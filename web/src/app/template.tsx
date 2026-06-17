'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ProactiveBanner, { type ProactiveNotice } from '@/components/chat/ProactiveBanner';
import { useInboxContext } from '@/components/InboxProvider';
import { useT } from '@/i18n';

/**
 * Per-route shell wrapper. Re-mounts on every route change → replays the
 * `page-enter` animation, giving cheap smooth transitions between screens.
 *
 * It also hosts two app-wide concerns that need a client boundary:
 *  1. Keyboard avoidance — tracks the on-screen keyboard via visualViewport and
 *     exposes its height as the `--kb` CSS custom property for composers etc.
 *  2. The global ProactiveBanner — fed by the single InboxProvider poll, shown
 *     on every screen EXCEPT the landing route ('/'), and suppressed for the
 *     persona whose chat is currently open (the chat page sets that).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { onNewProactive } = useInboxContext();
  const [notice, setNotice] = useState<ProactiveNotice | null>(null);

  // Keyboard inset: keep --kb = visible viewport gap at the bottom (the area the
  // on-screen keyboard covers), so fixed bottom chrome can lift above it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb', `${Math.round(kb)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.setProperty('--kb', '0px');
    };
  }, []);

  // The landing route never shows in-app proactive banners.
  const onLanding = pathname === '/';

  useEffect(() => {
    if (onLanding) return;
    return onNewProactive((p) =>
      setNotice({
        personaId: p.id,
        name: p.name,
        preview: p.lastMessage?.content ?? t('chats.sentYouMessage'),
      }),
    );
  }, [onNewProactive, onLanding, t]);

  return (
    <div className="page-enter">
      {!onLanding ? (
        <ProactiveBanner
          notice={notice}
          onOpen={(id) => {
            setNotice(null);
            router.push(`/chat?id=${encodeURIComponent(id)}`);
          }}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
      {children}
    </div>
  );
}
