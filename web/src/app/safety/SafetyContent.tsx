'use client';

import Link from 'next/link';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';

// Hotline names/numbers are proper nouns — only the region label is localized.
const HOTLINES: { regionKey: string; name: string; number: string }[] = [
  { regionKey: 'safety.regionUkraine', name: 'Lifeline Ukraine', number: '7333' },
  { regionKey: 'safety.regionUS', name: 'Suicide & Crisis Lifeline', number: '988' },
  { regionKey: 'safety.regionUK', name: 'Samaritans', number: '116 123' },
];

export default function SafetyContent() {
  const t = useT();
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg />
      <GlassBar title={t('safety.title')} back="/" />
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
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
            {t('safety.protocolTitle')}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 8 }}>
            {t('safety.protocol1')}
          </p>
          <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('safety.protocol2')}</p>
        </GlassCard>

        <GlassCard>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{t('safety.hardTitle')}</h2>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>
            {t('safety.hardBody')}
          </p>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {HOTLINES.map((h) => (
              <li
                key={h.number}
                className="glass"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 14 }}>
                  {h.name}
                  <span style={{ color: 'var(--text-dim)' }}> · {t(h.regionKey)}</span>
                </span>
                <strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>{h.number}</strong>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{t('safety.rulesTitle')}</h2>
          <ul
            style={{
              paddingLeft: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 14,
              color: 'var(--text-dim)',
            }}
          >
            <li>{t('safety.rule1')}</li>
            <li>{t('safety.rule2')}</li>
            <li>{t('safety.rule3')}</li>
            <li>{t('safety.rule4')}</li>
          </ul>
        </GlassCard>

        <GlassCard>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
            {t('safety.rightsTitle')}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>
            {t('safety.rightsBody')}
          </p>
          <Link href="/takedown" className="btn-glass" style={{ width: '100%' }}>
            {t('safety.requestRemoval')}
          </Link>
        </GlassCard>
      </div>
    </main>
  );
}
