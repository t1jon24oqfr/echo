'use client';

import { useEffect, useRef, useState } from 'react';
import GlassCard from '@/components/GlassCard';
import { useT } from '@/i18n';
import { ApiError, uploadVoiceSample } from '@/lib/api';

/**
 * "Her voice" section of the persona profile. When she has a cloned voice
 * (`hasVoiceSample`) we show a confirmation + a "replace" affordance; otherwise
 * a card inviting the user to upload (file picker, accept audio/*) or record
 * (MediaRecorder, mirrored from chat/Composer.tsx) a ~10s+ sample. On success
 * we POST /personas/:id/voice-sample and call `onUploaded()` so the parent can
 * re-fetch the persona detail. 501 (tts_unavailable) and 502 (clone_failed) map
 * to friendly copy.
 */

// MediaRecorder picks the first mime type the browser actually supports
// (same list as the chat composer so behaviour is consistent).
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

export default function HerVoice({
  personaId,
  hasVoiceSample,
  onUploaded,
}: {
  personaId: string;
  hasVoiceSample: boolean;
  onUploaded: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [micAvailable, setMicAvailable] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string | null>(null);

  // Detect MediaRecorder + getUserMedia support once on mount (graceful fallback).
  useEffect(() => {
    const mime = pickAudioMime();
    const hasGum = !!navigator.mediaDevices?.getUserMedia;
    mimeRef.current = mime;
    setMicAvailable(mime !== null && hasGum);
  }, []);

  const submit = async (audio: Blob | File) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await uploadVoiceSample(personaId, audio);
      onUploaded(); // parent re-fetches detail → hasVoiceSample reflects
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) setError(t('herVoice.errUnavailable'));
      else if (e instanceof ApiError && e.status === 502) setError(t('herVoice.errClone'));
      else setError((e as Error).message || t('herVoice.errClone'));
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f || busy) return;
    void submit(f);
  };

  const startRecording = async () => {
    if (recording || busy || !micAvailable) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = mimeRef.current || undefined;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        setRecording(false);
        if (blob.size > 0) void submit(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setMicAvailable(false);
      setError(t('composer.micUnavailable'));
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const cancelRecording = () => {
    const rec = recorderRef.current;
    if (rec) rec.onstop = null; // drop the result
    if (rec && rec.state !== 'inactive') rec.stop();
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setRecording(false);
  };

  const hiddenFileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="audio/*"
      onChange={onPickFile}
      style={{ display: 'none' }}
    />
  );

  // ---- Voice is on: confirmation + replace affordance ----
  if (hasVoiceSample) {
    return (
      <GlassCard style={{ padding: '14px 16px' }}>
        {hiddenFileInput}
        <p style={{ fontSize: 15, fontWeight: 600 }}>{t('herVoice.onTitle')}</p>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{t('herVoice.onNote')}</p>
        {error ? (
          <p style={{ fontSize: 13, color: '#ff453a', marginTop: 8 }}>{error}</p>
        ) : null}
        {recording ? (
          <RecordingRow
            label={t('composer.recording')}
            onCancel={cancelRecording}
            onStop={stopRecording}
            cancelAria={t('composer.cancelRecAria')}
            sendAria={t('composer.sendVoiceAria')}
          />
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn-glass"
              style={{ flex: 1 }}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? t('common.saving') : t('herVoice.replace')}
            </button>
            {micAvailable ? (
              <button
                type="button"
                className="btn-glass"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => void startRecording()}
              >
                {t('herVoice.record')}
              </button>
            ) : null}
          </div>
        )}
      </GlassCard>
    );
  }

  // ---- Voice is off: invite an upload / recording ----
  return (
    <GlassCard style={{ padding: '14px 16px' }}>
      {hiddenFileInput}
      <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {t('herVoice.offBody')}
      </p>
      {error ? <p style={{ fontSize: 13, color: '#ff453a', marginTop: 8 }}>{error}</p> : null}
      {recording ? (
        <RecordingRow
          label={t('composer.recording')}
          onCancel={cancelRecording}
          onStop={stopRecording}
          cancelAria={t('composer.cancelRecAria')}
          sendAria={t('composer.sendVoiceAria')}
        />
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="btn-solid"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? t('common.saving') : t('herVoice.upload')}
          </button>
          {micAvailable ? (
            <button
              type="button"
              className="btn-glass"
              style={{ flex: 1 }}
              disabled={busy}
              onClick={() => void startRecording()}
            >
              {t('herVoice.record')}
            </button>
          ) : null}
        </div>
      )}
    </GlassCard>
  );
}

/** Inline recording controls (cancel / live dot / stop+send), glass styling. */
function RecordingRow({
  label,
  onCancel,
  onStop,
  cancelAria,
  sendAria,
}: {
  label: string;
  onCancel: () => void;
  onStop: () => void;
  cancelAria: string;
  sendAria: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
      <button
        type="button"
        onClick={onCancel}
        aria-label={cancelAria}
        className="glass-strong"
        style={iconBtn('var(--text-dim)')}
      >
        ✕
      </button>
      <div
        className="glass-strong"
        style={{
          flex: 1,
          borderRadius: 24,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 16px',
          color: 'var(--text)',
          fontSize: 14,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: '#ff3b30',
            animation: 'vl-rec 1s infinite ease-in-out',
          }}
        />
        <style>{'@keyframes vl-rec{0%,100%{opacity:1}50%{opacity:0.3}}'}</style>
        {label}
      </div>
      <button
        type="button"
        onClick={onStop}
        aria-label={sendAria}
        style={{ ...iconBtn('#fff'), background: 'var(--accent)', border: 'none' }}
      >
        ✓
      </button>
    </div>
  );
}

function iconBtn(color: string): React.CSSProperties {
  return {
    width: 44,
    height: 44,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color,
    fontSize: 18,
  };
}
