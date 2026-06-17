'use client';

/** Selectable glass chip (relationship picker, author picker, etc.). */
export default function Chip({
  label,
  selected,
  onClick,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={selected ? undefined : 'glass'}
      style={{
        minHeight: 44,
        padding: '10px 16px',
        borderRadius: 999,
        fontSize: 15,
        fontWeight: 500,
        ...(selected
          ? {
              background: 'var(--accent)',
              color: '#fff',
              border: '1px solid var(--accent)',
            }
          : { color: 'var(--text)' }),
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}
