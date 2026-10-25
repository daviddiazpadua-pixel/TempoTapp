// v1.7 feature tests. Serve the repo on :8765, then: node tests/v17_features.js [longWav]
const {chromium}=require('playwright');const path=require('path');
const TD=path.join(__dirname,'testdata');let fails=0;const ok=(name,cond,info)=>{console.log(`${cond?'PASS':'FAIL'}  ${name}  ${info||''}`);if(!cond)fails++};
(async()=>{const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const pg=await b.newPage({viewport:{width:1280,height:900}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(900);
const H=()=>pg.evaluate(()=>window.__TT_TEST__);
// ---- 1. Space while the TAP button has focus: tap is stamped at key-DOWN, not key-up; exactly one tap ----
await pg.evaluate(()=>{document.getElementById('homeCreateButton').click()});await pg.waitForTimeout(200);await pg.evaluate(()=>document.getElementById('createScratchButton').click());await pg.waitForTimeout(300);
await pg.click('#startButton');await pg.waitForTimeout(150);await pg.focus('#tapButton');
await pg.evaluate(()=>{window.__kd=[];document.addEventListener('keydown',e=>{if(e.code==='Space')window.__kd.push(e.timeStamp)},true)});
for(let i=0;i<4;i++){await pg.keyboard.down('Space');await pg.waitForTimeout(160);await pg.keyboard.up('Space');await pg.waitForTimeout(260)}
const r1=await pg.evaluate(()=>({taps:window.__TT_TEST__.track().tapMs,rec:window.__TT_TEST__.rec(),kd:window.__kd}));
const expected=r1.kd.map(t=>t-r1.rec.segmentStartReal+r1.rec.segmentBaseMs),errMs=r1.taps.map((t,i)=>Math.abs(t-expected[i]));
ok('Space on focused TAP button: one tap per press, timed at key-down',r1.taps.length===4&&Math.max(...errMs)<3,`taps=${r1.taps.length} maxErr=${Math.max(...errMs).toFixed(2)}ms (key held 160 ms)`);
await pg.click('#endButton');
// ---- 2. tap-along → Listen: recording + clicks ----
await pg.evaluate(()=>{document.getElementById('changeCreateModeButton')?.click()});await pg.waitForTimeout(200);await pg.evaluate(()=>document.getElementById('createMediaButton').click());await pg.waitForTimeout(400);
await pg.evaluate(()=>{const ok=[...document.querySelectorAll('#uiDialog button, .modal-backdrop.open button')].find(b=>/start new|ok|continue/i.test(b.textContent));ok?.click()});await pg.waitForTimeout(300);
await pg.setInputFiles('#tapAlongFile',path.join(TD,'clicks120.wav'));await pg.waitForTimeout(1200);
await pg.click('#tapAlongStartButton');await pg.waitForTimeout(300);for(let i=0;i<6;i++){await pg.click('#tapRegularButton');await pg.waitForTimeout(480)}
await pg.click('#tapAlongPauseButton');await pg.waitForTimeout(300);
await pg.evaluate(()=>{const C=window.AudioContext.prototype,o=C.createOscillator;window.__osc=0;C.createOscillator=function(){window.__osc++;return o.call(this)}});
await pg.evaluate(()=>{document.getElementById('tapAlongAudio').currentTime=0});await pg.waitForTimeout(200);
const lb=await pg.evaluate(()=>!document.getElementById('tapAlongListenButton').disabled);await pg.click('#tapAlongListenButton');await pg.waitForTimeout(3600);
const l2=await pg.evaluate(()=>({osc:window.__osc,label:document.getElementById('tapAlongListenButton').textContent,st:document.getElementById('tapAlongStatus').textContent,playing:!document.getElementById('tapAlongAudio').paused}));
await pg.click('#tapAlongListenButton');await pg.waitForTimeout(300);const l3=await pg.evaluate(()=>({paused:document.getElementById('tapAlongAudio').paused,label:document.getElementById('tapAlongListenButton').textContent}));
ok('Tap-along: Listen plays the recording with the click track, Stop stops it',lb&&l2.playing&&l2.osc>=3&&/Stop/.test(l2.label)&&l3.paused&&/Listen/.test(l3.label),`clicksScheduled=${l2.osc} label=${l2.label} afterStop=${l3.label}`);
// ---- 3. Analyze: training with count-in, Space taps, all taps listed; downbeat tap + nudge; playhead ----
await pg.evaluate(()=>document.querySelector('[data-main-nav="analyze"]').click());await pg.waitForTimeout(400);
await pg.selectOption('#analysisMeter','4/4');await pg.setInputFiles('#analyzeAudioFile',path.join(TD,'bach_rubato.wav'));await pg.waitForTimeout(2500);
await pg.click('#startTrainingTapsButton');await pg.waitForTimeout(300);const cd=await pg.evaluate(()=>{const e=document.getElementById('trainingCountdown');return{vis:!e.classList.contains('hidden'),txt:e.textContent}});
await pg.waitForTimeout(2600);const playing=await pg.evaluate(()=>!document.getElementById('analysisAudio').paused);
await pg.focus('#trainingTapButton');for(let i=0;i<10;i++){await pg.keyboard.down('Space');await pg.waitForTimeout(90);await pg.keyboard.up('Space');await pg.waitForTimeout(520)}
const tt=await pg.evaluate(()=>({n:window.__TT_TEST__.analysis().taps.length,chips:document.querySelectorAll('#trainingTapList span').length,txt:document.getElementById('trainingTapReadout').textContent}));
ok('Tap training: 3-2-1 count-in, then audio plays and Space taps are recorded (one per press)',cd.vis&&/3|2|1/.test(cd.txt)&&playing&&tt.n===10,`countdown=${cd.txt} playing=${playing} taps=${tt.n}`);
ok('Tap training list shows every tap (no "…")',tt.chips===10&&!/…/.test(tt.txt),`chips=${tt.chips} readout=${tt.txt}`);
await pg.click('#startTrainingTapsButton');await pg.waitForTimeout(200);
await pg.click('#runAudioAnalysisButton');for(let i=0;i<90;i++){const s=await pg.evaluate(()=>document.getElementById('analyzeStatus').textContent);if(/ready/i.test(s))break;await pg.waitForTimeout(500)}
const an=await pg.evaluate(()=>({s:document.getElementById('analyzeStatus').textContent,sum:document.getElementById('analysisSummary').textContent,a:window.__TT_TEST__.analysis()}));
ok('Analysis uses the training taps (reported in the summary) and returns bar positions',/reference taps used/.test(an.sum)&&an.a.pos.length>0,`summary=${an.sum.slice(0,120)}`);
// downbeat: tap with count-in from the start
await pg.click('#tapDownbeatButton');await pg.waitForTimeout(2700);const capOn=await pg.evaluate(()=>/Beat 1/.test(document.getElementById('tapDownbeatButton').textContent));
await pg.waitForTimeout(400);await pg.keyboard.down('Space');await pg.waitForTimeout(80);await pg.keyboard.up('Space');await pg.waitForTimeout(400);
const d1=await pg.evaluate(()=>window.__TT_TEST__.analysis().down);const fineVis=await pg.evaluate(()=>!document.getElementById('downbeatFine').classList.contains('hidden'));
await pg.click('[data-db-nudge="0.01"]');await pg.waitForTimeout(150);const d2=await pg.evaluate(()=>window.__TT_TEST__.analysis().down);
await pg.fill('#downbeatSecInput','0.5');await pg.press('#downbeatSecInput','Enter');await pg.evaluate(()=>document.getElementById('downbeatSecInput').dispatchEvent(new Event('change')));await pg.waitForTimeout(200);const d3=await pg.evaluate(()=>window.__TT_TEST__.analysis());
ok('Downbeat: count-in, Space sets it, ±10 ms nudge and typed value move beat 1 exactly',capOn&&Number.isFinite(d1)&&fineVis&&Math.abs(d2-d1-0.01)<1e-6&&Math.abs(d3.down-0.5)<1e-6&&d3.firstBeats.some(v=>Math.abs(v-0.5)<1e-6),`tap=${d1?.toFixed?.(3)} nudged=${d2?.toFixed?.(3)} typed=${d3.down} beatAt0.5=${d3.firstBeats.some(v=>Math.abs(v-0.5)<1e-6)}`);
// playhead
await pg.click('#analysisPlayButton');await pg.waitForTimeout(1500);const ph1=await pg.evaluate(()=>({x:parseFloat(document.getElementById('analysisPlayhead').style.left),lab:document.getElementById('analysisPlayheadLabel').textContent,hid:document.getElementById('analysisPlayhead').classList.contains('hidden'),btn:document.getElementById('analysisPlayButton').textContent}));
await pg.waitForTimeout(1500);const ph2=await pg.evaluate(()=>parseFloat(document.getElementById('analysisPlayhead').style.left));await pg.click('#analysisPlayButton');
ok('Beat map: Play button in front, playhead moves with the audio and shows M.beat',!ph1.hid&&ph2>ph1.x&&/^M\d+\.\d+$/.test(ph1.lab)&&/Pause/.test(ph1.btn),`x ${ph1.x}→${ph2} label=${ph1.lab}`);
ok('"Create Click Track from Analysis" button removed',!(await pg.$('#createTrackFromAnalysisButton')),'');
// ---- 4. long recording ----
if(process.argv[2]){await pg.setInputFiles('#analyzeAudioFile',process.argv[2]);for(let i=0;i<120;i++){const s=await pg.evaluate(()=>document.getElementById('analyzeStatus').textContent);if(!/Loading|decoding/i.test(s))break;await pg.waitForTimeout(500)}
  const t0=Date.now();await pg.click('#runAudioAnalysisButton');let st='';for(let i=0;i<400;i++){st=await pg.evaluate(()=>document.getElementById('analyzeStatus').textContent);if(/ready|error|could not|timed out/i.test(st)&&!/AI beat tracker:/.test(st))break;await pg.waitForTimeout(1000)}
  const lc=await pg.evaluate(()=>{const c=document.getElementById('analysisCanvas'),x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<x.length;i+=4)if(x[i+3]>0)ink++;return{ink,spacer:parseFloat(document.getElementById('analysisTimelineSpacer').style.width),beats:window.__TT_TEST__.analysis().beats}});
  await pg.evaluate(()=>{const sc=document.getElementById('analysisTimelineScroll');sc.scrollLeft=sc.scrollWidth*0.8});await pg.waitForTimeout(300);
  const lc2=await pg.evaluate(()=>{const c=document.getElementById('analysisCanvas'),x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<x.length;i+=4)if(x[i+3]>0)ink++;return ink});
  ok('Long recording: analysis completes and the beat map draws (start and 80% in)',/ready/i.test(st)&&lc.ink>5000&&lc2>5000&&lc.spacer>32000,`${((Date.now()-t0)/1000).toFixed(0)}s beats=${lc.beats} spacerW=${lc.spacer} ink=${lc.ink}/${lc2} status=${st.slice(0,60)}`);}
ok('No page errors',!errs.length,errs.slice(0,3).join(' | '));
await b.close();process.exit(fails?1:0)})();
