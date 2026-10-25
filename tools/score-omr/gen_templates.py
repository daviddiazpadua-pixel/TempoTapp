import re,io,json,sys,cairosvg
import numpy as np
from PIL import Image
D='/usr/local/lib/python3.13/site-packages/verovio/data/'
fonts=sys.argv[1].split(',')
classes={**{f'E08{i}':str(i) for i in range(10)},'E08A':'C','E08B':'cut','E050':'other','E05C':'other','E062':'other','E260':'other','E261':'other','E262':'other','E0A4':'note','E0A3':'note','E0A2':'note','E4E5':'rest','E4E6':'rest','E4E4':'rest','E4E3':'rest','E4E7':'rest'}
GW,GH=10,14
def feat(img):  # img: bool array cropped to glyph bbox
  h,w=img.shape; im=Image.fromarray((img*255).astype('uint8')).resize((GW,GH),Image.BOX)
  a=np.asarray(im)/255.0; return ''.join(str(min(9,int(round(v*9)))) for v in a.flatten()), w/h
out=[]
for f in fonts:
  for code,label in classes.items():
    try: x=open(f'{D}{f}/{code}.xml').read()
    except FileNotFoundError: continue
    d=re.search(r' d="([^"]+)"',x).group(1)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400" viewBox="-400 -1200 1800 2800"><path transform="scale(1,-1)" fill="#000" d="{d}"/></svg>'
    png=cairosvg.svg2png(bytestring=svg.encode(),background_color='white')
    a=np.asarray(Image.open(io.BytesIO(png)).convert('L'))<128
    ys,xs=np.nonzero(a)
    if not len(ys): continue
    g=a[ys.min():ys.max()+1,xs.min():xs.max()+1]
    # height in staff spaces: units 250/space; svg scale 900/1800=.5 px/unit -> 125 px/space
    bits,asp=feat(g); out.append({'l':label,'f':f,'b':bits,'a':round(asp,3),'h':round(g.shape[0]/125,2)})
json.dump(out,open(sys.argv[2],'w'))
print(len(out))

# --- extra sources: LilyPond's Emmentaler (SVG font) and bold serif text digits (old engravings) ---
def add_emmentaler(out):
  E='/usr/local/lib/python3.13/site-packages/lilypond-binaries/share/lilypond/2.25.12/fonts/svg/emmentaler-20.svg'
  src=open(E).read()
  names={**{n:str(i) for i,n in enumerate(['zero','one','two','three','four','five','six','seven','eight','nine'])},'four.alt':'4','seven.alt':'7','timesig.C44':'C','timesig.C22':'cut',
         'clefs.G':'other','clefs.F':'other','clefs.C':'other','accidentals.sharp':'other','accidentals.flat':'other','accidentals.natural':'other',
         'noteheads.s0':'note','noteheads.s1':'note','noteheads.s2':'note','rests.0':'rest','rests.1':'rest','rests.2':'rest','rests.3':'rest'}
  for gname,label in names.items():
    m=re.search(r'<glyph[^>]*glyph-name="'+re.escape(gname)+r'"[^>]*?\sd="([^"]+)"',src) or re.search(r'<glyph[^>]*\sd="([^"]+)"[^>]*glyph-name="'+re.escape(gname)+'"',src)
    if not m: print('missing',gname);continue
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="-600 -1000 1800 2400"><path transform="scale(1,-1)" fill="#000" d="{m.group(1)}"/></svg>'
    a=np.asarray(Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(),background_color='white'))).convert('L'))<128
    ys,xs=np.nonzero(a)
    if not len(ys): print('empty',gname);continue
    g=a[ys.min():ys.max()+1,xs.min():xs.max()+1];bits,asp=feat(g);out.append({'l':label,'f':'Emmentaler','b':bits,'a':round(asp,3),'h':0})
def add_serif(out):
  from PIL import ImageFont,ImageDraw
  import glob
  for fp in [f for f in glob.glob('/usr/share/fonts/**/*.ttf',recursive=True) if re.search(r'(Serif-Bold|SerifBold|Serif-Bold)\.ttf$',f)][:2]:
    font=ImageFont.truetype(fp,200)
    for i in range(10):
      im=Image.new('L',(260,300),255);ImageDraw.Draw(im).text((30,20),str(i),font=font,fill=0);a=np.asarray(im)<128;ys,xs=np.nonzero(a)
      g=a[ys.min():ys.max()+1,xs.min():xs.max()+1];bits,asp=feat(g);out.append({'l':str(i),'f':os.path.basename(fp),'b':bits,'a':round(asp,3),'h':0})
import os
if len(sys.argv)>3:
  if 'emm' in sys.argv[3]: add_emmentaler(out)
  if 'serif' in sys.argv[3]: add_serif(out)
  json.dump(out,open(sys.argv[2],'w'));print('with extras',len(out))
