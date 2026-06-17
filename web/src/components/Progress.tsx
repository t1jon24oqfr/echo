'use client';

import { useT } from '@/i18n';

/** Row of thin glass segments; segments up to and including `step` are accent-filled. */
export default function Progress({ step, total }: { step: number; total: number }) {
  const t = useT();
  return (
    <div
      style={{ display: 'flex', gap: 6, padding: '0 16px' }}
      aria-label={t('create.progressAria', { step, total })}
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: i < step ? 'var(--accent)' : 'var(--glass)',
            border: i < step ? 'none' : '1px solid var(--glass-border)',
            transition: 'background 0.3s',
          }}
        />
      ))}
    </div>
  );
}
