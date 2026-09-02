# GFY session handoff — pick up here

> Written 2026-09-02 at the close of the §25/§26 arc (supersedes the 07-30-era handoff;
> its primer + binding invariants are folded in below — full prior text in git history). A fresh session should read this,
> the memory topic file (`~/.claude/projects/-Users-riley/memory/project_gfy_tournament_site.md`),
> and `BACKLOG.md`, then emit the doctrine loaded-heartbeat before acting
> (`~/.claude/projects/-Users-riley/memory/DOCTRINE.md` §1 first; GFY has no company layer).

## What this project is

GFY: an annual golf-trip site + Google Sheet ops system. Static site (one `index.html`,
inline CSS/JS) on GitHub Pages reading published-CSV tabs from one Google Sheet; operator
tooling = two Apps Script files pasted into the sheet's container project, a Google Form
for live scoring, a Python template generator, and a Node pre-send email checker.
Event: NEXT YEAR (2027 dates TBD — sheet still carries 2026 sample/test data) at MeadowCreek (New Meadows, ID). 12–15 four-player teams.

## Where things stand (verify fresh — never trust this doc over `git fetch` + the live site)

- **Live main = `becf0a1`** — §25a broadcast-finish + §25b finish-polish + the Announce-tab
  sync wiring are DEPLOYED and verified (Pages built, live md5 checked at each push).
- **Merged on the lane, AWAITING RILEY'S PUSH WORD: §26 event kit** — lane branch
  `v2.1-invites` @ `940ae47` (merge `69b3fc1` + backlog rows), **11 commits ahead of
  origin/main**, merged suite **331/331**. Rollback ref for the next push: `becf0a1`.
- **Drive sync is 14/14 LIVE**: every config.js gid matches the sheet tab map; the
  Announce tab exists (gid 1337342920, header `year,when,message`, intentionally empty).
- Suites: `node test/smoke.mjs` (jsdom, ~331 checks, moving baseline — assert
  zero-FAIL, never an absolute count); `npm run check-qr` (11); `npm run check-kit` (20);
  `npm run event-ready` (reads the LIVE sheet — exits 1 today on ~48 pre-existing
  sheet-content FAILs: sample residue, unarmed scorer, calcutta cross-tab; that is
  Riley's data-fill runway, not a code defect).

## What shipped in this arc (short)

1. **Drive cleanup (08-24):** goodfriendsyearly@gmail.com reduced to 3 artifacts —
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

## Riley's open gates (in order)

1. **Push word** — ships §26 (11 commits). Procedure below.
2. **BACKLOG #17 — BINDING physical proof steps before any real print run:**
   phone-scan BOTH QR codes on a printed sample; 2027 Info dates/course/lodging fill;
   arm scoring first (cards promise live scoring — BACKLOG #1's runbook: re-paste .gs,
   redeploy endpoint on the same URL, Info keys, polish(), 25-min drill); print vendor +
   paper; TV hardware + on-lodge `#tv` eyeball.
3. **BACKLOG #11** — §25a live eyeball items (masthead wide-seam, doubled context text
   on Board, archive-year chip taste call, phone pass).
4. **BACKLOG #6** — replace the sheet's sample data (event-ready polices residue).
5. Copy list: one new line awaiting his blessing-in-place: "No events scheduled today."

## How this project works (conventions a fresh session must keep)

- **Spec** = §-sections appended to `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md`
  (next free: §27). Plans in `docs/superpowers/plans/`. Canvas-normative clause: the
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
2. `cd ~/Code/gfy && git fetch origin && git status` — establish lane vs origin/main
   truth (the twin session may have pushed or advanced the lane since this was written).
3. If Riley gives the push word: run the push procedure above for the pending §26 commits.
4. Otherwise the work queue is Riley-gated — help with whichever gate he opens
   (#17 proof steps, #11 eyeball fixes, arming runbook, data fill), or new asks.
