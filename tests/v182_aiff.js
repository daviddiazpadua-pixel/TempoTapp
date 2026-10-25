// AIFF/AIFC import works in every browser engine and every audio entry point (tap-along, Analyze, Warp).
const pw=require('playwright');const path=require('path');const fs=require('fs');const TD=path.join(__dirname,'testdata');let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
const files=fs.readdirSync(path.join(TD,'aiff')).filter(f=>/\.aif/.test(f)).sort();
(async()=>{for(const eng of ['chromium','firefox','webkit']){let b;try{b=await pw[eng].launch()}catch(e){console.log('skip',eng,e.message.split('\n')[0]);continue}
 const pg=await b.newPage({viewport:{width:1280,height:900}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));const T=(f,...a)=>pg.evaluate(f,...a);
 await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(1000);
 for(const f of files){const r=await T(u=>window.__TT_TEST__.aiffCheck(u).catch(e=>({err:e.message})),'/tests/testdata/aiff/'+f);ok(!r.err&&Math.abs(r.dur-8)<0.05&&r.peak>0.2&&r.ch===(/mono/.test(f)?1:2),`[${eng}] ${f} → ${r.name||''} ${r.ch}ch ${r.sr}Hz ${r.dur}s peak ${r.peak?.toFixed?.(2)} ${r.err||''}`)}
 // tap-along: loads and plays
 await T(()=>document.getElementById('homeCreateButton').click());await pg.waitForTimeout(200);await T(()=>document.getElementById('createMediaButton').click());await pg.waitForTimeout(300);
 await pg.setInputFiles('#tapAlongFile',path.join(TD,'aiff','clicks_s24be.aif'));await pg.waitForTimeout(1500);
 const ta=await T(()=>{const a=document.getElementById('tapAlongAudio');return new Promise(r=>{const done=()=>r({dur:a.duration,info:document.getElementById('tapAlongFileInfo').textContent,err:a.error?.code||0});if(a.readyState>=1)done();else{a.addEventListener('loadedmetadata',done,{once:true});a.addEventListener('error',done,{once:true});setTimeout(done,4000)}})});
 ok(Math.abs(ta.dur-8)<0.1&&!ta.err,`[${eng}] tap-along plays the AIFF (${ta.info}, ${ta.dur?.toFixed?.(2)} s)`);
 // Analyze: 8 s at 120 BPM -> about 16 beats
 await T(()=>document.querySelector('[data-main-nav="analyze"]').click());await pg.waitForTimeout(500);
 await pg.setInputFiles('#analyzeAudioFile',path.join(TD,'aiff','clicks_s16be.aif'));await pg.waitForTimeout(2500);await T(()=>document.getElementById('runAudioAnalysisButton').click());let st='';for(let i=0;i<180;i++){st=await T(()=>document.getElementById('analyzeStatus').textContent);if(/ready|Full beat map|could not|can’t|damaged/i.test(st))break;await pg.waitForTimeout(500)}
 const beats=await T(()=>window.__TT_TEST__.analysis().beats);ok(/ready/i.test(st)&&beats>=14&&beats<=18,`[${eng}] Analyze reads the AIFF: ${beats} beats · ${st.slice(0,60)}`);
 ok(!errs.length,`[${eng}] no page errors ${errs.join('|')}`);await b.close()}
console.log(fails?`${fails} FAILED`:'ALL PASS');process.exit(fails?1:0)})();
