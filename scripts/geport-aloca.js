// Robô de ALOCAÇÃO no Geport mobile (v0.135.0) — roda no GitHub Actions quando o painel pede.
// Lê os pedidos em /painel/area/gpFila (Firebase), entra no Geport (versão para celular) e, para cada frente:
//   Alocação de Recurso › AQUAVIÁRIO (nº da atracação) ou AVULSA (código da frente) › contrato TPS › Buscar frente
//   › FUNCIONÁRIO › Hora extra › código do funcionário › ADICIONAR › confere em "Visualizar listagem".
// Pedido "fin": abre a listagem e clica em FINALIZAR para as pessoas da escala.
// Pedido com ensaio=true: faz o caminho todo, mas NÃO clica em ADICIONAR nem em FINALIZAR.
// O resultado vai para /painel/area/gpRes/<escala>/<frente> (o painel mostra).
// Localização simulada nas coordenadas do terminal (autorizado pelo usuário). Câmera falsa do navegador.
// Nunca imprime nomes, códigos, usuário ou senha no log: só contagens e etapas.
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const BASE = process.env.GEPORT_URL || 'https://geport.triunfologistica.com.br/';
const USER = process.env.GEPORT_USER || '';
const PASS = process.env.GEPORT_PASS || '';
const CONTRATO = process.env.GEPORT_CONTRATO_ALOC || 'TPS';
const FB_EMAIL = (process.env.FB_ROBO_EMAIL || '').trim();
const FB_PASS = process.env.FB_ROBO_PASS || '';
const GEO = { latitude: -22.8792, longitude: -43.2262, accuracy: 30 };   // terminal (Caju, Rio de Janeiro)
const ESPERA_LISTA = 4500;   // a listagem demora uns 4 s para mostrar os botões

const mascarar = t => [USER, PASS, FB_EMAIL, FB_PASS].filter(v => v && v.length > 2).reduce((r, v) => r.split(v).join('***'), String(t || ''));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const esperar = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Firebase (usuário do robô) ---------- */
let FB = null;
async function fbLogin() {
  const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'firebase-config.json'), 'utf8'));
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(cfg.apiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: FB_EMAIL, password: FB_PASS, returnSecureToken: true }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Login do robô no Firebase recusado (' + ((j.error && j.error.message) || r.status) + ').');
  FB = { tok: j.idToken, db: String(cfg.dbUrl || '').replace(/\/+$/, '') };
}
const fbUrl = (p, q) => FB.db + '/' + p + '.json?auth=' + encodeURIComponent(FB.tok) + (q || '');
async function fbGet(p, q) { const x = await fetch(fbUrl(p, q)); if (!x.ok) throw new Error('Leitura de /' + p + ' recusada (HTTP ' + x.status + ').'); return x.json(); }
async function fbPatch(p, v) { const x = await fetch(fbUrl(p), { method: 'PATCH', body: JSON.stringify(v) }); if (!x.ok) console.log('Aviso: gravação recusada em', p.split('/').slice(0, 3).join('/'), x.status); }

/* ---------- ajudas de tela (Quasar) ---------- */
async function visivel(loc) { try { return await loc.isVisible(); } catch (e) { return false; } }
// clica no primeiro elemento VISÍVEL com o texto; tenta botões, abas, itens de menu e, por último, qualquer texto
async function clicar(page, re, ms) {
  const fim = Date.now() + (ms || 15000);
  const sels = ['button', '.q-btn', '[role=tab]', '.q-tab', '[role=button]', '.q-item', 'a', '[role=radio]', '.q-radio', 'label'];
  while (Date.now() < fim) {
    for (const s of sels) {
      const l = page.locator(s).filter({ hasText: re });
      const n = await l.count().catch(() => 0);
      for (let i = 0; i < n; i++) { const e = l.nth(i); if (await visivel(e)) { await e.click(); return true; } }
    }
    const t = page.getByText(re).first();
    if (await visivel(t)) { await t.click(); return true; }
    await page.waitForTimeout(400);
  }
  return false;
}
// campo de digitação pelo rótulo (q-field), pelo placeholder ou pelo aria-label
async function campo(page, re, fora) {
  if (Array.isArray(re)) { for (const r of re) { const c = await campo(page, r, fora); if (c) return c; } return null; }
  const fs1 = page.locator('.q-field').filter({ hasText: re });
  for (let i = 0; i < await fs1.count(); i++) { if (fora && fora.test(await fs1.nth(i).innerText().catch(() => ''))) continue; const inp = fs1.nth(i).locator('input:not([type=checkbox]):not([type=radio]), textarea').first(); if (await inp.count() && await visivel(inp)) return inp; }
  const ins = page.locator('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=password])');
  for (let i = 0; i < await ins.count(); i++) {
    const e = ins.nth(i); if (!(await visivel(e))) continue;
    const t = await e.evaluate(x => (x.placeholder || '') + ' ' + (x.getAttribute('aria-label') || '') + ' ' + (x.name || '')).catch(() => '');
    if (re.test(t) && !(fora && fora.test(t))) return e;
  }
  return null;
}
async function digitar(inp, txt) { await inp.click(); await inp.fill(''); await inp.pressSequentially(String(txt), { delay: 60 }); }
// resumo da tela sem valores digitados (para descobrir botões e campos quando algo não é achado)
async function resumoTela(page) {
  return page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const t = e => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const uniq = a => a.filter((x, i) => x && a.indexOf(x) === i).slice(0, 25);
    return {
      url: location.hash.slice(0, 80),
      botoes: uniq([].slice.call(document.querySelectorAll('button, .q-btn, [role=tab], .q-tab, .q-item')).filter(vis).map(t)),
      campos: uniq([].slice.call(document.querySelectorAll('.q-field')).filter(vis).map(e => { const l = e.querySelector('.q-field__label, label'); const i = e.querySelector('input'); return (l ? t(l) : '') || (i && (i.placeholder || i.getAttribute('aria-label'))) || '(sem rótulo)'; })),
      marcar: uniq([].slice.call(document.querySelectorAll('.q-checkbox, .q-toggle, .q-radio, [role=checkbox], [role=radio]')).filter(vis).map(e => t(e) + ':' + (e.getAttribute('aria-checked') || ''))),
      avisos: uniq([].slice.call(document.querySelectorAll('.q-notification, .q-banner, [role=alert], .q-field--error .q-field__messages')).filter(vis).map(e => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90))),
      cabecalho: uniq([].slice.call(document.querySelectorAll('header *, .q-header *, .q-toolbar *')).filter(e => vis(e) && !e.children.length).map(t)).join(' | ').slice(0, 160)
    };
  }).catch(() => ({}));
}
// marca os avisos que já estão na tela; avisosNovos devolve só os que apareceram depois
async function marcarAvisos(page) { await page.evaluate(() => document.querySelectorAll('.q-notification').forEach(e => { e.dataset.robo = 'visto'; })).catch(() => {}); }
async function avisosNovos(page, ms) {
  await page.waitForTimeout(ms || 1500);
  const L = await page.evaluate(() => [].slice.call(document.querySelectorAll('.q-notification')).filter(e => e.dataset.robo !== 'visto').map(e => (e.innerText || '').replace(/\s+/g, ' ').replace(/\s*(close|x)$/i, '').trim()).filter(Boolean).slice(-3)).catch(() => []);
  await marcarAvisos(page); return L;
}
async function fecharAvisos(page) { await page.evaluate(() => document.querySelectorAll('.q-notification button').forEach(b => b.click())).catch(() => {}); }

/* ---------- login ---------- */
async function escolherContratoLogin(page) {
  const re = new RegExp(CONTRATO, 'i');
  let c = page.locator('.q-field, label').filter({ hasText: /contrato/i }).locator('input').first();
  if (!(await c.count())) return false;
  await c.click(); await page.waitForTimeout(400); await c.fill(''); await c.pressSequentially(CONTRATO, { delay: 80 }); await page.waitForTimeout(1200);
  const op = page.locator('.q-menu .q-item, [role=option]').filter({ hasText: re }).first();
  if (await op.count()) await op.click(); else await page.keyboard.press('Enter');
  await page.waitForTimeout(500); return true;
}
async function entrar(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const temSenha = async () => (await page.locator('input[type=password]').count().catch(() => 0)) > 0;
  if (!(await temSenha())) return;
  await page.locator('input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=search])').first().fill(USER);
  await page.locator('input[type=password]').first().fill(PASS);
  await escolherContratoLogin(page);
  const b = page.locator('button[type=submit], button:has-text("ENTRAR"), button:has-text("Entrar"), button:has-text("ACESSAR")').first();
  if (await b.count()) await b.click(); else await page.keyboard.press('Enter');
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); if (!(await temSenha())) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2000); return; } }
  throw new Error('Login no Geport não concluído (senha recusada, código extra ou "não sou robô"?). Tela: ' + mascarar(JSON.stringify(await resumoTela(page))));
}
// confere o contrato no canto superior direito; se não for TPS, tenta trocar
async function garantirContrato(page) {
  const re = new RegExp('(^|[^A-Za-z])' + CONTRATO + '([^A-Za-z]|$)', 'i');
  const cab = async () => (await resumoTela(page)).cabecalho || '';
  if (re.test(await cab())) return 'ok';
  const alvo = page.locator('header .q-btn, header .q-select, .q-header .q-btn, .q-header .q-select, .q-toolbar .q-btn').last();
  if (await alvo.count()) {
    await alvo.click().catch(() => {}); await page.waitForTimeout(900);
    const op = page.locator('.q-menu .q-item, [role=option], .q-dialog .q-item').filter({ hasText: re }).first();
    if (await op.count()) { await op.click(); await page.waitForTimeout(2500); }
    else await page.keyboard.press('Escape').catch(() => {});
  }
  return re.test(await cab()) ? 'trocado' : 'nao-confirmado';
}

/* ---------- caminho até a frente ---------- */
let ROTA_ALOC = '';
async function irAlocacao(page) {
  if (ROTA_ALOC) { await page.evaluate(h => { location.hash = h; }, ROTA_ALOC); await page.waitForTimeout(2500); if (await visivel(page.getByText(/AVULSA|AQUAVI/i).first())) return; }
  const reMenu = /Aloca[cç][aã]o de Recurso/i;
  if (!(await visivel(page.getByText(reMenu).first()))) {
    const ham = page.locator('button[aria-label*=enu], .q-btn:has(i:text-is("menu")), button:has(i:text-is("menu"))').first();
    if (await ham.count()) { await ham.click().catch(() => {}); await page.waitForTimeout(900); }
  }
  if (!(await clicar(page, reMenu, 12000))) throw new Error('Não achei o menu "Alocação de Recurso". Tela: ' + JSON.stringify(await resumoTela(page)));
  await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2500);
  ROTA_ALOC = await page.evaluate(() => location.hash).catch(() => '');
}
async function buscarFrente(page, fr) {
  await irAlocacao(page);
  const tipo = fr.tipo === 'nav' ? /AQUAVI[AÁ]RIO/i : /AVULSA/i;
  if (!(await clicar(page, tipo, 10000))) throw new Error('Não achei a opção ' + (fr.tipo === 'nav' ? 'AQUAVIÁRIO' : 'AVULSA') + '. Tela: ' + JSON.stringify(await resumoTela(page)));
  await page.waitForTimeout(1200);
  const ct = await garantirContrato(page);
  let inp = await campo(page, /frente|atraca|c[oó]digo|n[uú]mero|pesquis|busca/i);
  if (!inp) { const ins = page.locator('input:not([type=checkbox]):not([type=radio]):not([type=hidden])'); for (let i = 0; i < await ins.count(); i++) if (await visivel(ins.nth(i))) { inp = ins.nth(i); break; } }
  if (!inp) throw new Error('Não achei o campo do código da frente. Tela: ' + JSON.stringify(await resumoTela(page)));
  await marcarAvisos(page); await digitar(inp, fr.cod); await page.waitForTimeout(900);
  const op = page.locator('.q-menu .q-item').filter({ hasText: new RegExp(fr.cod) }).first();
  if (await visivel(op)) { await op.click(); await page.waitForTimeout(600); }
  if (!(await clicar(page, /Buscar frente|BUSCAR/i, 8000))) await inp.press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2500);
  const av = await avisosNovos(page, 300);
  if (av.some(a => /n[aã]o (foi )?encontrad|inv[aá]lid|erro/i.test(a))) throw new Error('O Geport não achou a frente ' + fr.cod + ': ' + av.join(' / '));
  return ct;
}
async function abaFuncionario(page) {
  if (!(await clicar(page, /FUNCION[AÁ]RIO/i, 12000))) throw new Error('Não achei a aba FUNCIONÁRIO (a frente abriu?). Tela: ' + JSON.stringify(await resumoTela(page)));
  await page.waitForTimeout(1500);
  // Hora extra: marca logo depois de abrir a aba
  const he = page.locator('.q-checkbox, .q-toggle, [role=checkbox]').filter({ hasText: /hora extra/i }).first();
  if (!(await he.count())) return 'sem-campo';
  const est = await he.getAttribute('aria-checked').catch(() => null);
  if (est !== 'true') { await he.click(); await page.waitForTimeout(500); }
  return (await he.getAttribute('aria-checked').catch(() => null)) === 'true' ? 'marcada' : 'nao-confirmada';
}
async function adicionarPessoa(page, p, ensaio) {
  let inp = await campo(page, [/funcion[aá]rio|colaborador|matr[ií]cula/i, /c[oó]digo/i], /frente|atraca/i);
  if (!inp) throw new Error('Não achei o campo do código do funcionário. Tela: ' + JSON.stringify(await resumoTela(page)));
  await digitar(inp, p.cod); await page.waitForTimeout(1200);
  const op = page.locator('.q-menu .q-item').filter({ hasText: new RegExp(p.cod) }).first();
  if (await visivel(op)) { await op.click(); await page.waitForTimeout(600); }
  if (ensaio) { await inp.fill('').catch(() => {}); return { ok: true, msg: 'ensaio: campo achado, ADICIONAR não clicado' }; }
  await fecharAvisos(page); await marcarAvisos(page);
  if (!(await clicar(page, /^\s*ADICIONAR\s*$/i, 8000)) && !(await clicar(page, /ADICIONAR/i, 3000))) throw new Error('Não achei o botão ADICIONAR. Tela: ' + JSON.stringify(await resumoTela(page)));
  const av = await avisosNovos(page, 2500);
  const ruim = av.find(a => /erro|n[aã]o|inv[aá]lid|j[aá] (est[aá]|aloc)|falh|permiss/i.test(a) && !/sucesso/i.test(a));
  if (ruim) return { ok: false, msg: ruim.slice(0, 140) };
  return { ok: true, msg: (av.find(a => /sucesso|adicionad|alocad/i.test(a)) || 'adicionado').slice(0, 140) };
}
// abre "Visualizar listagem", espera os botões e devolve as linhas {nome, sit, i}
async function abrirListagem(page) {
  if (!(await visivel(page.getByText(/Visualizar/i).first()))) { await clicar(page, /FUNCION[AÁ]RIO/i, 6000); await page.waitForTimeout(1200); }
  if (!(await clicar(page, /Visualizar/i, 10000))) throw new Error('Não achei "Visualizar listagem alocação recurso". Tela: ' + JSON.stringify(await resumoTela(page)));
  await page.waitForTimeout(ESPERA_LISTA);
  return page.evaluate(() => [].slice.call(document.querySelectorAll('.q-dialog tbody tr, .q-dialog .q-table tr, tbody tr')).map((tr, i) => {
    const td = [].slice.call(tr.children).map(x => (x.innerText || '').replace(/\s+/g, ' ').trim());
    return { i, nome: td[0] || '', sit: td.find(x => /CONFIRMAD|FINALIZAD|CANCELAD|PENDENT/i.test(x)) || '' };
  }).filter(r => r.nome && !/^NOME$/i.test(r.nome))).catch(() => []);
}
function achaLinha(linhas, nome) {
  const n = norm(nome), ps = n.split(' ');
  return linhas.find(l => norm(l.nome) === n) || linhas.find(l => { const q = norm(l.nome).split(' '); return q[0] === ps[0] && q[q.length - 1] === ps[ps.length - 1]; });
}
async function fecharListagem(page) {
  const b = page.locator('.q-dialog button').filter({ hasText: /close|fechar|voltar/i }).first();
  if (await visivel(b)) await b.click().catch(() => {}); else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
}
async function finalizarPessoa(page, linha, ensaio) {
  const tr = page.locator('.q-dialog tbody tr, tbody tr').nth(linha.i);
  const b = tr.locator('button, .q-btn').filter({ hasText: /FINALIZAR/i }).first();
  if (!(await b.count())) return { ok: false, msg: 'sem botão FINALIZAR (situação: ' + (linha.sit || '?') + ')' };
  if (ensaio) return { ok: true, msg: 'ensaio: FINALIZAR achado, não clicado' };
  await fecharAvisos(page); await marcarAvisos(page); await b.click(); await page.waitForTimeout(1500);
  // confirmação, se o Geport perguntar
  const conf = page.locator('.q-dialog button, .q-dialog .q-btn').filter({ hasText: /^(SIM|CONFIRMAR|OK|SALVAR|FINALIZAR)$/i }).last();
  if (await visivel(conf)) { await conf.click(); await page.waitForTimeout(1500); }
  const av = await avisosNovos(page, 1200);
  const ruim = av.find(a => /erro|n[aã]o|falh/i.test(a) && !/sucesso/i.test(a));
  return ruim ? { ok: false, msg: ruim.slice(0, 140) } : { ok: true, msg: (av[0] || 'finalizado').slice(0, 140) };
}

/* ---------- um pedido ---------- */
async function rodarPedido(page, pid, ped) {
  const fin = ped.tipo === 'fin', ens = !!ped.ensaio;
  let nOk = 0, nErr = 0;
  for (const fr of ped.itens || []) {
    const base = 'painel/area/gpRes/' + ped.esc + '/' + fr.fid + (fin ? '/fin' : '');
    // a pessoa pode ter cancelado esta frente no painel enquanto o pedido esperava
    const atual = await fbGet(base + '/st').catch(() => null);
    if (atual === 'cancelado') { console.log('Frente cancelada no painel: pulada.'); continue; }
    const res = { st: 'rodando', em: Date.now(), por: ped.por || '', ensaio: ens, pessoas: {}, passos: [] };
    await fbPatch(base, { st: 'rodando', em: res.em });
    try {
      if (!fr.cod) throw new Error('A frente não tem código do Geport.');
      res.contrato = await buscarFrente(page, fr); res.passos.push('frente');
      if (!fin) {
        res.horaExtra = await abaFuncionario(page); res.passos.push('funcionario');
        for (const p of fr.pessoas || []) {
          if (!p.cod) { res.pessoas[p.m] = { ok: false, msg: 'sem código no cadastro TPS' }; continue; }
          try { res.pessoas[p.m] = await adicionarPessoa(page, p, ens); } catch (e) { res.pessoas[p.m] = { ok: false, msg: mascarar(e.message).slice(0, 300) }; }
        }
        res.passos.push('adicionar');
        const lin = await abrirListagem(page); res.passos.push('listagem:' + lin.length);
        if (!ens) (fr.pessoas || []).forEach(p => { const r = res.pessoas[p.m]; if (!r || !r.ok) return; const l = achaLinha(lin, p.nome); if (!l) { r.ok = false; r.msg = 'não apareceu na listagem do Geport'; } else r.sit = l.sit; });
        await fecharListagem(page);
      } else {
        const lin = await abrirListagem(page); res.passos.push('listagem:' + lin.length);
        for (const p of fr.pessoas || []) {
          const l = achaLinha(lin, p.nome);
          if (!l) { res.pessoas[p.m] = { ok: false, msg: 'não está na listagem desta frente' }; continue; }
          if (/FINALIZAD/i.test(l.sit)) { res.pessoas[p.m] = { ok: true, msg: 'já estava finalizado' }; continue; }
          try { res.pessoas[p.m] = await finalizarPessoa(page, l, ens); } catch (e) { res.pessoas[p.m] = { ok: false, msg: mascarar(e.message).slice(0, 300) }; }
        }
        await fecharListagem(page);
      }
      const v = Object.values(res.pessoas), ok = v.filter(x => x.ok).length;
      res.st = !v.length ? 'erro' : ok === v.length ? 'ok' : ok ? 'parcial' : 'erro';
      if (!v.length) res.msg = 'Nenhuma pessoa no pedido.';
    } catch (e) {
      res.st = 'erro'; res.msg = mascarar(e.message).slice(0, 900);
    }
    res.fim = Date.now();
    await fbPatch(base, res);
    if (res.st === 'ok') nOk++; else if (res.st === 'parcial') { nOk++; nErr++; } else nErr++;
    console.log('Frente', (fr.tipo === 'nav' ? 'aquaviária' : 'avulsa'), '→', res.st, '| pessoas:', Object.keys(res.pessoas).length, '| etapas:', res.passos.join(','));
  }
  await fbPatch('painel/area/gpFila/' + pid, { st: nErr ? (nOk ? 'parcial' : 'erro') : 'ok', fim: Date.now() });
}

(async () => {
  let browser;
  try {
    if (!USER || !PASS) throw new Error('Faltam os Secrets GEPORT_USER e GEPORT_PASS no GitHub.');
    if (!FB_EMAIL || !FB_PASS) throw new Error('Faltam os Secrets FB_ROBO_EMAIL e FB_ROBO_PASS no GitHub.');
    await fbLogin();
    browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const ctx = await browser.newContext(Object.assign({}, devices['Pixel 7'], { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', geolocation: GEO, permissions: ['geolocation', 'camera'] }));
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    let logado = false, feitos = 0;
    for (let volta = 0; volta < 6; volta++) {
      const fila = (await fbGet('painel/area/gpFila', '&orderBy=%22st%22&equalTo=%22pendente%22').catch(async () => {
        const t = (await fbGet('painel/area/gpFila')) || {}; const o = {}; Object.keys(t).forEach(k => { if (t[k] && t[k].st === 'pendente') o[k] = t[k]; }); return o;
      })) || {};
      const ks = Object.keys(fila).sort();
      if (!ks.length) break;
      if (!logado) { await entrar(page); logado = true; }
      for (const k of ks) {
        const ped = fila[k];
        if (!ped || Date.now() - (ped.em || 0) > 12 * 3600e3) { await fbPatch('painel/area/gpFila/' + k, { st: 'vencido' }); continue; }
        await fbPatch('painel/area/gpFila/' + k, { st: 'rodando', ini: Date.now() });
        console.log('Pedido', ped.tipo === 'fin' ? 'FINALIZAR' : 'ALOCAR', ped.ensaio ? '(ensaio)' : '', '| frentes:', (ped.itens || []).length);
        await rodarPedido(page, k, ped); feitos++;
      }
    }
    console.log('OK:', feitos, 'pedido(s) atendido(s).');
  } catch (e) {
    console.error('FALHOU:', mascarar(e.message || e).slice(0, 300).replace(/"botoes".*/, '(detalhes no painel)'));
    // marca os pedidos pendentes/rodando como erro, para o painel mostrar
    try {
      if (FB) { const t = (await fbGet('painel/area/gpFila')) || {}; for (const k of Object.keys(t)) { const p = t[k]; if (p && (p.st === 'pendente' || p.st === 'rodando')) { await fbPatch('painel/area/gpFila/' + k, { st: 'erro', erro: mascarar(e.message).slice(0, 900) }); for (const fr of p.itens || []) await fbPatch('painel/area/gpRes/' + p.esc + '/' + fr.fid + (p.tipo === 'fin' ? '/fin' : ''), { st: 'erro', msg: mascarar(e.message).slice(0, 900), fim: Date.now() }); } } }
    } catch (x) {}
    process.exitCode = 1;
  } finally { if (browser) await browser.close(); }
})();
