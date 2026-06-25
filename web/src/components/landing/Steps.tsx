'use client';

import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';

/**
 * "How it works" — three steps, each with a small honest illustration in place
 * of a bare number (the number stays as a tiny corner index). Returns a
 * fragment (no outer section) so the parent <Reveal> can make the heading +
 * cards its direct children and stagger them in on scroll.
 *
 * The step-2 swatches use the same clamped pastel palette as <AmbientBg/> —
 * the honest "tunes its colors and atmosphere" reading (colour, never a face).
 */

const SWATCHES = ['hsl(175,65%,80%)', 'hsl(32,65%,80%)', 'hsl(330,65%,80%)'];

function StepArt({ n }: { n: number }) {
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div
        className="glass-strong"
        aria-hidden
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {n === 1 ? <UploadArt /> : n === 2 ? <PhotosArt /> : <ChatArt />}
      </div>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: -6,
          left: -6,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,122,255,0.3)',
        }}
      >
        {n}
      </span>
    </div>
  );
}

function UploadArt() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect x="4" y="9" width="20" height="15" rx="3" fill="var(--accent)" opacity="0.12" />
      <rect x="7" y="13" width="11" height="2" rx="1" fill="var(--accent)" opacity="0.55" />
      <rect x="7" y="17" width="8" height="2" rx="1" fill="var(--accent)" opacity="0.35" />
      <path
        d="M14 2v8m0-8l-3 3m3-3l3 3"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhotosArt() {
  return (
    <svg width="28" height="26" viewBox="0 0 30 28" fill="none" aria-hidden>
      <rect x="3" y="8" width="12" height="12" rx="3" fill={SWATCHES[0]} transform="rotate(-8 9 14)" />
      <rect x="9" y="6" width="12" height="12" rx="3" fill={SWATCHES[1]} />
      <rect x="15" y="8" width="12" height="12" rx="3" fill={SWATCHES[2]} transform="rotate(8 21 14)" />
    </svg>
  );
}

function ChatArt() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden>
      <path
        d="M5 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-5 4v-4H8a3 3 0 0 1-3-3z"
        fill="var(--accent)"
        opacity="0.12"
      />
      <circle cx="11" cy="11" r="1.5" fill="var(--accent)" />
      <circle cx="14" cy="11" r="1.5" fill="var(--accent)" opacity="0.7" />
      <circle cx="17" cy="11" r="1.5" fill="var(--accent)" opacity="0.45" />
    </svg>
  );
}

export default function Steps() {
  const t = useT();
  const steps = [
    { n: 1, title: t('landing.step1Title'), text: t('landing.step1Text') },
    { n: 2, title: t('landing.step2Title'), text: t('landing.step2Text') },
    { n: 3, title: t('landing.step3Title'), text: t('landing.step3Text') },
  ];
  return (
    <>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
        {t('landing.howItWorks')}
      </h2>
      {steps.map((s) => (
        <GlassCard key={s.n}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <StepArt n={s.n} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}>{s.text}</p>
            </div>
          </div>
        </GlassCard>
      ))}
    </>
  );
}
