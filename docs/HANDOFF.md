# GFY — Session Handoff (updated 2026-07-30 night)

> Fresh-session bootstrap. Read this, then `.superpowers/sdd/progress.md` (authoritative
> per-task ledger), then the spec's latest sections. Verify live state before asserting —
> Riley edits the sheet in real time.

## What this project is

GFY: an annual golf-trip site + Google Sheet ops system. Static site (one `index.html`,
inline CSS/JS) on GitHub Pages reading published-CSV tabs from one Google Sheet; operator
tooling = two Apps Script files pasted into the sheet's container project, a Google Form
for live scoring, a Python template generator, and a Node pre-send email checker.
Event: **Aug 14–16, 2026** at MeadowCreek (New Meadows, ID). 12–15 four-player teams.

## Live systems (verify, don't trust)

| Thing | Where | State at handoff |
|---|---|---|
| Site | killerroyboy.github.io/gfy (repo Killerroyboy/gfy, public) | LIVE at **v2.6 live scorer** (`6c88071`, deployed 2026-07-30 night, live md5 == tip, scorer markers verified served) |
| Local repo | `~/Code/gfy`, branch `v2.1-invites` | origin/main == `6c88071` DEPLOYED (union suite 197/197); local tip `3327301` (+prototype ref `d73eaea`, +rev-3 plan — spec/plan commits only, undeployed is fine); next-push rollback ref = `6c88071` |
| Google Sheet | (sheet edit link — Riley's private bookmark; removed from repo), account **goodfriendsyearly@gmail.com** | polished (light CF tints, START HERE first tab, real Course 18); Riley entering REAL data (teams Jake/Greg/Voss, real rounds) |
| Apps Script | project `1HE704reG5WNBWSQOMhoiTzG-phbTGKlD_NP6ywipR5zWy1xV9x8bTtOW` (Code.gs = sheet-polish + `/** @OnlyCurrentDoc */`; triggers.gs = sheet-triggers) | **2 triggers INSTALLED** (onScoreFormSubmit, onDepositEdit) — verified on Triggers page |
| Scoring form | `docs.google.com/forms/d/e/1FAIpQLSdlNWdXrrolvALR1JkT0_QtQH7mpS6cDscq-TI3UGIfD6FsdA/viewform` | PUBLISHED, linked to the sheet, URL pasted in START HERE B8; **email collection = Do not collect (verified)**; E2E proven (Jake r1 h18=5 → applied) |
| Published CSV | PUB_ID + 13 gids in `config.js` (info gid fixed to 346870487) | 13/13 verified |

## Governance / where the rules live

- Spec: `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` — §12 (v2.2), §13 (v2.3),
  §14+hardening (v2.4), §14.1 (shotgun), §15+hardening+H-PLACE-PARSE (v2.5, **BUILT**),
  §16 (crest v3 Park Badge — a DIFFERENT round, parallel session, its own plan).
- Plans: `docs/superpowers/plans/` (v2.3 ops, v2.4 ease, v2.5 tournament rev 2, crest-v3).
- Ledger: `.superpowers/sdd/progress.md` — every task, review, fix round. RESUME FROM HERE.
- Process: subagent-driven dev (fresh implementer per task, adversarial review each, fix
  rounds re-reviewed, whole-round final review on strongest model). It caught real bugs
  every single round — do not skip reviews.
- Doctrine: `~/.claude/projects/-Users-riley/memory/DOCTRINE.md` + session-start heartbeat.
- **The fence (amended, Riley ratified 2026-07-30)**: the push DECISION stays Riley's,
  per push — but for THIS repo only he says the word in chat ("push it") and the agent
  executes `GFY_PUSH_GRANT=1 git push origin v2.1-invites:main` from inside ~/Code/gfy,
  then verifies Pages build + live md5 and reports true state. The fence-hook honors the
  token ONLY with a ~/Code/gfy cwd, bypasses only the push check, and logs every grant
  (~/.mc-ground/state/fence.log). NEVER push without the word; never let a subagent push.
  All other repos: fence absolute. Rollback ref for next push: `f9f77bb`
  (say-the-word pushes proven twice, both live-verified 2026-07-30).

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

## Open work, in priority order

1. **DONE — v2.5 build** (spec §15 + hardening): shipped at `793e647` via the full pipeline
   (plan rev 2 after a 13-finding adversarial plan review; 4 tasks × implement→opus
   review→fix rounds; fable whole-branch review + final wave; 155/155). Podium history,
   public `#draft` board, captain-only labels, N-FULLNAMES, template columns.
   Accepted residuals + carried-minors triage live in the ledger's FINAL entry.
2. **DONE — pushed + deployed 2026-07-30**: `49efa87` live, Pages built, live md5 == tip,
   `#draft` present in served HTML. Rollback ref for the NEXT push: `49efa87`.
3. **DONE — ops-hardening wave (§19) BUILT + reviewed at `7419c89`** (169/169; all 11
   ratified items incl. the 4 Riley-ruled judgment calls; fable whole-wave review, final
   verdict Yes). NOT YET LIVE on the sheet: the .gs half deploys ONLY when Riley
   re-pastes BOTH files post-push — sheet-polish.gs as Code.gs, sheet-triggers.gs via
   File → New → Script file (NEVER over Code.gs) — then runs `polish()` once (builds the
   FORM TEAM LIST block). New tools: `npm run check-template`, `npm run check-gids`;
   presend gains `--extra-gid responses=590385167` + loud V-PROBE skip. Residual:
   whether imported TRUE/FALSE render ticked after polish() — observe at next template
   upload.
4. **Crest v3 (§16)**: parallel session's round — its plan at
   `docs/superpowers/plans/2026-07-29-gfy-crest-v3-park-badge.md`; do not collide.
5. Form polish (Riley, 60s): Required toggles on Team/Round/Team score; retitle the form
   doc (internal name "Untitled form"); replace Team options at draft night.
6. Riley data entry: real roster w/ full names (N-FULLNAMES now documented in README +
   START HERE), podium history backfill (Champions `place`/`players` now live),
   strengths notes.
7. Residual verifications: phone-width eyeball of the grid AND the new `#draft` view
   (real browser — carried); Jake h18=5 was MY test submission — Riley must confirm or
   correct that one cell.
8. Backlog: responses-tab watchdog coverage (ops-wave D4 candidate); task-11-report.md
   root cleanup; vault Drive-auth checker upgrade path.

## Fresh-session paste block

```
Read ~/Code/gfy/docs/HANDOFF.md and ~/Code/gfy/.superpowers/sdd/progress.md (tail 60),
then run: cd ~/Code/gfy && git log --oneline -15 && npm test 2>&1 | tail -3 &&
git ls-remote origin main | cut -c1-8
That's the full state. The active work item is the v2.5 build (spec §15 + its hardening
block in docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md) via the same
subagent-driven pipeline recorded in the ledger. Riley's live sheet changes in real time —
verify anything sheet-related against the live sheet before acting on it. Pushes to main
are Riley's, via the fence hook. Honor every invariant in HANDOFF.md §invariants.
```

## 2026-07-30 night — v2.6 DEPLOYED · rev-3 UI wave IN FLIGHT (superseded — see 2026-07-31 section below)

**v2.6 live scorer is DEPLOYED and live-verified** (`6c88071` == origin/main == live md5;
push via the ratified say-the-word grant, fence-logged). Full round record: spec §18 rev 2
(3-review pressure test) → 8-task subagent build (7 fix rounds, mutation-evidenced) →
whole-branch review → final fix wave → reconciliation merge absorbing the §19 ops wave
(O-REJECT/O-REPLACED ported into shared `applyScore_`; polish blocks collapsed; J4/J10
adapted) → reconciliation review → placeholder restore. Union suite 197/197 (J 10/10,
X 28/28).

**RILEY'S PRE-LINKS RUNWAY (blocking before captains get links — README "Live scoring"):**
(1) re-paste BOTH .gs files onto the live sheet + redeploy (Edit → New version — the live
script predates the merge); (2) CORS spike `tools/spike-scorer-cors.md`; (3) Info keys
`score_endpoint` + `form_url`, re-run polish(); (4) the 25-min SC-DRILL. PARKED RILEY
DECISION: sheet doc-id sits in public git history since `f261fd2` — recommendation
accept-residual (sheet 401s anonymous; drill re-verifies sharing).

**IN FLIGHT: §18 rev 3 UI wave** (Riley: "lets do the rev 3 UI wave").
- Spec pins: §18 rev 3 + SC-BOARD-BTN (both ratified, in the spec file).
- Fidelity reference OF RECORD: `tools/scorer-rev3-prototype.html` (`d73eaea`) — Riley-approved
  prototype, artifact wrapper stripped; its demo logic (fake timer, hardcoded conflict, demo
  copy) is spec-pinned NOT-spec.
- Plan: `docs/superpowers/plans/2026-07-30-gfy-scorer-rev3-ui.md` (`3327301`) — 5 tasks,
  SCREEN-ONLY mandate (zero engine changes), suite arc 197→201.
- Worktree: `.worktrees/scorer-rev3` (branch `scorer-rev3`), baseline 197/197.
- Ledger (RESUME POINT): `.superpowers/sdd/2026-07-30-gfy-scorer-rev3-ui/progress.md`.
- State at handoff: **Task 1 committed (`91f03a8`, 197/197, X7/X16/X20 adapted + 7 blocks
  selector-renamed) — task review WAS IN FLIGHT in the prior session.** If the ledger shows
  no review verdict for Task 1, RE-DISPATCH its review (package exists:
  `review-3327301..91f03a8.diff` in the ledger dir; brief + report files alongside).
  Then Tasks 2–5 per plan, whole-branch review (strongest model), reconciliation-aware
  merge to `v2.1-invites` (check `git log v2.1-invites` for concurrent movement FIRST —
  three parallel sessions have landed on this branch this week; T8 discipline).
- Known residuals for the wave's final review: "Par —" degrade path render-uncovered
  (Task 5 visual pass); conflict order flipped to SHEET·MINE per prototype (cross-surface
  consistency was under review at handoff).

## 2026-07-31 — rev-3 UI wave COMPLETE + MERGED (local) · push = the gate

**v2.1-invites at `565abf3`** (merge of scorer-rev3 `2fef74e`), union suite **201/201**, NOT pushed.
Full trail: `.superpowers/sdd/2026-07-30-gfy-scorer-rev3-ui/progress.md` (ledger, 5 task reports,
fix-wave report, 78+ S11 PNGs — retained deliberately as evidence).

- **Review trail:** per-task adversarial reviews (2 Critical + 8 Important found and fixed across
  fix rounds, every round re-reviewed) → whole-branch review (strongest model): screen-only mandate
  PROVEN byte-level (26 engine function bodies md5-identical base→HEAD), verdict "with fixes" →
  final fix wave `2fef74e` (drain-repaint picker guard; 390w row drift 26→0px; reduced-motion
  next-hint static signal; pad digits raised per Riley ruling; X8/X31 hardening) → scoped
  re-review: all addressed, third independent 201/201.
- **Riley rulings this wave:** 1–19 hard rule governs the overflow formula (plan amended `95e8ce8`);
  pad digit hierarchy raised to the prototype's intent; D3 follow-up wave QUEUED.
- **Accepted residuals (rulings in ledger):** third-number keep-then-reopen destructive window
  (ADD TO THE CAPTAIN DRILL), board-button ≤60s identity lag, aria-modal focus/keyboard work
  (follow-up wave), board-button season-pin test hardening (follow-up).
- **QUEUED NEXT — D3 follow-up wave (Riley-approved, PRE-EXISTING bug, not this wave):** a blank
  par cell makes courseMap() carry par=0, silently skewing scorer to-par AND every team's board
  To-par with no warning. Shape: validate VALUES in courseMap() (18 positive-int pars, else null →
  the existing honest strokes degrade) + a health-strip warning naming the hole. Own plan/tests/
  reviews; land before the tournament.
- **Pre-links runway** unchanged (README "Live scoring") **plus two additions:** one real-phone
  eyeball of the card at 390w under production Jost (the S11 harness ran the fallback font), and
  the third-number keep-then-reopen flow added to the 25-min drill.
- Housekeeping: scorer-rev3 branch + worktree retained; one superseded stash on the worktree (safe
  to drop); the 07-30 dual-controller incident is documented and closed in the ledger (stand-down).

**PUSHED + LIVE 2026-07-31:** main = `6c6cf9e`, Pages built for that exact commit, live `index.html` md5 == tip, rev-3 markers verified served. Next-push rollback ref = `6c6cf9e`. Remaining: pre-links runway + D3 follow-up wave.
