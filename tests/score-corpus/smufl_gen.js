// Engraved-style test PDFs with SMuFL fonts as real text (like Dorico/MuseScore/Finale exports).
// truth: measures, meter changes, tempo changes; numbering at system starts (numbers='sys') or every bar ('all') or none.
const {chromium}=require('playwright');const fs=require('fs');
const sp=7, W=612, H=792, L=60, R=560;
function piece(seed){let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
  const meters=['4/4','3/4','6/8','5/4','7/8','2/4','9/8'];const ms=[];let cur='4/4',tempo=96;
  for(let i=1;i<=34;i++){let ev={};if(i===1){ev.meter=cur;ev.tempo={u:'q',v:tempo}}else if(rnd()<.18){let m;do m=meters[Math.floor(rnd()*meters.length)];while(m===cur);cur=m;ev.meter=m}
    if(i===12)ev.word='rall.';if(i===14){ev.word='a tempo'}if(i===20){tempo=72;ev.tempo={u:cur.endsWith('/8')&&+cur.split('/')[0]%3===0?'q.':'q',v:tempo}}if(i===17)ev.title='II. Second Movement';ms.push({n:i,meter:cur,...ev})}
  return ms}
function svg(ms,font,numbers){const pages=[];let page=[],y=110,first=true,sysStart=0;const perSys=4,sysH=sp*4*2+sp*8+40;
  let out=[];for(let i=0;i<ms.length;i+=perSys){const row=ms.slice(i,i+perSys);const extra=row[0].title?50:0;
    if(y+extra+sysH>H-40){pages.push(page);page=[];y=80}
    if(row[0].title)y+=30;
    if(row[0].title)page.push(`<text x="${W/2}" y="${y-8}" font-family="Times" font-size="22" text-anchor="middle">${row[0].title}</text>`),y+=20;
    const staves=[y,y+sp*4+sp*6];const x0=L,x1=R;
    for(const sy of staves)for(let k=0;k<5;k++)page.push(`<line x1="${x0}" y1="${sy+k*sp}" x2="${x1}" y2="${sy+k*sp}" stroke="#000" stroke-width="0.8"/>`);
    page.push(`<line x1="${x0}" y1="${staves[0]}" x2="${x0}" y2="${staves[1]+sp*4}" stroke="#000" stroke-width="1"/>`);
    // header: clef glyph + (time sig on first system / changes)
    for(const sy of staves)page.push(`<text x="${x0+4}" y="${sy+sp*3}" font-family="${font}" font-size="${sp*4}"></text>`);
    const hdr=36,mw=(x1-x0-hdr)/row.length;
    row.forEach((m,j)=>{const mx=x0+hdr+j*mw;let cx=mx+6;
      if(m.meter&&(m.n===1||ms[m.n-2].meter!==m.meter||j===0&&m.meter)){if(m.n===1||ms[m.n-2].meter!==m.meter){const [a,b]=m.meter.split('/');for(const sy of staves){page.push(`<text x="${cx}" y="${sy+sp*1}" font-family="${font}" font-size="${sp*4}">${[...a].map(d=>String.fromCodePoint(0xE080+ +d)).join('')}</text>`);page.push(`<text x="${cx}" y="${sy+sp*3}" font-family="${font}" font-size="${sp*4}">${[...b].map(d=>String.fromCodePoint(0xE080+ +d)).join('')}</text>`)}cx+=16}}
      if(m.tempo)page.push(`<text x="${mx+2}" y="${staves[0]-sp*3}" font-family="Times" font-size="12" font-weight="bold"><tspan font-family="${font}" font-size="18">${m.tempo.u==='q.'?'':''}</tspan> = ${m.tempo.v}</text>`);
      if(m.word)page.push(`<text x="${mx+2}" y="${staves[0]-sp*3}" font-family="Times" font-style="italic" font-size="12">${m.word}</text>`);
      if(numbers==='all'||numbers==='sys'&&j===0)page.push(`<text x="${mx+(j===0?-hdr+2:2)}" y="${staves[0]-sp*1.2}" font-family="Times" font-size="9">${m.n}</text>`);
      const [num,den]=m.meter.split('/').map(Number),beats=den===8&&num%3===0?num/3:num;
      for(let k=0;k<beats;k++){const nx=cx+4+(mw-(cx-mx)-12)*k/beats;for(const sy of staves)page.push(`<text x="${nx}" y="${sy+sp*(1.5+((k+j)%4)*0.5)}" font-family="${font}" font-size="${sp*4}"></text>`),page.push(`<line x1="${nx+sp*1.15}" y1="${staves[0]+sp*(1.5+((k+j)%4)*.5)}" x2="${nx+sp*1.15}" y2="${staves[0]+sp*(1.5+((k+j)%4)*.5)-sp*3.5}" stroke="#000" stroke-width="0.6"/>`)}
      const bx=mx+mw,last=m.n===ms.length;
      if(last){page.push(`<line x1="${bx-5}" y1="${staves[0]}" x2="${bx-5}" y2="${staves[1]+sp*4}" stroke="#000" stroke-width="0.8"/><rect x="${bx-2.5}" y="${staves[0]}" width="2.5" height="${staves[1]+sp*4-staves[0]}" fill="#000"/>`)}
      else page.push(`<line x1="${bx}" y1="${staves[0]}" x2="${bx}" y2="${staves[1]+sp*4}" stroke="#000" stroke-width="0.9"/>`)});
    y+=sysH}
  pages.push(page);return pages}
(async()=>{const b=await chromium.launch();const truth={};
for(const [font,file] of [['Bravura','bravura.otf'],['Leland','leland.otf'],['Petaluma','petaluma.otf']])for(const numbers of ['sys','all','none']){
  const ms=piece(font.length*7+numbers.length);const pages=svg(ms,font,numbers);const name=`smufl_${font.toLowerCase()}_${numbers}`;
  const html=`<html><head><style>@font-face{font-family:'${font}';src:url(data:font/otf;base64,${fs.readFileSync('/root/smufl/'+file).toString('base64')})}@page{size:612pt 792pt;margin:0}body{margin:0}svg{display:block;page-break-after:always}</style></head><body>${pages.map(p=>`<svg width="612pt" height="792pt" viewBox="0 0 612 792" xmlns="http://www.w3.org/2000/svg">${p.join('')}</svg>`).join('')}</body></html>`;
  const pg=await b.newPage();await pg.setContent(html);await pg.evaluate(()=>document.fonts.ready);await pg.waitForTimeout(300);await pg.pdf({path:`/root/smufl/${name}.pdf`,width:'8.5in',height:'11in',printBackground:true});await pg.close();
  const meters=[];let c=null;for(const m of ms)if(m.meter!==c){meters.push([m.n,m.meter]);c=m.meter}
  truth[name]={measures:ms.length,meters,tempo:96,tempoChanges:ms.filter(m=>m.tempo).map(m=>[m.n,m.tempo.u,m.tempo.v]),title:17,numbers}}
fs.writeFileSync('/root/smufl/truth.json',JSON.stringify(truth,null,1));console.log(Object.keys(truth).join(' '));await b.close()})();
