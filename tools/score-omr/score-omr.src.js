/* TempoTapp score reader ("OMR-lite"), v1.6.
   Reads a rendered sheet-music page and finds staves, systems, barlines (measure boundaries),
   repeat signs and time signatures. Pure JS, no network, works on engraved and scanned PDFs.
   Input: grayscale Uint8Array (0 = black, 255 = white), width, height.
   Glyph templates come from the open SMuFL fonts (Bravura, Gootville, Leland, Petaluma, Leipzig; OFL). */
(function(root){
'use strict';
const TEMPLATES=__TEMPLATES__;
const GW=10,GH=14;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function median(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return 0;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2}

function toGray(imageData){const d=imageData.data,n=imageData.width*imageData.height,g=new Uint8Array(n);for(let i=0,j=0;i<n;i++,j+=4){const a=d[j+3]/255;g[i]=Math.round(255*(1-a)+a*(d[j]*.299+d[j+1]*.587+d[j+2]*.114))}return g}
function otsu(g){const hist=new Float64Array(256);for(let i=0;i<g.length;i++)hist[g[i]]++;const n=g.length;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sB=0,wB=0,best=0,t=128;for(let i=0;i<256;i++){wB+=hist[i];if(!wB)continue;const wF=n-wB;if(!wF)break;sB+=i*hist[i];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>best){best=v;t=i}}return t}
function binarize(g){const t=clamp(otsu(g),90,215),b=new Uint8Array(g.length);for(let i=0;i<g.length;i++)b[i]=g[i]<=t?1:0;return b}

// Small skew (scans): maximise the sharpness of the horizontal projection over +-2 degrees.
function estimateSkew(b,w,h){
  const xs=[],ys=[];let step=1,count=0;for(let i=0;i<b.length;i++)count+=b[i];step=Math.max(1,Math.round(count/250000));let k=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(b[y*w+x]&&(k++%step===0)){xs.push(x-w/2);ys.push(y)}
  const score=a=>{const t=Math.tan(a*Math.PI/180),hist=new Float64Array(h+w);let s=0;for(let i=0;i<xs.length;i++){const yy=Math.round(ys[i]-xs[i]*t+w/2);if(yy>=0&&yy<hist.length)hist[yy]++}for(const v of hist)s+=v*v;return s};
  let best=0,bs=score(0);for(let a=-2;a<=2.0001;a+=0.1){const s=score(a);if(s>bs*1.0005){bs=s;best=a}}
  let fine=best;for(let a=best-0.1;a<=best+0.1001;a+=0.02){const s=score(a);if(s>bs){bs=s;fine=a}}return Math.abs(fine)<0.05?0:fine;
}
function deskew(b,w,h,deg){if(!deg)return b;const a=deg*Math.PI/180,co=Math.cos(a),si=Math.sin(a),cx=w/2,cy=h/2,o=new Uint8Array(b.length);for(let y=0;y<h;y++){const dy=y-cy;for(let x=0;x<w;x++){const dx=x-cx,sx=Math.round(cx+dx*co-dy*si),sy=Math.round(cy+dx*si+dy*co);if(sx>=0&&sx<w&&sy>=0&&sy<h)o[y*w+x]=b[sy*w+sx]}}return o}

// Staff line thickness and staff space from vertical run lengths.
function runStats(b,w,h){
  const black=new Float64Array(64),white=new Float64Array(200);
  for(let x=0;x<w;x+=3){let run=0,col=b[x];for(let y=0;y<=h;y++){const v=y<h?b[y*w+x]:2;if(v===col)run++;else{if(col===1&&run<64)black[run]++;else if(col===0&&run<200)white[run]++;col=v;run=1}}}
  let lt=1,bw=0;for(let i=1;i<64;i++)if(black[i]>black[lt])lt=i;for(let i=3;i<200;i++)if(white[i]>white[bw]||!bw)bw=i;
  return{lt,sp:bw+lt};
}

function findStaves(b,w,h,lt,sp){
  const minRun=Math.max(8,Math.round(sp*2.5)),strength=new Float64Array(h);
  // thin = black pixel whose vertical run is no thicker than a staff line (beams, noteheads excluded)
  const thin=new Uint8Array(b.length),maxT=lt+2;
  for(let x=0;x<w;x++){let y=0;while(y<h){if(!b[y*w+x]){y++;continue}let y1=y;while(y1<h&&b[y1*w+x])y1++;if(y1-y<=maxT)for(let k=y;k<y1;k++)thin[k*w+x]=1;y=y1}}
  for(let y=0;y<h;y++){let run=0,gap=0,s=0;const r=y*w;for(let x=0;x<=w;x++){const v=x<w&&thin[r+x];if(v){run+=1+gap;gap=0}else if(run>0&&gap<Math.max(2,sp*0.3)){gap++}else{if(run>=minRun)s+=run;run=0;gap=0}}strength[y]=s}
  let mx=0;for(const v of strength)mx=Math.max(mx,v);const thr=Math.max(w*0.06,mx*0.12),cands=[];
  for(let y=0;y<h;y++){if(strength[y]<thr)continue;let y0=y,sw=0,sy=0,smax=0;while(y<h&&strength[y]>=thr){sw+=strength[y];sy+=strength[y]*y;smax=Math.max(smax,strength[y]);y++}cands.push({y:sy/sw,top:y0,bot:y-1,s:smax})}

  // enumerate every plausible 5-line staff, then keep the strongest non-overlapping ones
  const combos=[];
  for(let i=0;i<cands.length;i++){
    for(let j=i+1;j<cands.length;j++){
      const g=cands[j].y-cands[i].y;if(g<sp*0.55)continue;if(g>sp*1.6)break;
      const lines=[i,j];let ok=true,gg=g;for(let k=2;k<5;k++){const want=cands[lines.at(-1)].y+gg;let best=-1,bd=1e9;for(let m=lines.at(-1)+1;m<cands.length;m++){const d=Math.abs(cands[m].y-want);if(d<bd){bd=d;best=m}if(cands[m].y>want+gg)break}if(best<0||bd>Math.max(1.6,gg*0.25)){ok=false;break}lines.push(best);gg=(cands[best].y-cands[i].y)/k}
      if(!ok)continue;
      const ys=lines.map(m=>cands[m].y),gaps=ys.slice(1).map((v,q)=>v-ys[q]);
      if(Math.max(...gaps)/Math.min(...gaps)>1.35)continue;
      const strs=lines.map(m=>cands[m].s),mn=Math.min(...strs),mx2=Math.max(...strs);if(mn<mx2*0.12)continue;
      combos.push({lines,ys,score:strs.reduce((x,y)=>x+y,0)*(0.5+0.5*mn/mx2)});
    }
  }
  combos.sort((x,y)=>y.score-x.score);const staves=[],used=new Set();
  for(const c of combos){if(c.lines.some(m=>used.has(m)))continue;if(staves.some(st=>c.ys[0]<=st.bottom+1&&c.ys[4]>=st.top-1))continue;
    c.lines.forEach(m=>used.add(m));const ys=c.ys,gaps=ys.slice(1).map((v,q)=>v-ys[q]);staves.push({lines:ys,lineRows:c.lines.map(m=>[cands[m].top,cands[m].bot]),top:ys[0],bottom:ys[4],sp:median(gaps),mid:ys[2]})}
  // horizontal extent: columns where >=4 of 5 lines are black
  for(const s of staves){
    const ok=new Uint8Array(w);for(let x=0;x<w;x++){let n=0;for(const [a,c] of s.lineRows){let hit=0;for(let y=Math.max(0,a-1);y<=Math.min(h-1,c+1)&&!hit;y++)if(b[y*w+x])hit=1;n+=hit}ok[x]=n>=4?1:0}
    let best=[0,-1],start=-1,gap=0;const maxGap=Math.max(2,Math.round(s.sp*0.6));
    for(let x=0;x<=w;x++){if(x<w&&ok[x]){if(start<0)start=x;gap=0;if(x-start>best[1]-best[0])best=[start,x]}else if(start>=0){gap++;if(gap>maxGap){start=-1;gap=0}}}
    s.left=best[0];s.right=best[1];
  }
  return staves.filter(s=>s.right-s.left>s.sp*8).sort((a,c)=>a.top-c.top);
}

// Remove staff-line pixels (keep pixels where something crosses the line).
function removeLines(b,w,h,staves,lt){
  const c=b.slice();
  for(const s of staves)for(const [a,z] of s.lineRows){
    const y0=Math.max(0,a-1),y1=Math.min(h-1,z+1),X0=Math.max(0,s.left-2),X1=Math.min(w-1,s.right+2),n=X1-X0+1;
    const U=new Int32Array(n).fill(-1),D=new Int32Array(n),R=new Int32Array(n);
    for(let x=X0;x<=X1;x++){let top=-1,bot=-1;for(let y=y0;y<=y1;y++)if(b[y*w+x]){if(top<0)top=y;bot=y}if(top<0)continue;let u=top;while(u>0&&b[(u-1)*w+x])u--;let d=bot;while(d<h-1&&b[(d+1)*w+x])d++;U[x-X0]=u;D[x-X0]=d;R[x-X0]=d-u+1}
    const hist=new Int32Array(16);for(let i=0;i<n;i++)if(R[i]>0&&R[i]<16)hist[R[i]]++;let m=1;for(let i=1;i<16;i++)if(hist[i]>hist[m])m=i;
    const win=Math.max(6,Math.round(s.sp));
    for(let i=0;i<n;i++){const r=R[i];if(r<=0)continue;let erase=r<=m;
      if(!erase&&r===m+1){let k=0,t=0;for(let j=Math.max(0,i-win);j<=Math.min(n-1,i+win);j++){if(R[j]>0){t++;if(R[j]===m+1)k++}}erase=t>0&&k>=t*0.7}
      if(erase)for(let y=U[i];y<=D[i];y++)c[y*w+X0+i]=0}
  }
  // heal strokes that cross a line (black just above and just below) so glyphs are not cut in two
  for(const s of staves)for(const [a,z] of s.lineRows){
    const ya=a-2,yb=z+2;if(ya<0||yb>=h)continue;
    for(let x=Math.max(1,s.left-2);x<=Math.min(w-2,s.right+2);x++){
      const up=b[ya*w+x]||b[ya*w+x-1]||b[ya*w+x+1],dn=b[yb*w+x]||b[yb*w+x-1]||b[yb*w+x+1];
      if(up&&dn)for(let y=a-1;y<=z+1;y++)if(b[y*w+x])c[y*w+x]=1;
    }
  }
  return c;
}
function integral(b,w,h){const I=new Uint32Array((w+1)*(h+1));for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=b[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+row}}return I}
function boxSum(I,w,x0,y0,x1,y1){if(x1<x0||y1<y0)return 0;const W=w+1;return I[(y1+1)*W+x1+1]-I[y0*W+x1+1]-I[(y1+1)*W+x0]+I[y0*W+x0]}

// Vertical stroke candidates crossing a whole staff, classified as barline or not.
function staffBarCandidates(b,clean,Ic,Ih,w,h,s,staffAbove,staffBelow){
  const sp=s.sp,t0=Math.round(s.top),t1=Math.round(s.bottom),H=t1-t0+1,out=[];
  const cov=new Float32Array(w);
  for(let x=s.left;x<=s.right;x++){let n=0;for(let y=t0;y<=t1;y++)if(b[y*w+x]||(x+1<w&&b[y*w+x+1]))n++;cov[x]=n/H}
  for(let x=s.left;x<=s.right;x++){
    if(cov[x]<0.9)continue;let x1=x;while(x1+1<=s.right&&cov[x1+1]>=0.9)x1++;
    const seg={x0:x,x1,width:x1-x+1};x=x1;
    if(seg.width>sp*0.9)continue;
    // vertical extension beyond the staff
    const ext=(dir)=>{let y=dir<0?t0-1:t1+1,n=0;const lim=dir<0?(staffAbove?Math.round(staffAbove.bottom):0):(staffBelow?Math.round(staffBelow.top):h-1);while(y>=0&&y<h){let any=0;for(let xx=Math.max(0,seg.x0-1);xx<=Math.min(w-1,seg.x1+1);xx++)if(b[y*w+xx]){any=1;break}if(!any)break;n++;y+=dir;if(dir<0?y<lim:y>lim)break}return n};
    const up=ext(-1),dn=ext(1);
    seg.reachAbove=!!staffAbove&&up>=Math.round(staffAbove?(t0-staffAbove.bottom)*0.92:1e9);
    seg.reachBelow=!!staffBelow&&dn>=Math.round(staffBelow?(staffBelow.top-t1)*0.92:1e9);
    seg.extUp=up/sp;seg.extDn=dn/sp;
    // what sits at the far end of an extension: stems end in a notehead/beam/flag, barlines in empty space
    const tip=(yT)=>{const x0=Math.max(0,seg.x0-Math.round(sp*1.1)),x1=Math.min(w-1,seg.x1+Math.round(sp*1.1)),y0=Math.max(0,Math.round(yT-sp*0.6)),y1=Math.min(h-1,Math.round(yT+sp*0.6));
      const all=boxSum(Ic,w,x0,y0,x1,y1),self=boxSum(Ic,w,Math.max(0,seg.x0-1),y0,Math.min(w-1,seg.x1+1),y1);return (all-self)/Math.max(1,(x1-x0+1-(seg.x1-seg.x0+3))*(y1-y0+1))};
    seg.tipUp=up>sp*0.7?tip(t0-up):0;seg.tipDn=dn>sp*0.7?tip(t1+dn):0;
    // isolation: no notehead-sized blob immediately left/right (lines removed)
    const ww=Math.max(2,Math.round(sp*0.45)),g=1,win=Math.max(3,Math.round(sp*0.9));
    let lA=Math.max(0,seg.x0-g-ww),lB=seg.x0-g-1,rA=seg.x1+g+1,rB=Math.min(w-1,seg.x1+g+ww);
    for(let xx=lB;xx>=lA;xx--)if(cov[xx]>=0.9){lA=xx+2;break}
    for(let xx=rA;xx<=rB;xx++)if(cov[xx]>=0.9){rB=xx-2;break}
    let mL=0,mR=0;for(let y=Math.round(t0-sp*0.4);y+win<=Math.round(t1+sp*0.4);y++){
      const yy0=Math.max(0,y),yy1=Math.min(h-1,y+win-1);
      if(lB-lA>=1)mL=Math.max(mL,boxSum(Ih,w,lA,yy0,lB,yy1)/((lB-lA+1)*(yy1-yy0+1)));
      if(rB-rA>=1)mR=Math.max(mR,boxSum(Ih,w,rA,yy0,rB,yy1)/((rB-rA+1)*(yy1-yy0+1)));
    }
    if(mL>0.3&&hasRepeatDots(clean,w,h,s,seg.x0-1,-1))mL=0;
    if(mR>0.3&&hasRepeatDots(clean,w,h,s,seg.x1+1,1))mR=0;
    seg.isoL=mL;seg.isoR=mR;
    // straightness: follow the stroke row by row; a barline's centre stays put, an arpeggio squiggle swings
    {let c=(seg.x0+seg.x1)/2;const cs=[];for(let y=t0;y<=t1;y++){let best=null;let xx=Math.max(0,Math.round(c)-4);const xe=Math.min(w-1,Math.round(c)+4);
        while(xx<=xe){if(!b[y*w+xx]){xx++;continue}let x2=xx;while(x2+1<=xe&&b[y*w+x2+1])x2++;const cc=(xx+x2)/2;if(x2-xx<=sp*0.8&&(!best||Math.abs(cc-c)<Math.abs(best-c)))best=cc;xx=x2+1}
        if(best!==null){c=best;cs.push(best)}}
      const mc=median(cs);let dc=0;for(const v of cs)dc+=Math.abs(v-mc);seg.wiggle=cs.length>H*0.6?dc/cs.length:0}
    out.push(seg);
  }
  return out;
}
function isBarlike(seg,sp,strict){
  const extOk=(seg.extUp<=0.7||seg.reachAbove||(seg.extUp>=1.2&&seg.tipUp<0.1))&&(seg.extDn<=0.7||seg.reachBelow||(seg.extDn>=1.2&&seg.tipDn<0.1));
  const lim=(seg.reachAbove||seg.reachBelow)?0.75:strict?0.4:0.5; // a stroke bridging two staves is almost surely a barline
  return extOk&&seg.width<=sp*0.75&&seg.isoL<lim&&seg.isoR<lim&&!(seg.wiggle>Math.max(0.9,sp*0.06));
}

function groupSystems(b,w,h,staves,layout){
  if(layout==='single')return staves.map(s=>[s]);
  if(layout==='piano'){const o=[];for(let i=0;i<staves.length;i+=2)o.push(staves.slice(i,i+2));return o}
  const conn=[];
  for(let i=0;i+1<staves.length;i++){
    const a=staves[i],c=staves[i+1],sp=(a.sp+c.sp)/2;let ok=false;
    if(Math.abs(a.left-c.left)<sp*3){
      const xa=Math.min(a.left,c.left)-Math.round(sp*1.2),xb=Math.min(a.left,c.left)+Math.round(sp*1.2),y0=Math.round(a.bottom),y1=Math.round(c.top),H=y1-y0+1;
      for(let x=Math.max(0,xa);x<=xb&&!ok;x++){let n=0;for(let y=y0;y<=y1;y++)if(b[y*w+x]||b[y*w+x+1])n++;if(n>=H*0.94)ok=true}
    }
    conn.push(ok);
  }
  const out=[];let cur=[staves[0]];for(let i=1;i<staves.length;i++){if(conn[i-1])cur.push(staves[i]);else{out.push(cur);cur=[staves[i]]}}if(staves.length)out.push(cur);
  return out;
}

// Connected components inside a box of the line-free image.
function components(c,w,h,x0,y0,x1,y1){
  x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(w-1,x1);y1=Math.min(h-1,y1);
  const bw=x1-x0+1,bh=y1-y0+1;if(bw<=0||bh<=0)return[];const seen=new Uint8Array(bw*bh),out=[],stack=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const li=(y-y0)*bw+(x-x0);if(seen[li]||!c[y*w+x])continue;
    let minx=x,maxx=x,miny=y,maxy=y,n=0;const pts=[];stack.push(x,y);seen[li]=1;
    while(stack.length){const py=stack.pop(),px=stack.pop();n++;pts.push(px,py);if(px<minx)minx=px;if(px>maxx)maxx=px;if(py<miny)miny=py;if(py>maxy)maxy=py;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=px+dx,ny=py+dy;if(nx<x0||nx>x1||ny<y0||ny>y1)continue;const nl=(ny-y0)*bw+(nx-x0);if(!seen[nl]&&c[ny*w+nx]){seen[nl]=1;stack.push(nx,ny)}}}
    if(n<4)continue;out.push({x0:minx,x1:maxx,y0:miny,y1:maxy,n,pts});
  }
  return out;
}
// Re-join pieces of one glyph split where it was tangent to a staff line.
function assemble(comps,sp,lt,side=true){
  const gap=Math.max(lt+3,sp*0.3);let changed=true;const L=comps.slice();
  while(changed){changed=false;
    for(let i=0;i<L.length&&!changed;i++)for(let j=i+1;j<L.length&&!changed;j++){const a=L[i],c=L[j];
      const ov=Math.min(a.x1,c.x1)-Math.max(a.x0,c.x0)+1,minW=Math.min(a.x1-a.x0+1,c.x1-c.x0+1);
      const vg=Math.max(a.y0,c.y0)-Math.min(a.y1,c.y1);
      const hg=Math.max(a.x0,c.x0)-Math.min(a.x1,c.x1),vov=Math.min(a.y1,c.y1)-Math.max(a.y0,c.y0)+1,minH=Math.min(a.y1-a.y0+1,c.y1-c.y0+1);
      if((ov>=minW*0.3&&vg<=gap)||(side&&hg<=Math.max(lt+2,sp*0.25)&&vov>=minH*0.5)){L[i]={x0:Math.min(a.x0,c.x0),x1:Math.max(a.x1,c.x1),y0:Math.min(a.y0,c.y0),y1:Math.max(a.y1,c.y1),n:a.n+c.n,pts:a.pts.concat(c.pts)};L.splice(j,1);changed=true}}}
  return L;
}
function glyphFeature(comp){
  const W=comp.x1-comp.x0+1,H=comp.y1-comp.y0+1,grid=new Float32Array(GW*GH),cnt=new Float32Array(GW*GH);
  // area-average onto GWxGH (each source pixel spreads into its cell)
  const m=new Uint8Array(W*H);for(let i=0;i<comp.pts.length;i+=2)m[(comp.pts[i+1]-comp.y0)*W+(comp.pts[i]-comp.x0)]=1;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const gx=Math.min(GW-1,Math.floor(x*GW/W)),gy=Math.min(GH-1,Math.floor(y*GH/H)),k=gy*GW+gx;grid[k]+=m[y*W+x];cnt[k]++}
  for(let k=0;k<grid.length;k++)grid[k]=cnt[k]?grid[k]/cnt[k]:0;return{grid,aspect:W/H};
}
let TPL_CACHE=null;
function templates(){if(TPL_CACHE)return TPL_CACHE;TPL_CACHE=TEMPLATES.map(t=>({l:t.l,a:t.a,h:t.h,g:Float32Array.from(t.b,ch=>(ch.charCodeAt(0)-48)/9)}));return TPL_CACHE}
function classify(comp,only){
  const f=glyphFeature(comp);let best=null,bestOther=1e9,bestNR=null;
  for(const t of templates()){let d=0;for(let k=0;k<f.grid.length;k++)d+=Math.abs(f.grid[k]-t.g[k]);d=d/f.grid.length+0.35*Math.abs(Math.log(f.aspect/t.a));
    if(only&&!only.includes(t.l)&&/^\d$/.test(t.l))continue;
    if(t.l==='other'||t.l==='note'||t.l==='rest'){bestOther=Math.min(bestOther,d);if(t.l!=='other'&&(!bestNR||d<bestNR.d))bestNR={l:t.l,d};continue}if(!best||d<best.d)best={l:t.l,d}}
  if(!best)return null;best.other=bestOther;best.nr=bestNR;return best;
}

// Time signature right after x (start of system or after a barline), on one staff.
function readTimeSig(c,w,h,s,xa,xb,lt=1){
  const sp=s.sp,top=s.top,mid=s.mid,bot=s.bottom,upper=[],lower=[],whole=[];
  const X0=Math.round(xa),X1=Math.round(xb),M=Math.round(mid);
  // digits sit exactly in the upper (lines 1-3) and lower (lines 3-5) halves and touch at the middle line: split there
  // (handwritten-style fonts such as Petaluma draw digits up to ~3 spaces tall, overhanging the staff)
  for(const k of assemble(components(c,w,h,X0,Math.round(top-sp*2.5),X1,M),sp,lt,false)){const hh=(k.y1-k.y0+1)/sp;if(hh>=1.45&&hh<=4.4&&k.y0<=top+sp*0.5&&k.y0>=top-sp*2.4&&k.y1>=M-sp*0.3)upper.push(k)}
  for(const k of assemble(components(c,w,h,X0,M,X1,Math.round(bot+sp*2.5)),sp,lt,false)){const hh=(k.y1-k.y0+1)/sp;if(hh>=1.45&&hh<=4.4&&k.y1>=bot-sp*0.5&&k.y1<=bot+sp*2.4&&k.y0<=M+sp*0.3)lower.push(k)}
  for(const k of assemble(components(c,w,h,X0,Math.round(top-sp*0.9),X1,Math.round(bot+sp*0.9)),sp,lt)){const hh=(k.y1-k.y0+1)/sp,cy=(k.y0+k.y1)/2;if(hh>=1.6&&hh<=3.6&&Math.abs(cy-mid)<sp*0.45)whole.push(k)}
  // touching digits ("12", "16"): split a too-wide blob at its thinnest column
  const splitWide=list=>{const out=[];for(const k of list){const W=k.x1-k.x0+1,H=k.y1-k.y0+1;if(W/H<1.0){out.push(k);continue}
    const col=new Uint16Array(W);for(let i=0;i<k.pts.length;i+=2)col[k.pts[i]-k.x0]++;let bx=-1,bv=1e9;for(let x=Math.round(W*0.3);x<=Math.round(W*0.7);x++)if(col[x]<bv){bv=col[x];bx=x}
    if(bx<0){out.push(k);continue}const A=[],B=[];for(let i=0;i<k.pts.length;i+=2)(k.pts[i]-k.x0<bx?A:B).push(k.pts[i],k.pts[i+1]);
    const mk=pts=>{let x0=1e9,x1=-1,y0=1e9,y1=-1;for(let i=0;i<pts.length;i+=2){x0=Math.min(x0,pts[i]);x1=Math.max(x1,pts[i]);y0=Math.min(y0,pts[i+1]);y1=Math.max(y1,pts[i+1])}return{x0,x1,y0,y1,n:pts.length/2,pts}};
    if(A.length>8&&B.length>8){out.push(mk(A),mk(B))}else out.push(k)}return out};
  const digits=list=>{const ok=[];for(const k of splitWide(list)){const r=classify(k);if(r&&/^\d$/.test(r.l)&&((r.d<0.3&&r.other-r.d>0.04)||(r.d<0.34&&r.other-r.d>0.08)))ok.push({k,r})}return ok.sort((a,c)=>a.k.x0-c.k.x0)};
  const U=digits(upper),L=digits(lower);

  for(const u0 of U){
    const ug=U.filter(u=>u.k.x0>=u0.k.x0&&u.k.x0-u0.k.x1<sp*0.9&&u.k.x0-u0.k.x0<sp*2.6);
    const ux0=ug[0].k.x0,ux1=ug.at(-1).k.x1;
    const lg=L.filter(l=>l.k.x1>=ux0-sp*0.8&&l.k.x0<=ux1+sp*0.8);
    if(!lg.length)continue;
    const num=Number(ug.map(u=>u.r.l).join('')),den=Number(lg.map(l=>l.r.l).join(''));
    if(num>=1&&num<=32&&[1,2,4,8,16,32].includes(den))return{meter:`${num}/${den}`,x0:Math.min(ux0,lg[0].k.x0),x1:Math.max(ux1,lg.at(-1).k.x1),conf:1-Math.max(...ug.map(u=>u.r.d),...lg.map(l=>l.r.d))};
  }
  for(const k of whole){const r=classify(k,['C','cut']);if(r&&(r.l==='C'||r.l==='cut')&&r.d<0.3&&r.other-r.d>0.04)return{meter:r.l==='C'?'4/4':'2/2',x0:k.x0,x1:k.x1,conf:1-r.d}}
  return null;
}
// Does [xa,xb] on this system contain notes or rests (vs. only clef/key/time signature)?
function hasContent(c,Ic,w,h,g,xa,xb,skip,lt=1){
  xa=Math.round(xa);xb=Math.round(xb);if(xb-xa<3)return false;
  for(const s of g){const sp=s.sp,e=Math.max(3,Math.round(sp*0.58)),y0=Math.max(0,Math.round(s.top-sp*2)),y1=Math.min(h-1,Math.round(s.bottom+sp*2));
    for(const k of components(c,w,h,xa,y0,xb,y1)){
      const kw=(k.x1-k.x0+1)/sp,kh=(k.y1-k.y0+1)/sp;if(kh<0.35&&kw<0.6)continue;
      if(skip&&skip.some(r=>k.x0>=r[0]-2&&k.x1<=r[1]+2))continue;
      if(kh>=2.4&&kw>=1.2&&kw<=3.6&&k.x0<=xa+sp*1.5)continue;            // clef at the line start
      const r=classify(k);
      if(r&&r.other<0.33&&r.other<=r.d&&(!r.nr||r.other<r.nr.d-0.03))continue;  // clef / accidental
      if(r&&r.nr&&r.nr.d<0.28&&r.nr.d<=r.d)return true;                    // notehead or rest glyph
      let blob=false;for(let y=k.y0;y+e-1<=k.y1&&!blob;y++)for(let x=k.x0;x+e-1<=k.x1;x++)if(boxSum(Ic,w,x,y,x+e-1,y+e-1)===e*e){blob=true;break}
      if(blob&&kw>=0.8)return true;                                         // filled notehead (with stem/beam)
      let stem=false;const m=new Uint8Array((k.x1-k.x0+1)*(k.y1-k.y0+1)),W=k.x1-k.x0+1;for(let i=0;i<k.pts.length;i+=2)m[(k.pts[i+1]-k.y0)*W+(k.pts[i]-k.x0)]=1;
      for(let x=0;x<W&&!stem;x++){let run=0;for(let y=0;y<=k.y1-k.y0;y++){if(m[y*W+x]){if(++run>=sp*3.2){stem=true;break}}else run=0}}
      if(stem&&kw>=0.9)return true;                                         // stemmed note (hollow head)
    }
  }
  return false;
}
function hasRepeatDots(c,w,h,s,x,dir){
  // two dots in the 2nd and 3rd spaces within ~1.3 sp on side dir
  const sp=s.sp,xa=dir>0?x:x-Math.round(sp*1.3),xb=dir>0?x+Math.round(sp*1.3):x;
  const comps=components(c,w,h,xa,Math.round(s.top),xb,Math.round(s.bottom));let a=false,bb=false;
  for(const k of comps){const kw=(k.x1-k.x0+1)/sp,kh=(k.y1-k.y0+1)/sp,cy=(k.y0+k.y1)/2;if(kw<0.25||kw>0.75||kh<0.25||kh>0.75)continue;
    if(Math.abs(cy-(s.lines[1]+s.lines[2])/2)<sp*0.3)a=true;if(Math.abs(cy-(s.lines[2]+s.lines[3])/2)<sp*0.3)bb=true}
  return a&&bb;
}

function analyzePage(gray,w,h,opts={}){
  let b=binarize(gray);const skew=opts.deskew===false?0:estimateSkew(b,w,h);b=deskew(b,w,h,skew);
  const {lt,sp:sp0}=runStats(b,w,h);
  const staves=findStaves(b,w,h,lt,sp0);
  if(!staves.length)return{skew,lt,sp:sp0,staves:[],systems:[]};
  const clean=removeLines(b,w,h,staves,lt),Ic=integral(clean,w,h);
  // blobs only: drop long horizontal strokes (beams, ties, brackets) so they don't look like noteheads beside a barline
  const hb=clean.slice(),longRun=Math.max(8,Math.round(median(staves.map(s=>s.sp))*1.6));
  for(let y=0;y<h;y++){let x=0;const r=y*w;while(x<w){if(!hb[r+x]){x++;continue}let x1=x;while(x1<w&&clean[r+x1])x1++;if(x1-x>=longRun)for(let k=x;k<x1;k++)hb[r+k]=0;x=x1}}
  const Ih=integral(hb,w,h);
  // per-staff candidates (neighbour staves allowed for cross-staff barlines)
  staves.forEach((s,i)=>{s.cands=staffBarCandidates(b,clean,Ic,Ih,w,h,s,staves[i-1],staves[i+1])});
  let groups=groupSystems(b,w,h,staves,opts.layout||'auto');
  // auto: also merge consecutive groups whose barlines line up (editions without a systemic barline)
  if((opts.layout||'auto')==='auto'&&groups.every(g=>g.length===1)){
    const merged=[];for(const g of groups){const prev=merged.at(-1);
      if(prev){const a=prev.at(-1),c=g[0],sp=(a.sp+c.sp)/2;const xa=a.cands.filter(s=>isBarlike(s,a.sp,false)).map(s=>s.x0),xc=c.cands.filter(s=>isBarlike(s,c.sp,false)).map(s=>s.x0);
        const aligned=xa.filter(x=>xc.some(y=>Math.abs(x-y)<=Math.max(2,sp*0.25))).length;
        if(Math.abs(a.left-c.left)<sp*1.5&&Math.abs(a.right-c.right)<sp*1.5&&aligned>=2&&aligned>=0.7*Math.max(xa.length,xc.length)){prev.push(...g);continue}}
      merged.push(g)}
    groups=merged;
  }
  const systems=[];
  for(const g of groups){
    const sp=median(g.map(s=>s.sp)),left=Math.min(...g.map(s=>s.left)),right=Math.max(...g.map(s=>s.right)),n=g.length,tol=Math.max(2,lt+1,sp*0.3);
    const all=[];g.forEach((s,si)=>{for(const c of s.cands)if(isBarlike(c,s.sp,n===1)||((c.reachAbove||c.reachBelow)&&c.width<=s.sp*0.75&&!(c.wiggle>Math.max(0.9,s.sp*0.06))))all.push({x:(c.x0+c.x1)/2,x0:c.x0,x1:c.x1,si,w:c.width,br:!!(c.reachAbove||c.reachBelow)})});
    all.sort((a,c)=>a.x-c.x);const clusters=[];
    for(const c of all){const k=clusters.at(-1);if(k&&c.x-k.x<=tol){k.items.push(c);k.x1=Math.max(k.x1,c.x1);k.staves.add(c.si)}else clusters.push({x:c.x,x0:c.x0,x1:c.x1,items:[c],staves:new Set([c.si])})}
    const need=Math.max(1,n-Math.floor(n/4));
    // scans: a thin barline can break up in one staff; accept a weaker vertical stroke there as support
    for(const k of clusters){if(k.staves.size>=need||k.staves.size*2<n)continue;const br=k.items.some(it=>it.br);
      g.forEach((st,si)=>{if(k.staves.has(si))return;
        // same stroke, clean on both sides, only rejected because something touches its end
        if(st.cands.some(c=>Math.abs((c.x0+c.x1)/2-k.x)<=tol&&c.width<=st.sp*0.75&&c.isoL<0.5&&c.isoR<0.5)){k.staves.add(si);return}
        if(!br)return;const t0=Math.round(st.top),t1=Math.round(st.bottom),H=t1-t0+1;
        for(let x=Math.max(0,k.x0-2);x<=Math.min(w-2,k.x1+2);x++){let c=0;for(let y=t0;y<=t1;y++)if(b[y*w+x]||b[y*w+x+1])c++;if(c>=H*0.7){k.staves.add(si);break}}})}
    let bars=clusters.filter(k=>k.staves.size>=need&&k.x0>left+sp*1.0);
    // merge double / repeat barlines (thin+thick within ~1.2 sp)
    const merged=[];for(const k of bars){const p=merged.at(-1);if(p&&k.x0-p.x1<=sp*1.25){p.x1=Math.max(p.x1,k.x1);p.parts++}else merged.push({x0:k.x0,x1:k.x1,parts:1})}
    bars=merged;
    const ref=g[0];
    for(const k of bars){k.repeatEnd=g.some(s=>hasRepeatDots(clean,w,h,s,k.x0-1,-1));k.repeatStart=g.some(s=>hasRepeatDots(clean,w,h,s,k.x1+1,1))}
    // implicit closing barline at the right edge
    if(!bars.length||right-bars.at(-1).x1>sp*1.6){
      // staff runs on past the last barline: a real (unclosed) measure only if notes/rests are there, not a courtesy key/time signature
      const lastX=bars.length?bars.at(-1).x1:left+sp*3.2;
      // a weak vertical stroke where the staff lines stop still closes the line (scans lose thin barlines)
      let closed=false;for(const st of g){const t0=Math.round(st.top),t1=Math.round(st.bottom);for(let x=Math.max(0,st.right-3);x<=Math.min(w-1,st.right+2)&&!closed;x++){let n=0;for(let y=t0;y<=t1;y++)if(b[y*w+x])n++;if(n>=(t1-t0+1)*0.7)closed=true}}
      if(!bars.length||hasContent(clean,Ic,w,h,g,lastX+2,right-2,null,lt))bars.push({x0:right,x1:right,parts:1,implicit:!closed});
    }
    // start-repeat right after the clef/key/time header is not a measure boundary
    const widths=bars.map((k,i)=>k.x0-(i?bars[i-1].x1:left)),medW=median(widths);
    if(bars.length>1&&bars[0].repeatStart&&!bars[0].repeatEnd&&widths[0]<Math.max(sp*9,medW*0.45))bars[0].headerRepeat=true;
    const boundaries=bars.filter(k=>!k.headerRepeat);
    // time signatures: at system start and right after each boundary
    const sigs=[];
    // a time signature is written on every staff of the system; mid-line changes must agree on (nearly) all of them
    const sigAt=(xa,xb,where)=>{const votes={},conf={};for(const s of g){const r=readTimeSig(clean,w,h,s,xa,xb,lt);if(r){votes[r.meter]=(votes[r.meter]||0)+1;conf[r.meter]=Math.max(conf[r.meter]||0,r.conf)}}const best=Object.entries(votes).sort((a,c)=>c[1]-a[1])[0];
      const need=where==='start'?Math.max(1,Math.ceil(n*0.5)):(n<=2?n:Math.ceil(n*0.75));if(best&&best[1]>=need&&(where==='start'||conf[best[0]]>=0.72))sigs.push({meter:best[0],where,votes:best[1],of:n,conf:conf[best[0]]})};
    const firstB=boundaries[0]?boundaries[0].x0:right;
    sigAt(left+2,Math.min(firstB-sp*0.3,left+sp*14),'start');
    boundaries.forEach((k,i)=>{if(i===boundaries.length-1)return;const nx=boundaries[i+1].x0;sigAt(k.x1+1,Math.min(nx-sp*0.5,k.x1+sp*9),i+1)});
    // segments holding only clef/key/time signature (start of a 2nd ending, key change before a repeat) are not measures
    const sigSpans=[];for(const s of g){const r=readTimeSig(clean,w,h,s,left+2,Math.min(firstB-sp*0.3,left+sp*14),lt);if(r)sigSpans.push([r.x0-2,r.x1+2])}
    for(let i=0;i<boundaries.length;i++){const k=boundaries[i],prev=i?boundaries[i-1]:null,x0=prev?prev.x1+2:left+sp*3.2,x1=k.x0-2,width=(k.x0-(prev?prev.x1:left))/sp;
      const headerLike=(!prev&&width<13)||(prev&&(prev.parts>=2||prev.repeatEnd)&&width<10);
      if(width<2.2&&boundaries.length>1){k.empty=true;continue}            // a sliver (bracket / double start line) is never a measure
      if(headerLike&&boundaries.length>1&&!hasContent(clean,Ic,w,h,g,prev?x0:left+2,x1,!prev?sigSpans:null,lt)){k.empty=true}}
    for(let i=boundaries.length-1;i>=0;i--)if(boundaries[i].empty){sigs.forEach(sg=>{if(typeof sg.where==='number'&&sg.where>i)sg.where--;else if(sg.where===i)sg.where=i?i:'start'});boundaries.splice(i,1)}
    const top=Math.min(...g.map(s=>s.top)),bottom=Math.max(...g.map(s=>s.bottom));
    const measures=boundaries.map((k,i)=>({x0:i?boundaries[i-1].x1:left,x1:k.x0,repeatStart:i?!!boundaries[i-1].repeatStart:!!(bars[0].headerRepeat||false),repeatEnd:!!k.repeatEnd,open:!!k.implicit}));
    systems.push({staves:g.length,top,bottom,left,right,sp,measures,sigs,...(opts.debug?{bars,cands:g.map(s=>({top:s.top,bottom:s.bottom,cands:s.cands.map(c=>({x:c.x0,w:c.width,bar:isBarlike(c,s.sp,n===1),eu:+c.extUp.toFixed(2),ed:+c.extDn.toFixed(2),ra:c.reachAbove,rb:c.reachBelow,il:+c.isoL.toFixed(2),ir:+c.isoR.toFixed(2),wg:+(c.wiggle||0).toFixed(2)}))}))}:{})});
  }
  return{skew,lt,sp:sp0,staves:staves.map(s=>({top:s.top,bottom:s.bottom,left:s.left,right:s.right,sp:s.sp})),systems};
}
// Number measures across pages/systems; a line ending without a barline continues into the next line.
function numberMeasures(pages){
  const out=[],meters=[];let n=0,carry=false;
  pages.forEach((pg,pi)=>pg.systems.forEach((sy,si)=>{
    const startN=n;
    sy.measures.forEach((m,mi)=>{let num;if(mi===0&&carry){num=n}else{n++;num=n}out.push({page:pi+1,system:si,measure:num,...m,top:sy.top,bottom:sy.bottom,sp:sy.sp})});
    for(const sg of sy.sigs){if(meters.length&&(sg.conf<0.72||sg.votes<(sg.of<=2?sg.of:Math.ceil(sg.of*0.75))))continue;const at=sg.where==='start'?(carry?startN+1:startN+1):startN+sg.where+(carry?0:1);const prev=meters.at(-1);if(!prev||prev.meter!==sg.meter){if(prev&&prev.measure===at)prev.meter=sg.meter;else meters.push({measure:at,meter:sg.meter})}}
    const last=sy.measures.at(-1);carry=!!(last&&last.open);
  }));
  return{boxes:out,total:n,meters};
}
const api={analyzePage,numberMeasures,toGray,_:{binarize,runStats,findStaves,classify,readTimeSig,estimateSkew,removeLines,components,glyphFeature,integral,hasContent}};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TempoOMR=api;
})(typeof window!=='undefined'?window:globalThis);
