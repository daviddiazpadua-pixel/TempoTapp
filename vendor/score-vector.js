/* TempoTapp exact score reader (vector + text layer).
 * Digitally engraved PDFs (Sibelius, Dorico, MuseScore, Finale, LilyPond…) store staff lines and barlines as
 * real lines and store time signatures, tempo marks and measure numbers as text in a music font. Reading those
 * directly gives exact measures; the image reader is only needed for scans. Everything here is pure JS, no network.
 * Coordinates returned are page fractions (0..1, top-left origin) like the image reader's boxes.
 */
(function(root){
'use strict';
// ---------- glyph tables ----------
// Opus/Helsinki/Maestro/Engraver (Sibelius, Finale legacy) put music symbols on ASCII/Latin-1 code points;
// SMuFL fonts (Bravura, Leland, Petaluma, Finale Maestro SMuFL, Dorico, MuseScore 4) use the private-use area.
const NOTEHEAD=new Set(['œ','˙','w','W','Ï','ú','Ú','¿','Ñ','Ò']),REST=new Set(['Œ','‰','≈','Ó','∑','®','Ô','Â','Ê','Î']);
const isSmufl=c=>c>=0xE000&&c<=0xF8FF;
const smuflKind=c=>(c>=0xE0A0&&c<=0xE0FF)?'note':(c>=0xE4E0&&c<=0xE4FF)?'rest':(c>=0xE080&&c<=0xE089)?'tsdigit':(c===0xE08A)?'common':(c===0xE08B)?'cut':(c>=0xE050&&c<=0xE07F)?'clef':(c>=0xECA0&&c<=0xECB6)?'metnote':(c===0xECB7)?'metdot':(c>=0xE260&&c<=0xE26F)?'acc':(c>=0xE4C0&&c<=0xE4CF)?'fermata':null;
const MET_SMUFL={0xECA0:8,0xECA2:4,0xECA3:2,0xECA4:2,0xECA5:1,0xECA6:1,0xECA7:.5,0xECA8:.5,0xECA9:.25,0xECAA:.25,0xECAB:.125,0xECAC:.125};
const MET_UNI={'♩':1,'♪':.5,'\u{1D15F}':1,'\u{1D15E}':2,'\u{1D15D}':4,'\u{1D160}':.5,'\u{1D161}':.25};
const MET_OPUS={q:1,e:.5,h:2,w:4,x:.25,Q:1,E:.5,H:2};
const TEMPO_WORDS=[['prestissimo',200],['presto',176],['vivacissimo',172],['vivace',156],['allegro molto',152],['allegro assai',152],['allegro moderato',116],['allegretto',112],['allegro',132],['moderato',104],['andantino',92],['andante',84],['adagietto',72],['adagio',66],['larghetto',60],['lento',52],['largo',50],['grave',40]];
const isMusicFont=n=>/opus|maestro|helsinki|engraver|petrucci|jazz|inkpen|reprise|norfolk|pmw|bravura|leland|petaluma|sebastian|gootville|leipzig|finale ?maestro|finale ?ash|finale ?jazz|broadway|golden|emmentaler|feta|musejazz|november|smufl|sonata|toccata|kousaku|musescore|mscore|academico|edwin|ekmelos|gonville|lilyjazz/i.test(n||'');

// ---------- extraction ----------
function mul(A,B){return[A[0]*B[0]+A[2]*B[1],A[1]*B[0]+A[3]*B[1],A[0]*B[2]+A[2]*B[3],A[1]*B[2]+A[3]*B[3],A[0]*B[4]+A[2]*B[5]+A[4],A[1]*B[4]+A[3]*B[5]+A[5]]}
function ap(M,x,y){return[M[0]*x+M[2]*y+M[4],M[1]*x+M[3]*y+M[5]]}
async function extractPage(page,OPS){
  const vp=page.getViewport({scale:1}),W=vp.width,H=vp.height,V=vp.transform,ol=await page.getOperatorList();
  const segs=[],fills=[];let ctm=V,stack=[],lw=1,pending=null,imgArea=0;
  const fn=ol.fnArray,args=ol.argsArray;
  for(let i=0;i<fn.length;i++){const f=fn[i],a=args[i];
    if(f===OPS.save)stack.push([ctm,lw]);else if(f===OPS.restore){const s=stack.pop();if(s){ctm=s[0];lw=s[1]}}
    else if(f===OPS.transform)ctm=mul(ctm,a);
    else if(f===OPS.paintFormXObjectBegin){stack.push([ctm,lw]);if(Array.isArray(a?.[0])&&a[0].length===6)ctm=mul(ctm,a[0])}
    else if(f===OPS.paintFormXObjectEnd){const s=stack.pop();if(s){ctm=s[0];lw=s[1]}}
    else if(f===OPS.setLineWidth)lw=a[0];
    else if(f===OPS.paintImageXObject||f===OPS.paintInlineImageXObject||f===OPS.paintImageMaskXObject||f===OPS.paintImageXObjectRepeat){const sc=Math.abs(ctm[0]*ctm[3]-ctm[1]*ctm[2]);imgArea+=sc}
    // a path can be built over several constructPath ops before it is painted: keep them together
    else if(f===OPS.constructPath){(pending=pending||{pieces:[]}).pieces.push({ops:a[0],co:a[1],ctm})}
    else if(pending&&(f===OPS.stroke||f===OPS.closeStroke||f===OPS.fill||f===OPS.eoFill||f===OPS.fillStroke||f===OPS.eoFillStroke||f===OPS.closeFillStroke||f===OPS.closeEOFillStroke||f===OPS.endPath)){
      const stroke=f===OPS.stroke||f===OPS.closeStroke||f===OPS.fillStroke||f===OPS.eoFillStroke||f===OPS.closeFillStroke||f===OPS.closeEOFillStroke,fill=f===OPS.fill||f===OPS.eoFill||f===OPS.fillStroke||f===OPS.eoFillStroke||f===OPS.closeFillStroke||f===OPS.closeEOFillStroke;
      if(f!==OPS.endPath)emitPath(pending,stroke,fill,lw,segs,fills);pending=null}
  }
  const tc=await page.getTextContent(),text=[];
  for(const it of tc.items){if(!it.str||!it.str.trim())continue;let font=it.fontName;try{const o=page.commonObjs.get(it.fontName);font=o?.name||o?.loadedName||font}catch{}
    const t=it.transform,P=ap(V,t[4],t[5]),size=Math.hypot(t[2],t[3])||Math.hypot(t[0],t[1]);text.push({s:it.str,x:P[0],y:P[1],size,w:it.width||size*.5*it.str.length,font,music:isMusicFont(font)})}
  return{W,H,segs,fills,text,imageCover:imgArea/(W*H)};
}
function emitPath(p,stroke,fill,lw,segs,fills){
  let cur=null,start=null;const scale=Math.hypot(p.pieces[0].ctm[0],p.pieces[0].ctm[1])||1,w=lw*scale;
  const sub=[];// polygon points for fill bbox
  for(const {ops,co,ctm} of p.pieces){let k=0;for(const op of ops){
    if(op===13){cur=ap(ctm,co[k],co[k+1]);start=cur;k+=2;sub.push([cur])}
    else if(op===14){const n=ap(ctm,co[k],co[k+1]);k+=2;if(stroke&&cur)segs.push({x0:cur[0],y0:cur[1],x1:n[0],y1:n[1],w});cur=n;sub.length&&sub.at(-1).push(n)}
    else if(op===15){const n=ap(ctm,co[k+4],co[k+5]);k+=6;cur=n;sub.length&&sub.at(-1).push(n,null)}
    else if(op===16||op===17){const n=ap(ctm,co[k+2],co[k+3]);k+=4;cur=n;sub.length&&sub.at(-1).push(n,null)}
    else if(op===18){if(stroke&&cur&&start)segs.push({x0:cur[0],y0:cur[1],x1:start[0],y1:start[1],w});cur=start}
    else if(op===19){const x=co[k],y=co[k+1],ww=co[k+2],hh=co[k+3];k+=4;const q=[ap(ctm,x,y),ap(ctm,x+ww,y),ap(ctm,x+ww,y+hh),ap(ctm,x,y+hh)];sub.push(q);if(stroke)for(let j=0;j<4;j++)segs.push({x0:q[j][0],y0:q[j][1],x1:q[(j+1)%4][0],y1:q[(j+1)%4][1],w})}
  }}
  if(fill)for(const s of sub){const P=s.filter(Boolean);if(P.length<3)continue;const curved=s.includes(null);let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const[x,y]of P){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}fills.push({x0,x1,y0,y1,curved,n:P.length})}
}

// ---------- analysis ----------
function median(a){if(!a.length)return 0;const s=[...a].sort((p,q)=>p-q);return s[s.length>>1]}
function hLines(raw){
  const L=[];
  for(const s of raw.segs){if(Math.abs(s.y1-s.y0)<=Math.max(.35,s.w*.6)&&Math.abs(s.x1-s.x0)>4)L.push({x0:Math.min(s.x0,s.x1),x1:Math.max(s.x0,s.x1),y:(s.y0+s.y1)/2})}
  for(const f of raw.fills){const h=f.y1-f.y0,w=f.x1-f.x0;if(!f.curved&&h<=1.6&&w>8&&w>h*12)L.push({x0:f.x0,x1:f.x1,y:(f.y0+f.y1)/2})}
  // join collinear pieces (staff lines drawn per measure)
  L.sort((a,b)=>a.y-b.y||a.x0-b.x0);const out=[];
  for(const l of L){const m=out.find(o=>Math.abs(o.y-l.y)<.4&&l.x0<=o.x1+.6&&l.x1>=o.x0-.6);if(m){m.x0=Math.min(m.x0,l.x0);m.x1=Math.max(m.x1,l.x1);m.y=(m.y+l.y)/2}else out.push({...l})}
  return out}
function vLines(raw){
  const L=[];
  for(const s of raw.segs){if(Math.abs(s.x1-s.x0)<=Math.max(.35,s.w*.6)&&Math.abs(s.y1-s.y0)>3)L.push({x:(s.x0+s.x1)/2,y0:Math.min(s.y0,s.y1),y1:Math.max(s.y0,s.y1),w:s.w})}
  for(const f of raw.fills){const h=f.y1-f.y0,w=f.x1-f.x0;if(!f.curved&&w<=7&&h>6&&h>w*3)L.push({x:(f.x0+f.x1)/2,y0:f.y0,y1:f.y1,w})}
  L.sort((a,b)=>a.x-b.x||a.y0-b.y0);const out=[];
  for(const l of L){const m=out.find(o=>Math.abs(o.x-l.x)<.5&&l.y0<=o.y1+1.2&&l.y1>=o.y0-1.2);if(m){m.y0=Math.min(m.y0,l.y0);m.y1=Math.max(m.y1,l.y1);m.w=Math.max(m.w,l.w)}else out.push({...l})}
  return out}
function findStaves(H){
  const long=H.filter(l=>l.x1-l.x0>40).sort((a,b)=>a.y-b.y),used=new Set(),staves=[];
  for(let i=0;i<long.length;i++){if(used.has(i))continue;const a=long[i];
    // try every next line as the 2nd line, then require 3 more at the same spacing with overlapping x
    for(let j=i+1;j<long.length;j++){const b=long[j],sp=b.y-a.y;if(sp<2)continue;if(sp>14)break;const same=(p,q)=>Math.abs(p.x0-q.x0)<=Math.max(2,sp)&&Math.abs(p.x1-q.x1)<=Math.max(2,sp);if(!same(a,b))continue;
      const idx=[i,j];for(let k=2;k<5;k++){const want=a.y+sp*k;let best=-1;for(let q=j+1;q<long.length;q++){const c=long[q];if(c.y>want+sp*.2)break;if(Math.abs(c.y-want)<=sp*.12&&same(a,c)&&!used.has(q)){best=q;break}}if(best<0)break;idx.push(best)}
      if(idx.length===5){idx.forEach(q=>used.add(q));const ls=idx.map(q=>long[q]);staves.push({top:ls[0].y,bottom:ls[4].y,sp:(ls[4].y-ls[0].y)/4,x0:median(ls.map(l=>l.x0)),x1:median(ls.map(l=>l.x1)),lines:ls.map(l=>l.y)});break}}}
  return staves.sort((a,b)=>a.top-b.top)}
function analyzePage(raw){
  const {W,H}=raw,Hl=hLines(raw),Vl=vLines(raw),staves=findStaves(Hl);
  const res={W,H,staves,systems:[],text:raw.text,ok:false,imageCover:raw.imageCover||0};if(!staves.length)return res;
  const sp=median(staves.map(s=>s.sp)),tol=Math.max(.6,sp*.3),etol=Math.max(.3,sp*.07);
  const near=(v,t)=>Math.abs(v-t)<=tol;
  // systems: staves joined by a vertical line whose ends sit on a staff's top and a lower staff's bottom
  const parent=staves.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  for(const v of Vl){const ti=staves.findIndex(s=>near(v.y0,s.top)&&v.x>=s.x0-sp*3&&v.x<=s.x1+sp),bi=staves.findIndex(s=>near(v.y1,s.bottom)&&v.x>=s.x0-sp*3&&v.x<=s.x1+sp);if(ti>=0&&bi>ti)for(let k=ti+1;k<=bi;k++)parent[find(k)]=find(ti)}
  const groups={};staves.forEach((s,i)=>{(groups[find(i)]=groups[find(i)]||[]).push(s)});
  const systems=Object.values(groups).map(st=>({staves:st.sort((a,b)=>a.top-b.top)})).sort((a,b)=>a.staves[0].top-b.staves[0].top);
  for(const sys of systems){const st=sys.staves;sys.top=st[0].top;sys.bottom=st.at(-1).bottom;sys.x0=Math.min(...st.map(s=>s.x0));sys.x1=Math.max(...st.map(s=>s.x1));sys.sp=median(st.map(s=>s.sp));
    // barline candidates: vertical lines whose ends sit exactly on staff boundary lines
    const cand=[];for(const v of Vl){if(v.x<sys.x0+sys.sp*.4||v.x>sys.x1+sys.sp*.6)continue;const cov=[];for(let k=0;k<st.length;k++){const s=st[k];if(v.y0<=s.top+tol&&v.y1>=s.bottom-tol)cov.push(k)}if(!cov.length)continue;
      const topOk=st.some(s=>Math.abs(v.y0-s.top)<=etol),botOk=st.some(s=>Math.abs(v.y1-s.bottom)<=etol);if(!topOk||!botOk)continue;cand.push({x:v.x,cov,w:v.w})}
    cand.sort((a,b)=>a.x-b.x);const ex=[];for(const c of cand){const l=ex.at(-1);if(l&&c.x-l.x<=Math.max(.6,c.w)){l.cov=new Set([...l.cov,...c.cov]);l.w=Math.max(l.w,c.w)}else ex.push({x:c.x,cov:new Set(c.cov),w:c.w})}
    const need=Math.max(1,st.length-Math.floor(st.length/3)),ok=ex.filter(c=>c.cov.size>=need),cl=[];
    for(const c of ok){const last=cl.at(-1);if(last&&c.x-last.x1<=sys.sp*1.2){last.x1=c.x;last.n++;last.w=Math.max(last.w,c.w)}else cl.push({x0:c.x,x1:c.x,n:1,w:c.w})}
    sys.bars=cl.map(c=>({x0:c.x0,x1:c.x1,double:c.n>1,thick:c.w>sys.sp*.3}));
    // the system's right edge always closes the last measure
    if(!sys.bars.length||sys.x1-sys.bars.at(-1).x1>sys.sp*1.5)sys.bars.push({x0:sys.x1,x1:sys.x1,implied:true});
  }
  res.systems=systems.filter(s=>s.bars.length);res.sp=sp;res.ok=res.systems.length>0;
  readText(res);return res}

// ---------- text layer: measure numbers, time signatures, tempo marks, titles ----------
function tokens(items,gapF=.45){// join adjacent glyphs of the same font/size/baseline into words
  const it=[...items].sort((a,b)=>Math.round(a.y)-Math.round(b.y)||a.x-b.x),out=[];
  for(const t of it){const l=out.at(-1);if(l&&l.font===t.font&&Math.abs(l.size-t.size)<.3&&Math.abs(l.y-t.y)<l.size*.25&&t.x-(l.x+l.w)<l.size*gapF&&t.x>=l.x){l.s+=(t.x-(l.x+l.w)>l.size*.18&&!/\s$/.test(l.s)?' ':'')+t.s;l.w=t.x+t.w-l.x}else out.push({...t})}
  return out}
function sysAt(res,y,above=true){// the system whose staff region contains y, or the next system below y (for marks above a system)
  let best=null,bd=1e9;for(const s of res.systems){const pad=s.sp*2;if(y>=s.top-pad&&y<=s.bottom+pad)return s;const d=s.top-y;if(above&&d>0&&d<bd&&d<s.sp*14){bd=d;best=s}}return best}
function readText(res){
  const T=res.text,sp=res.sp;res.numbers=[];res.timesigs=[];res.tempos=[];res.words=[];res.titles=[];res.notes=[];
  // music-font glyphs: noteheads/rests (for beat placement) and time-signature digits
  const mus=T.filter(t=>t.music||[...t.s].some(ch=>isSmufl(ch.codePointAt(0))));
  const tsd=[];
  for(const t of mus){let x=t.x;const step=t.s.length>1?t.w/t.s.length:t.w;for(const ch of t.s){const c=ch.codePointAt(0),k=isSmufl(c)?smuflKind(c):null;
      if(k==='tsdigit'||(!isSmufl(c)&&/[0-9]/.test(ch)&&t.size>sp*2.5))tsd.push({d:k==='tsdigit'?c-0xE080:+ch,x,y:t.y,size:t.size,w:step});
      else if(k==='common'||k==='cut'||(!isSmufl(c)&&(ch==='c'||ch==='C')&&t.size>sp*2.5&&!/text/i.test(t.font)))tsd.push({sym:k==='cut'||ch==='C'?'2/2':'4/4',x,y:t.y,size:t.size,w:step});
      else if(k==='note'||k==='rest'||NOTEHEAD.has(ch)||REST.has(ch))res.notes.push({x:x+step/2,y:t.y,rest:k==='rest'||REST.has(ch)});
      x+=step}}
  // time signatures: a numerator above the staff middle and a denominator below, at the same x, inside a staff
  for(const sys of res.systems)for(const st of sys.staves){const mid=(st.top+st.bottom)/2,inStaff=tsd.filter(d=>d.y>st.top-st.sp*.6&&d.y<st.bottom+st.sp*2.6&&d.x>=sys.x0-st.sp&&d.x<=sys.x1+st.sp);
    const used=new Set();for(const d of inStaff){if(d.sym){res.timesigs.push({x:d.x,x1:d.x+d.w,staffTop:st.top,meter:d.sym,sys});continue}}
    const tops=inStaff.filter(d=>!d.sym&&d.y<=mid+st.sp*.25),bots=inStaff.filter(d=>!d.sym&&d.y>mid+st.sp*.25);
    // group digits per column (multi-digit numbers sit side by side)
    const col=arr=>{const s=[...arr].sort((a,b)=>a.x-b.x),g=[];for(const d of s){const l=g.at(-1);if(l&&d.x-l.x1<st.sp*1.1&&Math.abs(d.y-l.y)<st.sp*.5){l.v=l.v*10+d.d;l.x1=d.x+d.w}else g.push({v:d.d,x:d.x,x1:d.x+d.w,y:d.y})}return g};
    const T1=col(tops),B1=col(bots),DEN=[1,2,4,8,16,32];for(const a of T1){const b=B1.find(q=>Math.abs((q.x+q.x1)/2-(a.x+a.x1)/2)<st.sp*1.6);if(!b)continue;
      if(DEN.includes(b.v)&&a.v>0&&a.v<=32){res.timesigs.push({x:Math.min(a.x,b.x),x1:Math.max(a.x1,b.x1),staffTop:st.top,meter:`${a.v}/${b.v}`,sys});continue}
      const ta=String(a.v),tb=String(b.v);if(ta.length===tb.length&&ta.length>1&&[...tb].every(d=>DEN.includes(+d))){const alts=[...ta].map((d,i)=>`${d}/${tb[i]}`);res.timesigs.push({x:Math.min(a.x,b.x),x1:Math.max(a.x1,b.x1),staffTop:st.top,meter:alts[0],alt:alts,sys})}}}
  // plain-text tokens (all fonts) for numbers, tempo words and titles
  const isMet=t=>[...t.s].every(ch=>{const c=ch.codePointAt(0);return MET_SMUFL[c]||c===0xECB7||MET_UNI[ch]||ch===' '}),glyphFont=t=>t.music&&!/text/i.test(t.font)&&!isMet(t),words=tokens(T.filter(t=>!glyphFont(t)),.6);
  const big=words.length?median(words.map(w=>w.size)):10;
  for(const w of words){const sys=sysAt(res,w.y);
    if(/^\d{1,4}$/.test(w.s)&&!w.music&&sys&&w.size<sys.sp*3.2){
      // measure numbers sit above a staff (any staff of the system: ossia staves can sit on top), at/after a barline
      const st=sys.staves.find(s=>w.y<s.top+s.sp*.7&&w.y>s.top-s.sp*7&&w.x>=s.x0-s.sp*2&&w.x<=s.x1);if(st)res.numbers.push({n:+w.s,x:w.x,x1:w.x+w.w,y:w.y,size:w.size,sys,font:w.font})}}
  // assemble lines (same baseline) across fonts for tempo marks: "<note> = 120", "q. = 60", "Allegro (q = 132)"
  const lines=[];for(const w of [...words].sort((a,b)=>a.y-b.y||a.x-b.x)){const l=lines.find(L=>Math.abs(L.y-w.y)<Math.max(2,w.size*.35)&&w.x-L.x1<Math.max(L.size,w.size)*1.6&&w.x>=L.x-1);if(l){l.parts.push(w);l.x1=Math.max(l.x1,w.x+w.w);l.size=Math.max(l.size,w.size)}else lines.push({y:w.y,x:w.x,x1:w.x+w.w,size:w.size,parts:[w]})}
  for(const L of lines){L.parts.sort((a,b)=>a.x-b.x);L.str=L.parts.map(p=>p.s).join(' ');const sys=sysAt(res,L.y);L.sys=sys;
    // metronome mark
    const P=L.parts;for(let i=0;i<P.length;i++){if(!/=/.test(P[i].s))continue;let num=null;const after=(P[i].s.split('=')[1]||'').trim()||(P[i+1]?.s||'');const m=after.match(/^c?a?\.?\s*(\d{2,3}(?:\.\d+)?)/)||(P[i+2]&&/^\d{2,3}$/.test(P[i+2].s)&&!P[i+1].s.match(/\d/)?[0,P[i+2].s]:null);if(m)num=+m[1];if(!num)continue;
      // unit = the note glyph right before this "="
      let unit=null,j=i-(P[i].s.trim()==='='?1:0);const nb=(P[i].s.split('=')[0]||'').trim();const cand=nb?[nb,...P.slice(0,i).reverse().map(p=>p.s)]:P.slice(0,i).reverse().map(p=>p.s);
      let dots=0;for(const s0 of cand.slice(0,3)){const s=s0.trim();if(!s)continue;let base=null;for(const ch of s){const c=ch.codePointAt(0);if(MET_SMUFL[c])base=MET_SMUFL[c];else if(MET_UNI[ch])base=MET_UNI[ch];else if(MET_OPUS[ch]&&s.length<=3)base=MET_OPUS[ch];else if(ch==='.'||c===0xECB7)dots++}
        if(base){unit=base*(dots?1.5:1);break}if(s==='.'){dots++;continue}}
      if(unit&&num>=20&&num<=400)res.tempos.push({x:L.x,y:L.y,bpm:num,unit,qpm:num*unit,sys,text:L.str})}
    const low=L.str.toLowerCase().replace(/\s+/g,' ');
    if(sys){// position of each word = x of the glyph run where it starts (several marks can share a baseline)
      const offs=[];let acc='';for(const p of L.parts){offs.push([acc.length,p.x]);acc+=(acc?' ':'')+p.s}const xAt=i=>{let x=L.x;for(const [o,px] of offs)if(o<=i)x=px;return x};const lowS=acc.toLowerCase();
      for(const [re,kind] of [[/\b(accel(\.|erando)?|stringendo|string\.)/g,'accel'],[/\b(rall(\.|entando)?|rit(\.|ardando|\.)?|ritard\.?|allarg(\.|ando)|calando|slentando|morendo)(?![a-z])/g,'rall'],[/\ba tempo\b|\btempo i\b|\btempo primo\b/g,'atempo'],[/\b(free|senza misura|ad lib|colla voce|out of time)\b/g,'free']])for(const mm of lowS.matchAll(re))res.words.push({kind,x:xAt(mm.index),y:L.y,sys,text:L.str})}
    if(sys&&!res.tempos.some(t=>Math.abs(t.y-L.y)<3))for(const [w,b] of TEMPO_WORDS)if(new RegExp('^\\W*'+w+'\\b').test(low)){res.tempos.push({x:L.x,y:L.y,bpm:b,unit:1,qpm:b,sys,text:L.str,word:true});break}
    if(L.size>=big*1.7&&!L.parts.some(p=>p.music)&&!/=/.test(L.str)&&(L.str.match(/[A-Za-z]/g)||[]).length>=4&&!res.tempos.some(t=>Math.abs(t.y-L.y)<3))res.titles.push({y:L.y,x:L.x,text:L.str.trim(),size:L.size})}
  // a title is clearly larger than the page's tempo/expression text (which is itself large and bold)
  const ref=Math.max(0,...lines.filter(L=>res.tempos.some(t=>Math.abs(t.y-L.y)<3)||res.words.some(w=>Math.abs(w.y-L.y)<3)).flatMap(L=>L.parts.filter(p=>!p.music&&/[A-Za-z0-9]/.test(p.s)).map(p=>p.size)));
  // ...and is not a rehearsal mark ("M  More motion": a boxed letter/number followed by text)
  res.titles=res.titles.filter(t=>{const L=lines.find(q=>q.y===t.y&&q.x===t.x);return t.size>=ref*1.3&&!res.words.some(w=>Math.abs(w.y-t.y)<3)&&!(L&&L.parts.length>1&&/^([A-Z]|\d{1,3})$/.test(L.parts[0].s.trim()))});
}

// ---------- measures per page and across the document ----------
function pageMeasures(res,pageNo){
  const out=[];res.systems.forEach((sys,si)=>{let x=sys.x0;sys.bars.forEach((b,bi)=>{const x1=b.x0;if(x1-x<sys.sp*1.2){x=b.x1;return}
      out.push({page:pageNo,system:si,sysRef:sys,x0:x,x1:b.x0,xEnd:b.x1,implied:!!b.implied,top:sys.top,bottom:sys.bottom,sp:sys.sp,first:bi===0||out.length===0||out.at(-1).system!==si,barKind:b.double?(b.thick?'final':'double'):'single'});x=b.x1})});
  return out}
function analyzeDocument(pages){
  // pages: [{res, page}] in order. Returns measures with printed numbers reconciled, meters, tempos, sections.
  const M=[];let warnings=[];
  pages.forEach(({res},pi)=>{if(!res.ok)return;const ms=pageMeasures(res,pi+1);
    for(const m of ms){const sys=m.sysRef;
      // printed number: one sitting at the start of this measure (within ~2 spaces of its left edge)

      // time signature printed in this measure (first one on the top staff, or any staff)
      const ts=res.timesigs.filter(t=>t.sys===sys&&t.x>=m.x0-sys.sp*.5&&t.x<m.x1-sys.sp*.3);if(ts.length){const votes={};for(const t of ts)votes[t.meter]=(votes[t.meter]||0)+1;m.meter=Object.entries(votes).sort((a,b)=>b[1]-a[1])[0][0];m.tsX=Math.max(...ts.filter(t=>t.meter===m.meter).map(t=>t.x1))}
      // courtesy time signature at the end of a system belongs to the next measure, not this one
      if(m.meter&&ts.every(t=>t.x>m.x1-sys.sp*4)&&ms.indexOf(m)===ms.length-1||(m.meter&&m.x1-m.x0<sys.sp*5&&ts.every(t=>t.x>m.x0+sys.sp*.2)&&m===ms.filter(q=>q.system===m.system).at(-1))){m.courtesy=m.meter;m.meter=undefined}
      const sysMs=ms.filter(q=>q.system===m.system),k=sysMs.indexOf(m),lo=k===0?-1e9:m.x0-sys.sp*1.5,hi=k===sysMs.length-1?1e9:sysMs[k+1].x0-sys.sp*1.5,inM=t=>t.sys===sys&&t.x>=lo&&t.x<hi;
      const tm=res.tempos.filter(inM);if(tm.length)m.tempo=tm.sort((a,b)=>a.x-b.x).at(-1);
      const wd=res.words.filter(inM);if(wd.length)m.words=[...new Set(wd.sort((a,b)=>a.x-b.x).map(w=>w.kind))];
      m._ev=[...tm.map(t=>({kind:'set',x:t.x,qpm:t.qpm,bpm:t.bpm,unit:t.unit,word:!!t.word})),...wd.map(w=>({kind:w.kind,x:w.x,molto:/molto|much/i.test(w.text),poco:/poco|un peu|a little/i.test(w.text)}))];
      if(ts.some(t=>t.alt))m.meterAlt=ts.find(t=>t.alt).alt;
      // where the music starts in the measure (after clef/key/time) and the note columns, for beat placement
      const cols=[...new Set(res.notes.filter(n=>n.x>m.x0+sys.sp*.3&&n.x<m.x1-sys.sp*.2&&n.y>=sys.top-sys.sp*6&&n.y<=sys.bottom+sys.sp*6).map(n=>Math.round(n.x*2)/2))].sort((a,b)=>a-b);
      const cc=[];for(const c of cols){if(!cc.length||c-cc.at(-1)>sys.sp*.6)cc.push(c)}m.cols=cc;m.cx0=Math.max(m.x0,cc.length?cc[0]-sys.sp*.6:m.x0);if(m.tsX&&m.tsX>m.cx0)m.cx0=m.tsX+sys.sp*.4;
      {const hi=m.first?Math.max(m.cx0,m.x0)+sys.sp*5:m.x0+Math.min(sys.sp*4,(m.x1-m.x0)*.5),nums=res.numbers.filter(n=>n.sys===sys&&n.x>=m.x0-sys.sp*2.2&&n.x<hi);m.printed=nums.length?nums.sort((a,b)=>Math.abs(a.x-m.x0)-Math.abs(b.x-m.x0))[0].n:null}
      // title (big text) between the previous system and this one starts a new section
      m.title=null;if(m.first){const prev=res.systems[res.systems.indexOf(sys)-1],ts=res.titles.filter(t=>t.y<sys.top&&(!prev||t.y>prev.bottom)).sort((a,b)=>a.y-b.y);if(ts.length){const big=Math.max(...ts.map(t=>t.size));m.title=ts.filter(t=>t.size>=big*.6).map(t=>t.text).join(' · ').slice(0,90)}}
      // the space after the last barline of a line holds only a courtesy time signature/key: not a measure
      if(m.implied&&!m.cols.length){const prev=M.at(-1);if(m.meter&&prev&&prev.page===m.page&&prev.system===m.system)prev.courtesy=m.meter;continue}
      M.push(m)}});
  // measures that continue across a system break (no barline at the end of a line) are rare in engraved
  // output; keep each box but number consecutively. Reconcile with printed numbers when present.
  let n=0;for(const m of M){n++;m.measure=n;
    // event position as a fraction of the measure's music (0 = beat 1, 1 = the barline)
    const span=Math.max(1,m.x1-m.cx0);m.events=(m._ev||[]).map(e=>({...e,frac:Math.max(0,Math.min(.999,(e.x-m.cx0)/span))})).sort((a,b)=>a.frac-b.frac||(b.kind==='set')-(a.kind==='set'));delete m._ev}
  // printed numbering: fill gaps and spot restarts (a later section that starts its own numbering)
  let prevLabel=0;for(const m of M){if(Number.isFinite(m.printed)){m.restart=m.printed<prevLabel-1||(!!m.title&&m.printed!==prevLabel+1);m.label=m.printed}else m.label=prevLabel+1;if(m.measure===1)m.restart=false;prevLabel=m.label}
  const withNum=M.filter(m=>Number.isFinite(m.printed));let agree=0;
  for(let i=1;i<withNum.length;i++){const a=withNum[i-1],b=withNum[i];if(b.printed-a.printed===b.measure-a.measure)agree++}
  const mismatches=[];for(let i=1;i<withNum.length;i++){const a=withNum[i-1],b=withNum[i];if(b.printed-a.printed!==b.measure-a.measure&&!M.slice(M.indexOf(a)+1,M.indexOf(b)+1).some(q=>q.restart))mismatches.push({from:a.measure,to:b.measure,printedFrom:a.printed,printedTo:b.printed})}
  const report={measures:M.length,printed:withNum.length,consistentPairs:agree,pairs:Math.max(0,withNum.length-1),mismatches};
  return{measures:M,report}
}
const api={extractPage,analyzePage,analyzeDocument,pageMeasures,_:{hLines,vLines,findStaves,tokens}};
if(typeof module!=='undefined'&&module.exports)module.exports=api;root.TempoVector=api;
})(typeof window!=='undefined'?window:globalThis);
