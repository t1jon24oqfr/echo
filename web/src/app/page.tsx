import type { Metadata } from 'next';
import AmbientBg from '@/components/AmbientBg';
import Hero from '@/components/landing/Hero';
import Steps from '@/components/landing/Steps';
import Features from '@/components/landing/Features';
import Honesty from '@/components/landing/Honesty';
import ClosingCta from '@/components/landing/ClosingCta';
import ReturningUser from '@/components/landing/ReturningUser';
import Footer from '@/components/landing/Footer';
import Reveal from '@/components/landing/Reveal';

export const metadata: Metadata = {
  title: 'Echo — their words, your memories',
  description: 'Rebuild a person from your chats and photos — and talk once more.',
};

const sectionGroup: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

export default function LandingPage() {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg />
      {/* Light-from-above: a hopeful overhead glow (memorial-as-warm-light, not
          a candle), painted over the ambient blobs and behind all content. */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(430px, 100vw)',
          height: '70vh',
          zIndex: -1,
          pointerEvents: 'none',
          background:
            'radial-gradient(120% 55% at 50% 0%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0) 60%)',
        }}
      />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 56,
          padding: '0 20px',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
        }}
      >
        <Hero />

        <Reveal style={sectionGroup}>
          <Steps />
        </Reveal>

        <Reveal style={sectionGroup}>
          <Features />
        </Reveal>

        <Reveal>
          <Honesty />
        </Reveal>

        <Reveal>
          <ClosingCta />
        </Reveal>

        <ReturningUser />
      </div>

      <div style={{ padding: '8px 20px 0' }}>
        <Footer />
      </div>
    </main>
  );
}
