'use client';

import { useEffect, useRef, useState } from 'react';
import GlassCard from '@/components/GlassCard';
import { buildPersona, getPersona, type CorpusStats } from '@/lib/api';
import { useT } from '@/i18n';

const STAGE_KEYS = ['building.stage1', 'building.stage2', 'building.stage3', 'building.stage4'];

/** Backend build stages mapped onto the displayed stage copy. */
const STAGE_INDEX: Record<string, number> = { card: 0, exemplars: 1, memories: 2, avatars: 3 };

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function Building({
  personaId,
  name,
  photoUrl,
  onDone,
}: {
  personaId: string;
  name: string;
  photoUrl: string | null;
  onDone: () => void;
}) {
  const t = useT();
  const [stage, setStage] = useState(0);
  const [serverStage, setServerStage] = useState<string | null>(null);
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [personaName, setPersonaName] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // drives the blur→sharpen completion
  const [error, setError] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setStage((s) => (s + 1) % STAGE_KEYS.length), 2400);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** POST build (202), then poll GET /personas/:id until ready/failed. */
  async function build() {
    setError(false);
    try {
      await buildPersona(personaId);
      for (;;) {
        await delay(1500);
        const p = await getPersona(personaId);
        if (p.stage) setServerStage(p.stage);
        // Real corpus stats become available during ingest/build — feed the copy.
        if (p.stats) setStats(p.stats);
        if (p.card?.name) setPersonaName(p.card.name);
        if (p.status === 'ready') {
          setReady(true); // let the portrait finish sharpening before we leave
          await delay(900);
          onDone();
          return;
        }
        if (p.status === 'failed') throw new Error(p.stage ?? 'build failed');
      }
    } catch {
      setError(true);
    }
  }

  const stageIdx = serverStage != null ? STAGE_INDEX[serverStage] : undefined;
  const stageText = t(STAGE_KEYS[stageIdx ?? stage]);

  // Personalized lines, derived from the real corpus stats. They cycle in sync
  // with `stage` (the 2.4s ticker), falling back to the generic stage copy when
  // a particular fact isn't available yet.
  const who = personaName || name;
  const personalLines = buildPersonalLines(who, stats);
  const detailText = personalLines.length
    ? personalLines[stage % personalLines.length]
    : stageText;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: '0 24px',
      }}
    >
      <style>{`@keyframes vid-pulse { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }`}</style>

      <div
        className="glass-strong"
        style={{
          width: 128,
          height: 128,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              // Blurred while building; sharpens to clear only when the real
              // build reports `ready` — not on a blind timer.
              filter: ready ? 'blur(0)' : 'blur(16px)',
              opacity: ready ? 1 : 0.6,
              transition: 'filter 1.4s ease-out, opacity 1.4s ease-out',
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 44,
              fontWeight: 600,
              filter: ready ? 'blur(0)' : 'blur(6px)',
              opacity: ready ? 1 : 0.6,
              transition: 'filter 1.4s ease-out, opacity 1.4s ease-out',
            }}
          >
            {(who || '·').slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>

      {error ? (
        <GlassCard style={{ width: '100%' }}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>{t('building.error')}</div>
          <button className="btn-glass" style={{ width: '100%' }} onClick={() => void build()}>
            {t('common.tryAgain')}
          </button>
        </GlassCard>
      ) : (
        <div style={{ textAlign: 'center', minHeight: 48 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text)',
              animation: 'vid-pulse 2.4s ease-in-out infinite',
              minHeight: 22,
            }}
          >
            {detailText}
          </div>
          {/* The generic stage label stays as a quiet secondary line. */}
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, minHeight: 18 }}>
            {stageText}
          </div>
        </div>
      )}
    </div>
  );
}

/** ISO range → "1 Jan – 14 Jun 2024"-ish compact label (locale-safe slice). */
function rangeLabel(from: string, to: string): string | null {
  const f = from.slice(0, 10);
  const tt = to.slice(0, 10);
  if (!f || !tt) return null;
  return `${f} – ${tt}`;
}

/**
 * Build a small set of personalized "learning" lines from the real corpus.
 * English copy is hardcoded here (templated with the real numbers); see the
 * report for the i18n keys to add in the verify pass.
 */
function buildPersonalLines(name: string, stats: CorpusStats | null): string[] {
  const who = name || 'them';
  const lines: string[] = [`Learning how ${who} talks…`];
  if (!stats) return lines;

  if (stats.totalMessages > 0) {
    const range = rangeLabel(stats.from, stats.to);
    lines.push(
      range
        ? `${who} sent you ${stats.totalMessages.toLocaleString()} messages over ${range}`
        : `Reading ${stats.totalMessages.toLocaleString()} messages from ${who}`,
    );
  }

  const author = stats.byAuthor[name] ?? Object.values(stats.byAuthor)[0];
  const topEmoji = author?.topEmoji?.[0]?.[0];
  if (topEmoji) lines.push(`Picking up the way ${who} uses ${topEmoji}`);

  lines.push(`Gathering the memories you shared with ${who}…`);
  return lines;
}
