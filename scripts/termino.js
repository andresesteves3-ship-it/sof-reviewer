// Robô "Término previsto" — roda no GitHub Actions 30 min depois do fim de cada período (07, 13, 19 e 01 h de Brasília).
// Abre o Painel Operacional do Rômulo (página pública) pelo navegador e SÓ LÊ o "no ritmo real <dia>" de cada navio em operação.
// Grava dados/termino.json ({atualizado, navios:{NOME:{dia:'aaaa-mm-dd', txt:'9 nov', sit:'dentro do prazo'}}}) e dados/termino-status.json.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL_PAINEL = process.env.TERMINO_URL || 'https://central-de-projetos.romulooc86.workers.dev/projetos/painel-operacao-navios-monitor';
const DIR = path.join(__dirname, '..', 'dados');
const ARQ = path.join(DIR, 'termino.json');
const ARQ_ST = path.join(DIR, 'termino-status.json');
const MES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const p2 = n => String(n).padStart(2, '0');
const lerJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };

// "9 nov" -> aaaa-mm-dd, no ano mais próximo de hoje
function paraData(txt, agora) {
  const m = /(\d{1,2})\s*(?:de\s+)?([a-zç]{3})/i.exec(txt || ''); if (!m) return '';
  const mo = MES[m[2].toLowerCase().slice(0, 3)]; if (!mo) return '';
  const d = +m[1], y0 = new Date(agora).getUTCFullYear();
  let best = null;
  [y0 - 1, y0, y0 + 1].forEach(y => { const t = Date.UTC(y, mo - 1, d); if (!best || Math.abs(t - agora) < Math.abs(best.t - agora)) best = { y, t }; });
  return best.y + '-' + p2(mo) + '-' + p2(d);
}

// lê os cartões da página (função pura sobre o texto, para poder testar sem o site)
function lerCartoes(lista, agora) {
  const out = {};
  lista.forEach(t => {
    const L = String(t || '').split('\n').map(x => x.trim()).filter(Boolean); if (!L.length) return;
    const nome = L[0].toUpperCase();
    const i = L.findIndex(x => /no ritmo real/i.test(x)); if (i < 0) return;
    const txt = L[i].replace(/^.*no ritmo real\s*/i, '').trim();
    const dia = paraData(txt, agora); if (!dia) return;
    const sit = (L[i + 1] && /prazo|atras|adiant/i.test(L[i + 1])) ? L[i + 1] : '';
    out[nome] = { dia, txt, sit };
  });
  return out;
}

async function main() {
  const agora = Date.now(), ant = lerJson(ARQ_ST, {});
  let st = { ok: false, erro: '', atualizado: new Date(agora).toISOString(), ultimoSucesso: ant.ultimoSucesso };
  let browser;
  try {
    browser = await chromium.launch();
    const page = await (await browser.newContext({ locale: 'pt-BR', viewport: { width: 1500, height: 1000 } })).newPage();
    page.setDefaultTimeout(45000);
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto(URL_PAINEL, { waitUntil: 'domcontentloaded' });
    // espera os cartões dos navios (ou o aviso de que não há navio em operação)
    await page.waitForFunction(() => document.querySelectorAll('.m-card').length > 0 || /nenhum navio/i.test(document.body.innerText), null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const lista = await page.$$eval('.m-card', els => els.map(e => e.innerText));
    const navios = lerCartoes(lista, agora);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(ARQ, JSON.stringify({ atualizado: st.atualizado, navios }, null, 1) + '\n');
    st = { ok: true, erro: '', atualizado: st.atualizado, ultimoSucesso: st.atualizado, diag: { cartoes: lista.length, comPrevisao: Object.keys(navios).length } };
    console.log('OK:', Object.keys(navios).length, 'navio(s) com término no ritmo real;', lista.length, 'cartão(ões) lidos.');
  } catch (e) {
    st.erro = String(e.message || e).slice(0, 300);
    st.site = /Timeout|net::ERR|waitForFunction/i.test(st.erro);
    console.error('FALHOU:', st.erro);
  } finally { if (browser) await browser.close(); }
  st.falhasSeguidas = st.ok ? 0 : (ant.falhasSeguidas || 0) + 1;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ARQ_ST, JSON.stringify(st, null, 1) + '\n');
}

module.exports = { lerCartoes, paraData };
if (require.main === module) main();
