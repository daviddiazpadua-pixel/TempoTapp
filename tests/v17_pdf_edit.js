// PDF measure editing + beat-1 placement. Serve repo on :8765; node tests/v17_pdf_edit.js <pdf>
const {chromium}=require('playwright');let fails=0;const ok=(n,c,i)=>{console.log(`${c?'PASS':'FAIL'}  ${n}  ${i||''}`);if(!c)fails++};
(async()=>{const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1280,height:1000}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(800);await pg.evaluate(()=>document.getElementById('homeCreateButton').click());await pg.waitForTimeout(200);
await pg.setInputFiles('#createSheetPdfFile',process.argv[2]);for(let i=0;i<60;i++){if(!(await pg.evaluate(()=>window.__TT_TEST__.busy()))&&/ready/i.test(await pg.evaluate(()=>document.getElementById('scoreAnalysisStatus').textContent)))break;await pg.waitForTimeout(400)}
const meas=()=>pg.evaluate(()=>({total:+document.getElementById('scoreClickMeasures').value,pill:document.getElementById('durationPill').textContent}));
const m0=await meas();
// beat 1 dots sit after the clef/key/time signature: first dot of the first measure must be right of the box start by > 4% of page width
const dots=await pg.evaluate(()=>{const ov=document.getElementById('scoreOverlay'),r=ov.getBoundingClientRect(),box=ov.querySelector('.score-measure-box'),br=box.getBoundingClientRect(),mk=[...ov.querySelectorAll('.score-beat-mark')].map(e=>e.getBoundingClientRect()).filter(m=>m.top>br.top-30&&m.top<br.bottom).sort((a,b)=>a.left-b.left)[0];return{boxLeft:(br.left-r.left)/r.width,dot:(mk.left+mk.width/2-r.left)/r.width}});
ok('Beat 1 of measure 1 sits after the clef/key/time signature',dots.dot-dots.boxLeft>0.04,`box ${dots.boxLeft.toFixed(3)} dot ${dots.dot.toFixed(3)}`);
// add a barline inside measure 2
await pg.click('[data-score-edit="add"]');const box2=await pg.evaluate(()=>{const bx=[...document.querySelectorAll('#scoreOverlay .score-measure-box')][1].getBoundingClientRect();return{x:bx.left+bx.width*0.5,y:bx.top+bx.height*0.6}});
await pg.mouse.click(box2.x,box2.y);await pg.waitForTimeout(400);const m1=await meas();
ok('Add barline: one more measure, click track rebuilt',m1.total===m0.total+1&&new RegExp(`${m0.total+1} measures`).test(m1.pill),`${m0.total} → ${m1.total} (${m1.pill})`);
// remove that barline again
await pg.click('[data-score-edit="remove"]');const h=await pg.evaluate(()=>{const hs=[...document.querySelectorAll('#scoreOverlay .score-bar-handle')].map(e=>e.getBoundingClientRect());const r=hs[1];return{x:r.left+r.width/2,y:r.top+r.height/2}});
await pg.mouse.click(h.x,h.y);await pg.waitForTimeout(400);const m2=await meas();ok('Remove barline: measures merge back',m2.total===m0.total,`${m1.total} → ${m2.total}`);
// move a barline by dragging
await pg.click('[data-score-edit="move"]');const g=await pg.evaluate(()=>{const e=[...document.querySelectorAll('#scoreOverlay .score-bar-handle')][0],r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,id:e.dataset.boxKey}});
const x1a=await pg.evaluate(id=>document.querySelector(`#scoreOverlay .score-bar-handle[data-box-key="${id}"]`).style.left,g.id);
await pg.mouse.move(g.x,g.y);await pg.mouse.down();await pg.mouse.move(g.x-40,g.y,{steps:6});await pg.mouse.up();await pg.waitForTimeout(400);
const x1b=await pg.evaluate(id=>document.querySelector(`#scoreOverlay .score-bar-handle[data-box-key="${id}"]`)?.style.left,g.id);const m3=await meas();
ok('Move barline: drag changes its position, measure count unchanged',x1b&&parseFloat(x1b)<parseFloat(x1a)-1&&m3.total===m0.total,`${x1a} → ${x1b}`);
await pg.click('#scoreEditUndo');await pg.waitForTimeout(300);const x1c=await pg.evaluate(id=>document.querySelector(`#scoreOverlay .score-bar-handle[data-box-key="${id}"]`)?.style.left,g.id);
ok('Undo restores the barline',x1c===x1a,`${x1b} → ${x1c}`);
ok('No page errors',!errs.length,errs.join(' | '));await b.close();process.exit(fails?1:0)})();
