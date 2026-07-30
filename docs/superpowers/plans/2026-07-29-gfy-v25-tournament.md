# GFY v2.5 Tournament Refinement Implementation Plan (spec §15, hardened; rev 2 post-review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec §15 — podium history on Champions (`place` + `players`), a public `#draft` board (pool/drafted, win badges, strengths), and captain-only labels on the leaderboard + scorecard grid (4-player teams) — plus the N-FULLNAMES naming convention in README/START HERE and the template columns.

**Architecture:** All site changes stay inside `index.html` (one new `captainLabel()` helper, a rewritten `renderChampions()`, a new `renderDraft()` + `#draft` section, nav-priority updates). Sheet/template surface: `tools/make_template.py` gains the new columns (regenerate the xlsx), `tools/sheet-polish.gs` START HERE gains one naming-convention line, README documents everything. Tests: existing group A/S assertions updated **in place** where behavior legitimately changes; all new coverage in **group U** (letter free; tally auto-prints).

**Tech Stack:** unchanged — vanilla JS single file, jsdom smoke (`npm test`, baseline **143/143** — spec §15 pin verified), Python template generator, Apps Script V8, no new dependencies.

## Global Constraints (spec §12–§15 — every task inherits)

- Emails never in the repo; sample data synthetic. Page never scrolls sideways (K5 guards the grid slice only — the new `#draft` CSS gets its own `overflow-wrap` and a battery eyeball; it is NOT covered by K5).
- Blank `team` in Field is NORMAL pre-draft (E-TEAM): `renderDraft` must never call `flag()` for a blank team — the pool IS the blank-team list. **TWO checks pin the main dom at exactly 7 health flags: D3 (test/smoke.mjs ~330) AND Z5 (~1567).** Base-fixture edits and new render code must add zero main-dom flags; if either goes red, the task broke fixture hygiene — fix the code, never the pin.
- **The main jsdom `dom` is CLOSED at test/smoke.mjs ~1512** — after that line `doc` queries return empty/null. Group U appends after group T (~1902), so EVERY U check that needs a rendered default-fixture page builds its own `makeDom("")`, gates on `until(() => d.querySelectorAll("#lbBody .lb-row").length > 0)` (never on a selector that static markup already satisfies), and closes it. Same pattern as K/L/S groups.
- §15 hardening pins are BINDING, copied verbatim into the tasks below: **N-FULLNAMES**, **U-TOKENS** (split on comma, ·, /, &, |, " and "; nkey each token; EXACT token match — Jake must never match Jakeb), **U-DUPES** (duplicate same-year places render ALL rows + health-strip flag; no silent de-dup), **U-POOL** (pool = year==activeSeason AND team blank AND status not in {out, wd}; current-season `declined` also excluded), **B-CAPTAIN scope** (captain-only on leaderboard rows AND grid sticky team column; tap-open card gains a roster header with all names; Calcutta/Money/Shame keep existing joined labels — NOT §15 scope. **Decision: `renderHolePanel` (~1319) also keeps the joined `teamLabel` form** — the per-hole list is vertical, width is not the constraint there, and the scope pin names only board rows + grid column).
- H-PODIUM: `place` optional (**blank = 1st**, silent, full legacy compat; **"1"/"2"/"3" = that place; anything else is a TYPO — flagged, rendered as-is, never counted as a win**). `players` free text. Years lacking 2nd/3rd render only what exists — no fabricated placings. Bird holder = **the latest year's** place-1 row; if the latest year has no place-1 row, `#homeBird` is left untouched (never fall back to an older year).
- The draft view is pinned to `activeSeason()` end-to-end — it must NEVER follow `STATE.year` (the archive year picker), including the drafted-teams grouping. `rosterMap()` follows `STATE.year`, so `renderDraft` must not call it.
- S-KEY normalization everywhere a name is compared: `nkey` = trim + collapse whitespace + lowercase (already defined at index.html:959 — reuse, never re-implement).
- Suite never shrinks; run `npm test` before every commit; stage only the task's files (`.superpowers/` is git-ignored scratch — never staged).
- Fixture edits are ADDITIVE: append new columns at the END of the header; leave existing rows byte-identical unless a task explicitly renames one (group W does string surgery on raw `FIXTURES.field` rows like `2027,Hammer,,,,,,` — those lines must survive verbatim; `toObjects` at index.html:846 tolerates short rows, so old rows need no trailing commas).

---

### Task 1: B-CAPTAIN — captain-only labels on board + grid, roster header on the card

**Files:** Modify `index.html` (helper near teamLabel ~1003; renderLeaderboard ~1218; renderScoreGrid ~1273; cardHTML ~1142; one CSS rule). Test: `test/smoke.mjs` (edit 4 strings in `expectedA` in place; new group U block with U1/U2 → suite 145).

**Interfaces:** Produces `captainLabel(key, rawFallback)` → `{html, text}` (same shape as `teamLabel`). Later tasks do NOT consume it; the draft view (Task 3) uses raw names. Produces the group-U section header; Task 3 creates its own variant doms — no shared state between tasks.

- [ ] **Step 1 (RED):** In `test/smoke.mjs` `expectedA` (~line 159), edit ONLY the four `name` values of A2–A5 in place — **A6 (Bear) stays byte-identical** (its name is already captain-only), and every other field of every row stays untouched:
  - A2: `name: "Duck & Hammer"` → `name: "Duck"`
  - A3: `name: "Sully & Johnson, Wade"` → `name: "Sully"`
  - A4: `name: "Tex & Tank"` → `name: "Tex"`
  - A5: `name: "Moose & Sock"` → `name: "Moose"`

  (If any A-row assertion compares `name` with `===`, the captain-only string must match exactly — no trailing partner names.) Then append a new group U section AFTER the group T block (~line 1902), using the same variant-dom pattern as S3/S4 (`withOverride` + `makeDom` + `until`):

```js
/* ---------- U: v2.5 tournament refinement (§15) ---------- */
{
  // 4-player team + a draft pool (B-CAPTAIN / D-DRAFT fixtures — synthetic)
  const fieldU = [
    "year,player,team,since,handicap,status,deposit,paid_date,strengths",
    "2026,Duck,Duck,2019,8,In,TRUE,,steady putter",
    "2026,Hammer,Duck,2019,10,In,TRUE,,",
    "2026,Sully,Duck,2021,15,In,TRUE,,",
    "2026,Tank,Duck,2026,20,In,TRUE,,",
    "2026,Wade Boggs,,2022,9,In,TRUE,,long drives",
    "2026,Jake,,2024,,In,TRUE,,",
    "2026,Ghost,,2020,12,out,,,",
    "2026,Blade,,2020,13,wd,,,",
    "2026,Crash,,2020,14,declined,,,",
  ].join("\n");
  const fetchU = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldU }),
  });
  const domU = makeDom("", fetchU);
  const docU = domU.window.document;
  await until(() => docU.querySelectorAll("#lbBody .lb-row").length > 0);

  const duckRow = [...docU.querySelectorAll("#lbBody .lb-row")]
    .find(r => (r.querySelector(".lb-name")?.textContent || "").includes("Duck"));
  const duckName = duckRow?.querySelector(".lb-name");
  const gridTh = [...docU.querySelectorAll("#sgTable tr.sg-teamrow th.sg-team")]
    .find(th => th.textContent.includes("Duck"));
  check("U1: B-CAPTAIN — 4-player team's board row and grid sticky column show the captain ONLY (cap-marked), no partner names",
    !!duckName && duckName.textContent.trim() === "Duck" && capMarked(duckName.innerHTML, "Duck")
    && !!gridTh && gridTh.textContent.trim() === "Duck",
    "board=" + JSON.stringify(duckName?.textContent) + " grid=" + JSON.stringify(gridTh?.textContent));

  duckRow.click();
  await until(() => !!docU.querySelector("#lbBody .card-drop"));
  const rosterHead = docU.querySelector("#lbBody .card-drop .card-roster");
  check("U2: B-CAPTAIN — tap-open card gains a roster header with ALL FOUR names, captain cap-marked",
    !!rosterHead && ["Duck","Hammer","Sully","Tank"].every(n => rosterHead.textContent.includes(n))
    && capMarked(rosterHead.innerHTML, "Duck"),
    rosterHead ? rosterHead.textContent : "no .card-roster");
  domU.window.close();
}
```

- [ ] **Step 2:** Run `npm test` — expect the four edited A checks and U1/U2 to FAIL (board still shows joined names; no `.card-roster`). Confirm the failures are exactly those before writing implementation.
- [ ] **Step 3 (GREEN):** In `index.html`, add directly below `teamLabel` (~line 1011):

```js
// B-CAPTAIN (§15): board rows + grid sticky column show the captain only —
// width-critical at 15 four-player teams. Full roster: card header + Field.
// The hole panel keeps the joined form (vertical list, width not constrained).
function captainLabel(key,rawFallback){
  const t=rosterMap().get(key);
  if(!t||!t.captain) return teamLabel(key,rawFallback);
  return { html:`<span class="cap">${esc(t.captain)}</span>`, text:t.captain };
}
```

In `renderLeaderboard` (~1218) change `teamLabel(p.key, p.name).html` → `captainLabel(p.key, p.name).html`. In `renderScoreGrid` (~1273) change the row header to `captainLabel(p.key,p.name).html`. Do NOT touch `renderHolePanel`, Calcutta, Money, or Shame (scope pin). In `cardHTML` (~1146), insert the roster header right after the opening `card-drop` div (the joined form is the sanctioned card surface — reuse `teamLabel`):

```js
return `<div class="card-drop" id="card-${esc(p.key).replace(/ /g,"-")}">`
  + `<p class="card-roster">${teamLabel(p.key,p.name).html}</p>`
  + rds.map(rd=>{
```

Add CSS next to the existing `.card-drop` rules (`.card-drop` already pads `20px 8px 24px` — use margin only, no double indent):

```css
.card-roster{font-size:.85rem;color:var(--bone);margin:0 0 10px;padding:0;letter-spacing:.02em}
```

(`--bone`/`--sage`/`--brass` are confirmed real custom properties at index.html:17.)
- [ ] **Step 4:** `npm test` → **145/145** (A green again, U 2/2; K3/K7/L2 find rows by `textContent.includes("Duck"/"Tex")`, which captain-only still satisfies). Commit: `git add index.html test/smoke.mjs && git commit -m "feat: B-CAPTAIN — captain-only board/grid labels, card roster header (§15)"`.

---

### Task 2: H-PODIUM — Champions place/players + per-year podium render

**Files:** Modify `index.html` (renderChampions ~2220 + two CSS rules), `fixtures/champions.csv`. Test: `test/smoke.mjs` (group U additions U3/U4/U5 → suite 148).

**Interfaces:** Consumes nothing from Task 1. Produces: Champions rows now carry optional `place`/`players` keys (lowercased by `toObjects`); the podium DOM contract — `#champBody .entry` (place-1) and `#champBody .entry.entry-minor` (2nd/3rd, `.entry-year` cell shows "2nd"/"3rd"), rosters in `.entry-roster`; and the place-parse semantics (blank→1 silent; 1–3→that; else null+flag) that Task 3's `champPodium` must mirror exactly. Note: the roster string `Sully · Wade Johnson` anticipates Task 3's fixture rename of `"Johnson, Wade"` → `Wade Johnson` (N-FULLNAMES first-last form; the comma separator would split a lastname-first spelling into junk tokens).

- [ ] **Step 1 (fixture):** Replace `fixtures/champions.csv` with (additive columns; 2024 gains a real podium; 2024 Duck keeps a BLANK place — the legacy-compat case; `·` separators so no CSV quoting is needed):

```csv
year,champion,score,place,players
2024,Duck,151 (+7),,Duck · Hammer
2024,Sully,153 (+9),2,Sully · Wade Johnson
2024,Tex,158 (+14),3,Tex & Tank
2023,Hammer,149 (+5),,
2019,Tex,Inaugural,,
```

(E4 pins the Home bird holder to "latest Champions row (2024 Duck)" — the latest-year place-1 rule below keeps that green. 2023/2019 stay single-row years: the U4 "render only what exists" case.)
- [ ] **Step 2 (RED):** Append to the group U section. The main dom is closed by this point in the file — U3/U4 build their OWN default-fixture dom:

```js
{
  // H-PODIUM on the default fixtures (own dom — the main one is closed upstream)
  const domH = makeDom("");
  const docH = domH.window.document;
  await until(() => docH.querySelectorAll("#lbBody .lb-row").length > 0);
  const entries = [...docH.querySelectorAll("#champBody .entry")];
  const minors = entries.filter(e => e.classList.contains("entry-minor"));
  check("U3: H-PODIUM — 2024 renders a full podium: place-1 Duck (blank place = 1st, legacy), 2nd Sully, 3rd Tex, each with its roster",
    entries.length === 5 && minors.length === 2
    && minors.some(e => e.querySelector(".entry-year")?.textContent === "2nd" && /Sully/.test(e.textContent) && /Wade Johnson/.test(e.querySelector(".entry-roster")?.textContent || ""))
    && minors.some(e => e.querySelector(".entry-year")?.textContent === "3rd" && /Tex & Tank/.test(e.querySelector(".entry-roster")?.textContent || ""))
    && entries.some(e => !e.classList.contains("entry-minor") && /Duck/.test(e.textContent) && /Duck · Hammer/.test(e.querySelector(".entry-roster")?.textContent || "")),
    "entries=" + entries.length + " minors=" + minors.length + " :: " + entries.map(e => e.querySelector(".entry-year")?.textContent + "|" + e.querySelector(".entry-name")?.textContent).join(" ; "));
  check("U4: H-PODIUM — years without 2nd/3rd rows render only what exists (2023, 2019 single entries, no fabricated placings) and the bird holder stays the latest place-1 row (Duck)",
    entries.filter(e => e.querySelector(".entry-year")?.textContent === "2023").length === 1
    && entries.filter(e => e.querySelector(".entry-year")?.textContent === "2019").length === 1
    && (docH.querySelector("#homeBird")?.textContent || "").includes("Duck"),
    "");
  domH.window.close();
}
{
  // U-DUPES: two place-1 rows same year → BOTH render + health flag, no silent
  // de-dup. Gate on the BOARD, not #champBody — static markup ships 6 .entry
  // divs, so a champBody-based until() fires before the fetch resolves.
  const champsDup = 'year,champion,score,place,players\n2024,Duck,151 (+7),1,\n2024,Moose,151 (+7),1,\n';
  const fetchDup = withOverride({
    champions: () => Promise.resolve({ ok: true, status: 200, text: async () => champsDup }),
  });
  const domDup = makeDom("", fetchDup);
  const docDup = domDup.window.document;
  await until(() => docDup.querySelectorAll("#lbBody .lb-row").length > 0);
  const dupEntries = [...docDup.querySelectorAll("#champBody .entry")];
  const healthDup = docDup.querySelector("#healthStrip")?.textContent || "";
  check("U5: U-DUPES — duplicate same-year place-1 rows ALL render + health-strip flag (no silent de-dup, no fabricated podium)",
    dupEntries.length === 2 && /Duck/.test(dupEntries.map(e=>e.textContent).join(" ")) && /Moose/.test(dupEntries.map(e=>e.textContent).join(" "))
    && /duplicate/i.test(healthDup),
    "entries=" + dupEntries.length + " health=" + healthDup.slice(0, 160));
  domDup.window.close();
}
```

- [ ] **Step 3:** Run `npm test` — U3/U4/U5 FAIL (old renderChampions renders flat rows, no `.entry-minor`, no dupe flag). Every pre-existing check must still pass at this point — expected: NONE break (E4 keeps Duck; FPRINT `champions:["champion"]` still satisfied; D3/Z5's 7-flag pins untouched — the new fixture has no duplicate or invalid places). If something else goes red, STOP and report; do not paper over it.
- [ ] **Step 4 (GREEN):** Replace `renderChampions()` (index.html ~2220) with:

```js
function renderChampions(){
  const rows=STATE.data.champions;
  if(!rows||!rows.length){
    $("#champBody").innerHTML=`
      <div class="entry"><div class="entry-year">2025</div><div class="entry-name blank">Open</div><div class="entry-score">—</div></div>
      <div class="entry"><div class="entry-year">2024</div><div class="entry-name blank">Add name</div><div class="entry-score">—</div></div>
      <div class="entry"><div class="entry-year">2023</div><div class="entry-name blank">Add name</div><div class="entry-score">—</div></div>
      <div class="entry"><div class="entry-year">2022</div><div class="entry-name blank">Add name</div><div class="entry-score">—</div></div>
      <div class="entry"><div class="entry-year">2021</div><div class="entry-name blank">Add name</div><div class="entry-score">—</div></div>
      <div class="entry"><div class="entry-year">2019</div><div class="entry-name blank">Add name</div><div class="entry-score">Inaugural</div></div>`;
    return;
  }
  // H-PODIUM (§15): optional place + players roster.
  // blank = 1st (legacy rows, silent). "1"-"3" = that place. Anything else is
  // a typo: flagged, rendered as-is, NEVER counted as a win — a bad cell must
  // not fabricate a first place (or hand The Bird to a typo).
  const withYear=rows.filter(r=>r.year);
  const placeOf=r=>{ const s=String(r.place||"").trim(); if(!s) return 1;
    const n=parseInt(s,10); return (n>=1&&n<=3)?n:null; };
  const years=[...new Set(withYear.map(r=>r.year))].sort((a,b)=>parseInt(b,10)-parseInt(a,10));
  $("#champBody").innerHTML=years.map(y=>{
    const yr=withYear.filter(r=>r.year===y);
    const counts={};
    yr.forEach(r=>{ const p=placeOf(r); if(p!==null) counts[p]=(counts[p]||0)+1; });
    Object.entries(counts).filter(([,n])=>n>1)
      .forEach(([p,n])=>flag(`Champions ${y} has ${n} duplicate place-${p} rows — showing all`));
    yr.filter(r=>placeOf(r)===null)
      .forEach(r=>flag(`Champions ${y} place "${r.place}" is not 1-3 — shown as-is, not counted as a win`));
    const ordered=[...yr].sort((a,b)=>(placeOf(a)??9)-(placeOf(b)??9));
    return ordered.map(r=>{
      const pl=placeOf(r);
      const minor=pl!==1;
      const yearCell=pl===1?esc(r.year):(pl!==null?esc(pl+ordSuffix(pl)):esc(String(r.place)));
      const blank=!r.champion;
      const roster=r.players?`<div class="entry-roster">${esc(r.players)}</div>`:"";
      return `<div class="entry${minor?" entry-minor":""}">
        <div class="entry-year">${yearCell}</div>
        <div class="entry-name${blank?" blank":""}">${esc(r.champion||"Open")}${roster}</div>
        <div class="entry-score">${esc(r.score||"—")}</div>
      </div>`;
    }).join("");
  }).join("");

  // Bird: the LATEST year's place-1 row — never an older year's (spec pin).
  // Latest year without a place-1 row → leave #homeBird's default copy alone.
  const latestYear=years[0];
  const latest=latestYear?withYear.find(r=>r.year===latestYear&&placeOf(r)===1):null;
  const bird=$("#homeBird");
  if(bird&&latest){
    const p=bird.querySelector("p");
    if(p) p.innerHTML=`<strong>${esc(latest.champion||"Open")}</strong>Holding The Bird since ${esc(latest.year)}. Displayed somewhere visible. Returned to the first tee, cleaned, or the holder plays from the back tees.`;
  }
}
```

Add CSS beside the existing `.entry` rules (find the `.entry-year`/`.entry-name` block and extend it):

```css
.entry-minor{opacity:.72}
.entry-minor .entry-name{font-size:.95em}
.entry-roster{font-size:.78rem;color:var(--sage);margin-top:2px;font-weight:400;letter-spacing:.02em}
```

- [ ] **Step 5:** `npm test` → **148/148**. Commit: `git add index.html fixtures/champions.csv test/smoke.mjs && git commit -m "feat: H-PODIUM — Champions place/players, per-year podium, dupe/typo place flags (§15)"`.

---

### Task 3: D-DRAFT — public #draft board (pool / drafted, win badges, nav)

**Files:** Modify `index.html` (new section after the board section ~line 518; nav link after Board ~406; `renderDraft` + `champPodium` functions; `renderAll` ~2251; NAV priorities ~2275; CSS), `fixtures/field.csv` (append `strengths` header + values on TWO 2026 rows; rename ONE player). Test: `test/smoke.mjs` (S3/S4 updated in place; U6–U10 → suite 153).

**Interfaces:** Consumes Champions `place`/`players` columns and MIRRORS Task 2's place-parse semantics (blank→1 silent; 1–3→that; else null → NO badge, no extra flag — renderChampions already flags typos). Produces: `champPodium()` → `Map(nkey(player) → {wins:[years desc], minors:[{place,year} desc]})`; `renderDraft()`; DOM contract `#draft` section with `#draftPool`/`#draftTeams`, rows `.drow` with the player name isolated in `.drow-player` (badges live OUTSIDE that span); nav gains `<a href="#draft">Draft</a>`.

- [ ] **Step 1 (fixture):** In `fixtures/field.csv`:
  1. Append `,strengths` to the header line.
  2. Append a value to exactly two 2026 rows — `2026,Duck,Duck,2019,8,In,TRUE,` → `2026,Duck,Duck,2019,8,In,TRUE,,steady putter` and `2026,Tex,Tex,2019,18,In,TRUE,` → `2026,Tex,Tex,2019,18,In,TRUE,,long drives`.
  3. Rename the lastname-first player to N-FULLNAMES form: the row `2026,"Johnson, Wade",Sully,2022,12,In,TRUE,` becomes `2026,Wade Johnson,Sully,2022,12,In,TRUE,` (quotes drop — no comma left). Reviewer-verified: no other check greps "Johnson"; A3's joined-name expectation was already rewritten in Task 1. This kills the comma-separator/lastname-first collision the old spelling would create in Champions.players.
  4. **Every other row stays byte-identical** (no trailing commas — `toObjects` tolerates short rows; group W's raw-string surgery on `2027,Hammer,,,,,,` depends on it).
- [ ] **Step 2 (RED):** Update S3/S4 **in place** (test/smoke.mjs ~1334, ~1352) — Draft enters both nav priorities:

```js
  check("S3: S-NAV off-season order — Home, Next Year, Field, Draft lead the nav (first_tee pinned far-future via override, A6 — can't go red during the real event window)",
    navLinksText.slice(0, 4).join(",") === "home,nextyear,field,draft",
    navLinksText.join(","));
```

```js
  check("S4: S-NAV event-window order — Board, Draft, Pairings, Calcutta lead the nav (first_tee = today, inside ±3 days)",
    navLinksTextS4.slice(0, 4).join(",") === "board,draft,pairings,calcutta",
    navLinksTextS4.join(","));
```

Then append to the group U section:

```js
{
  // D-DRAFT: pool/drafted split + U-POOL filter + U-TOKENS badges.
  // Field: 4-player Duck team drafted; Wade Boggs + Jake in the pool;
  // Ghost(out)/Blade(wd)/Crash(declined) excluded. Champions: Wade wins 2024
  // (messy-token spelling — normalization), Jake takes 2nd 2023, and
  // "Jakeb Smith" must NOT badge Jake (exact-token, never substring).
  const fieldU2 = [
    "year,player,team,since,handicap,status,deposit,paid_date,strengths",
    "2026,Duck,Duck,2019,8,In,TRUE,,steady putter",
    "2026,Hammer,Duck,2019,10,In,TRUE,,",
    "2026,Sully,Duck,2021,15,In,TRUE,,",
    "2026,Tank,Duck,2026,20,In,TRUE,,",
    "2026,Wade Boggs,,2022,9,In,TRUE,,long drives",
    "2026,Jake,,2024,,In,TRUE,,",
    "2026,Ghost,,2020,12,out,,,",
    "2026,Blade,,2020,13,wd,,,",
    "2026,Crash,,2020,14,declined,,,",
  ].join("\n");
  const champsU2 = [
    "year,champion,score,place,players",
    '2024,Duck,151 (+7),,"Jakeb Smith · wade  BOGGS"',
    '2023,Sully,150 (+6),2,"Jake, Bo"',
  ].join("\n");
  const fetchU2 = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldU2 }),
    champions: () => Promise.resolve({ ok: true, status: 200, text: async () => champsU2 }),
  });
  const domU2 = makeDom("", fetchU2);
  const docU2 = domU2.window.document;
  await until(() => docU2.querySelectorAll("#draftPool .drow, #draftPool .lb-empty").length > 0);

  const poolRows = [...docU2.querySelectorAll("#draftPool .drow")];
  const poolNames = poolRows.map(r => r.querySelector(".drow-player")?.textContent.trim());
  check("U6: U-POOL — pool = active-season blank-team rows minus out/wd/declined, handicap ascending with blank handicaps last",
    poolRows.length === 2 && poolNames[0] === "Wade Boggs" && poolNames[1] === "Jake",
    JSON.stringify(poolNames));

  const wade = poolRows.find(r => r.textContent.includes("Wade Boggs"));
  const jake = poolRows.find(r => r.querySelector(".drow-player")?.textContent.trim() === "Jake");
  check("U7: U-TOKENS — Wade Boggs gets 🏆 2024 (messy token normalized), Jake gets a lighter 2nd '23 and NO trophy (Jakeb must not match Jake); strengths render",
    !!wade && /🏆/.test(wade.textContent) && /2024/.test(wade.querySelector(".pod-win")?.textContent || "")
    && /long drives/.test(wade.textContent)
    && !!jake && !/🏆/.test(jake.textContent) && /2nd/.test(jake.querySelector(".pod-minor")?.textContent || ""),
    "wade=" + (wade?.textContent || "").slice(0, 120) + " jake=" + (jake?.textContent || "").slice(0, 120));

  const teamGroups = [...docU2.querySelectorAll("#draftTeams .draft-team")];
  const duckNames = teamGroups.length === 1
    ? [...teamGroups[0].querySelectorAll(".drow-player")].map(e => e.textContent.trim()) : [];
  check("U8: D-DRAFT — drafted column groups by team, captain FIRST, all four members listed",
    teamGroups.length === 1 && duckNames[0] === "Duck"
    && ["Hammer","Sully","Tank"].every(n => duckNames.includes(n)),
    JSON.stringify(duckNames));
  domU2.window.close();
}
{
  // Honest empty state: base 2026 field is fully drafted → the pool announces
  // draft complete. Own dom — the main one is closed upstream.
  const domU9 = makeDom("");
  const docU9 = domU9.window.document;
  await until(() => docU9.querySelectorAll("#lbBody .lb-row").length > 0);
  const poolEmpty = docU9.querySelector("#draftPool")?.textContent || "";
  check("U9: D-DRAFT — all-drafted pool renders 'draft complete' empty state on the default fixture",
    /pool empty — draft complete/i.test(poolEmpty), poolEmpty.slice(0, 120));
  domU9.window.close();
}
{
  // No active-season Field rows at all → the view says so, honestly. Gate on
  // the DISAPPEARANCE of #draftPool: the static markup ships the Pool/Drafted
  // shell, so a textContent-length gate would fire before the fetch resolves;
  // the empty-state branch replaces #draftBody's innerHTML, destroying the node.
  const fieldNone = "year,player,team,since,handicap,status,deposit,paid_date,strengths\n2027,Duck,,,,,TRUE,2026-08-20,\n";
  const fetchNone = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldNone }),
  });
  const domNone = makeDom("", fetchNone);
  const docNone = domNone.window.document;
  await until(() => !docNone.querySelector("#draftPool"));
  check("U10: D-DRAFT — zero active-season Field rows renders the view's own note (no fabricated pool)",
    /lights up|fills in/i.test(docNone.querySelector("#draftBody")?.textContent || ""),
    (docNone.querySelector("#draftBody")?.textContent || "").slice(0, 120));
  domNone.window.close();
}
```

- [ ] **Step 3:** Run `npm test` — S3/S4 + U6–U10 FAIL (no #draft section yet; `until` timeouts on the missing selectors are the expected failure mode). Nothing else may be red.
- [ ] **Step 4 (GREEN):** In `index.html`:

**(a)** Nav link (line ~406, after Board): `<a href="#draft">Draft</a>`

**(b)** New section immediately after the board section's `</section>` (~line 518):

```html
<section class="band view" data-view="draft" id="draft">
  <div class="wrap">
    <p class="eyebrow">Friday night</p>
    <h2>The Draft</h2>
    <p class="lede">Captains pick from the pool. Drafting someone = filling their team cell on the Field tab — this board follows the sheet live.</p>
    <div id="draftBody">
      <div class="draft-cols">
        <div><h3 class="draft-h">Pool</h3><div id="draftPool"></div></div>
        <div><h3 class="draft-h">Drafted</h3><div id="draftTeams"></div></div>
      </div>
    </div>
  </div>
</section>
```

**(c)** CSS (beside the `.fld` rules — this sits OUTSIDE K5's guarded slice, so wrap long free text explicitly; the page must never scroll sideways):

```css
.draft-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px}
@media(max-width:720px){.draft-cols{grid-template-columns:1fr}}
.draft-h{font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sage);margin:0 0 10px}
.drow{display:grid;grid-template-columns:minmax(0,1.5fr) auto;gap:2px 10px;padding:9px 0;border-bottom:1px solid rgba(200,162,74,.14)}
.drow-name{font-weight:600;overflow-wrap:anywhere}
.drow-hcp{color:var(--bone);font-variant-numeric:tabular-nums;text-align:right}
.drow-meta{grid-column:1 / -1;font-size:.8rem;color:var(--sage);overflow-wrap:anywhere}
.pod-win{color:var(--brass);margin-right:8px}
.pod-minor{opacity:.7;margin-right:8px}
.draft-team{margin:0 0 18px}
.draft-team .drow{padding:6px 0}
```

**(d)** Functions — place after `renderField` (~1418):

```js
/* ---------- v2.5 draft board (D-DRAFT §15) ---------- */
// U-TOKENS: Champions.players → exact-token podium index. Split on the spec's
// separators, nkey each token, EXACT match only — "Jake" never matches "Jakeb".
// Place semantics MIRROR renderChampions: blank = 1st; "1"-"3" = that place;
// anything else is a typo — no badge fabricated (renderChampions flags it).
function champPodium(){
  const m=new Map();
  (STATE.data.champions||[]).filter(r=>r.players).forEach(r=>{
    const s=String(r.place||"").trim();
    const place=!s?1:(parseInt(s,10)>=1&&parseInt(s,10)<=3?parseInt(s,10):null);
    if(place===null) return;
    String(r.players).split(/,|·|\/|&|\||\band\b/i).map(nkey).filter(Boolean).forEach(k=>{
      if(!m.has(k)) m.set(k,{wins:[],minors:[]});
      if(place===1) m.get(k).wins.push(r.year);
      else m.get(k).minors.push({place,year:r.year});
    });
  });
  m.forEach(p=>{ p.wins.sort((a,b)=>parseInt(b,10)-parseInt(a,10));
    p.minors.sort((a,b)=>parseInt(b.year,10)-parseInt(a.year,10)); });
  return m;
}
function renderDraft(){
  const body=$("#draftBody"); if(!body) return;
  // Pinned to activeSeason() end-to-end — the draft never follows the archive
  // year picker (STATE.year), so rosterMap() must not be used here.
  const season=activeSeason();
  const rows=(STATE.data.field||[]).filter(r=>r.player&&r.year===season);
  if(!rows.length){
    body.innerHTML='<div class="lb-empty">The draft board lights up when this season\'s Field tab fills in.</div>';
    return;
  }
  if(!body.querySelector("#draftPool")){                    // restore columns after an empty-state render
    body.innerHTML='<div class="draft-cols"><div><h3 class="draft-h">Pool</h3><div id="draftPool"></div></div>'+
      '<div><h3 class="draft-h">Drafted</h3><div id="draftTeams"></div></div></div>';
  }
  // U-POOL: blank team AND status not in {out, wd, declined}. Blank team is
  // NORMAL here (E-TEAM) — the pool is the point; never flag it.
  const excluded=new Set(["out","wd","declined"]);
  const pool=rows.filter(r=>!String(r.team||"").trim()&&!excluded.has(nkey(r.status)));
  const drafted=rows.filter(r=>String(r.team||"").trim());
  const pod=champPodium();
  const seasonInt=parseInt(season,10);
  const hnum=v=>{ const n=parseFloat(String(v||"").replace(/[^0-9.\-]/g,"")); return isNaN(n)?Infinity:n; };
  const podHTML=k=>{ const p=pod.get(k); if(!p) return "";
    const wins=p.wins.length?`<span class="pod-win">🏆 ${p.wins.map(esc).join(" · ")}</span>`:"";
    const minors=p.minors.length?`<span class="pod-minor">${p.minors.map(mm=>esc(mm.place+ordSuffix(mm.place)+" ’"+String(mm.year).slice(2))).join(" · ")}</span>`:"";
    return wins||minors?`<span class="drow-pod">${wins}${minors}</span>`:""; };
  const badgeHTML=r=>{ const b=seniorityBadge(r.since,seasonInt);
    return b==="ROOKIE"?'<span class="badge badge-rookie">ROOKIE</span>':(b?`<span class="badge">${esc(b)}</span>`:""); };
  const rowHTML=r=>`<div class="drow">
      <div class="drow-name"><span class="drow-player">${esc(r.player)}</span>${badgeHTML(r)}</div>
      <div class="drow-hcp">${r.handicap?esc(r.handicap):"—"}</div>
      <div class="drow-meta">${podHTML(nkey(r.player))}${r.strengths?`<span class="drow-str">${esc(r.strengths)}</span>`:""}</div>
    </div>`;
  $("#draftPool").innerHTML = pool.length
    ? [...pool].sort((a,b)=>hnum(a.handicap)-hnum(b.handicap)).map(rowHTML).join("")
    : '<div class="lb-empty">Pool empty — draft complete.</div>';
  // Drafted: grouped by team from THIS season's rows. Captain first (player ==
  // team). Captainless or stray groups still render — nothing with a name may
  // vanish, and nothing here flags (E-TEAM; rosterMap owns roster health).
  const byTeam=new Map();
  drafted.forEach(r=>{ const k=nkey(r.team);
    if(!byTeam.has(k)) byTeam.set(k,{captain:null,members:[]});
    const t=byTeam.get(k);
    if(nkey(r.player)===k&&!t.captain) t.captain=r; else t.members.push(r);
  });
  const teamsHTML=[...byTeam.values()].map(t=>
    `<div class="draft-team">${[...(t.captain?[t.captain]:[]),...t.members].map(rowHTML).join("")}</div>`).join("");
  $("#draftTeams").innerHTML = teamsHTML || '<div class="lb-empty">Nobody drafted yet.</div>';
}
```

**(e)** Wire in: `renderAll()` (~2251) gains `renderDraft();` after `renderField();`. NAV priorities (~2275) become:

```js
const NAV_OFF_PRIORITY=["home","nextyear","field","draft","rooms"];
const NAV_EVENT_PRIORITY=["board","draft","pairings","calcutta","rooms"];
```

- [ ] **Step 5:** `npm test` → **153/153** (S3/S4 green with Draft in the order, U6–U10 green, D3+Z5's exactly-7 flag pins still green — proof renderDraft and the fixture edits added no flags). Commit: `git add index.html fixtures/field.csv test/smoke.mjs && git commit -m "feat: D-DRAFT — public draft board, U-POOL filter, exact-token win badges, seasonal nav (§15)"`.
- [ ] **Step 6 (battery note, carried):** phone-width eyeball of `#draft` needs a real browser — record it on the final-review list alongside the standing grid phone-width residual (Riley's phone / authorized Chrome run; B6 — never drive Riley's own browser).

---

### Task 4: N-FULLNAMES + template columns + docs

**Files:** Modify `tools/make_template.py`, regenerate `tools/gfy-template.xlsx`, `tools/sheet-polish.gs` (one START HERE row), `README.md`. Test: `test/smoke.mjs` (U11/U12 → suite 155).

**Interfaces:** Consumes the column names locked by Tasks 2–3 (`place`, `players`, `strengths` — exact lowercase spellings). Produces nothing downstream; this closes the round.

- [ ] **Step 1 (RED):** Append to the group U section (source-parity pattern — same as groups P/T):

```js
{
  const py = readFileSync(path.join(ROOT, "tools", "make_template.py"), "utf8");
  check("U11: template generator carries the §15 columns — Champions place+players, Field strengths",
    /"place",\s*"players"/.test(py.slice(py.indexOf('"Champions"')))
    && /"strengths"/.test(py.slice(py.indexOf('"Field"'), py.indexOf('"Scores"'))),
    "");
  const gsPolish = readFileSync(path.join(ROOT, "tools", "sheet-polish.gs"), "utf8");
  check("U12: START HERE states the N-FULLNAMES convention (first + last, matching everywhere)",
    /first\s*\+\s*last/i.test(gsPolish),
    "");
}
```

Run `npm test` — U11/U12 FAIL.
- [ ] **Step 2 (GREEN — generator):** In `tools/make_template.py`, Field block: headers become `["year", "player", "team", "since", "handicap", "status", "deposit", "paid_date", "strengths"]`; append a strengths value to two sample rows (`"Duck"` row gains `"steady off the tee"`, `"Tex"` row gains `"long drives"`; every other row gains `""`). Add one comment line: `# strengths (§15) = captain-facing scouting note, shows on the public #draft board`. Champions block becomes:

```python
    "Champions": {
        # place (§15): 1/2/3 — BLANK means 1st (old rows keep working).
        # players: the winning roster, any separator (comma, ·, &, "and").
        "headers": ["year", "champion", "score", "place", "players"],
        "rows": [
            [2025, "Duck", "151 (+7)", "", "Duck · Hammer · Sully · Tank"],
            [2025, "Tex", "153 (+9)", 2, "Tex · Sock · Bear · Crash"],
            [2025, "Moose", "155 (+11)", 3, "Moose · Ghost · Blade · Zeke"],
            [2024, "Hammer", "149 (+5)", "", ""],
            [2019, "Tex", "Inaugural", "", ""],
        ],
    },
```

(Sample data stays short-form on purpose — it is obviously-sample; the CONVENTION lives in README/START HERE, N-FULLNAMES.) Regenerate: `python3 tools/make_template.py`. **The xlsx binary is NOT byte-reproducible** (openpyxl stamps created/modified timestamps into docProps and zip entries) — a binary diff on regeneration is expected; do NOT gate on md5. Verify CONTENT instead:

```bash
python3 - << 'EOF'
import openpyxl
wb = openpyxl.load_workbook("tools/gfy-template.xlsx")
ch = [c.value for c in wb["Champions"][1]]
fd = [c.value for c in wb["Field"][1]]
assert ch == ["year","champion","score","place","players"], ch
assert fd[-1] == "strengths" and fd[:8] == ["year","player","team","since","handicap","status","deposit","paid_date"], fd
print("template headers OK")
EOF
```

Expected output: `template headers OK`. Commit the regenerated binary once, alongside the .py.
- [ ] **Step 3 (GREEN — polish):** In `tools/sheet-polish.gs` `buildStartHere_`, insert ONE row into the `rows` array, directly after the last COLOR LEGEND line (the `"Orange tint = Rooms name not on Field"` row) — do NOT touch the `"Scoring form URL (paste once):"` row (it is the E-IDEM content anchor; the restore logic is a `findIndex` over the built array, so added rows are safe):

```js
    ["Names: FIRST + LAST on Field / Invites / Rooms (and the vault), spelled identically everywhere. Short team labels are fine on Scores / Pairings.", ""],
```

- [ ] **Step 4 (GREEN — README):** Three additions:
  1. New section right BEFORE `## Year to year`:

```markdown
## Names — the one convention

Field.player, Invites.player, Rooms.player (and the vault's Contacts.player)
carry **first + last name**, spelled identically everywhere — the site matches
them by exact normalized text, so "Wade B." on Rooms will not match
"Wade Boggs" on Field. Scores.team and Pairings follow the **team label**
(the captain's name), not player names — short forms are fine there.
```

  2. In `## Admin quick edits (cheat-sheet)` add two lines: `Champions place/players — place 1/2/3 (blank = 1st, old rows fine); players = that team's roster, any separator. Backfill history and the podium + draft badges light up.` and `Field strengths — optional scouting note; shows on the public #draft board next to the player.`
  3. Same cheat-sheet: `Draft night — the site's Draft tab reads the sheet live: filling a player's team cell on Field IS drafting them; the pool empties as you type.`
- [ ] **Step 5:** Verify README claims against source (view name `#draft`, column spellings, polish function text). `npm test` → **155/155**. Commit: `git add tools/make_template.py tools/gfy-template.xlsx tools/sheet-polish.gs README.md test/smoke.mjs && git commit -m "feat: N-FULLNAMES convention + §15 template columns (place/players/strengths) + draft docs"`.

---

## Self-review notes (inline)

- Group letter U is free (in use: A–I, K, L, M, N, P, Q, R, S, T, V, W, Z); the tally regex `^([A-Z])\d+:` matches U1–U12.
- Suite arithmetic (A6 Bear retained — five expectedA rows): 143 baseline → T1 +2 (145) → T2 +3 (148) → T3 +5 (153) → T4 +2 (155). Counts are targets; the controller verifies the real total at each gate.
- B-CAPTAIN deliberately does NOT touch Money/Calcutta/Shame/renderHolePanel (scope pin + explicit hole-panel decision) — I1/I2's joined "Moose & Sock" assertions stay green because Money still uses `teamLabel`.
- D3 AND Z5 (both pin exactly 7 main-dom health flags) are the standing tripwires that Tasks 2–3's fixture edits and renderDraft added zero flags. If either goes red in any task, the task broke E-TEAM or fixture hygiene — fix the code, never the pins.
- `renderChampions` empty-fallback branch is byte-identical to today's (Z-group unconfigured-deploy checks depend on it).
- `champPodium` reads ALL champions rows with `players` (not year-filtered): podium history spans years by design. Its place-parse mirrors `renderChampions`'s `placeOf` exactly — typo'd places award nothing and are flagged once (by renderChampions, not twice).
- U9's regex matches the exact copy "Pool empty — draft complete." (case-insensitive); the em dash in the assertion must be the same character as the copy's — keep them in sync.
- The plan reviewer verified: harness signatures (until/check/capMarked/withOverride/makeDom), the U1 variant board/grid rendering path, K3/K7/L2 row lookups surviving captain-only, field.csv string-surgery safety, FPRINT, W28-W30/P5, VIEWS/nav count independence, tally coverage, START HERE anchor safety, U11 slice disambiguation (Payout's `"place"` excluded), CSS var names, README anchors.
