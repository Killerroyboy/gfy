# Work order — consolidate GFY Admin into GFY Tournament (one file), offline build only

Riley ruled 2026-11-13: "One file, safely". Repo ~/Code/gfy. Branch `one-file` from main (a45ecf3).

## Ground truth (verified live 11-13)
- GFY Tournament (16Co2b3_…) is published to the web as the ENTIRE document: pubhtml lists every tab
  (START HERE, Field, Invites, Rooms, Announce, Form Responses 1, Info, Course, Scores, Schedule, Pairings,
  Calcutta, Payout, Ledger, Champions, Shame). The site reads `pub?gid=<GID>&output=csv` per tab (config.js GID map).
  Before any private tab lands there, the orchestrator (not you) will switch publishing to selected tabs only.
- Bound project of GFY Tournament = tools/clasp/ (Code.gs = tools/sheet-polish.gs, gfy-promote.gs, triggers.gs =
  scorer: doPost/doGet, onScoreFormSubmit, onDepositEdit, setup/teardown). Mailer = tools/gfy-mailer.gs, today bound
  to GFY Admin (tools/clasp-admin/), reaching the public sheet by Script Property PUBLIC_ID.
- One Apps Script project = ONE global scope. Known collisions: `onOpen` (gfy-promote vs mailer), `doGet`
  (scorer vs RSVP web app). Check EVERY top-level function/const/var name across all four files, `_` helpers too.

## Build
1. **Single project.** The mailer runs in the Tournament project. Private tabs (Contacts, Replies, RSVP, SendLog,
   Dashboard, admin READ ME — rename it `Admin READ ME` so it can't be confused with START HERE) live in the same
   spreadsheet. PUBLIC_ID: when unset, or equal to the active spreadsheet id, use the active spreadsheet for both
   roles; keep PUBLIC_ID support so the two-file layout still works until migration day. No behaviour change otherwise.
2. **Collisions.** One `onOpen` building both menus (GFY + GFY Mail). One `doGet` router: an RSVP request (the
   mailer's token param) → RSVP page; anything else → the scorer's existing doGet response, byte-identical.
   doPost stays the scorer's. Add a test that loads all four files into ONE scope (vm context, concatenated in
   clasp file order) and fails on any duplicate top-level declaration.
3. **Polish coexistence.** public polish() (orderTabs_, checkbox windows, START HERE) must leave the private tabs'
   data alone and order them AFTER all public tabs; adminPolish must not touch public tabs except as today.
   Private tabs: red tab colour + warning-only header protection (as now). Second run of each = zero changes.
4. **Publish guard (the safety net).**
   a. `tools/check-publish.mjs` + `npm run check-publish`: fetch `https://docs.google.com/spreadsheets/d/e/<PUB_ID>/pubhtml`,
      list published tab names, exit 1 naming any private tab (closed list from one shared constant) or any tab
      not in the site's expected public set (WARN for unknown, FAIL for private). Offline unit tests with fixture HTML
      (save a trimmed real pubhtml shape; both the `sheet-button-` menu form and single-sheet form).
   b. In Apps Script: before Send invites / Send nudges / adminPolish, fetch the same pubhtml via UrlFetchApp
      (PUB_ID from a Script Property, never hardcoded) and BLOCK with a clear message if a private tab name is
      published. Fetch failure = BLOCK for sends ("can't confirm the email tabs are private"), WARN-only for polish.
      Add the UrlFetch scope to tools/clasp/appsscript.json if scopes are explicit.
   c. Dashboard line: `publish check: OK — private tabs not published` / `PRIVATE TAB PUBLISHED: <names>`.
   d. Fold the check into `npm run event-ready` as a FAIL.
5. **Migration function** `migrateFromAdmin()` (menu GFY Mail → "Import from old Admin file…", Script Property
   ADMIN_ID): copy Contacts, Replies, RSVP, SendLog values (+ checkboxes via adminPolish after) into same-name tabs
   in the active spreadsheet. Refuse if a destination tab already has data rows. Refuse unless the publish guard
   passes. Report per-tab row counts copied vs source; verify equal. Never deletes the source. Idempotent refusal
   on second run. Script properties the mailer uses (WEBAPP_URL, ALERT_TO, NUDGE_DAYS, GFY_MAIL_TEST, prefixes…)
   are listed in README for the orchestrator to set by hand — do not try to copy properties across projects.
6. **Leak invariant update.** "Never '@' to the public sheet" becomes "never '@' to a PUBLISHED tab": the existing
   leak test must now assert no '@' write lands on any tab outside the private closed list. Keep it as strict.
7. **tools/clasp/** = the deployable copy: add gfy-mailer.gs there (repo copy, identical md5 to tools/gfy-mailer.gs);
   appsscript.json merged (webapp executeAs USER_DEPLOYING, access ANYONE_ANONYMOUS — check what the scorer
   deployment uses today in tools/clasp/appsscript.json and README; if they differ, STOP and report, don't guess).
8. **Docs.** README: one-file layout, migration-day runbook (order: publish selected tabs → check-publish green →
   clasp push → New version on the EXISTING scorer deployment so score_endpoint URL is unchanged → set
   WEBAPP_URL to that same /exec URL → consent → Import → adminPolish → Install / repair triggers → delete old
   Admin project triggers → trash Admin), rollback. BACKLOG new row #34. make_admin_template.py: note it's legacy.

## Rules
TDD, RED before GREEN, reuse the fake SpreadsheetApp/GmailApp/UrlFetchApp harness (add UrlFetchApp fake).
`npm run test:all` rc 0 — capture rc, no pipe-hiding. Do NOT push, no clasp, no live Google, no email, no network
in tests. Small commits on `one-file`. Report: commits, totals + rc, every collision found and how resolved,
open questions.
