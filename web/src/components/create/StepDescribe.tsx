'use client';

import { useState } from 'react';
import GlassCard from '@/components/GlassCard';
import { updatePersona } from '@/lib/api';
import { useT } from '@/i18n';

export default function StepDescribe({
  personaId,
  name,
  onNext,
}: {
  personaId: string;
  name: string;
  onNext: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function save(skip: boolean) {
    if (busy) return;
    if (skip || !text.trim()) {
      onNext();
      return;
    }
    setBusy(true);
    setError(false);
    try {
      await updatePersona(personaId, { description: text.trim() });
      onNext();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '12px 0 4px' }}>{t('describe.title')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 18 }}>
        {t('describe.subtitle', { name: name || t('describe.fallbackName') })}
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('describe.placeholder')}
        className="glass"
        rows={7}
        style={{
          width: '100%',
          padding: 16,
          fontSize: 15,
          lineHeight: 1.5,
          color: 'var(--text)',
          outline: 'none',
          resize: 'vertical',
        }}
      />

      {error && (
        <GlassCard style={{ marginTop: 14 }}>
          <span style={{ fontSize: 14 }}>{t('describe.saveError')}</span>
        </GlassCard>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          className="btn-solid"
          style={{ width: '100%', opacity: text.trim() ? 1 : 0.4 }}
          disabled={!text.trim() || busy}
          onClick={() => save(false)}
        >
          {busy ? t('common.saving') : t('common.next')}
        </button>
        <button className="btn-glass" style={{ width: '100%' }} disabled={busy} onClick={() => save(true)}>
          {t('common.skip')}
        </button>
      </div>
    </>
  );
}
