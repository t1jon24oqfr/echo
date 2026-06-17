'use client';

/**
 * A small bottom-floating toast (saved / error confirmation for the Studio).
 * Self-positions above the sticky Save bar; the parent controls visibility and
 * auto-dismiss. Glass-themed, mobile-first.
 */
export default function Toast({
  message,
  tone = 'ok',
}: {
  message: string;
  tone?: 'ok' | 'error';
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass-strong pop-in"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
        zIndex: 60,
        maxWidth: 'calc(100% - 32px)',
        padding: '10px 18px',
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 600,
        color: tone === 'error' ? '#c0392b' : 'var(--text)',
        boxShadow: 'var(--glass-depth)',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}
