// Painel dos Assistentes — service worker (0.123.1)
// Rede primeiro (sempre pede a versão mais nova ao servidor); sem internet, usa a cópia guardada.
const VERSION = '0.123.1';
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
// v0.123.1: notificações como no WhatsApp. O carteiro manda só o nome e o número da mensagem (no endereço, m=...).
// O aparelho busca o texto no banco com o acesso que a página guardou no IndexedDB ('painel-push' › kv › 'auth').
// Se não conseguir em 5 s (ou a pessoa desligou "Mostrar o texto"), mostra "Nova mensagem".
function idb(modo, valor) {
  return new Promise(res => {
    try {
      const rq = indexedDB.open('painel-push', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onerror = () => res(null);
      rq.onsuccess = () => {
        const db = rq.result;
        try {
          const tx = db.transaction('kv', modo === 'put' ? 'readwrite' : 'readonly'), st = tx.objectStore('kv');
          const op = modo === 'put' ? st.put(valor, 'auth') : st.get('auth');
          op.onsuccess = () => { db.close(); res(op.result || null); };
          op.onerror = () => { db.close(); res(null); };
        } catch (x) { db.close(); res(null); }
      };
    } catch (x) { res(null); }
  });
}
async function tokenDe(a) {
  if (a.tok && Date.now() < (a.exp || 0)) return a.tok;
  const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(a.api), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.ref)
  });
  const j = await r.json();
  if (!r.ok || !j.id_token) throw new Error('sem acesso');
  a.tok = j.id_token; a.ref = j.refresh_token || a.ref; a.exp = Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000 - 120000;
  await idb('put', a);
  return a.tok;
}
async function mensagem(id) {
  const a = await idb('get');
  if (!a || !a.db || !a.ref || a.texto === false) return null;
  const tk = await tokenDe(a);
  const r = await fetch(a.db + '/chat/msg/' + encodeURIComponent(id) + '.json?auth=' + encodeURIComponent(tk));
  if (!r.ok) return null;
  const m = await r.json();
  return m && m.t ? m : null;
}
function curto(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { t: 'Painel dos Assistentes', c: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const tag = d.tag || 'painel', u = d.u || './';
    let titulo = d.t || 'Painel dos Assistentes', corpo = d.c || '', nome = String(titulo).split(' · ')[0];
    const id = (String(u).match(/[?&]m=([^&]+)/) || [])[1];
    if (id) {
      try {
        const m = await Promise.race([mensagem(decodeURIComponent(id)), new Promise(r => setTimeout(() => r(null), 5000))]);
        if (m) { corpo = curto(m.t, 300); nome = m.nome || nome; }
      } catch (x) {}
    }
    if (tag !== 'chat') {
      return self.registration.showNotification(titulo, { body: corpo, tag, renotify: true, icon: 'icons/icon-192.png?v=3', badge: 'icons/icon-192.png?v=3', data: { u } });
    }
    // junta com a notificação do chat que ainda está na tela (como no WhatsApp: as últimas 5 linhas)
    let ant = null; try { ant = (await self.registration.getNotifications({ tag: 'chat' }))[0] || null; } catch (x) {}
    const pd = (ant && ant.data) || {}, linhas = (pd.l || []).concat([{ n: String(nome).split(/\s+/)[0], c: corpo || 'Nova mensagem' }]).slice(-5), qt = (pd.q || 0) + 1;
    const autores = linhas.map(x => x.n).filter((x, i, a) => a.indexOf(x) === i);
    if (qt > 1) {
      if (autores.length === 1) {
        titulo = titulo + ' (' + qt + ' mensagens)';
        corpo = linhas.map(x => x.c).join('\n');
      } else {
        titulo = (/ · /.test(d.t || '') ? d.t + ' · ' : 'Chat do painel · ') + qt + ' mensagens';
        corpo = linhas.map(x => x.n + ': ' + x.c).join('\n');
      }
    }
    return self.registration.showNotification(titulo, {
      body: corpo, tag: 'chat', renotify: true, icon: 'icons/icon-192.png?v=3', badge: 'icons/icon-192.png?v=3', data: { u, l: linhas, q: qt }
    });
  })());
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
