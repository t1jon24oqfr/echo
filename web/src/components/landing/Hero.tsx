'use client';

import { useT } from '@/i18n';

/** Landing header: brand mark (untranslated) + localized tagline. */
export default function Hero() {
  const t = useT();
  return (
    <header style={{ textAlign: 'center' }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          marginBottom: 18,
        }}
      >
        ECHO
      </div>
      <h1 style={{ fontSize: 32, lineHeight: 1.2, fontWeight: 600, marginBottom: 12 }}>
        {t('landing.title')}
      </h1>
      <p style={{ fontSize: 16, color: 'var(--text-dim)' }}>{t('landing.subtitle')}</p>
    </header>
  );
}
