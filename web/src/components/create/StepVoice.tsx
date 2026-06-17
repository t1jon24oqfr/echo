'use client';

import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';

export default function StepVoice({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '12px 0 4px' }}>{t('voice.title')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 18 }}>
        {t('voice.subtitle')}
      </p>

      <GlassCard style={{ opacity: 0.6 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{t('voice.soon')}</div>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {t('voice.soonBody')}
        </div>
        <button className="btn-glass" style={{ width: '100%', marginTop: 14, opacity: 0.5 }} disabled>
          {t('voice.upload')}
        </button>
      </GlassCard>

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button className="btn-solid" style={{ width: '100%' }} onClick={onNext}>
          {t('common.skip')}
        </button>
      </div>
    </>
  );
}
