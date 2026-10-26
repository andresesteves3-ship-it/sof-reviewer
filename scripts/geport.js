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
const KEY = (process.env.LINEUP_KEY || '').trim();
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


// Preenche o campo CONTRATO da tela de login (campo de digitação com lista que aparece ao digitar).
// Retorna true se achou o campo e digitou.
async function escolherContrato(page) {
  const re = new RegExp(CONTRATO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const nativo = page.locator('select').first();
  if (await nativo.count()) {
    const txt = await nativo.locator('option').allTextContents();
    const i = txt.findIndex(t => re.test(t));
    if (i >= 0) { await nativo.selectOption({ index: i }); return true; }
  }
  // 1) campo cujo rótulo contém "CONTRATO"; 2) senão, o segundo campo de texto da tela
  let campo = page.locator('.q-field, label').filter({ hasText: /contrato/i }).locator('input').first();
  if (!(await campo.count())) {
    const todos = page.locator('input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=search])');
    if ((await todos.count()) >= 2) campo = todos.nth(1); else return false;
  }
  await campo.click(); await page.waitForTimeout(500);
  await campo.fill('');
  await campo.pressSequentially(CONTRATO, { delay: 90 });
  await page.waitForTimeout(1200);
  const op = page.locator('.q-menu .q-item, [role=option], .q-virtual-scroll__content > *').filter({ hasText: re }).first();
  if (await op.count()) { await op.click(); } else { await page.keyboard.press('Enter'); }
  await page.waitForTimeout(500);
  return true;
}

async function lerTabela(page) {
  const vistos = new Set(), out = [];
  const ler = async () => {
    const rows = await page.evaluate(() => [].slice.call(document.querySelectorAll('table.q-table tbody tr')).map(tr => {
      const td = tr.children, x = i => td[i] ? td[i].innerText.replace(/\s+/g, ' ').trim() : '';
      return { cod: x(0), navio: x(1), eta: x(2), etd: x(3), ini: x(4), fim: x(5), classe: x(6), carga: x(7), berco: x(8), origem: x(11),
        sit: [].slice.call(td[9] ? td[9].querySelectorAll('i.on') : []).map(i => i.textContent.trim()) };
    }));
    rows.forEach(r => { if (r.cod && r.navio && !vistos.has(r.cod)) { vistos.add(r.cod); out.push(r); } });
  };
  const btn = n => page.locator('.q-table__bottom button, .q-table__bottom .q-btn', { hasText: n }).first();
  const off = async b => (await b.count()) === 0 || await b.evaluate(e => e.disabled || /disabled/.test(e.className) || e.getAttribute('aria-disabled') === 'true');
  // tenta aumentar "resultados por página" para o máximo
  try {
    const sel = page.locator('.q-table__bottom .q-select').first();
    if (await sel.count()) {
      await sel.click(); await page.waitForTimeout(600);
      const ops = page.locator('.q-menu .q-item');
      const n = await ops.count();
      if (n) { await ops.nth(n - 1).click(); await page.waitForTimeout(2500); }
    }
  } catch (e) {}
  const primeira = btn('first_page');
  if (!(await off(primeira))) { await primeira.click(); await page.waitForTimeout(1200); }
  let paginas = 0;
  for (let i = 0; i < 80; i++) {
    await ler(); paginas++;
    const nx = btn('keyboard_arrow_right');
    if (await off(nx)) break;
    const antes = await page.evaluate(() => (document.querySelector('table.q-table tbody tr td') || {}).innerText);
    await nx.click();
    try { await page.waitForFunction(a => (document.querySelector('table.q-table tbody tr td') || {}).innerText !== a, antes, { timeout: 5000 }); } catch (e) { break; }
  }
  const rodape = await page.evaluate(() => (document.querySelector('.q-table__bottom') || {}).innerText || '').catch(() => '');
  console.log('Paginas lidas:', paginas, '| Rodape:', String(rodape).replace(/\s+/g, ' ').slice(0, 120));
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
    const temSenha = async () => { for (let i = 0; i < 6; i++) { try { return (await page.locator('input[type=password]').count()) > 0; } catch (e) { await page.waitForTimeout(900); } } return false; };
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
        throw new Error('Login não concluído (contrato ' + (contratoOk ? 'digitado' : 'NÃO encontrado na tela') + '; senha recusada, captcha ou verificação extra?). Selects=[' + mascarar(info.selects) + '] Campos=[' + mascarar(info.campos) + '] Botões=[' + mascarar(info.botoes) + '] Avisos=[' + mascarar(info.avisos) + '] Texto=[' + mascarar(info.texto) + ']');
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2500);
    }
    // vai direto para a tela Aquaviária; se o Geport redirecionar para outra página, tenta de novo
    let achou = false, ultimaUrl = '';
    for (let t = 0; t < 4 && !achou; t++) {
      try {
        await page.goto(BASE + ROTA, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1500);
        if (!page.url().includes('aquaviaria')) {
          await page.evaluate(h => { location.hash = h; }, ROTA).catch(() => {});
          await page.waitForTimeout(1500);
        }
        ultimaUrl = page.url();
        await page.waitForSelector('table.q-table tbody tr', { timeout: 20000 });
        // espera os dados carregarem: uma linha com 10+ colunas e nome de embarcação preenchido
        await page.waitForFunction(() => [].slice.call(document.querySelectorAll('table.q-table tbody tr')).some(tr => tr.children.length >= 10 && tr.children[1] && tr.children[1].innerText.trim()), null, { timeout: 40000 });
        achou = true;
      } catch (e) { ultimaUrl = page.url(); await page.waitForTimeout(2000); }
    }
    if (!achou) {
      const info = await page.evaluate(() => ({
        tabelas: document.querySelectorAll('table').length,
        linhas: document.querySelectorAll('table.q-table tbody tr').length,
        texto: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200)
      })).catch(() => ({}));
      const mascarar2 = t => [USER, PASS].filter(Boolean).reduce((r, v) => r.split(v).join('***'), String(t || ''));
      throw new Error('Tabela de navios não apareceu. Caminho=' + (ultimaUrl.split('geport.triunfologistica.com.br')[1] || ultimaUrl).slice(0, 80) + ' tabelas=' + info.tabelas + ' linhas=' + info.linhas + ' Texto=[' + mascarar2(info.texto) + ']');
    }
    const todos = await lerTabela(page);
    if (!todos.length) {
      const d = await page.evaluate(() => { const tr = document.querySelector('table.q-table tbody tr'); return { linhas: document.querySelectorAll('table.q-table tbody tr').length, colunas: tr ? tr.children.length : 0, cab: [].slice.call(document.querySelectorAll('table.q-table thead th')).length }; }).catch(() => ({}));
      throw new Error('A tabela veio sem navios (linhas=' + d.linhas + ' colunas=' + d.colunas + ' cabecalhos=' + d.cab + '); leitura ignorada.');
    }
    // só guarda o que o Line Up usa: previstos (sem data de início, não finalizados/cancelados)
    const fin = r => r.sit.includes('assignment_turned_in'), canc = r => r.sit.includes('highlight_off');
    const semIni = todos.filter(r => !r.ini);
    let prev = semIni.filter(r => !fin(r) && !canc(r));
    let modo = 'icones';
    // se o filtro por ícones cortar tudo (ícones não informativos), usa só a data de início
    if (!prev.length && semIni.length) { prev = semIni.map(r => ({ ...r, sit: [] })); modo = 'so-data-inicio'; }
    const contIcones = {};
    todos.forEach(r => r.sit.forEach(i => { contIcones[i] = (contIcones[i] || 0) + 1; }));
    const diag = { linhas: todos.length, semInicio: semIni.length, comInicio: todos.length - semIni.length, finalizados: todos.filter(fin).length, cancelados: todos.filter(canc).length, icones: contIcones, modo };
    // além dos previstos, leva os demais navios (em operação, finalizados) só com nome e carga: o painel usa a carga para escolher o modelo do catálogo
    const codsPrev = new Set(prev.map(r => r.cod));
    const outros = todos.filter(r => !codsPrev.has(r.cod) && !canc(r)).map(r => ({ cod: r.cod, navio: r.navio, eta: r.eta, etd: '', ini: r.ini || 'sim', fim: '', classe: r.classe, carga: r.carga, berco: '', origem: '', sit: r.sit }));
    const nPrev = prev.length;
    prev = prev.map(r => ({ cod: r.cod, navio: r.navio, eta: r.eta, etd: '', ini: '', fim: '', classe: r.classe, carga: r.carga, berco: '', origem: '', sit: r.sit })).concat(outros);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(ARQ_ENC, JSON.stringify({ ...cifrar({ geradoEm: Date.now(), dados: prev }), atualizado: st.atualizado }) + '\n');
    st = { ok: true, erro: '', atualizado: st.atualizado, ultimoSucesso: st.atualizado, total: todos.length, previstos: nPrev, diag };
    console.log('OK:', todos.length, 'linhas lidas;', nPrev, 'previstos (dados criptografados). Diagnóstico:', JSON.stringify(diag));
  } catch (e) {
    st.erro = [USER, PASS].filter(Boolean).reduce((t, v) => t.split(v).join('***'), String(e.message || e)).slice(0, 500);
    console.error('FALHOU:', st.erro);
  } finally {
    if (browser) await browser.close();
  }
  gravarStatus(st);
})();
