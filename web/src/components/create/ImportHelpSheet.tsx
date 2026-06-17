'use client';

/**
 * "How to export?" help sheet — a bottom-anchored glass overlay that renders the
 * FULL, per-platform export guide for the selected messenger from the verified
 * data file (web/src/lib/importGuides.data.json, via getImportGuide).
 *
 * The guide BODY text stays English (it comes from the data file); only the
 * static labels around it ("Verified June 2026", "What you'll upload", platform
 * names, "Close", …) are localised via i18n. Pure presentational; no fetching.
 */

import { useMemo, useState } from 'react';
import { getImportGuide, type ImportPlatformId } from '@/lib/importGuides';
import { useT } from '@/i18n';

/** Localised platform tab label (the data names are fixed English ids). */
const PLATFORM_KEY: Record<ImportPlatformId, string> = {
  iPhone: 'helpSheet.platform.iPhone',
  Android: 'helpSheet.platform.android',
  Desktop: 'helpSheet.platform.desktop',
  Web: 'helpSheet.platform.web',
};

/** Pick a sensible default platform from the device user-agent. */
function detectPlatform(available: ImportPlatformId[]): ImportPlatformId {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua) && available.includes('iPhone')) return 'iPhone';
    if (/Android/i.test(ua) && available.includes('Android')) return 'Android';
  }
  return available[0];
}

/** "no …" / "partial …" availability notes mean the platform isn't fully supported. */
function isLimited(available: string): boolean {
  return /^\s*(no|partial)\b/i.test(available);
}

export default function ImportHelpSheet({
  source,
  onClose,
}: {
  source: string;
  onClose: () => void;
}) {
  const t = useT();
  const guide = getImportGuide(source);

  const platformIds = useMemo(
    () => (guide ? guide.platforms.map((p) => p.platform) : []),
    [guide],
  );
  const [active, setActive] = useState<ImportPlatformId>(() => detectPlatform(platformIds));
  const [openTip, setOpenTip] = useState<number | null>(null);

  if (!guide) return null;

  const platform =
    guide.platforms.find((p) => p.platform === active) ?? guide.platforms[0];
  const limited = isLimited(platform.available);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={guide.displayName}
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
          maxHeight: '88dvh',
          overflowY: 'auto',
          padding: 20,
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <h3 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>{guide.displayName}</h3>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 3 }}>
              {t('helpSheet.verified')}
            </div>
          </div>
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

        {/* Pinned "What you'll upload" banner */}
        <div
          className="glass-strong"
          style={{
            borderLeft: '3px solid var(--accent)',
            borderRadius: 12,
            padding: '12px 14px',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              color: 'var(--accent)',
              marginBottom: 5,
            }}
          >
            {t('helpSheet.whatYoullUpload')}
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--text)' }}>
            {guide.whatEchoNeeds}
          </div>
        </div>

        {/* Per-platform sub-tabs */}
        <div
          role="tablist"
          aria-label={t('helpSheet.platformTabs')}
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}
        >
          {guide.platforms.map((p) => {
            const selected = p.platform === active;
            return (
              <button
                key={p.platform}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setActive(p.platform);
                  setOpenTip(null);
                }}
                className={selected ? undefined : 'glass'}
                style={{
                  minHeight: 36,
                  padding: '7px 14px',
                  borderRadius: 999,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  ...(selected
                    ? { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }
                    : { color: 'var(--text)' }),
                }}
              >
                {t(PLATFORM_KEY[p.platform])}
              </button>
            );
          })}
        </div>

        {/* Availability note when the platform isn't fully supported */}
        {limited && (
          <div
            className="glass"
            style={{
              borderRadius: 12,
              padding: '10px 14px',
              marginBottom: 14,
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--text)',
            }}
          >
            <span aria-hidden="true" style={{ marginRight: 6 }}>
              ⚠️
            </span>
            {platform.available}
          </div>
        )}

        {/* Numbered steps */}
        <ol
          style={{
            margin: 0,
            paddingLeft: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            fontSize: 14,
            color: 'var(--text)',
            lineHeight: 1.55,
          }}
        >
          {platform.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>

        {/* Getting the file onto your phone */}
        {platform.getItToPhone && platform.getItToPhone.trim() && (
          <div
            className="glass"
            style={{
              borderRadius: 12,
              padding: '12px 14px',
              marginTop: 16,
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--text)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {t('helpSheet.gettingItToPhone')}
            </div>
            <div style={{ color: 'var(--text-dim)' }}>{platform.getItToPhone}</div>
          </div>
        )}

        {/* Time-delay chip */}
        {platform.timeDelay && platform.timeDelay.trim() && (
          <div style={{ marginTop: 14 }}>
            <span
              className="glass"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 12.5,
                color: 'var(--text-dim)',
              }}
            >
              <span aria-hidden="true">⏱</span>
              {t('helpSheet.timeNeeded')}: {platform.timeDelay}
            </span>
          </div>
        )}

        {/* Platform caveats */}
        {platform.caveats.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              margin: '16px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {platform.caveats.map((c, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  gap: 8,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: 'var(--text-dim)',
                }}
              >
                <span aria-hidden="true" style={{ flex: '0 0 auto' }}>
                  ⚠️
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Troubleshooting accordion */}
        {guide.troubleshooting.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
              {t('helpSheet.ifItDoesntWork')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {guide.troubleshooting.map((tip, i) => {
                const open = openTip === i;
                return (
                  <div
                    key={i}
                    className="glass"
                    style={{ borderRadius: 12, overflow: 'hidden' }}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenTip(open ? null : i)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '11px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: 'var(--text)',
                        lineHeight: 1.4,
                      }}
                    >
                      <span>{tip.problem}</span>
                      <span
                        aria-hidden="true"
                        style={{
                          flex: '0 0 auto',
                          color: 'var(--text-dim)',
                          transform: open ? 'rotate(180deg)' : 'none',
                          transition: 'transform 0.2s',
                        }}
                      >
                        ⌄
                      </span>
                    </button>
                    {open && (
                      <div
                        style={{
                          padding: '0 14px 12px',
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: 'var(--text-dim)',
                        }}
                      >
                        {tip.fix}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* "Good to know" — general caveats */}
        {guide.generalCaveats.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
              {t('helpSheet.goodToKnow')}
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--text-dim)',
              }}
            >
              {guide.generalCaveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          className="btn-solid"
          onClick={onClose}
          style={{ width: '100%', marginTop: 22 }}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
