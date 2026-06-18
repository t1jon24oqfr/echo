-- N12 situation-matched real-reply exemplars (kNN-LM grounding at generation).
CREATE TABLE "ReplyExemplar" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "embedding" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplyExemplar_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReplyExemplar_personaId_idx" ON "ReplyExemplar"("personaId");

ALTER TABLE "ReplyExemplar" ADD CONSTRAINT "ReplyExemplar_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
