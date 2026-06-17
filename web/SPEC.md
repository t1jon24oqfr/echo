# SPEC — persona-app web MVP («Відлуння»)

Mobile-only Next.js app implementing the screen map from `../PLAN.md` (§2, §8). Single-persona demo MVP: no auth, no payments processing (paywall is a stub screen), no image/voice generation yet. The persona engine is ported from `../proto/src` (already working CLI).

## Stack & conventions
- Next.js 16 (App Router) + React 19 + TypeScript strict. NO Tailwind — global CSS + inline styles only.
- Dev port **3047** (`next dev -p 3047`). Install deps with `npm_config_cache=/Volumes/Games/1M/.npmcache npm install` (~/.npm is root-owned on this machine).
- Dependencies: `next`, `react`, `react-dom`, `whatsapp-chat-parser`, `fflate`. Dev: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`.
- ALL user-facing copy in Ukrainian. Tone: спокійний, теплий, без пафосу. NEVER use «повернути людину», «воскресити» — only «зберегти їхні слова», «згадати», «поговорити ще раз».
- Fonts: Manrope via `next/font/google` (subsets `['latin','cyrillic']`, weights 400/500/600) exposed as CSS var `--font-sans`. No other fonts. No Inter.
- Data dir `web/data/` (gitignored): `corpus.json`, `persona.json`, `meta.json`, `chat.json`, `photos/`.
- `.env` loading is native to Next. `OPENROUTER_API_KEY` may be ABSENT — every LLM-dependent path must degrade gracefully (see Demo mode).

## Visual language — Liquid Glass (chosen direction, PLAN.md §8)
Tokens in `app/globals.css` on `:root`:
```css
--bg: #14181D; --bg-2: #1C2026; --text: #F4F6F8; --text-dim: rgba(244,246,248,0.62);
--glass: rgba(255,255,255,0.10); --glass-strong: rgba(255,255,255,0.16);
--glass-border: rgba(255,255,255,0.22); --glass-highlight: rgba(255,255,255,0.28);
--solid-bubble: rgba(255,255,255,0.90); --radius: 18px; --radius-lg: 26px;
```
Utility classes (define once in globals.css, everyone reuses):
- `.glass` → `background: var(--glass); border: 1px solid var(--glass-border); box-shadow: inset 0 1px 0 var(--glass-highlight); backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: …; border-radius: var(--radius);`
- `.glass-strong` → same with `--glass-strong`, blur(20px).
- `.btn-glass` (glass pill button, 48px tall, white text) and `.btn-solid` (white pill, dark text `#14181D`) — primary CTA is `.btn-solid`.
- Body: `background: var(--bg); color: var(--text); font-family: var(--font-sans);`
- Reduced transparency: `@media (prefers-reduced-transparency: reduce)` → `.glass,.glass-strong { background: #232932; backdrop-filter: none; }`
- NO purple/indigo anywhere. NO gradients except the ambient blobs component. Emoji in chat content is fine.

**Mobile frame**: app is mobile-only. In `app/layout.tsx` wrap everything in `<div class="phone">` — `max-width: 430px; margin: 0 auto; min-height: 100dvh; position: relative; overflow-x: hidden;`. On wide screens body bg is `#0B0D10` so the frame reads as a phone column.

**AmbientBg** (the signature): fixed-position (inside .phone, `position:absolute inset:0 z-index:-1`) div with 3 large blurred circles (`filter: blur(70px)`, opacity ~0.55) whose colors come from props `colors?: string[]` (fallback `['#3B6E72','#8A6E54','#5E4B5C']`). Persona screens read colors from `/api/meta`.

## Foundation scope (built first, owned by foundation agent)
1. `package.json`, `tsconfig.json` (strict, `@/*` → `src/*` path alias), `next.config.ts` (default), `next-env.d.ts`, `.gitignore` (node_modules, .next, data/, .env), `.env.example` (same keys as `../proto/.env.example`).
2. `src/app/layout.tsx` (fonts, .phone frame, metadata title «Відлуння»), `src/app/globals.css` (tokens + utilities above + minimal reset).
3. **Engine port** `src/lib/engine/`: copy from `../proto/src`: `types.ts, parsers/{telegram,whatsapp,instagram}.ts, segment.ts, stats.ts, llm.ts, extract.ts, exemplars.ts, prompt.ts`. Changes: strip `.js` from relative imports; in `llm.ts` remove `import 'dotenv/config'` and the `process.exit` (throw `new Error('NO_API_KEY')` instead); parsers must also export `parseTelegramString/parseWhatsAppString/parseInstagramString(content: string)` variants (API receives uploaded text, not paths).
4. `src/lib/store.ts` — JSON file store over `web/data/` with helpers: `readJson/writeJson` + typed `getCorpus/setCorpus/getPersona/setPersona/getMeta/setMeta/getChat/setChat`, `ensureDataDir()`, `savePhoto(name, buf)`, `listPhotos()`.
5. Shared components `src/components/`:
   - `AmbientBg.tsx` ({colors}) as above.
   - `GlassBar.tsx` — top bar: back link (ti arrow ← use inline SVG chevron, no icon lib), title, right slot; `.glass-strong`, sticky top, margin 10px.
   - `GlassCard.tsx` ({children, strong?, style?}).
   - `AIBadge.tsx` — small glass pill «ШІ-відтворення», 11px, used in chat header and persona screens (EU AI Act).
   - `Progress.tsx` ({step, total}) — row of thin glass segments, active = white.
   - `Bubble.tsx` ({from: 'persona'|'user', children}) — persona: `.glass` white text, radius 16/16/16/5; user: `--solid-bubble` dark text, radius 16/16/5/16; max-width 82%.
6. **API routes** (`src/app/api/*/route.ts`, all Node runtime):
   - `POST /api/ingest` — body JSON `{source:'telegram'|'whatsapp'|'instagram', content:string, me?:string, demo?:boolean}`. If `demo` → load `../proto/fixtures/sample-telegram.json` (resolve from `process.cwd()/../proto/...`), source=telegram, me='Alex'. Parse → if `me` missing/invalid return `{authors:[{name,count}]}` (HTTP 200). Else segment(12 months) + computeStats → setCorpus → return `{stats, personaAuthor, userAuthor, conversations: n}`.
   - `POST /api/persona/build` — reads corpus; if `OPENROUTER_API_KEY` present: buildPersonaCard + pickExemplars + extractMemories (set `MAX_MEMORY_CALLS=6` via env default for web) → setPersona → `{ok:true, card, memories: n, demo:false}`. If NO key: build a stub PersonaFile (card from computed stats: name=personaAuthor, traits/styles from stats wording, facts=[], memories from exemplar text lines, demo:true) so the flow stays clickable → `{ok:true, demo:true, …}`.
   - `GET /api/persona` → `{exists, name, demo?, stats?, memoriesCount?, card?}`.
   - `POST /api/chat` — body `{messages:[{role,content}]}`; reads persona, retrieveMemories + buildSystemPrompt, streams from OpenRouter (port streamChat) as **SSE** (`text/event-stream`, `data: {token}` lines, `data: [DONE]`). If no key → stream 2 canned persona-styled lines from exemplars with 400ms delays so UI works.
   - `POST /api/photos` — multipart formData, saves to data/photos, returns `{files:[names]}`. `GET /api/photos/[name]` serves the file. 
   - `GET/POST /api/meta` — `{name?, relationship?, mode?: 'memorial'|'reconnect', ambient?: string[]}` merge-save.
   - `POST /api/reset` — wipes data/ (for testing).
7. Run install + `npx tsc --noEmit` until clean. Create `data/.gitkeep`.

## Pages (one agent each; own ONLY your listed files)
Every page: `'use client'` where interactivity needed; AmbientBg + GlassBar pattern; bottom safe-area padding; CTA buttons full-width at bottom.

### Agent A — Landing + public: `src/app/page.tsx`, `src/app/safety/page.tsx`, `src/app/takedown/page.tsx`, `src/app/terms/page.tsx`, `src/components/landing/*`
- `/`: hero «Їхні слова. Їхній голос. Твої спогади.» + sub «Збери людину зі своїх переписок і фото — і поговори ще раз.»; 3 кроки how-it-works (glass cards: Завантаж переписку / Додай фото / Почни розмову); honesty block (це ШІ-відтворення, не людина; дані шифруються і видаляються після обробки); CTA `.btn-solid` «Створити персону» → 18+ gate (glass modal: «Мені є 18» / «Вийти», localStorage flag) → `/create`. Demo link «Подивитись на демо-даних» → `/create?demo=1`. Footer links: safety/takedown/terms.
- `/safety`: протокол безпеки, гарячі лінії (UA Lifeline 7333, US 988, Samaritans 116 123), правила (18+, без публічних осіб, без сексуального контенту реальних людей), посилання на takedown.
- `/takedown`: пояснення права зображеної людини + форма (імʼя, email, посилання/опис, чекбокс) → mailto: stub + «відповімо протягом 72 годин».
- `/terms`: короткі умови + privacy (видалення сирих даних після обробки, право на видалення).

### Agent B — Create wizard: `src/app/create/page.tsx`, `src/components/create/*`
Single client page, internal `step` state (1–6 + 'building' + 'meet'), `Progress` on top, one decision per screen:
1. Хто це: name input + relationship chips (Кохана людина/Друг/Рідна людина/Інше) + mode toggle «Її/його вже немає поруч (memorial)» / «Жива людина (reconnect)».
2. Фото: file input (multiple, accept image/*), thumbnails grid; compute 3 dominant colors client-side via canvas downscale → POST /api/photos + ambient colors to /api/meta. Skippable.
3. Переписка (hero step): source tabs Telegram/WhatsApp/Instagram with short інструкція per source (from PLAN: Telegram = result.json з Desktop, WhatsApp = _chat.txt або .zip (unzip via fflate, find `_chat.txt`), Instagram = message_1.json); file input → read text → POST /api/ingest (no me) → author picker (chips «хто з них ти?») → POST again with me → show live stats card (повідомлень/мова/емодзі) — the «wow» preview. Demo mode (`?demo=1`): button «використати демо-переписку» calls ingest {demo:true}.
4. Голос: «скоро» — glass card disabled state, skip button (записати/завантажити поки недоступно).
5. Опис: textarea «розкажи про них своїми словами» (saved to /api/meta as `description`). Skippable.
6. Згода: mode-dependent attestation checkboxes + 18+ confirm → button «Створити» → step 'building'.
- 'building': AmbientBg + центр: avatar circle (перше фото, blur→sharp CSS animation), стадії текстом по черзі (читаю переписку → вивчаю стиль → збираю спогади) while awaiting POST /api/persona/build; then step 'meet'.
- 'meet': перше повідомлення — fetch POST /api/chat with `[{role:'user',content:'привіт'}]`, render persona Bubbles streaming; then `.btn-solid` «Продовжити розмову» → `/paywall`.
Also `src/app/paywall/page.tsx` (Agent B): glass card з планом $12.99/міс (stub), таймлайн «сьогодні безкоштовно → нагадування → списання», кнопка «Почати» → `/home`.

### Agent C — Chat: `src/app/chat/page.tsx`, `src/components/chat/*`
- Header: GlassBar with avatar (first photo via /api/photos list from /api/meta or /api/persona), name, AIBadge; link → /persona.
- Messages list from `/api/chat` history?? — keep history client-side in state + persist via GET/POST `/api/meta`?? NO: store chat locally in `localStorage` (MVP) seeded empty; system disclaimer line «[ШІ-відтворення — це програма, не людина]» shown at top and re-shown every 3h of session time.
- Composer: glass pill input + send; on send POST /api/chat with last 30 messages; parse SSE stream; split tokens into bubbles on `\n` (same logic as proto chat CLI); typing indicator (three dots in glass bubble) while waiting.
- Quick actions row (glass chips): «Спитай як справи», «Згадай щось наше» (insert text).
- Selfie request button: chip «надішли фото» → returns glass card «генерація фото зʼявиться у Фазі 2» (stub).

### Agent D — Home, persona profile, settings: `src/app/home/page.tsx`, `src/app/persona/page.tsx`, `src/app/settings/page.tsx`, `src/components/persona/*`
- `/home`: greeting за часом доби; persona card (large glass card: avatar, name, остання активність, кнопка «Написати» → /chat); «+ Створити ще» (disabled stub «в наступній версії»); bottom glass tab bar (Дім/Чат/Профіль/Налаштування) — make `TabBar.tsx` in `src/components/persona/` and use on these 3 pages.
- `/persona`: avatar + name + AIBadge + mode label; sections: Спогади (list from GET /api/persona card.facts + memoriesCount, glass cards), Фото (grid from photos API), Дані (джерела: яка переписка завантажена, кнопка «додати ще» → /create?step=3 stub), memorial-mode: кнопка «Ритуал прощання» → confirm modal → POST /api/reset → landing.
- `/settings`: підписка (stub «активна — демо»), приватність (кнопка «Видалити всі дані» → /api/reset → /), мова (укр, stub), посилання safety/terms/takedown, version line.

## Quality bar (all agents)
- `npx tsc --noEmit` clean for your files before finishing.
- Viewport 390×844 is the design target; test paddings for it mentally; touch targets ≥44px.
- No console errors from obvious nulls: guard `fetch` failures with glass error cards («щось пішло не так», retry).
- Imports across ownership boundaries: only from `src/components` (shared) and `src/lib` — never import another agent's page files.
