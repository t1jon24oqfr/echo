import type { Metadata } from 'next';
import AmbientBg from '@/components/AmbientBg';
import Hero from '@/components/landing/Hero';
import Steps from '@/components/landing/Steps';
import Honesty from '@/components/landing/Honesty';
import CtaSection from '@/components/landing/CtaSection';
import ReturningUser from '@/components/landing/ReturningUser';
import Footer from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Echo — their words, your memories',
  description: 'Rebuild a person from your chats and photos — and talk once more.',
};

export default function LandingPage() {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          padding: '0 20px',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
        }}
      >
        <Hero />

        <Steps />
        <Honesty />
        <CtaSection />
        <ReturningUser />
      </div>
      <div style={{ padding: '8px 20px 0' }}>
        <Footer />
      </div>
    </main>
  );
}
