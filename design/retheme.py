"""Engraved retheme: map the dark-navy palette to paper-and-ink, family by family, in CSS and JS."""
import re, colorsys, sys

SRC = '/home/claude/TempoTap.html'
OUT = '/home/claude/design/TempoTap.engraved.html'

INK = (0x14, 0x14, 0x14); PENCIL = (0xB5, 0x12, 0x1B); GOOD = (0x1F, 0x6B, 0x3A); GUIDE = (0x2B, 0x5F, 0x8A); WARN = (0x9A, 0x6B, 0x00)

def parse(c):
    c = c.strip()
    if c.startswith('#'):
        h = c[1:]
        if len(h) in (3, 4): h = ''.join(ch * 2 for ch in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else None
        return r, g, b, a
    m = re.match(r'rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)', c)
    if not m: return None
    r, g, b = (float(m.group(i)) for i in (1, 2, 3)); a = float(m.group(4)) if m.group(4) else None
    return r, g, b, a

def fmt(rgb, a):
    r, g, b = (max(0, min(255, int(round(v)))) for v in rgb)
    if a is None: return '#%02x%02x%02x' % (r, g, b)
    return 'rgba(%d,%d,%d,%s)' % (r, g, b, ('%.3f' % a).rstrip('0').rstrip('.') or '0')

def grey(l):  # warm-neutral paper greys
    r, g, b = colorsys.hls_to_rgb(55 / 360, l, 0.06); return (r * 255, g * 255, b * 255)

def remap(c):
    p = parse(c)
    if not p: return c
    r, g, b, a = p
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255); hd = h * 360
    # pure black/white with alpha: shadows & highlights on a dark UI
    if s < 0.02 and l < 0.05 and a is not None: return fmt((0, 0, 0), a * 0.35)      # shadows → faint
    if s < 0.02 and l > 0.95 and a is not None: return fmt((0, 0, 0), a * 0.25)      # white glints → faint ink tints
    if s < 0.02 and l > 0.95: return c                                                  # #fff stays (text on black buttons)
    # family by hue, only for saturated colors
    if s >= 0.35 and l > 0.25:
        if 300 <= hd <= 360 or hd < 15:  fam = PENCIL
        elif 130 <= hd <= 175:           fam = GOOD
        elif 185 <= hd <= 215:           fam = GUIDE
        elif 25 <= hd <= 60:             fam = WARN
        elif 215 < hd <= 275:            fam = INK      # brand purple/blue → ink
        else:                            fam = INK
        if a is not None: return fmt(fam, a)
        # solid light tints of a family (e.g. #ffd5e6, #bff7e5) are used as text on dark; make them the family ink
        return fmt(fam, None)
    # neutrals (the navy greys): dark → paper, light → ink
    if l < 0.45:
        lp = 1 - l * 1.15; lp = max(0.90, min(1.0, lp))
        return fmt(grey(lp), a)
    else:
        li = max(0.08, min(0.55, 1 - l))
        return fmt(grey(li), a)

s = open(SRC).read()
head, rest = s.split('<style>', 1)
css_blocks = re.findall(r'<style>(.*?)</style>', s, re.S)
pat = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]*\)')
def remap_css(block): return pat.sub(lambda m: remap(m.group(0)), block)
out = s
for block in css_blocks:
    out = out.replace('<style>' + block + '</style>', '<style>' + remap_css(block) + '</style>', 1)
# JS: only quoted color literals (canvas fillStyle/strokeStyle, inline styles)
scripts = re.findall(r'<script>(.*?)</script>', out, re.S)
main = scripts[1]
main2 = re.sub(r"(['\"])(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\1", lambda m: m.group(1) + remap(m.group(2)) + m.group(1), main)
out = out.replace(main, main2, 1)
# theme-color meta
out = out.replace('<meta name="theme-color" content="#080b13">', '<meta name="theme-color" content="#ffffff">')
open(OUT, 'w').write(out)
print('written', OUT, len(out))
