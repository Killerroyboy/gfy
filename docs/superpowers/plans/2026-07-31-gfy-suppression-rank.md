# GFY Suppression-Rank Wave Implementation Plan (§21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `courseMap()` is null, the board's Pos column and lead crown, and the calcutta's payout places and per-lot win claims, stop presenting standing derived from the raw-gross fallback ordering — while everything money-true (pot/rake/payable/outstanding) and everything net-basis stays live.

**Architecture:** Two render-branch changes reusing the §20 suppression signal (`!courseMap()`). `renderLeaderboard`'s row emitter renders `—` in `.lb-pos` and skips `.lead` when suppressed (ordering, sorting, and `rankedPlayers` untouched). `renderCalcutta` gains one suppression branch active only on gross basis: the payout table renders a pinned honest empty-state, `#calBasis` a pinned paused line, and the would-text chain's money-claim arm reads `awaiting pars`; the `withdrawn`/`unsold`/`waiting on cards` branches and all money tiles are untouched.

**Tech Stack:** index.html (single-file site), jsdom smoke suite (test/smoke.mjs, baseline 207/207), chrome-headless-shell CDP renders for the verification close.

## Global Constraints (spec §21 — every task inherits)

- Worktree isolation off `v2.1-invites` (controller creates `.worktrees/rank-supp`, branch `suppression-rank`, base = tip incl. spec §21). Commit there; NEVER push.
- **Unfrozen surfaces:** `renderLeaderboard` (Pos/lead emission only) and `renderCalcutta` (payout-table/would-text/calBasis branches only). FROZEN (verify by diff before committing): `rankedPlayers`, `calcuttaModel`, `buildPlayers`, `courseMap`, `courseYards`, `scHolePar`, `scHoleYards`, `scTallyHTML`, `renderScoreGrid`, `renderHolePanel`, `scGlanceHTML`, and the v2.6 engine (scSend/scPing/scDrain/scJournalSave/scStore/scEntryHeld/scSheetHoles(For)/applyScore_/doPost). If a change seems to need a frozen function, STOP and report BLOCKED.
- Suppression signal: `!courseMap()` — the exact §20 idiom (`parsSuppressed` is already computed in `renderLeaderboard` at index.html:1725; reuse it, do not recompute differently).
- SC-RANK-CAL applies on **gross basis only**: `basis==="net"` standings derive from handicaps/totals, not pars — never suppressed.
- Pinned copy, verbatim: `#payBody` empty-state `Payouts wait on the Course tab — standings need all 18 pars.` · `#calBasis` `Paused · Course pars incomplete` · would-text `awaiting pars`.
- Money invariance: `#calPot`/`#calRake`/`#calPayable`/`#calTop`/`#calOut` byte-identical suppressed vs not (X40 asserts it).
- Test discipline: X39/X40 appended after X38; suite 207 → exactly **209**, zero FAIL; values computed from real fixtures in-test; RED before GREEN; mutation evidence ONLY in throwaway /tmp copies (cp -R, mutate+test, discard — ratified rule). Existing checks (A2–A6 Pos ground truth, G1–G5, V1–V9, X34, X37/X38) stay green untouched.
- The blank-par splice idiom (from X37, test/smoke.mjs:4419-4421): `FIXTURES.course.split("\n").map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l).join("\n")`.

## File structure

- `index.html` — `renderLeaderboard` row emitter (index.html:1741-1758), `renderCalcutta` (index.html:2399-2564: the would-text chain ~2516-2536, payout render ~2540-2563, calBasis ~2561).
- `test/smoke.mjs` — X39/X40 after X38 (which ends ~4524).
- Read-only reference: spec §21 + §20 amendment 2 (docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md, bottom).

---

### Task 1: Board Pos/crown + calcutta suppression (SC-RANK-POS / SC-RANK-CAL; X39/X40)

**Files:** Modify `index.html:1741-1758` and `index.html:2440-2563`; Test `test/smoke.mjs` (X39/X40 new, after X38)

**Interfaces:**
- Consumes: `parsSuppressed` (already computed at index.html:1725 inside `renderLeaderboard`); `courseMap()` (frozen, null ⇒ suppressed); `basis` local in `renderCalcutta` (index.html:2436-2441); the existing would-text if/else chain (index.html:2517-2527) whose `withdrawn`/`unsold`/`waiting on cards` arms keep priority.
- Produces: suppressed board rows with `.lb-pos` = `—` and zero `.lead` rows; suppressed gross-basis calcutta with the three pinned strings; unsuppressed and net-basis behavior byte-identical to today.

- [ ] **Step 1: Write X39 + X40 (RED first).** Append after X38's block:

```js
/* X39: SC-RANK-POS — the board makes no place claims when pars are suppressed.
   Complete course: Pos numbers + .lead crown exactly as today (both-direction
   honesty, X37 idiom). Blank par: every Pos cell is em-dash, no .lead row,
   while the rows themselves still render (order is a sort, not a claim). */
{
  const domOK = await makeDom("");                       // ground the actual makeDom signature from X37's block and reuse verbatim
  // (wait for #lbBody .lb-row the way X37 does)
  const okPosFirst = domOK.window.document.querySelector("#lbBody .lb-row .lb-pos");
  const okPos1 = okPosFirst && okPosFirst.textContent.trim() === "1";
  const okLead = !!domOK.window.document.querySelector("#lbBody .lb-row.lead");
  const courseBlank7X39 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l).join("\n");
  const domB = await makeDom(/* X37's course-override mechanism with courseBlank7X39 */);
  const posCellsB = [...domB.window.document.querySelectorAll("#lbBody .lb-pos")].map(e => e.textContent.trim());
  const rowsExistB = posCellsB.length >= 5;              // all fixture teams still render
  const allDashB = rowsExistB && posCellsB.every(t => t === "—");
  const noLeadB = !domB.window.document.querySelector("#lbBody .lb-row.lead");
  check("X39: SC-RANK-POS — complete course: first Pos '1' + a .lead row present; blank-par: all Pos cells '—', zero .lead rows, all teams still listed (no standing claims off the raw-gross fallback)",
    okPos1 && okLead && rowsExistB && allDashB && noLeadB,
    `okPos1=${okPos1} okLead=${okLead} rows=${posCellsB.length} allDash=${allDashB} noLead=${noLeadB}`);
}

/* X40: SC-RANK-CAL — gross-basis calcutta suppresses PLACES and WIN CLAIMS,
   never MONEY. Complete course: today's exact behavior (a paying place and a
   "Wins if it ended now: $N" claim exist). Blank par: no .pay-row, pinned
   empty-state + paused basis line, owned+ranked lots read "awaiting pars",
   and every money tile is byte-identical across the two renders. */
{
  const domOK = await makeDom("");
  const okWould = /Wins if it ended now: \$\d+/.test(domOK.window.document.querySelector("#aucBody").textContent);
  const okPlace = !!domOK.window.document.querySelector("#payBody .pay-row");
  const moneyOK = ["#calPot","#calRake","#calPayable","#calTop"].map(s => domOK.window.document.querySelector(s).textContent);
  const outOK = domOK.window.document.querySelector("#calOut").textContent;
  const domB = await makeDom(/* same course-blank-7 override */);
  const payBodyB = domB.window.document.querySelector("#payBody");
  const noPlacesB = payBodyB && !payBodyB.querySelector(".pay-row") &&
    /Payouts wait on the Course tab — standings need all 18 pars\./.test(payBodyB.textContent);
  const basisB = /Paused · Course pars incomplete/.test(domB.window.document.querySelector("#calBasis").textContent);
  const aucTextB = domB.window.document.querySelector("#aucBody").textContent;
  const awaitingB = /awaiting pars/.test(aucTextB) && !/Wins if it ended now|Won: \$/.test(aucTextB);
  const moneyB = ["#calPot","#calRake","#calPayable","#calTop"].map(s => domB.window.document.querySelector(s).textContent);
  const outB = domB.window.document.querySelector("#calOut").textContent;
  const moneySame = JSON.stringify(moneyOK) === JSON.stringify(moneyB) && outOK === outB;
  check("X40: SC-RANK-CAL — complete course: paying place + 'Wins if it ended now: $N' present; blank-par: zero .pay-row + pinned 'Payouts wait on the Course tab' empty-state + 'Paused · Course pars incomplete' basis + owned lots 'awaiting pars' (no win claims) + pot/rake/payable/top/outstanding byte-identical across both renders",
    okWould && okPlace && noPlacesB && basisB && awaitingB && moneySame,
    `okWould=${okWould} okPlace=${okPlace} noPlaces=${noPlacesB} basis=${basisB} awaiting=${awaitingB} moneySame=${moneySame}`);
}
```

  The two `/* ground from X37 */` slots are the delegated grounding: reuse X37's exact `makeDom` + course-override + wait mechanism (test/smoke.mjs:4401-4470) verbatim — do not invent a new one. If the calcutta fixture's `wouldText` includes `withdrawn`/`unsold` lots in the default fixture, keep the `awaitingB` regex as-is (it only forbids money-claims and requires at least one `awaiting pars`; the priority branches are additionally covered below in Step 3's implementation note).

- [ ] **Step 2: Run to verify RED.** Run: `node test/smoke.mjs 2>&1 | grep -E "X39|X40|TALLY TOTAL"`
  Expected: X39 FAIL (Pos numbers + lead render under suppression today), X40 FAIL (places + win claims render), 207/209.

- [ ] **Step 3: Implement.**

  In `renderLeaderboard`'s row emitter (index.html:1741-1758) — `parsSuppressed` is in scope from line 1725:

```js
    const pos=p.pos;
    const lead=(!parsSuppressed && pos===1)?" lead":"";
    ...
        <span class="lb-pos">${parsSuppressed ? "—" : (pos??"—")}</span>
```

  In `renderCalcutta` — add one suppression const right after `basis` is resolved (index.html:~2441) and branch the three surfaces (SC-RANK-CAL, gross basis only):

```js
  const rankSuppressed = basis==="gross" && !courseMap();   // §21 SC-RANK-CAL: net standings don't rest on pars
```

  - Would-text chain (index.html:2517-2527): the final two arms (the `rowsOut` money claim and the `"—"` out-of-money arm) become `wouldText = rankSuppressed ? "awaiting pars" : (ro ? (done?"Won":"Wins if it ended now")+": "+money(ro.ownerCut) : "—");` — the `withdrawn`/`unsold`/`waiting on cards` arms above it are untouched and keep priority.
  - Payout table: before the `$("#payBody").innerHTML=rowsOut.map(...)` render (index.html:~2553), insert the suppressed branch:

```js
  if(rankSuppressed){
    $("#payBody").innerHTML='<div class="mn-empty">Payouts wait on the Course tab — standings need all 18 pars.</div>';
    $("#calBasis").textContent="Paused · Course pars incomplete";
    return;
  }
```

    Place it AFTER the `#aucBody` render (so the auction board with `awaiting pars` still paints) and after the existing `!ranked.length` / `!rowsOut.length` early-outs OR before them — ground the actual order so that: auction board always renders, money tiles always render, and the suppressed branch wins over the `"No eligible teams"` and normal paths. State the chosen insertion point and why in your report.
  - Everything else in `renderCalcutta` — `calcuttaModel` consumption, tiles, outstanding, `rowsOut` computation itself — untouched (computing `rowsOut` and not rendering it is fine; do NOT skip its computation, the would-text chain no longer needs it when suppressed but the unsuppressed path does).

- [ ] **Step 4: Run to verify GREEN.** `node test/smoke.mjs 2>&1 | tail -3` — expect exactly **209/209**, zero FAIL; A2–A6, G1–G5, V1–V9, X34, X37, X38 all still green.

- [ ] **Step 5: Mutation evidence (throwaway /tmp copy only).** Mutation A: restore `const lead=(pos===1)?" lead":""` + plain `${pos??"—"}` → X39 alone FAILS. Mutation B (fresh copy): force `rankSuppressed=false` → X40 alone FAILS. Discard copies; `git status --short` clean in the build worktree throughout.

- [ ] **Step 6: Frozen-surface check.** `git diff` touches only the two named regions of index.html + test/smoke.mjs; diff every frozen function against base — byte-identical.

- [ ] **Step 7: Commit** `fix(rank): board Pos/crown + calcutta places/win-claims suppressed without pars (§21 SC-RANK-POS/SC-RANK-CAL; X39/X40)`

### Task 2: Verification close — battery + render pass (report-first)

**Files:** none expected (report-first).

- [ ] **Step 1: Battery.** Clean tree at Task 1's commit; `node test/smoke.mjs` → record verbatim (expect 209/209).
- [ ] **Step 2: Renders.** Network-sealed CDP harness in /tmp (binary + technique per the D3 wave's task-2-report.md at .superpowers/sdd/2026-07-31-gfy-d3-par-validation/); blank-par-7 fixture vs complete control; capture at 390×844 AND 900×900: (a) suppressed board — every Pos "—", no brass crown row, Total-labeled column, order visibly by gross; (b) control board — Pos 1..N + crown; (c) suppressed #calcutta — money tiles populated, auction board with "awaiting pars" on owned lots, payout panel showing the pinned empty-state, basis line "Paused · Course pars incomplete"; (d) control #calcutta — places + "Wins if it ended now: $N". LOOK at every PNG cold (S11): claims true? copy legible/verbatim? anything a captain or lot-owner would distrust? PNGs to .superpowers/sdd/2026-07-31-gfy-suppression-rank/s11/.
- [ ] **Step 3: Report** to task-2-report.md; verification-only close if clean (no commit).

---

## Plan self-review
- Spec coverage: SC-RANK-POS → Task 1 (emitter change + X39); SC-RANK-CAL gross-only signal → Task 1 Step 3 (`rankSuppressed`), pinned copy strings → Step 3 + X40 regexes (byte-matched incl. em-dashes); money invariance → X40 moneySame; withdrawn/unsold/waiting priority → untouched arms + Step 1 note; net-basis never suppressed → the `basis==="gross" &&` guard (no automated net test — the scramble fixture forces gross basis via rosterMap; stated honestly rather than fabricating a net fixture); frozen list → Global Constraints + Step 6; both-direction tests → X39/X40 mirror the X37 idiom; suite 207→209 → pinned.
- Placeholder scan: the two `makeDom` grounding slots are explicit delegated-grounding pointers to X37's exact block (file:line given), not TBDs; the payout-branch insertion point is a grounded decision the implementer must state — pinned with the three invariants it must satisfy.
- Type consistency: `parsSuppressed` (existing, index.html:1725) reused in the emitter; `rankSuppressed` new local in `renderCalcutta` only; check names X39/X40 match the tally regex; all selectors (`.lb-pos`, `.lb-row.lead`, `#payBody .pay-row`, `#aucBody`, `#calBasis`, money tile ids) verified present in the grounding fact sheet.
