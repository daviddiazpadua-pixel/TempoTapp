// v1.7.2: count-in before tapping, audible Listen (recording ducked, brighter clicks),
// jump to the click editor with a moving playhead, and drag-to-fix while listening.
// Serve the repo on :8765, then: node tests/v172_listen.js
const {chromium}=require('playwright');const path=require('path');const TD=path.join(__dirname,'testdata');let fails=0;
const ok=(n,c,i)=>{console.log(`${c?'PASS':'FAIL'}  ${n}  ${i||''}`);if(!c)fails++};
(async()=>{const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
for(const vp of [{width:1280,height:900},{width:390,height:844}]){const pg=await b.newPage({viewport:vp});const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(/PROBE/.test(m.text()))console.log(m.text())});const tag=vp.width<500?'[phone]':'[desktop]';
await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(900);
await pg.evaluate(()=>document.getElementById('homeCreateButton').click());await pg.waitForTimeout(200);
// count-in on Start Clicks
await pg.evaluate(()=>document.getElementById('createScratchButton').click());await pg.waitForTimeout(300);
await pg.evaluate(()=>document.getElementById('startButton').click());await pg.waitForTimeout(250);
const c1=await pg.evaluate(()=>({vis:!document.getElementById('recCountdown').classList.contains('hidden'),txt:document.getElementById('recCountdown').textContent,rec:window.__TT_TEST__.rec().recording}));
await pg.waitForTimeout(2400);const c2=await pg.evaluate(()=>window.__TT_TEST__.rec().recording);
ok(`${tag} Start Clicks: 4-count count-in, recording starts after it`,c1.vis&&c1.txt==='4'&&!c1.rec&&c2,`shown=${c1.txt} recDuring=${c1.rec} recAfter=${c2}`);
await pg.evaluate(()=>document.getElementById('endButton').click());await pg.waitForTimeout(200);
// tap-along with count-in
await pg.evaluate(()=>{document.getElementById('changeCreateModeButton')?.click()});await pg.waitForTimeout(200);await pg.evaluate(()=>document.getElementById('createMediaButton').click());await pg.waitForTimeout(400);
await pg.evaluate(()=>{const o=[...document.querySelectorAll('#uiDialog button, .modal-backdrop.open button')].find(b=>/start new|ok|continue/i.test(b.textContent));o?.click()});await pg.waitForTimeout(300);
await pg.setInputFiles('#tapAlongFile',path.join(TD,'clicks120.wav'));await pg.waitForTimeout(1200);
await pg.evaluate(()=>document.getElementById('tapAlongStartButton').click());await pg.waitForTimeout(250);
const t1=await pg.evaluate(()=>({vis:!document.getElementById('recCountdown').classList.contains('hidden'),paused:document.getElementById('tapAlongAudio').paused}));
await pg.waitForTimeout(2000);const t2=await pg.evaluate(()=>!document.getElementById('tapAlongAudio').paused);
ok(`${tag} Play & Tap: count-in first, then the recording plays`,t1.vis&&t1.paused&&t2,`countdown=${t1.vis} pausedDuring=${t1.paused} playingAfter=${t2}`);
for(let i=0;i<8;i++){await pg.evaluate(()=>document.getElementById('tapRegularButton').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0})));await pg.waitForTimeout(500)}
await pg.evaluate(()=>document.getElementById('tapAlongPauseButton').click());await pg.waitForTimeout(300);
// listen
await pg.evaluate(()=>{const C=window.AudioContext.prototype,o=C.createOscillator,g=C.createGain;window.__osc=[];C.createOscillator=function(){const x=o.call(this),st=x.start.bind(x);x.start=t=>{window.__osc.push({t,type:x.type});return st(t)};return x};document.getElementById('tapAlongAudio').currentTime=0;window.scrollTo(0,0)});
await pg.waitForTimeout(200);const before=await pg.evaluate(()=>window.__TT_TEST__.track().tapMs);
await pg.evaluate(()=>document.getElementById('tapAlongListenButton').click());await pg.waitForTimeout(1500);
const l1=await pg.evaluate(()=>{const ed=document.querySelector('.panel.editor').getBoundingClientRect(),ph=document.getElementById('dragEditorPlayhead');return{vol:document.getElementById('tapAlongAudio').volume,inView:ed.top<innerHeight&&ed.bottom>0,ph:!ph.classList.contains('hidden'),x:parseFloat(ph.style.left),bright:window.__osc.filter(o=>o.type==='square').length,hit:!!document.querySelector('.drag-click-marker.hit')}});
await pg.waitForTimeout(700);const x2=await pg.evaluate(()=>parseFloat(document.getElementById('dragEditorPlayhead').style.left));
ok(`${tag} Listen: recording turned down, clicks get the bright layer`,l1.vol<=0.56&&l1.bright>=2,`vol=${l1.vol} brightClicks=${l1.bright}`);
ok(`${tag} Listen: jumps to the click editor, playhead moves, current click lights up`,l1.inView&&l1.ph&&x2>l1.x&&l1.hit,`inView=${l1.inView} playhead ${l1.x}→${x2} hit=${l1.hit}`);
// drag the last click while listening; the scheduled click must move
const idx=before.length-1;await pg.evaluate(i=>{document.getElementById('dragEditorScroll').dispatchEvent(new WheelEvent('wheel'));const m=document.querySelector(`#dragEditorMarkers .drag-click-marker[data-tap-index="${i}"]`);m.scrollIntoView({inline:'center',block:'center'});return 0},idx);await pg.waitForTimeout(500);const box=await pg.evaluate(i=>{const m=document.querySelector(`#dragEditorMarkers .drag-click-marker[data-tap-index="${i}"]`);const r=m.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}},idx);
const n0=await pg.evaluate(()=>window.__osc.length);
await pg.mouse.move(box.x,box.y);await pg.mouse.down();for(let k=1;k<=6;k++){await pg.mouse.move(box.x-k*4,box.y);await pg.waitForTimeout(40)}await pg.mouse.up();await pg.waitForTimeout(300);
const after=await pg.evaluate(()=>({taps:window.__TT_TEST__.track().tapMs,listening:/Stop/.test(document.getElementById('tapAlongListenButton').textContent)}));
await pg.waitForTimeout(Math.max(0,after.taps[idx]-0)+0);// let playback reach it
await pg.waitForTimeout(Math.max(500,after.taps[idx]-1500+600));
const heard=await pg.evaluate(()=>window.__osc.length);
ok(`${tag} Drag while listening: click moves, playback keeps going, new timing is played`,after.taps[idx]<before[idx]-5&&after.listening&&heard>n0,`tap ${before[idx].toFixed(0)}→${after.taps[idx].toFixed(0)}ms listening=${after.listening} clicksAfterDrag=${heard-n0}`);
await pg.evaluate(()=>{const b=document.getElementById('tapAlongListenButton');if(/Stop/.test(b.textContent))b.click()});await pg.waitForTimeout(300);
const s1=await pg.evaluate(()=>({vol:document.getElementById('tapAlongAudio').volume,ph:document.getElementById('dragEditorPlayhead').classList.contains('hidden')}));
ok(`${tag} Stop listening: volume restored, playhead hidden`,s1.vol===1&&s1.ph,`vol=${s1.vol} hidden=${s1.ph}`);
ok(`${tag} No page errors`,!errs.length,errs.slice(0,3).join(' | '));await pg.close()}
await b.close();process.exit(fails?1:0)})();
