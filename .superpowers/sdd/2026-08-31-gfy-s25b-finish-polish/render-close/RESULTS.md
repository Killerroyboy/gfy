# S25b render-close — Task 3 render battery + closing verification

Real-browser (Playwright Chromium) screenshot battery for the §25b
finish-polish wave (B-FIN), network-sealed against fixtures
(`fixtures/*.csv`), served from a local `http.server` copy of the
worktree. Harness: `render.js` in this directory — the PATTERN copied
from `.worktrees/s25a/.superpowers/sdd/2026-08-24-gfy-s25a-broadcast-core/render-close/render.js`
per the task-3 brief, adapted for §25b's six-item battery (the s25a
workspace itself was never touched). Raw facts in `raw-results.json`,
computed-style/DOM measurements in `measurements.json`.

Every state below was captured at **390×844** (mobile, dpr 2) and
**1440×900** (desktop, dpr 2) — **20 PNG frames** total (6 full-frame
battery items + 2 tight crops, each × 2 viewports).

Zero CSS or JS changes were made as a result of this run — all six items
verdict **PASS**, no defects found (see per-item detail below).

## Battery

| # | Frame id | Files | What it shows | Verdict |
|---|---|---|---|---|
| 1 | `01-board-empty` | `01-board-empty-{mobile,desktop}.png` | Board, `scores` tab overridden to header-only → `buildPlayers()` returns `[]` → `renderLeaderboard()`'s `if(!players.length)` branch repaints `#lbBody` with `.lb-empty`. | **PASS** |
| 2a | `02a-money-empty` | `02a-money-empty-{mobile,desktop}.png` | Money view (`#money`, `#mnBody`), **no override needed** — `fixtures/ledger.csv` only carries 2025 rows and the event-phase anchor (`NOW_EVENT`) puts `STATE.year` at 2026, so `renderMoney()`'s natural "Nothing to settle for 2026…" `.mn-empty` flavor renders from the default fixtures as-is. | **PASS** |
| 2b | `02b-photos-empty` | `02b-photos-empty-{mobile,desktop}.png` | Photos view (`#photos`, `#photoFrame`), **no override needed** — this worktree's `config.js` ships `DRIVE_FOLDER_ID:""`, so the static `.photo-empty` markup in `index.html` renders untouched (the `if(CONFIG.DRIVE_FOLDER_ID)` branch that would replace it with an iframe never fires). | **PASS** |
| 3 | `03-hole-panel` (+ `03b` crop) | `03-hole-panel-*`, `03b-sg-p-crop-edge-*` | Board, hole panel opened via `renderHolePanel(3)` (hole 3 has a real photo asset, `assets/holes/hole-3.jpg`, so `.sg-p-photo` doesn't `onerror`-hide) — all three framed surfaces visible: `.sg-p-crop` (scrolling course-map crop, pin marker), `.sg-p-map` (full course thumbnail, pin marker), `.sg-p-photo` (real hole photo). `03b` is a tight top-left corner crop of `.sg-p-crop`'s own edge. | **PASS** |
| 4 | `04-board-double-digit-mv` | `04-board-double-digit-mv-{mobile,desktop}.png` | Board, 12 synthetic teams (`field`+`scores` overridden, strictly increasing totals, no ties) with `STATE.prevBoard.order` set to the reversed live order (same idiom as s25a's `01-board-fresh-arrows`) → extreme rows show **▲11 / ▼11** movement. | **PASS** (exceeds the 10+ bar) |
| 5 | `05-sg-t-head-corner` (+ `05b` crop) | `05-sg-t-head-corner-*`, `05b-sg-t-head-corner-crop-*` | Board, hole-by-hole grid scrolled into view (default fixtures, full 18-hole course, not suppressed) — `05b` is a tight crop on the sticky `.sg-team` header cell's bottom-right corner, where its `border-right` (1px solid brass-dim) meets `.sg-t thead th`'s `border-bottom:3px double rgba(200,162,74,.45)`. | **PASS** |
| 6a | `06a-board-mid-flash` | `06a-board-mid-flash-{mobile,desktop}.png` | Board, a **real two-paint** (not a hand-primed class): `load()` fires once with `scores` = a 5-team, single-hole (h1) fixture giving every team `rel=0` ("E"); the fetch override is then mutated to change ONLY Duck's h1 (4→5), the page clock is fast-forwarded 71s (past the event-phase `HOT_TABS` 60s cadence + `scheduleRefresh`'s worst-case jitter) so `scores` comes due again, and the site's own `scheduleRefresh()` timer fires the second real `load()`/`paint()`. Captured immediately after Duck's to-par text changes (`"E"`→`"+1"`) — Duck's row carries `.lb-flash` and a visibly tinted background; Sully/Moose/Tex/Bear (unchanged control) never flash. | **PASS** |
| 6b | `06b-board-flash-reduced-motion` | `06b-board-flash-reduced-motion-{mobile,desktop}.png` | Identical real two-paint sequence, same fixtures, but the browser context is created with `reducedMotion:'reduce'`. Duck's row still gets the `.lb-flash` class (JS doesn't check the media query) but the row's computed background stays `rgba(0,0,0,0)` (transparent/default) both immediately and 600ms later — the site's one `@media(prefers-reduced-motion:reduce)` block's `.lb-flash,.lb-mv.up,.lb-mv.down{animation:none}` neutralizes it. No visible tint at any point. | **PASS** |

## Per-item pixel notes (from `measurements.json`)

- **Item 1** — `.lb-empty` computed style: `color:rgb(138,155,140)` (`--sage`), `font-style:normal`, `letter-spacing:2.7648px`, `text-transform:uppercase`, `text-align:center`. No italic, no brass-dim — matches T1's ceremony delta exactly, both viewports.
- **Item 2a** — `.mn-empty` (the "Nothing to settle for 2026…" flavor): same sage/normal/letterspaced/uppercase dress as item 1, confirming T2's fold-in applied identically to the Ledger-tab-configured-but-year-mismatch copy branch, not just the "Add a Ledger tab" branch.
- **Item 2b** — `.photo-empty`: same sage/normal/letterspaced/uppercase dress, plus its own deliberately larger `padding:60px 30px` and `text-align:center` (both pre-existing/untouched per the T2 report).
- **Item 3** — computed styles for all three frame surfaces: `.sg-p-photo` and `.sg-p-map img` both `border:1px solid rgba(200,162,74,.28)`, `background:rgb(10,23,18)` (`--pine-3`), `padding:4px`. `.sg-p-crop` carries the identical border+background but `padding:0px` — visually confirmed in the `03b` crop (the border sits flush on the map image, no pine-3 mat gap), exactly the deliberate T2 asymmetry documented in the Task 2 report. `.sg-p-photo` `hidden` is `false` (hole 3's asset loaded, not the onerror fallback).
- **Item 4** — 12 teams, reversed order → movement cells run `▲11,▲9,▲7,▲5,▲3,▲1,▼1,▼3,▼5,▼7,▼9,▼11`; `maxN:11` at both viewports — comfortably past the 10+ bar the brief set.
- **Item 5** — `.sg-team` (thead) computed: `border-right:1px solid rgb(111,90,38)` (`--brass-dim`), `border-bottom:3px double rgba(200,162,74,.45)`. Both rules resolve as intended at the shared corner in the collapsed-border table; the `05b` crop shows the vertical brass-dim line meeting the horizontal double gold rule in a clean L.
- **Item 6a** — `duckBefore:"E"` → `duckAfter:"+1"`; `hasFlashClass:true`; `backgroundColor:"rgba(200,162,74,.14)"` — that's the exact `from{}` value of the `lbFlash` keyframe, confirming the capture landed at the start of the real 1.2s animation window (the real compositor clock, unaffected by the page's fake `Date`/timers). Sully never carried `.lb-flash` (control held).
- **Item 6b** — same `duckBefore:"E"`; `hasFlashClass:true` (JS-side class still applied) but `backgroundColor:"rgba(0,0,0,0)"` and `animationName:"none"` immediately, and still `rgba(0,0,0,0)` 600ms later (the point in real time where the normal-motion frame is still visibly tinted) — proves the neutralization is real, not just present-but-untested.

## Mechanism note — how items 4 and 6 differ, on purpose

Item 4 uses the classic "hand-prime `STATE.prevBoard` + call `renderLeaderboard()` once" idiom (same as s25a's own `01-board-fresh-arrows`) — appropriate there because the point is the **arrow/Pos rendering at a given movement magnitude**, not the capture mechanism.

Item 6 deliberately does NOT hand-prime `STATE.prevVals`/`.lb-flash` — it drives the site's actual `load()`/`paint()`/`scheduleRefresh()` cycle twice via a mutated fetch-route override and a fast-forwarded page clock, landing on the real code path (`STATE.lastBoardVals` stash in `renderLeaderboard()` → promotion into `STATE.prevVals` in `paint()` → the `mv && STATE.prevVals.vals` gate). This is a real-browser visual companion to `test/smoke.mjs`'s `S25b-T2g` (which mutation-kills the same two capture-seam lines in jsdom) — item 6 proves it also **looks** right in a real compositor, not just that the DOM state is correct.

## Findings

**None.** All six battery items pass on first render with no CSS-level defects found — no fixes were required this task, so the suite re-run requirement ("fix only CSS-level defects you find, suite re-run green after any fix") had nothing to trigger. `index.html` is byte-identical before and after this run (`git status` clean throughout — the harness only ever serves patched responses over HTTP, never writes to the tracked file).

## Closing verification

- `node test/smoke.mjs` → **312/312, zero FAIL**, run both before and after the render battery (harness never touches disk).
- `npm run event-ready` → runs against the **live production sheet** (not this worktree's fixtures), so its FAIL/WARN lines reflect real sheet-side content: verbatim template sample rows still in Info/Course/Schedule/Calcutta/Payout/Champions/Shame/Invites/Rooms, no `score_endpoint` configured, a missing 2026-08-16 schedule row, 3 Calcutta teams with no matching Field row, a `first_tee` date warning. **None of this is caused by this wave** — §25b's diff (`669f8a6`, `abaab4c`, `b6e0452`) is CSS rules + one small JS flash-toggle inside `renderLeaderboard()`, nowhere near sheet-content parsing or the `checkFallbackParity` check (which still **PASSes**). Exit code 0, output unchanged in kind from what s25a's own Task 7 already documented as pre-existing.
- Final HEAD: `b6e0452` (Task 1 + Task 2, verified matching the wave's stated base before this task began).

## Task 1 audit tables (verbatim, per brief requirement)

Reproduced in full in `task-3-report.md` (this task's own report), copied verbatim from `task-1-report.md` — see that file for: the numerals audit table (6 additions: `.lb-pos`, `.lb-mv`, `.entry-year`, `.pay-place`, `.grp-time`, `.slot-time`), the hairline-rules audit, the full gold-as-metal (`var(--brass)` on text) classification table, and the `.mn-net.up{color:var(--brass)}` RULE-FLAG left open for the controller (money-up coloring is semantic, not ceremony, per the brief; `.name-list.up` carries the identical pattern and was likewise left untouched pending the same ruling).
