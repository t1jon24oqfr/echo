'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassCard from '@/components/GlassCard';
import AIBadge from '@/components/AIBadge';
import CallAvatar from '@/components/call/CallAvatar';
import CallControls, { type MicState } from '@/components/call/CallControls';
import { useT } from '@/i18n';
import {
  audioUrl,
  callChat,
  getPersona,
  isVoiceRequired,
  personaAvatar,
  readSseEvents,
} from '@/lib/api';

/** Walkie-talkie call states (turn-taking, not full-duplex). */
type CallState = 'connecting' | 'gate' | 'listening' | 'thinking' | 'speaking' | 'error';

// MediaRecorder picks the first mime type the browser actually supports
// (mirrors the approach in src/components/chat/Composer.tsx).
function pickAudioMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return ''; // recorder exists but no preferred type — let the browser default
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CallPage() {
  return (
    <Suspense fallback={null}>
      <CallScreen />
    </Suspense>
  );
}

function CallScreen() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('id');

  const [state, setState] = useState<CallState>('connecting');
  const [name, setName] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [ambient, setAmbient] = useState<string[] | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [muted, setMuted] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  // `recording` is a sub-mode of 'listening' (mic open + armed). It drives the
  // armed-mic look + the avatar's listening ring while the call state stays
  // 'listening'; recording is not a separate CallState value.
  const [recording, setRecording] = useState(false);
  const [myLine, setMyLine] = useState<string | null>(null); // your transcribed turn (best-effort)
  const [herLine, setHerLine] = useState<string | null>(null); // her streamed reply text
  const [elapsed, setElapsed] = useState(0); // call timer (seconds), starts when connected

  // Recording plumbing (same shape as Composer).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    mutedRef.current = muted;
    const a = audioElRef.current;
    if (a) a.muted = muted;
  }, [muted]);

  // --- Resolve persona + gate on voice sample ---
  useEffect(() => {
    aliveRef.current = true;
    if (!id) {
      setState('error');
      setErrorMsg(t('call.noPersona'));
      return;
    }
    mimeRef.current = pickAudioMime();
    (async () => {
      try {
        const detail = await getPersona(id);
        if (!aliveRef.current) return;
        setName(detail.name || null);
        setAvatar(personaAvatar(detail));
        if (Array.isArray(detail.ambient) && detail.ambient.length >= 3) setAmbient(detail.ambient);
        if (!detail.hasVoiceSample) {
          setState('gate');
          return;
        }
        // Brief "connecting" beat, then open the mic turn.
        setTimeout(() => {
          if (aliveRef.current) setState('listening');
        }, 700);
      } catch {
        if (!aliveRef.current) return;
        setState('error');
        setErrorMsg(t('call.connectError'));
      }
    })();
    return () => {
      aliveRef.current = false;
    };
  }, [id, t]);

  // --- Call timer: runs once connected (any state past connecting/gate/error). --
  useEffect(() => {
    if (state === 'connecting' || state === 'gate' || state === 'error') return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  // --- Cleanup on unmount: stop tracks + audio. ---
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => {
    return () => {
      aliveRef.current = false;
      try {
        recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      stopStream();
      const a = audioElRef.current;
      if (a) {
        a.pause();
        a.src = '';
      }
    };
  }, [stopStream]);

  // Play her cloned-voice reply, animate "speaking", then re-arm "listening".
  const playReply = useCallback((src: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      const a = audioElRef.current;
      if (!a) {
        if (aliveRef.current) setState('listening');
        resolve();
        return;
      }
      const done = () => {
        a.removeEventListener('ended', done);
        a.removeEventListener('error', done);
        if (aliveRef.current) setState('listening'); // auto re-arm for a natural back-and-forth
        resolve();
      };
      a.addEventListener('ended', done);
      a.addEventListener('error', done);
      a.src = src;
      a.muted = mutedRef.current;
      setState('speaking');
      void a.play().catch(() => done());
    });
  }, []);

  // --- Send a recorded turn: POST call chat, read SSE, play her voice reply. ---
  const sendTurn = useCallback(
    async (blob: Blob) => {
      if (!id) return;
      setState('thinking');
      setMyLine(null);
      setHerLine(null);
      let voiceFile: string | null = null;
      let full = '';
      let gotCaption = false;
      try {
        const res = await callChat(id, { audioBlob: blob });
        await readSseEvents(res, (ev) => {
          if (ev.type === 'token') {
            full += ev.token;
            // Strip stage-direction markers for the live transcript.
            const clean = full.replace(/\*/g, '').replace(/[ \t]{2,}/g, ' ').trim();
            setHerLine(clean || null);
          } else if (ev.type === 'caption') {
            // Backend may surface the user's transcription as a caption event.
            if (!gotCaption) {
              gotCaption = true;
              setMyLine(ev.caption?.trim() || null);
            }
          } else if (ev.type === 'voice') {
            if (ev.voice !== 'pending' && ev.voice !== 'failed') voiceFile = ev.voice;
          }
        });
        if (!aliveRef.current) return;
        if (voiceFile) {
          await playReply(audioUrl(id, voiceFile));
        } else {
          // No audio came back (e.g. synthesis failed) — go back to listening.
          if (aliveRef.current) setState('listening');
        }
      } catch (e) {
        if (!aliveRef.current) return;
        if (isVoiceRequired(e)) {
          setState('gate');
          return;
        }
        setErrorMsg((e as Error).message || t('call.turnError'));
        setState('error');
      }
    },
    [id, t, playReply],
  );

  // --- Recording controls (tap-to-talk). ---
  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(t('call.micDenied'));
      setState('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = stream;
      const mime = mimeRef.current || undefined;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mime || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type });
        stopStream();
        if (audioBlob.size > 0 && aliveRef.current) void sendTurn(audioBlob);
        else if (aliveRef.current) setState('listening');
      };
      recorderRef.current = rec;
      rec.start();
      // Recording is a sub-mode of 'listening' (mic open). The `recording` flag
      // drives the armed mic + speaking-ring; the call state stays 'listening'.
      setState('listening');
      setRecording(true);
    } catch {
      setErrorMsg(t('call.micDenied'));
      setState('error');
    }
  }, [sendTurn, stopStream, t]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    setRecording(false);
    if (rec && rec.state !== 'inactive') rec.stop(); // onstop → sendTurn
  }, []);

  const onMicTap = useCallback(() => {
    if (state === 'thinking' || state === 'speaking') return;
    if (recording) stopRecording();
    else void startRecording();
  }, [state, recording, startRecording, stopRecording]);

  const onEnd = useCallback(() => {
    aliveRef.current = false;
    try {
      recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    stopStream();
    const a = audioElRef.current;
    if (a) a.pause();
    if (id) router.push(`/chat?id=${encodeURIComponent(id)}`);
    else router.back();
  }, [id, router, stopStream]);

  // --- Derived UI ---
  const micState: MicState =
    state === 'thinking' || state === 'speaking' ? 'busy' : recording ? 'recording' : 'idle';

  const statusText =
    state === 'connecting'
      ? t('call.connecting')
      : state === 'thinking'
        ? t('call.thinking')
        : state === 'speaking'
          ? t('call.speaking')
          : recording
            ? t('call.listening')
            : t('call.tapToTalk');

  // ----- GATE: persona has no cloned voice -----
  if (state === 'gate') {
    return (
      <Shell ambient={ambient}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
          <GlassCard>
            <div style={{ textAlign: 'center' }}>
              <CallAvatar photo={avatar} name={name} size={96} />
              <p style={{ fontSize: 17, fontWeight: 600, marginTop: 16 }}>
                {t('call.addVoiceTitle', { name: name ?? t('call.her') })}
              </p>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
                {t('call.addVoiceBody')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
                <Link
                  href={id ? `/persona?id=${encodeURIComponent(id)}` : '/persona'}
                  className="btn-solid"
                  style={{ width: '100%' }}
                >
                  {t('call.addVoiceCta')}
                </Link>
                <button type="button" className="btn-glass" style={{ width: '100%' }} onClick={onEnd}>
                  {t('call.end')}
                </button>
              </div>
            </div>
          </GlassCard>
        </div>
      </Shell>
    );
  }

  // ----- ERROR -----
  if (state === 'error') {
    return (
      <Shell ambient={ambient}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
          <GlassCard>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15, marginBottom: 14 }}>{errorMsg ?? t('call.turnError')}</p>
              <button type="button" className="btn-solid" style={{ width: '100%' }} onClick={onEnd}>
                {t('call.end')}
              </button>
            </div>
          </GlassCard>
        </div>
      </Shell>
    );
  }

  // ----- ACTIVE CALL -----
  return (
    <Shell ambient={ambient}>
      {/* Top: AI badge + transcript toggle. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px 0',
        }}
      >
        <AIBadge />
        <button
          type="button"
          onClick={() => setShowTranscript((v) => !v)}
          aria-pressed={showTranscript}
          className="glass"
          style={{
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 999,
            color: 'var(--text-dim)',
            minHeight: 32,
          }}
        >
          {showTranscript ? t('call.hideTranscript') : t('call.showTranscript')}
        </button>
      </div>

      {/* Center: avatar + name + status + timer. */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          padding: '0 24px',
          textAlign: 'center',
        }}
      >
        <CallAvatar
          photo={avatar}
          name={name}
          speaking={state === 'speaking'}
          listening={recording}
        />
        <div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{name ?? t('chat.conversation')}</div>
          <div
            style={{
              marginTop: 6,
              fontSize: 15,
              color: state === 'speaking' || recording ? 'var(--accent)' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              justifyContent: 'center',
            }}
          >
            <style>{'@keyframes vl-call-blink{0%,100%{opacity:1}50%{opacity:0.4}}@media (prefers-reduced-motion: reduce){.vl-call-dots{animation:none!important}}'}</style>
            {statusText}
            {state === 'thinking' ? (
              <span aria-hidden className="vl-call-dots" style={{ animation: 'vl-call-blink 1.1s infinite ease-in-out' }}>
                …
              </span>
            ) : null}
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
            {mmss(elapsed)}
          </div>
        </div>

        {/* Subtle live transcript. */}
        {showTranscript && (myLine || herLine) ? (
          <div style={{ maxWidth: 360, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myLine ? (
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {t('call.youSaid')}: {myLine}
              </p>
            ) : null}
            {herLine ? <p style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.45 }}>{herLine}</p> : null}
          </div>
        ) : null}
      </div>

      {/* Bottom controls. */}
      <div style={{ padding: '0 0 calc(28px + env(safe-area-inset-bottom, 0px))' }}>
        <CallControls
          micState={micState}
          muted={muted}
          onMicTap={onMicTap}
          onToggleMute={() => setMuted((v) => !v)}
          onEnd={onEnd}
        />
      </div>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioElRef} preload="none" playsInline />
    </Shell>
  );
}

/** Full-screen call shell: ambient background + a column that fills the viewport. */
function Shell({ children, ambient }: { children: React.ReactNode; ambient?: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <AmbientBg colors={ambient} />
      {children}
    </div>
  );
}
