# GFY — Session Handoff (updated 2026-07-29 evening)

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
| Site | killerroyboy.github.io/gfy (repo Killerroyboy/gfy, public) | LIVE at v2.3 (`7714510`) |
| Local repo | `~/Code/gfy`, branch `v2.1-invites` | **v2.5 BUILT + reviewed at `793e647`** (155/155), **not pushed** (33 commits pending, ff-promotable, rollback `7714510`); crest-v3 round (§16) in flight from a parallel session |
| Google Sheet | id `16Co2b3_uaBhg1tzFw56aGJVsicgPx_xeQr_mCgHPNBw`, account **goodfriendsyearly@gmail.com** | polished (light CF tints, START HERE first tab, real Course 18); Riley entering REAL data (teams Jake/Greg/Voss, real rounds) |
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
- **The fence**: pushes to main are Riley-typed (`! git push origin v2.1-invites:main`);
  a PreToolUse hook blocks agent-side pushes BY DESIGN. Rollback ref for next push: `7714510`.

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
2. **Riley push gate**: everything since `7714510` ships on his next `!` push
   (33 commits incl. v2.5 + crest-v3 spec/tools work; ancestry verified ff-promotable).
3. **Ops-hardening wave (PROPOSED, not built)**: 8 small judgment-free sheet-ops fixes
   (top: repo `sheet-polish.gs` missing `@OnlyCurrentDoc`; template content-checker;
   gid-check tool; presend V-PROBE silent-skip warning) + 4 Riley-judgment items —
   grounded inventory at `.superpowers/sdd/ops-research.md` (gitignored scratch).
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
