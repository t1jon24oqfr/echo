'use client';

import Link from 'next/link';
import { useT } from '@/i18n';

/** Landing footer with links to the public pages. */
export default function Footer() {
  const t = useT();
  const link: React.CSSProperties = {
    color: 'var(--text-dim)',
    fontSize: 13,
    padding: '12px 6px',
    display: 'inline-block',
  };
  return (
    <footer
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 10,
        flexWrap: 'wrap',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}
    >
      <Link href="/safety" style={link}>
        {t('footer.safety')}
      </Link>
      <Link href="/takedown" style={link}>
        {t('footer.takedown')}
      </Link>
      <Link href="/terms" style={link}>
        {t('footer.terms')}
      </Link>
    </footer>
  );
}
