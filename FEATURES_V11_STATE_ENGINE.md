# Phase 2 — Inner-Life State Engine (mood/energy/closeness + presence + proactivity)

Implements PHASE 2 of the living-persona spec. READ FIRST (binding — has the exact pseudocode/formulas/constants): `persona-app/docs/specs/2026-06-16-living-persona-design.md` sections 1,2,3,4,5,7,9. Phase 1 (Passport) is DONE: `engine/passport.ts` has `oceanToBaseline`, `octantLabel`, `normalizePassport`; `Persona.passport/passportVersion/timezone` + `Memory.importance` exist; `buildSystemPrompt` already appends a baseline tone hint + relationship register + ANTI_MANIPULATION_GUARD. This phase makes the state LIVE.

SCOPE (Phase 2 ONLY — NOT the behavior layer micro-behaviors or embeddings; those are Phase 3): the persistent inner life that evolves while the user is away, driving presence + proactivity + the prompt's live state block, all formula-based (LLM only for daily agenda + nightly reflection).

Backend-heavy, `persona-app/api`. Small frontend touch for richer presence. prisma 6.19.3 exact; read env at call-time; npm cache `npm_config_cache=/Volumes/Games/1M/.npmcache`. COORDINATION: a parallel session also edits `api/` and runs the backend on :3048 — read every file FRESH before editing, additive/surgical, never rewrite whole files; before running the server `pkill -f dist/main.js` then `node dist/main.js` (EADDRINUSE otherwise).

## Backend
1. Schema (migration `state_engine`): add `PersonaState`, `DailyAgenda`, `AffectEvent` models EXACTLY per spec §2 (PAD mood + cached baseline, emotions JSON, closeness/peakCloseness/stage, two-process sleep fields, stateAt/version/lastDecayDay, reflection accumulator). Add relations on `Persona`. SQLite WAL + busy_timeout pragmas at boot (prisma.service onModuleInit). prisma 6.19.3. Also add `Persona.lastUserAt DateTime?` if not present (closeness decay needs it; reuse existing if there).
2. `src/engine/state.ts` — PURE, deterministic functions (clock + rng injected, NO Date.now()/Math.random() inside) per spec §3:
   - `advanceState(s, dtSec, passport, clock, rng)` — emotion decay → virtual emotion center → mood decay toward baseline → ALMA pull → tanh clamp → energy (call computeEnergy) → once/day closeness decay (gated lastDecayDay, skipped in memorial). Closed-form so `advance(advance(s,a),b) == advance(s,a+b)` (write a test for the semigroup property).
   - `computeEnergy(s, passport, clock)` — Borbély S + Folkard circadian C + ultradian U + sleep-inertia W → [0,1], per spec.
   - `octantLabel` already in passport.ts — reuse.
   - `appraise(event, passport, closeness)` — event→active-emotion impulse (rule table + EMA intensity), PAD_DIR table per spec.
   - `mulberry32`/`fnv1a` seeded RNG (reuse the existing FNV in personas.service if present).
   - Export the tunable `K` constants block (per spec) so Passport.tuning can override.
3. `src/personas/persona-state.service.ts` — the compute-on-read wrapper:
   - `read(personaId)`: load PersonaState (create from passport.baselinePAD + closenessSeed if missing), compute `dt = now - stateAt`, run `advanceState`, persist with OPTIMISTIC LOCK `updateMany where {personaId, version}` + `version: {increment:1}`; on 0-rows reload+retry (max 3). Return the advanced snapshot incl. `_derived {energy, mood, octant, currentActivity, presence}`.
   - `applyEvent(personaId, event)`: read → push appraised emotion + closeness delta → persist (same lock) → write an `AffectEvent` row (audit).
   - Memorial mode: closeness decay disabled; agenda/activity muted (presence = remembrance framing).
4. `src/personas/agenda.service.ts` — daily agenda (spec §4):
   - `ensureToday(personaId, passport)`: if no `DailyAgenda` for (personaId, localDate in persona tz), generate. COST: if a same-weekday agenda exists, CLONE + jitter startMin (seeded rng), `byLLM=false`; else ONE DeepSeek call (EXTRACT_MODEL) producing contiguous blocks summing 1440 incl wrap-around sleep. Use a real tz lib for local time (add `date-fns-tz` or Luxon — pin exact; DST correctness is REQUIRED).
   - `currentActivity(agenda, clock, tz)`: pure clock lookup → {activity,label,busy,valence,arousal,nextLabel,minsUntilNext}. Feeds presence + prompt + proactive opener + a weak ambient emotion (intensity ~0.15) into the tick.
   - Nightly reflection: at simulated bedtime OR importanceSinceReflect>150, ONE DeepSeek call → 2-4 reflection Memory rows (kind='reflection') + a day-summary seed for tomorrow; reset accumulator + cooldown. Skip in memorial.
5. Presence: replace the hash-only `presenceFor` in personas.service with an energy+agenda-derived state machine (online/idle/busy/asleep/last_seen) per spec §1/circadian, keeping the FNV hash only as the online-flicker RNG seed. Derive quiet-hours FROM the sleep window. Presence text can be richer ("probably at work", "asleep"). Memorial: remembrance framing, no fabricated activity.
6. Prompt: upgrade the `## Your current state` block in `buildSystemPrompt` to use LIVE values from `persona-state.read()` — current octant+adverb from live mood, energy descriptor bucket, current activity line, closeness STAGE (live, capped by pinnedMaxStage). Keep the guard. All paths (chat/voice/call/proactive) read ONE snapshot per request and pass it in. Grounding: she may reference only the current/past agenda block + retrieved memories.
7. Chat turn hook (chat.service): after a turn, classify the exchange depth/reciprocity (lexicon via existing tokens()), call `applyEvent` to bump closeness + push an emotion, write AffectEvent. (No per-message LLM.)
8. Proactive rewire (proactive.service): the EVERY_MINUTE cron becomes a thin LLM-free gate `shouldTextFirst(state, passport, clock)` = f(stage, energy, quiet-hours, current free slot, silence-since-lastUser, Poisson λ, cooldown), HUMAN-paced base gap `clamp(20·(1.6−0.7·c/100)·proactivityScale, 8, 96)` hours, subordinate to existing MAX_CONSECUTIVE_PROACTIVE=3 + quiet-hours skip. Opener wording anchored to current activity ("just got back from <activity>"), never guilt-trips. Reuse existing nudge generation + cleanReply.
9. Tests (REQUIRED — these formulas must be right): unit tests for advanceState (semigroup, decay-to-baseline, emotion decay), computeEnergy (24h trace shape: morning rise, ~14:00 dip, night low; lark vs owl shift; DST day), closeness (gain diminishing, soft decay to floor, memorial no-decay), octant labels. Use injected clock/rng.

Verify (curl + tests): migration applies; tsc+build clean; tests pass; boot; on a ready persona GET detail/presence reflects energy (asleep at her night, active by day); a chat turn moves closeness + writes an AffectEvent; the prompt state block shows a LIVE octant + activity (log once); nudge cadence is the human-paced gap. Kill server after.

## Frontend (web) — light
- Presence already renders (online/last-seen) — ensure the richer presence labels (busy/asleep/at-activity) display; add any new i18n keys (ALL 6 locales). Optionally a subtle mood cue on the persona profile (NOT a number — e.g. a soft word/dot), only if low-risk. No big UI.
- tsc + build clean.

## Report
Backend: migration name, the 3 models, where compute-on-read is wired, presence state machine, proactive gate formula, test results. Frontend: presence labels + i18n keys.
