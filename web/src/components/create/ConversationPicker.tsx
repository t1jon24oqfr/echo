'use client';

/**
 * Reusable conversation picker for multi-thread exports (Facebook Messenger, VK).
 * Renders selectable Telegram-style glass rows (label + sublabel + message count)
 * with a search box. Sits BEFORE the existing two-phase author flow: once the
 * user picks a conversation, the parent reads/merges that thread and ingests it.
 */

import { useMemo, useState } from 'react';
import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';

export interface Conversation {
  id: string;
  label: string;
  sublabel?: string;
  count: number;
}

export default function ConversationPicker({
  conversations,
  busy,
  onPick,
}: {
  conversations: Conversation[];
  busy?: boolean;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.count - a.count);
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.sublabel ?? '').toLowerCase().includes(q),
    );
  }, [conversations, query]);

  return (
    <GlassCard strong style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
        {t('picker.title')}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
        {t('picker.subtitle', { n: conversations.length })}
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('picker.search')}
        aria-label={t('picker.search')}
        className="glass"
        style={{
          width: '100%',
          height: 40,
          padding: '0 14px',
          marginBottom: 10,
          fontSize: 14,
          color: 'var(--text)',
          border: '1px solid var(--glass-border)',
          borderRadius: 12,
          outline: 'none',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        {filtered.length === 0 && (
          <div style={{ fontSize: 14, color: 'var(--text-dim)', padding: '8px 2px' }}>
            {t('picker.empty')}
          </div>
        )}
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            className="glass"
            disabled={busy}
            onClick={() => onPick(c.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              width: '100%',
              minHeight: 56,
              padding: '10px 14px',
              borderRadius: 14,
              textAlign: 'left',
              color: 'var(--text)',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <span style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 15,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </span>
              {c.sublabel && (
                <span
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    color: 'var(--text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.sublabel}
                </span>
              )}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-dim)',
                whiteSpace: 'nowrap',
              }}
            >
              {t('picker.count', { n: c.count })}
            </span>
          </button>
        ))}
      </div>
    </GlassCard>
  );
}
