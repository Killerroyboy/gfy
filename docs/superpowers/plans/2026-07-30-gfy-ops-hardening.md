# GFY Ops-Hardening Wave Implementation Plan (spec §19; rev 2 after adversarial plan review — 11 findings folded, incl. a live-validated pubhtml parser replacing a dead-on-arrival one)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec §19 — the eleven ratified sheet-ops hardening items: paste-safe .gs least-privilege, draft-night team list on START HERE, honest form rejections + overwrite audit, presend responses-tab coverage + loud V-PROBE skip, template/gid drift checkers, admin-template path fix, and the README setup/vault restructure.

**Architecture:** No site-JS changes (index.html untouched — this wave is the ops layer). Two .gs files hardened (deploy = Riley re-paste, recorded as operator step). presend-check.mjs gains `--extra-gid` + an exported `readConfig()` shared with the NEW `tools/gid-check.mjs`; NEW `tools/check_template.py` content-diffs both generators vs their committed xlsx. README restructured last (its claims must match the code the earlier tasks land). New smoke checks = **group J** (free letter), source-parity style (P/T/U-group pattern).

**Tech Stack:** unchanged — Node (no new deps), Python 3 + openpyxl (already required by the generators), Apps Script V8, jsdom smoke (`npm test`, baseline **159/159**).

## Global Constraints (spec §12–§19 — every task inherits)

- Emails NEVER in the repo; rejection strings and printed output carry no personal data beyond what is already public (team labels, years). presend stdout discipline unchanged (never redirect/commit).
- Both .gs files keep `/** @OnlyCurrentDoc */` (polish GAINS it — O-SCOPE), embed zero sheet IDs/URLs, never reference the vault.
- E-TEAM: blank team is normal — nothing in this wave flags it. E-IDEM: the START HERE "Scoring form URL (paste once):" row is the content anchor — never touch it; added rows are safe (restore is a `findIndex` over the built array).
- F-DROPDOWN stands: NOTHING touches the Form or takes FormApp scope. O-TEAMLIST writes only to START HERE.
- O-GIDCHECK / O-TEMPLATECHECK are READ-ONLY tools: gid-check must contain no write to config.js; check_template must contain no xlsx write. Print-and-exit only. A parse failure is a loud exit 2, never a partial result presented as authoritative.
- xlsx binaries are NOT byte-reproducible — content-verify with openpyxl read-back, never md5-gate.
- Suite never shrinks; run `npm test` before every commit; stage only the task's files (`.superpowers/` is git-ignored scratch, never staged).
- CONCURRENT-BRANCH DISCIPLINE: a parallel session commits to this branch. Before every commit: `git log --oneline -1`; if HEAD moved past your recorded base, `git diff --name-only <base>..HEAD` — proceed only if none of YOUR task's files are touched, else STOP and report. index.lock contention → wait 2s, retry. NEVER push.
- Group J is the new check letter (free letters today: J, O, X — J chosen). The main test dom is closed at ~line 1512 — but every J check is a SOURCE-parity check (readFileSync + regex), so no doms are needed; append the J section after group U. EVERY J read of a file that may not exist yet uses the group-T bootstrap (`let src = ""; try { src = readFileSync(...) } catch {}`) — a bare readFileSync at module scope on a missing file aborts the suite before TALLY prints.

---

### Task 1: .gs hardening — O-SCOPE, O-TEAMLIST, O-REJECT, O-REPLACED

**Files:** Modify `tools/sheet-polish.gs`, `tools/sheet-triggers.gs`. Test: `test/smoke.mjs` (new group J, checks J1–J4 → suite 163).

**Interfaces:** Produces: `writeScore_` return-value contract (returns the displaced Number when a DIFFERENT value was overwritten, else null); `seasonYear_(ss)` + `teamList_(ss)` helpers in polish. Nothing downstream consumes these outside the .gs files.

- [ ] **Step 1 (RED):** Append the group J section to `test/smoke.mjs` after the group U section (source-parity pattern — `gs`/`tg` style readFileSync):

```js
/* ---------- J: ops hardening (§19) ---------- */
{
  const polishSrc = readFileSync(path.join(ROOT, "tools", "sheet-polish.gs"), "utf8");
  const trigSrc = readFileSync(path.join(ROOT, "tools", "sheet-triggers.gs"), "utf8");
  check("J1: O-SCOPE — BOTH .gs files carry @OnlyCurrentDoc (repo copies are paste-safe)",
    polishSrc.includes("@OnlyCurrentDoc") && trigSrc.includes("@OnlyCurrentDoc"), "");
  check("J2: O-REJECT — rejections name their real cause: missing-Team-answer message + year-scoped roster miss",
    trigSrc.includes('rejected: no Team answer') && /rejected: team not in roster for " \+ year/.test(trigSrc), "");
  check("J3: O-REPLACED — overwrite audit: prior value read before setValue, applied (replaced N) mark, semantics recorded not arbitrated",
    /getValue\(\)[^]*setValue\(score\)/.test(trigSrc.split("function writeScore_")[1] || "")
    && trigSrc.includes('"applied (replaced " + replaced + ")"'), "");
  check("J4: O-TEAMLIST — polish writes the FORM TEAM LIST block: derived label, honest empty state, Field-derived, anchor row untouched",
    polishSrc.includes("FORM TEAM LIST") && polishSrc.includes("no teams yet")
    && polishSrc.includes("Scoring form URL (paste once):") && /function teamList_/.test(polishSrc), "");
}
```

Run `npm test` → exactly J1–J4 FAIL (159 pass, 4 fail). Nothing else red.
- [ ] **Step 2 (GREEN — polish):** `tools/sheet-polish.gs`:
  1. Line 1 becomes `/** @OnlyCurrentDoc */` (above the existing header comment).
  2. Add two helpers directly above `buildStartHere_`:

```js
function seasonYear_(ss){
  const info = ss.getSheetByName("Info"); if (!info) return null;
  for (const r of info.getDataRange().getValues()){
    if (String(r[0]).trim().toLowerCase() === "first_tee"){
      const v = r[1];
      const y = v instanceof Date ? v.getFullYear() : parseInt(String(v).slice(0, 4), 10);
      return (y > 2000 && y < 2100) ? y : null;
    }
  }
  return null;
}
function teamList_(ss){
  // O-TEAMLIST (§19): distinct current-season Field.team values, sheet order,
  // raw casing — paste-ready for the Form's Team dropdown. Blank team is
  // normal pre-draft (E-TEAM): empty result is an honest state, never a flag.
  const f = ss.getSheetByName("Field"); if (!f) return [];
  const vals = f.getDataRange().getValues(); if (vals.length < 2) return [];
  const head = vals[0].map(h => String(h).trim().toLowerCase());
  const t = head.indexOf("team"), y = head.indexOf("year");
  if (t < 0) return [];
  const season = seasonYear_(ss);
  const seen = {}; const out = [];
  for (let i = 1; i < vals.length; i++){
    if (y >= 0 && season !== null && String(vals[i][y]) !== String(season)) continue;
    const raw = String(vals[i][t] || "").trim();
    const k = raw.replace(/\s+/g, " ").toLowerCase();
    if (raw && !seen[k]){ seen[k] = 1; out.push(raw); }
  }
  return out;
}
```

  3. In `buildStartHere_`'s `rows` array, insert AFTER the `["Scoring form URL (paste once):", ""]` row and its following `["", ""]` row, BEFORE `["COLOR LEGEND", ""]`:

```js
    ["FORM TEAM LIST — copy the lines below into the scoring form's Team dropdown (a multi-line paste becomes one option per line):", ""],
    ...(function(){ const t = teamList_(ss);
      return t.length ? t.map(function(n){ return [n, ""]; })
                      : [["(no teams yet — the draft fills this in; re-run polish() after)", ""]]; })(),
    ["Team list derived from Field when polish() last ran — re-run polish() after the draft to refresh.", ""],
    ["", ""],
```

  (The form-URL restore is a content-anchored `findIndex` over the built array — added rows are safe by design. Do not touch the anchor row.)
- [ ] **Step 3 (GREEN — triggers):** `tools/sheet-triggers.gs`, three edits inside `onScoreFormSubmit` / `writeScore_`:
  1. After `const ans = namedAnswers_(e);` and before the `firstTeeYear_` call, add:

```js
      if (!ans.team){ markResponse_(e, "rejected: no Team answer — check the form's question titles"); return; }
```

  2. Change `if (!team){ markResponse_(e, "rejected: team not in roster"); return; }` to:

```js
      if (!team){ markResponse_(e, "rejected: team not in roster for " + year); return; }
```

  3. O-REPLACED: `writeScore_`'s overwrite branch becomes (read inside the already-held document lock):

```js
    if (String(vals[i][yc]) === String(year) && NORM(vals[i][tc]) === NORM(team)
        && String(parseInt(vals[i][rc], 10)) === round){
      const cell = sh.getRange(i + 1, hc + 1);
      const prev = cell.getValue();
      cell.setValue(score);
      // O-REPLACED (§19): record the displaced value, never arbitrate —
      // last-write-wins stands; the mark is the mid-round audit trail.
      // Number.isFinite guard: a hand-typed non-numeric cell must not
      // produce "applied (replaced NaN)" — the spec says a different NUMBER.
      const prevN = Number(prev);
      return (prev !== "" && prev !== null && Number.isFinite(prevN) && prevN !== score) ? prevN : null;
    }
```

  and the append path ends `sh.appendRow(row); return null;`. The call site becomes:

```js
      const replaced = writeScore_(ss, year, team, round, hole, score);
      markResponse_(e, replaced !== null ? "applied (replaced " + replaced + ")" : "applied");
```

- [ ] **Step 4:** `npm test` → **163/163**. Commit: `git add tools/sheet-polish.gs tools/sheet-triggers.gs test/smoke.mjs && git commit -m "feat: O-SCOPE/O-TEAMLIST/O-REJECT/O-REPLACED — paste-safe .gs, draft team list, honest rejections, overwrite audit (§19)"`.

---

### Task 2: presend upgrades — O-EXTRAGID, O-VPROBE-LOUD, shared readConfig

**Files:** Modify `tools/presend-check.mjs`. Test: `test/smoke.mjs` (J5–J6 → suite 165). (README docs for these land in Task 4.)

**Interfaces:** Produces `export function readConfig(cfgText)` → `{pub, gids}` (comment-strip + PUB_ID + GID-block extraction, exactly the current inline MINOR-9 logic) — **Task 3's gid-check.mjs imports this**; and the `--extra-gid` CLI contract (`name=gid`, repeatable, strict validation, exit 2 on malformed).

- [ ] **Step 1 (RED):** Append to group J:

```js
{
  const preSrc = readFileSync(path.join(ROOT, "tools", "presend-check.mjs"), "utf8");
  check("J5: O-EXTRAGID — repeatable --extra-gid name=gid, strict validation + collision guard exit 2, merged into the watchdog loop, exported readConfig",
    preSrc.includes('"--extra-gid"') && /--extra-gid needs name=gid/.test(preSrc)
    && /collides with a config GID key/.test(preSrc)
    && /\{\s*\.\.\.gids,\s*\.\.\.extraGids\s*\}/.test(preSrc)
    && preSrc.includes("export function readConfig"), "");
  check("J6: O-VPROBE-LOUD — missing --vault-url prints the NOT-proven-unpublished warning (in the else of the vaultUrl gate)",
    preSrc.includes("V-PROBE SKIPPED — no --vault-url given; the vault is NOT proven unpublished this run.")
    && /\}\s*else\s*\{[^{}]*V-PROBE SKIPPED/.test(preSrc), "");
}
```

Run — J5/J6 FAIL.
- [ ] **Step 2 (GREEN):** In `tools/presend-check.mjs`:
  1. Extract the config parse (currently inline at ~164-176) into an export placed beside the other exported helpers, and make `main()` call it:

```js
// Shared with tools/gid-check.mjs (§19 O-GIDCHECK). Strips // line-comments
// FIRST (MINOR-9: config.js's own comments carry worked examples that a
// naive first-match would grab), then extracts PUB_ID and the GID block.
export function readConfig(cfgText){
  const cfgCode = String(cfgText).replace(/\/\/[^\n]*/g, "");
  const pub = (cfgCode.match(/PUB_ID:\s*"([^"]+)"/) || [])[1];
  const gidBlock = (cfgCode.match(/GID:\s*\{[^}]*\}/) || [])[0] || "";
  const gids = {}; [...gidBlock.matchAll(/(\w+):\s*"(\d+)"/g)].forEach(m => gids[m[1]] = m[2]);
  return { pub, gids };
}
```

  In `main()`: `const { pub, gids } = readConfig(readFileSync(path.join(REPO, "config.js"), "utf8"));` replacing the inline block (keep the existing `if (!pub || !gids.invites)` guard).
  2. Argument parsing — after the `--vault-url` splice block, add (NOTE the collision guard: `{...gids, ...extraGids}` lets extras WIN, so an extra named like a real tab would silently REPLACE that tab's scan — `--extra-gid scores=99` would leave the real Scores tab unscanned while the output still says "scores"; and `PUB_ID` would be silently dropped by the loop's own `tab === "PUB_ID"` skip):

```js
  // O-EXTRAGID (§19): scan extra published tabs the config deliberately does
  // not know about (the Form-responses tab). CLI-only by design — a 14th GID
  // key would break the site's 13-tab contract. Names colliding with real
  // config keys are REFUSED: the spread would silently replace that tab's
  // scan, which violates skipped-is-never-clean.
  const extraGids = {};
  for (let ix; (ix = args.indexOf("--extra-gid")) >= 0; ){
    const val = args[ix + 1];
    if (!val || val.startsWith("-") || !/^[a-z_]\w*=\d+$/i.test(val)){
      console.log("ERROR: --extra-gid needs name=gid (e.g. --extra-gid responses=590385167)");
      process.exitCode = 2;
      return;
    }
    const [n, g] = val.split("=");
    extraGids[n] = g;
    args.splice(ix, 2);
  }
```

  and directly AFTER the `readConfig` call in `main()` (it needs `gids` in scope):

```js
  for (const n of Object.keys(extraGids)){
    if (n in gids || n === "PUB_ID"){
      console.log(`ERROR: --extra-gid ${n} collides with a config GID key — it would replace that tab's scan, not add one`);
      process.exitCode = 2;
      return;
    }
  }
```

  Also update BOTH stale usage strings in the same edit: the header comment (line ~3) and the `usage:` line (~145) become `npm run presend -- <vault-contacts.csv> [--vault-url <url>] [--extra-gid name=gid ...]`.

  3. Watchdog loop header becomes `for (const [tab, gid] of Object.entries({ ...gids, ...extraGids })){` (skipped-never-clean semantics inherited — a bad extra gid lands in `skipped`, forcing exit 1, exactly right).
  4. O-VPROBE-LOUD — the `if (vaultUrl){ ... }` block gains an else:

```js
  } else {
    console.log("\nV-PROBE SKIPPED — no --vault-url given; the vault is NOT proven unpublished this run.");
  }
```

  (Exit code unchanged for the skip case — ratified warn-mode, spec §19.)
- [ ] **Step 3 (behavioral spot-check, no vault data):** `node tools/gid-check.mjs` does not exist yet — instead verify presend's arg handling only: `npm run presend -- --extra-gid bad` → prints the ERROR line, exit 2 (no file read happens — confirm the usage/refusal path is unchanged for a missing vault file). Record output in the report.
- [ ] **Step 4:** `npm test` → **165/165**. Commit: `git add tools/presend-check.mjs test/smoke.mjs && git commit -m "feat: O-EXTRAGID + O-VPROBE-LOUD — responses-tab watchdog coverage, loud vault-probe skip, exported readConfig (§19)"`.

---

### Task 3: new tools — O-TEMPLATECHECK, O-GIDCHECK, O-ADMINPATH

**Files:** Create `tools/check_template.py`, `tools/gid-check.mjs`. Modify `tools/make_admin_template.py`, regenerate `tools/gfy-admin-template.xlsx`, `package.json`. Test: `test/smoke.mjs` (J7–J9 → suite 168).

**Interfaces:** Consumes Task 2's `readConfig` export. `make_template.py` is VERIFIED import-safe (module-level `SHEETS` at line 27; `wb.save` under the `__main__` guard at line 197) — importing it cannot regenerate the xlsx, so the checker cannot go vacuous. `make_admin_template.py` is NOT yet import-safe — this task's Step 4 fixes it, and Step 4 must run before the checker's first invocation (Step 6).

- [ ] **Step 1 (RED):** Append to group J. The J7/J8 targets DO NOT EXIST yet — the try/catch bootstrap below is MANDATORY, not optional (a bare readFileSync would abort the suite before TALLY):

```js
{
  let ctSrc = ""; try { ctSrc = readFileSync(path.join(ROOT, "tools", "check_template.py"), "utf8"); } catch {}
  let gcSrc = ""; try { gcSrc = readFileSync(path.join(ROOT, "tools", "gid-check.mjs"), "utf8"); } catch {}
  const adminSrc = readFileSync(path.join(ROOT, "tools", "make_admin_template.py"), "utf8");
  check("J7: O-TEMPLATECHECK — read-only content diff (no xlsx write anywhere in the checker)",
    ctSrc.length > 0 && !ctSrc.includes(".save(") && /load_workbook/.test(ctSrc), "");
  check("J8: O-GIDCHECK — print-only (no config write), fail-loud on unparseable pubhtml, shares presend's readConfig",
    gcSrc.length > 0 && !/writeFileSync|createWriteStream/.test(gcSrc)
    && /could not parse the tab map/.test(gcSrc)
    && /import\s*\{[^}]*readConfig[^}]*\}\s*from/.test(gcSrc), "");
  check("J9: O-ADMINPATH — __file__-resolved output, __main__ guard, READ ME teaches --vault-url",
    /__file__/.test(adminSrc) && /__main__/.test(adminSrc) && adminSrc.includes("--vault-url"), "");
}
```

Run `npm test` → expected RED: **159 pass / 3 fail (J7–J9), TALLY TOTAL 159/162**. Nothing else red.
- [ ] **Step 2 (GREEN — check_template.py):** Create `tools/check_template.py`:

```python
#!/usr/bin/env python3
"""O-TEMPLATECHECK (spec §19): content-diff both template generators' data
against the committed .xlsx binaries. READ-ONLY — this tool never writes an
xlsx (regeneration is the generators' job). Exit 0 = both in sync; 1 = drift
(printed cell-by-cell); 2 = a file could not be read/imported.

Why not a hash gate: openpyxl stamps timestamps, so the binaries are never
byte-reproducible — git diff on them is noise and md5 can't see real drift.
Run: npm run check-template"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

def sheet_dict(module_name):
    mod = __import__(module_name)
    for cand in ("SHEETS", "TABS"):
        if hasattr(mod, cand):
            return getattr(mod, cand)
    raise AttributeError(f"{module_name} exposes neither SHEETS nor TABS")

def diff_workbook(xlsx_path, spec, label):
    from openpyxl import load_workbook
    problems = []
    wb = load_workbook(xlsx_path)
    want_sheets = list(spec.keys())
    if wb.sheetnames != want_sheets:
        problems.append(f"{label}: sheet list {wb.sheetnames} != generator {want_sheets}")
    for name, tab in spec.items():
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        want = [tab["headers"]] + [list(r) for r in tab["rows"]]
        got = [[c.value for c in row] for row in ws.iter_rows()]
        norm = lambda v: "" if v is None else str(v)
        for i in range(max(len(want), len(got))):
            w = [norm(v) for v in (want[i] if i < len(want) else [])]
            g = [norm(v) for v in (got[i] if i < len(got) else [])]
            # trailing blanks are xlsx-representation noise, not drift
            while w and w[-1] == "": w.pop()
            while g and g[-1] == "": g.pop()
            if w != g:
                problems.append(f"{label} [{name}] row {i+1}: generator={w} xlsx={g}")
    return problems

def main():
    checks = [
        ("make_template", HERE / "gfy-template.xlsx", "public template"),
        ("make_admin_template", HERE / "gfy-admin-template.xlsx", "admin template"),
    ]
    all_problems = []
    for module, xlsx, label in checks:
        try:
            spec = sheet_dict(module)
        except Exception as e:
            print(f"CANNOT IMPORT {module}: {e}")
            return 2
        try:
            all_problems += diff_workbook(xlsx, spec, label)
        except Exception as e:
            print(f"CANNOT READ {xlsx.name}: {e}")
            return 2
    if all_problems:
        print(f"TEMPLATE DRIFT — {len(all_problems)} difference(s):")
        for p in all_problems:
            print("  " + p)
        print("Fix: edit the GENERATOR, re-run it, commit both. Never hand-edit the xlsx.")
        return 1
    print("templates in sync — both xlsx match their generators cell-for-cell")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

  **Import-safety gate:** `make_template.py` must import without writing (its save must sit under `__main__` resolved from `__file__` — verify; report if not). `make_admin_template.py` gets its guard in Step 4 of THIS task — order Step 4 before first running the checker.
- [ ] **Step 3 (GREEN — gid-check.mjs):** Create `tools/gid-check.mjs`:

```js
#!/usr/bin/env node
/* O-GIDCHECK (spec §19): fetch the published sheet's pubhtml, parse its
   tab-name→gid map, and diff it against config.js. PRINT-ONLY — this tool
   never writes config.js (silently repointing a tab is the failure class it
   exists to DETECT: the info-gid-"0" incident). Exit 0 = all wired gids
   match; 1 = mismatch/missing (paste-ready block printed); 2 = pubhtml
   unparseable (nothing verified — never a partial map presented as truth).
   Run: npm run check-gids */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "./presend-check.mjs";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const norm = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

export function parseTabMap(html){
  // pubhtml does NOT serve the tab list as markup (the <li id="sheet-button-…">
  // elements are built client-side by JS fetch() never runs). The map is
  // served as a JS array: items.push({name: "START HERE", …, gid: "1054538461", …}).
  // LIVE-VALIDATED at plan review (2026-07-30): 15 tabs parsed, all 13 config
  // gids matched. Names can carry JS escapes (\x26 for &) — unescape first.
  const map = new Map();
  const unesc = s => String(s)
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, "$1");
  for (const m of String(html).matchAll(/items\.push\(\{\s*name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g)){
    map.set(norm(unesc(m[1])), m[2]);
  }
  return map;
}

async function main(){
  const { pub, gids } = readConfig(readFileSync(path.join(REPO, "config.js"), "utf8"));
  if (!pub){ console.log("config.js has no PUB_ID — is the sheet wired?"); process.exitCode = 2; return; }
  let html;
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/e/${pub}/pubhtml`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    html = await res.text();
  } catch (e) {
    console.log(`could not fetch pubhtml (${e.message}) — nothing verified`);
    process.exitCode = 2; return;
  }
  const live = parseTabMap(html);
  if (!live.size){
    console.log("could not parse the tab map — Google may have changed the pubhtml markup; NOTHING verified (this is a tool failure, not a clean result)");
    process.exitCode = 2; return;
  }
  let bad = 0;
  console.log(`pubhtml tabs found: ${live.size}`);
  for (const [tab, gid] of Object.entries(gids)){
    const liveGid = live.get(norm(tab)) ?? live.get(norm(tab.replace(/_/g, " ")));
    if (liveGid === undefined){ console.log(`  ${tab}: gid ${gid} — NO TAB of that name in pubhtml`); bad++; }
    else if (liveGid !== gid){ console.log(`  ${tab}: config has ${gid}, live sheet says ${liveGid}  ← MISMATCH`); bad++; }
    else console.log(`  ${tab}: ${gid} OK`);
  }
  const unwired = [...live.entries()].filter(([n]) => !Object.keys(gids).some(t => norm(t) === n || norm(t.replace(/_/g, " ")) === n));
  if (unwired.length) console.log("tabs on the sheet with no config entry (fine if intentional — e.g. START HERE, Form Responses): "
    + unwired.map(([n, g]) => `${n}=${g}`).join(", "));
  if (bad){
    console.log("\npaste-ready GID block (from the LIVE sheet — review before using, this tool never writes config.js):");
    console.log("  GID: {");
    for (const tab of Object.keys(gids)){
      const g = live.get(norm(tab)) ?? live.get(norm(tab.replace(/_/g, " ")));
      console.log(`    ${tab}: "${g ?? gids[tab]}",`);
    }
    console.log("  },");
  }
  process.exitCode = bad ? 1 : 0;
}

// Import-safe CLI guard — presend's MINOR-8 realpath pattern verbatim, so a
// future test can import parseTabMap without firing a live network call.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
function realpathOrSelf(p){ try { return realpathSync(p); } catch { return p; } }
const invokedReal = process.argv[1] ? realpathOrSelf(process.argv[1]) : null;
const selfReal = realpathOrSelf(fileURLToPath(import.meta.url));
if (invokedReal && pathToFileURL(invokedReal).href === pathToFileURL(selfReal).href)
  main().catch(e => { console.log("gid-check failed: " + (e && e.message ? e.message : e) + " — nothing verified"); process.exitCode = 2; });
```

(Consolidate the imports at the top of the file rather than mid-file if the implementer prefers — behavior is what J8 pins, not import placement. Node allows top-level `import` only at module top: MOVE these two imports into the existing import block at the head of the file.)

- [ ] **Step 4 (GREEN — admin template):** `tools/make_admin_template.py`: wrap the build in `def main():` with `if __name__ == "__main__": main()`; save to `Path(__file__).resolve().parent / "gfy-admin-template.xlsx"` (add `from pathlib import Path`); keep `TABS` at module level (check_template imports it). READ ME row 3 becomes: `["Before every send round: export Contacts as CSV (somewhere OUTSIDE the repo) and run: npm run presend -- <that .csv> --vault-url <this sheet's URL>"],`. Regenerate: `python3 tools/make_admin_template.py` from an arbitrary cwd (e.g. `cd /tmp && python3 ~/Code/gfy/tools/make_admin_template.py`) — proves the path fix; confirm the xlsx landed in tools/, then content-verify with a readback (3 sheets, READ ME row 3 contains `--vault-url`).
- [ ] **Step 5 (package.json):** scripts gain `"check-template": "python3 tools/check_template.py"` and `"check-gids": "node tools/gid-check.mjs"`.
- [ ] **Step 6 (LIVE verification):** run both tools for real and paste output in the report: `npm run check-template` → expect `templates in sync…` exit 0 (plan review pre-validated this against both committed binaries; if it prints drift, STOP and report — do not "fix" either side unilaterally). `npm run check-gids` → expect exit 0 with all 13 config tabs OK PLUS an "unwired tabs" line naming `form responses 1=590385167` and `start here=1054538461` (both intentional — plan review verified this exact live state; the responses gid on that line is what the operator feeds `--extra-gid`). A parse failure or mismatch is a REAL finding — report it, don't paper over.
- [ ] **Step 7:** `npm test` → **168/168**. Commit: `git add tools/check_template.py tools/gid-check.mjs tools/make_admin_template.py tools/gfy-admin-template.xlsx package.json test/smoke.mjs && git commit -m "feat: O-TEMPLATECHECK + O-GIDCHECK + O-ADMINPATH — drift checkers (read/print-only) + admin template path fix (§19)"`.

---

### Task 4: README restructure — O-SETUPDOCS, O-VAULTMERGE + wave docs

**Files:** Modify `README.md`. Test: `test/smoke.mjs` (J10 → suite 169).

**Interfaces:** Consumes the CLI contracts landed in Tasks 1–3 (`--extra-gid name=gid`, `npm run check-template`, `npm run check-gids`, the START HERE FORM TEAM LIST block). Every claim written here must match that shipped code.

- [ ] **Step 1 (RED):** Append to group J:

```js
{
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  check("J10: §19 docs — README teaches --extra-gid responses scan, check-template, check-gids, FORM TEAM LIST, and has ONE vault section with a pointer",
    readme.includes("--extra-gid responses=") && readme.includes("npm run check-template")
    && readme.includes("npm run check-gids") && readme.includes("FORM TEAM LIST")
    && (readme.match(/^## .*[Vv]ault/gm) || []).length === 1, "");
}
```

Run — J10 FAILS (two `## …vault` headings exist today).
- [ ] **Step 2 (O-SETUPDOCS):** In `### 1. Create the sheet from the template` (~line 21), replace the manual checkbox-conversion step: primary path = "after uploading, open Extensions → Apps Script, paste `tools/sheet-polish.gs` as Code.gs, run `polish()` once and authorize — it **applies checkbox validation** to the checkbox columns (Field.deposit, Ledger.settled, Calcutta.collected, Invites.invited/responded — never handicap) **without changing any cell values**, plus the warn-mode dropdowns, colors, and START HERE". Do NOT write "converts" — `applyCheckboxes_` (sheet-polish.gs:47-53) deliberately leaves values untouched (E-IDEM); whether imported TRUE/FALSE strings render as ticked boxes depends on the xlsx→Sheets import coercion, which is UNVERIFIED. Manual `Insert → Checkbox` stays as the clearly-labeled REMEDY: "if the boxes come in unticked after polish(), select the data cells of those columns and Insert → Checkbox — never the handicap column" (keep the existing never-sweep-handicap warning). Be honest that polish requires the Apps Script paste first. Keep every current fact; move, don't delete. RESIDUAL (record in report + ledger): the ticked-after-polish question gets settled empirically at the next real template upload — Riley observation, not this wave's.
- [ ] **Step 3 (O-VAULTMERGE):** Merge `## The Admin vault (emails)` (~143) and `## The GFY Admin vault` (~474) into ONE authoritative section at the FIRST location. At the old (~474) location leave a one-line NON-heading pointer (spec-mandated): `**Vault:** see "The Admin vault (emails)" further up — one authoritative section.` — it must NOT be a `## ` heading or J10's single-heading pin breaks. VERIFIED: zero internal README links reference either vault anchor. DIRECTIONAL FIX: the deleted section's sentence "(see the warning under **The invite list**, *above*)" flips to *below* once its content lives at ~143 (which sits before The invite list). METHOD (sentence-level diff, not vibes): list EVERY sentence of the deleted section in your report and mark where each landed (merged verbatim / merged reworded / already present / dropped-with-reason — "dropped" needs a real reason, not "redundant-ish"). RULE INVENTORY that must survive, verified item-by-item in the report: (1) never Publish-to-web/share the vault; (2) separate Sheets FILE, never a tab of the public sheet (entire-doc publish); (3) Contacts CSV export lands OUTSIDE the repo; (4) presend before EVERY send round, full form with `--vault-url`; (5) the DNI pairing rule — every vault do-not-invite row gets a public Invites row with status `out` in the same sitting; (6) BOTH pairing-failure modes spelled out — DNI-only = the site quietly counts them as needing an invite; Invites-only = next year's operator has an exclusion with no memory of why; (7) the REVERSE cross-check — nobody about to get an invite email should be sitting on the DNI list; (8) the WHY — everything published from the main sheet is public; the two never-publish classes are email addresses and why someone isn't invited back; (9) WHAT the vault holds — every address you have per person, multiple per person (`email_alt`), plus the DNI list with plain-language reasons for future-you; (10) the public Invites tab carries names only, never an address in any cell (the checker watches this); (11) skipped the checker → at minimum re-read the do_not_invite column before sending; (12) Gmail reply loop stays human-approved; a failed scan never means "no replies"; (13) vault template upload → never publish; (14) presend is credited as the DNI automation (the corrected claim stays corrected). Plus the new content: (15) responses-tab scan via `--extra-gid responses=<gid>` (`npm run check-gids` prints the gid on its "unwired tabs" line — currently `form responses 1=590385167`); (16) `npm run check-template` / `npm run check-gids` as drift checks.
- [ ] **Step 4 (O-LIVESCORING docs — the section Tasks 1-2 make stale):** `## Live scoring (the Form)` (~217-266), three edits:
  1. The line "collecting emails would publish every submitter's address on the public responses tab, which no checker scans" — the second clause is FALSE once O-EXTRAGID lands. Reword: "…the public responses tab. The 'Do not collect' setting stays the primary defense; `npm run presend -- … --extra-gid responses=<gid>` can now scan that tab after the fact (detection, not prevention)."
  2. The response-status vocabulary list (~248-256) gains the new marks: `applied (replaced <old>)` (a resubmission displaced a different score — the old value is preserved in the mark), `rejected: no Team answer — check the form's question titles`, and the roster message now reads `rejected: team not in roster for <year>` (a stale Info first_tee self-diagnoses here).
  3. The Team-dropdown bullet (~222, "menu items hand-filled at draft night") gains: "copy the FORM TEAM LIST block from START HERE (built by polish() from the season's Field) — one line per option."
- [ ] **Step 5 (wave docs):** Cheat-sheet (`## Admin quick edits`): update the draft-night row to mention copying the FORM TEAM LIST block from START HERE into the Form's Team dropdown. In `## When something looks wrong`, EXTEND the existing row "One section empty, rest fine | That tab's gid is wrong or missing in config.js" with "— run `npm run check-gids` to diff config.js against the live sheet's tabs" (do NOT add a duplicate row elsewhere). In `## For whoever maintains this`, add the new tool inventory line: `tools/check_template.py` + `tools/gid-check.mjs` (drift checks) + `tools/sheet-triggers.gs` (live-scoring triggers) — the section predates all three.
- [ ] **Step 6:** Verify every README claim against the shipped code (flag names, script names, block titles, status strings — exact). `npm test` → **169/169**. Commit: `git add README.md test/smoke.mjs && git commit -m "docs: O-SETUPDOCS + O-VAULTMERGE + live-scoring runbook — polish-primary setup, one vault section, wave docs (§19)"`.

---

## Post-merge operator steps (Riley — recorded, not automated)

1. Re-paste BOTH .gs files into the live sheet's Apps Script (Code.gs ← sheet-polish.gs, triggers file ← sheet-triggers.gs). This is the deploy path for O-REJECT/O-REPLACED/O-TEAMLIST; the repo's new @OnlyCurrentDoc makes this and every future paste least-privilege-safe. Then run `polish()` once (builds the FORM TEAM LIST block).
2. No form/site changes in this wave. Next presend run: use `--vault-url` and optionally `--extra-gid responses=<gid>`.

## Self-review notes (inline)

- Group J is source-parity only — no doms, no closed-dom hazard, no flag-count interaction (D3/Z5 untouched: nothing in this wave renders).
- Suite arithmetic: 159 → T1 +4 (163) → T2 +2 (165) → T3 +3 (168) → T4 +1 (169).
- J-regexes were written against the exact code blocks in this plan — implementers use the plan's code verbatim, so the regexes bind. If a reviewer-driven fix rewords a target string, the J-check updates in the same commit (same-unit lockstep, S8).
- check_template's trailing-blank normalization exists because openpyxl round-trips `""` cells as `None` and row widths vary by writer — without it the checker would cry drift on representation noise (a false alarm generator would get ignored, which kills the tool).
- gid-check's underscore↔space fallback (`norm(tab.replace(/_/g," "))`) covers config keys like `info` vs a tab literally named "Info" (case handled by norm) — the only current mismatch class; a config key that matches NO live tab prints loudly rather than guessing.
- O-TEAMLIST derives season from Info first_tee (same rule as the triggers' F-YEAR) — if Info is unreadable, `season === null` and ALL Field team values are listed (graceful, labeled; better than an empty lie).
- Task ordering: 3 depends on 2 (readConfig export) and on its own Step 4 ordering (admin guard before first checker run); 4 depends on 1–3 (documents their shipped contracts).
