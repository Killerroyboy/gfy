# Work order — fix the #33 RE-REVIEW (N1–N8). Branch inv-program, tip c232319. PM rulings are final.

Same rules: RED test first per item (upgrade the fake so it would catch it), `npm run test:all` rc 0 (no pipe-hiding),
no push/clasp/live/email, small commits, README + BACKLOG updated. Report commits, totals + rc, deviations.

N1 (HIGH) RSVP/scan/onEdit must never wait on a long send. Implement the reservation design:
  - Run-exclusivity for sends/nudges via a Script Property lease SEND_RUN={id,expires(+8 min)} taken/checked under a
    SHORT script lock; second concurrent send refuses ("another send is running").
  - Per recipient: short lock → fresh re-check (invited / SendLog season / DNI / status) + append reservation SendLog
    row (what=invite|nudge, note "season Y pending <runId>") + mint token → release. Send with NO lock. Short lock →
    write thread_id + note "season Y sent" into that row + public tick → release.
  - A pending row counts as logged (never re-sent). Dashboard lists "pending, unconfirmed" rows for a human.
  - Fake: lock contention test — an RSVP during a 30-recipient send completes in < 2 s of lock wait.
  - RSVP page failure handler retries once after ~5 s.
N2 every mailAppend_ under the script lock (L693 inside the lock body; L836, L885 wrapped). mailAppend_ asserts lock held
  (track holder flag in mailWithLock_). Test: calling mailAppend_ without the lock throws.
N3 add "Install / repair triggers" to the GFY Mail menu; README step 5 uses the menu. Any README "run X from the editor"
  step becomes a menu item. Guard stays.
N4 PM RULING: drop GmailThread.reply entirely. A nudge is ALWAYS a fresh email to the exact logged address, subject
  "Re: " + the person's original invite subject (Gmail threads it for most recipients), body from the NUDGE draft; its
  thread_id is logged and watched like the invite thread. Remove mailNudgeLive_ reply branch + its tests; test the new path.
N5 closed by N1 (the reservation row exists before send()). Also: if d.send() throws, do NOT delete the reservation —
  mark it "send error — check Sent before re-running" (Dashboard lists it); never claim "safe to re-run".
N6 before any LIVE send: unflagged RSVP rows with an answer but no live invite SendLog row for that player → BLOCK with
  "rehearsal answers from an older version — clear them (menu: Clear rehearsal answers)". Add that menu item: clears
  answer/answered_at/history on test-flagged and such unflagged rows only.
N7 nudge-days lives in Script Property NUDGE_DAYS (Dashboard shows it, edited via menu "Set nudge days…"); Dashboard
  rebuild runs under the lock and skips getDrafts() except from adminPolish/menu/scan (RSVP/onEdit rebuilds reuse the
  cached template status stored in a Script Property).
N8 guard checks the trigger's getHandlerFunction() matches the entrypoint; getThreadById in try → missing; auto-reply
  msg ids added to `seen` (no refetch); onEdit + Dashboard share one truthiness helper; mailIsOurRule_ only by an exact
  tag, never by formula content.
Probe d follow-up: leftover-token check must also catch a token split by inline markup in HTML (strip tags then scan for
  `{`…`}` / `[FILL`), and the HTML body must contain the rsvp URL after fill (else BLOCK).
