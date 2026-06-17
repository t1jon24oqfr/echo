'use client';

import { useState } from 'react';
import type { Mode } from '@/components/create/StepWho';
import { useT } from '@/i18n';

export default function StepConsent({ mode, onNext }: { mode: Mode; onNext: () => void }) {
  const t = useT();
  const itemKeys: string[] = [
    'consent.age',
    'consent.ai',
    ...(mode === 'memorial'
      ? ['consent.memorial1', 'consent.memorial2']
      : ['consent.reconnect1', 'consent.reconnect2']),
  ];
  const items = itemKeys.map((k) => t(k));
  const [checked, setChecked] = useState<boolean[]>(items.map(() => false));
  const all = checked.every(Boolean);

  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '12px 0 4px' }}>{t('consent.title')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 18 }}>
        {t('consent.subtitle')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((label, i) => (
          <label
            key={itemKeys[i]}
            className="glass"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '14px 16px',
              fontSize: 14,
              lineHeight: 1.45,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={() =>
                setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))
              }
              style={{ width: 20, height: 20, marginTop: 1, accentColor: 'var(--accent)', flexShrink: 0 }}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button
          className="btn-solid"
          style={{ width: '100%', opacity: all ? 1 : 0.4 }}
          disabled={!all}
          onClick={onNext}
        >
          {t('consent.create')}
        </button>
      </div>
    </>
  );
}
