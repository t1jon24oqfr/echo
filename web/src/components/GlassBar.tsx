'use client';

import Link from 'next/link';
import { useT } from '@/i18n';

/**
 * Telegram-style floating top chrome: a glass circle for back,
 * a centered glass pill with the title, and an optional right slot.
 */
export default function GlassBar({
  title,
  back,
  onBack,
  right,
}: {
  title: React.ReactNode;
  /** Route the back chevron links to. Ignored when `onBack` is provided. */
  back?: string;
  /**
   * Custom back handler. When set, the chevron renders as a <button> calling
   * this instead of a <Link>, e.g. to step back through a wizard or close a
   * modal flow without a route change. Same chevron/styling either way.
   */
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const t = useT();
  // A back affordance is shown when either a route or a callback is supplied.
  const hasBack = Boolean(onBack) || Boolean(back);
  const chevron = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 5L8 12L15 19"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  const backStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: '50%',
    flexShrink: 0,
  };
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        // Clear the notch / Dynamic Island on every screen.
        padding: 'calc(10px + env(safe-area-inset-top, 0px)) 10px 6px',
        minHeight: 56,
      }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={t('common.back')}
          className="glass-strong"
          style={backStyle}
        >
          {chevron}
        </button>
      ) : back ? (
        <Link href={back} aria-label={t('common.back')} className="glass-strong" style={backStyle}>
          {chevron}
        </Link>
      ) : null}
      <div
        className="glass-strong"
        style={{
          margin: '0 auto',
          maxWidth: hasBack ? 'calc(100% - 110px)' : 'calc(100% - 8px)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          padding: '4px 16px',
          borderRadius: 999,
          fontSize: 16,
          fontWeight: 600,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </div>
      {right ? (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{right}</div>
      ) : hasBack ? (
        <div style={{ width: 44, flexShrink: 0 }} aria-hidden />
      ) : null}
    </div>
  );
}
