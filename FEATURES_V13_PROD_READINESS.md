# Step A — Production readiness (Postgres + R2 + Docker) for DigitalOcean App Platform

Make Echo deployable & durable on DO App Platform. Target: estate DO account (separate project), Cloudflare R2 for media, domain **exchat.ai** (web) + **api.exchat.ai** (api). This step is CODE ONLY — no cloud resources are created here (that's Step B). Brand text stays "ECHO" placeholder (do NOT rename); only hosting/config uses exchat.ai.

The blockers (App Platform containers have EPHEMERAL filesystems — anything on local disk is wiped on every deploy/restart): (1) Prisma is SQLite, (2) media is written to local `data/`, (3) no Dockerfile and visual-import needs system ffmpeg.

prisma pinned 6.19.3 exact. npm cache `npm_config_cache=/Volumes/Games/1M/.npmcache`. Read env at call-time. Parallel session shares api/ on :3048 — read files FRESH, additive/surgical, never rewrite whole files; `pkill -f dist/main.js` before running.

## Backend (api)
1. **Prisma → PostgreSQL** (the prod DB is fresh — no data to preserve; local dev SQLite is disposable):
   - `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }`.
   - Delete the old SQLite migrations folder and create ONE fresh Postgres baseline migration `init` from the current schema (all existing models/columns IDENTICAL — keep the JSON-as-String columns as `String`; do NOT convert to `Json` now, avoid churn). Keep prisma + @prisma/client BOTH exactly 6.19.3 (estate footgun: version skew → silent crash-loop).
   - Guard the SQLite-only `PRAGMA journal_mode=WAL / busy_timeout` in prisma.service.onModuleInit so it NO-OPS on Postgres (only run when DATABASE_URL starts with `file:`). The optimistic-lock `updateMany where{...,version}` pattern stays (works on PG).
   - `.env.example`: `DATABASE_URL="postgresql://USER:PASS@HOST:5432/echo?sslmode=require"` + keep a commented sqlite line for local dev.
2. **R2 object storage in StorageService** (S3-compatible; add `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` pinned exact):
   - `STORAGE_DRIVER=local|r2` (default local for dev). R2 env: `R2_ENDPOINT` (https://<acct>.r2.cloudflarestorage.com), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION=auto`.
   - Route EVERY media path through StorageService: savePhoto/readPhoto, corpus read/write/delete, audio save/serve, voice samples, generated selfies+avatars, visual-import raw uploads + pending merged. Keys keep the same logical layout (`personas/<id>/photos/...`, `corpora/<id>.json`, `imports/<id>/...`).
   - SERVE endpoints (photos/audio) must KEEP `?t=` device-token auth: stream bytes from R2 through the API (GetObject → pipe), do NOT make the bucket public and do NOT 302 to a public URL. (A short-lived presigned URL is acceptable only if the API still checks the token first.)
   - The bucket is PRIVATE. Raw chat exports / corpora are deleted after build as today — keep that.
   - Keep the `local` driver fully working so dev needs no R2.
3. **Dockerfile (api)** — multi-stage: base `node:22-slim`; install `ffmpeg` (+ any sharp runtime libs) via apt; `npm ci`; `npx prisma generate`; `npm run build`; final stage runs an entrypoint that does `npx prisma migrate deploy` THEN `node dist/main.js`. Expose 3048. `.dockerignore` (node_modules, dist, data, .env, *.db).
4. **Health endpoint**: `GET /health` → `{ok:true, db:'up'}` (cheap `SELECT 1` via prisma) for the App Platform health check. Public (no guard).
5. **App Platform spec** `.do/app.yaml` (committed, for Step B): 2 services — `api` (dockerfile, **instance_count: 1** because the EVERY_MINUTE proactive cron must be single-instance, http_port 3048, health_check /health, routes `api.exchat.ai`), `web` (dockerfile or node buildpack, env NEXT_PUBLIC_API_URL=https://api.exchat.ai, routes exchat.ai) + a `databases` managed Postgres component bound to api's DATABASE_URL. List ALL env vars (mark secrets as type SECRET, value placeholders): OPENROUTER_API_KEY, FAL_KEY, EMBED_MODEL, VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT, R2_*, CORS_ORIGIN=https://exchat.ai, plus model/tuning envs. Add a brief `DEPLOY.md` with the Step-B doctl/CF/DNS runbook (create R2 bucket+token, create app from app.yaml, set secrets, bind PG, point DNS exchat.ai + api.exchat.ai, deploy, verify).
6. **VERIFY against a REAL Postgres** (estate footgun: `nest build` passes but runtime crashes): spin an ephemeral Postgres (`docker run -e POSTGRES_PASSWORD=… -p 5433:5432 postgres:16` if docker is available, else any local PG), set DATABASE_URL to it, `prisma migrate deploy`, boot `node dist/main.js`, and smoke: POST /auth/device, create a persona, GET /health. Confirm `new PrismaClient()` actually connects (not just tsc/build). Also run the existing test suite. Report exactly how PG boot was verified.

## Frontend (web)
1. `next.config` → `output: 'standalone'`. Add a **Dockerfile (web)** (node:22-slim, npm ci, build, run the standalone server) + `.dockerignore`. (Or document the node buildpack if simpler — but a Dockerfile is more reproducible.)
2. Confirm `API_BASE` is fully env-driven (`NEXT_PUBLIC_API_URL`) with NO hardcoded localhost in shipped code paths; build with the prod value injected at build time (App Platform sets it).
3. tsc + build clean.

## Report
Backend: prisma provider switch + how the fresh PG migration was made + HOW PG boot was verified (real connection), the StorageService R2 driver + which paths route through it + how serve-auth is preserved, the Dockerfile (ffmpeg), /health, the app.yaml services/db/env list, DEPLOY.md runbook. Frontend: standalone + Dockerfile + env. Anything deferred. Start with "STEP A: PASS" or "FAIL".
