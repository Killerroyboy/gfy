# GFY session handoff — pick up here

> Rewritten 2026-09-28 (state sections only; the conventions and binding invariants below
> are older and still current). A fresh session should read this,
> the memory topic file (`~/.claude/projects/-Users-riley/memory/project_gfy_tournament_site.md`),
> and `BACKLOG.md`, then emit the doctrine loaded-heartbeat before acting
> (`~/.claude/projects/-Users-riley/memory/DOCTRINE.md` §1 first; GFY has no company layer).

## §0 — paste this into a fresh session as its first message

```
GFY pickup. Load doctrine FIRST: ~/.claude/projects/-Users-riley/memory/DOCTRINE.md (§1
first) — md5 must match the SessionStart hook's fresh-from-disk value; there is NO gfy
company layer. Emit the loaded-heartbeat before acting.

Then read, in this order:
  1. ~/Code/gfy/docs/HANDOFF.md            (this file — state, gates, conventions)
  2. ~/Code/gfy/BACKLOG.md                 (the ⚑ row is the blocker)
  3. ~/.claude/projects/-Users-riley/memory/project_gfy_tournament_site.md
  4. ~/mc-driver/docs/HANDOFF-gfy-lane.md  (only if touching the autonomous lane)

Ground before asserting anything (all four are cheap):
  cd ~/Code/gfy && git fetch origin && git status && git log --oneline -3
  npm run test:all                  # offline gate: smoke + qr + kit + template
  npm run check-endpoint -- <Info!score_endpoint URL from the live sheet>
  npm run check:live                # ONLY when you need live-sheet truth (rate-limits)

STATE as of 2026-09-28 (verify, do not trust):
  live main 9820e19, deployed + browser-verified (Pages built for that exact sha).
  Lane v2.1-invites is ahead by whatever `git rev-list --count origin/main..HEAD` says —
  no number is written here on purpose: a doc that states its own pending-commit count
  is wrong by one the moment it is committed, and it has drifted twice already.
  Site complete: §24 player-info, §25a/b broadcast, §26 event kit, §27 go-live hardening,
  §28 #preflight, roundNorm fix. Rollback ref 9820e19.

THE ONE BLOCKER, unchanged since 09-24 and it is Riley's hands:
  THE SCORER IS UNARMED. check-endpoint says STUB — the §18 echo is deployed and writes
  nothing. Everything else about GFY is finished. Arming sequence:
    1. README step 3b FIRST — delete the spike's duplicate doPost/doGet from the Apps
       Script project. One project = ONE global scope, so it silently overwrites the real
       handler. Skipping this makes arming LOOK successful while still serving the stub.
    2. Redeploy the real handler on the SAME deployment URL (Manage deployments → Edit →
       New version). A new deployment mints a new URL and orphans every captain link.
    3. Paste Info!score_endpoint, then check-endpoint must print REAL.
    4. npm run drill-sweep -- <url>   (dry-run first, then --go; it REFUSES a stub)
    5. Drill steps 3-7 by hand. Pass condition is a ROW APPEARING in Scores, never a 200.

DO NOT:
  - push without Riley's in-chat word for THAT push (GFY-only grant; never standing)
  - arm an autonomous window (G0 has run; the next one is Riley's call, and the current
    manifest is refused by preflight anyway — a window id IS its manifest md5)
  - run npm run check:live in a loop (the published-CSV endpoint rate-limits bursts; a
    rate-limited run is what made the overseer's GFY check go green-while-blind for 3 days)
  - invent work around the scorer. Arming it IS the task.

RILEY'S OPEN RULINGS: ⚑ arm the scorer · the G0 verdict — rule `agree`, OUTCOME ONLY
(corrected 2026-09-28; the earlier "do NOT rule agree" here was wrong — see below) ·
the 2027 data package (worklist now exists: docs/2027-DATA-PACKAGE.md) · BACKLOG #28,
the EV-ACCEPT gate may be unpassable · push word · whether to commit the oldmac
conductor (339 lines uncommitted since 2026-07-07, preserved, NOT ratified).
```

## What this project is

GFY: an annual golf-trip site + Google Sheet ops system. Static site (one `index.html`,
inline CSS/JS) on GitHub Pages reading published-CSV tabs from one Google Sheet; operator
tooling = two Apps Script files pasted into the sheet's container project, a Google Form
for live scoring, a Python template generator, and a Node pre-send email checker.
Event: NEXT YEAR (2027 dates TBD — sheet still carries 2026 sample/test data) at MeadowCreek (New Meadows, ID). 12–15 four-player teams.

## Where things stand (verify fresh — never trust this doc over `git fetch` + the live site)

- **Live main = `9820e19`**, deployed and verified in a real browser (0 console errors);
  re-confirmed 2026-09-28 via `gh api .../pages/builds/latest` — status `built`, that exact
  sha, `err: null`. The lane `v2.1-invites` is ahead by whatever `git rev-list --count
  origin/main..HEAD` reports — deliberately not written as a number here.
  Next rollback ref = `9820e19`.
- **2026-09-28 — "everything else is finished" was not true.** Auditing the arming path
  instead of repeating that claim turned up three real defects, all now fixed, RED-proven
  and pinned (suite 351 → 356): (1) `check-endpoint` told the operator "Continue with
  SC-DRILL step 2" and exited **0** against a bound-but-throwing handler — the green light
  could not say no; (2) the probe was **1-in-4 false `UNREACHABLE`** against the live
  endpoint, because Apps Script's `/exec` 302s to a short-lived `user_content_key` URL that
  404s when stale, unretried; (3) **BACKLOG #22 was not cosmetic** — a bare-year `first_tee`
  made the board render one season while the scorer keyed another, in America/Denver, the
  event's own timezone. Scores would post fine and never appear on the board, mid-tournament.
  `classify()` was deliberately left untouched in (1): smoke `SC27-2` pins that a bound-but-
  erroring handler IS `REAL`, and that is correct — "which code is bound" and "may I drill"
  are different questions, so the PROCEED decision became its own pure function.
- **THE ONE BLOCKER: THE SCORER IS NOT ARMED.** `npm run check-endpoint -- <url>` against
  the live deployment returns **`STUB`** — the §18 echo is what is deployed and it writes
  nothing. Unchanged since 09-24. Everything else about GFY is finished; this is the only
  thing between it and live tournament use. **Start here** (README step 3b first — the
  live Apps Script project also holds the spike's duplicate `doPost`/`doGet`, and Apps
  Script gives one project ONE global scope, so it silently overwrites the real handler;
  skipping that step makes arming *look* successful while still serving the stub).
- **The live sheet is still the test bed:** 12 residue identities / 30 rows, real 2027
  dates absent, `payment_handle` still the fake "Venmo @gfy-duck" and publicly displayed.
  `npm run check:live` is the authority. (The Course tab's 18 rows are verified-real and
  exempted — they are the template matching reality, not stale samples.)
- **GFY is the FIRST AUTONOMOUS LANE** (Riley, 09-24, superseding the 09-23 riffle-first
  ruling). **G0 ran end to end on 09-24 and closed** at `needs-riley`; the fence held (live
  repo never moved, all work on `gfy-preview/auto-builds`). Full account + the next-window
  steps: `~/mc-driver/docs/HANDOFF-gfy-lane.md`. **Do not arm another window without
  Riley** — and the current manifest is now refused by preflight anyway (a window id IS
  its manifest md5, so re-use is a replay).
- **Watched daily by the overseer** (`~/mc-overseer`, 07:00): `gfy-readiness` reports
  ADVERSE CHANGE against a baseline — a scorer regression, a NEW failure identity, a gid
  that stopped resolving, the live site drifting from the deployed tip — and stays quiet
  on the known sheet-fill runway. It reports **SHEET UNREADABLE** rather than "clean" when
  it cannot fetch (it went green-while-blind for three days before that was fixed).
- **Drive sync is 14/14 LIVE**: every config.js gid matches the sheet tab map; the
  Announce tab exists (gid 1337342920, header `year,when,message`, intentionally empty).
- **THE GATE before any commit: `npm run test:all`** — smoke + check-qr + check-kit +
  check-template in one command. It is genuinely OFFLINE (proven by running it with the
  network blackholed), so it is safe to run every time and cannot rate-limit the sheet.
  Use it instead of remembering which suites matter: on 2026-09-27 I shipped a regression
  into mc-driver by running one suite and carrying a PREVIOUS commit's result forward for
  the rest — the commit that changes kind (read → write) is exactly where an earlier
  green stops transferring.
- **`npm run check:live`** — check-gids + event-ready. These READ THE LIVE SHEET and the
  published-CSV endpoint rate-limits bursts, so run them deliberately, not in a loop and
  not as a pre-commit habit. (A rate-limited run is why the overseer's GFY check went
  green-while-blind for three days.)
- Suites: `node test/smoke.mjs` (jsdom, 351 checks — a MOVING baseline, so assert
  zero-FAIL, never an absolute count); `npm run check-qr` (11); `npm run check-kit` (20);
  `npm run check-endpoint -- <url>` (§27 SC-PROBE — what is actually deployed);
  `npm run event-ready` (reads the LIVE sheet — exits 1 today on **25 actionable**
  sample-residue rows plus the unarmed scorer and the calcutta cross-tab mismatch;
  that is Riley's data-fill runway, not a code defect. The Course tab's 18 rows are
  no longer among them — they are verified-real and exempted per run).
- Real-browser proof: `tools/pf-render-close.mjs` (needs playwright installed in the
  repo; see its header). It is the only leg that can prove a CSS cascade.

## What shipped in this arc (short)

1. **Drive cleanup (08-24):** the GFY Google account (address deliberately not
   restated here — binding invariant 1) reduced to 3 artifacts —
   **GFY Tournament** (the live published sheet; publish-id verified == config.js
   PUB_ID), **GFY Live Scoring** (backup form; "Do not collect emails" verified;
   all 4 questions required), **GFY Admin** (private email vault, never published —
   its URL/doc-id is deliberately NOT in this public repo).
2. **PGA-caliber design (08-24):** brainstorm rulings — Augusta prestige + broadcast
   graphics + full event kit; straight-face tone; formal name THE GOOD FRIENDS YEARLY;
   no custom domain. Canvas artifact (6 boards) Riley-approved in full; spec §25 rev 2 +
   §26 written into `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` after a
   4-lens pressure test.
3. **§25a (deployed):** 5-token golf score colors w/ mechanical contrast gate, scorecard
   glyph rings + legend, ceremonial mastheads + honest round chip, movement arrows
   (10-min basis, year + suppression guarded), event-phase Home top-5 slice
   (season-pinned), broadcast lower-third.
4. **§25b (deployed):** numeral/rule/gold audits, empty-state ceremony, photo frames,
   score-flash + arrow entrance (honesty-gated, reduced-motion clean).
5. **§26 (merged, unpushed):** `#tv` lodge mode (3 panels, 20 s rotation, honest
   stamps/stale/empty, §20 suppression parity), vendored QR encoder
   (`tools/print/qr-vendor.mjs` — a from-memory RECONSTRUCTION of MIT
   qrcode-generator; a review-built independent decoder caught every code decoding
   EMPTY, fixed + decode-round-trips now pinned), `tools/print/make-kit.mjs`
   (poster + captain cards; vault guard; per-card TZ+season stamps; `[TBD]` /
   `[ 2027 DATES ]` honesty; PDF pagination verified).

## Riley's open gates (his EA now ranks these; ⚑ is the marked one)

1. **⚑ ARM THE SCORER** — the only blocker. Sequence, three of four steps mechanically
   checked: README step 3b (delete the spike's duplicate `doPost`) → redeploy on the
   **same** deployment URL → paste `Info!score_endpoint` → `npm run check-endpoint -- <url>`
   must print **`REAL`** → `npm run drill-sweep -- <url>` (dry-run, then `--go`) →
   drill steps 3-7 by hand (pocket, airplane, clobber, concurrent, round-toggle, canary).
   **The drill's pass condition is a ROW APPEARING in Scores, never a 200.**
2. **Rule on the G0 verdict — `agree`, outcome only.** *(CORRECTED 2026-09-28. This row
   used to say "and **not** `agree`". That was wrong, and it was wrong because it read
   `agree` as ratifying the CEO's reasoning. It does not.* `mc-driver/bin/ea.mjs` writes
   `verdict_effective` into the ruling row, so the ruling binds to the **effective**
   verdict — which was `needs-riley`, and `needs-riley` was correct. The CLI even prints
   the written-vs-effective divergence at ruling time so the `why` can carry it.*)
   Verified in the record: the only G0 verdict row is `verdict_ceo: needs-riley`,
   `verdict_effective: needs-riley`, `acceptance: false`, `acceptance_discriminating: null`
   — and the CEO's own review file (goal state `review_files.S1`, task_id **and** nonce
   matched) wrote `"verdict": "accept"` on that crash while its own defect recorded the
   doubt. The driver refused it. Suggested ruling:

   `S1=agree "OUTCOME ONLY: needs-riley was the correct effective outcome — acceptance
   recorded false (discriminating null) from an environmental failure (jsdom missing in
   the sandbox clone), so this window validated NO code and must not be cited as evidence
   the lane works. The CEO's own review file wrote ACCEPT on that crash while its defect
   doubted it; the driver refused it."`

   The substantive caution the old wording was protecting survives in the `why`: agreeing
   to the outcome is not agreeing that G0 proved anything.
3. **The 2027 data package** (BACKLOG #6) — dates, `first_tee`, the fake `payment_handle`,
   the wipe confirmations. The long pole, and the only thing only he holds.
4. **Push word** for the 1 pending commit (and any later ones).
5. Standing decisions: #17 invites-flow hardening, #24 (`#preflight` is BUILT and live —
   this row is now only about follow-ups), #26 account address accept-residual.

## How this project works (conventions a fresh session must keep)

- **Spec** = §-sections appended to `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md`
  (next free: §29 — §27 go-live hardening and §28 #preflight are written).
  Plans in `docs/superpowers/plans/`. Canvas-normative clause: the
  approved design canvas governs visual details not restated in text.
- **Build pipeline:** brainstorm w/ Riley → spec → adversarial pressure test → plan →
  subagent-driven dev in a worktree (`.worktrees/<wave>` off the lane tip; verify HEAD
  before EVERY commit) → per-task review (opus for risky, sonnet for small) → fix
  rounds w/ scoped re-reviews + mutation kills → fable whole-branch review w/
  frozen-surface hash proof → render-close battery (playwright harness pattern lives in
  each retained workspace) → reconciliation merge to `v2.1-invites` → RILEY PUSH GATE.
- **Frozen surfaces** (byte-frozen unless a spec sanctions a change; hash-prove at
  whole-branch + re-prove at merge): scorer write path (scJournalSave/scDrain/scSend/
  scStore + tools/sheet-triggers.gs), §24 fns (nowNextModel/seasonPhase/teeOffsetMs/
  scheduleInstants, announce/watermark), renderField, nextYearModel, §25 core
  (movementFor, renderMastChip, renderHomeBoard, lbRowHTML, flash gates).
- **Smoke checks** append INSIDE the single anchor block
  `/* ===== §25a broadcast-core checks ===== */` near the end of `test/smoke.mjs`,
  with wave-prefixed names (S25a-/S25b-/S26-), detail args, fresh throwaway
  `makeDom()` per scenario (the shared dom is closed by then), `until()` readiness
  waits, and mutation-verified teeth. Standalone tool tests use their own namespaces
  (K-QR-*, K-KIT-*).
- **Push procedure (fence):** Riley's in-chat word per push, never standing. Ground
  fresh (`git fetch`; ancestry `merge-base --is-ancestor`; suite at tip) → dry-run and
  apply with `GFY_PUSH_GRANT=1 git push origin v2.1-invites:main` (the fence hook
  blocks it otherwise) → verify Pages `built` for the exact sha + live md5/markers.
  A TWIN SESSION often works this repo concurrently — expect the lane tip to move,
  re-ground before every crossing, and treat same-tip push races as benign (verify
  live regardless; N12 discipline).
- **Machine hazard:** lid-closed battery sleep kills subagent streams (~2-min
  Maintenance Sleep cycles; caffeinate cannot hold through lid sleep). If agents die
  repeatedly: verify worktree state via `git status` (trust disk, not memory), resume
  with scope-cuts, or go controller-inline with the review gate kept.

## Binding invariants (cost us reviews to learn — do not relearn)

1. Emails NEVER in repo/published sheet/site. Vault = separate never-published sheet.
   The form's "Collect email addresses = Do not collect" setting guards the responses tab
   (which auto-publishes and NO watchdog can scan).
2. Sheet CF colors are LIGHT tints (white sheet, black text) — never site-palette hexes.
3. START HERE's form-URL cell is CONTENT-anchored ("Scoring form URL" label) — never
   coordinate-anchored; polish() rebuild preserves it.
4. Blank `team` in Field = normal (draft is Friday night). Handicap = typed number.
5. Full names (first+last) on Field/Invites/Rooms/vault players; team labels elsewhere.
6. All sheet validations warn-mode; site vocabulary owns dropdown lists (In/wd/out/declined).
7. Test values come from the REAL fixtures (compute, never assume); RED before GREEN.

## Key references

- Apps Script container project `1HE704reG5WNBWSQOMhoiTzG-phbTGKlD_NP6ywipR5zWy1xV9x8bTtOW`
  (Code.gs = sheet-polish; triggers.gs = sheet-triggers; 2 triggers installed: onScoreFormSubmit,
  onDepositEdit). The scorer WEB APP endpoint exists as an echo STUB only — arming = redeploy the
  real doPost on the SAME deployment URL (BACKLOG #1); NEVER arm with the stub.

- Ledgers (rulings live here): `.superpowers/sdd/<wave>/progress.md` in each retained
  worktree (s25a, s25b) and `~/Code/gfy/.superpowers/sdd/2026-09-01-gfy-s26-event-kit/`.
- Render evidence: `render-close/` dirs in the same workspaces (PNG batteries + RESULTS.md).
- Artifacts (private, auth-gated; REUSE these URLs, registered in `~/mc-gallery/ARTIFACTS.md`):
  design canvas `claude.ai/code/artifact/c7f7775e-2462-4398-9f31-4a7a72662e04`,
  §25a review page `claude.ai/code/artifact/52ae7656-5981-4e12-a119-625f8cd38528`.
- Deferred/known oddities: BACKLOG #12/#15/#18 (test-tightness items, roundNorm
  "1.0"→"10" quirk, activeSeason-vs-scorerSeason bare-year divergence, SITE_ROOT
  canonicalization, lodge announcements hidden on `#tv` by ruling).

## First moves for a fresh session

1. Doctrine heartbeat; read this doc + the memory topic file + `BACKLOG.md`.
2. `cd ~/Code/gfy && git fetch origin && git status` — establish lane vs origin/main truth.
3. `npm run test:all` — the offline gate (smoke + qr + kit + template). Proven offline, so
   it is safe every time and cannot rate-limit the sheet.
4. `npm run check:live` ONLY when you need live-sheet truth — it reads the published CSVs
   and the endpoint rate-limits bursts.
5. Then: help with whichever gate Riley opens. **Do not invent work around the scorer —
   arming it is the task, and it is his hands.**
