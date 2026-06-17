'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { inbox, type Inbox, type InboxPersona } from '@/lib/api';

const POLL_MS = 25_000;

/** Callback fired when a persona's unread count rises (a new proactive arrived). */
export type ProactiveListener = (p: InboxPersona) => void;

export interface InboxContextValue {
  /** Latest inbox snapshot (null until first load). */
  data: Inbox | null;
  /** unread count by persona id (convenience accessor). */
  unreadById: Record<string, number>;
  totalUnread: number;
  /** Force an immediate refresh (e.g. after markRead). */
  refresh: () => void;
  /**
   * Register a listener for new proactive messages. Returns an unsubscribe fn.
   * Multiple consumers may subscribe; all are notified. The currently-open chat
   * persona (see setSuppressPersonaId) is skipped before listeners fire.
   */
  onNewProactive: (cb: ProactiveListener) => () => void;
  /** Tell the provider which persona's chat is open so its banners are muted. */
  setSuppressPersonaId: (id: string | null) => void;
}

const InboxContext = createContext<InboxContextValue | null>(null);

/**
 * Single-poll inbox provider. Calls the API once on a 25s interval (+ on focus)
 * for the whole app, so home, contacts, TabBar, and the global ProactiveBanner
 * all read the SAME snapshot instead of each spinning up their own poll.
 *
 * Replaces the per-component `useInbox()` hook for shell-level consumers.
 */
export default function InboxProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Inbox | null>(null);
  const prevUnread = useRef<Record<string, number>>({});
  const suppress = useRef<string | null>(null);
  const listeners = useRef<Set<ProactiveListener>>(new Set());

  const load = useCallback(async () => {
    try {
      const next = await inbox();
      setData(next);
      const prev = prevUnread.current;
      const seeded = Object.keys(prev).length > 0; // don't fire on the very first load
      for (const p of next.personas) {
        const before = prev[p.id] ?? 0;
        if (seeded && p.unread > before && p.id !== suppress.current) {
          for (const cb of listeners.current) cb(p);
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

  const onNewProactive = useCallback((cb: ProactiveListener) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  const setSuppressPersonaId = useCallback((id: string | null) => {
    suppress.current = id;
  }, []);

  // Stable identity — consumers put `refresh` in effect deps; if it changed on
  // every poll it would re-run their effects (and a markRead→refresh→re-render
  // loop). `load` is already stable, so this stays stable for the app's life.
  const refresh = useCallback(() => void load(), [load]);

  const value = useMemo<InboxContextValue>(() => {
    const unreadById = data
      ? Object.fromEntries(data.personas.map((p) => [p.id, p.unread]))
      : {};
    return {
      data,
      unreadById,
      totalUnread: data?.totalUnread ?? 0,
      refresh,
      onNewProactive,
      setSuppressPersonaId,
    };
  }, [data, refresh, onNewProactive, setSuppressPersonaId]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

/**
 * Read the single app-wide inbox snapshot. Must be called inside <InboxProvider>
 * (mounted in the root layout shell). Throws otherwise so the wiring mistake is
 * loud rather than silently double-polling.
 */
export function useInboxContext(): InboxContextValue {
  const ctx = useContext(InboxContext);
  if (!ctx) {
    throw new Error('useInboxContext must be used within <InboxProvider>');
  }
  return ctx;
}
