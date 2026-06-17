'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import { useT } from '@/i18n';

type Tier = 'plus' | 'infinite';
type Billing = 'annual' | 'monthly';

// Prices are format strings (brand/currency) — the "/month" suffix is localized at render.
const PRICING: Record<
  Tier,
  {
    annual: { total: string; perMonth: string; badge: string };
    monthly: { perMonth: string };
  }
> = {
  plus: {
    annual: { total: '$79.99', perMonth: '$6.67', badge: '-49%' },
    monthly: { perMonth: '$12.99' },
  },
  infinite: {
    annual: { total: '$159.99', perMonth: '$13.33', badge: '-47%' },
    monthly: { perMonth: '$24.99' },
  },
};

/** iOS Settings-style leading icon: 29×29 colored square, white stroke glyph. */
function IconSquare({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      style={{
        width: 29,
        height: 29,
        borderRadius: 7,
        background: color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 16 16"
        fill="none"
        stroke="#fff"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

const ChatGlyph = (
  <path d="M2 3.5h12v8H8.5L5 14.2v-2.7H2v-8z" />
);
const CameraGlyph = (
  <>
    <path d="M2 4.5h2.5l1.2-1.7h4.6l1.2 1.7H14v8H2v-8z" />
    <circle cx="8" cy="8.3" r="2.4" />
  </>
);
const BellGlyph = (
  <>
    <path d="M8 2a4 4 0 0 1 4 4c0 3 1.2 4.2 1.6 4.6H2.4C2.8 10.2 4 9 4 6a4 4 0 0 1 4-4z" />
    <path d="M6.6 13.2a1.5 1.5 0 0 0 2.8 0" />
  </>
);
const MicGlyph = (
  <>
    <rect x="6" y="1.8" width="4" height="7.4" rx="2" />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
    <path d="M8 12v2.2" />
  </>
);
const PeopleGlyph = (
  <>
    <circle cx="5.8" cy="5.5" r="2.4" />
    <path d="M1.8 13.5c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8" />
    <circle cx="11.2" cy="5.8" r="1.9" />
    <path d="M11.4 9.8c1.7.2 2.9 1.6 2.9 3.4" />
  </>
);
const StarGlyph = (
  <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z" />
);
const PhoneGlyph = (
  <path d="M3 2.5l2.7-.7 1.4 3.2-1.6 1.4a8.6 8.6 0 0 0 4.1 4.1l1.4-1.6 3.2 1.4-.7 2.7c-5.7.4-10.9-4.8-10.5-10.5z" />
);
const BrainGlyph = (
  <>
    <path d="M8 2.2c-2.6 0-4.6 1.8-4.6 4.2 0 1.3.5 2.3 1.3 3.1v2.3l1.8-.7c.5.1 1 .2 1.5.2 2.6 0 4.6-1.8 4.6-4.2S10.6 2.2 8 2.2z" />
    <path d="M6.2 6.5l.5 1 1-.5-1-.5-.5-1-.5 1-1 .5 1 .5.5-1zM10.3 5.2l.3.7.7.3-.7.3-.3.7-.3-.7-.7-.3.7-.3.3-.7z" fill="#fff" stroke="none" />
  </>
);

const FEATURES: Record<
  Tier,
  { color: string; glyph: React.ReactNode; titleKey: string; descKey?: string }[]
> = {
  plus: [
    { color: '#007AFF', glyph: ChatGlyph, titleKey: 'paywall.fUnlimitedMsgs', descKey: 'paywall.fUnlimitedMsgsD' },
    { color: '#FF9500', glyph: CameraGlyph, titleKey: 'paywall.fPhotoReplies', descKey: 'paywall.fPhotoRepliesD' },
    { color: '#34C759', glyph: BellGlyph, titleKey: 'paywall.fProactive', descKey: 'paywall.fProactiveD' },
    { color: '#FF3B30', glyph: MicGlyph, titleKey: 'paywall.fVoice', descKey: 'paywall.fVoiceD' },
    { color: '#30B0C7', glyph: PeopleGlyph, titleKey: 'paywall.fPersonas3' },
  ],
  infinite: [
    { color: '#007AFF', glyph: StarGlyph, titleKey: 'paywall.fEverything' },
    { color: '#FF9500', glyph: CameraGlyph, titleKey: 'paywall.fUnlimitedPhotos' },
    { color: '#FF3B30', glyph: MicGlyph, titleKey: 'paywall.fUnlimitedVoice' },
    { color: '#34C759', glyph: PhoneGlyph, titleKey: 'paywall.fCalls' },
    { color: '#30B0C7', glyph: PeopleGlyph, titleKey: 'paywall.fUnlimitedPersonas' },
    { color: '#5856D6', glyph: BrainGlyph, titleKey: 'paywall.fDeep', descKey: 'paywall.fDeepD' },
  ],
};

function CheckCircle({ selected }: { selected: boolean }) {
  return selected ? (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="11" fill="var(--accent)" />
      <path
        d="M6.2 11.4l3.2 3.2 6.2-7"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="10.25" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1.5" />
    </svg>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-dim)',
  margin: '22px 6px 10px',
};

export default function PaywallPage() {
  const t = useT();
  const router = useRouter();
  const [tier, setTier] = useState<Tier>('plus');
  const [billing, setBilling] = useState<Billing>('annual');

  const p = PRICING[tier];
  const ctaLabel =
    billing === 'annual'
      ? t('paywall.subscribeYear', { price: p.annual.total })
      : t('paywall.subscribeMonth', { price: p.monthly.perMonth });

  const billingRow = (
    key: Billing,
    title: string,
    sub: string | null,
    right: string,
    badge?: string,
    last?: boolean,
  ) => {
    const selected = billing === key;
    return (
      <button
        key={key}
        onClick={() => setBilling(key)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          minHeight: 56,
          padding: '10px 0',
          background: 'none',
          border: 'none',
          borderBottom: last ? 'none' : '1px solid rgba(0,0,0,0.06)',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          color: 'var(--text)',
        }}
      >
        <CheckCircle selected={selected} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
            {badge ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#fff',
                  background: 'linear-gradient(90deg, #0A84FF, #5AC8FA)',
                  borderRadius: 999,
                  padding: '2px 7px',
                }}
              >
                {badge}
              </span>
            ) : null}
          </span>
          {sub ? (
            <span style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>
              {sub}
            </span>
          ) : null}
        </span>
        <span style={{ fontSize: 15, color: 'var(--text-dim)', flexShrink: 0 }}>{right}</span>
      </button>
    );
  };

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg />
      <GlassBar back="/home" title="Echo Premium" />

      <div style={{ flex: 1, padding: '6px 16px 0' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', padding: '18px 0 6px' }}>
          <div style={{ position: 'relative', width: 150, height: 130, margin: '0 auto' }}>
            <svg
              width={96}
              height={96}
              viewBox="0 0 96 96"
              aria-hidden
              style={{ position: 'absolute', top: 14, left: 27 }}
            >
              <defs>
                <linearGradient id="premiumStar" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#0A84FF" />
                  <stop offset="100%" stopColor="#5AC8FA" />
                </linearGradient>
              </defs>
              <path
                d="M48 4c3.5 18.5 8 28.5 16.5 35.5C72 45.5 81 49 92 48c-18.5 3.5-28.5 8-35.5 16.5C50.5 72 47 81 48 92c-3.5-18.5-8-28.5-16.5-35.5C25 50.5 16 47 4 48c18.5-3.5 28.5-8 35.5-16.5C45.5 25 47 16 48 4z"
                fill="url(#premiumStar)"
              />
            </svg>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: '6px 0 6px' }}>
            {t('paywall.heroTitle')}
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-dim)', lineHeight: 1.4, margin: '0 12px' }}>
            {t('paywall.heroSub')}
          </p>
        </div>

        {/* Tier segmented control */}
        <div
          className="glass-strong"
          role="tablist"
          aria-label={t('paywall.tierAria')}
          style={{
            display: 'flex',
            borderRadius: 999,
            padding: 3,
            margin: '16px auto 0',
            maxWidth: 300,
          }}
        >
          {(['plus', 'infinite'] as Tier[]).map((t) => {
            const active = tier === t;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setTier(t)}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 15,
                  fontWeight: 600,
                  color: active ? '#fff' : 'var(--text)',
                  background: active ? 'linear-gradient(90deg, #0A84FF, #5AC8FA)' : 'transparent',
                  transition: 'background 0.15s ease, color 0.15s ease',
                }}
              >
                {t === 'plus' ? 'Plus' : 'Infinite'}
              </button>
            );
          })}
        </div>

        {/* Billing card */}
        <div className="card" style={{ padding: '2px 16px', marginTop: 16 }}>
          {billingRow(
            'annual',
            t('paywall.annual'),
            t('paywall.annualSub', { total: p.annual.total }),
            `${p.annual.perMonth}${t('paywall.perMonthSuffix')}`,
            p.annual.badge,
          )}
          {billingRow(
            'monthly',
            t('paywall.monthly'),
            null,
            `${p.monthly.perMonth}${t('paywall.perMonthSuffix')}`,
            undefined,
            true,
          )}
        </div>

        {/* Features */}
        <h2 style={sectionTitle}>{t('paywall.included')}</h2>
        <div className="card" style={{ padding: '4px 16px' }}>
          {FEATURES[tier].map((f, i) => (
            <div
              key={f.titleKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minHeight: 52,
                padding: '8px 0',
                borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <IconSquare color={f.color}>{f.glyph}</IconSquare>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>
                  {t(f.titleKey)}
                </span>
                {f.descKey ? (
                  <span
                    style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginTop: 1 }}
                  >
                    {t(f.descKey)}
                  </span>
                ) : null}
              </span>
              <span aria-hidden style={{ color: 'var(--text-dim)', fontSize: 17 }}>
                ›
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky CTA */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 10,
          padding: '12px 16px calc(14px + env(safe-area-inset-bottom))',
          marginTop: 18,
          background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 35%)',
        }}
      >
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => router.push('/home')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              height: 52,
              borderRadius: 26,
              border: 'none',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 17,
              fontWeight: 600,
              color: '#fff',
              background: 'linear-gradient(90deg, #0A84FF, #5AC8FA)',
              boxShadow: '0 6px 20px rgba(111, 123, 255, 0.35)',
            }}
          >
            {ctaLabel}
          </button>
          {/* Honest, hard-to-miss demo chip pinned to the CTA while payments are stubbed. */}
          <span
            style={{
              position: 'absolute',
              top: -10,
              right: 12,
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.02em',
              color: '#fff',
              background: '#34C759',
              borderRadius: 999,
              padding: '3px 9px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
              whiteSpace: 'nowrap',
            }}
          >
            {/* TODO i18n: paywall.demoChip */}
            Demo — no charge
          </span>
        </div>
        <p
          style={{
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text-dim)',
            marginTop: 10,
          }}
        >
          {t('paywall.demoNote')}
        </p>
      </div>
    </main>
  );
}
