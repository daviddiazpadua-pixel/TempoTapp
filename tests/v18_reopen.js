// A click track saved for one section maps back onto that section when the PDF is added again.
const {chromium}=require('playwright');let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
(async()=>{const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1280,height:1000}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));const T=(f,...a)=>pg.evaluate(f,...a);
const wait=async()=>{for(let i=0;i<600;i++){if(!(await T(()=>window.__TT_TEST__.busy()))&&/ready|Read exactly/i.test(await T(()=>document.getElementById('scoreAnalysisStatus').textContent)))break;await pg.waitForTimeout(250)}};
await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(800);await T(()=>document.getElementById('homeCreateButton').click());
await pg.setInputFiles('#createSheetPdfFile',process.argv[2]);await wait();await pg.selectOption('#scoreSectionSelect',process.argv[3]||'3');await pg.waitForTimeout(800);
const before=await T(()=>({n:window.__TT_TEST__.track().taps,first:window.__TT_TEST__.boxes()[0],labels:window.__TT_TEST__.boxes().slice(0,3).map(b=>b.label)}));
await T(()=>window.__TT_TEST__.asReopened());await pg.setInputFiles('#scorePdfFile',process.argv[2]);await pg.waitForTimeout(1500);await wait();await pg.waitForTimeout(800);
const after=await T(()=>({n:window.__TT_TEST__.track().taps,idx:window.__TT_TEST__.sectionIdx(),first:window.__TT_TEST__.boxes()[0]}));
ok(after.idx===+(process.argv[3]||3),`section ${after.idx} restored`);ok(after.n===before.n,`same click track kept (${before.n} beats)`);ok(after.first&&after.first.page===before.first.page&&Math.abs(after.first.x0-before.first.x0)<.002,`measure 1 maps to the same place (page ${after.first?.page})`);
ok(!errs.length,'no page errors '+errs.join('|'));console.log(fails?`${fails} FAILED`:'ALL PASS');await b.close();process.exit(fails?1:0)})();
