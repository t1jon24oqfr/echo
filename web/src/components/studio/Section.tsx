'use client';

import type { ReactNode } from 'react';
import GlassCard from '@/components/GlassCard';

/**
 * One Character Studio section: an uppercase heading + a glass card holding the
 * section's controls (stacked with a consistent gap). Mobile-first.
 */
export default function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2
        style={{
          fontSize: 13,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-dim)',
          margin: '22px 6px 10px',
        }}
      >
        {title}
      </h2>
      {subtitle ? (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '-4px 6px 10px' }}>{subtitle}</p>
      ) : null}
      <GlassCard style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '16px 16px' }}>
        {children}
      </GlassCard>
    </section>
  );
}
