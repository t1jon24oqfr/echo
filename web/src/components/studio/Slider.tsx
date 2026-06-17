'use client';

/**
 * A labelled range slider for the Character Studio. Mobile-first, glass-themed.
 * Shows a title (with an optional provenance tag + the two endpoint labels) and
 * a one-line live description of the current value below the track.
 *
 * The numeric value is intentionally NOT shown for relationship/closeness-style
 * controls — callers omit `lowLabel`/`highLabel` or pass a `description` only.
 */
import type { ReactNode } from 'react';

export default function Slider({
  title,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  lowLabel,
  highLabel,
  description,
  tag,
  disabled,
}: {
  title: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  lowLabel?: string;
  highLabel?: string;
  description?: ReactNode;
  tag?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div style={{ opacity: disabled ? 0.5 : 1 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        {tag ?? null}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={title}
        style={{
          width: '100%',
          accentColor: 'var(--accent)',
          cursor: disabled ? 'default' : 'pointer',
        }}
      />
      {(lowLabel || highLabel) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--text-dim)',
            marginTop: 2,
          }}
        >
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
      {description ? (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>{description}</p>
      ) : null}
    </div>
  );
}
