# Echo («Відлуння») — session overview (2026-06-12)

One-day journey: idea → deep research → product plan → design (3 iterations) → CLI prototype → web MVP → real frontend/backend split → live keys → verified working product.

## 1. The idea
Mobile-only app: a user uploads a chat export (Telegram / WhatsApp / Instagram), 3–10 photos and optional voice notes of a specific person — an ex, a friend, a deceased loved one — and gets an AI persona that texts exactly like that person (language mix, emoji habits, inside jokes), has their face and, later, their voice.

## 2. Research (10-agent workflow, ~280 web queries)
Key findings that shaped everything:
- **The niche is empty.** No shipped product does "upload export → persona with style + face + voice". Closest: ExClone AI (text-only landing page), You Only Virtual (grief-only, no self-serve), 2wai (video avatars, 40M-views backlash for "resurrection" framing). All majors (Character.AI, Replika, Nomi) are questionnaire-based.
- **Persona quality math (Princeton IMPersona):** prompt + RAG ≈ 25% human-pass; per-character LoRA fine-tune ≈ 44% (human = 70%). → MVP on prompting+RAG, LoRA as premium "Deep Persona".
- **Frontier APIs are banned for this** (OpenAI/Anthropic impersonation policies; Project December precedent) → open-weight hosts (OpenRouter), self-host later.
- **Images:** every trendy face-adapter (InstantID/PuLID/Flux) is license-poisoned for commercial use; clean path = Z-Image LoRA on own 3090s, or hosted fal.ai for instant start.
- **Voice:** no open-source TTS speaks Ukrainian; ElevenLabs for UA, Chatterbox (MIT) for RU/EN; own UA fine-tune = future moat.
- **Legal red lines:** memorial-first positioning, hard SFW (TAKE IT DOWN Act), 18+, EU AI Act Art. 50 deadline 2026-08-02 (AI badge + watermarking), separate entity/MID from the adult estate, geo-block RU payments (market = Ukraine + diaspora).
- Full plan: `PLAN.md`. Raw research digests preserved in the session transcript.

## 3. Design (3 iterations with the owner)
1. Warm editorial set (Golden Hour / Lantern / Contact Sheet) — **rejected** ("too papery").
2. Dark Liquid Glass / OLED Noir / Aurora — Liquid Glass chosen, built, then **rejected** after seeing it live.
3. **FINAL: light iOS/Telegram-native** — #EFEFF4 background, white cards, #007AFF accent, blue/white bubbles, floating glass chrome (top bar, tab bar, composer), soft pastel ambient wash derived from the persona's own photos (every extracted color clamped to hsl(h, 65%, 80%)). UI language: **English**, brand placeholder **ECHO**.

## 4. What was built (all working)
### `proto/` — CLI prototype (Phase 0)
`npm run ingest / build-persona / chat`. Parsers for Telegram result.json, WhatsApp _chat.txt, Instagram JSON (with the mandatory latin-1→UTF-8 mojibake fix), 6-hour conversation segmentation, computed style stats, persona-card + memories extraction, terminal chat.

### `api/` — backend (NestJS 11, port 3048)
- Prisma **6.19.3 exact-pinned** + SQLite (`prisma/dev.db`), schema Postgres-ready.
- Device-token auth (`x-device-token`), multi-persona per user.
- Endpoints: auth, personas CRUD, ingest (demo + two-phase author picking), photos upload/serve, async build with stages (card → exemplars → memories), SSE chat persisted in DB, selfie via fal.ai, reset. Contract: `API_CONTRACT.md`.
- Privacy: raw corpus file deleted after successful build; only derived data (card, memories, stats) remains.

### `web/` — frontend (Next 16, port 3047, launch.json entry "vidlunnia")
Pure API client (`src/lib/api.ts`) — zero server logic, which is the store-readiness path: wrap with **Capacitor** later for App Store / Google Play, same backend for all platforms. PWA manifest added.
Pages: landing (18+ gate) → create wizard (who → photos → chats → voice stub → describe → consent) → building → first message → paywall stub → home (multi-persona) → chat (SSE, selfie button, AI disclaimer) → persona profile (memories/photos/farewell ritual) → settings → safety/takedown/terms.

## 5. Live verification (end of session)
- **OpenRouter key plugged in** (`api/.env`): real DeepSeek build on the demo fixture — card extracted actual quotes/inside jokes ("ok boomer", spilled latte, "barista"), and live chat replied in-style: «ахаха класика 😂 / памʼятаєш як ми під дощем до трамвая бігли? / ти ж парасолю знов десь залишив 🙄».
- **fal.ai key plugged in**: integration verified up to fal's answer — account is locked: **"Exhausted balance"** → top up at fal.ai/dashboard/billing ($5–10; ~$0.02–0.05 per image) and the "send a photo" button works with no code changes.
- Cost model: DeepSeek chat ≈ $1.5–2/month per heavy user; persona build ≈ $0.2–0.5 one-time.

## 6. How to run
```bash
# backend
cd /Volumes/Games/1M/persona-app/api
npm run build && node dist/main.js          # :3048, keys in api/.env

# frontend (or via Claude preview "vidlunnia")
cd /Volumes/Games/1M/persona-app/web
npx next dev -p 3047
```
Demo flow works without any keys (fixture + canned replies). With OPENROUTER_API_KEY — real persona; with funded FAL_KEY — real photo replies.

## 7. Next steps
1. **The decisive test:** upload a real Telegram/WhatsApp export through the wizard and judge style fidelity by feel.
2. Top up fal.ai → selfies live; then avatar pack at creation.
3. Voice notes (ElevenLabs for UA), payments (own payment-service, separate MID), deploy (DO App Platform + managed Postgres), Capacitor wrap for stores (note: Apple requires IAP for subscriptions and moderates AI-companion apps strictly — web stays primary).
4. Premium "Deep Persona" LoRA tier; later migrate inference to own EU box (Hetzner GEX131) at ~500+ heavy users.

## Key files
| File | What |
|---|---|
| `PLAN.md` | Full product/architecture/legal plan (UA) |
| `API_CONTRACT.md` | Backend⇄frontend contract |
| `web/SPEC.md` | Original UI spec (API section now stale) |
| `proto/README.md` | CLI prototype usage |
| `api/.env` | Live keys (gitignored) |
