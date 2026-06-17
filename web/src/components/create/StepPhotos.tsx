'use client';

import { useEffect, useRef, useState } from 'react';
import GlassCard from '@/components/GlassCard';
import { extractAmbientColors } from '@/components/create/colors';
import { updatePersona, uploadPhotos } from '@/lib/api';
import { useT } from '@/i18n';

export default function StepPhotos({
  personaId,
  onNext,
}: {
  personaId: string;
  /** files = saved server names (empty when skipped), colors = ambient palette. */
  onNext: (d: { files: string[]; colors: string[] }) => void;
}) {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function pick(list: FileList | null) {
    if (!list) return;
    const imgs = [...list].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) setFiles((prev) => [...prev, ...imgs].slice(0, 12));
  }

  async function upload() {
    if (!files.length || busy) return;
    setBusy(true);
    setError(false);
    try {
      const { files: saved } = await uploadPhotos(personaId, files);
      const colors = await extractAmbientColors(files[0]);
      if (colors.length) {
        await updatePersona(personaId, { ambient: colors }).catch(() => undefined);
      }
      onNext({ files: saved, colors });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '12px 0 4px' }}>{t('photos.title')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 18 }}>
        {t('photos.subtitle')}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {previews.map((src, i) => (
          <div key={src} style={{ position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={t('photos.alt', { n: i + 1 })}
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 14 }}
            />
            <button
              type="button"
              aria-label={t('photos.removeAria')}
              onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              className="glass-strong"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 26,
                height: 26,
                borderRadius: 13,
                fontSize: 14,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="glass"
          style={{
            aspectRatio: '1',
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            color: 'var(--text-dim)',
            fontSize: 13,
          }}
        >
          <span style={{ fontSize: 26, lineHeight: 1 }}>+</span>
          {t('photos.add')}
        </button>
      </div>

      {error && (
        <GlassCard style={{ marginTop: 14 }}>
          <span style={{ fontSize: 14 }}>{t('photos.uploadError')}</span>
        </GlassCard>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          className="btn-solid"
          style={{ width: '100%', opacity: files.length ? 1 : 0.4 }}
          disabled={!files.length || busy}
          onClick={upload}
        >
          {busy ? t('photos.uploading') : t('common.next')}
        </button>
        <button
          className="btn-glass"
          style={{ width: '100%' }}
          disabled={busy}
          onClick={() => onNext({ files: [], colors: [] })}
        >
          {t('common.skip')}
        </button>
      </div>
    </>
  );
}
