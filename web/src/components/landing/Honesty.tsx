'use client';

import GlassCard from '@/components/GlassCard';
import AIBadge from '@/components/AIBadge';
import { useT } from '@/i18n';

/** Honesty block: what this really is and what happens to your data. */
export default function Honesty() {
  const t = useT();
  return (
    <GlassCard strong>
      <div style={{ marginBottom: 10 }}>
        <AIBadge />
      </div>
      <p style={{ fontSize: 14, marginBottom: 10 }}>{t('landing.honesty1')}</p>
      <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('landing.honesty2')}</p>
    </GlassCard>
  );
}
