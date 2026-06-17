/**
 * Humanized reveal pacing for persona replies.
 *
 * Timing model:
 *  - initial "read" delay before anything: 900–2600ms random, in silence
 *    (no typing indicator — as if she just saw the message);
 *  - per bubble line: typing indicator ON, wait
 *    clamp(700 + line.length * 45 + random(0..600), 900, 5200) ms,
 *    then reveal the bubble and hide typing;
 *  - 300–800ms random quiet gap between bubbles;
 *  - if the line queue is empty but the stream is not finished, the typing
 *    indicator stays on while waiting for the next line.
 */

export interface PacerCallbacks {
  onTypingStart(): void;
  onTypingStop(): void;
  onBubble(line: string): void;
  onDone?(): void;
}

export interface PacerOptions {
  /** [min, max] ms of silent "read" delay before anything. Default [900, 2600]. */
  readDelayMs?: [number, number];
  /** [min, max] ms of quiet gap between bubbles. Default [300, 800]. */
  gapMs?: [number, number];
  /** Typing duration = clamp(base + chars*perChar + random(0..jitter), min, max). */
  typeBaseMs?: number; // 700
  typePerCharMs?: number; // 45
  typeJitterMs?: number; // 600
  typeMinMs?: number; // 900
  typeMaxMs?: number; // 5200
  /**
   * Server-driven behavior (Phase-3 `{behavior}` SSE event). When present these
   * EXACT, state-derived values override the local heuristics; the local
   * defaults above stay as the fallback when the event is absent. The numbers
   * are computed server-side from mood/energy/closeness/passport, so the client
   * just plays them back instead of guessing.
   */
  server?: ServerBehavior;
}

/**
 * Per-turn pacing as computed by the backend behavior layer and delivered over
 * the chat SSE `{behavior}` frame. All fields optional — any subset overrides
 * the corresponding local heuristic; missing fields fall back to the defaults.
 */
export interface ServerBehavior {
  /** Exact silent "read" delay before the first bubble, ms (incl. busy long-tail). */
  readDelayMs?: number;
  /** Exact typing-indicator duration per bubble index, ms. */
  perBubbleTyping?: number[];
  /** Exact quiet gap BEFORE each bubble (index 0 unused), ms. */
  gapMs?: number[];
  /** How many bubbles she intends to send this turn (advisory; for indicators). */
  bubbleCount?: number;
  /** True when the read delay is a busy/asleep override (a long believable tail). */
  busyOverride?: boolean;
  /** Whether to show the ✓✓ "seen" receipt this turn (seenPolicy gate). */
  showSeen?: boolean;
  /** Rare "typing then stops" tease — start typing, then go quiet without a bubble. */
  typingThenStop?: boolean;
}

export interface LinePacer {
  /** Enqueue a completed line (already trimmed, non-empty). */
  push(line: string): void;
  /** Signal that no more lines will arrive; pacer drains the queue then resolves `done`. */
  finish(): void;
  /** Abort pacing: instantly reveal everything still queued, then resolve `done` (used on stream errors). */
  flush(): void;
  /** Resolves after the last bubble is revealed (or after flush). Never rejects. */
  done: Promise<void>;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function typingMs(line: string, o: Required<Omit<PacerOptions, 'server'>>): number {
  const ms = o.typeBaseMs + line.length * o.typePerCharMs + rand(0, o.typeJitterMs);
  return Math.min(o.typeMaxMs, Math.max(o.typeMinMs, ms));
}

/**
 * Create a push-based pacer: feed it lines as they complete (the SSE stream can
 * still be arriving — reveal starts as soon as the first line is ready), call
 * `finish()` after the stream ends, await `done`.
 */
export function createLinePacer(cb: PacerCallbacks, opts: PacerOptions = {}): LinePacer {
  const o: Required<Omit<PacerOptions, 'server'>> = {
    readDelayMs: opts.readDelayMs ?? [350, 1000],
    gapMs: opts.gapMs ?? [180, 420],
    typeBaseMs: opts.typeBaseMs ?? 300,
    typePerCharMs: opts.typePerCharMs ?? 22,
    typeJitterMs: opts.typeJitterMs ?? 350,
    typeMinMs: opts.typeMinMs ?? 450,
    typeMaxMs: opts.typeMaxMs ?? 2400,
  };
  // Server-driven behavior overrides (Phase 3). Absent → local heuristics.
  //
  // Live-reply clamp: the backend's behavior layer can emit a very long
  // "busy/asleep" read tail (e.g. 23 min) meant for WHEN she initiates a chat,
  // but here the user just sent a message and is staring at the thread — honoring
  // a multi-minute delay reads as a frozen "typing…" that never resolves until
  // you leave and re-open (then it loads from history). Bound the client reveal
  // to sane live-chat limits; the server's macro-timing (proactive scheduling)
  // is unaffected because that lives in the cron, not this pacer.
  const SV_MAX_READ_MS = 3000;
  const SV_MAX_TYPING_MS = 3500;
  const SV_MAX_GAP_MS = 1400;
  const sv: ServerBehavior | undefined = opts.server && {
    ...opts.server,
    readDelayMs:
      opts.server.readDelayMs != null
        ? Math.min(opts.server.readDelayMs, SV_MAX_READ_MS)
        : undefined,
    perBubbleTyping: opts.server.perBubbleTyping?.map((v) => Math.min(v, SV_MAX_TYPING_MS)),
    gapMs: opts.server.gapMs?.map((v) => Math.min(v, SV_MAX_GAP_MS)),
  };
  // Reveal counter so per-bubble server arrays line up with the order bubbles
  // are actually shown (drives perBubbleTyping[i] + gapMs[i]).
  let bubbleIdx = 0;

  const queue: string[] = [];
  let finished = false;
  let cancelled = false;
  let wake: (() => void) | null = null;
  let triggerCancel: () => void = () => {};
  const cancelSignal = new Promise<void>((r) => {
    triggerCancel = r;
  });

  const notify = () => {
    wake?.();
    wake = null;
  };
  /** Sleep that resolves early if the pacer is flushed. */
  const pause = (ms: number) => Promise.race([new Promise<void>((r) => setTimeout(r, ms)), cancelSignal]);

  const done = (async () => {
    // Silent "read" delay — she just saw the message. Server value (exact,
    // state-derived, can be a long busy/asleep tail) wins; else local random.
    await pause(sv?.readDelayMs != null ? sv.readDelayMs : rand(o.readDelayMs[0], o.readDelayMs[1]));

    // Rare "typing then stops" tease: flash the typing indicator, fall quiet,
    // then proceed normally (she "started to write, then didn't"). Server-gated.
    if (sv?.typingThenStop && !cancelled) {
      cb.onTypingStart();
      await pause(rand(900, 1800));
      cb.onTypingStop();
      await pause(rand(700, 1500));
    }

    let revealedAny = false;
    while (!cancelled) {
      if (!queue.length) {
        if (finished) break;
        // Stream still arriving but nothing complete yet — keep typing on.
        cb.onTypingStart();
        await new Promise<void>((r) => {
          wake = r;
        });
        continue;
      }
      const line = queue.shift()!;
      const idx = bubbleIdx++;
      if (revealedAny) {
        cb.onTypingStop();
        // Quiet gap BEFORE this bubble: server gapMs[idx] (exact) else local random.
        const gap = sv?.gapMs?.[idx];
        await pause(gap != null ? gap : rand(o.gapMs[0], o.gapMs[1]));
        if (cancelled) {
          queue.unshift(line);
          bubbleIdx--;
          break;
        }
      }
      cb.onTypingStart();
      // Typing duration: server perBubbleTyping[idx] (exact) else local heuristic.
      const tMs = sv?.perBubbleTyping?.[idx];
      await pause(tMs != null ? tMs : typingMs(line, o));
      cb.onTypingStop();
      if (cancelled) {
        queue.unshift(line);
        bubbleIdx--;
        break;
      }
      cb.onBubble(line);
      revealedAny = true;
    }

    cb.onTypingStop();
    if (cancelled) {
      // Flushed (e.g. stream error): reveal whatever is left instantly.
      while (queue.length) cb.onBubble(queue.shift()!);
    }
    cb.onDone?.();
  })();

  return {
    push(line: string) {
      queue.push(line);
      notify();
    },
    finish() {
      finished = true;
      notify();
    },
    flush() {
      cancelled = true;
      finished = true;
      triggerCancel();
      notify();
    },
    done,
  };
}

/**
 * Incremental '\n' splitter for SSE token streams: feed raw tokens with
 * `push`, it emits trimmed non-empty completed lines; call `flush()` after the
 * stream ends to emit the trailing partial line.
 */
export function createLineSplitter(onLine: (line: string) => void) {
  let buf = '';
  return {
    push(token: string) {
      buf += token;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) onLine(line);
      }
    },
    flush() {
      const tail = buf.trim();
      buf = '';
      if (tail) onLine(tail);
    },
  };
}
