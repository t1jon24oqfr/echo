# V3 — Persona voice replies (TTS "her voice")

Goal: the persona can answer with a VOICE message (audio bubble + transcript), spoken in a natural Ukrainian-capable voice — and in HER cloned voice when a sample is available. STT (user voice → text) already works; this adds the outbound direction. Keep everything on the existing FAL_KEY (fal hosts both clone + TTS).

## Backend only (persona-app/api) — DO NOT touch persona-app/web (a parallel session edits it)

### Models / env (.env + .env.example, append)
- `FAL_TTS_MODEL=fal-ai/elevenlabs/tts/multilingual-v2`  (preset-voice TTS, strong Ukrainian)
- `FAL_TTS_VOICE_FEMALE=Sarah`  `FAL_TTS_VOICE_MALE=Brian`  (ElevenLabs preset voice names; reasonable UA-capable defaults — keep as env so they're tunable)
- `FAL_VOICE_CLONE_MODEL=fal-ai/minimax/voice-clone`  (sample → reusable voice id)
- `FAL_TTS_CLONE_MODEL=fal-ai/minimax/speech-02-hd`    (TTS that accepts a cloned voice id; supports Ukrainian)
Read every value at call-time (process.env.X ?? default), never at module top — same bug we already hit with VISION_MODEL.

### DB (Prisma migration, name `v3_voice`; keep prisma 6.19.3 exact)
Add to `Persona`:
- `voiceId String?`        // cloned voice id once a sample is processed
- `voiceGender String?`    // 'female' | 'male' — chosen at build from the card/relationship; drives preset fallback
- `voiceSampleFile String?`// stored her-voice sample filename (under data/photos/<id>/ or a voice/ subdir)

### Engine: src/engine/tts.ts (new, framework-free, mirrors stt.ts/vision.ts style)
- `export class TtsUnavailableError extends Error {}`
- `export async function synthesizeSpeech(text: string, opts: { voiceId?: string|null; gender?: string|null }): Promise<{ buffer: Buffer; ext: string }>`
  - if no FAL_KEY → throw TtsUnavailableError.
  - if `voiceId` present → use FAL_TTS_CLONE_MODEL with that voice id (minimax: `{ text, voice_setting:{ custom_voice_id: voiceId }, ... }` — check fal schema, adapt).
  - else → use FAL_TTS_MODEL (elevenlabs) with the gender-appropriate preset voice name; language Ukrainian/auto.
  - download resulting audio url → return buffer + ext (mp3 typical). 30s timeout, never leak raw provider errors.
- `export async function cloneVoice(sample: Buffer, mime: string): Promise<string>` — upload sample to fal storage, run FAL_VOICE_CLONE_MODEL, return the new voice id. Throws on failure.

### StorageService: add `saveAudio(personaId, name, buf)` + a `voiceDir` if not already (audio can live alongside photos; the existing GET /personas/:id/audio/:file route already serves from wherever audioFile points — match that path).

### Chat: src/personas/chat.service.ts
Persona decides to reply with voice in two cases:
1. The user's current turn was a voice message (attachments.audio present) → reply as a voice note (natural — she "voice-notes back").
2. The model opts in via a marker `[[VOICE]]` anywhere in its reply (add a prompt rule, mirror the existing `[[SELFIE]]` handling: strip it from visible tokens, hold-back logic included).
When voice is triggered:
- Collect the full visible reply text (all bubbles joined with a space / newline).
- `synthesizeSpeech(text, { voiceId: persona.voiceId, gender: persona.voiceGender })` → saveAudio → persist ONE assistant ChatMessage `{ kind:'voice', audioFile, transcript: text, content: text }`.
- SSE: stream the text tokens as usual BUT also emit `data: {"voice":"pending"}` when synthesis starts and `data: {"voice":"<file>"}` when ready (or `{"voice":"failed"}` on error → fall back to the already-streamed text bubbles, persisted as normal text). Mirror the selfie event shape exactly so the frontend can reuse the pattern.
- Decision: if voice succeeds, do NOT also persist the text bubbles as separate messages (the voice message carries the transcript). If it fails, keep the text bubbles. Keep this clean — no double messages.

### Prompt (src/engine/prompt.ts): add rule
`9. You MAY reply with a voice message instead of text by putting [[VOICE]] on its own line anywhere in your reply — do this occasionally when it feels warm/natural (a few words, a laugh, missing someone), never every time. When you do, still write the words you're saying; they become the spoken audio.`
Also: when the user just sent you a voice message, prefer replying with voice.

### Build (src/personas/build.service.ts): set `voiceGender`
At build, infer gender from the persona card / name / relationship via the existing extract LLM (cheap: one tiny classification, or reuse fields already extracted). Default 'female' if unknown. Store on persona. (No cloning at build — cloning happens when a sample is uploaded.)

### Endpoint: voice sample upload (her real voice)
`POST /personas/:id/voice-sample` (multipart, field `audio`, reuse audio mime allowlist) → save sample, `cloneVoice()` → store `voiceId` + `voiceSampleFile` → `{ ok:true, voiceId }`. 501 `{error:'tts_unavailable'}` if no key, 502 `{error:'clone_failed'}` on fal error. Also expose `voiceId`/`voiceGender`/has-sample in `GET /personas/:id` so the frontend can show "her real voice ✓ / using a stand-in voice".

## Verification (curl, report `VOICE: PASS`/`FAIL`)
1. migrate + build + tsc clean; server boots.
2. Existing persona: `POST /chat {message:"скажи голосом що скучила"}` — model emits [[VOICE]] → SSE shows `{"voice":"pending"}` then `{"voice":"<file>.mp3"}` then `[DONE]`; the audio file exists on disk and is non-empty; a `GET /personas/:id/audio/<file>?t=<token>` returns 200 audio.
3. Reply-to-voice: send a multipart audio turn → response comes back as a voice message.
4. No-key path is graceful (text fallback).
Report which fal TTS request/response shapes you actually used (so the frontend/docs match), and any deviations.

## Machine notes
npm: `npm_config_cache=/Volumes/Games/1M/.npmcache`. Backend run: `node dist/main.js` (kill :3048 first). Keys already in api/.env. Do not commit; do not touch web/.
