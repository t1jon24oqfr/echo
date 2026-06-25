'use client';

import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';

/**
 * "What it feels like" — the two ideas the How-it-works steps don't already
 * cover: voice and presence. Each card carries a small, honest illustration
 * (a resting waveform — no audio plays; a presence row — a neutral glyph, no
 * face). The waveform bars grow-in once when the section scroll-reveals
 * (`.echo-bar`, frozen under reduced-motion).
 */

// Fixed bar heights (%) — a calm, speech-like silhouette, NOT a live meter.
const WAVE = [26, 44, 70, 52, 88, 64, 100, 58, 78, 40, 62, 34, 50, 28];

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function Waveform() {
  return (
    <div
      aria-hidden
      style={{ display: 'flex', alignItems: 'center', gap: 10, height: 56 }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--accent)',
          boxShadow: '0 4px 14px rgba(0,122,255,0.25)',
        }}
      >
        <PlayGlyph />
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 40, flex: 1 }}>
        {WAVE.map((h, i) => (
          <span
            key={i}
            className="echo-bar"
            style={{
              flex: 1,
              height: `${h}%`,
              minWidth: 3,
              borderRadius: 999,
              background: 'var(--accent)',
              opacity: 0.55 + (h / 100) * 0.45,
              animationDelay: `${i * 35}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PresenceRow({ name, online }: { name: string; online: string }) {
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 10, height: 56 }}>
      <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }}>
        <div
          className="glass"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-dim)',
          }}
        >
          {name.trim().charAt(0).toUpperCase()}
        </div>
        <span
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: '#34C759',
            border: '2px solid var(--bg)',
          }}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{name}</div>
        <div style={{ fontSize: 12, color: '#34C759' }}>{online}</div>
      </div>
    </div>
  );
}

function FeatureCard({
  art,
  title,
  text,
}: {
  art: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <GlassCard style={{ padding: 18 }}>
      <div style={{ marginBottom: 14 }}>{art}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}>{text}</p>
    </GlassCard>
  );
}

export default function Features() {
  const t = useT();
  return (
    <>
      <h2
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-dim)',
          letterSpacing: '0.04em',
        }}
      >
        {t('landing.featuresHeader')}
      </h2>
      <FeatureCard art={<Waveform />} title={t('landing.featVoiceTitle')} text={t('landing.featVoiceText')} />
      <FeatureCard
        art={<PresenceRow name={t('landing.heroName')} online={t('presence.online')} />}
        title={t('landing.featPresenceTitle')}
        text={t('landing.featPresenceText')}
      />
    </>
  );
}
