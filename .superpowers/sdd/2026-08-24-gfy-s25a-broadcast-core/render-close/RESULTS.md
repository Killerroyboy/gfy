# S25a render-close — S11 evidence (Task 7)

Real-browser (Playwright Chromium) screenshot battery for the §25a
broadcast-core wave, network-sealed against fixtures (`fixtures/*.csv`),
served from a local `http.server` copy of the worktree. Harness:
`render.js` in this directory (pattern copied from the §24 harness at
`.worktrees/s24-player-info/.superpowers/sdd/2026-08-17-gfy-s24-player-info/render-close/`,
adapted for §25a's Board/Home/grid/masthead surfaces). Raw facts in
`raw-results.json`, numeric measurements in `measurements.json`.

Every state below was captured at **390×844** (mobile, dpr 2) and
**1440×900** (desktop, dpr 2) — 16 states × 2 viewports = **32 PNG frames**.

Two CSS-only fixes were applied to `index.html` as a direct result of this
run (both re-verified: `node test/smoke.mjs` → 281/281 green after each).
See "Findings fixed" below.

## Battery — every frame

| # | Frame id | Files | What it shows |
|---|---|---|---|
| 1 | `01-board-fresh-arrows` | `01-board-fresh-arrows-{mobile,desktop}.png` | Board, populated, `STATE.prevBoard` primed with the reversed live order (T4e idiom) → real ▲/▼ arrows + "Movement since 2:00PM" footer. |
| 2 | `02-board-suppressed` | `02-board-suppressed-{mobile,desktop}.png` | Board, hole-7 par blanked (`courseMap()` null) → Pos shows `—`, To-par column collapses to a single "Total", hole-by-hole note reads "needs all 18 holes", **legend correctly hidden** (post-fix). |
| 3 | `03-board-stale-movement` | `03-board-stale-movement-{mobile,desktop}.png` | Board, `prevBoard.at` forced 11 min old (T4f idiom) → every arrow dashes, footer reads "Movement paused — last refresh 1:49PM". |
| 4 | `04-grid-glyphs-legend` | `04-grid-glyphs-legend-{mobile,desktop}.png` (full page) | Hole-by-hole grid, Round 1 default, populated with bogey (square outline) and blowup (double square outline) glyphs + the Eagle/Birdie/Par/Bogey/Double-or-worse legend. |
| 4b | `04b-grid-blowup-crop` | `04b-grid-blowup-crop-{mobile,desktop}.png` | 2× device-pixel crop of Moose's Round-1 hole-7 blowup cell (score 7, par 3) — halo clearance check. |
| 4c | `04c-grid-under-round2-crop` | `04c-grid-under-round2-crop-{mobile,desktop}.png` | 2× crop of Duck's Round-2 "under" ring (hole 5, score 3 vs par 4) — **now a true circle** (post-fix; was an ellipse pre-fix). |
| 5a | `05a-home-slice` (+ `05a2` scrolled) | `05a-home-slice-*`, `05a2-home-slice-scrolled-*` | Home, event phase, top-slice: 5 rows (Duck/Sully/Tex/Moose/Bear), "Full leaderboard →" link, single homeSync stamp underneath (no duplicate). |
| 5b | `05b-home-slice-tie` (+ `05b2` scrolled) | `05b-home-slice-tie-*`, `05b2-home-slice-tie-scrolled-*` | Home, event phase, 7-team fixture with a 3-way tie for 5th (T5f idiom) — slice correctly extends to **7 rows**, not clipped to 5. |
| 6 | `06-home-suppressed` (+ `06b` scrolled) | `06-home-suppressed-*`, `06b-home-suppressed-scrolled-*` | Home, event phase, par-suppressed — Pos `—`, single "Total" value per row (the T5e/T5's honest single-total state). |
| 7 | `07-home-off-phase` | `07-home-off-phase-{mobile,desktop}.png` | Home, off-phase (now ≫ first_tee±3d) — no countdown, no Now/Next, no homeBoard slice; post-event status line ("3 of 9 paid for 2027 · …") shown instead; nav falls back to canonical off-season order. |
| 8a | `08a-masthead-data-view` | `08a-masthead-data-view-{mobile,desktop}.png` | `#mastBar` on a non-Board data view (`#schedule`/"Card") — single ceremonial strip, no `#mastChip` pill (that element doesn't exist off-Board). |
| 8b | `08b-board-masthead-offphase` | `08b-board-masthead-offphase-{mobile,desktop}.png` | Board masthead, off-phase — both `#mastCtx` (top bar) and `#mastChip` (Board's own pill) read "McCall, Idaho · Est. 2019" simultaneously — the double-render Riley should eyeball. |
| 9 | `09-nownext-announce` | `09-nownext-announce-{mobile,desktop}.png` | Home, event phase, unseen announce row → lower-third banner ("Round One tee times posted…" + "Got it") visible at page top; Now/Next strip content confirmed via `05a2`'s scrolled frame (same schedule fixture, unaffected by the announce override). |

## Findings fixed (CSS-only, suite re-verified green both times)

### F1 — `.sg-t td.under::after` ring was an ellipse, not a circle (watch-list, mandated)

**Before:** `inset:15%` on the grid `<td>` (measured border-box 35.19×31.42px)
produced an after-box of **21.94×19.30px** (aspect ratio **1.14**) —
`border-radius:50%` rounds an ellipse's corners, it does not correct the
aspect ratio. Visibly egg-shaped in the `04c` crop (see `git show` for the
pre-fix crop if needed — not retained, overwritten by the post-fix run).

**Fix:** `.sg-t td.under::after` now sets a fixed `1.6em × 1.6em` box,
centered via `top/left:50%` + `transform:translate(-50%,-50%)`, instead of
the shared percentage `inset`. `.under.eagle`'s box-shadow rule is untouched
(it only adds a shadow, no positioning) and correctly rides the new square
box. `bogey`/`blowup` deliberately keep the old `inset:15%` rectangle — they
were never meant to be round.

**After:** measured after-box **21.75×21.75px, aspect ratio 1.000** — a true
circle at both viewports. See `04c-grid-under-round2-crop-{mobile,desktop}.png`.

### F2 — `.sg-legend[hidden]` had no effect in a real browser (found via this run, not on the watch-list)

**Before:** `renderScoreGrid()` correctly sets `legend.hidden=true` in both
the par-suppressed and no-rounds-yet branches (verified in the DOM — this is
exactly what `test/smoke.mjs`'s X35/T-series checks assert, and they still
pass). But `.sg-legend{display:flex;...}` is an **author** rule with the
same specificity (0,1,0) as the UA default `[hidden]{display:none}`, and —
appearing later in the cascade — it silently wins. In a real browser the
Eagle/Birdie/Par/Bogey/Double-or-worse legend stayed visible underneath the
"needs all 18 holes" note even though `.hidden` read `true` in the DOM. This
is a real-browser-only defect the jsdom-based smoke suite structurally
cannot see (it never queries computed style, only the `.hidden` property) —
exactly the class of bug S11 exists to catch.

Confirmed the mechanism directly:
```
display= flex hiddenProp= true   // <div class="x" hidden> where .x{display:flex}
```

Every sibling toggle in the very same feature already carries the
companion override (`.sg-controls[hidden]{display:none}` two lines below;
`.card-drop[hidden]{display:none}` above) — `.sg-legend` was simply missed.

**Fix:** added `.sg-legend[hidden]{display:none}` (specificity 0,2,0 — wins
outright, no reordering needed).

**After:** `02-board-suppressed-*.png` shows the legend correctly absent —
only the note + sync stamp, no stray glyph legend with nothing to explain.

## Watch-list verdicts

| Item | Verdict | Measurement / evidence |
|---|---|---|
| **Ring ellipse** (`.sg-t td.under::after` percentage inset on non-square `<td>`) | **FIXED** (was FINDING) | Pre-fix: 21.94×19.30px, aspect 1.14 (brief predicted ~24.6×19.6, same non-circular shape, close order of magnitude). Post-fix: 21.75×21.75px, aspect **1.000**. Crop: `04c-grid-under-round2-crop-{mobile,desktop}.png`. |
| **Ring box-shadow spread vs cell edge** (blowup halo clearance) | **PASS** | Measured on Moose's R1 h7 blowup cell: inset 6.06px (top) / 6.63px (left), spread 3px → clearance **3.06px (top) / 3.63px (left)**. Comfortable, not touching the cell border. (Brief's ~1.2px prediction was for a different geometry assumption; the actual measured clearance is healthier than that.) Crop: `04b-grid-blowup-crop-{mobile,desktop}.png`. |
| **`.lb-mv` column overflow at 390w** | **PASS — no overflow** | `row.scrollWidth === row.clientWidth` = 342px at 390 viewport (mobile) and 1052px at 1440 (desktop); `overflow:false` both. The narrow 5-track grid (`1.9rem 2rem 1fr 3.4rem 4rem`) fits inside the 342px content width with room to spare (mv cell measured 32px). No column drop needed. |
| **Masthead: full-bleed centering vs nav's 1100px column** | **FINDING (presentational, eyeball needed)** | At 1440w: nav content center = 720px (viewport/2, as expected); Board's own `.mast-head` (h2 + chip) starts at **194px** from the left edge (matches `(1440-1100)/2+24` exactly — column-anchored). `#mastBar`'s content (mark+name+ctx), being `justify-content:center` across the **full** 1440px bar with no `max-width`, starts at **~477–498px** depending on ctx text length — roughly 280–300px right of the column-anchored content below it. At 390w the two are nearly flush (11.7–24px) since the column cap never engages below 1148px content width. Not a bug — a real, measurable seam between the ceremonial bar's full-bleed centering and everything else's 1100px-column anchoring. Screenshots: `01-board-fresh-arrows-desktop.png`, `08a-masthead-data-view-desktop.png`. |
| **Masthead chip wrap at 390w** | **FINDING (visual roughness, not fixed)** | `#mastCtx`'s text wraps mid-phrase inside the narrow `#mastBar` at 390w: "ROUND 2 · SATURDAY" breaks into 3 lines (`ROUND 2` / `·` / `SATURDAY`, the "·" stranded alone); the off-phase est-line wraps into 4 lines (`MCCALL,` / `IDAHO ·` / `EST.` / `2019`), inflating the bar to ~180px tall. Not broken/overlapping, just visually rough — a genuine mobile polish item, left unfixed here (a real fix means redesigning the mobile masthead-bar layout, bigger than a surgical one-rule CSS patch, and out of this task's mandate). Screenshots: `01-board-fresh-arrows-mobile.png`, `08b-board-masthead-offphase-mobile.png`. |
| **`#mastCtx` + `#mastChip` double render on Board** | **FINDING (by design, eyeball needed)** | Confirmed: both elements are driven by the same `renderMastChip()` call and show the identical string simultaneously — once in the slim top bar, once in the bordered pill beside "Leaderboard". Functionally correct (both surfaces are documented to "share it"), but reads as redundant on screen. Screenshot: `08b-board-masthead-offphase-{mobile,desktop}.png` (off-phase est-line visible in both spots at once) and `01-board-fresh-arrows-desktop.png` (event-phase "Round 2 · Saturday" in both spots). Riley's call on whether one instance should be suppressed on Board. |
| **Home slice compactness at 390w (fits above the fold?)** | **FINDING (informational — not a regression)** | The slice itself (5 rows + link + sync stamp) is compact — roughly 550–600px tall including the "Full leaderboard →" link and the homeSync stamp (see `05a2-home-slice-scrolled-mobile.png`, which fits it comfortably inside one 844px viewport once scrolled to it). It does **not** fit above the fold on load (`homeBoard` bottom measured at **1308px** on a 844px-tall mobile viewport) — but that's driven entirely by the pre-existing hero (crest SVG + wordmark + countdown/status line), which already occupied that space before this wave. B-HOME added the slice as a literal prefix of the Board's own rows right after Now/Next; it did not make the hero any taller. Not a regression, just a pre-existing site trait worth having eyes on. |
| **`.nn-row` stacked kicker reads as chyron, not broken wrap** | **PASS** | `05a2-home-slice-scrolled-mobile.png`: "NOW:" (small caps, sage) stacks cleanly above "Round One — shotgun start · 9:00 am · Meadow Creek" (bone, larger), inside the brass left-border block. Reads as a lower-third/chyron treatment, not accidental wrapping. |
| **Over-par to-par cells unchanged (bone)** | **Confirmed, not a finding** | All `+4`/`+5`/`+6`/`+8` to-par values render in plain bone/off-white (`--score-over` == `--bone`, `#E9E3D3`), same as body text — deliberate per B-CONV's design (only under/even get distinct accent colors). No action needed. |

## Other visual observations (not findings)

- The `04-grid-glyphs-legend-desktop.png` **full-page** capture shows the
  sticky `.nav` bar appearing to overlap the "Leaderboard" `h2` partway down
  the stitched image. This is a known Playwright/Chromium full-page-
  screenshot artifact with `position:sticky` elements (the sticky element's
  "stuck" position gets baked into the stitched composite at multiple scroll
  offsets) — **not** a real rendering defect. The viewport-only screenshots
  of the same page (`01-board-fresh-arrows-desktop.png` etc.) render cleanly
  with a single nav bar, confirming a live scrolling user never sees this.

## Closing verification

- `node test/smoke.mjs` → **281/281, zero FAIL** (run before the two CSS
  fixes, and again after — both green; final run's tail: `TALLY TOTAL
  281/281`).
- `npm run event-ready` → runs against the **live production sheet** (not
  this worktree's fixtures), so its FAIL/WARN lines reflect real sheet-side
  content: verbatim template sample rows still in Info/Course/Schedule/
  Calcutta/Payout/Champions/Shame/Invites/Rooms, no `score_endpoint`
  configured, a missing 2026-08-16 schedule row, and 3 Calcutta teams with no
  matching Field row. **None of this is caused by this wave.** The one check
  that reads `index.html` at all (`checkFallbackParity`'s pinned "Schedule
  not loaded yet…" empty-state string) still **PASSes** — this wave's diff
  is two CSS rules inside `<style>`, nowhere near that string or any other
  JS/text `event-ready` inspects. Output is unchanged by this wave; every
  FAIL/WARN present is sheet-content-side and pre-existing.
