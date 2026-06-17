# Phase 3 — Behavior Layer (alive texting micro-behaviors) + embeddings

Implements PHASE 3 (final) of the living-persona spec. READ FIRST: `persona-app/docs/specs/2026-06-16-living-persona-design.md` sections 6 (behavior model — exact probability functions/constants), 7 (prompt/retrieval), 9 (phasing). Phases 1+2 are DONE: Passport (`engine/passport.ts`), and the Inner-Life State Engine (`engine/state.ts` advanceState/computeEnergy, `persona-state.service` compute-on-read snapshot with `_derived {energy, mood, octant, closeness/stage, currentActivity}`). This phase turns that state into OBSERVABLE micro-behaviors and adds embedding retrieval.

SCOPE: the highest realism-per-line behaviors, layered on the live state. Per spec §6: delay ALONE reads dumb — delay + VISIBLE SELF-CORRECTION reads natural; NEVER ship uncorrected typos. Keep rare behaviors rare. Bake variance (sample per message via the seeded rng). All behavior decisions are server-side pure functions of (mood, energy, closeness, message-type, passport knobs); the LLM only renders text; the EXISTING `web/src/components/chat/pacing.ts` consumes state-driven params.

Backend `persona-app/api`, frontend `persona-app/web`. prisma 6.19.3; read env at call-time; npm cache `npm_config_cache=/Volumes/Games/1M/.npmcache`; backend run `pkill -f dist/main.js` then `node dist/main.js`. COORDINATION: parallel session shares api/ + :3048 — read files FRESH, additive/surgical, never rewrite whole files; don't needlessly restart their backend.

## Backend
1. `src/engine/behavior.ts` — PURE functions of the live state snapshot + passport knobs + message-type + seeded rng (spec §6), each individually toggleable, deterministic/testable:
   - `replyLatency(state, passport, msgType, chars, rng)` → {acknowledgeMs, composeMs}: two-phase, heavy-tailed (log-normal acknowledge clamp 2s..1800s with μ reduced by closeness & energy; compose from chars·(1000/cps)·energyFactor, WPM~N(38,8) clamp[25,90]); BUSY OVERRIDE: if current agenda block busy/asleep, acknowledge = time-until-block-ends (the believable long tail); <250ms only for instant emoji reactions.
   - `burstCount(state, passport, newsFlag, rng)` → k=1+Poisson(λ), λ=0.3+0.7·arousal+0.4·extraversion+0.8·news, clamp≤4.
   - `replyLengthHint(state, passport, msgType)` → target words (Gamma mean = 8·(0.6+0.8·E)·(0.7+0.6·extraversion)·typeMult), surfaced to the LLM as a soft "keep it ~N words" directive (NOT a hard truncate).
   - `emojiPolicy(state, passport, msgType)` → {pEmoji, pEmojiOnlyReaction}: P(emoji)=σ(−1.2+1.8·c+1.0·valence+0.8·agreeableness+0.7·banter−1.5·logistics); P(emoji-only)=0.12·banter_or_ack·c·(1−emotional) FORCED 0 on emotional-disclosure or a direct question.
   - `selfCorrection(state, chars, rng)` → maybe {typedPartial, backspaceN, finalWord}: P=clamp(0.05+0.07·(len>12)+0.04·high_arousal,0,0.15). Operate on ONE word; never random chars; final text has NO typo.
   - `seenPolicy(state, passport)` → show 'seen' only when reply imminent OR closeness stage≥3 (passport.knobs.readReceipts can force off/always); `typingThenStop` P<0.05 stage≥4 only.
   These map onto the SSE/pacing contract: emit per-turn behavior params over the chat SSE so the client drives pacing + renders reactions/corrections.
2. Chat SSE additions (chat.service): alongside existing token/voice/selfie events, emit:
   - `{behavior: {readDelayMs, perBubbleTyping[], gapMs[], bubbleCount}}` (early, so pacing uses state-driven values instead of pacing.ts hardcoded defaults);
   - `{reaction: "<emoji>"}` when emojiPolicy fires an emoji-only reaction (no text turn);
   - `{correct: {bubbleIndex, typed, backspace, fix}}` for a visible self-correction;
   - keep `{voice}`/`{selfie}` as-is. Gate `seen`/typing-stop via seenPolicy.
   The LLM reply length is nudged via the prompt directive from replyLengthHint.
3. Clean goodbye handler: detect a farewell intent (lexicon) → a warm, brief close that contains NONE of the 6 HBS dark-pattern farewell tactics (no guilt, no "don't go", no FOMO, no neediness). Snapshot-test the output against a banned-pattern list. The ANTI_MANIPULATION_GUARD already covers prompts; this adds an explicit goodbye path.
4. Embeddings retrieval (spec §7 step 2): embed each Memory once at write-time (an embeddings model via OpenRouter/fal — pick one, env `EMBED_MODEL`, store vector as JSON on Memory; add `embedding String?`). Upgrade `retrieveMemories` to Generative-Agents scoring: normalized recency(0.995^h) + importance/10 + cosine(query,mem) blend; bump `lastAccessedAt` on retrieval; FALLBACK to the existing keyword tokens() matcher when no embedding/key. Backfill embeddings lazily (on read or a one-shot) — never block a turn.
5. Live-tunable constants: honor `passport.tuning` overrides of the global `K` block (per-persona), mirroring the redis-config A/B pattern; expose nothing new to the user UI beyond existing knobs.
6. Tests: behavior functions are pure → unit-test the probability bounds + the busy-override latency + "no uncorrected typo in final text" + goodbye snapshot (contains none of the banned patterns) + cosine retrieval ordering.

Verify (curl + tests): tsc+build clean; tests pass; a chat turn emits a `behavior` event with state-driven pacing; occasionally a `reaction`/`correct` event (force via seeded rng in a test); 'seen' suppressed for a stage<3 persona; embeddings backfill works and retrieval uses cosine when present. Kill server after.

## Frontend (web)
1. `pacing.ts` + chat page: consume the `{behavior}` SSE event → feed PacerOptions (readDelayMs/typing/gaps/bubbleCount) from the server values instead of the local defaults (keep local defaults as fallback when the event is absent).
2. Render `{reaction: emoji}` as an emoji reaction on the user's last bubble (small, like a tapback) rather than a normal bubble.
3. Render `{correct}` as a visible self-correction animation in the streaming bubble (type partial → backspace → fix); subtle, respects prefers-reduced-motion. NO uncorrected typos ever shown.
4. Apply seen-gating from server (only show ✓✓ when the server says so).
5. i18n any new strings, ALL 6 locales.
CRITICAL: parallel session may edit web/ (esp. chat/page.tsx, pacing.ts) — read FRESH, additive/surgical, never rewrite; preserve i18n/design.
Verify: tsc + build clean; in preview a chat turn still streams and bubbles pace per the server event (full mic/edge behaviors can't all be exercised headlessly — confirm the event is consumed + no regression).

## Report
Backend: behavior.ts functions + the new SSE events, goodbye handler, embeddings model + retrieval, test results. Frontend: pacing/reaction/correction rendering, seen-gating, i18n. Note anything deferred.
