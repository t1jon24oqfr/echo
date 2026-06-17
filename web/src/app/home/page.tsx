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
import { useT, type TFunc } from '@/i18n';
import {
  getPersona,
  listPersonas,
  personaAvatar,
  photoUrl,
  type InboxPersona,
  type MessageKind,
  type PersonaSummary,
} from '@/lib/api';

type LastMessage = NonNullable<InboxPersona['lastMessage']> & { role?: 'user' | 'assistant' };

interface PersonaWithPhoto extends PersonaSummary {
  photo: string | null; // full URL of the canonical avatar (or first photo), if any
}

interface PersonaRow extends PersonaWithPhoto {
  last: InboxPersona['lastMessage']; // most recent message from the inbox snapshot
  unread: number;
}

// Resume the wizard where the user left off: chats step for drafts,
// voice step once a chat export is ingested, build screen while building.
function resumeHref(p: PersonaRow): string {
  const id = encodeURIComponent(p.id);
  if (p.status === 'building') return `/create?id=${id}&step=building`;
  const step = p.status === 'ingested' ? 4 : p.demo ? 3 : 2;
  return `/create?id=${id}&step=${step}${p.demo ? '&demo=1' : ''}`;
}

function rowHref(p: PersonaRow): string {
  return p.status === 'ready' ? `/chat?id=${encodeURIComponent(p.id)}` : resumeHref(p);
}

// Last-message preview. The inbox `lastMessage` has no role, so the "You:"
// prefix only applies when we can tell it's the user's — kept for parity with
// the message-history shape (kind: text / image / selfie / voice).
function previewText(m: { content: string; kind: MessageKind }, t: TFunc): string {
  if (m.kind === 'image' || m.kind === 'selfie') return t('chats.photo');
  if (m.kind === 'voice') return t('chats.voice');
  return m.content;
}

// Telegram-style timestamp: HH:MM today, short weekday this week, else DD.MM.YY.
function formatTime(iso: string, t: TFunc): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const sixDaysAgo = new Date(startOfToday);
  sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
  if (d >= sixDaysAgo) {
    const days = ['time.sun', 'time.mon', 'time.tue', 'time.wed', 'time.thu', 'time.fri', 'time.sat'];
    return t(days[d.getDay()]);
  }
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}.${String(d.getFullYear() % 100).padStart(2, '0')}`;
}

export default function HomePage() {
  const t = useT();
  // The inbox snapshot (single app-wide poll) supplies last-message + unread —
  // no per-persona getMessages fan-out.
  const { data: inbox, unreadById } = useInboxContext();
  const [personas, setPersonas] = useState<PersonaWithPhoto[] | null>(null);
  const [error, setError] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  const load = () => {
    setError(false);
    listPersonas()
      .then(async (list) => {
        const withPhotos = await Promise.all(
          list.map(async (p): Promise<PersonaWithPhoto> => {
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
        setPersonas(withPhotos);
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

  // Join persona metadata (presence, status, photo) with the inbox snapshot
  // (last message + unread), then sort by recency.
  const inboxById = inbox ? new Map(inbox.personas.map((p) => [p.id, p])) : null;
  // Chats = real conversations only. Unfinished personas (drafts/building) live
  // in Contacts until they're done; they never show up here.
  const rows: PersonaListRow[] = (personas ?? [])
    .filter((p) => p.status === 'ready')
    .map((p) => {
      const photo = p.photo ?? null;
      const ib = inboxById?.get(p.id);
      const last = ib?.lastMessage ?? null;
      const unread = unreadById[p.id] ?? ib?.unread ?? 0;
      const online = p.status === 'ready' && p.presence?.state === 'online';
      const pr: PersonaRow = { ...p, photo, last, unread };
      const hasUnread = unread > 0;
      return {
        row: {
          id: p.id,
          name: p.name,
          href: rowHref(pr),
          photo,
          online,
          unread,
          subtitle: last ? previewText(last, t) : t('chats.noMessages'),
          subtitleColor: hasUnread ? 'var(--text)' : 'var(--text-dim)',
          emphasize: hasUnread,
          time: last ? formatTime(last.createdAt, t) : undefined,
        } satisfies PersonaListRow,
        sortKey: last ? new Date(last.createdAt).getTime() : 0,
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((x) => x.row);

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg colors={ambient ?? undefined} />
      <GlassBar title={t('chats.title')} />
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
        ) : rows.length ? (
          <PersonaList rows={rows} variant="chats" />
        ) : (
          <GlassCard strong style={{ padding: 20 }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{t('chats.emptyTitle')}</p>
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
