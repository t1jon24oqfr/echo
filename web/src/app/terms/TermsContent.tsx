'use client';

import Link from 'next/link';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';

export default function TermsContent() {
  const t = useT();
  const listStyle: React.CSSProperties = {
    paddingLeft: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    fontSize: 14,
    color: 'var(--text-dim)',
  };
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg />
      <GlassBar title={t('terms.title')} back="/" />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '6px 16px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        <GlassCard strong>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{t('terms.whatTitle')}</h2>
          <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('terms.whatBody')}</p>
        </GlassCard>

        <GlassCard>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{t('terms.shortTitle')}</h2>
          <ul style={listStyle}>
            <li>{t('terms.t1')}</li>
            <li>{t('terms.t2')}</li>
            <li>{t('terms.t3')}</li>
            <li>{t('terms.t4')}</li>
            <li>{t('terms.t5')}</li>
          </ul>
        </GlassCard>

        <GlassCard>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
            {t('terms.privacyTitle')}
          </h2>
          <ul style={listStyle}>
            <li>{t('terms.p1')}</li>
            <li>{t('terms.p2')}</li>
            <li>{t('terms.p3')}</li>
            <li>
              {t('terms.p4a')}{' '}
              <Link href="/takedown" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
                {t('terms.p4link')}
              </Link>
              .
            </li>
          </ul>
        </GlassCard>

        <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
          {t('terms.mvpNote')}
        </p>
      </div>
    </main>
  );
}
