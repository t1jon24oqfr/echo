'use client';

import { useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import {
  updateProfile,
  type CharacterPassport,
  type Knobs,
  type Ocean,
  type PassportPatch,
  type ReadReceipts,
  type RoutineBlock,
} from '@/lib/api';
import Section from './Section';
import Slider from './Slider';
import ProvenanceTag from './ProvenanceTag';
import EditableChips from './EditableChips';
import RoutineEditor from './RoutineEditor';
import Toast from './Toast';
import {
  chronotypeDescKey,
  knobDescKey,
  msfToSlider,
  oceanDescKey,
  proactivityDescKey,
  sliderToMSF,
} from './descriptions';

type Toast = { message: string; tone: 'ok' | 'error' } | null;

const OCEAN_TRAITS: (keyof Ocean)[] = ['O', 'C', 'E', 'A', 'N'];
const KNOB_KEYS: (keyof Omit<Knobs, 'readReceipts'>)[] = [
  'talkativeness',
  'warmth',
  'expressiveness',
  'initiative',
  'moodReactivity',
  'moodStability',
  'typoTendency',
];
const READ_RECEIPTS: ReadReceipts[] = ['off', 'close-only', 'always'];

/**
 * The Character Studio: edits a persona's Character Passport in place. Holds a
 * draft, diffs it against the loaded passport to build a minimal PATCH, and
 * saves optimistically with a toast. Closeness is NEVER shown as a number.
 */
export default function Studio({
  personaId,
  initial,
  onSaved,
}: {
  personaId: string;
  initial: CharacterPassport;
  onSaved?: (next: CharacterPassport) => void;
}) {
  const t = useT();
  // The last server-confirmed passport (provenance source of truth).
  const [saved, setSaved] = useState<CharacterPassport>(initial);
  // The working draft the user edits.
  const [draft, setDraft] = useState<CharacterPassport>(initial);
  const [savingState, setSavingState] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(stripDerived(draft)) !== JSON.stringify(stripDerived(saved)),
    [draft, saved],
  );

  const set = (patch: Partial<CharacterPassport>) => setDraft((d) => ({ ...d, ...patch }));
  const setOcean = (k: keyof Ocean, v: number) =>
    setDraft((d) => ({ ...d, ocean: { ...d.ocean, [k]: v } }));
  const setKnob = (k: keyof Knobs, v: Knobs[keyof Knobs]) =>
    setDraft((d) => ({ ...d, knobs: { ...d.knobs, [k]: v } }));
  const setRelationship = (patch: Partial<CharacterPassport['relationship']>) =>
    setDraft((d) => ({ ...d, relationship: { ...d.relationship, ...patch } }));
  const setBoundaries = (patch: Partial<CharacterPassport['boundaries']>) =>
    setDraft((d) => ({ ...d, boundaries: { ...d.boundaries, ...patch } }));
  const setChronotype = (patch: Partial<CharacterPassport['chronotype']>) =>
    setDraft((d) => ({ ...d, chronotype: { ...d.chronotype, ...patch } }));

  const flash = (message: string, tone: 'ok' | 'error') => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const save = async () => {
    if (savingState || !dirty) return;
    setSavingState(true);
    const patch = diffPatch(saved, draft);
    // Optimistic: keep the draft on screen; only roll provenance forward on success.
    try {
      const res = await updateProfile(personaId, {
        passport: patch,
        timezone: draft.timezone !== saved.timezone ? draft.timezone : undefined,
      });
      if (res.passport) {
        setSaved(res.passport);
        setDraft(res.passport);
        onSaved?.(res.passport);
      }
      flash(t('studio.saved'), 'ok');
    } catch {
      flash(t('studio.saveError'), 'error');
    } finally {
      setSavingState(false);
    }
  };

  const prov = saved._provenance;
  const memorial = draft.mode === 'memorial';
  const chronoSlider = msfToSlider(draft.chronotype.MSF);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 48,
    padding: '0 14px',
    fontSize: 16,
    color: 'var(--text)',
    outline: 'none',
  };

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* IDENTITY */}
      <Section title={t('studio.identity')}>
        <Field label={t('studio.name')} tag={<ProvenanceTag provenance={prov} field="name" />}>
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            className="glass"
            style={inputStyle}
            placeholder={t('studio.name')}
          />
        </Field>
        <Field
          label={t('studio.relationship')}
          tag={<ProvenanceTag provenance={prov} field="relationshipToUser" />}
        >
          <input
            value={draft.relationshipToUser}
            onChange={(e) => set({ relationshipToUser: e.target.value })}
            className="glass"
            style={inputStyle}
            placeholder={t('studio.relationship')}
          />
        </Field>
        <Field
          label={t('studio.occupation')}
          tag={<ProvenanceTag provenance={prov} field="occupation" />}
        >
          <input
            value={draft.occupation}
            onChange={(e) => set({ occupation: e.target.value })}
            className="glass"
            style={inputStyle}
            placeholder={t('studio.occupationPlaceholder')}
          />
        </Field>
        <Field label={t('studio.timezone')} tag={null}>
          <input
            value={draft.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
            className="glass"
            style={inputStyle}
            placeholder="Europe/Kyiv"
          />
        </Field>
      </Section>

      {/* PERSONALITY — Big-Five */}
      <Section title={t('studio.personality')} subtitle={t('studio.personalitySub')}>
        {OCEAN_TRAITS.map((trait) => (
          <Slider
            key={trait}
            title={t(`studio.ocean${trait}.title`)}
            value={draft.ocean[trait]}
            onChange={(v) => setOcean(trait, v)}
            lowLabel={t(`studio.ocean${trait}.low`)}
            highLabel={t(`studio.ocean${trait}.high`)}
            description={t(oceanDescKey(trait, draft.ocean[trait]))}
            tag={<ProvenanceTag provenance={prov} field="ocean" />}
          />
        ))}
      </Section>

      {/* CHRONOTYPE */}
      <Section title={t('studio.chronotypeTitle')}>
        <Slider
          title={t('studio.rhythm')}
          value={chronoSlider}
          onChange={(v) => setChronotype({ MSF: sliderToMSF(v) })}
          lowLabel={t('studio.earlyBird')}
          highLabel={t('studio.nightOwl')}
          description={t(chronotypeDescKey(chronoSlider))}
          tag={<ProvenanceTag provenance={prov} field="chronotype" />}
        />
        <Stepper
          label={t('studio.sleepDuration')}
          value={draft.chronotype.sleepDurationH}
          min={6}
          max={9}
          step={0.5}
          suffix={t('studio.hoursSuffix')}
          onChange={(v) => setChronotype({ sleepDurationH: v })}
        />
      </Section>

      {/* VOICE & STYLE */}
      <Section title={t('studio.voiceStyle')}>
        <Field
          label={t('studio.speechStyle')}
          tag={<ProvenanceTag provenance={prov} field="speechStyle" />}
        >
          <EditableChips
            values={draft.speechStyle}
            onChange={(v) => set({ speechStyle: v })}
            placeholder={t('studio.speechStylePlaceholder')}
          />
        </Field>
        <Field
          label={t('studio.emojiSet')}
          tag={<ProvenanceTag provenance={prov} field="topEmoji" />}
        >
          <EditableChips
            values={draft.topEmoji}
            onChange={(v) => set({ topEmoji: v })}
            placeholder={t('studio.emojiPlaceholder')}
            emoji
          />
        </Field>
        <Field label={t('studio.languageMix')} tag={null}>
          <input
            value={draft.languageMixNotes}
            onChange={(e) => set({ languageMixNotes: e.target.value })}
            className="glass"
            style={inputStyle}
            placeholder={t('studio.languageMixPlaceholder')}
          />
        </Field>
      </Section>

      {/* WORLD & ROUTINE */}
      <Section title={t('studio.worldRoutine')} subtitle={t('studio.worldRoutineSub')}>
        <Field
          label={t('studio.routine')}
          tag={<ProvenanceTag provenance={prov} field="routineSkeleton" />}
        >
          <RoutineEditor
            blocks={draft.routineSkeleton}
            onChange={(v: RoutineBlock[]) => set({ routineSkeleton: v })}
          />
        </Field>
      </Section>

      {/* RELATIONSHIP & LIMITS */}
      <Section title={t('studio.relationshipLimits')} subtitle={t('studio.relationshipLimitsSub')}>
        <Slider
          title={t('studio.maxCloseness')}
          value={draft.relationship.pinnedMaxStage}
          min={1}
          max={5}
          step={1}
          onChange={(v) => setRelationship({ pinnedMaxStage: v })}
          lowLabel={t('studio.stage1')}
          highLabel={t('studio.stage5')}
          description={t(`studio.stageDesc.${draft.relationship.pinnedMaxStage}`)}
          tag={<ProvenanceTag provenance={prov} field="relationship" />}
        />
        <Slider
          title={t('studio.proactivity')}
          value={Math.round(draft.relationship.proactivityScale * 100)}
          min={50}
          max={200}
          step={10}
          onChange={(v) => setRelationship({ proactivityScale: v / 100 })}
          lowLabel={t('studio.proactivityLow')}
          highLabel={t('studio.proactivityHigh')}
          description={t(proactivityDescKey(draft.relationship.proactivityScale))}
        />
        <Toggle
          label={t('studio.paused')}
          description={t('studio.pausedDesc')}
          checked={draft.boundaries.paused}
          onChange={(v) => setBoundaries({ paused: v })}
        />
        <Field label={t('studio.readReceipts')} tag={null}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {READ_RECEIPTS.map((rr) => {
              const selected = draft.knobs.readReceipts === rr;
              return (
                <button
                  key={rr}
                  type="button"
                  onClick={() => setKnob('readReceipts', rr)}
                  className={selected ? undefined : 'glass'}
                  style={{
                    minHeight: 40,
                    padding: '8px 14px',
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 500,
                    ...(selected
                      ? { background: 'var(--accent)', color: '#fff' }
                      : { color: 'var(--text)' }),
                  }}
                >
                  {t(`studio.receipts.${rr === 'close-only' ? 'closeOnly' : rr}`)}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 8 }}>
            {t('studio.readReceiptsDesc')}
          </p>
        </Field>
        {memorial ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('studio.memorialNote')}</p>
        ) : null}
      </Section>

      {/* BEHAVIOR KNOBS */}
      <Section title={t('studio.behavior')} subtitle={t('studio.behaviorSub')}>
        {KNOB_KEYS.map((k) => (
          <Slider
            key={k}
            title={t(`studio.knob.${k}.title`)}
            value={draft.knobs[k]}
            onChange={(v) => setKnob(k, v)}
            lowLabel={t('studio.knobLow')}
            highLabel={t('studio.knobHigh')}
            description={t(knobDescKey(k, draft.knobs[k]))}
            tag={<ProvenanceTag provenance={prov} field="knobs" />}
          />
        ))}
      </Section>

      {/* Sticky Save bar */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 40,
          padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
          maxWidth: 430,
          margin: '0 auto',
          background: 'linear-gradient(to top, var(--bg) 55%, transparent)',
        }}
      >
        <button
          className="btn-solid"
          onClick={save}
          disabled={!dirty || savingState}
          style={{ width: '100%', opacity: dirty && !savingState ? 1 : 0.45 }}
        >
          {savingState ? t('studio.saving') : t('studio.save')}
        </button>
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}

// ---------- small inline controls ----------

function Field({
  label,
  tag,
  children,
}: {
  label: string;
  tag: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
        {tag}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
          style={{
            width: 50,
            height: 30,
            borderRadius: 999,
            padding: 3,
            flexShrink: 0,
            background: checked ? 'var(--accent)' : 'rgba(120, 120, 128, 0.24)',
            transition: 'background-color 0.18s ease',
          }}
        >
          <span
            style={{
              display: 'block',
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              transform: checked ? 'translateX(20px)' : 'translateX(0)',
              transition: 'transform 0.18s ease',
            }}
          />
        </button>
      </div>
      {description ? (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>{description}</p>
      ) : null}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const btn: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 'var(--radius)',
    fontSize: 22,
    fontWeight: 600,
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="glass"
          style={btn}
          onClick={() => onChange(clamp(value - step))}
          aria-label="−"
          disabled={value <= min}
        >
          −
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, minWidth: 56, textAlign: 'center' }}>
          {value}
          {suffix ? ` ${suffix}` : ''}
        </span>
        <button
          type="button"
          className="glass"
          style={btn}
          onClick={() => onChange(clamp(value + step))}
          aria-label="+"
          disabled={value >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}

// ---------- diff helpers ----------

/** Drop server-derived/owned fields before comparing for "dirty" / building a patch. */
function stripDerived(p: CharacterPassport): Record<string, unknown> {
  const { _provenance, _version, baselinePAD, ...rest } = p;
  void _provenance;
  void _version;
  void baselinePAD;
  return rest;
}

/**
 * Build a minimal patch of only the top-level passport fields the user changed.
 * baselinePAD/_provenance/_version are server-owned and never sent. timezone is
 * carried separately by the caller (it has a dedicated PATCH body field).
 */
function diffPatch(prev: CharacterPassport, next: CharacterPassport): PassportPatch {
  const patch: Record<string, unknown> = {};
  const keys = Object.keys(stripDerived(next)) as (keyof CharacterPassport)[];
  for (const k of keys) {
    if (k === 'timezone' || k === 'mode') continue;
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) {
      patch[k] = next[k];
    }
  }
  return patch as PassportPatch;
}
