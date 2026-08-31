# §25b Finish-Polish Wave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete spec §25 B-FIN — the finish pass deferred behind §25a: numeral/rule/gold audits, photo framing, empty-state ceremony, and the two sanctioned motion moments, all under the same mechanical-verification bar.

**Architecture:** CSS-first wave over `index.html` with two tiny JS touches (score-change flash class toggle; nothing else). All §25a tokens/idioms are in place and binding. Checks append INSIDE the existing `/* ===== §25a broadcast-core checks ===== */` anchor block (same block — §25b extends the wave family; unique `S25b-` names).

**Tech Stack:** Vanilla CSS/JS in `index.html`; jsdom suite `test/smoke.mjs`; playwright render harness already in the s25a workspace pattern.

**Spec:** `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` §25 rev 2, requirement **B-FIN** (§25b). Canvas-normative clause applies.

## Global Constraints

- Worktree `.worktrees/s25b`, branch `s25b-polish`, base `e30159e`. Verify HEAD before every commit.
- Suite green zero FAIL (assert no-FAIL, never an absolute count — baseline 301 at base, twin session may move it).
- Frozen: scorer write path (scJournalSave/scDrain/scSend/scStore + tools/sheet-triggers.gs), all §24 logic fns, renderField, nextYearModel. §25a's shipped behavior is ALSO frozen: no color/class semantics changes — B-FIN polishes form, never meaning.
- COPY unchanged everywhere. The empty/degraded states get restyled with their exact existing words (S12: honest wording is ruled; §20-§23 own it).
- Contrast floors hold (4.5 text / 3.0 decorative) — any new color pairing gets added to the S25a-T1c mechanical gate's scope if it introduces a new token pairing (it shouldn't; use existing tokens only).
- prefers-reduced-motion: every new transition/animation disabled inside the site's existing reduced-motion block (grep `prefers-reduced-motion` in index.html and extend THAT block — never a second one).

---

### Task 1: Audits — numerals, hairline rules, gold-as-metal, empty-state ceremony

**Files:**
- Modify: `index.html` (CSS only + the audit's file-wide fixes)
- Test: `test/smoke.mjs` — new `S25b-T1*` checks inside the §25a anchor block, after the last §25a check.

**Interfaces:** consumes §25a tokens; produces `.ceremony-empty` styling on the existing empty-state classes (no class renames).

- [ ] **Step 1: Run the three audits and WRITE THE FINDINGS into your report before changing anything.**
  1. *Numerals:* find score/money/count-bearing elements lacking `font-variant-numeric:tabular-nums`. Grep candidates: `.pot dd` has it; check `.card-roster` totals, `.nine-lab` round totals, `.sc-tile-v`, `.lb-pos`, `.mast-chip` (Round N), ledger/money tables (`.mn-*` have it), `.auc-*`, `.ny-*`, countdown digits. Add `font-variant-numeric:tabular-nums` ONLY where digits align vertically in columns or tick in place (countdown); prose numerals stay.
  2. *Rules:* table heads and mastheads still using heavier borders where the Identity-board double hairline belongs: `.lb-head` (currently `border-bottom:1px solid rgba(200,162,74,.45)` single — upgrade to the double via the `.mast-rule` pattern: `border-top` `.45` + `::after` `.2`), `.sg-t thead` row underline. Do NOT touch borders that encode state (suppression, conflict, health).
  3. *Gold-as-metal:* list every `var(--brass)` use on TEXT and classify ceremony (leader Pos, crowns, chips, links, kickers, EVEN) vs body-text violation. Known open question to RULE-FLAG in your report, not change: `.mn-net.up{color:var(--brass)}` (money-up coloring — semantic, not ceremony; the controller rules on it from your report).
- [ ] **Step 2: Failing checks** (write after the audit so they encode the real findings):

```js
{ // S25b-T1: finish audits — numerals, double-rules, empty-state ceremony
  const idx = readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("S25b-T1a: lb-head + sg-t head carry the double hairline rule language",
    /\.lb-head\{[^}]*border-bottom:1px solid rgba\(200,162,74,\.45\)/.test(idx)
    && /\.lb-head::after\{[^}]*rgba\(200,162,74,\.2\)/.test(idx),
    "lb-head rules");
  check("S25b-T1b: empty states styled as ceremony (small-caps letterspaced, not italic apology)",
    /\.lb-empty,\.sched-empty\{[^}]*letter-spacing/.test(idx)
    && !/\.lb-empty,\.sched-empty\{[^}]*font-style:italic/.test(idx),
    "empty-state css");
  // numerals: assert the audit's concrete additions (fill in the selectors your audit found)
}
```

(Adapt the T1a regex to the exact double-rule mechanism you implement — assert BOTH halves of the double rule; adapt T1b to the exact declaration; add one `S25b-T1c` asserting each selector your numerals audit added, listed explicitly.)
- [ ] **Step 3: Implement.** Empty-state ceremony (copy IDENTICAL, presentation ceremonial):

```css
  .lb-empty,.sched-empty{padding:26px 6px;color:var(--sage);font-style:normal;
    font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;text-align:center}
```

Double rule on `.lb-head` (position:relative + ::after 2px below, matching `.mast-rule`'s two-tone), sg-t head underline likewise. Numerals additions per audit.
- [ ] **Step 4: Suite green; commit** — `git commit -m "style(s25b): T1 finish audits — numerals, double rules, empty-state ceremony (B-FIN)"`.

---

### Task 2: Photo frames + sanctioned motion

**Files:**
- Modify: `index.html` — CSS for `.sg-p-photo`, `.sg-p-map img`, `.sg-p-crop-img` (hole panel imagery, emitted at ~2198-2203) and the two motion moments; ONE JS touch in `renderLeaderboard` for the flash class.
- Test: `S25b-T2*` checks in the anchor block.

- [ ] **Step 1: Failing checks:**

```js
{ // S25b-T2: photo frames + motion under reduced-motion
  const idx = readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("S25b-T2a: hole-panel imagery carries the hairline frame treatment",
    /\.sg-p-photo[^{]*\{[^}]*border:1px solid rgba\(200,162,74,\.28\)/.test(idx)
    && /\.sg-p-map img[^{]*\{[^}]*border:1px solid rgba\(200,162,74,\.28\)/.test(idx),
    "photo frames");
  check("S25b-T2b: score-flash + arrow entrance exist AND are disabled under prefers-reduced-motion",
    /\.lb-flash\{[^}]*animation/.test(idx) && /\.lb-mv\.up,\.lb-mv\.down\{[^}]*animation/.test(idx)
    && /prefers-reduced-motion[\s\S]*?\.lb-flash[^}]*\{[^}]*animation:\s*none/.test(idx.replace(/\n/g," ")),
    "motion + rm guard");
}
```

(Adapt regexes to your exact declarations; the binding intent: frames on all three image surfaces; both animations defined; BOTH neutralized inside the existing reduced-motion block.)
- [ ] **Step 2: Implement.** Frames: 1px `rgba(200,162,74,.28)` border + `background:var(--pine-3);padding:4px` on `.sg-p-photo` and `.sg-p-map img`; the crop container (`.sg-p-crop-img` is inside an overflow crop — frame its WRAPPER, read the surrounding markup first). Motion: (a) score-change flash — in `renderLeaderboard`, where rows rebuild, compare each row's to-par text to the previous paint (reuse `STATE.prevBoard` — it already carries order; extend the stash with a `vals` map ONLY if trivially safe, else derive from DOM before overwrite) and add class `lb-flash` to changed rows; `@keyframes lbFlash{from{background:rgba(200,162,74,.14)}to{background:transparent}}` 1.2s once. (b) arrow entrance: `.lb-mv.up,.lb-mv.down{animation:mvIn .25s ease-out}` fade/slide 3px. Both `animation:none` in the existing reduced-motion block. The flash must NOT fire on first paint or year switch (same honesty gates as arrows — reuse `basisFresh`/`yearMatch`; flash only when arrows are live).
- [ ] **Step 3: Suite green (all §25a checks untouched); commit** — `git commit -m "style(s25b): T2 photo frames + score-flash/arrow-entrance motion (B-FIN)"`.

---

### Task 3: Render close + wave verification

- [ ] Copy the s25a render harness pattern into `.worktrees/s25b/.superpowers/sdd/<workspace>/render-close/`; frames at 390 + 1440: empty-state board, hole panel open (photo + map framed), board fresh (motion classes present statically), plus one `prefers-reduced-motion` emulated frame proving no animation classes apply visually.
- [ ] Suite green; `npm run event-ready` unaffected; commit evidence.
- [ ] Report includes the Task 1 audit tables verbatim (numerals added where; brass-on-text classification; the `.mn-net.up` rule-flag for the controller).

## Self-review notes

- Spec coverage: B-FIN's six named items → T1 (numerals, rules, gold audit, empty states) + T2 (photos, motion). ✓
- Placeholders: audit-driven steps explicitly require the implementer to enumerate findings before asserting them — deliberate, since the audit IS the task; skeleton checks are flagged as adapt-with-teeth. ✓
- No copy changes anywhere; motion gated by the arrows' own honesty state. ✓
