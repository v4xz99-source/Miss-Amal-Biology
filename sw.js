/* Service Worker - Miss Amal Biology
   - يخلّي الموقع قابل للتثبيت كتطبيق
   - يستقبل إشعارات الفيديوهات الجديدة
   مفيش كاش للصفحة عشان الطلاب يشوفوا دايماً آخر نسخة. */
const OFFLINE_HTML = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Miss Amal Biology</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#04120e;color:#f1fff8;font-family:sans-serif;text-align:center;padding:24px">
<div><div style="font-size:54px">🧬</div><h2 style="color:#f0cf7a">مفيش اتصال بالإنترنت</h2><p style="color:#9fc9bb">افتح الإنترنت وجرّب تاني</p>
<button onclick="location.reload()" style="margin-top:12px;padding:12px 26px;border:0;border-radius:12px;background:#e6bb58;font-weight:700;font-size:16px">إعادة المحاولة</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;              // الصفحة بس، الباقي بيروح للشبكة عادي
  e.respondWith(fetch(e.request).catch(() =>
    new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const scope = self.registration.scope;
  e.waitUntil(self.registration.showNotification(d.title || 'Miss Amal Biology 🧬', {
    body: d.body || 'في محتوى جديد على المنصة',
    icon: scope + 'icon-192.png',
    badge: scope + 'icon-192.png',
    dir: 'rtl', lang: 'ar',
    tag: d.tag || 'new-content',
    renotify: true,
    data: { url: d.url || scope },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate && c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
