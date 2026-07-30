# GFY v2.6 Captain Live Scorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the card-first, endpoint-confirmed captain scoring view (`#score?team=…`) per spec §18 rev 2, with the Google Form lane untouched as fallback.

**Architecture:** All client code lives in `index.html` (single-file site) as one contiguous SCORER section: a season-pinned data layer reusing `buildPlayers()`/`courseMap()`, a localStorage journal + send-queue state machine, a transport module POSTing JSON (text/plain) to an Apps Script `doPost` whose URL comes from Info key `score_endpoint`, and a card-first view exempt from `renderAll()` repaints. Server side: `tools/sheet-triggers.gs` gains a shared `applyScore_` validator used by BOTH the existing form trigger and the new `doPost`/`doGet`, plus idempotency and a round-totals guard.

**Tech Stack:** Vanilla JS in index.html; jsdom smoke suite (`npm test`, group X); Google Apps Script (.gs, review-gated — no unit harness); chrome-headless-shell for S11 renders.

## Global Constraints (spec §18 rev 2 — every task inherits)

- Work in an isolated worktree off `v2.1-invites` (controller sets it up; commit there, NEVER push).
- Suite baseline 159/159; every task ends green with its new X checks added. Group letter is **X** (`X<n>: …` — tally regex `^([A-Z])\d+:`).
- SC-YEAR: the scorer's season = Info `first_tee` year — NEVER `STATE.year`, never max-year-in-Scores. `rosterMap()` (index.html:1053) and `buildPlayers()` (index.html:1107) currently filter by `STATE.year`; the scorer uses the season-parameterized forms Task 1/6 introduce.
- SC-DERIVE: hole maps ONLY via `buildPlayers(seasonY)`; pars ONLY via `courseMap()` + the per-hole raw fallback defined in Task 3. No second CSV parse, no second par table.
- SC-NOCLOBBER: nothing ever auto-sends into a hole whose sheet value differs from this phone's — conflict state + explicit two-number confirm only.
- Offline-first (Riley ruling): a score tap ALWAYS succeeds instantly into the journal; network is the queue's problem.
- Palette/type: existing tokens only; scorer view text ≥13px; over/under never color-only (pair with the existing `▲/–` style glyphs as specced in Task 3 markup).
- The Google Form lane and its trigger behavior stay byte-compatible (Task 2 refactors `onScoreFormSubmit` to call `applyScore_` with identical semantics — proven by the existing form-lane behavior notes in the task).
- Endpoint transport contract (SC-WRITE): request = POST, `Content-Type: text/plain;charset=utf-8`, body `JSON.stringify({team, round, hole, score, client_id, seq})`; response = JSON `{ok:boolean, verdict:string, team:string, round:number, holes:Object|null}`. Anything unparseable/mis-shaped = SC-LOUD-CONFIG state, never a guess.
- SPIKE GATE note: the live CORS spike + draft-night drill are RILEY-GATED live steps (documented in Task 8's README rewrite). Build proceeds against stubbed transport; the transport module is isolated (Task 4) so a spike failure strands the minimum.
- FIXTURE REALITY (corrected after Task-1 NEEDS_CONTEXT; binding): 2026 fixture teams are `Duck, Sully, Moose, Tex, Bear` (captains are same-named Field rows). Duck has COMPLETE r1 and r2 Scores rows natively (the r2 row's team cell is lowercase `duck` - free S-KEY exercise; r2 h1..h6 = 4,4,3,5,3,4). Sully r1 is split across two merge rows. Any test needing an EMPTY hole for Duck must drop the `duck,2` row via a scores `withOverride` - never edit base fixtures.
- Screenshot binary: `/Users/riley/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`.

## File structure

- `index.html` — router fix (~:858), SCORER section (new, one `<section class="view" data-view="score">` + one `<script>` block after the existing view scripts), `buildPlayers`/`rosterMap` season params, `renderAll()` exemption, SC-PUBBTN removal (~:524, ~:2598).
- `tools/sheet-triggers.gs` — `applyScore_` extraction, `doPost`, `doGet`, idempotency ring, totals guard, START HERE captain-links/dropdown-list blocks (polish surface).
- `tools/spike-scorer-cors.md` — the Riley-run 20-minute spike kit (created Task 2).
- `config.js` — `SHEET_EDIT_URL` value removal (Task 7).
- `fixtures/info.csv` — unchanged on disk; endpoint present only via `withOverride` variants.
- `test/smoke.mjs` — group X appended after group Y, before the tally.
- `README.md` — "Live scoring" section rewritten rev 2 (Task 8).

---

### Task 1: Router hash-query fix + #score shell + team resolution (SC-LINK, SC-YEAR)

**Files:**
- Modify: `index.html` (showView ~:858; add view section + scorer script skeleton; add `scorerSeason`/`scorerTeams` helpers near `activeSeason` ~:1033)
- Test: `test/smoke.mjs` (X1–X6)

**Interfaces:**
- Produces: `scorerSeason()` → string year from Info `first_tee` (fallback: `activeSeason()` only when first_tee absent/unparseable, flagged); `scorerTeams(seasonY)` → array of distinct trimmed Field `team` values for that year (S-KEY deduped, original casing of first occurrence); `scorerTeamFromHash()` → decoded, nkey-matched team or null; the `#score` section with ids `#scHeader`, `#scPicker`, `#scConfirm`, `#scCard` (empty shells Task 3 fills); localStorage key helper `scKey(seasonY, teamKey)` → `"gfy-scorer:"+seasonY+":"+teamKey`.
- Consumes: `nkey` (index.html:1022), `forYear` (:1085), `activeSeason` (:1033).

- [ ] **Step 1: Write failing tests X1–X6** (after group Y block, before the tally section; reuse `makeDom`, `withOverride`, `until`, `FIXTURES`; every check name starts `X<n>:`):

```js
/* ---------------------------------------------------------------------
   Group X: v2.6 captain live scorer (spec §18 rev 2).
   X1-X6: routing + team resolution (SC-LINK, SC-YEAR).
   --------------------------------------------------------------------- */
{
  // X1: hash query must not break routing (pressure-test Critical)
  const domX1 = makeDom("#score?team=" + encodeURIComponent("Duck"));
  await until(() => !domX1.window.document.querySelector("[data-view=score]")?.hidden);
  const scoreVisX1 = !domX1.window.document.querySelector("[data-view=score]")?.hidden;
  const homeHidX1 = domX1.window.document.querySelector("[data-view=home]")?.hidden === true;
  check("X1: #score?team=… routes to the score view, not home", scoreVisX1 && homeHidX1,
    "scoreHidden=" + domX1.window.document.querySelector("[data-view=score]")?.hidden);

  // X2: matched team renders the identity confirm naming the team
  await until(() => /Duck/.test(domX1.window.document.querySelector("#scConfirm")?.textContent || ""));
  check("X2: matched team shows one-time identity confirm with team name",
    /Duck/.test(domX1.window.document.querySelector("#scConfirm")?.textContent || ""),
    (domX1.window.document.querySelector("#scConfirm")?.textContent || "").slice(0, 120));
  domX1.window.close();

  // X3: unmatched team -> picker listing team values (never an error)
  const domX3 = makeDom("#score?team=NoSuchTeam");
  await until(() => (domX3.window.document.querySelectorAll("#scPicker .sc-pick") || []).length > 0);
  const picksX3 = [...domX3.window.document.querySelectorAll("#scPicker .sc-pick")].map(b => b.textContent);
  check("X3: unmatched team renders picker with Field team values",
    picksX3.some(t => /Duck/.test(t)) && picksX3.some(t => /Sully/.test(t)),
    JSON.stringify(picksX3).slice(0, 160));
  domX3.window.close();

  // X4: bare #score with no stored team -> picker too
  const domX4 = makeDom("#score");
  await until(() => (domX4.window.document.querySelectorAll("#scPicker .sc-pick") || []).length > 0);
  check("X4: bare #score with no remembered team renders picker",
    (domX4.window.document.querySelectorAll("#scPicker .sc-pick") || []).length >= 2, "");
  domX4.window.close();

  // X5: SC-YEAR — scorer season comes from first_tee, not Scores max-year.
  // Variant: Scores holds a rogue 2031 row; scorer must still resolve 2026 teams.
  const rogue = FIXTURES.scores + "2031,Ghost,1,4,,,,,,,,,,,,,,,,,\n";
  const domX5 = makeDom("#score?team=Duck", withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => rogue }),
  }));
  await until(() => /Duck/.test(domX5.window.document.querySelector("#scConfirm")?.textContent || ""));
  check("X5: SC-YEAR — first_tee season pins team matching despite rogue Scores year",
    /Duck/.test(domX5.window.document.querySelector("#scConfirm")?.textContent || ""), "");
  domX5.window.close();

  // X6: nav has NO score link (link-only view)
  const domX6 = makeDom("");
  check("X6: nav carries no #score anchor",
    ![...domX6.window.document.querySelectorAll(".nav a")].some(a => a.hash === "#score"), "");
  domX6.window.close();
}
```

- [ ] **Step 2: Run to verify failures**

Run: `npm test 2>&1 | grep "^FAIL  X\|TALLY TOTAL"`
Expected: X1–X5 FAIL (no score view exists; X1 falls through to home). X6 PASSES (regression guard). Total 159+6 with 5 FAIL.

- [ ] **Step 3: Implement**

3a. Router fix (replace the two hash-consuming sites at index.html:858-865):

```js
function showView(name){
  const bare=(name||"").split("?")[0];              // §18 SC-LINK router pin
  const aliased=VIEW_ALIASES[bare]||bare;
  const v=VIEWS.includes(aliased)?aliased:"home";
  document.querySelectorAll(".view").forEach(s=>{ s.hidden=s.dataset.view!==v; });
  document.querySelectorAll(".nav a").forEach(a=>a.classList.toggle("active",a.hash==="#"+v));
}
```

(`location.hash.slice(1)` call sites stay as-is — the split happens inside.)

3b. View shell — add before the footer, following the existing `.view` section pattern:

```html
<section class="view" data-view="score" id="score" hidden>
  <div class="wrap">
    <div id="scHeader"></div>
    <div id="scConfirm" hidden></div>
    <div id="scPicker" hidden></div>
    <div id="scCard"></div>
    <div id="scGlance"></div>
  </div>
</section>
```

3c. Helpers (place beside `activeSeason()`):

```js
// §18 SC-YEAR: the scorer keys season off Info first_tee (the validator's source).
function scorerSeason(){
  const ft=String((STATE.data.infoMap||{}).first_tee||"");
  const m=ft.match(/^(\d{4})/);
  return m?m[1]:activeSeason();
}
// Distinct active-season Field team values (the set the trigger validates).
function scorerTeams(seasonY){
  const seen=new Map();
  forYear(STATE.data.field,seasonY).forEach(r=>{
    const t=String(r.team||"").trim();
    if(t&&!seen.has(nkey(t))) seen.set(nkey(t),t);
  });
  return [...seen.values()];
}
function scorerTeamFromHash(){
  const q=location.hash.split("?")[1]||"";
  const m=/(?:^|&)team=([^&]*)/.exec(q);
  if(!m) return null;
  const want=nkey(decodeURIComponent(m[1]));
  return scorerTeams(scorerSeason()).find(t=>nkey(t)===want)||null;
}
const scKey=(y,tk)=>"gfy-scorer:"+y+":"+tk;
```

NOTE: if `STATE.data.infoMap` is not the real name of the parsed Info key map, find the actual one (grep `est_year` consumption near index.html:1187) and use it — do not invent a second Info parse.

3d. Scorer boot: a `renderScorer()` called from the score view's first show (hashchange listener) + after data load; resolution order: hash team → `localStorage` remembered team (wrapped in try/catch) → picker. Matched + not-yet-confirmed → `#scConfirm` with team + roster + "Not your team?" link (tap = picker); confirm tap persists `{confirmed:true}` under `scKey` and reveals `#scCard`. Picker buttons `.sc-pick` (one per `scorerTeams()` value, roster listed under each from Field rows).

- [ ] **Step 4: Verify green**

Run: `npm test 2>&1 | tail -3`
Expected: `TALLY TOTAL 165/165`, zero FAIL.

- [ ] **Step 5: Commit**

```bash
git add index.html test/smoke.mjs
git commit -m "feat(scorer): hash-query routing, #score shell, season-pinned team resolution (§18 SC-LINK/SC-YEAR; smoke X1-X6)"
```

---

### Task 2: Apps Script — shared validator, doPost/doGet, idempotency, totals guard + spike kit

**Files:**
- Modify: `tools/sheet-triggers.gs`
- Create: `tools/spike-scorer-cors.md`

**Interfaces:**
- Produces (server): `applyScore_(ss, p)` where `p={team,round,hole,score}` → `{ok:boolean, verdict:string, team:string, round:number, holes:Object|null}`; `doPost(e)` / `doGet(e)` per the Global Constraints contract; `doGet` returns `{ok:true, year, teams:[...]}`.
- The client transport (Task 4) depends on EXACTLY this response shape.

- [ ] **Step 1: Refactor `onScoreFormSubmit` → `applyScore_`**

Extract the validation+write core (currently inline at tools/sheet-triggers.gs:24-46 + `writeScore_`:79) into:

```js
// ONE validator for both lanes (§18 SC-VALIDATE). Caller holds NO lock; applyScore_ locks.
function applyScore_(ss, p){
  const lock = LockService.getDocumentLock();
  if(!lock.tryLock(10000)) return {ok:false, verdict:"busy — resubmit", team:p.team, round:0, holes:null};
  try{
    const year = firstTeeYear_(ss);
    const teams = rosterTeams_(ss, year);
    const tk = NORM(p.team);
    const team = teams.find(t => NORM(t) === tk);
    if(!team) return {ok:false, verdict:"team not in roster", team:p.team, round:0, holes:null};
    const round = parseInt(p.round,10), hole = parseInt(p.hole,10), score = parseInt(p.score,10);
    if(round!==1 && round!==2) return {ok:false, verdict:"invalid round", team:team, round:round||0, holes:null};
    if(!(hole>=1 && hole<=18)) return {ok:false, verdict:"invalid hole", team:team, round:round, holes:null};
    if(!(score>=1 && score<=19)) return {ok:false, verdict:"invalid score", team:team, round:round, holes:null};
    return writeScore_(ss, year, team, round, hole, score);   // returns {ok,verdict,team,round,holes}
  } finally { lock.releaseLock(); }
}
```

Rework `writeScore_` to (a) return the row's full holes map `{h1:…, …, h18:…}` after the write, (b) **reject a row carrying a round total** (§18 SC-VALIDATE guard): if the target (year,team,round) row has a non-empty `r1`/`r2` cell → `{ok:false, verdict:"round total already entered — clear r1/r2 first", …}`. `onScoreFormSubmit` becomes: parse answers via `namedAnswers_`, call `applyScore_`, `markResponse_(e, r.ok ? "applied" : "rejected: "+r.verdict)` — **identical observable form-lane behavior** (the busy path previously came from a thrown lock timeout; now it is the returned verdict — README's status list already documents `rejected: busy — resubmit`, unchanged).

- [ ] **Step 2: Add doPost/doGet + idempotency ring**

```js
function doPost(e){
  let p; try{ p = JSON.parse(e.postData.contents); }catch(err){ return jsonOut_({ok:false, verdict:"bad request", team:"", round:0, holes:null}); }
  const key = "idem:" + String(p.client_id||"").slice(0,40) + ":" + String(p.seq||"");
  const props = PropertiesService.getScriptProperties();
  if(p.client_id && p.seq != null){
    const prior = props.getProperty(key);
    if(prior) return ContentService.createTextOutput(prior).setMimeType(ContentService.MimeType.JSON);
  }
  const r = applyScore_(SpreadsheetApp.getActive(), p);
  const out = JSON.stringify(r);
  if(p.client_id && p.seq != null && r.verdict !== "busy — resubmit"){
    props.setProperty(key, out);                    // bounded: cleanupIdem_ below
    cleanupIdem_(props);
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}
function doGet(){
  const ss = SpreadsheetApp.getActive();
  const year = firstTeeYear_(ss);
  return jsonOut_({ok:true, year:year, teams:rosterTeams_(ss, year)});
}
function jsonOut_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
// Keep at most 600 idem keys (15 teams x 2 rounds x 18 holes + retries headroom).
function cleanupIdem_(props){
  const keys = props.getKeys().filter(k => k.indexOf("idem:") === 0);
  if(keys.length > 600) keys.slice(0, keys.length - 600).forEach(k => props.deleteProperty(k));
}
```

(`getKeys()` order is unspecified — acceptable: the ring only bounds growth, exact eviction order is not load-bearing. Say so in a comment.)

- [ ] **Step 3: Write the spike kit** `tools/spike-scorer-cors.md`: exact steps for Riley — deploy (Execute as Me / Anyone), the `curl -H "Content-Type: text/plain;charset=utf-8" -d '{"team":"…"}' -L <exec-url>` probe, then the browser probe: open `https://killerroyboy.github.io/gfy/?debug=1` console and run a provided 6-line `fetch` snippet against the exec URL asserting a parsed JSON response; PASS/FAIL criteria; the redeploy rule (Manage deployments → Edit → New version — never New deployment).

- [ ] **Step 4: Verify form-lane compatibility by inspection + suite**

`.gs` has no harness. Verify: `grep -n "applyScore_\|doPost\|doGet" tools/sheet-triggers.gs` shows the new structure; re-read `onScoreFormSubmit` end-to-end confirming identical verdict strings (the smoke suite doesn't run .gs — full suite still 165/165 as a no-regression check).

- [ ] **Step 5: Commit**

```bash
git add tools/sheet-triggers.gs tools/spike-scorer-cors.md
git commit -m "feat(scorer): shared applyScore_ validator, doPost/doGet endpoint, idempotency ring, totals guard, CORS spike kit (§18 SC-VALIDATE/SC-WRITE)"
```

---

### Task 3: Card UI + par-labeled pad + round chip (SC-UI, SC-PAR, SC-ROUND)

**Files:**
- Modify: `index.html` (fill `#scCard`; scorer CSS in the main `<style>` block, prefixed `.sc-`)
- Test: `test/smoke.mjs` (X7–X12)

**Interfaces:**
- Consumes: Task 1 shell + helpers; `courseMap()` (:1092), `scoreClass` (:1204), `buildPlayers` (season param arrives in Task 6 — until then the card renders journal-only cells; the sheet-value merge lands in Task 6 and X-tests for it live there).
- Produces: `renderScCard()` (idempotent, in-place updates); `scPadOpen(hole)`; `scHolePar(hole)` → int>0 or null (courseMap when non-null, else per-hole raw parse with `par>0` guard); `scRoundDefault()` and the momentary toggle; DOM contract: 18 `button.sc-cell[data-hole]` in two 9-cell rows with `aria-label="Hole N"`, pad `#scPad` with `button.sc-num[data-score]`, round chip `#scRound`.

- [ ] **Step 1: Failing tests X7–X12** (same placement pattern; all via `makeDom("#score?team=Duck")` + tapping `#scConfirm` button first — write a tiny local helper `openScorer(dom)` doing confirm-tap + `until` card visible):

```js
// X7: 18 cells, two rows, >=44px via class contract (jsdom has no layout: assert row split 9/9)
// X8: SC-PAR — pad labels derive from THAT hole's par: with Course fixture par3 on h8 and par4 on h7,
//     opening pad(7) labels score 4 "Par" and pad(8) labels score 3 "Par" (query .sc-num[data-score] label spans)
// X9: SC-PAR degrade — course variant with h5 par blank: pad(5) shows NO golf-term labels (plain numbers), other holes still labeled
// X10: tally suppression — same variant: #scCard to-par tally element absent/strokes-only (data-mode="strokes")
// X11: SC-ROUND spring — toggle to R1 (tap #scRound), enter a score via pad, toggle auto-returns to derived default (chip text back to "Round 2") — Duck's fixture R1 is complete natively, so the derived default is already R2 - no variant needed
// X12: tapping a filled cell opens pad in edit mode showing "currently N" and the send button labeled "Replace N with M" after picking M
```

Write each as a real `check()` following X1–X6's style — the six comments above define the behavioral contract; the test code queries the DOM ids/classes from **Interfaces**. (Implementer: write the full check bodies — anything you cannot assert from the DOM contract, flag in your report rather than weakening the test.)

- [ ] **Step 2: Run — X7–X12 FAIL** (`#scCard` is an empty div).

- [ ] **Step 3: Implement** the card + pad + round logic. Markup contract (inside `#scCard`, re-rendered in place):

```html
<div class="sc-round"><button id="scRound" type="button">Round 2 · Sat</button></div>
<div class="sc-nine"><span class="sc-lab">Out</span><div class="sc-row">…9 × <button class="sc-cell" data-hole="1"><b>3</b><span>1</span></button>…</div></div>
<div class="sc-nine"><span class="sc-lab">In</span><div class="sc-row">…holes 10–18…</div></div>
<div class="sc-legend">■ on the sheet · ⇡ saved on phone · ? sheet differs — tap</div>
<div id="scPad" hidden><!-- hole header + par/yds + 8 sc-num buttons + Other numeric entry --></div>
```

Cells: min-height 48px CSS, labels ≥13px; under/over pairing = `scoreClass` color + a `▾/▴` glyph next to the number (non-color cue). Pad numbers: range = par−2 … par+4 when `scHolePar(hole)` non-null (labels Eagle/Birdie/Par/Bogey/+2…), else 1–8; "Other" always opens `<input type="number" min="1" max="19">`. `scRoundDefault()`: if the team's R1 board row (Task 6; until then journal) has 18 entries → 2; else date rule vs `first_tee` compared in the first_tee string's own offset (parse the ISO offset, compute "event day index" without local timezone: `Math.floor((Date.parse(now) - Date.parse(first_tee))/86400000)` clamped 0/1 → round 1/2). Toggle: tap flips for ONE submission (`scRoundOverride` consumed on send), then reverts; chip text always names the active target.

Send-on-tap: Task 3 wires taps to `scJournalSave(entry)` (Task 5's function — until Task 5 lands, stub it as `window.scJournalSave = window.scJournalSave || (e => {})` so Task 3 is testable standalone; X11/X12 assert UI behavior, not persistence).

- [ ] **Step 4: Green** — `npm test` → 171/171.

- [ ] **Step 5: Commit**

```bash
git add index.html test/smoke.mjs
git commit -m "feat(scorer): card-first UI, per-hole par-labeled pad, momentary round toggle (§18 SC-UI/SC-PAR/SC-ROUND; smoke X7-X12)"
```

---

### Task 4: Transport module + loud misconfig + debug ping (SC-WRITE client, SC-LOUD-CONFIG)

**Files:**
- Modify: `index.html` (transport fns in the SCORER script; `?debug=1` panel addition near the existing debug wiring)
- Test: `test/smoke.mjs` (X13–X15)

**Interfaces:**
- Consumes: Info key `score_endpoint` (via the same parsed Info map as Task 1).
- Produces: `scEndpoint()` → url string or null; `scSend(entry)` → Promise resolving `{ok, verdict, team, round, holes}` or REJECTING with `{kind:"network"}` (fetch threw) or `{kind:"config", detail}` (non-JSON / bad shape / HTTP-but-unparseable); `scPing()` → same discipline against `doGet`. `client_id` = random-once persisted in the journal root; `seq` = journal's monotonically increasing counter (Task 5 owns both; Task 4 reads them via parameters: `scSend(entry, clientId, seq)`).

- [ ] **Step 1: Failing tests X13–X15**

```js
// X13: absent score_endpoint -> scorer inert state: #scCard hidden, copy /scoring opens at the tournament/i,
//      raw form link visible when Info form URL key exists (default fixture: absent -> no link, still no error)
// X14: endpoint variant (info override adds "score_endpoint,https://script.example/exec") + stubbed fetch
//      returning JSON {ok:true, verdict:"applied", team:"Duck", round:2, holes:{h13:6}} - AND the variant MUST also drop the lowercase `duck,2` scores row via withOverride (else Task 6 sheet-merge later turns this into a conflict state and X14 would break) -> a pad send resolves
//      and the cell for h13 shows 6 in the sent-family state
// X15: SC-LOUD-CONFIG — stub returns an HTML string ("<html>Sign in</html>") -> view shows
//      /scoring endpoint not reachable/i and NO cell claims sent-to-sheet
```

Stub pattern: extend the variant fetch — requests whose URL starts with the endpoint return the canned Response-like object; CSV requests fall through to `fakeFetch`.

- [ ] **Step 2: Run — X13–X15 FAIL.**

- [ ] **Step 3: Implement**

```js
function scEndpoint(){ const v=String((STATE.data.infoMap||{}).score_endpoint||"").trim(); return /^https:\/\//.test(v)?v:null; }
async function scSend(entry, clientId, seq){
  const url=scEndpoint(); if(!url) throw {kind:"config", detail:"no endpoint"};
  let res;
  try{
    res=await fetch(url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({team:entry.team,round:entry.round,hole:entry.hole,score:entry.score,client_id:clientId,seq:seq}),
      redirect:"follow"});
  }catch(err){ throw {kind:"network"}; }
  let out;
  try{ out=JSON.parse(await res.text()); }catch(err){ throw {kind:"config", detail:"non-JSON response"}; }
  if(typeof out.ok!=="boolean"||typeof out.verdict!=="string") throw {kind:"config", detail:"bad shape"};
  return out;
}
```

Inert state: `renderScorer()` renders the "scoring opens at the tournament" copy + optional raw form link when `scEndpoint()===null`. `scPing()` wired into the existing `?debug=1` diagnostics (one extra row: endpoint OK/FAIL + team count).

- [ ] **Step 4: Green** — 174/174.
- [ ] **Step 5: Commit**

```bash
git add index.html test/smoke.mjs
git commit -m "feat(scorer): endpoint transport with loud misconfig + debug ping (§18 SC-WRITE/SC-LOUD-CONFIG; smoke X13-X15)"
```

---

### Task 5: Journal, queue, and truth states (SC-HONEST, SC-NOCLOBBER, SC-QUEUE)

**Files:**
- Modify: `index.html` (journal/state machine in the SCORER script; wire `scJournalSave` into Task 3's taps for real)
- Test: `test/smoke.mjs` (X16–X23)

**Interfaces:**
- Consumes: `scSend` (Task 4), `scKey` (Task 1), cells/pad (Task 3).
- Produces: `scJournalSave(entry)` (instant, storage-try/catch, coalesces per (round,hole), bumps seq); `scDrain()` (ordered, one-at-a-time, invoked on save/timer(20s)/`online`/`pageshow`/`visibilitychange`); per-entry states `"queued"|"sending"|"ok"|"rejected"` + verdict; `scCellState(hole)` merging sheet value (Task 6 supplies; until then null) + journal per the precedence rules below — THE single source for cell rendering.

**Precedence rules (SC-HONEST/SC-NOCLOBBER, exact):**
1. Sheet value present AND journal entry `ok` with same value → "on the sheet" (journal entry prunable).
2. Sheet value present AND differs from this phone's latest entry (any state) → **conflict**: cell shows both (`5·4`), pad opens in replace-confirm mode; the queued entry for that hole is HELD (never auto-sent).
3. No sheet value: journal state renders (queued ⇡ / sending / ok "on the sheet" / rejected loud with verdict + "text Riley" after 2 manual retries).
4. Entries from a round older than the current derived round render one quiet summary line, never a prompt.

- [ ] **Step 1: Failing tests X16–X23**

```js
// X16: offline-first — stub fetch rejects (network): tap score -> cell shows queued state INSTANTLY, no error UI
// X17: drain on reconnect — flip the stub to succeed, dispatch window 'online' -> until cell state 'ok'; exactly ONE POST body seen for that hole (capture bodies in the stub)
// X18: coalescing — while offline, tap 4 then 6 on the same hole: stub captures show at most one in-flight body for that hole and its score is 6
// X19: ordered drain — offline taps on holes 2 then 3: captured POST order is [h2, h3]
// X20: SC-NOCLOBBER — sheet value for h14 = duck r2 fixture value (4) -> use queued 6 (differs), scores fixture UNMODIFIED: NO POST for h14 on drain; cell renders conflict (contains "5" and "4"); pad(14) shows a replace-confirm labeled with both numbers
// X21: rejected verdict — stub returns {ok:false, verdict:"team not in roster",...} (team Duck, same dropped-row variant): cell loud state contains the verbatim verdict
// X22: idempotent seq — the same entry retried (stub: first network-reject, then success) sends the SAME seq both times
// X23: storage-dead degrade — makeDom variant where localStorage.setItem throws: tap still updates the cell in-memory and the header shows the "can't remember sends" copy; no uncaught errors (dom.pageErrors empty)
```

(X20's sheet-value merge needs Task 6's `buildPlayers` param if implemented there first — to keep Task 5 self-contained, `scCellState` takes the sheet map as an injected getter `scSheetHoles()` which Task 5 stubs to read a fixture-driven global; Task 6 replaces the stub with the real derivation and X20 keeps passing. Pin: `window.scSheetHoles = window.scSheetHoles || (()=>null)`.)

- [ ] **Step 2: Run — X16–X23 FAIL.**
- [ ] **Step 3: Implement** the journal exactly per Interfaces + precedence rules. Journal root: `{client_id, seq, confirmed, entries:{"r2h13":{round,hole,score,seq,state,verdict,ts}}}` under `scKey(season, teamKey)`; every mutation через one `scStore(mutfn)` wrapper (try/catch both read and write; on throw flip `scStorageDead=true` and keep the in-memory copy). Drain: single-flight (`scDraining` flag), takes entries `state==="queued"` sorted by seq, holds conflicts per rule 2, marks `sending`→`ok|rejected` from the verdict, `kind:"network"` reject → back to `queued` (same seq), `kind:"config"` → the Task 4 loud state (entries stay queued).
- [ ] **Step 4: Green** — 182/182.
- [ ] **Step 5: Commit**

```bash
git add index.html test/smoke.mjs
git commit -m "feat(scorer): offline-first journal, coalescing ordered queue, NOCLOBBER conflict states (§18 SC-HONEST/SC-QUEUE; smoke X16-X23)"
```

---

### Task 6: Sheet truth merge, glance strip, render boundary (SC-DERIVE, SC-GLANCE)

**Files:**
- Modify: `index.html` (`buildPlayers(seasonY)` + `rosterMap(seasonY)` additive params defaulting to `STATE.year`; real `scSheetHoles()`; `#scGlance`; `renderAll()` exemption)
- Test: `test/smoke.mjs` (X24–X26)

**Interfaces:**
- Consumes: everything prior.
- Produces: `buildPlayers(seasonY=STATE.year)` / `rosterMap(seasonY=STATE.year)` (all existing call sites unchanged — verify by grep that zero call sites pass args today); `scSheetHoles()` → `{h1..h18}` for the scorer team+round from `buildPlayers(scorerSeason())` merged output (S-MERGE/S-ZERO semantics for free); glance markup `#scGlance` ("Nth of M reporting · thru K" + leader + neighbors, board-data only, pending shown as its own labeled line).

- [ ] **Step 1: Failing tests X24–X26**

```js
// X24: sheet merge — scores fixture natively has duck r2 h1..h6 = 4,4,3,5,3,4; card cells 1-6 render those values in on-sheet state
//      while STATE.year is poked to a different year via the year picker on #board first (SC-YEAR: card unaffected)
// X25: glance honesty — with the fixture's natural r2 coverage (verify the actual reporting count at implementation time and assert that number, stating it in the report), glance text matches /of 3 reporting/ and shows /thru/
//      and pending-on-phone renders as its own line, absent from the board tally number
// X26: render boundary — open pad(7), force a full load()/renderAll() cycle (dispatch the same path the 60s
//      timer uses), assert the pad is still open and its hole is still 7
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Exemption pin: `renderAll()` must skip the score section's interactive DOM — either exclude `data-view=score` from its loop or have `renderScorer()` only update text nodes in place; pick whichever matches `renderAll()`'s actual structure (read it first at :2427) and assert via X26 either way.
- [ ] **Step 4: Green** — 185/185.
- [ ] **Step 5: Commit**

```bash
git add index.html test/smoke.mjs
git commit -m "feat(scorer): season-pinned sheet merge, honest glance strip, repaint-safe view (§18 SC-DERIVE/SC-GLANCE; smoke X24-X26)"
```

---

### Task 7: Admin & housekeeping (SC-PUBBTN, SC-LINKS-ADMIN, SC-FORMLANE)

**Files:**
- Modify: `index.html` (:524 hero button + :2598 wiring — remove), `config.js` (SHEET_EDIT_URL value → ""), `tools/sheet-triggers.gs` (`setup()` header asserts), `tools/sheet-polish.gs` (START HERE: captain links block + Team-dropdown list block + freeze note; DELETE the "Short team labels are fine" line ~:141), `README.md` (delete the same guidance line; SHEET_EDIT_URL instruction removal)
- Test: `test/smoke.mjs` (X27–X28)

- [ ] **Step 1: Failing tests**

```js
// X27: no #sheetBtn in the DOM at all, and the raw html source contains no "SHEET_EDIT_URL" consumer wiring
// X28: config.js source (readFileSync) contains SHEET_EDIT_URL: "" — the live edit URL string is gone
//      (assert /SHEET_EDIT_URL:\s*""/ and NOT /docs\.google\.com\/spreadsheets\/d\/16Co2b/)
```

- [ ] **Step 2: FAIL** (button exists; URL present).
- [ ] **Step 3: Implement.** START HERE additions follow sheet-polish.gs's existing content-anchored row pattern (read :100-160 first): one block "Captain scoring links" (one row per `rosterTeams_` value: team label + `https://killerroyboy.github.io/gfy/#score?team=<encodeURIComponent(team)>`), one block "Form Team dropdown — paste exactly this list", one note row "Team names freeze once links go out; a rename must also be applied to Scores." `setup()` asserts Scores headers (`team` present — not legacy `player` — and `h1..h18` all present), logging loudly and throwing on mismatch.
- [ ] **Step 4: Green** — 187/187.
- [ ] **Step 5: Commit**

```bash
git add index.html config.js tools/sheet-triggers.gs tools/sheet-polish.gs README.md test/smoke.mjs
git commit -m "feat(scorer): admin blocks + pubbtn/SHEET_EDIT_URL removal + formlane hardening (§18 SC-PUBBTN/SC-LINKS-ADMIN/SC-FORMLANE; smoke X27-X28)"
```

---

### Task 8: README rev 2, battery, S11, ledger

**Files:**
- Modify: `README.md` ("Live scoring" section rewritten: endpoint setup incl. deploy click-path + redeploy rule verbatim from SC-LOUD-CONFIG; the SC-DRILL checklist verbatim from the spec incl. the 15-tap sweep values `round 2 / hole 13 / score 6`; paper card = system of record; queued-scores honesty copy; spike kit pointer)
- Modify: `.superpowers/sdd` ledger via controller (report only)

- [ ] **Step 1: README rewrite** per above — no new promises beyond the spec; the drill section IS the pre-links gate and says so.
- [ ] **Step 2: Full battery**: `git status --porcelain` empty; `npm test` → 187/187.
- [ ] **Step 3: S11 renders**: homepage (unchanged check) + `#score?team=Duck` at 420×900 AND 900×900 with the endpoint absent (inert state) and via a local variant page if needed for the card state — judge cold: legible in the sun test (nothing under 13px), tap targets, honest copy. Read the PNGs.
- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(scorer): live-scoring rev 2 — endpoint setup, redeploy rule, draft-night drill gate, paper-card record (§18)"
```

---

## Plan self-review

- Spec coverage: SC-LINK/SC-YEAR→T1 · SC-VALIDATE/SC-WRITE-server/SC-IDEMPOTENT/spike kit→T2 · SC-UI/SC-PAR/SC-ROUND→T3 · SC-WRITE-client/SC-LOUD-CONFIG/doGet-ping→T4 · SC-HONEST/SC-NOCLOBBER/SC-QUEUE→T5 · SC-DERIVE/SC-GLANCE/render-boundary→T6 · SC-PUBBTN/SC-LINKS-ADMIN/SC-FORMLANE→T7 · SC-DRILL-doc/README/battery→T8. The LIVE spike + drill are Riley-gated post-build steps (documented T2/T8), consistent with the spec's gate ("before any link is texted" / "before build" softened to transport-isolated build per controller ruling recorded in the ledger).
- Placeholder scan: X7–X12 and X16–X26 are specified as behavioral contracts with DOM anchors rather than full literal bodies — deliberate: the implementer writes the check bodies against the pinned ids/classes, and the per-task reviewer verifies the assertions are real (flagged in each task). No TBD/TODO items.
- Type consistency: `scSend(entry, clientId, seq)` (T4) matches T5's drain calls; `scSheetHoles()` stub/real handoff pinned in both T5 and T6; `applyScore_` return shape identical in T2 server code and T4 client validation; suite arithmetic 159→165→171→174→182→185→187 consistent.
