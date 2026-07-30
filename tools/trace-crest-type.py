#!/usr/bin/env python3
"""Trace the crest band lettering (spec §16 C3-TYPE) into SVG path outlines.

Face is PINNED: Futura-CondensedExtraBold from the macOS Futura.ttc — the
face the approved render resolved (measured via canvas widths, plan header).
Layout replicates SVG textPath: glyphs advance along the arc (letter-spacing
between glyphs), each glyph's advance-center sits on the arc, rotated to the
tangent. Geometry constants come from tools/crest-round2.html candidate A:
  top arc:    M 51.9 141.2 A 159 159 0 0 1 348.1 141.2  -> C=(200,199.1) r=159
  bottom arc: M 51.9 258.8 A 159 159 0 0 0 348.1 258.8  -> C=(200,200.9) r=159
Writes tools/crest-type-paths.svg (fragment: three <g> blocks).
"""
import math
from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen

TTC = "/System/Library/Fonts/Supplemental/Futura.ttc"
PSNAME = "Futura-CondensedExtraBold"

col = TTCollection(TTC)
font = next(f for f in col.fonts if f["name"].getDebugName(6) == PSNAME)
upem = font["head"].unitsPerEm
cmap = font.getBestCmap()
hmtx = font["hmtx"]
glyphset = font.getGlyphSet()

# Legacy AAT 'kern' table (this is an old macOS TrueType font: kern/morx/feat/
# fond tables, no GPOS kerning). Chromium applies it by default (font-kerning:
# auto) for BOTH plain <text> and <textPath> — confirmed by review round 1:
# digit pairs ('zero','one')=-143 and ('one','nine')=-137 font units produced
# a growing rightward drift in "EST. 2019" that a naive advance-sum model
# (no kerning) can't reproduce. Letter pairs in the arc strings have much
# smaller kern values (<=66 units, sub-pixel at 21-26px) so this mattered
# visibly only for the digit pair, but is applied uniformly for correctness.
KERN = {}
if "kern" in font:
    for subtable in font["kern"].kernTables:
        KERN.update(getattr(subtable, "kernTable", {}) or {})

def glyph_for(ch):
    gname = cmap[ord(ch)]
    return gname, hmtx[gname][0]  # (name, advance in font units)

def kern_for(gname_a, gname_b):
    return KERN.get((gname_a, gname_b), 0)  # font units, 0 if no pair

def outline(gname):
    pen = SVGPathPen(glyphset)
    glyphset[gname].draw(pen)
    return pen.getCommands()

# jobs: (group id, text, font px, letter-spacing px, layout)
# layout for arcs: (cx, cy, r, phi0_rad, direction, rot_offset_deg)
#   phi = phi0 + direction * s/r   (s = arc length travelled, px)
#   pos = (cx + r*cos(phi), cy + r*sin(phi))   [SVG y-down coords]
#   glyph rotation = degrees(phi) + rot_offset_deg
# layout for straight: (x_center, y_baseline)
JOBS = [
    ("type-arc-top", "GO FUCK YOURSELF", 26.0, 4.0,
     ("arc", 200.0, 199.1, 159.0, -2.76897, +1, +90.0)),
    ("type-arc-bot", "McCALL · IDAHO", 21.0, 5.0,
     ("arc", 200.0, 200.9, 159.0, +2.76897, -1, -90.0)),
    ("type-est-static", "EST. 2019", 17.0, 3.0,
     ("line", 200.0, 324.0)),
]

def total_advance(gnames, size, ls, trailing):
    s = size / upem
    t = sum(adv for _, adv in gnames) * s
    kern_sum = sum(kern_for(gnames[i][0], gnames[i + 1][0])
                   for i in range(len(gnames) - 1)) * s
    n = len(gnames)
    # Centering formula differs by layout (confirmed by overlay screenshots,
    # Step 4 + review round 1 — the two do NOT share one constant):
    #   trailing=True  (arc/textPath):  t + ls*n        — Chromium's textPath
    #     text-anchor:middle counts letter-spacing after every glyph,
    #     including the last.
    #   trailing=False (line, plain <text>): t + ls*(n-1) — spacing BETWEEN
    #     glyphs only. The line branch's cursor is a left-edge glyph origin
    #     (not a centered advance box like the arc branch), so the rendered
    #     run spans [xc-T/2, xc-T/2+t+ls*(n-1)]; that is symmetric about xc
    #     only when T = t + ls*(n-1) — using the trailing-inclusive T here
    #     overshoots the span symmetrically on both ends.
    # kern_sum (usually negative — kerning pulls pairs tighter) is folded
    # into T the same way for both variants so the centering width always
    # matches the actual cumulative cursor advancement below.
    return t + kern_sum + ls * (n if trailing else n - 1)

out = []
for gid, text, size, ls, layout in JOBS:
    s = size / upem
    gnames = [glyph_for(ch) for ch in text]
    T = total_advance(gnames, size, ls, trailing=(layout[0] == "arc"))
    paths = []
    if layout[0] == "arc":
        _, cx, cy, r, phi0, dirn, rotoff = layout
        L = r * 2.39634                      # arc span |Δφ| = 2.39634 rad
        cursor = (L - T) / 2.0               # startOffset 50% + anchor middle
        for i, ch in enumerate(text):
            gname, adv = gnames[i]
            centre = cursor + adv * s / 2.0
            phi = phi0 + dirn * (centre / r)
            px = cx + r * math.cos(phi)
            py = cy + r * math.sin(phi)
            deg = math.degrees(phi) + rotoff
            if ch.strip():                   # spaces advance, no outline
                paths.append(
                    f'<path transform="translate({px:.2f} {py:.2f}) '
                    f'rotate({deg:.2f}) scale({s:.6f} {-s:.6f}) '
                    f'translate({-adv/2:.1f} 0)" d="{outline(gname)}"/>')
            step = adv * s + ls
            if i + 1 < len(text):
                step += kern_for(gname, gnames[i + 1][0]) * s
            cursor += step
    else:
        _, xc, yb = layout
        cursor = xc - T / 2.0
        for i, ch in enumerate(text):
            gname, adv = gnames[i]
            if ch.strip():
                paths.append(
                    f'<path transform="translate({cursor:.2f} {yb:.2f}) '
                    f'scale({s:.6f} {-s:.6f})" d="{outline(gname)}"/>')
            step = adv * s + ls
            if i + 1 < len(text):
                step += kern_for(gname, gnames[i + 1][0]) * s
            cursor += step
    out.append(f'<g id="{gid}">\n  ' + "\n  ".join(paths) + "\n</g>")

with open("tools/crest-type-paths.svg", "w") as f:
    f.write("<!-- GENERATED by tools/trace-crest-type.py — do not hand-edit.\n"
            "     Face: Futura-CondensedExtraBold (macOS Futura.ttc). -->\n")
    f.write("\n".join(out) + "\n")
print("wrote tools/crest-type-paths.svg")
