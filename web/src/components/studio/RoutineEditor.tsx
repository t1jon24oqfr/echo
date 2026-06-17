'use client';

import { useT } from '@/i18n';
import type { RoutineBlock } from '@/lib/api';

/**
 * A simple routine-skeleton editor: a stack of rows (label, approx start time,
 * duration in hours, busy toggle, weekday/weekend scope) with add/remove. These
 * blocks seed the persona's day (Phase 2 agenda); Phase 1 just stores them.
 * Mobile-first; no time-picker dependency — start is an "HH:MM" text field and
 * duration is a small numeric stepper in hours.
 */
function emptyBlock(): RoutineBlock {
  return { label: '', approxStart: '09:00', approxDur: 60, busy: true, valence: 0, arousal: 0 };
}

function dowValue(b: RoutineBlock): 'all' | 'weekday' | 'weekend' {
  if (b.dow === 'weekday') return 'weekday';
  if (b.dow === 'weekend') return 'weekend';
  return 'all';
}

export default function RoutineEditor({
  blocks,
  onChange,
}: {
  blocks: RoutineBlock[];
  onChange: (next: RoutineBlock[]) => void;
}) {
  const t = useT();

  const update = (i: number, patch: Partial<RoutineBlock>) =>
    onChange(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(blocks.filter((_, idx) => idx !== i));
  const add = () => onChange([...blocks, emptyBlock()]);

  const fieldStyle: React.CSSProperties = {
    height: 40,
    padding: '0 12px',
    fontSize: 14,
    color: 'var(--text)',
    outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map((b, i) => {
        const scope = dowValue(b);
        return (
          <div
            key={i}
            className="glass"
            style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={b.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder={t('studio.routineLabelPlaceholder')}
                className="glass"
                style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={t('studio.removeRow')}
                className="glass"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius)',
                  fontSize: 18,
                  color: 'var(--text-dim)',
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {t('studio.routineStart')}
                <input
                  type="time"
                  value={b.approxStart}
                  onChange={(e) => update(i, { approxStart: e.target.value || '09:00' })}
                  className="glass"
                  style={{ ...fieldStyle, width: 110 }}
                />
              </label>
              <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {t('studio.routineHours')}
                <input
                  type="number"
                  min={0.5}
                  max={16}
                  step={0.5}
                  value={Math.round((b.approxDur / 60) * 10) / 10}
                  onChange={(e) =>
                    update(i, { approxDur: Math.max(30, Math.round(Number(e.target.value) * 60)) })
                  }
                  className="glass"
                  style={{ ...fieldStyle, width: 72 }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={scope}
                onChange={(e) =>
                  update(i, {
                    dow: e.target.value === 'all' ? undefined : (e.target.value as 'weekday' | 'weekend'),
                  })
                }
                aria-label={t('studio.routineScope')}
                className="glass"
                style={{ ...fieldStyle, paddingRight: 8 }}
              >
                <option value="all">{t('studio.routineEveryDay')}</option>
                <option value="weekday">{t('studio.routineWeekdays')}</option>
                <option value="weekend">{t('studio.routineWeekends')}</option>
              </select>
              <button
                type="button"
                onClick={() => update(i, { busy: !b.busy })}
                aria-pressed={b.busy}
                className={b.busy ? undefined : 'glass'}
                style={{
                  height: 40,
                  padding: '0 14px',
                  borderRadius: 'var(--radius)',
                  fontSize: 14,
                  fontWeight: 500,
                  ...(b.busy
                    ? { background: 'var(--accent)', color: '#fff' }
                    : { color: 'var(--text)' }),
                }}
              >
                {b.busy ? t('studio.routineBusy') : t('studio.routineFree')}
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="glass"
        style={{ height: 44, borderRadius: 'var(--radius)', fontSize: 15, fontWeight: 600 }}
      >
        {t('studio.routineAdd')}
      </button>
    </div>
  );
}
