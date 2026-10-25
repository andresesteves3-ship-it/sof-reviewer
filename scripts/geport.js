// Robô do Geport — roda no GitHub Actions a cada hora.
// Entra no Geport com o usuário/senha guardados como Secrets (GEPORT_USER / GEPORT_PASS),
// lê a tela Frente de Trabalho > Aquaviária (todas as páginas) e grava dados/geport.enc.json
// CRIPTOGRAFADO com a chave LINEUP_KEY (o repositório é público; os dados do Geport não podem ficar abertos).
// Nunca imprime dados, usuário ou senha no log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const BASE = process.env.GEPORT_URL || 'https://geport.triunfologistica.com.br/';
const ROTA = '#/operacao/controle-operacional/aquaviaria';
const USER = process.env.GEPORT_USER || '';
const PASS = process.env.GEPORT_PASS || '';
const KEY = process.env.LINEUP_KEY || '';
const DIR = path.join(__dirname, '..', 'dados');
const ARQ_ENC = path.join(DIR, 'geport.enc.json');
const ARQ_ST = path.join(DIR, 'geport-status.json');

function cifrar(obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const k = crypto.pbkdf2Sync(KEY, salt, 200000, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}
function gravarStatus(st) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ARQ_ST, JSON.stringify(st, null, 1) + '\n');
}

async function lerTabela(page) {
  const vistos = new Set(), out = [];
  const ler = async () => {
    const rows = await page.evaluate(() => [].slice.call(document.querySelectorAll('table.q-table tbody tr')).map(tr => {
      const td = tr.children, x = i => td[i] ? td[i].innerText.replace(/\s+/g, ' ').trim() : '';
      return { cod: x(0), navio: x(1), eta: x(2), etd: x(3), ini: x(4), fim: x(5), classe: x(6), carga: x(7), berco: x(8), origem: x(11),
        sit: [].slice.call(td[9] ? td[9].querySelectorAll('i.on') : []).map(i => i.textContent.trim()) };
    }));
    rows.forEach(r => { if (r.cod && !vistos.has(r.cod)) { vistos.add(r.cod); out.push(r); } });
  };
  const btn = n => page.locator('.q-table__bottom button', { hasText: n }).first();
  const off = async b => (await b.count()) === 0 || await b.evaluate(e => e.disabled || /disabled/.test(e.className) || e.getAttribute('aria-disabled') === 'true');
  const primeira = btn('first_page');
  if (!(await off(primeira))) { await primeira.click(); await page.waitForTimeout(1200); }
  for (let i = 0; i < 80; i++) {
    await ler();
    const nx = btn('keyboard_arrow_right');
    if (await off(nx)) break;
    const antes = await page.evaluate(() => (document.querySelector('table.q-table tbody tr td') || {}).innerText);
    await nx.click();
    try { await page.waitForFunction(a => (document.querySelector('table.q-table tbody tr td') || {}).innerText !== a, antes, { timeout: 5000 }); } catch (e) {}
  }
  return out;
}

(async () => {
  let st = { ok: false, erro: '', atualizado: new Date().toISOString() };
  try { st.ultimoSucesso = JSON.parse(fs.readFileSync(ARQ_ST, 'utf8')).ultimoSucesso; } catch (e) {}
  let browser;
  try {
    if (!USER || !PASS || !KEY) throw new Error('Faltam os Secrets GEPORT_USER, GEPORT_PASS e/ou LINEUP_KEY no GitHub.');
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: 'pt-BR' })).newPage();
    page.setDefaultTimeout(30000);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    if (await page.locator('input[type=password]').count()) {
      const campoUser = page.locator('input:not([type=password]):not([type=hidden]):not([type=checkbox])').first();
      await campoUser.fill(USER);
      await page.locator('input[type=password]').first().fill(PASS);
      const entrar = page.locator('button[type=submit], button:has-text("ENTRAR"), button:has-text("Entrar"), button:has-text("LOGIN"), button:has-text("Login"), button:has-text("ACESSAR")').first();
      if (await entrar.count()) await entrar.click(); else await page.keyboard.press('Enter');
      await page.waitForTimeout(4000);
      if (await page.locator('input[type=password]').count()) throw new Error('Login não concluído (senha recusada, captcha ou verificação extra).');
    }
    await page.evaluate(h => { location.hash = h; }, ROTA);
    try { await page.waitForSelector('table.q-table tbody tr', { timeout: 40000 }); }
    catch (e) {
      const campos = await page.evaluate(() => [].slice.call(document.querySelectorAll('input,button')).slice(0, 12).map(e => e.tagName + ':' + (e.type || '') + ':' + (e.innerText || '').trim().slice(0, 20)).join(' | '));
      throw new Error('Tabela de navios não apareceu. URL=' + page.url().replace(/[?#].*/, '') + ' elementos=' + campos);
    }
    const todos = await lerTabela(page);
    if (!todos.length) throw new Error('A tabela veio vazia (leitura ignorada).');
    // só guarda o que o Line Up usa: previstos (sem início, não finalizados/cancelados)
    const prev = todos.filter(r => !r.ini && !r.sit.includes('assignment_turned_in') && !r.sit.includes('highlight_off'))
      .map(r => ({ cod: r.cod, navio: r.navio, eta: r.eta, etd: '', ini: '', fim: '', classe: r.classe, carga: r.carga, berco: '', origem: '', sit: r.sit }));
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(ARQ_ENC, JSON.stringify({ ...cifrar({ geradoEm: Date.now(), dados: prev }), atualizado: st.atualizado }) + '\n');
    st = { ok: true, erro: '', atualizado: st.atualizado, ultimoSucesso: st.atualizado, total: todos.length, previstos: prev.length };
    console.log('OK:', todos.length, 'linhas lidas;', prev.length, 'previstos (dados criptografados).');
  } catch (e) {
    st.erro = String(e.message || e).replace(new RegExp(USER ? USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '$^', 'g'), '***').slice(0, 300);
    console.error('FALHOU:', st.erro);
  } finally {
    if (browser) await browser.close();
  }
  gravarStatus(st);
})();
