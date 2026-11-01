"""Gera o tema escuro do painel a partir do CSS claro (bloco <style> com :root).
Uso: python3 gera_escuro.py [arquivo.html]  → reescreve <style id="temaEscuro"> (padrão: painel_template.html; serve também no index.html publicado).
Rode de novo sempre que mudar cores no CSS claro."""
import re,sys
P=sys.argv[1] if len(sys.argv)>1 else '/home/claude/painel_template.html'
t=open(P).read()
t=re.sub(r'\n?<style id="temaEscuro">.*?</style>','',t,flags=re.S)
k=t.find(':root{');i=t.rfind('<style',0,k);i=t.find('>',i)+1;j=t.find('</style>',k)
css=re.sub(r'/\*.*?\*/','',t[i:j],flags=re.S)
BG={'#fff':'#1E1F22','#ffffff':'#1E1F22','white':'#1E1F22','#eee':'#2A2B2F','#fbe3e4':'#3A1E21','#e3f1e4':'#1D3322','#fff4e0':'#3A2E17','#e7eaf0':'#2A2E36','#e3eefb':'#1D2A3A','#fff6f6':'#2E1C1E','#fff8f8':'#2A1C1E','#eef2f8':'#262A31','#fafafa':'#232427','#fbf1f1':'#2E1F20','#e6f0fb':'#1D2A3A','#f1e6f7':'#2C2133','#ececec':'#2B2C30','#e6e6e6':'#2B2C30','#efc3c7':'#5A2A2F','#eaeaea':'#121316','#bdbdbd':'#55575C','#e6c27a':'#7A6330','#fff4dc':'#3A2E17','#f5f5f6':'#26272B','#fbe6e8':'#3A1E21','#f2a4a9':'#7A3A40','#d9d9dc':'#34363B','#f0f0f0':'#2A2B2F','#f7f7f7':'#232427','#f4f4f4':'#26272B','#e0e0e0':'#3A3B40','#dcdcdc':'#34363B','#f1f1f1':'#2A2B2F','#e6f0fa':'#1D2A3A','#f2faf3':'#1D2B20','#fff1a8':'#4A4220','#fff1d6':'#3A2E17','#fff5f5':'#2E1C1E','#fff8ec':'#33291A','#f5f5f5':'#26272B','#f8d9dc':'#3A1E21','#ddd':'#3A3B40','#ccc':'#4A4B50'}
TX={'#9a5b00':'#E8B04A','#1f5fa8':'#7DB3F0','#2f3a4e':'#C9D2E3','#44546a':'#AEB9CC','#1e6b2e':'#7BCB8A','#8a5300':'#E8B04A','#6b2c8a':'#C9A0E0','#555':'#B5B7BC','#444':'#C2C4C8','#333':'#D0D2D6','#222':'#E0E0E2','#b42318':'#FF8A82','#9b111e':'#FF8A82','#2f2f2f':'#E6E6E8','#888':'#9A9CA2','#666':'#A8AAAF','#000':'#EDEDED','#1a1a1a':'#E6E6E8','#2e7d32':'#6FCF7C','#b8161f':'#FF6B73','#141414':'#E6E6E8','#6b6b6b':'#A8AAAF','#067647':'#6FCF7C','#757575':'#A8AAAF'}
def conv(prop,val):
    prop=prop.strip().lower();ov=val
    def r(m):
        c=m.group(0).lower()
        if prop=='color':
            return TX.get(c,m.group(0))
        if prop.startswith('--'):
            return BG.get(c,TX.get(c,m.group(0)))
        if c in('#fff','#ffffff') and prop in('border-color',):return '#34363B'
        return BG.get(c,m.group(0))
    val=re.sub(r'#[0-9a-fA-F]{3,6}\b|\bwhite\b',r,val)
    if prop=='color':
        val=val.replace('var(--trl-red-dark)','#FF8A90').replace('var(--trl-red)','#FF5A63')
    return None if val==ov else val
def sels(pre):
    out=[]
    for s in pre.split(','):
        s=s.strip()
        if not s:continue
        # :where() = especificidade zero: a regra escura empata com a original e vence só por vir depois
        if s.startswith(':root'):out.append(':where(html.escuro)'+s[5:])
        elif s.startswith('html'):out.append(':where(html.escuro)'+s[4:])
        else:out.append(':where(html.escuro) '+s)
    return ','.join(out)
def walk(txt):
    res=[];pos=0;n=len(txt)
    while pos<n:
        b=txt.find('{',pos)
        if b<0:break
        pre=txt[pos:b].strip();depth=1;q=b+1
        while q<n and depth:
            if txt[q]=='{':depth+=1
            elif txt[q]=='}':depth-=1
            q+=1
        body=txt[b+1:q-1];pos=q
        if pre.startswith('@media') or pre.startswith('@supports'):
            inner=walk(body)
            if inner and not ('print' in pre):res.append(pre+'{'+inner+'}')
        elif pre.startswith('@'):continue
        else:
            ds=[]
            for d in body.split(';'):
                if ':' not in d:continue
                pr,_,v=d.partition(':')
                if pr.strip().startswith('--trl-'):continue
                nv=conv(pr,v)
                if nv is not None:ds.append(pr.strip()+':'+nv.strip())
            if ds:res.append(sels(pre)+'{'+';'.join(ds)+'}')
    return ''.join(res)
dark=walk(css)
base=('html.escuro{color-scheme:dark;--trl-text:#E6E6E8;--trl-gray:#A0A2A8;--trl-bg:#121316;--trl-card:#1E1F22;--trl-line:#34363B;--trl-pink:#3A1E21;--trl-pink-2:#7A3A40;--trl-soft:#26272B;--trl-ok:#6FCF7C;--trl-warn:#E8B04A;--trl-warn-bg:#3A2E17;--trl-shadow:0 1px 3px rgba(0,0,0,.5)}'
 'html.escuro body{background:var(--trl-bg);color:var(--trl-text)}'
 # prévias de e-mail ficam claras (o e-mail sai claro)
 'html.escuro .sl-prev{background:#fff!important;color:#000!important;border-color:#34363B}'
 # estilos inline claros gerados pelo JS
 'html.escuro [style*="background:#fff"],html.escuro [style*="background:#FFF;"],html.escuro [style*="background: #fff"]{background:var(--trl-card)!important}'
 'html.escuro [style*="background:#FFF4E0"]{background:#3A2E17!important;color:#E8B04A!important}'
 'html.escuro input,html.escuro select,html.escuro textarea{background:#17181B;color:var(--trl-text);border-color:#3A3B40}'
 'html.escuro ::placeholder{color:#7D8086}'
 'html.escuro img:not(#hdrLogoB):not(#lgLogo){filter:none}')
blk='\n<style id="temaEscuro">/* gerado por gera_escuro.py — não editar à mão */'+base+dark+'</style>'
j2=t.find('</style>',k)+len('</style>')
t=t[:j2]+blk+t[j2:]
open(P,'w').write(t)
print('regras escuras:',dark.count('{'),'tamanho:',len(blk))
