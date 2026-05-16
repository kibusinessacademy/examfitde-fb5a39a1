/* ExamFit Push Service Worker
 * Single-purpose: receive Web-Push, show notification, route click → URL.
 * Does NOT cache HTML/assets — caching is owned by VitePWA only.
 */
self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: 'ExamFit', body: event.data?.text() || '' }; }
  const title = payload.title || 'ExamFit';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/pwa-192x192.png',
    tag: payload.tag || payload.kind || 'examfit',
    renotify: false,
    data: {
      url: payload.url || '/app',
      kind: payload.kind || null,
      job_id: payload.job_id || null,
      ts: Date.now(),
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/app';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.origin === self.location.origin) {
          await c.focus();
          await c.navigate(target);
          return;
        }
      } catch { /* ignore */ }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Best-effort: cleanup happens server-side via 404/410 detection on next send.
  event.waitUntil(Promise.resolve());
});
