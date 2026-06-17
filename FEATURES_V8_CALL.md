# V8 — Call mode (voice conversation with the persona)

A full-screen "call" experience on mobile web: you talk, your speech is transcribed, she replies in HER cloned voice (short, spoken), it auto-plays, then it listens again — a natural back-and-forth (walkie-talkie style turn-taking, not full-duplex; full-duplex realtime is a later upgrade). Reuses the existing pieces: mic record → POST /chat (audio) → STT (fal whisper) → LLM → her cloned-voice TTS. GATED on `hasVoiceSample` (her real cloned voice) — same gate as voice replies; without it, offer to add her voice.

Backend owns `persona-app/api`, frontend owns `persona-app/web`. prisma 6.19.3 exact. Read env at call-time. npm cache `npm_config_cache=/Volumes/Games/1M/.npmcache`. Backend: `pkill -f dist/main.js` first, then `node dist/main.js`. Parallel session may touch web/: read fresh, additive/surgical, preserve i18n (add keys to ALL 6 locales)/presence/design.

## Backend (api) — small
The existing `POST /personas/:id/chat` already: takes multipart `audio`, transcribes (STT), runs the LLM, and (when `voiceEnabled` = voiceId+TTS) returns a voice reply via SSE `{voice:pending|<file>|failed}` plus persists messages. For call mode we want SHORTER, snappier spoken replies and to force voice.
1. Add an optional `mode` field to the chat request (JSON body field and multipart field): `mode?: 'call'`. Plumb it into ChatService.chat.
2. When `mode==='call'`:
   - Force voice if `voiceEnabled` (already auto-forces when userSentVoice, so this is belt-and-suspenders — but also allow a text message in call mode to still come back as voice).
   - Inject a brevity instruction into the system prompt for THIS turn only: "You are on a quick VOICE CALL — reply in 1-2 short spoken sentences, natural and warm, no long monologues, no lists, no markers." (Append after the persona rules; do NOT persist this into the persona.) Lower max_tokens for the turn (e.g. 160).
   - Never emit a `[[SELFIE]]`/photo in call mode (strip/ignore).
   - Still persist the user + assistant messages (a call turn is a real message; kind 'voice' for both as today).
3. If `mode==='call'` but `!voiceEnabled`, respond with a clear 409/422 JSON `{error:'voice_required'}` BEFORE streaming so the frontend can tell the user to add her voice. (Normal chat is unaffected.)
Verify: curl a call-mode turn (text message + mode:'call') on a persona WITH a voiceId → returns a `{voice:<file>}` event and the reply is short; on a persona WITHOUT voiceId → `{error:'voice_required'}`. tsc+build clean.

## Frontend (web)
1. `src/lib/api.ts`: extend `chatMultipart`/the chat call to pass `mode:'call'`. Add a helper for call turns if cleaner.
2. New screen `src/app/call/page.tsx` (+ components under `src/components/call/`), route `/call?id=<personaId>`:
   - Full-screen, immersive (her ambient palette as background, large round avatar centered). NOT the normal chat chrome — this is a call UI.
   - Header/center: avatar (large), her name, a call status line + a running call timer (mm:ss).
   - STATES: `connecting` → `listening` (mic open / tap to talk) → `thinking` (after you finish, while STT+LLM+TTS run) → `speaking` (her voice playing, avatar has a pulsing/speaking ring animation) → back to `listening`. Show the current state clearly.
   - MIC: default to TAP-TO-TALK (big mic button: tap to start recording, tap again to send) — robust on mobile. (Optional nicety: auto-send on silence via simple VAD, but tap-to-talk is the required baseline.) Use the MediaRecorder approach already in `src/components/chat/Composer.tsx`.
   - On send: POST /chat multipart `{audio, mode:'call'}`; read SSE; on `{voice:<file>}` fetch the audio (audioUrl with token) and auto-play it via an `<audio>`/AudioContext; while playing → state `speaking` + animate. When playback ends → return to `listening` (optionally auto-arm the mic so it feels continuous; provide a setting/toggle or just re-arm).
   - LIVE TRANSCRIPT (small, optional, toggle): show your transcribed line + her reply text under the avatar so the user can follow. Keep it subtle.
   - CONTROLS (bottom): big round mic (talk), an End-call button (red) → router.back()/to /chat, and a mute toggle. Tap targets ≥56px.
   - GATE: on load, GET /personas/:id; if `!hasVoiceSample` → show a centered card "Add {name}'s voice to call her" + button → `/persona?id=...` (HerVoice). If voice exists, proceed.
   - Handle errors gracefully (mic denied → message; voice_required → the gate card; network → retry).
3. Entry point: add a **call/phone icon** to the chat header (`src/app/chat/page.tsx` GlassBar right slot, next to the AI badge) → navigates to `/call?id=`. Only show/enable it when the persona has a voice sample (else it can route to the gate which explains).
4. i18n: all call UI strings in ALL 6 locales (status: Connecting/Listening/Thinking/Speaking, "Tap to talk", "End", "Mute", "Add {name}'s voice to call her", call timer label, transcript toggle).
5. Respect `prefers-reduced-motion` for the speaking animation.

Verify: `npx tsc --noEmit` + `npm run build` clean. In preview, the call screen renders, shows the gate when no voice, and (with a voiced persona) the state machine + controls render. (Full mic capture can't be exercised headlessly — at least confirm UI states + the gate + that tapping mic requests permission.)

Report: backend — call-mode behavior + voice_required; frontend — files touched, new i18n keys, the call UX + states, anything deferred (full-duplex/VAD).
