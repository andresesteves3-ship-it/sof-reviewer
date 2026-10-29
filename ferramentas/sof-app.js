/* SOF Reviewer — integrado ao Painel dos Assistentes (código da análise; a tela fica no index.html) */

let lastData=null, workbook=null, rows=[], fileLabel='', colInfo=null, docIsSOF=false, curArea=null, areaNote='', hdrInfo=null, stowPlans=[];
const SOF_RX=/statement\s+of\s+facts?/i;
const $=id=>document.getElementById(id);
const MONTHS={jan:0,feb:1,fev:1,mar:2,apr:3,abr:3,may:4,mai:4,jun:5,jul:6,aug:7,ago:7,sep:8,set:8,oct:9,out:9,nov:10,dec:11,dez:11};
const DAY=86400000;
function status(t,type=''){const s=$('status');s.textContent=t;s.className='status '+type}
function prog(n){$('bar').style.width=n+'%'}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
// Ocorrência compacta: título + selo + botões numa linha, dados em seguida e a ação curta.
// g (opcional) = {k: chave do grupo, t: título do grupo, c: colunas, v: valores} -> ocorrências iguais viram uma tabela.
const SEV={'CRÍTICO':'crit','ALTO':'alto','ATENÇÃO':'aten','REVISAR':'rev'};
function issue(title,fields,action,badge='',g){
  const k=hashStr(title+'\u0001'+fields.map(x=>x[0]+'\u0002'+x[1]).join('\u0001'));
  const listy=fields.length>1&&(fields.every(x=>/^(Linha|Célula)/.test(x[0]))||/^Pendência|^Células vazias/.test(title));
  let s='<div class="issue sev-'+(SEV[badge]||'info')+'" data-k="'+k+'"'+(g?' data-g="'+esc(g.k)+'" data-gt="'+esc(g.t)+'" data-gc="'+esc(JSON.stringify(g.c))+'" data-gv="'+esc(JSON.stringify(g.v.map(v=>String(v??''))))+'"':'')+'>';
  s+='<div class="ih"><span class="issue-title">'+esc(title)+'</span>'+(badge?'<span class="badge">'+esc(badge)+'</span>':'')+'<!--NEW--><span class="ib"><!--BTN--></span></div>';
  if(fields.length)s+='<div class="facts'+(listy?' list':'')+'">'+fields.map(x=>'<span class="f"><em>'+esc(x[0])+'</em> '+esc(x[1])+'</span>').join('')+'</div>';
  if(action)s+='<div class="act">→ '+esc(action)+'</div>';
  return s+'</div>';
}
const keyOf=h=>(h.match(/data-k="([^"]+)"/)||[])[1]||hashStr(h);
const mainSheet=()=>rows[0]&&rows[0].sheet;
const ond=(sheet,l)=>String(l)+(sheet&&sheet!==mainSheet()?' (aba '+sheet+')':'');
// Junta ocorrências do mesmo grupo (2 ou mais) em um cartão com tabela; os botões ficam em cada linha
function tableGroup(items){
  const order=[], groups=new Map();
  items.forEach(h=>{const g=(h.match(/data-g="([^"]+)"/)||[])[1]; if(!g){order.push({h});return} if(!groups.has(g)){groups.set(g,[]);order.push({g})} groups.get(g).push(h)});
  const attr=(h,a)=>unesc((h.match(new RegExp(a+'="([^"]*)"'))||[])[1]||'');
  return order.map(o=>{
    if(o.h)return o.h;
    const list=groups.get(o.g); if(list.length<2)return list[0];
    const first=list[0], cols=JSON.parse(attr(first,'data-gc'));
    const sev=(first.match(/class="issue (sev-\w+)/)||[])[1]||'sev-info';
    const badge=(first.match(/<span class="badge">([^<]*)<\/span>/)||[])[1]||'';
    const act=(first.match(/<div class="act">([\s\S]*?)<\/div>/)||[])[1]||'';
    const trs=list.map(h=>{
      const v=JSON.parse(attr(h,'data-gv')), isNew=/badge new/.test(h), btns=(h.match(/<span class="ib">([\s\S]*?)<\/span><\/div>/)||[])[1]||'';
      return '<tr>'+v.map((c,i)=>'<td>'+esc(c)+(i===0&&isNew?'<span class="badge new">NOVO</span>':'')+'</td>').join('')+'<td class="tb">'+btns+'</td></tr>';
    }).join('');
    return '<div class="issue '+sev+' grouped"><div class="ih"><span class="issue-title">'+esc(attr(first,'data-gt'))+'</span>'+(badge?'<span class="badge">'+badge+'</span>':'')+'<span class="gcount">'+list.length+' ocorrências</span></div>'+
      '<div class="gwrap"><table class="gtable"><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'<th></th></tr></thead><tbody>'+trs+'</tbody></table></div>'+
      (act?'<div class="act">'+act+'</div>':'')+'</div>';
  });
}
function empty(msg){return '<div class="empty">✓ '+esc(msg)+'</div>'}
const pad=n=>String(n).padStart(2,'0');

const tick=()=>new Promise(r=>setTimeout(r,0));
const fmtMs=ms=>ms<1000?Math.round(ms)+' ms':(ms/1000).toFixed(1).replace('.',',')+' s';
let loadMs=0;
$('file').addEventListener('change',async()=>{
  const f=$('file').files[0]; if(!f)return;
  $('fileName').textContent=f.name; fileLabel=f.name;
  $('results').classList.add('hidden'); $('analyzeBtn').disabled=true; prog(5);
  const t0=performance.now();
  try{
    status('Lendo o arquivo selecionado...'); await tick();
    const data=await f.arrayBuffer(); lastData=data; prog(25);
    // 1) lê só os nomes das abas (rápido); 2) lê apenas a aba do SOF quando o nome indica
    const names=XLSX.read(data,{type:'array',bookSheets:true}).SheetNames;
    const likely0=names.filter(n=>/sof|statement|fact/i.test(n));
    const likely=likely0.length?likely0.concat(names.filter(n=>/stowage/i.test(n)&&!likely0.includes(n))):[];
    prog(40); await tick();
    const opts={type:'array',cellFormula:true,cellDates:false};
    workbook=XLSX.read(data,likely.length?Object.assign({},opts,{sheets:likely}):opts); prog(70); await tick();
    rows=extractRows(workbook);
    if((!rows.length||!docIsSOF)&&likely.length&&likely.length<names.length){
      status('Aba do SOF não reconhecida pelo nome; lendo todas as abas...'); await tick();
      workbook=XLSX.read(data,opts); rows=extractRows(workbook);
    }
    prog(100); loadMs=performance.now()-t0;
    if(!docIsSOF){rows=[];prog(0);status('Documento não compatível. O SOF Reviewer analisa apenas Statement of Facts.','error');return}
    if(!rows.length){status('Não encontrei linhas de operação reconhecíveis neste XLSX. ('+fmtMs(loadMs)+')','error');return}
    $('analyzeBtn').disabled=false; $('auditBtn').disabled=false; status('Arquivo carregado com sucesso. Clique em Analisar SOF para iniciar a revisão.','ok');
  }catch(e){status('Erro ao abrir o arquivo: '+e.message,'error');prog(0)}
});

// Intervalo realmente usado: ignora linhas vazias que só têm formatação
function usedRange(ws){
  let maxR=-1,maxC=0;
  for(const k in ws){ if(k[0]==='!')continue; const c=XLSX.utils.decode_cell(k); if(c.r>maxR)maxR=c.r; if(c.c>maxC)maxC=c.c; }
  return maxR<0?null:{s:{r:0,c:0},e:{r:maxR,c:maxC}};
}

function excelTimeFromValue(v){
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='number'&&isFinite(v)&&v>=0&&v<1){const t=Math.round(v*1440)%1440;return pad(Math.floor(t/60))+':'+pad(t%60)}
  if(v instanceof Date&&!isNaN(v))return pad(v.getHours())+':'+pad(v.getMinutes());
  const s=String(v).trim();
  if(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s))return s.slice(0,5);
  let m=s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if(m){let hh=Number(m[1]);const mm=Number(m[2]),ap=m[4].toUpperCase();
    if(hh<1||hh>12||mm>59)return null;
    if(ap==='AM'&&hh===12)hh=0;else if(ap==='PM'&&hh!==12)hh+=12;
    return pad(hh)+':'+pad(mm)}
  return null;
}

function excelDateFromValue(v){
  if(v===null||v===undefined||v==='')return '';
  if(v instanceof Date&&!isNaN(v))return pad(v.getDate())+'/'+pad(v.getMonth()+1)+'/'+v.getFullYear();
  if(typeof v==='number'&&v>20000){
    const d=new Date(Date.UTC(1899,11,30)+Math.round(v*DAY));
    return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1)+'/'+d.getUTCFullYear();
  }
  return String(v).trim();
}

function getRawCellValue(ws,addr,depth=0){
  if(depth>5)return '';
  if(curArea&&depth===0){ // fora da área de impressão = não lido
    const c=XLSX.utils.decode_cell(addr);
    if(c.r<curArea.s.r||c.r>curArea.e.r||c.c<curArea.s.c||c.c>curArea.e.c)return '';
  }
  const cell=ws[addr]; if(!cell)return '';
  if(cell.v!==undefined&&cell.v!==null&&cell.v!=='')return cell.v;
  if(typeof cell.f==='string'){
    const m=cell.f.match(/^=?\$?([A-Z]{1,3})\$?(\d+)$/i);
    if(m)return getRawCellValue(ws,m[1].toUpperCase()+m[2],depth+1);
  }
  if(typeof cell.w==='string')return cell.w;
  return '';
}

// Aceita dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, aaaa-mm-dd, dd-Mon-aa e dd Mon aaaa
function parseDateValue(v){
  if(v===null||v===undefined||v==='')return null;
  if(v instanceof Date&&!isNaN(v))return new Date(v.getFullYear(),v.getMonth(),v.getDate());
  const s=String(v).trim(); let m,d,mo,y;
  if((m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))){d=+m[1];mo=+m[2]-1;y=+m[3]}
  else if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))){y=+m[1];mo=+m[2]-1;d=+m[3]}
  else if((m=s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3})[a-z]*[\s\-\/,]*(\d{2,4})$/))){
    d=+m[1];mo=MONTHS[m[2].toLowerCase()];y=+m[3]; if(mo===undefined)return null}
  else return null;
  if(y<100)y+=2000;
  const dt=new Date(y,mo,d);
  return (dt.getMonth()===mo&&dt.getDate()===d)?dt:null;
}
const fmtDate=d=>pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear();
const diffDays=(a,b)=>Math.round((b-a)/DAY);

// Localiza as colunas de Volumes e Peso pelo cabeçalho da planilha
function detectCols(matrix){
  const volRx=/volumes?|\bvol['’`´.]?s?\b|\bskips?\b|\bpcs\b|pieces|quantidade|\bqty\b/i;
  const wRx=/\bpeso\b|weights?|\bwgt\b|\bkg\b|\bm\.?t\.?\b|tonn?es?\b|\btons?\b/i;
  // Trucks/Carretas: só aceita cabeçalho curto e exato (evita casar com "Awaiting trucks")
  const tRx=/^(n[ºo°.]*\s*(of|de)?\s*)?(trucks?|carretas?)(\s*\(.*\))?\s*:?$/i;
  const norm=v=>String(v??'').trim().toLowerCase().replace(/[:.]/g,'');
  const h=matrix.findIndex(r=>r.some(c=>norm(c)==='from')&&r.some(c=>norm(c)==='to'));
  const from=h>=0?Math.max(0,h-2):0, to=h>=0?h+2:Math.min(matrix.length-1,80);
  const cols={vol:undefined,w:undefined,t:undefined,g:undefined,d:undefined,h:undefined,hdr:h};
  const scan=i=>matrix[i].forEach((c,j)=>{
    const t=String(c??'').trim(); if(!t||t.length>40)return;
    if(cols.t===undefined&&tRx.test(t))cols.t=j;
    else if(cols.vol===undefined&&volRx.test(t))cols.vol=j;
    else if(cols.w===undefined&&wRx.test(t)&&j!==cols.vol)cols.w=j;
  });
  for(let i=from;i<=to&&i<matrix.length;i++)scan(i);
  // Reserva: se algo não foi achado perto do cabeçalho, procura nas primeiras 80 linhas
  for(let i=0;i<Math.min(matrix.length,80)&&(cols.vol===undefined||cols.w===undefined||cols.t===undefined);i++)scan(i);
  if(h>=0){
    cols.labels=matrix[h].map(norm);
    cols.labels.forEach((n,j)=>{
      if(n==='gang'&&cols.g===undefined)cols.g=j;
      if(n==='hold'&&cols.h===undefined)cols.h=j;
      if(/^(stoppages?|remarks|description)$/.test(n)&&cols.d===undefined)cols.d=j;
      if(/^(date|data)$/.test(n)&&cols.dt===undefined)cols.dt=j;
      if(/^(day|dia)$/.test(n)&&cols.dy===undefined)cols.dy=j;
      if(n==='from'&&cols.fr===undefined)cols.fr=j;
      if(n==='to'&&cols.to===undefined)cols.to=j;
    });
    /* modelo diferente do padrão (DATE em B, DAY em C, FROM em D, TO em E): reorganiza a linha para essa ordem */
    const dt=cols.dt!==undefined?cols.dt:1,fr=cols.fr,to=cols.to;
    if(fr!==undefined&&to!==undefined&&!(dt===1&&fr===3&&to===4&&(cols.dy===undefined||cols.dy===2))){
      const W=Math.max(...matrix.map(r=>r.length)),usa=[dt,cols.dy,fr,to].filter(x=>x!==undefined);
      const ord=[usa.indexOf(0)<0?0:-1,dt,cols.dy!==undefined?cols.dy:-1,fr,to];
      for(let j=0;j<W;j++)if(ord.indexOf(j)<0)ord.push(j);
      const ni=o=>o===undefined?undefined:ord.indexOf(o);
      cols.ord=ord;cols.g=ni(cols.g);cols.h=ni(cols.h);cols.d=ni(cols.d);
      cols.labels=ord.map(i=>i<0?'':cols.labels[i]||'');
    }
  }
  return cols;
}
function numAt(ws,col,rowNumber){
  if(col===undefined)return null;
  const v=getRawCellValue(ws,XLSX.utils.encode_col(col)+rowNumber);
  if(typeof v==='number'&&isFinite(v))return v;
  let t=String(v??'').trim().replace(/\s/g,''); if(!t||!/\d/.test(t))return null;
  const c=t.lastIndexOf(','),d=t.lastIndexOf('.');
  if(c>-1&&d>-1)t=c>d?t.replace(/\./g,'').replace(',','.'):t.replace(/,/g,'');
  else if(c>-1)t=/,\d{1,2}$/.test(t)?t.replace(',','.'):t.replace(/,/g,'');
  const n=Number(t.replace(/[^\d.\-]/g,''));
  return isFinite(n)?n:null;
}

// Área de impressão definida no Excel (_xlnm.Print_Area); várias áreas viram um retângulo único
function printArea(wb,sheetName){
  const names=(wb.Workbook&&wb.Workbook.Names)||[], idx=wb.SheetNames.indexOf(sheetName);
  let box=null;
  names.forEach(n=>{
    if(n.Name!=='_xlnm.Print_Area'||!n.Ref)return;
    String(n.Ref).split(',').forEach(p=>{
      const bang=p.lastIndexOf('!'); if(bang<0)return;
      const sh=p.slice(0,bang).replace(/^'|'$/g,'').replace(/''/g,"'");
      if(sh!==sheetName&&n.Sheet!==idx)return;
      let r; try{r=XLSX.utils.decode_range(p.slice(bang+1).replace(/\$/g,''))}catch(e){return}
      if(!r||[r.s.r,r.s.c,r.e.r,r.e.c].some(x=>typeof x!=='number'||isNaN(x)))return;
      box=box?{s:{r:Math.min(box.s.r,r.s.r),c:Math.min(box.s.c,r.s.c)},e:{r:Math.max(box.e.r,r.e.r),c:Math.max(box.e.c,r.e.c)}}:r;
    });
  });
  return box;
}
// O título "Statement of Facts" é procurado nas primeiras 40 linhas, mesmo fora da área de impressão
function titleInSheet(ws){
  for(const k in ws){
    if(k[0]==='!')continue;
    if(parseInt(k.replace(/\D/g,''),10)>40)continue;
    const c=ws[k]; if(c&&SOF_RX.test(String(c.v??c.w??'')))return true;
  }
  return false;
}

// ===== Cabeçalho do SOF (campos acima da tabela) =====
const HDR_FIELDS=[
  {k:'arrival',name:'Arrival',rx:/^\s*(\d+\)\s*)?arriv(al|ed)\b(?!\s+drafts?)/i},
  {k:'pilot',name:'Pilot on board',rx:/pilot\s+on\s+board/i},
  {k:'allfast',name:'Made all fast',rx:/all\s*fast/i},
  {k:'nort',name:'NOR tendered',rx:/\bnor\b.*tender/i},
  {k:'nora',name:'NOR accepted',rx:/\bnor\b.*accept/i},
  {k:'cleared',name:'Vessel cleared by inspections',rx:/cleared\s+by/i},
  {k:'commenced',name:'Commenced Loading/Discharging',rx:/commenc\w*\s+(load|disch)/i},
  {k:'completed',name:'Completed Loading/Discharging',rx:/complet\w*\s+(load|disch)/i},
  {k:'docs',name:'Documents on board/signed',rx:/documents\s+on\s+board/i},
  {k:'booked',name:'Pilot booked for berthing',rx:/pilot\s+booked/i},
  {k:'unberth',name:'Vessel unberthed',rx:/unberth/i}
];
function buildHeader(ws,hdrIdx){
  if(hdrIdx===undefined||hdrIdx<1)return null;
  const fields={}, drafts={}, surveys={}, lastCol=18, nomes=[]; let vessel='';
  for(let r=1;r<=hdrIdx;r++){
    for(let c=0;c<=lastCol;c++){
      const label=String(getRawCellValue(ws,XLSX.utils.encode_col(c)+r)??'').trim();
      if(!label||label.length>70)continue;
      if(/^(vessel|ship|navio|agents?|owners?|port|flag|berth.*|shippers?|receivers?|charterers?|consignee|operators?|stevedores?|cargo.*)(\s*name)?\s*:?$/i.test(label)){for(let cc=c+1;cc<=c+6;cc++){const v=String(getRawCellValue(ws,XLSX.utils.encode_col(cc)+r)??'').trim();if(v){nomes.push(v);break}}}
      if(!vessel&&/^(vessel|ship|navio)(\s*name)?\s*:?$/i.test(label)){for(let cc=c+1;cc<=c+6;cc++){const v=String(getRawCellValue(ws,XLSX.utils.encode_col(cc)+r)??'').trim();if(v){vessel=v;break}}}
      const f=HDR_FIELDS.find(x=>!fields[x.k]&&x.rx.test(label));
      if(f){
        let date=null,time=null,dcol,cand=[];
        for(let cc=c+1;cc<=c+9;cc++){
          const raw=getRawCellValue(ws,XLSX.utils.encode_col(cc)+r);
          if(raw===''||raw===null||raw===undefined)continue;
          const d=parseDateValue(excelDateFromValue(raw)); let t=excelTimeFromValue(raw);
          if(!t&&typeof raw==='number'&&raw>=1&&raw%1>0)t=excelTimeFromValue(raw%1);
          if(d&&!date){date=d;dcol=cc; if(t&&!time)time=t}
          else if(t&&!time&&!d)time=t;
          else if(!d&&!t&&!/^at$/i.test(String(raw).trim()))cand.push({cc,txt:String(raw).trim()});
        }
        fields[f.k]={name:f.name,label,row:r,date,time,text:'',dcol,cand};
        continue;
      }
      const sv=label.match(/^\s*(initial|final)\s+draft\s+survey/i);
      if(sv){
        const S={row:r,from:null,to:null};
        for(let rr=r;rr<=r+1;rr++)for(let cc=c+1;cc<=c+3;cc++){
          const lab=String(getRawCellValue(ws,XLSX.utils.encode_col(cc)+rr)??'').trim().toLowerCase().replace(/[:.]/g,'');
          if(lab!=='from'&&lab!=='to')continue;
          let date=null,time=null;
          for(let k=cc+1;k<=cc+6;k++){
            const raw=getRawCellValue(ws,XLSX.utils.encode_col(k)+rr); if(raw===''||raw===null||raw===undefined)continue;
            const d=parseDateValue(excelDateFromValue(raw)); let t=excelTimeFromValue(raw);
            if(!t&&typeof raw==='number'&&raw>=1&&raw%1>0)t=excelTimeFromValue(raw%1);
            if(d&&!date){date=d; if(t&&!time)time=t} else if(t&&!time&&!d)time=t;
          }
          S[lab]={date,time,row:rr};
        }
        surveys[sv[1].toLowerCase()]=S;
        continue;
      }
      const isDraft=/^\s*[AB]\)\s*(arrival|sailing)\b/i.test(label)||/^\s*(arrival|sailing)\s+drafts?\b/i.test(label);
      if(isDraft){
        const kind=label.match(/arrival|sailing/i)[0].toLowerCase();
        const dr={row:r,fwd:null,aft:null,found:false};
        for(let rr=r;rr<=r+2;rr++)for(let cc=c+1;cc<=c+8;cc++){
          const lab=String(getRawCellValue(ws,XLSX.utils.encode_col(cc)+rr)??'').trim().toLowerCase().replace(/[:.]/g,'');
          if(lab==='fwd'||lab==='aft'){
            dr.found=true;
            for(let k=cc+1;k<=cc+4;k++){const v=getRawCellValue(ws,XLSX.utils.encode_col(k)+rr); if(typeof v==='number'){dr[lab]=v;break}}
          }
        }
        if(dr.found)drafts[kind]=dr;
      }
    }
  }
  // texto livre (ex.: "AS PER CHARTER PARTY") só vale na coluna onde ficam as datas; textos de outros blocos ao lado são ignorados
  const dc=Object.values(fields).filter(f=>f.dcol!==undefined).map(f=>f.dcol);
  const dateCol=dc.sort((x,y)=>dc.filter(v=>v===x).length-dc.filter(v=>v===y).length).pop();
  Object.values(fields).forEach(f=>{
    if(!f.date&&!f.time){const c=f.cand.find(x=>dateCol===undefined||x.cc===dateCol); f.text=c?c.txt:''}
    delete f.cand; delete f.dcol;
  });
  return Object.keys(fields).length?{fields,drafts,surveys,vessel,nomes}:null;
}

function extractRows(wb){
  const stow=[]; stowPlans=[];
  let best=[]; colInfo=null; areaNote=''; curArea=null; hdrInfo=null; docIsSOF=SOF_RX.test((wb.Props&&wb.Props.Title)||'');
  const meta=(wb.Workbook&&wb.Workbook.Sheets)||[], anyVisible=wb.SheetNames.some((n,i)=>!(meta[i]&&meta[i].Hidden));
  wb.SheetNames.forEach((name,si)=>{
    if(anyVisible&&meta[si]&&meta[si].Hidden)return; // abas ocultas não entram na revisão
    if(SOF_RX.test(name))docIsSOF=true;
    const ws=wb.Sheets[name]; if(!ws)return;
    const used=usedRange(ws); if(!used)return;
    const pa=printArea(wb,name);
    const rng=pa?{s:{r:0,c:0},e:{r:Math.min(used.e.r,pa.e.r),c:Math.min(used.e.c,pa.e.c)}}:used;
    curArea=pa;
    if(/stowage/i.test(name)){const p=parseStowage(ws,name); if(p)stow.push(p)}
    let matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,range:rng});
    // mantém a numeração original das linhas/colunas, esvaziando o que está fora da área de impressão
    if(pa)matrix=matrix.map((r,i)=>i<pa.s.r?[]:r.map((v,j)=>j<pa.s.c?'':v));
    if(!docIsSOF&&titleInSheet(ws))docIsSOF=true;
    const cols=detectCols(matrix);
    const footIdx=matrix.findIndex((r,i)=>i>cols.hdr&&r.some(c=>/remarks|signature/i.test(String(c)))); // rodapé: observações e assinaturas
    const candidate=[]; let currentDate='', periodBlock=1;
    matrix.forEach((r,i)=>{
      const rowNumber=i+1, cru=r.map(v=>String(v??'').trim()), vals=cols.ord?cols.ord.map(j=>j<0?'':(cru[j]||'')):cru;
      if(!vals.some(Boolean))return;
      const cD=cols.dt!==undefined?cols.dt:1,cF=cols.fr!==undefined?cols.fr:3,cT=cols.to!==undefined?cols.to:4;
      const dateValue=excelDateFromValue(getRawCellValue(ws,XLSX.utils.encode_col(cD)+rowNumber))||String(r[cD]??'').trim();
      const fromTime=excelTimeFromValue(getRawCellValue(ws,XLSX.utils.encode_col(cF)+rowNumber));
      const toTime=excelTimeFromValue(getRawCellValue(ws,XLSX.utils.encode_col(cT)+rowNumber));
      // A data da coluna B só atualiza a data corrente; o bloco só avança em "Period Total".
      if(dateValue&&parseDateValue(dateValue))currentDate=dateValue;
      const isPeriodTotal=/period\s*total/i.test(vals.join(' | '));
      const isGrandTotal=!isPeriodTotal&&vals.some(v=>/^(grand\s*total|total(\s+(geral|general|cargo|carga|discharged|loaded|embarcado|descarregado))?(\s+(ashore|on\s*board|onboard|to\s+date|at\s+port))?)\s*:?$/i.test(v));
      if(fromTime)vals[3]=fromTime;
      if(toTime)vals[4]=toTime;
      const joined=vals.join(' | ');
      const volV=numAt(ws,cols.vol,rowNumber), wV=numAt(ws,cols.w,rowNumber), tV=numAt(ws,cols.t,rowNumber);
      const base=/\b\d{1,2}:\d{2}\b/.test(joined)||/not worked|commenced|completed|awaiting|discharge|loading|hold no/i.test(joined)||isPeriodTotal||isGrandTotal;
      // Linha só com produção (sem horário/palavra-chave): entra para a soma, desde que abaixo do cabeçalho
      const prodOnly=!base&&cols.hdr>=0&&i>cols.hdr&&[volV,wV,tV].some(x=>x!==null&&x!==0)&&!/total|cumul|accum|acum|saldo|balanc|remain/i.test(joined);
      // linha só com texto na coluna de descrição (ex.: título de seção): entra para a conferência de texto
      const textOnly=!base&&!prodOnly&&cols.d!==undefined&&cols.hdr>=0&&i>cols.hdr&&(footIdx<0||i<footIdx)&&/[A-Za-z]{3}/.test(vals[cols.d]||'');
      if(base||prodOnly||textOnly){
        candidate.push({sheet:name,row:rowNumber,values:vals,operationalDate:currentDate,periodBlock,isPeriodTotal,isGrandTotal,vol:volV,w:wV,t:tV,prodOnly,textOnly,gang:cols.g!==undefined?(vals[cols.g]||''):undefined,hold:cols.h!==undefined?(vals[cols.h]||''):undefined});
      }
      if(isPeriodTotal)periodBlock++;
    });
    if(candidate.length>best.length){best=candidate;colInfo=cols;areaNote=pa?XLSX.utils.encode_range(pa):'';hdrInfo=buildHeader(ws,cols.hdr)}
  });
  curArea=null; stowPlans=stow;
  return best;
}

function parseTime(s){
  if(s===null||s===undefined||s==='')return null;
  const m=String(s).trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m?Number(m[1])*60+Number(m[2]):null;
}
function timePairs(r){
  const found=[], a=parseTime(r.values[3]), b=parseTime(r.values[4]);
  if(a!==null)found.push({i:3,time:r.values[3],min:a});
  if(b!==null)found.push({i:4,time:r.values[4],min:b});
  return found;
}
// Virada de meia-noite é válida para períodos iniciados em 19:00+ ou antes de 07:00.
function operationalEndMinutes(start,end){
  if(start===null||end===null)return null;
  if(end>=start)return end;
  if(start>=19*60||start<7*60)return end+1440;
  return end;
}
function periodLabel(start,end){
  if(start===null||end===null)return 'sem horário completo';
  let e=end; if(e<start)e+=1440;
  if(start>=420&&start<780&&e<=780)return '07x13';
  if(start>=780&&start<1140&&e<=1140)return '13x19';
  if(start>=1140&&e<=1500)return '19x01';
  if(start<420&&e<=420)return '01x07';
  return 'fora do padrão / requer conferência';
}
const rowText=r=>r.values.join(' | ');
const findCellText=(r,rx)=>r.values.find(v=>rx.test(String(v)))||'';

// Cronologia das datas (coluna B)
function checkDates(errors,alerts){
  const seq=[]; let last='';
  rows.forEach(r=>{
    if(!r.operationalDate||r.operationalDate===last)return;
    last=r.operationalDate;
    const d=parseDateValue(r.operationalDate);
    if(d)seq.push({d,text:r.operationalDate,row:r.row,sheet:r.sheet});
  });
  if(seq.length<2)return;
  const sorted=seq.map(x=>x.d.getTime()).sort((a,b)=>a-b);
  const median=new Date(sorted[Math.floor(sorted.length/2)]);
  const today=new Date(); today.setHours(0,0,0,0);

  // 1. Datas muito distantes da maioria (passado ou futuro)
  const ok=[];
  seq.forEach(x=>{
    const off=diffDays(median,x.d);
    if(Math.abs(off)>31){
      const dist=Math.abs(off)+' dias '+(off>0?'depois':'antes')+' da data central ('+fmtDate(median)+')';
      errors.push(issue('Data muito distante das demais ('+x.text+')',[['Linha',ond(x.sheet,x.row)],['Distância',dist]],
        'Provável erro de dia, mês ou ano.','ALTO',{k:'d-dist',t:'Datas muito distantes das demais',c:['Linha','Data','Distância'],v:[ond(x.sheet,x.row),x.text,dist]}));
    }else ok.push(x);
  });

  // 2. Datas no futuro em relação a hoje
  ok.forEach(x=>{
    if(diffDays(today,x.d)>2)alerts.push(issue('Data no futuro ('+x.text+')',[['Linha',ond(x.sheet,x.row)],['Hoje',fmtDate(today)]],
      'Conferir a data, principalmente o ano.','',{k:'d-fut',t:'Datas no futuro',c:['Linha','Data'],v:[ond(x.sheet,x.row),x.text]}));
  });

  // 3. Ordem crescente e saltos (23 → 24 → 25)
  for(let i=1;i<ok.length;i++){
    const p=ok[i-1],c=ok[i],g=diffDays(p.d,c.d);
    if(g<=0){
      const prob=g===0?'data repetida depois de outra':'volta '+Math.abs(g)+' dia(s)';
      errors.push(issue('Datas fora de ordem cronológica',[['Linhas',ond(c.sheet,p.row+' → '+c.row)],['Sequência',p.text+' → '+c.text],['Problema',prob]],
        'Conferir a data das duas linhas. Afeta o cálculo de laytime.','CRÍTICO',{k:'d-ord',t:'Datas fora de ordem cronológica',c:['Linhas','Sequência','Problema'],v:[ond(c.sheet,p.row+' → '+c.row),p.text+' → '+c.text,prob]}));
    }else if(g>1){
      alerts.push(issue('Salto de '+g+' dias entre datas consecutivas',[['Linhas',ond(c.sheet,p.row+' → '+c.row)],['Sequência',p.text+' → '+c.text]],
        'Confirmar se não houve registros nos dias que faltam.','',{k:'d-salto',t:'Saltos entre datas consecutivas',c:['Linhas','Sequência','Dias'],v:[ond(c.sheet,p.row+' → '+c.row),p.text+' → '+c.text,g]}));
    }
  }
}

// Somatórias de Volumes e Peso: por período (Period Total) e total final
const fmtN=n=>n.toLocaleString('pt-BR',{maximumFractionDigits:3});
function checkVW(volOut,pesoOut){
  [{k:'vol',name:'Volumes',out:volOut,tol:0.5},{k:'t',name:'Carretas',out:volOut,tol:0.5},{k:'w',name:'Peso',out:pesoOut,tol:0.01}].forEach(def=>{
    const col=colInfo&&colInfo[def.k], k=def.k;
    if(col===undefined){
      if(k==='t')return; // Trucks é opcional: só existe em algumas operações
      if(k==='vol'&&colInfo&&colInfo.t!==undefined)return; // operação contada em Trucks
      def.out.push(issue('Coluna de '+def.name+' não identificada',[],
        'O cabeçalho da coluna deve ser '+(k==='vol'?'Vols, Skips, Volumes ou Trucks':'Peso ou Weight')+'.'));
      return;
    }
    const blocks=new Map(); const grand=[];
    rows.forEach(r=>{
      if(r.isGrandTotal){grand.push(r);return}
      if(!blocks.has(r.periodBlock))blocks.set(r.periodBlock,{sum:0,n:0,total:null,tr:null,date:r.operationalDate,lines:[],skipped:[]});
      const b=blocks.get(r.periodBlock), v=r[k];
      if(r.isPeriodTotal){b.tr=r;b.total=v;return}
      if(/not\s+worked|awaiting/i.test(rowText(r))){b.skipped.push(r.row);return} // paralisação não é produção
      if(v!==null){b.sum+=v;b.n++;b.lines.push(r.row)}
    });
    let sumTotals=0, nTotals=0, sumRows=0;
    blocks.forEach(b=>{
      sumRows+=b.sum;
      if(!b.tr)return;
      if(b.total===null){
        if(b.n&&b.sum>def.tol)def.out.push(issue('Period Total sem valor de '+def.name,[['Linha',ond(b.tr.sheet,b.tr.row)],['Data',b.date||'—'],['Soma das linhas',fmtN(b.sum)]],
          'Preencher o total do período ou restaurar a fórmula.','',{k:'pt0-'+k,t:'Period Total sem valor de '+def.name,c:['Linha','Data','Soma das linhas'],v:[ond(b.tr.sheet,b.tr.row),b.date||'—',fmtN(b.sum)]}));
        return;
      }
      sumTotals+=b.total; nTotals++;
      if(Math.abs(b.sum-b.total)>def.tol)def.out.push(issue('Somatória do período não confere — '+def.name,[
        ['Linha',ond(b.tr.sheet,b.tr.row)],['Data',b.date||'—'],['Total informado',fmtN(b.total)],['Soma das linhas',fmtN(b.sum)],['Diferença',fmtN(Math.abs(b.sum-b.total))],
        ['Linhas somadas',b.lines.slice(0,15).join(', ')+(b.lines.length>15?' …':'')]
      ].concat(b.skipped.length?[['Paralisações (fora da soma)',b.skipped.join(', ')]]:[]),'Conferir linha faltando, duplicada ou com valor errado, e o intervalo da fórmula do total.','ALTO',
        {k:'pt-'+k,t:'Somatórias de período que não conferem — '+def.name,c:['Linha','Data','Informado','Soma','Diferença'],v:[ond(b.tr.sheet,b.tr.row),b.date||'—',fmtN(b.total),fmtN(b.sum),fmtN(Math.abs(b.sum-b.total))]}));
    });
    const g=grand.filter(r=>r[k]!==null).pop();
    if(!g){
      def.out.push(issue('Total final de '+def.name+' não identificado',[],
        'Conferir se a linha "Total" / "Grand Total" existe e está preenchida.'));
    }else if(nTotals&&Math.abs(g[k]-sumTotals)>def.tol){
      def.out.push(issue('Total final não confere — '+def.name,[
        ['Linha',ond(g.sheet,g.row)],['Informado',fmtN(g[k])],['Soma dos períodos',fmtN(sumTotals)+' ('+nTotals+')'],['Diferença',fmtN(Math.abs(g[k]-sumTotals))]
      ],'Conferir se algum período ficou fora da soma final.','CRÍTICO'));
    }
  });
}

// Sequência dos marcos do navio (chegada, NOR, atracação, início/fim da operação, saída)
const MILESTONES=[
  {rank:1,name:'Chegada',rx:/\barriv(ed|al)\b|\beosp\b/i,pick:'first'},
  {rank:2,name:'NOR tendered',rx:/\bnor\b.*\btender|notice of readiness.*tender|tender.*\bnor\b/i,pick:'first'},
  {rank:3,name:'NOR accepted',rx:/\bnor\b.*\baccept|accept.*\bnor\b/i,pick:'first'},
  {rank:4,name:'Atracação (all fast)',rx:/all\s*fast|\bberthed\b|\balongside\b/i,pick:'first'},
  {rank:5,name:'Início da operação',rx:/(load\w*|discharg\w*)(\s+(cargo|operations?))?\s+(commenced|started|began)|(commenced|started)\s+(load\w*|discharg\w*)/i,pick:'first'},
  {rank:6,name:'Fim da operação',rx:/(load\w*|discharg\w*)(\s+(cargo|operations?))?\s+(completed|finished|ended)|(completed|finished)\s+(load\w*|discharg\w*)/i,pick:'last'},
  {rank:7,name:'Saída',rx:/\bsailed\b|\bdeparted\b|\bdeparture\b|\bcast\s*off\b|\blast\s*line\b|\bpilot\s*off\b/i,pick:'first'} // \"unberthed\" não conta: o navio pode sair do costado e terminar no fundeio
];
function tsText(ts){const d=new Date(ts);return fmtDate(d)+' '+pad(d.getHours())+':'+pad(d.getMinutes())}
function collectMilestones(){
  const found={}, start=new Map();
  rows.forEach(r=>{
    if(r.isPeriodTotal||r.isGrandTotal||r.prodOnly||start.has(r.periodBlock))return;
    const m=parseTime(r.values[3])!==null?parseTime(r.values[3]):parseTime(r.values[4]);
    if(m!==null)start.set(r.periodBlock,m);
  });
  rows.forEach(r=>{
    if(r.isPeriodTotal||r.isGrandTotal)return;
    const t=rowText(r);
    if(/awaiting|waiting|not worked|survey/i.test(t))return;
    const d=parseDateValue(r.operationalDate);
    const min=parseTime(r.values[3])!==null?parseTime(r.values[3]):parseTime(r.values[4]);
    if(!d||min===null)return;
    const m=MILESTONES.find(x=>x.rx.test(t)); if(!m)return;
    const late=(start.get(r.periodBlock)>=1140&&min<420); // depois da meia-noite em período 19x01 = dia seguinte
    const ev={m,ts:d.getTime()+(min+(late?1440:0))*60000,row:r.row,sheet:r.sheet,late,cycle:r.operationalDate};
    if(!found[m.rank]||m.pick==='last')found[m.rank]=ev;
  });
  return found;
}
function checkMilestones(errors){
  const found=collectMilestones();
  const list=Object.keys(found).map(Number).sort((a,b)=>a-b).map(k=>found[k]);
  for(let i=1;i<list.length;i++){
    const p=list[i-1],c=list[i];
    if(c.ts<p.ts){
      errors.push(issue('Marcos do navio fora de ordem cronológica',[
        ['Linhas',ond(c.sheet,p.row+' e '+c.row)],[p.m.name,tsText(p.ts)],[c.m.name,tsText(c.ts)],['Diferença',fmtMin2(p.ts-c.ts)+' antes']
      ],'Conferir data e hora dos dois marcos.','CRÍTICO',{k:'marcos',t:'Marcos do navio fora de ordem cronológica',c:['Linhas','Marco anterior','Marco seguinte','Diferença'],v:[ond(c.sheet,p.row+' e '+c.row),p.m.name+' '+tsText(p.ts),c.m.name+' '+tsText(c.ts),fmtMin2(p.ts-c.ts)+' antes']}));
    }
  }
}
function fmtMin2(ms){const m=Math.round(ms/60000);return m>=1440?Math.floor(m/1440)+'d '+Math.floor((m%1440)/60)+'h'+pad(m%60):Math.floor(m/60)+'h'+pad(m%60)}

// Produção lançada em linha marcada como "Not worked" ou "Awaiting"
function checkStopProduction(errors){
  rows.forEach(r=>{
    if(r.isPeriodTotal||r.isGrandTotal)return;
    const t=rowText(r);
    if(!/not\s+worked|awaiting/i.test(t))return;
    const prod=[['Volumes',r.vol],['Carretas',r.t],['Peso',r.w]].filter(x=>x[1]!==null&&x[1]>0);
    if(!prod.length)return;
    const reg=findCellText(r,/not\s+worked|awaiting/i)||t, pr=prod.map(x=>x[0]+' '+fmtN(x[1])).join(' · ');
    errors.push(issue('Produção lançada em linha paralisada',[['Linha',ond(r.sheet,r.row)],['Data',r.operationalDate||'—'],['Registro',reg],['Produção',pr]],
      'Conferir se o motivo ou a produção estão na linha errada.','ALTO',{k:'prodpar',t:'Produção lançada em linha paralisada',c:['Linha','Data','Registro','Produção'],v:[ond(r.sheet,r.row),r.operationalDate||'—',reg,pr]}));
  });
}

// ===== Ortografia (dicionário de inglês + glossário) =====
let typo=null, dictState='loading';
const DEFAULT_GLOSS=('berthed unberthed unberth unberthing berthing stevedores stevedore stevedoring hatch hatches tally nor eosp pilotage tugs tug demurrage laytime dunnage lashing unlashing crane cranes grab grabs hopper hoppers skips potash wrc manifest warping anchorage roadstead gangway bunkering unmooring moored sailed fenders breakbulk lorries forklift forklifts payloader payloaders conveyor tonnage deadweight'.split(' '));
const GL_KEY='sofGlossary'; let gl=null;
function userGloss(){if(gl)return gl;try{gl=JSON.parse(localStorage.getItem(GL_KEY)||'[]')}catch(e){gl=[]}return gl}
function saveGloss(a){gl=a;try{localStorage.setItem(GL_KEY,JSON.stringify(a))}catch(e){}}
function getGloss(){return new Set(DEFAULT_GLOSS.concat(userGloss()))}
function refreshGloss(){renderGloss()}
function addGloss(w){const a=userGloss().slice();if(!a.includes(w))a.push(w);saveGloss(a);refreshGloss()}

async function loadDict(){
  // Dicionário en_US embutido no próprio arquivo (não depende de internet)
  try{
    if(typeof Typo==='undefined'||typeof DICT_EN_AFF==='undefined')throw new Error('dicionário ausente');
    await tick();
    typo=new Typo('en_US',DICT_EN_AFF,DICT_EN_DIC,{platform:'any'});
    dictState='ok';
  }catch(e){dictState='fail';console.error('Dicionário não carregado',e)}
}

function checkSpelling(english){
  if(dictState!=='ok'){
    english.push(issue('Verificação ortográfica não executada',[],
      dictState==='loading'?'O dicionário ainda está carregando. Clique em Analisar SOF de novo em alguns segundos.':'O dicionário não carregou. Recarregue a página e analise de novo.'));
    return;
  }
  const gloss=getGloss(), found=new Map(), auto=new Set();
  /* nomes próprios não são erro de ortografia: dados do cabeçalho (navio, agente, armador, porto...), navios/cargas do Line Up e nomes depois de "M/V" */
  const addW=s=>(String(s||'').match(/[A-Za-z]+/g)||[]).forEach(w=>auto.add(w.toLowerCase()));
  if(hdrInfo){addW(hdrInfo.vessel);(hdrInfo.nomes||[]).forEach(addW)}
  try{const lu=JSON.parse(localStorage.getItem('painelLineup')||'null');((lu&&lu.dados)||[]).forEach(x=>{addW(x.navio);addW(x.carga);addW(x.berco);addW(x.origem)})}catch(e){}
  rows.forEach(r=>(rowText(r).match(/\bM\s*\/?\.?\s*V\.?\s+[A-Za-z][A-Za-z0-9\- ]{2,30}/g)||[]).forEach(addW));
  rows.forEach(r=>{
    if(r.isPeriodTotal||r.isGrandTotal)return;
    r.values.forEach(cell=>{
      const t=String(cell||'');
      if(!/[A-Za-z]{3}/.test(t)||/^[\d\s:.,\/\-+%]*$/.test(t))return;
      (t.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)||[]).forEach(raw=>{
        const w=raw.replace(/['’]s$/i,'');
        if(w.length<3||/['’]/.test(w))return;
        if(w===w.toUpperCase()&&w.length<=5)return; // siglas (NOR, EOSP, WRC...)
        const k=w.toLowerCase();
        if(gloss.has(k)||auto.has(k)||typo.check(w))return;
        if(!found.has(k))found.set(k,{word:w,rows:[],ctx:t.trim().slice(0,100),sheet:r.sheet});
        const f=found.get(k); if(!f.rows.includes(r.row))f.rows.push(r.row);
      });
    });
  });
  const all=[...found.values()], shown=all.slice(0,60);
  shown.forEach((f,i)=>{
    let sug=[]; if(i<40){try{sug=(typo.suggest(f.word,5)||[]).filter(x=>!/\d/.test(x)).slice(0,3)}catch(e){}}
    const lin=ond(f.sheet,f.rows.slice(0,10).join(', ')+(f.rows.length>10?' …':'')), sg=sug.length?sug.join(', '):'—';
    let h=issue('Possível erro de ortografia: “'+f.word+'”',[['Linhas',lin],['Trecho',f.ctx],['Sugestão',sg]],
      'Corrigir no documento ou, se a palavra estiver certa, adicionar ao glossário.','REVISAR',{k:'orto',t:'Possíveis erros de ortografia',c:['Palavra','Linhas','Trecho','Sugestão'],v:[f.word,lin,f.ctx,sg]});
    h=h.replace('<!--BTN-->','<button class="addGloss" data-word="'+esc(f.word.toLowerCase())+'" title="A palavra está certa: não marcar mais">+ Glossário</button><!--BTN-->');
    english.push(h);
  });
  if(all.length>shown.length)english.push(issue('Mais '+(all.length-shown.length)+' palavra(s) não reconhecida(s)',[],
    'Não foram listadas. Se forem nomes ou termos técnicos, adicione ao glossário e analise de novo.'));
}

// ===== Regras 1 a 5: ciclos por data, equipes, peso por unidade, cabeçalho e padronização =====
const inTable=r=>!colInfo||colInfo.hdr===undefined||colInfo.hdr<0||r.row>colInfo.hdr+1;
const hmm=m=>pad(Math.floor((m%1440)/60))+':'+pad(m%60);

// 1) Cada data tem 4 períodos (01x07, 07x13, 13x19, 19x01), sempre nessa ordem
const CYC=['01x07','07x13','13x19','19x01'];
const cycIndex=m=>m<420?0:m<780?1:m<1140?2:3;
function checkCycles(errors){
  const blocks=new Map();
  rows.forEach(r=>{
    if(r.isPeriodTotal||r.isGrandTotal||r.prodOnly||!inTable(r))return;
    const m=parseTime(r.values[3])!==null?parseTime(r.values[3]):parseTime(r.values[4]);
    if(m===null)return;
    if(!blocks.has(r.periodBlock))blocks.set(r.periodBlock,{date:r.operationalDate,start:m,row:r.row,sheet:r.sheet});
  });
  let prev=null;
  [...blocks.values()].forEach(b=>{
    const idx=cycIndex(b.start);
    if(prev&&b.date&&prev.date===b.date&&idx<=prev.idx){
      const d=parseDateValue(b.date), next=d?fmtDate(new Date(d.getFullYear(),d.getMonth(),d.getDate()+1)):'';
      const per=CYC[idx]+' depois de '+CYC[prev.idx]+' (linha '+prev.row+')', sgd=idx===0&&prev.idx===3&&next?'data provável: '+next:'—';
      errors.push(issue('Período fora de ordem dentro da data '+b.date,[['Linha',ond(b.sheet,b.row)],['Período',per]].concat(sgd!=='—'?[['Sugestão',sgd]]:[]),
        'Cada data segue 01x07, 07x13, 13x19, 19x01. Conferir a data deste bloco.','ALTO',{k:'per',t:'Períodos fora de ordem dentro da data',c:['Linha','Data','Período','Sugestão'],v:[ond(b.sheet,b.row),b.date,per,sgd]}));
    }
    prev={date:b.date,idx,row:b.row};
  });
}

// 2) Por equipe (Gang): as linhas de cada período devem cobrir o horário sem lacuna nem sobreposição
function checkGangs(errors){
  if(!colInfo||colInfo.g===undefined)return;
  const names=new Map();
  rows.forEach(r=>{
    if(r.isPeriodTotal||r.isGrandTotal||!inTable(r)||!r.gang||r.gang==='-')return;
    names.set(r.gang.toLowerCase(),r.gang);
  });
  if(names.size<2)return; // só roda quando o SOF tem equipes nomeadas (1st, 2nd...)
  const blocks=new Map();
  rows.forEach(r=>{
    if(r.isPeriodTotal||r.isGrandTotal||r.prodOnly||!inTable(r))return;
    const a=parseTime(r.values[3]),b=parseTime(r.values[4]);
    if(a===null||b===null||a===b)return;
    if(!blocks.has(r.periodBlock))blocks.set(r.periodBlock,[]);
    blocks.get(r.periodBlock).push({a,b,row:r.row,sheet:r.sheet,g:(r.gang||'-').toLowerCase(),date:r.operationalDate});
  });
  blocks.forEach(list=>{
    const base=list[0].a, norm=x=>x<base-720?x+1440:x;
    list.forEach(x=>{x.s=norm(x.a);x.e=x.s+(x.b>x.a?x.b-x.a:x.b+1440-x.a)});
    const start=Math.min(...list.map(x=>x.s)), end=Math.max(...list.map(x=>x.e));
    names.forEach((label,g)=>{
      if(!list.some(x=>x.g===g))return;
      const segs=list.filter(x=>x.g===g||x.g==='-').sort((p,q)=>p.s-q.s||p.e-q.e);
      const probs=[]; let pos=start,last=null;
      segs.forEach(x=>{
        if(x.s>pos)probs.push('lacuna de '+hmm(pos)+' às '+hmm(x.s)+(last?' (entre as linhas '+last.row+' e '+x.row+')':' (antes da linha '+x.row+')'));
        else if(x.s<pos&&last)probs.push('sobreposição de '+hmm(x.s)+' às '+hmm(Math.min(pos,x.e))+' (linhas '+last.row+' e '+x.row+')');
        if(x.e>pos||!last){pos=Math.max(pos,x.e);last=x}
      });
      if(pos<end)probs.push('lacuna de '+hmm(pos)+' às '+hmm(end)+' (após a linha '+last.row+')');
      if(!probs.length)return;
      const rr=list.map(x=>x.row);
      const lns=ond(list[0].sheet,Math.min(...rr)+' a '+Math.max(...rr)), pb=probs.join('; ');
      errors.push(issue('Equipe '+label+': conflito de horários no período',[['Linhas',lns],['Data',list[0].date||'—'],['Problema',pb]],
        'Conferir a equipe das paralisações e se falta ou sobra registro (linhas com "-" valem para todas).','ALTO',{k:'gang',t:'Equipes com conflito de horários',c:['Equipe','Linhas','Data','Problema'],v:[label,lns,list[0].date||'—',pb]}));
    });
  });
}

// 3) Volumes com casas decimais (volume deve ser número inteiro)
function checkFractionalVolumes(out){
  if(!colInfo)return;
  const key=colInfo.vol!==undefined?'vol':(colInfo.t!==undefined?'t':null); if(!key)return;
  const bad=rows.filter(r=>!r.isPeriodTotal&&!r.isGrandTotal&&inTable(r)&&r[key]!==null&&Math.abs(r[key]-Math.round(r[key]))>1e-6);
  if(!bad.length)return;
  out.push(issue((key==='vol'?'Volume':'Carretas')+' com casas decimais',
    bad.slice(0,10).map(r=>['Linha '+r.row,fmtN(r[key])+' ('+(r.operationalDate||'sem data')+')']),
    'Volumes são inteiros. Conferir se a linha foi rateada ou digitada errada.','ATENÇÃO'));
}

// 4) Cabeçalho: campos em branco, ordem dos marcos, Pilot x chegada e cabeçalho x tabela
const tsOf=f=>f&&f.date&&f.time?f.date.getTime()+parseTime(f.time)*60000:null;
function checkHeader(errors,alerts){
  if(!hdrInfo)return;
  const F=hdrInfo.fields, found=collectMilestones();
  [['arrival','nort'],['arrival','pilot'],['pilot','allfast'],['arrival','allfast'],['nort','commenced'],['allfast','commenced'],['commenced','completed'],['completed','docs']].forEach(([a,b])=>{
    const A=F[a],B=F[b]; if(!A||!B||!A.date||!B.date)return;
    const ta=tsOf(A),tb=tsOf(B), bad=(ta!==null&&tb!==null)?tb<ta:B.date<A.date;
    if(bad)errors.push(issue('Cabeçalho: marcos fora de ordem cronológica',[
      ['Linhas do cabeçalho',A.row+' e '+B.row],[A.name,fmtDate(A.date)+(A.time?' '+A.time:'')],[B.name,fmtDate(B.date)+(B.time?' '+B.time:'')]
    ],B.name+' está antes de '+A.name+'. Conferir os dois campos.','CRÍTICO'));
  });
  // Pilot on board muito antes de Made all fast
  const PILOT_MAX_H=6, tpil=tsOf(F.pilot), tfast=tsOf(F.allfast);
  if(tpil!==null&&tfast!==null&&tfast-tpil>PILOT_MAX_H*3600000)alerts.push(issue('Cabeçalho: Pilot on board muito antes de Made all fast',[
    ['Linhas do cabeçalho',F.pilot.row+' e '+F.allfast.row],['Pilot on board',tsText(tpil)],['Made all fast',tsText(tfast)],['Intervalo',fmtMin2(tfast-tpil)]
  ],'O prático costuma embarcar poucas horas antes da atracação. Conferir hora e data.','ATENÇÃO'));
  // Sailing Drafts preenchidos antes do fim da operação
  const sd=hdrInfo.drafts.sailing;
  if(sd&&sd.fwd!==null&&sd.aft!==null&&!found[6]&&tsOf(F.completed)===null)alerts.push(issue('Cabeçalho: Sailing Drafts preenchidos antes do fim da operação',[
    ['Linha do cabeçalho',sd.row],['Sailing Drafts','fwd '+fmtN(sd.fwd)+' m / aft '+fmtN(sd.aft)+' m']
  ],'Os calados de saída são medidos no fim do carregamento. Confirmar se são estimados.','ATENÇÃO'));
  const ta=tsOf(F.arrival), tp=tsOf(F.pilot);
  if(ta!==null&&tp!==null&&ta===tp)alerts.push(issue('Cabeçalho: Pilot on board no mesmo horário da chegada',[
    ['Linhas do cabeçalho',F.arrival.row+' e '+F.pilot.row],['Horário',tsText(ta)]
  ],'Pode ser cópia do horário de Arrival. Conferir o horário real de Pilot on board.'));
  [['commenced',5],['completed',6]].forEach(([k,rank])=>{
    const f=F[k], ev=found[rank], th=tsOf(f);
    if(!f||!ev||th===null||th===ev.ts)return;
    errors.push(issue('Cabeçalho × tabela: '+f.name+' não confere',[
      ['Linhas','cabeçalho '+f.row+', tabela '+ev.row],['Cabeçalho',tsText(th)],['Tabela',tsText(ev.ts)],['Diferença',fmtMin2(Math.abs(th-ev.ts))]
    ].concat(ev.late?[['Obs.','na tabela fica no 19x01 de '+ev.cycle+', depois da meia-noite (dia seguinte)']]:[]),'Conferir qual dos dois está correto e corrigir o outro.','CRÍTICO'));
  });
}

// ===== Erros grotescos (v0.44): produtividade impossível, data fora da estadia, dia da semana, linhas duplicadas, restos de modelo =====
const DOW_EN=['sun','mon','tue','wed','thu','fri','sat'],DOW_PT=['dom','seg','ter','qua','qui','sex','sab'];
function checkGrotescos(errors,alerts,all){
  const F=hdrInfo?hdrInfo.fields:{};
  // 4) Produtividade (t/h por linha de produção) muito fora do padrão do próprio SOF: vírgula/ponto trocados ou zero a mais
  const prod=[];
  all.forEach(r=>{if(!r.w||r.w<=0)return;const tp=timePairs(r);if(tp.length<2)return;const e=operationalEndMinutes(tp[0].min,tp[1].min);if(e===null)return;const dur=e-tp[0].min;
    if(dur<=0){errors.push(issue('Produção registrada em intervalo de 0 minuto',[['Linha',ond(r.sheet,r.row)],['Registro',tp[0].time+' → '+tp[1].time],['Peso',fmtN(r.w)]],'Conferir o horário de início e fim.','CRÍTICO',{k:'g-dur0',t:'Produção em intervalo de 0 minuto',c:['Linha','Registro','Peso'],v:[ond(r.sheet,r.row),tp[0].time+' → '+tp[1].time,fmtN(r.w)]}));return}
    prod.push({r,rate:r.w/(dur/60),dur,tp})});
  if(prod.length>=4){
    const s=prod.map(x=>x.rate).sort((a,b)=>a-b),med=s[Math.floor(s.length/2)];
    prod.forEach(x=>{if(!(x.rate>4*med&&x.rate-med>150))return;const vezes=Math.round(x.rate/med);
      const grave=vezes>=10;
      errors.push(issue('Produtividade fora do padrão ('+fmtN(Math.round(x.rate))+' t/h)',[['Linha',ond(x.r.sheet,x.r.row)],['Registro',x.tp[0].time+' → '+x.tp[1].time+' ('+fmtMin2(x.dur*60000)+')'],['Peso',fmtN(x.r.w)],['Média do SOF',fmtN(Math.round(med))+' t/h ('+vezes+'x)']],
        grave?'Muito acima do normal: provável vírgula/ponto trocados ou zero a mais no peso. Conferir com o tally.':'Bem acima das outras linhas. Conferir peso e horário.',grave?'CRÍTICO':'ALTO',
        {k:'g-prod',t:'Produtividade fora do padrão',c:['Linha','Registro','Peso','t/h','Média do SOF'],v:[ond(x.r.sheet,x.r.row),x.tp[0].time+' → '+x.tp[1].time,fmtN(x.r.w),fmtN(Math.round(x.rate)),fmtN(Math.round(med))]}))});
  }
  // 5) Data da tabela fora da estadia do navio (antes da chegada ou depois da saída/fim)
  const ini=F.arrival&&F.arrival.date||F.allfast&&F.allfast.date||null,fimF=[F.unberth,F.docs,F.completed].find(f=>f&&f.date),fim=fimF?fimF.date:null,vistos={};
  if(ini||fim)all.forEach(r=>{const d=parseDateValue(r.operationalDate);if(!d||vistos[r.operationalDate])return;
    const antes=ini&&diffDays(ini,d)<-1&&diffDays(ini,d)>=-31,depois=fim&&diffDays(fim,d)>1&&diffDays(fim,d)<=31;   /* mais longe que 31 dias já aparece em "Data muito distante" */if(!antes&&!depois)return;vistos[r.operationalDate]=1;
    errors.push(issue('Data fora da estadia do navio ('+r.operationalDate+')',[['Linha',ond(r.sheet,r.row)],[antes?'Chegada (cabeçalho)':fimF.name+' (cabeçalho)',fmtDate(antes?ini:fim)]],
      antes?'A data é anterior à chegada do navio. Provável erro de dia, mês ou ano.':'A data é posterior ao fim registrado no cabeçalho. Conferir a data (principalmente o ano) ou o cabeçalho.','CRÍTICO',
      {k:'g-estadia',t:'Datas fora da estadia do navio',c:['Linha','Data','Referência'],v:[ond(r.sheet,r.row),r.operationalDate,(antes?'chegada ':'fim ')+fmtDate(antes?ini:fim)]}))});
  // 6) Dia da semana (coluna DAY) não confere com a data
  all.forEach(r=>{const d=parseDateValue(r.values[1]);if(!d)return;const w=String(r.values[2]||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').slice(0,3);
    let i=DOW_EN.indexOf(w);if(i<0)i=DOW_PT.indexOf(w);if(i<0||i===d.getDay())return;
    const certo=DOW_EN[d.getDay()].replace(/^./,c=>c.toUpperCase());
    errors.push(issue('Dia da semana não confere com a data',[['Linha',ond(r.sheet,r.row)],['Data',r.values[1]],['Escrito',r.values[2]],['Correto',certo]],'Corrigir o dia da semana (ou a data).','ALTO',
      {k:'g-dow',t:'Dia da semana não confere com a data',c:['Linha','Data','Escrito','Correto'],v:[ond(r.sheet,r.row),r.values[1],r.values[2],certo]}))});
  // 8) Linhas duplicadas: ficam na conferência de duplicados (que passa a ser CRÍTICA quando a linha tem produção)
  // 9) Restos de modelo: XX, TBA, erros do Excel, 00:00 → 00:00, nome de outro navio, campos-chave do cabeçalho vazios
  const RX_RESTO=/(^|[\s(|])(x{2,}|tba|tbc|tbd|a definir|\?{2,}|lorem)(?=$|[\s).,:|])|#(ref!|n\/a|value!|div\/0!|name\?|num!)/i;
  all.forEach(r=>{const v=r.values.find(x=>RX_RESTO.test(' '+x+' '));if(v)alerts.push(issue('Resto de modelo / campo a preencher',[['Linha',ond(r.sheet,r.row)],['Texto',v]],'Preencher ou apagar antes de liberar o SOF.','ALTO',{k:'g-resto',t:'Restos de modelo / campos a preencher',c:['Linha','Texto'],v:[ond(r.sheet,r.row),v]}));
    const tp=timePairs(r);if(tp.length===2&&tp[0].min===0&&tp[1].min===0)alerts.push(issue('Horário 00:00 → 00:00',[['Linha',ond(r.sheet,r.row)]],'Parece horário não preenchido. Conferir.','ALTO',{k:'g-zero',t:'Horários 00:00 → 00:00',c:['Linha'],v:[ond(r.sheet,r.row)]}))});
  const vs=hdrInfo&&hdrInfo.vessel;
  if(vs){const nv=t=>String(t||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim(),V=nv(vs),outros={};
    all.forEach(r=>{const m=rowText(r).match(/\bM\s*\/?\.?\s*V\.?\s+([A-Za-z][A-Za-z0-9\- ]{2,30})/g);(m||[]).forEach(x=>{const n=nv(x.replace(/^M\s*\/?\.?\s*V\.?\s+/i,''));if(n&&V.indexOf(n)<0&&n.indexOf(V)<0&&!outros[n]){outros[n]=1;
      errors.push(issue('Nome de outro navio no SOF',[['Linha',ond(r.sheet,r.row)],['Navio do cabeçalho',vs],['Encontrado',x.trim()]],'Provável SOF aproveitado de outro navio. Conferir o texto.','CRÍTICO'))}})})}
  /* campos do cabeçalho em branco já entram em Pendências */
}

// Cabeçalho × corpo: o tipo de operação escrito no cabeçalho (Commenced/Completed Loading ou Discharging)
// precisa ser o mesmo da operação descrita nas linhas do SOF.
function checkHeaderOp(errors,all){
  if(!hdrInfo)return;const F=hdrInfo.fields;let nl=0,nd=0;
  /* só linhas da tabela de eventos (com horário de início e fim) e totais: o próprio cabeçalho não conta */
  all.filter(r=>timePairs(r).length>=2||/total/i.test(rowText(r))).forEach(r=>{const t=rowText(r).toLowerCase();nl+=(t.match(/\b(loading|loaded|load)\b/g)||[]).length;nd+=(t.match(/\b(discharg\w*|unload\w*|offload\w*)\b/g)||[]).length});
  const op=nd>=2&&nd>=3*nl?'disch':nl>=2&&nl>=3*nd?'load':null;if(!op)return;
  const errados=['commenced','completed'].map(k=>F[k]).filter(f=>f&&f.label&&(op==='disch'?/load/i:/disch/i).test(f.label));
  if(!errados.length)return;
  const certo=op==='disch'?'Commenced Discharging / Completed Discharging':'Commenced Loading / Completed Loading';
  errors.push(issue('Cabeçalho: tipo de operação não confere com o SOF',[
    ['Linhas do cabeçalho',errados.map(f=>f.row).join(' e ')],['No cabeçalho',errados.map(f=>f.label).join(' / ')],
    ['No corpo do SOF',op==='disch'?'descarga ('+nd+' menção(ões) a discharging; '+nl+' a loading)':'carregamento ('+nl+' menção(ões) a loading; '+nd+' a discharging)']
  ],'O corpo do SOF é de '+(op==='disch'?'DESCARGA':'CARREGAMENTO')+'. No cabeçalho, usar “'+certo+'”.','CRÍTICO'));
}

// 5) Padronização dos textos e do preenchimento
function checkTextStyle(english,alerts){
  if(!colInfo||colInfo.d===undefined)return;
  const di=colInfo.d;
  // todas as frases da coluna de descrição, inclusive títulos de seção (ex.: "LOADING AT ANCHORAGE AREA.")
  const ev=rows.filter(r=>!r.isPeriodTotal&&!r.isGrandTotal&&!r.prodOnly&&inTable(r))
    .map(r=>({r,t:String(r.values[di]||'').trim()})).filter(x=>x.t&&x.t!=='-');
  const list=m=>[...m.entries()].map(([t,rws])=>['Linha(s) '+rws.slice(0,8).join(', '),t]);
  const groups=new Map();
  ev.forEach(x=>{
    const key=x.t.toLowerCase().replace(/[.\s]+$/,'').replace(/\s+/g,' ').replace(/(\w{3,})s\b/g,'$1');
    if(!groups.has(key))groups.set(key,new Map());
    const g=groups.get(key); if(!g.has(x.t))g.set(x.t,[]); g.get(x.t).push(x.r.row);
  });
  groups.forEach(g=>{
    if(g.size<2)return;
    english.push(issue('Padronização: mesma frase escrita de formas diferentes',list(g),'Padronizar singular/plural, maiúsculas e pontuação.','REVISAR'));
  });
  // títulos de seção (texto em maiúsculas, sem horário, ex.: "LOADING AT ANCHORAGE AREA") não levam ponto final
  const isTitle=x=>/[A-Z]/.test(x.t)&&x.t===x.t.toUpperCase()&&parseTime(x.r.values[3])===null&&parseTime(x.r.values[4])===null;
  const evp=ev.filter(x=>!isTitle(x)), dot=evp.filter(x=>/\.$/.test(x.t));
  if(evp.length>=10&&dot.length/evp.length>=0.8){
    const miss=new Map(); evp.filter(x=>!/\.$/.test(x.t)).forEach(x=>{if(!miss.has(x.t))miss.set(x.t,[]);miss.get(x.t).push(x.r.row)});
    if(miss.size)english.push(issue('Padronização: frase sem ponto final',list(miss),'Acrescentar o ponto final, como nas demais linhas.','REVISAR'));
  }
  const seen=new Set();
  ev.forEach(x=>{
    const m=x.t.match(/\b(cranes|forklifts|trucks|hatches|gangs)\s+\w+s\b/i);
    if(!m||seen.has(x.t))return; seen.add(x.t);
    const sing=/ches$/i.test(m[1])?m[1].slice(0,-2):m[1].slice(0,-1);
    const ls=ev.filter(y=>y.t===x.t).map(y=>y.r.row).slice(0,8).join(', ');
    english.push(issue('Redação: plural antes de outro substantivo',[['Linhas',ls],['Texto',x.t],['Sugestão',x.t.replace(m[1],sing)]],
      'Usar o singular antes de outro substantivo.','REVISAR',{k:'plural',t:'Redação: plural antes de outro substantivo',c:['Linhas','Texto','Sugestão'],v:[ls,x.t,x.t.replace(m[1],sing)]}));
  });
  if(colInfo.labels&&ev.length>=10){
    // células vazias: só linhas de operação (com horário); títulos de seção não têm gang, porão nem volumes
    const evr=ev.map(x=>x.r).filter(r=>parseTime(r.values[3])!==null||parseTime(r.values[4])!==null), campos=[];
    colInfo.labels.forEach((lab,j)=>{
      if(!lab||/^(date|day|from|to)$/.test(lab)||j===di)return;
      const blanks=evr.filter(r=>!String(r.values[j]||'').trim());
      if(blanks.length&&1-blanks.length/evr.length>=0.9)
        campos.push([lab.charAt(0).toUpperCase()+lab.slice(1),'linha(s) '+blanks.slice(0,12).map(r=>r.row).join(', ')+(blanks.length>12?' …':'')]);
    });
    if(campos.length)alerts.push(issue('Células vazias onde o padrão é preencher',campos,'Preencher com o valor ou com "-".'));
  }
}

// ===== Stowage Plan: pesos e volumes por porão =====
function parseStowage(ws,name){
  const cells=[];
  for(const k in ws){
    if(k[0]==='!')continue;
    const v=getRawCellValue(ws,k); if(v===''||v===null||v===undefined)continue;
    const a=XLSX.utils.decode_cell(k); cells.push({r:a.r,c:a.c,v});
  }
  const labels=cells.filter(x=>typeof x.v==='string'&&/^\s*H#\s*\d+\s*$/i.test(x.v)).map(x=>({hold:parseInt(x.v.replace(/\D/g,''),10),r:x.r,c:x.c})).sort((a,b)=>a.c-b.c);
  if(!labels.length)return null;
  const mids=labels.slice(1).map((l,i)=>(labels[i].c+l.c)/2);
  const holdAt=c=>{let i=0;while(i<mids.length&&c>=mids[i])i++;return labels[i].hold};
  const at=(r,c)=>cells.find(x=>x.r===r&&x.c===c);
  const isUnit=(x,rx)=>!!x&&typeof x.v==='string'&&rx.test(x.v.trim());
  const entries=[];
  cells.forEach(x=>{
    if(typeof x.v!=='number'||!isUnit(at(x.r,x.c+1),/^mt$/i)||x.r<=labels[0].r)return;
    let vol=null;
    for(let rr=x.r-1;rr>=x.r-3;rr--){const y=at(rr,x.c); if(y&&typeof y.v==='number'&&isUnit(at(rr,x.c+1),/^vols?\.?$/i)){vol=y.v;break}}
    let cargo='',best=1e9;
    cells.forEach(y=>{
      if(typeof y.v!=='string'||y.r>=x.r||x.r-y.r>10||Math.abs(y.c-x.c)>1)return;
      if(/^\s*(vols?\.?|mt|with|un)\s*$/i.test(y.v)||/^\s*H#/i.test(y.v))return;
      if(x.r-y.r<best){best=x.r-y.r;cargo=y.v.trim()}
    });
    entries.push({hold:holdAt(x.c),w:x.v,vol,cargo,row:x.r+1});
  });
  const numRight=re=>{const l=cells.find(x=>typeof x.v==='string'&&re.test(x.v.trim())); if(!l)return null;
    const n=cells.filter(x=>x.r===l.r&&x.c>l.c&&typeof x.v==='number').sort((a,b)=>a.c-b.c)[0]; return n?n.v:null};
  const after=re=>{const l=cells.find(x=>typeof x.v==='string'&&re.test(x.v)); return l?l.v.replace(re,'').trim():null};
  return {name,entries,totalW:numRight(/^total\s+weight\s*:?$/i),totalVol:numRight(/^total\s+volumes?\s*:?$/i),
          date:after(/^\s*date\s*:/i),port:after(/^.*discharging\s+port\s*:/i)};
}
const cargoKey=t=>String(t||'').toLowerCase().replace(/^\s*(loading|discharg\w*)\s+/,'').replace(/[.\s]+$/,'').replace(/\s+/g,' ').replace(/s$/,'');

// 2) Tabela × Stowage Plan (por porão e, quando há mais de uma carga, por carga)
function checkStowage(errors){
  if(!stowPlans.length||!colInfo||colInfo.h===undefined)return;
  const key=colInfo.vol!==undefined?'vol':(colInfo.t!==undefined?'t':null);
  const T={},P={};
  const add=(M,h,c,vol,w)=>{const o=M[h]||(M[h]={vol:0,w:0,c:{}}); o.vol+=vol; o.w+=w; const k=o.c[c]||(o.c[c]={vol:0,w:0}); k.vol+=vol; k.w+=w};
  rows.forEach(r=>{
    if(r.isPeriodTotal||r.isGrandTotal||!inTable(r)||!(r.w>0)||/not\s+worked|awaiting/i.test(rowText(r)))return;
    const h=parseInt(r.hold,10); if(!(h>0))return;
    add(T,h,colInfo.d!==undefined?cargoKey(r.values[colInfo.d]):'',key?(r[key]||0):0,r.w);
  });
  let planVol=false;
  stowPlans.forEach(p=>p.entries.forEach(e=>{add(P,e.hold,cargoKey(e.cargo),e.vol||0,e.w); if(e.vol!==null)planVol=true}));
  const fmt=o=>fmtN(o.w)+' t'+(planVol?' · '+fmtN(o.vol)+' vol':'');
  const dif=(a,b)=>fmtN(Math.abs(a.w-b.w))+' t'+(planVol?' · '+fmtN(Math.abs(a.vol-b.vol))+' vol':'');
  const bad=(a,b)=>Math.abs(a.w-b.w)>0.011||(planVol&&Math.abs(a.vol-b.vol)>0.5);
  const zero={vol:0,w:0,c:{}};
  [...new Set(Object.keys(T).concat(Object.keys(P)))].map(Number).sort((a,b)=>a-b).forEach(h=>{
    const p=P[h]||zero, t=T[h]||zero;
    if(bad(p,t)){
      errors.push(issue('Tabela × Stowage Plan: Porão '+h+' não confere',[['Plano',fmt(p)],['Tabela',fmt(t)],['Diferença',dif(p,t)]],
        'Conferir o porão na tabela e no plano.','ALTO',{k:'stow',t:'Tabela × Stowage Plan: porões que não conferem',c:['Porão','Plano','Tabela','Diferença'],v:[h,fmt(p),fmt(t),dif(p,t)]}));
      return;
    }
    if(Object.keys(p.c).length<2&&Object.keys(t.c).length<2)return;
    [...new Set(Object.keys(p.c).concat(Object.keys(t.c)))].forEach(c=>{
      if(!c)return;
      const a=p.c[c]||{vol:0,w:0}, b=t.c[c]||{vol:0,w:0};
      if(bad(a,b))errors.push(issue('Tabela × Stowage Plan: Porão '+h+', carga "'+c+'" não confere',[['Plano',fmt(a)],['Tabela',fmt(b)],['Diferença',dif(a,b)]],
        'O porão bate, mas a divisão entre cargas não. Conferir os rótulos de carga.','ALTO',{k:'stowc',t:'Tabela × Stowage Plan: cargas que não conferem',c:['Porão','Carga','Plano','Tabela','Diferença'],v:[h,c,fmt(a),fmt(b),dif(a,b)]}));
    });
  });
  stowPlans.forEach(p=>{
    const sw=p.entries.reduce((x,e)=>x+e.w,0), sv=p.entries.reduce((x,e)=>x+(e.vol||0),0), hasV=p.entries.some(e=>e.vol!==null), f=[];
    if(p.totalW!==null&&Math.abs(p.totalW-sw)>0.011)f.push(['Peso total',fmtN(p.totalW)+' t (porões: '+fmtN(sw)+' t)']);
    if(p.totalVol!==null&&hasV&&Math.abs(p.totalVol-sv)>0.5)f.push(['Volumes totais',fmtN(p.totalVol)+' (porões: '+fmtN(sv)+')']);
    if(f.length)errors.push(issue('Stowage Plan "'+p.name+'": total não confere com os porões',f,'Conferir o total digitado no topo do plano.','ALTO'));
  });
}

// 5) Draft survey: ordem em relação aos marcos do navio
function checkSurveys(errors){
  if(!hdrInfo||!hdrInfo.surveys)return;
  const S=hdrInfo.surveys, F=hdrInfo.fields, found=collectMilestones();
  const ts=x=>x&&x.date&&x.time?x.date.getTime()+parseTime(x.time)*60000:null;
  const bad=(title,f)=>errors.push(issue('Cabeçalho: '+title,f,'Conferir datas e horários do draft survey e dos marcos.','ALTO'));
  [['initial','Initial'],['final','Final']].forEach(([k,nm])=>{
    const s=S[k]; if(!s)return; const a=ts(s.from), b=ts(s.to);
    if(a!==null&&b!==null&&b<a)bad(nm+' draft survey termina antes de começar',[['Início',tsText(a)],['Fim',tsText(b)]]);
  });
  const ini=S.initial;
  if(ini){
    const a=ts(ini.from), b=ts(ini.to), fast=tsOf(F.allfast), com=tsOf(F.commenced)!==null?tsOf(F.commenced):(found[5]?found[5].ts:null);
    if(a!==null&&fast!==null&&a<fast)bad('Initial draft survey começa antes de Made all fast',[['Initial draft survey',tsText(a)],['Made all fast',tsText(fast)]]);
    if(b!==null&&com!==null&&b>com)bad('Initial draft survey termina depois do início do carregamento',[['Fim do survey',tsText(b)],['Commenced Loading',tsText(com)]]);
  }
  const fin=S.final;
  if(fin){
    const a=ts(fin.from), end=tsOf(F.completed)!==null?tsOf(F.completed):(found[6]?found[6].ts:null);
    if(a!==null&&end!==null&&a<end)bad('Final draft survey começa antes do fim da operação',[['Final draft survey',tsText(a)],['Fim da operação',tsText(end)]]);
  }
}

// 1) Checklist de liberação: o que já está preenchido e o que falta
function buildChecklist(){
  const ok=[],wait=[],miss={cab:[],drf:[],srv:[],stw:[]};
  const found=collectMilestones(), done=!!found[6];
  if(found[6])ok.push('Fim da operação registrado na tabela'); else wait.push('Fim da operação registrado na tabela');
  if(hdrInfo){
    const F=hdrInfo.fields, AFTER=['completed','docs','booked','unberth'];
    Object.entries(F).forEach(([k,f])=>{
      if(f.text||(f.date&&f.time)){ok.push(f.name);return}
      if(AFTER.includes(k)&&!done){wait.push(f.name);return}
      miss.cab.push([f.name+' (linha '+f.row+')',f.date?'hora em branco':f.time?'data em branco':'data e hora em branco']);
    });
    [['arrival','Drafts de chegada',false],['sailing','Drafts de saída',true]].forEach(([k,lab,after])=>{
      const d=hdrInfo.drafts[k]; if(!d)return;
      const m=['fwd','aft'].filter(x=>d[x]===null);
      if(!m.length)ok.push(lab); else if(after&&!done)wait.push(lab); else miss.drf.push([lab+' (linha '+d.row+')',m.join(' e ')+' em branco']);
    });
    const started=F.commenced&&tsOf(F.commenced)!==null;
    [['initial','Initial draft survey',false],['final','Final draft survey',true]].forEach(([k,lab,after])=>{
      const s=(hdrInfo.surveys||{})[k]; if(!s)return;
      const full=['from','to'].every(x=>s[x]&&s[x].date&&s[x].time);
      if(full)ok.push(lab); else if(after?!done:!started)wait.push(lab); else miss.srv.push([lab+' (linha '+s.row+')','datas e horários de início e fim em branco']);
    });
  }
  stowPlans.forEach(p=>[['date','data'],['port','porto de descarga']].forEach(([k,nm])=>{
    if(p[k]===null)return;
    const lab='Stowage Plan'+(stowPlans.length>1?' "'+p.name+'"':'')+': '+nm;
    if(p[k])ok.push(lab); else if(!done)wait.push(lab); else miss.stw.push([lab,'em branco']);
  }));
  const pend=[],act='Preencher antes de liberar o SOF.';
  if(miss.cab.length)pend.push(issue('Pendência: cabeçalho com campos em branco',miss.cab,act));
  if(miss.drf.length)pend.push(issue('Pendência: drafts em branco',miss.drf,act));
  if(miss.srv.length)pend.push(issue('Pendência: draft survey em branco',miss.srv,act));
  if(miss.stw.length)pend.push(issue('Pendência: Stowage Plan incompleto',miss.stw,act));
  return {ok,wait,pend};
}
function checklistHtml(cl,nPend){
  if(!cl.ok.length&&!cl.wait.length)return '';
  const li=(a,i)=>a.map(x=>'<li>'+i+' '+esc(x)+'</li>').join('');
  return '<div class="ckinfo"><b>'+cl.ok.length+'</b> item(ns) conferido(s) • <b>'+nPend+'</b> pendência(s)'+(cl.wait.length?' • <b>'+cl.wait.length+'</b> aguardando o fim da operação':'')+
    '<details><summary>Ver itens conferidos e aguardando</summary><ul class="cklist">'+li(cl.ok,'✓')+li(cl.wait,'⏳')+'</ul></details></div>';
}

// 4) Mudanças desde a análise anterior do mesmo navio (guardado no navegador)
const HIST_KEY='sofHistory'; let loadCounter=0, diffLoad=-1, diffState=null;
const unesc=t=>String(t||'').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const titleOf=h=>unesc((h.match(/issue-title">([^<]*)/)||[])[1]);
function loadHist(){try{return JSON.parse(localStorage.getItem(HIST_KEY)||'{}')}catch(e){return {}}}
function computeDiff(all){
  const key=(rows[0]&&rows[0].sheet)||fileLabel||'sof';
  const cur=all.map(h=>({h:keyOf(h),t:titleOf(h)})).filter(x=>!/^Verificação ortográfica/.test(x.t));
  const H=loadHist(), prev=H[key]; let diff=null;
  if(prev){
    const ps=new Set(prev.items.map(x=>x.h)), cs=new Set(cur.map(x=>x.h));
    diff={at:prev.at,newSet:new Set(cur.filter(x=>!ps.has(x.h)).map(x=>x.h)),resolved:prev.items.filter(x=>!cs.has(x.h)).map(x=>x.t),persist:cur.filter(x=>ps.has(x.h)).length};
  }
  H[key]={at:Date.now(),items:cur};
  const keys=Object.keys(H).sort((a,b)=>H[b].at-H[a].at); keys.slice(30).forEach(k=>delete H[k]);
  try{localStorage.setItem(HIST_KEY,JSON.stringify(H))}catch(e){}
  return diff;
}
function showDiff(){
  const el=$('diffInfo'); if(!diffState){el.classList.add('hidden');return}
  const d=diffState, when=new Date(d.at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  el.innerHTML='Desde a análise anterior deste navio ('+when+'): <b>'+d.newSet.size+'</b> nova(s) • <b>'+d.resolved.length+'</b> resolvida(s) • <b>'+d.persist+'</b> continua(m).'+
    (d.resolved.length?'<details><summary>Ver resolvidas</summary><ul>'+d.resolved.slice(0,30).map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul></details>':'');
  el.classList.remove('hidden');
}

// ===== Auditoria do modelo (modo separado) =====
const colNum=t=>[...t].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0);
function relForm(f,r,c){
  return String(f).replace(/'[^']*'!/g,'S!').replace(/"[^"]*"/g,'"s"')
    .replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g,(m,d1,col,d2,row)=>(d1?'C'+colNum(col):'C['+(colNum(col)-1-c)+']')+(d2?'R#':'R['+(+row-1-r)+']')); // linha absoluta ($P$38): cada bloco pode ter a sua célula de fator, então não conta como diferença
}
const normVessel=t=>String(t||'').toUpperCase().replace(/^\s*(M\/?V|M\.V\.)\s+/,'').replace(/[^A-Z0-9]/g,'');
const COMMON_TYPOS=[[/bill\s+of\s+landing/i,'Bill of Lading'],[/responsability/i,'Responsibility']];
function auditWorkbook(wb,sofName){
  const items=[], meta=(wb.Workbook&&wb.Workbook.Sheets)||[];
  const isHid=n=>{const i=wb.SheetNames.indexOf(n);return !!(meta[i]&&meta[i].Hidden)};
  const sheets=wb.SheetNames.map(n=>({n,ws:wb.Sheets[n],hid:isHid(n)})).filter(x=>x.ws);
  const cellsOf=ws=>{const a=[];for(const k in ws){if(k[0]==='!')continue;const c=ws[k];if(c&&c.v!==undefined&&c.v!==null&&c.v!=='')a.push({k,c,a:XLSX.utils.decode_cell(k)})}return a};
  const cache=new Map(); const cells=s=>{if(!cache.has(s.n))cache.set(s.n,cellsOf(s.ws));return cache.get(s.n)};
  const txt=x=>typeof x.c.v==='string'?x.c.v:'';
  const rightOf=(cs,lab)=>cs.filter(x=>x.a.r===lab.a.r&&x.a.c>lab.a.c&&x.a.c<=lab.a.c+3&&txt(x).trim()&&!/:\s*$/.test(txt(x))).sort((p,q)=>p.a.c-q.a.c)[0];
  const vesselOf=cs=>{const lab=cs.find(x=>/^\s*vessel(\s+name)?\s*:?\s*$/i.test(txt(x))); const v=lab&&rightOf(cs,lab); return v?txt(v).trim():null};
  const titleVessel=cs=>{const t=cs.find(x=>/^\s*daily report\s*-\s*\S+/i.test(txt(x))); return t?txt(t).replace(/^\s*daily report\s*-\s*/i,'').trim():null};
  const sof=sheets.find(s=>s.n===sofName), sofVessel=sof?vesselOf(cells(sof)):null;
  const vis=sheets.filter(s=>!s.hid), hid=sheets.filter(s=>s.hid);
  const summary='<div class="ckinfo"><b>Abas visíveis:</b> '+esc(vis.map(s=>s.n).join(', ')||'—')+'<br><b>Abas ocultas:</b> '+esc(hid.map(s=>s.n).join(', ')||'nenhuma')+(sofVessel?'<br><b>Navio do SOF:</b> '+esc(sofVessel):'')+'</div>';

  // 1) abas ocultas com dados de outro navio
  hid.forEach(s=>{
    const cs=cells(s), names=[vesselOf(cs),titleVessel(cs)].filter(Boolean);
    const other=names.filter(n=>sofVessel&&normVessel(n)&&normVessel(n)!==normVessel(sofVessel));
    if(other.length)items.push(issue('Aba oculta com dados de outro navio: "'+s.n+'"',[
      ['Aba',s.n+' (oculta)'],['Navio encontrado',other.join(' / ')],['Navio do SOF',sofVessel]
    ],'Limpar ou excluir a aba oculta, para que dados antigos não sejam usados por engano.','ALTO'));
  });

  // 2) fórmulas que apontam para outra aba (inexistente ou oculta, em vez da aba do SOF)
  const refs=new Map();
  sheets.forEach(s=>cells(s).forEach(x=>{
    if(!x.c.f)return; const f=String(x.c.f), re=/(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!/g; let m;
    if(/#REF!/i.test(f)){const e=refs.get(s.n+'|#REF')||{n:0,ex:x.k,src:s.n,t:'#REF!'};e.n++;refs.set(s.n+'|#REF',e)}
    while((m=re.exec(f))){const t=(m[1]||m[2]).replace(/''/g,"'"); if(t===s.n)continue;
      const e=refs.get(s.n+'|'+t)||{n:0,ex:x.k,src:s.n,t}; e.n++; refs.set(s.n+'|'+t,e)}
  }));
  refs.forEach(e=>{
    let msg=null;
    if(e.t==='#REF!')msg='contém referência quebrada (#REF!)';
    else if(!wb.SheetNames.includes(e.t))msg='aponta para a aba "'+e.t+'", que não existe';
    else if(isHid(e.t)&&sofName&&e.t!==sofName)msg='aponta para a aba oculta "'+e.t+'", e não para a aba do SOF ("'+sofName+'")';
    if(msg)items.push(issue('Fórmulas apontando para a aba errada em "'+e.src+'"',[
      ['Aba',e.src],['Fórmulas',e.n+' (primeira em '+e.ex+')'],['Problema','A fórmula '+msg+'.']
    ],'Ajustar as fórmulas para a aba do SOF, ou remover a aba se não for mais usada.','ALTO'));
  });

  // 3) fórmulas diferentes dentro de uma sequência da mesma coluna
  sheets.forEach(s=>{
    const byCol=new Map(), flagged=[];
    cells(s).forEach(x=>{if(!x.c.f)return; const l=byCol.get(x.a.c)||[]; l.push({r:x.a.r,k:x.k,f:String(x.c.f),p:relForm(x.c.f,x.a.r,x.a.c)}); byCol.set(x.a.c,l)});
    byCol.forEach(list=>{
      list.sort((a,b)=>a.r-b.r); let run=[];
      const flush=()=>{
        if(run.length>=4){
          const cnt=new Map(); run.forEach(x=>cnt.set(x.p,(cnt.get(x.p)||0)+1));
          const [maj,n]=[...cnt.entries()].sort((a,b)=>b[1]-a[1])[0];
          if(n>=3&&n/run.length>=0.6)run.filter(x=>x.p!==maj&&!/^\s*(IFERROR\()?(SUM|SUMIF|SUMIFS|SUBTOTAL|AVERAGE|COUNT\w*)\(/i.test(x.f)).forEach(x=>{const ex=run.find(y=>y.p===maj); if(ex.f!==x.f)flagged.push({x,ex})});
        } run=[];
      };
      list.forEach(x=>{if(run.length&&x.r!==run[run.length-1].r+1)flush(); run.push(x)}); flush();
    });
    if(flagged.length)items.push(issue('Fórmula diferente das vizinhas em "'+s.n+(s.hid?' (oculta)':'')+'"',
      flagged.slice(0,8).map(g=>['Célula '+g.x.k,'='+g.x.f+'   (vizinhas: ='+g.ex.f+')']),
      'Conferir se a diferença é intencional. Fórmulas iguais na coluna costumam ter o mesmo formato.','ATENÇÃO'));
  });

  // 4) dados fora da área de impressão e formatação excessiva (abas visíveis)
  vis.forEach(s=>{
    const pa=printArea(wb,s.n), cs=cells(s);
    if(pa){
      const out=cs.filter(x=>x.a.r<pa.s.r||x.a.r>pa.e.r||x.a.c<pa.s.c||x.a.c>pa.e.c);
      if(out.length)items.push(issue('Dados fora da área de impressão em "'+s.n+'"',[
        ['Células',out.slice(0,8).map(x=>x.k+' ('+String(x.c.v).slice(0,20)+')').join(', ')+(out.length>8?' …':'')],['Quantidade',String(out.length)]
      ],'Conferir se são cálculos de apoio feitos de propósito. Se sobraram de testes, apagar.','ATENÇÃO'));
    }
    const ref=s.ws['!ref'];
    if(ref){const rg=XLSX.utils.decode_range(ref), used=cs.reduce((m,x)=>Math.max(m,x.a.r),0);
      if(rg.e.r>5000&&used<2000)items.push(issue('Formatação até a linha '+(rg.e.r+1)+' em "'+s.n+'"',[
        ['Última linha com dados',String(used+1)],['Última linha formatada',String(rg.e.r+1)]
      ],'Apagar as linhas em branco abaixo dos dados deixa o arquivo mais leve e rápido de abrir.','ATENÇÃO'))}
  });

  // 5) campos de modelo sem preencher e nome do navio no Stowage Plan
  vis.forEach(s=>cells(s).filter(x=>/^\s*vessel name\s*$/i.test(txt(x))).forEach(x=>items.push(issue('Campo de modelo sem preencher em "'+s.n+'"',[
    ['Célula',x.k],['Texto','"'+txt(x).trim()+'"']],'Substituir pelo nome do navio.','ALTO'))));
  if(sofVessel)vis.filter(s=>/stowage/i.test(s.n)).forEach(s=>{
    const cs=cells(s), names=[];
    const top=cs.filter(x=>x.a.r<=4&&txt(x).trim()&&!/stowage|cargo plan|description|total|date/i.test(txt(x))).sort((p,q)=>p.a.r-q.a.r||p.a.c-q.a.c)[0]; if(top)names.push(txt(top).trim());
    const lab=cs.find(x=>/chief officer\s*\/\s*master/i.test(txt(x)));
    if(lab){const b=cs.find(x=>x.a.r===lab.a.r+1&&x.a.c===lab.a.c&&txt(x).trim()); if(b)names.push(txt(b).trim())}
    const bad=names.filter(n=>normVessel(n)!==normVessel(sofVessel));
    if(bad.length)items.push(issue('Nome do navio diferente no Stowage Plan: "'+s.n+'"',[['No plano',bad.join(' / ')],['No SOF',sofVessel]],'Corrigir o nome do navio no plano.','ALTO'));
  });

  // 6) erros comuns de grafia nos rótulos do modelo (e dicionário nos títulos de coluna, se carregado)
  const seen=new Set(), gloss=getGloss();
  sheets.forEach(s=>cells(s).forEach(x=>{
    const t=txt(x); if(!t||t.length>140)return;
    COMMON_TYPOS.forEach(([rx,fix])=>{const m=t.match(rx); if(m&&!seen.has(s.n+x.k)){seen.add(s.n+x.k);
      items.push(issue('Rótulo com erro de grafia: "'+m[0]+'"',[['Aba',s.n+(s.hid?' (oculta)':'')],['Célula',x.k],['Texto',t.trim().slice(0,80)],['Sugestão',fix]],'Corrigir o rótulo no modelo.','REVISAR'))}});
  }));
  if(dictState==='ok'&&sof&&colInfo&&colInfo.hdr>=0){
    const unk=new Map();
    cells(sof).filter(x=>x.a.r===colInfo.hdr||(x.a.r<colInfo.hdr&&/:\s*$/.test(txt(x)))).forEach(x=>{
      (txt(x).match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)||[]).forEach(raw=>{
        const w=raw.replace(/['’]s$/i,''); if(w.length<3||/['’]/.test(w)||(w===w.toUpperCase()&&w.length<=5))return;
        if(gloss.has(w.toLowerCase())||typo.check(w))return; if(!unk.has(w.toLowerCase()))unk.set(w.toLowerCase(),{w,k:x.k})});
    });
    unk.forEach(u=>items.push(issue('Rótulo possivelmente com erro de grafia: "'+u.w+'"',[['Aba',sof.n],['Célula',u.k]],'Conferir a grafia no modelo.','REVISAR')));
  }
  return {summary,items};
}
async function runAudit(){
  const body=$('auditBody'); $('auditModal').classList.remove('hidden');
  body.innerHTML='<div class="meta" style="padding:12px 0">Lendo todas as abas do arquivo (inclusive as ocultas)...</div>'; await tick();
  try{
    if(!lastData)throw new Error('nenhum arquivo carregado');
    const wb=XLSX.read(lastData,{type:'array',cellFormula:true,cellDates:false});
    const res=auditWorkbook(wb,rows[0]&&rows[0].sheet);
    body.innerHTML=res.summary+(res.items.length?res.items.join(''):empty('Nenhum problema encontrado no modelo.'));
  }catch(e){body.innerHTML='<div class="empty" style="color:#b42318">Não foi possível auditar o arquivo: '+esc(e.message)+'</div>'}
}

// Cada verificação roda isolada: se uma falhar, as outras continuam e a falha aparece em Anomalias
let ruleFails=[];
function safe(name,fn,fallback){
  try{return fn()}
  catch(e){ruleFails.push({name,msg:(e&&e.message)||String(e)});console.error('Verificação falhou: '+name,e);return fallback}
}
function failIssues(){
  return ruleFails.map(f=>issue('Verificação não concluída: '+f.name,[['Detalhe técnico',f.msg]],
    'Erro interno nesta verificação (as demais rodaram). Conferir este ponto manualmente e informar o arquivo para correção.','ATENÇÃO'));
}

function analyze(opts){
  try{analyzeCore(opts)}
  catch(e){console.error(e);status('Erro inesperado na análise: '+((e&&e.message)||e)+'. Recarregue a página e tente novamente.','error')}
}
function analyzeCore(opts){
  const tA=performance.now();
  const errors=[],alerts=[],english=[], all=rows;
  ruleFails=[];

  // 1 e 2. Horários impossíveis e períodos fora do padrão
  safe('Horários',()=>all.forEach(r=>{
    const tp=timePairs(r);
    if(tp.length<2)return;
    const a=tp[0],b=tp[1], endOp=operationalEndMinutes(a.min,b.min), label=periodLabel(a.min,b.min);
    if(endOp!==null&&endOp<a.min){
      errors.push(issue('Horário impossível',[['Linha',ond(r.sheet,r.row)],['Data',r.operationalDate||'—'],['Registro',a.time+' → '+b.time]],
        'O término não fecha no relógio de 24h. Conferir o horário original.','CRÍTICO',{k:'h-imp',t:'Horários impossíveis',c:['Linha','Data','Registro'],v:[ond(r.sheet,r.row),r.operationalDate||'—',a.time+' → '+b.time]}));
    }else if(label==='fora do padrão / requer conferência'){
      alerts.push(issue('Horário fora do padrão dos períodos de estiva',[['Linha',ond(r.sheet,r.row)],['Data',r.operationalDate||'—'],['Registro',a.time+' → '+b.time]],
        'Não cabe em 07x13, 13x19, 19x01 ou 01x07. Conferir o período e as linhas vizinhas.','',{k:'h-pad',t:'Horários fora dos períodos de estiva',c:['Linha','Data','Registro'],v:[ond(r.sheet,r.row),r.operationalDate||'—',a.time+' → '+b.time]}));
    }
  }));

  // 3. Duplicados (data + bloco + conteúdo)
  const seen=new Map();
  safe('Registros duplicados',()=>all.forEach(r=>{
    if(rowText(r).length<10||r.isPeriodTotal||r.isGrandTotal||r.prodOnly||r.textOnly)return;
    const sig=(r.operationalDate+'|P:'+r.periodBlock+'|'+rowText(r)).toLowerCase();
    if(seen.has(sig)){
      const prev=seen.get(sig);
      const comProd=(r.w||r.vol);
      errors.push(issue(comProd?'Linha duplicada (produção somada duas vezes)':'Registro potencialmente duplicado',[['Linhas',ond(r.sheet,prev.row+' e '+r.row)],['Data',r.operationalDate||'—']].concat(comProd?[['Peso',r.w?fmtN(r.w):'-'],['Volumes',r.vol?fmtN(r.vol):'-']]:[]),
        comProd?'As duas linhas são iguais, inclusive a produção: o total fica somado em dobro. Apagar a repetida e conferir os totais.':'Linhas idênticas no mesmo período. Se forem o mesmo evento, remover uma.',comProd?'CRÍTICO':'ALTO',{k:'dup',t:'Registros potencialmente duplicados',c:['Linhas','Data'],v:[ond(r.sheet,prev.row+' e '+r.row),r.operationalDate||'—']}));
    }else seen.set(sig,r);
  }));

  // 4. #REF!
  safe('Fórmulas (#REF!)',()=>all.forEach(r=>{
    if(r.values.some(v=>String(v).includes('#REF!')))errors.push(issue('Referência de fórmula quebrada (#REF!)',[['Linha',ond(r.sheet,r.row)]],
      'Restaurar a fórmula e recalcular os totais.','CRÍTICO',{k:'ref',t:'Referências de fórmula quebradas (#REF!)',c:['Linha'],v:[ond(r.sheet,r.row)]}));
  }));

  // 5. Datas e demais verificações
  safe('Datas',()=>checkDates(errors,alerts));
  safe('Marcos do navio',()=>checkMilestones(errors));
  safe('Produção em linha paralisada',()=>checkStopProduction(errors));
  safe('Períodos por data',()=>checkCycles(errors));
  safe('Equipes (Gang)',()=>checkGangs(errors));
  safe('Cabeçalho',()=>checkHeader(errors,alerts));
  safe('Cabeçalho × operação',()=>checkHeaderOp(errors,all));
  safe('Erros grotescos',()=>checkGrotescos(errors,alerts,all));
  /* o que o revisor NÃO conseguiu conferir (para não parecer que está tudo certo) */
  safe('Cobertura da revisão',()=>{const falta=[];
    if(!colInfo||colInfo.hdr===undefined||colInfo.hdr<0)falta.push(['Tabela de eventos','não achei a linha de títulos com FROM e TO']);
    else{if(colInfo.w===undefined)falta.push(['Peso','coluna WEIGHT/PESO não encontrada: somatórias e produtividade não conferidas']);
      if(colInfo.vol===undefined)falta.push(['Volumes','coluna VOLUMES não encontrada: somatórias não conferidas']);
      if(colInfo.g===undefined)falta.push(['Equipes','coluna GANG não encontrada: conflitos de equipe não conferidos']);
      if(colInfo.dt===undefined&&colInfo.ord)falta.push(['Datas','coluna DATE não encontrada'])}
    if(!all.some(r=>parseDateValue(r.operationalDate)))falta.push(['Datas','nenhuma data reconhecida na tabela: cronologia e estadia não conferidas']);
    if(!all.some(r=>timePairs(r).length>=2))falta.push(['Horários','nenhum horário de início e fim reconhecido']);
    if(!hdrInfo)falta.push(['Cabeçalho','não reconheci o cabeçalho (Arrival, Pilot on board...): marcos e tipo de operação não conferidos']);
    if(falta.length)errors.unshift(issue('Revisão incompleta: '+falta.length+' parte(s) do SOF não foram conferidas',falta,'O resultado não cobre essas partes. Confira-as manualmente ou verifique se o modelo da planilha mudou.','ATENÇÃO'));
  });
  safe('Draft survey',()=>checkSurveys(errors));
  const planoRaw=[];
  safe('Plano de Carga (Stowage Plan)',()=>checkStowage(planoRaw));
  safe('Padronização do texto',()=>checkTextStyle(english,alerts));

  // 6. Inglês: "Loading" em descarga — contexto exclui as próprias linhas "commenced"
  safe('Redação (Loading/Discharging)',()=>{
  const others=all.filter(r=>!/loading operation commenced/i.test(rowText(r))).map(rowText).join(' ');
  const isDischarge=/discharg/i.test(others)&&!/\bloading\b|\bloaded\b/i.test(others);
  all.forEach(r=>{
    const t=rowText(r);
    if(isDischarge&&/loading operation commenced/i.test(t))english.push(issue('Possível uso de “Loading” em operação de descarga',[['Linha',ond(r.sheet,r.row)]],
      'O restante do SOF fala só em descarga. Usar “Discharging operation commenced.”','REVISAR'));
    if(/adjusting equipment\.\./i.test(t))english.push(issue('Pontuação/redação inadequada',[['Linha',ond(r.sheet,r.row)],['Texto',t]],
      'Preferir “Not worked due to equipment adjustment.”','REVISAR'));
  });
  });

  safe('Ortografia',()=>checkSpelling(english));

  // 8. Awaiting invoice
  safe('Motivos a esclarecer',()=>all.forEach(r=>{
    if(/awaiting invoice/i.test(rowText(r)))alerts.push(issue('Motivo “awaiting invoice” requer esclarecimento',[['Linha',ond(r.sheet,r.row)],['Registro',findCellText(r,/awaiting invoice/i)]],
      'Informar qual documento estava pendente.','',{k:'inv',t:'Motivos “awaiting invoice” a esclarecer',c:['Linha','Registro'],v:[ond(r.sheet,r.row),findCellText(r,/awaiting invoice/i)]}));
  }));

  const volRaw=[], pesoRaw=[];
  safe('Somatórias de volumes e peso',()=>checkVW(volRaw,pesoRaw));
  safe('Volumes com casas decimais',()=>checkFractionalVolumes(volRaw));
  const cl=safe('Pendências',()=>buildChecklist(),{ok:[],wait:[],pend:[]});
  lastRaw={anom:failIssues().concat(errors,alerts),eng:english.slice(),vol:volRaw,peso:pesoRaw,plano:planoRaw,pend:cl.pend,cl};
  loadIgn();
  if(!(opts&&opts.noScroll)&&diffLoad!==loadCounter){ // compara só na 1ª análise de cada arquivo carregado
    diffState=computeDiff(lastRaw.anom.concat(lastRaw.eng,lastRaw.vol,lastRaw.peso,lastRaw.plano,lastRaw.pend)); diffLoad=loadCounter;
  }
  showResults(opts,tA);
}

// Aplica as ocorrências marcadas como "Corrigido" e desenha o resultado
function showResults(opts,tA){
  const anomalias=applyFixed(lastRaw.anom), eng=applyFixed(lastRaw.eng), volIssues=applyFixed(lastRaw.vol), pesoIssues=applyFixed(lastRaw.peso), pend=applyFixed(lastRaw.pend);
  const raws=lastRaw.anom.concat(lastRaw.eng,lastRaw.vol,lastRaw.peso,lastRaw.plano,lastRaw.pend);
  const hidden=raws.filter(h=>!ign.has(keyOf(h))&&fixed.has(keyOf(h))).length;
  showIgnored(raws.filter(h=>ign.has(keyOf(h))));
  showDiff();
  $('fixedN').textContent=hidden; $('fixedInfo').classList.toggle('hidden',hidden===0);
  render('anomalias',anomalias,'nAnomalias','Nenhuma anomalia detectada.',groupAnomalias);
  render('english',eng,'nEnglish','Nenhum erro de ortografia identificado.');
  const vn=colInfo&&colInfo.t!==undefined?(colInfo.vol!==undefined?'Volumes / Carretas':'Carretas'):'Volumes';
  $('lblVol').textContent=vn; $('lblVolPanel').textContent=vn;
  render('volumes',volIssues,'nVolumes','As somatórias de '+vn.toLowerCase()+' conferem.');
  render('peso',pesoIssues,'nPeso','As somatórias de peso conferem.');
  const plano=applyFixed(lastRaw.plano), hasPlan=stowPlans.length>0;
  render('plano',plano,'nPlano',hasPlan?'Tabela e Stowage Plan conferem.':'Nenhum Stowage Plan encontrado no arquivo.');
  if(!hasPlan){$('nPlano').textContent='—';$('nPlano').closest('.stat').classList.remove('ok')}
  $('planoSub').textContent=hasPlan?'divergências com a tabela':'plano não encontrado';
  render('pend',pend,'nPend','Nenhuma pendência para liberar.');
  $('pendBody').innerHTML=checklistHtml(lastRaw.cl,pend.length)+$('pendBody').innerHTML;
  const total=anomalias.length+eng.length+volIssues.length+pesoIssues.length+plano.length+pend.length;
  lastTotal=total;
  $('nOk').textContent=total?'CONFERIR':'OK';
  const sc=$('nOk').closest('.stat');
  sc.classList.toggle('alert',total>0); sc.classList.toggle('ok',total===0);
  $('nOk').style.color='';
  $('resultIntro').innerHTML=total
    ?'<strong>Foram encontradas ocorrências que exigem conferência antes da liberação do SOF.</strong>'
    :'<strong>Nenhuma ocorrência detectada pelas regras atuais.</strong>';
  const counts={anomalias:anomalias.length,english:eng.length,volumes:volIssues.length,peso:pesoIssues.length,plano:plano.length,pend:pend.length};
  if(!(opts&&opts.noScroll)||!activeTab)setTab(Object.keys(counts).find(k=>counts[k]>0)||'all');
  updateBar(counts,vn,total);
  if(tA!==undefined)$('timing').textContent='Leitura do arquivo: '+fmtMs(loadMs)+'  •  Análise: '+fmtMs(performance.now()-tA);
  $('results').classList.remove('hidden');
  if(!(opts&&opts.noScroll))window.scrollTo({top:$('results').offsetTop-20,behavior:'smooth'});
}
// Agrupamento das anomalias por tipo
const GROUPS=[
  ['Verificações não concluídas',/^Verificação não concluída/],
  ['Horários',/^Horário impossível|^Horário fora do padrão/],
  ['Datas',/^Data muito distante|^Datas fora de ordem|^Salto de|^Data no futuro|^Período fora de ordem/],
  ['Marcos do navio',/^Marcos do navio/],
  ['Equipes (Gang)',/^Equipe /],
  ['Cabeçalho',/^Cabeçalho/],
  ['Preenchimento',/^Células vazias/],
  ['Registros duplicados',/duplicado/],
  ['Produção em linha paralisada',/^Produção lançada em linha paralisada/],
  ['Fórmulas',/^Referência de fórmula/],
  ['Motivos a esclarecer',/requer esclarecimento/]
];
function groupAnomalias(items){
  const buckets=GROUPS.map(g=>({name:g[0],list:[]})), other={name:'Outros',list:[]};
  items.forEach(h=>{
    const title=(h.match(/issue-title">([^<]*)/)||[])[1]||'';
    (buckets.find((b,i)=>GROUPS[i][1].test(title))||other).list.push(h);
  });
  return buckets.concat(other).filter(b=>b.list.length)
    .map(b=>'<details class="group" open><summary>'+esc(b.name)+'<span class="count">'+b.list.length+'</span></summary>'+tableGroup(b.list).join('')+'</details>').join('');
}
function render(section,items,countId,emptyMsg,grouper){
  $(countId).textContent=items.length;
  const card=$(countId).closest('.stat');
  card.classList.toggle('ok',items.length===0);
  if(card.hasAttribute('data-alert'))card.classList.toggle('alert',items.length>0);
  $(section+'Body').innerHTML=items.length?(grouper?grouper(items):tableGroup(items).join('')):empty(emptyMsg);
}
// ===== Ocorrências marcadas como "Corrigido" =====
const fixed=new Set(); let lastRaw=null;
const ign=new Map(); const IGN_KEY='sofIgnored'; // ocorrências ignoradas: ficam guardadas por navio neste navegador
const ignKey=()=>(rows[0]&&rows[0].sheet)||fileLabel||'sof';
function loadIgn(){ign.clear(); try{const H=JSON.parse(localStorage.getItem(IGN_KEY)||'{}'); (H[ignKey()]||[]).forEach(x=>ign.set(x.h,x.t))}catch(e){}}
function saveIgn(){try{const H=JSON.parse(localStorage.getItem(IGN_KEY)||'{}'); delete H[ignKey()]; H[ignKey()]=[...ign.entries()].map(([h,t])=>({h,t})).slice(-300);
  const ks=Object.keys(H); while(ks.length>30)delete H[ks.shift()]; localStorage.setItem(IGN_KEY,JSON.stringify(H))}catch(e){}}
function ignoreIssue(k,t){ign.set(k,t);saveIgn()}
function unignoreIssue(k){ign.delete(k);saveIgn()}
function showIgnored(list){
  const el=$('ignInfo'); if(!list.length){el.classList.add('hidden');return}
  el.innerHTML='<b>'+list.length+'</b> ocorrência(s) ignorada(s) neste navio (a decisão fica guardada neste navegador). <details><summary>Ver ignoradas</summary><ul class="ignlist">'+
    list.map(h=>'<li>'+esc(titleOf(h))+' <button class="linkbtn unignBtn" data-key="'+keyOf(h)+'">Voltar a mostrar</button></li>').join('')+
    '</ul><button class="linkbtn" id="ignClear">Voltar a mostrar todas</button></details>';
  el.classList.remove('hidden');
}
function hashStr(t){let h=5381;for(let i=0;i<t.length;i++)h=((h<<5)+h+t.charCodeAt(i))|0;return (h>>>0).toString(36)+t.length.toString(36)}
function applyFixed(list){
  return list.filter(h=>!fixed.has(keyOf(h))&&!ign.has(keyOf(h))).map(h=>{
    const k=keyOf(h); let x=h;
    if(diffState&&diffState.newSet.has(k))x=x.replace('<!--NEW-->','<span class="badge new">NOVO</span>');
    return x.replace('<!--BTN-->','<button class="fixBtn" data-key="'+k+'" title="Já foi corrigido no SOF: tirar da lista">✓ Corrigido</button><button class="ignBtn" data-key="'+k+'" title="Não é um problema: não mostrar de novo neste navio">Ignorar</button>');
  });
}
const allRaw=()=>lastRaw?lastRaw.anom.concat(lastRaw.eng,lastRaw.vol,lastRaw.peso,lastRaw.plano,lastRaw.pend):[];
document.addEventListener('click',e=>{
  const t=e.target.closest?e.target:null; if(!t||!lastRaw)return;
  const fx=t.closest('.fixBtn'), ig=t.closest('.ignBtn'), un=t.closest('.unignBtn'), clr=t.closest('#ignClear');
  if(fx){fixed.add(fx.dataset.key);showResults({noScroll:true})}
  else if(ig){const h=allRaw().find(x=>keyOf(x)===ig.dataset.key); ignoreIssue(ig.dataset.key,h?titleOf(h):''); showResults({noScroll:true})}
  else if(un){unignoreIssue(un.dataset.key); showResults({noScroll:true})}
  else if(clr){ign.clear(); saveIgn(); showResults({noScroll:true})}
});
$('fixedUndo').addEventListener('click',()=>{fixed.clear(); if(lastRaw)showResults({noScroll:true})});
$('file').addEventListener('change',()=>{fixed.clear();lastRaw=null;loadCounter++;diffState=null;$('auditBtn').disabled=true;$('ignInfo').classList.add('hidden')});
$('clearBtn').addEventListener('click',()=>{fixed.clear();lastRaw=null;$('auditBtn').disabled=true;$('ignInfo').classList.add('hidden')});

// ===== Abas por categoria, barra fixa e arrastar e soltar =====
let activeTab='', summaryInView=true;
function setTab(t){
  activeTab=t;
  document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===t));
  document.querySelectorAll('.panel[data-panel]').forEach(p=>p.classList.toggle('hidden',t!=='all'&&p.dataset.panel!==t));
}
function refreshBar(){$('sbar').classList.toggle('show',!summaryInView&&!$('results').classList.contains('hidden'))}
function updateBar(c,vn,total){
  $('sbStatus').textContent='Status: '+(total?'CONFERIR':'OK');
  $('sbStatus').classList.toggle('bad',!!total); $('sbStatus').classList.toggle('good',!total);
  [['sbA',c.anomalias],['sbE',c.english],['sbV',c.volumes],['sbP',c.peso],['sbPl',c.plano],['sbPd',c.pend]].forEach(([id,n])=>{
    $(id).textContent=n; const chip=$(id).closest('.chip');
    chip.classList.toggle('bad',n>0); chip.classList.toggle('good',n===0);
  });
  $('sbVL').textContent=vn;
}
document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>{
  setTab(el.dataset.tab);
  if(el.classList.contains('chip'))$('tabHint').scrollIntoView({behavior:'smooth',block:'start'});
}));
$('sbTop').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
if('IntersectionObserver' in window)new IntersectionObserver(es=>{summaryInView=es[0].isIntersecting;refreshBar()}).observe($('summaryBox'));
$('file').addEventListener('change',()=>setTimeout(refreshBar,0));
$('clearBtn').addEventListener('click',()=>setTimeout(refreshBar,0));

const drop=$('drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')}));
drop.addEventListener('dragleave',e=>{if(!drop.contains(e.relatedTarget))drop.classList.remove('over')});
drop.addEventListener('drop',e=>{
  e.preventDefault(); drop.classList.remove('over');
  const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(!f)return;
  if(!/\.xlsx?$/i.test(f.name)){status('Formato não suportado. Envie uma planilha .xlsx ou .xls.','error');return}
  try{$('file').files=e.dataTransfer.files}catch(err){}
  $('file').dispatchEvent(new Event('change'));
});
['dragover','drop'].forEach(ev=>window.addEventListener(ev,e=>e.preventDefault())); // não deixa o navegador abrir o arquivo

$('analyzeBtn').addEventListener('click',()=>analyze());
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('.addGloss'); if(!b)return;
  addGloss(b.dataset.word); analyze({noScroll:true});
});
// ===== Menu do glossário =====
function renderGloss(){
  const a=userGloss(), q=($('glossSearch').value||'').trim().toLowerCase();
  $('glossN').textContent=a.length;
  const items=a.map((w,i)=>({w,i})).filter(x=>!q||x.w.includes(q)).sort((x,y)=>x.w.localeCompare(y.w));
  $('glossList').innerHTML=items.length
    ?items.map(x=>'<div class="gl-row" data-i="'+x.i+'"><span class="gl-word">'+esc(x.w)+'</span><button class="gl-edit">Editar</button><button class="gl-del">Excluir</button></div>').join('')
    :'<div class="meta" style="padding:12px 0">'+(a.length?'Nenhuma palavra encontrada.':'Nenhuma palavra adicionada ainda.')+'</div>';
}
function glossChanged(){
  renderGloss();
  if(!$('results').classList.contains('hidden')&&rows.length)analyze({noScroll:true});
}
const cleanWord=w=>String(w).trim().toLowerCase().replace(/\s+/g,'');
function glossOpen(){$('glossModal').classList.remove('hidden');listMsg('');renderGloss();$('glossInput').focus()}
function glossClose(){$('glossModal').classList.add('hidden')}
function glossAddManual(){
  const words=$('glossInput').value.split(/[\s,;]+/).map(cleanWord).filter(Boolean);
  if(!words.length)return;
  const a=userGloss().slice(); words.forEach(w=>{if(!a.includes(w))a.push(w)});
  saveGloss(a); $('glossInput').value=''; glossChanged();
}
$('glossBtn').addEventListener('click',glossOpen);
$('glossClose').addEventListener('click',glossClose);
$('glossModal').addEventListener('click',e=>{if(e.target===$('glossModal'))glossClose()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){glossClose();$('auditModal').classList.add('hidden')}});
$('auditBtn').addEventListener('click',runAudit);
$('auditClose').addEventListener('click',()=>$('auditModal').classList.add('hidden'));
$('auditModal').addEventListener('click',e=>{if(e.target===$('auditModal'))$('auditModal').classList.add('hidden')});
$('glossAdd').addEventListener('click',glossAddManual);
$('glossInput').addEventListener('keydown',e=>{if(e.key==='Enter')glossAddManual()});
$('glossSearch').addEventListener('input',renderGloss);
$('glossList').addEventListener('click',e=>{
  const btn=e.target.closest('button'); if(!btn)return;
  const row=btn.closest('.gl-row'), i=Number(row.dataset.i), a=userGloss().slice();
  if(btn.classList.contains('gl-del')){a.splice(i,1);saveGloss(a);glossChanged()}
  else if(btn.classList.contains('gl-edit')){
    row.innerHTML='<input type="text" class="gl-input" value="'+esc(a[i])+'"><button class="gl-save">Salvar</button><button class="gl-cancel">Cancelar</button>';
    row.querySelector('input').focus();
  }else if(btn.classList.contains('gl-cancel'))renderGloss();
  else if(btn.classList.contains('gl-save')){
    const w=cleanWord(row.querySelector('input').value); if(!w)return;
    a[i]=w; saveGloss(a.filter((x,j)=>a.indexOf(x)===j)); glossChanged();
  }
});
$('glossList').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.classList.contains('gl-input'))e.target.closest('.gl-row').querySelector('.gl-save').click();
});
// ===== Listas da equipe: salvar e carregar glossário + ignoradas =====
const LIST_TYPE='sof-reviewer-listas';
function listMsg(t,type){const m=$('listMsg');m.textContent=t;m.className=type||''}
function readIgnAll(){try{const H=JSON.parse(localStorage.getItem(IGN_KEY)||'{}');return H&&typeof H==='object'&&!Array.isArray(H)?H:{}}catch(e){return {}}}
function exportLists(){
  const ignAll=readIgnAll(), nIgn=Object.values(ignAll).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);
  const data={tipo:LIST_TYPE,versao:1,geradoEm:new Date().toISOString(),glossario:userGloss().slice().sort(),ignoradas:ignAll};
  const d=new Date(), name='sof-reviewer-listas-'+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'.json';
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  listMsg('Arquivo salvo: '+name+' ('+data.glossario.length+' palavra(s) no glossário e '+nIgn+' ocorrência(s) ignorada(s)).','ok');
}
async function importLists(file){
  let data;
  try{data=JSON.parse(await file.text())}catch(e){data=null}
  if(!data||data.tipo!==LIST_TYPE||!Array.isArray(data.glossario)||typeof data.ignoradas!=='object'||data.ignoradas===null){
    listMsg('Arquivo não reconhecido. Use um arquivo salvo pelo botão "Salvar listas".','error');return;
  }
  // glossário: soma as palavras novas
  const a=userGloss().slice(); let nW=0;
  data.glossario.forEach(w=>{w=cleanWord(w);if(w&&w.length<=60&&!a.includes(w)){a.push(w);nW++}});
  // ignoradas: soma por navio, sem repetir a mesma ocorrência
  const H=readIgnAll(); let nI=0; const ships=new Set();
  Object.entries(data.ignoradas).forEach(([ship,list])=>{
    if(!Array.isArray(list))return;
    const cur=Array.isArray(H[ship])?H[ship]:[], have=new Set(cur.map(x=>x.h));
    list.forEach(x=>{if(x&&typeof x.h==='string'&&!have.has(x.h)){cur.push({h:x.h,t:String(x.t||'')});have.add(x.h);nI++;ships.add(ship)}});
    if(cur.length)H[ship]=cur;
  });
  try{
    if(nW)saveGloss(a);
    if(nI)localStorage.setItem(IGN_KEY,JSON.stringify(H));
  }catch(e){listMsg('Não foi possível guardar as listas neste navegador.','error');return}
  if(!nW&&!nI){listMsg('Nada novo: tudo o que está no arquivo já estava neste computador.','ok');return}
  listMsg('Listas carregadas: '+nW+' palavra(s) nova(s) no glossário e '+nI+' ocorrência(s) ignorada(s) nova(s)'+(nI?' em '+ships.size+' navio(s)':'')+'.','ok');
  glossChanged();
}
$('listExport').addEventListener('click',exportLists);
$('listImportBtn').addEventListener('click',()=>$('listImport').click());
$('listImport').addEventListener('change',()=>{const f=$('listImport').files[0];if(f)importLists(f);$('listImport').value=''});
refreshGloss();
$('year').textContent=new Date().getFullYear();
setTimeout(loadDict,300);
$('clearBtn').addEventListener('click',()=>{
  $('file').value='';workbook=null;rows=[];$('fileName').textContent='Nenhum arquivo selecionado';
  $('results').classList.add('hidden');$('analyzeBtn').disabled=true;prog(0);status('Aguardando arquivo.');
});

;

/* ===== 0.32.0/0.32.1: Exportar SOF em PDF (modelo Rev04) ===== */
var lastTotal=0;
(function(){
  var THEME_DEF=['FFFFFF','000000','E7E6E6','44546A','4472C4','ED7D31','A5A5A5','FFC000','5B9BD5','70AD47'];
  var IDX={8:'000000',9:'FFFFFF',10:'FF0000',11:'00FF00',12:'0000FF',13:'FFFF00',22:'C0C0C0',23:'808080',55:'969696',64:'000000'};
  function hex(h){h=String(h).slice(-6);return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
  function tint(v,t){return Math.round(t>0?v+(255-v)*t:v*(1+t))}
  function esc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function isDateFmt(z){try{return !!(z&&XLSX.SSF.is_date(z))}catch(e){return false}}
  function shown(cell){
    if(!cell||cell.v===undefined||cell.v===null)return '';
    var w=cell.w!==undefined?String(cell.w):String(cell.v);
    if(cell.t==='n'&&!isDateFmt(cell.z)&&/^-?[\d.,]+%?$/.test(w))w=w.replace(/[.,]/g,function(ch){return ch===','?'.':','});
    return w.trim();
  }
  // cor de um elemento <color>/<fgColor>/<bgColor> do styles.xml
  function colorOf(el,theme){
    if(!el)return null; var c=null;
    if(el.getAttribute('rgb'))c=hex(el.getAttribute('rgb'));
    else if(el.getAttribute('theme')!==null&&el.getAttribute('theme')!==''){var i=+el.getAttribute('theme');c=hex((theme||THEME_DEF)[i]||THEME_DEF[i]||'000000')}
    else if(el.getAttribute('indexed')!==null&&el.getAttribute('indexed')!==''){var x=IDX[+el.getAttribute('indexed')];c=x?hex(x):null}
    else if(el.getAttribute('auto'))c=[0,0,0];
    if(c&&el.getAttribute('tint'))c=c.map(function(v){return tint(v,+el.getAttribute('tint'))});
    return c;
  }
  function parseXml(t){return new DOMParser().parseFromString(t,'application/xml')}
  function kids(p,tag){return p?Array.prototype.slice.call(p.getElementsByTagName(tag)):[]}
  function directKids(p,tag){return p?Array.prototype.filter.call(p.childNodes,function(n){return n.nodeName===tag}):[]}
  // lê estilos reais (fonte, borda, cor, alinhamento, formatação condicional) direto do .xlsx
  function readStyles(data,sheetName,maxRow,fileOk){
    var out={ok:false,xfOf:function(){return null},cond:[]};
    try{
      var z=XLSX.CFB.read(new Uint8Array(data),{type:'array'});
      var get=function(p){var e=XLSX.CFB.find(z,p);return e&&e.content?new TextDecoder('utf-8').decode(new Uint8Array(e.content)):null};
      var stx=get('/xl/styles.xml'); if(!stx)return out;
      var theme=null, th=get('/xl/theme/theme1.xml');
      if(th){var td=parseXml(th),cs=td.getElementsByTagName('a:clrScheme')[0]||td.getElementsByTagName('clrScheme')[0];
        if(cs){var names=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6'],t=[];
          names.forEach(function(n,i){var e=Array.prototype.filter.call(cs.childNodes,function(x){return x.nodeName.replace(/^a:/,'')===n})[0],c=e&&e.firstElementChild;
            t[i]=c?(c.getAttribute('lastClr')||c.getAttribute('val')||THEME_DEF[i]):THEME_DEF[i]});theme=t}}
      var sd=parseXml(stx);
      var fonts=kids(sd.getElementsByTagName('fonts')[0],'font').map(function(f){
        var o={b:!!f.getElementsByTagName('b')[0],i:!!f.getElementsByTagName('i')[0],sz:null,color:null,name:''};
        var s=f.getElementsByTagName('sz')[0]; if(s)o.sz=+s.getAttribute('val');
        o.color=colorOf(f.getElementsByTagName('color')[0],theme); var n=f.getElementsByTagName('name')[0]; if(n)o.name=n.getAttribute('val'); return o});
      var fills=kids(sd.getElementsByTagName('fills')[0],'fill').map(function(f){
        var p=f.getElementsByTagName('patternFill')[0]; if(!p||p.getAttribute('patternType')!=='solid')return null;
        return colorOf(p.getElementsByTagName('fgColor')[0],theme)});
      var borders=kids(sd.getElementsByTagName('borders')[0],'border').map(function(b){
        var o={};['left','right','top','bottom'].forEach(function(side){
          var e=directKids(b,side)[0]; if(e&&e.getAttribute('style'))o[side[0]]={st:e.getAttribute('style'),c:colorOf(e.getElementsByTagName('color')[0],theme)||[0,0,0]}});
        return o});
      var cx=sd.getElementsByTagName('cellXfs')[0];
      var xfs=kids(cx,'xf').map(function(x){
        var al=x.getElementsByTagName('alignment')[0];
        return {font:fonts[+x.getAttribute('fontId')||0]||null,fill:fills[+x.getAttribute('fillId')||0]||null,border:borders[+x.getAttribute('borderId')||0]||{},
          h:al?al.getAttribute('horizontal'):null,v:al?al.getAttribute('vertical'):null,wrap:al?al.getAttribute('wrapText')==='1'||al.getAttribute('wrapText')==='true':false,
          indent:al?+al.getAttribute('indent')||0:0}});
      var dxfs=kids(sd.getElementsByTagName('dxfs')[0],'dxf').map(function(d){
        var f=d.getElementsByTagName('fill')[0],p=f&&f.getElementsByTagName('patternFill')[0];
        return p?(colorOf(p.getElementsByTagName('bgColor')[0],theme)||colorOf(p.getElementsByTagName('fgColor')[0],theme)):null});
      // aba -> arquivo
      var wbx=get('/xl/workbook.xml'),rel=get('/xl/_rels/workbook.xml.rels'); if(!wbx||!rel)return out;
      var rid=null; kids(parseXml(wbx),'sheet').forEach(function(s){if(s.getAttribute('name')===sheetName)rid=s.getAttribute('r:id')||s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')});
      var tgt=null; kids(parseXml(rel),'Relationship').forEach(function(r){if(r.getAttribute('Id')===rid)tgt=r.getAttribute('Target')});
      if(!tgt)return out;
      var path=tgt.charAt(0)==='/'?tgt:'/xl/'+tgt.replace(/^\.?\//,'');
      var sx=get(path); if(!sx)return out;
      var map={}, re=/<c r="([A-Z]{1,3})(\d+)"([^>]*)>/g, m;
      while((m=re.exec(sx))){
        var row=+m[2]; if(row>maxRow+1)break;
        var sm=/\bs="(\d+)"/.exec(m[3]); if(sm)map[(row-1)+','+colNum(m[1])]=xfs[+sm[1]]||null;
      }
      var df=/<sheetFormatPr[^>]*defaultRowHeight="([\d.]+)"/.exec(sx); out.defRow=df?Math.round(+df[1]*4/3):null;
      // formatação condicional (preenchimento quando a célula está vazia)
      var cre=/<conditionalFormatting sqref="([^"]+)">([\s\S]*?)<\/conditionalFormatting>/g, cm;
      while((cm=cre.exec(sx))){
        var rre=/<cfRule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/cfRule>)/g, rm;
        while((rm=rre.exec(cm[2]))){
          var at=rm[1], ty=(/type="([^"]+)"/.exec(at)||[])[1], dx=/dxfId="(\d+)"/.exec(at), pr=+((/priority="(\d+)"/.exec(at)||[0,99])[1]);
          if(!dx||!dxfs[+dx[1]])continue;
          var fm=/<formula>([\s\S]*?)<\/formula>/.exec(rm[2]||'');
          out.cond.push({sq:cm[1].split(/\s+/),type:ty,f:fm?fm[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'):'',fill:dxfs[+dx[1]],pr:pr});
        }
      }
      out.cond.sort(function(a,b){return a.pr-b.pr});
      out.ok=true; out.xfOf=function(r,c){return map[r+','+c]||null};
    }catch(e){out.ok=false;out.err=e.message}
    return out;
  }
  function colNum(t){var n=0;for(var i=0;i<t.length;i++)n=n*26+t.charCodeAt(i)-64;return n-1}
  function inSq(sq,r,c){
    for(var i=0;i<sq.length;i++){var a=sq[i].split(':'),s=XLSX.utils.decode_cell(a[0]),e=XLSX.utils.decode_cell(a[a.length-1]);
      if(r>=s.r&&r<=e.r&&c>=s.c&&c<=e.c)return s}
    return null;
  }
  function condFill(st,ws,r,c){
    var isBlank=function(rr,cc){return shown(ws[XLSX.utils.encode_cell({r:rr,c:cc})])===''};
    for(var i=0;i<st.cond.length;i++){
      var k=st.cond[i], tl=inSq(k.sq,r,c); if(!tl)continue;
      if(k.type==='containsBlanks'){if(isBlank(r,c))return k.fill;continue}
      if(k.type!=='expression')continue;
      var f=k.f.replace(/\s+/g,'').toUpperCase(), neg=false, mm;
      if((mm=/^NOT\((.*)\)$/.exec(f))){neg=true;f=mm[1]}
      var ref=null;
      if((mm=/^ISBLANK\((\$?[A-Z]+\$?\d+)\)$/.exec(f)))ref=mm[1];
      else if((mm=/^LEN\((?:TRIM\()?(\$?[A-Z]+\$?\d+)\)?\)=0$/.exec(f)))ref=mm[1];
      else if((mm=/^(\$?[A-Z]+\$?\d+)=""$/.exec(f)))ref=mm[1];
      if(!ref)continue;
      var p=/^(\$?)([A-Z]+)(\$?)(\d+)$/.exec(ref), rr=+p[4]-1, cc=colNum(p[2]);
      if(!p[3])rr+=r-tl.r; if(!p[1])cc+=c-tl.c;
      var bl=isBlank(rr,cc); if(neg?!bl:bl)return k.fill;
    }
    return null;
  }
  function bcss(b){
    if(!b)return '';
    var w={hair:1,thin:1,dotted:1,dashed:1,dashDot:1,dashDotDot:1,medium:2,mediumDashed:2,mediumDashDot:2,mediumDashDotDot:2,slantDashDot:2,thick:3,double:3}[b.st]||1;
    var sty=/dot|hair/i.test(b.st)?'dotted':/dash/i.test(b.st)?'dashed':b.st==='double'?'double':'solid';
    return w+'px '+sty+' rgb('+b.c.join(',')+')';
  }
  function buildGrid(){
    var name=rows[0].sheet;
    var wb=XLSX.read(lastData,{type:'array',cellStyles:true,sheets:[name]});
    var ws=wb.Sheets[name]; if(!ws)throw new Error('aba do SOF não encontrada');
    var used=usedRange(ws), pa=printArea(wb,name);
    var r0=pa?pa.s.r:used.s.r, c0=pa?pa.s.c:used.s.c, r1=pa?Math.min(used.e.r,pa.e.r):used.e.r, c1=pa?Math.min(used.e.c,pa.e.c):used.e.c;
    var st=readStyles(lastData,name,r1);
    var maxR=r0, maxC=c0;
    Object.keys(ws).forEach(function(k){
      if(k[0]==='!')return; var a=XLSX.utils.decode_cell(k);
      if(a.r<r0||a.r>r1||a.c<c0||a.c>c1)return;
      var cl=ws[k]; if(shown(cl)===''&&!(cl.s&&cl.s.patternType==='solid'))return;
      if(a.r>maxR)maxR=a.r; if(a.c>maxC)maxC=a.c;
    });
    // com a área de impressão definida, ela manda (inclui bordas de células vazias)
    if(pa){maxR=r1;maxC=c1}
    r1=maxR; c1=maxC;
    var merges={}, covered={};
    (ws['!merges']||[]).forEach(function(m){
      if(m.e.r<r0||m.s.r>r1||m.e.c<c0||m.s.c>c1)return;
      var rs=Math.min(m.e.r,r1)-m.s.r+1, cs=Math.min(m.e.c,c1)-m.s.c+1;
      merges[m.s.r+','+m.s.c]={rs:rs,cs:cs};
      for(var r=m.s.r;r<m.s.r+rs;r++)for(var c=m.s.c;c<m.s.c+cs;c++)if(r!==m.s.r||c!==m.s.c)covered[r+','+c]=1;
    });
    var cw=[],colHidden=[],rh=[],rowHidden=[], defH=st.defRow||20;
    for(var c=c0;c<=c1;c++){var ci=(ws['!cols']||[])[c]||{};colHidden[c]=!!ci.hidden;cw[c]=ci.wpx||(ci.wch?Math.round(ci.wch*7+5):64)}
    for(var r=r0;r<=r1;r++){var ri=(ws['!rows']||[])[r]||{};rowHidden[r]=!!ri.hidden;rh[r]=ri.hpx||(ri.hpt?Math.round(ri.hpt*4/3):defH)}
    return {ws:ws,st:st,r0:r0,r1:r1,c0:c0,c1:c1,merges:merges,covered:covered,cw:cw,colHidden:colHidden,rh:rh,rowHidden:rowHidden,name:name};
  }
  function build(){
    var g=buildGrid(), ws=g.ws, st=g.st, ci=colInfo||{}, hdr=(ci.hdr!==undefined&&ci.hdr>=0)?ci.hdr:-1;
    var W=0; for(var c=g.c0;c<=g.c1;c++)if(!g.colHidden[c])W+=g.cw[c];
    var html='<table style="width:'+W+'px"><colgroup>', c, r, anyBorder=false;
    for(c=g.c0;c<=g.c1;c++)if(!g.colHidden[c])html+='<col style="width:'+g.cw[c]+'px">';
    html+='</colgroup>';
    var topOf={}, y=0, titleRow=-1, vessel='', rev03=false;
    for(r=g.r0;r<=g.r1;r++){
      if(g.rowHidden[r])continue;
      topOf[r]=y; y+=g.rh[r];
      var h=g.rh[r];
      html+='<tr style="height:'+h+'px">';
      var prevText=false;
      for(c=g.c0;c<=g.c1;c++){
        if(g.colHidden[c])continue;
        var key=r+','+c; if(g.covered[key])continue;
        var cell=ws[XLSX.utils.encode_cell({r:r,c:c})], txt=shown(cell), mg=g.merges[key];
        var rs=mg?mg.rs:1, cs=mg?mg.cs:1;
        var xf=st.ok?st.xfOf(r,c):null;
        var fill=st.ok?(xf&&xf.fill):(cell&&cell.s&&cell.s.patternType==='solid'&&cell.s.fgColor&&cell.s.fgColor.rgb?hex(cell.s.fgColor.rgb):null);
        if(!fill&&st.ok){var cf=condFill(st,ws,r,c);if(cf)fill=cf}
        var isNum=cell&&cell.t==='n'&&!isDateFmt(cell.z), isTime=/^\d{1,2}:\d{2}(:\d{2})?$/.test(txt);
        if(/^statement of facts?$/i.test(txt)&&titleRow<0)titleRow=r;
        if(/^vessel$/i.test(txt)&&!vessel){for(var k=c+1;k<=g.c1;k++){var v2=shown(ws[XLSX.utils.encode_cell({r:r,c:k})]);if(v2){vessel=v2;break}}}
        if(r-g.r0<40&&/^\s*\d{2}\)\s/.test(txt))rev03=true;
        var al0=xf?xf.h:null;
        // texto que "vaza" para as células vazias da direita (como no Excel), exceto se tiver quebra de linha ou alinhamento central/direita
        if(!mg&&txt&&!isNum&&!(xf&&xf.wrap)&&(!al0||al0==='general'||al0==='left')){
          while(c+cs<=g.c1&&!g.covered[r+','+(c+cs)]&&!g.merges[r+','+(c+cs)]){
            var nx=ws[XLSX.utils.encode_cell({r:r,c:c+cs})], nxf=st.ok?st.xfOf(r,c+cs):null;
            var nf=st.ok?((nxf&&nxf.fill)||condFill(st,ws,r,c+cs)):null;
            if(shown(nx)!==''||g.colHidden[c+cs]||(nf?!fill||nf.join()!==fill.join():!!fill))break;
            if(st.ok&&nxf&&(nxf.border.l||nxf.border.r))break;
            cs++;
          }
        }
        var s='';
        if(fill)s+='background:rgb('+fill.join(',')+');';
        var dark=!!fill&&(0.299*fill[0]+0.587*fill[1]+0.114*fill[2])<140, al;
        if(st.ok){
          var f=xf&&xf.font;
          var fs=f&&f.sz?Math.round(f.sz*4/3):12; s+='font-size:'+fs+'px;';
          if(f&&f.b)s+='font-weight:700;'; if(f&&f.i)s+='font-style:italic;';
          if(f&&f.color)s+='color:rgb('+f.color.join(',')+');'; else if(dark)s+='color:#fff;';
          al=!al0||al0==='general'?(isNum?'right':'left'):(al0==='centerContinuous'?'center':(al0==='fill'||al0==='justify'?'left':al0));
          var v=xf&&xf.v; s+='vertical-align:'+(v==='center'?'middle':v==='top'?'top':'bottom')+';';
          if(xf&&xf.wrap)s+='white-space:normal;word-break:break-word;';
          if(xf&&xf.indent)s+='padding-left:'+(3+xf.indent*7)+'px;';
          // bordas: esquerda/topo da própria célula; direita/baixo da última célula coberta
          var bl=xf&&xf.border.l, bt=xf&&xf.border.t;
          var lx=st.xfOf(r,c+cs-1), ly=st.xfOf(r+rs-1,c), br=(lx&&lx.border.r)||(xf&&xf.border.r), bb=(ly&&ly.border.b)||(xf&&xf.border.b);
          if(bl){s+='border-left:'+bcss(bl)+';';anyBorder=true} if(bt){s+='border-top:'+bcss(bt)+';';anyBorder=true}
          if(br){s+='border-right:'+bcss(br)+';';anyBorder=true} if(bb){s+='border-bottom:'+bcss(bb)+';';anyBorder=true}
        }else{
          // plano B (sem estilos): deduz pelo conteúdo
          s+='font-size:'+Math.max(7,Math.min(12,Math.round(h*0.72)))+'px;';
          if(dark)s+='color:#fff;font-weight:700;';
          al='left'; if(isNum)al='right'; else if(c===ci.g||c===ci.h)al='center'; else if(isTime&&c!==1)al='center';
          else if(mg&&mg.cs>1&&txt)al='center'; else if(dark&&r===hdr&&c!==ci.d)al='center'; else if(dark&&/^total\b/i.test(txt))al='right';
          if(/^statement of facts?$/i.test(txt)){s+='font-size:20px;font-weight:700;';al='center'}
          else if(!dark&&txt&&prevText&&(hdr<0||r<hdr))s+='font-weight:700;';
        }
        if(txt)prevText=true;
        s+='text-align:'+al+';';
        html+='<td'+(rs>1?' rowspan="'+rs+'"':'')+(cs>1?' colspan="'+cs+'"':'')+' style="'+s+'">'+esc(txt)+'</td>';
        if(cs>1&&!mg)c+=cs-1;
      }
      html+='</tr>';
    }
    html+='</table>';
    var logo=document.querySelector('.brand img'), lh=0, lt=0;
    if(logo&&titleRow>=0){lh=Math.min(g.rh[titleRow]*0.95,50);lt=topOf[titleRow]+(g.rh[titleRow]-lh)/2}
    var K=724/W;
    return {html:'<div class="pdfWrap'+(anyBorder?' nob':'')+'" style="zoom:'+K+';width:'+W+'px">'+html+
      (lh?'<img src="'+logo.src+'" style="position:absolute;left:8px;top:'+lt+'px;height:'+lh+'px">':'')+'</div>',
      vessel:vessel,sheet:g.name,rev03:rev03,styled:st.ok};
  }
  var btn=document.getElementById('pdfBtn');
  if(!btn)return;
  btn.addEventListener('click',function(){
    if(!rows.length||!lastData)return;
    var out;
    try{out=build()}catch(e){alert('Não foi possível montar o PDF: '+e.message);return}
    var msg=[];
    if(lastTotal>0)msg.push('Ainda há '+lastTotal+' ocorrência(s) pendente(s): o SOF não está liberado.');
    if(out.rev03)msg.push('Este SOF parece ser do modelo antigo (Rev03); o PDF foi desenhado para o Rev04 e pode sair diferente do original.');
    if(!out.styled)msg.push('Não consegui ler bordas e fontes deste arquivo; o PDF sairá com formatação aproximada.');
    if(msg.length&&!confirm(msg.join('\n\n')+'\n\nGerar o PDF mesmo assim?'))return;
    var box=document.getElementById('pdfView');
    if(!box){box=document.createElement('div');box.id='pdfView';document.body.appendChild(box)}
    box.innerHTML=out.html;
    var oldTitle=document.title;
    document.title='Statement of Facts - '+(out.vessel||out.sheet);
    var done=function(){document.title=oldTitle;box.innerHTML=''};
    window.addEventListener('afterprint',done,{once:true});
    setTimeout(function(){window.print()},60);
  });
})();
