import re
import verovio,cairosvg,io,json,random
from music21 import stream,note,meter,tempo,clef,key,expressions
from pypdf import PdfWriter,PdfReader
random.seed(7)
truth=json.load(open('truth.json'))
def mk(name,segments,mm=None,word=None,parts=1,pitches=('C4','D4','E4','F4','G4','A4','B4','C5')):
  sc=stream.Score();total=sum(n for _,n in segments)
  for pi in range(parts):
    p=stream.Part();num=1
    for si,(ts,n) in enumerate(segments):
      t=meter.TimeSignature(ts);bar=t.barDuration.quarterLength
      for k in range(n):
        m=stream.Measure(number=num)
        if k==0:m.append(meter.TimeSignature(ts))
        if num==1 and pi==0:
          if mm or word:m.insert(0,tempo.MetronomeMark(text=word,number=mm,referent=note.Note(type='quarter') if mm else None))
        q=0
        while q<bar-1e-6:
          d=random.choice([.5,1,1,2]) ; d=min(d,bar-q)
          nn=note.Note(random.choice(pitches) if pi==0 else 'C3',quarterLength=d)
          if pi==1:nn.pitch.octave=3
          m.append(nn);q+=d
        p.append(m);num+=1
    if pi==1:p.insert(0,clef.BassClef())
    sc.insert(0,p)
  xml=sc.write('musicxml');tk=verovio.toolkit();tk.setOptions({'pageWidth':2100,'pageHeight':2970,'scale':42,'footer':'none'});tk.loadFile(str(xml));w=PdfWriter()
  for pg in range(1,tk.getPageCount()+1):w.append(PdfReader(io.BytesIO(cairosvg.svg2pdf(bytestring=re.sub(r'<tspan font-family="Leipzig"([^>]*)>[^<]*</tspan>','<tspan\\1>\u2669</tspan>',tk.renderToSVG(pg)).encode()))))
  w.write(f'pdf/{name}.pdf');meters=[];s=1
  for ts,n in segments:meters.append([s,ts]);s+=n
  truth[name]={'measures':total,'meters':meters,'tempo':mm,'tempo_word':word,'pages':tk.getPageCount(),'staves':parts,'pickup':False};print(name,truth[name])
mk('syn_68',[('6/8',24)],mm=None,word='Andante')
mk('syn_54',[('5/4',20)],mm=88)
mk('syn_78',[('7/8',28)],mm=144)
mk('syn_128_piano',[('12/8',16)],mm=60,parts=2)
mk('syn_22',[('2/2',32)],word='Allegro')
mk('syn_change',[('4/4',8),('3/4',8),('6/8',8),('4/4',8)],mm=100,parts=2)
mk('syn_34_long',[('3/4',96)],mm=132)
json.dump(truth,open('truth.json','w'),indent=1)
