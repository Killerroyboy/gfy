# Work order — BACKLOG #33 finish (offline build). PM rulings are FINAL (Riley CO-014: build it out, no menus).

Repo ~/Code/gfy. Branch `inv-program` from the verified polish-round tip (given in dispatch). Read tools/gfy-mailer.gs,
test/mailer.test.mjs, README mailer section, BACKLOG #33. Same rules as before: TDD RED→GREEN with the fake
Google harness, `npm run test:all` rc 0 (no pipe-hiding), never '@' to the public sheet, no push/clasp/live/email,
small commits, README + BACKLOG updated. Report: commits, totals + rc, any deviation and why.

## 1. Gmail draft template — execute scratchpad WO-DRAFT-TEMPLATE.md in full (incl. the [FILL block).
## 2. RSVP buttons (part B) — Web App in the SAME Admin-bound project
- Placeholder `{rsvp}` in the template draft → per-recipient URL `<WEBAPP_URL>?t=<token>` (WEBAPP_URL Script
  Property; missing property + `{rsvp}` present → BLOCK). Token = 22+ char random (Utilities.getUuid-based),
  one per (year, player), stored ONLY in a private `RSVP` tab (year, player, token, answer, answered_at, history).
- doGet(t): unknown/old-year token → friendly "this link is not valid" page (no names leaked beyond the token's own
  first name). Valid → HtmlService page, GFY-styled, mobile-first: "{first}, are you in for 2027?" three big
  buttons IN / OUT / MAYBE, current answer shown. NOTHING is recorded on GET (link scanners prefetch GETs).
  Click → google.script.run.recordRsvp(t, choice) → confirmation state on the same page.
- recordRsvp under lock: RSVP tab updated + history appended. Public Invites: IN → responded+committed TRUE;
  MAYBE → responded TRUE; OUT → responded TRUE and status "declined" (only if status blank; never overwrite
  out/declined). Changing away from IN after committed: do NOT untick; Dashboard "changed answer — fix by hand"
  list. All public writes via mailPublicWrite_ (status value is a fixed word, still guarded).
- Test mode: RSVP works fully but writes ONLY to the private RSVP tab (no public writes) — Dashboard labels it.
## 3. Nudges (part D) — menu "Send nudges…"
- Template = the ONE draft with subject prefix `[GFY NUDGE]` (same rules/blocks as invite; `{first}`, `{rsvp}`).
- Candidates: current season, invited, not responded, not out/declined/DNI, last SendLog send ≥ N days (Dashboard
  cell, default 7). Sent as a REPLY in the person's existing invite thread (GmailThread.reply/replyAll on the logged
  thread_id) so the reply watcher keeps matching. SendLog what=nudge. Confirm dialog lists names. Test mode same.
## 4. Health (part E)
- Dashboard STALE already; add Script Property ALERT_TO (empty = off): if a scan throws, or the last good scan
  is > 3 h old when a scan starts, MailApp one alert per 24 h to ALERT_TO. Never alerts in a loop.
- Public START HERE: OUT (published); do not add.
## 5. Template draft update helper
- Add `docs/invite-copy.md` with the final invite + nudge copy (HTML-ready) using {first} and {rsvp}, GFY voice,
  short; the orchestrator will put it into the Gmail drafts. Include `[FILL: …]` only for: 2027 dates, course,
  lodging, format, deposit amount, payment handle, sign-off name.

## 6. Fixes from the polish-round review (PM rulings)
- mailOnEdit (Replies.confirm → committed) must respect test mode like everything else: GFY_MAIL_TEST≠0 → no public write, Dashboard notes "test mode: would commit X".
- Rebuild the Dashboard after every mailOnEdit commit and every recordRsvp (cheap; skip-if-unchanged already exists).
- Name-mismatch list: a Contacts name is a mismatch only if it matches NO Invites row in ANY year (case/space-normalized); a veteran not invited this year is not a mismatch.
- Copy the WO files into docs/ (WO-PROGRAM-33.md, WO-DRAFT-TEMPLATE.md) and commit them.
