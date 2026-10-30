// Robô TPA — roda no GitHub Actions nos horários do DA9 (04:35, 10:35, 16:35 e 19:35) e pelo botão do painel.
// Entra no OGMO com os mesmos Secrets do Robô do OGMO, olha as requisições de hoje e de amanhã e,
// para cada requisição com equipe escalada (Já Escalada? = SIM) e não cancelada, baixa o DA9 (PDF),
// guarda o PDF criptografado em dados/da9/<requisição>.enc.json e lê só NOME e MATRÍCULA dos TPAs.
// A lista de TPAs vai CRIPTOGRAFADA para dados/tpa.enc.json (o repositório é público); o painel inclui
// no banco de TPAs os que ainda não estão lá. Só LÊ: o único botão acionado é o DA9 (relatório).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const og = require('./ogmo.js');

const EMPRESA = (process.env.OGMO_EMPRESA || '').trim();
const USER = (process.env.OGMO_USER || '').trim();
const PASS = process.env.OGMO_PASS || '';
const KEY = (process.env.LINEUP_KEY || '').trim();
const DIAS = (process.env.TPA_DIAS || '0,1').split(',').map(x => parseInt(x, 10)).filter(x => !isNaN(x));
const MAX = parseInt(process.env.TPA_MAX || '15', 10);
const FORCAR = process.env.TPA_FORCAR === '1';
const DIR = path.join(__dirname, '..', 'dados');
const DIR_DA9 = path.join(DIR, 'da9');
const ARQ_TPA = path.join(DIR, 'tpa.enc.json');
const ARQ_IDX = path.join(DIR, 'da9.json');
const ARQ_ST = path.join(DIR, 'tpa-status.json');
const { espera, mascarar } = og;

const lerJson = (f, pad) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return pad; } };

// ---------- leitura do PDF (pdf.js): junta os pedaços de texto por linha ----------
async function linhasDoPdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    const L = [];
    tc.items.forEach(it => {
      const s = String(it.str || ''); if (!s.trim()) return;
      const x = it.transform[4], y = it.transform[5];
      let l = L.find(q => Math.abs(q.y - y) <= 2.5);
      if (!l) { l = { y, it: [] }; L.push(l); }
      l.it.push({ x, s, w: it.width || 0 });
    });
    L.sort((a, b) => b.y - a.y).forEach(l => {
      l.it.sort((a, b) => a.x - b.x);
      let t = '', fim = null;
      l.it.forEach(i => { if (fim !== null) t += (i.x - fim > 6 ? '  ' : (i.x - fim > 0.8 ? ' ' : '')); t += i.s; fim = i.x + i.w; });
      out.push(t.replace(/[ \t]+$/, ''));
    });
  }
  await doc.destroy().catch(() => {});
  return out;
}
// "159601746 EDJAIR ROCHA R 1ª RDG 50 SG 10:32" -> { mat: '159601746', nome: 'EDJAIR ROCHA' }
const LETRA = "A-ZÀ-ÖØ-Ý";
const RE_LINHA = new RegExp('^\\s*(\\d{5,10})\\s+([' + LETRA + "][" + LETRA + "'´`.\\- ]*?[" + LETRA + '.])(?=\\s+[RC]\\b|\\s{2,}|\\s+\\d|\\s*$)');
function tpasDasLinhas(linhas) {
  const vis = {}, out = [];
  linhas.forEach(l => {
    const m = RE_LINHA.exec(l.toUpperCase());
    if (!m) return;
    const nome = m[2].replace(/\s+/g, ' ').trim();
    if (nome.replace(/[^A-ZÀ-Ý]/g, '').length < 3 || vis[m[1]]) return;
    vis[m[1]] = 1; out.push({ mat: m[1], nome });
  });
  return out;
}

// ---------- botão DA9 na tela da requisição ----------
async function acharDA9(fr) {
  return fr.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, ' ').trim();
    document.querySelectorAll('[data-da9]').forEach(e => e.removeAttribute('data-da9'));
    const els = [].slice.call(document.querySelectorAll('input,button,a,img,span,div,td'));
    const c = els.filter(e => {
      const v = norm(e.value), t = e.children.length ? '' : norm(e.innerText), n = (e.id || '') + ' ' + (e.getAttribute('name') || '');
      return /^DA9$/i.test(v) || /^DA9$/i.test(t) || /DA9/i.test(e.title || '') || /DA9/i.test(e.alt || '') || /DA9/i.test(n);
    });
    const l = c.map(e => { const r = e.getBoundingClientRect();
      return { tag: e.tagName, id: (e.id || '').slice(0, 30), name: (e.getAttribute('name') || '').slice(0, 30), val: norm(e.value).slice(0, 20), tit: (e.title || '').slice(0, 40), vis: r.width > 0 && r.height > 0, on: (e.getAttribute('onclick') || '').slice(0, 90) }; });
    let j = l.findIndex(x => x.vis && /^(INPUT|BUTTON|A|IMG)$/.test(x.tag));
    if (j < 0) j = l.findIndex(x => x.vis);
    if (j >= 0) c[j].setAttribute('data-da9', 'x');
    return { l, j };
  });
}
// nome da ação IntraWeb do botão (para liberar só ele na proteção do robô)
function acaoDe(x) { const m = /SubmitClick\w*\(\s*['"]([^'"]+)/i.exec(x.on || ''); return (m ? m[1] : (x.name || x.id || '')).toUpperCase(); }

async function da9DaRequisicao(page, lbl, num, diag) {
  let fr = await og.frameDaTela(page);
  if (!(await fr.evaluate(n => window.__rb.marcar(-1, n), num))) throw new Error('requisição não está na grade');
  await fr.locator('[data-rb="x"]').first().click();
  await espera(1800);
  fr = await og.frameDaTela(page);
  const a = await acharDA9(fr);
  if (!diag.da9) diag.da9 = a.l.slice(0, 6);
  if (a.j < 0) throw new Error('botão DA9 não encontrado');
  og.permitir(acaoDe(a.l[a.j]));
  return og.baixar(page, fr, 'da9', fr.locator('[data-da9="x"]').first());
}

function gravar(f, o) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o) + '\n'); }

async function main() {
  let st = { ok: false, erro: '', atualizado: new Date().toISOString() };
  const ant = lerJson(ARQ_ST, {}); st.ultimoSucesso = ant.ultimoSucesso;
  const idx = lerJson(ARQ_IDX, {});
  let browser, page;
  const diag = {};
  try {
    if (!EMPRESA || !USER || !PASS || !KEY) throw new Error('Faltam os Secrets OGMO_EMPRESA, OGMO_USER, OGMO_PASS e/ou LINEUP_KEY no GitHub.');
    // lista de TPAs já conhecida (para juntar com a nova)
    let base = { geradoEm: 0, tpas: {} };
    try { const e = lerJson(ARQ_TPA, null); if (e) base = og.decifrar(e); } catch (e) { base = { geradoEm: 0, tpas: {} }; }
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: 'pt-BR', acceptDownloads: true });
    og.usarContexto(ctx);
    await og.protegerContexto(ctx);
    ctx.on('response', async rs => { try { if (/pdf/i.test(rs.headers()['content-type'] || '')) { const b = await rs.body(); if (b && b.length > 500) og.PDFBUF.push(b); } } catch (e) {} });
    page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.on('dialog', d => d.dismiss().catch(() => {}));   // nunca confirma nada
    await og.entrar(page);
    let fr = await og.abrirRegistro(page);
    await og.escolherFiltros(fr);
    fr = await og.frameDaTela(page);
    const c0 = await fr.evaluate(() => window.__rb.campoData());
    const hoje = c0 ? c0.v : og.dm(new Date());
    const [d0, m0, y0] = hoje.split('/').map(Number);
    const res = [], dias = [];
    let feitos = 0, novos = 0, mudou = !fs.existsSync(ARQ_TPA);
    for (const off of DIAS) {
      const lbl = og.dm(new Date(y0, m0 - 1, d0 + off));
      try {
        fr = await og.frameDaTela(page);
        const at = await fr.evaluate(() => window.__rb.campoData());
        if (!at || at.v !== lbl) { await og.trocarData(page, lbl); fr = await og.frameDaTela(page); await og.escolherFiltros(fr); fr = await og.frameDaTela(page); }
        const cd = await fr.evaluate(() => window.__rb.campoData());
        if (!cd || cd.v !== lbl) throw new Error('a tela ficou em ' + (cd ? cd.v : '?') + ' em vez de ' + lbl);
        let P = await fr.evaluate(() => window.__rb.principal());
        for (let t = 0; t < 5 && (!P || !P.linhas.length); t++) { await espera(1200); fr = await og.frameDaTela(page); P = await fr.evaluate(() => window.__rb.principal()); }
        const linhas = (P && P.linhas ? P.linhas : []).filter(r => /\d{5,}/.test(r[1] || ''));
        const esc = linhas.filter(r => /sim/i.test(r[5] || '') && !/sim/i.test(r[0] || ''));
        dias.push({ data: lbl, reqs: linhas.length, escaladas: esc.length });
        for (const r of esc) {
          const num = r[1], navio = r[2], per = r[3];
          const ja = idx[num];
          if (ja && ja.n > 0 && !FORCAR) continue;               // DA9 já lido
          if (feitos >= MAX) { res.push({ req: num, data: lbl, erro: 'fica para a próxima rodada (limite ' + MAX + ')' }); continue; }
          feitos++;
          const item = { req: num, navio, periodo: per, data: lbl };
          for (let tent = 0; tent < 2; tent++) {
            try {
              const buf = await da9DaRequisicao(page, lbl, num, diag);
              gravar(path.join(DIR_DA9, num + '.enc.json'), og.cifrar({ nome: 'DA9-' + num + '.pdf', b64: buf.toString('base64') }));
              let lista = [];
              try { lista = tpasDasLinhas(await linhasDoPdf(buf)); } catch (e) { item.aviso = 'não consegui ler o texto do DA9 (' + String(e.message).slice(0, 50) + ')'; }
              lista.forEach(t => {
                if (!base.tpas[t.mat]) novos++;
                base.tpas[t.mat] = Object.assign({}, base.tpas[t.mat] || {}, { mat: t.mat, nome: t.nome, req: num, navio, data: lbl, em: Date.now() });
              });
              item.n = lista.length; if (lista.length) mudou = true;
              idx[num] = { em: Date.now(), n: lista.length, data: lbl, periodo: per };
              delete item.erro;
              break;
            } catch (e) {
              item.erro = mascarar(String(e.message)).slice(0, 90);
              if (tent === 0) { try { await espera(1500); await og.recuperar(page, lbl); } catch (x) { item.erro += ' (não recuperou)'; break; } }
            }
          }
          res.push(item);
        }
      } catch (e) {
        dias.push({ data: lbl, erro: mascarar(String(e.message)).slice(0, 120) });
        try { await og.recuperar(page, lbl); } catch (x) {}
      }
    }
    if (dias.length && dias.every(d => d.erro)) throw new Error('Nenhum dia foi lido: ' + dias.map(d => d.data + ': ' + d.erro).join(' | '));
    // limpa DA9 com mais de 10 dias
    const lim = Date.now() - 10 * 864e5;
    Object.keys(idx).forEach(k => { if ((idx[k].em || 0) < lim) { delete idx[k]; try { fs.unlinkSync(path.join(DIR_DA9, k + '.enc.json')); } catch (e) {} } });
    if (mudou) { base.geradoEm = Date.now(); gravar(ARQ_TPA, Object.assign(og.cifrar(base), { atualizado: st.atualizado })); }   // sem novidade: não reescreve (evita commit à toa)
    gravar(ARQ_IDX, idx);
    st = { ok: true, erro: '', atualizado: st.atualizado, ultimoSucesso: st.atualizado, dias, da9: res.map(x => ({ req: x.req, data: x.data, n: x.n || 0, erro: x.erro || '', aviso: x.aviso || '' })), novos, total: Object.keys(base.tpas).length, diag };
    console.log('OK:', res.length, 'DA9 tentados;', novos, 'TPAs novos; total', st.total, '(dados criptografados).');
  } catch (e) {
    let extra = '';
    try { if (page) extra = ' Frames=' + JSON.stringify(await og.resumoFrames(page)).slice(0, 500); } catch (x) {}
    const b = og.bloqueado();
    st.erro = mascarar(String(e.message || e) + (b ? ' [bloqueado: ' + b + ']' : '') + extra).slice(0, 900);
    st.diag = diag;
    console.error('FALHOU:', st.erro);
  } finally {
    if (browser) await browser.close();
  }
  st.falhasSeguidas = st.ok ? 0 : (ant.falhasSeguidas || 0) + 1;   // o painel avisa a partir de 2
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ARQ_ST, JSON.stringify(st, null, 1) + '\n');
}

module.exports = { linhasDoPdf, tpasDasLinhas };
if (require.main === module) main();
