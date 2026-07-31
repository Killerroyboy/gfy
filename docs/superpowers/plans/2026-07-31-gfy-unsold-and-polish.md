# GFY §22 Unsold-Lot Integrity + Suppression Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unsold placing lot's share verifiably stays in the pot (no phantom owner cut, disclosure fires), the suppression story's copy names everything it suppresses, and the coverage gaps the §21 reviews earmarked close — per spec §22.

**Architecture:** Three small tasks. Task 1 (C-UNSOLD): `renderCalcutta`'s `covered` filter narrows to lots with a real owner; the disclosure-note condition widens; X41. Task 2 (polish + coverage): the health-flag string re-pins (SC-PAR-FLAG-2, X33 assert updated in place), the combined no-cards+no-pars `#calBasis` string (SC-PAR-CORNER), one README basis sentence, `renderHolePanel`'s per-hole par fallback (HP-PAR), X42 net-basis-live + X43 arm-priority + X39 parity strengthen. Task 3: verification close (battery + renders incl. the unsold-placing fixture and the new chip copy).

**Tech Stack:** index.html, README.md, jsdom smoke suite (baseline 209/209), chrome-headless-shell CDP renders.

## Global Constraints (spec §22 — every task inherits)

- Worktree isolation off `v2.1-invites` (controller creates `.worktrees/unsold-polish`, branch `unsold-polish`). Commit there; NEVER push.
- **Unfrozen surfaces, exactly:** `renderCalcutta` (the `covered` filter, disclosure-note condition, and the SC-PAR-CORNER calBasis arm only), `renderHolePanel` (the par read only), `courseMap` (the flag STRING only — zero logic change), README.md (basis sentence + any flag-copy quote updates), test/smoke.mjs. FROZEN: everything else §21 froze, including `rankedPlayers`, `calcuttaModel`, `buildPlayers`, `courseYards`, `scHolePar`, `scHoleYards`, `scTallyHTML`, `renderLeaderboard`, `renderScoreGrid`, `scGlanceHTML`, and the v2.6 engine. STOP → BLOCKED if a frozen function seems needed.
- Pinned strings verbatim: flag `Course tab: hole <N> par missing or invalid — To-par and standings suppressed (strokes only)` · corner calBasis `Bids locked. Payouts post once cards and Course pars are in.` · the existing §21 strings are untouched.
- Suite arc pinned: 209 → **210** (Task 1, X41) → **212** (Task 2, X42/X43; X33/X39 edited in place, no count change). Zero FAIL always; RED before GREEN; fixture-computed values; mutation evidence ONLY in throwaway /tmp copies (ratified rule). Reviewers mutation-check tests.
- Mutation bar (spec): covered-filter revert → X41 alone; net-guard revert → X42 alone; suppressed-arm hoist → X43 alone.

## File structure

- `index.html` — `renderCalcutta` (~2497-2505 covered/ownerCut; ~2583 note condition; ~2545-2560 corner arm), `renderHolePanel` (~1867 par read), `courseMap` (~1523 flag string).
- `README.md` — calcutta basis sentence; flag-copy quotes if any exist.
- `test/smoke.mjs` — X41 (after X40), X42/X43 (after X41); X33 copy-regex + X39 parity edits in place.

---

### Task 1: C-UNSOLD — unsold placing lot stays in the pot (X41)

**Files:** Modify `index.html` (`renderCalcutta` only); Test `test/smoke.mjs` (X41 new, after X40)

**Interfaces:**
- Consumes: `rowsOut` rows (`{place,tied,key,name,detail,owner,each,lot}` — `lot` is the `lots.find` result; an UNSOLD lot exists with `owner==="—"`), the `covered`/largest-remainder block (index.html:~2497-2505), the disclosure-note condition `rowsOut.some(r=>!r.lot)` (~2583), the pay-row cut render `r.ownerCut?money(r.ownerCut):"—"`.
- Produces: `covered` = rows whose lot exists AND has a real owner (`r.lot && r.lot.owner!=="—"`); unsold rows get `ownerCut=0` (the existing `if(!r.lot) r.ownerCut=0` line generalizes to `if(!r.lot || r.lot.owner==="—")`); the note fires when `rowsOut.some(r=>!r.lot || (r.lot&&r.lot.owner==="—"))`.

- [ ] **Step 1 (RED): X41.** Build the fixture in-test: clone `FIXTURES.calcutta` and blank the OWNER cell of a lot belonging to a team that PLACES under the default (complete-par) fixture — ground which teams place from G4's fixture expectations (1st*/1st*/3rd) and pick one of them; keep every other lot untouched. Assertions: (a) that team's pay-row renders cut `—` (no dollars); (b) the auction board's arm for that lot reads `unsold`; (c) the disclosure note `unsold lots' shares stay in the pot` appears in `#calBasis`; (d) the SOLD placing lots' cuts equal their values from an unmodified-fixture dom rendered in the same test (compute both doms, compare — the sold lots' math must not shift when the unsold lot leaves the covered set... unless the unmodified fixture's cuts included the unsold lot's share, in which case assert the NEW cuts equal the largest-remainder allocation over the narrowed covered set, computed in-test from `payable` and the shares — mirror the code's own floors+remainder algorithm); (e) `#calPot`/`#calPayable` unchanged between the two doms (pot math never keyed on owners). Expect X41 FAIL today on (a)/(c)/(d)-shape (a cut IS booked to the unsold lot).
- [ ] **Step 2: Implement** the three-line change per Interfaces (filter, generalized zeroing, widened note condition). Nothing else in the function.
- [ ] **Step 3: GREEN** — 210/210; G1–G5/V1–V9/X40 untouched-green. **Step 4: Mutation** (throwaway copy): revert the covered filter → X41 alone fails. **Step 5: Commit** `fix(calcutta): unsold placing lot stays in the pot — excluded from covered math, disclosure fires (§22 C-UNSOLD; X41)`

### Task 2: Suppression polish + coverage (SC-PAR-FLAG-2, SC-PAR-CORNER, README-BASIS, HP-PAR; X42/X43, X33/X39 edits)

**Files:** Modify `index.html` (courseMap flag string; renderCalcutta corner arm; renderHolePanel par read), `README.md`; Test `test/smoke.mjs`

**Interfaces:**
- Consumes: the §20 flag site (index.html:~1523), the `!ranked.length` branch's `$("#calBasis")` write (~2545-ish: `Bids locked. Payouts post once cards do.`), `renderHolePanel`'s `Par ${pars[h]}` (~1867), `scHolePar(h)` (frozen, per-hole fallback), the §21 `rankSuppressed` local.
- Produces: flag string per SC-PAR-FLAG-2; in the `!ranked.length` branch, when `basis==="gross" && !courseMap()` also holds, calBasis reads the pinned corner string (single states keep existing copy); hole-panel head uses `const hp=scHolePar(h)` → `Par ${hp??"—"}`; README gains one basis sentence (calcutta_basis Info key, scramble forces gross) in the calcutta section.

- [ ] **Step 1 (RED where applicable):** X42 — roster-less + `calcutta_basis=net` fixture override (ground the override mechanism: Field/roster fixture emptied the way rosterMap() reads it + Info row added; the §21 task-2 report documents a synthetic-fixture technique if needed) + blank-par-7 course: assert the calcutta payout table renders places (`.pay-row` present) and a `Wins if it ended now: $` claim — net stays LIVE under suppression. X43 — gross + blank-par + a calcutta fixture carrying a wd team's lot, an unsold lot, and a cardless team's lot: assert each arm's text (`withdrawn`/`unsold`/`waiting on cards`) wins over `awaiting pars` for its lot while a normal owned lot reads `awaiting pars`. X33 edit in place: copy-regex updated to the SC-PAR-FLAG-2 string (byte-exact). X39 edit in place: row-count parity with the control dom (replace `>=5`). Run: X42/X43 RED (X42 for the right reason — verify the current code path truly keeps net live and the RED comes from fixture wiring not from suppression; if X42 is GREEN-on-write because the behavior already holds, say so honestly and keep it — it is a pin, not a bug-proof), X33 RED (old string), 210 baseline otherwise.
- [ ] **Step 2: Implement** the flag string, corner arm, HP-PAR swap, README sentence. **Step 3: GREEN** — 212/212. **Step 4: Mutations** (throwaway copies): net-guard revert (`basis==="gross" &&` dropped) → X42 alone; suppressed-arm hoist above `waiting on cards` → X43 alone. **Step 5: Commit** `fix(polish): flag names standings, corner copy, hole-panel par fallback, README basis + net/arm-priority/parity coverage (§22; X42/X43, X33/X39 edits)`

### Task 3: Verification close — battery + renders (report-first)

**Files:** none expected.

- [ ] **Step 1: Battery** — clean tree, `node test/smoke.mjs` verbatim (expect 212/212).
- [ ] **Step 2: Renders** (network-sealed CDP harness in /tmp; technique per prior wave reports): (a) unsold-placing calcutta (complete pars) — pay-row cut "—", note fires, sold cuts intact; (b) suppressed states re-render — expanded health chip shows the NEW flag copy verbatim; (c) hole panel on a complete course — visual parity (Par N unchanged); (d) control calcutta. 390×844 + 900×900 where layout matters. LOOK at every PNG cold (S11). PNGs to the plan workspace s11/.
- [ ] **Step 3: Report**; verification-only close if clean.

---

## Plan self-review
- Spec coverage: C-UNSOLD → T1 (filter/zeroing/note + X41's five assertions incl. re-derived largest-remainder); SC-PAR-FLAG-2 → T2 (string + X33 edit); SC-PAR-CORNER → T2 (corner arm, single states preserved); README-BASIS → T2; HP-PAR → T2 (scHolePar idiom, "—" fallback); X42/X43/X39-parity → T2; suite arc 209→210→212 → pinned; mutation bar → T1 Step 4 + T2 Step 4; renders → T3.
- Placeholder scan: X41's fixture choice and X42's override mechanism are delegated-grounding steps with pointers (G4 expectations; §21 task-2 synthetic technique); the honest GREEN-on-write escape for X42 is explicit, not a fudge.
- Type consistency: `covered`/`rowsOut`/`r.lot.owner` shapes match the §21 fact sheet; `scHolePar(h)` frozen signature; check names X41–X43 fit the tally regex; pinned strings appear once each here and once in the spec.
