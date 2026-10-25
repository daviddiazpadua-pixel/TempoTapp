"""Render music21 pieces to audio with a known tempo curve -> WAV (22050 mono) + truth beats/downbeats."""
import numpy as np, json, sys, wave, math
from music21 import converter, stream, meter, note, chord
SR=22050
C='/usr/local/lib/python3.13/dist-packages/music21/corpus/'
def tone(freq,dur,vel=0.6):
    n=int(SR*min(dur+0.6,4.0));t=np.arange(n)/SR
    env=np.exp(-t*(2.2+freq/700))*(1-np.exp(-t*400))
    rel=np.clip((dur+0.08-t)/0.08,0,1)  # damper
    env*=np.where(t<dur,1,rel)
    y=np.zeros(n)
    for h,a in [(1,1),(2,.5),(3,.28),(4,.16),(5,.08),(6,.05)]:
        if freq*h<SR/2: y+=a*np.sin(2*np.pi*freq*h*t*(1+0.0004*h*h))
    y[:int(.004*SR)]+=np.random.randn(int(.004*SR))*0.25*np.linspace(1,0,int(.004*SR))  # hammer noise
    return vel*y*env
def tempo_curve(kind,total_beats):
    b=np.arange(total_beats+64,dtype=float);base=96
    if kind=='steady':bpm=np.full_like(b,base)
    elif kind=='rubato':bpm=base*(1+0.14*np.sin(2*np.pi*b/14)+0.05*np.sin(2*np.pi*b/5.3))
    elif kind=='rit':  # big slow-down at 60-80%, then a tempo
        bpm=np.full_like(b,base);s=int(total_beats*.6);e=int(total_beats*.8)
        bpm[s:e]=base*np.linspace(1,0.42,e-s);bpm[e:e+4]=base*0.42  # fermata-ish hold
    elif kind=='accel':bpm=base*np.linspace(0.8,1.3,len(b))
    else:raise ValueError(kind)
    return bpm
def render(path,kind,out,max_measures=None,seed=0):
    rng=np.random.default_rng(seed)
    s=converter.parse(C+path)
    parts=s.parts if hasattr(s,'parts') else [s]
    p0=parts[0];ms=list(p0.getElementsByClass(stream.Measure))
    if max_measures:ms=ms[:max_measures]
    ts=p0.recurse().getElementsByClass(meter.TimeSignature)[0]
    beat_q=ts.beatDuration.quarterLength; bpb=ts.beatCount
    # measure offsets in quarters (pickup aware)
    m_off=[m.offset for m in ms];end_q=ms[-1].offset+ms[-1].duration.quarterLength
    nbeats=int(math.ceil(end_q/beat_q))+2
    bpm=tempo_curve(kind,nbeats)
    # beat times: integrate
    bt=np.concatenate([[0],np.cumsum(60/bpm)])  # time of beat k (beat unit = ts beat)
    def q2t(q):
        x=q/beat_q;k=int(np.floor(x));f=x-k;return 0.5+bt[k]+f*(bt[k+1]-bt[k])
    # expressive micro-timing jitter (human): +-12 ms
    y=np.zeros(int(SR*(q2t(end_q)+3)))
    for part in parts:
        for n in part.recurse().notes:
            q=n.getOffsetInHierarchy(s)
            if q>=end_q:continue
            dur=q2t(q+n.duration.quarterLength)-q2t(q)
            t0=q2t(q)+rng.normal(0,0.008)
            pitches=[n.pitch] if isinstance(n,note.Note) else list(n.pitches)
            for pt in pitches:
                w=tone(pt.frequency,max(0.05,dur),0.35+0.25*rng.random())
                i0=int(t0*SR);y[i0:i0+len(w)]+=w[:max(0,len(y)-i0)]
    y=y/np.max(np.abs(y))*0.8
    # truth: beats from first measure-aligned beat; downbeats at measure starts
    first_q=ms[0].offset; pickup_q=ms[0].duration.quarterLength if ms[0].duration.quarterLength<ts.barDuration.quarterLength-1e-6 else 0
    beats=[];downs=[]
    anchor=ms[1].offset if (pickup_q and len(ms)>1) else ms[0].offset
    q=anchor%beat_q
    while q<end_q-1e-6:
        beats.append(q2t(q));q+=beat_q
    for m in ms:
        # measure start = downbeat unless it's a pickup measure
        if m.duration.quarterLength>=ts.barDuration.quarterLength-1e-6 or m is not ms[0]: downs.append(q2t(m.offset))
    with wave.open(out+'.wav','wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes((y*32767).astype('<i2').tobytes())
    json.dump({'beats':beats,'downbeats':downs,'bpb':bpb,'meter':ts.ratioString,'kind':kind,'dur':len(y)/SR},open(out+'.json','w'))
    print(out,kind,ts.ratioString,len(beats),'beats',round(len(y)/SR,1),'s')
if __name__=='__main__':
    import os;os.makedirs('audio',exist_ok=True)
    jobs=[('mozart/k545/movement1_exposition.mxl','mozart'),('bach/bwv10.7.mxl','bach'),('joplin/maple_leaf_rag.mxl','joplin'),('chopin/mazurka06-2.krn','chopin'),('schubert/Lindenbaum.xml','schubert'),('haydn/opus74no1/movement3.mxl','haydnmin')]
    for path,name in jobs:
        for kind in ['steady','rubato','rit']:
            try:render(path,kind,f'audio/{name}_{kind}',max_measures=40,seed=hash(name+kind)%1000)
            except Exception as e:print('FAIL',name,kind,e)
