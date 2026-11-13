/* Carteiro do Painel dos Assistentes — Cloudflare Worker (v0.115.0)
   Recebe do painel um pedido de notificação e envia Web Push para os celulares e computadores inscritos.
   Segurança: o painel manda o token de login do Firebase de quem enviou. O carteiro usa esse token para ler
   /painel/push no banco. Se o token não for de um usuário do painel, o banco recusa e nada é enviado.
   Privacidade: a notificação leva só o título e uma frase curta (ex.: "Nova mensagem de Roger Macedo"), sem o texto da conversa.
   Variáveis (Cloudflare › Worker › Settings › Variables):
     FB_DB         texto   ex.: https://<projeto>-default-rtdb.firebaseio.com
     ORIGEM        texto   https://andresesteves3-ship-it.github.io
     VAPID_PUBLIC  texto   chave pública (gerada em ferramentas/chaves-push.html)
     VAPID_PRIVATE secreto chave privada (gerada no mesmo lugar; nunca cole no chat nem no GitHub)
*/
const b64u = {
  dec(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
  enc(u) { let s = ''; u = new Uint8Array(u); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
};
const txt = s => new TextEncoder().encode(s);
const junta = (...a) => { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let i = 0; a.forEach(x => { o.set(x, i); i += x.length; }); return o; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
/* RFC 8291 (aes128gcm) */
async function cifra(sub, dados) {
  const uaPub = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const seg = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, seg, junta(txt('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, txt('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, txt('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, junta(dados, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return junta(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
/* VAPID (RFC 8292) */
async function vapid(endpoint, env) {
  const pub = b64u.dec(env.VAPID_PUBLIC), aud = new URL(endpoint).origin;
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), d: env.VAPID_PRIVATE, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cab = b64u.enc(txt(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64u.enc(txt(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.ORIGEM || 'https://andresesteves3-ship-it.github.io' })));
  const ass = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, txt(cab + '.' + corpo)));
  return 'vapid t=' + cab + '.' + corpo + '.' + b64u.enc(ass) + ', k=' + env.VAPID_PUBLIC;
}
async function envia(sub, msg, env) {
  const body = await cifra(sub, txt(JSON.stringify(msg)));
  return fetch(sub.endpoint, { method: 'POST', body, headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: await vapid(sub.endpoint, env) } });
}
function cors(env, h) { return Object.assign({ 'Access-Control-Allow-Origin': env.ORIGEM || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, h || {}); }
const resp = (env, o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: cors(env, { 'Content-Type': 'application/json' }) });
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (req.method !== 'POST') return resp(env, { ok: true, carteiro: '0.115.0' });
    let p; try { p = await req.json(); } catch (e) { return resp(env, { ok: false, erro: 'pedido inválido' }, 400); }
    if (!p || !p.token || !Array.isArray(p.para) || !p.para.length || p.para.length > 50) return resp(env, { ok: false, erro: 'faltam dados' }, 400);
    const db = String(env.FB_DB || '').replace(/\/$/, '');
    const r = await fetch(db + '/painel/push.json?auth=' + encodeURIComponent(p.token));
    if (!r.ok) return resp(env, { ok: false, erro: 'o banco recusou o token (HTTP ' + r.status + ')' }, 401);
    const todos = (await r.json()) || {};
    const msg = { t: String(p.titulo || 'Painel dos Assistentes').slice(0, 80), c: String(p.corpo || '').slice(0, 140), u: String(p.url || './').slice(0, 120), tag: String(p.tag || 'painel').slice(0, 60) };
    let n = 0, falhas = 0;
    const tarefas = [];
    p.para.forEach(k => { const ds = todos[k] || {}; Object.keys(ds).forEach(h => { const d = ds[h]; if (!d || !d.sub || !d.sub.endpoint) return;
      tarefas.push(envia(d.sub, msg, env).then(async x => { if (x.status === 404 || x.status === 410) { await fetch(db + '/painel/push/' + encodeURIComponent(k) + '/' + encodeURIComponent(h) + '.json?auth=' + encodeURIComponent(p.token), { method: 'DELETE' }); falhas++; } else if (x.ok) n++; else falhas++; }, () => { falhas++; })); }); });
    await Promise.all(tarefas);
    return resp(env, { ok: true, enviadas: n, falhas });
  }
};
