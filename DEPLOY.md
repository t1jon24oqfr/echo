# Echo — Step B deploy runbook (DigitalOcean App Platform + Cloudflare R2)

Step A (code) is done: Postgres Prisma + one baseline migration, R2 driver in
StorageService, Dockerfile (ffmpeg), `GET /health`, and `.do/app.yaml`. Step B
creates the cloud resources and ships it. Domains: **exchat.ai** (web) +
**api.exchat.ai** (api). Brand text stays "ECHO".

Containers have an EPHEMERAL filesystem — durability is managed Postgres + R2.

## 0. Prereqs
- `doctl auth init` against the **estate** DO account; put Echo in its own project.
- A Cloudflare account that owns `exchat.ai` (for R2 + DNS).
- Push this repo to GitHub; set `github.repo`/`branch` in `.do/app.yaml`.

## 1. Cloudflare R2 (private media bucket)
1. R2 → Create bucket `echo-media` (keep it **private**; do NOT enable public access).
2. R2 → Manage API Tokens → create an **S3 Auth** token scoped to `echo-media`
   (Object Read & Write). Note the Access Key ID + Secret.
3. R2_ENDPOINT is `https://<account-id>.r2.cloudflarestorage.com` (account id is
   shown on the R2 overview page).

## 2. Create the app + managed Postgres
```sh
doctl apps create --spec .do/app.yaml
```
This provisions the `api` + `web` services and the managed Postgres `echo-db`.
`${echo-db.DATABASE_URL}` is bound automatically (includes `sslmode=require`).
The api entrypoint runs `prisma migrate deploy` on boot, so the empty prod DB is
created from `prisma/migrations/0_init` on first deploy.

## 3. Set the secrets
Replace every `REPLACE_ME` (type SECRET) — either edit the spec then
`doctl apps update <APP_ID> --spec .do/app.yaml`, or set them in the dashboard
(App → Settings → api → Environment Variables):
- `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (from §1)
- `OPENROUTER_API_KEY`, `FAL_KEY`, `EMBED_MODEL`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
  (generate with `npx web-push generate-vapid-keys`)
- confirm `STORAGE_DRIVER=r2` and `CORS_ORIGIN=https://exchat.ai`

## 4. DNS (Cloudflare)
- `exchat.ai`     → CNAME to the web service's `ondigitalocean.app` hostname.
- `api.exchat.ai` → CNAME to the api service's `ondigitalocean.app` hostname.
Add both domains under App → Settings → Domains; DO issues the TLS certs.
Keep Cloudflare proxy (orange cloud) on; ensure SSL mode is Full (strict).

## 5. Deploy + verify
```sh
doctl apps create-deployment <APP_ID>            # or it auto-deploys on push
curl https://api.exchat.ai/health                # -> {"ok":true,"db":"up"}
TOKEN=$(curl -s -XPOST https://api.exchat.ai/auth/device -H 'content-type: application/json' -d '{}' | jq -r .token)
curl -s -XPOST https://api.exchat.ai/personas -H "x-device-token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Test","relationship":"friend","mode":"memorial"}'
```
Then open https://exchat.ai, create a persona, upload a photo, and confirm the
photo serves back via `GET /personas/:id/photos/:file?t=<token>` (streamed from
R2 through the API — the bucket is never public).

## Rollback / ops notes
- `prisma migrate deploy` is idempotent; re-deploys are safe.
- api `instance_count` MUST stay 1 (single-instance proactive cron).
- If a deploy shows ACTIVE but requests 5xx, `doctl apps create-deployment` to
  force a fresh pod (estate pod-wedge pattern).
- Version skew is the classic crash-loop trap: `prisma` and `@prisma/client` are
  both pinned exact 6.19.3 — keep them in lockstep.
