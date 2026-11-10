# Work order — fix the independent review of #33 (all findings), branch inv-program (tip 0431603)

Review findings are in this file's §A (copied verbatim from the reviewer, PM-verified where noted). Fix ALL of them.
Same rules: RED test first for each (upgrade the fakes so they would have caught it), `npm run test:all` rc 0 (no
pipe-hiding), no push/clasp/live/email, small commits, README + BACKLOG updated. Report commits, totals + rc, deviations.

## A. Findings (ranked)
H1 double-send on re-run/crash/concurrent click: exclude anyone with a current-season SendLog what=invite row; tryLock
   the WHOLE send; re-check invited + SendLog under the lock right before each send.
H2 Sheets coerces the "yyyy-MM-dd HH:mm" scan stamp to a Date → parseDate throws live → stale alert dead, Dashboard
   always STALE. Store epoch ms as TEXT (or setNumberFormat("@")) and make every reader accept Date|number|string.
   Upgrade the fake: setValue of a date-like string returns a Date from getValue; parseDate throws on bad input.
H3 test-mode RSVP answers persist on the real player's token → after go-live the page shows a fake prior answer.
   Fix: test-mode sends use separate test tokens (RSVP row flagged test, or a distinct test token column); live
   sends never reuse a test token; test answers never shown on a live token's page.
M1 scanReplies ticks `responded` publicly even in test mode → gate on !mailIsTest_, Dashboard "test mode: would mark responded X".
M2 nudge replyAll goes to the LAST message (bounce/mailer-daemon/self): skip BOUNCED players; do NOT use replyAll —
   send a NEW message to the exact logged address with In-Reply-To/References headers? Apps Script GmailApp can't set
   headers; so use GmailThread.reply only when the last message's sender is the account AND its recipient exactly
   equals the logged address (parsed, not substring); otherwise send a fresh email to the logged address with the
   invite subject prefixed "Re: " and log the NEW thread_id too (scanner must watch all logged thread_ids per player).
M3 PM-VERIFIED LIVE: Gmail rewrites href="{rsvp}" in a draft to href="javascript:void(0);" and strips button
   background; it also wraps links as https://www.google.com/url?q=<real>&... Fix: the button is produced by the
   mailer — template text token `{rsvp_button}` → mailer injects the full styled <a href=URL> (GFY colors #0E2019 /
   #E9E3D3); `{rsvp}` text → URL (in HTML, as a linked URL). BLOCK if the draft HTML contains href="javascript:" or
   %7B...%7D. Unwrap google.com/url?q= redirects in the copied HTML back to the real URL (decode q). Update docs/invite-copy.md.
M4 anonymous web app can call any global function: every non-entrypoint global gets a trailing underscore; menu/
   trigger entrypoints are thin wrappers that refuse unless invoked with UI or by a trigger event (check `e` /
   ScriptApp.getProjectTriggers ownership / try getUi). Only doGet, recordRsvp (and its page helpers) are web-callable.
   Test: enumerate globals without '_' and assert the allowlist.
M5 RSVP for DNI/out/declined rows: never commit/decline those public rows; list on Dashboard. OUT→IN with status
   declined: do not tick committed silently — put on "changed answer — fix by hand".
M6 quota/robustness: skip threads already responded; getRawContent only when cheap checks can't decide; a missing/
   deleted thread is reported on the Dashboard, never fails the whole scan; budget the scan (stop at ~4.5 min, resume next run).
L1 fill-down over Replies: any-row-ticked per player. L2 write thread_id/msg_id/token as TEXT. L3 adminPolish never
   overwrites formulas (skip cells with getFormulas() ≠ "") and only replaces ITS OWN CF rules (tagged), keeps user rules.
L4 test-mode nudge rehearsal: candidates include invite-test rows WHEN in test mode (still sent only to goodfriendsyearly@).
L6 README: web app is a deployed snapshot — after code changes, Manage deployments → Edit → New version (same URL).
L7 isOut also treats no / not coming / nope / n (case-insensitive) as out for SENDING (never invite), mirror in presend-check.
L8 fix the stale comment; delete orphan drafts on send failure.

## B. PM addition — staging isolation
Script Properties TEMPLATE_PREFIX (default "[GFY TEMPLATE]") and NUDGE_PREFIX (default "[GFY NUDGE]") so a staging
project can use "[GFY STAGING TEMPLATE]" / "[GFY STAGING NUDGE]" in the same Gmail without colliding with live.
Live must IGNORE drafts with the staging prefixes (prefix match must be exact, not startsWith of a longer prefix).
