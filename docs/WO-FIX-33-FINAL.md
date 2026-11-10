# Work order — final review fixes (#33 round 4). Branch inv-program, tip 6fdfc9e. PM rulings final.
Same rules (RED first, test:all rc 0 no pipe, offline only, small commits, README/BACKLOG).
1. mailWithLock_: SpreadsheetApp.flush() in finally BEFORE releaseLock (and fake records flush; test that every send()
   is preceded by a flush after the reservation append).
2. Send + nudge loops: t0 at function entry; stop before 4.5 min; summary "N not sent yet — run again" (re-run safe).
3. Scan: compute draft status BEFORE taking the lock. RSVP/onEdit-triggered Dashboard rebuilds debounced: skip if last
   rebuild < 60 s ago (Script Property DASH_AT), the scan/menu rebuilds always run.
4. Reply scan: a thread id whose getThreadById THROWS on 3 consecutive scans → treated as missing (counter in Script
   Property), never a permanent scan failure; update MC15/D9 to the new rule (1–2 throws = error, 3rd = missing).
6. End of every send/nudge run: Dashboard rebuild with refreshDrafts=true (also refreshes TPL_STATUS).
7. Mid-run block message names the block (who/what), not "changed while sending".
8. "invite thread missing" note keyed per thread kind (invite vs nudge), deterministic.
9. Fix the D..J comment; delete dead mailRsvpToken_.
10. PM RULING: nudge subject = "Reminder: " + original invite subject (no fake "Re:"). Update tests/README/invite-copy.
Report commits, totals + rc, deviations.
