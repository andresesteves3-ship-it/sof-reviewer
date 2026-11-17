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
// v0.135.3: o CONTRATO do login é uma lista ("SELECIONE" › TPS), não um campo de digitar
async function escolherContratoLogin(page) {
  const re = new RegExp('^\\s*' + CONTRATO + '\\s*$', 'i');
  const nat = page.locator('select').filter({ has: page.locator('option', { hasText: re }) }).first();
  if (await nat.count()) { await nat.selectOption({ label: CONTRATO }).catch(() => {}); return 'lista nativa'; }
  let alvo = page.getByText(/^\s*SELECIONE\s*$/i).first();
  if (!(await visivel(alvo))) alvo = page.locator('.q-select, [role=combobox], [role=listbox], .v-select, .dropdown').first();
  if (!(await visivel(alvo))) return 'lista não achada';
  for (let t = 0; t < 3; t++) {
    await alvo.click().catch(() => {}); await page.waitForTimeout(900);
    const ops = page.locator('.q-menu .q-item, [role=option], li, .q-item, div, span').filter({ hasText: re });
    for (let i = 0; i < Math.min(await ops.count(), 30); i++) { const o = ops.nth(i); if (!(await visivel(o))) continue; const tx = ((await o.innerText().catch(() => '')) || '').trim(); if (re.test(tx)) { await o.click(); await page.waitForTimeout(700); return 'escolhido'; } }
  }
  return 'TPS não apareceu na lista';
}
async function entrar(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const temSenha = async () => (await page.locator('input[type=password]').count().catch(() => 0)) > 0;
  if (!(await temSenha())) return;
  // v0.135.2: usa o 1º campo de texto VISÍVEL (a tela do celular tem campos escondidos) e digita como uma pessoa
  const ins = page.locator('input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=search])');
  let u = null; for (let i = 0; i < await ins.count(); i++) if (await visivel(ins.nth(i))) { u = ins.nth(i); break; }
  const pw = page.locator('input[type=password]').first();
  if (u) { await u.click(); await u.fill(''); await u.pressSequentially(USER, { delay: 40 }); }
  await pw.click(); await pw.fill(''); await pw.pressSequentially(PASS, { delay: 40 });
  const ct = await escolherContratoLogin(page);
  const b = page.locator('button[type=submit], button:has-text("ENTRAR"), button:has-text("Entrar"), button:has-text("ACESSAR")').first();
  if (await b.count()) await b.click(); else await page.keyboard.press('Enter');
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); if (!(await temSenha())) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2000); await irMobile(page); return; } }
  const d = await page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      inputs: [].slice.call(document.querySelectorAll('input, select, textarea')).map(e => [e.tagName.toLowerCase(), e.type || '', e.name || '', e.id || '', e.placeholder || '', e.getAttribute('aria-label') || '', vis(e) ? 'vis' : 'oculto', 'tam=' + String(e.value || '').length].join(':')).slice(0, 12),
      rotulos: [].slice.call(document.querySelectorAll('label, .q-field__label, .text-caption, .text-subtitle1, .text-h6, p, span')).filter(vis).map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(t => t && t.length < 40).filter((t, i, a) => a.indexOf(t) === i).slice(0, 20),
      erros: [].slice.call(document.querySelectorAll('.q-notification, [role=alert], .text-negative, .q-field__messages, .error, .alert')).map(e => (e.innerText || '').trim().slice(0, 100)).filter(Boolean),
      entrar: [].slice.call(document.querySelectorAll('button')).filter(b => /ENTRAR/i.test(b.innerText)).map(b => (b.disabled ? 'desabilitado' : 'habilitado') + ':' + (b.type || ''))
    };
  }).catch(() => ({}));
  throw new Error('Login no Geport não concluído. Usuário digitado: ' + (u ? 'sim' : 'NÃO (campo não achado)') + '. Contrato: ' + ct + '. Detalhe: ' + mascarar(JSON.stringify(d)));
}
// v0.135.3: depois de entrar, abre a versão do celular (#/mobile/tela-inicial)
const ROTA_MOBILE = process.env.GEPORT_ROTA_MOBILE || '#/mobile/tela-inicial';
async function irMobile(page) {
  await page.goto(BASE.replace(/#.*$/, '').replace(/\/?$/, '/') + ROTA_MOBILE, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2500);
  if ((await page.locator('input[type=password]').count().catch(() => 0)) > 0) throw new Error('O Geport voltou para o login ao abrir a tela do celular. Tela: ' + mascarar(JSON.stringify(await resumoTela(page))));
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
/* v0.135.5: fluxo confirmado com os prints do Geport mobile (#/mobile/alocar-recurso)
   TIPO DA FRENTE (lista: AQUAVIÁRIO, AVULSA, FERROVIÁRIA, RODOVIÁRIO) › CÓDIGO DA FRENTE › BUSCAR FRENTE
   › "ALOCAR RECURSO / AQUAVIARIA: nº" › FUNCIONÁRIO › caixa HORA EXTRA › código › espera 3 s › ADICIONAR › espera 3 s */
const ESPERA_CODIGO = 3000, ESPERA_DEPOIS = 3000;
async function campoEditavel(page, fora) {
  const ins = page.locator('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=password]):not([readonly])');
  const L = [];
  for (let i = 0; i < await ins.count(); i++) { const e = ins.nth(i); if (!(await visivel(e))) continue; if (fora && await e.evaluate((x, f) => { let p = x; for (let k = 0; k < 4 && p; k++) { if (new RegExp(f, 'i').test(p.innerText || '')) return true; p = p.parentElement; } return false; }, fora).catch(() => false)) continue; L.push(e); }
  return L;
}
async function irAlocacao(page) {
  await irMobile(page);   /* volta sempre à tela inicial: cada frente começa do zero */
  if (!(await clicar(page, /ALOCA[CÇ][AÃ]O (DE )?RECURSO/i, 12000))) throw new Error('Não achei o botão "ALOCAÇÃO RECURSO". Tela: ' + JSON.stringify(await resumoTela(page)));
  await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2000);
  if (!(await visivel(page.getByText(/TIPO DA FRENTE/i).first()))) throw new Error('A tela de alocação não abriu (sem "TIPO DA FRENTE"). Tela: ' + JSON.stringify(await resumoTela(page)));
}
async function escolherTipo(page, nav) {
  const re = nav ? /^\s*AQUAVI[AÁ]RI[OA]\s*$/i : /^\s*AVULSA\s*$/i;
  const nat = page.locator('select').first();
  if (await visivel(nat)) { const ops = await nat.locator('option').allTextContents(); const k = ops.findIndex(t => re.test(t)); if (k >= 0) { await nat.selectOption({ index: k }); return true; } }
  /* lista do Quasar: clica no campo abaixo de "TIPO DA FRENTE" e escolhe a opção */
  let alvo = page.locator('.q-select, .q-field').filter({ hasText: /SELECIONE|AQUAVI|AVULSA|FERROVI|RODOVI/i }).first();
  if (!(await visivel(alvo))) alvo = page.getByText(/^\s*SELECIONE\s*$/i).first();
  for (let t = 0; t < 3; t++) {
    await alvo.click().catch(() => {}); await page.waitForTimeout(900);
    const ops = page.locator('.q-menu .q-item, [role=option], .q-item, li, div, span').filter({ hasText: re });
    for (let i = 0; i < Math.min(await ops.count(), 40); i++) { const o = ops.nth(i); if (!(await visivel(o))) continue; if (re.test(((await o.innerText().catch(() => '')) || '').trim())) { await o.click(); await page.waitForTimeout(800); return true; } }
  }
  return false;
}
async function buscarFrente(page, fr) {
  await irAlocacao(page);
  const nav = fr.tipo === 'nav';
  if (!(await escolherTipo(page, nav))) throw new Error('Não consegui escolher ' + (nav ? 'AQUAVIÁRIO' : 'AVULSA') + ' em TIPO DA FRENTE. Tela: ' + JSON.stringify(await resumoTela(page)));
  const ct = await garantirContrato(page);
  let inp = await campo(page, /C[OÓ]DIGO DA FRENTE/i);
  if (!inp) { const L = await campoEditavel(page); inp = L[L.length - 1] || null; }
  if (!inp) throw new Error('Não achei o campo CÓDIGO DA FRENTE. Tela: ' + JSON.stringify(await resumoTela(page)));
  await marcarAvisos(page); await digitar(inp, fr.cod); await page.waitForTimeout(1200);
  if (!(await clicar(page, /BUSCAR FRENTE/i, 8000))) await inp.press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {});
  const fim = Date.now() + 15000;
  while (Date.now() < fim) { if (await visivel(page.getByText(/ALOCAR RECURSO/i).first()) || await visivel(page.getByText(/^\s*FUNCION[AÁ]RIO\s*$/i).first())) break; await page.waitForTimeout(500); }
  const av = await avisosNovos(page, 300);
  if (!(await visivel(page.getByText(/^\s*FUNCION[AÁ]RIO\s*$/i).first()))) throw new Error('O Geport não abriu a frente ' + fr.cod + (av.length ? ': ' + av.join(' / ') : '') + '. Tela: ' + JSON.stringify(await resumoTela(page)));
  return ct;
}
// caixa HORA EXTRA (caixa comum do navegador ou do Quasar); marca se estiver desmarcada
async function horaExtra(page) {
  const r = await page.evaluate(() => {
    const vis = e => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0; };
    const cxs = [].slice.call(document.querySelectorAll('input[type=checkbox], [role=checkbox], .q-checkbox'));
    for (const c of cxs) {
      /* texto logo ao lado da caixa; se não houver, sobe até achar um bloco que fale só de HORA EXTRA */
      let txt = ((c.nextSibling && c.nextSibling.textContent) || '') + ' ' + ((c.closest('label') && c.closest('label').innerText) || '');
      if (!/HORA EXTRA/i.test(txt)) { let p = c.parentElement; for (let k = 0; k < 3 && p; k++) { const t = p.innerText || ''; if (/HORA EXTRA/i.test(t) && !/RESPONS/i.test(t)) { txt = t; break; } p = p.parentElement; } }
      if (!/HORA EXTRA/i.test(txt) || /RESPONS/i.test(txt)) continue;
      const marcado = () => c.matches('input') ? c.checked : c.getAttribute('aria-checked') === 'true';
      if (!marcado()) { (c.matches('input') && !vis(c) && c.closest('label')) ? c.closest('label').click() : c.click(); }
      return marcado() ? 'marcada' : 'nao-confirmada';
    }
    return 'sem-campo';
  }).catch(() => 'erro');
  if (r === 'nao-confirmada') { const l = page.getByText(/^\s*HORA EXTRA\s*$/i).first(); if (await visivel(l)) { await l.click(); await page.waitForTimeout(300); } }
  return r;
}
async function abaFuncionario(page) {
  if (!(await clicar(page, /^\s*FUNCION[AÁ]RIO\s*$/i, 12000))) throw new Error('Não achei a aba FUNCIONÁRIO. Tela: ' + JSON.stringify(await resumoTela(page)));
  await page.waitForTimeout(1500);
  return horaExtra(page);
}
async function campoFuncionario(page) {
  let inp = await campo(page, [/funcion[aá]rio|colaborador|matr[ií]cula/i], /frente|atraca/i);
  if (!inp) { const L = await campoEditavel(page, 'C[OÓ]DIGO DA FRENTE'); inp = L[L.length - 1] || null; }
  return inp;
}
async function adicionarPessoa(page, p, ensaio) {
  const inp = await campoFuncionario(page);
  if (!inp) throw new Error('Não achei o campo do código do funcionário. Tela: ' + JSON.stringify(await resumoTela(page)));
  await digitar(inp, p.cod); await page.waitForTimeout(ESPERA_CODIGO);
  const he = await horaExtra(page);
  if (ensaio) { await inp.fill('').catch(() => {}); return { ok: true, msg: 'ensaio: código digitado, hora extra ' + he + ', ADICIONAR não clicado' }; }
  await fecharAvisos(page); await marcarAvisos(page);
  if (!(await clicar(page, /^\s*ADICIONAR\s*$/i, 8000))) throw new Error('Não achei o botão ADICIONAR. Tela: ' + JSON.stringify(await resumoTela(page)));
  await page.waitForTimeout(800);
  /* se o Geport perguntar algo (localização/câmera), confirma */
  const ok = page.locator('.q-dialog button, .q-dialog .q-btn').filter({ hasText: /^(PERMITIR|OK|SIM|CONFIRMAR)$/i }).last();
  if (await visivel(ok)) { await ok.click().catch(() => {}); await page.waitForTimeout(800); }
  const av = await avisosNovos(page, ESPERA_DEPOIS);
  const ruim = av.find(a => /erro|n[aã]o|inv[aá]lid|j[aá] (est[aá]|aloc)|falh|permiss/i.test(a) && !/sucesso/i.test(a));
  if (ruim) return { ok: false, msg: ruim.slice(0, 140) };
  return { ok: true, msg: (av.find(a => /sucesso|adicionad|alocad/i.test(a)) || 'adicionado').slice(0, 140) };
}
// abre "Visualizar listagem", espera os botões e devolve as linhas {nome, sit, i}
/* v0.135.6: listagem "LISTAGEM DE ALOCAÇÃO PELA FRENTE" (NOME, PROGRAMAÇÃO, REAL, SITUAÇÃO ALOCADO e os botões
   relógio, pessoa, FINALIZAR, CANCELAR, FALTA, FOLGA). A janela fica aberta: finaliza uma pessoa, espera 3 s e segue. */
const ESPERA_FIN = 3000;
async function lerLinhas(page) {
  return page.evaluate(() => {
    const tabs = [].slice.call(document.querySelectorAll('table')).filter(t => /SITUA[CÇ][AÃ]O|NOME/i.test((t.querySelector('thead') || t).innerText || ''));
    const t = tabs[tabs.length - 1]; if (!t) return [];
    return [].slice.call(t.querySelectorAll('tbody tr')).map((tr, i) => {
      tr.setAttribute('data-robo-i', String(i));
      const td = [].slice.call(tr.children).map(x => (x.innerText || '').replace(/\s+/g, ' ').trim());
      return { i, nome: td[0] || '', sit: td.find(x => /CONFIRMAD|FINALIZAD|CANCELAD|PENDENT|FALTA|FOLGA/i.test(x)) || '', fin: [].slice.call(tr.querySelectorAll('button, .q-btn')).some(b => /^\s*FINALIZAR\s*$/i.test(b.innerText || '')) };
    }).filter(r => r.nome && !/^NOME$/i.test(r.nome));
  }).catch(() => []);
}
async function abrirListagem(page) {
  if (!(await visivel(page.getByText(/VISUALIZAR LISTAGEM/i).first()))) { await clicar(page, /^\s*FUNCION[AÁ]RIO\s*$/i, 6000); await page.waitForTimeout(1200); }
  if (!(await clicar(page, /VISUALIZAR LISTAGEM/i, 10000))) throw new Error('Não achei "VISUALIZAR LISTAGEM ALOCAÇÃO RECURSO". Tela: ' + JSON.stringify(await resumoTela(page)));
  await page.waitForTimeout(ESPERA_LISTA);
  let L = await lerLinhas(page);
  for (let t = 0; t < 4 && !L.length; t++) { await page.waitForTimeout(1500); L = await lerLinhas(page); }
  return L;
}
// acha a linha pelo nome completo; o atalho (1º + último nome) só vale se houver UMA linha assim
function achaLinha(linhas, nome) {
  const n = norm(nome), ps = n.split(' ');
  const exata = linhas.filter(l => norm(l.nome) === n);
  if (exata.length) return exata.find(l => l.fin) || exata[0];
  const parc = linhas.filter(l => { const q = norm(l.nome).split(' '); return q[0] === ps[0] && q[q.length - 1] === ps[ps.length - 1]; });
  return parc.length === 1 ? parc[0] : null;
}
async function fecharListagem(page) {
  const b = page.locator('.q-dialog button, .q-dialog .q-btn').filter({ hasText: /^\s*(close|fechar|voltar)\s*$/i }).first();
  if (await visivel(b)) await b.click().catch(() => {}); else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
}
async function finalizarPessoa(page, p, ensaio) {
  const l = achaLinha(await lerLinhas(page), p.nome);
  if (!l) return { ok: false, msg: 'não está na listagem desta frente' };
  if (/FINALIZAD/i.test(l.sit)) return { ok: true, msg: 'já estava finalizado' };
  if (!l.fin) return { ok: false, msg: 'sem botão FINALIZAR (situação: ' + (l.sit || '?') + ')' };
  if (ensaio) return { ok: true, msg: 'ensaio: FINALIZAR achado, não clicado' };
  const b = page.locator('tr[data-robo-i="' + l.i + '"]').locator('button, .q-btn').filter({ hasText: /^\s*FINALIZAR\s*$/i }).first();
  const JAN = '.q-dialog, .swal2-popup, [role=dialog], [role=alertdialog], .modal.show, .v-dialog';
  const dlgAntes = await page.locator(JAN).count().catch(() => 0);
  /* v0.135.8: anota as chamadas que a página faz ao servidor depois do clique (só método, caminho e status) */
  const rede = [], ouve = r => { try { const q = r.request(); if (q.method() !== 'GET' || /finaliz|aloca|recurso/i.test(q.url())) rede.push(q.method() + ' ' + new URL(q.url()).pathname.split('/').slice(-2).join('/') + ' ' + r.status()); } catch (e) {} };
  page.on('response', ouve);
  await fecharAvisos(page); await marcarAvisos(page); await b.click();
  await page.waitForTimeout(1000);
  /* só confirma numa janela NOVA (nunca clica em FINALIZAR de outra linha). v0.135.7: guarda o que a janela mostrou */
  let janela = '';
  if ((await page.locator(JAN).count().catch(() => 0)) > dlgAntes) {
    const dl = page.locator(JAN).last();
    janela = ((await dl.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const conf = dl.locator('button, .q-btn').filter({ hasText: /^\s*(SIM|CONFIRMAR|OK|SALVAR|FINALIZAR)\b/i }).last();
    if (await visivel(conf)) { const rot = ((await conf.innerText().catch(() => '')) || '').trim(); await conf.click(); await page.waitForTimeout(1500); janela += ' [cliquei: ' + rot + ']'; }
    else janela += ' [sem botão de confirmar]';
  }
  /* v0.135.9: no Geport a pessoa SOME da lista uns 5 s depois do FINALIZAR. Espera sumir (até 15 s);
     lista vazia no meio da atualização não conta como "sumiu". */
  let sumiu = false;
  for (let t = 0; t < 30 && !sumiu; t++) {
    await page.waitForTimeout(500);
    const L = await lerLinhas(page);
    if (!L.length) continue;
    const d = achaLinha(L, p.nome);
    if (!d || /FINALIZAD/i.test(d.sit)) sumiu = true;
  }
  const av = await avisosNovos(page, 500);
  page.off('response', ouve);
  if (!sumiu) return { ok: false, msg: ('cliquei em FINALIZAR, mas a pessoa continuou na lista depois de 15 s' + (janela ? ' · ' + janela : '') + (rede.length ? ' · servidor: ' + rede.slice(0, 4).join(', ') : '')).slice(0, 400) };
  await page.waitForTimeout(ESPERA_FIN);   /* intervalo antes da próxima pessoa */ if (rede.length) janela += ' · servidor: ' + rede.slice(0, 4).join(', ');
  const ruim = av.find(a => /erro|n[aã]o|falh/i.test(a) && !/sucesso/i.test(a));
  if (ruim) return { ok: false, msg: (ruim + (janela ? ' · ' + janela : '')).slice(0, 400) };
  return { ok: true, msg: ((av[0] || 'FINALIZAR clicado') + (janela ? ' · janela: ' + janela : '')).slice(0, 400), janela: !!janela };
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
          try { res.pessoas[p.m] = await finalizarPessoa(page, p, ens); } catch (e) { res.pessoas[p.m] = { ok: false, msg: mascarar(e.message).slice(0, 300) }; }
        }
        /* v0.135.7: confere de verdade — fecha, abre a listagem de novo e vê se a pessoa ainda está CONFIRMADO */
        if (!ens) {
          await fecharListagem(page); await page.waitForTimeout(1500);
          const L2 = await abrirListagem(page).catch(() => []); res.passos.push('conferencia:' + L2.length);
          (fr.pessoas || []).forEach(p => { const r = res.pessoas[p.m]; if (!r || !r.ok || /já estava/.test(r.msg)) return; const d = achaLinha(L2, p.nome);
            if (!L2.length) { r.ok = false; r.msg = 'não consegui reabrir a listagem para conferir. ' + r.msg; }
            else if (d && !/FINALIZAD/i.test(d.sit)) { r.ok = false; r.msg = 'continua ' + (d.sit || 'na listagem') + ' depois do FINALIZAR. ' + r.msg; } });
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
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1366, height: 900 } }, { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', geolocation: GEO, permissions: ['geolocation', 'camera'] }));
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
