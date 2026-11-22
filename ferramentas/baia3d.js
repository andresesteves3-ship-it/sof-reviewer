/* Painel dos Assistentes — Baía 3D (v0.158). Motor herdado do cais 3D do Início (conceito de Fellipe Mourão).
   Carregado sob demanda depois de ferramentas/three.min.js (Three.js r128).
   window.Baia3D.montar({palco, cabs:{n:{x,y,h}}, verm:[n], clique(id|null), movido(id,c0,c1), mudouVista()})
     → {dados(lista), sel(id), ver('nav'|'tudo'), zoom(f), girar(graus), mover(id|null), enquadra(), destruir(), diag()}
   lista: [{id, nome, sub, cl:'op'|'at'|'fi'|'bl', c0, c1, mae, carga:'gusa'|'pot'|'geral', alerta:''|'r'|'a', fant:bool, fund:bool}]
   Coordenadas: as do mapa 2D (1 unidade ≈ distância entre 2 cabeços). x → X, y do mapa → Z. A água fica à esquerda de quem anda do 227 para o 80. */
(function(){'use strict';
var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
window.Baia3D={montar:function(O){
var T=THREE,palco=O.palco,CABS=O.cabs,VERM=O.verm||[];
var reduz=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var toque=window.matchMedia&&matchMedia('(pointer: coarse)').matches;
var leve=toque||Math.min(innerWidth,innerHeight)<700;
var camadaRot=document.createElement('div');camadaRot.className='b3-rot';palco.appendChild(camadaRot);

/* ---------- renderizador ---------- */
var renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,leve?1.5:2));
renderer.shadowMap.enabled=!leve;renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.domElement.className='b3-cv';renderer.domElement.setAttribute('aria-hidden','true');
palco.insertBefore(renderer.domElement,camadaRot);
var cena=new T.Scene();cena.background=new T.Color(0x16384A);
var cam=new T.OrthographicCamera(-10,10,10,-10,0.1,900);

/* ---------- luz ---------- */
cena.add(new T.HemisphereLight(0xEAF3F8,0x3A4A52,0.78));
var sol=new T.DirectionalLight(0xFFF2E0,0.72);sol.position.set(-60,120,70);sol.castShadow=!leve;
var smz=2048;sol.shadow.mapSize.set(smz,smz);var sc=sol.shadow.camera;sc.left=-90;sc.right=90;sc.top=80;sc.bottom=-80;sc.near=10;sc.far=360;sol.shadow.bias=-0.0008;sol.shadow.normalBias=0.03;
sol.target.position.set(40,0,30);cena.add(sol);cena.add(sol.target);

/* ---------- materiais ---------- */
var M={},geos=[];
function mat(nome,cor,o){if(M[nome])return M[nome];o=o||{};var m=new T.MeshStandardMaterial({color:cor,roughness:o.r!=null?o.r:0.85,metalness:o.m||0,flatShading:!!o.flat,transparent:!!o.t,opacity:o.op!=null?o.op:1,vertexColors:!!o.vc,depthWrite:o.dw!==false});return M[nome]=m}
function G(g){geos.push(g);return g}
function caixa(w,h,d,m,x,y,z,pai,somb){var o=new T.Mesh(G(new T.BoxGeometry(w,h,d)),m);o.position.set(x,y,z);if(somb!==false){o.castShadow=true;o.receiveShadow=true}(pai||cena).add(o);return o}
function cil(rt,rb,h,m,x,y,z,pai,sg){var o=new T.Mesh(G(new T.CylinderGeometry(rt,rb,h,sg||12)),m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;(pai||cena).add(o);return o}
var C={terra:mat('terra',0xB4B9B0),patio:mat('patio',0x8E9397),asfalto:mat('asfalto',0x4C5157),faixa:mat('faixa',0xE8B04A),branco:mat('branco',0xEFF1F2),
  armazem:mat('armazem',0xB9C2C8),telhado:mat('telhado',0x6F8796),grafite:mat('grafite',0x34383D),preto:mat('preto',0x1B1C1F),verde:mat('verdeT',0x7E9A7A),
  casco:mat('casco',0x13243A),cascoF:mat('cascoF',0x8A1E24),conves:mat('conves',0x6C747B),sup:mat('sup',0xF2F3F4),vidro:mat('vidro',0x3E5A66,{r:0.3,m:0.1}),
  guind:mat('guind',0xE2A93B),gusa:mat('gusa',0x4D3F39,{flat:true}),pot:mat('pot',0xC48C7A,{flat:true}),geral:mat('geral',0x8F7F62,{flat:true}),balsa:mat('balsa',0x7A5A3A),
  tampa:{op:mat('tOp',0x1F8A44),at:mat('tAt',0xD98C00),fi:mat('tFi',0x5B6B82),bl:mat('tBl',0x8A6A4A)}};

/* ---------- geometria do cais ---------- */
var KS=Object.keys(CABS).map(Number).sort(function(a,b){return b-a});   // 227 … 80 (sem o 163)
function pt(c){if(CABS[c])return CABS[c];for(var i=0;i<KS.length-1;i++){var a=KS[i],b=KS[i+1];if(c<=a&&c>=b){var t=(a-c)/(a-b),A=CABS[a],B=CABS[b];return {x:A.x+(B.x-A.x)*t,y:A.y+(B.y-A.y)*t,h:A.h+(B.h-A.h)*t}}}
  return c>KS[0]?CABS[KS[0]]:CABS[KS[KS.length-1]]}
function nrm(h,d){var r=(h-90)*Math.PI/180;return {x:Math.cos(r)*d,y:Math.sin(r)*d}}       /* d>0 = água; d<0 = terra */
var CY=1.05;   /* altura do cais acima da água */
var SEG=[KS.filter(function(c){return c>=164}),KS.filter(function(c){return c<=162})];

/* terra (as mesmas áreas do mapa 2D), em placas extrudadas */
function placa(pts,alt,m,y0){var s=new T.Shape();pts.forEach(function(p,i){if(i)s.lineTo(p[0],-p[1]);else s.moveTo(p[0],-p[1])});
  var g=G(new T.ExtrudeGeometry(s,{depth:alt,bevelEnabled:false}));g.rotateX(-Math.PI/2);var o=new T.Mesh(g,m);o.position.y=y0||0;o.receiveShadow=true;cena.add(o);return o}
(function(){var a0=CABS[227],z0=CABS[80],p164=CABS[164],p162=CABS[162];
  var A=[[-120,-120],[a0.x+12,-120],[a0.x+12,a0.y-12]].concat(SEG[0].map(function(c){return [CABS[c].x,CABS[c].y]})).concat([[p164.x+0.6,200],[-120,200]]);
  var B=[[p162.x-0.6,200]].concat(SEG[1].map(function(c){return [CABS[c].x,CABS[c].y]})).concat([[z0.x+90,z0.y-0.4],[z0.x+90,200]]);
  placa(A,CY,C.terra,-0.6);placa(B,CY,C.terra,-0.6);
  /* ilhas */
  var il=new T.Shape(),Y=function(v){return -v};il.moveTo(20.5,Y(4));il.bezierCurveTo(26,Y(1.5),31,Y(4),29.5,Y(12));il.bezierCurveTo(28.5,Y(17),25,Y(20),23.5,Y(26));il.bezierCurveTo(22.8,Y(30),21,Y(31.5),20,Y(29));
  il.bezierCurveTo(18.8,Y(25),21,Y(21),20,Y(17));il.bezierCurveTo(19,Y(14),15.5,Y(13.5),16,Y(9.5));il.bezierCurveTo(16.4,Y(6),18,Y(5),20.5,Y(4));
  var gi=G(new T.ExtrudeGeometry(il,{depth:0.9,bevelEnabled:true,bevelThickness:0.25,bevelSize:0.5,bevelSegments:2,curveSegments:18}));gi.rotateX(-Math.PI/2);var ilh=new T.Mesh(gi,C.verde);ilh.position.y=-0.5;ilh.receiveShadow=true;cena.add(ilh);
  placa([[74,4.5],[80,3.6],[80.5,5.4],[76,6.6],[73.4,6.2]],0.7,C.verde,-0.3)})();

/* faixas ao longo do cais: d0 → d1 (terra = negativo), na altura y */
function faixaCais(lista,d0,d1,m,y){var pos=[],idx=[];lista.forEach(function(c,i){var p=CABS[c],a=nrm(p.h,d0),b=nrm(p.h,d1);pos.push(p.x+a.x,y,p.y+a.y,p.x+b.x,y,p.y+b.y);if(i){var k=i*2;idx.push(k-2,k-1,k,k-1,k+1,k)}});
  var g=G(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
  var o=new T.Mesh(g,m);o.receiveShadow=true;o.material.side=T.DoubleSide;cena.add(o);return o}
SEG.forEach(function(L){faixaCais(L,0,-2.6,C.patio,CY+0.42);faixaCais(L,-0.32,-0.46,C.faixa,CY+0.43);faixaCais(L,-5.4,-7.6,C.asfalto,CY+0.425);
  /* paredão do cais (face voltada para a água) */
  var pos=[],idx=[];L.forEach(function(c,i){var p=CABS[c];pos.push(p.x,CY+0.42,p.y,p.x,-0.6,p.y);if(i){var k=i*2;idx.push(k-2,k-1,k,k-1,k+1,k)}});
  var g=G(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();var w=new T.Mesh(g,mat('paredao',0x9DA3A6));w.material.side=T.DoubleSide;cena.add(w)});
/* cabeços (instanciados) e defensas */
(function(){var gb=G(new T.CylinderGeometry(0.11,0.14,0.3,8)),ib=new T.InstancedMesh(gb,C.grafite,KS.length),gd=G(new T.BoxGeometry(0.55,0.7,0.18)),id=new T.InstancedMesh(gd,C.preto,KS.length),m4=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler(),s=new T.Vector3(1,1,1),v=new T.Vector3();
  KS.forEach(function(c,i){var p=CABS[c],n=nrm(p.h,-0.2);v.set(p.x+n.x,CY+0.58,p.y+n.y);m4.compose(v,q,s);ib.setMatrixAt(i,m4);
    var n2=nrm(p.h,0.08);e.set(0,-p.h*Math.PI/180,0);q.setFromEuler(e);v.set(p.x+n2.x,CY-0.05,p.y+n2.y);m4.compose(v,q,s);id.setMatrixAt(i,m4);q.set(0,0,0,1)});
  ib.castShadow=true;cena.add(ib);cena.add(id)})();
/* armazéns e pátios atrás da avenida (cenário) */
(function(){var hs=[0x9FB0BA,0xB4BCC2,0xA9B6AD,0xC0B9AC];SEG.forEach(function(L,si){for(var i=4;i<L.length-3;i+=7){var c=L[i];if(Math.abs(c-163)<6)continue;var p=CABS[c],n=nrm(p.h,-11),g=new T.Group();g.position.set(p.x+n.x,CY+0.42,p.y+n.y);g.rotation.y=-p.h*Math.PI/180;cena.add(g);
  var hgt=0.55+((c*7)%4)/7,m=mat('arm'+(c%4),hs[c%4]);if(c%3===1){[[-1.2,0],[0.4,0.3],[1.6,-0.2]].forEach(function(q,j){var pl=new T.Mesh(G(new T.DodecahedronGeometry(0.75,0)),C.gusa);pl.scale.set(1.3,0.38,1);pl.position.set(q[0],0.22,q[1]);pl.rotation.y=j;pl.castShadow=pl.receiveShadow=true;g.add(pl)});continue}
  caixa(4.4,hgt,2.4,m,0,hgt/2,0,g);caixa(4.55,0.1,2.55,C.telhado,0,hgt+0.05,0,g)}})})();

/* água com leve degradê (mais clara junto ao cais) */
(function(){var W=420,N=leve?90:140,g=G(new T.PlaneGeometry(W,W,N,N));g.rotateX(-Math.PI/2);g.translate(40,-0.02,30);
  var a=g.attributes.position,cor=[],c1=new T.Color(0x2E7F95),c2=new T.Color(0x184C61),tmp=new T.Color(),amos=KS.filter(function(c,i){return i%3===0}).map(function(c){return CABS[c]});
  for(var i=0;i<a.count;i++){var x=a.getX(i),z=a.getZ(i),d=1e9;for(var j=0;j<amos.length;j++){var dx=x-amos[j].x,dz=z-amos[j].y,q=dx*dx+dz*dz;if(q<d)d=q}d=Math.sqrt(d);var t=Math.min(1,d/38);tmp.copy(c1).lerp(c2,t);cor.push(tmp.r,tmp.g,tmp.b)}
  g.setAttribute('color',new T.Float32BufferAttribute(cor,3));var mar=new T.Mesh(g,mat('mar',0xFFFFFF,{vc:true,r:0.5,m:0.05}));mar.receiveShadow=true;cena.add(mar)})();

/* ---------- navios ---------- */
var NAV={},proxies=[],selId=null,moverId=null;
function corCarga(t){return t==='gusa'?C.gusa:t==='pot'?C.pot:C.geral}
function cascoGeo(L,B,alt,enc){var s=new T.Shape(),a=L/2-enc,b=B/2-enc,pr=Math.min(2.4,L*0.16);
  s.moveTo(-a,-b+0.25);s.quadraticCurveTo(-a,-b,-a+0.25,-b);s.lineTo(a-pr,-b);s.quadraticCurveTo(a-0.15,-b,a,0);s.quadraticCurveTo(a-0.15,b,a-pr,b);s.lineTo(-a+0.25,b);s.quadraticCurveTo(-a,b,-a,b-0.25);s.closePath();
  var e=G(new T.ExtrudeGeometry(s,{depth:alt,bevelEnabled:false,curveSegments:8}));e.rotateX(-Math.PI/2);return e}
function navioMesh(o){var g=new T.Group(),fant=!!o.fant;
  var M2=function(m){if(!fant)return m;var k='f_'+m.uuid;if(M[k])return M[k];var c=m.clone();c.transparent=true;c.opacity=0.38;c.depthWrite=false;return M[k]=c};
  var B=o.bl?1.25:1.6,L=o.L;
  if(o.bl){var h=new T.Mesh(cascoGeo(L,B,0.75,0),M2(C.balsa));h.position.y=-0.25;h.castShadow=h.receiveShadow=true;g.add(h);
    var hp=new T.Mesh(G(new T.ConeGeometry(0.55,0.5,8)),M2(corCarga(o.carga)));hp.scale.set(L*0.55,1,1.4);hp.position.set(0,0.72,0);hp.castShadow=true;g.add(hp);return {g:g,B:B}}
  var h1=new T.Mesh(cascoGeo(L,B,1.05,0),M2(C.casco));h1.position.y=-0.35;h1.castShadow=h1.receiveShadow=true;g.add(h1);
  var bt=new T.Mesh(cascoGeo(L,B,0.22,-0.01),M2(C.cascoF));bt.position.y=-0.34;g.add(bt);
  var cv=new T.Mesh(cascoGeo(L,B,0.04,0.06),M2(C.conves));cv.position.y=0.7;cv.receiveShadow=true;g.add(cv);
  var sx=-L/2+1.05,nh=Math.max(3,Math.min(9,Math.round((L-3.4)/1.5))),esp=(L-3.6)/nh,x0=sx+1.0+esp/2;
  for(var i=0;i<nh;i++){var hx=x0+i*esp,tw=esp*0.72,aberta=o.cl==='op'&&i%2===0;
    caixa(tw+0.08,0.1,B*0.66,M2(C.grafite),hx,0.79,0,g);
    if(aberta){var cg=new T.Mesh(G(new T.ConeGeometry(0.45,0.32,7)),M2(corCarga(o.carga)));cg.scale.set(tw*1.6,1,B*0.95);cg.position.set(hx,0.86,0);g.add(cg)}
    else caixa(tw,0.16,B*0.62,M2(C.tampa[o.cl]||C.tampa.fi),hx,0.9,0,g)}
  if(o.carga!=='pot')for(var j=1;j<nh;j+=2){var cx=x0+(j-0.5)*esp;cil(0.09,0.11,0.9,M2(C.guind),cx,1.2,B*0.22,g,8);var lc=caixa(0.07,0.07,1.5,M2(C.guind),cx,1.6,-0.2,g);lc.rotation.x=-0.5}
  /* superestrutura na popa */
  caixa(1.0,1.0,B*0.86,M2(C.sup),sx,1.2,0,g);caixa(1.1,0.32,B*1.02,M2(C.sup),sx+0.05,1.82,0,g);caixa(1.12,0.12,B*1.03,M2(C.vidro),sx+0.05,1.86,0,g,false);
  var ch=caixa(0.42,0.55,0.5,M2(C.grafite),sx-0.28,2.2,0,g);caixa(0.44,0.12,0.52,M2(C.cascoF),sx-0.28,2.36,0,g);
  return {g:g,B:B}}
function lugar(o){if(o.fund){var S=[[50,12],[58,10],[66,14],[52,20],[60,19],[68,22],[46,26],[56,27],[64,29]],s=S[o.slot%S.length];return {x:s[0],z:s[1],ang:-0.35+o.slot*0.4,L:7}}
  var a=pt(o.c0),b=pt(o.c1);var dx=b.x-a.x,dy=b.y-a.y,len=Math.sqrt(dx*dx+dy*dy)||1,hm=(a.h+b.h)/2,off=o.bl?1.6+1.6/2+0.2:1.6/2+0.25;
  var m=o.maeP;if(o.bl&&m){off=m.off+1.6/2+1.25/2+0.15;return {x:(a.x+b.x)/2+nrm(m.hm,off).x,z:(a.y+b.y)/2+nrm(m.hm,off).y,ang:Math.atan2(dy,dx),L:Math.max(3,len*0.55),off:off,hm:m.hm}}
  var n=nrm(hm,off);return {x:(a.x+b.x)/2+n.x,z:(a.y+b.y)/2+n.y,ang:Math.atan2(dy,dx),L:Math.max(3,len+0.6),off:off,hm:hm}}
function anel(L,B){var s=new T.Shape(),a=L/2+0.45,b=B/2+0.45,r=0.45;s.moveTo(-a+r,-b);s.lineTo(a-r,-b);s.quadraticCurveTo(a,-b,a,-b+r);s.lineTo(a,b-r);s.quadraticCurveTo(a,b,a-r,b);s.lineTo(-a+r,b);s.quadraticCurveTo(-a,b,-a,b-r);s.lineTo(-a,-b+r);s.quadraticCurveTo(-a,-b,-a+r,-b);
  var h=new T.Path(),a2=a-0.16,b2=b-0.16;h.moveTo(-a2,-b2);h.lineTo(a2,-b2);h.lineTo(a2,b2);h.lineTo(-a2,b2);h.closePath();s.holes.push(h);var g=G(new T.ShapeGeometry(s,6));g.rotateX(-Math.PI/2);return g}
function dados(lista){var vivos={},maeP={},slot=0;
  lista.forEach(function(o){if(!o.bl&&!o.fund&&o.c0!=null){var l=lugar(o);maeP[o.id]=l}});
  lista.forEach(function(o){if(o.c0==null&&!o.fund)return;vivos[o.id]=1;if(o.fund)o.slot=slot++;if(o.bl&&o.mae&&maeP[o.mae])o.maeP=maeP[o.mae];
    var l=lugar(o),k=[o.cl,o.carga,o.fant?1:0,o.bl?1:0,l.L.toFixed(1)].join('|'),n=NAV[o.id];
    if(!n||n.k!==k){if(n)apaga(o.id);var mm=navioMesh({L:l.L,cl:o.cl,carga:o.carga,bl:o.bl,fant:o.fant});n=NAV[o.id]={k:k,g:mm.g,B:mm.B,L:l.L};cena.add(mm.g);
      var px=new T.Mesh(G(new T.BoxGeometry(l.L+0.6,2.6,mm.B+0.8)),new T.MeshBasicMaterial({visible:false}));px.position.y=0.8;px.userData.id=o.id;mm.g.add(px);proxies.push(px);n.px=px;
      var an=new T.Mesh(anel(l.L,mm.B),new T.MeshBasicMaterial({color:0xFFFFFF,transparent:true,opacity:0,depthWrite:false}));an.position.y=0.04;mm.g.add(an);n.an=an;
      var r=document.createElement('button');r.type='button';r.className='b3-n';r.addEventListener('click',function(){O.clique&&O.clique(o.id)});camadaRot.appendChild(r);n.r=r}
    n.o=o;n.g.position.set(l.x,0,l.z);n.g.rotation.y=-l.ang;n.l=l;
    n.r.className='b3-n '+o.cl+(o.alerta?' al-'+o.alerta:'')+(o.fant?' fant':'')+(o.fund?' fund':'')+(selId===o.id?' sel':'');
    n.r.innerHTML='<b>'+esc(o.nome)+'</b>'+(o.sub?'<span>'+esc(o.sub)+'</span>':'')+(o.alerta?'<i aria-hidden="true">!</i>':'');n.r.setAttribute('aria-label',o.nome+(o.sub?', '+o.sub:''))});
  Object.keys(NAV).forEach(function(id){if(!vivos[id])apaga(id)});pintaAneis();precisa()}
function apaga(id){var n=NAV[id];if(!n)return;cena.remove(n.g);proxies.splice(proxies.indexOf(n.px),1);n.r.remove();delete NAV[id]}
function pintaAneis(){Object.keys(NAV).forEach(function(id){var n=NAV[id],o=n.o,an=n.an;if(selId===id){an.material.color.setHex(0xFFFFFF);an.material.opacity=0.95}else if(o.alerta==='r'){an.material.color.setHex(0xE5333F);an.material.opacity=0.85}
  else if(o.alerta==='a'){an.material.color.setHex(0xF2B233);an.material.opacity=0.7}else an.material.opacity=0;n.r.classList.toggle('sel',selId===id)})}

/* ---------- rótulos dos cabeços ---------- */
var RC={};KS.forEach(function(c){if(VERM.indexOf(c)<0&&c%5)return;var d=document.createElement('span');d.className='b3-c'+(VERM.indexOf(c)>=0?' v':'');d.textContent=c;camadaRot.appendChild(d);RC[c]=d});

/* ---------- câmera ---------- */
var V={tx:40,tz:30,hz:40,az:0,el:52},VA=null;   /* hz = meia altura visível (unidades) */
function aplicaCam(){var W=palco.clientWidth||1,H=palco.clientHeight||1,asp=W/H,az=V.az*Math.PI/180,el=V.el*Math.PI/180,R=300;
  cam.position.set(V.tx+R*Math.sin(az)*Math.cos(el),R*Math.sin(el),V.tz+R*Math.cos(az)*Math.cos(el));cam.up.set(0,1,0);cam.lookAt(V.tx,0,V.tz);
  cam.left=-V.hz*asp;cam.right=V.hz*asp;cam.top=V.hz;cam.bottom=-V.hz;cam.updateProjectionMatrix();cam.updateMatrixWorld()}
function enquadraPts(pts,mg){if(!pts.length)return null;aplicaCam();var inv=cam.matrixWorldInverse,p=new T.Vector3(),mn={x:1e9,y:1e9},mx={x:-1e9,y:-1e9},cx=0,cz=0;
  pts.forEach(function(q){cx+=q.x;cz+=q.z});cx/=pts.length;cz/=pts.length;
  var W=palco.clientWidth||1,H=palco.clientHeight||1,asp=W/H;
  pts.forEach(function(q){p.set(q.x,q.y||0,q.z).applyMatrix4(inv);mn.x=Math.min(mn.x,p.x);mn.y=Math.min(mn.y,p.y);mx.x=Math.max(mx.x,p.x);mx.y=Math.max(mx.y,p.y)});
  var w=(mx.x-mn.x)+2*mg,h=(mx.y-mn.y)+2*mg,hz=Math.max(h/2,w/2/asp);
  /* centro no plano: volta o centro do retângulo da tela para o chão */
  var cxs=(mn.x+mx.x)/2,cys=(mn.y+mx.y)/2,cc=new T.Vector3(cxs,cys,-300).applyMatrix4(cam.matrixWorld),dir=new T.Vector3(0,0,-1).applyQuaternion(cam.quaternion),t=-cc.y/dir.y;cc.addScaledVector(dir,t);
  return {tx:cc.x,tz:cc.z,hz:Math.max(3.5,Math.min(95,hz)),az:V.az,el:V.el}}
function vaiPara(alvo,ms){if(!alvo)return;if(reduz||!ms){V=Object.assign(V,alvo);aplicaCam();precisa();O.mudouVista&&O.mudouVista();return}VA={de:Object.assign({},V),para:alvo,t0:performance.now(),ms:ms};precisa()}
function ptsCais(){return KS.filter(function(c,i){return i%4===0}).map(function(c){return {x:CABS[c].x,z:CABS[c].y}})}
function ver(q){var pts=[];if(q==='nav')Object.keys(NAV).forEach(function(id){var n=NAV[id];if(n.o.fund)return;var c=Math.cos(n.l.ang),s=Math.sin(n.l.ang),L=n.L/2+1;pts.push({x:n.l.x-c*L,z:n.l.z-s*L,y:2.5},{x:n.l.x+c*L,z:n.l.z+s*L,y:2.5},{x:n.l.x,z:n.l.z,y:0})});
  var tem=pts.length;if(!tem)pts=ptsCais();var e=enquadraPts(pts,tem?(q==='nav'?5:2):2);if(q==='nav'&&tem&&e)e.hz=Math.max(e.hz,10);vaiPara(e,650)}
function focaNav(id){var n=NAV[id];if(!n)return;var c=Math.cos(n.l.ang),s=Math.sin(n.l.ang),L=n.L/2+2;vaiPara(enquadraPts([{x:n.l.x-c*L,z:n.l.z-s*L,y:2},{x:n.l.x+c*L,z:n.l.z+s*L,y:2},{x:n.l.x,z:n.l.z,y:0}],4.5),650)}
function zoom(f,sx,sy){var W=palco.clientWidth,H=palco.clientHeight;var nz=Math.max(3.5,Math.min(95,V.hz/f));
  if(sx!=null){var a=chao(sx,sy);V.hz=nz;aplicaCam();var b=chao(sx,sy);if(a&&b){V.tx+=a.x-b.x;V.tz+=a.z-b.z}}else V.hz=nz;aplicaCam();precisa();O.mudouVista&&O.mudouVista()}
function girar(g){V.az=Math.max(-75,Math.min(75,V.az+g));aplicaCam();precisa()}

/* ---------- entrada ---------- */
var ray=new T.Raycaster(),ndc=new T.Vector2(),plano=new T.Plane(new T.Vector3(0,1,0),0),cv=renderer.domElement;
function setNdc(x,y){var r=cv.getBoundingClientRect();ndc.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);ray.setFromCamera(ndc,cam)}
function chao(x,y){setNdc(x,y);var p=new T.Vector3();return ray.ray.intersectPlane(plano,p)?p:null}
function pega(x,y){setNdc(x,y);var h=ray.intersectObjects(proxies,false)[0];return h?h.object.userData.id:null}
var P={},pan=null;
cv.addEventListener('contextmenu',function(e){e.preventDefault()});
cv.addEventListener('pointerdown',function(e){e.preventDefault();cv.setPointerCapture(e.pointerId);P[e.pointerId]={x:e.clientX,y:e.clientY};var ks=Object.keys(P);
  if(ks.length===1){var id=moverId&&pega(e.clientX,e.clientY)===moverId?moverId:null;pan={x:e.clientX,y:e.clientY,v:Object.assign({},V),mov:false,gira:e.button===2||e.shiftKey,arr:id,t:Date.now()}}
  else if(ks.length===2){var a=P[ks[0]],b=P[ks[1]];pan={pinch:true,d:Math.hypot(a.x-b.x,a.y-b.y),ang:Math.atan2(b.y-a.y,b.x-a.x),v:Object.assign({},V),mov:true}}});
cv.addEventListener('pointermove',function(e){if(!P[e.pointerId]){if(e.pointerType==='mouse'){var id=pega(e.clientX,e.clientY);cv.style.cursor=id?(id===moverId?'grab':'pointer'):'';Object.keys(NAV).forEach(function(k){NAV[k].r.classList.toggle('hov',k===id)})}return}
  P[e.pointerId]={x:e.clientX,y:e.clientY};if(!pan)return;
  if(pan.pinch){var ks=Object.keys(P);if(ks.length<2)return;var a=P[ks[0]],b=P[ks[1]],d=Math.hypot(a.x-b.x,a.y-b.y),an=Math.atan2(b.y-a.y,b.x-a.x);V.hz=Math.max(3.5,Math.min(95,pan.v.hz*pan.d/Math.max(20,d)));V.az=Math.max(-75,Math.min(75,pan.v.az-(an-pan.ang)*180/Math.PI));aplicaCam();precisa();return}
  var dx=e.clientX-pan.x,dy=e.clientY-pan.y;if(!pan.mov&&Math.hypot(dx,dy)<5)return;pan.mov=true;cv.classList.add('arr');
  if(pan.arr){var q=chao(e.clientX,e.clientY);if(q)arrasta(pan.arr,q);return}
  if(pan.gira){V.az=Math.max(-75,Math.min(75,pan.v.az-dx*0.25));V.el=Math.max(28,Math.min(84,pan.v.el+dy*0.2));aplicaCam();precisa();return}
  var H=palco.clientHeight||1,u=pan.v.hz*2/H,az=V.az*Math.PI/180,sel=Math.sin(V.el*Math.PI/180);
  /* direita da tela e "para cima" da tela projetados no chão */
  var rx=Math.cos(az),rz=-Math.sin(az),fx=-Math.sin(az),fz=-Math.cos(az);V.tx=pan.v.tx-dx*u*rx+dy*u/sel*fx;V.tz=pan.v.tz-dx*u*rz+dy*u/sel*fz;aplicaCam();precisa()});
function fim(e){var p=pan;delete P[e.pointerId];cv.classList.remove('arr');if(Object.keys(P).length)return;pan=null;if(!p)return;
  if(p.arr&&p.mov){var n=NAV[p.arr];if(n&&n.nov&&O.movido)O.movido(p.arr,n.nov[0],n.nov[1]);return}
  if(!p.mov&&!p.pinch&&Date.now()-p.t<800){var id=pega(e.clientX,e.clientY);O.clique&&O.clique(id)}
  if(p.mov)O.mudouVista&&O.mudouVista()}
cv.addEventListener('pointerup',fim);cv.addEventListener('pointercancel',function(e){delete P[e.pointerId];pan=null;cv.classList.remove('arr')});
cv.addEventListener('wheel',function(e){e.preventDefault();zoom(e.deltaY<0?1.18:1/1.18,e.clientX,e.clientY)},{passive:false});
/* arrastar o navio ao longo do cais: acha o cabeço mais perto do ponteiro e mantém o tamanho */
function arrasta(id,q){var n=NAV[id];if(!n)return;var o=n.o,sp=Math.abs(o.c1-o.c0),best=null,bd=1e9;KS.forEach(function(c){var p=CABS[c],w=nrm(p.h,1.1),dx=q.x-(p.x+w.x),dz=q.z-(p.y+w.y),d=dx*dx+dz*dz;if(d<bd){bd=d;best=c}});
  var dir=o.c1>=o.c0?1:-1,c0=Math.round(best-dir*sp/2),c1=c0+dir*Math.round(sp);if(Math.min(c0,c1)<80){var s0=80-Math.min(c0,c1);c0+=s0;c1+=s0}if(Math.max(c0,c1)>227){var s1=Math.max(c0,c1)-227;c0-=s1;c1-=s1}
  var t=Object.assign({},o,{c0:c0,c1:c1}),l=lugar(t);n.g.position.set(l.x,0,l.z);n.g.rotation.y=-l.ang;n.l=l;n.nov=[c0,c1];n.r.querySelector('span')&&(n.r.querySelector('span').textContent='CAB '+Math.max(c0,c1)+' a '+Math.min(c0,c1));precisa()}
function mover(id){moverId=id||null;palco.classList.toggle('b3-mov',!!moverId);Object.keys(NAV).forEach(function(k){delete NAV[k].nov})}

/* ---------- rótulos na tela ---------- */
var tv=new T.Vector3();
function posRot(){var W=palco.clientWidth,H=palco.clientHeight;if(!W)return;var ls=[];
  Object.keys(NAV).forEach(function(id){var n=NAV[id];tv.set(n.l.x,n.o.bl?1.2:2.5,n.l.z).project(cam);var x=(tv.x+1)/2*W,y=(1-tv.y)/2*H;n.r.hidden=x<-60||x>W+60||y<-30||y>H+30;
    if(!n.r.hidden)ls.push({n:n,x:x,y:y,w:n.r.offsetWidth||90,h:n.r.offsetHeight||28,sel:selId===id})});
  ls.sort(function(a,b){return (b.sel?1:0)-(a.sel?1:0)||a.y-b.y});var feitos=[];
  ls.forEach(function(p){var y=p.y-p.h-8,x=p.x-p.w/2;for(var k=0;k<12;k++){var bate=feitos.some(function(f){return x<f.x+f.w+4&&x+p.w+4>f.x&&y<f.y+f.h+3&&y+p.h+3>f.y});if(!bate)break;y-=p.h+4}
    x=Math.max(4,Math.min(W-p.w-4,x));y=Math.max(4,y);feitos.push({x:x,y:y,w:p.w,h:p.h});p.n.r.style.transform='translate('+Math.round(x)+'px,'+Math.round(y)+'px)';p.n.r.style.setProperty('--ly',Math.max(0,Math.round(p.y-y-p.h))+'px')});
  var perto=V.hz<26,muitoPerto=V.hz<12;Object.keys(RC).forEach(function(c){var d=RC[c],ver=VERM.indexOf(+c)>=0;var mostra=ver?V.hz<70:(muitoPerto||(perto&&c%10===0));if(!mostra){d.hidden=true;return}
    var p=CABS[c],n=nrm(p.h,-1.25);tv.set(p.x+n.x,CY+0.5,p.y+n.y).project(cam);var x=(tv.x+1)/2*W,y=(1-tv.y)/2*H;d.hidden=x<0||x>W||y<0||y>H;d.style.transform='translate('+Math.round(x)+'px,'+Math.round(y)+'px) translate(-50%,-50%)'})}

/* ---------- laço (só desenha quando precisa) ---------- */
var raf=0,vis=true,ro,io,t0=performance.now();
function precisa(){if(!raf)raf=requestAnimationFrame(quadro)}
function quadro(now){raf=0;if(!vis)return;var cont=false;
  if(VA){var k=Math.min(1,(now-VA.t0)/VA.ms),e=k<0.5?2*k*k:1-Math.pow(-2*k+2,2)/2;['tx','tz','hz','az','el'].forEach(function(p){V[p]=VA.de[p]+(VA.para[p]-VA.de[p])*e});if(k>=1){VA=null;O.mudouVista&&O.mudouVista()}else cont=true;aplicaCam()}
  /* pulso do anel do selecionado e dos alertas: 12 quadros por segundo, sem animação contínua do resto */
  var pulsa=false;if(!reduz){var t=(now-t0)/1000;Object.keys(NAV).forEach(function(id){var n=NAV[id];if(selId===id||n.o.alerta){pulsa=true;n.an.material.opacity=(selId===id?0.75:0.55)+Math.sin(t*3.2)*0.25}})}
  renderer.render(cena,cam);posRot();if(cont)raf=requestAnimationFrame(quadro);else if(pulsa&&vis){clearTimeout(tp);tp=setTimeout(precisa,85)}}
var tp=0;
function enquadra(){var W=palco.clientWidth,H=palco.clientHeight;if(!W||!H)return;renderer.setSize(W,H,false);aplicaCam();precisa()}
ro=new ResizeObserver(enquadra);ro.observe(palco);
io=new IntersectionObserver(function(es){vis=es[0].isIntersecting;if(vis)precisa()});io.observe(palco);
document.addEventListener('visibilitychange',function(){vis=!document.hidden;if(vis)precisa()});
aplicaCam();var e0=enquadraPts(ptsCais(),2);if(e0)V=Object.assign(V,e0);enquadra();
function destruir(){cancelAnimationFrame(raf);clearTimeout(tp);ro.disconnect();io.disconnect();geos.forEach(function(g){g.dispose()});Object.keys(M).forEach(function(k){M[k].dispose()});renderer.dispose();palco.innerHTML=''}
return {dados:dados,sel:function(id,foco){selId=id||null;pintaAneis();if(id&&foco!==false)focaNav(id);precisa()},ver:ver,zoom:function(f){zoom(f)},girar:girar,mover:mover,enquadra:enquadra,destruir:destruir,
  vista:function(){return Object.assign({},V)},diag:function(){return {W:palco.clientWidth,H:palco.clientHeight,nav:Object.keys(NAV).length,V:Object.assign({},V)}}}
}};
})();
