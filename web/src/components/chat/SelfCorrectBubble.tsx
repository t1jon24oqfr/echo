'use client';

/**
 * A streaming persona bubble that can play a SUBTLE, one-word self-correction
 * (type a wrong partial → backspace → type the real word) before settling on the
 * final, correct line. Phase-3 `{correct}` SSE event.
 *
 * Invariants:
 *  - the RESTING / final text is ALWAYS the correct `line` — an uncorrected typo
 *    is never shown, even for a frame, if the animation is skipped;
 *  - `prefers-reduced-motion` (or a missing/incoherent descriptor) → render the
 *    final line immediately, no animation;
 *  - the animation is transient and ends exactly on `line`.
 *
 * Animation model (when a coherent descriptor is present + motion allowed):
 *   The `fix` word is the REAL word that the line ends on. We compute the line's
 *   stem (everything up to where `fix` begins) and play:
 *     stem + `typed`           (the wrong partial appears)
 *     → backspace `backspace` chars from the end
 *     → type `fix` char-by-char
 *   landing on `stem + fix` === `line` (verified; otherwise we bail to the line).
 */

import { useEffect, useRef, useState } from 'react';
import Bubble from '@/components/Bubble';
import type { SseCorrect } from '@/lib/api';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Build the keystroke frames for the type→backspace→fix correction, or null. */
function buildFrames(line: string, c: SseCorrect): string[] | null {
  const fix = c.fix ?? '';
  const typed = c.typed ?? '';
  if (!fix || !typed) return null;
  // The correct line must actually end on `fix` (the real word) for the stem to
  // be unambiguous; otherwise we cannot guarantee landing on the correct text.
  if (!line.endsWith(fix)) return null;
  const stem = line.slice(0, line.length - fix.length);
  const frames: string[] = [];
  // 1) type the wrong partial onto the stem (appears, char by char from a base).
  const wrong = stem + typed;
  for (let i = stem.length + 1; i <= wrong.length; i++) frames.push(wrong.slice(0, i));
  // 2) backspace `backspace` chars (clamped so we never erase below the stem).
  const back = Math.min(Math.max(0, c.backspace ?? 0), typed.length);
  for (let i = 1; i <= back; i++) frames.push(wrong.slice(0, wrong.length - i));
  // 3) type the real `fix` from wherever the backspace left us, landing on `line`.
  const base = wrong.slice(0, wrong.length - back);
  for (let i = 1; i <= line.length - base.length; i++) frames.push(base + line.slice(base.length, base.length + i));
  // Must end exactly on the correct line — otherwise bail (never risk a typo).
  if (frames.length === 0 || frames[frames.length - 1] !== line) return null;
  return frames;
}

export default function SelfCorrectBubble({
  line,
  correct,
  tail = false,
}: {
  line: string;
  correct?: SseCorrect;
  tail?: boolean;
}) {
  // Resting text is ALWAYS the correct line; the animation only ever overrides
  // it transiently and must end back on `line`.
  const [text, setText] = useState(line);
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current || !correct) return;
    if (prefersReducedMotion()) return; // accessibility: no animation, line stays put
    const frames = buildFrames(line, correct);
    if (!frames) return; // incoherent descriptor → leave the correct line as-is
    playedRef.current = true;

    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    // Slightly slower on backspace for a natural "oops" beat; quick on retype.
    const step = () => {
      setText(frames[i]);
      i++;
      if (i < frames.length) {
        const prevLen = i > 0 ? frames[i - 1].length : 0;
        const curLen = frames[i]?.length ?? prevLen;
        const deleting = curLen < prevLen;
        timer = setTimeout(step, deleting ? 70 : 42 + Math.random() * 28);
      } else {
        // Guarantee the final committed text is exactly the correct line.
        setText(line);
      }
    };
    timer = setTimeout(step, 60);
    return () => clearTimeout(timer);
    // Intentionally keyed only on mount-relevant inputs; the line for a given
    // streamed bubble index is stable once revealed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Bubble from="persona" tail={tail}>
      {text}
    </Bubble>
  );
}
