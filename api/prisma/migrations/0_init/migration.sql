-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "deviceToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "description" TEXT,
    "ambient" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stage" TEXT,
    "avatarFile" TEXT,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "personaAuthor" TEXT,
    "userAuthor" TEXT,
    "voiceId" TEXT,
    "voiceGender" TEXT,
    "voiceSampleFile" TEXT,
    "stats" TEXT,
    "card" TEXT,
    "exemplars" TEXT,
    "lastUserAt" TIMESTAMP(3),
    "lastPersonaAt" TIMESTAMP(3),
    "nextNudgeAt" TIMESTAMP(3),
    "passport" TEXT,
    "passportVersion" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "date" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 5,
    "kind" TEXT NOT NULL DEFAULT 'episodic',
    "emotionTag" TEXT,
    "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "imageFile" TEXT,
    "audioFile" TEXT,
    "transcript" TEXT,
    "proactive" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaState" (
    "personaId" TEXT NOT NULL,
    "moodP" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moodA" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moodD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseP" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseA" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "emotions" TEXT NOT NULL DEFAULT '[]',
    "closeness" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "peakCloseness" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "stage" INTEGER NOT NULL DEFAULT 1,
    "sleepPressureS" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "lastWakeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSleepAt" TIMESTAMP(3),
    "asleep" BOOLEAN NOT NULL DEFAULT false,
    "stateAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDecayDay" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "importanceSinceReflect" INTEGER NOT NULL DEFAULT 0,
    "lastReflectAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonaState_pkey" PRIMARY KEY ("personaId")
);

-- CreateTable
CREATE TABLE "DailyAgenda" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "blocks" TEXT NOT NULL,
    "seedSummary" TEXT,
    "byLLM" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyAgenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffectEvent" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "emotionType" TEXT,
    "dP" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dA" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dCloseness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_deviceToken_key" ON "User"("deviceToken");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PersonaState_stateAt_idx" ON "PersonaState"("stateAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAgenda_personaId_localDate_key" ON "DailyAgenda"("personaId", "localDate");

-- CreateIndex
CREATE INDEX "AffectEvent_personaId_createdAt_idx" ON "AffectEvent"("personaId", "createdAt");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaState" ADD CONSTRAINT "PersonaState_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAgenda" ADD CONSTRAINT "DailyAgenda_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffectEvent" ADD CONSTRAINT "AffectEvent_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

