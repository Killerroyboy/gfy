# §24 Player-Information Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Announcements tab + unseen banner, event-phase Now/Next Home strip, visibility-aware refresh + honest freshness stamp, honest fallbacks (C-FALLBACK), and the `tools/event-ready.mjs` preflight — §24 **rev 2** of `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` (read §24 in full before any task).

**Architecture:** Static single-file app (`index.html` + `config.js`), all data client-pulled from Google-Sheets published CSVs through the existing `pull()`/`paint()` pipeline (index.html:1306/4649). We add one sheet tab (`announce`), three small render units (announcements, Now/Next, event stamp), two behaviors at the existing 60s `load()` call site, honest fallback rewrites, and one read-only node tool. Nothing else changes — the whole-branch review will byte-verify the frozen surface.

**Tech Stack:** vanilla JS in index.html, jsdom smoke suite (`npm test` → `node test/smoke.mjs`), node ESM tools in `tools/`, python `make_template.py`/`check_template.py`.

## Global Constraints

- Suite must be green after EVERY task (`npm test` → `TALLY TOTAL N/N`). Baseline: 215/215 at `f91f3f7`.
- **No real-calendar dates in tests or fixtures** — the Z2 time-bomb lesson (f91f3f7). Time-dependent fixtures are built RELATIVE to `Date.now()` (helper in Task 3) or far-future (2099).
- Every sheet-sourced string rendered by this wave passes `esc()` (index.html:1355) — message, `when`-as-text, schedule label/time/event/location.
- `parseDate` (index.html:1371) is FROZEN — do not touch it; announcements use the new `parseWhen`.
- Verbatim copy pins (exact strings, byte-asserted where a test names them):
  - stamp fresh: `` Checked ‹h:mm› · the sheet publishes a few minutes behind edits ``
  - stamp failing: `` Couldn't refresh — showing data from ‹h:mm› ``
  - schedule empty state: `` Schedule not loaded yet — it lives in the sheet's Schedule tab. ``
- Template xlsx is NOT byte-reproducible — never md5-gate it (v2.5 lesson); compare content via `check_template.py`.
- Commit per task, files staged explicitly (never `git add -A`).
- Work happens in worktree `.worktrees/s24-player-info`, branch `s24-player-info` off `v2.1-invites` (create via superpowers:using-git-worktrees at execution start).

---

### Task 1: `parseWhen` + announce registration (config, TABS, FPRINT, template, fixtures)

**Files:**
- Modify: `index.html` (~1263 `TABS`, ~1299 `FPRINT`, after `parseDate` ~1392 add `parseWhen`)
- Modify: `config.js` (GID map, line 21-35)
- Modify: `tools/make_template.py` (SHEETS dict ~line 27; `main()` ~line 180 emits fingerprints)
- Create: `tools/sample-fingerprints.json` (generated — commit the generated file)
- Modify: `test/smoke.mjs` (harness TABS/GIDS/FIXTURES + D5 "13 tabs OK" → 14)
- Test: `test/smoke.mjs` (X47 block)

**Interfaces:**
- Produces: `parseWhen(v) -> epochMs|null` — strict `YYYY-MM-DD HH:MM` (24h) or bare `YYYY-MM-DD` (=00:00), device-local interpretation, real-calendar validation, years 2000–2100. Consumed by Task 2.
- Produces: `TABS` includes `"announce"` (last position); `FPRINT.announce=["message"]`; `CONFIG.GID.announce`; template tab `Announce` headers `year,when,message`; `tools/sample-fingerprints.json` shape `{ "<tab>": [["cell","cell",…],…] }` — trimmed stringified cell sequences of every SHEETS sample row. Consumed by Tasks 2 and 6.

- [ ] **Step 1: failing tests** — append an X47 block to `test/smoke.mjs` (after X46, keep the X-tally counter idiom used by the neighbors):

```js
// X47: parseWhen — format matrix (§24 A-WHEN). parseDate stays date-only and frozen.
{
  const dom=makeDom("", fakeFetch); await settle(); const w=dom.window;
  const ok=(s)=>w.parseWhen(s), no=(s)=>w.parseWhen(s)===null;
  const at=ok("2099-08-15 14:30");
  check("X47: parseWhen — 'YYYY-MM-DD HH:MM' parses; bare date = 00:00 same day; garbage/invalid-calendar/out-of-range all null; same-day ordering by time",
    at!==null
    && ok("2099-08-15")===new w.Date(2099,7,15,0,0).getTime()
    && at===new w.Date(2099,7,15,14,30).getTime()
    && ok("2099-08-15 09:00") < at                      // same-day ordering
    && no("2099-02-30 10:00") && no("2099-08-15 24:00") // fake calendar / bad clock
    && no("08/15/2099") && no("tomorrow") && no("") && no("2099-8-15 9:00") // strict widths
    && no("1999-08-15") && no("2101-08-15"),            // year range, parseDate idiom
    "at="+at);
  dom.window.close();
}
```

- [ ] **Step 2: run** `npm test 2>/dev/null | grep -E 'X47|TALLY TOTAL'` — expect X47 FAIL (`parseWhen is not a function`), total 215+1 with 1 fail.

- [ ] **Step 3: implement** — in `index.html`, directly below `parseDate`'s closing brace (~line 1392):

```js
/* §24 A-WHEN: announce-only timestamp parser. parseDate above is DATE-ONLY and
   frozen (paid-order etc. depend on that); announcements need same-day ordering,
   so they get their own strict format: "YYYY-MM-DD HH:MM" (24h) or a bare date
   (= 00:00). Device-local interpretation — only ORDER matters for the unseen
   watermark, and the >24h future-guard (renderAnnouncements) bounds clock abuse. */
function parseWhen(v){
  const m=String(v==null?"":v).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
  if(!m) return null;
  const y=+m[1],mo=+m[2],d=+m[3],hh=m[4]?+m[4]:0,mi=m[5]?+m[5]:0;
  if(y<2000||y>2100||hh>23||mi>59) return null;
  const dt=new Date(y,mo-1,d,hh,mi);
  if(dt.getFullYear()!==y||dt.getMonth()!==mo-1||dt.getDate()!==d) return null;
  return dt.getTime();
}
```

Registration, all four (§24 A-TAB — missing any = silently dead feature):
1. `index.html` `TABS` (~1263): append `"announce"` last.
2. `index.html` `FPRINT` (~1302): add `announce:["message"]`.
3. `config.js` GID map: add `announce: ""` with a one-line comment matching the file's style (`// announce — §24 Updates tab; gid from the live sheet once the tab exists`).
4. `tools/make_template.py` SHEETS: add after "Rooms":

```python
"Announce": {
    "headers": ["year", "when", "message"],
    "rows": [
        [2026, "2026-08-14 18:05", "SAMPLE — Draft complete. See the Draft tab."],
        [2026, "2026-08-16 07:40", "SAMPLE — R2 tee times posted. Leaders out last."],
    ],
    "note": "when = YYYY-MM-DD HH:MM (24h). The time orders same-day posts on the site.",
},
```

In `main()`, after the workbook write, emit the fingerprints (single authority — §24 R-READY(a)):

```python
import json
def write_fingerprints(sheets: dict, path: Path) -> None:
    fp = {name.lower(): [[str(c).strip() for c in row] for row in spec["rows"]]
          for name, spec in sheets.items()}
    path.write_text(json.dumps(fp, indent=1) + "\n")
# in main(), beside the xlsx write:
write_fingerprints(SHEETS, Path(__file__).parent / "sample-fingerprints.json")
```

Regenerate: `python3 tools/make_template.py` (openpyxl is in the python3.14 user site). Commit the regenerated xlsx AND the new json.

`tools/check_template.py` — add the sync guard (§24 R-READY(a): checker and template can't drift). After the existing sheet comparison in its main path:

```python
import json
fp_path = Path(__file__).parent / "sample-fingerprints.json"
derived = {name.lower(): [[str(c).strip() for c in row] for row in spec["rows"]]
           for name, spec in spec_dict.items()}   # spec_dict = the imported SHEETS
if not fp_path.exists() or json.loads(fp_path.read_text()) != derived:
    print("FAIL: tools/sample-fingerprints.json is out of sync with make_template.SHEETS — rerun make_template.py")
    sys.exit(1)
```

Harness: in `test/smoke.mjs` add `announce` to its TABS list, a `GIDS.announce` entry, and `FIXTURES.announce` (`year,when,message` CSV, rows using 2099 dates); update **D5** — the name and assertion move from `13 tabs OK` to `14 tabs OK`.

- [ ] **Step 4: run** full suite — expect 216/216 (X47 passes, D5 updated, nothing else moved). `python3 tools/check_template.py` — expect in-sync.

- [ ] **Step 5: commit** `git add index.html config.js tools/make_template.py tools/sample-fingerprints.json tools/gfy-template.xlsx test/smoke.mjs && git commit -m "feat(s24-t1): parseWhen + announce registration (TABS/FPRINT/GID/template/fingerprints; D5 13→14)"`

---

### Task 2: Announcements — banner, watermark, dismiss, Updates list, scorer suppression

**Files:**
- Modify: `index.html` — home view markup (add `<section id="annUpdates">` after the facts `<dl>` ~892); `showView()` (~1240) one line; new `renderAnnouncements()` beside `renderHealth()` (~2941); `paint()` (~4649) one call; CSS block for `#announceBar`/`#annUpdates` beside the health-strip CSS
- Test: `test/smoke.mjs` (X48–X50)

**Interfaces:**
- Consumes: `parseWhen` (Task 1), `esc`, `activeSeason()`, `STATE.data.announce`.
- Produces: `renderAnnouncements()` (idempotent, called from `paint()`), localStorage key `"gfyAnnSeen"` (epoch ms watermark), module state `ANN_DISMISSED` (session dismiss), `document.body.dataset.view` set by `showView` (consumed by the suppression CSS and by anyone later needing current view).

- [ ] **Step 1: failing tests** (append after X47; each uses `makeDom` with an announce fixture override via `withOverride` — the D-block idiom):

```js
// X48–X50 share this fixture: two parseable rows (one future-guarded), one malformed.
const annCsv = (rows)=>"year,when,message\n"+rows.map(r=>r.join(",")).join("\n");
const nowW = Date.now();
const iso = (ms)=>{ const d=new Date(ms); const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
```

X48: fresh DOM with rows `[2026, iso(nowW-3600000), "R2 tee times posted"]` and `[2026, iso(nowW-7200000), "<b>x</b> & y"]` → `#announceBar` visible, newest first, contains `R2 tee times posted`, innerHTML contains `&lt;b&gt;` and NOT `<b>x</b>` (esc proof); click `#annDismiss` → bar hidden, `localStorage.gfyAnnSeen === String(nowW-3600000 truncated-to-minute)`; re-`renderAnnouncements()` → stays hidden (session + watermark).
X49: watermark honesty — row with `when=iso(nowW+3*86400000)` (future-guard) renders in `#annUpdates` but bar does NOT show it as unseen and dismissing other rows leaves watermark BELOW it (assert stored value < that instant); malformed `when="soon"` renders last in Updates, never unseen; with `localStorage` throwing (override `dom.window.localStorage` getter to throw via `Object.defineProperty`) the bar still renders and dismiss still hides it for the session (no exception in `pageErrors`).
X50: Updates list on Home shows ALL current-season rows (seen + unseen); with `location.hash="#score"` and `showView("score")`, computed style of `#announceBar` is `display:none` (suppression), and back on `#board` it is visible again.

- [ ] **Step 2: run** — X48–X50 FAIL (`#announceBar` absent).

- [ ] **Step 3: implement**

`showView()` — add one line before the `querySelectorAll` loop: `document.body.dataset.view=v;`

CSS (beside `.health-strip` rules):

```css
#announceBar{position:relative;background:var(--brass,#8a6d3b);color:var(--pine);
  padding:10px 14px;font-size:.95rem;display:flex;gap:12px;align-items:baseline}
/* CORRECTED at Task-2 review round 1: the original sticky;top:0;z-index:60 occluded the
   sticky nav on scroll, and #fff on brass measured ≈2.2:1 — pine-on-brass is the repo
   convention (.year-btn[aria-pressed]). Loud-at-top-of-page is the requirement. */
#announceBar[hidden]{display:none}
body[data-view="score"] #announceBar{display:none} /* §24 A-BANNER: never interrupt a captain mid-entry */
#announceBar .ann-msg{flex:1}
#annUpdates{margin:26px 0 0}
#annUpdates .ann-row{display:flex;gap:10px;padding:4px 0;font-size:.9rem}
#annUpdates .ann-when{opacity:.6;white-space:nowrap}
```

Renderer (place beside `renderHealth`):

```js
/* §24 A-BANNER/A-SEEN. Unseen = parseWhen(when) newer than the persisted watermark
   AND not >24h future (future-guard: a typo'd year must never poison the watermark).
   Dismiss collapses in-memory for the session, then best-effort persists — if
   storage is unavailable the banner simply returns next visit (errs loud; no false
   "saved" claim). Malformed when: renders in sheet order after parseables, never
   unseen, never advances the watermark. Missing/empty tab: no DOM, no error. */
const ANN_KEY="gfyAnnSeen";
let ANN_DISMISSED=false;
function annWatermark(){ try{ const v=+localStorage.getItem(ANN_KEY); return isFinite(v)&&v>0?v:0; }catch(e){ return 0; } }
function renderAnnouncements(){
  let bar=document.getElementById("announceBar");
  const host=document.getElementById("annUpdates");
  const rows=(STATE.data.announce||[]).filter(r=>String(r.year||"").trim()===String(activeSeason()));
  if(!rows.length){ if(bar) bar.hidden=true; if(host) host.innerHTML=""; return; }
  const lim=Date.now()+24*3600000;
  const parsed=rows.map(r=>({r,at:parseWhen(r.when)}));
  const ordered=parsed.filter(x=>x.at!==null).sort((a,b)=>b.at-a.at)
    .concat(parsed.filter(x=>x.at===null));
  const wm=annWatermark();
  const unseen=ordered.filter(x=>x.at!==null&&x.at>wm&&x.at<=lim);
  if(!bar){
    bar=document.createElement("div"); bar.id="announceBar"; bar.hidden=true;
    const nav=document.querySelector(".nav");
    nav.parentNode.insertBefore(bar,nav);
  }
  if(unseen.length&&!ANN_DISMISSED){
    bar.hidden=false;
    bar.innerHTML=unseen.map(x=>`<span class="ann-msg">${esc(x.r.message)}</span>`).join("")
      +`<button id="annDismiss" type="button">Got it</button>`;
    bar.querySelector("#annDismiss").addEventListener("click",()=>{
      ANN_DISMISSED=true; bar.hidden=true;
      const top=unseen[0].at;
      try{ localStorage.setItem(ANN_KEY,String(top)); }catch(e){ /* session-only; returns next visit */ }
    });
  } else bar.hidden=true;
  if(host) host.innerHTML=`<h3>Updates</h3>`+ordered.map(x=>
    `<div class="ann-row"><span class="ann-when">${esc(x.r.when||"")}</span><span>${esc(x.r.message||"")}</span></div>`).join("");
}
```

`paint()`: add `renderAnnouncements();` immediately after `renderHealth();`. `?debug=1`: the existing debug table gains the announce tab automatically via TABS; add the malformed-`when` count to the debug report only if the debug renderer has a per-tab notes column (check `pullDebug` — if not, skip; spec requires debug to report the TAB, which TABS membership already gives).

- [ ] **Step 4: run** full suite — expect X48–X50 PASS, W-block (nav) and X31 (scorer picker) untouched.

- [ ] **Step 5: commit** `git add index.html test/smoke.mjs && git commit -m "feat(s24-t2): announcements banner + watermark + Updates list; scorer suppression via body[data-view]"`

---

### Task 3: Now/Next strip — resolver, selection, static chips

**Files:**
- Modify: `index.html` — home view markup (add `<div id="nowNext"></div>` directly above `#homeStatus`); new `teeOffsetMs`/`parseClock`/`scheduleInstants`/`nowNextModel` helpers beside `seasonPhase()` (~2964); `paintHome()` (~3283) event branch
- Test: `test/smoke.mjs` (X51–X53) + new helper `dynInfo`

**Interfaces:**
- Consumes: `INFO.first_tee`/`CONFIG.FIRST_TEE`, `seasonPhase()`, schedule rows (`STATE.data.schedule`), `forYear`, `esc`.
- Produces: `nowNextModel(rows, nowMs) -> {now:{r,at,dayEnd}|null, next:{r,at,dayEnd}|null}` (pure, exported to window scope for tests); `scheduleInstants(rows) -> [{r,at|null,dayEnd|null}]`; strip DOM `#nowNext` with static chips `#pairings`/`#board`/`#rooms`.

- [ ] **Step 1: failing tests** — add to smoke a dynamic fixture helper (top of file, beside `iso` from Task 2 — hoist both to file scope):

```js
// §24 test rule: no real-calendar dates. Event fixtures are built RELATIVE to now.
// dynInfo(daysFromNow) → an info CSV whose first_tee is now+days at 09:00 in a
// FIXED -06:00 offset regardless of the machine's TZ (offset math is the thing
// under test — the resolver must be TZ-independent by construction).
function dynFirstTee(daysFromNow){
  const d=new Date(Date.now()+daysFromNow*86400000);
  // format the McCall wall-date of that instant using -06:00
  const mc=new Date(d.getTime()-6*3600000);
  const p=n=>String(n).padStart(2,"0");
  return `${mc.getUTCFullYear()}-${p(mc.getUTCMonth()+1)}-${p(mc.getUTCDate())}T09:00:00-06:00`;
}
function dynInfo(daysFromNow){
  return FIXTURES.info.replace("2026-08-15T09:00:00-06:00", dynFirstTee(daysFromNow));
}
```

X51 (resolver truth, TZ-independent): with `first_tee="2099-08-15T09:00:00-06:00"` (a Saturday) loaded via info override, `scheduleInstants` on rows `[{label:"Friday",time:"3:00 pm"},{label:"Saturday",time:"9:00 am"},{label:"Sunday",time:"8:30 am"}]` returns instants equal to `new Date("2099-08-14T15:00:00-06:00").getTime()` etc. (expected epochs computed INDEPENDENTLY in the test from ISO strings — never via the resolver); a `+09:00` first_tee variant shifts all instants by exactly 15h relative to the `-06:00` run; `label:"Satruday"` and `time:"noon"` rows come back `at:null`.
X52 (selection): pure calls to `nowNextModel(rows, t)` with hand-built instants — `t` mid-Saturday ⇒ now=Saturday 9am row, next=Sunday row (day boundary crossed); `t` = Saturday 23:59 McCall +1min past `dayEnd` ⇒ now=null, next=Sunday (McCall-midnight expiry); `t` before all ⇒ now=null,next=first; `t` after all ⇒ both… now=last-until-its-dayEnd rule asserted.
X53 (render honesty): boot with `dynInfo(+1)` (inside event window) and a schedule fixture containing one resolvable and one `label:"Someday"` row ⇒ `#nowNext` shows Now/Next lines + exactly three chips (`a[href="#pairings"],a[href="#board"],a[href="#rooms"]`), the unresolvable row appears in the Schedule TAB render but never inside `#nowNext`'s Now/Next claims; with `dynInfo(+10)` (off phase) `#nowNext` is empty.

- [ ] **Step 2: run** — X51–X53 FAIL.

- [ ] **Step 3: implement** (beside `seasonPhase`):

```js
/* §24 H-NOWNEXT. Truth rule: compare INSTANTS only. A schedule row's instant is
   its resolved event-window date + its time cell, interpreted in the UTC OFFSET
   carried by the effective first_tee string — the offset has ONE owner. Times are
   DISPLAYED as the sheet's own text; nothing is re-rendered into device wall time.
   Unresolvable label/time ⇒ at:null ⇒ the row can never be claimed Now/Next. */
const WEEKDAYS=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
function teeOffsetMs(){
  const m=String(INFO.first_tee||CONFIG.FIRST_TEE||"").match(/([+-])(\d{2}):(\d{2})\s*$/);
  return m ? (m[1]==="-"?-1:1)*((+m[2])*60+(+m[3]))*60000 : null;
}
function parseClock(t){
  const m=String(t||"").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if(!m) return null;
  let h=+m[1]; const mi=m[2]?+m[2]:0, ap=m[3]&&m[3].toLowerCase();
  if(mi>59) return null;
  if(ap){ if(h<1||h>12) return null; if(ap==="pm"&&h<12)h+=12; if(ap==="am"&&h===12)h=0; }
  else if(h>23) return null;
  return (h*60+mi)*60000;
}
function scheduleInstants(rows){
  const eff=String(INFO.first_tee||CONFIG.FIRST_TEE||"");
  const dm=eff.match(/^(\d{4}-\d{2}-\d{2})T.*([+-]\d{2}:\d{2})$/), off=teeOffsetMs();
  if(!dm||off===null) return (rows||[]).map(r=>({r,at:null,dayEnd:null}));
  const base=new Date(dm[1]+"T00:00:00"+dm[2]).getTime();  // McCall midnight of first-tee day
  const byDay={};
  for(let k=-3;k<=3;k++){                                   // 7-day window ⇒ weekdays unique
    const mid=base+k*86400000;
    const wd=WEEKDAYS[new Date(mid+off).getUTCDay()];
    if(!(wd in byDay)) byDay[wd]=mid;
  }
  return (rows||[]).map(r=>{
    const mid=byDay[String(r.label||"").trim().toLowerCase()];
    const clk=parseClock(r.time);
    return (mid===undefined||clk===null) ? {r,at:null,dayEnd:null}
      : {r,at:mid+clk,dayEnd:mid+86400000};
  });
}
function nowNextModel(rows,now){
  const xs=scheduleInstants(rows).filter(x=>x.at!==null).sort((a,b)=>a.at-b.at);
  let cur=null;
  for(const x of xs){ if(x.at<=now) cur=x; else break; }
  if(cur&&now>=cur.dayEnd) cur=null;                        // McCall-midnight expiry
  const nxt=xs.find(x=>x.at>now)||null;                     // crosses day boundaries
  return {now:cur,next:nxt};
}
```

`paintHome()` event branch — inside the existing phase logic, when `seasonPhase()==="event"`:

```js
const nn=$("#nowNext");
if(nn){
  if(seasonPhase()!=="event"){ nn.innerHTML=""; }
  else{
    const model=nowNextModel(forYear(STATE.data.schedule,activeSeason()),Date.now());
    const line=(tag,x)=>x?`<div class="nn-row"><strong>${tag}:</strong> ${esc(x.r.event||"")}`
      +` · ${esc(x.r.time||"")}${x.r.location?" · "+esc(x.r.location):""}</div>`:"";
    nn.innerHTML=(line("Now",model.now)+line("Next",model.next)
      +`<div class="nn-chips"><a href="#pairings">Pairings</a><a href="#board">Board</a><a href="#rooms">Rooms</a></div>`);
  }
}
```

(Static chips always render with the strip — rev 2 CUT content-matching. `#countdown`/`tick()` untouched.) Add minimal `.nn-row`/`.nn-chips` CSS beside the countdown CSS, site tokens only.

- [ ] **Step 4: run** full suite — X51–X53 PASS; E2/E3 (countdown/status strip) untouched.

- [ ] **Step 5: commit** `git add index.html test/smoke.mjs && git commit -m "feat(s24-t3): Now/Next strip — offset-anchored resolver, midnight expiry, static chips"`

---

### Task 4: visibility seam + event freshness stamp (+ one-line spec amendment)

**Files:**
- Modify: `index.html` — bottom bootstrap (~4678), new `pageVisible`/`refreshTick`/`eventStampFor`/`fmtClock` helpers, `paint()` sets `#homeSync`, home markup adds `<div id="homeSync" class="sync"></div>` beside `#homeStatus`
- Modify: `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` (H-FRESH: one-line amendment)
- Test: `test/smoke.mjs` (X54–X55)

**Interfaces:**
- Consumes: `pull()` results (`{rows,at,live,err}` — `at` on a cache-served result IS the last-success write time, so the honesty rule falls out of the existing pipeline), `TABS`, `seasonPhase()`.
- Produces: `pageVisible() -> bool`, `refreshTick()` (window-scope, tests call it directly), `eventStampFor(results) -> string`.

**Spec amendment (commit with this task):** H-FRESH's board half is carried by the EXISTING `#lbSync` stamp (index.html:3273 `stampFor` — already honest: `Updated Xm ago` / `Saved copy from … — err`); the §24 verbatim copy renders as `#homeSync` on event-phase Home only. Two stamps on the board would duplicate; replacing `#lbSync`'s copy would churn D1/D4's frozen assertions for zero honesty gain. Append one sentence to §24 H-FRESH recording exactly this.

- [ ] **Step 1: failing tests**
X54: boot a DOM, count fetch calls; `Object.defineProperty(doc,"hidden",{configurable:true,get:()=>true})`, call `dom.window.refreshTick()` ⇒ fetch count unchanged; flip hidden to false, dispatch `visibilitychange` ⇒ fetch count increments (immediate load on wake); call `refreshTick()` ⇒ increments again.
X55: with `dynInfo(+1)` (event phase): after a live load, `#homeSync` textContent equals `Checked ‹h:mm› · the sheet publishes a few minutes behind edits` with `‹h:mm›` = `fmtClock` of the scores result's `at` (assert against the DOM's own result object — window-scope `LAST_RESULTS` if needed, else recompute from a frozen `at` injected via a fetch override that stamps a known Date); then a rejecting re-load (swap fetch to reject, call `refreshTick()`) flips it to `Couldn't refresh — showing data from ‹same h:mm›`; with `dynInfo(+10)` (off phase) `#homeSync` is empty.

- [ ] **Step 2: run** — X54–X55 FAIL.

- [ ] **Step 3: implement**

```js
/* §24 H-REFRESH: the existing unconditional 60s load() loop is RETAINED at its
   cadence (rev 2 — reuse, don't duplicate). Two additions only: skip fetches
   while hidden (through this named seam so tests can drive it), and load()
   immediately on wake — phone unlocked at the tee sees fresh data instantly. */
function pageVisible(){ return typeof document.hidden==="undefined"||!document.hidden; }
function refreshTick(){ if(pageVisible()) load(); }
```

Bootstrap (replace line 4678 only): `load(); setInterval(refreshTick,CONFIG.REFRESH_MS);` and add `document.addEventListener("visibilitychange",()=>{ if(pageVisible()) load(); });`

```js
function fmtClock(ms){ const d=new Date(ms); const h=d.getHours()%12||12;
  return h+":"+String(d.getMinutes()).padStart(2,"0")+(d.getHours()<12?"am":"pm"); }
/* §24 H-FRESH: stamp time = last SUCCESSFUL live fetch of the scores tab, device-
   local (the stamp describes the READER's fetch event — McCall time would be the
   wrong frame). pull() already encodes the honesty: live:false + at = the cache's
   last-success write time, so a backoff-served poll can never advance the stamp. */
function eventStampFor(results){
  if(seasonPhase()!=="event") return "";
  const r=results[TABS.indexOf("scores")];
  if(!r||!r.at) return "";
  return r.live ? `Checked ${fmtClock(r.at)} · the sheet publishes a few minutes behind edits`
                : `Couldn't refresh — showing data from ${fmtClock(r.at)}`;
}
```

`paint()`: after the existing stamp lines add `const hs=$("#homeSync"); if(hs) hs.textContent=eventStampFor(results);`

- [ ] **Step 4: run** full suite — X54–X55 PASS; D1/D4 stamps untouched.

- [ ] **Step 5: commit** `git add index.html test/smoke.mjs docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md && git commit -m "feat(s24-t4): visibility seam + immediate wake load; event-phase homeSync stamp (spec: board keeps lbSync)"`

---

### Task 5: C-FALLBACK — no year-stale hardcoded facts

**Files:**
- Modify: `index.html` — `renderSchedule()` empty branch (~2836-2855), facts `<dd>` fallbacks (~889-892), hero sub (~879), `renderInfo()` (~1607), `.ics` builder (~3005-3013)
- Test: `test/smoke.mjs` (X56–X57; Z-block extension)

**Interfaces:**
- Consumes: `INFO.course` / `INFO.lodging` (existing Info keys — no new keys).
- Produces: honest empty states; hero/ics compose helpers `heroLine()`, used by `renderInfo` and the ics click handler.

- [ ] **Step 1: failing tests**
X56: unconfigured-deploy DOM (Z-block harness): `#scheduleBody` textContent contains exactly the pinned `Schedule not loaded yet — it lives in the sheet's Schedule tab.` and does NOT contain `Steaks` or `9:00 am`; every facts `<dd>` reads `—`. (Extend the Z block with these as `Z6`/`Z7` if the Z counter is cheaper — implementer's call, name them in the tally either way.)
X57: with the normal fixtures (info course=`Meadow Creek`, lodging=`Bear Creek Lodge`): hero sub reads `Two rounds at Meadow Creek. Two nights at Bear Creek Lodge. One trophy nobody wants to explain.`; with an info override REMOVING both keys: hero sub reads `Two rounds. Two nights. One trophy nobody wants to explain.`; the ics blob (click `#icsBtn` with `URL.createObjectURL` stubbed to capture the Blob, read its text) contains `LOCATION:Bear Creek Lodge, McCall, Idaho` in the fixture run and `LOCATION:McCall, Idaho` in the keyless run.

- [ ] **Step 2: run** — FAIL (hardcoded fake weekend renders).

- [ ] **Step 3: implement**
- `renderSchedule()` empty branch — replace the entire hardcoded-weekend template literal with:
  `$("#scheduleBody").innerHTML='<p class="sched-empty">Schedule not loaded yet — it lives in the sheet\'s Schedule tab.</p>'; return;`
  (plus a 2-line comment: `§24 C-FALLBACK: the old hardcoded sample weekend here showed LAST YEAR's times as fact whenever the sheet was unreachable — same S12 class as a mislabeled number.`)
- Facts `<dd>` (889-892): fallback text → `—` for all four (`renderInfo` overwrites them when Info arrives — index.html:1611-1613 — so the dash shows only when Info truly failed).
- Hero (879): static text → `Two rounds. Two nights. One trophy nobody wants to explain.`; give the `<p>` `id="heroSub"`.
- `renderInfo()` — after the `data-info` loop add:

```js
const hero=$("#heroSub");
if(hero) hero.textContent=heroLine();
```

with, beside `renderInfo`:

```js
/* §24 C-FALLBACK: compose from Info keys; neutral when absent — a hardcoded fact
   that can outlive its year is the S12 class. */
function heroLine(){
  const c=INFO.course, l=INFO.lodging;
  return `Two rounds${c?" at "+c:""}. Two nights${l?" at "+l:""}. One trophy nobody wants to explain.`;
}
```

- `.ics` builder: `LOCATION:` → `(INFO.lodging?INFO.lodging+", ":"")+"McCall, Idaho"`; `DESCRIPTION:` → the same `heroLine()` first two sentences (`heroLine().replace(/ One trophy.*$/,"")`). SUMMARY unchanged.

- [ ] **Step 4: run** full suite — X56/X57 PASS; Z1–Z5, E-block, N-block (copy) green.

- [ ] **Step 5: commit** `git add index.html test/smoke.mjs && git commit -m "feat(s24-t5): C-FALLBACK — honest schedule empty state, dash facts, Info-composed hero/ics"`

---

### Task 6: `tools/event-ready.mjs` — the preflight

**Files:**
- Create: `tools/event-ready.mjs`
- Modify: `package.json` (script `"event-ready": "node tools/event-ready.mjs"`)
- Test: `test/smoke.mjs` (EV block — unit-tests the exported checks with fixture row arrays; no network)

**Interfaces:**
- Consumes: `readConfig(cfgText)` exported by `tools/presend-check.mjs` (takes the config.js TEXT); `tools/sample-fingerprints.json` (Task 1).
- Produces: CLI `npm run event-ready [-- --year 2027]`; exports (for the EV tests): `checkFirstTee, checkResidue, checkSchedule, checkPairings, checkPars, checkScorer, checkField, checkAnnounce, checkCrossTab, checkFallbackParity` — each `(input) -> {level:"PASS"|"FAIL"|"WARN"|"INFO", detail:string}` or an array of them; `main()` prints one line per result and exits 0 iff no FAIL.

- [ ] **Step 1: failing tests** — EV1–EV10, one per check, pure unit calls with inline fixture arrays. The load-bearing ones (write these exactly; the rest follow the same shape):

```js
// EV2 residue: a verbatim template Field row FAILs naming tab+row; the same row
// with ONE cell edited passes (documents the stated verbatim-only limit).
// EV9 cross-tab: scores.team "Duck" with Field teams ["Jake","Greg"] ⇒ FAIL;
// calcutta.team mismatch ⇒ FAIL; rooms.player "Pat" not in field and not
// "guest:" ⇒ WARN; "guest:Pat" ⇒ no flag.   (This is the 2026-08-15 live shape.)
// EV1 first_tee: "2026-13-01" ⇒ FAIL before anything else; a first_tee >7d past
// "now" arg ⇒ WARN "looks like last year's date — year rollover?".
// EV6 scorer: score_endpoint absent ⇒ FAIL; https://script.google.com/... ⇒ PASS;
// form_url absent ⇒ INFO (optional by design, README:314); form_url present but
// not forms.gle/docs.google.com/forms ⇒ FAIL.
// EV8 announce: zero rows ⇒ INFO only (first morning must not cry wolf); newest
// older than the current event day (inside window) ⇒ WARN; >24h-future when ⇒ WARN.
```

Every check function takes `now` as an argument — **no wall-clock reads inside check logic** (Z2 lesson); `main()` passes `Date.now()` once.

- [ ] **Step 2: run** — EV block FAIL (module absent).

- [ ] **Step 3: implement** `tools/event-ready.mjs` (~200 lines). Skeleton with the two subtle checks in full — implement the rest to their spec lines (§24 R-READY (a)–(i), read them verbatim while implementing):

```js
#!/usr/bin/env node
/* §24 R-READY — event-ready preflight. READ-ONLY, stdout-only, exit 0 iff no
   FAIL (WARN/INFO never change the exit code). Header states the residue
   limit honestly: this tool never claims the sheet "is clean", only "no
   verbatim residue". */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readConfig } from "./presend-check.mjs";
const HERE=dirname(fileURLToPath(import.meta.url));

export function parseCsv(text){            // minimal quoted-field CSV → array of arrays
  const rows=[[""]]; let q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], row=rows[rows.length-1];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){ row[row.length-1]+='"'; i++; } else q=false; }
           else row[row.length-1]+=c; }
    else if(c==='"') q=true;
    else if(c===",") row.push("");
    else if(c==="\n"){ if(row.length===1&&row[0]==="") row.pop(); rows.push([""]); }
    else if(c!=="\r") row[row.length-1]+=c;
  }
  const last=rows[rows.length-1];
  if(last.length===1&&last[0]==="") rows.pop();
  return rows;
}
export function toRows(grid){              // header row → array of objects, lowercase keys, trimmed
  const head=(grid[0]||[]).map(h=>String(h).trim().toLowerCase());
  return grid.slice(1).map(cells=>{ const o={}; head.forEach((h,i)=>o[h]=String(cells[i]??"").trim()); return o; });
}

export function checkFirstTee(firstTee, now){
  const m=String(firstTee||"").match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  if(!m) return {level:"FAIL", detail:`first_tee unparseable: "${firstTee}" — need ISO with offset, e.g. 2027-08-14T09:00:00-06:00`};
  const t=new Date(firstTee).getTime();
  if(now-t>7*86400000) return {level:"WARN", detail:`first_tee ${m[1]}-${m[2]}-${m[3]} is >7 days past — looks like last year's date (year rollover?)`};
  return {level:"PASS", detail:`first_tee ${firstTee}`};
}

export function checkResidue(tabRows, fingerprints){
  const out=[];
  for(const [tab,rows] of Object.entries(tabRows)){
    const fps=new Set((fingerprints[tab]||[]).map(r=>r.join("")));
    (rows||[]).forEach((cells,i)=>{
      if(fps.has(cells.map(c=>String(c).trim()).join("")))
        out.push({level:"FAIL", detail:`sample-residue: ${tab} row ${i+2} is a VERBATIM template sample row`});
    });
  }
  return out.length?out:[{level:"PASS", detail:"no verbatim template residue (edited-in-place residue is out of reach — eyeball stays in the runbook)"}];
}
// checkSchedule(rows, firstTee, datesProse, now)  — event days: parse Info dates
//   prose "Mon D–D" in first_tee's month; fallback [firstTee-1d .. firstTee+1d]
//   with an INFO line naming which basis was used. Every day ≥1 row else FAIL;
//   every row's label resolves as a weekday in the ±3d window AND its time parses,
//   else FAIL naming the row (Now/Next-invisible rows).
// checkPairings(rows, year) — ≥1 row per round, each with a time, else FAIL.
// checkPars(rows) — 18/18 positive ints else FAIL; missing/non-int yards WARN.
// checkScorer(info) — per EV6 above.
// checkField(rows, year) — ≥1 target-year row FAIL; missing handicaps WARN;
//   non-target-year rows NEVER flagged (Next Year board reads them).
// checkAnnounce(rows, now, windowStart, windowEnd) — per EV8 above.
// checkCrossTab({scores,calcutta,rooms,field}, year) — per EV9 above.
// checkFallbackParity(configText, indexHtml, infoRows) — CONFIG.FIRST_TEE vs Info
//   first_tee (WARN on drift: "countdown lies whenever Info fails"); grep-style
//   asserts that index.html contains the pinned schedule empty-state string and
//   no "Aug \d" literal in the facts dds.
export async function main(){ /* readConfig(config.js text) → PUB_ID/GID; fetch
   each tab's published CSV (a fetch error = FAIL for that check, NEVER silent
   PASS); run check 0 first and abort on its FAIL; print aligned LEVEL lines;
   process.exit(anyFail?1:0) */ }
if(process.argv[1]===fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: run** full suite (EV block PASS) and `npm run event-ready` against the live sheet — today's live sheet MUST light up: sample-residue FAILs, cross-tab FAIL (calcutta Duck/Sully/Tex vs teams Jake/Greg/Voss), schedule-coverage FAIL, scorer-unarmed FAIL, first_tee stale WARN. Paste that output into the task report — it is the tool's acceptance proof against the exact failure it was built for.

- [ ] **Step 5: commit** `git add tools/event-ready.mjs package.json test/smoke.mjs && git commit -m "feat(s24-t6): event-ready preflight — 10 checks, verbatim-residue honesty, no wall-clock in check logic"`

---

### Task 7: README + BACKLOG close-out

**Files:**
- Modify: `README.md` (announce format + operator runbook + year-rollover checklist + trade-off notes)
- Modify: `BACKLOG.md` (#7 → build-state note)
- Test: `test/smoke.mjs` — extend the existing README-pinning J/N-idiom tests ONLY if a J-test already greps README for the touched sections (check first; do not invent a new README-test class)

**README content (write these sections, house voice):**
- **Updates (announce tab):** the `when` format (`YYYY-MM-DD HH:MM`, 24h, why the time matters for same-day posts), the future-guard, and the operator habit: after any mid-weekend Schedule/Pairings edit, post an announcement. Template lines to copy: `Draft complete — see the Draft tab.` / `R2 tee times posted — leaders out last.` / `Weather delay — R2 pushed 30 min.`
- **Event-ready preflight:** run `npm run event-ready` before captain links go out and each tournament morning; what FAIL/WARN/INFO mean; the verbatim-residue limit sentence.
- **Year rollover checklist** (one pass, ordered): new season Info values (first_tee with offset, dates, course, lodging) → Field/Schedule/Pairings real rows → delete/replace every SAMPLE row → run polish() → `npm run event-ready` until clean → re-verify scorer endpoint (Info keys) → captain links.
- **On-course reality note:** dead-cell spots can't receive announcements (no-push ruling's stated trade-off) — urgent on-course matters go by voice/marshal; announcements are for logistics.

- [ ] Step 1: write sections → Step 2: `npm test` (README-pinning tests, if any grep these sections, updated in the same edit) → Step 3: commit `git add README.md BACKLOG.md test/smoke.mjs && git commit -m "docs(s24-t7): announce format, preflight runbook, year-rollover checklist, on-course trade-off"`

---

## Post-task gates (wave close-out, controller-run — not a task for implementers)

1. Full suite green; run the render close (PNG battery) per repo convention.
2. Whole-branch review (house pipeline): frozen-surface byte-proof against §24 rev 2's unfrozen list (note the two plan-level additions to that list: `showView` one-liner, `paint()` stamp/announce call sites — the spec amendment in Task 4 records H-FRESH; record these two in the same amendment commit if the reviewer flags them).
3. Merge `s24-player-info` → `v2.1-invites` locally. Riley push gate unchanged.
