'use client';

import { useT } from '@/i18n';
import type { Provenance } from '@/lib/api';

/**
 * A subtle "auto" vs "edited" pill that tells the user whether a passport field
 * was inferred from the chat export or hand-tuned by them. Reads provenance for
 * a single top-level field; renders nothing when provenance is unknown.
 */
export default function ProvenanceTag({
  provenance,
  field,
}: {
  provenance: Record<string, Provenance> | undefined;
  field: string;
}) {
  const t = useT();
  const p = provenance?.[field];
  if (!p) return null;
  const edited = p === 'edited';
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        padding: '2px 7px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        color: edited ? 'var(--accent)' : 'var(--text-dim)',
        background: edited ? 'rgba(0, 122, 255, 0.1)' : 'rgba(120, 120, 128, 0.12)',
      }}
    >
      {edited ? t('studio.tagEdited') : t('studio.tagAuto')}
    </span>
  );
}
