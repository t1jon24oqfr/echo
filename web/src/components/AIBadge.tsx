'use client';

import { useT } from '@/i18n';

/** Small transparency pill (EU AI Act): marks the persona as an AI reproduction. */
export default function AIBadge({ style }: { style?: React.CSSProperties }) {
  const t = useT();
  return (
    <span
      className="glass"
      aria-label={t('badge.ai')}
      title={t('badge.ai')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 11,
        lineHeight: 1,
        padding: '4px 7px',
        borderRadius: 999,
        color: 'var(--text-dim)',
        whiteSpace: 'nowrap',
        letterSpacing: '0.04em',
        ...style,
      }}
    >
      {t('badge.short')}
    </span>
  );
}
