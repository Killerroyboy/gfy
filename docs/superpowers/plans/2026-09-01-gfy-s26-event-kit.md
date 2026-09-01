# §26 Event-Kit Wave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec §26: the lodge television mode (`#tv`), the vendored QR encoder, and the print generator (lodge poster + per-team captain cards) — the physical/ambient half of the PGA-caliber kit.

**Architecture:** K-TV is a new hash-route view inside `index.html` reusing the existing refresh loop, §24 phase logic, and §25a board renderers (render reuse, zero logic forks). K-QR/K-PRINT live in `tools/print/` as node scripts following the repo's tools conventions (presend-check.mjs / event-ready.mjs precedent): fetch published CSVs anonymously, emit print-fixed HTML.

**Tech Stack:** Vanilla JS/CSS in `index.html`; node ESM in `tools/print/`; jsdom suite; playwright render harness (s25a/s25b pattern).

**Spec:** `docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md` §26 (rev 2) — read it verbatim before any task; the canvas artifact's Lodge TV / Poster / Captain Card boards are NORMATIVE for visual details (canvas-normative clause).

## Global Constraints

- Worktree `.worktrees/s26`, branch `s26-kit`, base `becf0a1` (= live main). Verify HEAD before every commit. Twin-session discipline: their regions off-limits; smoke additions inside the §25a anchor block with `S26-` names, detail args, established idioms.
- Suite green zero FAIL (moving baseline — 315 at base). Frozen: scorer write path, §24 logic fns, renderField, nextYearModel, §25a/§25b behavioral core (movementFor, renderMastChip, renderHomeBoard, lbRowHTML, the flash gates).
- Honesty (spec §26 verbatim): every TV panel carries "Checked h:mm"; >5 min since last successful fetch ⇒ the stamp escalates visibly ("Checked h:mm — data stale"); fetch-dead-with-no-cache ⇒ honest empty state, never the sample-weekend fallback. Print artifacts carry "Generated YYYY-MM-DD h:mm"; blank cells ⇒ [TBD]; absent dates ⇒ "[ 2027 DATES ]" verbatim; VAULT GUARD: refuse to run if any fetched header row contains email-like columns (email, email_alt, do_not_invite, reason); anonymous published-CSV endpoints ONLY (an auth-demanding response = loud abort).
- QR targets: poster → `https://killerroyboy.github.io/gfy/` exactly; captain card → `https://killerroyboy.github.io/gfy/#score?team=<NAME>` (URL-encoded team).
- No new runtime dependencies; `qrcode-generator` may be VENDORED (MIT, single-file, license header retained) — never fetched at runtime, never a package.json dependency.
- prefers-reduced-motion: TV rotation uses hard cuts (no crossfade) — the rotation itself (content replacement every 20 s) is not "motion" in the CSS sense and stays.

---

### Task 1: K-TV — the lodge television route

**Files:**
- Modify: `index.html` — new `<section class="band view" data-view="tv" id="tvMode">` (the router's VIEWS list auto-derives from `.view` sections — verify by reading the router block ~line 1256); CSS hiding nav/#mastBar/debug chrome on `body[data-view="tv"]`; `renderTv()` + a 20 s rotation driven off the EXISTING refresh/tick machinery (read how `tick()` and `refreshTick` interleave — reuse, never a second global interval unless none fits, and then ONE labeled interval cleared on view exit).
- Test: `S26-T1*` checks.

**Interfaces:** consumes `rankedPlayers`, `lbRowHTML` (mv:null ctx), `renderScoreGrid`'s data path (read-only reuse — the TV Card panel may re-render the grid table into its own container via the same builder functions, NEVER a copied template), `nowNextModel`/schedule rows, `seasonPhase`. Produces: `renderTv()`, `STATE.tvPanel` (0|1|2), `STATE.tvLastFetchAt` read from the existing fetch bookkeeping (find where a successful load stamps time — reuse that timestamp, do not add a parallel clock).

- [ ] **Step 1: Failing checks** — assert: (a) `#tv` route renders the tv section and hides nav/mastBar (CSS source assert + `showView("tv")` DOM assert); (b) rotation state machine: a pure `tvNextPanel(current)` cycling 0→1→2→0, and the panel container re-rendering per state (drive it directly); (c) the stamp: fresh fetch ⇒ `Checked h:mm`; a `tvLastFetchAt` older than 5 min ⇒ the stale escalation string; no data + no cache ⇒ the honest empty copy (reuse the site's existing empty-state strings — ZERO new user-facing copy without flagging; the stale/checked stamp strings come from the spec verbatim); (d) labeled-dot indicator marks the active panel; (e) reduced-motion: no transition/animation properties on the panel swap (source assert).
- [ ] **Step 2: Implement.** Panels: (0) Leaderboard — top rows large-type via `lbRowHTML` with a `tv-scale` wrapper class (CSS transform/font scaling, NOT a second row template); (1) The Card — the hole-by-hole table rendered by the existing builder into `#tvGrid`; (2) Schedule — today's rows via the schedule model. Chrome: masthead strip per the canvas (crest + full name + right-side clock line derived from the SAME stamp), dots + "Rotates every 20 seconds" per the canvas. Cursor hidden via CSS on the tv view. Rotation: advance on the existing cadence machinery every 20 s ONLY while `document.body.dataset.view==="tv"`.
- [ ] **Step 3: Suite green; commit.**

---

### Task 2: K-QR — vendored encoder + tests

**Files:**
- Create: `tools/print/qr-vendor.mjs` (the vendored MIT `qrcode-generator` core, license header verbatim at top, ESM-wrapped, no behavior edits beyond the module wrapper); `tools/print/qr.mjs` (thin API: `qrSvg(text, {modulesize, dark, light}) → svg string`).
- Test: `tools/print/qr.test.mjs` runnable via `node tools/print/qr.test.mjs` (tools tests live beside their tools per repo precedent — CHECK how existing tools are tested and follow that; if the smoke suite is the only harness, add S26-T2 checks that spawn the node test) — vectors: (a) finder patterns present at three corners of the emitted matrix for a known input; (b) deterministic snapshot: `qrSvg("https://killerroyboy.github.io/gfy/")` matrix hash pinned; (c) round-trip sanity vs the library's own `.createDataURL` consistency; (d) the two REAL kit URLs encode without error at the chosen EC level (M).
- License: the vendored file's MIT header retained verbatim + a one-line provenance comment (upstream project, version). No package.json changes.

---

### Task 3: K-PRINT — poster + captain cards generator

**Files:**
- Create: `tools/print/make-kit.mjs` — node ESM, zero deps beyond node builtins + qr.mjs. Reads `config.js` (parse PUB_ID + gids textually like `tools/gid-check.mjs` does — read that tool and reuse its parsing approach), fetches Field + Info published CSVs (anonymous; any 3xx-to-login or 401/403 ⇒ loud abort with the spec's wording), applies the VAULT GUARD (abort listing the offending headers if any email-like column appears), emits `tools/print/out/poster.html` and `tools/print/out/captain-cards.html` (gitignored output dir — add to .gitignore).
- Poster per the canvas board: crest (reference `../../assets/gfy-crest.svg` relatively), THE GOOD FRIENDS YEARLY, McCall line, double-hairline frame, dates from Info (`dates` key; absent/blank ⇒ `[ 2027 DATES ]`), venue line from Info course/lodging with [TBD] for blanks, real QR (poster URL), "Conditions of competition posted at the first tee", footer "Generated YYYY-MM-DD h:mm".
- Captain cards: one card per DISTINCT team with a captain in the CURRENT season's Field rows (team column; captain = the `c`-flagged/captain-marked player — read how the site derives captains in `captainLabel` and mirror the rule textually); card per the canvas: TEAM <NAME>, Captain · <name>, the two-line field note verbatim from the spec, per-team `#score?team=<NAME>` QR, monogram footer, generation stamp. Page-break CSS for print (one card pair per row, `@page` size letter).
- Test: `S26-T3*` or tool-side tests per the T2 pattern: (a) vault guard fires on a fixture CSV with an `email` header (exit non-zero, message); (b) blank date ⇒ the bracketed placeholder verbatim in output; (c) generation stamp present; (d) QR svg present per card with the right encoded target (assert the data content via the qr module, not by decoding); (e) zero `@` characters in emitted HTML (no email can leak into print output — structural guard).

---

### Task 4: Render close + wave verification

- Battery: `#tv` all three panels at 1280×720 (fresh + stale-stamp + empty states), poster.html and captain-cards.html rendered at print aspect (Letter) — visual verdicts against the canvas boards; suite green; `npm run event-ready` unaffected; evidence + RESULTS.md committed per the s25 pattern.
- The on-lodge-TV eyeball, print vendor, paper, and the 2027 Info dates remain RILEY items (spec §26 list) — restate them in the report.

## Self-review notes

- Spec coverage: K-TV → T1, K-QR → T2, K-PRINT → T3, acceptance → T4. Riley items restated, not absorbed. ✓
- Placeholder scan: tasks name exact strings, targets, guards; implementation details that require reading live code (tick machinery, captainLabel rule, gid-check parsing) are explicit READ-FIRST directives, not hand-waves. ✓
- Type consistency: `qrSvg(text, opts) → string` consumed by T3; `tvNextPanel` pure; STATE keys named once. ✓
