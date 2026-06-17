# V7 — "?" help icon → full per-platform import guide

Replace the current small "How to export from X? →" text link with a clear question-mark "?" icon that opens a FULL, per-platform guide for the selected messenger. Content is already researched + verified (June 2026) and saved as structured data.

Frontend only (`persona-app/web`). Parallel session may touch web/: read files fresh, additive/surgical edits, never rewrite whole files, preserve i18n/presence/design. English copy (the guide content is English; do not try to translate the long guide now — keep it English, localization is a later pass).

## Data (already on disk)
`web/src/lib/importGuides.data.json` — verified structured content for all 6 sources:
```
{ [sourceId]: {
    displayName, whatEchoNeeds,
    platforms: [{ platform:'iPhone'|'Android'|'Desktop'|'Web', available, steps:string[], fileToUpload, getItToPhone, timeDelay, caveats:string[] }],
    generalCaveats: string[],
    troubleshooting: [{ problem, fix }]
} }
```
sourceIds: telegram, whatsapp, instagram, facebook, line, vk.

## Build
1. `web/src/lib/importGuides.ts` — `import data from './importGuides.data.json'`; export a typed `ImportGuide` interface + `getImportGuide(sourceId): ImportGuide | null`. (JSON import: ensure `resolveJsonModule` is on in tsconfig — it is for Next; if needed add `assert {type:'json'}`-free standard import.)
2. Replace/upgrade the help affordance in `web/src/components/create/StepChat.tsx`:
   - Next to the active source's instruction (and/or each source tab), render a clear circular **"?" icon button** (aria-label "How to export from {name}", glass, ~28-32px). Tapping it opens the guide sheet for the CURRENT source. Keep a textual fallback link too if it fits the design, but the "?" icon is the primary affordance the user asked for.
3. Rewrite `web/src/components/create/ImportHelpSheet.tsx` (it already exists as a bottom-sheet) to render the RICH guide from `getImportGuide(source)`, per `uxNotes`:
   - Bottom-anchored glass sheet (keep existing role="dialog", aria-modal, tap-scrim-to-close, Close button, scroll). Must scroll — content is long.
   - Header: `displayName` + a subtle "Verified June 2026" line.
   - "What you'll upload" banner pinned near top (glass-strong, accent left-border): render `whatEchoNeeds` verbatim — the single most important line.
   - PER-PLATFORM SUB-TABS: a horizontal pill/segmented row from `platforms[].platform`. Auto-select a sensible default: detect the user's device (iOS vs Android via navigator.userAgent) and select that platform if present, else the first. Switching tabs swaps the steps below (no full re-render of the sheet).
   - For the selected platform: an "available" note if it's not full (e.g. Telegram iPhone "no — use Desktop"); a numbered **steps** list (large tap targets, readable line-height); a `getItToPhone` callout if non-empty ("Getting the file onto your phone"); a `timeDelay` chip; and a caveats list (muted, with a small warning icon).
   - TROUBLESHOOTING: a collapsible accordion of `{problem → fix}` at the bottom.
   - GENERAL section: `generalCaveats` as a short bulleted list under a "Good to know" heading.
   - All static labels ("Verified June 2026", "What you'll upload", "Getting the file onto your phone", "Good to know", "If it doesn't work", platform names, "Close") via i18n in ALL 6 locales (the guide BODY stays English from the data file).
4. Keep it self-contained and accessible; no new deps.

## Verify
- `cd persona-app/web && npx tsc --noEmit` and `npm run build` both clean (JSON import resolves).
- Confirm the sheet renders for each source with platform sub-tabs, steps, caveats, troubleshooting; the "?" icon opens it scoped to the active tab.
Report (<=15 lines) "PASS"/"FAIL": files touched, new i18n keys, how the "?" icon + platform sub-tabs look, anything deferred (e.g. guide-body localization).
