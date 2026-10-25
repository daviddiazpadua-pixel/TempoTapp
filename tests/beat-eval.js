const fs=require('fs');const New=require('./decoder.js');
const files=fs.readdirSync('audio').filter(f=>f.endsWith('.probs')).sort();
function fmeas(det,ref,tol=0.07){let used=new Set(),tp=0;for(const r of ref){let bi=-1,bd=tol;det.forEach((d,i)=>{if(!used.has(i)&&Math.abs(d-r)<=bd){bd=Math.abs(d-r);bi=i}});if(bi>=0){used.add(bi);tp++}}const p=det.length?tp/det.length:0,rc=ref.length?tp/ref.length:0;return p+rc?2*p*rc/(p+rc):0}
const cfgs=JSON.parse(process.argv[2]);
for(const cfg of cfgs){let bf=0,df=0,n=0;const per=[];for(const f of files){const truth=JSON.parse(fs.readFileSync('audio/'+f.replace('.probs','.json')));const b=fs.readFileSync('audio/'+f),probs=new Float32Array(b.buffer,b.byteOffset,b.length/4),T=probs.length/3;
  const tb=truth.beats;let taps=[];const ntap=cfg.ntap??8;if(ntap){const k=Math.floor(tb.length*(cfg.at??0.25));taps=tb.slice(k,k+ntap).map((t,i)=>t+((i*37)%5-2)*0.012)}
  const r=(cfg.learn?New.decodeLearned:New.decode)(probs,T,{beatsPerBar:truth.bpb,lambda:cfg.lambda||30,taps,priorWeight:cfg.pw,slowFactor:cfg.sf,fastFactor:cfg.ff});
  const a=fmeas(r.beats.map(x=>x.time),tb),d=fmeas(r.beats.filter(x=>x.downbeat).map(x=>x.time),truth.downbeats);bf+=a;df+=d;n++;per.push(f.replace('.probs','')+':'+a.toFixed(2))}
  console.log(JSON.stringify(cfg).padEnd(48),'beatF',(bf/n).toFixed(3),'downF',(df/n).toFixed(3),process.env.V?'\n  '+per.join(' '):'')}
