'use client';

/**
 * A small emoji "tapback" reaction the persona left on the USER's last bubble
 * (Phase-3 `{reaction}` SSE event — an emoji-only reply that short-circuits a
 * text turn). Rendered as a little glass pill that the caller overlaps onto the
 * bubble's lower outer corner, NOT as a normal chat bubble.
 */

import { useT } from '@/i18n';

export default function ReactionTapback({ emoji }: { emoji: string }) {
  const t = useT();
  return (
    <span
      role="img"
      aria-label={t('chat.reactedWith', { emoji })}
      className="glass-strong"
      style={{
        minWidth: 22,
        height: 22,
        padding: '0 4px',
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        lineHeight: 1,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        animation: 'vl-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      <style>{'@keyframes vl-pop{0%{transform:scale(0)}100%{transform:scale(1)}}'}</style>
      {emoji}
    </span>
  );
}
