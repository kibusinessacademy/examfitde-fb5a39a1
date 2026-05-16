/* ExamFit Push Service Worker
 * Phase 4: appends ?nj=<job_id>&nj_k=<kind> to deeplink for attribution.
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
      url: payload.deeplink || payload.url || '/app',
      kind: payload.kind || null,
      job_id: payload.job_id || null,
      ts: Date.now(),
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

function withAttribution(target, jobId, kind) {
  try {
    const u = new URL(target, self.location.origin);
    if (jobId) u.searchParams.set('nj', String(jobId));
    if (kind)  u.searchParams.set('nj_k', String(kind));
    u.searchParams.set('nj_t', String(Date.now()));
    return u.pathname + u.search + u.hash;
  } catch {
    return target;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = withAttribution(data.url || '/app', data.job_id, data.kind);
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
  event.waitUntil(Promise.resolve());
});
