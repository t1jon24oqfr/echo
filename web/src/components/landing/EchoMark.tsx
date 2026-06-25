'use client';

/**
 * EchoMark — the brand's recurring ripple motif: a still center point that
 * keeps sending out concentric rings. A voice carrying forward (the literal,
 * non-morbid opposite of a candle/tombstone). Used beside the "ECHO" kicker and
 * reprised at the closing CTA. Purely decorative (aria-hidden); the rings pulse
 * on a gentle loop that freezes under prefers-reduced-motion (see globals.css
 * `.echo-mark-arc` + its guard).
 */
export default function EchoMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0, display: 'block' }}
    >
      <circle cx="12" cy="12" r="2.4" fill="var(--accent)" />
      <circle
        className="echo-mark-arc"
        cx="12"
        cy="12"
        r="6"
        stroke="var(--accent)"
        strokeWidth="1.6"
        style={{ opacity: 0.7 }}
      />
      <circle
        className="echo-mark-arc"
        cx="12"
        cy="12"
        r="10"
        stroke="var(--accent)"
        strokeWidth="1.4"
        style={{ opacity: 0.4, animationDelay: '1.3s' }}
      />
    </svg>
  );
}
