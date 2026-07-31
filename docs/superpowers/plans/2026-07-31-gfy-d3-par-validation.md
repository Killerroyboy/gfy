# GFY D3 Par-Integrity Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A blank/invalid par cell on the Course tab triggers the same honest degrades as a missing row (strokes-only tally, gross-total leaderboard, hidden grid) plus a health-strip warning naming the hole — instead of silently skewing every to-par figure on the site.

**Architecture:** Single-point fix. `courseMap()`/`courseYards()` (index.html:1486-1498) validate VALUES, not keys — a hole's key exists only when its cell parses to a positive integer, so the shipped all-18-or-null contract turns a blank cell into `null`, and every existing null-degrade path fires unchanged. `courseMap()` additionally raises one `flag()` per par-less hole (existing HEALTH idiom). No consumer changes: `scTallyHTML`, `buildPlayers`, `renderLeaderboard`, `renderScoreGrid`, `scHolePar`, `scoreClass` stay byte-identical.

**Tech Stack:** index.html (single-file site), jsdom smoke suite (test/smoke.mjs, baseline 201/201), chrome-headless-shell CDP renders for the verification close.

## Global Constraints (spec §20 + carried wave rules — every task inherits)

- Worktree isolation off `v2.1-invites` (controller creates `.worktrees/d3-par`, branch `d3-par-validation`, base = current tip). Commit there; NEVER push.
- **Single-point mandate:** the ONLY index.html functions whose bodies change are `courseMap()` and `courseYards()`. Byte-frozen (verify by diff before committing): `scSend/scPing/scDrain/scJournalSave/scStore/scEntryHeld/scSheetHoles(For)/applyScore_/doPost` (the v2.6 engine) AND `scHolePar/scHoleYards/posInt/scoreClass/scTallyHTML/buildPlayers/renderLeaderboard/renderScoreGrid/renderHolePanel/rankedPlayers`. If the fix seems to need a consumer change, STOP and report BLOCKED.
- SC-PAR-VALID (spec §20, verbatim contract): key created only when the cell parses to a positive integer; all-18-or-null contract unchanged; blank/invalid cell ⇒ same degrades as missing row.
- SC-PAR-WARN copy pinned verbatim: `Course tab: hole <N> par missing or invalid — To-par suppressed (strokes only)` — one flag per hole 1–18 lacking a valid par after the build pass, via the existing `flag()` (index.html:1383, dedupes via `HEALTH.includes`); par only — yards validation stays silent.
- Test discipline: new checks are X33/X34/X35 appended after X32 (tally regex `/^([A-Z])\d+:/` needs only the `X<digits>:` name prefix — no renumbering, no registry). Suite 201 → exactly **204**, zero FAIL. Test values computed from the REAL fixtures in-test (compute, never assume). RED before GREEN. Reviewers on this project mutation-check tests.
- Mutation evidence: ONLY in throwaway /tmp copies (`cp -R`, mutate + test, discard) — NEVER git-revert or mutate the build worktree (ratified rule).
- X9/X10/X29 must remain green untouched (X9/X10 cover the missing-ROW degrade with the row-deletion splice at test/smoke.mjs:2435; X29 uses the complete fixture and stays `topar`).

## File structure

- `index.html` — `courseMap()` + `courseYards()` bodies (index.html:1486-1498) only, plus the `flag()` calls inside `courseMap()`.
- `test/smoke.mjs` — X33/X34/X35 appended after X32.
- Reference (read-only): `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` §20 + §18 rev 2 SC-PAR (lines 469-472).

---

### Task 1: Value-validated course maps + par warning (SC-PAR-VALID / SC-PAR-WARN; X33–X35)

**Files:** Modify `index.html:1486-1498`; Test `test/smoke.mjs` (X33/X34/X35 new, after X32)

**Interfaces:**
- Consumes: `STATE.data.course` rows (`{hole,par,yards}` strings), `flag(m)` (index.html:1383), the blank-par splice technique below.
- Produces: `courseMap()`/`courseYards()` with unchanged signatures and unchanged map-or-null contract; new behavior only for invalid values. Later tasks and all existing consumers rely on: blank-par fixture ⇒ `courseMap()===null` ⇒ `#scTally[data-mode="strokes"]`, `p.rel===null` on the board, grid note visible, `#healthStrip` carrying the pinned copy for the hole.

**The blank-par fixture splice** (compute from the real fixture; hole 7 is the blanked hole to mirror the D3 report):

```js
// course fixture with hole 7's par cell BLANK (row present: "7,,<yards>")
const courseBlank7 = FIXTURES.course.split("\n")
  .map(l => l.startsWith("7,") ? ("7," + "" + l.split(",").slice(2).map(v=>","+v).join("").slice(1) && "7,," + l.split(",")[2]) : l)
  .join("\n");
// simpler, equivalent, use this form:
const courseBlank7b = FIXTURES.course.split("\n")
  .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
  .join("\n");
```
Use the `courseBlank7b` form (`"7,," + yards`): row present, par blank, yards intact. Derive hole 7's true par in-test from the untouched fixture line (`parseInt(FIXTURES.course.split("\n").find(l=>l.startsWith("7,")).split(",")[1],10)`) — needed to compute expected values.

- [ ] **Step 1: Write X33/X34/X35 (RED first).** Append after X32, before the tally-summary block:

```js
/* X33: SC-PAR-VALID scorer degrade — a BLANK par cell (row present) suppresses
   to-par exactly like a missing row, warns by hole, and leaves the other 17
   holes' labels alive (scHolePar row-fallback). */
{
  const dom = makeDom({ course: courseBlank7b });           // same helper/override X9 uses (test/smoke.mjs:2435 idiom)
  // confirm a team + render the card the way X29's block does (reuse its setup verbatim)
  // ...confirmed Duck card rendered...
  const tally = dom.window.document.querySelector("#scTally");
  const modeStrokes = tally && tally.getAttribute("data-mode") === "strokes";
  const cell7 = dom.window.document.querySelector('.sc-cell[data-hole="7"] .sc-hole-par');
  const cell8 = dom.window.document.querySelector('.sc-cell[data-hole="8"] .sc-hole-par');
  const cell7Dash = cell7 && /Par —/.test(cell7.textContent);
  const cell8Real = cell8 && /Par \d/.test(cell8.textContent);
  const strip = dom.window.document.querySelector("#healthStrip");
  const warned = strip && !strip.hidden &&
    /Course tab: hole 7 par missing or invalid — To-par suppressed \(strokes only\)/.test(strip.textContent);
  check("X33: SC-PAR-VALID — blank par cell (hole 7 row present, par empty) => tally data-mode=strokes (not topar w/ silent 0), hole-7 cell 'Par —', hole-8 still labeled, healthStrip names hole 7 with the pinned copy",
    modeStrokes && cell7Dash && cell8Real && warned,
    `mode=${tally&&tally.getAttribute("data-mode")} cell7=${cell7&&cell7.textContent} cell8=${cell8&&cell8.textContent} warned=${warned}`);
}

/* X34: SC-PAR-VALID board suppression, BOTH directions — complete fixture shows
   to-par; blank-par fixture shows gross totals (rel=null), never a skewed to-par. */
{
  const domOK = makeDom({});                                 // standard fixtures
  const totOK = domOK.window.document.querySelector("#lbBody .lb-row .lb-tot");
  const toParForm = totOK && /^[+−\-]?\d+$|^E$/.test(totOK.textContent.trim()) && /^[+−\-E]/.test(totOK.textContent.trim());
  const domB = makeDom({ course: courseBlank7b });
  const totB = domB.window.document.querySelector("#lbBody .lb-row .lb-tot");
  // expected: plain gross total (digits only), equal to the leader's computed gross from the scores fixture
  const grossOnly = totB && /^\d+$/.test(totB.textContent.trim());
  // compute the leader's expected gross IN-TEST from FIXTURES.scores (sum that team's round strokes) — never hardcode
  const expectedGross = /* computed from FIXTURES.scores for the top #lbBody row's team */ 0;
  const grossMatches = totB && parseInt(totB.textContent.trim(),10) === expectedGross;
  check("X34: SC-PAR-VALID — leaderboard To-par column: complete course => to-par form (+N/−N/E); blank-par-7 course => plain gross total equal to the leader's fixture-computed strokes (rel suppressed, ranking unskewed)",
    toParForm && grossOnly && grossMatches,
    `ok=${totOK&&totOK.textContent} blank=${totB&&totB.textContent} expected=${expectedGross}`);
}

/* X35: SC-PAR-VALID grid degrade — blank par hides the hole-by-hole grid behind
   the existing honest note (no 'Par 0' artifact can render). */
{
  const dom = makeDom({ course: courseBlank7b });
  // navigate to the grid view the way X-group grid checks do; then:
  const note = /* the renderScoreGrid note element */ dom.window.document.querySelector("#sgNote") || null;
  const noteShown = note && !note.hidden && /needs all 18 holes/i.test(note.textContent);
  check("X35: SC-PAR-VALID — blank par cell hides the score grid behind the 'needs all 18 holes' note (same degrade as a missing row; no Par-0 header row can render)",
    !!noteShown, `note=${note&&note.textContent} hidden=${note&&note.hidden}`);
}
```

  The X34 `expectedGross` comment and the X35 note selector are the two places the implementer must ground against the actual code: (a) compute the leader's gross by summing that team's strokes from `FIXTURES.scores` exactly the way `buildPlayers` does for the fixture's round types (hole-by-hole rows sum holes; totals-only rows use the total — read `buildPlayers` index.html:1504-1560 and mirror it in-test); (b) `renderScoreGrid`'s note element id/class is at index.html:1735-1738 — use its real selector, and drive the same render path the existing grid checks use (grep `renderScoreGrid` in test/smoke.mjs for the established setup). X33's card setup reuses X29's confirmed-team setup verbatim (test/smoke.mjs:3822 onward). If `makeDom` takes fixture overrides differently than `{course: ...}`, mirror X9's exact override mechanism (test/smoke.mjs:2435-2456).

- [ ] **Step 2: Run to verify RED.** Run: `node test/smoke.mjs 2>&1 | grep -E "X3[345]|TALLY TOTAL"`
  Expected: X33 FAIL (`mode=topar`, `warned=false` — today's silent-skew behavior), X34 FAIL (blank branch renders a skewed to-par form, not a gross total), X35 FAIL (grid renders; note hidden). Everything else green: 201/204.

- [ ] **Step 3: Implement.** Replace the two builders (index.html:1486-1498) with value-validated forms + the warning pass:

```js
/* ---------- course ---------- */
/* SC-PAR-VALID (§20): keys only for VALID values — a blank/invalid cell must not
   create a 0-par key that poisons to-par sums while the map still reads non-null.
   All-18-or-null contract unchanged; consumers untouched. */
function courseMap(){
  const rows=STATE.data.course||[];
  const pars={};
  rows.forEach(r=>{ const h=parseInt(r.hole,10); const p=parseInt(r.par,10); if(h>=1&&h<=18&&p>0) pars[h]=p; });
  for(let h=1;h<=18;h++) if(!pars[h]) flag(`Course tab: hole ${h} par missing or invalid — To-par suppressed (strokes only)`);
  return Object.keys(pars).length===18 ? pars : null;
}

function courseYards(){
  const rows=STATE.data.course||[];
  const yds={};
  rows.forEach(r=>{ const h=parseInt(r.hole,10); const y=parseInt(r.yards,10); if(h>=1&&h<=18&&y>0) yds[h]=y; });
  return Object.keys(yds).length===18 ? yds : null;
}
```

  One caveat to handle honestly: the warning loop fires on EVERY `courseMap()` call, including before the Course tab has loaded at all (`STATE.data.course` empty ⇒ 18 flags). Check what the pre-existing behavior is on first paint before data arrives: if `courseMap()` can run with `STATE.data.course` empty/undefined during normal startup, guard the warning pass with `if(rows.length)` so an empty tab (not yet loaded / legitimately absent) doesn't spray 18 warnings — a truly empty Course tab already degrades via null today and stays silent. Rows present but holes invalid/missing ⇒ warn per hole. State in the report which guard you shipped and why.
  Also trace the untraced `courseMap()` call at index.html:~2675 (inside whatever function owns it — likely the shame/awards section): confirm it is falsy-safe when the map is null (it must be already, since null was always possible via missing rows); name the function and its guard in your report. Do not modify it (single-point mandate) — if it is NOT null-safe, STOP and report BLOCKED with the evidence.

- [ ] **Step 4: Run to verify GREEN.** Run: `node test/smoke.mjs 2>&1 | tail -3`
  Expected: `TALLY TOTAL 204/204`, zero FAIL. X9/X10/X29 all still green (row-deletion still nulls; complete fixture still topar).

- [ ] **Step 5: Mutation evidence (throwaway copy only).** `cp -R` the worktree to /tmp; revert the validation in the COPY (`p>0` back to the old `parseInt(r.par,10)||0` keyed form); run: expect X33 AND X34 FAIL (X35 may also fail), nothing else; `rm -rf` the copy; confirm the build worktree untouched (`git status --short` empty).

- [ ] **Step 6: Verify the single-point mandate.** `git diff` must touch only the two builder bodies + the flag pass in index.html plus test/smoke.mjs. Diff every frozen function named in Global Constraints against the base — byte-identical.

- [ ] **Step 7: Commit** `fix(course): SC-PAR-VALID value-validated courseMap/courseYards + SC-PAR-WARN hole-naming flag (§20 D3; X33-X35)`

### Task 2: Verification close — battery + render pass (report-first)

**Files:** none expected (report-first; commit only if a defect found in YOUR OWN Task-1 surface requires a fix, and then only with a re-run suite).

**Interfaces:**
- Consumes: Task 1's landed behavior (blank-par ⇒ strokes/totals/note/warning).

- [ ] **Step 1: Battery.** Clean tree at Task 1's commit; `node test/smoke.mjs` → record the verbatim tally (expect 204/204).
- [ ] **Step 2: Renders.** Network-sealed CDP harness in /tmp (binary: `/Users/riley/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`; technique per `.superpowers/sdd/2026-07-30-gfy-scorer-rev3-ui/task-3-report.md` fix-round section and `task-5-report.md` — `--host-resolver-rules` + Fetch interception + fixture CSVs; hole 7 par blanked in the served course fixture). Capture at 390×844: (a) scorer card confirmed w/ scores — tally strip shows the `Thru` tile (strokes mode), hole-7 cell "Par —", health chip visible; (b) health chip EXPANDED showing the pinned hole-7 copy; (c) `#board` leaderboard — To-par column showing plain totals; (d) CONTROL: same states with the complete fixture — to-par tile and board to-par forms present, NO health chip. LOOK at every PNG; save to the plan workspace `s11/` with self-describing names.
- [ ] **Step 3: Report** observations per PNG (cold-viewer standard); any defect with severity; verification-only close if clean (no commit).

---

## Plan self-review
- Spec coverage: SC-PAR-VALID → Task 1 Steps 1–4 (both builders, contract unchanged, consumers untouched); SC-PAR-WARN → Task 1 Step 3 (pinned copy, per-hole, flag() idiom, empty-tab guard decision) + X33's warned assert; §20 test pins X33/X34/X35 + 201→204 → Task 1; mutation bar → Step 5; degrade-parity with missing-row → X33/X35 + X9/X10 staying green; board suppression + ranking → X34 (rel=null path) with fixture-computed gross.
- Placeholder scan: X34's `expectedGross` and X35's note selector are explicitly delegated grounding steps with exact file:line pointers (not silent TBDs); the first X33 splice snippet shows a rejected-then-corrected form — the plan pins `courseBlank7b` as the one to use.
- Type consistency: `courseMap()/courseYards()` signatures unchanged; `flag(m)` exists at index.html:1383; check-name prefixes X33/X34/X35 match the tally regex; `#scTally[data-mode]`, `.lb-tot`, `#healthStrip` all verified present in the fact-sheet grounding (index.html:4026, 1709, 2845-2856).
- Known risk carried deliberately: the empty-course-tab warning guard is a judgment point — the plan pins the decision rule (empty rows ⇒ silent, matching today's silent null) and requires the implementer to verify startup call order and report the shipped guard.
