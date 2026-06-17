'use client';

import { useT } from '@/i18n';

/**
 * Row of glass chips above the composer.
 * Insert chips put text into the composer; the selfie chip triggers the photo stub.
 */
export default function QuickActions({
  onInsert,
  onSelfie,
  disabled,
}: {
  onInsert: (text: string) => void;
  onSelfie: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const inserts: { label: string; text: string }[] = [
    { label: t('quick.askLabel'), text: t('quick.askText') },
    { label: t('quick.rememberLabel'), text: t('quick.rememberText') },
  ];
  const chip: React.CSSProperties = {
    borderRadius: 999,
    padding: '0 14px',
    height: 44,
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 13,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    opacity: disabled ? 0.5 : 1,
  };
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        padding: '0 0 8px',
        scrollbarWidth: 'none',
      }}
    >
      {inserts.map((q) => (
        <button
          key={q.label}
          type="button"
          className="glass"
          style={chip}
          disabled={disabled}
          onClick={() => onInsert(q.text)}
        >
          {q.label}
        </button>
      ))}
      <button type="button" className="glass" style={chip} disabled={disabled} onClick={onSelfie}>
        {t('quick.sendPhoto')}
      </button>
    </div>
  );
}
