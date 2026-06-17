'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/i18n';

const AGE_KEY = 'vidlunnia:18plus';

/**
 * Landing CTA block: primary button "Create a persona" + demo link.
 * Both pass through an 18+ gate (glass modal, persisted in localStorage).
 */
export default function CtaSection() {
  const t = useT();
  const router = useRouter();
  const [gateOpen, setGateOpen] = useState(false);
  const [target, setTarget] = useState('/create');

  function go(href: string) {
    let confirmed = false;
    try {
      confirmed = localStorage.getItem(AGE_KEY) === '1';
    } catch {
      /* localStorage unavailable — show the gate */
    }
    if (confirmed) {
      router.push(href);
    } else {
      setTarget(href);
      setGateOpen(true);
    }
  }

  function confirmAge() {
    try {
      localStorage.setItem(AGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setGateOpen(false);
    router.push(target);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch' }}>
      <button type="button" className="btn-solid" style={{ width: '100%' }} onClick={() => go('/create')}>
        {t('common.createPersona')}
      </button>
      <button
        type="button"
        onClick={() => go('/create?demo=1')}
        style={{
          alignSelf: 'center',
          color: 'var(--text-dim)',
          fontSize: 15,
          textDecoration: 'underline',
          textUnderlineOffset: 4,
          padding: 10,
          minHeight: 44,
        }}
      >
        {t('landing.tryDemo')}
      </button>

      {gateOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('landing.ageAria')}
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
          <div
            className="glass-strong"
            style={{
              width: '100%',
              maxWidth: 360,
              padding: 24,
              borderRadius: 'var(--radius-lg)',
              textAlign: 'center',
              background: 'rgba(252,252,253,0.97)',
            }}
          >
            <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>
              {t('landing.ageTitle')}
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 20 }}>
              {t('landing.ageBody')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button type="button" className="btn-solid" style={{ width: '100%' }} onClick={confirmAge}>
                {t('landing.ageConfirm')}
              </button>
              <button
                type="button"
                className="btn-glass"
                style={{ width: '100%' }}
                onClick={() => setGateOpen(false)}
              >
                {t('landing.ageLeave')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
