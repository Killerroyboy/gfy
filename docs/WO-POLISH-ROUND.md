# Work order — GFY polish round (items 2–5), offline build only

Repo ~/Code/gfy. Branch `polish-round` from main (9a597e0). Read first: tools/gfy-mailer.gs (+ test/mailer.test.mjs
fake-API pattern), tools/sheet-polish.gs (polish() conventions: E-IDEM, protectHeader_, applyCheckboxes_,
CHECKBOX_COLS closed list, START HERE builder), tools/make_admin_template.py, README mailer + polish sections,
BACKLOG #18 (F-NAMES: START HERE is PUBLISHED → counts/time only, never names).

Live GFY Admin today (hand-built 11-10): tabs Contacts, Replies, InviteTemplate, SendLog, READ ME. Contacts =
template sample rows only. Replies/InviteTemplate typed by hand (plain text, no validation).

## 2. adminPolish() for GFY Admin — in tools/gfy-mailer.gs (menu "GFY Mail → Polish admin sheet")
- Create any missing tab with its template headers (same schema as make_admin_template.py; single source — add
  a test that the .gs schema equals the python TABS headers). Append missing headers only; never move/clear data.
- Freeze row 1, protect header row (warning-only like public polish), checkboxes on Contacts.do_not_invite,
  Replies.looks_yes, Replies.confirm (convert existing "TRUE"/"FALSE" text to real booleans, nothing else).
- Email format highlight (CF, not rejecting validation) on Contacts.email/email_alt.
- Tab colors + order: Dashboard, Contacts, Replies, SendLog, InviteTemplate, READ ME; end on Dashboard.
- Name-mismatch warning: Contacts.player names with no exact (mailNorm_) match on the current-season public
  Invites → listed in Dashboard + highlighted. Idempotent (second run = zero changes; test it).
## 3. confirm → committed
- Installable onEdit trigger (installed by installMailTriggers, idempotent) on Admin Replies.confirm: TRUE →
  tick `committed` for that player/current year on PUBLIC Invites via mailPublicWrite_ under lock. Unticking
  does NOT untick committed (log a note instead). Never writes anything but TRUE. Works from mobile (onEdit).
## 4. Dashboard tab (private, names OK) — rebuilt by adminPolish() and at the end of every scanReplies
- Counts invited / responded / committed / out for current season; lists: needs-nudge (invited, not
  responded, N days since SendLog date — N from a Dashboard cell, default 7), bounced, unconfirmed looks_yes,
  name mismatches; last scan time + "STALE" if > 1 h old at rebuild.
## 5. Public sheet tidy — tools/sheet-polish.gs
- Invites: checkbox/validation range limited to (last data row + 50), clear validation/FALSE on the excess
  BLANK-player rows only (never a row with any value in year/player); published CSV must drop the ~994 FALSE
  rows. Same rule for every CHECKBOX_COLS tab. Test: blank rows beyond the window carry no FALSE.
- START HERE: wrap text in column A / widen; drop the legacy "Scoring config moved → Info tab" row once
  Info carries score_endpoint/form_url (keep it if Info lacks them — never lose the only copy).

## Rules
TDD, RED before GREEN, reuse the fake SpreadsheetApp/GmailApp harness. `npm run test:all` rc 0 (capture rc,
no pipe-hiding). Never any '@' to the public sheet (extend the existing leak test to the new writes).
Update README (admin polish, confirm→committed, dashboard), BACKLOG (#33 items + #18 overlap). Do NOT push,
no clasp, no live Google, no email. Small commits on `polish-round`. Report: commits, totals + rc, open questions.
