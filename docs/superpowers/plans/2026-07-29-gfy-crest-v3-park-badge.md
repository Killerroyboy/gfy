# GFY Crest v3 — Park Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage hero crest with the approved "Park Badge" (spec §16), with font-independent outlined lettering and hat-vendor-ready asset files.

**Architecture:** A one-time Python tracer converts the two band-lettering arcs from macOS Futura Condensed ExtraBold into positioned SVG `<path>` outlines (verified by overlay against live `<text>` rendering). `index.html`'s hero crest block is swapped for the approved candidate-A markup with outlined type; the fist stays the injected single-authority `MARK_PATH`. A standalone `assets/gfy-crest.svg` + 2048px PNG are the vendor deliverables.

**Tech Stack:** Python 3 + fontTools (tracer, dev-time only); jsdom smoke suite (`npm test`); playwright-cached `chrome-headless-shell` for screenshots (no new runtime deps — the site stays a single static `index.html`).

## Global Constraints (from spec §16 — every task inherits these)

- Fidelity target = `docs/superpowers/specs/assets/crest-v3-approved.png`; mockup source = `tools/crest-round2.html` (candidate A markup, `<g id="candA-art">`). Reproduce, don't redesign.
- `MARK_PATH` string must occur **exactly once** in `index.html` (C3-FIST). The keyline gets its `d` injected from the same const.
- Palette = existing tokens only: `--pine #0E2019`, `--pine-2 #132B21`, `--bone #E9E3D3`, `--brass #C8A24A`, `--brass-dim #6F5A26` (C3-ART).
- Hero crest contains exactly ONE `<text>` element: `id="crestEst"` (C3-EST / C3-TYPE).
- Nav mark, footer mark, favicon pipeline, site palette, all other views: untouched (C3-SCOPE-OUT).
- Full suite green before every commit; baseline at plan time = **153/153** (`npm test`).
- All commits on `v2.1-invites`; **no push** (Riley's gate). Stage only each task's files.
- Traced face is pinned: PostScript name `Futura-CondensedExtraBold` inside `/System/Library/Fonts/Supplemental/Futura.ttc` (measured: the mockup's font stack resolves to it in Chrome — canvas width 329.5 vs 430.2 for plain Futura).
- Headless screenshot binary (already on this machine):
  `/Users/riley/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`

---

### Task 1: Type tracer — outlined band lettering, overlay-verified

**Files:**
- Create: `tools/trace-crest-type.py`
- Create (generated, committed): `tools/crest-type-paths.svg`
- Create (checker, committed): `tools/crest-type-check.html`

**Interfaces:**
- Consumes: `/System/Library/Fonts/Supplemental/Futura.ttc` (face `Futura-CondensedExtraBold`).
- Produces: `tools/crest-type-paths.svg` containing three groups used verbatim by Tasks 2–3:
  `<g id="type-arc-top">` ("GO FUCK YOURSELF", 26px, letter-spacing 4, top arc),
  `<g id="type-arc-bot">` ("McCALL · IDAHO", 21px, letter-spacing 5, bottom arc),
  `<g id="type-est-static">` ("EST. 2019", 17px, letter-spacing 3, straight, baseline y=324, centered x=200).
  Every `<path>` inside carries only `d` + `transform` (fill inherited from the parent `<g>` at paste site).

- [ ] **Step 1: Install fontTools (dev-time only, house precedent = openpyxl install)**

Run: `python3 -m pip install --user --break-system-packages fonttools`
Expected: `Successfully installed fonttools-…` (or already satisfied).

- [ ] **Step 2: Write the tracer**

Create `tools/trace-crest-type.py`:

```python
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

def glyph_for(ch):
    gname = cmap[ord(ch)]
    return gname, hmtx[gname][0]  # (name, advance in font units)

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

def total_advance(text, size, ls):
    s = size / upem
    t = sum(glyph_for(c)[1] * s for c in text)
    return t + ls * (len(text) - 1)          # spacing BETWEEN glyphs only

out = []
for gid, text, size, ls, layout in JOBS:
    s = size / upem
    T = total_advance(text, size, ls)
    paths = []
    if layout[0] == "arc":
        _, cx, cy, r, phi0, dirn, rotoff = layout
        L = r * 2.39634                      # arc span |Δφ| = 2.39634 rad
        cursor = (L - T) / 2.0               # startOffset 50% + anchor middle
        for ch in text:
            gname, adv = glyph_for(ch)
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
            cursor += adv * s + ls
    else:
        _, xc, yb = layout
        cursor = xc - T / 2.0
        for ch in text:
            gname, adv = glyph_for(ch)
            if ch.strip():
                paths.append(
                    f'<path transform="translate({cursor:.2f} {yb:.2f}) '
                    f'scale({s:.6f} {-s:.6f})" d="{outline(gname)}"/>')
            cursor += adv * s + ls
    out.append(f'<g id="{gid}">\n  ' + "\n  ".join(paths) + "\n</g>")

with open("tools/crest-type-paths.svg", "w") as f:
    f.write("<!-- GENERATED by tools/trace-crest-type.py — do not hand-edit.\n"
            "     Face: Futura-CondensedExtraBold (macOS Futura.ttc). -->\n")
    f.write("\n".join(out) + "\n")
print("wrote tools/crest-type-paths.svg")
```

Run: `cd ~/Code/gfy && python3 tools/trace-crest-type.py`
Expected: `wrote tools/crest-type-paths.svg`; file contains three `<g>` blocks with non-empty `d` attributes.

- [ ] **Step 3: Build the overlay checker**

Create `tools/crest-type-check.html` — renders the live `<text>` version (brass) under the traced paths (rust) at 55% opacity each; alignment = uniform muddy blend, drift = clean color fringes:

```html
<!DOCTYPE html><meta charset="utf-8">
<style>body{background:#0E2019;margin:0;display:grid;place-items:center;height:100vh}</style>
<svg viewBox="0 0 400 400" width="760" height="760">
  <defs>
    <path id="aTop" d="M 51.9 141.2 A 159 159 0 0 1 348.1 141.2"/>
    <path id="aBot" d="M 51.9 258.8 A 159 159 0 0 0 348.1 258.8"/>
  </defs>
  <g fill="#C8A24A" opacity=".55"
     font-family="Futura-CondensedExtraBold,Futura" font-weight="800">
    <text font-size="26" letter-spacing="4"><textPath href="#aTop" startOffset="50%" text-anchor="middle">GO FUCK YOURSELF</textPath></text>
    <text font-size="21" letter-spacing="5"><textPath href="#aBot" startOffset="50%" text-anchor="middle">McCALL &#183; IDAHO</textPath></text>
    <text font-size="17" letter-spacing="3" x="200" y="324" text-anchor="middle">EST. 2019</text>
  </g>
  <g fill="#B0705E" opacity=".55" id="traced"><!-- PASTE the three groups from tools/crest-type-paths.svg here --></g>
</svg>
```

Paste the generated groups into `#traced` (script does not auto-include: the checker is a committed, self-contained record of the verification).

- [ ] **Step 4: Screenshot and judge the overlay**

Run:
```bash
/Users/riley/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  --headless --disable-gpu --hide-scrollbars --window-size=800,800 \
  --screenshot=/tmp/type-overlay.png "file://$PWD/tools/crest-type-check.html"
```
Read the PNG. Expected: every glyph a single blended shape (brass+rust ≈ muted brown), **no** offset ghosting. If glyphs are uniformly rotated/shifted a constant amount, adjust the centering rule (`T` trailing-spacing variant: `+ ls*len(text)`) or `phi0` sign per the header comment, regenerate, re-shoot. Iterate until aligned; small sub-pixel softness is fine, visible double-strokes are not.

- [ ] **Step 5: Commit**

```bash
git add tools/trace-crest-type.py tools/crest-type-paths.svg tools/crest-type-check.html
git commit -m "feat(crest): trace band lettering to outlined paths (Futura Condensed XBold, overlay-verified) — §16 C3-TYPE"
```

---

### Task 2: Hero swap in index.html (TDD, smoke group Y)

**Files:**
- Modify: `index.html` (hero crest block at ~line 422–465; `<symbol id="mark">` defs block at ~line 378; `MARK_PATH` injection at ~line 782)
- Test: `test/smoke.mjs` (new group Y, appended before the tally section)

**Interfaces:**
- Consumes: `tools/crest-type-paths.svg` groups `type-arc-top`, `type-arc-bot` (Task 1).
- Produces: hero `<svg class="crest …">` containing `<g id="candA-art">`-equivalent badge with `<use href="#mark">`, `<use href="#markKeyline">`, and live `<text id="crestEst">`. Smoke checks `Y1 single-text`, `Y2 markpath-once`, `Y3 est-year-live`.

- [ ] **Step 1: Write the failing tests**

In `test/smoke.mjs`, append a new group after the last existing group (match the house idiom — `check()` + variant DOM via `withOverride`):

```js
/* ---------------------------------------------------------------------
   Group Y: crest v3 Park Badge (spec §16). Y1 = outline enforcement (the
   hero's only <text> is the live EST ribbon), Y2 = MARK_PATH single
   authority, Y3 = sheet-driven est_year still lands in the ribbon.
   --------------------------------------------------------------------- */
{
  // Y1/Y2: static assertions against the main dom + raw html source
  // (`dom` and `html` are file-level consts, in scope here).
  const crestY = dom.window.document.querySelector("svg.crest");
  const textsY = crestY ? crestY.querySelectorAll("text") : [];
  check("Y1: crest v3 — hero svg has exactly one <text> and it is #crestEst (outlined band type)",
    !!crestY && textsY.length === 1 && textsY[0].id === "crestEst",
    crestY ? "texts=" + textsY.length : "no svg.crest");

  const markCount = (html.match(/M 91 17 C 92 9, 100 3, 110 3/g) || []).length;
  check("Y2: crest v3 — MARK_PATH literal occurs exactly once in index.html (keyline is injected, not copied)",
    markCount === 1, "count=" + markCount);

  // Y3: variant dom — Info est_year 1987 must land in the live ribbon text.
  const infoVariant = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200,
      text: async () => FIXTURES.info.replace("est_year,2019", "est_year,1987") }),
  });
  const domY3 = makeDom("", infoVariant);
  await until(() => domY3.window.document.querySelector("#crestEst")?.textContent === "EST. 1987");
  const estY3 = domY3.window.document.querySelector("#crestEst")?.textContent || "";
  check("Y3: crest v3 — #crestEst renders sheet est_year (variant 1987)",
    estY3 === "EST. 1987", "got=" + estY3);
  domY3.window.close();
}
```

Placement: after the last existing group block (the U10 block), before the Tally section. Check names MUST keep the `Y<n>:` prefix — the tally regex is `^([A-Z])\d+:`.

- [ ] **Step 2: Run to verify the new checks fail correctly**

Run: `npm test 2>&1 | grep "^FAIL  Y\|TALLY"`
Expected: Y1 FAILS (current crest has 2+ `<text>` elements: crestEst + two textPaths). Y2 PASSES already (one literal). Y3 PASSES already (existing crestEst hook) — Y2/Y3 are regression guards, Y1 is the driver. Total = 153 + 3 with exactly one FAIL.

- [ ] **Step 3: Swap the hero crest block**

In `index.html`:

3a. Next to `<symbol id="mark">` (defs block ~line 378), add the keyline symbol (empty `d`, injected at script start like `#mark`):

```html
<symbol id="markKeyline" viewBox="0 0 200 260" style="overflow:visible">
  <!-- d injected from MARK_PATH at script start (single authority, §16 C3-FIST) -->
  <path fill="none" stroke="currentColor" stroke-width="11" stroke-linejoin="round"/>
</symbol>
```

3b. In the mark-injection script (~line 782), after the existing line
`document.querySelector("#mark path").setAttribute("d",MARK_PATH);` add:

```js
document.querySelector("#markKeyline path").setAttribute("d",MARK_PATH);
```

3c. Replace the entire current hero `<svg class="crest rise d1" …>…</svg>` block (the one containing `arcTop`/`arcBot` defs, the two textPaths, the two pine-bough stroke groups, and `#crestEst`) with the Park Badge. This is candidate A from `tools/crest-round2.html` (`<g id="candA-art">`) with three changes: (1) the two `<text>` arcs are replaced by the traced groups from `tools/crest-type-paths.svg`; (2) the ribbon text is the live `#crestEst` in Jost; (3) `defs` keep only the scene clip. Final markup:

```html
<svg class="crest rise d1" viewBox="0 0 400 400" role="img"
     aria-label="GFY crest: a raised middle finger over a mountain lake at night, flanked by pines">
  <defs>
    <clipPath id="crestScene"><circle cx="200" cy="200" r="134"/></clipPath>
  </defs>
  <circle cx="200" cy="200" r="194" fill="var(--brass)"/>
  <circle cx="200" cy="200" r="186" fill="var(--pine)"/>
  <circle cx="200" cy="200" r="180" fill="var(--brass)"/>
  <circle cx="200" cy="200" r="138" fill="var(--pine)"/>
  <g fill="var(--pine)">
    <!-- PASTE <g id="type-arc-top"> content-paths here, keeping this parent's fill -->
  </g>
  <g fill="var(--pine)">
    <!-- PASTE <g id="type-arc-bot"> content-paths here -->
  </g>
  <g fill="var(--pine)">
    <path d="M 41 200 l 7 -9 l 7 9 l -7 9 Z"/>
    <path d="M 345 200 l 7 -9 l 7 9 l -7 9 Z"/>
  </g>
  <g clip-path="url(#crestScene)">
    <circle cx="200" cy="152" r="64" fill="var(--bone)"/>
    <path fill="var(--brass-dim)" d="M 60 246 L 106 176 L 132 210 L 163 168 L 188 204 L 214 172 L 246 214 L 276 178 L 306 222 L 340 246 Z"/>
    <path fill="var(--brass)" d="M 52 258 L 96 206 L 124 236 L 158 196 L 200 244 L 238 200 L 270 238 L 302 210 L 348 258 Z"/>
    <rect x="60" y="252" width="280" height="90" fill="var(--pine-2)"/>
    <g stroke="var(--bone)" stroke-width="5" stroke-linecap="round">
      <path d="M 120 266 h 52 M 196 266 h 66"/>
      <path d="M 96 282 h 66 M 186 282 h 40 M 250 282 h 52"/>
      <path d="M 132 298 h 44 M 206 298 h 60"/>
    </g>
    <use href="#pinetree" x="66" y="170" width="54" height="82" style="color:var(--bone)"/>
    <use href="#pinetree" x="280" y="170" width="54" height="82" style="color:var(--bone)"/>
    <g style="color:var(--pine)"><use href="#markKeyline" x="141" y="96" width="118" height="153"/></g>
    <g style="color:var(--brass)"><use href="#mark" x="141" y="96" width="118" height="153"/></g>
  </g>
  <circle cx="200" cy="200" r="138" fill="none" stroke="var(--brass)" stroke-width="6"/>
  <g>
    <path fill="var(--brass)" d="M 143 306 L 257 306 L 257 330 L 143 330 Z"/>
    <path fill="var(--brass-dim)" d="M 143 306 L 127 318 L 143 330 Z M 257 306 L 273 318 L 257 330 Z"/>
    <text id="crestEst" x="200" y="323" fill="var(--pine)" text-anchor="middle"
          font-family="Jost, sans-serif" font-weight="600" font-size="14" letter-spacing="3">EST. 2019</text>
  </g>
</svg>
```

3d. Add the `pinetree` symbol next to `#mark`/`#markKeyline` in the defs block:

```html
<symbol id="pinetree" viewBox="0 0 60 90">
  <path fill="currentColor" d="M30 0 L46 26 L38 24 L52 50 L42 47 L56 74 L34 68 L34 90 L26 90 L26 68 L4 74 L18 47 L8 50 L22 24 L14 26 Z"/>
</symbol>
```

The old bough groups and `arcTop`/`arcBot` defs die with the replaced block (C3-SCOPE-OUT). Do not touch the nav/footer `<use href="#mark">` sites.

- [ ] **Step 4: Run tests to verify green**

Run: `npm test 2>&1 | tail -4`
Expected: `TALLY TOTAL 156/156` (153 baseline + Y1 Y2 Y3), zero FAIL lines.

- [ ] **Step 5: S11 fidelity check against the approved render**

```bash
/Users/riley/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  --headless --disable-gpu --hide-scrollbars --window-size=900,900 \
  --screenshot=/tmp/hero-v3.png "file://$PWD/index.html"
```
Read `/tmp/hero-v3.png` next to `docs/superpowers/specs/assets/crest-v3-approved.png`. Judge as a cold viewer at full size AND mentally at cap size: same badge? Moon halo behind fingertip, ridge shapes, lake dashes, bone pines, ribbon, band lettering weight/position all matching? Flag any visible divergence and fix before committing (lettering divergence → back to Task 1's overlay, geometry divergence → this markup).

- [ ] **Step 6: Commit**

```bash
git add index.html test/smoke.mjs
git commit -m "feat(crest): Park Badge hero — outlined band type, keyline, live EST ribbon (spec §16; smoke group Y)"
```

---

### Task 3: Hat-vendor assets (TDD: parity check first)

**Files:**
- Create: `assets/gfy-crest.svg`
- Create: `assets/gfy-crest-2048.png`
- Test: `test/smoke.mjs` (append check Y4 inside group Y)

**Interfaces:**
- Consumes: hero markup (Task 2), `tools/crest-type-paths.svg` incl. `type-est-static` (Task 1), `MARK_PATH` + detail strokes from `index.html`.
- Produces: self-contained vendor files; smoke `Y4` guards fist parity between asset and `MARK_PATH` (S8 parity gate).

- [ ] **Step 1: Write the failing parity test**

Append inside group Y in `test/smoke.mjs`:

```js
{
  // Y4: the standalone asset's fist must equal MARK_PATH (S8 parity — the
  // asset is a copy by necessity; this is the lockstep gate).
  let assetSvg = "";
  try { assetSvg = readFileSync(path.join(ROOT, "assets", "gfy-crest.svg"), "utf8"); } catch {}
  const markConst = (html.match(/const MARK_PATH="([^"]+)"/) || [])[1] || "";
  check("Y4: crest v3 — assets/gfy-crest.svg fist d === MARK_PATH (asset parity)",
    !!assetSvg && !!markConst && assetSvg.includes('d="' + markConst + '"'),
    assetSvg ? "fist d mismatch" : "asset file missing");
}
```

(Same `Y<n>:` naming rule; goes directly after the Y1–Y3 block.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test 2>&1 | grep "^FAIL  Y4"`
Expected: `FAIL  Y4 … [asset file missing]`

- [ ] **Step 3: Build the standalone SVG**

Create `assets/gfy-crest.svg`: a complete standalone document. Construction rule — take the hero crest markup from Task 2 Step 3c and make it self-contained:
- Root: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">` with this header comment:

```
<!-- GFY crest v3 "Park Badge" — vendor master (spec §16 C3-ASSETS).
     Colors: pine #0E2019 · pine-2 #132B21 · bone #E9E3D3 · brass #C8A24A · brass-dim #6F5A26.
     3-thread patch quantization: merge pine-2 -> pine and brass-dim -> brass.
     Fist silhouette is a COPY of index.html MARK_PATH; smoke check Y4 keeps them in lockstep.
     Lettering: outlined Futura Condensed ExtraBold via tools/trace-crest-type.py. -->
```

- Replace every `var(--pine)`→`#0E2019`, `var(--pine-2)`→`#132B21`, `var(--bone)`→`#E9E3D3`, `var(--brass)`→`#C8A24A`, `var(--brass-dim)`→`#6F5A26` (and the `style="color:…"` indirections become direct `fill`/`stroke` hex).
- Inline the fist: replace `<use href="#markKeyline">`/`<use href="#mark">` with a local `<g transform="translate(141 96) scale(0.59 0.588461)">` (118/200 and 153/260) containing: (a) the keyline path (`fill="none" stroke="#0E2019" stroke-width="11" stroke-linejoin="round"` + full `d` copied from `MARK_PATH`), (b) the filled fist path (`fill="#C8A24A"` + the same `d`), (c) the seven detail-stroke paths copied from `<symbol id="mark">` in `index.html` with `stroke="#0E2019"`.
- Inline the two pines the same way (`<path fill="#E9E3D3" transform="translate(66 170) scale(0.9 0.911)" d="M30 0 …"/>` — scale 54/60, 82/90; second at translate(280 170)).
- Ribbon text: use the outlined `<g id="type-est-static">` from `tools/crest-type-paths.svg` wrapped in `<g fill="#0E2019">` (no live text, no fonts).
- No `<use>`, no CSS vars, no classes, no external references anywhere in the file.

Verify render:
```bash
/Users/riley/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  --headless --disable-gpu --hide-scrollbars --window-size=500,500 \
  --screenshot=/tmp/asset-check.png "file://$PWD/assets/gfy-crest.svg"
```
Read it: identical badge to the hero (EST in Futura outlines instead of Jost is the one expected difference).

- [ ] **Step 4: Run tests to verify Y4 passes**

Run: `npm test 2>&1 | tail -4`
Expected: `TALLY TOTAL 157/157`.

- [ ] **Step 5: Export the 2048px PNG (transparent outside the badge)**

Create a tiny wrapper `/tmp/crest-export.html`:

```html
<!DOCTYPE html><style>body{margin:0}</style>
<img src="file:///Users/riley/Code/gfy/assets/gfy-crest.svg" width="2048" height="2048">
```

```bash
/Users/riley/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  --headless --disable-gpu --hide-scrollbars --window-size=2048,2048 \
  --default-background-color=00000000 \
  --screenshot=assets/gfy-crest-2048.png "file:///tmp/crest-export.html"
sips -g pixelWidth -g hasAlpha assets/gfy-crest-2048.png
```
Expected: `pixelWidth: 2048`, `hasAlpha: yes`. Read the PNG: badge crisp, corners transparent.

- [ ] **Step 6: Commit**

```bash
git add assets/gfy-crest.svg assets/gfy-crest-2048.png test/smoke.mjs
git commit -m "feat(crest): vendor-ready standalone SVG + 2048px PNG, fist-parity smoke gate (spec §16 C3-ASSETS)"
```

---

### Task 4: Final battery + ledger

**Files:**
- Modify: `.superpowers/sdd/progress.md` (append run entry)

**Interfaces:**
- Consumes: everything above.
- Produces: verified done-state; ledger row for resume/audit.

- [ ] **Step 1: Full suite from clean checkout state**

Run: `git status --porcelain` (expect: empty) then `npm test 2>&1 | tail -4`
Expected: `TALLY TOTAL 157/157`, no stray unstaged files.

- [ ] **Step 2: Whole-surface S11 pass (both sizes, cold eyes)**

Re-shoot the homepage (Task 2 Step 5 command). Judge full-size hero AND the same PNG scaled small (open at ~120px width) against `crest-v3-approved.png` one last time; also confirm nav mark + footer mark + the rest of Home render exactly as before (nothing else moved). Any "no" = fix before proceeding.

- [ ] **Step 3: Ledger entry**

Append to `.superpowers/sdd/progress.md` (match the existing entry format in that file): crest v3 Park Badge — spec §16, tasks 1–4 complete, suite 157/157, commits listed, GATE = Riley push (unchanged, whole-branch).

- [ ] **Step 4: Commit**

```bash
git add .superpowers/sdd/progress.md
git commit -m "chore(crest): ledger — crest v3 complete, 157/157, awaiting branch push gate"
```

---

## Plan self-review (spec §16 coverage)

- C3-FIST → Task 2 (keyline injection, Y2) ✓ · C3-ART → Task 2 Step 3c markup ✓ · C3-TYPE → Task 1 (pinned face, overlay verify) + Task 2 paste ✓ · C3-EST → Task 2 (live crestEst, Y3) ✓ · C3-A11Y → Task 2 aria-label ✓ · C3-ASSETS → Task 3 ✓ · C3-SCOPE-OUT → Task 2 3c note + Task 4 Step 2 ✓ · C3-TESTS → Y1–Y4 across Tasks 2–3 ✓ · Residual (font licensing) → spec-recorded, no task needed ✓ · Rollback → plain git revert, no task needed ✓
