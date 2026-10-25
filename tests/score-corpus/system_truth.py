import verovio,json,re
from music21 import converter
C='/usr/local/lib/python3.13/dist-packages/music21/corpus/'
pieces={'bach_bwv1.6':'bach/bwv1.6.mxl','bach_bwv10.7':'bach/bwv10.7.mxl','mozart_k545_1':'mozart/k545/movement1_exposition.mxl','joplin_maple':'joplin/maple_leaf_rag.mxl','beeth_op18_1_3':'beethoven/opus18no1/movement3.mxl','haydn_op74_1_1':'haydn/opus74no1/movement1.mxl','mozart_k80_1':'mozart/k80/movement1.mxl','corelli_grave':'corelli/opus3no1/1grave.xml','handel_lascia':'handel/rinaldo/Lascia_chio_pianga.mxl','schubert_linden':'schubert/Lindenbaum.xml','verdi_donna':'verdi/laDonnaEMobile.mxl','chopin_maz':'chopin/mazurka06-2.krn','monteverdi':'monteverdi/madrigal.3.1.mxl','mozart_k155_2':'mozart/k155/movement2.mxl','haydn_op1_1_3':'haydn/opus1no1/movement3.mxl'}
out={}
for name,rel in pieces.items():
  xml=converter.parse(C+rel).write('musicxml')
  tk=verovio.toolkit();tk.setOptions({'pageWidth':2100,'pageHeight':2970,'scale':40,'footer':'none','header':'auto','breaks':'auto','pageMarginLeft':100,'pageMarginRight':100});tk.loadFile(str(xml))
  pages=[]
  for pg in range(1,tk.getPageCount()+1):
    svg=tk.renderToSVG(pg);parts=svg.split('class="system"')[1:]
    pages.append([len(re.findall(r'class="measure',p)) for p in parts])
  out[name]=pages;print(name,pages)
json.dump(out,open('systruth.json','w'))
