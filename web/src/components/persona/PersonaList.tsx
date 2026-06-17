'use client';

import Link from 'next/link';
import Avatar from '@/components/persona/Avatar';
import UnreadBadge from '@/components/persona/UnreadBadge';

/**
 * Shared row data for the Chats and Contacts tabs. They share the 48px-avatar +
 * two-line layout so the geometry can't drift, but read DIFFERENTLY:
 *  - chats:    right-aligned time, last-message preview, unread badge.
 *  - contacts: presence only ("online" / "last seen …"), no time/unread/preview.
 * The create affordance is NOT part of this component — each page renders its
 * own ("New chat" picker on Chats, "New persona" row on Contacts).
 */
export interface PersonaListRow {
  id: string;
  name: string;
  href: string;
  photo: string | null;
  online: boolean;
  unread: number;
  /** Pre-rendered subtitle line (tab-specific logic stays in the page). */
  subtitle: string;
  subtitleColor: string;
  /** Bold the name + use full --text for the subtitle (unread emphasis). */
  emphasize?: boolean;
  /** Chats: right-aligned timestamp. Contacts: leave undefined. */
  time?: string;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 64,
  padding: '8px 16px',
  color: 'var(--text)',
  textDecoration: 'none',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--glass-border)',
  marginLeft: 76,
};

export default function PersonaList({
  rows,
  variant,
}: {
  rows: PersonaListRow[];
  variant: 'chats' | 'contacts';
}) {
  const chats = variant === 'chats';
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <style>{'.persona-row:active { background: rgba(0,0,0,0.04); }'}</style>
      {rows.map((p, i) => (
        <div key={p.id}>
          {i > 0 ? <div style={dividerStyle} /> : null}
          <Link href={p.href} className="persona-row" style={rowStyle}>
            <Avatar photo={p.photo} name={p.name} size={48} online={p.online} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: p.emphasize ? 700 : 600,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </div>
                {chats && p.time ? (
                  <span
                    style={{
                      fontSize: 13,
                      color: p.unread ? 'var(--accent)' : 'var(--text-dim)',
                      flexShrink: 0,
                    }}
                  >
                    {p.time}
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  fontSize: chats ? 14 : 13,
                  color: p.subtitleColor,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.subtitle}
              </div>
            </div>
            {/* Chats: unread badge. Contacts: nothing trailing — presence-only,
                matching Telegram's clean contact rows. */}
            {chats ? <UnreadBadge count={p.unread} style={{ flexShrink: 0 }} /> : null}
          </Link>
        </div>
      ))}
    </div>
  );
}

/**
 * Loading placeholder: N rows at the real geometry (48px avatar + two text
 * lines) so the list doesn't jump on load. Shown behind a short delay by the
 * caller so fast loads don't flash. The `.skeleton` shimmer is disabled under
 * prefers-reduced-motion (globals.css).
 */
export function PersonaListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i}>
          {i > 0 ? <div style={dividerStyle} /> : null}
          <div style={rowStyle}>
            <div
              className="skeleton"
              style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="skeleton"
                style={{ width: '45%', height: 13, borderRadius: 6, marginBottom: 8 }}
              />
              <div
                className="skeleton"
                style={{ width: '70%', height: 12, borderRadius: 6 }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
