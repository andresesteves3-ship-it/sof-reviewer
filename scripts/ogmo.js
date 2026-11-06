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
function decifrar(o) {
  const salt = Buffer.from(o.salt, 'base64'), iv = Buffer.from(o.iv, 'base64'), ct = Buffer.from(o.ct, 'base64');
  const k = crypto.pbkdf2Sync(KEY, salt, 200000, 32, 'sha256');
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(ct.slice(ct.length - 16));
  return JSON.parse(Buffer.concat([d.update(ct.slice(0, ct.length - 16)), d.final()]).toString('utf8'));
}
// leitura anterior (para não perder a composição quando o OGMO falha numa requisição)
let ANT = {}, ANT_EM = 0, ANT_DIAS = [];
function carregarAnterior() {
  try { const o = JSON.parse(fs.readFileSync(ARQ_ENC, 'utf8')); const d = decifrar(o); ANT_EM = d.geradoEm || 0; ANT_DIAS = d.dias || [];
    (d.dias || []).forEach(dia => (dia.reqs || []).forEach(r => { if (r && r.req && ((r.comp || []).length || (r.ternos || []).length) && !r.erro) ANT[r.req] = r; })); } catch (e) {}
}
let RECUP = 0, REUSO = 0, EQUIPES = 0, CANC_PULADAS = 0, SEM_ATUALIZAR = 0, ONTEM_REPETIDO = 0;
const T0 = Date.now(), TEMPOS = {};
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
    marcar: (i, num) => { const t = acha(['Requisição', 'Navio', 'Período']); if (!t) return false; const L = [].slice.call(t.querySelectorAll('tr'));
      const h = L.findIndex(tr => [].slice.call(tr.children).some(c => norm(c.innerText).toLowerCase() === 'requisição'));
      const dd = L.slice(h + 1).filter(tr => tr.children.length >= 5 && /\\d{5,}/.test(norm(tr.children[1] ? tr.children[1].innerText : '')));
      document.querySelectorAll('[data-rb]').forEach(e => e.removeAttribute('data-rb'));
      const alvo = (num && dd.find(tr => norm(tr.children[1].innerText) === num)) || dd[i]; if (!alvo) return false; alvo.children[1].setAttribute('data-rb', 'x'); return true; },
    // v0.83.1: marca a linha i (0 = 1ª) da grade de Equipes, na coluna "Equipe". Só seleciona a linha; não altera nada.
    marcarEquipe: (i, num) => { const t = acha(['Equipe', 'Faina 1']); if (!t) return false; const L = [].slice.call(t.querySelectorAll('tr'));
      const h = L.findIndex(tr => [].slice.call(tr.children).some(c => norm(c.innerText).toLowerCase() === 'equipe'));
      const dd = L.slice(h + 1).filter(tr => tr.children.length >= 2 && /^\\d+$/.test(norm(tr.children[1] ? tr.children[1].innerText : '')));
      document.querySelectorAll('[data-rbeq]').forEach(e => e.removeAttribute('data-rbeq'));
      const alvo = (num && dd.find(tr => norm(tr.children[1].innerText) === String(num))) || dd[i]; if (!alvo) return false; alvo.children[1].setAttribute('data-rbeq', 'x'); return true; },
    // v0.83.1: marca a grade da composição antes do clique; depois do clique, a grade nova não tem a marca (prova que a tela atualizou)
    marcaComp: () => { const t = acha(['Categoria', 'Função', 'Vagas']); if (!t) return false; t.setAttribute('data-rbv', '1'); [].slice.call(t.querySelectorAll('tr')).forEach(tr => tr.setAttribute('data-rbv', '1')); return true; },
    // v0.84.0: marca também a grade de Equipes (no clique da requisição, uma das duas grades tem de atualizar)
    marcaEq: () => { const t = acha(['Equipe', 'Faina 1']); if (!t) return false; t.setAttribute('data-rbv', '1'); [].slice.call(t.querySelectorAll('tr')).forEach(tr => tr.setAttribute('data-rbv', '1')); return true; },
    eqMudou: () => { const t = acha(['Equipe', 'Faina 1']); if (!t) return false; if (!t.hasAttribute('data-rbv')) return true; const L = [].slice.call(t.querySelectorAll('tr')); const h = L.findIndex(tr => [].slice.call(tr.children).some(c => norm(c.innerText).toLowerCase() === 'equipe')); const D = L.slice(h + 1); return D.length > 0 && D.every(tr => !tr.hasAttribute('data-rbv')); },
    compMudou: () => { const t = acha(['Categoria', 'Função', 'Vagas']); if (!t) return false; if (!t.hasAttribute('data-rbv')) return true; const L = [].slice.call(t.querySelectorAll('tr')); const h = L.findIndex(tr => [].slice.call(tr.children).some(c => norm(c.innerText).toLowerCase() === 'função')); const D = L.slice(h + 1); return D.length > 0 && D.every(tr => !tr.hasAttribute('data-rbv')); },
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

// a tela do OGMO (IntraWeb) às vezes recarrega, "tranca" ou a sessão cai no meio da leitura:
// reabre Requisições > Registro, refaz os filtros e volta para o dia que estava sendo lido
async function recuperar(page, lbl) {
  let fr;
  try { fr = await abrirRegistro(page); }
  catch (e) { await entrar(page); fr = await abrirRegistro(page); }
  await escolherFiltros(fr);
  fr = await frameDaTela(page);
  let c = await fr.evaluate(() => window.__rb.campoData());
  if (!c || c.v !== lbl) { await trocarData(page, lbl); fr = await frameDaTela(page); await escolherFiltros(fr); fr = await frameDaTela(page); c = await fr.evaluate(() => window.__rb.campoData()); }
  if (!c || c.v !== lbl) throw new Error('não consegui voltar para o dia ' + lbl);
  RECUP++;
  return fr;
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
// alvoDado: elemento já localizado (ex.: botão DA9); senão usa o botão do relatório da requisição
async function baixar(page, fr, tipo, alvoDado) {
  const iw = alvoDado ? false : await iwTem(fr);
  let alvo = alvoDado || null;
  if (!iw && !alvo) { alvo = await botaoPorTexto(fr, tipo); if (!alvo) throw new Error('botão do relatório não encontrado'); }
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
let BLOQUEADO = '', PERMITIDO = '';   // PERMITIDO: nome exato do botão DA9 (relatório, só leitura), usado pelo robô TPA
async function protegerContexto(ctx) {
  await ctx.route('**/*', route => {
    const rq = route.request();
    if (rq.method() === 'POST' && /\/EXEC$/i.test(rq.url())) {
      let ac = ''; try { ac = new URLSearchParams(rq.postData() || '').get('IW_Action') || ''; } catch (e) {}
      if (PROIBIDO.test(ac) && !/DA9/i.test(ac) && !(PERMITIDO && ac.toUpperCase() === PERMITIDO)) { BLOQUEADO = ac; return route.abort(); }
    }
    if (['image', 'media', 'font'].includes(rq.resourceType())) return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
    return route.continue();
  });
}
async function lerDia(page, fr0, lbl) {
  let fr;
  try { fr = await frameDaTela(page); } catch (e) { fr = await recuperar(page, lbl); }
  let P = await fr.evaluate(() => window.__rb.principal());
  for (let t = 0; t < 6 && (!P || !P.linhas.length); t++) { await espera(1200); fr = await frameDaTela(page); P = await fr.evaluate(() => window.__rb.principal()); }
  const reqs = [];
  const linhas = (P && P.linhas ? P.linhas : []).filter(r => /\d{5,}/.test(r[1] || ''));
  for (let i = 0; i < linhas.length; i++) {
    const r = linhas[i];
    const req = { cancelada: r[0], req: r[1], navio: r[2], periodo: r[3], local: r[4], escalada: r[5] || '', viagem: r[6] || '', comp: [], ternos: [] };
    // v0.84.0: requisição cancelada: o robô só lê a linha (o painel não confere requisição cancelada)
    if (/^s/i.test(req.cancelada || '')) { req.semComp = 'cancelada'; CANC_PULADAS++; reqs.push(req); continue; }
    for (let tent = 0; tent < 3; tent++) {
      try {
        fr = await frameDaTela(page);
        if (!(await fr.evaluate(([n, num]) => window.__rb.marcar(n, num), [i, req.req]))) throw new Error('requisição não encontrada na grade');
        await fr.evaluate(() => { window.__rb.marcaComp(); window.__rb.marcaEq(); });
        await fr.locator('[data-rb="x"]').first().click();
        // v0.84.0: espera a tela atualizar a composição ou as equipes (no máximo 6 s), em vez de 1,8 s fixos
        { let mudou = false; const fim = Date.now() + 6000; await espera(250);
          while (Date.now() < fim) { try { fr = await frameDaTela(page); if (await fr.evaluate(() => window.__rb.compMudou() || window.__rb.eqMudou())) { mudou = true; break; } } catch (x) {} await espera(250); }
          if (mudou) await espera(300); else SEM_ATUALIZAR++;   // sem sinal de atualização (ex.: a linha já estava selecionada): lê assim mesmo, como antes
          fr = await frameDaTela(page); }
        const C = await fr.evaluate(() => window.__rb.composicao());
        const T = await fr.evaluate(() => window.__rb.ternos());
        req.comp = (C ? C.linhas : []).map(c => ({ cancelado: c[0], categoria: c[1], funcao: c[2], vagas: c[3] }));
        req.ternos = (T ? T.linhas : []).map(c => ({ cancelado: c[0], equipe: c[1], fainas: c.slice(2).filter(Boolean) }));
        delete req.erro;
        fr = await lerEquipes(page, fr, req, lbl);
        // o PDF oficial só é tentado na 1ª vez (é o passo que mais derruba a tela)
        if (!PDFS && fs.existsSync(path.join(DIR_PDF, req.req + '.enc.json'))) req.pdf = 'ok';   // v0.85.0: os PDFs vêm na 2ª etapa
        if (PDFS && tent === 0 && !/sim/i.test(req.cancelada || '')) {
          try { await pdfDaRequisicao(page, fr, req); } catch (e) { req.pdfErro = String(e.message).slice(0, 60); }
          try { fr = await frameDaTela(page); } catch (e) { fr = await recuperar(page, lbl); }
        }
        break;
      } catch (e) {
        req.erro = mascarar(String(e.message)).slice(0, 80);
        if (tent < 2) { try { await espera(1500); await recuperar(page, lbl); } catch (x) { req.erro += ' (não recuperou: ' + mascarar(String(x.message)).slice(0, 60) + ')'; break; } }
      }
    }
    // não deu mesmo: usa a composição da leitura anterior, se a requisição for a mesma
    const a = ANT[req.req];
    if (req.erro && a && a.navio === req.navio && a.periodo === req.periodo) {
      req.comp = a.comp || []; req.ternos = a.ternos || []; if (a.porEquipe) req.porEquipe = 1; req.aviso = 'Composição da leitura anterior (' + new Date(ANT_EM).toISOString() + '); o OGMO falhou agora: ' + req.erro;
      delete req.erro; REUSO++;
    }
    reqs.push(req);
  }
  return reqs;
}

// v0.83.1: composição de cada equipe (terno). A equipe 1 já vem selecionada quando a requisição abre: usa a composição lida.
// Para as outras, clica na linha da equipe (só seleciona) e lê a composição. Não clica na grade da composição (lá o clique abre a edição).
// Falhou uma equipe: usa a leitura anterior daquela equipe, se a requisição for a mesma; senão marca compErro (o painel não acusa diferença).
async function lerEquipes(page, fr, req, lbl) {
  req.porEquipe = 1;
  const vivas = req.ternos.filter(t => !/^s/i.test(t.cancelado || ''));
  req.ternos.forEach(t => { if (/^s/i.test(t.cancelado || '')) t.comp = []; });
  if (!vivas.length) return fr;
  vivas[0].comp = req.comp.slice();
  const a = ANT[req.req], antEq = n => { if (!a || a.navio !== req.navio || a.periodo !== req.periodo || !a.porEquipe) return null; const x = (a.ternos || []).find(t => String(t.equipe) === String(n)); return x && Array.isArray(x.comp) && !x.compErro ? x.comp : null; };
  for (let k = 1; k < vivas.length; k++) {
    const t = vivas[k];
    try {
      if (!(await fr.evaluate(([i, n]) => window.__rb.marcarEquipe(i, n), [req.ternos.indexOf(t), t.equipe]))) throw new Error('equipe ' + t.equipe + ' não encontrada na grade');
      await fr.evaluate(() => window.__rb.marcaComp());
      await fr.locator('[data-rbeq="x"]').first().click();
      // espera a tela atualizar a composição (no máximo 6 s); sem atualizar = não lida (nunca grava a composição da equipe anterior)
      let mudou = false; const fim = Date.now() + 6000; await espera(250);
      while (Date.now() < fim) { try { fr = await frameDaTela(page); if (await fr.evaluate(() => window.__rb.compMudou())) { mudou = true; break; } } catch (x) {} await espera(250); }
      if (!mudou) throw new Error('a composição da equipe ' + t.equipe + ' não atualizou');
      await espera(300); fr = await frameDaTela(page);
      const C = await fr.evaluate(() => window.__rb.composicao());
      t.comp = (C ? C.linhas : []).map(c => ({ cancelado: c[0], categoria: c[1], funcao: c[2], vagas: c[3] }));
      EQUIPES++;
    } catch (e) {
      const ant = antEq(t.equipe);
      if (ant) { t.comp = ant; t.compAnt = 1; REUSO++; } else t.compErro = mascarar(String(e.message)).slice(0, 60);
      try { fr = await frameDaTela(page); } catch (x) { fr = await recuperar(page, lbl); }
    }
  }
  return fr;
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


async function main() {
  let st = { ok: false, erro: '', atualizado: new Date().toISOString() };
  let FANT = 0;   // falhas seguidas até a rodada anterior (o painel avisa a partir de 2)
  try { const a = JSON.parse(fs.readFileSync(ARQ_ST, 'utf8')); st.ultimoSucesso = a.ultimoSucesso; FANT = a.falhasSeguidas || 0; } catch (e) {}
  let browser, page;
  try {
    if (!EMPRESA || !USER || !PASS || !KEY) throw new Error('Faltam os Secrets OGMO_EMPRESA, OGMO_USER, OGMO_PASS e/ou LINEUP_KEY no GitHub.');
    carregarAnterior();
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
    TEMPOS.login = Date.now() - T0; TEMPOS.dias = {};
    // v0.85.0: "ontem" quase não muda: lê até as 08h (Brasília) e depois a cada 3 h; nas outras leituras repete a leitura anterior
    const hBR = new Date(Date.now() - 3 * 3600e3).getUTCHours();
    const lerOntem = process.env.OGMO_ONTEM === '1' || hBR < 8 || hBR % 3 === 0;
    for (const off of DIAS) {
      const dt = new Date(y0, m0 - 1, d0 + off), lbl = dm(dt), tD = Date.now();
      if (off < 0 && !lerOntem) { const a = ANT_DIAS.find(x => x.data === lbl && !x.erro); if (a) { dias.push(Object.assign({}, a, { anterior: 1 })); TEMPOS.dias[lbl] = 0; ONTEM_REPETIDO = 1; continue; } }
      for (let tent = 0; tent < 2; tent++) {
      try {
        { fr = await frameDaTela(page); const atual = await fr.evaluate(() => window.__rb.campoData());
          if (!atual || atual.v !== lbl) { await trocarData(page, lbl); fr = await frameDaTela(page); await escolherFiltros(fr); } }
        // confere se a tela está mesmo no dia pedido (senão leria o dia errado com o rótulo deste)
        fr = await frameDaTela(page);
        const cd = await fr.evaluate(() => window.__rb.campoData());
        if (!cd || cd.v !== lbl) throw new Error('a tela ficou em ' + (cd ? cd.v : '?') + ' em vez de ' + lbl);
        const reqs = await lerDia(page, fr, lbl);
        dias.push({ data: lbl, reqs, lidoEm: Date.now() });
        break;
      } catch (e) {
        if (tent === 1) { dias.push({ data: lbl, reqs: [], erro: mascarar(String(e.message)).slice(0, 120) }); break; }
        try { await recuperar(page, lbl); } catch (x) {}
      }
      }
      if (TEMPOS.dias[lbl] == null) TEMPOS.dias[lbl] = Date.now() - tD;
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
    st = { ok: true, erro: '', atualizado: st.atualizado, ultimoSucesso: st.atualizado, total, dias: dias.map(d => ({ data: d.data, n: d.reqs.length, erro: d.erro || '' })), diag: { ...diag, recuperacoes: RECUP, reaproveitadas: REUSO, equipesLidas: EQUIPES, canceladasPuladas: CANC_PULADAS, semAtualizar: SEM_ATUALIZAR, ontemRepetido: ONTEM_REPETIDO }, tempos: Object.assign({}, TEMPOS, { total: Date.now() - T0 }), pdfsSeparados: !PDFS };
    console.log('OK:', total, 'requisições lidas; dias:', JSON.stringify(st.dias), '(dados criptografados).');
  } catch (e) {
    let extra = '';
    try { if (page) extra = ' Frames=' + JSON.stringify(await resumoFrames(page)).slice(0, 600); } catch (x) {}
    st.erro = mascarar(String(e.message || e) + (BLOQUEADO ? ' [bloqueado: ' + BLOQUEADO + ']' : '') + extra).slice(0, 900);
    console.error('FALHOU:', st.erro);
  } finally {
    if (browser) await browser.close();
  }
  st.falhasSeguidas = st.ok ? 0 : FANT + 1;
  gravarStatus(st);
}

// ---- v0.85.0: 2ª etapa (OGMO_SO_PDF=1): os dados já foram publicados; agora baixa os PDFs oficiais que mudaram ----
async function mainPdf() {
  const t0 = Date.now(); let st = {};
  try { st = JSON.parse(fs.readFileSync(ARQ_ST, 'utf8')); } catch (e) {}
  let env, d;
  try { env = JSON.parse(fs.readFileSync(ARQ_ENC, 'utf8')); d = decifrar(env); } catch (e) { console.log('Sem dados do OGMO para os PDFs.'); return; }
  const sigDe = r => sha(JSON.stringify([r.cancelada, r.escalada, r.local, r.periodo, r.comp, r.ternos]));
  const tem = r => fs.existsSync(path.join(DIR_PDF, r + '.enc.json'));
  const todos = [];
  (d.dias || []).forEach(dia => (dia.reqs || []).forEach(r => { if (r && r.req && !/^s/i.test(r.cancelada || '') && !r.erro) todos.push({ dia: dia.data, r }); }));
  const marcaAntes = todos.map(x => (x.r.pdf || '') + '|' + (x.r.pdfErro || '')).join(',');
  idxNovo = {}; const fila = [];
  todos.forEach(x => { const s = sigDe(x.r), a = idxAnt[x.r.req]; if (a && a.sig === s && tem(x.r.req)) idxNovo[x.r.req] = a; else { if (a && tem(x.r.req)) idxNovo[x.r.req] = a; x.s = s; fila.push(x); } });
  const vez = fila.slice(0, MAX_PDFS); let feitos = 0, erros = 0, browser;
  if (vez.length) {
    try {
      if (!EMPRESA || !USER || !PASS || !KEY) throw new Error('Faltam os Secrets do OGMO.');
      browser = await chromium.launch();
      CTX = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: 'pt-BR', acceptDownloads: true });
      await protegerContexto(CTX);
      CTX.on('response', async rs => { try { if (/pdf/i.test(rs.headers()['content-type'] || '')) { const b = await rs.body(); if (b && b.length > 500) PDFBUF.push(b); } } catch (e) {} });
      const page = await CTX.newPage(); page.setDefaultTimeout(30000); page.on('dialog', dd => dd.dismiss().catch(() => {}));
      await entrar(page); let fr = await abrirRegistro(page); await escolherFiltros(fr);
      const porDia = {}; vez.forEach(x => { (porDia[x.dia] = porDia[x.dia] || []).push(x); });
      for (const lbl of Object.keys(porDia)) {
        try {
          fr = await frameDaTela(page); let c = await fr.evaluate(() => window.__rb.campoData());
          if (!c || c.v !== lbl) { await trocarData(page, lbl); fr = await frameDaTela(page); await escolherFiltros(fr); fr = await frameDaTela(page); c = await fr.evaluate(() => window.__rb.campoData()); }
          if (!c || c.v !== lbl) throw new Error('não abriu o dia ' + lbl);
        } catch (e) { erros += porDia[lbl].length; porDia[lbl].forEach(x => { x.r.pdfErro = String(e.message).slice(0, 60); }); continue; }
        for (const x of porDia[lbl]) {
          try {
            fr = await frameDaTela(page);
            if (!(await fr.evaluate(n => window.__rb.marcar(-1, n), x.r.req))) throw new Error('requisição não está mais na grade');
            await fr.evaluate(() => { window.__rb.marcaComp(); window.__rb.marcaEq(); });
            await fr.locator('[data-rb="x"]').first().click();
            { const fim = Date.now() + 6000; await espera(250); while (Date.now() < fim) { try { fr = await frameDaTela(page); if (await fr.evaluate(() => window.__rb.compMudou() || window.__rb.eqMudou())) { await espera(300); break; } } catch (q) {} await espera(250); } fr = await frameDaTela(page); }
            await guardarPdf(DIR_PDF, x.r.req, 'Requisicao-' + x.r.req + '.pdf', await baixar(page, fr, 'req'));
            idxNovo[x.r.req] = { sig: x.s, em: Date.now() }; x.r.pdf = 'ok'; delete x.r.pdfErro; feitos++;
          } catch (e) { erros++; x.r.pdfErro = mascarar(String(e.message)).slice(0, 60); try { await frameDaTela(page); } catch (q) {} }
        }
      }
    } catch (e) { erros = vez.length - feitos; console.error('PDFs: ' + mascarar(String(e.message)).slice(0, 200)); }
    finally { if (browser) await browser.close(); }
  }
  // limpeza dos PDFs de requisições que não existem mais (só se todos os dias foram lidos)
  if (!(d.dias || []).some(x => x.erro)) { try { for (const n of fs.readdirSync(DIR_PDF)) { const k = n.replace(/\.enc\.json$/, ''); if (!todos.some(x => x.r.req === k)) fs.unlinkSync(path.join(DIR_PDF, n)); } } catch (e) {} }
  else Object.keys(idxAnt).forEach(k => { if (!idxNovo[k] && tem(k)) idxNovo[k] = idxAnt[k]; });
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ARQ_IDX, JSON.stringify(idxNovo) + '\n');
  // marca nos dados quais requisições têm o PDF oficial
  const marca = () => todos.map(x => (x.r.pdf || '') + '|' + (x.r.pdfErro || '')).join(',');
  const antes = marcaAntes;
  todos.forEach(x => { if (tem(x.r.req)) x.r.pdf = 'ok'; });
  if (marca() !== antes) fs.writeFileSync(ARQ_ENC, JSON.stringify({ ...cifrar(d), atualizado: env.atualizado }) + '\n');   // só regrava se mudou
  st.pdfs = { em: new Date().toISOString(), ms: Date.now() - t0, feitos, erros, faltam: Math.max(0, fila.length - vez.length) };
  st.pdfsEm = st.pdfs.em;
  gravarStatus(st);
  console.log('PDFs: ' + feitos + ' baixado(s), ' + erros + ' erro(s), ' + st.pdfs.faltam + ' para a próxima leitura.');
}

// o robô TPA (scripts/tpa.js) reaproveita o login e a navegação deste robô
module.exports = {
  entrar, abrirRegistro, escolherFiltros, frameDaTela, trocarData, recuperar, protegerContexto, baixar, cifrar, decifrar, mascarar, espera, resumoFrames, dm,
  lerEquipes, lerDia, PDFBUF, usarContexto: c => { CTX = c; }, permitir: n => { PERMITIDO = String(n || '').toUpperCase(); }, bloqueado: () => BLOQUEADO
};
if (require.main === module) { if (process.env.OGMO_SO_PDF === '1') mainPdf(); else main(); }
