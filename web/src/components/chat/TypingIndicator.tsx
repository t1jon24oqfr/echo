'use client';

import { useT } from '@/i18n';

// NEW i18n strings, flagged for the verify phase (hardcoded English for now):
//   chat.takingPhoto   = 'taking a photo…'
//   chat.recordingAudio = 'recording audio…'
const TAKING_PHOTO = 'taking a photo…';
const RECORDING_AUDIO = 'recording audio…';

/**
 * Persona activity indicator (always left-aligned, glass).
 *  - default → three pulsing dots ("typing").
 *  - 'selfie' → a framed shimmer placeholder + "taking a photo…".
 *  - 'voice'  → a small waveform + "recording audio…".
 * The distinct variants make a pending photo / voice note legible in-thread
 * instead of a generic three-dot bubble.
 */
export default function TypingIndicator({
  variant = 'dots',
}: {
  variant?: 'dots' | 'selfie' | 'voice';
}) {
  const t = useT();

  if (variant === 'selfie') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '0 12px' }}>
        <div
          className="glass"
          style={{
            borderRadius: '16px 16px 16px 5px',
            padding: 8,
            display: 'inline-flex',
            flexDirection: 'column',
            gap: 8,
            maxWidth: '70%',
          }}
          aria-label={TAKING_PHOTO}
        >
          <div
            className="skeleton"
            style={{ width: 160, height: 200, maxWidth: '60vw', borderRadius: 12 }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-dim)', paddingLeft: 2 }}>
            {TAKING_PHOTO}
          </span>
        </div>
      </div>
    );
  }

  if (variant === 'voice') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '0 12px' }}>
        <div
          className="glass"
          style={{
            borderRadius: '16px 16px 16px 5px',
            padding: '12px 16px',
            display: 'inline-flex',
            gap: 10,
            alignItems: 'center',
          }}
          aria-label={RECORDING_AUDIO}
        >
          <style>{`
            @keyframes vl-wave {
              0%, 100% { transform: scaleY(0.4); }
              50% { transform: scaleY(1); }
            }
          `}</style>
          <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', height: 16 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                style={{
                  width: 3,
                  height: 16,
                  borderRadius: 2,
                  background: 'var(--accent)',
                  transformOrigin: 'center',
                  animation: `vl-wave 0.9s ${i * 0.12}s infinite ease-in-out`,
                }}
              />
            ))}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{RECORDING_AUDIO}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '0 12px' }}>
      <div
        className="glass"
        style={{
          borderRadius: '16px 16px 16px 5px',
          padding: '12px 16px',
          display: 'inline-flex',
          gap: 5,
          alignItems: 'center',
        }}
        aria-label={t('chat.typingAria')}
      >
        <style>{`
          @keyframes vl-dot {
            0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
            30% { opacity: 1; transform: translateY(-3px); }
          }
        `}</style>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--text)',
              animation: `vl-dot 1.2s ${i * 0.18}s infinite ease-in-out`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
