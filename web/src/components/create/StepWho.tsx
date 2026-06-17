'use client';

import { useState } from 'react';
import GlassCard from '@/components/GlassCard';
import Chip from '@/components/create/Chip';
import { createPersona } from '@/lib/api';
import { useT } from '@/i18n';

const RELATIONSHIP_KEYS = ['who.relPartner', 'who.relFriend', 'who.relFamily', 'who.relOther'];

export type Mode = 'memorial' | 'reconnect';

export default function StepWho({
  onNext,
}: {
  onNext: (d: { id: string; name: string; relationship: string; mode: Mode }) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [mode, setMode] = useState<Mode>('memorial');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const ready = name.trim().length > 0 && relationship.length > 0;

  async function next() {
    if (!ready || saving) return;
    setSaving(true);
    setError(false);
    try {
      const persona = await createPersona({ name: name.trim(), relationship, mode });
      onNext({ id: persona.id, name: name.trim(), relationship, mode });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '12px 0 4px' }}>{t('who.title')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 18 }}>
        {t('who.subtitle')}
      </p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('who.namePlaceholder')}
        className="glass"
        style={{
          width: '100%',
          height: 52,
          padding: '0 16px',
          fontSize: 16,
          color: 'var(--text)',
          outline: 'none',
          marginBottom: 18,
        }}
      />

      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
        {t('who.relationship')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {RELATIONSHIP_KEYS.map((key) => {
          const label = t(key);
          return (
            <Chip
              key={key}
              label={label}
              selected={relationship === label}
              onClick={() => setRelationship(label)}
            />
          );
        })}
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>{t('who.mode')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ModeOption
          selected={mode === 'memorial'}
          title={t('who.memorialTitle')}
          sub={t('who.memorialSub')}
          onClick={() => setMode('memorial')}
        />
        <ModeOption
          selected={mode === 'reconnect'}
          title={t('who.reconnectTitle')}
          sub={t('who.reconnectSub')}
          onClick={() => setMode('reconnect')}
        />
      </div>

      {error && (
        <GlassCard style={{ marginTop: 14 }}>
          <span style={{ fontSize: 14 }}>{t('common.error')}</span>
        </GlassCard>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button
          className="btn-solid"
          style={{ width: '100%', opacity: ready ? 1 : 0.4 }}
          disabled={!ready || saving}
          onClick={next}
        >
          {saving ? t('common.saving') : t('common.next')}
        </button>
      </div>
    </>
  );
}

function ModeOption({
  selected,
  title,
  sub,
  onClick,
}: {
  selected: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={selected ? 'glass-strong' : 'glass'}
      style={{
        textAlign: 'left',
        padding: '14px 16px',
        border: selected ? '1px solid var(--accent)' : undefined,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>
    </button>
  );
}
