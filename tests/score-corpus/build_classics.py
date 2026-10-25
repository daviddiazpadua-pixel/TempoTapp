import re
import verovio, cairosvg, json, io, os, sys, re
from music21 import corpus, converter, meter, tempo, stream
from pypdf import PdfWriter, PdfReader
C='/usr/local/lib/python3.13/dist-packages/music21/corpus/'
pieces={
 'bach_bwv1.6':'bach/bwv1.6.mxl','bach_bwv10.7':'bach/bwv10.7.mxl',
 'mozart_k545_1':'mozart/k545/movement1_exposition.mxl','joplin_maple':'joplin/maple_leaf_rag.mxl',
 'beeth_op18_1_3':'beethoven/opus18no1/movement3.mxl','haydn_op74_1_1':'haydn/opus74no1/movement1.mxl',
 'mozart_k80_1':'mozart/k80/movement1.mxl','corelli_grave':'corelli/opus3no1/1grave.xml',
 'handel_lascia':'handel/rinaldo/Lascia_chio_pianga.mxl','schubert_linden':'schubert/Lindenbaum.xml',
 'verdi_donna':'verdi/laDonnaEMobile.mxl','chopin_maz':'chopin/mazurka06-2.krn','monteverdi':'monteverdi/madrigal.3.1.mxl',
 'mozart_k155_2':'mozart/k155/movement2.mxl','haydn_op1_1_3':'haydn/opus1no1/movement3.mxl',
}
os.makedirs('pdf',exist_ok=True);truth={}
for name,rel in pieces.items():
  try:
    s=converter.parse(C+rel)
    p=s.parts[0] if hasattr(s,'parts') and s.parts else s
    ms=list(p.getElementsByClass(stream.Measure))
    ts=[]
    for i,m in enumerate(ms):
      for t in m.getElementsByClass(meter.TimeSignature): ts.append([i+1,t.ratioString])
    mm=[x.number for x in s.recurse().getElementsByClass(tempo.MetronomeMark) if x.number]
    pick=bool(ms and ms[0].duration.quarterLength < (ms[0].barDuration.quarterLength if ms[0].barDuration else 0)-1e-6)
    xml=s.write('musicxml')
    tk=verovio.toolkit();tk.setOptions({'pageWidth':2100,'pageHeight':2970,'scale':40,'footer':'none','header':'auto','breaks':'auto','pageMarginLeft':100,'pageMarginRight':100})
    tk.loadFile(str(xml));n=tk.getPageCount();w=PdfWriter()
    for pg in range(1,n+1):
      pdfb=cairosvg.svg2pdf(bytestring=re.sub(r'<tspan font-family="Leipzig"([^>]*)>[^<]*</tspan>','<tspan\\1>\u2669</tspan>',tk.renderToSVG(pg)).encode());w.append(PdfReader(io.BytesIO(pdfb)))
    w.write(f'pdf/{name}.pdf')
    truth[name]={'measures':len(ms),'meters':ts,'tempo':mm[0] if mm else None,'pages':n,'staves':len(s.parts) if hasattr(s,'parts') else 1,'pickup':pick}
    print(name,truth[name])
  except Exception as e: print('FAIL',name,repr(e)[:200])
json.dump(truth,open('truth.json','w'),indent=1)
