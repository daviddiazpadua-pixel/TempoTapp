const fs=require('fs'),cp=require('child_process'),path=require('path');
const OMR=require(process.env.OMR||'/root/omr/score-omr.js');
const CDIR=process.env.CDIR||'/root/corpus/pdf',TFILE=process.env.TFILE||'/root/corpus/truth.json';const truth=JSON.parse(fs.readFileSync(TFILE));const filt=process.argv[2]?new RegExp(process.argv[2]):null;const DPI=process.env.DPI||'170';
function readPGM(f){const b=fs.readFileSync(f);let p=0,tok=[];while(tok.length<4){while(/\s/.test(String.fromCharCode(b[p])))p++;if(b[p]===35){while(b[p]!==10)p++;continue}let s='';while(!/\s/.test(String.fromCharCode(b[p])))s+=String.fromCharCode(b[p++]);tok.push(s)}p++;return{w:+tok[1],h:+tok[2],g:new Uint8Array(b.buffer,b.byteOffset+p,(+tok[1])*(+tok[2]))}}
function meterMap(pages){let m=0;const map=[];for(const pg of pages)for(const s of pg.systems){s.sigs.forEach(sig=>{const at=sig.where==='start'?m+1:m+sig.where+1;if(!map.length||map.at(-1)[1]!==sig.meter){if(map.length&&map.at(-1)[0]===at)map[map.length-1][1]=sig.meter;else map.push([at,sig.meter])}});m+=s.measures.length}if(!map.length)map.push([1,'?']);if(map[0][0]!==1)map.unshift([1,'?']);return map}
const ST=process.env.TFILE?Object.fromEntries(Object.entries(truth).map(([k,v])=>[k,v.systems])):fs.existsSync('/root/corpus/systruth.json')?JSON.parse(fs.readFileSync('/root/corpus/systruth.json')):{};
let tot=0,okm=0,okt=0,okall=0;const out={};
for(const name of Object.keys(truth).filter(n=>!filt||filt.test(n))){
  const T=truth[name],dir=`/tmp/pgm_${DPI}/${name}`;if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});cp.execSync(`pdftoppm -gray -r ${DPI} "${CDIR}/${name}.pdf" ${dir}/p`)}
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.pgm')).sort();const t0=Date.now();
  const pages=files.map(f=>{const {w,h,g}=readPGM(path.join(dir,f));return OMR.analyzePage(g,w,h)});
  const NM=OMR.numberMeasures(pages),meas=NM.total,mm=NM.meters.length?NM.meters.map(x=>[x.measure,x.meter]):[[1,'?']];if(mm[0][0]!==1)mm.unshift([1,'?']);
  const perSys=pages.map(p=>p.systems.map(s=>s.measures.length+(s.staves>1?'x'+s.staves:'')).join(','));
  const okM=meas===T.measures,okT=JSON.stringify(mm)===JSON.stringify(T.meters);tot++;okm+=okM;okt+=okT;okall+=okM&&okT;
  out[name]={meas,mm,perSys};
  const base=name.replace(/^scan_/,'');let diffs=[];if(ST[base]&&!okM){pages.forEach((p,pi)=>{const got=p.systems.map(s=>s.measures.length),want=ST[base][pi]||[];if(JSON.stringify(got)!==JSON.stringify(want))diffs.push(`p${pi+1}: got [${got}] want [${want}]`)})}
  console.log(`${okM&&okT?'PASS':'FAIL'} ${name.padEnd(26)} meas ${String(meas).padStart(4)}/${String(T.measures).padEnd(4)}${okM?'✓':'✗'} meter ${JSON.stringify(mm)} ${okT?'✓':'✗ want '+JSON.stringify(T.meters)} ${(Date.now()-t0)}ms${diffs.length?'\n   '+diffs.slice(0,6).join('  '):''}${process.env.V?'\n   '+perSys.join(' | ')+'  sp='+pages.map(p=>p.sp+'/'+p.skew.toFixed(2)).join(','):''}`);
}
console.log(`\nmeasures ${okm}/${tot} · meters ${okt}/${tot} · both ${okall}/${tot}`);fs.writeFileSync('/tmp/omr_out.json',JSON.stringify(out,null,1));
