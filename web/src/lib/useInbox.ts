'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { inbox, type Inbox, type InboxPersona } from '@/lib/api';

const POLL_MS = 25_000;

export interface InboxState {
  /** Latest inbox snapshot (null until first load). */
  data: Inbox | null;
  /** unread count by persona id (convenience accessor). */
  unreadById: Record<string, number>;
  totalUnread: number;
  /** Force an immediate refresh (e.g. after markRead). */
  refresh: () => void;
}

/**
 * Poll `inbox()` every ~25s while the app is open and on window focus.
 * Optionally fires `onNewProactive` when a persona's unread count rises
 * (a new "she texts first" message arrived) — used for the in-app banner.
 * `suppressPersonaId` skips banners for the chat the user is currently viewing.
 */
export function useInbox(opts?: {
  onNewProactive?: (p: InboxPersona) => void;
  suppressPersonaId?: string | null;
}): InboxState {
  const [data, setData] = useState<Inbox | null>(null);
  const prevUnread = useRef<Record<string, number>>({});
  const onNew = useRef(opts?.onNewProactive);
  const suppress = useRef(opts?.suppressPersonaId ?? null);
  onNew.current = opts?.onNewProactive;
  suppress.current = opts?.suppressPersonaId ?? null;

  const load = useCallback(async () => {
    try {
      const next = await inbox();
      setData(next);
      const prev = prevUnread.current;
      const seeded = Object.keys(prev).length > 0; // don't fire on the very first load
      for (const p of next.personas) {
        const before = prev[p.id] ?? 0;
        if (seeded && p.unread > before && p.id !== suppress.current) {
          onNew.current?.(p);
        }
      }
      prevUnread.current = Object.fromEntries(next.personas.map((p) => [p.id, p.unread]));
    } catch {
      /* network blip — keep the last snapshot */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const unreadById = data
    ? Object.fromEntries(data.personas.map((p) => [p.id, p.unread]))
    : {};
  return { data, unreadById, totalUnread: data?.totalUnread ?? 0, refresh: () => void load() };
}
