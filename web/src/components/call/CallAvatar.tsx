'use client';

import { useEffect, useState } from 'react';

/**
 * Large centered call avatar. A glass circle with the name's first letter sits
 * behind the photo (same graceful fallback as the small persona Avatar), and a
 * concentric ring animates while she is "speaking" so the user can feel the turn.
 *
 * `speaking` drives a soft pulsing aura; `listening` shows a gentle steady ring
 * so the open mic reads as "your turn". Both animations are disabled under
 * `prefers-reduced-motion` (the static ring still indicates state).
 */
export default function CallAvatar({
  photo,
  name,
  speaking = false,
  listening = false,
  size = 168,
}: {
  photo?: string | null;
  name?: string | null;
  speaking?: boolean;
  listening?: boolean;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo]);

  const glyph = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const showImg = Boolean(photo) && !broken;
  const ringColor = speaking ? 'var(--accent)' : 'rgba(0,0,0,0.12)';

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <style>
        {`@keyframes vl-call-pulse{0%{transform:scale(1);opacity:0.55}70%{transform:scale(1.35);opacity:0}100%{transform:scale(1.35);opacity:0}}
@keyframes vl-call-breathe{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(1.12);opacity:0.15}}
@media (prefers-reduced-motion: reduce){.vl-call-aura{animation:none!important}}`}
      </style>

      {/* Pulsing aura rings — only while she speaks (or a soft breathe while listening). */}
      {speaking ? (
        <>
          <span
            aria-hidden
            className="vl-call-aura"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '2px solid var(--accent)',
              animation: 'vl-call-pulse 1.8s ease-out infinite',
            }}
          />
          <span
            aria-hidden
            className="vl-call-aura"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '2px solid var(--accent)',
              animation: 'vl-call-pulse 1.8s ease-out 0.9s infinite',
            }}
          />
        </>
      ) : listening ? (
        <span
          aria-hidden
          className="vl-call-aura"
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            border: '2px solid var(--accent)',
            animation: 'vl-call-breathe 2.6s ease-in-out infinite',
          }}
        />
      ) : null}

      {/* The avatar disc itself. */}
      <div
        className="glass-strong"
        style={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: speaking
            ? '0 0 0 3px var(--accent), 0 18px 48px rgba(0,0,0,0.18)'
            : `0 0 0 2px ${ringColor}, 0 14px 40px rgba(0,0,0,0.14)`,
          transition: 'box-shadow 0.25s ease',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size * 0.4,
            fontWeight: 600,
            color: 'var(--text-dim)',
          }}
        >
          {glyph}
        </span>
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo ?? undefined}
            alt=""
            width={size}
            height={size}
            decoding="async"
            onError={() => setBroken(true)}
            style={{
              position: 'absolute',
              inset: 0,
              width: size,
              height: size,
              objectFit: 'cover',
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
