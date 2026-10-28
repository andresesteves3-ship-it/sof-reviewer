// Robô da Praticagem — roda no GitHub Actions a cada hora.
// Lê https://www.praticagem-rj.com.br/ (SÓ a seção BAÍA DE GUANABARA), atualiza dados/praticagem.json com o histórico
// (apareceu / cancelada / voltou / alterada / concluída) por navio e GUARDA cada manobra (E = entrada, S = saída)
// com o horário do prático (POB), porque o site apaga a linha depois que a manobra passa.
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const URL_PRAT = 'https://www.praticagem-rj.com.br/';
const ARQ = path.join(__dirname, '..', 'dados', 'praticagem.json');
const ARQ_ST = path.join(__dirname, '..', 'dados', 'praticagem-status.json');
const TESTE = process.env.PRAT_HTML_FILE || '';      // só para testes locais
const AGORA = process.env.PRAT_AGORA ? +process.env.PRAT_AGORA : Date.now();

const norm = n => String(n || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, ' ').trim();

// POB vem em horário de Brasília (UTC-3, sem horário de verão)
function pobTs(s, ref) {
  const m = /^(\d\d)\/(\d\d)\s+(\d\d):(\d\d)/.exec(s || ''); if (!m) return 0;
  const y0 = new Date(ref - 3 * 36e5).getUTCFullYear();
  const mk = y => Date.UTC(y, +m[2] - 1, +m[1], +m[3] + 3, +m[4]);
  let t = mk(y0);
  if (t - ref > 183 * 864e5) t = mk(y0 - 1); else if (ref - t > 183 * 864e5) t = mk(y0 + 1);
  return t;
}

const SECAO = /^(BA[IÍ]A DE|PORTO D[OAE])\s+[A-ZÀ-Ú]+/i;
function parse(html, secoesOut) {
  const $ = cheerio.load(html), out = [], vistos = new Set();
  let secao = '', achouGuanabara = false;
  const txt = el => $(el).text().replace(/\s+/g, ' ').trim();
  $('tr').each((_, tr) => {
    const c = $(tr).children('td,th').toArray();
    const t = txt(tr);
    if (c.length < 9) {                                        // linha de título de seção?
      const m = SECAO.exec(t);
      if (m) { secao = norm(m[0]); if (secoesOut && !secoesOut.includes(secao)) secoesOut.push(secao); if (/GUANABARA/.test(secao)) achouGuanabara = true; }
      return;
    }
    const pob = txt(c[0]);
    if (!/^\d\d\/\d\d \d\d:\d\d$/.test(pob)) return;
    const cel = $(c[1]).clone(); cel.find('table').remove();
    const navio = cel.text().replace(/\s+/g, ' ').trim();
    const m = txt(c[7]);
    const k = secao + '|' + pob + '|' + navio + '|' + m;
    if (!navio || vistos.has(k)) return; vistos.add(k);
    out.push({ pob, navio, m, de: c[8] ? txt(c[8]) : '', para: c[11] ? txt(c[11]) : '', secao });
  });
  // se a página não tem títulos de seção reconhecíveis, usa tudo (e avisa); se tem, só Guanabara
  const temSecoes = out.some(x => x.secao);
  if (temSecoes && !achouGuanabara) throw new Error('A seção BAÍA DE GUANABARA não foi encontrada (seções vistas: ' + (secoesOut || []).join(', ') + ').');
  return temSecoes ? out.filter(x => /GUANABARA/.test(x.secao)) : out;
}

async function baixar() {
  if (TESTE) return fs.readFileSync(TESTE, 'utf8');
  const r = await fetch(URL_PRAT, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PainelAssistentes/1.0)', 'Accept': 'text/html' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function salvar(d) {
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  fs.writeFileSync(ARQ, JSON.stringify(d, null, 1) + '\n');
}

(async () => {
  let ant = { hist: {} };
  try { ant = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (e) {}
  const primeira = !ant.ultimoSucesso;
  const d = { ...ant, hist: ant.hist || {}, atualizado: new Date(AGORA).toISOString() };
  try {
    const secoes = [];
    const man = parse(await baixar(), secoes);
    d.secoes = secoes;
    if (!man.length) throw new Error('A página não trouxe nenhuma manobra (leitura ignorada para não gerar cancelamentos falsos).');
    const map = {};
    man.forEach(r => { (map[norm(r.navio)] = map[norm(r.navio)] || []).push(r); });
    const hist = d.hist;
    Object.keys(map).forEach(k => {
      const h = hist[k] || (hist[k] = { est: 'nunca', ev: [], man: [] });
      const l = map[k].sort((a, b) => pobTs(a.pob, AGORA) - pobTs(b.pob, AGORA));
      const sig = JSON.stringify(l.map(x => [x.pob, x.m])), antSig = JSON.stringify((h.man || []).map(x => [x.pob, x.m]));
      if (h.est !== 'marcada') h.ev.push({ t: AGORA, e: primeira ? 'inicial' : (h.est === 'cancelada' ? 'voltou' : 'apareceu') });
      else if (sig !== antSig) h.ev.push({ t: AGORA, e: 'alterada' });
      h.est = 'marcada'; h.man = l; h.nome = l[0].navio;
    });
    // ---- registro permanente das manobras (E = entrada, S = saída): fica salvo mesmo depois que o site apaga a linha ----
    const presente = new Set();
    Object.keys(map).forEach(k => {
      const h = hist[k]; h.mov = h.mov || [];
      map[k].forEach(x => {
        const ts = pobTs(x.pob, AGORA), id = x.m + '|' + ts;
        presente.add(k + '|' + id);
        let mv = h.mov.find(y => y.m === x.m && y.ts === ts);
        if (!mv) { mv = { m: x.m, pob: x.pob, ts, vis: AGORA }; h.mov.push(mv); }
        mv.de = x.de; mv.para = x.para; mv.ult = AGORA; mv.st = 'prevista';
      });
    });
    Object.keys(hist).forEach(k => {
      const h = hist[k]; if (!h.mov) return;
      h.mov.forEach(mv => {
        if (presente.has(k + '|' + mv.m + '|' + mv.ts) || mv.st === 'realizada' || mv.st === 'cancelada' || mv.st === 'remarcada') return;
        if (mv.ts <= AGORA + 36e5) mv.st = 'realizada';                           // sumiu depois do horário: manobra feita
        else mv.st = h.mov.some(y => y !== mv && y.m === mv.m && y.st === 'prevista') ? 'remarcada' : 'cancelada';
      });
      h.mov.sort((a, b) => a.ts - b.ts);
      if (h.mov.length > 40) h.mov = h.mov.slice(-40);
    });
    Object.keys(hist).forEach(k => {
      const h = hist[k];
      if (!map[k] && h.est === 'marcada') {
        const ult = Math.max(...(h.man || []).map(x => pobTs(x.pob, AGORA)), 0);
        if (ult > AGORA) { h.est = 'cancelada'; h.ev.push({ t: AGORA, e: 'cancelada' }); }
        else { h.est = 'concluida'; h.ev.push({ t: AGORA, e: 'concluida' }); }
      }
      if (h.ev.length > 20) h.ev = h.ev.slice(-20);
      // limpeza: encerrados há mais de 15 dias saem do arquivo
      const ult = h.ev.length ? h.ev[h.ev.length - 1].t : 0;
      const ultMov = Math.max(ult, ...((h.mov || []).map(x => x.ult || x.vis || 0)));
      if (h.est !== 'marcada' && AGORA - ultMov > 30 * 864e5) delete hist[k];
    });
    d.ok = true; d.erro = ''; d.ultimoSucesso = d.atualizado; d.total = man.length;
    console.log('OK:', man.length, 'manobras;', Object.keys(hist).length, 'navios no histórico');
  } catch (e) {
    d.ok = false; d.erro = String(e.message || e).slice(0, 200);
    console.error('FALHOU:', d.erro);
  }
  // só grava se mudou algo além do carimbo de hora (evita commit à toa); heartbeat diário
  const semCarimbo = o => JSON.stringify({ ...o, atualizado: 0, ultimoSucesso: 0 });
  const mudou = semCarimbo(d) !== semCarimbo(ant);
  const dia = s => (s || '').slice(0, 10);
  if (mudou || dia(d.atualizado) !== dia(ant.atualizado)) salvar(d);
  else console.log('Sem mudanças; arquivo mantido.');
  // sinal de vida: arquivo pequeno gravado em TODA rodada (o painel usa para saber que o robô está rodando)
  let stAnt = {}; try { stAnt = JSON.parse(fs.readFileSync(ARQ_ST, 'utf8')); } catch (e) {}
  fs.writeFileSync(ARQ_ST, JSON.stringify({ ok: d.ok !== false, erro: d.erro || '', atualizado: d.atualizado,
    ultimoSucesso: d.ok !== false ? d.atualizado : (stAnt.ultimoSucesso || ant.ultimoSucesso || ''), total: d.total || 0, gravouDados: !!(mudou || dia(d.atualizado) !== dia(ant.atualizado)) }, null, 1) + '\n');
})();
