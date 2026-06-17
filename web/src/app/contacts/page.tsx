'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import GlassCard from '@/components/GlassCard';
import TabBar from '@/components/persona/TabBar';
import PersonaList, {
  PersonaListSkeleton,
  type PersonaListRow,
} from '@/components/persona/PersonaList';
import { useInboxContext } from '@/components/InboxProvider';
import { presenceText, useT, type TFunc } from '@/i18n';
import {
  getPersona,
  listPersonas,
  personaAvatar,
  photoUrl,
  type PersonaSummary,
} from '@/lib/api';

interface PersonaRow extends PersonaSummary {
  photo: string | null; // full URL of the canonical avatar (or first photo), if any
}

/** Telegram "Invite Friends"-style top action: this is where you ADD a person. */
function NewPersonaRow({ label }: { label: string }) {
  return (
    <Link
      href="/create"
      className="persona-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        minHeight: 56,
        padding: '8px 18px',
        color: 'var(--accent)',
        textDecoration: 'none',
        fontSize: 16,
        fontWeight: 500,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <circle cx="9" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M3.5 19c.6-2.7 2.9-4.4 5.5-4.4 1 0 1.9.2 2.7.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path d="M17.5 14v6M14.5 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span>{label}</span>
    </Link>
  );
}

// Contacts sort: online first, then ready personas, then drafts; alphabetical
// within each band. Distinct from the Chats tab (which sorts by message time).
function contactSort(a: PersonaRow, b: PersonaRow): number {
  const onlineRank = (p: PersonaRow) => (p.status === 'ready' && p.presence?.state === 'online' ? 0 : 1);
  const readyRank = (p: PersonaRow) => (p.status === 'ready' ? 0 : 1);
  return (
    onlineRank(a) - onlineRank(b) ||
    readyRank(a) - readyRank(b) ||
    a.name.localeCompare(b.name)
  );
}

// Resume the wizard where the user left off (same logic as the Chats tab):
// chats step for drafts, voice step once ingested, build screen while building.
function resumeHref(p: PersonaRow): string {
  const id = encodeURIComponent(p.id);
  if (p.status === 'building') return `/create?id=${id}&step=building`;
  const step = p.status === 'ingested' ? 4 : p.demo ? 3 : 2;
  return `/create?id=${id}&step=${step}${p.demo ? '&demo=1' : ''}`;
}

// Distinct from the Chats tab: presence/relationship subtitle, not a preview.
function subtitle(p: PersonaRow, t: TFunc): { text: string; color: string } {
  if (p.status !== 'ready') return { text: t('contacts.draft'), color: 'var(--text-dim)' };
  // Online glows in the accent colour; every other state (busy / asleep / idle /
  // last seen / remembrance) is a dim, away-style line via presenceText.
  if (p.presence && p.presence.state === 'online')
    return { text: t('presence.online'), color: 'var(--accent)' };
  if (p.presence) return { text: presenceText(p.presence, t), color: 'var(--text-dim)' };
  return { text: t('presence.online'), color: 'var(--accent)' };
}

export default function ContactsPage() {
  const t = useT();
  const { unreadById } = useInboxContext(); // app-wide inbox snapshot (no extra poll)
  const [personas, setPersonas] = useState<PersonaRow[] | null>(null);
  const [error, setError] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  const load = () => {
    setError(false);
    listPersonas()
      .then(async (list) => {
        const rows = await Promise.all(
          list.map(async (p): Promise<PersonaRow> => {
            if (p.avatarFile) return { ...p, photo: photoUrl(p.id, p.avatarFile) };
            if (!p.photoCount) return { ...p, photo: null };
            try {
              const detail = await getPersona(p.id);
              return { ...p, photo: personaAvatar(detail) };
            } catch {
              return { ...p, photo: null };
            }
          }),
        );
        setPersonas(rows);
      })
      .catch(() => setError(true));
  };

  useEffect(load, []);

  // Delay the skeleton ~300ms so fast loads don't flash a loading state.
  useEffect(() => {
    if (personas !== null) return;
    const id = window.setTimeout(() => setShowSkeleton(true), 300);
    return () => window.clearTimeout(id);
  }, [personas]);

  const ambient = personas?.find((p) => Array.isArray(p.ambient) && p.ambient.length >= 3)?.ambient;

  const rows: PersonaListRow[] = (personas ?? [])
    .slice()
    .sort(contactSort)
    .map((p) => {
      const sub = subtitle(p, t);
      const online = p.status === 'ready' && p.presence?.state === 'online';
      return {
        id: p.id,
        name: p.name,
        href: p.status === 'ready' ? `/persona?id=${encodeURIComponent(p.id)}` : resumeHref(p),
        photo: p.photo,
        online,
        unread: unreadById[p.id] ?? 0,
        subtitle: sub.text,
        subtitleColor: sub.color,
      } satisfies PersonaListRow;
    });

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg colors={ambient ?? undefined} />
      <GlassBar title={t('contacts.title')} />
      <div style={{ padding: '6px 16px 110px', flex: 1 }}>
        {error ? (
          <GlassCard>
            <p style={{ marginBottom: 12 }}>{t('common.error')}</p>
            <button className="btn-glass" onClick={load} style={{ width: '100%' }}>
              {t('common.retry')}
            </button>
          </GlassCard>
        ) : personas === null ? (
          showSkeleton ? <PersonaListSkeleton rows={5} /> : null
        ) : personas.length ? (
          <>
            <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
              <style>{'.persona-row:active { background: rgba(0,0,0,0.04); }'}</style>
              <NewPersonaRow label={t('contacts.newPersona')} />
            </div>
            <PersonaList rows={rows} variant="contacts" />
          </>
        ) : (
          <GlassCard strong style={{ padding: 20 }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
              {t('contacts.emptyTitle')}
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>
              {t('chats.emptyBody')}
            </p>
            <Link href="/create" className="btn-solid" style={{ width: '100%', textAlign: 'center' }}>
              {t('common.createPersona')}
            </Link>
          </GlassCard>
        )}
      </div>
      <TabBar />
    </main>
  );
}
