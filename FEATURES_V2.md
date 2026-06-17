# Echo — Feature batch v2 (realism + multimodal + voice)

Backend = `api/` (NestJS, :3048, Prisma+SQLite). Frontend = `web/` (Next, :3047, light Telegram chat, English UI). Build against THIS contract; frontend codes to the contract, not the api/ folder. Keep current design/copy. npm cache prefix: `npm_config_cache=/Volumes/Games/1M/.npmcache`.

Models via OpenRouter (`OPENAI_BASE_URL`, `OPENROUTER_API_KEY`): chat = `deepseek/deepseek-chat`. ADD `VISION_MODEL=qwen/qwen-2.5-vl-7b-instruct` (vision captioning). STT + image gen via fal (`FAL_KEY`): `FAL_STT_MODEL=fal-ai/whisper`, selfie `FAL_EDIT_MODEL=fal-ai/qwen-image-edit`. Every new model/env added to `api/.env.example` (and `api/.env` keeps existing keys — do NOT overwrite the live keys already there).

---

## DB migration (additive, `prisma migrate dev --name v2`)
`ChatMessage` add: `kind String @default("text")` ('text'|'image'|'voice'|'selfie'), `imageFile String?`, `audioFile String?`, `transcript String?`, `proactive Boolean @default(false)`, `readAt DateTime?`.
`Persona` add: `lastUserAt DateTime?`, `lastPersonaAt DateTime?`, `nextNudgeAt DateTime?`.

---

## BACKEND tasks

### 1. Selfie robustness (`selfie.service.ts` / `fal-edit.ts`)
- Wrap fal call: on fal 403/Forbidden or content-moderation rejection, RETRY once using an avatar-pack photo (kind 'avatar') instead of the original upload; if still failing, return HTTP 422 `{error:'photo_rejected', message:'Could not generate from this photo — try a clearer face photo.'}`. Missing key stays 501. Timeout/other → 502 `{error,message}` (friendly). Always log the raw fal error server-side.
- The generated selfie is also persisted as a ChatMessage (kind 'selfie', imageFile=<file>, role 'assistant') so it shows in history and counts as persona activity (sets lastPersonaAt). Return `{file, messageId}`.

### 2. Vision — user sends a photo to the persona
- `POST /personas/:id/chat` becomes multipart-capable. Accept EITHER JSON `{message}` (as today) OR multipart with optional `image` file + optional `message` text + optional `audio` file (see voice). Keep SSE response.
- If an image is attached: save it (Photo? no — store under data/photos/<id>/ as `usermsg-<ts>.<ext>`), create a user ChatMessage kind 'image' imageFile=<file> content=<message||''>. Caption it via `VISION_MODEL` (OpenRouter chat with image_url data URL or fal-uploaded URL; prompt: "Describe this photo in one vivid sentence, focusing on what matters emotionally — who/what is in it, mood, setting."). Inject into the persona prompt as a synthetic context line: `[${userAuthor} sent a photo: ${caption}]` appended to the user turn content. Persona then reacts in-style via normal chat stream.
- Helper `captionImage(buf, mime): Promise<string>` in `engine/vision.ts`. No key / vision failure → caption = "(a photo)" so chat still flows.

### 3. Voice in — user records a voice message
- In the same multipart `chat` endpoint: if `audio` attached, save as `usermsg-<ts>.<ext>`, transcribe via `FAL_STT_MODEL` (fal-ai/whisper, upload blob → run → text). Create user ChatMessage kind 'voice' audioFile=<file> transcript=<text> content=<text>. Feed transcript to the persona as the user turn. SSE reply as normal.
- Helper `transcribeAudio(buf, mime): Promise<string>` in `engine/stt.ts`. Fal whisper supports language auto-detect; pass language hint 'uk' if available. No key → 501 `{error:'stt_unavailable'}`.
- `GET /personas/:id/audio/:file?t=<token>` serves stored audio (like photos route).

### 4. Ask persona for a photo (in-chat)
- Keep `POST /personas/:id/selfie`. Additionally: in the chat stream, if the persona's own reply contains a marker `[[SELFIE: <short scene>]]`, the backend strips the marker from the streamed text, fires a selfie generation with that scene as hint, and after the text reply persists a selfie ChatMessage. Add to the system prompt (engine/prompt.ts) rule 8: "If asked for a photo/selfie and it feels natural, you MAY end your reply with a line exactly like `[[SELFIE: cozy cafe, smiling]]` (English scene, SFW) — at most once per reply; otherwise never write it." The chat endpoint must detect the marker across streamed tokens, NOT emit it to the client, and enqueue the selfie. Stream a small SSE event `data:{"selfie":"pending"}` then, when ready, `data:{"selfie":"<file>"}` (frontend appends image bubble); on selfie failure emit `data:{"selfie":"failed"}`.

### 5. Proactive messaging + unread (realism)
- On each user chat turn: set `lastUserAt=now`, clear unread on that persona (set readAt on delivered proactive msgs), and schedule `nextNudgeAt = now + random(20–90 min)` (CONFIG via env `NUDGE_MIN_MIN=20`,`NUDGE_MAX_MIN=90`; for testing allow override).
- NestJS scheduler (`@nestjs/schedule` `@Cron` every 1 min, or setInterval in a service): for each ready persona where `nextNudgeAt <= now` AND last message was not already an unanswered proactive one (don't double-nudge): generate ONE short persona-initiated message via the chat model with a system instruction to write a natural unprompted text ("she texts first" — context-aware: if user silent long, a gentle "як ти там? чgot зник" in HER style; vary tone). Save as assistant ChatMessage proactive=true, set lastPersonaAt, set nextNudgeAt = now + random window again (so she may nudge again later, escalating slightly). Cap: no more than 3 consecutive un-read proactive messages, then stop until user replies.
- `POST /personas/:id/nudge-now` (dev/testing): force-generate one proactive message immediately (ignores schedule). Returns the message.
- Unread: a proactive (or selfie) message with `readAt=null` counts as unread. `GET /personas` includes `unread:number` and `lastMessage:{content,kind,createdAt}` per persona. `POST /personas/:id/read` sets readAt=now on all unread. 
- `GET /inbox` → `{personas:[{id,name,unread,lastMessage,avatarFile}], totalUnread}` for badges + a global poll. Lightweight, no heavy joins.

### Backend verification (required)
`npx prisma migrate dev` ok; `npm run build` + `npx tsc --noEmit` clean; boot and curl: multipart chat with an image returns SSE + persists image msg; `POST /nudge-now` returns a proactive msg and it appears unread in `/inbox`; selfie persists a message. Report starts `BACKEND: PASS|FAIL`.

---

## FRONTEND tasks (web/, keep design + English copy)

### api.ts additions
- `chatMultipart(id, {text?, imageFile?, audioBlob?})` → returns SSE Response (FormData; the SSE reader already exists; handle the extra `selfie`/caption events: extend readSse usage or add a typed event callback).
- `inbox()` → `{personas, totalUnread}`; `markRead(id)`; `nudgeNow(id)` (dev); `audioUrl(id,file)`.
- Extend message type with kind/imageFile/audioFile/transcript.

### Composer (src/components/chat/Composer.tsx + chat page)
- Add a "+" attach button → photo from file input (accept image/*) → preview chip → send as image message (renders a user image bubble + optional caption).
- Add a mic button → press-and-hold or tap-to-start/stop record via MediaRecorder (audio/webm or audio/mp4) → on stop, show a small "voice ..." sending state → upload → on result render a user VOICE bubble showing the transcript + a tiny play control (audio via audioUrl). Graceful fallback if MediaRecorder/permission unavailable (hide mic, show note).
- Persona image replies (kind 'image'/'selfie') render as image bubbles (photoUrl). Persona voice replies: not in v2 (text only) — but render transcript if present.
- The `[[SELFIE]]` flow: when SSE yields `selfie:pending`, show a "sending a photo…" typing-style placeholder; on `selfie:<file>` append persona image bubble; on failed, show small "couldn't send a photo" line. Keep humanized pacing for text.
- Selfie button (existing "Ask for a photo"): on 422/502 show the friendly message inline (not raw "Forbidden").

### Realism UI
- Unread badges: blue pill with count on each contact row (src/app/contacts or home list) and a badge on the Chat tab in TabBar. Source = `inbox()` polled every ~25s while app is open (and on focus). 
- Chat screen: poll `getMessages` (or inbox) every ~15s while open; when new proactive persona messages arrive, reveal them with the humanized pacer (typing → bubble) as if she just wrote; auto-mark read when the chat for that persona is open (`markRead`).
- In-app notification: a small glass banner sliding from top ("Майя · як ти там?") when a proactive message arrives while you're NOT on that chat; tap → open chat. (No real OS push in dev; this is the in-app version. Note in code where web-push would hook later.)
- Entering a chat calls markRead and clears that persona's badge.

### Frontend verification
`npx tsc --noEmit` + `npm run build` clean. Report starts `FRONTEND: PASS|FAIL`, max 18 lines, list new components/files + any contract points you adjusted.
