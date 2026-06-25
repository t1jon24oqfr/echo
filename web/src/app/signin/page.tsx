'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import {
  emailStart,
  emailVerify,
  socialLogin,
  ApiError,
  type AuthProvider,
} from '@/lib/api';
import { useT } from '@/i18n';

/**
 * V11 sign-in screen — "Quiet Light".
 *
 * Anonymous usage stays fully allowed; this is an opt-in affordance to save
 * personas across devices, reached from Settings (and a soft prompt). The flow
 * is unchanged:
 *  1. email step → POST /auth/email/start (dev returns the code → autofilled)
 *  2. code step  → POST /auth/email/verify → session stored, claims personas.
 *
 * Design language: light iOS / Telegram-native. The screen is composed in two
 * tiers — a solid white card carrying the primary email path (it gathers light
 * and visibly outranks everything below it), and, beneath a true "or" divider,
 * the social tier floating on the bare ambient wash. The one Echo-specific
 * focal moment is the brand mark: the ECHO wordmark seated on a soft white
 * mark-circle with a single faint concentric ring behind it that does ONE
 * expand-and-fade "echo" on mount and then rests — a word said once into a
 * quiet room. It never loops (a looping pulse would read as a notification /
 * AI-listening gimmick). The hero (mark + heading + lede) stays pinned across
 * both steps; only the card cross-fades, so the two steps feel like one surface
 * turning a page rather than a route jump.
 *
 * Apple + Google are rendered below; until provider creds land the backend
 * returns 501 provider_not_configured, which we surface as a calm disabled
 * "coming soon" state rather than crashing. When BOTH providers are
 * unconfigured (today's real state on web) the two greyed pills collapse into a
 * single muted "More options coming soon" line so the lower third reads
 * finished rather than broken. The current device token is passed automatically
 * by the api client so the anon user's personas are claimed on verify.
 */

/* Token-family dim that clears 4.5:1 for the smallest body copy (anon note,
   lede) over white and over the pastel wash. var(--text-dim) is reserved for
   incidental labels. */
const DIM_AA = 'rgba(60,60,67,0.75)';

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-dim)',
  marginBottom: 8,
};

/* Email input sits FLUSH-white on the already-white card — only a hairline,
   no grey tint — which reads more iOS-grouped than the old rgba tint. */
const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 52,
  padding: '0 16px',
  fontSize: 17,
  borderRadius: 14,
  border: '1px solid var(--glass-border)',
  background: '#FFFFFF',
  color: 'var(--text)',
  transition: 'border-color 0.16s ease, box-shadow 0.16s ease',
};

/* ---------- Provider glyphs ---------- */

function AppleGlyph({ muted }: { muted?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={muted ? 'var(--text-dim)' : 'currentColor'}
      aria-hidden
    >
      <path d="M16.36 12.62c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.98.9-3.77 2.29-1.61 2.79-.41 6.92 1.16 9.19.77 1.11 1.69 2.36 2.89 2.31 1.16-.05 1.6-.75 3-.75s1.8.75 3.02.72c1.25-.02 2.04-1.13 2.8-2.25.88-1.29 1.25-2.54 1.27-2.6-.03-.01-2.43-.93-2.46-3.69zM14.13 6.04c.64-.78 1.07-1.86.95-2.94-.92.04-2.04.62-2.7 1.39-.59.69-1.11 1.79-.97 2.85 1.03.08 2.08-.52 2.72-1.3z" />
    </svg>
  );
}

function GoogleGlyph({ muted }: { muted?: boolean }) {
  // When the provider is unavailable the glyph desaturates to text-dim so the
  // "off" state reads instantly and calmly, without any color noise.
  if (muted) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-dim)" aria-hidden>
        <path d="M21.6 12.23c0-.7-.06-1.37-.18-2.02H12v3.82h5.39a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.89-1.74 2.98-4.3 2.98-7.32zM12 22c2.7 0 4.97-.9 6.62-2.43l-3.23-2.5c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A10 10 0 0 0 12 22zM6.41 13.9a6 6 0 0 1 0-3.8V7.52H3.07a10 10 0 0 0 0 8.96l3.34-2.58zM12 5.98c1.47 0 2.78.5 3.81 1.5l2.86-2.86C16.97 2.99 14.7 2 12 2A10 10 0 0 0 3.07 7.52l3.34 2.58C7.2 7.74 9.4 5.98 12 5.98z" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.7-.06-1.37-.18-2.02H12v3.82h5.39a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.89-1.74 2.98-4.3 2.98-7.32z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.43l-3.23-2.5c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A10 10 0 0 0 12 22z"
      />
      <path
        fill="#FBBC05"
        d="M6.41 13.9a6 6 0 0 1 0-3.8V7.52H3.07a10 10 0 0 0 0 8.96l3.34-2.58z"
      />
      <path
        fill="#EA4335"
        d="M12 5.98c1.47 0 2.78.5 3.81 1.5l2.86-2.86C16.97 2.99 14.7 2 12 2A10 10 0 0 0 3.07 7.52l3.34 2.58C7.2 7.74 9.4 5.98 12 5.98z"
      />
    </svg>
  );
}

/* ---------- Brand mark: the one focal moment ---------- */

/**
 * ECHO wordmark seated on a soft white circle, with ONE faint concentric ring
 * behind it that expands-and-fades exactly once on mount (the literal "echo"),
 * then rests. Anchored on the solid white mark surface so the signature can
 * never wash out over an ambient blob. Decorative; the accessible name is the
 * single visible "ECHO". Under prefers-reduced-motion the ring renders at its
 * resting state and the ripple is suppressed (via the keyframed element being
 * gated by the media query in globals + the inline animation honoring it).
 */
function BrandMark() {
  return (
    <div
      aria-hidden
      style={{
        position: 'relative',
        width: 96,
        height: 64,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* The one-shot echo ring. */}
      <span
        className="echo-ring"
        style={{
          position: 'absolute',
          width: 64,
          height: 64,
          borderRadius: '50%',
          border: '1px solid rgba(0,0,0,0.06)',
          // Resting fallback (reduced-motion): a quiet ring at rest.
          opacity: 0.5,
        }}
      />
      {/* The mark circle holding the wordmark. */}
      <span
        style={{
          position: 'relative',
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--card)',
          boxShadow: 'var(--card-shadow)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
        }}
      >
        ECHO
      </span>
      <style>{`
        @keyframes echo-ripple {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.42); opacity: 0; }
        }
        .echo-ring {
          animation: echo-ripple 1.6s cubic-bezier(0.22, 1, 0.36, 1) 1 both;
        }
        @media (prefers-reduced-motion: reduce) {
          .echo-ring { animation: none; opacity: 0.5; transform: none; }
        }
      `}</style>
    </div>
  );
}

/* ---------- Segmented OTP display over one real input ---------- */

/**
 * Six visual cells layered over a SINGLE real <input> (the actual focus + OTP
 * autofill target). The cells are decorative (aria-hidden); screen readers and
 * iOS one-time-code autofill see the one labeled field. Tapping the row focuses
 * the input. This is a presentation upgrade only — the verify/resend flow and
 * state are unchanged, and if anything renders oddly the input itself is still
 * fully usable.
 */
function CodeField({
  value,
  onChange,
  onSubmit,
  labelId,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  labelId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const digits = value.slice(0, 6).split('');
  const activeIndex = Math.min(digits.length, 5);

  return (
    <div
      style={{ position: 'relative' }}
      onClick={() => ref.current?.focus()}
    >
      {/* Visual cells */}
      <div
        aria-hidden
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'center',
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => {
          const filled = i < digits.length;
          const isActive = focused && i === activeIndex;
          return (
            <div
              key={i}
              style={{
                flex: '1 1 0',
                maxWidth: 48,
                height: 56,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                border: isActive
                  ? '2px solid var(--accent)'
                  : '1px solid var(--glass-border)',
                background: '#FFFFFF',
                boxShadow: isActive ? '0 0 0 4px rgba(0,122,255,0.12)' : 'none',
                fontSize: 24,
                fontWeight: 600,
                color: 'var(--text)',
                fontVariantNumeric: 'tabular-nums',
                transition: 'border-color 0.16s ease, box-shadow 0.16s ease',
              }}
            >
              {filled ? digits[i] : ''}
            </div>
          );
        })}
      </div>
      {/* The single real input, transparent and overlaid across the row. */}
      <input
        ref={ref}
        id="signin-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-labelledby={labelId}
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          // Keep the caret off-screen but the field fully focusable/autofillable.
          color: 'transparent',
          background: 'transparent',
          border: 'none',
          caretColor: 'transparent',
          fontSize: 16,
          textAlign: 'center',
          cursor: 'text',
        }}
      />
    </div>
  );
}

/* ---------- Social tier ---------- */

function SocialButton({
  provider,
  glyph,
  mutedGlyph,
  label,
  onUnavailable,
}: {
  provider: AuthProvider;
  glyph: React.ReactNode;
  mutedGlyph: React.ReactNode;
  label: string;
  onUnavailable: (provider: AuthProvider) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState(false);

  const onClick = async () => {
    // No web SIWA-JS / GIS SDK is wired yet (deferred to the Capacitor phase).
    // We probe the backend with an empty token: a configured provider can wire
    // its real id_token here later; today this surfaces the graceful 501
    // "coming soon" path on web and never crashes.
    setBusy(true);
    setError(false);
    try {
      await socialLogin(provider, '');
      router.replace('/home');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 501 || /provider_not_configured/i.test(e.message))) {
        setUnavailable(true);
        onUnavailable(provider);
      } else {
        // A configured provider rejecting an empty token also lands here; treat
        // anything that isn't the 501 as a generic, retryable error.
        setError(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        className="btn-glass"
        onClick={onClick}
        disabled={busy || unavailable}
        aria-disabled={unavailable || undefined}
        style={{
          width: '100%',
          height: 52,
          gap: 10,
          opacity: unavailable ? 0.5 : 1,
          fontWeight: 500,
        }}
      >
        <span aria-hidden style={{ display: 'inline-flex' }}>
          {unavailable ? mutedGlyph : glyph}
        </span>
        {unavailable ? t('signin.comingSoon', { provider: label }) : label}
      </button>
      {error ? (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, textAlign: 'center' }}>
          {t('common.error')}
        </p>
      ) : null}
    </div>
  );
}

/* ---------- Page ---------- */

export default function SignInPage() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);

  // Track which providers came back 501 so we can collapse the social tier into
  // a single calm "coming soon" line once BOTH are unconfigured (the real web
  // state today), instead of leaving two greyed pills dominating the fold.
  const [unconfigured, setUnconfigured] = useState<Set<AuthProvider>>(new Set());
  const bothUnconfigured = unconfigured.has('apple') && unconfigured.has('google');

  const markUnavailable = (provider: AuthProvider) =>
    setUnconfigured((prev) => {
      const next = new Set(prev);
      next.add(provider);
      return next;
    });

  // On entering the code step, probe Apple+Google so we already know whether to
  // show the social tier as a quiet "coming soon" line — keeps the email step
  // primary and avoids the dead-pill fold. Best-effort: failures are ignored.
  const onSendCode = async () => {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(t('signin.invalidEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await emailStart(value);
      // Dev (no mail provider): autofill the returned code so the flow is testable.
      if (res.devCode) {
        setDevCode(res.devCode);
        setCode(res.devCode);
      }
      setStep('code');
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    const value = code.trim();
    if (!value) {
      setError(t('signin.enterCode'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await emailVerify(email.trim(), value);
      router.replace('/home');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? t('signin.badCode') : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const goBackToEmail = () => {
    setStep('email');
    setError(null);
  };

  // Auto-focus the code input when the card swaps in (skipped under
  // reduced-motion concerns is unnecessary — focusing is not motion).
  const codeWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step === 'code') {
      const input = codeWrapRef.current?.querySelector('input');
      input?.focus();
    }
  }, [step]);

  return (
    <main style={{ minHeight: '100dvh' }}>
      <AmbientBg />
      <GlassBar
        title={t('signin.title')}
        onBack={step === 'code' ? goBackToEmail : () => router.back()}
      />

      <div style={{ padding: '8px 20px 110px', maxWidth: 398, margin: '0 auto' }}>
        {/* Hero — pinned across both steps; only the card below swaps. */}
        <div style={{ textAlign: 'center', marginTop: 24, marginBottom: 24 }}>
          <BrandMark />
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.5,
              color: DIM_AA,
              maxWidth: 320,
              margin: '16px auto 0',
            }}
          >
            {t('signin.lede')}
          </p>
        </div>

        {step === 'email' ? (
          <div className="bubble-in" key="email">
            {/* Tier 1 — primary email path in a solid white card. */}
            <GlassCard style={{ padding: 20, borderRadius: 'var(--radius-lg)' }}>
              <label htmlFor="signin-email" style={fieldLabelStyle}>
                {t('signin.emailLabel')}
              </label>
              <input
                id="signin-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t('signin.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSendCode();
                }}
                style={{
                  ...inputStyle,
                  // Signature focus moment: the field quietly catches the light.
                  borderColor: emailFocused ? 'rgba(0,122,255,0.5)' : 'var(--glass-border)',
                  boxShadow: emailFocused ? '0 0 0 4px rgba(0,122,255,0.10)' : 'none',
                }}
              />
              <button
                className="btn-solid"
                onClick={onSendCode}
                disabled={busy}
                style={{ width: '100%', marginTop: 16 }}
              >
                {busy ? t('common.loading') : t('signin.sendCode')}
              </button>
            </GlassCard>

            {/* True separator between tiers — sits on the open wash, not in a card. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                margin: '26px 6px 14px',
                color: 'var(--text-dim)',
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
              {t('signin.or')}
              <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
            </div>

            {/* Tier 2 — social, on the bare ambient wash so the card outranks it.
                Once both providers are unconfigured the pills collapse into one
                calm line so the lower third reads finished, not broken. */}
            {bothUnconfigured ? (
              <p
                style={{
                  fontSize: 14,
                  color: 'var(--text-dim)',
                  textAlign: 'center',
                  padding: '6px 0',
                }}
                aria-live="polite"
              >
                {t('signin.moreSoon')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SocialButton
                  provider="apple"
                  glyph={<AppleGlyph />}
                  mutedGlyph={<AppleGlyph muted />}
                  label={t('signin.apple')}
                  onUnavailable={markUnavailable}
                />
                <SocialButton
                  provider="google"
                  glyph={<GoogleGlyph />}
                  mutedGlyph={<GoogleGlyph muted />}
                  label={t('signin.google')}
                  onUnavailable={markUnavailable}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="bubble-in" key="code" ref={codeWrapRef}>
            <GlassCard style={{ padding: 20, borderRadius: 'var(--radius-lg)' }}>
              <p
                id="signin-code-label"
                style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4, marginBottom: 14 }}
              >
                {t('signin.codeSentTo')}{' '}
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{email.trim()}</span>
              </p>

              <CodeField
                value={code}
                onChange={setCode}
                onSubmit={onVerify}
                labelId="signin-code-label"
              />

              {devCode ? (
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: 13,
                      color: 'var(--text-dim)',
                      background: 'rgba(0,0,0,0.03)',
                      borderRadius: 8,
                      padding: '4px 10px',
                    }}
                  >
                    {t('signin.devCode', { code: devCode })}
                  </span>
                </div>
              ) : null}

              <button
                className="btn-solid"
                onClick={onVerify}
                disabled={busy}
                style={{ width: '100%', marginTop: 16 }}
              >
                {busy ? t('common.loading') : t('signin.verify')}
              </button>

              <button
                type="button"
                onClick={onSendCode}
                disabled={busy}
                style={{
                  width: '100%',
                  marginTop: 8,
                  minHeight: 44,
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 8,
                }}
              >
                {t('signin.resend')}
              </button>
            </GlassCard>

            {/* A second, obvious way back besides the chevron — lowers the
                wrong-email dead-end on the OTP step. */}
            <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', marginTop: 16 }}>
              {t('signin.wrongEmail')}{' '}
              <button
                type="button"
                onClick={goBackToEmail}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {t('signin.goBack')}
              </button>
            </p>
          </div>
        )}

        {/* Error region — announced without stealing focus. */}
        <p
          aria-live="polite"
          style={{
            fontSize: 13,
            color: error ? '#FF3B30' : 'transparent',
            minHeight: error ? undefined : 0,
            marginTop: error ? 14 : 0,
            textAlign: 'center',
          }}
        >
          {error}
        </p>

        {/* Anon reassurance — quiet lock glyph + note, persists on both steps. */}
        <p
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: 6,
            fontSize: 12,
            lineHeight: 1.5,
            color: DIM_AA,
            maxWidth: 320,
            margin: '24px auto 0',
            textAlign: 'center',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
            style={{ flexShrink: 0, marginTop: 3 }}
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
          </svg>
          <span>{t('signin.anonNote')}</span>
        </p>
      </div>
    </main>
  );
}
