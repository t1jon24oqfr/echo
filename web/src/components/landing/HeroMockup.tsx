'use client';

/**
 * HeroMockup — the signature animated chat demo for the landing page.
 *
 * Shows the product working: an abstract initial-mark avatar comes "online",
 * types two remembered lines, the user replies (blue, sent→seen), then a voice
 * note resolves. It PLAYS ONCE and RESTS on the finished thread (a quiet
 * "Replay" button re-runs it) — never auto-loops, so a memorial conversation
 * never feels relentless. Built only from the app's own primitives + CSS/SVG,
 * so it inherits the locked light/iOS look and the no-faces rule structurally
 * (the avatar is photo-less → a neutral glass glyph).
 *
 * Reduced-motion: renders the complete static end-state (the full, legible
 * thread) — the product is still demonstrated, just not animated.
 */

import { useEffect, useRef, useState } from 'react';
import Bubble, { type BubbleStatus } from '@/components/Bubble';
import VoiceBubble from '@/components/chat/VoiceBubble';
import AIBadge from '@/components/AIBadge';
import { useT } from '@/i18n';

type Phase = 'idle' | 't1' | 'm1' | 'm2' | 'reply' | 't2' | 'voice' | 'done';

// Cumulative timeline (ms). Each phase begins at its start offset.
const T = {
  online: 500,
  t1: 700, // typing dots before msg1
  m1: 1800, // msg1 starts typing out
  m2: 3100, // msg2 starts typing out
  reply: 4500, // outgoing reply appears (status cycles)
  t2: 6200, // typing dots before voice
  voice: 7300, // voice note resolves
  done: 8600,
};
const CHAR_MS = 26;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export default function HeroMockup() {
  const t = useT();
  const reduced = usePrefersReducedMotion();

  const msg1 = t('landing.heroMsg1');
  const msg2 = t('landing.heroMsg2');
  const reply = t('landing.heroReply');

  const [online, setOnline] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [n1, setN1] = useState(0);
  const [n2, setN2] = useState(0);
  const [replyStatus, setReplyStatus] = useState<BubbleStatus>('sending');
  const [ripple, setRipple] = useState(false);
  const [runId, setRunId] = useState(0);

  const threadRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest beat in view as bubbles arrive.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [phase, n1, n2]);

  // Reduced motion (resolves after first paint): jump straight to the complete
  // static thread so the demo is still fully legible, just not animated.
  useEffect(() => {
    if (!reduced) return;
    setOnline(true);
    setPhase('done');
    setN1(msg1.length);
    setN2(msg2.length);
    setReplyStatus('seen');
  }, [reduced, msg1.length, msg2.length]);

  useEffect(() => {
    if (reduced) return; // static end-state handled above

    // The hero sits above the fold, so the demo starts on mount. A setInterval
    // clock (not rAF) drives the scripted beats: ~25fps and smooth when the tab
    // is visible, and — unlike rAF — it keeps a deterministic timeline even
    // when the tab is backgrounded, so the thread always resolves rather than
    // freezing half-played.
    const t0 = performance.now();
    let onlineFired = false;

    const id = window.setInterval(() => {
      const e = performance.now() - t0;

      if (e >= T.online && !onlineFired) {
        onlineFired = true;
        setOnline(true);
        setRipple(true);
        window.setTimeout(() => setRipple(false), 1400);
      }
      if (e >= T.t1 && e < T.m1) setPhase((p) => (p === 'idle' ? 't1' : p));
      if (e >= T.m1) {
        setPhase((p) => (p === 't1' || p === 'idle' ? 'm1' : p));
        setN1(Math.min(msg1.length, Math.floor((e - T.m1) / CHAR_MS)));
      }
      if (e >= T.m2) {
        setN1(msg1.length);
        setPhase((p) => (p === 'm1' ? 'm2' : p));
        setN2(Math.min(msg2.length, Math.floor((e - T.m2) / CHAR_MS)));
      }
      if (e >= T.reply) {
        setN2(msg2.length);
        setPhase((p) => (p === 'm2' ? 'reply' : p));
        const dt = e - T.reply;
        setReplyStatus(dt < 450 ? 'sending' : dt < 950 ? 'sent' : 'seen');
      }
      if (e >= T.t2) setPhase((p) => (p === 'reply' ? 't2' : p));
      if (e >= T.voice) setPhase((p) => (p === 't2' ? 'voice' : p));
      if (e >= T.done) {
        setPhase('done');
        window.clearInterval(id);
      }
    }, 40);

    return () => window.clearInterval(id);
    // runId re-arms the run on Replay; reduced gates the whole effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, runId]);

  const replay = () => {
    if (reduced) return;
    setOnline(false);
    setPhase('idle');
    setN1(0);
    setN2(0);
    setReplyStatus('sending');
    setRunId((r) => r + 1);
  };

  const showTyping1 = phase === 't1';
  const showM1 = ['m1', 'm2', 'reply', 't2', 'voice', 'done'].includes(phase);
  const showM2 = ['m2', 'reply', 't2', 'voice', 'done'].includes(phase);
  const showReply = ['reply', 't2', 'voice', 'done'].includes(phase);
  const showTyping2 = phase === 't2';
  const showVoice = ['voice', 'done'].includes(phase);
  const done = phase === 'done';

  const caret = (
    <span
      aria-hidden
      className="echo-caret"
      style={{
        display: 'inline-block',
        width: 2,
        height: '1em',
        marginLeft: 1,
        verticalAlign: '-0.12em',
        background: 'var(--accent)',
      }}
    />
  );

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
      {/* Whisper-quiet background echo rings (decorative; frozen under reduced-motion via CSS). */}
      <svg
        aria-hidden
        viewBox="0 0 400 400"
        style={{
          position: 'absolute',
          width: 400,
          height: 400,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          zIndex: -1,
          pointerEvents: 'none',
        }}
      >
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx="200"
            cy="200"
            r={70 + i * 34}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            className="echo-bg-ring"
            style={{ opacity: 0.05, animationDelay: `${i * 2.3}s` }}
          />
        ))}
      </svg>

      <div
        className="card"
        role="group"
        aria-label={t('landing.demoAria')}
        style={{ width: '100%', maxWidth: 360, overflow: 'hidden', padding: 0 }}
      >
        {/* Header strip — honesty rides inside the demo (AIBadge in frame one). */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 12,
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }} aria-hidden>
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
              {t('landing.heroName').trim().charAt(0).toUpperCase()}
            </div>
            {online ? (
              <span
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: 11,
                  height: 11,
                  borderRadius: '50%',
                  background: '#34C759',
                  border: '2px solid #fff',
                }}
              />
            ) : null}
            {ripple ? (
              <span
                className="echo-avatar-ripple"
                style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--accent)' }}
              />
            ) : null}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{t('landing.heroName')}</div>
            <div style={{ fontSize: 12, color: 'rgba(60,60,67,0.75)' }}>
              {online ? t('presence.online') : t('landing.heroPresenceWas')}
            </div>
          </div>
          <AIBadge />
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          aria-hidden
          style={{
            height: 292,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: 6,
            padding: '12px 0',
            // Soft top fade so the earliest bubble dissolves (rather than hard-
            // clipping against the header) on longer locales.
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 22px)',
            maskImage: 'linear-gradient(to bottom, transparent 0, #000 22px)',
          }}
        >
          {showTyping1 ? <DemoTyping /> : null}

          {showM1 ? (
            <Bubble from="persona" tail={!showM2}>
              {n1 < msg1.length ? (
                <span>
                  {msg1.slice(0, n1)}
                  {caret}
                </span>
              ) : (
                msg1
              )}
            </Bubble>
          ) : null}

          {showM2 ? (
            <Bubble from="persona" tail>
              {n2 < msg2.length ? (
                <span>
                  {msg2.slice(0, n2)}
                  {caret}
                </span>
              ) : (
                msg2
              )}
            </Bubble>
          ) : null}

          {showReply ? (
            <Bubble from="user" status={replyStatus}>
              {reply}
            </Bubble>
          ) : null}

          {showTyping2 ? <DemoTyping /> : null}

          {showVoice ? <VoiceBubble from="persona" transcript={t('landing.heroVoiceCaption')} audioSrc={null} /> : null}
        </div>

        {/* Rest state: a quiet, user-initiated Replay (never auto-loops). */}
        {done && !reduced ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 12px' }}>
            <button
              type="button"
              onClick={replay}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 36,
                padding: '6px 12px',
                fontSize: 13,
                color: 'var(--text-dim)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t('landing.replay')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Typing dots on a solid-white bubble surface (matches the persona Bubble fill,
 *  avoiding the glass→white seam of the in-app TypingIndicator). */
function DemoTyping() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '0 12px' }}>
      <div
        className="bubble-in"
        style={{
          background: 'var(--card)',
          boxShadow: 'var(--card-shadow)',
          borderRadius: '18px 18px 18px 6px',
          padding: '12px 16px',
          display: 'inline-flex',
          gap: 5,
          alignItems: 'center',
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="echo-typing-dot"
            style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text)', animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  );
}
