'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import {
  getAccount,
  updateAccount,
  exportAccount,
  logout,
  logoutAll,
  deleteAccount,
  isSignedIn,
  type Account,
  type AuthProvider,
} from '@/lib/api';
import { LOCALE_NAMES, useLocale, useT } from '@/i18n';

/**
 * V11 account page (signed-in users), linked from Settings. Reuses the
 * iOS-settings IconSquare/row vocabulary from /settings. Shows: display name
 * (edit → PATCH), email (+ private-relay badge), linked providers
 * (connect/disconnect, never the last one), plan, "18+ confirmed on …",
 * language, notifications hint; flows: export data, sign out, sign out all,
 * permanent DELETE account (confirm). Anonymous users are redirected to /signin.
 */

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

const PersonIcon = () => (
  <IconSquare color="#007AFF">
    <circle cx="8" cy="5" r="2.6" />
    <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
  </IconSquare>
);
const MailIcon = () => (
  <IconSquare color="#34C759">
    <rect x="1.8" y="3.5" width="12.4" height="9" rx="1.4" />
    <path d="M2.2 4.5L8 8.8l5.8-4.3" />
  </IconSquare>
);
const StarIcon = () => (
  <IconSquare color="#FFCC00">
    <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z" />
  </IconSquare>
);
const AgeIcon = () => (
  <IconSquare color="#5856D6">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M5.8 8l1.6 1.6L10.3 6.5" />
  </IconSquare>
);
const GlobeIcon = () => (
  <IconSquare color="#AF52DE">
    <circle cx="8" cy="8" r="6.2" />
    <ellipse cx="8" cy="8" rx="2.8" ry="6.2" />
    <path d="M1.8 8h12.4" />
  </IconSquare>
);
const KeyIcon = () => (
  <IconSquare color="#8E8E93">
    <circle cx="5" cy="8" r="2.6" />
    <path d="M7.5 8h6M11.5 8v2.4M13.5 8v1.8" />
  </IconSquare>
);
const ExportIcon = () => (
  <IconSquare color="#5AC8FA">
    <path d="M8 10V2.5M8 2.5L5.4 5M8 2.5l2.6 2.5" />
    <path d="M3 9.5v3.5h10V9.5" />
  </IconSquare>
);
const SignOutIcon = () => (
  <IconSquare color="#FF9500">
    <path d="M9.5 4V2.5h-7v11h7V12" />
    <path d="M6.5 8h7M13.5 8L11 5.6M13.5 8L11 10.4" />
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

const PROVIDER_LABEL: Record<AuthProvider, string> = { apple: 'Apple', google: 'Google' };

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function AccountPage() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();
  const [account, setAccount] = useState<Account | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  useEffect(() => {
    if (!isSignedIn()) {
      router.replace('/signin');
      return;
    }
    getAccount()
      .then(setAccount)
      .catch(() => setLoadError(true));
  }, [router]);

  const saveName = async () => {
    setSavingName(true);
    try {
      const updated = await updateAccount({ displayName: nameDraft.trim() });
      setAccount(updated);
      setEditingName(false);
    } catch {
      /* keep the editor open on failure */
    } finally {
      setSavingName(false);
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'echo-account-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore — user can retry */
    } finally {
      setExporting(false);
    }
  };

  const doSignOut = async () => {
    setSigningOut(true);
    await logout();
    router.replace('/home');
  };

  const doSignOutAll = async () => {
    setSigningOut(true);
    await logoutAll();
    router.replace('/home');
  };

  const doDelete = async () => {
    setDeleting(true);
    setDeleteError(false);
    try {
      await deleteAccount();
      router.replace('/');
    } catch {
      setDeleting(false);
      setDeleteError(true);
    }
  };

  if (loadError) {
    return (
      <main style={{ minHeight: '100dvh' }}>
        <AmbientBg />
        <GlassBar title={t('account.title')} back="/settings" />
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)' }}>
          {t('common.error')}
        </div>
      </main>
    );
  }

  if (!account) {
    return (
      <main style={{ minHeight: '100dvh' }}>
        <AmbientBg />
        <GlassBar title={t('account.title')} back="/settings" />
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)' }}>
          {t('common.loading')}
        </div>
      </main>
    );
  }

  const canDisconnect = account.providers.length > 1;

  return (
    <main style={{ minHeight: '100dvh' }}>
      <AmbientBg />
      <GlassBar title={t('account.title')} back="/settings" />
      <div style={{ padding: '6px 16px 110px', maxWidth: 430, margin: '0 auto' }}>
        {/* Profile */}
        <h2 style={sectionTitle}>{t('account.profile')}</h2>
        <GlassCard style={{ padding: '12px 16px' }}>
          <div style={row}>
            <PersonIcon />
            <span style={{ flex: 1 }}>{t('account.displayName')}</span>
            {editingName ? null : (
              <>
                <span style={{ color: 'var(--text-dim)' }}>
                  {account.displayName || t('account.noName')}
                </span>
                <button
                  onClick={() => {
                    setNameDraft(account.displayName || '');
                    setEditingName(true);
                  }}
                  style={{ color: 'var(--accent)', fontSize: 14, padding: '4px 8px' }}
                >
                  {t('account.edit')}
                </button>
              </>
            )}
          </div>
          {editingName ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: 4 }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                }}
                placeholder={t('account.namePlaceholder')}
                style={{
                  flex: 1,
                  height: 40,
                  padding: '0 12px',
                  fontSize: 15,
                  borderRadius: 10,
                  border: '1px solid var(--glass-border)',
                  background: 'rgba(255,255,255,0.7)',
                  color: 'var(--text)',
                }}
              />
              <button
                className="btn-solid"
                onClick={saveName}
                disabled={savingName}
                style={{ height: 40, padding: '0 16px', fontSize: 14 }}
              >
                {savingName ? t('common.saving') : t('account.save')}
              </button>
            </div>
          ) : null}

          <div style={{ ...row, borderTop: '1px solid var(--glass-border)' }}>
            <MailIcon />
            <span style={{ flex: 1 }}>{t('account.email')}</span>
            <span
              style={{
                color: 'var(--text-dim)',
                maxWidth: '55%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {account.email || t('account.noEmail')}
            </span>
          </div>
          {account.emailIsPrivateRelay ? (
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '2px 0 4px 41px' }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '1px 8px',
                  borderRadius: 999,
                  background: 'rgba(0,122,255,0.12)',
                  color: 'var(--accent)',
                  fontWeight: 600,
                }}
              >
                {t('account.privateRelay')}
              </span>{' '}
              {t('account.privateRelayNote')}
            </p>
          ) : null}
        </GlassCard>

        {/* Linked sign-in methods */}
        <h2 style={sectionTitle}>{t('account.signInMethods')}</h2>
        <GlassCard style={{ padding: '12px 16px' }}>
          {account.providers.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('account.noProviders')}</p>
          ) : (
            account.providers.map((p, i) => (
              <div
                key={p.provider}
                style={{ ...row, borderTop: i === 0 ? undefined : '1px solid var(--glass-border)' }}
              >
                <KeyIcon />
                <span style={{ flex: 1 }}>{PROVIDER_LABEL[p.provider] ?? p.provider}</span>
                <span
                  style={{ color: 'var(--text-dim)', fontSize: 13, display: 'inline-flex', gap: 6 }}
                >
                  {t('account.connected')}
                </span>
                {canDisconnect ? (
                  <button
                    onClick={() => {
                      /* disconnect endpoint not yet exposed — kept never-last-safe;
                         shown only when more than one method is linked. */
                    }}
                    disabled
                    title={t('account.disconnectSoon')}
                    style={{ color: 'var(--text-dim)', fontSize: 13, padding: '4px 8px' }}
                  >
                    {t('account.disconnect')}
                  </button>
                ) : (
                  <span
                    aria-hidden
                    title={t('account.lastMethod')}
                    style={{ color: 'var(--text-dim)' }}
                  >
                    ✓
                  </span>
                )}
              </div>
            ))
          )}
          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
            {canDisconnect ? t('account.disconnectNote') : t('account.lastMethodNote')}
          </p>
        </GlassCard>

        {/* Plan + age */}
        <h2 style={sectionTitle}>{t('account.account')}</h2>
        <GlassCard style={{ padding: '12px 16px' }}>
          <div style={row}>
            <StarIcon />
            <span style={{ flex: 1 }}>{t('account.plan')}</span>
            <span style={{ color: 'var(--text-dim)', textTransform: 'capitalize' }}>
              {account.plan}
            </span>
          </div>
          {account.ageConfirmedAt ? (
            <div style={{ ...row, borderTop: '1px solid var(--glass-border)' }}>
              <AgeIcon />
              <span style={{ flex: 1 }}>{t('account.ageConfirmed')}</span>
              <span style={{ color: 'var(--text-dim)' }}>
                {formatDate(account.ageConfirmedAt, locale)}
              </span>
            </div>
          ) : null}
          <div style={{ ...row, borderTop: '1px solid var(--glass-border)' }}>
            <GlobeIcon />
            <span style={{ flex: 1 }}>{t('account.language')}</span>
            <span style={{ color: 'var(--text-dim)' }}>{LOCALE_NAMES[locale]}</span>
          </div>
        </GlassCard>

        {/* Data & session */}
        <h2 style={sectionTitle}>{t('account.dataAndSession')}</h2>
        <GlassCard style={{ padding: '12px 16px' }}>
          <button
            onClick={doExport}
            disabled={exporting}
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
            <ExportIcon />
            <span style={{ flex: 1 }}>{t('account.exportData')}</span>
            <span style={{ color: 'var(--text-dim)' }}>
              {exporting ? t('common.loading') : '›'}
            </span>
          </button>
          <button
            onClick={doSignOut}
            disabled={signingOut}
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
              borderTop: '1px solid var(--glass-border)',
            }}
          >
            <SignOutIcon />
            <span style={{ flex: 1 }}>{t('account.signOut')}</span>
            <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
          </button>
          <button
            onClick={doSignOutAll}
            disabled={signingOut}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              padding: '4px 0 0 41px',
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              fontSize: 13,
              color: 'var(--accent)',
            }}
          >
            {t('account.signOutAll')}
          </button>
        </GlassCard>

        {/* Danger zone */}
        <h2 style={sectionTitle}>{t('account.dangerZone')}</h2>
        <GlassCard style={{ padding: '12px 16px' }}>
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
            <span style={{ flex: 1, color: '#FF3B30' }}>{t('account.deleteAccount')}</span>
            <span aria-hidden style={{ color: 'var(--text-dim)' }}>›</span>
          </button>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
            {t('account.deleteNote')}
          </p>
        </GlassCard>
      </div>

      {confirmDelete ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('account.deleteAria')}
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
              {t('account.deleteConfirmTitle')}
            </h3>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>
              {t('account.deleteConfirmBody')}
            </p>
            {deleteError ? (
              <p style={{ fontSize: 13, color: '#FF3B30', marginBottom: 12 }}>{t('common.error')}</p>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn-solid"
                onClick={doDelete}
                disabled={deleting}
                style={{ width: '100%', background: '#FF3B30' }}
              >
                {deleting ? t('account.deleting') : t('account.deleteConfirmYes')}
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
    </main>
  );
}
