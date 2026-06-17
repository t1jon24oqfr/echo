'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import AIBadge from '@/components/AIBadge';
import TabBar from '@/components/persona/TabBar';
import Avatar from '@/components/persona/Avatar';
import HerVoice from '@/components/persona/HerVoice';
import { useLocale, useT } from '@/i18n';
import {
  deletePersona,
  getPersona,
  listPersonas,
  personaAvatar,
  photoUrl,
  setAvatar,
  type PersonaDetail,
} from '@/lib/api';

function fmtDate(iso: string | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-dim)',
  margin: '22px 6px 10px',
};

export default function PersonaPage() {
  return (
    <Suspense fallback={null}>
      <PersonaScreen />
    </Suspense>
  );
}

function PersonaScreen() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const idParam = params.get('id');

  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [farewell, setFarewell] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pickingAvatar, setPickingAvatar] = useState(false);

  const pickAvatar = async (file: string) => {
    if (!persona || pickingAvatar || persona.avatarFile === file) return;
    setPickingAvatar(true);
    try {
      await setAvatar(persona.id, file);
      setPersona({ ...persona, avatarFile: file });
    } catch {
      setError(true);
    } finally {
      setPickingAvatar(false);
    }
  };

  const load = () => {
    setError(false);
    (async () => {
      let pid = idParam;
      if (!pid) {
        const list = await listPersonas();
        pid = list[0]?.id ?? null;
      }
      if (!pid) {
        setExists(false);
        return;
      }
      const detail = await getPersona(pid);
      setPersona(detail);
      setExists(true);
    })().catch(() => setError(true));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [idParam]);

  const doFarewell = async () => {
    if (!persona) return;
    setResetting(true);
    try {
      await deletePersona(persona.id);
      try {
        localStorage.removeItem(`echo.disclaimer.${persona.id}`);
      } catch {
        /* ignore */
      }
      router.push('/home');
    } catch {
      setResetting(false);
      setFarewell(false);
      setError(true);
    }
  };

  const name = persona?.name || '';
  // Avatar pack first (picker), then uploads/selfies.
  const avatarPack = persona ? persona.photos.filter((p) => p.kind === 'avatar') : [];
  const otherPhotos = persona ? persona.photos.filter((p) => p.kind !== 'avatar') : [];
  const modeLabel =
    persona?.mode === 'memorial'
      ? t('persona.modeMemorial')
      : persona?.mode === 'reconnect'
        ? t('persona.modeReconnect')
        : null;

  return (
    <main style={{ minHeight: '100dvh' }}>
      <AmbientBg colors={persona?.ambient ?? undefined} />
      <GlassBar title={t('persona.profile')} back="/contacts" right={<AIBadge />} />
      <div style={{ padding: '6px 16px 110px' }}>
        {error ? (
          <GlassCard>
            <p style={{ marginBottom: 12 }}>{t('common.error')}</p>
            <button className="btn-glass" onClick={load} style={{ width: '100%' }}>
              {t('common.retry')}
            </button>
          </GlassCard>
        ) : exists === null ? (
          <GlassCard>
            <p style={{ color: 'var(--text-dim)' }}>{t('common.loading')}</p>
          </GlassCard>
        ) : exists === false || !persona ? (
          <GlassCard>
            <p style={{ marginBottom: 12, color: 'var(--text-dim)' }}>{t('persona.none')}</p>
            <Link href="/create" className="btn-solid" style={{ width: '100%', textAlign: 'center' }}>
              {t('common.createPersona')}
            </Link>
          </GlassCard>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                margin: '14px 0 4px',
                textAlign: 'center',
              }}
            >
              <Avatar photo={personaAvatar(persona)} name={name} size={88} />
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 600 }}>{name}</h1>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>
                  {persona.relationship || t('persona.someoneClose')}
                  {modeLabel ? ` · ${t('persona.modeLabel', { mode: modeLabel })}` : ''}
                  {persona.demo ? ` · ${t('persona.demoTag')}` : ''}
                </p>
              </div>
            </div>

            {persona.hasPassport ? (
              <Link
                href={`/persona/edit?id=${encodeURIComponent(persona.id)}`}
                className="btn-glass"
                style={{ width: '100%', marginTop: 10 }}
              >
                {t('persona.editCharacter')}
              </Link>
            ) : null}

            <h2 style={sectionTitle}>{t('persona.memories')}</h2>
            {persona.card?.facts?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {persona.card.facts.map((f, i) => (
                  <GlassCard key={i} style={{ padding: '12px 16px' }}>
                    <p style={{ fontSize: 14 }}>{f}</p>
                  </GlassCard>
                ))}
              </div>
            ) : (
              <GlassCard style={{ padding: '12px 16px' }}>
                <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('persona.noFacts')}</p>
              </GlassCard>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '8px 6px 0' }}>
              {t('persona.memoriesSaved', { n: persona.memoriesCount ?? 0 })}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 6px 0' }}>
              {t('persona.keepsLearning', { n: persona.memoriesCount ?? 0 })}
            </p>
            {persona.recentMemories?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {persona.recentMemories.map((m, i) => (
                  <GlassCard key={i} style={{ padding: '10px 14px' }}>
                    <p style={{ fontSize: 13 }}>{m.text}</p>
                    {m.date ? (
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{m.date}</p>
                    ) : null}
                  </GlassCard>
                ))}
              </div>
            ) : null}

            <h2 style={sectionTitle}>{t('herVoice.title')}</h2>
            <HerVoice
              personaId={persona.id}
              hasVoiceSample={!!persona.hasVoiceSample}
              onUploaded={load}
            />

            {avatarPack.length ? (
              <>
                <h2 style={sectionTitle}>{t('persona.avatar')}</h2>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                  }}
                >
                  {avatarPack.map((p) => {
                    const current = persona.avatarFile === p.file;
                    return (
                      <button
                        key={p.file}
                        type="button"
                        onClick={() => void pickAvatar(p.file)}
                        disabled={pickingAvatar}
                        aria-label={current ? t('persona.currentAvatarAria') : t('persona.setAvatarAria')}
                        style={{
                          padding: 0,
                          border: 'none',
                          background: 'none',
                          cursor: current ? 'default' : 'pointer',
                          position: 'relative',
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photoUrl(persona.id, p.file)}
                          alt=""
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            objectFit: 'cover',
                            display: 'block',
                            borderRadius: 'var(--radius)',
                            border: current
                              ? '2px solid var(--accent, #007AFF)'
                              : '1px solid var(--glass-border)',
                            opacity: pickingAvatar && !current ? 0.6 : 1,
                          }}
                        />
                        {current ? (
                          <span
                            style={{
                              position: 'absolute',
                              right: 6,
                              bottom: 6,
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#fff',
                              background: 'var(--accent, #007AFF)',
                              borderRadius: 999,
                              padding: '2px 8px',
                            }}
                          >
                            {t('persona.current')}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            <h2 style={sectionTitle}>{t('persona.photos')}</h2>
            {otherPhotos.length ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                }}
              >
                {otherPhotos.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={p.file}
                    src={photoUrl(persona.id, p.file)}
                    alt=""
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--glass-border)',
                    }}
                  />
                ))}
              </div>
            ) : (
              <GlassCard style={{ padding: '12px 16px' }}>
                <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('persona.noPhotos')}</p>
              </GlassCard>
            )}

            <h2 style={sectionTitle}>{t('persona.data')}</h2>
            <GlassCard style={{ padding: '14px 16px' }}>
              <p style={{ fontSize: 14 }}>
                {t('persona.chatsMessages', { n: persona.stats?.totalMessages ?? 0 })}
              </p>
              {persona.stats?.from ? (
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                  {fmtDate(persona.stats.from, locale)} — {fmtDate(persona.stats.to, locale)}
                </p>
              ) : null}
              {persona.demo ? (
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                  {t('persona.demoData')}
                </p>
              ) : null}
              <Link
                href={`/create?step=3&id=${encodeURIComponent(persona.id)}`}
                className="btn-glass"
                style={{ width: '100%', marginTop: 12 }}
              >
                {t('persona.addChat')}
              </Link>
            </GlassCard>

            {persona.mode === 'memorial' ? (
              <>
                <h2 style={sectionTitle}>{t('persona.farewell')}</h2>
                <GlassCard style={{ padding: '14px 16px' }}>
                  <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>
                    {t('persona.farewellBody')}
                  </p>
                  <button
                    className="btn-glass"
                    onClick={() => setFarewell(true)}
                    style={{ width: '100%' }}
                  >
                    {t('persona.farewellBtn')}
                  </button>
                </GlassCard>
              </>
            ) : null}
          </>
        )}
      </div>

      {farewell ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('persona.farewellAria')}
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
              {t('persona.goodbyeTitle')}
            </h3>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>
              {t('persona.goodbyeBody')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn-solid"
                onClick={doFarewell}
                disabled={resetting}
                style={{ width: '100%' }}
              >
                {resetting ? t('persona.goodbyeDoing') : t('persona.goodbyeYes')}
              </button>
              <button
                className="btn-glass"
                onClick={() => setFarewell(false)}
                disabled={resetting}
                style={{ width: '100%' }}
              >
                {t('persona.stay')}
              </button>
            </div>
          </GlassCard>
        </div>
      ) : null}

      <TabBar />
    </main>
  );
}
