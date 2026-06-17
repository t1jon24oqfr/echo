'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import Studio from '@/components/studio/Studio';
import { useT } from '@/i18n';
import { getPersona, getProfile, type CharacterPassport, type PersonaDetail } from '@/lib/api';

export default function PersonaEditPage() {
  return (
    <Suspense fallback={null}>
      <PersonaEditScreen />
    </Suspense>
  );
}

function PersonaEditScreen() {
  const t = useT();
  const params = useSearchParams();
  const id = params.get('id');

  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [passport, setPassport] = useState<CharacterPassport | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');

  const load = () => {
    setState('loading');
    (async () => {
      if (!id) {
        setState('none');
        return;
      }
      const [detail, profile] = await Promise.all([getPersona(id), getProfile(id)]);
      setPersona(detail);
      if (!profile.passport) {
        setState('none');
        return;
      }
      setPassport(profile.passport);
      setState('ready');
    })().catch(() => setState('error'));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  const backHref = id ? `/persona?id=${encodeURIComponent(id)}` : '/contacts';

  return (
    <main style={{ minHeight: '100dvh' }}>
      <AmbientBg colors={persona?.ambient ?? undefined} />
      <GlassBar title={t('studio.title')} back={backHref} />
      <div style={{ padding: '6px 16px 0' }}>
        {state === 'error' ? (
          <GlassCard style={{ marginTop: 14 }}>
            <p style={{ marginBottom: 12 }}>{t('common.error')}</p>
            <button className="btn-glass" onClick={load} style={{ width: '100%' }}>
              {t('common.retry')}
            </button>
          </GlassCard>
        ) : state === 'loading' ? (
          <GlassCard style={{ marginTop: 14 }}>
            <p style={{ color: 'var(--text-dim)' }}>{t('common.loading')}</p>
          </GlassCard>
        ) : state === 'none' || !passport || !id ? (
          <GlassCard style={{ marginTop: 14 }}>
            <p style={{ marginBottom: 12, color: 'var(--text-dim)' }}>{t('studio.notReady')}</p>
            <Link href={backHref} className="btn-glass" style={{ width: '100%' }}>
              {t('common.back')}
            </Link>
          </GlassCard>
        ) : (
          <>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: '8px 6px 0' }}>
              {t('studio.intro', { name: persona?.name || passport.name })}
            </p>
            <Studio personaId={id} initial={passport} onSaved={(p) => setPassport(p)} />
          </>
        )}
      </div>
    </main>
  );
}
