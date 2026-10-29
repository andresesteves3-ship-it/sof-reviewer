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

// ---- acha o rodapé da tabela (onde fica "RESULTADOS POR PÁGINA 10" e "1 / 2") e marca com data-rbrod ----
// No Geport esse rodapé NÃO é o .q-table__bottom padrão: procura pelo texto "POR PÁGINA" e sobe até o bloco que tem os botões.
async function marcaRodape(page) {
  return page.evaluate(() => {
    document.querySelectorAll('[data-rbrod]').forEach(e => e.removeAttribute('data-rbrod'));
    const n = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    let el = document.querySelector('.q-table__bottom');
    if (!el || !/POR\s*P.{1,2}GINA|\d+\s*\/\s*\d+/.test(n(el.innerText))) {
      const lab = [].slice.call(document.querySelectorAll('body *')).filter(e => /POR\s*P.{1,2}GINA/.test(n(e.innerText)) && (e.innerText || '').length < 400)
        .sort((a, b) => a.innerText.length - b.innerText.length)[0];
      el = lab || null;
      for (let k = 0; k < 8 && el && el.parentElement; k++) {
        if (el.querySelectorAll('button, .q-btn, [role=button]').length >= 2 && /\d+\s*\/\s*\d+/.test(el.innerText || '') ) break;
        if (el.querySelectorAll('button, .q-btn, [role=button]').length >= 4) break;
        el = el.parentElement;
      }
    }
    if (!el) return null;
    el.setAttribute('data-rbrod', '1');
    return { tag: el.tagName, cls: String(el.className || '').slice(0, 80), txt: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 150), botoes: el.querySelectorAll('button, .q-btn, [role=button]').length };
  }).catch(() => null);
}

// ---- "Resultados por página": acha a caixinha do rodapé (a que mostra "10") e escolhe o maior valor ----
async function porPaginaMax(page, dg) {
  const nLinhas = () => page.evaluate(() => document.querySelectorAll('table.q-table tbody tr').length).catch(() => 0);
  const antes = await nLinhas();
  dg.linhasAntes = antes;
  dg.rodapeAchado = await marcaRodape(page);
  // 1) <select> nativo no rodapé
  const nat = page.locator('[data-rbrod] select, .q-pagination select').first();
  if (await nat.count()) {
    const t = await nat.locator('option').allTextContents(); dg.porPagina = t;
    let i = t.findIndex(x => /todos|all/i.test(x)); if (i < 0) i = t.map(x => parseInt(x, 10) || 0).reduce((m, v, k, arr) => v > arr[m] ? k : m, 0);
    await nat.selectOption({ index: i }); dg.escolhido = t[i]; dg.modo = 'select';
  } else {
    // 2) caixinha do Quasar: marca o menor elemento clicável do rodapé que mostra só o número atual (ex.: "10")
    const achou = await page.evaluate(() => {
      document.querySelectorAll('[data-rbpp]').forEach(e => e.removeAttribute('data-rbpp'));
      const rod = document.querySelector('[data-rbrod]');
      if (!rod) return { ok: false, motivo: 'rodapé não achado' };
      const cands = [].slice.call(rod.querySelectorAll('.q-select, .q-field, [role=combobox], [role=button], .q-btn-dropdown, .q-btn, div, span'))
        .filter(e => { const r = e.getBoundingClientRect(); const tx = (e.innerText || '').replace(/arrow_drop_down|expand_more|keyboard_arrow_down/g, '').trim(); return r.width > 0 && r.height > 0 && /^\d{1,3}$|^todos$/i.test(tx); })
        .filter(e => !e.closest('button[aria-label*="page" i]'));
      // prefere componentes de seleção; senão o menor elemento
      cands.sort((a, b) => { const s = e => (e.matches('.q-select, [role=combobox], .q-field') ? 0 : e.matches('.q-btn-dropdown') ? 1 : 2); const q = e => (/^10\b/.test((e.innerText || '').trim()) ? 0 : 1); return s(a) - s(b) || q(a) - q(b) || (a.innerText.length - b.innerText.length); });
      const el = cands[0]; if (!el) return { ok: false, motivo: 'caixinha não achada', rod: (rod.innerText || '').replace(/\s+/g, ' ').slice(0, 120) };
      const alvo = el.querySelector('.q-field__control, .q-field__native') || el; alvo.setAttribute('data-rbpp', '1');
      return { ok: true, tag: el.tagName, cls: String(el.className || '').slice(0, 80), txt: (el.innerText || '').trim().slice(0, 20) };
    });
    dg.caixa = achou;
    if (!achou.ok) return;
    const cx = page.locator('[data-rbpp]').first();
    const opsLoc = page.locator('.q-menu .q-item, .q-menu [role=option], [role=listbox] [role=option], .q-virtual-scroll__content .q-item');
    let n = 0;
    for (const modo of ['click', 'mouse', 'teclado']) {
      if (modo === 'click') await cx.click({ timeout: 5000 }).catch(() => {});
      else if (modo === 'mouse') { const bb = await cx.boundingBox(); if (bb) await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
      else { await cx.focus().catch(() => {}); await page.keyboard.press('ArrowDown').catch(() => {}); }
      await page.waitForTimeout(900);
      n = await opsLoc.count();
      if (n) { dg.abriu = modo; break; }
    }
    if (!n) { dg.porPagina = []; await page.keyboard.press('Escape').catch(() => {}); return; }
    const t = []; for (let k = 0; k < n; k++) t.push(((await opsLoc.nth(k).innerText().catch(() => '')) || '').trim());
    dg.porPagina = t;
    let i = t.findIndex(x => /todos|all/i.test(x)); if (i < 0) i = t.map(x => parseInt(x, 10) || 0).reduce((m, v, k, arr) => v > arr[m] ? k : m, 0);
    await opsLoc.nth(i).click(); dg.escolhido = t[i]; dg.modo = 'quasar';
  }
  // espera a tabela crescer
  try { await page.waitForFunction(a => document.querySelectorAll('table.q-table tbody tr').length > a, antes, { timeout: 15000 }); } catch (e) { dg.naoCresceu = true; }
  await page.waitForTimeout(1500);
  dg.linhasDepois = await nLinhas();
}

async function lerTabela(page) {
  const vistos = new Set(), out = [];
  const ler = async () => {
    const rows = await page.evaluate(() => {
    // coluna "CLASSIFICAÇÃO DA OPERAÇÃO" (importação / exportação) achada pelo cabeçalho; se não achar, usa a 7ª coluna
    const ths = [].slice.call(document.querySelectorAll('table.q-table thead th')).map(th => (th.innerText || '').toUpperCase());
    const iCl = ths.findIndex(h => /CLASSIFICA/.test(h)), iC = iCl >= 0 ? iCl : 6;
    return [].slice.call(document.querySelectorAll('table.q-table tbody tr')).map(tr => {
      const td = tr.children, x = i => td[i] ? td[i].innerText.replace(/\s+/g, ' ').trim() : '';
      // ícones da coluna SITUAÇÃO: o Geport mostra o ícone ativo em preto e o inativo em cinza claro
      const ic = [].slice.call(td[9] ? td[9].querySelectorAll('i') : []).map(i => {
        const cs = getComputedStyle(i), c = (cs.color.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
        const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255, alfa = (c.length > 3 ? c[3] : 1) * Number(cs.opacity || 1);
        return { n: i.textContent.trim(), on: i.classList.contains('on'), cor: cs.color, op: cs.opacity, w: i.offsetWidth, cls: String(i.className || '').slice(0, 80), escuro: lum < 0.45 && alfa > 0.6 && cs.visibility !== 'hidden' && i.getClientRects().length > 0 && i.offsetWidth > 0 };
      }).filter(i => i.n);
      return { cod: x(0), navio: x(1), eta: x(2), etd: x(3), ini: x(4), fim: x(5), classe: x(iC), carga: x(7), berco: x(8), origem: x(11), ic };
    });
    });
    rows.forEach(r => { if (r.cod && r.navio && !vistos.has(r.cod)) { vistos.add(r.cod); out.push(r); } });
  };
  const off = async b => (await b.count()) === 0 || await b.evaluate(e => e.disabled || /disabled/.test(e.className) || e.getAttribute('aria-disabled') === 'true');
  const pagInfo = async () => { await marcaRodape(page); return page.evaluate(() => {
    const b = document.querySelector('[data-rbrod]'); if (!b) return null;
    const extra = [].slice.call(b.querySelectorAll('input')).map(i => (i.value || '') + ' ' + (i.placeholder || '')).join(' ');
    const t = ((b.innerText || '') + ' ' + extra).replace(/\s+/g, ' ');
    let m = t.match(/(\d+)\s*\/\s*(\d+)/); if (m) return { at: +m[1], tot: +m[2] };
    m = t.match(/(\d+)\s*-\s*(\d+)\s*(?:de|of)\s*(\d+)/i); if (m) { const por = (+m[2]) - (+m[1]) + 1; return { at: Math.ceil(+m[2] / por), tot: Math.ceil(+m[3] / por), linhas: +m[3] }; }
    return null; }).catch(() => null); };
  const RE_ICO = { primeira: /first_page|first|skip_previous|double_arrow_left|chevrons?-left|angle-double-left/i, seguinte: /keyboard_arrow_right|chevron_right|navigate_next|arrow_forward_ios|chevron-right|angle-right/i };
  const btn = async tipo => {
    await marcaRodape(page);
    const bs = page.locator('[data-rbrod] button, [data-rbrod] .q-btn, [data-rbrod] [role=button]');
    const n = await bs.count();
    for (let i = 0; i < n; i++) { const t = (await bs.nth(i).innerText().catch(() => '')) + ' ' + (await bs.nth(i).getAttribute('aria-label').catch(() => '') || ''); if (RE_ICO[tipo].test(t)) return bs.nth(i); }
    if (n >= 4) return bs.nth(tipo === 'primeira' ? n - 4 : n - 2);  // ordem usual: |<  <  >  >|
    return page.locator('#nao-existe');
  };
  const dg = { porPagina: [], escolhido: '', botoes: [], rodape: '', tentativas: [] };
  // aumenta "RESULTADOS POR PÁGINA" (rodapé da tabela) de 10 para o máximo disponível ("Todos" ou o maior número)
  try { await porPaginaMax(page, dg); } catch (e) { dg.erroPorPagina = String(e.message || e).slice(0, 120); }
  await ler();   // garante a leitura do que já está na tela
  let info = await pagInfo();
  if (info && info.at > 1) { const pr = await btn('primeira'); if (!(await off(pr))) { await pr.click(); await page.waitForTimeout(1500); } }
  let paginas = 0;
  for (let i = 0; i < 80; i++) {
    await ler(); paginas++;
    info = await pagInfo();
    if (info && info.at >= info.tot) break;
    const nx = await btn('seguinte');
    if (await off(nx)) { dg.tentativas.push('pag ' + paginas + ': botão seguinte não achado/desabilitado'); break; }
    const antes = await page.evaluate(() => (document.querySelector('table.q-table tbody tr td') || {}).innerText);
    await nx.click();
    try { await page.waitForFunction(a => (document.querySelector('table.q-table tbody tr td') || {}).innerText !== a, antes, { timeout: 8000 }); } catch (e) { dg.tentativas.push('pag ' + paginas + ': cliquei em seguinte e a tabela não mudou'); break; }
  }
  await marcaRodape(page);
  const rodape = await page.evaluate(() => (document.querySelector('[data-rbrod]') || {}).innerText || '').catch(() => '');
  console.log('Paginas lidas:', paginas, '| Rodape:', String(rodape).replace(/\s+/g, ' ').slice(0, 120));
  dg.rodape = String(rodape).replace(/\s+/g, ' ').slice(0, 160);
  dg.botoes = await page.evaluate(() => [].slice.call(document.querySelectorAll('[data-rbrod] button, [data-rbrod] .q-btn, [data-rbrod] [role=button]')).map(b => ((b.innerText || '').trim() + '|' + (b.getAttribute('aria-label') || '') + '|' + ((b.querySelector('i') || {}).className || '') + (b.disabled || b.getAttribute('aria-disabled') === 'true' ? '|off' : '')).slice(0, 90))).catch(() => []);
  dg.inputs = await page.evaluate(() => [].slice.call(document.querySelectorAll('[data-rbrod] input')).map(i => (i.value || '') + '|' + (i.placeholder || ''))).catch(() => []);
  out.paginas = paginas; out.totalPaginas = info ? info.tot : null; out.dg = dg;
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
    // situação: usa os ícones escuros (ativos); se nenhum ícone escuro foi reconhecido em nenhuma linha, usa a classe "on"
    const usaCor = todos.some(r => r.ic.some(i => i.escuro));
    todos.forEach(r => { r.sit = r.ic.filter(i => usaCor ? i.escuro : i.on).map(i => i.n); });
    const fin = r => r.sit.includes('assignment_turned_in'), canc = r => r.sit.includes('highlight_off');
    const contIcones = {};
    todos.forEach(r => r.ic.forEach(i => { const c = contIcones[i.n] = contIcones[i.n] || { total: 0, ativo: 0, on: 0 }; c.total++; if (i.escuro) c.ativo++; if (i.on) c.on++; }));
    const semIni = todos.filter(r => !r.ini);
    const diag = { linhas: todos.length, paginas: todos.paginas, totalPaginas: todos.totalPaginas, semInicio: semIni.length, comInicio: todos.length - semIni.length,
      classificacao: todos.reduce((a, r) => { const k = /EXPORT/i.test(r.classe) ? 'exportacao' : /IMPORT/i.test(r.classe) ? 'importacao' : (r.classe ? 'outro:' + String(r.classe).slice(0, 20) : 'vazio'); a[k] = (a[k] || 0) + 1; return a; }, {}),
      finalizados: todos.filter(fin).length, cancelados: todos.filter(canc).length, icones: contIcones, modo: usaCor ? 'cor' : 'classe-on',
      paginacao: todos.dg, exemploIcones: todos.slice(0, 2).map(r => r.ic.map(i => ({ n: i.n, cor: i.cor, op: i.op, w: i.w, on: i.on, cls: i.cls }))) };
    // grava todos os navios lidos (previstos, em operação, finalizados e cancelados): o painel decide o que mostrar
    const prev = todos.map(r => ({ cod: r.cod, navio: r.navio, eta: r.eta, etd: r.etd, ini: r.ini, fim: r.fim, classe: r.classe, carga: r.carga, berco: r.berco, origem: r.origem, sit: r.sit }));
    const nPrev = semIni.filter(r => !fin(r) && !canc(r)).length;
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
