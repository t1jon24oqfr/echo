'use client';

import { useState } from 'react';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';

const TAKEDOWN_EMAIL = 'takedown@vidlunnia.app';

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-dim)',
  marginBottom: 6,
};

const fieldInput: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  padding: '12px 14px',
  borderRadius: 'var(--radius)',
  background: 'rgba(255,255,255,0.85)',
  border: '1px solid var(--glass-border)',
  color: 'var(--text)',
  fontSize: 15,
  outline: 'none',
};

export default function TakedownPage() {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [details, setDetails] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !details.trim()) {
      setError(t('takedown.errFill'));
      return;
    }
    if (!confirmed) {
      setError(t('takedown.errConfirm'));
      return;
    }
    setError(null);
    const subject = encodeURIComponent(t('takedown.mailSubject'));
    const body = encodeURIComponent(
      `${t('takedown.mailName')}: ${name}\nEmail: ${email}\n\n${t('takedown.mailDetails')}:\n${details}\n\n${t('takedown.confirm')}`,
    );
    window.location.href = `mailto:${TAKEDOWN_EMAIL}?subject=${subject}&body=${body}`;
    setSent(true);
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg />
      <GlassBar title={t('takedown.title')} back="/" />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '6px 16px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        <GlassCard strong>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
            {t('takedown.rightTitle')}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 8 }}>
            {t('takedown.right1')}
          </p>
          <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('takedown.right2')}</p>
        </GlassCard>

        {sent ? (
          <GlassCard>
            <p style={{ fontSize: 15, marginBottom: 6 }}>{t('takedown.sentTitle')}</p>
            <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>
              {t('takedown.sentBody', { email: TAKEDOWN_EMAIL })}
            </p>
          </GlassCard>
        ) : (
          <form onSubmit={submit} noValidate>
            <GlassCard>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label htmlFor="td-name" style={fieldLabel}>
                    {t('takedown.name')}
                  </label>
                  <input
                    id="td-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={fieldInput}
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label htmlFor="td-email" style={fieldLabel}>
                    {t('takedown.email')}
                  </label>
                  <input
                    id="td-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={fieldInput}
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label htmlFor="td-details" style={fieldLabel}>
                    {t('takedown.details')}
                  </label>
                  <textarea
                    id="td-details"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    rows={4}
                    style={{ ...fieldInput, resize: 'vertical' }}
                  />
                </div>
                <label
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    fontSize: 14,
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    minHeight: 44,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    style={{ width: 20, height: 20, marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 }}
                  />
                  <span>{t('takedown.confirm')}</span>
                </label>
                {error ? (
                  <div className="glass" style={{ padding: '10px 14px', fontSize: 14 }}>
                    {error}
                  </div>
                ) : null}
                <button type="submit" className="btn-solid" style={{ width: '100%' }}>
                  {t('takedown.send')}
                </button>
              </div>
            </GlassCard>
          </form>
        )}
      </div>
    </main>
  );
}
