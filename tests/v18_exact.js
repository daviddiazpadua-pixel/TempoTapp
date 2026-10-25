// v1.8 exact reader on a digitally engraved PDF: sections, printed labels, tempo map, edits, speed.
// usage: node tests/v18_exact.js <pdf> <sectionIndex>   (app served on :8765)
const {chromium}=require('playwright');let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
(async()=>{const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1280,height:1000}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));const T=(f,...a)=>pg.evaluate(f,...a);
await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(800);await T(()=>document.getElementById('homeCreateButton').click());const t0=Date.now();
await pg.setInputFiles('#createSheetPdfFile',process.argv[2]);for(let i=0;i<600;i++){if(!(await T(()=>window.__TT_TEST__.busy()))&&/ready/i.test(await T(()=>document.getElementById('scoreAnalysisStatus').textContent)))break;await pg.waitForTimeout(250)}
const secs=(Date.now()-t0)/1000,st=await T(()=>document.getElementById('scoreAnalysisStatus').textContent);
ok(/Read exactly/.test(st)&&/all agree/.test(st),'exact reading, checked against printed bar numbers');ok(secs<20,`whole PDF analysed in ${secs.toFixed(1)} s`);
const sec=process.argv[3]||'1';await pg.selectOption('#scoreSectionSelect',sec);await pg.waitForTimeout(1500);
const opt=await T(s=>document.querySelector(`#scoreSectionSelect option[value="${s}"]`).textContent,sec),mm=opt.match(/m(\d+)–(\d+)/),lo=+mm[1],hi=+mm[2];
const tr=await T(()=>window.__TT_TEST__.track()),ev=await T(()=>window.__TT_TEST__.events());
ok(ev.at(-1).m===hi-lo+1,`section has ${hi-lo+1} measures (m${lo}–${hi})`);
await pg.waitForFunction(()=>document.querySelectorAll('.score-measure-label').length>0&&!/Page 5 /.test(document.getElementById('scorePageLabel').textContent),null,{timeout:8000}).catch(()=>{});const labels=await T(()=>[...document.querySelectorAll('.score-measure-label')].map(e=>+e.textContent.slice(1)));ok(labels.length&&labels[0]>=lo&&labels.every((v,i)=>!i||v===labels[i-1]+1),`labels use printed numbers (${labels.slice(0,4)}…)`);
ok(ev.every(e=>e.acc===(e.b===1)),'accent only on beat 1');
const iv=tr.tapMs.slice(1).map((t,i)=>t-tr.tapMs[i]);{const nSet=await T(()=>{const m=document.getElementById('scoreTempoSummary').textContent.match(/(\d+) tempo mark/);return m?+m[1]:0});ok(nSet<2||new Set(iv.map(x=>Math.round(60000/x))).size>1,`click follows the printed tempos (${nSet} marks)`)}
// scale: BPM field doubles -> every interval halves
const dur0=tr.tapMs.at(-1),bpm0=+(await T(()=>document.getElementById('scoreClickBpm').value));await pg.fill('#scoreClickBpm',String(bpm0*2));await T(()=>document.getElementById('scoreClickBpm').dispatchEvent(new Event('change')));await pg.waitForTimeout(400);
const dur1=(await T(()=>window.__TT_TEST__.track())).tapMs.at(-1);ok(Math.abs(dur1/dur0-.5)<.02,`doubling the BPM halves the length (${dur0}→${dur1})`);
await pg.fill('#scoreClickBpm',String(bpm0));await T(()=>document.getElementById('scoreClickBpm').dispatchEvent(new Event('change')));await pg.waitForTimeout(400);
// follow-tempo off -> constant
await pg.click('#scoreFollowTempo');await pg.waitForTimeout(400);let tr2=await T(()=>window.__TT_TEST__.track());const iv2=tr2.tapMs.slice(1).map((t,i)=>t-tr2.tapMs[i]);ok(new Set(iv2.map(x=>Math.round(x/5))).size<=2,'unchecking "follow" gives a steady click');await pg.click('#scoreFollowTempo');await pg.waitForTimeout(400);
// add a barline in the 2nd measure on screen, then undo
const boxes=await T(()=>window.__TT_TEST__.boxes()),pgNo=await T(()=>window.__TT_TEST__.page()),onPage=boxes.filter(x=>x.page===pgNo),bx=onPage[1];
const stage=await pg.$('#scoreStage');const clickFrac=async(fx,fy)=>{let q=await stage.boundingBox();await T(y=>window.scrollBy(0,y-400),q.y+fy*q.height);await pg.waitForTimeout(150);q=await stage.boundingBox();await pg.mouse.click(q.x+fx*q.width,q.y+fy*q.height)};
const n0=ev.at(-1).m;await T(()=>document.querySelector('[data-score-edit="add"]').click());{await T(id=>document.querySelector(`#scoreOverlay .score-measure-box[data-box-key="${id}"]`).scrollIntoView({block:'center'}),bx.id);await pg.waitForTimeout(300);const r=await T(id=>{const q=document.querySelector(`#scoreOverlay .score-measure-box[data-box-key="${id}"]`).getBoundingClientRect();return{x:q.left+q.width*.6,y:q.top+q.height/2}},bx.id);await pg.mouse.click(r.x,r.y)}await pg.waitForTimeout(500);
let n1=(await T(()=>window.__TT_TEST__.events())).at(-1).m;ok(n1===n0+1,`add barline: ${n0} → ${n1} measures`);
const lab2=await T(()=>[...document.querySelectorAll('.score-measure-label')].map(e=>+e.textContent.slice(1)));ok(lab2.every((v,i)=>!i||v===lab2[i-1]+1),'labels stay sequential after the edit');
await T(()=>document.getElementById('scoreEditUndo').click());await pg.waitForTimeout(500);n1=(await T(()=>window.__TT_TEST__.events())).at(-1).m;ok(n1===n0,'undo restores it');
const tr3=await T(()=>window.__TT_TEST__.track());ok(tr3.tapMs.length===tr.tapMs.length&&Math.abs(tr3.tapMs.at(-1)-tr.tapMs.at(-1))<5,'tempo map unchanged after edit + undo');
ok(!errs.length,'no page errors '+errs.join('|'));console.log(fails?`${fails} FAILED`:'ALL PASS');await b.close();process.exit(fails?1:0)})();
