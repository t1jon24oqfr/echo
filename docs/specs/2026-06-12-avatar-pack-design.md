# Avatar pack at build time — design (2026-06-12, approved)

Every persona gets a polished face the moment it's `ready`: 3 clean AI portraits
generated from the uploaded photos via fal.ai, the first auto-set as the canonical
avatar shown on home tiles, chat header, and profile.

## Backend

**New build stage `avatars`** — pipeline becomes `card → exemplars → memories → avatars → ready`.
After memories are committed, `AvatarService.generatePack(personaId)` runs:

- **Source:** earliest `kind:'upload'` photo (same pick as the selfie). No uploads → skip
  the stage; persona still goes `ready` with the letter-glyph avatar.
- **Generation:** 3 **sequential** fal edit calls (`FAL_EDIT_MODEL`, default
  `fal-ai/qwen-image-edit`), fixed prompt: *"same person, clean portrait headshot, soft
  natural light, neutral softly-blurred background, friendly relaxed expression,
  realistic, high quality"*. Each result saved as a `kind:'avatar'` photo.
  Sequential over parallel: gentler on fal rate limits, simpler partial-failure handling;
  adds ~30–50s to an already-async staged build.
- **Canonical pick:** first successful avatar's filename → `Persona.avatarFile`.
- **Best-effort:** any fal error/timeout is caught and logged; successful avatars are
  kept; persona always reaches `ready`. No fal key → stage skipped silently.

## Schema

- `Persona.avatarFile String?` — canonical avatar filename (additive, nullable).
- Photo `kind` union gains `'avatar'` (string column, no migration needed for it).

## API

- `getPersona` returns `avatarFile` in the detail payload.
- `PATCH /personas/:id/avatar { file }` — re-pick canonical avatar; validates the file is
  an existing photo of that persona; owned-persona guard.

## Frontend

- `personaAvatar(detail)` helper in `api.ts` resolves `avatarFile ?? photos[0]` → used by
  home tiles, chat header, profile header (all already funnel through one photo URL).
- Profile page Photos section: avatar pack rendered first, "current" ring on the
  canonical one; tapping a `kind:'avatar'` photo calls the PATCH and moves the ring.

## Cost & verification

~$0.06–0.15 per persona (3 fal images at ~$0.02–0.05). Verified end-to-end with one real
persona build. No backfill of pre-existing personas; they gain avatars only on rebuild.
