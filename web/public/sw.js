/**
 * Echo service worker — Web Push only (no caching / offline strategy).
 * Kept minimal and dependency-free (no imports): it is fetched as a classic
 * worker from /sw.js and must run as-is in every browser.
 *
 * On `push`: parse the JSON payload { title, body, url, icon? } the backend
 * sends and show a notification. `icon` is usually omitted (persona avatars
 * need a per-device `?t=` token the SW can't supply), so we fall back to the
 * app icon for `badge` only.
 *
 * On `notificationclick`: focus an already-open Echo tab if there is one,
 * otherwise open the deep link the push carried (e.g. /chat?id=<persona>).
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  const title = data.title || 'Echo';
  const options = {
    body: data.body || '',
    badge: '/icon.svg',
    data: { url: data.url || '/home' },
    tag: 'echo',
  };
  if (data.icon) options.icon = data.icon;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/home';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Focus any open Echo tab and route it to the target if we can.
        if ('focus' in client) {
          if ('navigate' in client && client.url && new URL(client.url).origin === self.location.origin) {
            return client.focus().then((c) => (c && c.navigate ? c.navigate(target) : c));
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
