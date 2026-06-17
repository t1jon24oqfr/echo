# Echo / «Відлуння» — огляд чат-сесії (2026-06-12)

## 1. Ідея
Mobile-only апка: юзер завантажує переписку (Telegram/WhatsApp/Instagram), фото і голосові конкретної людини → AI-персона, яка пише точно як та людина, з її обличчям і (згодом) голосом. Кейси: memorial (померла близька людина) і reconnect (втрачений звʼязок).

## 2. Дослідження (10-агентний воркфлоу)
- Ніша порожня: ніхто не робить «експорт чату → стиль+обличчя+голос»; UA/RU мімікрія — нічия.
- Persona engine: IMPersona (Princeton) — промптинг+RAG ≈25% human-pass, per-character LoRA ≈44% → card+exemplars+RAG для MVP, LoRA як преміум.
- Моделі: Qwen3-14B/32B, MamayLM (UA), T-pro (RU); OpenAI/Anthropic не можна (impersonation-політики); OpenRouter → Hetzner self-host на масштабі.
- Образ: Z-Image Turbo LoRA (~1 год/3090) + Qwen-Image-Edit-2511 cold start; Flux/InsightFace — ліцензійно заборонені.
- Голос: відкритої UA clone-TTS не існує → Chatterbox (RU/EN) + ElevenLabs (UA), власний UA fine-tune = моут.
- Інжест: WhatsApp = hero (єдиний синхронний мобільний експорт); Telegram через бота/desktop; Instagram async.
- Legal: memorial-first, 18+, строго SFW, окрема юрособа/MID, AI Act Art.50 дедлайн 02.08.2026, геоблок РФ (ринок = UA + діаспора), real-person promise заборонений у рекламі.

## 3. План
`PLAN.md`: UX-майстер 6 кроків (value before signup, live-preview стилю), карта екранів, архітектура, legal-чеклист, роадмап Фаз 0–4, економіка ($9.99–19.99/міс + build fee).

## 4. Дизайн — 3 ітерації
Теплі (Golden Hour/Lantern/Contact Sheet) → відхилено. Темний Liquid Glass → зібрано і відхилено після живого тесту. **Фінал: світлий iOS/Telegram-native** — #EFEFF4 + пастельний wash з кольорів фото персони, білі картки, плаваючий скляний хром, акцент #007AFF, сині/білі бабли, системний шрифт. UI англійською, бренд-плейсхолдер «ECHO».

## 5. Збудовано
- **`proto/`** — CLI persona engine: ingest → build-persona → chat (парсери 3 експортів, mojibake-фікс, стиль-статистика, card+memories, retrieval).
- **`web/`** — фронтенд Next 16 на :3047 («vidlunnia» у launch.json): 10 сторінок (лендинг+18+, майстер, paywall, home, chat SSE, persona, settings, safety/takedown/terms). Збудовано воркфлоу 6 агентів, перекладено EN (30 файлів).
- **`api/`** — NestJS бекенд :3048 (паралельна сесія): multi-persona, device-token auth, Prisma+SQLite, OpenRouter chat/extract, fal.ai селфі; web = чистий API-клієнт (`src/lib/api.ts`); старі Next API-роути видалені.

## 6. Полішинг по фідбеку
Невидимий амбієнт (z-index баг) → виправлено; світла тема зачищена від темних залишків; анімації (page-enter, bubble-in, кнопки); таб-бар прибраний у відкритому чаті, лишився на списках; чіпси в чаті прибрані (селфі = кнопка-камера); скрол-стрибки вбиті (документ не скролиться, скролиться `.phone` з прихованим скролбаром); `?step=3`, імʼя персони, «Active · Demo», непрозора модалка 18+.

## 7. Стан
Повний стек наскрізно працює: майстер → інжест → build → SSE-чат (ключі в `api/.env`). tsc чистий, консоль чиста.

## 8. Далі
1. Тест якості на реальному експорті (вирішальний).
2. Avatar pack / Z-Image LoRA лейн + фото-відповіді.
3. Голос (Chatterbox + ElevenLabs UA).
4. Платежі (окремий MID), деплой, назва/домен.
5. Legal до запуску: takedown, crisis-протокол, DPIA, watermark.

Якорі: `PLAN.md` · `API_CONTRACT.md` · `web/SPEC.md` (API-розділ застарів) · `proto/README.md` · памʼять `persona_app_vidlunnia.md`.
