// v1.8.1: Listen starts at the top; Stop always reachable while the score plays; PDF only in its own workflow.
const {chromium}=require('playwright');const path=require('path');const TD=path.join(__dirname,'testdata');let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
(async()=>{const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
for(const vp of [{width:1280,height:900},{width:390,height:844}]){const tag=vp.width<500?'[phone] ':'';const pg=await b.newPage({viewport:vp});const errs=[];pg.on('pageerror',e=>errs.push(e.message));const T=(f,...a)=>pg.evaluate(f,...a);
await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(800);
// With Audio: no PDF section
await T(()=>document.getElementById('homeCreateButton').click());await pg.waitForTimeout(200);await T(()=>document.getElementById('createMediaButton').click());await pg.waitForTimeout(400);
const vis=id=>T(sel=>{const e=document.querySelector(sel);return !!e&&getComputedStyle(e).display!=='none'&&e.offsetParent!==null},id);
ok(await vis('.tap-along-panel')&&!(await vis('.score-follow-panel')),tag+'"With Audio" shows the recording panel and no PDF panel');
// Listen starts from the beginning
await pg.setInputFiles('#tapAlongFile',path.join(TD,'clicks120.wav'));await pg.waitForTimeout(800);
await T(()=>{const a=document.getElementById('tapAlongAudio');return new Promise(r=>{if(a.readyState>=1)r();else a.addEventListener('loadedmetadata',r,{once:true})})});
await T(()=>window.__TT_TEST__.setRecordedTrack([500,1000,1500,2000,2500,3000],[1,0,0,0,1,0],[{startMeasure:1,meter:'4/4'}]));
await T(()=>{const a=document.getElementById('tapAlongAudio');a.currentTime=Math.min(3,(a.duration||6)*.6)});await pg.waitForTimeout(200);
await T(()=>document.getElementById('tapAlongListenButton').click());
const t=await T(()=>new Promise(r=>{const a=document.getElementById('tapAlongAudio');const iv=setInterval(()=>{if(!a.paused){clearInterval(iv);r(a.currentTime)}},20);setTimeout(()=>{clearInterval(iv);r(-1)},8000)}));ok(t>=0&&t<0.3,tag+`Listen starts from the top (playback began at ${t.toFixed(2)} s; it was parked at 3 s)`);
await T(()=>{const b=document.getElementById('tapAlongListenButton');if(/Stop/.test(b.textContent))b.click()});
// From Sheet Music: own mode, PDF panel only
await T(()=>window.__TT_TEST__.asReopened&&0);await pg.goto('http://localhost:8765/index.html?tt-test=1');await pg.waitForTimeout(800);await T(()=>document.getElementById('homeCreateButton').click());await pg.waitForTimeout(200);
await pg.setInputFiles('#createSheetPdfFile',path.join(TD,'smufl','smufl_leland_sys.pdf'));for(let i=0;i<80;i++){if(!(await T(()=>window.__TT_TEST__.busy()))&&/ready/i.test(await T(()=>document.getElementById('scoreAnalysisStatus').textContent)))break;await pg.waitForTimeout(250)}
ok(await vis('.score-follow-panel')&&!(await vis('.tap-along-panel')),tag+'"From Sheet Music" shows the score and no recording panel');
// Stop reachable while practicing even after the page auto-scrolls away
await T(()=>document.getElementById('scorePracticeStart').click());await pg.waitForTimeout(2500);await T(()=>window.scrollTo(0,document.body.scrollHeight));await pg.waitForTimeout(400);
const fb=await T(()=>{const e=document.getElementById('scoreFloatBar'),r=e.getBoundingClientRect();return{hidden:e.classList.contains('hidden'),inView:r.top>=0&&r.bottom<=innerHeight&&r.width>0,text:e.textContent}});
ok(!fb.hidden&&fb.inView,tag+`floating Stop is on screen while practicing (${fb.text})`);
await pg.click('#scoreFloatStop');await pg.waitForTimeout(400);ok(await T(()=>/stopped/i.test(document.getElementById('scorePracticeStatus').textContent)&&document.getElementById('scoreFloatBar').classList.contains('hidden')),tag+'floating Stop stops practice and hides');
ok(!errs.length,tag+'no page errors '+errs.join('|'));await pg.close()}
console.log(fails?`${fails} FAILED`:'ALL PASS');await b.close();process.exit(fails?1:0)})();
