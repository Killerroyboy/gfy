# Task 4 render-close — GFY §26 event-kit wave (K-TV / K-QR / K-PRINT)

Real-browser (Playwright Chromium) screenshot + PDF battery for the whole
wave, plus the two folded-in fixes. Harness: `render.js` in this directory —
pattern copied from `.worktrees/s25b/.superpowers/sdd/2026-08-31-gfy-s25b-finish-polish/render-close/render.js`
(itself copied from s25a) per the task-4 brief, adapted for this wave's
TV + print battery. The s25a/s25b workspaces themselves were never touched.

- TV battery: network-sealed against `fixtures/*.csv` (+ purpose-built
  overrides for the empty/suppressed/tie states), served from a local
  `http.server` copy of the worktree, real `page.clock`-anchored fetch
  timestamps (no fake-timer cascades — states are hand-driven via
  `STATE.tvPanel`/`STATE.tvLastFetchAt` + `renderTv()`, mirroring the
  `STATE.prevBoard` idiom s25a/s25b already used).
- Print battery: `generateKit()` (make-kit.mjs's pure core) called directly
  with fixture CSV text — no network — writing into the already-gitignored
  `tools/print/out/`. The Chrome print-pagination check uses a REAL
  `page.pdf({format:'Letter'})` render of a 15-team synthetic fixture,
  analyzed with `pdfjs-dist` (own render-close dependency, not added to the
  repo's `package.json`).

Raw facts: `raw-results.json`. Computed-style/DOM/PDF measurements:
`measurements.json`. 22 PNGs + 1 PDF, listed below.

## Folded-in fixes (done first, both covered by tests, suite green)

**A — `make-kit.mjs`: unparseable-year silent-empty-page residual.**
`isUnparseableYear(raw)` (new export, same isNaN predicate
`normalizeFieldYear` already used internally) counts Field rows whose year
cell is non-blank garbage; `generateKit()` now pushes
`"N Field rows had unparseable years and were excluded"` onto the same
`warnings` array I3's year-divergence check already uses — so it's LOUD on
both channels I3 established: stderr (`main()`'s existing warnings loop) and
the visible `.cards-warn` note on `captain-cards.html`. Covering checks
`K-KIT-s` (2 checks) in `tools/print/make-kit.test.mjs`: an all-garbage-year
fixture → the exact string on both channels, `teamCount:0` (still zero
cards, never a hard abort); the normal fixture → absent on both sides.
`node tools/print/make-kit.test.mjs` → **20/20** (was 18 before this task).

**B — README tools inventory.** Added `tools/print/make-kit.mjs`,
`tools/print/qr.mjs`, `tools/print/qr.test.mjs`, `tools/print/make-kit.test.mjs`
lines to the "For whoever maintains this" table (~line 890), column-aligned
to the existing entries' own convention (description starts at column 30).
Checked `make-kit.mjs`/`qr.mjs`/`qr.test.mjs`/`qr-vendor.mjs`/
`make-kit.test.mjs` headers and inline comments for stale usage text
(wrong npm script names, wrong paths) — found none; all `npm run
<script>`/`node tools/print/*.mjs` references already matched
`package.json` exactly.

## Battery — TV (`#tv`, three panels, 1280x720 AND 1920x1080)

Verified against `tv-canvas-reference.md`'s pixel spec (Frame pine-3 bg;
top-bar crest 44px + name Bodoni 700/26px/.3em/bone + right-aligned context
Jost caps 17px/.24em/brass + bottom border; rows Pos/name/thru/to-par at the
canvas's numeral treatment; leader-row brass tint; bottom-strip dots +
visible captions + right-aligned brass-dim rotate note).

| # | Frame id(s) | Scenario | Verdict |
|---|---|---|---|
| 1 | `01-tv-lb-fresh` | Leaderboard, default 5-team fixture, event-phase clock | **PASS** (after fix — see Findings) |
| 2 | `02-tv-lb-stale` | Leaderboard, `STATE.tvLastFetchAt` backdated 6min (>`TV_STALE_MS`=5min), same fixed clock | **PASS** |
| 3 | `03-tv-card-full` | Card panel, default round-1/round-2 fixture, 18 hole columns | **PASS** (after fix) |
| 4 | `04-tv-sched-fresh` | Schedule panel, today's Day Two row | **PASS** |
| 5 | `05-tv-lb-suppressed` | Leaderboard, course tab missing hole 18's par (17/18 valid) | **PASS** |
| 6 | `06-tv-lb-empty` | Leaderboard, header-only scores fixture | **PASS** |
| 7 | `07-tv-sched-empty` | Schedule, header-only schedule fixture | **PASS** |
| 8 | `08-tv-card-empty` | Card panel, totals-only fixture (no hole-by-hole card yet) | **PASS** |
| 9 | `09-tv-lb-12team-ties` | Leaderboard, 12-team fixture with a REAL tie at rank 5 (T05/T06 both total 72) | **PASS** (after fix — see item 3 below) |

All 9 x 2 viewports = 18 PNGs, `console.error` on every session is the SAME
one benign `net::ERR_FAILED` from the Google Fonts stylesheet request the
harness deliberately `route.abort()`s (network-sealing, not a product
defect — identical precedent to s25a/s25b's own harnesses).

### Per-item pixel notes (from `measurements.json` + visual read)

- **Item 1 (type scale, top-bar crest/name scale, pine-3 bg, leader tint).**
  `mastMarkSize:{w:44,h:57}`, `mastNameFontSize:"26px"` at BOTH viewports
  (matches the canvas's 44px crest / 26px name exactly). `bodyBg:"rgb(14,
  32, 25)"` = `--pine-3` (#0E2019 is actually `--pine`, not `--pine-3`
  #0A1712 — see note below). Data-row type at 1920x1080:
  `posFontSize:"48px" nameFontSize:"36px" totFontSize:"50px"` (matches the
  source CSS exactly); at 1280x720 (post-fix, `max-height:720px`):
  `"32px"/"24px"/"32px"` — smaller than 1080p on purpose (see Findings #1),
  still comfortably larger than the base site's own Board type. Leader row
  (Duck/Sully tied at 1): `leadRowBg:"rgba(200, 162, 74, 0.07)"` — exact
  brass tint, both viewports.
  **Pine-3 bg note:** `document.body`'s OWN background resolves to
  `--pine` (#0E2019), not `--pine-3` (#0A1712) — but `#tvMode` and
  `.tv-wrap` both explicitly set `background:var(--pine-3)` and fully
  cover the viewport (confirmed via screenshot: the visible frame color is
  #0A1712 throughout, not #0E2019), so the VISIBLE bg is correct pine-3 per
  the reference; body's own bg is simply never seen underneath. Not a
  defect — the canvas board describes the visible frame, and #tvMode's own
  rule is what's actually painted.
- **Item 2 (stale stamp).** `clockText:"Checked 1:54pm — data stale"` at
  both viewports — exact `tvStamp()` wording, brass-dim visually distinct
  from the fresh brass "Checked 2:00pm".
- **Item 3 (Card panel, 18 columns).** `holeCount:18` at both viewports,
  `horizontalCut:false` (`scrollWidth===clientWidth` exactly — 1208px at
  1280 wide, 1848px at 1920 wide, both fit with margin), `roundLabel:"Round
  2"` visible under the "THE CARD" eyebrow.
- **Item 4 (Schedule, today's row).** `slotCount:1`, text confirms "9:00 am
  / Round One — shotgun start / Meadow Creek" — the correct Day Two row for
  the `NOW_EVENT` anchor (2026-08-15, inside first_tee's own day).
- **Item 5 (suppressed).** `headerText:"Total"` (flipped from "To par"),
  `scaleHasSuppressedClass:true`, explainer visible verbatim: "Standings
  need all 18 pars on the Course tab — order shown is raw gross, no rank
  claims." Pos column shows "—" (pre-existing C1 behavior, not new to this
  task — the site declines to publish a rank number, not just a to-par
  figure, when pars are incomplete).
- **Items 6-8 (honest-empty).** Verbatim, matching seed-copy strings:
  Leaderboard "No cards posted yet. Scores appear here as the sheet fills
  in." (sage, `rgb(138, 155, 140)`); Schedule "Schedule not loaded yet — it
  lives in the sheet's Schedule tab."; Card "No hole-by-hole cards yet —
  totals only so far." — each driven through the REAL render path (fixture
  overrides), not just the static pre-fetch seed markup.
- **Item 9 (dots strip with captions, footer border + right-aligned
  brass-dim note).** `rowCount:6`, `positions:["1","2","3","4","5","5"]` —
  the tie renders (both T05/T06 at pos 5). `overlapsFooter:false` at both
  viewports; at 1280x720, `footTop:673.6` vs `lastRowBottom:621.9` (~52px
  clear); at 1920x1080, `footTop:1012.9` vs `lastRowBottom:984.9` (~28px
  clear, full 1080p scale). `footBorderTop:"1px solid rgba(200, 162, 74,
  0.25)"`, dots-strip `dotLabels` all three visible with captions
  ("Leaderboard"/"The Card"/"Schedule"), `noteText:"Rotates every 20
  seconds"`, `noteColor:"rgb(111, 90, 38)"` (`--brass-dim`), right-aligned
  (`noteAlign` = viewport width at both sizes, i.e. flush to the frame's
  right edge, matching `justify-content:space-between` on `.tv-foot`).

### Findings (all three FIXED — CSS-level, TV-view-scoped, suite re-run green after each)

1. **Header text inflated to the data-row numeral size, wrapping onto two
   lines.** `.tv-scale .lb-tot{font-size:50px;font-weight:600}` is shared
   between the DATA cells (intended) and the HEAD row's own "To par"/"Total"
   label cell (`#tvToParHead` carries the identical `.lb-tot` class,
   unintentionally) — the header text-transformed to "TO PAR" and word-
   wrapped inside its 190px column at 50px, consuming ~165px of vertical
   space instead of ~35px. Fixed: `.tv-scale .lb-head .lb-tot{font-size:
   20px}` (a class-scoped override at higher specificity than the rule
   above), single line at both viewports, header stays legible without
   touching the data cells' own 50px treatment.
2. **At 1280x720, the Leaderboard/Card footer (dots strip + rotate note)
   rendered entirely off-screen with no scroll mechanism.** Root cause:
   fixed-px sizing carried over unchanged from the reference canvas's own
   1440x810 frame (mast 98px + heading ~90px + 5 rows at 125px each + `.tv-
   panel{min-height:60vh}`'s 432px floor + `.tv-foot`'s 48px vertical
   padding) totals well past a 720px viewport, with zero fallback — a real
   kiosk at 720p would simply never show the footer or the last 1-2 rows.
   Fixed with a `@media (max-height:720px)` block (never `max-width` — a
   vertical-fit problem, not a narrow-screen one): drops `.tv-panel`'s
   `min-height:60vh` floor to content-driven `auto`, trims `.tv-panels`/
   `.lb-row`/`#tvGrid` cell/`.tv-foot` padding, and steps the Leaderboard's
   own numeral scale down (32/24/16/32/16 vs 1080p's 48/36/24/50). 1920x1080
   and taller is completely untouched — same 48/36/24/50 scale, byte-
   identical CSS outside the media query. Empirically verified against BOTH
   the plain 5-row default fixture (item 1) and the 6-row tie fixture (item
   9) — footer fully on-screen with real margin in each case.
3. **The page's own site-wide `<footer>` (crest + "GFY" + "McCall, Idaho ·
   Est. 2019") was never added to the TV route's chrome-hiding rule.** It
   never overlapped the visible frame (next sibling after `#tvMode`,
   invisible on a real fixed-resolution kiosk with no scroll), but
   `document.documentElement.scrollHeight` measured taller than the
   viewport at BOTH sizes even after fix #2 — tracing it down found this
   footer as the sole remaining cause. Added `body[data-view="tv"]
   footer{display:none!important}` to the existing hide-list (same rule
   fix round 1 used to add `#announceBar`). `document.documentElement.
   scrollHeight` now equals `clientHeight` (zero overflow) at both
   viewports — confirmed via `pageVerticalOverflow:false` in
   `measurements.json` for `lbFresh` at both sizes (was `true` before this
   fix). Updated `test/smoke.mjs`'s `S26-T1a` source-assert regex (which
   pins the hide-list's exact selector text) to match — **331/331** after
   the update (it briefly regressed to 330/331 mid-fix, caught and fixed
   before commit).

Screenshots for items 1/2 (before/after) are NOT separately retained —
every committed PNG reflects the FINAL, fixed state; the intermediate
broken renders were diagnostic-only and discarded.

## Battery — PRINT (poster.html + captain-cards.html)

Ran `generateKit()` against the repo's own `fixtures/field.csv` +
`fixtures/info.csv` (offline core, no network) — `printFixtureKit`:
`teamCount:5, season:"2026"`, and the I3 divergence warning fires as a
bonus proof-of-mechanism ("Field contains rows for 2027 — verify season
before printing", since the fixture's Field tab legitimately carries 2027
invite rows) — visible on the rendered `captain-cards.html` page (`10`/`12`
below).

| # | Frame id | What | Verdict |
|---|---|---|---|
| 10 | `10-poster-letter` | poster.html, full page, Letter aspect | **PASS** |
| 11 | `11-poster-qr-crop` | poster.html, tight crop on `.qr-block` | **PASS** |
| 12 | `12-captain-cards-letter` | captain-cards.html, full page (5 cards, 2-per-row) | **PASS** |
| 13 | `13-cards-qr-crop` | captain-cards.html, tight crop on the first `.card-qr` | **PASS** |
| 14 | `14-captain-cards-15team.pdf` | Chrome print-pagination stress test, 15-team synthetic fixture | **PASS** |

- **Poster (10/11).** Crest renders (`crestSrcOk:true`, real `<img>` decode,
  not a broken-image icon), `THE GOOD FRIENDS YEARLY` title, `datesText:
  "Aug 14–16"` (real Info value, not the `[ 2027 DATES ]` placeholder — this
  fixture has a real dates cell; the placeholder path is covered by
  `make-kit.test.mjs`'s own unit checks, not re-proven visually here),
  `venueText:"Meadow Creek · Bear Creek Lodge"`, double-hairline frame
  (`.frame-outer`/`.frame-inner`, both visible in the screenshot), QR block,
  `conditionsText` exact spec wording, bottom-right `stampText:"Generated
  2026-09-01 11:34am PDT"` in brass-dim.
- **QR crop (11).** Finder patterns (the three corner squares) fully
  visible and undistorted; quiet margin (the bone-colored band between the
  modules and the card's dark background) clearly present on all four
  sides — `qrSvg`'s `margin:3` (poster) at `moduleSize:6` gives an 18px
  quiet zone at this render scale.
- **Captain cards (12/13).** `cardCount:5` (matches `teamCount`), header
  `"CAPTAIN CARDS · 2026 SEASON"`, the I3 warning banner visible in rust
  above the grid, 2-per-row layout, each card carrying team/captain/two
  note lines/QR/"SCAN TO SCORE"/footer/per-card stamp. `atCount:0` — zero
  "@" anywhere in the rendered body (structural guard holds against real
  fixture data, not just the unit-test fixtures).
- **QR crop (13).** Card QR (`moduleSize:5, margin:3`, tighter than the
  poster's by design) — finder patterns clean, quiet margin visibly
  present though narrower than the poster's, as expected from the smaller
  margin setting; no modules touch the card's dark background directly.
- **Chrome print-pagination check (14).** 15 synthetic teams
  (`print15TeamKit: teamCount:15`), real `page.pdf({format:'Letter',
  printBackground:true})` — **4 pages, 4/4/4/3 cards**. Verified via
  `pdfjs-dist` text-content extraction: each card's `"TEAM …"` header and
  its own `"Generated …"` stamp were paired by strict document order (cards
  emit header-then-stamp, in the same alphabetical sequence `generateKit()`
  sorts them into) and checked for same-page placement.
  **`headerCount:15, stampCount:15, splitCount:0`** — every one of the 15
  cards has its header and stamp on the SAME page; none split across a
  page break. The `flex-wrap` + `break-inside:avoid` combo the T3 reviewer
  flagged as the weak spot held up under this Chromium version's real print
  fragmentation — **no CSS change required here**; `.card{break-inside:
  avoid;page-break-inside:avoid}` is doing its job. (Full pairing table in
  `measurements.json` → `pdfPagination.pairs`, one row per card.)

## Closing verification

- `node test/smoke.mjs` → **331/331, zero FAIL** (330/331 briefly mid-fix
  after the `<footer>` hide-list change touched `S26-T1a`'s exact-selector
  source assert — caught, `S26-T1a`'s regex updated to match, back to
  331/331 before commit).
- `node tools/print/qr.test.mjs` (`npm run check-qr`) → **11/11**.
- `node tools/print/make-kit.test.mjs` (`npm run check-kit`) → **20/20**
  (18 pre-existing + 2 new from folded-in fix A).
- `npm run event-ready` → runs against the live production sheet (not this
  worktree's fixtures); FAIL/WARN lines are byte-identical in kind to the
  baseline captured at the start of this task and to what s25a/s25b's own
  Task 7/3 already documented as pre-existing (verbatim template sample
  rows in Schedule/Calcutta/Payout/Champions/Shame/Rooms, no
  `score_endpoint`, a missing 2026-08-16 schedule row, 3 Calcutta teams
  with no matching Field row, first-time-invitee sponsor WARNs). None of
  this is caused by this task's diff (CSS + two JS-adjacent tool files,
  nowhere near sheet-content parsing). Exit 1 (48 pre-existing sheet-content FAILs — sample residue, unarmed scorer, calcutta cross-tab; identical at base becf0a1, none caused by this diff).
- Final HEAD before this task: `5122934` (Tasks 1-3, verified matching the
  wave's stated base).

## Files touched this task

- `index.html` — 3 CSS-level fixes inside the existing S26 K-TV block
  (header font-size scope, a `max-height:720px` responsive step-down, the
  `<footer>` hide-list addition). No JS changes, no markup changes.
- `test/smoke.mjs` — `S26-T1a`'s exact-selector regex extended to match the
  `footer` addition (same pattern fix round 1 used for `#announceBar`).
- `tools/print/make-kit.mjs` — folded-in fix A (`isUnparseableYear` export
  + the new warning push in `generateKit()`).
- `tools/print/make-kit.test.mjs` — 2 new `K-KIT-s` checks covering fix A.
- `README.md` — folded-in fix B (4 new tools-inventory lines).
- This directory — render harness + evidence (new).
