'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import TabBar from '@/components/persona/TabBar';
import { listPersonas, resetAll, isSignedIn, getAccount, onAuthChange, type Account } from '@/lib/api';
import {
  pushSupported,
  currentPermission,
  enablePush,
  isIos,
  isStandalone,
  type PushStatus,
} from '@/lib/push';
import { LOCALES, LOCALE_NAMES, useLocale, useT } from '@/i18n';

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-dim)',
  margin: '22px 6px 10px',
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 44,
  fontSize: 15,
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

const StarIcon = () => (
  <IconSquare color="#007AFF">
    <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z" />
  </IconSquare>
);

const GlobeIcon = () => (
  <IconSquare color="#AF52DE">
    <circle cx="8" cy="8" r="6.2" />
    <ellipse cx="8" cy="8" rx="2.8" ry="6.2" />
    <path d="M1.8 8h12.4" />
  </IconSquare>
);

const TrashIcon = () => (
  <IconSquare color="#FF3B30">
    <path d="M2.5 4.2h11" />
    <path d="M6 4.2V2.8h4v1.4" />
    <path d="M3.8 4.2l.8 9.2h6.8l.8-9.2" />
    <path d="M6.5 6.8v4M9.5 6.8v4" />
  </IconSquare>
);

const ShieldIcon = () => (
  <IconSquare color="#34C759">
    <path d="M8 1.8l5 1.8v4c0 3.2-2.1 5.5-5 6.6-2.9-1.1-5-3.4-5-6.6v-4l5-1.8z" />
    <path d="M5.8 8l1.6 1.6L10.3 6.5" />
  </IconSquare>
);

const DocIcon = () => (
  <IconSquare color="#8E8E93">
    <path d="M4 1.8h5l3 3v9.4H4V1.8z" />
    <path d="M9 1.8v3h3" />
    <path d="M6 8h4M6 10.5h4" />
  </IconSquare>
);

const CameraOffIcon = () => (
  <IconSquare color="#FF9500">
    <path d="M2 4.5h2.5l1.2-1.7h4.6l1.2 1.7H14v8H2v-8z" />
    <circle cx="8" cy="8.3" r="2.4" />
    <path d="M1.5 1.5l13 13" />
  </IconSquare>
);

const BellIcon = () => (
  <IconSquare color="#FF2D55">
    <path d="M4 7a4 4 0 0 1 8 0c0 3 1 4 1.4 4.5H2.6C3 11 4 10 4 7z" />
    <path d="M6.6 13.6a1.6 1.6 0 0 0 2.8 0" />
  </IconSquare>
);

const PersonIcon = () => (
  <IconSquare color="#007AFF">
    <circle cx="8" cy="5" r="2.6" />
    <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
  </IconSquare>
);

/**
 * Account entry (V11). Signed-in → a row into /account showing name/email.
 * Anonymous → a "sign in to save your personas across devices" affordance into
 * /signin. Anonymous usage is never forced — this is purely opt-in. Reflects
 * sign-in/out live via the api client's auth-change event.
 */
function AccountCard() {
  const t = useT();
  const [signedIn, setSignedIn] = useState<boolean>(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      const on = isSignedIn();
      setSignedIn(on);
      setReady(true);
      if (on) {
        getAccount()
          .then(setAccount)
          .catch(() => setAccount(null));
      } else {
        setAccount(null);
      }
    };
    sync();
    return onAuthChange(sync);
  }, []);

  // Keep the first render hydration-stable (anon assumption) until the effect runs.
  if (!ready) {
    return (
      <GlassCard style={{ padding: '12px 16px' }}>
        <Link href="/signin" style={row}>
          <PersonIcon />
          <span style={{ flex: 1 }}>{t('account.signInCta')}</span>
          <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
        </Link>
      </GlassCard>
    );
  }

  if (!signedIn) {
    return (
      <GlassCard style={{ padding: '12px 16px' }}>
        <Link href="/signin" style={row}>
          <PersonIcon />
          <span style={{ flex: 1 }}>{t('account.signInCta')}</span>
          <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
        </Link>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
          {t('account.signInSub')}
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard style={{ padding: '12px 16px' }}>
      <Link href="/account" style={row}>
        <PersonIcon />
        <span style={{ flex: 1 }}>
          {account?.displayName || account?.email || t('account.title')}
        </span>
        <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
      </Link>
    </GlassCard>
  );
}

/**
 * Notifications row — enable Web Push so proactive ("she texts first") messages
 * reach a closed app. Mirrors the IconSquare/row style of the other settings
 * rows. Reflects the live permission/support state and shows an iOS hint when
 * the PWA isn't installed (iOS only delivers push to a Home-Screen install).
 */
function NotificationsCard() {
  const t = useT();
  // 'unknown' until the client-only effect resolves support/permission, to keep
  // the first render hydration-stable (matches the i18n provider's pattern).
  const [state, setState] = useState<PushStatus | 'granted' | 'unknown'>('unknown');
  const [busy, setBusy] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (!pushSupported()) {
      setState('unsupported');
      // iOS Safari can't do push until added to the Home Screen — guide the user.
      if (isIos() && !isStandalone()) setShowIosHint(true);
      return;
    }
    const perm = currentPermission();
    setState(perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'no-key');
  }, []);

  const onEnable = async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      setState(result === 'enabled' ? 'granted' : result);
    } catch {
      setState('denied');
    } finally {
      setBusy(false);
    }
  };

  const isOn = state === 'granted' || state === 'enabled';
  const isBlocked = state === 'denied';
  const isUnsupported = state === 'unsupported';
  const canEnable = !isOn && !isBlocked && !isUnsupported && state !== 'unknown';

  return (
    <GlassCard style={{ padding: '12px 16px' }}>
      <div style={row}>
        <BellIcon />
        <span style={{ flex: 1 }}>{t('notifications.title')}</span>
        {isOn ? (
          <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12.5L10 17.5L19 7"
                stroke="var(--accent)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t('notifications.enabled')}
          </span>
        ) : canEnable ? (
          <button
            className="btn-glass"
            onClick={onEnable}
            disabled={busy}
            style={{ padding: '6px 14px', fontSize: 14 }}
          >
            {busy ? t('common.loading') : t('notifications.enable')}
          </button>
        ) : null}
      </div>
      {!isOn ? (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
          {isBlocked
            ? t('notifications.blocked')
            : isUnsupported
              ? t('notifications.unsupported')
              : t('notifications.offDesc')}
        </p>
      ) : null}
      {showIosHint ? (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
          {t('notifications.iosHint')}
        </p>
      ) : null}
    </GlassCard>
  );
}

export default function SettingsPage() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const router = useRouter();
  const [ambient, setAmbient] = useState<string[] | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    listPersonas()
      .then((list) => {
        const first = list.find((p) => Array.isArray(p.ambient) && p.ambient.length >= 3);
        if (first?.ambient) setAmbient(first.ambient);
      })
      .catch(() => {});
  }, []);

  const doDelete = async () => {
    setDeleting(true);
    setError(false);
    try {
      await resetAll();
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('echo.disclaimer.')) localStorage.removeItem(key);
        }
      } catch {
        /* localStorage unavailable */
      }
      router.push('/');
    } catch {
      setDeleting(false);
      setError(true);
    }
  };

  return (
    <main style={{ minHeight: '100dvh' }}>
      <AmbientBg colors={ambient} />
      <GlassBar title={t('settings.title')} back="/home" />
      <div style={{ padding: '6px 16px 110px' }}>
        <h2 style={sectionTitle}>{t('account.section')}</h2>
        <AccountCard />

        <h2 style={sectionTitle}>{t('settings.subscription')}</h2>
        <GlassCard style={{ padding: '12px 16px' }}>
          <Link href="/paywall" style={row}>
            <StarIcon />
            <span style={{ flex: 1 }}>{t('settings.plan')}</span>
            <span style={{ color: 'var(--text-dim)' }}>{t('settings.planValue')}</span>
            <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
          </Link>
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('settings.planNote')}</p>
        </GlassCard>

        <h2 style={sectionTitle}>{t('settings.language')}</h2>
        <GlassCard style={{ padding: '12px 16px' }}>
          <button
            onClick={() => setLangOpen(true)}
            style={{
              ...row,
              width: '100%',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              color: 'var(--text)',
            }}
          >
            <GlobeIcon />
            <span style={{ flex: 1 }}>{t('settings.appLanguage')}</span>
            <span style={{ color: 'var(--text-dim)' }}>{LOCALE_NAMES[locale]}</span>
            <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
          </button>
        </GlassCard>

        <h2 style={sectionTitle}>{t('notifications.title')}</h2>
        <NotificationsCard />

        <h2 style={sectionTitle}>{t('settings.privacy')}</h2>
        <GlassCard style={{ padding: '12px 16px' }}>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 4 }}>
            {t('settings.privacyNote')}
          </p>
          <button
            onClick={() => setConfirmDelete(true)}
            style={{
              ...row,
              width: '100%',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              color: 'var(--text)',
            }}
          >
            <TrashIcon />
            <span style={{ flex: 1 }}>{t('settings.deleteAll')}</span>
            <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
          </button>
          {error ? (
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 8 }}>
              {t('common.error')}
            </p>
          ) : null}
        </GlassCard>

        <h2 style={sectionTitle}>{t('settings.info')}</h2>
        <GlassCard style={{ padding: '4px 16px' }}>
          <Link href="/safety" style={row}>
            <ShieldIcon />
            <span style={{ flex: 1 }}>{t('settings.safety')}</span>
            <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
          </Link>
          <Link href="/terms" style={{ ...row, borderTop: '1px solid var(--glass-border)' }}>
            <DocIcon />
            <span style={{ flex: 1 }}>{t('settings.terms')}</span>
            <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
          </Link>
          <Link href="/takedown" style={{ ...row, borderTop: '1px solid var(--glass-border)' }}>
            <CameraOffIcon />
            <span style={{ flex: 1 }}>{t('settings.takedown')}</span>
            <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
          </Link>
        </GlassCard>

        <p
          style={{
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text-dim)',
            marginTop: 24,
          }}
        >
          {t('settings.version')}
        </p>
      </div>

      {langOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('settings.langAria')}
          onClick={() => setLangOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div style={{ width: '100%', maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
          <GlassCard strong style={{ width: '100%', padding: '8px 0' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, padding: '10px 20px 6px' }}>
              {t('settings.appLanguage')}
            </h3>
            {LOCALES.map((l) => {
              const active = l === locale;
              return (
                <button
                  key={l}
                  onClick={() => {
                    setLocale(l);
                    setLangOpen(false);
                  }}
                  aria-current={active ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    minHeight: 48,
                    padding: '0 20px',
                    background: 'none',
                    border: 'none',
                    borderTop: '1px solid var(--glass-border)',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 15,
                    color: 'var(--text)',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ flex: 1 }}>{LOCALE_NAMES[l]}</span>
                  {active ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M5 12.5L10 17.5L19 7"
                        stroke="var(--accent)"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </GlassCard>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('settings.deleteAria')}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <GlassCard strong style={{ width: '100%', maxWidth: 360, padding: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              {t('settings.confirmTitle')}
            </h3>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>
              {t('settings.confirmBody')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn-solid"
                onClick={doDelete}
                disabled={deleting}
                style={{ width: '100%' }}
              >
                {deleting ? t('settings.deleting') : t('settings.confirmYes')}
              </button>
              <button
                className="btn-glass"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                style={{ width: '100%' }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </GlassCard>
        </div>
      ) : null}

      <TabBar />
    </main>
  );
}
