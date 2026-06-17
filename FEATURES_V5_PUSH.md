# V5 — Push notifications (Web Push), so "she texts first" reaches the user

The proactive engine already creates "she texts first" messages on a schedule (proactive.service, quiet-hours aware). Today they're only visible when the app is open. Add Web Push so they reach the user when the app is closed. Telegram-bot channel is a SEPARATE later effort (needs a bot token) — OUT OF SCOPE here.

Backend owns `persona-app/api`, frontend owns `persona-app/web`. Parallel session may touch web/: read files fresh, edit additively, preserve i18n (`useT`/`@/i18n` — add new keys to ALL locales), presence, design. prisma pinned 6.19.3 exact. Read env at call-time. npm cache `npm_config_cache=/Volumes/Games/1M/.npmcache`. Backend run: `pkill -f dist/main.js` first (avoid EADDRINUSE) then `node dist/main.js`.

---

## Backend (api)
1. Dependency: `npm i web-push` (pin exact). Generate VAPID keys once (`npx web-push generate-vapid-keys`) and write into `api/.env`:
   `VAPID_PUBLIC_KEY=...`, `VAPID_PRIVATE_KEY=...`, `VAPID_SUBJECT=mailto:hello@echo.app`. Add the names (public placeholder only) to `.env.example`.
2. DB (migration `push_subs`): `model PushSubscription { id String @id @default(cuid()) userId String; user User @relation(...); endpoint String @unique; p256dh String; auth String; createdAt DateTime @default(now()) }` + relation on User. Index userId.
3. `src/push/push.service.ts`:
   - configures web-push with VAPID at call-time; `enabled()` = keys present.
   - `saveSubscription(userId, sub)` upsert by endpoint (sub = {endpoint, keys:{p256dh, auth}}).
   - `removeSubscription(userId, endpoint)`.
   - `sendToUser(userId, payload: {title, body, url, icon?})`: send to all of that user's subs; on 404/410 delete that sub (expired). Never throw into callers (try/catch per sub, Promise.allSettled).
4. `src/push/push.controller.ts` (guarded by DeviceTokenGuard):
   - `GET /push/key` → `{ publicKey }` (VAPID public; `{ publicKey: null }` if not configured).
   - `POST /push/subscribe { subscription }` → `{ ok:true }`.
   - `POST /push/unsubscribe { endpoint }` → `{ ok:true }`.
   - `POST /push/test` → sends a test push to the caller's subs, `{ sent:N }` (for verification).
   Register module in app.module.
5. Hook proactive.service: right after a proactive ChatMessage is created/committed for a persona, call `pushService.sendToUser(persona.userId, { title: persona.name, body: <first ~80 chars of the message>, url: '/chat?id='+persona.id, icon: <avatar URL path or omit> })`. Fire-and-forget, never block the cron.
   (Optional, only if trivial: also send on an in-chat selfie/voice arriving while app backgrounded — skip if it complicates; proactive is the required trigger.)

Verify (report exact): web-push installed; migration applied; tsc+build clean; boot; `GET /push/key` returns a key; subscribe with a synthetic subscription row then `POST /push/test` returns sent≥0 without crashing; a manual proactive trigger (`POST /personas/:id/nudge-now`) calls sendToUser (log line). Report the VAPID public key value the frontend needs (or that it's served via GET /push/key), endpoint shapes, and any i18n strings the frontend must add.

## Frontend (web)
1. `public/sw.js` (service worker): on `push` → parse JSON `{title,body,url,icon}` and `self.registration.showNotification(title,{ body, icon, badge:'/icon.svg', data:{ url }, tag:'echo' })`; on `notificationclick` → `event.waitUntil(clients.matchAll(...))` focus an existing tab or `clients.openWindow(data.url)`; close the notification. Keep minimal, no external imports.
2. `src/lib/push.ts`:
   - `pushSupported()` (serviceWorker in navigator && 'PushManager' in window && 'Notification' in window).
   - `currentPermission()`.
   - `enablePush()`: register `/sw.js`; `Notification.requestPermission()`; if granted, GET /push/key, `reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlBase64ToUint8Array(key) })`, POST /push/subscribe. Return a status enum (`'enabled' | 'denied' | 'unsupported' | 'no-key'`).
   - `disablePush()`: get existing subscription, unsubscribe, POST /push/unsubscribe.
   - include the standard `urlBase64ToUint8Array` helper.
3. Settings UI (`src/app/settings/page.tsx`): a "Notifications" row (iOS-style toggle/button consistent with the existing settings rows + IconSquare style). Off → "Let her reach you — get notified when she messages" + Enable button → enablePush(); reflect state (enabled ✓ / blocked → "allow notifications in your browser settings" / unsupported). On iOS Safari when not installed as a PWA, show a hint "Add Echo to your Home Screen to get notifications". i18n all locales.
4. Optional nudge: after the user's FIRST reply in a chat (or on reaching /home with a ready persona the first time), a one-time soft prompt to enable notifications — only if low-risk and dismissible (localStorage flag `echo.pushAsked`). Otherwise Settings is enough.

Verify: tsc + build clean; in the Chrome preview, enabling from Settings registers the SW and creates a subscription (POST /push/subscribe 200); `navigator.serviceWorker.getRegistration()` resolves. Report files touched, new i18n keys, and the permission-state UX.

## Notes
- iOS web push requires the PWA be Added to Home Screen (iOS 16.4+) — that's expected; Android Chrome + desktop work in-tab.
- Don't break existing manifest.json / icon.svg (already present).
