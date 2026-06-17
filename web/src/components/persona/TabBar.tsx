'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import UnreadBadge from '@/components/persona/UnreadBadge';
import { useInboxContext } from '@/components/InboxProvider';
import { useT } from '@/i18n';

const TABS: { href: string; labelKey: string; also: string[]; icon: React.ReactNode }[] = [
  {
    href: '/contacts',
    labelKey: 'tabs.contacts',
    also: ['/persona'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M5 19.5C5.8 16.5 8.6 14.8 12 14.8C15.4 14.8 18.2 16.5 19 19.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: '/home',
    labelKey: 'tabs.chats',
    also: ['/chat'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M4 6.5C4 5.12 5.12 4 6.5 4H17.5C18.88 4 20 5.12 20 6.5V14.5C20 15.88 18.88 17 17.5 17H9L5 20.5V6.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: '/settings',
    labelKey: 'tabs.settings',
    also: [],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 4V6M12 18V20M20 12H18M6 12H4M17.7 6.3L16.3 7.7M7.7 16.3L6.3 17.7M17.7 17.7L16.3 16.3M7.7 7.7L6.3 6.3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * Bottom glass tab bar — Telegram's 3-tab model: Contacts / Chats / Settings.
 * Fixed to the bottom of the viewport, centered to the .phone column.
 * Pages using it should reserve ~96px of bottom padding.
 */
export default function TabBar() {
  const t = useT();
  const pathname = usePathname();

  // Unread total comes from the single app-wide InboxProvider poll (mounted in
  // the root layout shell). The proactive in-app banner is now rendered globally
  // in template.tsx, so TabBar only needs the badge count.
  const { totalUnread } = useInboxContext();

  return (
    <>
      <nav
      className="glass-strong"
      aria-label={t('tabs.aria')}
      style={{
        position: 'fixed',
        bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(410px, calc(100vw - 20px))',
        zIndex: 20,
        display: 'flex',
        alignItems: 'stretch',
        padding: 4,
        borderRadius: 26,
      }}
    >
      {TABS.map((tab) => {
        const active =
          matches(pathname, tab.href) || tab.also.some((p) => matches(pathname, p));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              minHeight: 52,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              borderRadius: 22,
              color: active ? 'var(--accent)' : 'var(--text-dim)',
              background: active ? 'rgba(0, 122, 255, 0.10)' : 'transparent',
            }}
          >
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              {tab.icon}
              {tab.href === '/home' && totalUnread > 0 ? (
                <UnreadBadge
                  count={totalUnread}
                  style={{
                    position: 'absolute',
                    top: -6,
                    left: '100%',
                    marginLeft: -10,
                    minWidth: 16,
                    height: 16,
                    fontSize: 10,
                    padding: '0 4px',
                  }}
                />
              ) : null}
            </span>
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 500, lineHeight: 1 }}>
              {t(tab.labelKey)}
            </span>
          </Link>
        );
      })}
      </nav>
    </>
  );
}
