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
const CONTRATO = process.env.GEPORT_CONTRATO || 'TRIUNFO';   // contrato escolhido na tela de login
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


// Escolhe o contrato na tela de login (caixa de seleção). Retorna true se achou e escolheu.
async function escolherContrato(page) {
  const re = new RegExp(CONTRATO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const nativo = page.locator('select').first();
  if (await nativo.count()) {
    const txt = await nativo.locator('option').allTextContents();
    const i = txt.findIndex(t => re.test(t));
    if (i >= 0) { await nativo.selectOption({ index: i }); return true; }
    return false;
  }
  const q = page.locator('.q-select').first();
  if (!(await q.count())) return false;
  const opcoes = () => page.locator('.q-menu .q-item, .q-virtual-scroll__content .q-item, [role=option]').filter({ hasText: re }).first();
  await q.click(); await page.waitForTimeout(800);
  let op = opcoes();
  if (!(await op.count())) { await page.keyboard.type(CONTRATO); await page.waitForTimeout(900); op = opcoes(); }
  if (await op.count()) { await op.click(); await page.waitForTimeout(400); return true; }
  return false;
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
    const mascarar = t => { let r = String(t || ''); [USER, PASS].filter(Boolean).forEach(v => { r = r.split(v).join('***'); }); return r; };
    const temSenha = async () => (await page.locator('input[type=password]').count()) > 0;
    const esperarSairLogin = async ms => { const fim = Date.now() + ms; while (Date.now() < fim) { if (!(await temSenha())) return true; await page.waitForTimeout(500); } return false; };
    if (await temSenha()) {
      const campoUser = page.locator('input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=search])').first();
      await campoUser.fill(USER);
      await page.locator('input[type=password]').first().fill(PASS);
      await page.waitForTimeout(800);
      const contratoOk = await escolherContrato(page);
      const entrar = page.locator('button[type=submit], button:has-text("ENTRAR"), button:has-text("Entrar"), button:has-text("LOGIN"), button:has-text("Login"), button:has-text("ACESSAR")').first();
      if (await entrar.count()) await entrar.click(); else await page.keyboard.press('Enter');
      let saiu = await esperarSairLogin(15000);
      if (!saiu) { await page.locator('input[type=password]').first().press('Enter'); saiu = await esperarSairLogin(12000); }
      if (!saiu) {
        // diagnóstico sem dados sensíveis (usuário/senha são mascarados)
        const info = await page.evaluate(() => ({
          selects: [].slice.call(document.querySelectorAll('.q-select, select')).map(e => (e.innerText || e.tagName).replace(/\\s+/g, ' ').trim().slice(0, 40)).join(' | '),
          campos: [].slice.call(document.querySelectorAll('input')).map(i => (i.type || '') + ':' + (i.name || i.placeholder || i.getAttribute('aria-label') || '')).join(' | '),
          botoes: [].slice.call(document.querySelectorAll('button')).map(b => (b.innerText || '').trim().slice(0, 20) + ':' + (b.type || '')).join(' | '),
          avisos: [].slice.call(document.querySelectorAll('.q-notification, .q-banner, .text-negative, [role=alert], .q-field--error')).map(e => (e.innerText || '').trim().slice(0, 80)).join(' | '),
          texto: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160)
        })).catch(() => ({}));
        throw new Error('Login não concluído (contrato ' + (contratoOk ? 'escolhido' : 'NÃO encontrado na tela') + '; senha recusada, captcha ou verificação extra?). Selects=[' + mascarar(info.selects) + '] Campos=[' + mascarar(info.campos) + '] Botões=[' + mascarar(info.botoes) + '] Avisos=[' + mascarar(info.avisos) + '] Texto=[' + mascarar(info.texto) + ']');
      }
      await page.waitForTimeout(2000);
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
    st.erro = [USER, PASS].filter(Boolean).reduce((t, v) => t.split(v).join('***'), String(e.message || e)).slice(0, 500);
    console.error('FALHOU:', st.erro);
  } finally {
    if (browser) await browser.close();
  }
  gravarStatus(st);
})();
