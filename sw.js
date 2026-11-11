// Painel dos Assistentes — service worker (0.115.1)
// Rede primeiro (sempre pede a versão mais nova ao servidor); sem internet, usa a cópia guardada.
const VERSION = '0.115.1';
const CACHE = 'painel-assistentes-' + VERSION;
const SHELL = ['./', './index.html', './ferramentas/sof-libs.js', './ferramentas/sof-app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => (k.startsWith('painel-assistentes-') || k.startsWith('sof-reviewer-')) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
// v0.115.1: notificações (Web Push enviado pelo carteiro). O conteúdo chega cifrado e traz só título e frase curta.
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { t: 'Painel dos Assistentes', c: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.t || 'Painel dos Assistentes', {
    body: d.c || '', tag: d.tag || 'painel', renotify: true, icon: 'icons/icon-192.png?v=3', badge: 'icons/icon-192.png?v=3', data: { u: d.u || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.u) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    const c = l.find(x => x.url.startsWith(self.registration.scope));
    if (c) { c.focus(); return c.navigate ? c.navigate(alvo) : null; }
    return self.clients.openWindow(alvo);
  }));
});
