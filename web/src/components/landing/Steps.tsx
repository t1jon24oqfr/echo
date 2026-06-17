'use client';

import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';

/** "How it works" — 3 glass steps. */
export default function Steps() {
  const t = useT();
  const steps: { n: number; title: string; text: string }[] = [
    { n: 1, title: t('landing.step1Title'), text: t('landing.step1Text') },
    { n: 2, title: t('landing.step2Title'), text: t('landing.step2Text') },
    { n: 3, title: t('landing.step3Title'), text: t('landing.step3Text') },
  ];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
        {t('landing.howItWorks')}
      </h2>
      {steps.map((s) => (
        <GlassCard key={s.n}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div
              className="glass-strong"
              aria-hidden
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 15,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {s.n}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
              <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{s.text}</p>
            </div>
          </div>
        </GlassCard>
      ))}
    </section>
  );
}
