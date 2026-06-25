'use client';

import { useT } from '@/i18n';
import EchoMark from './EchoMark';
import HeroMockup from './HeroMockup';
import CtaSection from './CtaSection';

/**
 * Landing hero: the ECHO kicker (with the ripple mark), a staggered three-line
 * headline, the subtitle, the live animated chat demo, and the primary CTA
 * directly under it — so the path to "Create a persona" sits right beneath the
 * thing that just showed what the product does. Entrance is staggered via
 * `.hero-rise` (frozen under reduced-motion).
 */
export default function Hero() {
  const t = useT();

  // Split the headline into its sentence-lines ("Their words." / "Their voice."
  // / "Your memories.") so it reads as a confident three-line stack. Works for
  // every locale's translated title; degrades to however many sentences exist.
  const lines = t('landing.title')
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[.!?…]$/.test(s) ? s : `${s}.`));

  let step = 0;
  const rise = (): React.CSSProperties => ({
    animationDelay: `${step++ * 90 + 40}ms`,
  });

  return (
    <header style={{ textAlign: 'center' }}>
      <div
        className="hero-rise"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          marginBottom: 16,
          ...rise(),
        }}
      >
        <EchoMark size={18} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}
        >
          ECHO
        </span>
      </div>

      <h1 style={{ fontSize: 30, lineHeight: 1.18, fontWeight: 600, marginBottom: 14 }}>
        {lines.map((line, i) => (
          <span key={i} className="hero-rise" style={{ display: 'block', ...rise() }}>
            {line}
          </span>
        ))}
      </h1>

      <p
        className="hero-rise"
        style={{ fontSize: 16, color: 'var(--text-dim)', maxWidth: 340, margin: '0 auto', ...rise() }}
      >
        {t('landing.subtitle')}
      </p>

      <div className="hero-rise" style={{ marginTop: 28, ...rise() }}>
        <HeroMockup />
      </div>

      <div className="hero-rise" style={{ marginTop: 24, ...rise() }}>
        <CtaSection />
      </div>
    </header>
  );
}
