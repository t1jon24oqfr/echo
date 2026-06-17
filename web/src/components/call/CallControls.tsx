'use client';

import { useT } from '@/i18n';

/**
 * Bottom call controls: a big round mic (tap-to-talk), a red End button, and a
 * mute toggle. Tap targets are ≥56px for reliable mobile use. The mic's look
 * tracks the call state: idle (tap to start), recording (red, tap to send),
 * disabled while she's thinking/speaking.
 */
export type MicState = 'idle' | 'recording' | 'busy';

export default function CallControls({
  micState,
  muted,
  onMicTap,
  onToggleMute,
  onEnd,
}: {
  micState: MicState;
  muted: boolean;
  onMicTap: () => void;
  onToggleMute: () => void;
  onEnd: () => void;
}) {
  const t = useT();

  const micLabel =
    micState === 'recording'
      ? t('call.tapToSend')
      : micState === 'busy'
        ? t('call.thinking')
        : t('call.tapToTalk');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        gap: 12,
        padding: '0 24px',
      }}
    >
      {/* Mute toggle */}
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? t('call.unmute') : t('call.mute')}
        aria-pressed={muted}
        className="glass-strong"
        style={roundBtn(64, muted ? 'var(--accent)' : 'var(--text-dim)')}
      >
        {muted ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 3L21 21" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <path
              d="M9 5.5A3 3 0 0 1 15 6V11M15 14.5A3 3 0 0 1 9 13V9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M5 11A7 7 0 0 0 12 18M19 11A7 7 0 0 1 17.5 15.3M12 18V21"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M5 11C5 14.87 8.13 18 12 18C15.87 18 19 14.87 19 11M12 18V21"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      {/* Big mic — tap to talk / tap to send. */}
      <button
        type="button"
        onClick={onMicTap}
        disabled={micState === 'busy'}
        aria-label={micLabel}
        style={{
          ...roundBtn(84, '#fff'),
          background: micState === 'recording' ? '#ff3b30' : 'var(--accent)',
          border: 'none',
          opacity: micState === 'busy' ? 0.5 : 1,
          boxShadow:
            micState === 'recording'
              ? '0 0 0 6px rgba(255,59,48,0.22), 0 12px 30px rgba(0,0,0,0.2)'
              : '0 12px 30px rgba(0,0,0,0.2)',
          transition: 'background 0.18s ease, box-shadow 0.18s ease',
        }}
      >
        {micState === 'recording' ? (
          <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="6" width="12" height="12" rx="2.5" />
          </svg>
        ) : (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path
              d="M5 11C5 14.87 8.13 18 12 18C15.87 18 19 14.87 19 11M12 18V21"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      {/* End call (red). */}
      <button
        type="button"
        onClick={onEnd}
        aria-label={t('call.end')}
        style={{
          ...roundBtn(64, '#fff'),
          background: '#ff3b30',
          border: 'none',
          boxShadow: '0 10px 26px rgba(255,59,48,0.3)',
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 9c-2.5 0-4.9.4-7.1 1.2-.6.2-1 .8-1 1.4v2c0 .5.3.9.8 1l2.5.8c.5.2 1-.1 1.2-.6l.6-1.8c.1-.3.4-.5.7-.6 1.5-.3 3.1-.3 4.6 0 .3.1.6.3.7.6l.6 1.8c.2.5.7.8 1.2.6l2.5-.8c.5-.1.8-.5.8-1v-2c0-.6-.4-1.2-1-1.4C16.9 9.4 14.5 9 12 9z" transform="rotate(135 12 12)" />
        </svg>
      </button>
    </div>
  );
}

function roundBtn(diam: number, color: string): React.CSSProperties {
  return {
    width: diam,
    height: diam,
    minWidth: 56,
    minHeight: 56,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color,
    cursor: 'pointer',
  };
}
