# V4 — voice gating + live memory + presence realism (with UI)

Three things, all must ship with UI. Backend owns `persona-app/api`, frontend owns `persona-app/web`. A parallel session may also touch web/ — frontend agent: read each file fresh right before editing, make ADDITIVE/surgical changes, never rewrite whole files, preserve existing i18n (`useT`/`@/i18n`), presence ("online"/"last seen"), and design.

Keys live in api/.env (OpenRouter + fal funded). prisma pinned 6.19.3 exact. Read env at call-time. npm cache: `npm_config_cache=/Volumes/Games/1M/.npmcache`. Backend run: `node dist/main.js` (kill :3048 first).

---

## 1. Voice ONLY when the user uploaded her voice sample  (REQUIRED)
Today persona voice replies fall back to a preset voice. Change: the persona may reply with voice ONLY when she has a cloned voice from an uploaded sample (`persona.voiceId` set). No preset-voice replies ever.

### Backend (api)
- chat.service.ts: compute `const voiceEnabled = Boolean(persona.voiceId) && hasTtsKey();`. Trigger voice reply only `if ((voiceRequested || userSentVoice) && finalText && voiceEnabled)`. When not enabled: ignore the `[[VOICE]]` marker (still strip it from text — already happens) and reply as text; if the user sent a voice note and voice isn't enabled, reply as text (normal).
- prompt.ts: `buildSystemPrompt(persona, retrieved, now, opts?: { voiceEnabled?: boolean })`. Include rule 9 (the `[[VOICE]]` option) ONLY when `voiceEnabled` is true; otherwise omit it entirely so she never tries to voice-note. Pass `voiceEnabled` from chat.service. (proactive.service builds prompt too → pass voiceEnabled:false there, proactive is text.)
- synthesizeSpeech keeps its preset capability for now but it is simply never reached by replies without voiceId. Voice-sample upload/clone path (POST /personas/:id/voice-sample) stays as-is.

### Frontend (web) — "Her voice" UI in persona profile (`src/app/persona/page.tsx`, new component under `src/components/persona/`)
- New section "Her voice" (localize via existing i18n; add keys to the dictionary used by `@/i18n`):
  - If `detail.hasVoiceSample` (from GET /personas/:id): show "Her real voice is on ✓" with a small note "she can reply with voice notes" + a "Replace voice sample" affordance.
  - Else: a card explaining "Upload a voice note of her (~10+ seconds of clear speech) so she can reply in her own voice" + an upload control (file input accept `audio/*`) AND/OR a record button (reuse the MediaRecorder approach from `src/components/chat/Composer.tsx`). On select/record → POST multipart `audio` to `/personas/:id/voice-sample` (add `uploadVoiceSample(id, blobOrFile)` to `src/lib/api.ts`). Show progress + success (re-fetch detail). Handle 501 (`tts_unavailable` → "voice isn't available right now") and 502 (`clone_failed` → "couldn't process that clip — try a longer, clearer one (10s+)").
- Optional nicety: in the create wizard voice step (currently a "coming soon" stub, `src/components/create/StepVoice.tsx`) wire the same upload so it's offered at creation too — only if low-risk; otherwise leave the stub and do it in the profile.

---

## 2. Live memory — she keeps learning from your ongoing chats
Today memories are frozen at build. Make her remember new things from the live conversation.

### Backend (api)
- After a completed turn (text OR voice), fire-and-forget (do NOT block/delay the SSE response): extract 0–3 NEW durable memories from the latest exchange (the user's turn text + the persona's reply text) using EXTRACT_MODEL, same shape as engine/extractMemories (text/keywords/date='YYYY-MM' of now). Append as `Memory` rows. Dedupe against the persona's recent memories (e.g. last ~50) by normalized-text prefix so nothing repeats. Skip trivial small-talk (let the extraction prompt return [] when nothing is worth keeping). Cap: at most 3 new per turn. This makes `loadPersonaFile` (which reads Memory rows) surface them on the very next turn automatically, and `memoriesCount` grows.
- Put this in a small `MemoryService` (or a method) called from chat.service after streaming completes; guard with try/catch and `hasApiKey()`; never throw into the response path.
- GET /personas/:id: also return `recentMemories: [{text, date}]` (latest ~5 Memory rows, newest first) for the UI.

### Frontend (web) — surface growth in persona profile
- In the "Memories" section of `src/app/persona/page.tsx`: keep facts, and add a small live line like "She remembers {memoriesCount} things and keeps learning as you talk." Render `recentMemories` (newest first) as small glass rows if present. Localize. Purely additive.

---

## 3. Presence realism — read receipts + quiet hours
### Backend (api)
- Read receipts: when `POST /chat` is handled, mark the user's still-unread inbound messages for that persona as read: set `readAt = now` on the user's ChatMessage rows where readAt is null (those the persona is now "seeing"). Ensure GET /personas/:id/messages returns `readAt` per message (add if missing).
- Quiet hours for proactive: in proactive.service `scheduleNextNudge`, avoid night. Use env `QUIET_START_HOUR` (default 23) and `QUIET_END_HOUR` (default 8) and `TZ_OFFSET_HOURS` (default 3, Kyiv). If the next scheduled time lands in the quiet window (in that local tz), push it to QUIET_END_HOUR local that day/next. Also: the EVERY_MINUTE cron should not fire a nudge during quiet hours (skip; it stays scheduled). Keep it simple and correct.

### Frontend (web) — ticks on your messages (`src/app/chat/page.tsx`)
- For user (outgoing) text/image/voice bubbles, show a subtle status: single tick ✓ = sent, double tick ✓✓ = seen. Source of truth: a user message is "seen" once it has `readAt` (from history) OR once any assistant message exists after it in the current session. Optimistic just-sent = ✓; flip to ✓✓ when her reply starts/arrives. Tiny, muted, bottom-right of the bubble. Reuse existing Bubble or add a small status element next to it. Additive; do not restructure the message list.

---

## Verification
- Backend agent: migrate (if any new column — none expected; readAt/Memory already exist) + `npx tsc --noEmit` + `npm run build` clean; boot; curl-verify: (a) persona WITHOUT voiceId never emits a `{voice:...}` SSE event even when asked "скажи голосом" (replies text); set a voiceId on a test persona (or upload a sample) and confirm it DOES; (b) after a couple of chat turns, `Memory` row count for that persona increased and GET detail shows growing memoriesCount + recentMemories; (c) after /chat, the user's prior messages have readAt set; (d) scheduleNextNudge never returns a quiet-hour time. Report `BACKEND: PASS/FAIL` + exact new/changed endpoint fields and any i18n keys the frontend must add.
- Frontend agent: `npx tsc --noEmit` + `npm run build` clean. Report `FRONTEND: PASS/FAIL` + files touched + new i18n keys added.

Voice CALL (real-time) is explicitly OUT OF SCOPE here — it's the next big separate effort.
