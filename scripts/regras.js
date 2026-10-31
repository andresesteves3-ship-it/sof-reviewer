// Robô de regras: publica firebase-regras.json no Firebase Realtime Database.
// Roda no GitHub Actions quando o firebase-regras.json muda (e pelo botão "Rodar agora").
// Usa a chave de serviço do Firebase guardada no Secret FIREBASE_SA (JSON). Nunca imprime a chave.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const ARQ_ST = path.join(RAIZ, 'dados', 'regras-status.json');
const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// token de acesso (OAuth 2) a partir da chave de serviço: JWT assinado com RS256
async function token(sa) {
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64u(JSON.stringify({
    iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  }));
  const ass = crypto.createSign('RSA-SHA256').update(cab + '.' + corpo).sign(sa.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + cab + '.' + corpo + '.' + b64u(ass)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('O Google recusou a chave de serviço (HTTP ' + r.status + (j.error ? ': ' + j.error : '') + '). Gere uma chave nova e atualize o Secret FIREBASE_SA.');
  return j.access_token;
}

(async () => {
  let st = { ok: false, erro: '', atualizado: new Date().toISOString() };
  try { const a = JSON.parse(fs.readFileSync(ARQ_ST, 'utf8')); st.ultimoSucesso = a.ultimoSucesso; st.falhasSeguidas = a.falhasSeguidas || 0; } catch (e) {}
  try {
    const raw = (process.env.FIREBASE_SA || '').trim();
    if (!raw) throw new Error('Falta o Secret FIREBASE_SA no GitHub (chave de serviço do Firebase).');
    let sa; try { sa = JSON.parse(raw); } catch (e) { throw new Error('O Secret FIREBASE_SA não é um JSON válido. Cole o arquivo da chave inteiro.'); }
    if (!sa.client_email || !sa.private_key) throw new Error('O Secret FIREBASE_SA não tem client_email/private_key.');
    const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'firebase-config.json'), 'utf8'));
    const db = String(cfg.dbUrl || '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(db)) throw new Error('firebase-config.json sem dbUrl.');
    const txt = fs.readFileSync(path.join(RAIZ, 'firebase-regras.json'), 'utf8');
    const regras = JSON.parse(txt);                       // confere se é JSON válido antes de publicar
    if (!regras.rules) throw new Error('firebase-regras.json sem a chave "rules".');
    const tk = await token(sa);
    const r = await fetch(db + '/.settings/rules.json', { method: 'PUT', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: txt });
    const resp = await r.text();
    if (!r.ok) throw new Error('O Firebase não aceitou as regras (HTTP ' + r.status + '): ' + resp.slice(0, 300));
    const hash = crypto.createHash('sha256').update(JSON.stringify(regras)).digest('hex').slice(0, 12);
    st = { ok: true, erro: '', atualizado: st.atualizado, ultimoSucesso: st.atualizado, hash, falhasSeguidas: 0 };
    console.log('OK: regras publicadas no Firebase (versão ' + hash + ').');
  } catch (e) {
    st.erro = String(e.message || e).slice(0, 500); st.falhasSeguidas = (st.falhasSeguidas || 0) + 1;
    console.error('FALHOU:', st.erro);
  }
  fs.mkdirSync(path.dirname(ARQ_ST), { recursive: true });
  fs.writeFileSync(ARQ_ST, JSON.stringify(st, null, 1) + '\n');
  if (!st.ok) process.exitCode = 1;
})();
