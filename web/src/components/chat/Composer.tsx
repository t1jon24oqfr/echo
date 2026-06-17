'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';

/**
 * Glass pill input + round send button. Controlled text, plus optional
 * multimodal attach (photo) and voice recording (MediaRecorder).
 * Enter sends text (Shift+Enter — newline).
 *
 * - `onSend()` sends the current text (existing behavior).
 * - `onSendImage(file, caption)` sends an attached photo with the typed text as caption.
 * - `onSendVoice(blob)` sends a recorded voice clip.
 * Image/voice handlers are optional; when omitted those controls are hidden,
 * so this stays drop-in compatible with any existing caller.
 */

// MediaRecorder picks the first mime type the browser actually supports.
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

export default function Composer({
  value,
  onChange,
  onSend,
  onSendImage,
  onSendVoice,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendImage?: (file: File, caption: string) => void;
  onSendVoice?: (blob: Blob) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
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
    setMicAvailable(mime !== null && hasGum && !!onSendVoice);
  }, [onSendVoice]);

  const canSendText = !disabled && value.trim().length > 0;
  const canSend = canSendText;

  const doSend = () => {
    if (disabled || recording) return;
    if (canSendText) onSend();
  };

  // Telegram-style: picking a photo sends it immediately — no preview chip,
  // no caption step. The image bubble (with its own loading state) appears at once.
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f || disabled) return;
    onSendImage?.(f, '');
  };

  const startRecording = async () => {
    if (recording || disabled || !onSendVoice) return;
    setRecError(null);
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
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
        if (blob.size > 0) onSendVoice(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      // Permission denied or no device — hide mic going forward, show a note.
      setMicAvailable(false);
      setRecError(t('composer.micUnavailable'));
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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  };

  // ---- Recording UI replaces the input row while active ----
  if (recording) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
        <button
          type="button"
          onClick={cancelRecording}
          aria-label={t('composer.cancelRecAria')}
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
            minHeight: 48,
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
          {t('composer.recording')}
        </div>
        <button
          type="button"
          onClick={stopRecording}
          aria-label={t('composer.sendVoiceAria')}
          style={{ ...iconBtn('#fff'), background: 'var(--accent)', border: 'none' }}
        >
          ✓
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {recError ? (
        <span style={{ fontSize: 12, color: 'var(--text-dim)', paddingLeft: 4 }}>{recError}</span>
      ) : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        {onSendImage ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPickFile}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              aria-label={t('composer.attachAria')}
              className="glass-strong"
              style={{ ...iconBtn('var(--text-dim)'), opacity: disabled ? 0.5 : 1 }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </>
        ) : null}

        <div
          className="glass-strong"
          style={{ flex: 1, borderRadius: 24, display: 'flex', alignItems: 'center', minHeight: 48 }}
        >
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) doSend();
              }
            }}
            placeholder={t('composer.placeholder')}
            rows={1}
            disabled={disabled}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color: 'var(--text)',
              fontSize: 15,
              lineHeight: 1.4,
              padding: '13px 16px',
              maxHeight: 110,
            }}
          />
        </div>

        {micAvailable && !canSend ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            aria-label={t('composer.recordAria')}
            className="glass-strong"
            style={{ ...iconBtn('var(--text-dim)'), opacity: disabled ? 0.5 : 1 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M5 11C5 14.87 8.13 18 12 18C15.87 18 19 14.87 19 11M12 18V21"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={doSend}
            disabled={!canSend}
            aria-label={t('composer.sendAria')}
            style={{
              ...iconBtn(canSend ? '#fff' : 'var(--text-dim)'),
              background: canSend ? 'var(--accent)' : 'var(--glass)',
              border: canSend ? 'none' : '1px solid var(--glass-border)',
              transition: 'background 0.15s ease',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 19V5M12 5L6 11M12 5L18 11"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function iconBtn(color: string): React.CSSProperties {
  return {
    width: 48,
    height: 48,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color,
    fontSize: 18,
  };
}
