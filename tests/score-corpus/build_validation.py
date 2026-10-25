import verovio,cairosvg,io,json,random,re,sys
from music21 import corpus,converter,meter,tempo,stream
from pypdf import PdfWriter,PdfReader
random.seed(int(sys.argv[2]) if len(sys.argv)>2 else 11)
used={'bwv1.6','bwv10.7','movement1_exposition','maple_leaf_rag','Lindenbaum','laDonnaEMobile','mazurka06-2','madrigal.3.1','1grave','Lascia_chio_pianga'}
cands=[str(p) for p in corpus.getPaths() if str(p).endswith(('.mxl','.xml','.krn')) and not any(u in str(p) for u in used)]
random.shuffle(cands)
fonts=['Bravura','Leland','Petaluma','Gootville','Leipzig']
out={};os=__import__('os');os.makedirs('val',exist_ok=True);n=0
for path in cands:
  if n>=int(sys.argv[1]):break
  try:
    s=converter.parse(path)
    if not hasattr(s,'parts') or not s.parts:continue
    p=s.parts[0];ms=list(p.getElementsByClass(stream.Measure))
    if len(ms)<8 or len(ms)>220 or len(s.parts)>6:continue
    ts=[]
    for i,m in enumerate(ms):
      for t in m.getElementsByClass(meter.TimeSignature):
        if not ts or ts[-1][1]!=t.ratioString: ts.append([i+1,t.ratioString])
    font=random.choice(fonts);scale=random.choice([30,35,40,45,50]);page=random.choice([(2100,2970),(2159,2794)])
    tk=verovio.toolkit();tk.setOptions({'pageWidth':page[0],'pageHeight':page[1],'scale':scale,'font':font,'footer':'none','header':'auto','breaks':'auto'})
    tk.loadFile(str(s.write('musicxml')));pages=[];w=PdfWriter()
    for pg in range(1,tk.getPageCount()+1):
      svg=re.sub(r'<tspan font-family="[A-Za-z]+"( font-size="[^"]*")?>[^<]*</tspan>','<tspan>♩</tspan>',tk.renderToSVG(pg))
      pages.append([len(re.findall(r'class="measure',x)) for x in svg.split('class="system"')[1:]])
      w.append(PdfReader(io.BytesIO(cairosvg.svg2pdf(bytestring=svg.encode()))))
    total=sum(sum(x) for x in pages)
    name=f'v{n:02d}_'+re.sub(r'[^A-Za-z0-9]+','_',path.split('corpus/')[-1])[:40]
    w.write(f'val/{name}.pdf')
    out[name]={'measures':total,'meters':ts or [[1,'?']],'systems':pages,'font':font,'scale':scale,'staves':len(s.parts),'m21measures':len(ms)}
    print(name,font,scale,total,len(ms),ts[:3]);n+=1
  except Exception as e: print('skip',path.split('corpus/')[-1],repr(e)[:80])
json.dump(out,open('val/truth.json','w'),indent=1)
