'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import AIBadge from '@/components/AIBadge';
import Bubble, { type BubbleStatus } from '@/components/Bubble';
import Composer from '@/components/chat/Composer';
import VoiceBubble from '@/components/chat/VoiceBubble';
import TypingIndicator from '@/components/chat/TypingIndicator';
import Disclaimer from '@/components/chat/Disclaimer';
import SelfCorrectBubble from '@/components/chat/SelfCorrectBubble';
import ReactionTapback from '@/components/chat/ReactionTapback';
import { useInboxContext } from '@/components/InboxProvider';
import { createLinePacer, createLineSplitter } from '@/components/chat/pacing';
import { presenceText, useLocale, useT } from '@/i18n';
import {
  ApiError,
  audioUrl,
  chat,
  chatMultipart,
  getMessages,
  getPersona,
  listPersonas,
  markRead,
  personaAvatar,
  photoUrl,
  readSseEvents,
  requestSelfie,
  type ChatHistoryMessage,
  type PersonaPresence,
  type SseBehavior,
  type SseCorrect,
} from '@/lib/api';

// Layout effect on the client (pins the scroll BEFORE the browser paints, so a
// freshly-opened chat never flashes the top before snapping to the latest
// message); plain effect on the server to avoid the SSR warning. Module-level
// so the hook identity is stable across renders.
const useIsoLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

const DISCLAIMER_EVERY_MS = 3 * 60 * 60 * 1000; // 3h of session time
const DISCLAIMER_KEY = 'echo.disclaimer'; // + '.<personaId>' → last-shown ts

// `reaction` (Phase-3): an emoji tapback the persona left on a USER bubble —
// rendered as a small pill on the bubble, never as a normal message bubble.
type Entry =
  | { id: string; kind: 'msg'; role: 'user' | 'assistant'; content: string; ts: number; status?: BubbleStatus; reaction?: string }
  | { id: string; kind: 'disclaimer'; ts: number }
  | { id: string; kind: 'selfie'; ts: number } // Phase-2 stub card (501)
  | { id: string; kind: 'image'; role: 'user' | 'assistant'; url: string; caption?: string; uploading?: boolean; ts: number; status?: BubbleStatus; file?: File; reaction?: string }
  | { id: string; kind: 'voice'; role: 'user' | 'assistant'; transcript?: string | null; url?: string | null; ts: number; status?: BubbleStatus; blob?: Blob; reaction?: string }
  | { id: string; kind: 'note'; text: string; ts: number }; // inline "couldn't send a photo" line

interface Streaming {
  bubbles: string[];
  typing: boolean;
  // Phase-3 self-correction descriptors keyed by streamed bubble index — the
  // bubble at that index plays a visible type→backspace→fix before settling.
  corrections?: Record<number, SseCorrect>;
}

/** What the persona is doing this turn — drives header + in-thread indicator. */
type StreamActivity = 'typing' | 'selfie' | 'voice';

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** HH:MM in the device locale (24h-agnostic — Intl decides per locale). */
function formatTime(ts: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ts);
  } catch {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** Local calendar-day key (YYYY-MM-DD in local time) for day grouping. */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * "Today" / "Yesterday" / "D MMMM" for a day separator pill. The two relative
 * labels are NEW i18n keys (chat.today / chat.yesterday) — hardcoded English
 * here for now and flagged for the verify phase; the absolute date is from Intl.
 */
function dayLabel(ts: number, locale: string): string {
  const now = new Date();
  const d = new Date(ts);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today'; // chat.today
  if (diffDays === 1) return 'Yesterday'; // chat.yesterday
  try {
    const sameYear = d.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/** Map a history message (v2 multimodal fields) into a renderable Entry. */
function entryFromHistory(m: ChatHistoryMessage, personaId: string): Entry {
  const ts = new Date(m.createdAt).getTime() || Date.now();
  const role = m.role;
  // Read receipts for outgoing (user) bubbles loaded from history: a message the
  // persona has already "seen" carries readAt (✓✓); otherwise it reached the
  // server but isn't read yet (✓). Persona bubbles never show a status glyph.
  const status: BubbleStatus | undefined =
    role === 'user' ? (m.readAt ? 'seen' : 'sent') : undefined;
  if ((m.kind === 'image' || m.kind === 'selfie') && m.imageFile) {
    return { id: uid(), kind: 'image', role, url: photoUrl(personaId, m.imageFile), caption: m.content || undefined, ts, status };
  }
  if (m.kind === 'voice') {
    return {
      id: uid(),
      kind: 'voice',
      role,
      transcript: m.transcript ?? m.content ?? null,
      url: m.audioFile ? audioUrl(personaId, m.audioFile) : null,
      ts,
      status,
    };
  }
  return { id: uid(), kind: 'msg', role, content: m.content, ts, status };
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatScreen />
    </Suspense>
  );
}

function ChatScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { refresh: refreshInbox, setSuppressPersonaId } = useInboxContext();
  const params = useSearchParams();
  const router = useRouter();
  const idParam = params.get('id');

  const [personaId, setPersonaId] = useState<string | null>(idParam);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [sending, setSending] = useState(false);
  const [selfieIncoming, setSelfieIncoming] = useState(false); // [[SELFIE]] pending placeholder
  // What she's doing right now (drives the live header + the distinct in-thread
  // indicator): 'typing' default, 'selfie' while a photo renders, 'voice' while
  // a voice note is synthesized.
  const [streamActivity, setStreamActivity] = useState<StreamActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personaName, setPersonaName] = useState<string | null>(null);
  const [presence, setPresence] = useState<PersonaPresence | null>(null);
  const [personaExists, setPersonaExists] = useState<boolean | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [ambient, setAmbient] = useState<string[] | undefined>(undefined);

  // Scroll-to-bottom FAB: shown when the user has scrolled up off the bottom.
  const [showFab, setShowFab] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0); // persona msgs arrived while unpinned
  // On-screen keyboard inset (px), mirrored from the --kb CSS var the shell sets.
  const [kb, setKb] = useState(0);

  const entriesRef = useRef<Entry[]>([]);
  const personaIdRef = useRef<string | null>(personaId);
  const lastSentRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSeenTsRef = useRef<number>(0); // newest message ts we've already shown
  const sendingRef = useRef(false); // guards the proactive poll while a turn is in flight

  const append = useCallback((next: Entry[]) => {
    // Count persona messages that land while the user is scrolled up reading
    // history, so the FAB can surface a "N new" accent badge.
    const prev = entriesRef.current;
    if (!pinnedRef.current && next.length > prev.length) {
      const prevIds = new Set(prev.map((e) => e.id));
      const addedFromPersona = next.filter(
        (e) =>
          !prevIds.has(e.id) &&
          (e.kind === 'msg' || e.kind === 'image' || e.kind === 'voice') &&
          e.role === 'assistant',
      ).length;
      if (addedFromPersona) setUnseenCount((n) => n + addedFromPersona);
    }
    entriesRef.current = next;
    setEntries(next);
  }, []);

  /**
   * Append a disclaimer if none shown yet or the last one is older than 3h —
   * but NEVER mid-stream: if a turn is in flight, defer (the 60s timer or the
   * turn's `finally` re-runs this), so the system line can't split her reply.
   */
  const ensureDisclaimer = useCallback(() => {
    const pid = personaIdRef.current;
    if (!pid) return;
    if (sendingRef.current) return; // a turn is mid-stream — never interrupt
    const key = `${DISCLAIMER_KEY}.${pid}`;
    let last = 0;
    try {
      last = Number(localStorage.getItem(key)) || 0;
    } catch {
      /* localStorage unavailable — show it */
    }
    if (Date.now() - last > DISCLAIMER_EVERY_MS) {
      try {
        localStorage.setItem(key, String(Date.now()));
      } catch {
        /* ignore */
      }
      append([...entriesRef.current, { id: uid(), kind: 'disclaimer', ts: Date.now() }]);
    }
  }, [append]);

  // Resolve persona (?id= or first persona), load header info + history.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let pid = idParam;
        if (!pid) {
          const list = await listPersonas();
          pid = (list.find((p) => p.status === 'ready') ?? list[0])?.id ?? null;
        }
        if (cancelled) return;
        if (!pid) {
          setPersonaExists(false);
          setHydrated(true);
          return;
        }
        personaIdRef.current = pid;
        setPersonaId(pid);

        const [detail, history] = await Promise.all([getPersona(pid), getMessages(pid)]);
        if (cancelled) return;
        if (detail.status !== 'ready') {
          // Unfinished persona — send the user back into the wizard instead of a chat that 400s.
          const step =
            detail.status === 'building' ? 'building' : detail.status === 'ingested' ? '4' : '2';
          router.replace(`/create?id=${encodeURIComponent(pid)}&step=${step}`);
          return;
        }
        setPersonaExists(true);
        setPersonaName(detail.name || null);
        setPresence(detail.presence ?? null);
        if (Array.isArray(detail.ambient) && detail.ambient.length >= 3) {
          setAmbient(detail.ambient);
        }
        setAvatar(personaAvatar(detail));

        append(history.map((m) => entryFromHistory(m, pid!)));
        lastSeenTsRef.current = history.length
          ? new Date(history[history.length - 1].createdAt).getTime() || Date.now()
          : 0;
        setHydrated(true);
        ensureDisclaimer();
        // Opening the chat clears that persona's unread badge; tell the shell to
        // re-poll the inbox so the badge updates immediately.
        void markRead(pid).then(() => refreshInbox()).catch(() => {});
      } catch {
        if (!cancelled) {
          setPersonaExists(false);
          setHydrated(true);
        }
      }
    })();
    const timer = setInterval(ensureDisclaimer, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [idParam, append, ensureDisclaimer, refreshInbox]);

  // Mute this persona's own proactive banner while its chat is open; clear on
  // unmount so banners resume elsewhere. Keyed on the resolved persona id.
  useEffect(() => {
    if (!personaId) return;
    setSuppressPersonaId(personaId);
    return () => setSuppressPersonaId(null);
  }, [personaId, setSuppressPersonaId]);

  // Pin-to-bottom like Telegram: stay pinned while the user is near the bottom,
  // release when they scroll up to read history. The FAB appears while unpinned.
  const pinnedRef = useRef(true);
  useEffect(() => {
    const ph = document.querySelector('.phone');
    if (!ph) return;
    const onScroll = () => {
      const pinned = ph.scrollHeight - ph.scrollTop - ph.clientHeight < 120;
      pinnedRef.current = pinned;
      setShowFab(!pinned);
      if (pinned) setUnseenCount(0); // back at the bottom → caught up
    };
    ph.addEventListener('scroll', onScroll, { passive: true });
    return () => ph.removeEventListener('scroll', onScroll);
  }, []);

  /** Smooth-scroll the phone scroller to the bottom and re-pin. */
  const scrollToBottom = useCallback((smooth = true) => {
    const ph = document.querySelector('.phone');
    if (!ph) return;
    ph.scrollTo({ top: ph.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    pinnedRef.current = true;
    setShowFab(false);
    setUnseenCount(0);
  }, []);

  // Mirror the shell's --kb keyboard inset into state so the composer wrapper
  // can offset by it AND we can re-pin when the keyboard opens/closes.
  useEffect(() => {
    const read = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--kb');
      const px = parseFloat(raw) || 0;
      setKb((prev) => (prev !== px ? px : prev));
    };
    read();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', read);
    return () => vv?.removeEventListener('resize', read);
  }, []);

  // Pin BEFORE paint (layout effect) so opening a chat — or a new message while
  // pinned — never shows a frame at the old scroll position then jerks down.
  // Runs synchronously after the DOM mutates; reading scrollHeight forces layout
  // so the set position is correct for the just-rendered content.
  useIsoLayoutEffect(() => {
    if (!pinnedRef.current) return;
    const ph = document.querySelector('.phone');
    if (!ph) return;
    ph.scrollTop = ph.scrollHeight;
  }, [entries, streaming, sending, error, streamActivity, kb]);

  // Keep the view pinned to the bottom while content GROWS asynchronously —
  // avatars, image bubbles, voice notes and web-fonts all load after the first
  // paint, each adding height. Without this the initial scroll-to-bottom lands
  // on a too-short scrollHeight and the user ends up stranded mid-thread once
  // the images settle. A ResizeObserver on the scroll content re-snaps to the
  // bottom on every height change, but only while the user is still pinned (so
  // it never yanks them down while they read history). It fires once per chat
  // open as the content settles, then goes quiet.
  useEffect(() => {
    if (!hydrated) return;
    const ph = document.querySelector('.phone');
    const content = ph?.firstElementChild;
    if (!ph || !content) return;
    const snap = () => {
      if (pinnedRef.current) ph.scrollTop = ph.scrollHeight;
    };
    snap(); // initial jump once entries have hydrated
    const ro = new ResizeObserver(snap);
    ro.observe(content);
    // Late-loading <img>/<audio> may not trigger the observer on every engine;
    // belt-and-suspenders snap on each media load while still pinned.
    const onMedia = () => snap();
    ph.querySelectorAll('img, audio').forEach((el) =>
      el.addEventListener('load', onMedia, { once: true }),
    );
    return () => ro.disconnect();
  }, [hydrated, personaId]);

  /**
   * POST the message, parse SSE, split persona tokens into lines on '\n' —
   * but REVEAL bubbles only through the pacing helper (read delay, typing
   * indicator, per-line typing time, quiet gaps). The stream is consumed at
   * full speed into the pacer's queue; reveal can start while it still arrives.
   */
  /**
   * Drive one chat turn. `parts` chooses the transport:
   *  - plain text → JSON `chat()` (unchanged path, used for retry too)
   *  - image/audio attached → multipart `chatMultipart()`
   * Either way the SSE is read with `readSseEvents` so the `[[SELFIE]]` flow
   * (selfie:pending → selfie:<file>/failed) is handled while keeping the
   * humanized pacer driving the text bubbles.
   */
  /** Flip the status glyph on this turn's optimistic user entries. */
  const setTurnStatus = useCallback(
    (ids: string[] | undefined, status: BubbleStatus) => {
      if (!ids?.length) return;
      const set = new Set(ids);
      append(
        entriesRef.current.map((e) =>
          set.has(e.id) && (e.kind === 'msg' || e.kind === 'image' || e.kind === 'voice')
            ? { ...e, status }
            : e,
        ),
      );
    },
    [append],
  );

  const runStream = useCallback(
    async (
      parts: { text?: string; imageFile?: File; audioBlob?: Blob },
      onUploaded?: () => void,
      pendingIds?: string[],
    ) => {
      const pid = personaIdRef.current;
      if (!pid) return;
      // Remember last *text* turn for the retry button (multipart isn't replayable).
      if (parts.text && !parts.imageFile && !parts.audioBlob) lastSentRef.current = parts.text;
      setSending(true);
      sendingRef.current = true;
      setError(null);
      setStreamActivity('typing');

      // Voice reply: backend streams the spoken text as tokens AND emits voice
      // events once synthesis finishes. While a voice note is being prepared we
      // hide this turn's text bubbles (show only a "recording" indicator) and
      // then render a single voice bubble instead.
      let voiceMode = false;
      let voiceFile: string | null = null;

      const revealed: string[] = [];
      // Phase-3: self-correction descriptors keyed by streamed bubble index, and
      // the server-driven behavior (pacing) for THIS turn — both arrive on the
      // SSE stream; the pacer reads `serverBehavior` at creation time.
      const corrections: Record<number, SseCorrect> = {};
      let serverBehavior: SseBehavior | null = null;
      let lastTyping = false; // remembered so a late {correct} re-sync keeps the indicator state
      const sync = (typing: boolean) => {
        lastTyping = typing;
        setStreaming(
          voiceMode
            ? { bubbles: [], typing: true }
            : { bubbles: [...revealed], typing, corrections: { ...corrections } },
        );
      };
      sync(false); // silent "read" phase — no typing indicator yet

      // The pacer is created lazily — on the FIRST line ready to enqueue — so the
      // early `{behavior}` SSE event (which precedes the tokens) is already
      // captured and its exact, state-derived pacing drives the reveal. Falls
      // back to local heuristics when no behavior event was sent. A holder
      // object (vs a bare `let`) keeps TS from narrowing the field to `never`
      // when it can't see the assignment escape the nested `ensurePacer`.
      const pacerRef: { current: ReturnType<typeof createLinePacer> | null } = { current: null };
      const ensurePacer = () => {
        if (pacerRef.current) return pacerRef.current;
        pacerRef.current = createLinePacer(
          {
            onTypingStart: () => sync(true),
            onTypingStop: () => sync(false),
            onBubble: (line) => {
              revealed.push(line);
              sync(false);
            },
          },
          serverBehavior ? { server: serverBehavior } : undefined,
        );
        return pacerRef.current;
      };
      const splitter = createLineSplitter((line) => {
        if (/^\s*(або|чи|or)\s*$/i.test(line)) return; // bare divider
        // Multi-word *...* = stage direction (drop the span); single word = emphasis (keep word).
        const cleaned = line
          .replace(/\*([^*]+)\*/g, (_m, inner: string) => (inner.trim().includes(' ') ? '' : inner))
          .replace(/\*/g, '')
          .replace(/[ \t]{2,}/g, ' ')
          .trim();
        if (cleaned) ensurePacer().push(cleaned);
      });

      // Track a pending selfie so we can show a placeholder and append on result.
      let selfiePending = false;
      const appendSelfie = (file: string) => {
        append([
          ...entriesRef.current,
          { id: uid(), kind: 'image', role: 'assistant', url: photoUrl(pid, file), ts: Date.now() },
        ]);
      };
      const appendSelfieNote = (text: string) => {
        append([...entriesRef.current, { id: uid(), kind: 'note', text, ts: Date.now() }]);
      };

      let full = '';
      try {
        const multipart = !!(parts.imageFile || parts.audioBlob);
        const res = multipart ? await chatMultipart(pid, parts) : await chat(pid, parts.text ?? '');
        // The response is back → the file finished uploading. Clear the bubble's
        // loading overlay now (Telegram-style), and mark this turn delivered.
        onUploaded?.();
        setTurnStatus(pendingIds, 'sent');
        // Read receipt (Phase-3 seen-gating): the bubble reaches the server →
        // ✓ ('sent', already set above). The ✓✓ 'seen' receipt is now SERVER-
        // GATED — only flip it when the `{behavior}` event signals showSeen.
        // Legacy fallback: if no behavior event arrives all turn, flip to seen
        // on stream end (older backends had no seenPolicy).
        let seenFlipped = false;
        let behaviorSeen = false; // a behavior event explicitly decided seen
        const flipSeen = () => {
          if (seenFlipped) return;
          seenFlipped = true;
          setTurnStatus(pendingIds, 'seen');
        };
        await readSseEvents(res, (ev) => {
          if (ev.type === 'behavior') {
            // Early, state-driven pacing for this turn → feeds the pacer when it
            // is (lazily) created. Also carries the seen-gating decision.
            serverBehavior = ev.behavior;
            behaviorSeen = true;
            if (ev.behavior.showSeen) flipSeen();
            return;
          }
          if (ev.type === 'reaction') {
            // Emoji-only tapback on the user's last bubble this turn — NOT a
            // normal bubble. The persona has "seen" the message to react to it.
            flipSeen();
            const targetId = pendingIds?.[pendingIds.length - 1];
            if (targetId) {
              append(
                entriesRef.current.map((e) =>
                  e.id === targetId &&
                  (e.kind === 'msg' || e.kind === 'image' || e.kind === 'voice')
                    ? { ...e, reaction: ev.reaction }
                    : e,
                ),
              );
            }
            return;
          }
          if (ev.type === 'correct') {
            // Visible self-correction on the streamed bubble at this index.
            corrections[ev.correct.bubbleIndex] = ev.correct;
            sync(lastTyping); // push the descriptor into state in case the bubble is already shown
            return;
          }
          if (ev.type === 'token') {
            full += ev.token;
            splitter.push(ev.token);
          } else if (ev.type === 'selfie') {
            if (ev.selfie === 'pending') {
              selfiePending = true;
              setSelfieIncoming(true);
              setStreamActivity('selfie');
            } else if (ev.selfie === 'failed') {
              selfiePending = false;
              setSelfieIncoming(false);
              setStreamActivity('typing');
              appendSelfieNote(t('chat.couldntSendPhoto'));
            } else {
              // a filename — the generated selfie is ready
              selfiePending = false;
              setSelfieIncoming(false);
              setStreamActivity('typing');
              appendSelfie(ev.selfie);
            }
          } else if (ev.type === 'voice') {
            if (ev.voice === 'pending') {
              voiceMode = true; // hide text bubbles; show a "recording" indicator
              setSelfieIncoming(true);
              setStreamActivity('voice');
              sync(true);
            } else if (ev.voice === 'failed') {
              voiceMode = false; // fall back to the streamed text bubbles
              setSelfieIncoming(false);
              setStreamActivity('typing');
            } else {
              voiceFile = ev.voice; // her voice note is ready
            }
          }
          // caption events are backend-internal context; nothing to render.
        });
        splitter.flush();
        // Legacy seen fallback: a backend that never emitted a {behavior} event
        // has no seenPolicy, so keep the old "reply arrived → seen" semantics.
        if (!behaviorSeen && full.trim()) flipSeen();
        if (pacerRef.current) {
          pacerRef.current.finish();
          await pacerRef.current.done; // `sending` stays true until the last bubble is revealed
        }

        const content = full.trim();
        if (voiceMode && voiceFile) {
          // Her voice note carries the spoken text as its transcript — no text bubble.
          setSelfieIncoming(false);
          append([
            ...entriesRef.current,
            {
              id: uid(),
              kind: 'voice',
              role: 'assistant',
              transcript: content || null,
              url: audioUrl(pid, voiceFile),
              ts: Date.now(),
            },
          ]);
        } else if (content) {
          append([
            ...entriesRef.current,
            { id: uid(), kind: 'msg', role: 'assistant', content, ts: Date.now() },
          ]);
        }
      } catch (e) {
        splitter.flush();
        if (pacerRef.current) {
          pacerRef.current.flush();
          await pacerRef.current.done;
        }
        const partial = full.trim();
        if (partial) {
          append([
            ...entriesRef.current,
            { id: uid(), kind: 'msg', role: 'assistant', content: partial, ts: Date.now() },
          ]);
        }
        // This turn never reached the server (or aborted) → mark it retryable.
        setTurnStatus(pendingIds, 'failed');
        setError((e as Error).message || t('chat.errorGeneric'));
      } finally {
        if (selfiePending) setSelfieIncoming(false);
        lastSeenTsRef.current = Date.now();
        setStreaming(null);
        setStreamActivity(null);
        setSending(false);
        sendingRef.current = false;
        // A turn just finished — the deferred transparency line may run now.
        ensureDisclaimer();
      }
    },
    [append, t, setTurnStatus, ensureDisclaimer],
  );

  // Outgoing turns are serialized through a queue so the user can type/send
  // freely while a reply is still playing — nothing is ever blocked.
  const turnQueue = useRef<
    Array<{
      parts: { text?: string; imageFile?: File; audioBlob?: Blob };
      onUploaded?: () => void;
      pendingIds?: string[];
    }>
  >([]);
  const drainingRef = useRef(false);
  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (turnQueue.current.length) {
        const turn = turnQueue.current.shift()!;
        await runStream(turn.parts, turn.onUploaded, turn.pendingIds);
      }
    } finally {
      drainingRef.current = false;
    }
  }, [runStream]);
  const enqueueTurn = useCallback(
    (
      parts: { text?: string; imageFile?: File; audioBlob?: Blob },
      onUploaded?: () => void,
      pendingIds?: string[],
    ) => {
      turnQueue.current.push({ parts, onUploaded, pendingIds });
      void drainQueue();
    },
    [drainQueue],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    const id = uid();
    append([
      ...entriesRef.current,
      { id, kind: 'msg', role: 'user', content: text, ts: Date.now(), status: 'sending' },
    ]);
    enqueueTurn({ text }, undefined, [id]);
  }, [input, append, enqueueTurn]);

  /** Send an attached photo (optionally with a caption) as a user image bubble. */
  const sendImage = useCallback(
    (file: File, caption: string) => {
      const pid = personaIdRef.current;
      if (!pid) return;
      setInput('');
      const imgId = uid();
      append([
        ...entriesRef.current,
        { id: imgId, kind: 'image', role: 'user', url: URL.createObjectURL(file), caption: caption || undefined, uploading: true, ts: Date.now(), status: 'sending', file },
      ]);
      // Clear the loading overlay once the upload lands (or on failure).
      const clearUploading = () =>
        append(
          entriesRef.current.map((x) =>
            x.id === imgId && x.kind === 'image' ? { ...x, uploading: false } : x,
          ),
        );
      enqueueTurn({ imageFile: file, text: caption || undefined }, clearUploading, [imgId]);
    },
    [append, enqueueTurn],
  );

  /** Send a recorded voice clip; the user bubble shows transcript once it returns. */
  const sendVoice = useCallback(
    (blob: Blob) => {
      const pid = personaIdRef.current;
      if (!pid) return;
      // Optimistic local voice bubble (transcript fills in after the server replies).
      const id = uid();
      append([
        ...entriesRef.current,
        { id, kind: 'voice', role: 'user', transcript: null, url: URL.createObjectURL(blob), ts: Date.now(), status: 'sending', blob },
      ]);
      enqueueTurn({ audioBlob: blob }, undefined, [id]);
    },
    [append, enqueueTurn],
  );

  /**
   * Per-bubble retry: re-enqueue THAT specific failed turn from the stored
   * payload (text / File / Blob), flipping its glyph back to 'sending'. Falls
   * back to nothing if the entry can't be replayed.
   */
  const retryEntry = useCallback(
    (entry: Entry) => {
      setTurnStatus([entry.id], 'sending');
      setError(null);
      if (entry.kind === 'msg') {
        enqueueTurn({ text: entry.content }, undefined, [entry.id]);
      } else if (entry.kind === 'image' && entry.file) {
        const f = entry.file;
        const clearUploading = () =>
          append(
            entriesRef.current.map((x) =>
              x.id === entry.id && x.kind === 'image' ? { ...x, uploading: false } : x,
            ),
          );
        append(
          entriesRef.current.map((x) =>
            x.id === entry.id && x.kind === 'image' ? { ...x, uploading: true } : x,
          ),
        );
        enqueueTurn({ imageFile: f, text: entry.caption || undefined }, clearUploading, [entry.id]);
      } else if (entry.kind === 'voice' && entry.blob) {
        enqueueTurn({ audioBlob: entry.blob }, undefined, [entry.id]);
      }
    },
    [append, enqueueTurn, setTurnStatus],
  );

  // The error-card "Try again" replays the most recent text turn (legacy path).
  const retry = useCallback(() => {
    if (!lastSentRef.current) return;
    enqueueTurn({ text: lastSentRef.current });
  }, [enqueueTurn]);

  /**
   * While the chat is open, poll history every ~15s. Any persona-authored
   * message newer than what we've shown is a proactive "she texts first"
   * message — reveal it through the same humanized pacer (typing → bubble),
   * append non-text kinds directly, then markRead (the chat is open).
   */
  useEffect(() => {
    const pid = personaIdRef.current;
    if (!pid || personaExists === false) return;

    const reveal = (text: string) =>
      new Promise<void>((resolve) => {
        const revealed: string[] = [];
        const sync = (typing: boolean) => setStreaming({ bubbles: [...revealed], typing });
        setStreamActivity('typing');
        sync(false);
        const pacer = createLinePacer({
          onTypingStart: () => sync(true),
          onTypingStop: () => sync(false),
          onBubble: (line) => {
            revealed.push(line);
            sync(false);
          },
          onDone: () => {
            append([...entriesRef.current, { id: uid(), kind: 'msg', role: 'assistant', content: text.trim(), ts: Date.now() }]);
            setStreaming(null);
            setStreamActivity(null);
            resolve();
          },
        });
        const splitter = createLineSplitter((line) => {
        if (/^\s*(або|чи|or)\s*$/i.test(line)) return; // bare divider
        // Multi-word *...* = stage direction (drop the span); single word = emphasis (keep word).
        const cleaned = line
          .replace(/\*([^*]+)\*/g, (_m, inner: string) => (inner.trim().includes(' ') ? '' : inner))
          .replace(/\*/g, '')
          .replace(/[ \t]{2,}/g, ' ')
          .trim();
        if (cleaned) pacer.push(cleaned);
      });
        splitter.push(text);
        splitter.flush();
        pacer.finish();
      });

    const poll = async () => {
      if (sendingRef.current) return; // don't collide with an in-flight turn
      let history: ChatHistoryMessage[];
      try {
        history = await getMessages(pid);
      } catch {
        return;
      }
      const fresh = history.filter(
        (m) => m.role === 'assistant' && (new Date(m.createdAt).getTime() || 0) > lastSeenTsRef.current,
      );
      if (!fresh.length) return;
      lastSeenTsRef.current = new Date(fresh[fresh.length - 1].createdAt).getTime() || Date.now();
      for (const m of fresh) {
        if (m.kind === 'image' || m.kind === 'selfie' || m.kind === 'voice') {
          append([...entriesRef.current, entryFromHistory(m, pid)]);
        } else if (m.content?.trim()) {
          await reveal(m.content); // humanized pacing, as if she just wrote
        }
      }
      // chat is open → keep it read, and nudge the shell inbox to re-poll.
      void markRead(pid).then(() => refreshInbox()).catch(() => {});
    };

    const timer = setInterval(() => void poll(), 15_000);
    return () => clearInterval(timer);
  }, [personaExists, append, refreshInbox]);

  /** Selfie chip → POST selfie; image bubble on success, Phase-2 stub on 501. */
  const onSelfie = useCallback(() => {
    const pid = personaIdRef.current;
    if (!pid || sending) return;
    setSending(true);
    setError(null);
    setSelfieIncoming(true);
    setStreamActivity('selfie');
    requestSelfie(pid)
      .then(({ file }) => {
        append([
          ...entriesRef.current,
          { id: uid(), kind: 'image', role: 'assistant', url: photoUrl(pid, file), ts: Date.now() },
        ]);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 501) {
          // Feature not enabled on the server yet — keep the Phase-2 stub card.
          append([...entriesRef.current, { id: uid(), kind: 'selfie', ts: Date.now() }]);
        } else if (e instanceof ApiError && (e.status === 422 || e.status === 502)) {
          // Friendly inline message (e.message carries the backend's photo_rejected /
          // 502 copy) — never surface raw "Forbidden".
          append([
            ...entriesRef.current,
            {
              id: uid(),
              kind: 'note',
              text:
                e.message ||
                (e.status === 422 ? t('chat.photoRejected') : t('chat.couldntSendPhoto')),
              ts: Date.now(),
            },
          ]);
        } else {
          setError((e as Error).message || t('chat.errorGeneric'));
        }
      })
      .finally(() => {
        setSelfieIncoming(false);
        setStreamActivity(null);
        setSending(false);
      });
  }, [sending, append, t]);

  // ---- Build the flat render list: day separators + grouped bubble runs ----
  // Persona text entries split per-line into multiple bubbles; those bubbles +
  // adjacent same-sender entries form a "run". Within a run the gap is tight
  // (2px) and only the LAST bubble carries a tail + timestamp; between runs the
  // gap opens up (8px). Day separators reset grouping at each calendar day.
  type BubbleUnit = {
    kind: 'bubble';
    key: string;
    entry: Extract<Entry, { kind: 'msg' | 'image' | 'voice' }>;
    line?: string; // for split persona text bubbles
    from: 'persona' | 'user';
  };
  type RenderUnit =
    | { kind: 'day'; key: string; label: string }
    | { kind: 'special'; key: string; entry: Entry }
    | (BubbleUnit & {
        tail: boolean;
        time?: string;
        status?: BubbleStatus;
        gapBefore: number;
      });

  const renderUnits = useMemo<RenderUnit[]>(() => {
    // 1) Flatten entries → bubble units (+ pass-through specials), with day breaks.
    const flat: Array<
      | { kind: 'day'; key: string; label: string }
      | { kind: 'special'; key: string; entry: Entry }
      | BubbleUnit
    > = [];
    let lastDay: string | null = null;

    for (const e of entries) {
      const dk = dayKey(e.ts);
      if (dk !== lastDay) {
        flat.push({ kind: 'day', key: `day_${dk}_${e.id}`, label: dayLabel(e.ts, locale) });
        lastDay = dk;
      }
      if (e.kind === 'disclaimer' || e.kind === 'selfie' || e.kind === 'note') {
        flat.push({ kind: 'special', key: e.id, entry: e });
        continue;
      }
      if (e.kind === 'image' || e.kind === 'voice') {
        flat.push({ kind: 'bubble', key: e.id, entry: e, from: e.role === 'user' ? 'user' : 'persona' });
        continue;
      }
      // text message
      const from = e.role === 'user' ? 'user' : 'persona';
      if (from === 'user') {
        flat.push({ kind: 'bubble', key: e.id, entry: e, from });
      } else {
        const lines = e.content.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) flat.push({ kind: 'bubble', key: e.id, entry: e, from });
        else
          lines.forEach((line, i) =>
            flat.push({ kind: 'bubble', key: `${e.id}_${i}`, entry: e, line, from }),
          );
      }
    }

    // 2) Decorate bubble units: tail + timestamp on the last bubble of each run,
    //    gapBefore from whether the previous unit was the same sender.
    const out: RenderUnit[] = [];
    for (let i = 0; i < flat.length; i++) {
      const u = flat[i];
      if (u.kind !== 'bubble') {
        out.push(u);
        continue;
      }
      const next = flat[i + 1];
      const prev = flat[i - 1];
      const lastOfRun = !(next && next.kind === 'bubble' && next.from === u.from);
      const sameAsPrev = prev && prev.kind === 'bubble' && prev.from === u.from;
      const status = u.from === 'user' ? u.entry.status : undefined;
      out.push({
        ...u,
        tail: lastOfRun,
        time: lastOfRun ? formatTime(u.entry.ts, locale) : undefined,
        status: lastOfRun ? status : undefined,
        gapBefore: sameAsPrev ? 2 : 8,
      });
    }
    return out;
  }, [entries, locale]);

  // Group the flat units into one <section> per calendar day, each led by its
  // date pill. The pill is `position: sticky` INSIDE its section, so the section
  // box bounds it: when you scroll into the next day, that section's bottom edge
  // pushes the outgoing pill up and out exactly as the next day's pill arrives —
  // the Telegram "replace, don't stack" behaviour, pure CSS, no scroll JS.
  const daySections = useMemo(() => {
    type Sec = { key: string; label: string | null; units: Exclude<RenderUnit, { kind: 'day' }>[] };
    const sections: Sec[] = [];
    let cur: Sec | null = null;
    for (const u of renderUnits) {
      if (u.kind === 'day') {
        cur = { key: u.key, label: u.label, units: [] };
        sections.push(cur);
      } else {
        if (!cur) {
          cur = { key: 'lead', label: null, units: [] };
          sections.push(cur);
        }
        cur.units.push(u);
      }
    }
    return sections;
  }, [renderUnits]);

  // Live header sub-line: while she's working show an animated activity word
  // instead of the frozen last-seen; otherwise fall back to presence.
  const liveActivity: StreamActivity | null =
    streamActivity ?? (streaming?.typing || sending ? 'typing' : null);
  // i18n: NEW keys flagged for the verify phase — hardcoded English for now.
  const activityLabel =
    liveActivity === 'selfie'
      ? 'taking a photo' // chat.takingPhoto
      : liveActivity === 'voice'
        ? 'recording' // chat.recordingShort
        : liveActivity === 'typing'
          ? 'typing' // chat.typingShort
          : null;

  const title = (
    <Link
      href={personaId ? `/persona?id=${encodeURIComponent(personaId)}` : '/persona'}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}
    >
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          flexShrink: 0,
          overflow: 'hidden',
          background: 'var(--glass-strong)',
          border: '1px solid var(--glass-border)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          (personaName?.[0] ?? '·')
        )}
      </span>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
          {personaName ?? t('chat.conversation')}
        </span>
        {activityLabel ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 400,
              color: 'var(--accent)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <style>{'@keyframes vl-blink{0%,100%{opacity:1}50%{opacity:0.35}}'}</style>
            {activityLabel}
            <span aria-hidden style={{ animation: 'vl-blink 1.1s infinite ease-in-out' }}>
              …
            </span>
          </span>
        ) : presence ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 400,
              color: 'var(--text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}
          >
            {presenceText(presence, t)}
          </span>
        ) : null}
      </span>
      <AIBadge style={{ flexShrink: 0 }} />
    </Link>
  );

  // Call entry: a phone icon in the header right slot → the full-screen call
  // screen, which gates on her cloned voice (and explains how to add it).
  const callButton =
    personaId && personaExists !== false ? (
      <Link
        href={`/call?id=${encodeURIComponent(personaId)}`}
        aria-label={t('call.startAria', { name: personaName ?? t('chat.personaFallback') })}
        className="glass-strong"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: '50%',
          flexShrink: 0,
          color: 'var(--accent)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.18z" />
        </svg>
      </Link>
    ) : undefined;

  /** Render one decorated bubble unit (text line / image / voice). */
  const renderBubble = (
    u: Extract<RenderUnit, { kind: 'bubble' }>,
  ): React.ReactNode => {
    const inner = renderBubbleInner(u);
    // Phase-3 reaction tapback: the persona's emoji reply on a USER bubble,
    // pinned to the tail (last) bubble of the run so it doesn't duplicate across
    // split lines. Rendered as a small overlapping pill, never a chat bubble.
    const reaction =
      u.tail && 'reaction' in u.entry ? (u.entry as { reaction?: string }).reaction : undefined;
    if (!reaction) return inner;
    return (
      <div style={{ position: 'relative' }}>
        {inner}
        {/* Overlap the bubble's lower OUTER corner: the persona reacts to the
            user's (right-aligned) bubble, so hug the inner-left edge of the
            row's 12px side padding; mirror for the rare persona-side case. */}
        <div
          style={{
            position: 'absolute',
            bottom: -8,
            ...(u.from === 'user' ? { left: 6 } : { right: 6 }),
            pointerEvents: 'none',
          }}
        >
          <ReactionTapback emoji={reaction} />
        </div>
      </div>
    );
  };

  /** Render the bare bubble (text line / image / voice) without the reaction overlay. */
  const renderBubbleInner = (
    u: Extract<RenderUnit, { kind: 'bubble' }>,
  ): React.ReactNode => {
    const { entry, from, tail, time, status } = u;
    const retryLabel = t('common.tryAgain');
    const onRetry = status === 'failed' ? () => retryEntry(entry) : undefined;

    if (entry.kind === 'image') {
      return (
        <Bubble
          from={from}
          tail={tail}
          time={time}
          status={status}
          onRetry={onRetry}
          retryLabel={retryLabel}
        >
          <div style={{ position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.url}
              alt={from === 'user' ? t('chat.photoYouSent') : t('chat.photoFromPersona')}
              style={{
                display: 'block',
                maxWidth: '100%',
                borderRadius: 12,
                filter: entry.uploading ? 'brightness(0.7)' : 'none',
              }}
            />
            {entry.uploading ? (
              <span
                aria-label={t('chat.sendingAria')}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: 34,
                  height: 34,
                  marginTop: -17,
                  marginLeft: -17,
                  borderRadius: '50%',
                  border: '3px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  animation: 'vl-spin 0.8s linear infinite',
                }}
              />
            ) : null}
            <style>{'@keyframes vl-spin{to{transform:rotate(360deg)}}'}</style>
          </div>
          {entry.caption ? (
            <div style={{ marginTop: 6, fontSize: 14, whiteSpace: 'pre-wrap' }}>{entry.caption}</div>
          ) : null}
        </Bubble>
      );
    }

    if (entry.kind === 'voice') {
      return (
        <VoiceBubble
          from={from}
          transcript={entry.transcript}
          audioSrc={entry.url ?? undefined}
          tail={tail}
          time={time}
          status={status}
          onRetry={onRetry}
          retryLabel={retryLabel}
        />
      );
    }

    // text — `line` is set for split persona bubbles; user keeps full content.
    return (
      <Bubble
        from={from}
        tail={tail}
        time={time}
        status={status}
        onRetry={onRetry}
        retryLabel={retryLabel}
      >
        {u.line ?? entry.content}
      </Bubble>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <AmbientBg colors={ambient} />
      <GlassBar back="/home" title={title} right={callButton} />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '4px 0 12px',
        }}
      >
        {personaExists === false ? (
          <div style={{ padding: '0 12px' }}>
            <GlassCard>
              <p style={{ fontSize: 15, marginBottom: 12 }}>{t('chat.noPersona')}</p>
              <Link href="/create" className="btn-solid" style={{ width: '100%' }}>
                {t('common.createPersona')}
              </Link>
            </GlassCard>
          </div>
        ) : null}

        {daySections.map((sec) => (
          <section key={sec.key}>
            {sec.label ? (
              <div
                style={{
                  position: 'sticky',
                  top: 'calc(62px + env(safe-area-inset-top, 0px))',
                  zIndex: 2,
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '8px 0 4px',
                  pointerEvents: 'none',
                }}
              >
                <span
                  className="glass-strong"
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    fontSize: 12,
                    color: 'var(--text-dim)',
                  }}
                >
                  {sec.label}
                </span>
              </div>
            ) : null}
            {sec.units.map((u) => {
              if (u.kind === 'special') {
                const e = u.entry;
                if (e.kind === 'disclaimer')
                  return <div key={u.key} style={{ marginTop: 8 }}><Disclaimer /></div>;
                if (e.kind === 'selfie')
                  return (
                    <div key={u.key} style={{ padding: '0 12px', marginTop: 8 }}>
                      <GlassCard>
                        <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('chat.selfieStub')}</p>
                      </GlassCard>
                    </div>
                  );
                // note
                return (
                  <div
                    key={u.key}
                    style={{
                      textAlign: 'center',
                      fontSize: 13,
                      color: 'var(--text-dim)',
                      padding: '4px 24px',
                      marginTop: 8,
                    }}
                  >
                    {e.kind === 'note' ? e.text : null}
                  </div>
                );
              }
              // bubble unit
              return (
                <div key={u.key} style={{ marginTop: u.gapBefore }}>
                  {renderBubble(u)}
                </div>
              );
            })}
          </section>
        ))}

        {hydrated &&
        personaExists !== false &&
        !entries.some((e) => e.kind === 'msg') &&
        !sending ? (
          <div
            style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-dim)', padding: '16px 24px' }}
          >
            {t('chat.writeFirst', { name: personaName ?? t('chat.personaFallback') })}
          </div>
        ) : null}

        {streaming
          ? streaming.bubbles.map((line, i) => (
              <div key={`stream_${i}`} style={{ marginTop: i === 0 ? 8 : 2 }}>
                {/* Phase-3: a streamed bubble carrying a self-correction plays a
                    subtle type→backspace→fix; otherwise a plain persona bubble.
                    Either way the final text is the correct `line`. */}
                <SelfCorrectBubble line={line} correct={streaming.corrections?.[i]} tail={false} />
              </div>
            ))
          : null}
        {/* Distinct in-thread indicator: framed shimmer for a selfie, waveform
            for a voice note, three dots otherwise. */}
        {streamActivity === 'selfie' || (selfieIncoming && streamActivity !== 'voice') ? (
          <div style={{ marginTop: 8 }}>
            <TypingIndicator variant="selfie" />
          </div>
        ) : streamActivity === 'voice' ? (
          <div style={{ marginTop: 8 }}>
            <TypingIndicator variant="voice" />
          </div>
        ) : streaming ? (
          streaming.typing ? (
            <div style={{ marginTop: 8 }}>
              <TypingIndicator />
            </div>
          ) : null
        ) : sending ? (
          <div style={{ marginTop: 8 }}>
            <TypingIndicator />
          </div>
        ) : null}

        {error ? (
          <div style={{ padding: '0 12px' }}>
            <GlassCard>
              <p style={{ fontSize: 14, marginBottom: 10 }}>{t('chat.error', { error })}</p>
              <button type="button" className="btn-glass" style={{ width: '100%' }} onClick={retry}>
                {t('common.tryAgain')}
              </button>
            </GlassCard>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {/* Sticky composer chrome — translated up by the on-screen keyboard inset
          (--kb, set by the shell) so it stays above the keyboard. */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          transform: 'translateY(calc(-1 * var(--kb, 0px)))',
          transition: 'transform 0.18s ease',
        }}
      >
        {/* Scroll-to-bottom FAB — only while scrolled up; shows N-new accent
            badge for persona messages that arrived while reading history. */}
        {showFab ? (
          <button
            type="button"
            aria-label="Scroll to latest messages"
            className="glass-strong"
            onClick={() => scrollToBottom(true)}
            style={{
              position: 'absolute',
              right: 14,
              top: -52,
              width: 40,
              height: 40,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text)',
              zIndex: 5,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {unseenCount > 0 ? (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 9,
                  background: 'var(--accent)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {unseenCount > 99 ? '99+' : unseenCount}
              </span>
            ) : null}
          </button>
        ) : null}

        <div
          style={{
            padding: '8px 12px calc(10px + env(safe-area-inset-bottom, 0px))',
            background: 'linear-gradient(to top, rgba(239,239,244,0.95), rgba(239,239,244,0))',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <button
            type="button"
            aria-label={t('chat.askPhotoAria')}
            className="glass-strong"
            onClick={onSelfie}
            disabled={personaExists === false}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-dim)',
              opacity: personaExists === false ? 0.5 : 1,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="7" width="18" height="13" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8.5 7L10 4.5H14L15.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="13.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Composer
              value={input}
              onChange={setInput}
              onSend={send}
              onSendImage={sendImage}
              onSendVoice={sendVoice}
              disabled={personaExists === false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
