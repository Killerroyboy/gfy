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

def total_advance(gnames, size, ls):
    s = size / upem
    t = sum(adv for _, adv in gnames) * s
    kern_sum = sum(kern_for(gnames[i][0], gnames[i + 1][0])
                   for i in range(len(gnames) - 1)) * s
    n = len(gnames)
    # ONE formula for both layouts: t + kern_sum + ls*n (trailing-inclusive).
    #
    # History (see task-1-report.md "review round 1" / "review round 2" for
    # full pixel measurements): round 1 used t+ls*(n-1) for the line job,
    # reasoning that Chromium's plain text-anchor:middle doesn't count
    # trailing letter-spacing the way textPath does. That "fixed" the gross
    # spread on "EST. 2019" but was the WRONG mechanism — the spread was
    # actually the still-missing kerning (large digit pairs zero-one=-143,
    # one-nine=-137 font units, ~-2.3px at 17px/2048upem — almost exactly
    # the measured 4x-supersample overshoot). Once kerning was added
    # (below), the t+ls*(n-1) formula for the line job started
    # UNDERSTATING T by one full `ls`, which shifts the start position
    # (xc - T/2) right by ls/2 — round 2's pixel sampling (native 800x800,
    # no upscaling) found exactly that: a constant ~2-3px brass-only/
    # rust-only band on every glyph's left/right edge, magnitude matching
    # ls/2 (1.5 svg units) at the render's 1.9px/unit scale (~2.85px).
    # Reverting to the trailing-inclusive formula for both layouts removed
    # the band (see round 2 pixel re-measurement).
    return t + kern_sum + ls * n

out = []
for gid, text, size, ls, layout in JOBS:
    s = size / upem
    gnames = [glyph_for(ch) for ch in text]
    T = total_advance(gnames, size, ls)
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
