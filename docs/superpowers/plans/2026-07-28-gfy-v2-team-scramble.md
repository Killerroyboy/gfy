# GFY v2 Team Scramble Conversion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the deployed GFY site from individual stroke play to a 2-day team scramble for 50+ attendees, with tabbed navigation, a collections-grade Calcutta board, a Next Year deposit board, seniority tracking, and a resilience layer against silently-stale/silently-wrong data.

**Architecture:** Single-file static app (`index.html`) over a published Google Sheet (11 CSV tabs), unchanged. v2 adds a canonical-name data layer, per-tab fault-isolated fetching, a hash router that turns the existing sections into tabs, and team-aware renderers. All behavior is verified through `test/smoke.mjs` (jsdom v29) against hand-derived fixtures.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step, no runtime deps. Tests: node + jsdom 29 (already installed). Template: python3 + openpyxl.

**Spec:** `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` — section references like §4 point there.

## Global Constraints

- Single file app: all JS stays inline in `index.html`; `config.js` schema is UNCHANGED in v2.
- No new dependencies, no external hosts beyond the existing Google Fonts links.
- jsdom v29 has **no `window.fetch`** — tests stub it via `beforeParse` (pattern already in `test/smoke.mjs`).
- **No buyback anywhere** (spec §2): one debt per lot, owner collects winnings in full.
- Canonical name key everywhere a name crosses tabs (spec S-KEY): `nkey = s => String(s||"").trim().replace(/\s+/g," ").toLowerCase()`.
- Active season (S-SEASON) = max year in Scores; fallback Info `first_tee` year; never null.
- **`git commit` only — NEVER `git push`** (fence-gated; Riley authorizes the deploy crossing at the end).
- Run tests as `npm test` from repo root `/Users/riley/Code/gfy`. The suite prints per-group results; a task is done only when its named groups pass AND no previously-green group regressed.
- `?debug=1` contract from v1 stays: no cache writes in debug, panel + console reporting.
- Don't touch `~/Downloads/gfy-v5.html` or anything outside the repo.

## Task overview / dependency order

1. v2 fixtures (data + hand-derived expectations)
2. smoke.mjs v2 rewrite (suite goes red on purpose; exact red/green inventory)
3. Data layer: canonical keys, scoring guards, roster, season (groups A–C green)
4. Resilience: per-tab fetch, fingerprints, health strip, stamps (group D green)
5. Tab shell + router + Home (group E green)
6. Board + Field team views + seniority (group F green)
7. Calcutta collections + Next Year board (groups G–H green)
8. Scramble shame, net-disable, copy sweep (group I green; suite fully green)
9. Crest rebuild + variants page (visual gate for Riley)
10. Template v2 + README v2
11. Deploy battery (Riley-gated push)

---

### Task 1: v2 fixtures

**Files:**
- Modify: `fixtures/info.csv`, `fixtures/field.csv`, `fixtures/scores.csv`, `fixtures/calcutta.csv`, `fixtures/shame.csv`
- Keep unchanged: `fixtures/course.csv`, `fixtures/payout.csv`, `fixtures/schedule.csv`, `fixtures/pairings.csv`, `fixtures/ledger.csv`, `fixtures/champions.csv`

**Interfaces:**
- Produces: the exact CSV bytes below; every number in the "Derived expectations" table. Tasks 2–8 assert against these values verbatim.

**Scenario (season 2026, 5 teams, 9 rostered players + 1 new next-year payer):**

Teams: **Duck & Hammer**, **Sully & Johnson, Wade**, **Moose & Sock**, **Tex & Tank** (Tank is the rookie), **Bear** (solo captain). Course: v1 pars (out 36 / in 36 / 72).

Nasty cases encoded: lowercase `duck` round-2 row (S-KEY merge) · Sully round 1 split across two rows by two editors with one conflicting cell (S-MERGE: h9 = 5 then 6, later wins) · Moose rounds labeled `Round One` / `Round Two` as words (S-ROUND) with the second row's **year blank** (S-YEARBLANK) · `h1 = 0` in Tex round 2 (S-ZERO) · phantom captain row `Hamer` with r1 = 70 that would lead if not excluded (S-RANKED) · quoted comma name kept from v1 · totals-only row (Bear).

- [ ] **Step 1: Write the fixtures**

`fixtures/info.csv` (note the two new keys):

```csv
key,value
dates,Aug 14–16
course,Meadow Creek
lodging,Bear Creek Lodge
format,2-day scramble
first_tee,2026-08-15T09:00:00-06:00
est_year,2019
calcutta_rake,10
calcutta_basis,gross
deposit_amount,200
payment_handle,Venmo @gfy-duck
```

`fixtures/field.csv`:

```csv
year,player,team,since,handicap,status,deposit,paid_date
2026,Duck,Duck,2019,8,In,TRUE,
2026,Hammer,Duck,2019,10,In,TRUE,
2026,Sully,Sully,2021,15,In,TRUE,
2026,"Johnson, Wade",Sully,2022,12,In,TRUE,
2026,Moose,Moose,2019,9,In,TRUE,
2026,Sock,Moose,2020,14,In,TRUE,
2026,Tex,Tex,2019,18,In,TRUE,
2026,Tank,Tex,2026,20,In,TRUE,
2026,Bear,Bear,2023,11,In,TRUE,
2027,Duck,,,,,TRUE,2026-08-20
2027,Tank,,,,,TRUE,2026-08-22
2027,Crash,,,,,TRUE,2026-09-01
2027,Hammer,,,,,,
2027,Sock,,,,out,,
```

`fixtures/scores.csv` — **write with CRLF line endings** (keep v1's `python3` CRLF conversion one-liner from the repo history: read bytes, replace `\n` with `\r\n` after normalizing):

```csv
year,team,round,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12,h13,h14,h15,h16,h17,h18,r1,r2
2026,Duck,1,4,4,4,5,4,4,4,4,5,4,5,3,4,4,4,3,5,4,,
2026,duck,2,4,4,3,5,3,4,3,4,4,4,5,4,5,4,5,3,5,5,,
2026,Sully,1,4,4,3,6,4,4,3,4,5,,,,,,,,,,,
2026,Sully,1,,,,,,,,,6,4,5,3,4,4,4,3,5,5,,
2026,Sully,2,4,4,4,5,4,4,3,4,5,4,5,3,4,4,4,3,5,4,,
2026,Moose,Round One,4,4,3,5,4,4,7,4,5,4,5,3,4,4,4,3,5,4,,
,Moose,Round Two,5,5,3,5,4,4,3,4,5,4,5,3,4,4,4,3,5,4,,
2026,Tex,1,4,5,3,5,5,5,3,5,6,4,5,3,4,4,4,3,5,4,,
2026,Tex,2,0,4,3,5,4,4,3,4,,,,,,,,,,,,
2026,Bear,,,,,,,,,,,,,,,,,,,,76,76
2026,Hamer,1,,,,,,,,,,,,,,,,,,,70,
```

`fixtures/calcutta.csv`:

```csv
year,team,owner,price,collected
2026,Duck,Tex,120,TRUE
2026,Sully,Tex,100,
2026,Moose,Sock,80,
2026,Tex,Bear,60,TRUE
2026,Bear,Duck,40,TRUE
```

`fixtures/shame.csv`:

```csv
year,award,player,detail
2026,Most balls lost,Tank,"Eleven, nine to the creek. Rookie record."
```

- [ ] **Step 2: Hand-derive and record the expectations table**

Verify every line below by hand against the CSVs (do the arithmetic; if any line disagrees, STOP — the fixture or this table is wrong, fix before proceeding):

```
Board (gross, rel = strokes − par-played):
  1  Duck & Hammer     F        74  74  148  +4   (R2 via lowercase "duck": out 34, in 40)
  1  Sully & J. Wade   F        75  73  148  +4   (R1 merged: out 38 after h9 conflict 5→6, in 37)
  3  Tex & Tank        R2 · 7   77  27  104  +5   (R2: h1=0 ignored, h2–h8 par = 27, E)
  4  Moose & Sock      F        76  74  150  +6   (word rounds normalized; R2 row year-blank → 2026)
  5  Bear              totals   76  76  152  +8   (r1/r2 totals row)
  EXCLUDED: "Hamer" r1=70 (unmatched captain — would rank 1st if included)
Calcutta: pot $400 · rake $40 (10%) · payable $360 · top lot $120 · Duck
  Outstanding: $180 total — Tex $100 (1 of 2 lots), Sock $80
  Payout (3 places, tie 1&2 splits 50+30): Duck lot → Tex $144 · Sully lot → Tex $144 · Tex lot → Bear $72 (owners, 100%)
Next Year (anchor 2027, picker-independent): "3 of 9 paid"
  Paid order: Duck (Aug 20) → Tank (Aug 22) → Crash (Sep 1; NOT in 2026 roster — union)
  Owing: Hammer, Sully, Johnson Wade, Moose, Tex, Bear  ·  Sock suppressed (out)
  Amount $200 · handle "Venmo @gfy-duck"
Seniority: Duck/Hammer/Moose/Tex 8th year · Sock 7th · Sully 6th · Wade 5th · Bear 4th · Tank ROOKIE (class of 2026)
Shame (computed, hole-carded teams only): Worst team hole = Moose & Sock, 7 on the par-3 7th (+4), round 1
  Back-nine collapse = Duck & Hammer, R2 (out 34 → in 40, +6 swing)
  Fewest birdies = Sully & Johnson, Wade (0; first zero in row order)
Health flags (exactly 3): unmatched team "Hamer" · merge conflict Sully R1 h9 · blank year defaulted (Moose Round Two)
```

- [ ] **Step 3: Commit**

```bash
git add fixtures/
git commit -m "test: v2 team-scramble fixtures with adversarial cases"
```

---

### Task 2: smoke.mjs v2 rewrite (the suite goes red on purpose)

**Files:**
- Modify: `test/smoke.mjs` (keep the existing helpers verbatim: `makeDom`, `until`, `check`, the `beforeParse` fetch stub, the config-serving interceptor; keep `TABS`/`GIDS`/`FIXTURES` loading)

**Interfaces:**
- Consumes: fixture bytes + expectations table from Task 1.
- Produces: assertion groups A–I named below; `check(name, ok, detail)` names are prefixed `"A1:"`, `"B2:"` etc. Tasks 3–8 claim groups by prefix. Final target: **38 assertions**, all green after Task 8.

Group inventory (each `check` call below is real code to write; group → spec rule):

- **A — canonical keys & scoring guards (Task 3):**
  - A1 board has exactly 5 rows (Hamer excluded, duck merged — not 6, not 7)
  - A2–A6 the five rows match the expectations table exactly (pos/name/thru/r1/r2/total/topar); team display is `"Duck & Hammer"` with `class="cap"` mark on the captain span
  - A7 Sully R1 total is 75 (h9 conflict resolved to 6)
  - A8 Tex thru is `"R2 · 7"` (h1=0 not a score)
  - A9 Moose has BOTH rounds (76/74 — word labels didn't collide)
- **B — season/year (Task 3):** B1 with the 2027 Field rows present and 2026 selected, the Field tab shows only 2026 rows (no all-years merge); B2 an empty-Scores variant (serve `scores.csv` header-only for a second dom) still shows the 2026 Field roster, not merged years
- **C — roster (Task 3):** C1 Field tab groups 5 teams; C2 Bear renders as roster-of-one; C3 rookie strip lists exactly Tank
- **D — resilience (Task 4):** D1 with the scores tab stubbed to HTTP 500, the OTHER sections still render live data and the board shows its own stale/failed stamp; D2 swapped field/scores gids ⇒ health strip reports fingerprint mismatch (and debug panel shows it too); D3 health strip shows exactly the 3 expected flags with the fixture data; D4 calcutta + next-year sections have their own "Updated" stamps
- **E — tabs/Home (Task 5):** E1 `#calcutta` hash shows only the calcutta view; E2 Home shows countdown pre-event (fixture `first_tee` is future at test time… see Task 5 note: serve a far-future variant to make this deterministic); E3 a past-`first_tee` info variant flips Home to the status strip reading `"3 of 9 paid"` and `"$180"`; E4 Bird holder on Home = latest Champions row
- **F — seniority/Field (Task 6):** F1 badges ("8th year" ×4, ROOKIE on Tank); F2 veterans-first ordering (Duck-2019 group before Bear-2023)
- **G — calcutta collections (Task 7):** G1 tiles pot/rake/payable/top exactly per table; G2 Outstanding rollup `Tex $100` + `Sock $80`, total $180; G3 collected lots marked; G4 payout rows exactly per table (tie asterisks, owners, $144/$144/$72, no player-cut column)
- **H — next year (Task 7):** H1 header "3 of 9 paid"; H2 paid order Duck→Tank→Crash with dates; H3 Crash present (union); H4 Sock absent (out); H5 amount + tappable handle rendered; H6 board pinned to 2027 even when the year picker selects an archive year
- **I — shame/net/copy (Task 8):** I1 worst-team-hole card per table; I2 back-nine-collapse card per table; I3 committee card (Tank) renders; I4 no "Player" header remains in board/calcutta DOM (label sweep); I5 lede/rules text contains no "buy back" and no "Stroke play"

- [ ] **Step 1: Write the full assertion code for groups A–I** (every check coded now, against Task 1's table — this is ~250 lines; the harness helpers already exist). Where a group needs a variant dom (B2, D1, D2, E2/E3), build it with a second `makeDom` whose fetch stub serves the altered bytes (pattern: wrap the default stub, override one tab).
- [ ] **Step 2: Run `npm test`. Expected: groups mostly RED.** Record the exact tally in the commit message. Sanity: v1 code must still pass A1's *row-count-not-7* half? No — expect A1 RED (v1 renders `duck`, `Hamer` as separate rows). Nothing should ERROR (harness must run to completion).
- [ ] **Step 3: Commit** — `git add test/smoke.mjs && git commit -m "test: v2 assertion suite (red: <tally>) — burn-down begins"`

---

### Task 3: Data layer — canonical keys, scoring guards, roster, season

**Files:**
- Modify: `index.html` (utils block after `const yes=…`; `buildPlayers`; `thruLabel`; `renderYears`; `forYear` stays)

**Interfaces:**
- Produces (later tasks call these exactly):
  - `nkey(s) -> string` — canonical name key
  - `HEALTH: string[]` — human-readable data flags, reset each load, appended by every layer
  - `activeSeason() -> string` — S-SEASON year as string, never null
  - `rosterMap() -> Map<nkeyTeam, {captain:string, members:string[], since:{[player]:string}}>` (captain/members in original casing, members excludes captain)
  - `teamLabel(key) -> {html, text}` — `"Duck & Hammer"`, captain span `class="cap"`
  - `buildPlayers()` — same return shape as v1 (`{name,rounds,roundTotals,played,total,rel,net,hcp}`) plus `key` (nkey) and `fromTotals:boolean`; only roster-matched teams when a roster exists

- [ ] **Step 1: Add the utility layer** (insert after the `yes=` line):

```js
const nkey=s=>String(s||"").trim().replace(/\s+/g," ").toLowerCase();
let HEALTH=[];
const flag=m=>{ if(!HEALTH.includes(m)) HEALTH.push(m); };
const posInt=v=>{ const n=parseInt(v,10); return (isNaN(n)||n<=0)?null:n; };
const WORDROUND={one:"1",two:"2",three:"3"};
function roundNorm(v){
  const d=String(v||"").replace(/[^0-9]/g,"");
  if(d) return d;
  const w=String(v||"").trim().toLowerCase().split(/\s+/).pop();
  return WORDROUND[w]||"1";
}
function activeSeason(){
  const ys=(STATE.data.scores||[]).map(r=>parseInt(r.year,10)).filter(n=>n>0);
  if(ys.length) return String(Math.max(...ys));
  const t=new Date(INFO.first_tee||CONFIG.FIRST_TEE);
  return String(isNaN(t)?new Date().getFullYear():t.getFullYear());
}
function rosterMap(){
  const m=new Map();
  (STATE.data.field||[]).filter(r=>r.player&&r.team&&r.year===STATE.year).forEach(r=>{
    const k=nkey(r.team);
    if(!m.has(k)) m.set(k,{captain:null,members:[],since:{}});
    const t=m.get(k);
    if(nkey(r.player)===k){ if(t.captain) flag(`two captains claim team "${r.team}"`); t.captain=r.player; }
    else t.members.push(r.player);
    if(r.since) t.since[r.player]=r.since;
  });
  m.forEach((t,k)=>{ if(!t.captain) flag(`team "${k}" has no captain row (player must equal team)`); });
  return m;
}
function teamLabel(key){
  const t=rosterMap().get(key);
  if(!t||!t.captain){ const raw=key; return {html:esc(raw),text:raw}; }
  const names=[t.captain,...t.members];
  return {
    html:names.map((n,i)=>`<span${i===0?' class="cap"':''}>${esc(n)}</span>`).join(" &amp; "),
    text:names.join(" & ")
  };
}
```

- [ ] **Step 2: Rewrite `buildPlayers`** (replace the whole function; key changes: keyed by `nkey(s.team||s.player)`, roster filter with flag, merge-not-overwrite rounds with conflict flags, `posInt` for every score, `roundNorm`, `fromTotals`):

```js
function buildPlayers(){
  const roster=rosterMap();
  const scores=forYear(STATE.data.scores,STATE.year).filter(s=>(s.team||s.player));
  const pars=courseMap();
  const byKey={};
  scores.forEach(s=>{
    const raw=(s.team||s.player), k=nkey(raw);
    if(roster.size&&!roster.has(k)){ flag(`score row for unknown team "${raw}" — not counted`); return; }
    if(!byKey[k]) byKey[k]={key:k,name:(roster.get(k)||{}).captain||raw,rounds:{},fromTotals:false};
    const rd=roundNorm(s.round);
    const holes={}; let any=false;
    HOLES.forEach(h=>{ const v=posInt(s["h"+h]); if(v!==null){ holes[h]=v; any=true; } });
    if(any){
      const ex=byKey[k].rounds[rd];
      if(ex&&ex.holes){
        Object.keys(holes).forEach(h=>{
          if(ex.holes[h]!==undefined&&ex.holes[h]!==holes[h])
            flag(`conflicting entries for ${byKey[k].name} R${rd} h${h} (${ex.holes[h]} vs ${holes[h]}) — using ${holes[h]}`);
          ex.holes[h]=holes[h];
        });
      } else byKey[k].rounds[rd]={holes};
    } else {
      const r1=posInt(s.r1), r2=posInt(s.r2);
      if(r1!==null){ byKey[k].rounds["1"]={total:r1}; byKey[k].fromTotals=true; }
      if(r2!==null){ byKey[k].rounds["2"]={total:r2}; byKey[k].fromTotals=true; }
    }
  });
  const hcp={}; (STATE.data.field||[]).forEach(f=>{ if(f.player) hcp[nkey(f.player)]=num(f.handicap); });
  return Object.values(byKey).map(p=>{
    let played=0, strokes=0, parPlayed=0;
    const roundTotals={};
    Object.entries(p.rounds).forEach(([rd,r])=>{
      if(r.holes){
        const hs=Object.keys(r.holes).map(Number);
        roundTotals[rd]=hs.reduce((s,h)=>s+r.holes[h],0);
        played+=hs.length; strokes+=roundTotals[rd];
        if(pars) parPlayed+=hs.reduce((s,h)=>s+(pars[h]||0),0);
      } else {
        roundTotals[rd]=r.total; played+=18; strokes+=r.total;
        if(pars) parPlayed+=Object.values(pars).reduce((a,b)=>a+b,0);
      }
    });
    const h=hcp[nkey(p.name)]||0;
    return { key:p.key, name:p.name, rounds:p.rounds, roundTotals, played, fromTotals:p.fromTotals,
      total: played?strokes:null,
      rel: (pars&&played) ? strokes-parPlayed : null,
      net: played ? Math.round(strokes-h*played/18) : null, hcp:h };
  });
}
```

- [ ] **Step 3: `thruLabel` totals honesty + season wiring.** In `thruLabel`, before the F checks add: `if(p.fromTotals) return Object.keys(p.rounds).length>1?"totals":"R"+Object.keys(p.rounds)[0]+" · total";`. In `renderYears` replace the assignment line with `if(!STATE.year||!ys.includes(STATE.year)) STATE.year=ys.includes(activeSeason())?activeSeason():(ys[0]??activeSeason());`. Add blank-year defaulting in `paint()` before rendering: for tabs `["field","scores","calcutta","schedule","pairings","ledger","shame"]`, rows where `!r.year` and the tab has any year → `r.year=activeSeason()` + `flag("row with blank year defaulted to "+r.year+" ("+tab+")")` — implement as a `normalizeYears(data)` function called at the top of `paint()`, and reset `HEALTH=[]` there too. Board renderer: swap `esc(p.name)` for `teamLabel(p.key).html` and use `p.key` for card ids and `data-player`.
- [ ] **Step 4: Run `npm test`. Expected: groups A, B, C fully PASS; D–I still red; no prior group regressed.**
- [ ] **Step 5: Commit** — `git commit -am "feat: canonical-key data layer, scoring guards, roster, season anchor (groups A-C green)"`

---

### Task 4: Resilience — per-tab fetch, fingerprints, health strip, stamps

**Files:**
- Modify: `index.html` (`pull`, `load`, `paint`, cache helpers, `pullDebug`; add `renderHealth`; add stamps + small CSS for `.health-strip`)

**Interfaces:**
- Produces:
  - cache key becomes `"gfy-cache-v2"`, shape `{tabs:{[tab]:{rows,at}}}`
  - `FPRINT` = `{info:["key"],course:["hole"],field:["player"],scores:["h1","r1"],schedule:["event"],pairings:["players"],calcutta:["price"],payout:["share"],ledger:["buyin"],champions:["champion"],shame:["award"]}` — a tab passes if ANY listed header is present
  - `pull(tab)` returns `{rows,at,live:boolean,err:string|null}` — never throws
  - `renderHealth()` paints `#healthStrip` (fixed element like `#debugPanel`, rust border, hidden when `HEALTH` empty)
  - per-section stamp ids: `#lbSync` `#schedSync` (existing) + `#calSync` `#nySync` (new, same `.sync` class)

- [ ] **Step 1: Rewrite the fetch/cache layer:**

```js
const FPRINT={info:["key"],course:["hole"],field:["player"],scores:["h1","r1"],
  schedule:["event"],pairings:["players"],calcutta:["price"],payout:["share"],
  ledger:["buyin"],champions:["champion"],shame:["award"]};
const BACKOFF={};   // tab -> next-allowed epoch ms
async function pull(tab){
  const gid=CONFIG.GID[tab];
  if(!CONFIG.PUB_ID||!gid) return {rows:null,at:0,live:false,err:null};
  if(BACKOFF[tab]&&Date.now()<BACKOFF[tab]) return cacheTab(tab,"backoff");
  try{
    const res=await fetch(`https://docs.google.com/spreadsheets/d/e/${CONFIG.PUB_ID}/pub?gid=${gid}&single=true&output=csv`);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const text=await res.text();
    if(/^\s*<(!doctype|html)/i.test(text)) throw new Error("HTML response — wrong PUB_ID or not published");
    const grid=parseCSV(text);
    const heads=grid.length?grid[0].map(h=>h.trim().toLowerCase()):[];
    if(!FPRINT[tab].some(h=>heads.includes(h)))
      throw new Error(`headers don't look like the ${tab} tab (gid swapped?)`);
    BACKOFF[tab]=0;
    return {rows:toObjects(grid),at:Date.now(),live:true,err:null};
  }catch(e){
    BACKOFF[tab]=Date.now()+Math.min(300000,(BACKOFF[tab]?120000:30000));
    return cacheTab(tab,(e&&e.message)||String(e));
  }
}
function cacheTab(tab,err){
  const c=readCache();
  const t=c&&c.tabs&&c.tabs[tab];
  return {rows:t?t.rows:null,at:t?t.at:0,live:false,err};
}
```

`load()` becomes: `if(DEBUG) return loadDebug();` then `const got=await Promise.all(TABS.map(pull));` assemble `data`, write cache as `{tabs:{[tab]:{rows,at}}}` **only for live tabs** (merge over previous cache), call `paint(data,got)`. `paint(data,results)` gains the results param: per-section stamps read their own tab's `{live,at,err}` — board stamp from `scores`, schedule from `schedule`, calcutta from `calcutta`, next-year from `field`; text `Updated N ago` / `Saved copy from N ago` / `"— "+err` when no cache either. Non-OK tabs append `flag(tab+": "+err)`. `renderHealth()` runs at the end of `paint`. `CACHE_KEY="gfy-cache-v2"`. `pullDebug` reuses `FPRINT` (add the same header check; keep its no-cache-write contract). Every renderer that can go empty paints its explicit empty state (`renderField`, `renderPairings`, `renderCalcutta`, `renderMoney`, `renderShame`, `renderSchedule`, `renderChampions` — replace each early `return` with an empty-state innerHTML write reusing the v1 placeholder sentences).

- [ ] **Step 2: `renderHealth` + strip element** (create-once pattern copied from `renderDebugPanel`, id `healthStrip`, `bottom:10px;right:10px`, border `#B0705E`, collapsed to `⚠ N data warnings` with `<details>` expansion listing `HEALTH` items).
- [ ] **Step 3: Run `npm test`. Expected: group D green (A–C stay green).** D1 exercises scores-500 partial render; D2 gid swap → fingerprint flag; D3 exact 3 flags; D4 stamps exist.
- [ ] **Step 4: Commit** — `git commit -am "feat: fault-isolated per-tab fetch, fingerprints, health strip, money stamps (group D green)"`

---

### Task 5: Tab shell — hash router + Home

**Files:**
- Modify: `index.html` (nav; new `#home` section; router JS at the end of the script; small CSS: `.view[hidden]{display:none}`)

**Interfaces:**
- Produces: `VIEWS=["home","board","field","pairings","calcutta","money","schedule","rules","champions","shame","photos","nextyear"]`; `showView(name)`; sections get `class="view" data-view="<name>"`; nav `<a href="#board">` etc.; `#nextyear` section SHELL only (`<section class="band view" data-view="nextyear" id="nextyear"><div class="wrap"><p class="eyebrow">Collections</p><h2>Next Year</h2><div id="nyBody"></div><p class="sync" id="nySync"></p></div></section>` — Task 7 fills `#nyBody`).

- [ ] **Step 1: Restructure.** Rename existing section ids where they collide with view names (`id="leaderboard"`→`data-view="board"`; keep inner ids). Home section: crest+wordmark+countdown+facts (moved from `<header class="hero">`), Bird holder (clone of the `.holder` block, fed by latest Champions row in `renderChampions`), status element `<div id="homeStatus"></div>`. Router:

```js
const VIEWS=["home","board","field","pairings","calcutta","money","schedule","rules","champions","shame","photos","nextyear"];
function showView(name){
  const v=VIEWS.includes(name)?name:"home";
  document.querySelectorAll(".view").forEach(s=>{ s.hidden=s.dataset.view!==v; });
  document.querySelectorAll(".nav a").forEach(a=>a.classList.toggle("active",a.hash==="#"+v));
}
window.addEventListener("hashchange",()=>showView(location.hash.slice(1)));
showView(location.hash.slice(1));
```

Date-aware Home (in `paint`): `const tee=new Date(INFO.first_tee||CONFIG.FIRST_TEE); const post=!isNaN(tee)&&Date.now()>tee.getTime()+3*86400000;` — pre: countdown as today; post: hide countdown, `#homeStatus` = `"<paid> of <shown> paid for <NEXT> · $<outstanding> Calcutta outstanding"` linking `#nextyear`/`#calcutta` (numbers from Task 7's `nextYearModel()`/`calcuttaModel()` — render "—" until those exist; E3 asserts after Task 7, note in suite: E3 is allowed to stay red until Task 7).

- [ ] **Step 2: Run `npm test`. Expected: E1, E2, E4 green; E3 red until Task 7 (documented). No regressions.**
- [ ] **Step 3: Commit** — `git commit -am "feat: hash-routed tab shell + slim Home (group E green except E3)"`

---

### Task 6: Field team view + seniority

**Files:**
- Modify: `index.html` (`renderField`; small CSS: `.team-group`, `.badge`, `.badge-rookie`, `.rookie-strip`)

**Interfaces:**
- Consumes: `rosterMap()`, `nkey`, `activeSeason()` (Task 3).
- Produces: `seniorityBadge(since, season) -> string` (`"8th year"` / `"ROOKIE"` / `""`), used verbatim by nothing else (self-contained view).

- [ ] **Step 1: Rewrite `renderField`.** Group rows by roster teams (fall back to v1 flat list when no `team` values). Order: teams by captain's `since` ascending (blank `since` last), members within a team captain-first then by `since`. Each player row: name + badge + status + deposit (labeled `"<season> bed"` in the column header) + hcp. Badge: `const yrs=season-since+1;` → `since==season ? "ROOKIE" : yrs+ordSuffix(yrs)+" year"` (reuse the `ord` helper from `renderCalcutta`, hoist it to utils as `ordSuffix(n)` and update the payout renderer to use the hoisted one). Rookie strip above the list when any rookie: `Rookie Class of <season>: <names>`.
- [ ] **Step 2: Run `npm test`. Expected: group F green (A–E unchanged).**
- [ ] **Step 3: Commit** — `git commit -am "feat: team-grouped roster, seniority badges, rookie class strip (group F green)"`

---

### Task 7: Calcutta collections + Next Year board

**Files:**
- Modify: `index.html` (`renderCalcutta` rewrite; new `calcuttaModel`, `nextYearModel`, `renderNextYear`; `paint` calls `renderNextYear` and fills `#homeStatus`; pay-row CSS grid drops the player-cut column: `.pay-head,.pay-row{grid-template-columns:3.4rem 1fr 1fr 5.5rem}`)

**Interfaces:**
- Consumes: `nkey`, `yes`, `num`, `forYear`, `activeSeason`, `rankedPlayers`, `teamLabel`, `flag` (Tasks 3–4); `#nyBody`/`#nySync` shell (Task 5).
- Produces:
  - `calcuttaModel() -> {lots:[{key,team,owner,price,collected}], pot, rakePct, rake, payable, outstanding:[{owner,total,lots}]}`
  - `nextYearModel() -> {open:boolean, next:string, all:[], paid:[{name,date}...ordered], owing:[{name}]}`
  - Home consumes both for the post-event strip (E3 goes green here).

- [ ] **Step 1: Models** (insert before `renderCalcutta`):

```js
function calcuttaModel(){
  const rows=forYear(STATE.data.calcutta,STATE.year).filter(r=>(r.team||r.player));
  const lots=rows.map(r=>({ key:nkey(r.team||r.player), team:(r.team||r.player),
    owner:(r.owner||"").trim()||"—", price:num(r.price), collected:yes(r.collected)
  })).sort((a,b)=>b.price-a.price);
  const pot=lots.reduce((s,l)=>s+l.price,0);
  const rakePct=num(INFO.calcutta_rake), rake=pot*rakePct/100;
  const owed={};
  lots.filter(l=>!l.collected).forEach(l=>{
    const k=nkey(l.owner);
    if(!owed[k]) owed[k]={owner:l.owner,total:0,lots:0};
    owed[k].total+=l.price; owed[k].lots++;
  });
  return { lots, pot, rakePct, rake, payable:pot-rake,
           outstanding:Object.values(owed).sort((a,b)=>b.total-a.total) };
}
function nextYearModel(){
  const season=activeSeason(), next=String(parseInt(season,10)+1);
  const field=STATE.data.field||[];
  const byKey=new Map();
  field.filter(r=>r.year===season&&r.player).forEach(r=>
    byKey.set(nkey(r.player),{name:r.player,paid:false,date:"",out:false}));
  const nxt=field.filter(r=>r.year===next&&r.player);
  if(!nxt.length) return {open:false,next};
  nxt.forEach(r=>{
    const k=nkey(r.player);
    if(!byKey.has(k)) byKey.set(k,{name:r.player,paid:false,date:"",out:false});
    const p=byKey.get(k);
    if(String(r.status||"").trim().toLowerCase()==="out") p.out=true;
    if(yes(r.deposit)){ p.paid=true; p.date=(r.paid_date||"").trim(); }
  });
  const all=[...byKey.values()].filter(p=>!p.out);
  const paid=all.filter(p=>p.paid).sort((a,b)=>(a.date||"9999")<(b.date||"9999")?-1:1);
  return {open:true,next,all,paid,owing:all.filter(p=>!p.paid)};
}
```

- [ ] **Step 2: Rewrite `renderCalcutta`.** Tiles from the model (+ new Outstanding tile: `$<sum>` headline, dd small-print per debtor `"Tex $100 · 2 lots"` — lots count = that owner's UNcollected lots). Board rows: team via `teamLabel(l.key).html`, owner, price, collected cell `✓` (brass) or `—`. One-line pot rule under the tiles: `<p class="basis">Owners pay the winning bid to the pot. Winnings pay the owner in full.</p>`. Payout: keep tie-splitting loop exactly as v1 but the whole `amt` goes to `owner` (no playerCut, 4 columns); basis forced gross when a roster exists: `if(roster.size&&String(INFO.calcutta_basis||"").toLowerCase()==="net") flag("calcutta_basis=net ignored — no team handicap in a scramble");` and rank with `"gross"`. Render into existing ids; `#calSync` stamp from Task 4.
- [ ] **Step 3: `renderNextYear`** into `#nyBody`: closed state (`Collection for <next> not open yet.`); open state: `<p class="eyebrow"><paid.length> of <all.length> paid for <next></p>` + paid `<ol>` (name — date, dateless last) + owing div (class `mn-net down`, names joined) + `Deposit $<INFO.deposit_amount> · <INFO.payment_handle>` (wrap in `<a href>` only if the handle starts with `http`). Call from `renderAll`. Fill `#homeStatus` in `paint` using both models (Task 5 wired the element).
- [ ] **Step 4: Run `npm test`. Expected: groups G, H green AND E3 green. Suite tally now everything green except group I.**
- [ ] **Step 5: Commit** — `git commit -am "feat: collections calcutta (no buyback) + next-year board (groups G,H,E3 green)"`

---

### Task 8: Scramble shame + copy sweep (suite fully green)

**Files:**
- Modify: `index.html` (`renderShame` computed section; static copy strings listed below)

**Interfaces:**
- Consumes: `buildPlayers` (`.rounds[rd].holes`, `.key`), `teamLabel`, `courseMap`.

- [ ] **Step 1: Replace the computed-awards block in `renderShame`** (keep the committee-tab loop untouched). Hole-carded teams only (`fromTotals` teams skipped):

```js
if(pars){
  let worst=null, collapse=null; const birdCount={};
  players.filter(p=>!p.fromTotals).forEach(p=>{
    birdCount[p.key]=birdCount[p.key]||0;
    Object.entries(p.rounds).forEach(([rd,r])=>{
      if(!r.holes) return;
      let out=0,inn=0,outN=0,inN=0;
      Object.entries(r.holes).forEach(([h,sc])=>{
        const par=pars[h]||0, d=sc-par;
        if(!worst||d>worst.d) worst={key:p.key,d,sc,h:+h,par,rd};
        if(d<0) birdCount[p.key]++;
        if(+h<=9){out+=d;outN++;} else {inn+=d;inN++;}
      });
      if(outN===9&&inN===9){
        const swing=inn-out;
        if(!collapse||swing>collapse.swing) collapse={key:p.key,rd,swing,out,inn};
      }
    });
  });
  if(worst) cards.push({award:"Worst team hole",who:teamLabel(worst.key).text,
    detail:`${worst.sc} on the par-${worst.par} ${worst.h}${ordSuffix(worst.h)}, round ${worst.rd}. ${toPar(worst.d)}.`});
  if(collapse&&collapse.swing>0) cards.push({award:"Back-nine collapse",who:teamLabel(collapse.key).text,
    detail:`Round ${collapse.rd}: out ${toPar(collapse.out)}, in ${toPar(collapse.inn)}. It got away.`});
  const teams=Object.keys(birdCount);
  if(teams.length){
    const fewest=teams.reduce((a,b)=>birdCount[b]<birdCount[a]?b:a);
    cards.push({award:"Fewest birdies",who:teamLabel(fewest).text,
      detail:`${birdCount[fewest]} team birdies all weekend.`});
  }
}
```

(`ordSuffix` was hoisted in Task 6. Note `reduce` keeps the FIRST minimum — matches fixture expectation "first zero in row order".)

- [ ] **Step 2: Copy sweep — exact string replacements in `index.html`** (drafts; Riley may reword at review, but these exact strings make test I5 deterministic):

| Old (find exactly) | New |
|---|---|
| `36 holes, stroke` (Format fact) | `2-day scramble` |
| `Gross decides The Bird. Net decides who buys. Tap a name for the full card.` | `Gross decides The Bird. Tap a team for the full card.` |
| `<div>Pos</div><div>Player</div>` (lb-head) | `<div>Pos</div><div>Team</div>` |
| `Every man in the field goes to the highest bidder. Buy back half of yourself or watch someone else cash your round.` | `Every team goes to the highest bidder Friday night. Owners pay the pot before Sunday's first tee.` |
| `<div>Player</div><div>Owner</div>` (auc-head) | `<div>Team</div><div>Owner</div>` |
| `<div>Place</div><div>Player</div><div>Owner</div>` + the two `pay-cut` header cells | `<div>Place</div><div>Team</div><div>Owner</div>` + one `pay-cut` header cell `Owner takes` |
| Rule 2 `Stroke play with full handicap. Gross wins The Bird. Net decides who buys the first round.` | `Two-day scramble, gross score. Gross wins The Bird and keeps it for a year.` |
| Rule 3 `One mulligan per nine. Call it before you swing or it never happened.` | `One mulligan per team per nine. Call it before the swing or it never happened.` |
| Rule 7 (the buy-back rule, full sentence) | `The Calcutta is bid Friday after the draw. Winning bids are due to the pot before Sunday's first tee.` |
| `Buyback` header in auc-head + `.auc-back` cells | remove the column (3-col grid: `1fr 1fr 5rem`) |

- [ ] **Step 3: Run `npm test`. Expected: 38/38 — the ENTIRE suite green.** Paste the output into the commit body.
- [ ] **Step 4: Commit** — `git commit -am "feat: scramble shame awards + team-scramble copy sweep (38/38 green)"`

---

### Task 9: Crest rebuild + variants page (Riley's visual gate)

**Files:**
- Create: `tools/crest-variants.html` (throwaway local page, committed for the record)
- Modify: `index.html` (`#mark` symbol path; `makeIcon`; add `const MARK_PATH="…"` single source)

**Interfaces:**
- Produces: `MARK_PATH` (the d-string of the fist+finger outline) consumed by BOTH the inline `<symbol id="mark">` and `makeIcon`'s `Path2D` — v1 duplicates this path in two places; v2 must have exactly one authority. The symbol keeps its detail strokes as separate paths; `makeIcon` keeps its stroke list — both derive the SILHOUETTE from `MARK_PATH`. (Symbol is static HTML: inject it at script start with `document.querySelector("#mark path").setAttribute("d",MARK_PATH)`.)

- [ ] **Step 1: Draft 3 fist variants** in `tools/crest-variants.html` — same 200×260 viewBox contract as v1. Acceptance criteria (all must hold, judged by eye at BOTH sizes): reads instantly as a fist with the middle finger extended; four distinct folded-finger knuckle bumps across the top of the fist; the extended finger is straight, parallel-sided, with a visible nail line and two joint creases; thumb wraps the folded fingers, not floating; silhouette clean at 64px (no strokes thinner than 5 units); brass `currentColor` fill on pine, matching v1's style. Layout of the page: 3 columns (A/B/C), each showing the full crest mock at 330px and the favicon mock at 64px on a pine background, with variant B pre-marked **RECOMMENDED**.
- [ ] **Step 2: Wire the recommended variant** (B) into `index.html` via `MARK_PATH` + symbol injection + `makeIcon` `Path2D(MARK_PATH)`. Verify: `npm test` still 38/38 (no layout assertions break); open `tools/crest-variants.html` and `index.html` via `python3 -m http.server 8000` and eyeball both sizes against the criteria.
- [ ] **Step 3: Commit** — `git commit -am "feat: rebuilt crest mark (variant B), single-source path, variants page for review"`
- [ ] **Step 4: STOP for Riley** — present the variants page; if he picks A or C, swap `MARK_PATH` + the symbol's detail strokes, re-run test, amend commit.

---

### Task 10: Template v2 + README v2

**Files:**
- Modify: `tools/make_template.py`, regenerate `tools/gfy-template.xlsx`; `README.md`

**Interfaces:**
- Consumes: spec §3 schema exactly (Field: year, player, team, since, handicap, status, deposit, paid_date · Scores: year, team, round, h1…h18 · Calcutta: year, team, owner, price, collected · Info: + `deposit_amount`, `payment_handle` keys).

- [ ] **Step 1: Update `SHEETS` in `make_template.py`** to the §3 headers with team-scramble sample rows (3 sample teams mirroring the fixture pattern: captain row `player==team`, a partner row, a rookie with `since` = sample season). Sample `deposit`/`collected` cells hold the strings `TRUE`/`FALSE`. **xlsx cannot carry Google Sheets checkboxes** — add a bold note row nowhere; instead document in README (next step): after import, select each deposit/settled/collected column → Insert → Checkbox (Sheets converts the TRUE/FALSE values in place). Regenerate + extend the existing verification snippet (same pattern as v1: assert sheet names, exact headers, frozen+bold row 1) and run it.
- [ ] **Step 2: README v2.** Update: tab list description (team column + captain convention — "your row's team cell holds your CAPTAIN's name; the captain's own row names himself"); scores entry ("one row per TEAM per round, captain's name in the team column"); the checkbox conversion step (one-time, listed right after "Save as Google Sheets"); Next Year workflow ("when someone pays for next season: add a row with next year, their name, tick deposit, type the date — the site orders the paid list by it"); `since` column ("first GFY year — powers seniority badges; fill once"); keep the PUB_ID/gid instructions untouched (unchanged mechanics); troubleshooting table gains: "Team missing from board → captain's name in Scores doesn't match any Field team (check the health strip)".
- [ ] **Step 3: Run `npm test` (38/38 — README/template changes can't regress it, prove it anyway). Commit** — `git commit -am "docs+template: v2 team-scramble sheet template and runbook"`

---

### Task 11: Deploy battery (Riley-gated)

**Files:** none (verification + one gated push)

- [ ] **Step 1: Full local gate:** `git status --short` clean · `npm test` = 38/38 at the exact tip · `python3 -m http.server 8199` + curl `index.html` (200, HTML) and `config.js` (200, `text/javascript`) · jsdom pass of the LIVE-INTENDED bytes with `?debug=1` (fixture-stubbed) confirming panel + health strip render.
- [ ] **Step 2: STOP — the fence.** Present to Riley: tip SHA, test tally, what the deploy changes, rollback (`git revert` range or repo-delete). **Riley pushes, or types the authorization; never push autonomously** (the fence hook enforces this).
- [ ] **Step 3: After his push:** poll `gh api repos/Killerroyboy/gfy/pages/builds/latest --jq .status` to `built`, then the v1 battery verbatim: `git log --oneline -1` · `curl -sI https://killerroyboy.github.io/gfy/` (200) · body head is our HTML · `config.js` MIME · live `index.html` md5 == local md5. Then live `?debug=1` in the deployed page (expect FAILED/unconfigured until his sheet exists, or 11×OK after).
- [ ] **Step 4: Update memory** (`project_gfy_tournament_site.md`): v2 live, tip, what's pending (sheet setup with v2 template, crest pick if still open).

---

## Self-review record (run before handoff)

- **Spec coverage:** §2 no-buyback → T7/T8 · §3 schema → T1/T10 · §4 S-KEY/S-ZERO/S-MERGE/S-ROUND/S-ROSTER/S-RANKED/S-SEASON/S-YEARBLANK/S-SENIORITY → T3/T6 · §5.1 Home → T5/T7 · §5.2 board → T3/T8 · §5.3 field → T6 · §5.4 calcutta → T7 · §5.5 next year → T7 · §5.6 net-disable → T7 · §5.7 shame → T8 · §6 R-SETTLED/R-STAMPS/R-HEALTH/R-FPRINT/R-NET → T4 · §7 crest → T9 · §8 copy → T8 · §9 testing → T1/T2 · §10 rollout order → task order · §11 open items → T9 step 4, T8 note. No uncovered section.
- **Known open visual step:** T9's variant drafting is creative work bounded by explicit acceptance criteria — the one place the plan specifies outcome, not code.
- **Type consistency check:** `nkey/HEALTH/flag/activeSeason/rosterMap/teamLabel` defined T3, consumed T4–T8 with matching signatures; `calcuttaModel/nextYearModel` defined T7, consumed by T5's `#homeStatus` (E3 deliberately deferred to T7 — noted in both tasks); `ordSuffix` hoisted T6, used T8; `fromTotals` produced T3, consumed T8. `pull()` return shape changed in T4 — `loadDebug` untouched (has its own `pullDebug`), no other caller.
