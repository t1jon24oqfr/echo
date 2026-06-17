# Echo — API contract (backend `api/` NestJS :3048 ⇄ frontend `web/` Next :3047)

Goal: real working product once keys are set. Frontend is a pure API client (store-ready: later wrapped with Capacitor unchanged). Backend owns DB, engine, LLM (OpenRouter) and image gen (fal.ai).

## Backend — persona-app/api (NestJS 11, TypeScript strict)
- Prisma + SQLite (`DATABASE_URL="file:./dev.db"`), schema Postgres-compatible (no SQLite-only types; Json via `String` columns storing JSON if needed for sqlite compat — use Prisma `Json`? sqlite supports Json in Prisma as TEXT — fine). PIN `prisma` and `@prisma/client` to the SAME exact version (estate had a crash-loop from version skew).
- Engine: copy `web/src/lib/engine/**` → `api/src/engine/**` (it is framework-free TS; keep llm.ts throwing `NO_API_KEY`).
- File storage: `api/data/` → `corpora/<personaId>.json`, `photos/<personaId>/<file>`. Raw corpus file is DELETED after successful build (privacy policy); derived data lives in DB.
- Env (`.env.example`): `PORT=3048`, `CORS_ORIGIN=http://localhost:3047`, `DATABASE_URL`, `OPENROUTER_API_KEY`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, `EXTRACT_MODEL=deepseek/deepseek-chat`, `CHAT_MODEL=deepseek/deepseek-chat`, `MAX_MEMORY_CALLS=12`, `FAL_KEY`, `FAL_EDIT_MODEL=fal-ai/qwen-image-edit`.
- CORS: origin from env, allow header `x-device-token`. Global validation pipe. No auth beyond device token (MVP).

### DB (Prisma models)
- `User { id cuid, deviceToken unique, createdAt }`
- `Persona { id cuid, userId FK, name, relationship, mode ('memorial'|'reconnect'), description?, ambient Json?, status ('draft'|'ingested'|'building'|'ready'|'failed'), stage?, demo Boolean default false, personaAuthor?, userAuthor?, stats Json?, card Json?, exemplars Json?, createdAt }`
- `Memory { id, personaId FK, text, keywords Json, date? }`
- `Photo { id, personaId FK, file, kind ('upload'|'selfie'), createdAt }`
- `ChatMessage { id, personaId FK, role ('user'|'assistant'), content, createdAt }`

### Endpoints (all JSON unless noted; auth = header `x-device-token`, 401 if unknown except /auth)
- `POST /auth/device {}` → `{token}` (create user; idempotent if token sent and exists)
- `GET /personas` → `[{id,name,relationship,mode,ambient,status,demo,photoCount,createdAt}]`
- `POST /personas {name,relationship,mode,description?,ambient?}` → persona (status `draft`)
- `GET /personas/:id` → `{...persona, stats, card, memoriesCount, photos:[{file,kind}], stage}`
- `PATCH /personas/:id {description?,ambient?,name?}` → persona
- `DELETE /personas/:id` → `{ok}` (DB rows + files)
- `POST /personas/:id/ingest {source:'telegram'|'whatsapp'|'instagram', content?, me?, demo?}`:
  - demo=true → load fixture from `api/fixtures/sample-telegram.json` (copy from proto), me='Alex'.
  - no/invalid `me` → `{authors:[{name,count}]}`; else parse+segment(12mo)+stats → save corpus file, persona.stats, personaAuthor/userAuthor, status `ingested` → `{stats, personaAuthor, userAuthor, conversations}`
- `POST /personas/:id/photos` multipart field `photos` → `{files}` (jpeg/png/webp only, 10MB cap)
- `GET /personas/:id/photos/:file?t=<deviceToken>` → image bytes (token via query because <img> can't set headers)
- `POST /personas/:id/build` → 202 `{status:'building'}`; runs async in-process: stage `card` → `exemplars` → `memories` → status `ready` (deletes corpus file). No OPENROUTER_API_KEY → stub build from stats+exemplars, demo=true (same as web demo logic). Failure → status `failed` + stage=error message. Re-POST allowed when `failed`/`ready` IF corpus still exists; else 409.
- `GET /personas/:id/messages?limit=100` → `[{role,content,createdAt}]`
- `POST /personas/:id/chat {message:string}` → **SSE** stream `data:{"token":...}` / `data:[DONE]`; server loads last 30 messages from DB + persists both user msg and final assistant msg. No key → stream 2 exemplar lines with 400ms delay.
- `POST /personas/:id/selfie {hint?:string}` → if no `FAL_KEY`: 501 `{error:'FAL_KEY missing'}`. Else: take first upload photo, `@fal-ai/client` `fal.storage.upload` + run `FAL_EDIT_MODEL` with prompt "same person, casual phone selfie, {hint}, natural lighting, realistic" → download result → save as Photo kind 'selfie' → `{file}`. 30s timeout, clear error JSON on fal failure.
- `POST /reset` → wipe ALL data of this user (dev convenience).

## Frontend — persona-app/web changes (KEEP current light iOS/Telegram design and English copy exactly as-is)
- `src/lib/api.ts`: base = `process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3048'`; device token bootstrap (`localStorage 'echo.device'`, POST /auth/device on first need); helpers for all endpoints incl. SSE reader; photo URL builder appending `?t=` token.
- DELETE all `src/app/api/**` routes and `src/lib/store.ts` (backend owns them now). Engine stays only in backend.
- Wizard: step 1 "Next" → POST /personas (store id in component state); photos step → POST photos + PATCH ambient; chat step → ingest endpoints (same two-phase authors flow, demo button); describe → PATCH description; consent → POST build → building screen polls GET /personas/:id (stage text) → meet screen: POST chat 'hi' SSE.
- Home: real multi-persona list from GET /personas; "+ Create another" now navigates to /create (enabled).
- Chat: history from GET messages (drop localStorage as source of truth; keep disclaimer logic client-side), send via POST chat SSE; selfie chip → POST selfie → on `{file}` append an image bubble (img via photo URL); on 501 show the Phase-2 stub card as before.
- Persona/settings: use backend (DELETE persona = farewell; /reset for delete-all). Multi-persona: /chat and /persona take `?id=` (fallback: first persona).
- Store-readiness: add `public/manifest.json` (name Echo, display standalone, theme `#EFEFF4`), link in layout metadata, simple icon placeholder; NO server-only logic in pages (everything через api client) — Capacitor wrap later needs zero changes.

## Verification (final agent)
1. `api`: `npx prisma migrate dev` ok, `npm run build` ok, start :3048.
2. `web`: `npx tsc --noEmit` + `npm run build` ok.
3. End-to-end via curl: auth → create persona → ingest demo → build → poll to ready → chat SSE returns tokens → messages persisted → selfie returns 501 without FAL_KEY.
4. Report MUST start `E2E: PASS` or `E2E: FAIL` + details.

Machine notes: npm needs `npm_config_cache=/Volumes/Games/1M/.npmcache`. Ports busy check: web dev server may already run on :3047.
