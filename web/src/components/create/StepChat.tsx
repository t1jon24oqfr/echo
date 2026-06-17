'use client';

import { useEffect, useRef, useState } from 'react';
import GlassCard from '@/components/GlassCard';
import Chip from '@/components/create/Chip';
import {
  ApiError,
  getPersona,
  ingestChat,
  visualImport,
  visualImportConfirm,
  type IngestResult,
} from '@/lib/api';
import { useT } from '@/i18n';

/* ===========================================================================
 * V9 PIVOT — file-export import is COMMENTED OUT (not deleted), replaced by a
 * single "upload a screen recording or screenshots" visual-import step below.
 * The 6 per-messenger tabs, their per-source hints, the "?" ImportHelpSheet
 * wiring and the file-export upload/parse paths are preserved here for the
 * future; their i18n keys (stepChat.hint*, help.*, helpSheet.*) are kept too.
 * The demo button is KEPT (re-implemented in the new body).
 * ---------------------------------------------------------------------------
 * Original imports this block needed:
 *   import { strFromU8, unzipSync } from 'fflate';
 *   import ConversationPicker, { type Conversation } from '@/components/create/ConversationPicker';
 *   import ImportHelpSheet from '@/components/create/ImportHelpSheet';
 *
 * type Source = 'telegram' | 'whatsapp' | 'instagram' | 'facebook' | 'line' | 'vk';
 *
 * // Labels are brand names (untranslated); hints/help are dictionary keys.
 * const SOURCES: {
 *   id: Source;
 *   label: string;
 *   hintKey: string;
 *   accept: string;
 *   helpKey: string; // help-sheet title key
 *   helpSteps: string[]; // ordered step keys
 *   caveatKey?: string; // optional small caveat shown in the help sheet
 * }[] = [
 *   {
 *     id: 'telegram',
 *     label: 'Telegram',
 *     hintKey: 'stepChat.hintTelegram',
 *     accept: '.json,application/json',
 *     helpKey: 'help.telegram.title',
 *     helpSteps: ['help.telegram.s1', 'help.telegram.s2', 'help.telegram.s3', 'help.telegram.s4'],
 *     caveatKey: 'help.telegram.caveat',
 *   },
 *   {
 *     id: 'whatsapp',
 *     label: 'WhatsApp',
 *     hintKey: 'stepChat.hintWhatsapp',
 *     accept: '.txt,.zip,text/plain,application/zip',
 *     helpKey: 'help.whatsapp.title',
 *     helpSteps: ['help.whatsapp.s1', 'help.whatsapp.s2', 'help.whatsapp.s3', 'help.whatsapp.s4'],
 *     caveatKey: 'help.whatsapp.caveat',
 *   },
 *   {
 *     id: 'instagram',
 *     label: 'Instagram',
 *     hintKey: 'stepChat.hintInstagram',
 *     accept: '.json,application/json,.zip,application/zip',
 *     helpKey: 'help.instagram.title',
 *     helpSteps: [
 *       'help.instagram.s1',
 *       'help.instagram.s2',
 *       'help.instagram.s3',
 *       'help.instagram.s4',
 *       'help.instagram.s5',
 *     ],
 *     caveatKey: 'help.instagram.caveat',
 *   },
 *   {
 *     id: 'facebook',
 *     label: 'Facebook',
 *     hintKey: 'stepChat.hintFacebook',
 *     accept: '.zip,application/zip',
 *     helpKey: 'help.facebook.title',
 *     helpSteps: [
 *       'help.facebook.s1',
 *       'help.facebook.s2',
 *       'help.facebook.s3',
 *       'help.facebook.s4',
 *       'help.facebook.s5',
 *       'help.facebook.s6',
 *     ],
 *     caveatKey: 'help.facebook.caveat',
 *   },
 *   {
 *     id: 'line',
 *     label: 'LINE',
 *     hintKey: 'stepChat.hintLine',
 *     accept: '.txt,.zip,text/plain,application/zip',
 *     helpKey: 'help.line.title',
 *     helpSteps: ['help.line.s1', 'help.line.s2', 'help.line.s3', 'help.line.s4', 'help.line.s5'],
 *     caveatKey: 'help.line.caveat',
 *   },
 *   {
 *     id: 'vk',
 *     label: 'VK',
 *     hintKey: 'stepChat.hintVk',
 *     accept: '.zip,application/zip',
 *     helpKey: 'help.vk.title',
 *     helpSteps: ['help.vk.s1', 'help.vk.s2', 'help.vk.s3', 'help.vk.s4', 'help.vk.s5'],
 *     caveatKey: 'help.vk.caveat',
 *   },
 * ];
 *
 * type ZipEntries = Record<string, Uint8Array>;
 *
 * // ---- Facebook helpers -----------------------------------------------------
 * // Group every message_*.json under inbox/<thread>/ by its thread folder.
 * function facebookThreads(entries: ZipEntries): Record<string, string[]> {
 *   const groups: Record<string, string[]> = {};
 *   for (const path of Object.keys(entries)) {
 *     const m = /(?:^|\/)messages\/inbox\/([^/]+)\/(message_\d+\.json)$/i.exec(path);
 *     if (!m) continue;
 *     const thread = m[1];
 *     (groups[thread] ??= []).push(path);
 *   }
 *   return groups;
 * }
 *
 * interface FbThreadJson {
 *   participants?: { name: string }[];
 *   messages?: unknown[];
 *   title?: string;
 * }
 *
 * function fbParse(entries: ZipEntries, path: string): FbThreadJson | null {
 *   try {
 *     return JSON.parse(strFromU8(entries[path])) as FbThreadJson;
 *   } catch {
 *     return null;
 *   }
 * }
 *
 * // ---- VK helpers -----------------------------------------------------------
 * function vkDialogs(entries: ZipEntries): Record<string, string[]> {
 *   const groups: Record<string, string[]> = {};
 *   for (const path of Object.keys(entries)) {
 *     const m = /(?:^|\/)messages\/([^/]+)\/messages\d+\.html$/i.exec(path);
 *     if (!m) continue;
 *     (groups[m[1]] ??= []).push(path);
 *   }
 *   return groups;
 * }
 *
 * function vkPageIndex(path: string): number {
 *   const m = /messages(\d+)\.html$/i.exec(path);
 *   return m ? parseInt(m[1], 10) : 0;
 * }
 *
 * function vkDecode(entries: ZipEntries, path: string): string {
 *   return new TextDecoder('windows-1251').decode(entries[path]);
 * }
 *
 * function vkDialogLabel(html: string): { label: string; sublabel?: string } {
 *   let label = '';
 *   let sublabel: string | undefined;
 *   const header = /class="message__header"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
 *   if (header) {
 *     const text = stripTags(header[1]).trim();
 *     const comma = text.lastIndexOf(',');
 *     label = (comma > 0 ? text.slice(0, comma) : text).trim();
 *   }
 *   if (label === 'Вы' || !label) {
 *     const authors = [...html.matchAll(/class="message__header"[^>]*>([\s\S]*?)<\/div>/gi)]
 *       .map((mm) => {
 *         const text = stripTags(mm[1]).trim();
 *         const comma = text.lastIndexOf(',');
 *         return (comma > 0 ? text.slice(0, comma) : text).trim();
 *       })
 *       .filter((a) => a && a !== 'Вы');
 *     if (authors[0]) label = authors[0];
 *   }
 *   return { label: label || '', sublabel };
 * }
 *
 * function stripTags(s: string): string {
 *   return s
 *     .replace(/<br\s*\/?>(?!$)/gi, ' ')
 *     .replace(/<[^>]+>/g, '')
 *     .replace(/&amp;/g, '&')
 *     .replace(/&lt;/g, '<')
 *     .replace(/&gt;/g, '>')
 *     .replace(/&quot;/g, '"')
 *     .replace(/&#039;|&apos;/g, "'")
 *     .replace(/&nbsp;/g, ' ');
 * }
 *
 * // ---- Old StepChat body (file-export flow) ---------------------------------
 * // const [source, setSource] = useState<Source>('telegram');
 * // const [content, setContent] = useState<string | null>(null);
 * // const [fileName, setFileName] = useState('');
 * // const [help, setHelp] = useState(false);
 * // const [pickerSource, setPickerSource] = useState<'facebook' | 'vk' | null>(null);
 * // const [conversations, setConversations] = useState<Conversation[]>([]);
 * // const zipRef = useRef<ZipEntries | null>(null);
 * // const src = SOURCES.find((s) => s.id === source)!;
 * // async function readFile(file: File) { ...telegram/whatsapp/instagram/line/fb/vk parse... }
 * // function handleFacebookZip(...) {...}  async function pickFacebook(...) {...}
 * // function handleVkZip(...) {...}        async function pickVk(...) {...}
 * // function onPickConversation(id) {...}
 * // The source tabs <Chip> row, the per-source hint card with the "?" button,
 * // the hidden <input accept={src.accept}>, the ConversationPicker, and the
 * // <ImportHelpSheet source={source} …/> were all rendered here.
 * =========================================================================== */

const LANG_KEYS: Record<string, string> = {
  uk: 'lang.uk',
  ru: 'lang.ru',
  en: 'lang.en',
  cyr: 'lang.cyr',
  other: 'lang.other',
};

/** Visual-import phases for the single-step UI. */
type Phase = 'pick' | 'extracting' | 'authors' | 'done';

/** Poll backoff while extraction runs server-side. */
const POLL_MS = 1800;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function StepChat({
  personaId,
  demo,
  onNext,
}: {
  personaId: string;
  demo: boolean;
  onNext: (r: IngestResult) => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('pick');
  const [authors, setAuthors] = useState<{ name: string; count: number }[] | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordHelp, setRecordHelp] = useState(false);
  // A cycling "Reading your messages… / Sorting who said what…" line.
  const [extractTick, setExtractTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollAbort = useRef(false);

  useEffect(() => {
    return () => {
      pollAbort.current = true;
    };
  }, []);

  // Cycle the extraction copy while extracting.
  useEffect(() => {
    if (phase !== 'extracting') return;
    const id = setInterval(() => setExtractTick((n) => n + 1), 2600);
    return () => clearInterval(id);
  }, [phase]);

  /** Demo path reuses the existing text-ingest endpoint (unchanged). */
  async function useDemo() {
    setBusy(true);
    setError(null);
    try {
      const data = await ingestChat(personaId, { demo: true });
      if ('authors' in data) {
        setAuthors(data.authors);
        setPhase('authors');
      } else if ('stats' in data) {
        setResult(data);
        setPhase('done');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('stepChat.connError'));
    } finally {
      setBusy(false);
    }
  }

  /** Demo author-finalize: the old ingest {me} contract is still mapped. */
  async function finalizeDemo(me: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await ingestChat(personaId, { demo: true, me });
      if ('stats' in data) {
        setResult(data);
        setAuthors(null);
        setPhase('done');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('stepChat.connError'));
    } finally {
      setBusy(false);
    }
  }

  /** Upload the screen recording or screenshots and start polling. */
  async function onFiles(files: File[]) {
    if (!files.length) return;
    setError(null);
    setBusy(true);
    setPhase('extracting');
    setExtractTick(0);
    pollAbort.current = false;
    try {
      await visualImport(personaId, files);
      await pollExtraction();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('visualImport.uploadError'));
      setPhase('pick');
    } finally {
      setBusy(false);
    }
  }

  /** Poll GET /personas/:id until importAuthors appear, or a stage error. */
  async function pollExtraction() {
    for (;;) {
      if (pollAbort.current) return;
      await delay(POLL_MS);
      let p;
      try {
        p = await getPersona(personaId);
      } catch {
        continue; // transient network blip — keep polling
      }
      // Friendly error: backend sets stage to 'extract:error:<reason>'.
      if (p.stage && p.stage.startsWith('extract:error')) {
        const reason = p.stage.slice('extract:error:'.length).trim();
        setError(reason || t('visualImport.extractError'));
        setPhase('pick');
        return;
      }
      if (p.status === 'failed') {
        setError(t('visualImport.extractError'));
        setPhase('pick');
        return;
      }
      if (p.importAuthors && p.importAuthors.length) {
        setAuthors(p.importAuthors);
        setPhase('authors');
        return;
      }
    }
  }

  /** Confirm which extracted author is "me" → instant corpus finalize. */
  async function confirmMe(me: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await visualImportConfirm(personaId, me);
      setResult(data);
      setAuthors(null);
      setPhase('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('stepChat.connError'));
    } finally {
      setBusy(false);
    }
  }

  const topLang = (mix: Record<string, number>) => {
    const top = Object.entries(mix).sort((a, b) => b[1] - a[1])[0];
    return top
      ? `${LANG_KEYS[top[0]] ? t(LANG_KEYS[top[0]]) : top[0]} (${Math.round(top[1] * 100)}%)`
      : '—';
  };

  const EXTRACT_LINES = [
    t('visualImport.reading'),
    t('visualImport.sorting'),
    t('visualImport.almost'),
  ];

  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '12px 0 4px' }}>{t('stepChat.title')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>
        {t('stepChat.subtitle')}
      </p>

      {demo && phase === 'pick' && (
        <GlassCard strong style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, marginBottom: 10 }}>{t('stepChat.demoCard')}</div>
          <button
            className="btn-solid"
            style={{ width: '100%', height: 44 }}
            disabled={busy}
            onClick={() => void useDemo()}
          >
            {busy ? t('stepChat.reading') : t('stepChat.useDemo')}
          </button>
        </GlassCard>
      )}

      {/* ---- PICK: the single visual-import card with the mini-guide ---- */}
      {phase === 'pick' && (
        <GlassCard style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            {t('visualImport.heading')}
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5, margin: '0 0 14px' }}>
            {t('visualImport.lede')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
            <GuideStep icon="💬" n={1} text={t('visualImport.step1')} />
            <GuideStep icon="🎬" n={2} text={t('visualImport.step2')} />
            <GuideStep icon="⬆️" n={3} text={t('visualImport.step3')} />
          </div>

          <div
            className="glass"
            style={{
              borderRadius: 12,
              padding: '9px 12px',
              marginBottom: 14,
              fontSize: 13,
              lineHeight: 1.45,
              color: 'var(--text-dim)',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <span aria-hidden="true">💡</span>
            <span>{t('visualImport.tip')}</span>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="video/*,image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length) void onFiles(files);
              e.target.value = '';
            }}
          />
          <button
            className="btn-solid"
            style={{ width: '100%' }}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t('visualImport.uploadCta')}
          </button>

          <button
            type="button"
            onClick={() => setRecordHelp(true)}
            style={{
              marginTop: 12,
              padding: 0,
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 13.5,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('visualImport.howToRecord')}
          </button>

          <div
            style={{
              marginTop: 12,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'var(--text-dim)',
            }}
          >
            {t('visualImport.approxNote')}
          </div>
        </GlassCard>
      )}

      {/* ---- EXTRACTING: Building-style stage UI while the VLM reads ---- */}
      {phase === 'extracting' && (
        <GlassCard strong style={{ marginBottom: 12 }}>
          <style>{`@keyframes vid-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              padding: '14px 8px',
              textAlign: 'center',
            }}
          >
            <div
              className="glass"
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                animation: 'vid-pulse 2.6s ease-in-out infinite',
              }}
              aria-hidden="true"
            >
              👀
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, minHeight: 22 }}>
              {EXTRACT_LINES[extractTick % EXTRACT_LINES.length]}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
              {t('visualImport.extractHint')}
            </div>
          </div>
        </GlassCard>
      )}

      {/* ---- AUTHORS: existing "which one is you?" chip step ---- */}
      {phase === 'authors' && authors && (
        <GlassCard strong style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            {t('stepChat.whichYou')}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.45 }}>
            {t('visualImport.whichYouNote')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {authors.map((a) => (
              <Chip
                key={a.name}
                label={`${a.name} · ${a.count}`}
                disabled={busy}
                onClick={() => void (demo ? finalizeDemo(a.name) : confirmMe(a.name))}
              />
            ))}
          </div>
        </GlassCard>
      )}

      {/* ---- DONE: the stats card (unchanged shape) ---- */}
      {phase === 'done' && result && (
        <GlassCard strong style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
            {t('stepChat.acquainted', { name: result.personaAuthor })}
          </div>
          <StatRow label={t('stepChat.statMessages')} value={String(result.stats.totalMessages)} />
          <StatRow label={t('stepChat.statConversations')} value={String(result.conversations)} />
          <StatRow
            label={t('stepChat.statLanguage')}
            value={topLang(result.stats.byAuthor[result.personaAuthor]?.langMix ?? {})}
          />
          <StatRow
            label={t('stepChat.statEmoji')}
            value={
              (result.stats.byAuthor[result.personaAuthor]?.topEmoji ?? [])
                .slice(0, 5)
                .map(([e]) => e)
                .join(' ') || t('stepChat.noEmoji')
            }
          />
          <StatRow
            label={t('stepChat.statPeriod')}
            value={`${result.stats.from.slice(0, 10)} — ${result.stats.to.slice(0, 10)}`}
          />
        </GlassCard>
      )}

      {error && (
        <GlassCard style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 14 }}>{error}</span>
        </GlassCard>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 16 }}>
        <button
          className="btn-solid"
          style={{ width: '100%', opacity: result ? 1 : 0.4 }}
          disabled={!result || busy}
          onClick={() => result && onNext(result)}
        >
          {t('common.next')}
        </button>
      </div>

      {recordHelp && <ScreenRecordHelp onClose={() => setRecordHelp(false)} />}
    </>
  );
}

/** One row of the illustrated 3-step guide: icon badge + step number + text. */
function GuideStep({ icon, n, text }: { icon: string; n: number; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        className="glass"
        style={{
          flex: '0 0 auto',
          width: 40,
          height: 40,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
        }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--text)' }}>
        <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 6 }}>{n}</span>
        {text}
      </div>
    </div>
  );
}

/** Compact "How to screen-record?" sheet: iPhone + Android steps (generic). */
function ScreenRecordHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('visualImport.recordSheetTitle')}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.32)',
        padding: 12,
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
      }}
    >
      <div
        className="glass-strong"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '82dvh',
          overflowY: 'auto',
          padding: 20,
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <h3 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>
            {t('visualImport.recordSheetTitle')}
          </h3>
          <button
            type="button"
            className="glass"
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              flex: '0 0 auto',
              minWidth: 40,
              height: 40,
              borderRadius: 999,
              fontSize: 18,
              lineHeight: 1,
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <RecordPlatform
          title={t('visualImport.iphoneTitle')}
          steps={[t('visualImport.iphoneS1'), t('visualImport.iphoneS2'), t('visualImport.iphoneS3')]}
        />
        <div style={{ height: 14 }} />
        <RecordPlatform
          title={t('visualImport.androidTitle')}
          steps={[
            t('visualImport.androidS1'),
            t('visualImport.androidS2'),
            t('visualImport.androidS3'),
          ]}
        />

        <button
          type="button"
          className="btn-solid"
          onClick={onClose}
          style={{ width: '100%', marginTop: 20 }}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}

function RecordPlatform({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <ol
        style={{
          margin: 0,
          paddingLeft: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          fontSize: 13.5,
          lineHeight: 1.5,
          color: 'var(--text)',
        }}
      >
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: 14,
        padding: '5px 0',
      }}
    >
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
