'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n';

/**
 * In-app top glass banner for a proactive ("she texts first") message that
 * arrived while the user is NOT on that persona's chat. Tap → open the chat.
 *
 * This is the in-app, dev-time stand-in for an OS/web push notification.
 * WEB-PUSH HOOK: when real push lands, register a Service Worker + the Push API
 * here (subscribe on permission grant, POST the subscription to the backend,
 * and let the SW show a Notification when the app is backgrounded). This banner
 * stays as the foreground/in-app presentation of the same proactive event.
 */
export interface ProactiveNotice {
  personaId: string;
  name: string;
  preview: string;
}

export default function ProactiveBanner({
  notice,
  onOpen,
  onDismiss,
}: {
  notice: ProactiveNotice | null;
  onOpen: (personaId: string) => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!notice) {
      setShown(false);
      return;
    }
    // Slide in on next frame, auto-dismiss after a few seconds.
    const raf = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => {
      setShown(false);
      setTimeout(onDismiss, 250);
    }, 5000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [notice, onDismiss]);

  if (!notice) return null;

  return (
    <button
      type="button"
      onClick={() => onOpen(notice.personaId)}
      className="glass-strong"
      aria-label={t('chat.openChatAria', { name: notice.name })}
      style={{
        position: 'fixed',
        top: 'calc(8px + env(safe-area-inset-top, 0px))',
        left: '50%',
        transform: `translateX(-50%) translateY(${shown ? '0' : '-140%'})`,
        width: 'min(410px, calc(100vw - 20px))',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 18,
        textAlign: 'left',
        transition: 'transform 0.28s cubic-bezier(0.2,0.8,0.2,1)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        {notice.name[0] ?? '·'}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: 'block',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {notice.name}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            color: 'var(--text-dim)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {notice.preview}
        </span>
      </span>
    </button>
  );
}
