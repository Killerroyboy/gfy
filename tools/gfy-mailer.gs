/** GFY Mail — invite sender (BACKLOG #33 part A) + reply watcher (part C).
 *
 *  Bound to the PRIVATE "GFY Admin" sheet (Extensions → Apps Script → paste this
 *  file as its own file). It is NOT for the public GFY sheet's project.
 *
 *  Script Properties (Project Settings → Script properties):
 *    PUBLIC_ID      the public GFY sheet's spreadsheet id (never hardcoded here)
 *    GFY_MAIL_TEST  anything but the exact value 0 (including unset) = TEST MODE:
 *                   every message goes to goodfriendsyearly@gmail.com, subject
 *                   prefixed "[TEST → real address]", nothing is ticked on the
 *                   public sheet. Set it to 0 BY HAND to go live.
 *
 *    WEBAPP_URL     the deployed Web App /exec URL of THIS project (RSVP links).
 *                   Required only when the template draft contains {rsvp}.
 *    ALERT_TO       optional: an address that gets ONE health alert per 24 h
 *                   (a scan threw, or the last good scan is over 3 h old). Empty = off.
 *    ADMIN_ID       optional fallback for the Web App if getActiveSpreadsheet() is
 *                   unavailable there: the Admin sheet's own id.
 *
 *  Privacy rule: addresses, reply text and bounce notes live ONLY on the Admin
 *  sheet. The one thing this file writes to the public sheet is a boolean tick
 *  in Invites (`invited` / `responded`), through mailPublicWrite_, which refuses
 *  any value containing '@'.
 *
 *  TODO (out of scope, separate work order): publish the last-scan time on the
 *  public START HERE tab. START HERE is published — counts/time only, no names.
 */

const MAIL_TEST_ADDR = "goodfriendsyearly@gmail.com";
const MAIL_TAB = { contacts: "Contacts", log: "SendLog", replies: "Replies", readme: "READ ME", invites: "Invites", dash: "Dashboard", rsvp: "RSVP", oldTpl: "InviteTemplate" };
const MAIL_TPL_PREFIX = "[GFY TEMPLATE]";     // the ONE Gmail draft whose subject starts with this is the invite
const MAIL_NUDGE_PREFIX = "[GFY NUDGE]";      // the ONE Gmail draft whose subject starts with this is the nudge

// Admin-sheet schema. LOCKSTEP with tools/make_admin_template.py TABS (single
// source: test/mailer.test.mjs AP1 fails if the two differ). Dashboard is built
// by code, not templated, so it is deliberately not here.
const MAIL_SCHEMA = {
  "Contacts": ["player", "email", "email_alt", "phone", "do_not_invite", "reason", "notes"],
  "SendLog": ["date", "player", "address_used", "what", "note", "thread_id"],
  "Replies": ["date", "player", "from", "snippet", "looks_yes", "confirm", "msg_id"],
  "RSVP": ["year", "player", "token", "answer", "answered_at", "history", "test"],
  "READ ME": ["warning", "last_reply_scan"],
};
const MAIL_ORDER = ["Dashboard", "Contacts", "Replies", "RSVP", "SendLog", "READ ME"];
const MAIL_TAB_COLORS = { "Dashboard": "#1155cc", "Contacts": "#6aa84f", "Replies": "#f1c232", "SendLog": "#999999", "RSVP": "#e69138", "READ ME": "#cc0000" };
const MAIL_CHECKBOX = { "Contacts": ["do_not_invite"], "Replies": ["looks_yes", "confirm"] };   // CLOSED list
const MAIL_POLISH_TAG = "gfy-admin-polish";
const MAIL_NUDGE_DEFAULT = 7;
const MAIL_STALE_MS = 60 * 60 * 1000;

const mailNorm_ = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
// "Not coming" in any of the spellings people type into the status cell. Mirror: tools/presend-check.mjs.
const mailIsOutStatus_ = v => /^(out|declined|no|not coming|nope|n)$/i.test(String(v == null ? "" : v).trim());
const mailYes_ = v => v === true || /^(y|yes|true|1|x|✓)$/i.test(String(v == null ? "" : v).trim());

function onOpen(){
  SpreadsheetApp.getUi().createMenu("GFY Mail")
    .addItem("Send invites…", "sendInvites")
    .addItem("Send nudges…", "sendNudges")
    .addItem("Scan replies now", "scanReplies")
    .addItem("Polish admin sheet", "adminPolish")
    .addToUi();
}

// ---- generic sheet helpers ----------------------------------------------

function mailTable_(sheet){
  const vals = sheet.getDataRange().getValues();
  const heads = (vals[0] || []).map(mailNorm_);
  const idx = {}; heads.forEach((h, i) => { if (h && !(h in idx)) idx[h] = i; });
  const rows = vals.slice(1).map((cells, i) => {
    const o = { _row: i + 2 };
    Object.keys(idx).forEach(k => { o[k] = cells[idx[k]]; });
    return o;
  });
  return { heads, idx, rows };
}

// Append a header to row 1 if absent (an older live SendLog has no thread_id).
function mailEnsureHeader_(sheet, name){
  const t = mailTable_(sheet);
  if (name in t.idx) return;
  sheet.getRange(1, Math.max(t.heads.length, sheet.getLastColumn()) + 1).setValue(name);
}

// Columns that must stay TEXT. Sheets coerces a typed "2027-01-06" to a Date and an all-digit id
// to a Number (losing leading zeros / precision), so the cell is formatted "@" BEFORE the write.
const MAIL_TEXT_COLS = ["date", "thread_id", "msg_id", "token", "answered_at", "history"];

function mailAppend_(sheet, obj){
  const t = mailTable_(sheet);
  const row = new Array(t.heads.length).fill("");
  Object.keys(obj).forEach(k => { if (k in t.idx) row[t.idx[k]] = obj[k]; });
  if (!row.length) return;
  const r = sheet.getLastRow() + 1;
  MAIL_TEXT_COLS.forEach(k => { if (k in t.idx) sheet.getRange(r, t.idx[k] + 1).setNumberFormat("@"); });
  sheet.getRange(r, 1, 1, row.length).setValues([row]);
}

// A stored timestamp as epoch ms, or NaN. Accepts what a cell may hold: a Date (Sheets coerced the
// text), a number (epoch ms, or a Sheets date serial) or the "yyyy-MM-dd HH:mm" text we write.
function mailStampMs_(v){
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v > 1e11 ? v : (v - 25569) * 864e5;
  const s = String(v == null ? "" : v).trim();
  if (!s) return NaN;
  if (/^\d{12,}$/.test(s)) return Number(s);
  try { return Utilities.parseDate(s, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm").getTime(); } catch (e){ return NaN; }
}
function mailStampText_(v){
  const ms = mailStampMs_(v);
  return isNaN(ms) ? String(v == null ? "" : v).trim() : mailStamp_(new Date(ms));
}

function mailToday_(d){ return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"); }
function mailStamp_(d){ return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"); }

function mailIsTest_(props){
  const v = props.getProperty("GFY_MAIL_TEST");
  return !(v != null && String(v).trim() === "0");   // only an explicit 0 goes live
}

// THE only function allowed to write to the public sheet.
function mailPublicWrite_(sheet, r, c, v){
  if (/@/.test(String(v))) throw new Error("refusing to write '@' to the public sheet");
  sheet.getRange(r, c).setValue(v);
}

function mailWithLock_(fn){
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function mailCurrentYear_(invRows){
  return Math.max(0, ...invRows.map(r => parseInt(r.year, 10) || 0));
}

// Tick a boolean column for (year, player) on the PUBLIC Invites sheet, under
// the script lock, re-reading the row at write time. Returns true if it wrote.
function mailTickPublic_(invSheet, year, player, col){
  return mailWithLock_(() => mailTickPublicNL_(invSheet, year, player, col));
}
// Caller MUST already hold the script lock.
function mailTickPublicNL_(invSheet, year, player, col){
  const t = mailTable_(invSheet);
  if (!(col in t.idx)) return false;
  const row = t.rows.find(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player) === mailNorm_(player));
  if (!row || mailYes_(row[col])) return false;
  mailPublicWrite_(invSheet, row._row, t.idx[col] + 1, true);
  return true;
}
// "declined" only into a BLANK status; never overwrites anything (out / declined / maybe ...). Lock held by caller.
function mailDeclinePublicNL_(invSheet, year, player){
  const t = mailTable_(invSheet);
  if (!("status" in t.idx)) return false;
  const row = t.rows.find(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player) === mailNorm_(player));
  if (!row || String(row.status == null ? "" : row.status).trim() !== "") return false;
  mailPublicWrite_(invSheet, row._row, t.idx.status + 1, "declined");
  return true;
}

// ---- A: planning (pure) ---------------------------------------------------

/** contacts / invites: arrays of lowercase-keyed row objects. Mirrors
 *  tools/presend-check.mjs diffVault: DNI violation, unpaired DNI, missing from vault. */
/** Has this person already been emailed an invite THIS season, per the SendLog (live `invite` rows)?
 *  A row tagged `season <year>` in its note is exact. An older untagged row counts if it is dated
 *  last year or later (invites for 2027 go out in 2026); an unreadable date counts too (safe side). */
function mailInviteLogged_(logRows, player, year){
  const k = mailNorm_(player);
  return logRows.some(l => {
    if (mailNorm_(l.what) !== "invite" || mailNorm_(l.player) !== k) return false;
    const tag = String(l.note == null ? "" : l.note).match(/season (\d{4})/);
    if (tag) return parseInt(tag[1], 10) === year;
    const d = mailDateOf_(l.date);
    return !d || parseInt(mailToday_(d).slice(0, 4), 10) >= year - 1;
  });
}

function mailPlan_(contacts, invites, logRows){
  logRows = logRows || [];
  const year = mailCurrentYear_(invites);
  const cur = invites.filter(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player));
  const byName = new Map(cur.map(r => [mailNorm_(r.player), r]));
  const vault = new Map(contacts.filter(c => mailNorm_(c.player)).map(c => [mailNorm_(c.player), c]));
  const dni = contacts.filter(c => mailNorm_(c.player) && mailYes_(c.do_not_invite));
  const isOut = r => mailIsOutStatus_(r.status);
  const blocks = [];

  dni.forEach(c => {
    const row = byName.get(mailNorm_(c.player));
    if (!row) blocks.push(`${c.player}: do-not-invite with NO ${year} Invites row — add one with status out so the site suppresses them`);
    else if (mailYes_(row.invited) || mailYes_(row.responded) || !isOut(row))
      blocks.push(`${c.player}: do-not-invite but has an active ${year} Invites row — set status out and untick invited/responded`);
  });
  cur.forEach(r => {
    if (isOut(r)) return;
    if (!vault.has(mailNorm_(r.player))) blocks.push(`${r.player}: on the Invites tab but missing from Contacts — add their address first`);
  });

  const recipients = [], noAddress = [], alreadySent = [];
  cur.forEach(r => {
    if (mailYes_(r.invited) || isOut(r)) return;
    const c = vault.get(mailNorm_(r.player));
    if (!c || mailYes_(c.do_not_invite)) return;
    if (mailInviteLogged_(logRows, r.player, year)){ alreadySent.push(String(r.player).trim()); return; }
    const addr = String(c.email || "").trim() || String(c.email_alt || "").trim();
    if (!addr){ noAddress.push(String(r.player).trim()); return; }
    recipients.push({ player: String(r.player).trim(), address: addr });
  });
  return { year, blocks, recipients, noAddress, alreadySent };
}

// ---- Gmail-draft template ----------------------------------------------------

const mailHtmlEsc_ = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const MAIL_TOKEN_RE = /\{[A-Za-z][A-Za-z0-9_ -]*\}/g;     // word-like {tokens} only, so CSS braces never trip it

/** Find THE template draft (subject starts with `prefix`, case-insensitive, trimmed).
 *  Returns { ok:true, subject, html, plain, attachments } or { ok:false, kind, msg }.
 *  The draft is only ever READ - never sent, updated or deleted. */
function mailLoadDraft_(prefix){
  const want = mailNorm_(prefix);
  const found = GmailApp.getDrafts().filter(d => mailNorm_(d.getMessage().getSubject()).indexOf(want) === 0);
  if (found.length !== 1){
    return { ok: false, kind: found.length ? "many" : "none",
      msg: found.length ? `Found ${found.length} drafts whose subject starts with ${prefix} - there must be exactly ONE. Delete the extras.`
                        : `No draft whose subject starts with ${prefix} was found (0). Write it as a normal Gmail draft in this account.` };
  }
  const m = found[0].getMessage();
  const raw = String(m.getSubject() || "").trim();
  const subject = raw.slice(prefix.length).trim();
  const html = String(m.getBody() || ""), plain = String(m.getPlainBody() || "");
  if (/\[fill/i.test(raw + "\n" + html + "\n" + plain)) return { ok: false, kind: "fill", msg: "the template draft still has [FILL] spots" };
  const all = m.getAttachments({ includeInlineImages: true }) || [];
  const files = m.getAttachments({ includeInlineImages: false }) || [];
  if (all.length > files.length) return { ok: false, kind: "inline", msg: "The template draft has inline images, which this sender cannot copy safely (it would send a broken email). Remove them or use a normal attachment / a hosted image link." };
  const left = [];
  [raw, html, plain].forEach(t => (String(t).replace(/\{(first|rsvp)\}/g, "").match(MAIL_TOKEN_RE) || []).forEach(x => { if (left.indexOf(x) < 0) left.push(x); }));
  if (left.length) return { ok: false, kind: "token", msg: `The template draft has unreplaced ${left.join(" ")} - only {first} and {rsvp} are filled in. Nothing sent.` };
  if (!subject || !(html.trim() || plain.trim())) return { ok: false, kind: "empty", msg: "The template draft needs a subject (after the prefix) and a body." };
  return { ok: true, subject, html, plain, attachments: files, hasRsvp: /\{rsvp\}/.test(raw + html + plain) };
}

/** Per-recipient copy of the draft. Names are HTML-escaped inside the HTML body only. */
function mailBuild_(tpl, player, address, test, rsvpUrl){
  const first = String(player).trim().split(/\s+/)[0];
  const fill = (t, esc) => String(t).replace(/\{first\}/g, () => (esc ? mailHtmlEsc_(first) : first)).replace(/\{rsvp\}/g, () => (esc ? mailHtmlEsc_(rsvpUrl || "") : (rsvpUrl || "")));
  const subject = fill(tpl.subject, false);
  return {
    to: test ? MAIL_TEST_ADDR : address,
    subject: test ? `[TEST \u2192 ${address}] ${subject}` : subject,
    body: fill(tpl.plain, false), htmlBody: fill(tpl.html, true), attachments: tpl.attachments || [],
  };
}

function mailSendOpts_(m){
  const o = {};
  if (m.htmlBody && m.htmlBody.trim()) o.htmlBody = m.htmlBody;
  if (m.attachments && m.attachments.length) o.attachments = m.attachments;
  return o;
}

// ---- A: the button ---------------------------------------------------------

function sendInvites(){
  const ui = SpreadsheetApp.getUi();
  const say = (title, msg) => ui.alert(title, msg, ui.ButtonSet.OK);
  const props = PropertiesService.getScriptProperties();
  const pid = props.getProperty("PUBLIC_ID");
  if (!pid){ say("GFY Mail", "Script property PUBLIC_ID is not set (Project Settings → Script properties). Nothing sent."); return; }

  const admin = SpreadsheetApp.getActiveSpreadsheet();
  const invSheet = SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites);
  const conSheet = admin.getSheetByName(MAIL_TAB.contacts), logSheet = admin.getSheetByName(MAIL_TAB.log);
  if (!invSheet || !conSheet || !logSheet){ say("GFY Mail", "Missing tab (public Invites, or Admin Contacts / SendLog). Nothing sent."); return; }

  const plan = mailPlan_(mailTable_(conSheet).rows, mailTable_(invSheet).rows, mailTable_(logSheet).rows);
  if (plan.blocks.length){
    say("Send BLOCKED — fix these first (nothing was sent)", plan.blocks.join("\n"));
    return;
  }
  const dupNote = plan.alreadySent.length ? `\n\nAlready emailed according to SendLog, NOT sent again (tick invited on the public sheet by hand if it is missing): ${plan.alreadySent.join(", ")}` : "";
  if (!plan.recipients.length){ say("GFY Mail", `Nobody to invite for ${plan.year}.` + (plan.noAddress.length ? `\nNo address on file: ${plan.noAddress.join(", ")}` : "") + dupNote); return; }

  let tpl;
  try { tpl = mailLoadDraft_(MAIL_TPL_PREFIX); } catch (e){ say("GFY Mail", "Could not read Gmail drafts (" + (e && e.message || e) + "). Nothing sent."); return; }
  if (!tpl.ok){ say("Send BLOCKED - template draft (nothing was sent)", tpl.msg); return; }

  const rs = mailRsvpPrereq_(props, admin, tpl);
  if (rs){ say("Send BLOCKED - RSVP links (nothing was sent)", rs); return; }

  const quota = MailApp.getRemainingDailyQuota();
  if (quota < plan.recipients.length){ say("GFY Mail", `Daily send quota too low: ${quota} left, ${plan.recipients.length} needed. Nothing sent.`); return; }

  const test = mailIsTest_(props);
  const list = plan.recipients.map(r => `${r.player} → ${r.address}`).join("\n");
  const msg = (test ? `TEST MODE: every message goes to ${MAIL_TEST_ADDR}; nothing is ticked on the public sheet.\n\n` : "LIVE: these people will be emailed for real.\n\n")
    + `Subject of the first email: ${mailBuild_(tpl, plan.recipients[0].player, plan.recipients[0].address, test).subject}\n\n`
    + `Send ${plan.recipients.length} ${plan.year} invite(s)?\n\n${list}`
    + (plan.noAddress.length ? `\n\nSkipped (no address): ${plan.noAddress.join(", ")}` : "") + dupNote;
  if (ui.alert("Send invites", msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // The WHOLE send runs under the script lock; a second click (or a re-run after a crash) cannot overlap it.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)){ say("GFY Mail", "Another send is already running (the script lock is held). Wait a minute and run Send invites again. Nothing sent."); return; }
  const failed = [], tickFailed = [], skipped = [];
  let sent = 0;
  try {
    mailEnsureHeader_(logSheet, "thread_id");
    plan.recipients.forEach(r => {
      // Re-read EVERYTHING under the lock right before this send: invited tick, SendLog, DNI, status.
      const fresh = mailPlan_(mailTable_(conSheet).rows, mailTable_(invSheet).rows, mailTable_(logSheet).rows);
      const still = fresh.recipients.find(x => mailNorm_(x.player) === mailNorm_(r.player));
      if (fresh.blocks.length || fresh.year !== plan.year || !still || still.address !== r.address){ skipped.push(r.player); return; }
      let m, threadId;
      try {
        const url = tpl.hasRsvp ? mailRsvpUrl_(props, mailRsvpTokenNL_(admin.getSheetByName(MAIL_TAB.rsvp), plan.year, r.player, test)) : "";
        m = mailBuild_(tpl, r.player, r.address, test, url);
        threadId = mailSendNew_(m);
      } catch (e){ failed.push(`${r.player} (${e && e.message || e})`); return; }
      sent++;
      // Log BEFORE ticking: a crash after the send must never lead to a second email.
      mailAppend_(logSheet, {
        date: mailToday_(), player: r.player, address_used: m.to,
        what: test ? "invite-test" : "invite",
        note: test ? `TEST MODE (real address ${r.address})` : `season ${plan.year}`, thread_id: threadId,
      });
      if (!test){
        try { mailTickPublicNL_(invSheet, plan.year, r.player, "invited"); }
        catch (e){ tickFailed.push(r.player); }
      }
    });
  } finally { lock.releaseLock(); }
  say("GFY Mail", `${test ? "TEST " : ""}Sent ${sent} of ${plan.recipients.length}.`
    + (failed.length ? `\n\nSEND FAILED (not logged, not ticked — safe to re-run): ${failed.join("; ")}` : "")
    + (skipped.length ? `\n\nSKIPPED (changed while sending — already invited, or edited): ${skipped.join(", ")}` : "")
    + (tickFailed.length ? `\n\nSent and logged, but could NOT tick invited on the public sheet — tick by hand: ${tickFailed.join(", ")}` : ""));
}

// Send ONE fresh message and return its Gmail thread id. A failed send deletes its own draft (no orphans);
// a send that went out but whose thread id cannot be read still returns "" (the caller logs it - never re-sends).
function mailSendNew_(m){
  const d = GmailApp.createDraft(m.to, m.subject, m.body, mailSendOpts_(m));
  let msg;
  try { msg = d.send(); }
  catch (e){ try { d.deleteDraft(); } catch (x){ /* already gone */ } throw e; }
  try { return String(msg.getThread().getId()); } catch (e){ return ""; }
}

// ---- D: nudges -------------------------------------------------------------------

/** Who needs a nudge. cur = current-season Invites rows; logRows = SendLog rows.
 *  invited, not responded / committed / out / declined, not do-not-invite, and the last
 *  REAL send (invite or nudge - test rows never count) is >= `days` ago.
 *  threadId / address come from that person's latest invite row. `bounced` = Contacts notes say BOUNCED.
 *  `test` (TEST-MODE rehearsal only): invite-test rows also make someone a candidate (and count as the
 *  invite send), since test mode never ticks `invited`; nudge-test rows still never count. */
function mailNudgeRows_(cur, contacts, logRows, days, test){
  const dni = new Set(contacts.filter(c => mailYes_(c.do_not_invite)).map(c => mailNorm_(c.player)));
  const bounced = new Set(contacts.filter(c => /BOUNCED/.test(String(c.notes == null ? "" : c.notes))).map(c => mailNorm_(c.player)));
  const isOut = r => mailIsOutStatus_(r.status);
  const last = new Map(), inv = new Map();
  logRows.forEach(r => {
    const what = mailNorm_(r.what);
    const isInv = what === "invite" || (test && what === "invite-test");
    if (!isInv && what !== "nudge") return;
    const d = mailDateOf_(r.date); if (!d) return;
    const k = mailNorm_(r.player);
    if (!last.has(k) || d >= last.get(k)) last.set(k, d);
    if (isInv && (!inv.has(k) || d >= inv.get(k).d)) inv.set(k, { d, row: r });
  });
  const today = mailDateOf_(mailToday_());
  const out = [];
  cur.forEach(r => {
    const k = mailNorm_(r.player);
    const ir = inv.get(k) && inv.get(k).row;
    if (!(mailYes_(r.invited) || (test && ir)) || mailYes_(r.responded) || mailYes_(r.committed) || isOut(r) || dni.has(k)) return;
    const d = last.get(k); if (!d) return;
    if (Math.round((today - d) / 864e5) < days) return;
    let address = ir ? String(ir.address_used || "").trim() : "";
    const real = ir ? String(ir.note || "").match(/real address ([^\s)]+)/) : null;     // test rows log the TEST address; the real one is in the note
    if (real) address = real[1];
    out.push({ player: String(r.player).trim(), address, threadId: ir ? String(ir.thread_id || "").trim() : "", bounced: bounced.has(k) });
  });
  return out;
}

function mailReadNudgeDays_(sh){
  let nudge = MAIL_NUDGE_DEFAULT;
  if (sh && sh.getLastRow() >= 1){
    const old = sh.getDataRange().getValues().find(r => mailNorm_(r[0]) === MAIL_DASH_LABELS.nudge);
    const n = old ? parseInt(old[1], 10) : NaN;
    if (n > 0) nudge = n;
  }
  return nudge;
}

function sendNudges(){
  const ui = SpreadsheetApp.getUi();
  const say = (title, msg) => ui.alert(title, msg, ui.ButtonSet.OK);
  const props = PropertiesService.getScriptProperties();
  const pid = props.getProperty("PUBLIC_ID");
  if (!pid){ say("GFY Mail", "Script property PUBLIC_ID is not set. Nothing sent."); return; }
  const admin = SpreadsheetApp.getActiveSpreadsheet();
  const invSheet = SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites);
  const conSheet = admin.getSheetByName(MAIL_TAB.contacts), logSheet = admin.getSheetByName(MAIL_TAB.log);
  if (!invSheet || !conSheet || !logSheet){ say("GFY Mail", "Missing tab (public Invites, or Admin Contacts / SendLog). Nothing sent."); return; }

  let tpl;
  try { tpl = mailLoadDraft_(MAIL_NUDGE_PREFIX); } catch (e){ say("GFY Mail", "Could not read Gmail drafts (" + (e && e.message || e) + "). Nothing sent."); return; }
  if (!tpl.ok){ say("Nudge BLOCKED - template draft (nothing was sent)", tpl.msg); return; }
  const rs = mailRsvpPrereq_(props, admin, tpl);
  if (rs){ say("Nudge BLOCKED - RSVP links (nothing was sent)", rs); return; }

  const test = mailIsTest_(props);
  const inv = mailTable_(invSheet).rows, year = mailCurrentYear_(inv);
  const days = mailReadNudgeDays_(admin.getSheetByName(MAIL_TAB.dash));
  const cur = inv.filter(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player));
  const all = mailNudgeRows_(cur, mailTable_(conSheet).rows, mailTable_(logSheet).rows, days, test);
  const bouncedNames = all.filter(c => c.bounced).map(c => c.player);
  const cands = all.filter(c => c.threadId && !c.bounced), noThread = all.filter(c => !c.threadId && !c.bounced).map(c => c.player);
  const skipNote = (bouncedNames.length ? `\n\nBounced, not nudged (fix their address first): ${bouncedNames.join(", ")}` : "")
    + (noThread.length ? `\n\nNo invite thread on file (cannot reply): ${noThread.join(", ")}` : "");
  if (!cands.length){ say("GFY Mail", `Nobody to nudge (invited, not answered, last send ${days}+ days ago).` + skipNote); return; }

  const quota = MailApp.getRemainingDailyQuota();
  if (quota < cands.length){ say("GFY Mail", `Daily send quota too low: ${quota} left, ${cands.length} needed. Nothing sent.`); return; }
  const msg = (test ? `TEST MODE: fresh messages go to ${MAIL_TEST_ADDR} only; nobody real is contacted.\n\n` : "LIVE: each person gets a reply in their invite thread when it is safe to, otherwise a fresh email to the address we invited.\n\n")
    + `Nudge ${cands.length} ${year} player(s) (last send ${days}+ days ago)?\n\n${cands.map(c => c.player).join("\n")}` + skipNote;
  if (ui.alert("Send nudges", msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)){ say("GFY Mail", "Another send is already running (the script lock is held). Wait a minute and run Send nudges again. Nothing sent."); return; }
  const failed = [], skipped = [];
  let sent = 0;
  try {
    const me = String(Session.getEffectiveUser().getEmail() || "").toLowerCase();
    cands.forEach(c0 => {
      try {
        // Re-read under the lock right before this send (a concurrent run may have nudged / the person may have answered).
        const freshInv = mailTable_(invSheet).rows;
        const freshCur = freshInv.filter(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player));
        const c = mailNudgeRows_(freshCur, mailTable_(conSheet).rows, mailTable_(logSheet).rows, days, test).find(x => mailNorm_(x.player) === mailNorm_(c0.player));
        if (!c || c.bounced || !c.threadId){ skipped.push(c0.player); return; }
        const url = tpl.hasRsvp ? mailRsvpUrl_(props, mailRsvpTokenNL_(admin.getSheetByName(MAIL_TAB.rsvp), year, c.player, test)) : "";
        const m = mailBuild_(tpl, c.player, c.address, test, url);
        let threadId = c.threadId, note = test ? `TEST MODE (real address ${c.address})` : "";
        if (test){
          threadId = mailSendNew_(m);
        } else {
          if (!c.address) throw new Error("no address on file");
          const r = mailNudgeLive_(c, m, me);
          threadId = r.threadId; note = r.note;
        }
        sent++;
        mailAppend_(logSheet, { date: mailToday_(), player: c.player, address_used: test ? MAIL_TEST_ADDR : c.address, what: test ? "nudge-test" : "nudge", note, thread_id: threadId });
      } catch (e){ failed.push(`${c0.player} (${e && e.message || e})`); }
    });
  } finally { lock.releaseLock(); }
  try { mailDashboard_(admin, props); } catch (e){ Logger.log("dashboard rebuild failed: " + (e && e.message || e)); }
  say("GFY Mail", `${test ? "TEST " : ""}Nudged ${sent} of ${cands.length}.`
    + (failed.length ? `\n\nNUDGE FAILED (not logged - safe to re-run): ${failed.join("; ")}` : "")
    + (skipped.length ? `\n\nSKIPPED (changed while sending): ${skipped.join(", ")}` : "")
    + skipNote);
}

// "a@x.com, B <b@x.com>" -> ["a@x.com", "b@x.com"] (parsed, lowercased - never a substring test)
function mailAddrList_(s){
  return String(s == null ? "" : s).split(",").map(x => mailAddrOf_(x)).filter(Boolean);
}

/** LIVE nudge. thread.reply ONLY when the thread's last message is ours AND went to exactly the logged
 *  address (a reply goes to the last message's sender/recipients - a bounce or a stray cc would receive it).
 *  Otherwise a fresh email to the logged address, subject "Re: <invite subject>"; its NEW thread id is returned
 *  and logged, and the scanner watches every logged thread of a player. */
function mailNudgeLive_(c, m, me){
  const thread = GmailApp.getThreadById(c.threadId);          // a missing/deleted thread (null) falls through to a fresh email
  const addr = String(c.address).toLowerCase();
  let subject = "";
  if (thread){
    const msgs = thread.getMessages(), last = msgs[msgs.length - 1];
    try { subject = String(thread.getFirstMessageSubject() || "").trim(); } catch (e){ subject = ""; }
    const to = last ? mailAddrList_(last.getTo()) : [];
    if (last && mailAddrOf_(last.getFrom()) === me && to.length === 1 && to[0] === addr){
      thread.reply(m.body, mailSendOpts_(m));
      return { threadId: c.threadId, note: "" };
    }
  }
  const subj = subject ? (/^re:/i.test(subject) ? subject : "Re: " + subject) : m.subject;
  const threadId = mailSendNew_({ to: c.address, subject: subj, body: m.body, htmlBody: m.htmlBody, attachments: m.attachments });
  return { threadId, note: "fresh email (the invite thread was not safe to reply into)" };
}

// ---- B: RSVP links (Web App in this same project) ---------------------------------
// Deploy: Apps Script -> Deploy -> New deployment -> Web app, Execute as: Me,
// Who has access: Anyone. Put the /exec URL in the WEBAPP_URL script property.

function mailRsvpPrereq_(props, admin, tpl){
  if (!tpl.hasRsvp) return "";
  if (!String(props.getProperty("WEBAPP_URL") || "").trim()) return "The template draft contains {rsvp} but the script property WEBAPP_URL is not set (deploy the Web App, then paste its /exec URL).";
  if (!admin.getSheetByName(MAIL_TAB.rsvp)) return "The template draft contains {rsvp} but the Admin sheet has no RSVP tab - run GFY Mail > Polish admin sheet first.";
  return "";
}

function mailRsvpUrl_(props, token){
  const base = String(props.getProperty("WEBAPP_URL")).trim();
  return base + (base.indexOf("?") >= 0 ? "&" : "?") + "t=" + token;
}

// One random token per (year, player, test?), created once and reused. Stored ONLY in the private RSVP tab.
// TEST-mode sends use their own tokens (RSVP.test = TRUE) so a rehearsal answer can never sit on the
// token a real player later receives; live sends never reuse a test token.
function mailRsvpToken_(sheet, year, player, test){ return mailWithLock_(() => mailRsvpTokenNL_(sheet, year, player, test)); }
// Caller MUST already hold the script lock (the lock is not reentrant).
function mailRsvpTokenNL_(sheet, year, player, test){
  mailEnsureHeader_(sheet, "test");
  const t = mailTable_(sheet);
  const have = t.rows.find(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player) === mailNorm_(player) && mailYes_(r.test) === !!test && String(r.token || "").trim().length >= 22);
  if (have) return String(have.token).trim();
  const token = Utilities.getUuid().replace(/-/g, "");     // 32 chars, 122 random bits
  mailAppend_(sheet, { year, player: String(player).trim(), token, answer: "", answered_at: "", history: "", test: test ? true : "" });
  return token;
}

function mailAdmin_(props){
  let a = null;
  try { a = SpreadsheetApp.getActiveSpreadsheet(); } catch (e){ a = null; }
  if (!a && props.getProperty("ADMIN_ID")) a = SpreadsheetApp.openById(props.getProperty("ADMIN_ID"));
  return a;
}

// { admin, rsvp, inv, year } or null when anything is unavailable.
function mailRsvpCtx_(props){
  const admin = mailAdmin_(props), pid = props.getProperty("PUBLIC_ID");
  if (!admin || !pid) return null;
  const rsvp = admin.getSheetByName(MAIL_TAB.rsvp), inv = SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites);
  if (!rsvp || !inv) return null;
  return { admin, rsvp, inv, year: mailCurrentYear_(mailTable_(inv).rows) };
}

function mailRsvpFind_(ctx, token){
  const t = String(token == null ? "" : token).trim();
  if (t.length < 22) return null;
  const tb = mailTable_(ctx.rsvp);
  const row = tb.rows.find(r => String(r.token == null ? "" : r.token).trim() === t && (parseInt(r.year, 10) || 0) === ctx.year);
  return row ? { tb, row } : null;
}

function mailRsvpPage_(first, year, token, current){
  const f = mailHtmlEsc_(first), tk = JSON.stringify(String(token)).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Good Friends Yearly</title><style>
:root{--pine:#0E2019;--bone:#E9E3D3;--sage:#8A9B8C;--brass:#C8A24A;--rust:#B0705E}
*{box-sizing:border-box}body{margin:0;background:var(--pine);color:var(--bone);font-family:Jost,Futura,"Helvetica Neue",Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
main{width:100%;max-width:420px;text-align:center}.brand{font-family:"Bodoni Moda",Didot,Georgia,serif;font-weight:700;letter-spacing:.14em;color:var(--brass);font-size:.9rem;margin-bottom:18px}
h1{font-family:"Bodoni Moda",Didot,Georgia,serif;font-size:1.7rem;line-height:1.2;margin:0 0 22px}
button{display:block;width:100%;min-height:64px;margin:12px 0;border-radius:10px;border:2px solid var(--brass);background:transparent;color:var(--bone);font:600 1.3rem Jost,Futura,Arial,sans-serif;letter-spacing:.08em;cursor:pointer}
button:active,button.sel{background:var(--brass);color:var(--pine)}button:disabled{opacity:.6}
#cur,#msg{color:var(--sage);min-height:1.4em;margin-top:14px}#msg.err{color:var(--rust)}</style></head><body><main>
<div class="brand">GOOD FRIENDS YEARLY</div>
<h1 id="q">${f}, are you in for ${year}?</h1>
<button id="b-IN" onclick="go('IN')">IN</button><button id="b-OUT" onclick="go('OUT')">OUT</button><button id="b-MAYBE" onclick="go('MAYBE')">MAYBE</button>
<div id="cur">${current ? "Your answer so far: " + mailHtmlEsc_(current) : ""}</div><div id="msg"></div></main>
<script>var T=${tk};
function go(c){var bs=document.getElementsByTagName("button");for(var i=0;i<bs.length;i++){bs[i].disabled=true;}
document.getElementById("msg").className="";document.getElementById("msg").textContent="Saving...";
google.script.run.withSuccessHandler(function(){for(var i=0;i<bs.length;i++){bs[i].disabled=false;bs[i].className="";}
document.getElementById("b-"+c).className="sel";document.getElementById("q").textContent="Got it - you're "+c+".";
document.getElementById("cur").textContent="Your answer: "+c+". Tap another to change it.";document.getElementById("msg").textContent="Saved.";})
.withFailureHandler(function(){for(var i=0;i<bs.length;i++){bs[i].disabled=false;}document.getElementById("msg").className="err";document.getElementById("msg").textContent="Could not save - try again, or reply to the email.";}).recordRsvp(T,c);}
</script></body></html>`;
}

function mailRsvpInvalid_(){
  return `<!doctype html><html><head><meta charset="utf-8"><title>Good Friends Yearly</title><style>body{margin:0;background:#0E2019;color:#E9E3D3;font-family:Jost,Futura,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}</style></head><body><main><h1>This link is not valid</h1><p>It may be from an older year. Just reply to the email and we will sort it out.</p></main></body></html>`;
}

/** Web App GET. Records NOTHING (link scanners prefetch GETs); only renders. */
function doGet(e){
  const props = PropertiesService.getScriptProperties();
  const token = String((e && e.parameter && e.parameter.t) || "").trim();
  let html = null;
  try {
    const ctx = mailRsvpCtx_(props);
    const f = ctx && mailRsvpFind_(ctx, token);
    if (f) html = mailRsvpPage_(String(f.row.player).trim().split(/\s+/)[0], ctx.year, token, String(f.row.answer || "").trim());
  } catch (err){ html = null; }
  return HtmlService.createHtmlOutput(html || mailRsvpInvalid_()).setTitle("Good Friends Yearly").addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/** Called from the page via google.script.run. Everything under one lock. */
function recordRsvp(token, choice){
  const c = String(choice == null ? "" : choice).trim().toUpperCase();
  if (c !== "IN" && c !== "OUT" && c !== "MAYBE") throw new Error("invalid choice");
  const props = PropertiesService.getScriptProperties();
  const ctx = mailRsvpCtx_(props);
  if (!ctx) throw new Error("RSVP is unavailable right now");
  const test = mailIsTest_(props);
  const out = { player: "", publicFailed: false };
  mailWithLock_(() => {
    const f = mailRsvpFind_(ctx, token);                 // re-read under the lock
    if (!f) throw new Error("This link is not valid");
    const { tb, row } = f;
    const stamp = mailStamp_();
    out.player = String(row.player).trim();
    const hist = String(row.history == null ? "" : row.history).trim();
    const set = (name, v) => { if (name in tb.idx){ const cell = ctx.rsvp.getRange(row._row, tb.idx[name] + 1); if (MAIL_TEXT_COLS.indexOf(name) >= 0) cell.setNumberFormat("@"); cell.setValue(v); } };
    set("answer", c); set("answered_at", stamp); set("history", (hist ? hist + "; " : "") + stamp + " " + c);
    if (test || mailYes_(row.test)) return;              // TEST MODE, or a TEST token: private RSVP tab only, never public
    try {
      // A do-not-invite player gets NO public write at all (a ticked responded would also trip the DNI send-block);
      // an out/declined player may tick responded but is never committed or re-declined. Both are listed on the Dashboard.
      const dni = ctx.admin.getSheetByName(MAIL_TAB.contacts) && mailTable_(ctx.admin.getSheetByName(MAIL_TAB.contacts)).rows.some(x => mailNorm_(x.player) === mailNorm_(out.player) && mailYes_(x.do_not_invite));
      if (dni) return;
      const pt = mailTable_(ctx.inv), prow = pt.rows.find(x => (parseInt(x.year, 10) || 0) === ctx.year && mailNorm_(x.player) === mailNorm_(out.player));
      const isOut = !!prow && mailIsOutStatus_(prow.status);
      mailTickPublicNL_(ctx.inv, ctx.year, out.player, "responded");
      if (c === "IN" && !isOut) mailTickPublicNL_(ctx.inv, ctx.year, out.player, "committed");
      if (c === "OUT") mailDeclinePublicNL_(ctx.inv, ctx.year, out.player);
    } catch (err){ out.publicFailed = true; }
  });
  if (out.publicFailed){
    const log = ctx.admin.getSheetByName(MAIL_TAB.log);
    if (log) mailAppend_(log, { date: mailToday_(), player: out.player, what: "note", note: `RSVP ${c} recorded but the public sheet could not be updated - fix by hand` });
  }
  try { mailDashboard_(ctx.admin, props); } catch (err){ Logger.log("dashboard rebuild failed: " + (err && err.message || err)); }
  return { answer: c, first: out.player.split(/\s+/)[0] };
}

// ---- C: reply watcher --------------------------------------------------------

function installMailTriggers(){
  const has = fn => ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === fn);
  if (!has("scanReplies")) ScriptApp.newTrigger("scanReplies").timeBased().everyMinutes(15).create();
  // Installable onEdit (a simple onEdit cannot open the public sheet): confirm -> committed.
  if (!has("mailOnEdit")) ScriptApp.newTrigger("mailOnEdit").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}

const MAIL_AUTO_SUBJECT = /out of office|automatic reply|auto[- ]?reply|autoreply|away from (my )?(desk|office)/i;
const MAIL_BOUNCE_FROM = /mailer-daemon|postmaster/i;

function mailAddrOf_(from){
  const m = String(from || "").match(/<([^>]+)>/);
  return (m ? m[1] : String(from || "")).trim().toLowerCase();
}

/** "reply" | "bounce" | "auto" | "own" */
function mailClassify_(msg, me){
  const from = String(msg.getFrom() || "");
  if (MAIL_BOUNCE_FROM.test(from)) return "bounce";
  if (mailAddrOf_(from) === String(me).toLowerCase()) return "own";
  if (MAIL_AUTO_SUBJECT.test(String(msg.getSubject() || ""))) return "auto";
  const raw = String(msg.getRawContent() || "");
  const headers = raw.split(/\r?\n\r?\n/)[0];
  if (/^auto-submitted:\s*(?!no\b)\S+/im.test(headers)) return "auto";
  return "reply";
}

function mailSnippet_(body){
  const keep = [];
  for (const line of String(body || "").split(/\r?\n/)){
    if (/^\s*>/.test(line)) continue;
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    keep.push(line);
  }
  return keep.join(" ").replace(/\s+/g, " ").trim().slice(0, 280);
}

// A SUGGESTION for the human only. Never drives committed.
function mailLooksYes_(text){
  const t = String(text || "").toLowerCase();
  if (/\b(not|no|can'?t|cannot|won'?t|unable|pass|sorry|decline)\b/.test(t)) return false;
  return /\b(yes|yep|yeah|i'?m in|count me in|sign me up|i'?ll be there|absolutely|definitely)\b/.test(t);
}

// ---- E: health alerts -------------------------------------------------------------

const MAIL_ALERT_STALE_MS = 3 * 60 * 60 * 1000;
const MAIL_ALERT_EVERY_MS = 24 * 60 * 60 * 1000;

/** One alert mail per 24 h to the ALERT_TO script property (empty = off). Never throws. */
function mailAlert_(props, subject, body){
  try {
    const to = String(props.getProperty("ALERT_TO") || "").trim();
    if (!to) return;
    const last = Number(props.getProperty("ALERT_LAST")) || 0;
    if (Date.now() - last < MAIL_ALERT_EVERY_MS) return;
    MailApp.sendEmail(to, subject, body);
    props.setProperty("ALERT_LAST", String(Date.now()));
  } catch (e){ Logger.log("alert failed: " + (e && e.message || e)); }
}

function scanReplies(){
  const props = PropertiesService.getScriptProperties();
  try {                       // stale check at scan start (never-scanned stays quiet)
    const admin = SpreadsheetApp.getActiveSpreadsheet();
    const readme = admin && admin.getSheetByName(MAIL_TAB.readme);
    const raw = readme ? readme.getRange(2, 2).getValue() : "";
    const ms = mailStampMs_(raw);
    if (!isNaN(ms) && Date.now() - ms > MAIL_ALERT_STALE_MS)
      mailAlert_(props, "GFY Mail: reply scan is stale", `The last good reply scan was ${mailStampText_(raw)}, over 3 hours ago. Check the Apps Script trigger / Executions.`);
  } catch (e){ Logger.log("stale check failed: " + (e && e.message || e)); }
  try { mailScan_(); }
  catch (e){
    mailAlert_(props, "GFY Mail: reply scan FAILED", String(e && e.message || e).replace(/\S+@\S+/g, "(address)").slice(0, 500));
    throw e;
  }
}

function mailScan_(){
  const admin = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const pid = props.getProperty("PUBLIC_ID");
  if (!pid) throw new Error("PUBLIC_ID script property is not set");
  const invSheet = SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites);
  const logSheet = admin.getSheetByName(MAIL_TAB.log), repSheet = admin.getSheetByName(MAIL_TAB.replies);
  const conSheet = admin.getSheetByName(MAIL_TAB.contacts), readme = admin.getSheetByName(MAIL_TAB.readme);
  if (!invSheet || !logSheet || !repSheet || !conSheet) throw new Error("missing tab (Invites / SendLog / Replies / Contacts)");

  mailEnsureHeader_(repSheet, "msg_id");
  const me = Session.getEffectiveUser().getEmail();
  const year = mailCurrentYear_(mailTable_(invSheet).rows);
  const test = mailIsTest_(props);                  // TEST MODE: the public sheet is never written (the Dashboard says what would be)
  const seen = new Set(mailTable_(repSheet).rows.map(r => String(r.msg_id)));
  const errors = [];

  // every logged LIVE thread (invites AND fresh nudge threads), once each; test-mode rows are never watched
  const watched = new Set();
  mailTable_(logSheet).rows.filter(r => { const w = mailNorm_(r.what); return (w === "invite" || w === "nudge") && String(r.thread_id || "").trim(); }).filter(r => {
    const id = String(r.thread_id).trim(); if (watched.has(id)) return false; watched.add(id); return true;
  }).forEach(entry => {
    const player = String(entry.player).trim();
    try {
      const thread = GmailApp.getThreadById(String(entry.thread_id).trim());
      if (!thread) throw new Error("thread not found");
      let replied = false;
      thread.getMessages().forEach(msg => {
        const kind = mailClassify_(msg, me);
        if (kind === "own" || kind === "auto") return;
        if (kind === "bounce"){ mailNoteBounce_(conSheet, player, mailToday_(msg.getDate())); return; }
        replied = true;
        const id = String(msg.getId());
        if (seen.has(id)) return;
        seen.add(id);
        const snippet = mailSnippet_(msg.getPlainBody());
        mailAppend_(repSheet, {
          date: mailToday_(msg.getDate()), player, from: String(msg.getFrom()), snippet,
          looks_yes: mailLooksYes_(snippet), confirm: false, msg_id: id,
        });
      });
      if (replied && !test) mailTickPublic_(invSheet, year, player, "responded");
    } catch (e){ errors.push(`${player}: ${e && e.message || e}`); }
  });

  if (!errors.length && readme){     // timestamp only — never names (START HERE publication is a TODO above)
    readme.getRange(1, 2).setValue("last_reply_scan");
    readme.getRange(2, 2).setNumberFormat("@").setValue(mailStamp_());
  }
  // Rebuild the private Dashboard even after a failed scan (so STALE can show).
  try { mailDashboard_(admin, props); } catch (e){ Logger.log("dashboard rebuild failed: " + (e && e.message || e)); }
  if (errors.length) throw new Error("reply scan incomplete — " + errors.join("; "));
}

function mailNoteBounce_(conSheet, player, date){
  const t = mailTable_(conSheet);
  if (!("notes" in t.idx)) return;
  const row = t.rows.find(r => mailNorm_(r.player) === mailNorm_(player));
  if (!row) return;
  const tag = "BOUNCED " + date;
  const cur = String(row.notes == null ? "" : row.notes);
  if (cur.indexOf(tag) >= 0) return;
  conSheet.getRange(row._row, t.idx.notes + 1).setValue(cur ? cur + "; " + tag : tag);
}

// ---- confirm -> committed (installable onEdit) --------------------------------

/** Installed by installMailTriggers. Ticking Replies.confirm ticks `committed`
 *  for that player / current year on the PUBLIC Invites tab (only ever TRUE, via
 *  mailPublicWrite_, under the lock; NOT in test mode - the Dashboard says "would commit X"). UNticking never unticks committed - it
 *  logs a note on SendLog instead. Script edits (scanReplies) do not fire onEdit. */
function mailOnEdit(e){
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (!sh || sh.getName() !== MAIL_TAB.replies) return;
  const t = mailTable_(sh);
  if (!("confirm" in t.idx)) return;
  const cc = t.idx.confirm + 1;
  const c0 = e.range.getColumn(), c1 = c0 + e.range.getNumColumns() - 1;
  if (cc < c0 || cc > c1) return;
  const r0 = Math.max(2, e.range.getRow()), r1 = e.range.getRow() + e.range.getNumRows() - 1;
  const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAIL_TAB.log);
  const note = (player, text) => { if (logSheet) mailAppend_(logSheet, { date: mailToday_(), player, what: "note", note: text }); else Logger.log(player + ": " + text); };

  const pid = PropertiesService.getScriptProperties().getProperty("PUBLIC_ID");
  const invSheet = pid ? SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites) : null;
  if (!invSheet){ Logger.log("mailOnEdit: PUBLIC_ID / Invites unavailable - nothing written"); return; }
  const year = mailCurrentYear_(mailTable_(invSheet).rows);

  const test = mailIsTest_(PropertiesService.getScriptProperties());     // test mode never writes the public sheet
  const seen = new Set();
  const isTicked = r => r.confirm === true || /^true$/i.test(String(r.confirm == null ? "" : r.confirm).trim());
  const tickedBy = new Set(t.rows.filter(r => mailNorm_(r.player) && isTicked(r)).map(r => mailNorm_(r.player)));     // fill-down: ANY row ticked counts
  t.rows.filter(r => r._row >= r0 && r._row <= r1 && mailNorm_(r.player)).forEach(r => {
    const key = mailNorm_(r.player);
    if (seen.has(key)) return; seen.add(key);
    const ticked = tickedBy.has(key);
    const player = String(r.player).trim();
    if (ticked){
      if (test) return;          // the Dashboard shows "test mode: would commit X"
      try { mailTickPublic_(invSheet, year, player, "committed"); }
      catch (err){ note(player, "confirm ticked but could NOT tick committed on the public sheet - tick by hand (" + (err && err.message || err) + ")"); }
    } else {
      const pt = mailTable_(invSheet);
      const row = pt.rows.find(x => (parseInt(x.year, 10) || 0) === year && mailNorm_(x.player) === key);
      if (row && "committed" in pt.idx && mailYes_(row.committed)) note(player, "confirm unticked - committed left ticked on the public sheet (untick it there by hand if wanted)");
    }
  });
  try { mailDashboard_(SpreadsheetApp.getActiveSpreadsheet(), PropertiesService.getScriptProperties()); } catch (err){ Logger.log("dashboard rebuild failed: " + (err && err.message || err)); }
}

// ---- adminPolish (menu: GFY Mail -> Polish admin sheet) -----------------------

function mailColLetter_(i){ let s = ""; while (i > 0){ s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); } return s; }

// Append the template headers that row 1 lacks, after the last NON-EMPTY header
// cell. Never moves, inserts or clears anything. A brand-new tab gets them all.
function mailAdminHeaders_(sh, headers){
  const width = Math.max(1, sh.getLastColumn());
  const row = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, width).getValues()[0] : [];
  const have = new Set(row.map(mailNorm_));
  let last = 0; row.forEach((v, i) => { if (String(v).trim() !== "") last = i + 1; });
  headers.forEach(h => {
    if (have.has(mailNorm_(h))) return;
    sh.getRange(1, ++last).setValue(h);
  });
}

function mailHeaderCol_(sh, name){
  if (sh.getLastRow() < 1) return 0;
  const row = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  return row.findIndex(h => mailNorm_(h) === name) + 1;
}

function mailProtectHeader_(sh){
  sh.setFrozenRows(1);
  const have = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).find(p => p.getDescription() === MAIL_POLISH_TAG);
  if (!have) sh.getRange("1:1").protect().setDescription(MAIL_POLISH_TAG).setWarningOnly(true);   // warn, never block
}

// Real checkboxes on the closed column list; "TRUE"/"FALSE" TEXT becomes a real
// boolean, nothing else is touched. Validation stops at last data row + 50.
function mailCheckboxes_(sh, cols){
  cols.forEach(c => {
    const i = mailHeaderCol_(sh, c); if (!i) return;
    const last = sh.getLastRow();
    if (last >= 2){
      const rng = sh.getRange(2, i, last - 1, 1);
      const vals = rng.getValues();
      let changed = false;
      const out = vals.map(r => {
        const v = r[0];
        if (typeof v === "string" && /^(true|false)$/i.test(v.trim())){ changed = true; return [/^true$/i.test(v.trim())]; }
        return [v];
      });
      if (changed) rng.setValues(out);
    }
    const end = Math.min(sh.getMaxRows(), last + 50);
    sh.getRange(2, i, Math.max(1, end - 1), 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  });
}

function mailContactsRules_(sh){
  const n = Math.max(1, sh.getMaxRows() - 1);
  const rules = [];
  const re = '"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"';   // formula text: ^[^@\s]+@[^@\s]+\.[^@\s]+$
  ["email", "email_alt"].forEach(h => {
    const i = mailHeaderCol_(sh, h); if (!i) return;
    const L = mailColLetter_(i);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($${L}2<>"",NOT(REGEXMATCH($${L}2&"",${re})))`)       // highlight only - never rejects input
      .setBackground("#f4cccc").setRanges([sh.getRange(2, i, n, 1)]).build());
  });
  const p = mailHeaderCol_(sh, "player");
  if (p){
    const P = mailColLetter_(p), M = mailColLetter_(MAIL_DASH_COL0 + MAIL_DASH_LISTS.indexOf("Name mismatches"));
    const esc = `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE($${P}2,"~","~~"),"*","~*"),"?","~?")`;
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($${P}2<>"",COUNTIF(INDIRECT("Dashboard!${M}3:${M}"),${esc})>0)`)
      .setBackground("#fce5cd").setRanges([sh.getRange(2, p, n, 1)]).build());
  }
  sh.setConditionalFormatRules(rules);                  // polish owns CF on Contacts (replaced wholesale, idempotent)
}

function mailOrderTabs_(admin){
  MAIL_ORDER.forEach((n, i) => { const s = admin.getSheetByName(n); if (s){ admin.setActiveSheet(s); admin.moveActiveSheet(i + 1); } });
  const home = admin.getSheetByName(MAIL_TAB.dash); if (home) admin.setActiveSheet(home);   // end on Dashboard
}

function adminPolish(){
  const admin = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  Object.keys(MAIL_SCHEMA).forEach(name => {
    const sh = admin.getSheetByName(name) || admin.insertSheet(name);
    mailAdminHeaders_(sh, MAIL_SCHEMA[name]);
    mailProtectHeader_(sh);
    mailCheckboxes_(sh, MAIL_CHECKBOX[name] || []);
    if (MAIL_TAB_COLORS[name]) sh.setTabColor(MAIL_TAB_COLORS[name]);
  });
  const con = admin.getSheetByName(MAIL_TAB.contacts);
  mailContactsRules_(con);
  mailDashboard_(admin, props);
  const dash = admin.getSheetByName(MAIL_TAB.dash);
  mailProtectHeader_(dash);
  dash.setTabColor(MAIL_TAB_COLORS.Dashboard);
  mailOrderTabs_(admin);
  Logger.log("adminPolish complete");
}

// ---- Dashboard (PRIVATE admin tab - names are fine here, never on a published tab) ----

const MAIL_DASH_LISTS = ["Needs nudge", "Bounced", "Unconfirmed looks_yes", "Name mismatches", "Changed answer \u2014 fix by hand", "RSVP from out / DNI"];
const MAIL_DASH_COL0 = 4;                               // lists live in D..G, headers on row 2, entries from row 3
const MAIL_DASH_LABELS = { nudge: "nudge after (days)", scan: "last reply scan", status: "scan status" };

function mailTrimGrid_(g){
  const rows = g.map(r => r.map(v => (v == null ? "" : v)));
  while (rows.length && rows[rows.length - 1].every(v => v === "")) rows.pop();
  let w = 0; rows.forEach(r => { r.forEach((v, i) => { if (v !== "") w = Math.max(w, i + 1); }); });
  return rows.map(r => { const o = r.slice(0, w); while (o.length < w) o.push(""); return o; });
}

function mailDateOf_(v){
  if (v instanceof Date) return v;
  const m = String(v == null ? "" : v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? Utilities.parseDate(m[1], Session.getScriptTimeZone(), "yyyy-MM-dd") : null;
}

function mailDashboard_(admin, props){
  let sh = admin.getSheetByName(MAIL_TAB.dash);
  if (!sh) sh = admin.insertSheet(MAIL_TAB.dash);

  // N (nudge days) is an editable cell on this tab - read it back before rebuilding.
  const nudge = mailReadNudgeDays_(sh);

  const notes = [];
  const lists = {}; MAIL_DASH_LISTS.forEach(k => { lists[k] = []; });
  let year = "", counts = null;

  const pid = props.getProperty("PUBLIC_ID");
  const invSheet = pid ? SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites) : null;
  const conSheet = admin.getSheetByName(MAIL_TAB.contacts), logSheet = admin.getSheetByName(MAIL_TAB.log), repSheet = admin.getSheetByName(MAIL_TAB.replies);

  if (conSheet) mailTable_(conSheet).rows.forEach(c => { if (mailNorm_(c.player) && /BOUNCED/.test(String(c.notes == null ? "" : c.notes))) lists["Bounced"].push(String(c.player).trim()); });
  if (repSheet){
    const seen = new Set(), repRows = mailTable_(repSheet).rows;
    const confirmed = new Set(repRows.filter(r => mailYes_(r.confirm)).map(r => mailNorm_(r.player)));     // any row ticked = confirmed
    repRows.forEach(r => {
      const k = mailNorm_(r.player);
      if (k && mailYes_(r.looks_yes) && !confirmed.has(k) && !seen.has(k)){ seen.add(k); lists["Unconfirmed looks_yes"].push(String(r.player).trim()); }
    });
  }

  if (mailIsTest_(props)) notes.push("RSVP test mode: answers are recorded on the RSVP tab only; the public sheet is not written.");
  if (!invSheet){
    notes.push(pid ? "Public Invites tab not found - counts and name checks unavailable." : "PUBLIC_ID script property not set - counts and name checks unavailable.");
  } else {
    const inv = mailTable_(invSheet).rows;
    year = mailCurrentYear_(inv);
    const cur = inv.filter(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player));
    const isOut = r => mailIsOutStatus_(r.status);
    counts = {
      invited: cur.filter(r => mailYes_(r.invited)).length,
      responded: cur.filter(r => mailYes_(r.responded)).length,
      committed: cur.filter(r => mailYes_(r.committed)).length,
      out: cur.filter(isOut).length,
    };
    mailNudgeRows_(cur, conSheet ? mailTable_(conSheet).rows : [], logSheet ? mailTable_(logSheet).rows : [], nudge).forEach(c => lists["Needs nudge"].push(c.player));
    if (mailIsTest_(props) && repSheet){       // test mode: confirm ticks are NOT committed - say what would be
      const would = [], seenW = new Set();
      mailTable_(repSheet).rows.forEach(r => {
        const k = mailNorm_(r.player);
        if (!k || seenW.has(k) || !(r.confirm === true || /^true$/i.test(String(r.confirm == null ? "" : r.confirm).trim()))) return;     // any ticked row of the player reaches here
        seenW.add(k);
        const pr = cur.find(x => mailNorm_(x.player) === k);
        if (pr && !mailYes_(pr.committed)) would.push(String(r.player).trim());
      });
      if (would.length) notes.push("test mode: would commit " + would.join(", "));
      const wouldR = [], seenR = new Set();
      mailTable_(repSheet).rows.forEach(r => {
        const k = mailNorm_(r.player);
        if (!k || seenR.has(k)) return;
        const pr = cur.find(x => mailNorm_(x.player) === k);
        if (pr && !mailYes_(pr.responded)){ seenR.add(k); wouldR.push(String(r.player).trim()); }
      });
      if (wouldR.length) notes.push("test mode: would mark responded " + wouldR.join(", "));
    }
    const rsvpSh = admin.getSheetByName(MAIL_TAB.rsvp);
    if (rsvpSh) mailTable_(rsvpSh).rows.forEach(r => {
      if ((parseInt(r.year, 10) || 0) !== year || !mailNorm_(r.player) || mailYes_(r.test)) return;
      const ans = String(r.answer == null ? "" : r.answer).trim().toUpperCase();
      if ((ans !== "OUT" && ans !== "MAYBE") || !/\bIN$|\bIN;/.test(String(r.history == null ? "" : r.history) + ";")) return;
      const pr = cur.find(x => mailNorm_(x.player) === mailNorm_(r.player));
      if (pr && mailYes_(pr.committed)) lists["Changed answer \u2014 fix by hand"].push(String(r.player).trim());
    });
    // M5: answers from do-not-invite / out / declined players are never written publicly - list them for a human.
    const dniSet = new Set(conSheet ? mailTable_(conSheet).rows.filter(c => mailYes_(c.do_not_invite)).map(c => mailNorm_(c.player)) : []);
    if (rsvpSh) mailTable_(rsvpSh).rows.forEach(r => {
      if ((parseInt(r.year, 10) || 0) !== year || !mailNorm_(r.player) || mailYes_(r.test) || !String(r.answer == null ? "" : r.answer).trim()) return;
      const pr = cur.find(x => mailNorm_(x.player) === mailNorm_(r.player));
      const dni = dniSet.has(mailNorm_(r.player)), out = !!pr && isOut(pr);
      if (!dni && !out) return;
      lists["RSVP from out / DNI"].push(String(r.player).trim());
      if (out && !dni && String(r.answer).trim().toUpperCase() === "IN") lists["Changed answer \u2014 fix by hand"].push(String(r.player).trim());
    });
    const names = new Set(inv.filter(r => mailNorm_(r.player)).map(r => mailNorm_(r.player)));   // ANY year: a veteran not invited this year is not a mismatch
    if (conSheet) mailTable_(conSheet).rows.forEach(c => { if (mailNorm_(c.player) && !names.has(mailNorm_(c.player))) lists["Name mismatches"].push(String(c.player)); });
  }

  // last scan health
  const readme = admin.getSheetByName(MAIL_TAB.readme);
  const rawStamp = readme ? readme.getRange(2, 2).getValue() : "";
  const stamp = mailStampText_(rawStamp);
  let status = "STALE - never scanned";
  if (stamp){
    const ms = mailStampMs_(rawStamp);
    status = isNaN(ms) ? "STALE - unreadable scan time" : (Date.now() - ms > MAIL_STALE_MS ? "STALE - over 1 h old" : "ok");
  }

  const draftStatus = prefix => {
    try {
      const t = mailLoadDraft_(prefix);
      if (t.ok) return `OK \u2014 ${t.subject}`;
      return ({ none: "MISSING \u2014 ", many: "2+ drafts \u2014 ", fill: "has [FILL] spots \u2014 " }[t.kind] || "BLOCKED \u2014 ") + t.msg;
    } catch (e){ return "UNKNOWN \u2014 Gmail unreadable"; }
  };
  if (admin.getSheetByName(MAIL_TAB.oldTpl)) notes.push("InviteTemplate tab is no longer used \u2014 safe to delete");
  const L = MAIL_DASH_LABELS;
  const left = [
    ["GFY Admin Dashboard", ""],
    ["", ""],
    ["season", counts ? year : ""],
    ["invited", counts ? counts.invited : ""],
    ["responded", counts ? counts.responded : ""],
    ["committed", counts ? counts.committed : ""],
    ["out", counts ? counts.out : ""],
    ["", ""],
    [L.nudge, nudge],
    ["", ""],
    [L.scan, stamp],
    [L.status, status],
    ["template draft", draftStatus(MAIL_TPL_PREFIX)],
    ...notes.map(n => ["note", n]),
  ];
  const height = Math.max(left.length, 2 + Math.max(...MAIL_DASH_LISTS.map(k => lists[k].length)));
  const grid = [];
  for (let r = 0; r < height; r++){
    const row = new Array(MAIL_DASH_COL0 - 1 + MAIL_DASH_LISTS.length).fill("");
    if (left[r]){ row[0] = left[r][0]; row[1] = left[r][1]; }
    MAIL_DASH_LISTS.forEach((k, i) => {
      row[MAIL_DASH_COL0 - 1 + i] = r === 1 ? k : (r >= 2 ? (lists[k][r - 2] || "") : "");
    });
    grid.push(row);
  }
  // Skip the write entirely when nothing changed (idempotent, no flicker).
  const want = mailTrimGrid_(grid);
  const have = sh.getLastRow() >= 1 ? mailTrimGrid_(sh.getDataRange().getValues()) : [];
  if (JSON.stringify(want) === JSON.stringify(have)) return;
  sh.clearContents();
  const scanRow = left.findIndex(x => x[0] === L.scan) + 1;
  if (scanRow) sh.getRange(scanRow, 2).setNumberFormat("@");        // the stamp must stay text, not be coerced to a Date
  sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  sh.getRange(1, 1).setFontWeight("bold");
  sh.getRange(2, MAIL_DASH_COL0, 1, MAIL_DASH_LISTS.length).setFontWeight("bold");
}
