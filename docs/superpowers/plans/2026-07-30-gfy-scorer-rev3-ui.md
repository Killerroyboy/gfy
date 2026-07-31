# GFY Scorer Rev 3 UI Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin and re-lay the shipped rev-2 scorer to the Riley-approved rev-3 prototype (vertical card, bottom-sheet pad, sticky glance header, next-hint, conflict ruling sheet, board button) — changing the SCREEN only; every rev-2 write-path, truth-state, and access rule stands.

**Architecture:** The rev-2 engine (journal, queue, drain, scSend, scCellState, scSheetHolesFor, season pinning) is untouched; this wave replaces the scorer's RENDER layer (`renderScCard`, pad, header) with the prototype's structure, wired to the real state machine. The committed prototype `tools/scorer-rev3-prototype.html` is the fidelity reference of record — transcribe its CSS/markup shapes, NEVER its demo logic (fake timer, hardcoded conflict, demo copy are spec-pinned as NOT spec).

**Tech Stack:** index.html (single-file site), jsdom smoke suite (group X, baseline 197/197), chrome-headless-shell renders.

## Global Constraints (spec §18 rev 3 + carried rev-2 rules — every task inherits)

- Worktree isolation off `v2.1-invites` (controller creates; commit there, NEVER push). Base includes d73eaea (the committed prototype reference).
- **Screen-only mandate**: zero changes to scSend/scPing/scDrain/scJournalSave/scStore/scEntryHeld/scSheetHoles(For)/applyScore_/doPost or any verdict/cache/queue semantics. If a render change seems to need an engine change, STOP and report.
- The state model keeps rev 2's four states + conflict + old-round summary; rev 3 only re-DRESSES them: marks become **▮ on-sheet · ⇡ saved/sending · ▲ conflict · ! rejected** (! kept from rev 2 — rev 3's pin list omits it but SC-HONEST "stands unchanged"; rejected stays loud with its verdict).
- SC-UI-V: two vertical columns Out|In inside `#scCard`, one full-width row per hole: hole number (display face), "Par N / NNN yds" block, score (display face, scoreClass coloring), state mark. Cells ≥52px min-height. The old two-rows-of-nine layout is retired IN THIS VIEW ONLY.
- SC-PAD-SHEET: pad = fixed bottom sheet + veil (prototype `.sheet`/`.veil` classes); par key visually primary; keys par−2…par+4 with Eagle/Birdie/Par/Bogey/+n labels (SC-PAR derivation unchanged — `scHolePar` stays the source); "Other" toggles the numeric overflow row (par+5…19 — ALWAYS through 19; the earlier par+10 cap was a plan defect leaving 16–19 unreachable on real pars) PLUS the full 1–19 range must remain reachable: the overflow row is prototype-shaped, but ALSO keep a numeric input fallback for values below par−2 (rev 2's clamp 1–19 is a hard rule; prototype's overflow alone cannot reach e.g. 1 on a par-5 — resolve per Task 2's pinned resolution).
- SC-NEXT-HINT: first EMPTY cell (per `scCellState`) gets `.sc-next` pulse — affordance only, never selection, never a write target; disabled under `prefers-reduced-motion` (CSS-only, as in the prototype).
- SC-SKIN: `--display`/`--ui` faces per the site's existing tokens (site already defines them; the prototype's :root duplicates — REUSE the site's, do not add a second token block); pine/bone/sage/brass; nothing functional under 13px (prototype's 9.5–11px sub-labels are decorative per the pin — hole-par line and key sub-labels qualify; score/hole/verdict text does not).
- SC-CONFLICT-UI: conflict cell shows "SHEET·MINE" + ▲; tapping opens the conflict SHEET (two-button ruling: "Keep the sheet" / "Replace with mine", plain-words copy per the prototype's `.con-copy` including "Nothing resends on its own — pick which number is true."). SEMANTICS UNCHANGED: keep = rev 2's `scPadKeepSheet` discard; replace-with-mine = rev 2's force-send (same seq); the rev-2 in-flight guard carries over — while `entry.state==="sending"` BOTH buttons render disabled with "sending — wait". Entering a THIRD number = keep-the-sheet first, then tap the cell again (normal replace flow) — document in the sheet's copy line if space allows, else README.
- SC-TALLY-HONEST: header tallies (Out/In/Total/To par) compute from non-conflict SCORED holes only, source = the same scCellState-backed data (no second derivation); "To par · thru N" label carries the basis; conflicts count NOWHERE until resolved.
- Sticky header: team name (display face), roster line "Scoring for **Team X** · not you? switch" — **switch opens the team picker** (this RESOLVES the parked I3 header-picker gap; the README's corrected line gets re-corrected to the new truth in Task 4); momentary round chip with "auto"/"manual · one entry" sub-label (rev 2 spring semantics untouched).
- SC-BOARD-BTN: Board view gains "Enter scores — Team <name>" ONLY when the scorer's persisted-identity localStorage key exists (same key SC-LINK writes); routes to bare `#score`; absent identity → nothing rendered. Placement beside the year picker, quiet brass action.
- Test discipline: group X; adapted checks keep their numbers (X7 layout contract, X12 replace flow, X16 marks, X20 conflict UI); genuinely new surfaces get X29+ (board button, next-hint, tally basis, switch link). Suite target pinned per task; zero FAIL always. Reviewers on this build mutation-check tests — write assertions accordingly.
- Rejected-state UI (unchanged semantics): rejected cells keep `!` mark + verdict reachable (tap → sheet shows the verdict + retry (same seq) + "text Riley" escalation as shipped). The prototype omits this state — carry rev 2's, restyled to sheet form.
- Screenshot binary: `/Users/riley/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`; network-free render harness technique documented in the v2.6 task-8 report (rebuild it in /tmp as needed — never committed).

## File structure
- `index.html` — scorer CSS block (`.sc-*` rules replaced by prototype-derived ones, prefixed `.sc-` to avoid colliding with the prototype's bare class names), `renderScCard` + pad + header render functions, board button hook in `renderAll`'s board painter.
- `test/smoke.mjs` — group X adaptations + additions.
- `README.md` — Task 4's truth corrections (switch link, board button).
- Reference (read-only): `tools/scorer-rev3-prototype.html`.

---

### Task 1: Vertical card + marks + skin (SC-UI-V, SC-SKIN core)

**Files:** Modify `index.html`; Test `test/smoke.mjs` (X7 rework + X16 mark swap + new X30 next-hint placeholder excluded — hint is Task 3)

**Interfaces:**
- Consumes: `scCellState(hole)` (unchanged), `scHolePar(hole)`, `courseMap()`/yards via the existing per-hole source, `scoreClass`.
- Produces: `renderScCard()` emitting: `#scCard > .sc-cardgrid > 2 × (.sc-colhead + .sc-col)`, each `.sc-col` = 9 × `button.sc-cell[data-hole]`, every cell containing `.sc-hole-n`, `.sc-hole-par` ("Par N" + "NNN yds"), `.sc-score` (dash span when empty), `.sc-mark`. State classes: `.sc-onsheet` `.sc-queued` `.sc-sending` `.sc-conflict` `.sc-rejected` (+ marks ▮ ⇡ ⇡ ▲ ! respectively — queued and sending share ⇡ per the legend). aria-label carries hole + par + state.
- The legend line updates to the rev-3 mark set.

- [ ] **Step 1: Rework X7 + X16 to the rev-3 contracts (RED first).** X7: asserts 2 `.sc-col` containers × 9 `button.sc-cell` each,every cell contains `.sc-hole-n`, `.sc-hole-par` matching /Par \d/ and /yds/, `.sc-score`, `.sc-mark`; the old 9-across `.sc-row` assert is deleted. X16: queued mark assertion becomes ⇡ (unchanged glyph) PLUS on-sheet cells assert ▮ in `.sc-mark` and conflict assertion (in X20's block) swaps ? → ▲. Run: X7/X16/X20 RED for layout/mark reasons, everything else green.
- [ ] **Step 2: Implement.** Transcribe the prototype's `.cell/.hole-n/.hole-par/.score/.mark/.card/.colhead/.col` CSS into the site's `.sc-`-prefixed equivalents using the SITE's existing `--display`/`--ui` tokens; rebuild `renderScCard` to the two-column structure; wire marks from `scCellState().kind/state`. Keep `renderScCard` idempotent and repaint-safe (X26 must stay green untouched).
- [ ] **Step 3: Green.** Suite = 197 (no count change this task). Run and record.
- [ ] **Step 4: Commit** `feat(scorer-ui): vertical Out|In card, rev-3 marks and skin (SC-UI-V/SC-SKIN; X7/X16/X20 adapted)`

### Task 2: Bottom-sheet pad + replace flow (SC-PAD-SHEET)

**Files:** Modify `index.html`; Test `test/smoke.mjs` (X8/X12 adapted)

**Interfaces:**
- Consumes: `scPadOpen(hole)` name retained (call sites in cell wiring), `scHolePar`, `scSubmitScore` (unchanged send-on-tap semantics).
- Produces: `#scPad` restructured as `#scSheet.sc-sheet` + `#scVeil.sc-veil` (fixed, bottom, prototype geometry); `#scSheet` contains sheet-head (hole + "Par N · NNN yds" + Close), `.sc-replace-line` ("Currently **N** on the sheet — tap a number to replace it." — shown when the hole already carries a value; THIS is the rev-3 form of the rev-2 two-tap replace confirm: opening the sheet on a filled cell + the named current value + a deliberate number tap = the explicit two-number act; the separate `#scPadReplace` button is retired), key grid (par−2…par+4, par key `.sc-parkey` primary), Other → `.sc-numrow` overflow (par+5…19, always through 19), PLUS down-range values 1…par−3 when par−2 > 1 — full 1–19 reachable without a text input.
- Pinned resolution: `STATE.scPadOtherVal` text-input path is RETIRED (the overflow rows cover 1–19 completely); its X12 persistence assertion is replaced by an overflow-row persistence assert (numrow stays open across a forced `renderScCard()` — same refresh-survival protection, new mechanism via `STATE.scPadOtherOpen` which already exists).

- [ ] **Step 1: Adapt X8 + X12 (RED first).** X8: same par-shift labeling asserts, now against `.sc-num`→`.sc-key` classes and the par-primary class (`.sc-parkey` on the par value). X12: filled-cell tap → sheet shows the replace-line naming the current value; a number tap fires ONE `scJournalSave` with the new value (no second confirm element); overflow-open survives a forced repaint; sheet-differing replace still carries override (the v2.6 X12b assert stays, adapted to the new flow).
- [ ] **Step 2: Implement** per Interfaces; veil/sheet open-close cycle full (S14: open→close→reopen asserted in X12's block).
- [ ] **Step 3: Green** — 197. **Step 4: Commit** `feat(scorer-ui): bottom-sheet pad, replace-line flow, full-range overflow (SC-PAD-SHEET; X8/X12 adapted)`

### Task 3: Sticky header + honest tallies + next-hint (SC-TALLY-HONEST, SC-NEXT-HINT, header)

**Files:** Modify `index.html`; Test `test/smoke.mjs` (new X29 tallies, X30 next-hint, X31 switch link; renumber-free — append after X28)

**Interfaces:**
- Produces: `#scHeader` = sticky top block: team name, roster line with `#scSwitch` ("not you? switch") opening the picker (`scShowPicker()` — reachable ALWAYS now), round chip (`#scRound` retained id, adds the auto/manual sub-label), tally strip `#scTally` reworked: Out/In/Total/To-par tiles, to-par tile labeled `To par · thru N`. Tally source: iterate `scCellState` per hole; count score only when kind is sheet/journal-ok/queued-sending — EXCLUDE conflict entirely (both numbers). `data-mode` attr semantics kept (topar/strokes per the all-18-pars rule — unchanged).
- SC-NEXT-HINT: `.sc-next` on the first hole whose `scCellState().kind==="empty"`, breathe animation inside `@media (prefers-reduced-motion: no-preference)` only; class is presentational — no click behavior difference.

- [ ] **Step 1: X29/X30/X31 (RED).** X29: with duck's fixture (r2 full) + one journal conflict planted via the scSheetHoles stub pattern, the to-par tile label matches /thru \d+/ and the conflicted hole's strokes are absent from Total (compute expected from fixture values in the test). X30: exactly one `.sc-next` cell and it is the first empty hole; a scores variant with holes 1-3 filled puts `.sc-next` on 4; reduced-motion is CSS-only (assert the animation rule is inside the media query by source regex — structural, stated honestly in the check name). X31: `#scSwitch` click → `#scPicker` visible with team buttons (from any confirmed-state dom).
- [ ] **Step 2: Implement.** Header sticky CSS from prototype (`.top` → `.sc-top`), tallies from the single per-hole walk. NOTE: the rev-2 rank glance (`#scGlance` — position/leader/neighbors) STAYS, below the card, unchanged (SC-GLANCE stands; the header adds tallies, it does not replace the rank panel).
- [ ] **Step 3: Green** — 200. **Step 4: Commit** `feat(scorer-ui): sticky header w/ switch + honest tallies + next-hint (SC-TALLY-HONEST/SC-NEXT-HINT; X29-X31)`

### Task 4: Conflict ruling sheet + rejected sheet + board button + README (SC-CONFLICT-UI, SC-BOARD-BTN)

**Files:** Modify `index.html`, `README.md`; Test `test/smoke.mjs` (X20 adapted; new X32 board button)

**Interfaces:**
- Conflict sheet `#scConSheet`: prototype copy verbatim shape ("The sheet says **S** · this phone sent **M**. Someone else may have corrected it. Nothing resends on its own — pick which number is true."), two `.sc-con-btn`s (Keep the sheet / Replace with mine) wired to the EXISTING `scPadKeepSheet` / force-send (same seq) handlers; in-flight (`state==="sending"`) renders both disabled + "sending — wait" (rev-2 guard carried; the function-level guards remain untouched).
- Rejected sheet: tapping a rejected cell opens the same sheet chrome showing the verbatim verdict + Retry (same seq) + the "text Riley" escalation copy at ≥2 retries (all existing functions; UI re-dress only).
- Board button: in the board renderer, `#boardScoreBtn` "Enter scores — Team <name>" rendered ONLY when the persisted scorer identity exists (read via the same `scKey`/`scConfirmedTeam()` path — read-only call, no new storage); href `#score`. Styled quiet brass beside the year picker.
- README: correct the switch-link line (header picker now real); add one line documenting the board button ("appears only on phones that have opened their captain link").

- [ ] **Step 1: X20 adapt + X32 (RED).** X20: conflict cell tap → `#scConSheet` visible, copy matches /sheet says 4/ and /this phone sent 6/ (fixture values), both buttons present; mid-flight variant asserts BOTH disabled (carries the v2.6 in-flight assert); keep-sheet click → journal entry gone + cell reverts (existing asserts adapted). X32: fresh dom → no `#boardScoreBtn` on #board; plant the persisted identity key (localStorage seed before load, or confirm via the scorer first) → button present with team name; click → score view shown.
- [ ] **Step 2: Implement.** **Step 3: Green** — 201. **Step 4: Commit** `feat(scorer-ui): conflict ruling sheet, rejected sheet, board score button (SC-CONFLICT-UI/SC-BOARD-BTN; X20/X32)`

### Task 5: Battery + S11 vs prototype + ledger

**Files:** README only if S11 exposes copy defects (report-first otherwise).

- [ ] **Step 1: Battery** — clean tree, full suite (201/201 expected; record actual).
- [ ] **Step 2: S11** — network-free harness renders at 390×844 (the prototype's design width) and 900×900: fresh/inert, confirmed+card (journal states planted), conflict planted, sheet open. Read every PNG side-by-side against `tools/scorer-rev3-prototype.html` rendered at the same size — cold-viewer judgment: same screen? marks visible? nothing under 13px functional? Then homepage + #board (button present/absent states) unchanged elsewhere.
- [ ] **Step 3: Report** with render observations; commit only if changes were needed (else no commit — verification-only close).

---

## Plan self-review
- Spec coverage: SC-UI-V→T1 · SC-PAD-SHEET→T2 · SC-NEXT-HINT/SC-TALLY-HONEST/header+switch→T3 · SC-CONFLICT-UI/SC-BOARD-BTN→T4 · SC-SKIN→T1-T4 (tokens/marks/faces) · rev-2 rules untouched→Global screen-only mandate · prototype caveats→Global (demo logic excluded) · battery/S11→T5.
- Deliberate resolutions recorded: replace-confirm → replace-line flow (X12 adapted, override carry preserved); Other text input retired for full-range overflow rows; rejected-state UI carried from rev 2 (prototype omits it); #scGlance rank panel retained alongside new header tallies; I3 header-picker gap closed by the switch link.
- Type consistency: `scCellState/scHolePar/scPadOpen/scPadKeepSheet/scShowPicker/scConfirmedTeam/scKey` all rev-2 shipped names (verified against the v2.6 build); new ids `#scSheet #scVeil #scConSheet #scSwitch #boardScoreBtn` used consistently across tasks. Suite arithmetic 197→197→197→200→201.
