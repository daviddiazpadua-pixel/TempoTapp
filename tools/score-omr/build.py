"""Build vendor/score-omr.js from score-omr.src.js + glyph templates.
Usage (from repo root):
  python3 tools/score-omr/gen_templates.py Bravura,Gootville,Leland,Petaluma,Leipzig tools/score-omr/tpl_ship.json emm,serif   # needs verovio, cairosvg, lilypond (pip)
  python3 tools/score-omr/build.py
"""
import json,os
here=os.path.dirname(os.path.abspath(__file__));root=os.path.dirname(os.path.dirname(here))
t=json.load(open(os.path.join(here,'tpl_ship.json')));src=open(os.path.join(here,'score-omr.src.js')).read()
out=src.replace('__TEMPLATES__',json.dumps([{k:x[k] for k in ('l','b','a','h')} for x in t],separators=(',',':')))
open(os.path.join(root,'vendor','score-omr.js'),'w').write(out);print('wrote vendor/score-omr.js',len(out),'bytes')
