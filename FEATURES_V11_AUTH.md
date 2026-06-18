# V11 — Real authentication + account/profile (Apple + Google + Email magic-link)

Decision (user, 2026-06-17): ship **Sign in with Apple + Sign in with Google + first-party email magic-link/OTP**. **No Facebook.** Today auth is anonymous device-token only (`POST /auth/device` → `User.deviceToken` in localStorage `echo.device`, header `x-device-token`). Full research: task `w5qdb55dz` (providers/4.8, Capacitor mechanics, architecture, migration, profile).

## Hard constraints (verified June 2026)
- **Apple Guideline 4.8** is binding the moment Google ships: must offer an "equivalent" privacy login (name+email only, private email, no ad tracking). Sign in with Apple is the only mainstream provider meeting it → **SIWA mandatory once Google present.** Email **magic-link** (not password) satisfies the "own account setup" carve-out as the fallback. Ship order: SIWA + email first (4.8-safe), then Google.
- **Capacitor**: social login via NATIVE plugin `@capgo/capacitor-social-login` (v8, pin to Capacitor major) — Google REJECTS OAuth in WebView (`disallowed_useragent`); SIWA must be native ASAuthorization. One backend verify path serves web (GIS/SIWA-JS id_token) AND native (plugin id_token).
- **Sessions = Bearer JWT** in `Authorization` header (web localStorage + Capacitor `@capacitor/preferences`). NOT cookies (capacitor:// / WKWebView refuse cross-site cookies). Mirrors current `x-device-token` 1:1.
- **Never change `User.id`** — every row FKs to it. Link an `Identity` onto the existing device-token User.
- Stay on **Prisma 6.19.3** (both packages exact); boot-verify `new PrismaClient()`.

## Backend (api) — hand-rolled NestJS auth (no Better-Auth/BaaS)
Deps: `jose` (mint/verify Echo JWT + provider JWKS), `google-auth-library` (Google verify). Apple via jose against Apple JWKS.

Prisma (one additive migration):
- `User`: `deviceToken String? @unique` (nullable now); ADD `email String?`, `displayName String?`, `plan String @default("free")`, `ageConfirmedAt DateTime?`. **Keep `id`.**
- NEW `Identity { id, userId FK onDelete:Cascade, provider, providerSub, email?, emailIsPrivateRelay Boolean @default(false), appleRefreshToken String?, createdAt; @@unique([provider, providerSub]); @@index([userId]) }`
- NEW `RefreshToken { id, userId FK onDelete:Cascade, tokenHash @unique, expiresAt, revokedAt?, createdAt; @@index([userId]) }`
- NEW `EmailOtp { id, email, codeHash, expiresAt, consumedAt?, createdAt }`

Endpoints (AuthController):
- `POST /auth/social { provider:'apple'|'google', idToken, nonce?, deviceToken? }` → verify idToken server-side (aud = ARRAY of all surface client IDs; Apple nonce check; trust `sub`, not email) → claim/link transaction → `{ token, refreshToken }`.
- `POST /auth/email/start { email, deviceToken? }` → mint OTP/link, send via existing mail path.
- `POST /auth/email/verify { email, code, deviceToken? }` → `{ token, refreshToken }`.
- `POST /auth/refresh` (rotate) · `POST /auth/logout` · `POST /auth/logout-all`.
- `GET/PATCH /account` · `GET /account/export` (GDPR) · `DELETE /account` (Apple revoke + cascade + R2 purge).
- Keep `POST /auth/device` during transition.

Guard (COLLISION-MINIMAL APPROACH — chosen to avoid touching the 6 controllers a parallel session is editing): **extend `DeviceTokenGuard` IN PLACE** — make it try Bearer JWT first (verify sig+exp → load User by `sub`), else fall back to the existing `x-device-token`/`?t=` lookup. Do NOT rename it, do NOT change any `@UseGuards(DeviceTokenGuard)` line. `req.user` contract unchanged. Add `Authorization` to `allowedHeaders` in main.ts. Keep `?t=` only on the 2 `<img>`/`<audio>` byte routes (later → signed URLs).

EMAIL SENDING (no SMTP yet): an `EmailService` abstraction — if `RESEND_API_KEY`/SMTP env is absent, in non-production it LOGS the code and returns `{ devCode }` in the response so the flow is testable now; real provider plugs in via env later. SOCIAL (Apple/Google): implement full verify reading client IDs from env (`APPLE_*`, `GOOGLE_*`); if the relevant env is missing, `/auth/social` returns 501 `{error:'provider_not_configured'}` — endpoints exist and work the moment creds land.

### Claim/link transaction (the no-orphan rule) — single Prisma `$transaction`
1. Verify idToken → `sub` (+ first-Apple-only name/email/appleRefreshToken — persist immediately, Apple shows them ONCE).
2. Find `Identity` by `(provider, sub)`.
3. Resolve caller `deviceToken` → anon User D (if any).
- **A (new claim):** Identity missing, D exists → attach Identity to D.id; fill empty User fields. (common)
- **B (return):** Identity exists on E, no/own deviceToken → mint session for E.
- **C (merge/new-device):** Identity exists on E AND a different anon D with personas → E survives; `updateMany` Persona/PushSubscription `userId D→E`, move Identities, delete D.
- **D (fresh):** no device + no Identity → create User + Identity.
- Auto-link by email ONLY if both verified-email; else key strictly on `sub`.

## Frontend (web) + Capacitor
- Sign-in screen: SIWA button (native on iOS / SIWA-JS on web) + Google (native / GIS) + email-code. Store `{token, refreshToken}`; on first `/auth/social` pass the existing device token so personas claim.
- `src/lib/api.ts`: switch the single header-injection point from `x-device-token` to `Authorization: Bearer` + silent refresh-on-401 (keep device-token bootstrap for anon→claim).
- Account page (profileSpec): display name (edit), email (+ "private relay" badge for `*@privaterelay.appleid.com` / `*@private.icloud.com`), linked providers (connect/disconnect, never the last one), plan, "18+ confirmed on …", language, notifications; flows: data export, sign out, sign out all, **DELETE account** (confirm + permanent). Public web deletion page on the domain (Google Play requires it).
- Capacitor: `@capgo/capacitor-social-login`, custom scheme `echo://auth/callback`, verify `state`; clear Guideline 4.2 (bundle assets locally, native push/biometric).

## What we need FROM the user (cannot be generated by us)
- **Apple**: Apple Developer account → an App ID + a **Services ID**, a **Sign in with Apple key (.p8)** + its Key ID + Team ID; register sending domain + **allowlist `privaterelay.appleid.com` AND `private.icloud.com`** in Email Sources (private.icloud.com rollout summer 2026).
- **Google**: OAuth client IDs — **web** + **iOS** (+ Android later); scopes ONLY `openid email profile` (never Drive/Contacts/Calendar → avoids costly restricted-scope assessment).
- **Email**: a sending path (we already send via fal? no — need an SMTP/email provider for magic-link). Confirm which.
All secrets in env/secret-store, never git. `appleRefreshToken` encrypted at rest.

## Build sequencing (do NOT start while the parallel session is editing api/)
1. **Email-magic-link core + scaffolding** (no external creds, 4.8-safe): schema migration, JWT/refresh + AuthGuard dual-accept, `/auth/email/*`, `/account` + delete/export, guard swap. Buildable first.
2. **Apple** verify path (needs Apple creds).
3. **Google** verify path (needs Google creds) → triggers 4.8 (Apple already shipped, ok).
4. **Capacitor** native plugin wiring + Apple console email domain + public deletion page.

## Top risks (don't get wrong)
Apple 4.8 (ship SIWA with Google) · Apple name/email returned ONCE (persist) · verify aud as ARRAY + Apple nonce · NO cookies on Capacitor (bearer only) · Google webview block (native only) · all claim/merge in one transaction, never change User.id · secrets out of git · allowlist private.icloud.com · Google Play public deletion URL · stay Prisma 6.19.3.
