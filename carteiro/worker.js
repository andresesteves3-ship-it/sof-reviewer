/* Carteiro do Painel dos Assistentes — Cloudflare Worker (v0.125.0)
   Recebe do painel um pedido de notificação e envia Web Push para os celulares e computadores inscritos.
   Segurança: o painel manda o token de login do Firebase de quem enviou. O carteiro usa esse token para ler
   /painel/push no banco. Se o token não for de um usuário do painel, o banco recusa e nada é enviado.
   Privacidade: a notificação leva só o título e uma frase curta (ex.: "Nova mensagem de Roger Macedo"), sem o texto da conversa.
   Variáveis (Cloudflare › Worker › Settings › Variables):
     FB_DB         texto   ex.: https://<projeto>-default-rtdb.firebaseio.com
     ORIGEM        texto   https://andresesteves3-ship-it.github.io
     VAPID_PUBLIC  texto   chave pública (gerada em ferramentas/chaves-push.html)
     VAPID_PRIVATE secreto chave privada (gerada no mesmo lugar; nunca cole no chat nem no GitHub)
   v0.125.0 — DESPERTADOR (Cloudflare › Worker › Settings › Triggers › Cron: 0,15,30,45 * * * *)
   A cada 15 min confere a hora da última leitura de cada integração (arquivos dados/*-status.json do site).
   Se uma integração atrasou (o agendamento do GitHub pulou), pede ao GitHub para rodar agora (o mesmo que "Rodar agora").
   Se ficou parada mais de 2 h, manda notificação para a Liderança e os administradores (de novo a cada 6 h).
   Variáveis a mais:
     FB_ROBO_EMAIL secreto e-mail do usuário do robô no Firebase (o mesmo do Secret do GitHub)
     FB_ROBO_PASS  secreto senha desse usuário (o mesmo do Secret do GitHub)
     GH_TOKEN      secreto (opcional) chave do GitHub só com "Actions: Read and write" no repositório.
                   Sem ela, o despertador usa a chave dos robôs cadastrada no painel (Administração).
     SITE          texto   (opcional) https://andresesteves3-ship-it.github.io/sof-reviewer
     GH_REPO       texto   (opcional) andresesteves3-ship-it/sof-reviewer
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

/* ===================== DESPERTADOR (v0.125.0) ===================== */
const BRT = -3; // Brasil, sem horário de verão
const INTEG = [
  { n: 'OGMO', wf: 'ogmo.yml', st: 'dados/ogmo-status.json', atraso: 75, parada: 120 },
  { n: 'Praticagem', wf: 'praticagem.yml', st: 'dados/praticagem-status.json', atraso: 75, parada: 120 },
  { n: 'Término previsto', wf: 'termino.yml', st: 'dados/termino-status.json', slots: ['01:30', '07:30', '13:30', '19:30'] },
  { n: 'TPA', wf: 'tpa.yml', st: 'dados/tpa-status.json', slots: ['04:35', '10:35', '16:35', '19:35'] },
  { n: 'Cópia de segurança', wf: 'backup.yml', st: 'dados/backup-status.json', slots: ['03:41'] }
];
// último horário agendado (em ms) que já passou há pelo menos "folga" minutos
function ultimoSlot(slots, agora, folga) {
  let best = 0;
  for (let d = 0; d <= 1; d++) slots.forEach(hm => {
    const [h, m] = hm.split(':').map(Number);
    const b = new Date(agora + BRT * 3600e3); // relógio de Brasília
    const t = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() - d, h, m) - BRT * 3600e3;
    if (t + folga * 60e3 <= agora && t > best) best = t;
  });
  return best;
}
// situação: 'ok' | 'atrasada' (pedir leitura) | 'parada' (avisar) — com os minutos sem atualizar
function situacao(it, st, agora) {
  const t = st && st.atualizado ? Date.parse(st.atualizado) : 0;
  const min = t ? (agora - t) / 60e3 : 1e9;
  if (st && st.ok === false && Date.parse(st.proxTentativa || '') > agora) return { s: 'ok', min }; // a própria integração já remarcou
  if (it.slots) {
    const sl = ultimoSlot(it.slots, agora, 20);
    if (!sl || t >= sl) return { s: 'ok', min };
    const desde = (agora - sl) / 60e3;
    if (desde > 6 * 60) return { s: 'ok', min };                // janela passou: espera o próximo horário
    return { s: desde >= 120 ? 'parada' : 'atrasada', min, desde };
  }
  return { s: min >= it.parada ? 'parada' : min >= it.atraso ? 'atrasada' : 'ok', min };
}
async function fbLogin(env, site) {
  if (!env.FB_ROBO_EMAIL || !env.FB_ROBO_PASS) throw new Error('faltam FB_ROBO_EMAIL e FB_ROBO_PASS');
  const cfg = await (await fetch(site + '/firebase-config.json', { cf: { cacheTtl: 300 } })).json();
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(cfg.apiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.FB_ROBO_EMAIL, password: env.FB_ROBO_PASS, returnSecureToken: true }) });
  const j = await r.json();
  if (!r.ok) throw new Error('login do robô recusado (' + ((j.error && j.error.message) || r.status) + ')');
  return { tok: j.idToken, db: String(env.FB_DB || cfg.dbUrl || '').replace(/\/$/, '') };
}
const fbGet = async (fb, p) => { const x = await fetch(fb.db + '/' + p + '.json?auth=' + encodeURIComponent(fb.tok)); return x.ok ? x.json() : null; };
const fbPut = (fb, p, v) => fetch(fb.db + '/' + p + '.json?auth=' + encodeURIComponent(fb.tok), { method: 'PUT', body: JSON.stringify(v) });
async function ghPede(env, tk, repo, wf) {
  const h = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + tk, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'painel-carteiro' };
  // não pede de novo se já tem uma rodada na fila, rodando ou criada há menos de 20 min
  const u = await fetch('https://api.github.com/repos/' + repo + '/actions/workflows/' + wf + '/runs?per_page=1', { headers: h });
  if (u.ok) { const r = ((await u.json()).workflow_runs || [])[0]; if (r && (r.status !== 'completed' || Date.now() - Date.parse(r.created_at) < 20 * 60e3)) return 'já rodando'; }
  const x = await fetch('https://api.github.com/repos/' + repo + '/actions/workflows/' + wf + '/dispatches', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify({ ref: 'main' }) });
  return x.status === 204 ? 'pedido' : 'GitHub respondeu ' + x.status;
}
const hm = min => min >= 120 ? Math.round(min / 60) + ' h' : Math.round(min) + ' min';
async function despertador(env) {
  const agora = Date.now(), site = String(env.SITE || ((env.ORIGEM || 'https://andresesteves3-ship-it.github.io') + '/sof-reviewer')).replace(/\/$/, '');
  const repo = env.GH_REPO || 'andresesteves3-ship-it/sof-reviewer', rel = { em: new Date(agora).toISOString(), itens: [] };
  let fb = null; try { fb = await fbLogin(env, site); } catch (e) { rel.erroFirebase = e.message; }
  let tk = env.GH_TOKEN || ''; if (!tk && fb) { try { tk = String((await fbGet(fb, 'painel/config/token')) || ''); } catch (e) {} }
  const mem = fb ? ((await fbGet(fb, 'painel/despertador')) || {}) : {};
  const avisar = [];
  for (const it of INTEG) {
    const k = it.wf.replace('.yml', '');
    let st = null; try { const r = await fetch(site + '/' + it.st + '?_=' + agora, { cf: { cacheTtl: 0 } }); if (r.ok) st = await r.json(); } catch (e) {}
    const sit = situacao(it, st, agora), m = Object.assign({}, mem[k] || {}), item = { n: it.n, sit: sit.s, min: Math.round(sit.min) };
    if (sit.s !== 'ok') {
      if (m.pediu && agora - m.pediu < 45 * 60e3) item.gh = 'pedido há ' + Math.round((agora - m.pediu) / 60e3) + ' min';
      else if (tk) { try { item.gh = await ghPede(env, tk, repo, it.wf); if (item.gh === 'pedido') { m.pediu = agora; m.n = (m.n || 0) + 1; } } catch (e) { item.gh = 'erro: ' + e.message; } } else item.gh = 'sem chave do GitHub';
      if (sit.s === 'parada' && (!m.alerta || agora - m.alerta > 6 * 3600e3)) { m.alerta = agora; avisar.push({ it, sit }); }
    } else if (m.alerta) delete m.alerta;
    rel.itens.push(item);
    if (fb && JSON.stringify(m) !== JSON.stringify(mem[k] || {})) await fbPut(fb, 'painel/despertador/' + k, m);
  }
  if (avisar.length && fb && env.VAPID_PRIVATE) {
    // quem recebe: Analista, Gerente e os administradores técnicos
    const us = (await fbGet(fb, 'usuarios')) || {}, para = [];
    Object.keys(us).forEach(k => { const u = us[k] || {}, em = String(u.email || k.replace(/,/g, '.')).toLowerCase(); /* chave = e-mail com , no lugar de . */ if (/^(analista|gerente)$/i.test(u.funcao || '') || /^(andres\.santos|fellipe\.mourao)@/.test(em)) para.push(em.split('@')[0].replace(/\./g, '_')); });
    const todos = (await fbGet(fb, 'painel/push')) || {};
    const msg = avisar.length === 1
      ? { t: '⚠ Integração ' + avisar[0].it.n + ' parada', c: 'Sem atualizar há ' + hm(avisar[0].sit.min) + '. O despertador já pediu uma nova leitura.', u: './#admin', tag: 'integracoes' }
      : { t: '⚠ ' + avisar.length + ' integrações paradas', c: avisar.map(a => a.it.n + ' (' + hm(a.sit.min) + ')').join(' · ') + '. O despertador já pediu novas leituras.', u: './#admin', tag: 'integracoes' };
    let n = 0; const tarefas = [];
    para.forEach(k => Object.keys(todos[k] || {}).forEach(h => { const d = todos[k][h]; if (d && d.sub && d.sub.endpoint) tarefas.push(envia(d.sub, msg, env).then(x => { if (x.ok) n++; }, () => {})); }));
    await Promise.all(tarefas); rel.alerta = { para: para.length, enviadas: n, texto: msg.t };
  }
  if (fb) await fbPut(fb, 'painel/despertador/_ultima', { em: agora, itens: rel.itens.map(i => i.n + ': ' + i.sit + (i.gh ? ' (' + i.gh + ')' : '')).join(' · ') });
  return rel;
}
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (req.method !== 'POST') {
      // GET /?despertador=1 roda a conferência agora (para testar); só pede leitura das integrações atrasadas
      if (new URL(req.url).searchParams.get('despertador')) return resp(env, await despertador(env));
      return resp(env, { ok: true, carteiro: '0.125.0', despertador: !!(env.FB_ROBO_EMAIL && env.FB_ROBO_PASS) });
    }
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
,
  async scheduled(ev, env, ctx) { ctx.waitUntil(despertador(env)); }
};
