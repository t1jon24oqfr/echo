'use client';

import { useState } from 'react';
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
 * V11 sign-in screen. Anonymous usage stays fully allowed — this is an opt-in
 * affordance to save personas across devices, reached from Settings (and a
 * soft prompt). Flow:
 *  1. email step → POST /auth/email/start (dev returns the code → autofilled)
 *  2. code step  → POST /auth/email/verify → session stored, claims personas.
 * Apple + Google buttons are rendered; until provider creds land the backend
 * returns 501 provider_not_configured, which we show as a tasteful disabled
 * "coming soon" state rather than crashing. The current device token is passed
 * automatically by the api client so the anon user's personas are claimed.
 */

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 48,
  padding: '0 16px',
  fontSize: 16,
  borderRadius: 14,
  border: '1px solid var(--glass-border)',
  background: 'rgba(255,255,255,0.7)',
  color: 'var(--text)',
};

function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.36 12.62c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.98.9-3.77 2.29-1.61 2.79-.41 6.92 1.16 9.19.77 1.11 1.69 2.36 2.89 2.31 1.16-.05 1.6-.75 3-.75s1.8.75 3.02.72c1.25-.02 2.04-1.13 2.8-2.25.88-1.29 1.25-2.54 1.27-2.6-.03-.01-2.43-.93-2.46-3.69zM14.13 6.04c.64-.78 1.07-1.86.95-2.94-.92.04-2.04.62-2.7 1.39-.59.69-1.11 1.79-.97 2.85 1.03.08 2.08-.52 2.72-1.3z" />
    </svg>
  );
}

function GoogleGlyph() {
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

function ProviderButton({
  provider,
  glyph,
  label,
  onUnavailable,
}: {
  provider: AuthProvider;
  glyph: React.ReactNode;
  label: string;
  onUnavailable: (provider: AuthProvider) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState(false);

  const onClick = async () => {
    // There is no web SIWA-JS/GIS SDK wired yet (deferred to the Capacitor
    // phase). We probe the backend with an empty token so a configured provider
    // can wire its real id_token here later; today this surfaces the graceful
    // 501 "coming soon" path on web, and never crashes.
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
        // A configured provider rejecting an empty token also lands here; for
        // now treat anything that isn't the 501 as a generic, retryable error.
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
        style={{
          width: '100%',
          gap: 10,
          opacity: unavailable ? 0.5 : 1,
        }}
      >
        <span aria-hidden style={{ display: 'inline-flex' }}>
          {glyph}
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

export default function SignInPage() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main style={{ minHeight: '100dvh' }}>
      <AmbientBg />
      <GlassBar
        title={t('signin.title')}
        onBack={step === 'code' ? () => { setStep('email'); setError(null); } : () => router.back()}
      />
      <div style={{ padding: '6px 20px 110px', maxWidth: 430, margin: '0 auto' }}>
        <p style={{ fontSize: 15, color: 'var(--text-dim)', margin: '8px 6px 20px', lineHeight: 1.5 }}>
          {t('signin.lede')}
        </p>

        {step === 'email' ? (
          <>
            <GlassCard style={{ padding: 16 }}>
              <label
                htmlFor="signin-email"
                style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}
              >
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSendCode();
                }}
                style={inputStyle}
              />
              <button
                className="btn-solid"
                onClick={onSendCode}
                disabled={busy}
                style={{ width: '100%', marginTop: 12 }}
              >
                {busy ? t('common.loading') : t('signin.sendCode')}
              </button>
            </GlassCard>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                margin: '22px 6px',
                color: 'var(--text-dim)',
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
              {t('signin.or')}
              <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ProviderButton
                provider="apple"
                glyph={<AppleGlyph />}
                label={t('signin.apple')}
                onUnavailable={() => {}}
              />
              <ProviderButton
                provider="google"
                glyph={<GoogleGlyph />}
                label={t('signin.google')}
                onUnavailable={() => {}}
              />
            </div>
          </>
        ) : (
          <GlassCard style={{ padding: 16 }}>
            <label
              htmlFor="signin-code"
              style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}
            >
              {t('signin.codeLabel', { email: email.trim() })}
            </label>
            <input
              id="signin-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t('signin.codePlaceholder')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onVerify();
              }}
              style={{ ...inputStyle, letterSpacing: '0.3em', textAlign: 'center', fontSize: 20 }}
            />
            {devCode ? (
              <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 8 }}>
                {t('signin.devCode', { code: devCode })}
              </p>
            ) : null}
            <button
              className="btn-solid"
              onClick={onVerify}
              disabled={busy}
              style={{ width: '100%', marginTop: 12 }}
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
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: 14,
                cursor: 'pointer',
                padding: 8,
              }}
            >
              {t('signin.resend')}
            </button>
          </GlassCard>
        )}

        {error ? (
          <p style={{ fontSize: 13, color: '#FF3B30', marginTop: 14, textAlign: 'center' }}>
            {error}
          </p>
        ) : null}

        <p
          style={{
            fontSize: 12,
            color: 'var(--text-dim)',
            marginTop: 24,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {t('signin.anonNote')}
        </p>
      </div>
    </main>
  );
}
