-- Memory bi-temporal supersession + session recall (additive, all nullable).
-- Memory.validUntil: set when a memory is contradicted/outdated by a newer one;
-- the row is preserved (memorial history) but no longer surfaced as current.
ALTER TABLE "Memory" ADD COLUMN "validUntil" TIMESTAMP(3);

-- Persona.lastSessionSummary: one-line recap of the previous chat session,
-- written when a new session starts after a long gap; injected into the prompt.
ALTER TABLE "Persona" ADD COLUMN "lastSessionSummary" TEXT;
