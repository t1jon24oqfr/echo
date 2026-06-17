'use client';

import { useState } from 'react';
import { useT } from '@/i18n';

/**
 * An editable list of short string "chips" (traits, signature phrases, pet
 * names, emoji). Each chip has an × to remove it; a text input + Add button
 * appends a new one. Mobile-first, glass-themed. Emits the full new array on
 * every change so the parent can stage it for the PATCH.
 */
export default function EditableChips({
  values,
  onChange,
  placeholder,
  emoji,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Emoji mode: chips render larger and the input is narrower. */
  emoji?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  };

  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: values.length ? 10 : 0 }}>
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="glass"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: emoji ? '6px 10px' : '7px 6px 7px 12px',
              borderRadius: 999,
              fontSize: emoji ? 18 : 14,
            }}
          >
            <span>{v}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={t('studio.removeChip')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: '50%',
                fontSize: 14,
                lineHeight: 1,
                color: 'var(--text-dim)',
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder ?? t('studio.addPlaceholder')}
          className="glass"
          style={{
            flex: 1,
            minWidth: 0,
            height: 44,
            padding: '0 14px',
            fontSize: 15,
            color: 'var(--text)',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={add}
          className="glass"
          style={{ padding: '0 16px', borderRadius: 'var(--radius)', fontSize: 15, fontWeight: 600 }}
        >
          {t('studio.add')}
        </button>
      </div>
    </div>
  );
}
