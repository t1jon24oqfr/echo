'use client';

import { useT } from '@/i18n';
import EchoMark from './EchoMark';
import CtaSection from './CtaSection';

/**
 * Closing call-to-action — reprises the echo mark (closing the motif loop) over
 * a warm one-line headline, then the same gated CtaSection as the hero so the
 * primary action is surfaced again at the end of the scroll.
 */
export default function ClosingCta() {
  const t = useT();
  return (
    <div
      className="card"
      style={{
        padding: '32px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
      }}
    >
      <EchoMark size={30} />
      <h2 style={{ fontSize: 23, fontWeight: 600, lineHeight: 1.25, maxWidth: 280 }}>
        {t('landing.ctaHeadline')}
      </h2>
      <div style={{ width: '100%' }}>
        <CtaSection />
      </div>
    </div>
  );
}
