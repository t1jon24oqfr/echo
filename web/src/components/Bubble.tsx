/**
 * Chat bubble. persona = glass, left-aligned; user = solid white, right-aligned.
 *
 * Grouping support:
 *  - `tail` (default true) — the LAST bubble of a same-sender run keeps the
 *    little tail notch (asymmetric corner); inner bubbles pass tail={false}
 *    for a fully-rounded shape and a tighter 2px gap (set by the caller).
 *  - `time` — optional HH:MM stamp shown bottom-right, only on the last bubble
 *    of a run (caller decides). 11px, dimmed.
 *  - `status` — optional trailing status glyph for OUTGOING bubbles
 *    ('sending' clock → 'sent' single check → 'seen' double check, 'failed' red
 *    retry). `onRetry` makes the failed glyph tappable to re-enqueue that turn.
 */

export type BubbleStatus = 'sending' | 'sent' | 'seen' | 'failed';

export default function Bubble({
  from,
  children,
  tail = true,
  time,
  status,
  onRetry,
  retryLabel,
}: {
  from: 'persona' | 'user';
  children: React.ReactNode;
  tail?: boolean;
  time?: string;
  status?: BubbleStatus;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const persona = from === 'persona';
  // Tail = asymmetric corner on the sender's side; no tail = full radius.
  const radius = persona
    ? tail
      ? '18px 18px 18px 6px'
      : '18px'
    : tail
      ? '18px 18px 6px 18px'
      : '18px';

  const meta = time || status;

  return (
    <div
      className="bubble-in"
      style={{
        display: 'flex',
        justifyContent: persona ? 'flex-start' : 'flex-end',
        padding: '0 12px',
      }}
    >
      <div
        style={{
          maxWidth: '82%',
          padding: '10px 14px',
          fontSize: 15,
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          ...(persona
            ? {
                background: 'var(--card)',
                color: 'var(--text)',
                borderRadius: radius,
                boxShadow: 'var(--card-shadow)',
              }
            : {
                background: 'var(--accent)',
                color: '#ffffff',
                borderRadius: radius,
                boxShadow: '0 4px 14px rgba(0, 122, 255, 0.25)',
              }),
        }}
      >
        {children}
        {meta ? (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 4,
              marginTop: 3,
              fontSize: 11,
              lineHeight: 1,
              color: persona ? 'var(--text-dim)' : 'rgba(255,255,255,0.75)',
            }}
          >
            {time ? <span>{time}</span> : null}
            {status === 'sending' ? (
              <ClockGlyph color="rgba(255,255,255,0.7)" />
            ) : status === 'sent' ? (
              <CheckGlyph color="rgba(255,255,255,0.85)" />
            ) : status === 'seen' ? (
              <DoubleCheckGlyph color="rgba(255,255,255,0.95)" />
            ) : status === 'failed' ? (
              <button
                type="button"
                onClick={onRetry}
                aria-label={retryLabel}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: 0,
                  color: '#ff453a',
                }}
              >
                <RetryGlyph />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ClockGlyph({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckGlyph({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12.5L9 17.5L20 6.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DoubleCheckGlyph({ color }: { color: string }) {
  // Two overlapping checks (✓✓) — the Telegram "seen" indicator.
  return (
    <svg width="16" height="13" viewBox="0 0 28 24" fill="none" aria-hidden>
      <path d="M2 12.5L7 17.5L18 6.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 14.5L13 16.5L24 5.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RetryGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
