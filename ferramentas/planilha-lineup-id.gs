/**
 * Painel dos Assistentes — ID fixo das linhas da aba LINEUP (planilha "Produção")
 * O painel usa a coluna "ID" para ligar a frente das Rotinas à linha da planilha.
 * Regras:
 *  - Linha com NAVIO preenchido e ID vazio recebe o próximo número (maior ID + 1).
 *  - ID repetido (ex.: linha copiada e colada) recebe um número novo na linha de baixo.
 *  - O script nunca muda um ID que já existe e não está repetido.
 * Instalação: Extensões › Apps Script › colar este código › Salvar. Recarregue a planilha.
 */
var ABA = 'LINEUP';
var COL_NAVIO = 1; // coluna A

function colunaId_(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (var i = 0; i < h.length; i++) if (String(h[i]).trim().toUpperCase() === 'ID') return i + 1;
  return 0;
}

function preencherIds() {
  var sh = SpreadsheetApp.getActive().getSheetByName(ABA);
  if (!sh) return;
  var c = colunaId_(sh);
  if (!c) return;
  var n = sh.getLastRow();
  if (n < 2) return;
  var nav = sh.getRange(2, COL_NAVIO, n - 1, 1).getValues();
  var rg = sh.getRange(2, c, n - 1, 1);
  var ids = rg.getValues();
  var max = 0, vistos = {}, mudou = false;
  ids.forEach(function (r) { var v = parseInt(r[0], 10); if (!isNaN(v) && v > max) max = v; });
  for (var i = 0; i < ids.length; i++) {
    if (String(nav[i][0]).trim() === '') continue;
    var v = String(ids[i][0]).trim();
    if (v === '' || vistos[v]) { max++; ids[i][0] = max; v = String(max); mudou = true; }
    vistos[v] = true;
  }
  if (mudou) rg.setValues(ids);
}

/* roda sozinho quando alguém edita a aba LINEUP */
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() !== ABA) return;
    preencherIds();
  } catch (x) {}
}

/* menu "Painel" na planilha, para rodar à mão */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Painel')
    .addItem('Preencher IDs do Line Up', 'preencherIds')
    .addToUi();
}
