# Work order — invite template = a Gmail draft (replaces the InviteTemplate tab)

Repo ~/Code/gfy. Branch `draft-template` from the tip that includes the polish round (`polish-round`, after it
is verified/merged — base given in the dispatch). Read tools/gfy-mailer.gs, test/mailer.test.mjs, README mailer section.

Riley ruled 11-10: the invite is written as a normal Gmail draft in goodfriendsyearly@gmail.com.
- Template = the ONE draft whose subject starts with `[GFY TEMPLATE]` (case-insensitive, trimmed). Zero or
  2+ such drafts → Send BLOCKED with a clear message (name the count). The prefix is stripped from the sent subject.
- Per recipient: copy the draft's subject + HTML body + plain body + inline images + attachments
  (GmailMessage.getAttachments({includeInlineImages:false}) + inline images via getAttachments({includeInlineImages:true})
  mapped to cid — use the documented GmailApp pattern; if inline-image cid mapping is not robustly testable in the
  fake, support attachments + HTML and BLOCK when the draft has inline images, with a message saying so — never
  send a broken email). Replace `{first}` everywhere in subject + bodies. Unreplaced `{...}` token → BLOCK.
- The draft itself is never sent, modified or deleted.
- Test mode unchanged (to goodfriendsyearly@, "[TEST → real address]" subject prefix). The confirm dialog shows
  the final subject for the first recipient.
- Remove InviteTemplate from: mailer reads, adminPolish tab list/order, make_admin_template.py, template xlsx
  (regenerate; npm run check-template), README. adminPolish must NOT delete an existing InviteTemplate tab on the
  live sheet — leave it, and the Dashboard shows a one-line "InviteTemplate tab is no longer used — safe to delete".
  Dashboard also shows template status: "template draft: OK — <subject>" / "MISSING" / "2+ drafts".
- TDD with the fake GmailApp (add getDrafts/GmailDraft/getMessage). RED before GREEN. `npm run test:all` rc 0.
- No push, no clasp, no live Google, no email. Small commits. Report: commits, totals + rc, open questions.
- Riley's real draft exists (subject "[GFY TEMPLATE] Good Friends Yearly 2027 — are you in, {first}?", HTML + plain). It contains "[FILL: ...]" placeholders → ALSO BLOCK when subject/body contains "[FILL" (case-insensitive), message: "the template draft still has [FILL] spots". Test it.
