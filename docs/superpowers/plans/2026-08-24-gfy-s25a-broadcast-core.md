# §25a Broadcast-Finish Core Wave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the live site's Board, scorecard, and event-phase Home to the canvas-approved "PGA tournament caliber" presentation: five-token golf score colors, scorecard glyph rings, movement arrows, ceremonial mastheads, and the broadcast lower-third — with every behavior mechanically tested.

**Architecture:** Single-file site (`index.html` holds all CSS/JS); all changes are CSS blocks + small pure functions + template-literal render tweaks. The score-class VOCABULARY does not change (`under`/`bogey`/`blowup` classes stay; `eagle` is added additively) — only their colors flip to new semantic tokens, so existing tests keep passing. Glyph rings are pure CSS on the existing score spans. Board rows gain a movement column fed by a pure diff function against the previous refresh.

**Tech Stack:** Vanilla JS + CSS in `index.html`; jsdom suite `test/smoke.mjs` (`node test/smoke.mjs`, tally line last); fixtures in `test/fixtures/`.

**Spec:** `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` §25 rev 2 (commit `de4c8b4`) — read §25 (and its CANVAS-NORMATIVE clause) before any task. The approved canvas working files (visual referent) are mirrored at `docs/superpowers/specs/assets/` only for the crest; the binding visual truth is described in §25's requirement text and table.

## Global Constraints

- **Worktree:** build on branch `s25a-broadcast` in `.worktrees/s25a` off `de4c8b4`. Verify `git rev-parse HEAD` before EVERY commit (concurrent-session discipline; another session owns `renderField`/`nextYearModel`/`.fld-strip` regions and the smoke-append tail — never touch those regions).
- **Suite:** `node test/smoke.mjs` must end green (assert "no FAIL in output", never a hardcoded total — the baseline count moves with a concurrent wave). All new smoke checks go inside ONE uniquely-anchored block per task, appended INSIDE the §25a master block created by Task 1 (comment anchor `/* ===== §25a broadcast-core checks ===== */`), so the eventual merge with the other session's smoke tail stays clean.
- **Frozen surface:** never edit `scQueue`/`scDrain` (index.html ~3959-4120), `applyScore_`/`doPost` (tools/sheet-triggers.gs), or any §24 logic function (`nowNextModel`, announce/watermark/stamp code). CSS may restyle their output; JS bodies are hash-frozen.
- **Tone:** straight-face ceremonial. NO new user-facing copy beyond what this plan quotes verbatim; if a task feels it needs a sentence not in the plan, it flags the controller instead of inventing it.
- **Contrast floors:** text ≥ 4.5:1, decorative rings ≥ 3:1 against all three pines (#0E2019/#132B21/#0A1712) — enforced by Task 1's mechanical test, never by eye.
- **Colors (spec §25 rev 2 table):** `--score-under:#D08A76`, `--score-even:#C8A24A`, `--score-over:#E9E3D3`, `--score-bogey:#8A9B8C`, `--score-blowup:#B0705E` (rings only; blowup TEXT renders bone).
- Reference lines below are for the `de4c8b4` version of `index.html`; re-locate by anchor text if drifted.

---

### Task 1: Score tiers + tokens + mechanical contrast test

**Files:**
- Modify: `index.html` — `:root` block (~line 15) and `scoreClass()` (~line 1695)
- Test: `test/smoke.mjs` — new §25a master anchor block appended at the END of the file, before the tally (read the file tail first; the other session appends there too — place ours immediately after the LAST existing `check` block with the unique anchor comment)

**Interfaces:**
- Produces: `scoreClass(score, par)` now returns `""`, `" under"`, `" under eagle"`, `" bogey"`, or `" blowup"` (eagle ADDITIVE — every existing `.includes("under")` consumer unaffected). CSS tokens `--score-under/-even/-over/-bogey/-blowup` on `:root`. Later tasks style against these tokens and classes only.

- [ ] **Step 1: Write the failing smoke checks** (inside the new anchor block):

```js
/* ===== §25a broadcast-core checks ===== */
{ // T1: score tiers + tokens + mechanical contrast
  const idx = readFileSync(path.join(ROOT, "index.html"), "utf8");
  // token presence
  check("S25a-T1a: five semantic score tokens on :root",
    /--score-under:\s*#D08A76/.test(idx) && /--score-even:\s*#C8A24A/.test(idx)
    && /--score-over:\s*#E9E3D3/.test(idx) && /--score-bogey:\s*#8A9B8C/.test(idx)
    && /--score-blowup:\s*#B0705E/.test(idx));
  // tier boundaries via the page's own scoreClass (jsdom window from the suite's dom)
  const scoreClass = dom.window.scoreClass || dom.window.eval("scoreClass");
  check("S25a-T1b: scoreClass tiers — eagle additive, boundaries exact",
    scoreClass(2,4) === " under eagle" && scoreClass(3,4) === " under"
    && scoreClass(4,4) === "" && scoreClass(5,4) === " bogey"
    && scoreClass(6,4) === " blowup" && scoreClass(9,4) === " blowup"
    && scoreClass(3,0) === "" && scoreClass(3,null) === "");
  // mechanical WCAG contrast — no eyeballs gate color
  const lum = (hex) => { const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
    .map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4);
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
  const ratio = (f,b) => { const [hi,lo]=[Math.max(lum(f),lum(b)),Math.min(lum(f),lum(b))];
    return (hi+0.05)/(lo+0.05); };
  const pines = ["#0E2019","#132B21","#0A1712"];
  const text = ["#D08A76","#C8A24A","#E9E3D3","#8A9B8C"];      // text tokens: 4.5 floor
  const rings = ["#B0705E"];                                     // ring-only: 3.0 floor
  check("S25a-T1c: contrast — text tokens ≥4.5, ring tokens ≥3.0 on every pine",
    text.every(f=>pines.every(b=>ratio(f,b)>=4.5))
    && rings.every(f=>pines.every(b=>ratio(f,b)>=3.0)));
}
```

Note: if `scoreClass` is not reachable on `dom.window` in this suite's setup, follow the suite's existing idiom for reaching page functions (grep `dom.window.` in smoke.mjs and copy the established access pattern) — do not weaken the assertions.

- [ ] **Step 2: Run to verify failure** — `node test/smoke.mjs 2>&1 | grep -E "S25a-T1|FAIL" ` — expect the three checks FAIL (tokens absent, eagle tier absent).
- [ ] **Step 3: Implement.** In `:root` (after `--rust:#B0705E;`):

```css
    /* §25a B-CONV — semantic score tokens (spec rev 2 table; contrast measured in suite) */
    --score-under:#D08A76; --score-even:#C8A24A; --score-over:#E9E3D3;
    --score-bogey:#8A9B8C; --score-blowup:#B0705E;
```

In `scoreClass` (keep the function signature and existing returns; eagle additive):

```js
function scoreClass(score,par){
  if(!par) return "";
  const d=score-par;
  if(d<=-2) return " under eagle";   // §25a B-GLYPH: additive tier — every .includes("under") consumer unaffected
  if(d<0) return " under";
  if(d===1) return " bogey";
  if(d>=2) return " blowup";
  return "";
}
```

- [ ] **Step 4: Run full suite green** — `node test/smoke.mjs 2>&1 | tail -3` (no FAIL; K3/L2 untouched and passing).
- [ ] **Step 5: Commit** — `git add index.html test/smoke.mjs && git commit -m "feat(s25a): T1 score tiers + semantic tokens + mechanical contrast gate"` (verify HEAD first).

---

### Task 2: B-CONV color flip + B-GLYPH rings + legend

**Files:**
- Modify: `index.html` — CSS rules at ~189-191 (`.hcell.*`), ~207-209 (`.sg-t td.*`), ~521 (`.sc-tile-v.under`), ~567-569 (`.sc-cell.*`), plus new ring/legend CSS; grid markup `renderScoreGrid` (~1867 `table.innerHTML=` line) to append the legend row container; Board section markup (~951-957) gains `<div class="sg-legend" id="sgLegend">…</div>` after `#sgPanel`.
- Test: `test/smoke.mjs` — T2 checks inside the §25a anchor block.

**Interfaces:**
- Consumes: Task 1's tokens + `under eagle` class.
- Produces: CSS classes `.sg-legend`; glyph ring styling on `.hcell .hs`, `.sg-t td`, `.sc-cell .sc-score` driven purely by existing tier classes.

- [ ] **Step 1: Failing checks:**

```js
{ // T2: color flip + rings + legend
  const idx = readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("S25a-T2a: under/even/over/bogey cells style from tokens, not raw brass",
    /\.hcell\.under \.hs\{[^}]*var\(--score-under\)/.test(idx)
    && /\.sg-t td\.under\{[^}]*var\(--score-under\)/.test(idx)
    && /\.sc-cell\.under \.sc-score\{[^}]*var\(--score-under\)/.test(idx));
  check("S25a-T2b: blowup TEXT is bone; rust survives only as ring color",
    /\.hcell\.blowup \.hs\{[^}]*var\(--score-over\)/.test(idx)
    && /\.sg-t td\.blowup\{[^}]*var\(--score-over\)/.test(idx)
    && !/\.sg-t td\.blowup\{[^}]*var\(--rust\)[^}]*\}/.test(idx.replace(/border[^;]*;/g,"")));
  check("S25a-T2c: ring vocabulary present (circle under, double eagle, square bogey, double-square blowup)",
    /\.sg-t td\.under\b[^{]*\{[^}]*border-radius:\s*50%/.test(idx)
    && /\.sg-t td\.under\.eagle\b[^{]*\{[^}]*box-shadow/.test(idx)
    && /\.sg-t td\.bogey\b[^{]*\{[^}]*border(?![^}]*radius:\s*50%)/.test(idx)
    && /\.sg-t td\.blowup\b[^{]*\{[^}]*box-shadow/.test(idx));
  const legend = dom.window.document.querySelector("#sgLegend");
  check("S25a-T2d: legend — five labels verbatim",
    !!legend && ["Eagle","Birdie","Par","Bogey","Double or worse"]
      .every(t => legend.textContent.includes(t)));
}
```

- [ ] **Step 2: Verify failure**, same grep pattern.
- [ ] **Step 3: Implement CSS.** Replace the six color rules and add rings/legend (exact blocks; rings sit on the NUMBER span/cell so no markup change — inline-flex sizing keeps the ring round):

```css
  /* §25a B-CONV: five-token golf convention (K3/L2 class vocab unchanged — colors only) */
  .hcell.under .hs{color:var(--score-under);font-weight:700}
  .hcell.bogey .hs{color:var(--score-bogey)}
  .hcell.blowup .hs{color:var(--score-over)}   /* rust TEXT fails 4.5 floor — ring carries the tier */
  .sg-t td.under{color:var(--score-under);font-weight:700}
  .sg-t td.bogey{color:var(--score-bogey)}
  .sg-t td.blowup{color:var(--score-over)}
  .sc-tile-v.under{color:var(--score-under)}
  .sc-cell.under .sc-score{color:var(--score-under)}
  .sc-cell.bogey .sc-score{color:var(--score-bogey)}
  .sc-cell.blowup .sc-score{color:var(--score-over)}
  /* §25a B-GLYPH: broadcast scorecard rings — pure CSS on existing tier classes */
  .sg-t td.under,.sg-t td.bogey,.sg-t td.blowup{position:relative}
  .sg-t td.under::after,.sg-t td.bogey::after,.sg-t td.blowup::after{
    content:"";position:absolute;inset:15%;pointer-events:none;border:1px solid var(--score-under)}
  .sg-t td.under::after{border-radius:50%}
  .sg-t td.under.eagle::after{box-shadow:0 0 0 2px var(--pine),0 0 0 3px var(--score-under)}
  .sg-t td.bogey::after{border-color:var(--score-bogey)}
  .sg-t td.blowup::after{border-color:var(--score-blowup);
    box-shadow:0 0 0 2px var(--pine),0 0 0 3px var(--score-blowup)}
  .hcell.under .hs,.hcell.bogey .hs,.hcell.blowup .hs,
  .sc-cell.under .sc-score,.sc-cell.bogey .sc-score,.sc-cell.blowup .sc-score{
    display:inline-flex;align-items:center;justify-content:center;
    min-width:1.6em;min-height:1.6em;border:1px solid var(--score-under)}
  .hcell.under .hs,.sc-cell.under .sc-score{border-radius:50%}
  .hcell.under.eagle .hs,.sc-cell.under.eagle .sc-score{
    box-shadow:0 0 0 2px var(--pine),0 0 0 3px var(--score-under)}
  .hcell.bogey .hs,.sc-cell.bogey .sc-score{border-color:var(--score-bogey)}
  .hcell.blowup .hs,.sc-cell.blowup .sc-score{border-color:var(--score-blowup);
    box-shadow:0 0 0 2px var(--pine),0 0 0 3px var(--score-blowup)}
  .sg-legend{display:flex;flex-wrap:wrap;gap:22px;align-items:center;margin-top:14px;
    padding-top:12px;border-top:1px solid rgba(200,162,74,.2)}
  .sg-legend .lg{display:flex;align-items:center;gap:9px;font-size:.62rem;
    letter-spacing:.22em;text-transform:uppercase;color:var(--sage)}
  .sg-legend .gl{display:inline-flex;width:26px;height:26px;align-items:center;
    justify-content:center;font-family:var(--display)}
```

- [ ] **Step 4: Legend markup.** In the Board section after `<div class="sg-panel card-drop" id="sgPanel" hidden></div>` insert (static markup — verbatim copy, straight-face):

```html
      <div class="sg-legend" id="sgLegend" aria-label="Scorecard legend">
        <span class="lg"><span class="gl" style="color:var(--score-under);border:1px solid var(--score-under);border-radius:50%;box-shadow:0 0 0 2px var(--pine),0 0 0 3px var(--score-under)">3</span>Eagle</span>
        <span class="lg"><span class="gl" style="color:var(--score-under);border:1px solid var(--score-under);border-radius:50%">3</span>Birdie</span>
        <span class="lg"><span class="gl" style="color:var(--score-over)">4</span>Par</span>
        <span class="lg"><span class="gl" style="color:var(--score-bogey);border:1px solid var(--score-bogey)">5</span>Bogey</span>
        <span class="lg"><span class="gl" style="color:var(--score-over);border:1px solid var(--score-blowup);box-shadow:0 0 0 2px var(--pine),0 0 0 3px var(--score-blowup)">7</span>Double or worse</span>
      </div>
```

- [ ] **Step 5: Doc audit.** `grep -rn -iE "gold|brass" README.md index.html --include=*.md | grep -iE "under|birdie"` — update any copy documenting the OLD gold=under rule to the new convention wording ("Under par shows warm terracotta; even, brass; over, bone."). If none found, note "audit clean" in the task report.
- [ ] **Step 6: Suite green; commit** — `git commit -m "feat(s25a): T2 five-token colors + glyph rings + legend (B-CONV/B-GLYPH)"`.

---

### Task 3: B-NAME mastheads + round-context chip

**Files:**
- Modify: `index.html` — Board section header (~934-947); new compact masthead bar element rendered under the nav for non-home views (static markup + CSS keyed off `body[data-view]`); crest markup reuses the existing inline `MARK_PATH` svg idiom (grep `nav-mark` for the pattern).
- Test: T3 checks in the anchor block.

**Interfaces:**
- Consumes: nothing new. Produces: `#mastBar` element; `.mast-chip` populated by `renderMastChip()` (exported on window like sibling render fns).

- [ ] **Step 1: Failing checks:**

```js
{ // T3: mastheads
  const d = dom.window.document;
  check("S25a-T3a: compact masthead bar exists with full ceremonial name",
    !!d.querySelector("#mastBar")
    && /THE GOOD FRIENDS YEARLY/.test(d.querySelector("#mastBar").textContent));
  check("S25a-T3b: Board masthead carries name + double rule + chip slot",
    /THE GOOD FRIENDS YEARLY/.test(d.querySelector('[data-view="board"]').textContent)
    && !!d.querySelector('[data-view="board"] .mast-rule')
    && !!d.querySelector("#mastChip"));
  // chip honesty: with no event phase active (fixture default), chip shows the est line, never a fabricated round/day
  check("S25a-T3c: chip honest off-phase",
    /Est\. 2019|McCall/.test(d.querySelector("#mastChip").textContent)
    && !/Round \d/.test(d.querySelector("#mastChip").textContent));
}
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Masthead bar directly after `</nav>`:

```html
<div id="mastBar" aria-hidden="false">
  <svg viewBox="0 0 76 100" class="mast-mark" aria-hidden="true"><use href="#markPath"></use></svg>
  <span class="mast-name">THE GOOD FRIENDS YEARLY</span>
  <span class="mast-ctx" id="mastCtx"></span>
</div>
```

(If the crest svg is not referencable via `<use>` in this codebase — check how `nav-mark` embeds it — copy the nav's exact inline-svg idiom instead; never a second path source, Y4 single-authority.)

Board header (replace the eyebrow/h2 block, KEEPING the existing copy verbatim):

```html
    <div class="mast-head">
      <p class="eyebrow">Live from the course</p>
      <h2>Leaderboard</h2>
      <span class="mast-chip" id="mastChip"></span>
    </div>
    <div class="mast-rule"></div>
    <p class="lede">Gross decides The Bird. Tap a team for the full card.</p>
```

CSS:

```css
  /* §25a B-NAME: ceremonial mastheads */
  #mastBar{display:flex;align-items:center;gap:12px;justify-content:center;
    padding:9px 24px;background:rgba(10,23,18,.6);border-bottom:1px solid rgba(200,162,74,.2)}
  body[data-view="home"] #mastBar{display:none}
  .mast-mark{width:15px;height:20px;color:var(--brass)}
  .mast-name{font-family:var(--display);font-weight:700;font-size:.72rem;
    letter-spacing:.3em;text-indent:.3em;color:var(--bone)}
  .mast-ctx{font-size:.58rem;letter-spacing:.22em;text-transform:uppercase;color:var(--sage)}
  .mast-head{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}
  .mast-chip{margin-left:auto;font-size:.6rem;letter-spacing:.24em;text-transform:uppercase;
    color:var(--brass);border:1px solid rgba(200,162,74,.45);padding:5px 12px}
  .mast-rule{border-top:1px solid rgba(200,162,74,.45);padding-top:3px;margin:10px 0 6px}
  .mast-rule::after{content:"";display:block;border-top:1px solid rgba(200,162,74,.2)}
```

`renderMastChip()` (new fn near the other small render fns; called from `paint()` alongside `renderLeaderboard()` — find the render fan-out at ~2966 and add the call): during the §24 event phase derive "Round N · <weekday>" from the SAME schedule/phase model the Now/Next strip uses (`nowNextModel` output — read its shape at ~3076 and reuse; never a second date parser); otherwise render `McCall, Idaho · Est. 2019`. `#mastCtx` gets the same string. Honesty: if the phase model cannot name the round, fall back to the est line — never guess.

- [ ] **Step 4: Suite green (T3 checks + all prior); commit** — `git commit -m "feat(s25a): T3 ceremonial mastheads + honest round chip (B-NAME)"`.

---

### Task 4: B-MV movement arrows

**Files:**
- Modify: `index.html` — `renderLeaderboard()` (~1758-1809), `.lb-head`/`.lb-row` grid columns CSS (~132, and the 423 narrow-width variant), new pure fn + state capture in `paint()` (~4795), footer line after `#lbBody`.
- Test: T4 checks.

**Interfaces:**
- Produces: `movementFor(prevOrder, keys)` pure fn on window — `prevOrder`: array of team keys in prior standings order or `null`; returns `Map(key → {dir:"up"|"down"|"same"|"new", n})`. `STATE.prevBoard = {order:[...keys], at:<ms>}` captured in `paint()` AFTER render (so the render diffs against the PREVIOUS paint).

- [ ] **Step 1: Failing checks:**

```js
{ // T4: movement
  const mv = dom.window.movementFor;
  check("S25a-T4a: movement diff — first load, up, down, tie-shuffle, new team",
    (() => {
      const first = mv(null, ["a","b"]);
      const m = mv(["a","b","c","d"], ["b","a","d","c"]);
      const n = mv(["a"], ["a","z"]);
      return first.get("a").dir==="same" && first.get("a").n===0
        && m.get("b").dir==="up" && m.get("b").n===1
        && m.get("a").dir==="down" && m.get("a").n===1
        && m.get("d").dir==="up" && m.get("d").n===1
        && n.get("z").dir==="new";
    })());
  const idx = readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("S25a-T4b: staleness rule — 10-minute basis cap present with paused copy",
    /STALE_BASIS_MS\s*=\s*10\*60\*1000/.test(idx)
    && idx.includes("Movement paused — last refresh"));
  check("S25a-T4c: arrows are aria-labeled inline SVG in rows",
    idx.includes('aria-label="moved up') && /lb-mv/.test(idx));
}
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Pure fn (top-level, near `scoreClass`):

```js
/* §25a B-MV: standings movement vs the previous successful paint — in-page only,
   never persisted (no fabricated overnight movement). */
const STALE_BASIS_MS = 10*60*1000;
function movementFor(prevOrder, keys){
  const out = new Map();
  if(!prevOrder){ keys.forEach(k=>out.set(k,{dir:"same",n:0})); return out; }
  const prev = new Map(prevOrder.map((k,i)=>[k,i]));
  keys.forEach((k,i)=>{
    if(!prev.has(k)){ out.set(k,{dir:"new",n:0}); return; }
    const d = prev.get(k)-i;
    out.set(k, d>0?{dir:"up",n:d}:d<0?{dir:"down",n:-d}:{dir:"same",n:0});
  });
  return out;
}
```

In `renderLeaderboard()`: before the `players.map`, compute
`const basisFresh = STATE.prevBoard && (Date.now()-STATE.prevBoard.at) <= STALE_BASIS_MS;`
`const mv = basisFresh ? movementFor(STATE.prevBoard.order, players.map(p=>p.key)) : null;`
Add a `lb-mv` span as the SECOND grid column in both `.lb-head` (`<div class="lb-mv" aria-hidden="true"></div>`) and each row:

```js
    const m = mv ? mv.get(p.key) : null;
    const mvHtml = !m || m.dir==="same" || m.dir==="new"
      ? '<span class="lb-mv">—</span>'
      : m.dir==="up"
        ? `<span class="lb-mv up" aria-label="moved up ${m.n}"><svg width="8" height="7" viewBox="0 0 9 8"><path d="M4.5 0 L9 8 L0 8 Z" fill="currentColor"></path></svg>${m.n}</span>`
        : `<span class="lb-mv down" aria-label="moved down ${m.n}"><svg width="8" height="7" viewBox="0 0 9 8"><path d="M4.5 8 L0 0 L9 0 Z" fill="currentColor"></path></svg>${m.n}</span>`;
```

Grid columns: `.lb-head,.lb-row{grid-template-columns:2.4rem 2.2rem 1fr 4rem 3.2rem 3.2rem 4rem 4rem;…}` (and add `2rem` to the ~423 narrow variant, dropping it at the narrowest width if the row overflows — measure at 390w in Task 7). CSS: `.lb-mv{font-size:.7rem;color:var(--sage);display:flex;align-items:center;gap:3px}.lb-mv.up{color:var(--brass)}.lb-mv.down{color:var(--sage)}`.
Footer after `#lbBody`'s grid wrap (inside the section, before `#lbSync`):
`<p class="sync" id="lbMvBasis"></p>` — set in `renderLeaderboard()`:
`basisFresh ? "Movement since "+timeLabel(STATE.prevBoard.at) : (STATE.prevBoard ? "Movement paused — last refresh "+timeLabel(STATE.prevBoard.at) : "")` (grep the codebase for the existing time-label helper the sync stamp uses — reuse it; if none fits, `new Date(at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})`).
In `paint()` AFTER the render fan-out: `STATE.prevBoard = { order: rankedPlayers("gross").map(p=>p.key), at: Date.now() };`
Reduced-motion: no new animation is added in this task, nothing to gate.

- [ ] **Step 4: Suite green; commit** — `git commit -m "feat(s25a): T4 movement arrows with honest 10-min basis cap (B-MV)"`.

---

### Task 5: B-HOME event-phase top-slice

**Files:**
- Modify: `index.html` — extract `lbRowHTML(p, ctx)` from `renderLeaderboard()` (~1785-1801) and reuse; new `renderHomeBoard()`; Home markup gains `<div id="homeBoard"></div>` right after `<div id="nowNext"></div>` (~914); call `renderHomeBoard()` from the same place the Now/Next strip renders (find the strip's paint call at ~3419-3435).
- Test: T5 checks.

**Interfaces:**
- Consumes: Task 4's `mv`-aware row builder. Produces: `lbRowHTML(p, ctx)` where `ctx={parsSuppressed, wdKeys, mv, open:false, interactive:false}` returns the EXACT row markup renderLeaderboard uses (renderLeaderboard passes `interactive:true` + open state; home passes `interactive:false`, rendering a `<div>` row, not a `<button>`).

- [ ] **Step 1: Failing checks:**

```js
{ // T5: home top-slice parity
  const d = dom.window.document;
  check("S25a-T5a: #homeBoard exists after #nowNext", (() => {
    const nn = d.querySelector("#nowNext"); const hb = d.querySelector("#homeBoard");
    return !!hb && !!nn && nn.nextElementSibling === hb; })());
  // parity: when the event phase is active (drive it the same way the suite's §24
  // Now/Next tests drive phase — reuse their fixture/clock idiom), home rows must be a
  // prefix of board rows in team order and suppression state
  check("S25a-T5b: home slice rows = board top rows (order + pos text)", (() => {
    dom.window.renderLeaderboard(); dom.window.renderHomeBoard();
    const b = [...d.querySelectorAll("#lbBody .lb-row .lb-name")].map(e=>e.textContent);
    const h = [...d.querySelectorAll("#homeBoard .lb-row .lb-name")].map(e=>e.textContent);
    return h.length>0 && h.every((t,i)=>t===b[i]); })());
  check("S25a-T5c: off-phase Home carries no board", (() => {
    // drive clock out of the event window per the §24 test idiom, repaint, assert empty
    dom.window.renderHomeBoard();
    return true; /* implement with the real phase toggle from the §24 checks — assert #homeBoard.innerHTML==="" off-phase */ })());
}
```

The T5c body above is a SKELETON the implementer must complete using the suite's real §24 phase-driving idiom (grep smoke.mjs for the Now/Next checks) — an empty-body pass is a plan violation; the finished check must fail when `renderHomeBoard` ignores phase.

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Extract the row template into `lbRowHTML(p,ctx)` verbatim (one implementation — a semantic diff between Home and Board is a spec defect). `renderHomeBoard()`:

```js
/* §25a B-HOME: event-phase top slice — a literal prefix of the Board's render.
   Ties at the cut INCLUDE every tied row (slice may exceed 5). */
function renderHomeBoard(){
  const el=$("#homeBoard"); if(!el) return;
  const phase=/* the SAME event-phase boolean the Now/Next strip derives — reuse its
                 model/flag, never a second clock computation */;
  if(!phase){ el.innerHTML=""; return; }
  const players=rankedPlayers("gross");
  if(!players.length){ el.innerHTML=""; return; }
  const parsSuppressed=!courseMap();
  const cut=players.length<=5?players.length
    :players.filter((p,i)=>i<5||(p.pos!==null&&p.pos===players[4].pos)).length;
  const wdKeys=wdKeySet();
  el.innerHTML=`<div class="home-board"><p class="eyebrow">Leaderboard</p>`
    + players.slice(0,cut).map(p=>lbRowHTML(p,{parsSuppressed,wdKeys,mv:null,interactive:false})).join("")
    + `<a class="home-board-link" href="#board">Full leaderboard →</a></div>`;
}
```

(The `→` arrow: use `&rarr;`; keep copy exactly "Full leaderboard" + arrow.) Wire the call next to the strip's render; CSS `.home-board{margin-top:18px}` + compact row sizing (`.home-board .lb-row{padding:9px 0;font-size:.9em}`) and the link styled like existing `#homeStatus a`. The slice inherits the Board's stamp via the page's existing sync stamp — do NOT add a second timestamp; the §24 strip's stamp already sits directly above.

- [ ] **Step 4: Suite green; commit** — `git commit -m "feat(s25a): T5 event-phase Home leaderboard slice (B-HOME)"`.

---

### Task 6: B-LT lower-third restyle

**Files:**
- Modify: `index.html` — CSS ONLY for the §24 Now/Next strip + event banner (locate their class names by reading the strip render found in Task 5; typically `#nowNext` children + the announce banner classes).
- Test: T6 checks.

- [ ] **Step 1: Failing check:** `check("S25a-T6: lower-third language on strip", /#nowNext[^{]*\{[^}]*border-left/.test(idx) || /nn-strip[^{]*\{[^}]*var\(--brass\)/.test(idx))` — adapt the selector to the strip's REAL class names after reading them; assert the new kicker/rule styling exists.
- [ ] **Step 2-3: Implement CSS:** brass kicker rule + tightened type per the canvas lower-third: left brass rule (2px solid var(--brass)), kicker line in letterspaced sage caps, content in bone — restyle ONLY (zero JS edits in §24 functions; `git diff` must show no line inside `nowNextModel` or the announce logic).
- [ ] **Step 4: Suite green (all §24 checks untouched and passing); commit** — `git commit -m "style(s25a): T6 broadcast lower-third treatment (B-LT)"`.

---

### Task 7: Render close + wave verification

**Files:**
- Create: `.superpowers/sdd/2026-08-24-gfy-s25a/render-close/` PNG battery (playwright harness — copy the harness pattern from `.superpowers/sdd/2026-08-17-gfy-s24-player-info/render-close/`).
- No product-code edits in this task except fixes that its findings force (each fix re-runs the suite).

- [ ] **Step 1:** Full suite: `node test/smoke.mjs 2>&1 | tail -3` — green, no FAIL.
- [ ] **Step 2:** Render battery at 390×844 and 1440×900: Board (populated + suppressed fixtures), grid with glyphs + legend, Home in-phase with slice, Home off-phase, masthead bar on data views, movement arrows fresh + paused states. Network-sealed per the S24 harness convention.
- [ ] **Step 3:** Eyeball pass against the canvas boards (the S11 questions: true, finished, trustworthy to a cold viewer). 390w check: the `lb-mv` column must not overflow the row — if it does, drop the column at the narrowest breakpoint and note it.
- [ ] **Step 4:** `npm run event-ready` still runs and its output is UNCHANGED by this wave (it reads the sheet, not the site — a change means we broke something).
- [ ] **Step 5:** Commit evidence — `git add .superpowers && git commit -m "test(s25a): T7 render close + S11 evidence"`.

---

## After the tasks (controller, not a task)

1. Whole-branch review (fable): frozen-set hash proof (`scQueue`/`scDrain`/§24 fns byte-identical to `de4c8b4`), spec-vs-diff walk, findings → fix rounds re-reviewed.
2. Reconciliation merge to `v2.1-invites`: re-verify the other session's state FIRST (their smoke/index edits may have landed); merge, re-run full suite, verify BOTH waves' features survive (T8 discipline).
3. Ledger + BACKLOG + memory updates; §25b and §26 queue behind Riley's look at §25a on the preview lane. Push stays Riley-gated.

## Self-review notes (run before execution)

- Spec coverage: B-NAME→T3, B-HOME→T5, B-CONV→T1+T2, B-GLYPH→T1+T2, B-MV→T4, B-LT→T6, acceptance→T7+after-tasks. B-FIN deliberately absent (§25b). ✓
- Placeholders: T5c check is explicitly flagged as a skeleton the implementer must finish with the real §24 idiom — allowed because the idiom lives in the file they must read; every other step carries real code. ✓
- Type consistency: `movementFor(prevOrder, keys)` Map shape used identically in T4 row code; `lbRowHTML(p, ctx)` ctx keys consistent between T4/T5. `scoreClass` return strings consistent T1/T2. ✓
