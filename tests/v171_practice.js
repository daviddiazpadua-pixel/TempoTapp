// v1.7.1: practice must visit every beat incl. user-added dots; accents = beat 1 of each printed measure only.
// usage: node tests/v171_practice.js <3/4 pdf>   (expects the app served on localhost:8765)
const {chromium}=require('playwright');let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
(async()=>{const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const pg=await b.newPage({viewport:{width:1280,height:1000}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
const T=(f,...a)=>pg.evaluate(f,...a);
await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(800);await T(()=>document.getElementById('homeCreateButton').click());await pg.waitForTimeout(200);
await pg.setInputFiles('#createSheetPdfFile',process.argv[2]);for(let i=0;i<80;i++){if(!(await T(()=>window.__TT_TEST__.busy()))&&/ready/i.test(await T(()=>document.getElementById('scoreAnalysisStatus').textContent)))break;await pg.waitForTimeout(400)}
await pg.fill('#scoreClickBpm','300');await T(()=>document.getElementById('scoreClickBpm').dispatchEvent(new Event('change')));await pg.waitForTimeout(300);
const meter=(await T(()=>window.__TT_TEST__.track().scoreMap))[0].meter;ok(meter==='3/4','PDF read as 3/4 ('+meter+')');
let ev=await T(()=>window.__TT_TEST__.events());ok(ev.every(e=>e.acc===(e.b===1)),'score track: accent exactly on beat 1 of every measure');
// --- add a dot by clicking on beat 2 of M3 (geometry from the detected boxes)
const boxes=await T(()=>window.__TT_TEST__.boxes());const m3=boxes.find(x=>x.measure===3&&x.page===1);
const stage=await pg.$('#scoreStage');const clickFrac=async(fx,fy)=>{let q=await stage.boundingBox();await T(y=>window.scrollBy(0,y-400),q.y+fy*q.height);await pg.waitForTimeout(150);q=await stage.boundingBox();await pg.mouse.click(q.x+fx*q.width,q.y+fy*q.height)};await stage.scrollIntoViewIfNeeded();
await pg.click('#scoreStartMappingButton');await pg.waitForTimeout(200);
let r;const L=(m3.cx0>m3.x0?m3.cx0:m3.x0),fx=L+(m3.x1-L)*(1/3);await clickFrac(fx,m3.y);await pg.waitForTimeout(200);
let an=(await T(()=>window.__TT_TEST__.anchors())).filter(a=>a.source==='manual');
let lab=await T(()=>[...document.querySelectorAll('.score-anchor-label')].map(e=>e.textContent));
ok(an.length===1&&lab[0]==='M3.2','dot dropped on beat 2 of M3 is labelled M3.2 (got '+lab.join(',')+')');
ok(!(await T(()=>document.getElementById("scoreStage").classList.contains("mapping-active"))),"marker mode turns itself off after one dot");
// --- add a barline inside M1: the dot must follow its measure (now M4.2), not stay on beat index
await T(()=>document.querySelector('[data-score-edit="add"]').click());await pg.waitForTimeout(150);
const m1=boxes.find(x=>x.measure===1&&x.page===1);await clickFrac(m1.x0+(m1.x1-m1.x0)*0.55,m1.y);await pg.waitForTimeout(400);
await T(()=>document.querySelector('[data-score-edit="add"]').click());await pg.waitForTimeout(150);
lab=await T(()=>[...document.querySelectorAll('.score-anchor-label')].map(e=>e.textContent));ok(lab[0]==='M4.2','after adding a barline before it, the dot is M4.2 (got '+lab.join(',')+')');
// --- practice: every beat visited, the added dot hit at its exact place
await T(()=>{window.__seen=[];const ov=document.getElementById('scoreOverlay');new MutationObserver(()=>{const ph=document.getElementById('scorePlayhead'),st=document.getElementById('scorePracticeStatus').textContent,m=st.match(/beat (\d+)/);if(ph&&m)window.__seen.push({beat:+m[1],l:ph.style.left,t:ph.style.top,label:st})}).observe(ov,{childList:true})});
await pg.click('#scorePracticeStart');for(let i=0;i<900;i++){const s=await T(()=>document.getElementById('scorePracticeStatus').textContent);if(/finished|stopped/i.test(s))break;await pg.waitForTimeout(250)}
const res=await T(()=>({seen:window.__seen,n:window.__TT_TEST__.track().taps,an:window.__TT_TEST__.anchors().filter(a=>a.source==='manual')}));
const vis=new Set(res.seen.map(x=>x.beat));let miss=[];for(let i=1;i<=res.n;i++)if(!vis.has(i))miss.push(i);ok(!miss.length,`practice visited all ${res.n} beats (missing ${miss.slice(0,10)})`);
const a=res.an[0],hit=res.seen.find(x=>x.beat===a.beatIndex+1);ok(hit&&Math.abs(parseFloat(hit.l)-a.x*100)<0.01&&Math.abs(parseFloat(hit.t)-a.y*100)<0.01&&/M4\.2/.test(hit.label),'practice lands on the added dot as M4.2');
ok(res.seen.every(x=>/accent/.test(x.label)===/\.1 ·/.test(x.label)),'practice status shows accent only on beat 1');
// --- recorded/analysed track in the wrong meter (4/4, accents every 4) mapped onto the 3/4 PDF
const taps=[],acc=[];for(let i=0;i<60;i++){taps.push(1000+i*500);acc.push(i%4===0?1:0)}
await T(([t,a])=>window.__TT_TEST__.setRecordedTrack(t,a,[{startMeasure:1,meter:'4/4'}]),[taps,acc]);
const tm=await T(()=>window.__TT_TEST__.track().scoreMap);ok(tm[0].meter==='3/4','recorded track adopts the PDF time signature');
ev=await T(()=>window.__TT_TEST__.events());ok(ev.every(e=>e.acc===(e.b===1))&&ev.filter(e=>e.acc).length===20,'recorded track: 20 accents, all on beat 1');
const marks=await T(()=>{const c={};for(const e of document.querySelectorAll('#scoreOverlay .score-beat-mark')){const m=e.title.split('.')[0];c[m]=(c[m]||0)+1}return c});ok(Object.values(marks).every(v=>v<=3),'3 dots per printed measure');
ok(!errs.length,'no page errors '+errs.join('|'));console.log(fails?`${fails} FAILED`:'ALL PASS');await b.close();process.exit(fails?1:0)})();
