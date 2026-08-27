# Task 7 report — render close + S11 evidence (S25a broadcast-core wave)

**Worktree:** `/Users/riley/Code/gfy/.worktrees/s25a` (branch `s25a-broadcast`), started at `4cdfbe6`.

## What was done

1. Copied the §24 render-close harness pattern (network-sealed, fixture-served,
   viewport-controlled, `playwright-core` via a copied `node_modules`) from
   `.worktrees/s24-player-info/.superpowers/sdd/2026-08-17-gfy-s24-player-info/render-close/`
   into this wave's own workspace at
   `.superpowers/sdd/2026-08-24-gfy-s25a-broadcast-core/render-close/render.js`
   (s24's workspace untouched — read-only).
2. Ran a 16-state × 2-viewport (390×844, 1440×900) real-Chromium screenshot
   battery covering Board (fresh/stale/suppressed movement, hole-by-hole grid
   with glyph rings + legend), Home (populated/tied/suppressed/off-phase
   slice), the masthead bar/chip, and the Now/Next strip + announce banner.
3. Measured every explicit watch-list item numerically (ring geometry, halo
   clearance, `lb-mv` row width, masthead centering offsets, chip wrap,
   home-slice height) in addition to screenshotting it.
4. Found and fixed **two real CSS-only defects**, both invisible to the
   jsdom-based `test/smoke.mjs` suite because they only manifest under a real
   browser's CSS cascade — re-ran the full suite green after each fix:
   - **Ring ellipse** (mandated by the brief): `.sg-t td.under::after`'s
     percentage `inset:15%` on a non-square `<td>` rendered an ellipse
     (measured 21.94×19.30px, aspect 1.14), not a circle. Fixed with a
     fixed-size (`1.6em²`), transform-centered box — now measures
     21.75×21.75px, aspect **1.000**.
   - **`.sg-legend[hidden]` had no effect** (found during this run, not on
     the watch-list): `.sg-legend{display:flex}` is the same CSS specificity
     as the UA `[hidden]{display:none}` default and — being an author rule
     declared later — silently won, so the Eagle/Birdie/Par/Bogey/
     Double-or-worse legend stayed visible even when `renderScoreGrid()`
     correctly set `.hidden=true` (par-suppressed / no-rounds-yet). Every
     sibling toggle in the same feature (`.sg-controls[hidden]`,
     `.card-drop[hidden]`) already had this companion rule; `.sg-legend` was
     missed. Added `.sg-legend[hidden]{display:none}`.
5. Ran the closing verification: full suite green, `npm run event-ready`
   confirmed unaffected by this wave (it reads the live sheet; every FAIL/WARN
   is sheet-content-side and pre-existing — the one check that reads
   `index.html` at all still passes).
6. Committed the evidence (see commit sha in the final status line).

Full per-frame battery description, crops, and evidence: see
`.superpowers/sdd/2026-08-24-gfy-s25a-broadcast-core/render-close/RESULTS.md`.

## Watch-list verdict table

| Item | Verdict | Evidence |
|---|---|---|
| `.sg-t td` ring ellipse (percentage inset on non-square `<td>`) | **FIXED** | Pre-fix 21.94×19.30px (aspect 1.14) → post-fix 21.75×21.75px (aspect 1.000). `04c-grid-under-round2-crop-*.png` |
| Ring box-shadow spread vs cell edge (blowup halo) | **PASS** | Clearance 3.06px (top) / 3.63px (left) on Moose's R1 h7 blowup cell — comfortable, not touching. `04b-grid-blowup-crop-*.png` |
| `.lb-mv` column overflow at 390w | **PASS — no overflow** | `row.scrollWidth === row.clientWidth` (342px) at 390w; mv cell 32px. No column drop needed. |
| Masthead: full-bleed centering vs nav's 1100px column | **FINDING (presentational, eyeball needed)** | At 1440w, Board's own left-anchored content starts at 194px; `#mastBar`'s centered content starts at ~477–498px — a real ~280–300px seam, invisible below 1148px content width (390w: both ~12–24px). `01-board-fresh-arrows-desktop.png`, `08a-masthead-data-view-desktop.png` |
| Masthead chip wrap at 390w | **FINDING (visual roughness, not fixed)** | "Round 2 · Saturday" wraps into 3 ragged lines; the off-phase est-line wraps into 4. Not broken/overlapping, just rough — left unfixed (needs a real mobile masthead layout pass, beyond a surgical CSS patch). `01-board-fresh-arrows-mobile.png`, `08b-board-masthead-offphase-mobile.png` |
| `#mastCtx` + `#mastChip` double render on Board | **FINDING (by design, eyeball needed)** | Both driven by the same `renderMastChip()` call, same string shown twice on screen (top bar + h2 pill) — functionally correct, visually redundant. `08b-board-masthead-offphase-*.png` |
| Home slice compactness at 390w (fits above the fold?) | **FINDING (informational — not a regression)** | Slice itself is compact (~550–600px incl. link + stamp); doesn't fit above the fold only because the pre-existing hero (crest/wordmark/countdown) already fills the first ~1150px. B-HOME didn't make the hero taller. |
| `.nn-row` stacked kicker reads as chyron | **PASS** | "NOW:" kicker + content stack cleanly inside the brass-bordered block. `05a2-home-slice-scrolled-mobile.png` |
| Over-par to-par cells unchanged (bone) | **Confirmed, not a finding** | `+4`/`+5`/`+6`/`+8` all render in plain bone, matching `--score-over == --bone` by design. |

## Test summary

- `node test/smoke.mjs` → `TALLY TOTAL 281/281` — run before the two CSS
  fixes and again after; both green, zero FAIL.
- `npm run event-ready` → runs against the live sheet; output unaffected by
  this wave (see RESULTS.md "Closing verification" for detail).

## Concerns

- Two presentational findings (masthead full-bleed-vs-column seam, chip wrap
  at 390w) and one by-design double-render are left for Riley's eyeball —
  none are regressions from this wave's own tasks (T1–T6), and none block
  the wave; they're pre-existing/adjacent surface polish the real-browser
  pass happened to surface.
- The `04-grid-glyphs-legend-desktop.png` full-page capture shows a sticky-nav
  double-render artifact that is a known Playwright full-page-screenshot
  quirk, not a real defect (viewport-only shots of the same page render
  cleanly) — flagged in RESULTS.md so it isn't mistaken for one.
