/* Painel dos Assistentes — cais portuário 3D do Início (v0.74). Carregado sob demanda depois de ferramentas/three.min.js.
   window.CaisTriunfo.montar({palco, ferramentas:[{id,nome,desc,rota}], logoB}) → {selos(mapa), enquadra(), destruir()} */
(function(){'use strict';
var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
window.CaisTriunfo={montar:function(O){
var T=THREE;
var palco=O.palco,camadaRot=document.createElement('div');camadaRot.className='cais-rotulos';palco.appendChild(camadaRot);
var reduz=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var toque=window.matchMedia&&matchMedia('(pointer: coarse)').matches;
var leve=toque||Math.min(innerWidth,innerHeight)<700;var FERRAMENTAS=O.ferramentas;

/* ---------- renderizador e qualidade ---------- */
var renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
var dprMax=leve?1.5:2;renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,dprMax));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.tabIndex=-1;
palco.insertBefore(renderer.domElement,camadaRot);
var cena=new T.Scene();
var cam=new T.OrthographicCamera(-10,10,10,-10,0.1,400);

/* ---------- luzes (poucas) ---------- */
cena.add(new T.HemisphereLight(0xF2F6F8,0x46545A,0.82));
var sol=new T.DirectionalLight(0xFFF4E6,0.62);sol.position.set(-14,26,16);sol.castShadow=true;
var sm=leve?1024:2048;sol.shadow.mapSize.set(sm,sm);var sc=sol.shadow.camera;sc.left=-26;sc.right=26;sc.top=20;sc.bottom=-20;sc.near=1;sc.far=80;sol.shadow.bias=-0.0006;sol.shadow.normalBias=0.02;
cena.add(sol);cena.add(sol.target);

/* ---------- materiais (foscos, reaproveitados) ---------- */
var M={};
function mat(nome,cor,o){if(M[nome])return M[nome];o=o||{};var m=new T.MeshStandardMaterial({color:cor,roughness:o.r!=null?o.r:0.86,metalness:o.m||0,flatShading:!!o.flat,transparent:!!o.t,opacity:o.op!=null?o.op:1});return M[nome]=m}
var C={concreto:mat('concreto',0xB3B7B8),concretoEsc:mat('concretoEsc',0x9DA2A4),asfalto:mat('asfalto',0x5E6267),grafite:mat('grafite',0x3B3E43),grafiteEsc:mat('grafiteEsc',0x26282C),
  vermelho:mat('vermelho',0xDA202C),vermelhoEsc:mat('vermelhoEsc',0xA9161F),branco:mat('branco',0xEDEEEF),cinza:mat('cinza',0xA9AEB2),amarelo:mat('amarelo',0xE8B04A),
  preto:mat('preto',0x1B1C1F),vidro:mat('vidro',0x5D7C87,{r:0.35,m:0.1}),casco:mat('casco',0x2C2F34),convés:mat('convés',0x80868B),gusa:mat('gusa',0x5A4B44,{flat:true}),
  potassio:mat('potassio',0x8C7466,{flat:true}),cabo:mat('cabo',0x202124)};
var geos=[];function G(g){geos.push(g);return g}
function caixa(w,h,d,m,x,y,z,pai,sombra){var o=new T.Mesh(G(new T.BoxGeometry(w,h,d)),m);o.position.set(x,y,z);if(sombra!==false){o.castShadow=true;o.receiveShadow=true}(pai||cena).add(o);return o}
function cil(rt,rb,h,m,x,y,z,pai,seg){var o=new T.Mesh(G(new T.CylinderGeometry(rt,rb,h,seg||16)),m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;(pai||cena).add(o);return o}
function textura(w,h,desenha){var c=document.createElement('canvas');c.width=w;c.height=h;var g=c.getContext('2d');desenha(g,w,h);var t=new T.CanvasTexture(c);t.anisotropy=4;return {tex:t,g:g,c:c}}
function imagemEm(uri,feito){var im=new Image();im.onload=function(){feito(im)};im.src=uri}

/* =====================================================================
   4) CENA PORTUÁRIA: mar, cais e pátio
   ===================================================================== */
var seg=leve?36:56;
var marGeo=G(new T.PlaneGeometry(110,70,seg,Math.round(seg*0.64)));marGeo.rotateX(-Math.PI/2);marGeo.translate(0,0,34);
var marBase=marGeo.attributes.position.array.slice();
var mar=new T.Mesh(marGeo,mat('mar',0x1F5664,{r:0.55,m:0.05,flat:true}));mar.receiveShadow=true;cena.add(mar);
var CAIS_Y=1.25;
// cais de concreto (borda em z=0) e pátio asfaltado atrás
caixa(64,CAIS_Y+1.2,7,C.concreto,0,(CAIS_Y-1.2)/2,-3.5);
caixa(64,CAIS_Y+1.0,30,C.asfalto,0,(CAIS_Y-1.0)/2-0.02,-22);
caixa(64,0.02,30,mat('grama',0x8A938C),0,CAIS_Y+0.005,-34,null,false);
caixa(64,0.03,0.18,C.amarelo,0,CAIS_Y+0.02,-0.55,null,false);        // faixa amarela de segurança
caixa(64,0.02,0.12,C.branco,0,CAIS_Y+0.02,-6.9,null,false);          // divisa do pátio
for(var fx=-17;fx<=17;fx+=2.6){var df=caixa(0.55,1.2,0.35,C.preto,fx,CAIS_Y-0.75,0.12)}            // defensas
var cabeços=[];for(var bx=-18;bx<=18;bx+=3.9){var cb=new T.Group();cb.position.set(bx,CAIS_Y,-0.95);cena.add(cb);cil(0.2,0.24,0.42,C.grafiteEsc,0,0.21,0,cb,12);cil(0.3,0.3,0.08,C.amarelo,0,0.45,0,cb,12);cabeços.push(cb)}
// postes de iluminação do pátio
[-14,-0.5,13.5].forEach(function(x){cil(0.07,0.09,5.2,C.grafite,x,CAIS_Y+2.6,-6.4,null,8);caixa(0.9,0.14,0.32,C.grafiteEsc,x+0.3,CAIS_Y+5.2,-6.4)});
// cargas no pátio: pilha de granel (potássio) e lotes de ferro-gusa
var pg=G(new T.ConeGeometry(2.8,1.35,14,2));(function(){var a=pg.attributes.position;for(var i=0;i<a.count;i++){var y=a.getY(i);if(y<0.6&&y>-0.6){a.setX(i,a.getX(i)*(0.92+((i*37)%11)/60));a.setZ(i,a.getZ(i)*(0.92+((i*53)%13)/70))}}pg.computeVertexNormals()})();var pilha=new T.Mesh(pg,C.potassio);pilha.scale.set(1.35,1,0.9);pilha.position.set(9.4,CAIS_Y+0.67,-3.8);pilha.castShadow=pilha.receiveShadow=true;cena.add(pilha);
for(var gi=0;gi<3;gi++)for(var gj=0;gj<2;gj++){var lt=new T.Mesh(G(new T.DodecahedronGeometry(0.62,0)),C.gusa);lt.scale.set(1.2,0.6,1);lt.position.set(-15.2+gi*1.45,CAIS_Y+0.36,-3.2-gj*1.35);lt.rotation.y=gi*0.7+gj;lt.castShadow=lt.receiveShadow=true;cena.add(lt)}

/* =====================================================================
   5) ESTRUTURAS INTERATIVAS (uma por ferramenta)
   ===================================================================== */
var ESTR={};   // id → {grupo, ancora (Vector3), caixa de toque}

/* ---- Line Up → navio graneleiro atracado ---- */
(function(){
  var g=new T.Group();g.position.set(-0.5,0,3.4);cena.add(g);
  var L=17.5,W=4.3,meio=W/2;
  function casco(alt,enc){var s=new T.Shape();var a=L/2-enc,b=meio-enc;s.moveTo(-a,-b+0.6);s.quadraticCurveTo(-a,-b,-a+0.6,-b);s.lineTo(a-3.2,-b);s.quadraticCurveTo(a-0.6,-b,a,0);s.quadraticCurveTo(a-0.6,b,a-3.2,b);s.lineTo(-a+0.6,b);s.quadraticCurveTo(-a,b,-a,b-0.6);s.closePath();
    var e=G(new T.ExtrudeGeometry(s,{depth:alt,bevelEnabled:false,curveSegments:10}));e.rotateX(-Math.PI/2);return e}
  var h1=new T.Mesh(casco(3.0,0),C.casco);h1.position.y=-0.75;h1.castShadow=h1.receiveShadow=true;g.add(h1);
  var faixa=new T.Mesh(casco(0.38,-0.02),C.vermelhoEsc);faixa.position.y=-0.2;g.add(faixa);          // linha d'água
  var conv=new T.Mesh(casco(0.08,0.12),C['convés']);conv.position.y=2.25;conv.receiveShadow=true;g.add(conv);
  // tampas dos 5 porões (vermelho institucional)
  for(var i=0;i<5;i++){var hx=-3.6+i*2.35;caixa(1.85,0.42,3.0,C.vermelho,hx,2.53,0,g);caixa(1.95,0.12,3.1,C.grafiteEsc,hx,2.36,0,g)}
  // guindastes de bordo entre os porões
  [-2.42,0.27,2.72].forEach(function(x){var p=cil(0.22,0.26,1.6,C.grafite,x,3.1,1.25,g,10);var j=caixa(0.16,0.16,3.4,C.amarelo,x,3.7,-0.25,g);j.rotation.x=-0.42});
  // superestrutura de popa
  var sx=-7.1;caixa(2.6,2.7,3.7,C.branco,sx,3.6,0,g);caixa(2.9,0.75,4.4,C.branco,sx+0.1,5.3,0,g);caixa(2.95,0.32,4.45,C.vidro,sx+0.1,5.35,0,g,false);caixa(0.06,0.5,3.5,C.vidro,sx+1.31,3.9,0,g,false);
  caixa(2.4,0.12,3.0,C.grafite,sx+0.05,5.74,0,g);
  // chaminé com faixa vermelha e símbolo Triunfo
  var ch=caixa(1.1,1.7,1.4,C.grafite,sx-0.75,6.55,0,g);
  var simb=textura(256,256,function(x,w,h){x.fillStyle='#DA202C';x.fillRect(0,0,w,h)});
  imagemEm(O.logoB,function(im){var s=im.height;simb.g.drawImage(im,0,0,s*1.02,s,40,40,176,176);simb.tex.needsUpdate=true});
  var mf=new T.MeshStandardMaterial({map:simb.tex,roughness:0.8});
  [0.705,-0.705].forEach(function(z){var p=new T.Mesh(G(new T.PlaneGeometry(1.1,1.1)),mf);p.position.set(sx-0.75,6.65,z);p.rotation.y=z>0?0:Math.PI;g.add(p)});
  caixa(1.14,0.14,1.44,C.preto,sx-0.75,7.42,0,g);
  // mastro de proa
  cil(0.06,0.08,2.2,C.grafite,L/2-1.6,3.4,0,g,8);
  // logo Triunfo no costado (lado do mar, voltado para a câmera)
  var lg=textura(1024,256,function(){});imagemEm(O.logoB,function(im){var r=Math.min(1000/im.width,240/im.height);lg.g.clearRect(0,0,1024,256);lg.g.drawImage(im,(1024-im.width*r)/2,(256-im.height*r)/2,im.width*r,im.height*r);lg.tex.needsUpdate=true});
  var pl=new T.Mesh(G(new T.PlaneGeometry(5.2,1.3)),new T.MeshStandardMaterial({map:lg.tex,transparent:true,roughness:0.8}));pl.position.set(2.2,1.15,meio+0.012);g.add(pl);
  // cabos de amarração até os cabeços
  [[-8.6,-0.6],[-6.9,-0.8],[6.4,-0.6],[8.3,-0.4]].forEach(function(p){var de=new T.Vector3(g.position.x+p[0],2.3,g.position.z-meio+0.1),para=new T.Vector3(Math.round((de.x+18)/3.9)*3.9-18,CAIS_Y+0.42,-0.95);
    var v=new T.Vector3().subVectors(para,de),c=new T.Mesh(G(new T.CylinderGeometry(0.03,0.03,v.length(),5)),C.cabo);c.position.copy(de).addScaledVector(v,0.5);c.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.clone().normalize());cena.add(c)});
  ESTR.lineup={grupo:g,ancora:new T.Vector3(-0.5+1.2,3.4,3.4),toque:[L,4.8,W+0.6],toqueC:new T.Vector3(-0.5,1.6,3.4)};
})();

/* ---- Rotinas → guindaste portuário móvel junto ao navio ---- */
var lanca;
(function(){
  var g=new T.Group();g.position.set(3.6,CAIS_Y,-2.6);cena.add(g);
  caixa(3.6,0.55,2.8,C.grafite,0,0.45,0,g);
  [[-1.9,-1.6],[1.9,-1.6],[-1.9,1.6],[1.9,1.6]].forEach(function(p){caixa(0.7,0.12,0.7,C.amarelo,p[0],0.06,p[1],g);caixa(0.18,0.4,0.18,C.grafiteEsc,p[0]*0.8,0.3,p[1]*0.8,g)});
  var gira=new T.Group();gira.position.y=0.75;g.add(gira);lanca=gira;
  caixa(1.0,6.6,1.0,C.grafite,0,3.3,0,gira);                         // torre
  caixa(2.3,1.3,2.0,C.branco,-0.5,1.0,0,gira);caixa(2.32,0.18,2.02,C.vermelho,-0.5,1.45,0,gira); // casa de máquinas
  caixa(1.2,1.0,1.5,C.grafiteEsc,-1.6,0.9,0,gira);                    // contrapeso
  caixa(0.9,0.75,0.8,C.vidro,0.35,5.4,0.75,gira);                     // cabine do operador
  // lança treliçada (duas vigas) apontando para o navio
  var piv=new T.Group();piv.position.set(0.3,6.2,0.3);piv.rotation.x=-0.3;gira.add(piv);
  caixa(0.5,0.42,8.6,C.amarelo,0,0,4.3,piv);caixa(0.3,0.3,8.4,C.grafite,0,0.42,4.2,piv);
  for(var k=1;k<5;k++)caixa(0.08,0.44,0.08,C.grafiteEsc,0,0.21,k*1.8,piv);
  // cabo e moitão sobre o porão
  var cab=caixa(0.05,4.2,0.05,C.cabo,0,-2.05,8.5-0.62,piv,false);cab.rotation.x=0.3;
  caixa(0.5,0.45,0.5,C.amarelo,0,-4.05,8.5-1.25,piv).rotation.x=0.3;
  ESTR.rotinas={grupo:g,ancora:new T.Vector3(3.9,CAIS_Y+8.1,-2.6),toque:[4.2,8.4,3.4],toqueC:new T.Vector3(3.6,CAIS_Y+4,-2.6)};
})();

/* ---- Requisições → central de equipes do OGMO (cobertura + painel de turnos + terno) ---- */
(function(){
  var g=new T.Group();g.position.set(-9.6,CAIS_Y,-10.6);cena.add(g);
  caixa(6.4,0.18,4.6,C.concretoEsc,0,0.09,0,g);
  [[-2.8,-1.9],[2.8,-1.9],[-2.8,1.9],[2.8,1.9]].forEach(function(p){cil(0.1,0.1,2.8,C.grafite,p[0],1.55,p[1],g,8)});
  var tet=caixa(6.6,0.2,4.8,C.grafite,0,3.05,0,g);tet.rotation.z=0.05;caixa(6.62,0.32,0.08,C.vermelho,0,2.9,2.43,g);
  // painel de turnos: 4 períodos, cada um com equipes
  var pt=textura(512,256,function(x,w,h){x.fillStyle='#24262A';x.fillRect(0,0,w,h);x.fillStyle='#DA202C';x.fillRect(0,0,w,34);
    for(var i=0;i<4;i++){var cx=18+i*124;x.fillStyle='#3A3D42';x.fillRect(cx,50,110,190);x.fillStyle='#E8B04A';x.fillRect(cx,50,110,8);
      for(var j=0;j<(i===3?2:4);j++){x.fillStyle=j%2?'#C4C7C8':'#EDEEEF';x.fillRect(cx+10,72+j*40,90,26)}}});
  var pm=new T.Mesh(G(new T.BoxGeometry(3.6,1.8,0.12)),[C.grafiteEsc,C.grafiteEsc,C.grafiteEsc,C.grafiteEsc,new T.MeshStandardMaterial({map:pt.tex,roughness:0.85}),C.grafiteEsc]);
  pm.position.set(-0.6,1.6,-1.2);pm.castShadow=true;g.add(pm);cil(0.06,0.06,0.8,C.grafite,-2.2,0.5,-1.2,g,6);cil(0.06,0.06,0.8,C.grafite,1.0,0.5,-1.2,g,6);
  // terno em fila (capacetes coloridos), sem rostos
  var cores=[C.branco,C.amarelo,C.branco,C.vermelho,C.branco,C.amarelo];
  for(var i=0;i<6;i++){var px=-2.1+i*0.62;cil(0.15,0.17,0.62,C.grafite,px,0.5,0.9,g,10);var cap=new T.Mesh(G(new T.SphereGeometry(0.15,10,6,0,Math.PI*2,0,Math.PI/2)),cores[i]);cap.position.set(px,0.95,0.9);cap.castShadow=true;g.add(cap);
    var cab=new T.Mesh(G(new T.SphereGeometry(0.11,8,6)),C.cinza);cab.position.set(px,0.9,0.9);g.add(cab)}
  caixa(2.2,0.32,0.5,C.concreto,1.8,0.34,0.9,g);
  ESTR.requisicoes={grupo:g,ancora:new T.Vector3(-9.6,CAIS_Y+3.6,-10.6),toque:[6.8,3.6,5],toqueC:new T.Vector3(-9.6,CAIS_Y+1.6,-10.6)};
})();

/* ---- Solicitações → prédio administrativo operacional ---- */
(function(){
  var g=new T.Group();g.position.set(-2.4,CAIS_Y,-11.2);cena.add(g);
  caixa(5.6,3.6,3.6,C.branco,0,1.8,0,g);
  caixa(5.62,0.5,3.62,C.vidro,0,1.35,0,g,false);caixa(5.62,0.5,3.62,C.vidro,0,2.75,0,g,false);
  caixa(5.8,0.22,3.8,C.grafite,0,3.7,0,g);
  caixa(0.8,0.5,0.6,C.cinza,-1.6,4.05,-0.6,g);caixa(0.6,0.4,0.6,C.cinza,1.8,4.0,0.4,g);
  // marquise vermelha e totem com ícone de formulário
  caixa(2.2,0.14,1.1,C.vermelho,0.9,2.1,2.3,g);cil(0.06,0.06,2.0,C.grafite,1.85,1.0,2.75,g,6);
  var fm=textura(256,512,function(x,w,h){x.fillStyle='#DA202C';x.fillRect(0,0,w,h);x.fillStyle='#FFFFFF';x.beginPath();x.moveTo(56,90);x.lineTo(160,90);x.lineTo(200,130);x.lineTo(200,330);x.lineTo(56,330);x.closePath();x.fill();
    x.fillStyle='#DA202C';for(var i=0;i<4;i++){x.fillRect(80,150+i*42,96,12)}x.strokeStyle='#DA202C';x.lineWidth=10;x.strokeRect(78,312-8,0,0);x.fillStyle='#FFFFFF';x.fillRect(56,380,144,26);x.fillRect(56,420,100,26)});
  var tm=new T.Mesh(G(new T.BoxGeometry(0.9,2.6,0.3)),[C.vermelho,C.vermelho,C.vermelho,C.vermelho,new T.MeshStandardMaterial({map:fm.tex,roughness:0.85}),C.vermelho]);tm.position.set(-2.1,1.3,2.25);tm.castShadow=true;g.add(tm);
  ESTR.solicitacoes={grupo:g,ancora:new T.Vector3(-2.4,CAIS_Y+4.5,-11.2),toque:[6,4.4,4.6],toqueC:new T.Vector3(-2.4,CAIS_Y+2,-11.2)};
})();

/* ---- SOF Reviewer → central documental com prancheta e verificação ---- */
(function(){
  var g=new T.Group();g.position.set(5.2,CAIS_Y,-11.0);cena.add(g);
  caixa(4.6,2.0,3.2,C.concreto,0,1.0,0,g);caixa(4.62,1.1,0.06,C.vidro,0,1.15,1.6,g,false);caixa(4.8,0.18,3.4,C.grafite,0,2.08,0,g);
  // prancheta inclinada sobre o telhado
  var p=new T.Group();p.position.set(0,2.2,0.1);p.rotation.x=-0.28;g.add(p);
  caixa(2.6,3.2,0.16,C.grafite,0,1.6,0,p);
  var fol=new T.Mesh(G(new T.PlaneGeometry(2.2,2.7)),C.branco);fol.position.set(0,1.5,0.085);p.add(fol);
  caixa(1.0,0.32,0.22,C.cinza,0,3.18,0.05,p);
  for(var i=0;i<4;i++)caixa(i===3?0.9:1.5,0.07,0.02,C.cinza,-0.15-(i===3?0.3:0),2.5-i*0.32,0.1,p,false);
  // símbolo de verificação
  var v1=caixa(0.22,0.65,0.06,C.vermelho,-0.45,0.95,0.12,p,false);v1.rotation.z=0.75;
  var v2=caixa(0.22,1.25,0.06,C.vermelho,0.12,1.12,0.12,p,false);v2.rotation.z=-0.62;
  cil(0.07,0.07,1.2,C.grafite,0,2.6,-0.75,g,6).rotation.x=0.4;
  ESTR.revisor={grupo:g,ancora:new T.Vector3(5.2,CAIS_Y+5.5,-11.0),toque:[5,5.4,3.8],toqueC:new T.Vector3(5.2,CAIS_Y+2.6,-11.0)};
})();

/* ---- Como usar → torre de controle com identificação de ajuda ---- */
(function(){
  var g=new T.Group();g.position.set(12.8,CAIS_Y,-9.6);cena.add(g);
  caixa(2.6,0.3,2.6,C.concretoEsc,0,0.15,0,g);
  cil(0.62,0.85,8.2,C.concreto,0,4.3,0,g,18);
  cil(0.95,0.95,0.2,C.grafite,0,8.4,0,g,8);
  cil(1.45,1.2,1.3,C.vidro,0,9.15,0,g,8);
  cil(1.55,1.55,0.2,C.vermelho,0,9.9,0,g,8);cil(1.1,1.5,0.4,C.grafite,0,10.2,0,g,8);
  cil(0.04,0.04,1.6,C.grafiteEsc,0.3,11.2,0,g,6);
  // placa circular de ajuda na torre (voltada para a câmera)
  var aj=textura(256,256,function(x,w,h){x.fillStyle='#FFFFFF';x.beginPath();x.arc(128,128,124,0,Math.PI*2);x.fill();x.fillStyle='#DA202C';x.beginPath();x.arc(128,128,108,0,Math.PI*2);x.fill();
    x.fillStyle='#FFFFFF';x.font='bold 170px Arial, Helvetica, sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('?',128,140)});
  var pl=new T.Mesh(G(new T.CircleGeometry(0.75,28)),new T.MeshStandardMaterial({map:aj.tex,roughness:0.8,transparent:true}));pl.position.set(0,6.6,0.86);g.add(pl);
  ESTR.ajuda={grupo:g,ancora:new T.Vector3(12.8,CAIS_Y+11.4,-9.6),toque:[3.4,11.6,3.4],toqueC:new T.Vector3(12.8,CAIS_Y+5.6,-9.6),placa:pl};
})();

/* =====================================================================
   6) PONTOS INTERATIVOS: caixas de toque ampliadas + realce
   ===================================================================== */
var proxies=[],porId={};
FERRAMENTAS.forEach(function(f){var e=ESTR[f.id];if(!e)return;
  var px=new T.Mesh(G(new T.BoxGeometry(e.toque[0],e.toque[1],e.toque[2])),new T.MeshBasicMaterial({visible:false}));px.position.copy(e.toqueC);px.userData.id=f.id;cena.add(px);proxies.push(px);
  // materiais próprios por estrutura (para o realce não vazar para outras)
  e.mats=[];e.grupo.traverse(function(o){if(o.isMesh){if(Array.isArray(o.material))o.material=o.material.map(function(m){var c=m.clone();e.mats.push(c);return c});else{o.material=o.material.clone();e.mats.push(o.material)}}});
  porId[f.id]=e});
function realca(id,on){var e=porId[id];if(!e)return;e.mats.forEach(function(m){if(m.emissive){m.emissive.setHex(on?0x3A0B0E:0x000000)}});precisa()}

/* =====================================================================
   7) RÓTULOS HTML (nítidos, focáveis, com descrição no hover/foco)
   ===================================================================== */
var ROT={};
FERRAMENTAS.forEach(function(f){if(!ESTR[f.id])return;var a=document.createElement('a');a.className='rot';a.href=f.rota;a.dataset.f=f.id;
  a.setAttribute('aria-label',f.nome+': '+f.desc);a.innerHTML='<span class="pl"><span class="nm">'+esc(f.nome)+'</span><span class="sl" hidden></span></span><span class="ds">'+esc(f.desc)+'</span><span class="ln" aria-hidden="true"></span>';
  a.addEventListener('mouseenter',function(){foca(f.id)});a.addEventListener('mouseleave',function(){foca(null)});a.addEventListener('focus',function(){foca(f.id)});a.addEventListener('blur',function(){foca(null)});
  camadaRot.appendChild(a);ROT[f.id]=a});
var atual=null;
function foca(id){if(atual===id)return;if(atual){realca(atual,false);ROT[atual]&&ROT[atual].classList.remove('on')}atual=id;if(id){realca(id,true);ROT[id]&&ROT[id].classList.add('on')}palco.classList.toggle('hover',!!id)}
var tmpV=new T.Vector3();
function posRotulos(){var W=palco.clientWidth,H=palco.clientHeight,lst=[];
  FERRAMENTAS.forEach(function(f){var e=ESTR[f.id],a=ROT[f.id];if(!e||!a)return;tmpV.copy(e.ancora).project(cam);var x=(tmpV.x+1)/2*W,y=(1-tmpV.y)/2*H;var r=a.querySelector('.pl').getBoundingClientRect();lst.push({a:a,x:x,y:y,y0:y,w:r.width+12,h:r.height+22})});
  // evita sobreposição: empurra para cima o rótulo mais alto do par
  lst.sort(function(p,q){return q.y-p.y});
  for(var it=0;it<4;it++)for(var i=0;i<lst.length;i++)for(var j=0;j<i;j++){var A=lst[i],B=lst[j];if(Math.abs(A.x-B.x)<(A.w+B.w)/2&&Math.abs(A.y-B.y)<(A.h+B.h)/2){A.y=B.y-(A.h+B.h)/2-2}}
  lst.forEach(function(p){var x=Math.max(p.w/2+4,Math.min(W-p.w/2-4,p.x)),y=Math.max(p.h+2,Math.min(H-4,p.y));p.a.style.transform='translate('+Math.round(x)+'px,'+Math.round(Math.max(y,p.y0))+'px) translate(-50%,-100%)';p.a.querySelector('.ln').style.height=Math.max(14,Math.round(p.y0-y+14))+'px'})}

/* =====================================================================
   8) CÂMERA ADAPTÁVEL (enquadra tudo, conforme tamanho e orientação)
   ===================================================================== */
var alvo=new T.Vector3(0,2,-3.5);
function enquadra(){var W=palco.clientWidth,H=palco.clientHeight;if(!W||!H)return;renderer.setSize(W,H,false);
  var asp=W/H,retrato=asp<0.95;
  var az=(retrato?50:30)*Math.PI/180,el=(retrato?42:36)*Math.PI/180,R=80;
  cam.position.set(alvo.x+R*Math.sin(az)*Math.cos(el),alvo.y+R*Math.sin(el),alvo.z+R*Math.cos(az)*Math.cos(el));cam.up.set(0,1,0);cam.lookAt(alvo);cam.updateMatrixWorld();
  // limites das estruturas no espaço da câmera
  var bb=new T.Box3(),mn=new T.Vector3(1e9,1e9,0),mx=new T.Vector3(-1e9,-1e9,0),inv=cam.matrixWorldInverse,p=new T.Vector3();
  Object.keys(ESTR).forEach(function(k){bb.setFromObject(ESTR[k].grupo);[bb.min.x,bb.max.x].forEach(function(x){[bb.min.y,bb.max.y].forEach(function(y){[bb.min.z,bb.max.z].forEach(function(z){p.set(x,y,z).applyMatrix4(inv);mn.x=Math.min(mn.x,p.x);mn.y=Math.min(mn.y,p.y);mx.x=Math.max(mx.x,p.x);mx.y=Math.max(mx.y,p.y)})})})});
  var cx=(mn.x+mx.x)/2,cy=(mn.y+mx.y)/2,w=(mx.x-mn.x),h=(mx.y-mn.y);
  var padX=retrato?1.04:1.08,padTop=retrato?0.2:0.16; // espaço extra no topo para os rótulos
  w*=padX;h*=1+padTop;cy+=h*padTop*0.32;
  if(w/h>asp)h=w/asp;else w=h*asp;
  cam.left=cx-w/2;cam.right=cx+w/2;cam.top=cy+h/2;cam.bottom=cy-h/2;cam.updateProjectionMatrix();
  precisa()}
var ro=new ResizeObserver(enquadra);ro.observe(palco);

/* =====================================================================
   9) ENTRADA: hover no desktop; toque ≠ arraste no celular
   ===================================================================== */
var ray=new T.Raycaster(),ndc=new T.Vector2();
function pega(ev){var r=renderer.domElement.getBoundingClientRect();ndc.set((ev.clientX-r.left)/r.width*2-1,-(ev.clientY-r.top)/r.height*2+1);ray.setFromCamera(ndc,cam);var hit=ray.intersectObjects(proxies,false)[0];return hit?hit.object.userData.id:null}
var cv=renderer.domElement,ini=null;
cv.addEventListener('pointermove',function(ev){if(ev.pointerType==='mouse')foca(pega(ev))});
cv.addEventListener('pointerleave',function(ev){if(ev.pointerType==='mouse')foca(null)});
cv.addEventListener('pointerdown',function(ev){ini={x:ev.clientX,y:ev.clientY,t:Date.now()}});
cv.addEventListener('pointercancel',function(){ini=null});
cv.addEventListener('pointerup',function(ev){if(!ini)return;var d=Math.hypot(ev.clientX-ini.x,ev.clientY-ini.y),dt=Date.now()-ini.t;ini=null;if(d>10||dt>700)return;
  var id=pega(ev);if(!id)return;foca(id);var a=ROT[id];setTimeout(function(){a.click();setTimeout(function(){foca(null)},300)},110)});

/* =====================================================================
   10) LAÇO: animação discreta, pausa fora da tela e com a aba oculta
   ===================================================================== */
var visivel=true,emTela=true,sujo=true,t0=performance.now(),medidas=[],raf=0;
function precisa(){sujo=true;if(!raf)raf=requestAnimationFrame(quadro)}
var io=new IntersectionObserver(function(es){emTela=es[0].isIntersecting;if(emTela)precisa()},{threshold:0});io.observe(palco);
document.addEventListener('visibilitychange',function(){visivel=!document.hidden;if(visivel)precisa()});
var navio=ESTR.lineup.grupo,placa=ESTR.ajuda.placa;
function quadro(now){raf=0;if(!visivel||!emTela)return;
  var t=(now-t0)/1000;
  if(!reduz){
    var a=marGeo.attributes.position,arr=a.array;for(var i=0;i<arr.length;i+=3){var x=marBase[i],z=marBase[i+2];arr[i+1]=Math.sin(x*0.35+t*0.9)*0.07+Math.cos(z*0.42+t*0.7)*0.06}a.needsUpdate=true;
    navio.rotation.z=Math.sin(t*0.6)*0.006;navio.position.y=Math.sin(t*0.8)*0.04;
    lanca.rotation.y=Math.sin(t*0.25)*0.12;
  }
  placa.quaternion.copy(cam.quaternion);
  renderer.render(cena,cam);posRotulos();
  // qualidade adaptativa: se ficar lento, reduz resolução e sombras
  if(medidas.length<90){medidas.push(now);if(medidas.length===90){var ms=(medidas[89]-medidas[0])/89;if(ms>30){renderer.setPixelRatio(1);sol.castShadow=false;renderer.shadowMap.enabled=false;enquadra()}}}
  sujo=false;if(!reduz)raf=requestAnimationFrame(quadro)}
enquadra();precisa();
// limpeza ao sair (para quando a cena for integrada ao painel)
function destruir(){cancelAnimationFrame(raf);ro.disconnect();io.disconnect();geos.forEach(function(g){g.dispose()});Object.keys(M).forEach(function(k){M[k].dispose()});renderer.dispose();palco.innerHTML=''}

/* selos com números reais (mapa id → {n, c:'r'|'a'|''}); sem número, o selo some */
function selos(m){FERRAMENTAS.forEach(function(f){var a=ROT[f.id];if(!a)return;var s=a.querySelector('.sl'),v=m&&m[f.id];
  if(v&&v.n){s.hidden=false;s.textContent=v.n;s.className='sl'+(v.c?' sl-'+v.c:'');a.setAttribute('aria-label',f.nome+' ('+v.t+'): '+f.desc)}else{s.hidden=true;a.setAttribute('aria-label',f.nome+': '+f.desc)}});precisa()}
return {selos:selos,enquadra:enquadra,destruir:destruir};
}};
})();
