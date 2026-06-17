'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n';

/**
 * Persona avatar circle. A glass circle with the name's first letter always
 * sits BEHIND the photo, so a slow / expired image never flashes an empty hole
 * and a broken one falls straight back to the glyph.
 *
 * `photo` is a full image URL (built via api.photoUrl); the token in its `?t=`
 * query can expire, so we swap to the letter-glyph on `onError`.
 * `online` renders an accent presence dot (bottom-right, white ring).
 */
export default function Avatar({
  photo,
  name,
  size = 56,
  online = false,
}: {
  photo?: string | null;
  name?: string | null;
  size?: number;
  online?: boolean;
}) {
  const t = useT();
  // Reset the error state when the source URL changes (e.g. a refreshed token).
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo]);

  const glyph = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const showImg = Boolean(photo) && !broken;
  const dotSize = Math.max(10, Math.round(size * 0.26));

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {/* Letter-glyph base — always present behind the image. */}
      <div
        className="glass"
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.4,
          fontWeight: 600,
          color: 'var(--text-dim)',
        }}
      >
        {glyph}
      </div>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo ?? undefined}
          alt={name ? t('persona.photoAlt', { name }) : t('persona.photoAltGeneric')}
          width={size}
          height={size}
          decoding="async"
          onError={() => setBroken(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            border: '1px solid var(--glass-border)',
          }}
        />
      ) : null}
      {online ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            background: 'var(--accent)',
            border: '2px solid #fff',
            boxSizing: 'border-box',
          }}
        />
      ) : null}
    </div>
  );
}
