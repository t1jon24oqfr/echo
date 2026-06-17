# persona-proto — Фаза 0

CLI-прототип persona engine: експорт переписки → persona card + спогади → чат у терміналі.
Мета — оцінити якість мімікрії стилю (це головний продуктовий ризик) до того, як писати апку.
Контекст і повний план: [`../PLAN.md`](../PLAN.md).

## Запуск

```bash
cd proto
npm_config_cache=/Volumes/Games/1M/.npmcache npm install   # ~/.npm на цій машині root-owned
cp .env.example .env                                        # додай OPENROUTER_API_KEY

# 1. Інжест експорту (все локально, без LLM)
npm run ingest -- --source telegram --in ~/Downloads/ChatExport/result.json --me "Alex"
#   --source whatsapp --in _chat.txt | --source instagram --in message_1.json
#   без --me — покаже список авторів; --months 12 — тільки останній рік (рекомендовано)

# 2. Побудова персони (LLM: card + memories; ~30 викликів, копійки на deepseek)
npm run build-persona

# 3. Чат
npm run chat            # команди: /debug (показати retrieval), /temp 0.7, /exit
```

## Як це працює
1. **Парсери** ([src/parsers/](src/parsers/)): Telegram `result.json`, WhatsApp `_chat.txt` (через `whatsapp-chat-parser`), Instagram JSON з фіксом mojibake (без нього вся кирилиця — каша).
2. **Сегментація** — розмови по гепу >6 год (рецепт IMPersona, arXiv 2504.04332).
3. **Статистика стилю** ([src/stats.ts](src/stats.ts)) — рахується кодом, не LLM: мовний мікс (uk/ru/en), емодзі-рейт і топ-емодзі, медіанна довжина, % повідомлень без крапки, дужки-смайли, burst-розмір.
4. **Persona card** — один LLM-виклик по семплу історії: трейти, стиль, петнейми, внутрішні жарти, факти.
5. **Спогади** — LLM-екстракція по батчах розмов → `memories` з ключовими словами; retrieval по перетину токенів (top-7 на кожен хід).
6. **Чат** — системний промпт = card + 20 реальних фрагментів переписки + retrieved memories + поточна дата; відповідь стрімиться і ріжеться на окремі «бабли».

## Приватність
- Все зберігається локально в `data/` (gitignored). Сирі експорти нікуди не вантажаться — на LLM ідуть фрагменти тексту.
- Запити йдуть через OpenRouter з `provider.data_collection: deny`; в акаунті OpenRouter додатково увімкни ZDR. Використовуй **тільки власні переписки**.
- `OPENAI_BASE_URL` можна вказати на self-hosted vLLM — тоді нічого не покидає твою інфру (цільова конфігурація з плану).

## Що оцінювати (критерії Фази 0)
- Чи впізнається мовний мікс і ритм (короткі повідомлення, не «асистентські» абзаци)?
- Чи спливають петнейми/жарти доречно, а не в кожному повідомленні?
- Чи відмовляється вигадувати факти, яких немає в історії?
- `/debug` показує, які спогади підтягнулись — оцінюй retrieval окремо від стилю.

Якщо промптинг+RAG дає «мурашки» хоча б у половині діалогів — зелене світло Фазі 1 (MVP-апка); LoRA-тир («Deep Persona») підніме реалістичність далі (44% vs 25% human-pass за IMPersona).

## Смоук-тест без своїх даних
```bash
npm run ingest -- --source telegram --in fixtures/sample-telegram.json --me "Alex"
```
