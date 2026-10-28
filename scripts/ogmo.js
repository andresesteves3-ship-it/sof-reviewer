// Robô do OGMO-RJ (Requisições de mão de obra) — roda no GitHub Actions.
// Entra no sistema com Empresa / Login / Senha guardados como Secrets (OGMO_EMPRESA / OGMO_USER / OGMO_PASS),
// abre Requisições > Registro de Requisições, escolhe Porto = RIO DE JANEIRO e Período = TODOS,
// lê as requisições do dia (e do dia seguinte), a composição e os ternos de cada uma,
// e grava dados/ogmo.enc.json CRIPTOGRAFADO com a chave LINEUP_KEY (o repositório é público).
// Nunca imprime dados, usuário ou senha no log. Só LÊ: não cria, altera nem cancela requisições.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const BASE = process.env.OGMO_URL || 'https://www.ogmorj.com.br/weboperador/WEBOPERADOR12081830.dll';
const EMPRESA = (process.env.OGMO_EMPRESA || '').trim();
const USER = (process.env.OGMO_USER || '').trim();
const PASS = process.env.OGMO_PASS || '';
const KEY = (process.env.LINEUP_KEY || '').trim();
const PORTO = process.env.OGMO_PORTO || 'RIO DE JANEIRO';
const DIAS = (process.env.OGMO_DIAS || '0,1,-1')   // hoje primeiro (mais importante), depois amanhã e ontem
  .split(',').map(x => parseInt(x, 10)).filter(x => !isNaN(x));
const DIR = path.join(__dirname, '..', 'dados');
const ARQ_ENC = path.join(DIR, 'ogmo.enc.json');
const ARQ_ST = path.join(DIR, 'ogmo-status.json');

function cifrar(obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const k = crypto.pbkdf2Sync(KEY, salt, 200000, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}
function gravarStatus(st) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ARQ_ST, JSON.stringify(st, null, 1) + '\n'); }
const mascarar = t => { let r = String(t || ''); [EMPRESA, USER, PASS].filter(v => v && v.length > 2).forEach(v => { r = r.split(v).join('***'); }); return r; };
const espera = ms => new Promise(r => setTimeout(r, ms));

// ---- utilidades que procuram em todos os frames da página (o OGMO pode usar frames) ----
async function frameCom(page, fn, ms) {
  const fim = Date.now() + (ms || 15000);
  while (Date.now() < fim) {
    for (const fr of page.frames()) {
      try { const r = await fn(fr); if (r) return { fr, r }; } catch (e) {}
    }
    await espera(400);
  }
  return null;
}
async function resumoFrames(page) {
  const out = [];
  for (const fr of page.frames()) {
    try {
      out.push(await fr.evaluate(() => ({
        sel: document.querySelectorAll('select').length, tab: document.querySelectorAll('table').length,
        inp: document.querySelectorAll('input').length,
        txt: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 140)
      })));
    } catch (e) { out.push({ erro: String(e.message).slice(0, 60) }); }
  }
  return out;
}

// Funções que rodam DENTRO da página: acham as grades pelo texto do cabeçalho.
const NA_PAGINA = `
(() => {
  const norm = t => (t || '').replace(/\\s+/g, ' ').trim();
  const tabelas = () => [].slice.call(document.querySelectorAll('table')).filter(t => !t.querySelector('table'));
  const linhas = t => [].slice.call(t.querySelectorAll('tr')).map(tr => [].slice.call(tr.children).map(c => norm(c.innerText)));
  const acha = chaves => tabelas().filter(t => { const L = linhas(t); return L.some(r => chaves.every(k => r.some(c => c.toLowerCase() === k.toLowerCase()))); })[0] || null;
  const dados = (t, chaves, min) => { if (!t) return null; const L = linhas(t); const h = L.findIndex(r => chaves.every(k => r.some(c => c.toLowerCase() === k.toLowerCase())));
    return { cab: L[h], linhas: L.slice(h + 1).filter(r => r.length >= min && r.some(c => c)) }; };
  window.__rb = {
    principal: () => dados(acha(['Requisição', 'Navio', 'Período']), ['Requisição', 'Navio', 'Período'], 5),
    composicao: () => dados(acha(['Categoria', 'Função', 'Vagas']), ['Categoria', 'Função', 'Vagas'], 3),
    ternos: () => dados(acha(['Equipe', 'Faina 1']), ['Equipe', 'Faina 1'], 2),
    marcar: i => { const t = acha(['Requisição', 'Navio', 'Período']); if (!t) return false; const L = [].slice.call(t.querySelectorAll('tr'));
      const h = L.findIndex(tr => [].slice.call(tr.children).some(c => norm(c.innerText).toLowerCase() === 'requisição'));
      const dd = L.slice(h + 1).filter(tr => tr.children.length >= 5 && /\\d{5,}/.test(norm(tr.children[1] ? tr.children[1].innerText : '')));
      document.querySelectorAll('[data-rb]').forEach(e => e.removeAttribute('data-rb'));
      if (!dd[i]) return false; dd[i].children[1].setAttribute('data-rb', 'x'); return true; },
    selects: () => [].slice.call(document.querySelectorAll('select')).map((s, i) => ({ i, ops: [].slice.call(s.options).map(o => norm(o.text)) })),
    campoData: () => { const l = [].slice.call(document.querySelectorAll('input')); const i = l.findIndex(x => /^\\d{2}\\/\\d{2}\\/\\d{4}$/.test(x.value || '')); return i < 0 ? null : { i, v: l[i].value, ro: !!l[i].readOnly }; }
  };
  return true;
})()`;

async function entrar(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const ach = await frameCom(page, fr => fr.locator('input[type=password]').count(), 25000);
  if (!ach) throw new Error('Tela de login do OGMO não apareceu.');
  const fr = ach.fr;
  // campos de texto visíveis, de cima para baixo: 1º Empresa, 2º Login
  const caixas = await fr.locator('input').evaluateAll(els => els.map((e, i) => { const r = e.getBoundingClientRect(); return { i, t: (e.type || 'text').toLowerCase(), y: r.top, w: r.width, vis: r.width > 0 && r.height > 0 }; }));
  const textos = caixas.filter(c => c.vis && (c.t === 'text' || c.t === '')).sort((a, b) => a.y - b.y);
  const senha = caixas.find(c => c.vis && c.t === 'password');
  if (textos.length < 2 || !senha) throw new Error('Não achei os 3 campos (Empresa, Login, Senha) na tela de login.');
  await fr.locator('input').nth(textos[0].i).fill(EMPRESA);
  await fr.locator('input').nth(textos[1].i).fill(USER);
  await fr.locator('input').nth(senha.i).fill(PASS);
  const bt = fr.getByRole('button', { name: /^entrar$/i }).first();
  if (await bt.count()) await bt.click(); else await fr.locator('input').nth(senha.i).press('Enter');
  // login concluído = nenhum campo de senha em nenhum frame
  const fim = Date.now() + 25000;
  while (Date.now() < fim) {
    await espera(700);
    let tem = false;
    for (const f of page.frames()) { try { if (await f.locator('input[type=password]').count()) tem = true; } catch (e) {} }
    if (!tem) return;
  }
  throw new Error('Login no OGMO não concluído (senha recusada ou verificação extra?).');
}

async function abrirRegistro(page) {
  const m = await frameCom(page, async fr => { const l = fr.getByText(/^\s*Requisições\s*$/); return (await l.count()) ? l.first() : null; }, 25000);
  if (!m) throw new Error('Não achei o menu "Requisições" depois do login.');
  await m.r.hover().catch(() => {});
  await espera(500);
  await m.r.click().catch(() => {});
  const s = await frameCom(page, async fr => { const l = fr.getByText(/Registro de Requisi/); return (await l.count()) && await l.first().isVisible() ? l.first() : null; }, 10000);
  if (!s) throw new Error('Não achei "Registro de Requisições" no menu.');
  await s.r.click();
  // tela pronta = frame com pelo menos 2 selects e a grade de requisições
  const t = await frameCom(page, async fr => (await fr.locator('select').count()) >= 2 && (await fr.getByText(/Requisição de Trabalhadores/).count()) ? true : null, 25000);
  if (!t) throw new Error('A tela "Requisição de Trabalhadores" não carregou.');
  return t.fr;
}

async function escolherFiltros(fr) {
  await fr.evaluate(NA_PAGINA);
  const sels = await fr.evaluate(() => window.__rb.selects());
  const ip = sels.find(s => s.ops.some(o => o.toUpperCase() === PORTO.toUpperCase()));
  const iq = sels.find(s => s.ops.some(o => /^todos$/i.test(o)));
  if (!ip || !iq) throw new Error('Não achei as listas Porto/Período (selects=' + sels.length + ').');
  await fr.locator('select').nth(ip.i).selectOption({ label: ip.ops.find(o => o.toUpperCase() === PORTO.toUpperCase()) });
  await espera(1500);
  await fr.locator('select').nth(iq.i).selectOption({ label: iq.ops.find(o => /^todos$/i.test(o)) });
  await espera(2500);
}

// reencontra o frame da tela (a página pode recarregar a cada clique)
async function frameDaTela(page) {
  const t = await frameCom(page, async fr => (await fr.getByText(/Requisição de Trabalhadores/).count()) ? true : null, 15000);
  if (!t) throw new Error('Perdi a tela de requisições.');
  // IntraWeb: a tela só está pronta depois do onload (variável GActivateLock)
  await t.fr.waitForFunction(() => typeof window.SubmitClickConfirm !== 'function' || typeof window.GActivateLock !== 'undefined', null, { timeout: 25000 }).catch(() => {});
  await t.fr.evaluate(NA_PAGINA);
  return t.fr;
}

// ---- relatório oficial (PDF) de cada requisição: o robô clica no botão "Gera Relatório da Requisição Selecionada" ----
const PDFS = process.env.OGMO_PDFS !== '0';                       // OGMO_PDFS=0 desliga
const MAX_PDFS = parseInt(process.env.OGMO_PDFS_MAX || '15', 10); // máximo de PDFs novos por rodada
const DIR_PDF = path.join(DIR, 'rpdf');
const ARQ_IDX = path.join(DIR, 'ogmo-pdfs.json');
let CTX = null; const PDFBUF = [];
let idxAnt = {}, idxNovo = {}, pdfsFeitos = 0;
try { idxAnt = JSON.parse(fs.readFileSync(ARQ_IDX, 'utf8')); } catch (e) {}
const sha = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 20);
// O sistema é IntraWeb: cada botão tem um nome (IWRELATORIO = PDF da requisição) e é acionado por SubmitClickConfirm.
const IW = { req: 'IWRELATORIO' };
async function iwTem(fr) { return fr.evaluate(() => typeof window.SubmitClickConfirm === 'function').catch(() => false); }
async function iwSubmit(fr, nome) { return fr.evaluate(n => { window.SubmitClickConfirm(n, '', true, ''); return true; }, nome); }
// depois de um download a página não recarrega e o IntraWeb deixa a tela "trancada": solta a trava
async function iwDestrancar(fr) { await fr.evaluate(() => { window.GSubmitting = false; try { window.ReleaseLock(); } catch (e) {} try { window.SetBusy(false); } catch (e) {} }).catch(() => {}); }
async function botaoPorTexto(fr, tipo) {
  const da9 = fr.locator('input[value="DA9"], button:has-text("DA9"), a:has-text("DA9"), img[alt*="DA9"], [title*="DA9"]').first();   // só como referência de posição
  let a = fr.locator('img[title*="Relat"], input[type=image][title*="Relat"], [alt*="Relat"], a[title*="Relat"], button[title*="Relat"]').first();
  if (await a.count()) return a;
  a = da9.locator('xpath=preceding::*[self::img or self::input or self::button or self::a][1]');
  return (await a.count()) ? a : null;
}
// aciona o botão e devolve os bytes do PDF (download, resposta application/pdf ou janela impressa)
async function baixar(page, fr, tipo) {
  const iw = await iwTem(fr);
  let alvo = null;
  if (!iw) { alvo = await botaoPorTexto(fr, tipo); if (!alvo) throw new Error('botão do relatório não encontrado'); }
  PDFBUF.length = 0;
  let pop = null, down = null;
  CTX.waitForEvent('page', { timeout: 30000 }).then(p => { pop = p; }, () => {});
  page.waitForEvent('download', { timeout: 30000 }).then(d => { down = d; }, () => {});
  if (iw) await iwSubmit(fr, IW[tipo]); else await alvo.click();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !PDFBUF.length && !down) { await espera(400); if (pop && Date.now() - t0 > 9000) break; }
  await espera(1200);
  let buf = null;
  if (down) buf = fs.readFileSync(await down.path());
  else if (PDFBUF.length) buf = PDFBUF.slice().sort((a, b) => b.length - a.length)[0];
  else if (pop) { await pop.waitForLoadState('domcontentloaded').catch(() => {}); buf = await pop.pdf({ format: 'A4', printBackground: true }); }
  if (pop) await pop.close().catch(() => {});
  await page.bringToFront().catch(() => {});
  await iwDestrancar(fr);
  if (!buf || buf.length < 500 || buf.slice(0, 4).toString() !== '%PDF') throw new Error('o OGMO não devolveu um PDF');
  return buf;
}
async function guardarPdf(dir, req, nome, buf) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, req + '.enc.json'), JSON.stringify(cifrar({ nome, b64: buf.toString('base64') })) + '\n');
}
// PDF da requisição; só baixa de novo quando a requisição mudou
async function pdfDaRequisicao(page, fr, req) {
  const f = path.join(DIR_PDF, req.req + '.enc.json');
  const sig = sha(JSON.stringify([req.cancelada, req.escalada, req.local, req.periodo, req.comp, req.ternos]));
  const ant = idxAnt[req.req] || {}, novo = { sig: ant.sig || sig, em: ant.em || Date.now() };
  const temPdf = ant.sig === sig && fs.existsSync(f);
  if (temPdf) req.pdf = 'ok'; else if (ant.sig && fs.existsSync(f)) req.pdf = 'ok';   // mantém o anterior se não der para atualizar agora
  idxNovo[req.req] = novo;
  if (!temPdf && pdfsFeitos < MAX_PDFS) {
    pdfsFeitos++;
    try { await guardarPdf(DIR_PDF, req.req, 'Requisicao-' + req.req + '.pdf', await baixar(page, fr, 'req')); novo.sig = sig; novo.em = Date.now(); req.pdf = 'ok'; delete req.pdfErro; }
    catch (e) { req.pdfErro = String(e.message).slice(0, 60); }
  }
}

// Segurança e velocidade: nenhum botão que altera requisição sai do navegador; imagens viram um GIF vazio (a tela só inicia depois de carregá-las).
const GIF = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');
const PROIBIDO = /^(BTN(?!ENTRAR$)|IWBUTTON)/i;
let BLOQUEADO = '';
async function protegerContexto(ctx) {
  await ctx.route('**/*', route => {
    const rq = route.request();
    if (rq.method() === 'POST' && /\/EXEC$/i.test(rq.url())) {
      let ac = ''; try { ac = new URLSearchParams(rq.postData() || '').get('IW_Action') || ''; } catch (e) {}
      if (PROIBIDO.test(ac)) { BLOQUEADO = ac; return route.abort(); }
    }
    if (['image', 'media', 'font'].includes(rq.resourceType())) return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
    return route.continue();
  });
}
async function lerDia(page, fr0) {
  let fr = await frameDaTela(page);
  let P = await fr.evaluate(() => window.__rb.principal());
  for (let t = 0; t < 6 && (!P || !P.linhas.length); t++) { await espera(1200); fr = await frameDaTela(page); P = await fr.evaluate(() => window.__rb.principal()); }
  const reqs = [];
  const linhas = (P && P.linhas ? P.linhas : []).filter(r => /\d{5,}/.test(r[1] || ''));
  for (let i = 0; i < linhas.length; i++) {
    const r = linhas[i];
    const req = { cancelada: r[0], req: r[1], navio: r[2], periodo: r[3], local: r[4], escalada: r[5] || '', viagem: r[6] || '', comp: [], ternos: [] };
    try {
      fr = await frameDaTela(page);
      if (await fr.evaluate(n => window.__rb.marcar(n), i)) {
        await fr.locator('[data-rb="x"]').first().click();
        await espera(1800);
        fr = await frameDaTela(page);
        const C = await fr.evaluate(() => window.__rb.composicao());
        const T = await fr.evaluate(() => window.__rb.ternos());
        req.comp = (C ? C.linhas : []).map(c => ({ cancelado: c[0], categoria: c[1], funcao: c[2], vagas: c[3] }));
        req.ternos = (T ? T.linhas : []).map(c => ({ cancelado: c[0], equipe: c[1], fainas: c.slice(2).filter(Boolean) }));
        if (PDFS && !/sim/i.test(req.cancelada || '')) { try { await pdfDaRequisicao(page, fr, req); } catch (e) { req.pdfErro = String(e.message).slice(0, 60); } fr = await frameDaTela(page); }
      }
    } catch (e) { req.erro = String(e.message).slice(0, 80); }
    reqs.push(req);
  }
  return reqs;
}

async function trocarData(page, ddmmyyyy) {
  const fr = await frameDaTela(page);
  const c = await fr.evaluate(() => window.__rb.campoData());
  if (!c) throw new Error('Campo da data não encontrado.');
  if (c.ro) throw new Error('Campo da data é somente leitura.');
  const loc = fr.locator('input').nth(c.i);
  await loc.click(); await loc.press('Control+A'); await loc.pressSequentially(ddmmyyyy.replace(/\//g, ''), { delay: 40 }).catch(() => {});
  let v = await loc.inputValue();
  if (v !== ddmmyyyy) { await loc.fill(ddmmyyyy); v = await loc.inputValue(); }
  await loc.press('Tab');
  await espera(2500);
  const fr2 = await frameDaTela(page);
  return fr2;
}
const dm = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();


(async () => {
  let st = { ok: false, erro: '', atualizado: new Date().toISOString() };
  try { st.ultimoSucesso = JSON.parse(fs.readFileSync(ARQ_ST, 'utf8')).ultimoSucesso; } catch (e) {}
  let browser, page;
  try {
    if (!EMPRESA || !USER || !PASS || !KEY) throw new Error('Faltam os Secrets OGMO_EMPRESA, OGMO_USER, OGMO_PASS e/ou LINEUP_KEY no GitHub.');
    browser = await chromium.launch();
    CTX = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: 'pt-BR', acceptDownloads: true });
    await protegerContexto(CTX);
    CTX.on('response', async rs => { try { if (/pdf/i.test(rs.headers()['content-type'] || '')) { const b = await rs.body(); if (b && b.length > 500) PDFBUF.push(b); } } catch (e) {} });
    page = await CTX.newPage();
    page.setDefaultTimeout(30000);
    page.on('dialog', d => d.dismiss().catch(() => {}));   // nunca confirma nada
    await entrar(page);
    let fr = await abrirRegistro(page);
    await escolherFiltros(fr);
    const dias = [], diag = { frames: (await resumoFrames(page)).length };
    // data de hoje exibida pelo sistema
    fr = await frameDaTela(page);
    const c0 = await fr.evaluate(() => window.__rb.campoData());
    const hoje = c0 ? c0.v : dm(new Date());
    const [d0, m0, y0] = hoje.split('/').map(Number);
    for (const off of DIAS) {
      const dt = new Date(y0, m0 - 1, d0 + off), lbl = dm(dt);
      try {
        { fr = await frameDaTela(page); const atual = await fr.evaluate(() => window.__rb.campoData());
          if (!atual || atual.v !== lbl) { await trocarData(page, lbl); fr = await frameDaTela(page); await escolherFiltros(fr); } }
        // confere se a tela está mesmo no dia pedido (senão leria o dia errado com o rótulo deste)
        fr = await frameDaTela(page);
        const cd = await fr.evaluate(() => window.__rb.campoData());
        if (!cd || cd.v !== lbl) throw new Error('a tela ficou em ' + (cd ? cd.v : '?') + ' em vez de ' + lbl);
        const reqs = await lerDia(page, fr);
        dias.push({ data: lbl, reqs });
      } catch (e) { dias.push({ data: lbl, reqs: [], erro: mascarar(String(e.message)).slice(0, 120) }); }
    }
    const chaveD = s => s.split('/').reverse().join('');
    dias.sort((a, b) => chaveD(a.data) < chaveD(b.data) ? -1 : 1);
    const total = dias.reduce((a, d) => a + d.reqs.length, 0);
    // índice dos PDFs e limpeza dos que não existem mais (só se todos os dias foram lidos)
    if (PDFS) {
      if (!dias.some(d => d.erro)) { try { for (const n of fs.readdirSync(DIR_PDF)) { if (!idxNovo[n.replace(/\.enc\.json$/, '')]) fs.unlinkSync(path.join(DIR_PDF, n)); } } catch (e) {} }
      else Object.keys(idxAnt).forEach(k => { if (!idxNovo[k] && fs.existsSync(path.join(DIR_PDF, k + '.enc.json'))) idxNovo[k] = idxAnt[k]; });
      fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ARQ_IDX, JSON.stringify(idxNovo) + '\n');
    }
    if (!dias.some(d => !d.erro)) throw new Error('Nenhum dia foi lido: ' + dias.map(d => d.data + ': ' + d.erro).join(' | '));
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(ARQ_ENC, JSON.stringify({ ...cifrar({ geradoEm: Date.now(), dias }), atualizado: st.atualizado }) + '\n');
    st = { ok: true, erro: '', atualizado: st.atualizado, ultimoSucesso: st.atualizado, total, dias: dias.map(d => ({ data: d.data, n: d.reqs.length, erro: d.erro || '' })), diag };
    console.log('OK:', total, 'requisições lidas; dias:', JSON.stringify(st.dias), '(dados criptografados).');
  } catch (e) {
    let extra = '';
    try { if (page) extra = ' Frames=' + JSON.stringify(await resumoFrames(page)).slice(0, 600); } catch (x) {}
    st.erro = mascarar(String(e.message || e) + (BLOQUEADO ? ' [bloqueado: ' + BLOQUEADO + ']' : '') + extra).slice(0, 900);
    console.error('FALHOU:', st.erro);
  } finally {
    if (browser) await browser.close();
  }
  gravarStatus(st);
})();
