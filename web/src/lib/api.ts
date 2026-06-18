/**
 * API client for the Echo backend (persona-app/api, NestJS on :3048).
 * The frontend is a pure API client — no server-side logic lives in web/.
 *
 * Auth (V11): two coexisting modes, both sent through the single `apiFetch`
 * injection point.
 *  - Anonymous: device token bootstrapped via POST /auth/device, kept in
 *    localStorage 'echo.device', sent as `x-device-token` (or `?t=` for
 *    <img>/<audio> URLs, which cannot set headers).
 *  - Signed-in: a real account session — a JWT in 'echo.jwt' (+ a rotating
 *    'echo.refresh' refresh token), sent as `Authorization: Bearer <jwt>`.
 *    On a 401 the JWT is silently refreshed once and the request retried;
 *    if refresh fails the session is cleared and we fall back to the device
 *    token (anon keeps working). On first email/social sign-in the current
 *    device token is passed so the anon user's personas are CLAIMED in place.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3048';

const DEVICE_KEY = 'echo.device';
const JWT_KEY = 'echo.jwt';
const REFRESH_KEY = 'echo.refresh';

// ---------- Types (contract shapes) ----------

export interface AuthorStats {
  messages: number;
  avgWords: number;
  medianWords: number;
  emojiPerMessage: number;
  topEmoji: [string, number][];
  langMix: Record<string, number>;
  noTrailingPeriod: number;
  bracketSmiles: number;
  burstAvg: number;
}

export interface CorpusStats {
  totalMessages: number;
  voiceNotes: number;
  media: number;
  from: string; // ISO date
  to: string;
  byAuthor: Record<string, AuthorStats>;
}

export interface PersonaCard {
  name: string;
  relationship_to_user: string;
  traits: string[];
  speech_style: string[];
  language_mix_notes: string;
  emoji_and_punctuation: string;
  pet_names: string[];
  inside_jokes: string[];
  recurring_topics: string[];
  dynamics_with_user: string;
  facts: string[];
}

export type PersonaMode = 'memorial' | 'reconnect';
export type PersonaStatus = 'draft' | 'ingested' | 'building' | 'ready' | 'failed';

/**
 * Simulated presence, computed server-side for ready personas only.
 * Phase 2 (state engine): energy + agenda derived, so the backend now emits the
 * richer `idle` / `busy` / `asleep` / `remembrance` states alongside the legacy
 * `online` / `last_seen`. Labels arrive in English and are mapped by
 * `presenceText`; unknown shapes fall back to the raw label.
 */
export type PersonaPresence =
  | { state: 'online'; label?: string }
  | { state: 'idle'; label: string }
  | { state: 'busy'; label: string }
  | { state: 'asleep'; label: string }
  | { state: 'last_seen'; label: string }
  | { state: 'remembrance'; label: string };

export interface PersonaSummary {
  id: string;
  name: string;
  relationship: string;
  mode: PersonaMode;
  ambient?: string[] | null;
  status: PersonaStatus;
  presence?: PersonaPresence | null;
  avatarFile?: string | null;
  demo: boolean;
  photoCount: number;
  createdAt: string;
}

export interface PersonaPhoto {
  file: string;
  kind: 'upload' | 'selfie' | 'avatar';
}

/** A durable memory the persona has learned (latest-first in `recentMemories`). */
export interface RecentMemory {
  text: string;
  date: string | null; // 'YYYY-MM' or null
}

export interface PersonaDetail extends Omit<PersonaSummary, 'photoCount'> {
  description?: string | null;
  stage?: string | null;
  stats?: CorpusStats | null;
  card?: PersonaCard | null;
  memoriesCount: number;
  /** Newest-first sample of learned memories, for the live-memory UI. */
  recentMemories?: RecentMemory[];
  /** True once a voice sample has been uploaded + cloned (her real voice). */
  hasVoiceSample?: boolean;
  /**
   * Phase 1 Character Passport: true once a passport exists, so the UI can show
   * the "Edit character" entry into the Character Studio. The passport itself is
   * fetched lazily via getProfile() — never dumped on the detail endpoint.
   */
  hasPassport?: boolean;
  passportVersion?: number;
  /** Persona's IANA timezone (mirrors the passport; default "Europe/Kyiv"). */
  timezone?: string;
  /**
   * Visual-import only: present once frames are extracted but the user hasn't
   * picked which author is "me" yet. The which-one-is-you chip step reads this;
   * `approximate:true` flags that timestamps were inferred from the images.
   */
  importAuthors?: { name: string; count: number }[] | null;
  approximate?: boolean;
  photos: PersonaPhoto[];
}

export interface IngestAuthors {
  authors: { name: string; count: number }[];
}

export interface IngestResult {
  stats: CorpusStats;
  personaAuthor: string;
  userAuthor: string;
  conversations: number;
}

/** Message kind from the v2 contract. */
export type MessageKind = 'text' | 'image' | 'voice' | 'selfie';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  // v2 multimodal fields (optional — older 'text' messages omit them).
  kind?: MessageKind;
  imageFile?: string | null;
  audioFile?: string | null;
  transcript?: string | null;
  proactive?: boolean;
  readAt?: string | null;
}

/** Per-persona inbox row for unread badges + last-message preview. */
export interface InboxPersona {
  id: string;
  name: string;
  unread: number;
  lastMessage: { content: string; kind: MessageKind; createdAt: string } | null;
  avatarFile?: string | null;
}

export interface Inbox {
  personas: InboxPersona[];
  totalUnread: number;
}

// ---------- Auth / account (V11) ----------

export type AuthProvider = 'apple' | 'google';

/** A session pair from email/social verify or refresh. */
export interface Session {
  token: string;
  refreshToken: string;
}

/** One linked sign-in identity, as listed on the account profile. */
export interface AccountProvider {
  provider: AuthProvider;
  email?: string | null;
  emailIsPrivateRelay?: boolean;
}

/** The signed-in user's profile (GET /account). */
export interface Account {
  id: string;
  email: string | null;
  emailIsPrivateRelay: boolean;
  displayName: string | null;
  plan: string;
  ageConfirmedAt: string | null;
  createdAt: string;
  providers: AccountProvider[];
  hasDeviceToken: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- Device token bootstrap ----------

function storedToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

let tokenPromise: Promise<string> | null = null;

/** Token from localStorage, or POST /auth/device on first need (deduped). */
export async function getDeviceToken(): Promise<string> {
  const cached = storedToken();
  if (cached) return cached;
  if (!tokenPromise) {
    tokenPromise = (async () => {
      const res = await fetch(`${API_BASE}/auth/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new ApiError(res.status, 'Could not register this device');
      const { token } = (await res.json()) as { token: string };
      try {
        localStorage.setItem(DEVICE_KEY, token);
      } catch {
        /* keep in memory via the resolved promise */
      }
      return token;
    })();
    tokenPromise.catch(() => {
      tokenPromise = null; // allow retry after a failed bootstrap
    });
  }
  return tokenPromise;
}

// ---------- Account session (JWT) ----------

/** True when a real account session (JWT) is present. */
export function isSignedIn(): boolean {
  return Boolean(storedJwt());
}

function storedJwt(): string | null {
  try {
    return localStorage.getItem(JWT_KEY);
  } catch {
    return null;
  }
}

function storedRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

/** Persist a session pair (after email/social verify or a refresh rotation). */
function setSession(s: Session): void {
  try {
    localStorage.setItem(JWT_KEY, s.token);
    localStorage.setItem(REFRESH_KEY, s.refreshToken);
  } catch {
    /* localStorage unavailable — session lives only for this load */
  }
  notifyAuthChange();
}

/** Drop the account session (sign out / refresh failure) — device token stays. */
function clearSession(): void {
  try {
    localStorage.removeItem(JWT_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
  notifyAuthChange();
}

const AUTH_EVENT = 'echo:auth';

/** Fired on sign-in/out so screens (e.g. Settings) can re-render reactively. */
function notifyAuthChange(): void {
  try {
    window.dispatchEvent(new Event(AUTH_EVENT));
  } catch {
    /* SSR / no window */
  }
}

/**
 * Subscribe to account sign-in/sign-out changes. Returns an unsubscribe fn.
 * (UI helper — lets the Settings/account entry reflect state without a reload.)
 */
export function onAuthChange(cb: () => void): () => void {
  window.addEventListener(AUTH_EVENT, cb);
  return () => window.removeEventListener(AUTH_EVENT, cb);
}

// ---------- Core fetch helpers ----------

/** Build the auth header: Bearer JWT when signed in, else the device token. */
async function authHeaders(): Promise<Record<string, string>> {
  const jwt = storedJwt();
  if (jwt) return { Authorization: `Bearer ${jwt}` };
  const token = await getDeviceToken();
  return { 'x-device-token': token };
}

let refreshPromise: Promise<Session | null> | null = null;

/**
 * Rotate the session using the stored refresh token (deduped across concurrent
 * 401s). On success persists + returns the new pair; on failure clears the
 * session and returns null so callers fall back to the device token.
 */
async function refreshSession(): Promise<Session | null> {
  const rt = storedRefresh();
  if (!rt) return null;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, json({ refreshToken: rt }));
        if (!res.ok) {
          clearSession();
          return null;
        }
        const pair = (await res.json()) as Session;
        setSession(pair);
        return pair;
      } catch {
        return null; // network blip — keep the session, let the caller fall back
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const baseHeaders = (init.headers as Record<string, string> | undefined) ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...baseHeaders, ...(await authHeaders()) },
  });
  // Signed-in only: a 401 means the JWT expired — refresh once and retry. If
  // refresh fails the session is cleared; we don't retry-as-anon here (the
  // caller surfaces the 401), but subsequent requests use the device token.
  if (res.status === 401 && storedJwt()) {
    const pair = await refreshSession();
    if (pair) {
      return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { ...baseHeaders, Authorization: `Bearer ${pair.token}` },
      });
    }
  }
  return res;
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  }
  return data as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------- Endpoints ----------

export const listPersonas = (): Promise<PersonaSummary[]> => apiJson('/personas');

export const createPersona = (body: {
  name: string;
  relationship: string;
  mode: PersonaMode;
  description?: string;
  ambient?: string[];
}): Promise<PersonaDetail> => apiJson('/personas', json(body));

export const getPersona = (id: string): Promise<PersonaDetail> =>
  apiJson(`/personas/${encodeURIComponent(id)}`);

export const updatePersona = (
  id: string,
  patch: { description?: string; ambient?: string[]; name?: string },
): Promise<PersonaDetail> =>
  apiJson(`/personas/${encodeURIComponent(id)}`, { ...json(patch), method: 'PATCH' });

export const deletePersona = (id: string): Promise<{ ok: boolean }> =>
  apiJson(`/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const ingestChat = (
  id: string,
  body: {
    source?: 'telegram' | 'whatsapp' | 'instagram' | 'facebook' | 'line' | 'vk';
    content?: string;
    me?: string;
    demo?: boolean;
  },
): Promise<IngestAuthors | IngestResult> =>
  apiJson(`/personas/${encodeURIComponent(id)}/ingest`, json(body));

/**
 * Visual import (V9): upload a screen recording OR screenshots of a chat and let
 * the backend extract the messages with a vision model. One video → field
 * `video`; one or more images → field `images` (≤150). Returns 202
 * `{status:'extracting'}` and runs extraction async — poll `getPersona` until
 * `importAuthors` appears (or `stage` becomes an `extract:error:…` string).
 */
export async function visualImport(
  id: string,
  files: File[],
): Promise<{ status: string }> {
  const form = new FormData();
  const isVideo = files.length === 1 && /^video\//i.test(files[0].type);
  if (isVideo) {
    form.append('video', files[0]);
  } else {
    for (const f of files) form.append('images', f);
  }
  const res = await apiFetch(`/personas/${encodeURIComponent(id)}/visual-import`, {
    method: 'POST',
    body: form,
  });
  const data = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Could not read the upload');
  return { status: data?.status ?? 'extracting' };
}

/**
 * Finalize a visual import: tell the backend which extracted author is "me".
 * Instant — the corpus is already stored; this writes personaAuthor/userAuthor
 * and returns the same shape as a text ingest result (plus `approximate`).
 */
export const visualImportConfirm = (
  id: string,
  me: string,
): Promise<IngestResult & { approximate?: boolean }> =>
  apiJson(`/personas/${encodeURIComponent(id)}/visual-import/confirm`, json({ me }));

export async function uploadPhotos(id: string, files: File[]): Promise<{ files: string[] }> {
  const form = new FormData();
  for (const f of files) form.append('photos', f);
  const res = await apiFetch(`/personas/${encodeURIComponent(id)}/photos`, {
    method: 'POST',
    body: form,
  });
  const data = (await res.json().catch(() => null)) as { files?: string[]; error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Upload failed');
  return { files: data?.files ?? [] };
}

/**
 * Upload a voice sample of the persona (~10s+ of clear speech) and clone it so
 * she can reply in her own voice. Multipart field name `audio`. On success the
 * persona's `hasVoiceSample` flips true (re-fetch detail to reflect it).
 * Surfaces the backend's error code on failure (501 `tts_unavailable`,
 * 502 `clone_failed`) so the UI can show the right message.
 */
export async function uploadVoiceSample(
  id: string,
  audio: Blob | File,
): Promise<{ ok: boolean; voiceId?: string }> {
  const form = new FormData();
  // Name the blob so the backend can derive an extension from the mime type.
  const filename =
    audio instanceof File ? audio.name : `sample.${audio.type.includes('mp4') ? 'mp4' : 'webm'}`;
  form.append('audio', audio, filename);
  const res = await apiFetch(`/personas/${encodeURIComponent(id)}/voice-sample`, {
    method: 'POST',
    body: form,
  });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; voiceId?: string; error?: string }
    | null;
  if (!res.ok) throw new ApiError(res.status, data?.error || 'clone_failed');
  return { ok: data?.ok ?? true, voiceId: data?.voiceId };
}

/**
 * URL for a persona photo, with the device token appended as `?t=`
 * (because <img> cannot send headers). Token is read synchronously —
 * call after any API request has bootstrapped it.
 */
export function photoUrl(personaId: string, file: string): string {
  const token = storedToken() ?? '';
  return `${API_BASE}/personas/${encodeURIComponent(personaId)}/photos/${encodeURIComponent(
    file,
  )}?t=${encodeURIComponent(token)}`;
}

/**
 * Canonical avatar URL for a persona: the chosen avatar-pack portrait if set,
 * otherwise the first photo, otherwise null (letter-glyph fallback).
 */
export function personaAvatar(p: {
  id: string;
  avatarFile?: string | null;
  photos?: PersonaPhoto[];
}): string | null {
  const file = p.avatarFile ?? p.photos?.[0]?.file;
  return file ? photoUrl(p.id, file) : null;
}

export const setAvatar = (id: string, file: string): Promise<{ avatarFile: string }> =>
  apiJson(`/personas/${encodeURIComponent(id)}/avatar`, { ...json({ file }), method: 'PATCH' });

export const buildPersona = (id: string): Promise<{ status: string }> =>
  apiJson(`/personas/${encodeURIComponent(id)}/build`, { method: 'POST' });

export const getMessages = (id: string, limit = 100): Promise<ChatHistoryMessage[]> =>
  apiJson(`/personas/${encodeURIComponent(id)}/messages?limit=${limit}`);

/** POST chat message; returns the raw SSE Response (use readSse on it). */
export async function chat(id: string, message: string): Promise<Response> {
  const res = await apiFetch(`/personas/${encodeURIComponent(id)}/chat`, json({ message }));
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    // Nest puts the human reason in `message`; `error` is just the status name.
    const reason =
      (typeof data?.message === 'string' && data.message) ||
      data?.error ||
      'Could not send the message';
    throw new ApiError(res.status, reason);
  }
  return res;
}

/**
 * Multipart chat: the same `/chat` SSE endpoint, but sent as FormData so the
 * user can attach a photo and/or a recorded voice clip alongside optional text.
 * Returns the raw SSE Response (read with `readSseEvents` to also surface the
 * `selfie`/`caption` JSON events the backend interleaves with token frames).
 */
export async function chatMultipart(
  id: string,
  parts: { text?: string; imageFile?: File; audioBlob?: Blob; mode?: 'call' },
): Promise<Response> {
  const form = new FormData();
  if (parts.text) form.append('message', parts.text);
  if (parts.imageFile) form.append('image', parts.imageFile);
  if (parts.audioBlob) {
    // Name the blob so the backend can derive an extension from the mime type.
    const ext = parts.audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
    form.append('audio', parts.audioBlob, `voice.${ext}`);
  }
  // Call mode: forces a short spoken (voice) reply; backend 409s `voice_required`
  // before streaming if the persona has no cloned voice.
  if (parts.mode) form.append('mode', parts.mode);
  const res = await apiFetch(`/personas/${encodeURIComponent(id)}/chat`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    // Nest puts the human reason in `message`; `error` is just the status name.
    const reason =
      (typeof data?.message === 'string' && data.message) ||
      data?.error ||
      'Could not send the message';
    throw new ApiError(res.status, reason);
  }
  return res;
}

/**
 * Voice-call turn: a thin wrapper over `chatMultipart` that forces `mode:'call'`
 * (short, spoken reply in her cloned voice). On a persona WITHOUT a cloned voice
 * the backend returns 409 `{error:'voice_required'}` BEFORE streaming — surfaced
 * here as an `ApiError(409, 'voice_required')` so the call screen can show the
 * "add her voice" gate. Read the returned SSE with `readSseEvents`.
 */
export async function callChat(
  id: string,
  parts: { audioBlob?: Blob; text?: string },
): Promise<Response> {
  return chatMultipart(id, { ...parts, mode: 'call' });
}

/** True when an error is the backend's pre-stream "needs her cloned voice" 409. */
export function isVoiceRequired(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 409 || e.status === 422) && /voice_required/i.test(e.message);
}

/**
 * Read an SSE stream of `data: {"token": "..."}` frames until `data: [DONE]`
 * or end of stream, invoking onToken for each token.
 */
export async function readSse(res: Response, onToken: (token: string) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!raw.startsWith('data:')) continue;
      const payload = raw.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload) as { token?: string };
        if (typeof parsed.token === 'string') onToken(parsed.token);
      } catch {
        /* skip malformed frame */
      }
    }
  }
}

/**
 * Like `readSse`, but surfaces non-token JSON frames too. Each `data: {...}`
 * frame is parsed and dispatched: `{token}` → onEvent({type:'token'}),
 * `{selfie}` → onEvent({type:'selfie'}), `{caption}` → onEvent({type:'caption'}).
 * Unknown JSON shapes are ignored. Keeps the same `[DONE]` / EOF semantics as
 * `readSse`, so existing token handling is unaffected.
 */
/**
 * Phase-3 behavior layer: per-turn pacing the backend computes from the live
 * state snapshot (mood/energy/closeness/passport) and emits EARLY on the SSE
 * stream so the client plays back exact, state-derived timing instead of its
 * local heuristics. All fields optional.
 */
export interface SseBehavior {
  /** Exact silent "read" delay before the first bubble, ms (incl. busy long-tail). */
  readDelayMs?: number;
  /** Exact typing-indicator duration per bubble index, ms. */
  perBubbleTyping?: number[];
  /** Exact quiet gap before each bubble (index 0 unused), ms. */
  gapMs?: number[];
  /** Bubbles she intends to send this turn (advisory). */
  bubbleCount?: number;
  /** True when the read delay is a busy/asleep override (a long believable tail). */
  busyOverride?: boolean;
  /** Whether to show the ✓✓ "seen" receipt this turn (seenPolicy gate). */
  showSeen?: boolean;
  /** Rare "typing then stops" tease this turn. */
  typingThenStop?: boolean;
}

/** A visible self-correction (type partial → backspace → fix) on a streaming bubble. */
export interface SseCorrect {
  /** Which streamed bubble (reveal order) the correction plays on. */
  bubbleIndex: number;
  /** The (intentionally wrong) partial that is typed first. */
  typed: string;
  /** How many characters to backspace before re-typing the fix. */
  backspace: number;
  /** The CORRECT word that replaces the backspaced characters (never a typo). */
  fix: string;
}

export type SseEvent =
  | { type: 'token'; token: string }
  | { type: 'selfie'; selfie: 'pending' | 'failed' | string } // 'pending' | 'failed' | '<file>'
  | { type: 'voice'; voice: 'pending' | 'failed' | string } // 'pending' | 'failed' | '<file>'
  | { type: 'caption'; caption: string }
  | { type: 'behavior'; behavior: SseBehavior } // Phase-3 per-turn pacing (emitted early)
  | { type: 'reaction'; reaction: string } // emoji-only tapback on the user's last bubble
  | { type: 'correct'; correct: SseCorrect }; // visible self-correction in a streaming bubble

export async function readSseEvents(res: Response, onEvent: (ev: SseEvent) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!raw.startsWith('data:')) continue;
      const payload = raw.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload) as {
          token?: string;
          selfie?: string;
          voice?: string;
          caption?: string;
          behavior?: SseBehavior;
          reaction?: string;
          correct?: SseCorrect;
        };
        if (typeof parsed.token === 'string') onEvent({ type: 'token', token: parsed.token });
        else if (typeof parsed.selfie === 'string') onEvent({ type: 'selfie', selfie: parsed.selfie });
        else if (typeof parsed.voice === 'string') onEvent({ type: 'voice', voice: parsed.voice });
        else if (typeof parsed.caption === 'string')
          onEvent({ type: 'caption', caption: parsed.caption });
        else if (parsed.behavior && typeof parsed.behavior === 'object')
          onEvent({ type: 'behavior', behavior: parsed.behavior });
        else if (typeof parsed.reaction === 'string' && parsed.reaction)
          onEvent({ type: 'reaction', reaction: parsed.reaction });
        else if (parsed.correct && typeof parsed.correct === 'object')
          onEvent({ type: 'correct', correct: parsed.correct });
      } catch {
        /* skip malformed frame */
      }
    }
  }
}

export const requestSelfie = (id: string, hint?: string): Promise<{ file: string; messageId?: string }> =>
  apiJson(`/personas/${encodeURIComponent(id)}/selfie`, json(hint ? { hint } : {}));

// ---------- Realism: inbox / unread / proactive ----------

/** Lightweight inbox for badges + a global poll. */
export const inbox = (): Promise<Inbox> => apiJson('/inbox');

/** Mark all unread (proactive/selfie) messages on a persona as read. */
export const markRead = (id: string): Promise<{ ok: boolean }> =>
  apiJson(`/personas/${encodeURIComponent(id)}/read`, { method: 'POST' });

/** Dev/testing: force one proactive message immediately. */
export const nudgeNow = (id: string): Promise<ChatHistoryMessage> =>
  apiJson(`/personas/${encodeURIComponent(id)}/nudge-now`, { method: 'POST' });

/**
 * URL for a stored voice clip, token appended as `?t=` (like photoUrl, because
 * <audio> cannot send headers). Call after a request has bootstrapped the token.
 */
export function audioUrl(personaId: string, file: string): string {
  const token = storedToken() ?? '';
  return `${API_BASE}/personas/${encodeURIComponent(personaId)}/audio/${encodeURIComponent(
    file,
  )}?t=${encodeURIComponent(token)}`;
}

export const resetAll = (): Promise<{ ok: boolean }> => apiJson('/reset', { method: 'POST' });

// ---------- Character Passport / Studio (Phase 1) ----------

/** Big-Five sliders, each 0..100 (slider space; backend maps to [-1,1]). */
export interface Ocean {
  O: number;
  C: number;
  E: number;
  A: number;
  N: number;
}

/** PAD baseline, each axis [-1,1]. Derived from `ocean`; never edited directly here. */
export interface PAD {
  P: number;
  A: number;
  D: number;
}

export interface Chronotype {
  /** Mid-sleep-on-free-days, hours (2.5 lark .. 7.5 owl). */
  MSF: number;
  sleepDurationH: number; // 6..9
}

export interface RoutineBlock {
  dow?: 'weekday' | 'weekend' | number;
  label: string;
  approxStart: string; // "HH:MM" local
  approxDur: number; // minutes
  busy: boolean;
  valence: number; // [-1,1]
  arousal: number; // [-1,1]
}

export interface PassportRelationship {
  closenessSeed: number; // never shown as a number in the UI
  pinnedMaxStage: number; // 1..5 — ceiling the user controls
  decayEnabled: boolean; // forced false in memorial mode
  proactivityScale: number; // 0.5..2.0
}

export interface PassportBoundaries {
  paused: boolean;
  proactivityDailyCap: number;
  quietHours?: { start: number; end: number };
}

export type ReadReceipts = 'off' | 'close-only' | 'always';

export interface Knobs {
  talkativeness: number;
  warmth: number;
  expressiveness: number;
  moodReactivity: number;
  moodStability: number;
  initiative: number;
  typoTendency: number;
  readReceipts: ReadReceipts;
}

export type Provenance = 'auto' | 'edited';

export interface CharacterPassport {
  name: string;
  relationshipToUser: string;
  occupation: string;
  locale: string;
  timezone: string;
  mode: PersonaMode;

  speechStyle: string[];
  languageMixNotes: string;
  emojiAndPunctuation: string;
  medianWords: number;
  emojiPerMessage: number;
  burstAvg: number;
  topEmoji: string[];

  ocean: Ocean;
  baselinePAD: PAD;
  baselineOverride?: PAD;

  chronotype: Chronotype;
  routineSkeleton: RoutineBlock[];
  relationship: PassportRelationship;
  boundaries: PassportBoundaries;
  knobs: Knobs;

  octantLexicon?: Record<string, string>;
  _provenance: Record<string, Provenance>;
  _version: number;
}

export interface ProfileResponse {
  passport: CharacterPassport | null;
  passportVersion: number;
  timezone: string;
}

/** A partial passport patch (any subset of fields; backend deep-merges + normalizes). */
export type PassportPatch = Partial<
  Omit<CharacterPassport, '_provenance' | '_version' | 'mode'>
>;

/** GET the persona's Character Passport (parsed + normalized server-side). */
export const getProfile = (id: string): Promise<ProfileResponse> =>
  apiJson(`/personas/${encodeURIComponent(id)}/profile`);

/**
 * PATCH the persona's passport: deep-merge `patch`, recompute baselinePAD when
 * ocean changes, flip touched fields to provenance 'edited', bump the version.
 * Returns the new normalized profile.
 */
export const updateProfile = (
  id: string,
  body: { passport?: PassportPatch; timezone?: string },
): Promise<ProfileResponse> =>
  apiJson(`/personas/${encodeURIComponent(id)}/profile`, { ...json(body), method: 'PATCH' });

/** Re-run the build-time auto-fill for fields still 'auto' (never overwrites 'edited'). */
export const regenerateProfile = (id: string): Promise<ProfileResponse> =>
  apiJson(`/personas/${encodeURIComponent(id)}/profile/regenerate`, { method: 'POST' });

// ---------- Web Push (proactive "she texts first" reaches a closed app) ----------

/** Shape the SW + push API exchange (matches the W3C PushSubscription JSON). */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** VAPID public key for `pushManager.subscribe`. `null` ⇒ server not configured. */
export const getPushKey = (): Promise<{ publicKey: string | null }> => apiJson('/push/key');

export const savePushSubscription = (
  subscription: PushSubscriptionJson,
): Promise<{ ok: boolean }> => apiJson('/push/subscribe', json({ subscription }));

export const removePushSubscription = (endpoint: string): Promise<{ ok: boolean }> =>
  apiJson('/push/unsubscribe', json({ endpoint }));

/** Send a test push to the caller's own subscriptions (verification helper). */
export const testPush = (): Promise<{ sent: number }> => apiJson('/push/test', { method: 'POST' });

// ---------- Auth / account endpoints (V11) ----------

/**
 * Begin an email sign-in: the backend mints a one-time code and sends it.
 * In dev (no mail provider) the code is returned as `devCode` so the flow is
 * testable now. The current device token is passed so the anon user can be
 * claimed on verify.
 */
export async function emailStart(email: string): Promise<{ ok: boolean; devCode?: string }> {
  const deviceToken = isSignedIn() ? undefined : await getDeviceToken();
  return apiJson('/auth/email/start', json({ email, deviceToken }));
}

/**
 * Finish an email sign-in with the code. Returns + stores the session pair.
 * Passing the device token lets the backend claim/merge the anon user's
 * personas onto the (new or existing) account in one transaction.
 */
export async function emailVerify(email: string, code: string): Promise<Session> {
  const deviceToken = isSignedIn() ? undefined : await getDeviceToken();
  const session = await apiJson<Session>('/auth/email/verify', json({ email, code, deviceToken }));
  setSession(session);
  return session;
}

/**
 * Sign in with Apple/Google using a provider id_token (from SIWA-JS / GIS on
 * web, or the native plugin on Capacitor). Returns + stores the session pair,
 * claiming the device token's personas. Throws ApiError(501,
 * 'provider_not_configured') when the backend has no creds for that provider —
 * the sign-in UI shows a "coming soon" state instead of crashing.
 */
export async function socialLogin(
  provider: AuthProvider,
  idToken: string,
  nonce?: string,
): Promise<Session> {
  const deviceToken = isSignedIn() ? undefined : await getDeviceToken();
  const session = await apiJson<Session>(
    '/auth/social',
    json({ provider, idToken, nonce, deviceToken }),
  );
  setSession(session);
  return session;
}

/** Manually rotate the session (normally automatic on 401). */
export async function refresh(): Promise<Session | null> {
  return refreshSession();
}

/** Sign out this session (revoke the current refresh token) and clear locally. */
export async function logout(): Promise<void> {
  const refreshToken = storedRefresh();
  if (refreshToken) {
    try {
      await apiJson('/auth/logout', json({ refreshToken }));
    } catch {
      /* best-effort — clear locally regardless */
    }
  }
  clearSession();
}

/** Sign out everywhere (revoke all refresh tokens) and clear locally. */
export async function logoutAll(): Promise<void> {
  const refreshToken = storedRefresh();
  if (refreshToken) {
    try {
      await apiJson('/auth/logout-all', json({ refreshToken }));
    } catch {
      /* best-effort */
    }
  }
  clearSession();
}

/** The signed-in user's profile. */
export const getAccount = (): Promise<Account> => apiJson('/account');

/** Patch the profile (display name and/or 18+ confirmation). */
export const updateAccount = (patch: {
  displayName?: string;
  ageConfirmed?: boolean;
}): Promise<Account> => apiJson('/account', { ...json(patch), method: 'PATCH' });

/** GDPR data export (whatever the backend bundles for this account). */
export const exportAccount = (): Promise<unknown> => apiJson('/account/export');

/**
 * Permanently delete the account: cascades personas/identities/sessions and
 * purges media server-side. Clears the local session afterward.
 */
export async function deleteAccount(): Promise<{ ok: boolean }> {
  const res = await apiJson<{ ok: boolean }>('/account', { method: 'DELETE' });
  clearSession();
  return res;
}
