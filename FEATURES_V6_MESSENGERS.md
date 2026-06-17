# V6 — add Facebook Messenger, LINE, VK import + detailed import guide

Adds 3 new chat sources to the existing 3 (WhatsApp/Telegram/Instagram). Verified-feasible set from research (others deferred: Signal/iMessage = desktop-only, Skype = shutting down this month, Discord = one-sided export, Viber = no clean mobile export — all OUT of this lane).

Authoritative parser specs: `persona-app/_parser_specs.txt` (READ IT — exact schemas, timestamp formats, encoding, kind/skip rules). Shippable guide already written: `persona-app/IMPORT_GUIDE.md`.

Backend owns `persona-app/api`, frontend owns `persona-app/web`. prisma 6.19.3 exact. Read env at call-time. npm cache `npm_config_cache=/Volumes/Games/1M/.npmcache`. Backend run: `pkill -f dist/main.js` first, then `node dist/main.js`. Parallel session may touch web/: read files fresh, additive edits, preserve i18n (add keys to ALL 6 locales)/presence/design.

Current ingest flow (keep working): frontend unzips client-side (fflate), extracts the chat text, POSTs `{source, content, me?}` to `/personas/:id/ingest`; no `me` → `{authors:[{name,count}]}`; with `me` → stats. Backend `PARSERS: Record<Source,(content:string)=>Msg[]>`. Two-phase author picker counts authors over ALL emitted msgs (never emit kind:'system').

## Backend (api)
1. Refactor: extract `fixMojibake` from `engine/parsers/instagram.ts` into `engine/parsers/_encoding.ts`; instagram imports it. (No behavior change.)
2. New parsers (pure `(content:string)=>Msg[]`, plus thin `parseXString` exports, mirroring the existing trio), per `_parser_specs.txt`:
   - `engine/parsers/line.ts` — UTF-8 .txt state machine (date-section header + TAB-delimited message lines + multi-line continuation). NO mojibake. Reject space-delimited desktop export.
   - `engine/parsers/facebook.ts` — input is a MERGED `{participants, messages}` JSON string (the frontend merges a thread's message_*.json before sending). `JSON.parse` then `fixMojibake` every string; map timestamp_ms directly (already ms); kind from audio_files/photos/videos/etc; drop is_unsent/calls/system per spec. Dedupe by (timestamp_ms,sender_name,content); sort ascending.
   - `engine/parsers/vk.ts` — input is ALREADY-DECODED (UTF-8) concatenated HTML of ONE dialog's page files (frontend decodes CP1251 → UTF-8 and concatenates in chronological page order). Parse with `node-html-parser` (add dep, pin exact): iterate `div.message`, header `div.message__header` → split on LAST comma → author + 'D MMM YYYY в H:MM:SS' (genitive month map incl. 'мая'; Moscow UTC+3 → `Date.UTC(y,m-1,d,hh-3,mm,ss)`); body = sibling after header, strip `div.kludges`, `<br>`→\n, decode `[id|name]` mentions to name, HTML-entity-decode; kind from `div.attachment` type (voice via audiomsg .ogg / 'Голосовое сообщение'); DROP system (a.im_srv_lnk). Normalize self 'Вы' to a stable owner display name BEFORE counting (resolve owner once; if unknown, use literal 'Вы' consistently). DO NOT use fixMojibake.
3. Register all 3 (4 touch-points): PARSERS map + Source union in `personas.service.ts`; `@IsIn([...])` + union in `dto.ts`. Source ids: `facebook`, `line`, `vk`.
4. Keep conventions: `if(kind==='text'&&!text)continue`; media/voice rows `text=''`; never emit kind:'system'.
Verify: build a tiny fixture per source (a 2–3 message FB merged-JSON, a LINE .txt, a small VK dialog HTML), run each parseXString, confirm authors + kinds + timestamps correct; tsc+build clean.

## Frontend (web) — `src/components/create/StepChat.tsx` + a new conversation-picker
1. Add 3 source tabs (Source union → add 'facebook'|'line'|'vk'; SOURCES list with labels + accept + hintKey). accept: facebook `.zip`, line `.txt,.zip`, vk `.zip`.
2. LINE: like the WhatsApp .txt branch — if .zip, find the `*.txt`; else read the .txt; send `{source:'line', content}`.
3. Facebook (.zip): unzip (fflate); find all `**/messages/inbox/<thread>/message_*.json` (also legacy `messages/inbox/...`). Group by thread folder. If >1 thread → show CONVERSATION PICKER (list each thread by its participants' names + message count, searchable); on pick, read that thread's `message_*.json`, `JSON.parse` each, MERGE their `messages` arrays into one `{participants, messages}` object, `JSON.stringify`, send `{source:'facebook', content}`. (Keep \u escapes intact — just parse+merge+stringify; the backend does the mojibake fix.) If exactly 1 thread, skip the picker.
4. VK (.zip): unzip; find dialog folders `messages/<peerId>/messages*.html`. Decode each needed file from CP1251 → UTF-8 with `new TextDecoder('windows-1251').decode(bytes)`. Conversation picker = dialog folders labeled by the first message header's author/peer + message count (parse minimally for the label, or show peerId + a sample). On pick, decode + concatenate that dialog's `messages*.html` in ascending numeric order, send `{source:'vk', content}`.
5. CONVERSATION PICKER component (`src/components/create/ConversationPicker.tsx`, reused by FB+VK): given a list `{id, label, sublabel, count}` render selectable glass rows (Telegram-style), then proceed to the existing two-phase author flow. Keep the existing post-ingest stats card + author-chip flow unchanged.
6. Per-source instruction hints from `IMPORT_GUIDE.md` (concise in-tab steps). Add an "How to export from {app}? →" link that opens a help sheet/page with the fuller steps. i18n all new strings in ALL 6 locales.
7. Optional: a `/import-guide` page (or a sheet) rendering the guide content — low-risk, nice to have.
Verify: tsc + build clean. In the Chrome preview, the new tabs render with instructions; (full archive upload can't be simulated easily — at least confirm tab UI + that LINE .txt path posts).

## Also
- Copy `IMPORT_GUIDE.md` content into the app where it helps (help sheet). The doc itself stays at repo root as the canonical guide.
- Note in the FB tab: E2EE ("secret") chats need a separate desktop export — show as a small caveat.
- Report exact: new source ids, any new deps (node-html-parser), files touched, new i18n keys, and what was verified.
