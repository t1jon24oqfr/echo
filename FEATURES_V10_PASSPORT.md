# Phase 1 — Character Passport + Studio + Assembler

Implements PHASE 1 of the living-persona spec. READ THE SPEC FIRST (binding for schema/formulas/passport fields/prompt contract): `persona-app/docs/specs/2026-06-16-living-persona-design.md` — sections 2 (Prisma), 3 (oceanToBaseline), 7 (prompt assembly), 8 (Passport).

SCOPE (Phase 1 ONLY — do NOT build the state engine, agenda, behavior layer, or embeddings; those are Phases 2-3):
- A versioned, editable **Character Passport** (JSON on Persona), auto-filled once from the chat export at build time, deeply tunable by the user.
- A **Character Studio** edit screen.
- The **prompt assembler** reads the Passport: adds a relationship register + an anti-manipulation guard line + a baseline tone hint. Upgrade memory retrieval to heuristic importance-weighting (NO embeddings yet).
Zero new per-message LLM cost. No behavior change to timing/presence/proactivity (those are Phase 2).

Backend owns `persona-app/api`, frontend owns `persona-app/web`. prisma 6.19.3 exact, read env at call-time, npm cache `npm_config_cache=/Volumes/Games/1M/.npmcache`, backend run `pkill -f dist/main.js` then `node dist/main.js`. A PARALLEL SESSION may edit both repos (it's adding a "visual import" feature) — read every file FRESH right before editing, make ADDITIVE/surgical changes, never rewrite whole files, preserve existing i18n (add keys to ALL 6 locales)/presence/design.

## Backend (api)
1. Schema (migration `passport`): add to `Persona`: `passport String?` (JSON CharacterPassport), `passportVersion Int @default(1)`, `timezone String @default("Europe/Kyiv")`. Add to `Memory`: `importance Int @default(5)` (1..10). Keep prisma 6.19.3.
2. `src/engine/passport.ts`:
   - The `CharacterPassport` TS type per spec §8 (identity, voice/style mirror, `ocean{O,C,E,A,N}` 0..100, `baselinePAD{P,A,D}`, `chronotype{MSF,sleepDurationH}`, `routineSkeleton[]`, `relationship{closenessSeed,pinnedMaxStage,decayEnabled,proactivityScale}`, `boundaries{paused,proactivityDailyCap,quietHours?}`, `knobs{talkativeness,warmth,expressiveness,moodReactivity,moodStability,initiative,typoTendency,readReceipts}`, `octantLexicon?`, `_provenance`, `_version`).
   - `oceanToBaseline(ocean)` EXACTLY per spec §3 (Mehrabian regression, ×0.5 scale, clamp). Sliders 0..100 → [-1,1] before the formula.
   - `defaultKnobs()`, and a `normalizePassport(partial)` that fills defaults + recomputes `baselinePAD` whenever `ocean` is present.
   - Mode rules: memorial → `relationship.decayEnabled=false`, `closenessSeed=70`; reconnect → `decayEnabled=true`, `closenessSeed=40`.
3. Build-time auto-fill (`src/personas/build.service.ts`): after the existing card/memories build, do ONE extra DeepSeek (EXTRACT_MODEL) analysis over the same chat sample to estimate `ocean` (Big-Five 0..100, with a 1-line justification each), `chronotype` (from message timestamps: infer MSF/owl-ness from when the persona is active; sleepDurationH default 7.5), and a `routineSkeleton` (3-6 blocks from mentions of work/gym/etc). Mirror style fields from the existing card/stats. Build the Passport via `normalizePassport`, mark every field `_provenance:'auto'`, store on `persona.passport`. ALSO infer `timezone` cheaply from export timestamp offsets if available, else leave default. Heuristic fallback (no key): a neutral passport (ocean all 50, default skeleton). Never fail the build on passport error — log + continue.
   - Set `Memory.importance` at write time with a cheap heuristic (length + feeling-word + first-person + has-date → 1..10) in the existing memory extraction path; default 5.
4. Endpoints (DeviceTokenGuard, owner-checked):
   - `GET /personas/:id/profile` → `{ passport, passportVersion, timezone }` (passport parsed).
   - `PATCH /personas/:id/profile` body `{ passport?: Partial<CharacterPassport>, timezone?: string }` → deep-merge into stored passport, run `normalizePassport` (recompute baselinePAD if ocean changed), flip touched fields `_provenance:'edited'`, `passportVersion++`. Returns the new profile. Memorial-mode invariants re-enforced (decay stays false).
   - `POST /personas/:id/profile/regenerate` (optional, nice-to-have) → re-run the build-time auto-fill for fields still `auto` (never overwrite `edited`). Skip if low-risk-tight on time.
5. Prompt assembler (`src/engine/prompt.ts` `buildSystemPrompt`) — extend per spec §7, Phase-1 subset:
   - Load passport (pass it in from chat/proactive paths). Add: (a) RELATIONSHIP REGISTER line keyed off the closeness STAGE derived from `relationship.closenessSeed` (Phase 1 has no live closeness yet) capped by `pinnedMaxStage`; (b) the FIXED anti-manipulation guard line (verbatim from spec §7 step 5) appended to EVERY prompt, all paths; (c) a BASELINE tone hint from `baselinePAD` via an `octantLabel()` (port the deadzone classifier from spec §3) — "[Right now you feel <adverb> <octant>.]" (no live mood/energy yet — that's Phase 2).
   - Upgrade `retrieveMemories`: rank by blend of recency + `importance` (heuristic) + the existing keyword overlap; keep the `tokens()` matcher as the relevance term (NO embeddings). top-k unchanged.
   - All call sites (chat.service, proactive.service, call path) must pass the passport so the guard + register appear everywhere. Keep existing rules 1-9 unchanged.
6. `personas.service.ts detail()`: include `hasPassport` (and maybe `passportVersion`) so the UI knows to show the Studio. Don't dump the whole passport in the list endpoint.
Verify: migration applies; tsc+build clean; boot; build a persona (or reuse one) and confirm `GET /profile` returns an auto-filled passport with ocean+baselinePAD+skeleton; PATCH ocean → baselinePAD changes + version bumps + provenance 'edited'; a chat reply still works and the system prompt now contains the guard line + register (log it once to confirm). Memorial persona → decayEnabled false.

## Frontend (web)
1. `src/lib/api.ts` (additive): `getProfile(id)`, `updateProfile(id, patch)`, types `CharacterPassport`/`Ocean`/`Knobs`. Add `hasPassport` to PersonaDetail.
2. **Character Studio** screen at `/persona/edit?id=` (route `src/app/persona/edit/page.tsx` + components under `src/components/studio/`), reached from the persona profile via an "Edit character" button. Sections (each a glass card, mobile-first, our light Telegram design):
   - Identity (name, relationship, occupation — text).
   - Personality: 5 Big-Five sliders (Openness/Conscientiousness/Extraversion/Agreeableness/Neuroticism) 0..100 with friendly labels + a one-line live description of the current setting.
   - Chronotype: a single slider Early bird ↔ Night owl + a sleep-duration stepper.
   - Voice & style: editable traits (chips), signature phrases, pet names, emoji set (from auto-fill, editable).
   - World & routine: facts list + a simple routine-skeleton editor (rows: label, approx start, duration, busy toggle, weekday/weekend).
   - Relationship & limits: pinnedMaxStage (a labelled 1..5 control "how close she can ever get"), proactivityScale slider, paused toggle ("Pause — she won't reach out; framed as rest"), readReceipts (off/close-only/always).
   - Behavior knobs: talkativeness, warmth, expressiveness, initiative, moodReactivity, moodStability, typoTendency — sliders with a one-line effect description each.
   - Each field shows a subtle "auto" vs "edited" tag (from `_provenance`). A sticky "Save" that PATCHes; optimistic + toast.
   - Closeness is NEVER shown as a number anywhere.
   - i18n ALL strings in all 6 locales.
3. Add the "Edit character" entry on `src/app/persona/page.tsx` (a button near the top), only when `hasPassport`.
Verify: tsc + build clean; the Studio renders, sliders load auto-filled values, Save round-trips (PATCH then re-GET reflects changes), provenance flips to edited.

## Report
Backend: migration name, passport fields, endpoint shapes, how the guard+register appear in the prompt, where baseline is computed. Frontend: files, new i18n keys, the Studio sections, anything deferred (regenerate, preview).
