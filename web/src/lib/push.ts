/**
 * Web Push client helpers for the Echo PWA.
 *
 * Registers the /sw.js service worker, requests notification permission, and
 * subscribes through the browser's PushManager using the VAPID public key the
 * backend serves at GET /push/key (never hardcoded). The resulting subscription
 * is persisted server-side via POST /push/subscribe so the proactive cron can
 * reach the user when the app is closed.
 *
 * All functions are browser-only and guard on feature support; calling them
 * during SSR / on an unsupported device resolves to a benign status.
 */

import { getPushKey, savePushSubscription, removePushSubscription } from './api';

/** Outcome of an enablePush() attempt, for the Settings UI to reflect. */
export type PushStatus = 'enabled' | 'denied' | 'unsupported' | 'no-key';

/** True if this browser can do Web Push at all (SW + PushManager + Notification). */
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current Notification permission, or 'default' where unsupported. */
export function currentPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'default';
  return Notification.permission;
}

/** Decode a URL-safe base64 VAPID key into the Uint8Array PushManager expects. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  // Back the array with a concrete ArrayBuffer so the type is `Uint8Array<ArrayBuffer>`
  // (PushManager's `applicationServerKey` requires BufferSource, not ArrayBufferLike).
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function registerSw(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

/**
 * Register the SW, ask for permission, subscribe to push, and persist the
 * subscription on the server. Returns a status the UI can render directly.
 * Never throws for the expected denial/unsupported/no-key paths.
 */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const { publicKey } = await getPushKey();
  if (!publicKey) return 'no-key';

  const reg = await registerSw();
  await navigator.serviceWorker.ready;

  // Reuse an existing subscription if present; only create one when missing.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'denied';
  await savePushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return 'enabled';
}

/**
 * Unsubscribe locally and tell the server to drop the row. Best-effort: a
 * missing subscription or a network hiccup still resolves cleanly.
 */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* already gone */
  }
  if (endpoint) {
    try {
      await removePushSubscription(endpoint);
    } catch {
      /* server prune is best-effort */
    }
  }
}

/** True when running as an installed (standalone) PWA — needed for iOS push. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const navAny = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    navAny.standalone === true
  );
}

/** Rough iOS Safari detection, for the "Add to Home Screen" push hint. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Mac; detect via touch points.
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return iOSDevice || iPadOS;
}
