'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import AIBadge from '@/components/AIBadge';
import Bubble from '@/components/Bubble';
import GlassCard from '@/components/GlassCard';
import { chat, readSse } from '@/lib/api';
import type { Mode } from '@/components/create/StepWho';
import { createLinePacer, createLineSplitter } from '@/components/chat/pacing';
import { useT } from '@/i18n';

/**
 * 'meet' state: the persona greets *first* (as if she just saw you), then the
 * user gets a real composer. We send a hidden opener to the backend so her
 * greeting is genuinely in her style — but we never render a user "hi" bubble,
 * so it reads as her writing first. The streamed reply is revealed with the
 * humanized pacing from pacing.ts.
 *
 * "Continue" goes to the REAL chat (the persona is already saved); the paywall
 * is only a soft, secondary surface here.
 */
export default function Meet({
  personaId,
  name,
  mode,
  photoUrl,
}: {
  personaId: string;
  name: string;
  mode: Mode;
  photoUrl: string | null;
}) {
  const t = useT();
  const router = useRouter();
  // Hidden opener that prompts her greeting — never shown to the user, so it is
  // intentionally a plain literal (not i18n; the persona answers in her own
  // language regardless of UI locale).
  const opener = 'hi)';
  const [bubbles, setBubbles] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const [streaming, setStreaming] = useState(true);
  const [error, setError] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setError(false);
    setStreaming(true);
    setBubbles([]);
    setTyping(false);

    const pacer = createLinePacer({
      onTypingStart: () => setTyping(true),
      onTypingStop: () => setTyping(false),
      onBubble: (line) => setBubbles((prev) => [...prev, line]),
    });
    const splitter = createLineSplitter((line) => {
      // Drop the bare "or" connector lines the model emits between alternatives
      // (matches the chat page), so the greeting doesn't show orphan bubbles.
      if (/^\s*(або|чи|or)\s*$/i.test(line)) return;
      pacer.push(line);
    });

    try {
      const res = await chat(personaId, opener);
      await readSse(res, (token) => splitter.push(token));
      splitter.flush();
      pacer.finish();
      await pacer.done;
    } catch {
      // Reveal whatever arrived, then show the error card.
      splitter.flush();
      pacer.flush();
      await pacer.done;
      setError(true);
    } finally {
      setTyping(false);
      setStreaming(false);
    }
  }

  const goChat = () => router.push(`/chat?id=${encodeURIComponent(personaId)}`);
  // Sending a starter from here just opens the real chat with that text queued
  // as the first thing she answers — keeps a single source of truth for chat.
  const sendStarter = (text: string) =>
    router.push(`/chat?id=${encodeURIComponent(personaId)}&first=${encodeURIComponent(text)}`);

  // Mode-aware starter prompts (hardcoded English — see report for i18n keys).
  const starters =
    mode === 'memorial'
      ? ['I miss you', 'Remember when…', 'Tell me about yourself']
      : ['Hey, how are you?', "It's been a while", 'I was thinking about you'];
  const placeholder = mode === 'memorial' ? 'Say something to them…' : 'Write to them…';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: '16px 0 20px',
        }}
      >
        <div
          className="glass-strong"
          style={{
            width: 84,
            height: 84,
            borderRadius: '50%',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 30, fontWeight: 600 }}>{(name || '·').slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div style={{ fontSize: 19, fontWeight: 600 }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Online dot — she just arrived. */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 13,
              color: 'var(--text-dim)',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C759' }} />
            {t('presence.online')}
          </span>
          <AIBadge />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bubbles.map((b, i) => (
          <Bubble key={i} from="persona">
            {b}
          </Bubble>
        ))}
        {typing && (
          <Bubble from="persona">
            <TypingDots />
          </Bubble>
        )}
      </div>

      {error && (
        <GlassCard style={{ margin: '16px 12px 0' }}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>{t('common.error')}</div>
          <button className="btn-glass" style={{ width: '100%' }} onClick={() => void run()}>
            {t('common.retry')}
          </button>
        </GlassCard>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        {!streaming && !error && (
          <>
            {/* Starter chips — tapping opens the real chat with that opener. */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              {starters.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="glass-strong"
                  onClick={() => sendStarter(s)}
                  style={{
                    border: 'none',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 14,
                    color: 'var(--text)',
                    padding: '9px 14px',
                    borderRadius: 999,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Tappable composer-shaped affordance → opens the real chat. */}
            <button
              type="button"
              onClick={goChat}
              className="glass-strong"
              aria-label={placeholder}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                minHeight: 48,
                borderRadius: 24,
                border: 'none',
                cursor: 'pointer',
                font: 'inherit',
                color: 'var(--text-dim)',
                fontSize: 15,
                padding: '0 18px',
                textAlign: 'left',
                marginBottom: 12,
              }}
            >
              {placeholder}
            </button>

            <button type="button" className="btn-solid" style={{ width: '100%' }} onClick={goChat}>
              {t('meet.continue')}
            </button>

            <button
              type="button"
              onClick={() => router.push('/paywall')}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 12,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 13,
                color: 'var(--text-dim)',
                textAlign: 'center',
              }}
            >
              {/* TODO i18n: meet.seePremium */}
              See what Premium adds
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', height: 18 }}>
      <style>{`@keyframes vid-dot { 0%,80%,100% { opacity: 0.3; } 40% { opacity: 1; } }`}</style>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: 'var(--text)',
            animation: `vid-dot 1.2s ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </span>
  );
}
