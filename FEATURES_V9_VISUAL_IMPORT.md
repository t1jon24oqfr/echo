# V9 — Visual import: ONE step "upload a screen recording or screenshots"

Pivot the chat-import UX: drop the 6 per-messenger file-export tabs + their "?" guides from the UI (COMMENT OUT, do not delete — keep parsers/guides files for the future). Replace with a SINGLE, friendly step: the user uploads a **screen recording** of them scrolling the chat, OR **screenshots**, and we extract the messages with a vision model. This is universal (works for any messenger incl. Viber/iMessage) and the easiest thing for users.

Architecture decision (from research): EXTRACTION RUNS SERVER-SIDE (iOS Safari can't run ffmpeg.wasm reliably). Frontend just uploads the raw file(s) to storage; backend extracts frames → dedups → vision-LLM → our `{author,text,ts,kind}` corpus → the existing build flow. Cost is ~cents/import when frames are deduped (the 60–90× lever). Default model: Qwen3-VL-8B (`VISION_MODEL=qwen/qwen3-vl-8b-instruct`, already configured, paid via OpenRouter).

Backend owns `persona-app/api`, frontend owns `persona-app/web`. prisma 6.19.3 exact. Read env at call-time. npm cache `npm_config_cache=/Volumes/Games/1M/.npmcache`. Backend run: `pkill -f dist/main.js` first, then `node dist/main.js`. Parallel session may touch web/: read fresh, additive/surgical, preserve i18n(×6 locales)/presence/design. ffmpeg is available on this box (`/opt/homebrew/bin/ffmpeg`); NOTE in the report that production images must install ffmpeg.

## Backend (api)
Deps: add `sharp` (image downscale/grayscale for dedup + token savings; pin exact). Use system `ffmpeg`/`ffprobe` via `child_process` (no fluent-ffmpeg dep needed).

1. Storage: save raw uploads under `data/imports/<personaId>/` (a "bucket" abstraction — keep it in StorageService so it can swap to R2 later). Video: one file. Screenshots: the N images.
2. `engine/frames.ts` — frame extraction + dedup:
   - VIDEO: `ffmpeg -i in.mp4 -vf "mpdecimate=hi=64*12:lo=64*5:frac=0.33,fps=4" -vsync vfr frames/%05d.png` (cap fps so a fast scroll still yields frames; mpdecimate drops near-identical). Then a second JS pass: for consecutive frames compute a 16×16 grayscale aHash (via sharp) and drop frames whose Hamming distance to the kept previous frame is < threshold (~6). Result: ~the message-advancing frames only.
   - IMAGES: use as-is (already discrete).
   - Downscale every kept frame with sharp to ~560px wide JPEG q80 (chat is a narrow column; ~4.5× fewer vision tokens, no real accuracy loss).
   - Safety caps: max ~120 frames per import (if more after dedup, sample evenly + log truncation); reject videos > ~200MB / > ~6 min with a friendly error.
3. `engine/visualExtract.ts` — per-frame vision extraction (reuse the OpenRouter image_url pattern from `engine/vision.ts`): send the downscaled frame to `VISION_MODEL` with a strict instruction + `response_format` json_schema. Output per frame: `{ rows: [{ side:'left'|'right'|'center', sender?:string, text:string, time?:string|null, kind:'message'|'date'|'system'|'media' }] }`. Prompt MUST: state the convention (right-aligned bubble = the person who recorded this / "me"; left = the other person; center = date/system), ask it to read top→bottom, transcribe Cyrillic/emoji verbatim, NOT invent timestamps (null when absent), and mark media/stickers as kind:'media' with empty text. Keep temp low. Concurrency-limit calls (~4 at a time).
4. `engine/visualMerge.ts` — merge frames into one ordered message list:
   - Concatenate rows in frame order (frames are chronological as the user scrolls). Drop `kind:'system'`. Keep `date` rows to anchor day windows.
   - DEDUP overlapping messages across consecutive frames: fuzzy key (side + normalized text, trimmed/lowercased, ignore trailing punctuation); collapse repeats from scroll overlap.
   - AUTHORS: derive two author labels. If `sender` names were detected use them; else label by side → use placeholder labels the picker can show (e.g. detected name, or "Right (you)" / "Left"). Count per author.
   - TIMESTAMPS (approximate, this path is lossy): assign synthetic increasing epoch-ms — anchor to detected `date` separators + any visible `time`; otherwise space messages sequentially within the inferred day. Always monotonic. (Mark approximate in the API response.)
   - Produce the SAME corpus shape the file parsers feed into the pipeline: `Msg[] = {author,text,ts,kind}`.
5. Endpoints (under DeviceTokenGuard):
   - `POST /personas/:id/visual-import` — multipart: `video` (1 file) OR `images` (up to ~150). Save raw, set persona `status:'building'`/a new stage `'extracting'`, return `202 {status:'extracting'}`, and run the extraction async (frames → VLM → merge → store corpus + stats like `ingest` does, but DON'T pick `me` yet). On success set a state meaning "extracted, awaiting which-one-is-you" — reuse `status:'ingested'` + persist the corpus + a provisional `importAuthors:[{name,count}]`. On failure set stage to an error string.
   - Extend `GET /personas/:id` to surface during/after extraction: `stage` (e.g. 'extracting'/'extract:frames'/'extract:reading'), and once done `importAuthors:[{name,count}]` + `stats`. Frontend polls this.
   - Reuse the EXISTING author-finalize path: after extraction, the frontend calls the existing `POST /personas/:id/ingest` with `{me}` ONLY (no source/content) to finalize personaAuthor/userAuthor + status 'ingested' from the already-stored corpus — OR add a tiny `POST /personas/:id/visual-import/confirm {me}`. Pick whichever is cleaner; keep the corpus already stored so confirm is instant.
   - Then the existing `POST /personas/:id/build` runs unchanged.
6. Keep the old text `ingest` (source+content) working for the commented-out file path / API users — don't break it.
Verify: a tiny smoke — feed 2–3 sample chat screenshots (make simple ones with text) through the extraction → confirm rows parse, dedup works, authors derived, corpus stored; tsc+build clean; note ffmpeg-in-prod requirement.

## Frontend (web)
1. In `src/components/create/StepChat.tsx`: COMMENT OUT (don't delete) the 6 source tabs, the per-source hints, the "?" ImportHelpSheet wiring, and the file-export upload paths. Keep the demo button. Replace the body with a SINGLE visual-import card:
   - Big friendly heading + a **mini illustrated guide** (nicely designed, not a wall of text): 3 simple steps with icons, e.g.
     1) "Open your chat" (chat icon)
     2) "Record your screen while you slowly scroll up through the messages" (record/▶ icon) — or "or take screenshots as you scroll" (camera icon)
     3) "Upload it here" (upload icon)
     Keep copy tiny and warm. Show a one-line tip: "Scroll slowly, oldest→newest, so nothing is missed."
   - ONE upload control accepting BOTH: `accept="video/*,image/*"` `multiple`. Detect: if a video → send as `video`; if image(s) → send as `images`. (Optionally two buttons "Record screen / Upload video" and "Upload screenshots" that open the same input — but one combined dropzone is fine.)
   - A small platform hint toggle: "How to screen-record?" → a compact sheet with iPhone (Control Center → Screen Recording) and Android (Quick Settings → Screen record) steps. (You MAY reuse ImportHelpSheet's shell for this, but it's now ONE generic guide, not per-messenger.)
2. On upload: POST /personas/:id/visual-import (multipart). Then show an "extracting" progress screen (reuse the Building-style stage UI) polling GET /personas/:id until extraction done (stage cleared + importAuthors present) or error. Show friendly stages: "Reading your messages… / Sorting who said what…".
3. When extraction returns the two authors → the EXISTING "which one is you?" chip step (using importAuthors), then the stats card, then continue to the build — same downstream flow as before.
4. Add a small honest note: "We read your messages from the images — times are approximate, and you can fix names on the next step."
5. i18n: all new strings in ALL 6 locales. Keep the commented-out i18n keys (don't remove).
Verify: tsc + build clean; in preview the new single-step UI renders with the mini-guide + the screen-record help; (full video extraction can't be exercised headlessly — confirm the UI + that an image upload posts to visual-import).

## Report
Backend: endpoints + shapes (visual-import, confirm/ingest-me, detail importAuthors), the frames/dedup/VLM/merge approach, sharp/ffmpeg notes (incl. prod ffmpeg requirement), smoke result. Frontend: files touched, what was commented out, new i18n keys, the mini-guide UX, anything deferred.
