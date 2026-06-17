'use client';

import { useRef, useState } from 'react';
import Bubble, { type BubbleStatus } from '@/components/Bubble';
import { useT } from '@/i18n';

/**
 * Voice message bubble: a tiny play/pause control plus the transcript text.
 * Used for user voice messages (transcript from STT). `audioSrc` may be null
 * while a just-recorded clip is still uploading — then only the transcript
 * (or "voice message") shows, with the play control hidden.
 *
 * Grouping props (`tail`/`time`/`status`/`onRetry`/`retryLabel`) are forwarded
 * to the underlying Bubble so voice notes group + carry status like text.
 */
export default function VoiceBubble({
  from,
  transcript,
  audioSrc,
  tail,
  time,
  status,
  onRetry,
  retryLabel,
}: {
  from: 'persona' | 'user';
  transcript?: string | null;
  audioSrc?: string | null;
  tail?: boolean;
  time?: string;
  status?: BubbleStatus;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const text = transcript?.trim();
  const tint = from === 'user' ? 'rgba(255,255,255,0.85)' : 'var(--text-dim)';

  return (
    <Bubble from={from} tail={tail} time={time} status={status} onRetry={onRetry} retryLabel={retryLabel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {audioSrc ? (
          <>
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? t('chat.pauseVoice') : t('chat.playVoice')}
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: from === 'user' ? 'rgba(255,255,255,0.22)' : 'var(--glass-strong)',
                color: from === 'user' ? '#fff' : 'var(--text)',
              }}
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio ref={audioRef} src={audioSrc} onEnded={() => setPlaying(false)} preload="none" />
          </>
        ) : (
          <span aria-hidden style={{ fontSize: 16, color: tint }}>
            🎤
          </span>
        )}
        <span style={{ fontSize: 15, minWidth: 0 }}>
          {text || <span style={{ color: tint, fontStyle: 'italic' }}>{t('chat.voiceFallback')}</span>}
        </span>
      </div>
    </Bubble>
  );
}
