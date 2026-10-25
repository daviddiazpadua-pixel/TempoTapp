// Accuracy harness: node tests/score_corpus.js <pdfDir> <truth.json> [filter]
// Serves the app on :8765 (start `python3 -m http.server 8765` in the repo root first).
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const [dir,truthFile,filter]=process.argv.slice(2);const truth=JSON.parse(fs.readFileSync(truthFile));
(async()=>{const b=await chromium.launch();const rows=[];
for(const name of Object.keys(truth).filter(n=>!filter||new RegExp(filter).test(n))){
  const T=truth[name],pg=await b.newPage({viewport:{width:1280,height:900}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(800);
  await pg.evaluate(()=>document.getElementById('homeCreateButton').click());await pg.waitForTimeout(300);
  await pg.setInputFiles('#createSheetPdfFile',path.join(dir,name+'.pdf'));
  const t0=Date.now();await pg.waitForTimeout(1500);
  while(Date.now()-t0<240000){const busy=await pg.evaluate(()=>window.__TT_TEST__?.busy());const st=await pg.evaluate(()=>document.getElementById('scoreAnalysisStatus').textContent);if(!busy&&!/Analyzing|Reading/.test(st))break;await pg.waitForTimeout(500)}
  const r=await pg.evaluate(()=>({measures:+document.getElementById('scoreClickMeasures').value,meter:document.getElementById('scoreClickMeter').value,bpm:+document.getElementById('scoreClickBpm').value,status:document.getElementById('scoreAnalysisStatus').textContent,tr:window.__TT_TEST__.track(),boxes:window.__TT_TEST__.scoreBoxes()}));
  const perPage={};for(const x of r.boxes)perPage[x.page]=(perPage[x.page]||0)+1;
  const expTempo=T.tempo||({andante:84,allegro:132}[String(T.tempo_word||'').toLowerCase()]||null);
  const meterMap=r.tr.scoreMap.map(x=>[x.startMeasure,x.meter]);
  const ok={m:r.measures===T.measures,meter:JSON.stringify(meterMap)===JSON.stringify(T.meters),tempo:expTempo?r.bpm===expTempo:true};
  rows.push({name,ok,got:r.measures,want:T.measures,meters:meterMap,wantMeters:T.meters,bpm:r.bpm,wantBpm:expTempo,secs:((Date.now()-t0)/1000).toFixed(1),perPage,errs});
  console.log(`${ok.m&&ok.meter&&ok.tempo?'PASS':'FAIL'} ${name.padEnd(22)} meas ${String(r.measures).padStart(3)}/${String(T.measures).padEnd(3)} ${ok.m?'✓':'✗'}  meter ${JSON.stringify(meterMap)} vs ${JSON.stringify(T.meters)} ${ok.meter?'✓':'✗'}  bpm ${r.bpm}/${expTempo??'-'} ${ok.tempo?'✓':'✗'}  ${((Date.now()-t0)/1000).toFixed(0)}s ${errs.length?'ERR '+errs[0]:''}`);
  await pg.close()}
const n=rows.length,f=k=>rows.filter(r=>r.ok[k]).length;console.log(`\nmeasures ${f('m')}/${n} · meters ${f('meter')}/${n} · tempo ${f('tempo')}/${n} · all ${rows.filter(r=>r.ok.m&&r.ok.meter&&r.ok.tempo).length}/${n}`);
fs.writeFileSync('/tmp/score_corpus_results.json',JSON.stringify(rows,null,1));await b.close()})();
