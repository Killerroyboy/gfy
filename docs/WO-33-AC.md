# Work order — event-ready status=Yes gap + BACKLOG #33 parts A+C (offline build only)

Repo ~/Code/gfy. Create branch `inv-auto` from main (4db4e8c). Read first: BACKLOG #33 and #9 rows,
README "The Admin vault (emails)", "Before every send round", "Replies (Gmail loop)", "The invite list";
tools/presend-check.mjs (DNI + leak rules to mirror), tools/make_admin_template.py (vault schema),
tools/gfy-promote.gs (pcNorm_/pcYes_/pcCommitted_ name + truthiness rules), test/smoke.mjs (fake
SpreadsheetApp pattern from the W17-* block — reuse it).

## 0. Gap fix (small, first commit)
tools/event-ready.mjs: treat Invites `status` yes/y (case/space-insensitive) as committed exactly like
Promote's pcCommitted_, so committed-but-unpromoted WARN fires for those rows. RED test first.

## A. "Send invites" button — tools/gfy-mailer.gs, bound to the private GFY Admin sheet
- Menu "GFY Mail → Send invites…" on the ADMIN sheet. Reads Contacts (vault) + the PUBLIC sheet's Invites
  via SpreadsheetApp.openById(PUBLIC_ID from a Script Property, never hardcoded).
- Recipients = current-season Invites rows not yet `invited`, status not out/declined, not DNI in Contacts,
  with an address. Blocks the whole send (like presend-check) on: DNI name with active invite row, unpaired
  DNI, invitee missing from vault. Shows a confirm dialog listing name → address; cancel = nothing sent.
- Sends ONE email per person via GmailApp from the account (subject/body from an `InviteTemplate` tab on the
  Admin sheet, {first} placeholder). Records SendLog row (date, player, address_used, what=invite, note) +
  NEW SendLog column `thread_id`. Ticks `invited` on public Invites. Daily-quota guard (MailApp.getRemainingDailyQuota).
- TEST MODE: Script Property GFY_MAIL_TEST=1 (default ON when unset) → every message goes to
  goodfriendsyearly@gmail.com with "[TEST → real address]" in subject, nothing ticked on the public sheet.
  Going live requires setting the property to 0 by hand. Document in README.
## C. Reply watcher — same file
- Time trigger every 15 min (installer function `installMailTriggers()`, idempotent).
- For each SendLog thread_id: any message after the send that is from someone other than the account and
  not auto-generated (Auto-Submitted header / "out of office"/"automatic reply" subject / mailer-daemon /
  postmaster) → tick `responded` for that player on public Invites. Bounce (mailer-daemon) → Contacts
  notes "BOUNCED <date>" and NOT responded.
- Reply text/snippet goes ONLY to a private `Replies` tab on the Admin sheet (date, player, from, snippet,
  looks_yes checkbox-suggestion, confirm checkbox). NEVER auto-tick committed from prose.
- Health: write last successful scan time (timestamp only, no names) to Admin `READ ME`!B-cell AND to the
  public START HERE is OUT OF SCOPE (leave a TODO; START HERE is published — counts/time only).
- Never write anything containing '@' to the public sheet. Add a test that fails if any public-sheet write
  in gfy-mailer.gs could carry an address (fake SpreadsheetApp records every write; assert none has '@').

## Rules
TDD with fake GmailApp/SpreadsheetApp/PropertiesService/LockService (LockService around public writes).
Each behaviour RED before GREEN. `npm run test:all` green, capture rc (no pipe-hiding). Update
make_admin_template.py (SendLog.thread_id, InviteTemplate, Replies tabs) + `npm run check-template`.
README section for the mailer: install (paste into Admin sheet's Apps Script, set PUBLIC_ID property,
run installMailTriggers), test mode, going live. Do NOT push, do NOT run clasp, do NOT touch live Google,
do NOT send any email. Small commits on `inv-auto`; mark BACKLOG #33 `partial` (A+C built offline).
Report: commits, test totals + rc, open questions.
