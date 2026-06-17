'use client';

import { useT } from '@/i18n';

/** Blue pill showing an unread count. Renders nothing when count <= 0. */
export default function UnreadBadge({
  count,
  style,
}: {
  count: number;
  style?: React.CSSProperties;
}) {
  const t = useT();
  if (!count || count <= 0) return null;
  return (
    <span
      aria-label={t('chats.unreadAria', { n: count })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 20,
        padding: '0 6px',
        borderRadius: 10,
        background: 'var(--accent)',
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1,
        ...style,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
