-- Persona realism (additive, all defaulted/nullable — no backfill, no downtime).
-- Persona.knowledgeCutoff: the persona knows nothing after this date (memorial
-- death/last-active date) — authenticity + ethical grounding + retrieval gate.
ALTER TABLE "Persona" ADD COLUMN "knowledgeCutoff" TEXT;

-- Memory.source: provenance of a memory. 'user' = from the human's turn (ground
-- truth), 'card' = verified build fact, 'reflection' = consolidated belief,
-- 'model' = derived from the persona's own reply (low-confidence, never pins).
ALTER TABLE "Memory" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'user';
