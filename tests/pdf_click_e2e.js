// PDF-only flow (v1.5.1): adding a sheet-music PDF with no click track must build one.
// Run from the repo root with: python3 -m http.server 8765 & node tests/pdf_click_e2e.js
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1280,height:900}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
const t=id=>pg.evaluate(i=>document.getElementById(i)?.textContent,id);
await pg.goto('http://localhost:8765/index.html');await pg.waitForTimeout(1500);
await pg.evaluate(()=>{for(const id of ['homeCreateButton','createMediaButton']){document.getElementById(id)?.click()}});await pg.waitForTimeout(800);
await pg.setInputFiles('#scorePdfFile','tests/testdata/score_real.pdf');await pg.waitForTimeout(8000);
for(const id of ['scoreAnalysisStatus','scoreClickSource','scoreMapReadout','scoreAnchorCount','status','durationPill','scoreMakeClickButton'])console.log(id,'=>',await t(id));
console.log('bpm field',await pg.inputValue('#scoreClickBpm'),'measures',await pg.inputValue('#scoreClickMeasures'));
console.log('beats', await t('durationPill'));
// change meter to 3/4 -> regenerates
await pg.selectOption('#scoreClickMeter','3/4');await pg.waitForTimeout(500);console.log('after 3/4:',await t('scoreAnalysisStatus'),await t('durationPill'));
await pg.selectOption('#scoreClickMeter','4/4');await pg.waitForTimeout(500);
// practice without audio
console.log('practice disabled?',await pg.evaluate(()=>document.getElementById('scorePracticeStart').disabled));
await pg.evaluate(()=>document.getElementById('scorePracticeStart').click());await pg.waitForTimeout(3600);console.log('practice',await t('scorePracticeStatus'));
await pg.evaluate(()=>document.getElementById('scorePracticePause').click());await pg.waitForTimeout(300);console.log('paused',await t('scorePracticeStatus'));
await pg.evaluate(()=>document.getElementById('scorePracticeStart').click());await pg.waitForTimeout(2600);console.log('resumed',await t('scorePracticeStatus'));
await pg.evaluate(()=>document.getElementById('scorePracticeStop').click());
await pg.evaluate(()=>document.querySelector('.score-follow-panel').scrollIntoView());await pg.waitForTimeout(300);
await pg.screenshot({path:'/tmp/pdf_click.png'});
// playback via main Play
console.log('play disabled?',await pg.evaluate(()=>document.getElementById('playButton').disabled));
console.log('errors',errs);await b.close()})();
