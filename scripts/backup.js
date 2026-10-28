// Robô de cópia de segurança — roda no GitHub Actions uma vez por dia.
// Entra no Firebase com o usuário do robô (Secrets FB_ROBO_EMAIL / FB_ROBO_PASS), lê o banco do painel
// (/painel, /usuarios e os últimos 7 dias de /log) e grava dados/backup/AAAA-MM-DD.enc.json
// CRIPTOGRAFADO com a chave LINEUP_KEY (o repositório é público). Guarda as cópias dos últimos 30 dias.
// Só LÊ o banco: nunca grava nada no Firebase. Não imprime dados, e-mail nem senha no log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const DIR = path.join(RAIZ, 'dados', 'backup');
const ARQ_ST = path.join(RAIZ, 'dados', 'backup-status.json');
const EMAIL = (process.env.FB_ROBO_EMAIL || '').trim();
const PASS = process.env.FB_ROBO_PASS || '';
const KEY = (process.env.LINEUP_KEY || '').trim();
const DIAS_GUARDA = parseInt(process.env.BACKUP_DIAS || '30', 10);

function cifrar(obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const k = crypto.pbkdf2Sync(KEY, salt, 200000, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const mascarar = t => [EMAIL, PASS].filter(v => v && v.length > 2).reduce((r, v) => r.split(v).join('***'), String(t || ''));

(async () => {
  let st = { ok: false, erro: '', atualizado: new Date().toISOString() };
  try { st.ultimoSucesso = JSON.parse(fs.readFileSync(ARQ_ST, 'utf8')).ultimoSucesso; } catch (e) {}
  try {
    if (!EMAIL || !PASS || !KEY) throw new Error('Faltam os Secrets FB_ROBO_EMAIL, FB_ROBO_PASS e/ou LINEUP_KEY no GitHub.');
    const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'firebase-config.json'), 'utf8'));
    const db = String(cfg.dbUrl || '').replace(/\/+$/, '');
    if (!cfg.apiKey || !/^https:\/\//.test(db)) throw new Error('firebase-config.json sem apiKey/dbUrl.');
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(cfg.apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }) });
    const j = await r.json();
    if (!r.ok) throw new Error('Login do robô no Firebase recusado (' + ((j.error && j.error.message) || r.status) + ').');
    const tok = encodeURIComponent(j.idToken);
    const get = async (p, q) => {
      const x = await fetch(db + '/' + p + '.json?auth=' + tok + (q || ''));
      if (!x.ok) throw new Error('Leitura de /' + p + ' recusada (HTTP ' + x.status + '). O e-mail do robô está na lista de Usuários do painel?');
      return x.json();
    };
    const hoje = new Date(), ini = new Date(hoje.getTime() - 7 * 864e5);
    const painel = await get('painel');
    const usuarios = await get('usuarios').catch(() => null);
    const log = await get('log', '&orderBy=%22%24key%22&startAt=%22' + ymd(ini) + '%22').catch(() => null);
    if (!painel || typeof painel !== 'object') throw new Error('O banco veio vazio; cópia não gravada (a anterior foi mantida).');
    const copia = { feitoEm: Date.now(), painel, usuarios: usuarios || {}, log: log || {} };
    fs.mkdirSync(DIR, { recursive: true });
    const nome = ymd(hoje) + '.enc.json';
    fs.writeFileSync(path.join(DIR, nome), JSON.stringify(cifrar(copia)) + '\n');
    // apaga as cópias com mais de DIAS_GUARDA dias
    const limite = ymd(new Date(hoje.getTime() - DIAS_GUARDA * 864e5));
    let apagadas = 0;
    for (const f of fs.readdirSync(DIR)) { if (/^\d{4}-\d{2}-\d{2}\.enc\.json$/.test(f) && f.slice(0, 10) < limite) { fs.unlinkSync(path.join(DIR, f)); apagadas++; } }
    const nFr = Object.keys(painel.frentes || {}).length;
    st = { ok: true, erro: '', atualizado: st.atualizado, ultimoSucesso: st.atualizado, arquivo: nome, frentes: nFr, copias: fs.readdirSync(DIR).length, apagadas };
    console.log('OK: cópia', nome, '(' + nFr + ' frentes; dados criptografados).', apagadas ? apagadas + ' cópia(s) antiga(s) apagada(s).' : '');
  } catch (e) {
    st.erro = mascarar(e.message || e).slice(0, 400);
    console.error('FALHOU:', st.erro);
  }
  fs.mkdirSync(path.dirname(ARQ_ST), { recursive: true });
  fs.writeFileSync(ARQ_ST, JSON.stringify(st, null, 1) + '\n');
})();
