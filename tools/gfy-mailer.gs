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
 *                   Required only when the template draft contains {rsvp} / {rsvp_button}.
 *    ALERT_TO       optional: an address that gets ONE health alert per 24 h
 *                   (a scan threw, or the last good scan is over 3 h old). Empty = off.
 *    TEMPLATE_PREFIX / NUDGE_PREFIX   optional: the Gmail-draft subject prefixes (defaults
 *                   "[GFY TEMPLATE]" / "[GFY NUDGE]"). A staging project in the same Gmail uses
 *                   "[GFY STAGING TEMPLATE]" / "[GFY STAGING NUDGE]"; the match is EXACT on the
 *                   leading [bracket] token, so live never sees staging drafts or vice versa.
 *    SCAN_BUDGET_MS  optional: reply-scan time budget (default 270000 = 4.5 min).
 *    NUDGE_DAYS     optional: days between a send and its nudge (default 7). Set it from the menu
 *                   (GFY Mail > Set nudge days...); the Dashboard only DISPLAYS it.
 *    (managed by the code, do not edit: SEND_RUN = the send/nudge run lease, SCAN_CURSOR, SCAN_MISSING,
 *     SCAN_THROWS = per-thread count of consecutive unreadable scans, SCAN_AUTO, TPL_STATUS,
 *     DASH_AT = when the Dashboard was last rebuilt (RSVP / onEdit rebuilds are skipped within 60 s), ALERT_LAST)
 *    ADMIN_ID       optional fallback for the Web App if getActiveSpreadsheet() is
 *                   unavailable there: the Admin sheet's own id.
 *
 *  Privacy rule: addresses, reply text and bounce notes live ONLY on the Admin
 *  sheet. The one thing this file writes to the public sheet is a boolean tick
 *  in Invites (`invited` / `responded` / `committed`, and `declined` into a blank status),
 *  through mailPublicWrite_, which refuses any value containing '@'.
 *
 *  Web surface: the deployed Web App is anonymous, so every global except doGet,
 *  recordRsvp, onOpen and the guarded menu/trigger entrypoints ends in "_" (see mailGuard_).
 *
 *  Locking (WO-FIX-33-REREVIEW N1/N2): the script lock is only ever held for SHORT steps, never across a
 *  Gmail send. A send/nudge run takes a lease (Script Property SEND_RUN, 8 min) so two runs cannot overlap;
 *  per recipient: short lock -> re-check + append a RESERVATION SendLog row ("season Y pending <runId>")
 *  -> release -> send with NO lock -> short lock -> settle the row (thread_id, "season Y sent") + public tick.
 *  A pending / "send error" row counts as already sent (never re-sent) and is listed on the Dashboard for
 *  a human. mailAppend_ refuses to run unless the lock is held.
 *  The deployed web app is a SNAPSHOT: after changing this file, Deploy > Manage deployments >
 *  Edit > Version: New version (same URL) - saving the file alone does not update it.
 *
 *  Not built (separate work order): publishing the last-scan time on the public START HERE
 *  tab (counts/time only, no names - START HERE is published).
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
// A Replies.confirm cell counts as ticked ONLY for a real checkbox TRUE (or the text "TRUE"). The ONE definition,
// used by the onEdit commit and by every Dashboard list/note, so they can never disagree about who is confirmed.
const mailConfirmTicked_ = r => r.confirm === true || /^true$/i.test(String(r.confirm == null ? "" : r.confirm).trim());
const mailYes_ = v => v === true || /^(y|yes|true|1|x|✓)$/i.test(String(v == null ? "" : v).trim());

// ---- web-surface guard --------------------------------------------------------------
// The deployed Web App is anonymous and google.script.run can call ANY global function whose name does not end
// in "_". So the only such globals are: doGet, recordRsvp, onOpen and the thin menu/trigger entrypoints below,
// which refuse unless they run from the sheet UI (getUi works) or from one of THIS project's own triggers
// (the event's triggerUid must be the id of an installed trigger). Everything else ends in "_".
// `handler` = the entrypoint's own name: a trigger's uid only authorises the function that trigger runs.
function mailGuard_(e, handler){
  if (e && e.triggerUid){
    const uid = String(e.triggerUid);
    if (ScriptApp.getProjectTriggers().some(t => String(t.getUniqueId()) === uid && t.getHandlerFunction() === handler)) return;
  }
  try { SpreadsheetApp.getUi(); }
  catch (err){ throw new Error("Not available here: run this from the GFY Mail menu or by its trigger."); }
}

function onOpen(){
  SpreadsheetApp.getUi().createMenu("GFY Mail")
    .addItem("Send invites…", "sendInvites")
    .addItem("Send nudges…", "sendNudges")
    .addItem("Scan replies now", "scanReplies")
    .addItem("Set nudge days…", "setNudgeDays")
    .addItem("Clear rehearsal answers", "clearRehearsalAnswers")
    .addItem("Polish admin sheet", "adminPolish")
    .addItem("Install / repair triggers", "installMailTriggers")
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
  if (!MAIL_LOCK_HELD_) throw new Error("mailAppend_ needs the script lock (wrap the call in mailWithLock_)");
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

// True only while THIS execution holds the script lock (each execution has fresh globals).
let MAIL_LOCK_HELD_ = false;
function mailWithLock_(fn, waitMs){
  const lock = LockService.getScriptLock();
  lock.waitLock(waitMs || 30000);
  MAIL_LOCK_HELD_ = true;
  // flush BEFORE releasing: Sheets writes are buffered, and the next execution (or this run's own next lock) must
  // see them. A flush error propagates (the caller then treats the step as failed) but the lock is still released.
  try { return fn(); } finally { MAIL_LOCK_HELD_ = false; try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } }
}

// A send/nudge run stops starting new emails after 4.5 min (Apps Script kills an execution at 6): t0 = function entry
// (the confirm dialog counts). Whoever was not reached is told to run again - every re-run is safe (SendLog excludes the sent).
const MAIL_SEND_BUDGET_MS = 270000;
const mailOverBudget_ = t0 => Date.now() - t0 >= MAIL_SEND_BUDGET_MS;
const mailNotYet_ = n => `${n} not sent yet — run again (stopped to stay inside the 6-minute Apps Script limit; nobody who was sent is emailed twice)`;

// ---- run lease (WO-FIX-33-REREVIEW N1): one send/nudge run at a time, without holding the lock across sends ----
const MAIL_LEASE_MS = 8 * 60 * 1000;
function mailLeaseRead_(props){ try { const v = JSON.parse(props.getProperty("SEND_RUN") || "null"); return v && typeof v === "object" ? v : null; } catch (e){ return null; } }
// Returns the new run id, or "" when another run holds a live lease. Throws if the lock cannot be had.
function mailRunBegin_(props){
  return mailWithLock_(() => {
    const cur = mailLeaseRead_(props);
    if (cur && Number(cur.expires) > Date.now()) return "";
    const id = Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
    props.setProperty("SEND_RUN", JSON.stringify({ id, expires: Date.now() + MAIL_LEASE_MS }));
    return id;
  }, 10000);
}
function mailRunEnd_(props, id){
  try { mailWithLock_(() => { const cur = mailLeaseRead_(props); if (cur && cur.id === id) props.deleteProperty("SEND_RUN"); }, 10000); }
  catch (e){ Logger.log("could not release the send lease (it expires on its own): " + (e && e.message || e)); }
}
const MAIL_ANOTHER_RUN = "Another send is running (a send or nudge run holds the lease, or the script lock is busy). Wait a few minutes and run it again. Nothing sent.";

// One log row for a send: reserved before the email goes out, settled after. Lock held by the caller.
function mailLogSettle_(logSheet, runId, base, threadId, note){
  const t = mailTable_(logSheet);
  const tag = "pending " + runId;
  const row = t.rows.find(r => mailNorm_(r.player) === mailNorm_(base.player) && mailNorm_(r.what) === base.what && String(r.note == null ? "" : r.note).indexOf(tag) >= 0);
  if (!row){ mailAppend_(logSheet, Object.assign({}, base, { note, thread_id: threadId })); return; }     // the reservation row was removed by hand: never lose the thread id
  logSheet.getRange(row._row, t.idx.note + 1).setValue(note);
  if (threadId !== undefined && "thread_id" in t.idx){ const cell = logSheet.getRange(row._row, t.idx.thread_id + 1); cell.setNumberFormat("@"); cell.setValue(threadId); }
}
// SendLog rows a human must look at: reserved but never settled, or a send() that threw.
function mailUnsettled_(logRows){
  const out = [];
  logRows.forEach(l => {
    const w = mailNorm_(l.what); if (w !== "invite" && w !== "nudge" && w !== "invite-test" && w !== "nudge-test") return;
    const note = String(l.note == null ? "" : l.note);
    const err = /send error/.test(note), pend = /\bpending\b/.test(note) && !String(l.thread_id == null ? "" : l.thread_id).trim();
    if (err || pend) out.push(`${String(l.player).trim()} (${w}, ${err ? "send error" : "pending"})`);
  });
  return out;
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

// Exact prefix match. For a "[BRACKETED]" prefix the subject's own leading [bracket] token must equal it, so
// "[GFY STAGING TEMPLATE]" or "[GFY TEMPLATE] extra"-style longer prefixes are never mistaken for "[GFY TEMPLATE]".
function mailPrefixMatches_(subject, prefix){
  const subj = mailNorm_(subject), want = mailNorm_(prefix);
  if (!want) return false;
  if (/^\[[^\]]*\]$/.test(want)){
    const lead = subj.match(/^\[[^\]]*\]/);
    return !!lead && lead[0] === want;
  }
  return subj.indexOf(want) === 0;
}
// Script properties TEMPLATE_PREFIX / NUDGE_PREFIX let a staging project share a Gmail account with live.
function mailTplPrefix_(props){ return String(props.getProperty("TEMPLATE_PREFIX") || "").trim() || MAIL_TPL_PREFIX; }
function mailNudgePrefix_(props){ return String(props.getProperty("NUDGE_PREFIX") || "").trim() || MAIL_NUDGE_PREFIX; }

const MAIL_BUTTON_STYLE = "display:inline-block;padding:12px 22px;background:#0E2019;color:#E9E3D3;text-decoration:none;font-weight:bold;border-radius:6px;";
const MAIL_BUTTON_LABEL = "Tell me: IN, OUT or MAYBE";

/** Gmail wraps links it saves in a draft as https://www.google.com/url?q=<real>&sa=...; put the real URL back.
 *  `html` re-escapes & for use inside an HTML attribute. */
function mailUnwrapGoogle_(text, html){
  return String(text).replace(/https?:\/\/(?:www\.)?google\.com\/url\?([^\s"'<>]*)/gi, (m, qs) => {
    const mm = qs.replace(/&amp;/g, "&").match(/(?:^|&)q=([^&]*)/);
    if (!mm) return m;
    let real;
    try { real = decodeURIComponent(mm[1].replace(/\+/g, " ")); } catch (e){ return m; }
    return html ? real.replace(/&/g, "&amp;") : real;
  });
}

/** Find THE template draft (subject starts with `prefix`, case-insensitive, trimmed).
 *  Returns { ok:true, subject, html, plain, attachments } or { ok:false, kind, msg }.
 *  The draft is only ever READ - never sent, updated or deleted. */
function mailLoadDraft_(prefix){
  const found = GmailApp.getDrafts().filter(d => mailPrefixMatches_(d.getMessage().getSubject(), prefix));
  if (found.length !== 1){
    return { ok: false, kind: found.length ? "many" : "none",
      msg: found.length ? `Found ${found.length} drafts whose subject starts with ${prefix} - there must be exactly ONE. Delete the extras.`
                        : `No draft whose subject starts with ${prefix} was found (0). Write it as a normal Gmail draft in this account.` };
  }
  const m = found[0].getMessage();
  const raw = String(m.getSubject() || "").trim();
  const subject = raw.slice(prefix.length).trim();
  const html = mailUnwrapGoogle_(String(m.getBody() || ""), true), plain = mailUnwrapGoogle_(String(m.getPlainBody() || ""), false);
  // Inline markup can split a token or a [FILL marker ("{da<b>te</b>}"): scan the TAG-STRIPPED text too.
  const htmlText = String(html).replace(/<[^>]*>/g, "");
  if (/\[\s*fill/i.test(raw + "\n" + html + "\n" + plain + "\n" + htmlText)) return { ok: false, kind: "fill", msg: "the template draft still has [FILL] spots" };
  const all = m.getAttachments({ includeInlineImages: true }) || [];
  const files = m.getAttachments({ includeInlineImages: false }) || [];
  if (all.length > files.length) return { ok: false, kind: "inline", msg: "The template draft has inline images, which this sender cannot copy safely (it would send a broken email). Remove them or use a normal attachment / a hosted image link." };
  // Gmail's draft editor rewrites a typed {rsvp} href to javascript:void(0) (and strips button styling) - the button
  // must come from the {rsvp_button} token, which the mailer turns into a real styled link.
  if (/href\s*=\s*["']?\s*javascript:/i.test(html)) return { ok: false, kind: "badlink", msg: "The template draft has a link whose address Gmail replaced with javascript:void(0) (it does that to a typed {rsvp} link). Remove the link and put {rsvp_button} (or plain {rsvp}) in the text instead. Nothing sent." };
  if (/%7B[^"'<>\s]*?%7D/i.test(html + "\n" + plain)) return { ok: false, kind: "badlink", msg: "The template draft has a link containing %7B...%7D (an encoded {token}, so it can never be filled in). Remove the link and put {rsvp_button} or {rsvp} in the text instead. Nothing sent." };
  const left = [];
  [raw, html, htmlText, plain].forEach(t => (String(t).replace(/\{(first|rsvp|rsvp_button)\}/g, "").match(MAIL_TOKEN_RE) || []).forEach(x => { if (left.indexOf(x) < 0) left.push(x); }));
  if (left.length) return { ok: false, kind: "token", msg: `The template draft has unreplaced ${left.join(" ")} - only {first}, {rsvp} and {rsvp_button} are filled in. Nothing sent.` };
  // A token the mailer WOULD fill but that formatting split in the HTML ("{fi<b>rst</b>}") is never replaced.
  const cnt = (t, tok) => String(t).split(tok).length - 1;
  if (["{first}", "{rsvp}", "{rsvp_button}"].some(tok => cnt(htmlText, tok) > cnt(html, tok))) return { ok: false, kind: "token", msg: "The template draft has a {first} / {rsvp} / {rsvp_button} token split by formatting (bold, colour, a link...) so it can never be filled in. Retype the whole token in one go with no formatting inside the braces. Nothing sent." };
  if (!subject || !(html.trim() || plain.trim())) return { ok: false, kind: "empty", msg: "The template draft needs a subject (after the prefix) and a body." };
  return { ok: true, subject, html, plain, attachments: files, hasRsvp: /\{rsvp(_button)?\}/.test(raw + html + plain) };
}

/** Per-recipient copy of the draft. Names are HTML-escaped inside the HTML body only.
 *  {rsvp_button} -> a full inline-styled <a> (HTML) / the bare URL (plain, subject); {rsvp} -> the URL
 *  (a linked URL in HTML text, the plain URL inside an href="{rsvp}" attribute). {first} is filled LAST so a
 *  name can never inject a token. */
function mailBuild_(tpl, player, address, test, rsvpUrl){
  const first = String(player).trim().split(/\s+/)[0];
  const url = rsvpUrl || "", urlH = mailHtmlEsc_(url);
  const plainFill = t => String(t).replace(/\{rsvp_button\}/g, () => url).replace(/\{rsvp\}/g, () => url).replace(/\{first\}/g, () => first);
  const htmlFill = t => String(t)
    .replace(/href\s*=\s*(["'])\{rsvp\}\1/g, (m, q) => `href=${q}${urlH}${q}`)
    .replace(/\{rsvp_button\}/g, () => url ? `<a href="${urlH}" style="${MAIL_BUTTON_STYLE}">${MAIL_BUTTON_LABEL}</a>` : "")
    .replace(/\{rsvp\}/g, () => url ? `<a href="${urlH}">${urlH}</a>` : "")
    .replace(/\{first\}/g, () => mailHtmlEsc_(first));
  const subject = plainFill(tpl.subject);
  return {
    to: test ? MAIL_TEST_ADDR : address,
    subject: test ? `[TEST \u2192 ${address}] ${subject}` : subject,
    body: plainFill(tpl.plain), htmlBody: htmlFill(tpl.html), attachments: tpl.attachments || [],
  };
}

function mailSendOpts_(m){
  const o = {};
  if (m.htmlBody && m.htmlBody.trim()) o.htmlBody = m.htmlBody;
  if (m.attachments && m.attachments.length) o.attachments = m.attachments;
  return o;
}

// ---- A: the button ---------------------------------------------------------

function sendInvites(e){ mailGuard_(e, "sendInvites"); mailSendInvites_(); }
function mailSendInvites_(){
  const t0 = Date.now();
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
  if (!mailIsTest_(props)){
    const stale = mailStaleRehearsal_(admin, plan.year, mailTable_(logSheet).rows);
    if (stale.length){ say("Send BLOCKED — rehearsal answers (nothing was sent)", mailRehearsalMsg_(stale)); return; }
  }
  const dupNote = plan.alreadySent.length ? `\n\nAlready emailed according to SendLog, NOT sent again (tick invited on the public sheet by hand if it is missing): ${plan.alreadySent.join(", ")}` : "";
  if (!plan.recipients.length){ say("GFY Mail", `Nobody to invite for ${plan.year}.` + (plan.noAddress.length ? `\nNo address on file: ${plan.noAddress.join(", ")}` : "") + dupNote); return; }

  let tpl;
  try { tpl = mailLoadDraft_(mailTplPrefix_(props)); } catch (e){ say("GFY Mail", "Could not read Gmail drafts (" + (e && e.message || e) + "). Nothing sent."); return; }
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

  // No lock is held across the sends: a run lease keeps two runs apart, and each recipient is
  // reserved in SendLog (short lock) BEFORE the email goes out and settled (short lock) after it.
  let runId = "";
  try { runId = mailRunBegin_(props); } catch (e){ runId = ""; }
  if (!runId){ say("GFY Mail", MAIL_ANOTHER_RUN); return; }
  const failed = [], tickFailed = [], skipped = [], unconfirmed = [], notYet = [];
  let sent = 0, stop = "", blockMsgs = [];
  try {
    mailWithLock_(() => mailEnsureHeader_(logSheet, "thread_id"), 10000);
    plan.recipients.forEach(r => {
      if (!stop && mailOverBudget_(t0)) stop = "time";
      if (stop){ notYet.push(r.player); return; }
      let res;
      try {
        res = mailWithLock_(() => {
          // Re-read EVERYTHING under the lock right before this send: invited tick, SendLog, DNI, status.
          const fresh = mailPlan_(mailTable_(conSheet).rows, mailTable_(invSheet).rows, mailTable_(logSheet).rows);
          const still = fresh.recipients.find(x => mailNorm_(x.player) === mailNorm_(r.player));
          if (fresh.blocks.length) return { blocks: fresh.blocks };
          if (fresh.year !== plan.year) return { skip: "the season changed" };
          if (!still) return { skip: "no longer due - already invited / logged, or its status was edited" };
          if (still.address !== r.address) return { skip: "its address was edited" };
          const url = tpl.hasRsvp ? mailRsvpUrl_(props, mailRsvpTokenNL_(admin.getSheetByName(MAIL_TAB.rsvp), plan.year, r.player, test)) : "";
          const m = mailBuild_(tpl, r.player, r.address, test, url);
          const base = { date: mailToday_(), player: r.player, address_used: m.to, what: test ? "invite-test" : "invite" };
          mailAppend_(logSheet, Object.assign({}, base, { note: (test ? `TEST MODE (real address ${r.address}) ` : `season ${plan.year} `) + "pending " + runId, thread_id: "" }));
          return { m, base };
        }, 10000);
      } catch (e){ failed.push(`${r.player} (${e && e.message || e}; nothing was sent to them)`); return; }
      if (res.blocks){ stop = "block"; blockMsgs = res.blocks; notYet.push(r.player); return; }
      if (res.skip){ skipped.push(`${r.player} (${res.skip})`); return; }
      let threadId;
      try { threadId = mailSendNew_(res.m); }
      catch (e){
        // Keep the reservation: the send may or may not have gone out. A human checks Gmail > Sent.
        try { mailWithLock_(() => mailLogSettle_(logSheet, runId, res.base, "", (test ? `TEST MODE (real address ${r.address}) ` : `season ${plan.year} `) + "send error — check Sent before re-running"), 10000); } catch (x){ /* stays "pending": still listed on the Dashboard */ }
        failed.push(`${r.player} (${e && e.message || e})`); return;
      }
      sent++;
      try {
        mailWithLock_(() => {
          mailLogSettle_(logSheet, runId, res.base, threadId, test ? `TEST MODE (real address ${r.address})` : `season ${plan.year} sent`);
          if (!test){
            try { mailTickPublicNL_(invSheet, plan.year, r.player, "invited"); }
            catch (e){ tickFailed.push(r.player); }
          }
        }, 10000);
      } catch (e){ unconfirmed.push(r.player); }
    });
  } finally { mailRunEnd_(props, runId); }
  try { mailDashboard_(admin, props, true); } catch (e){ Logger.log("dashboard rebuild failed: " + (e && e.message || e)); }
  say("GFY Mail", `${test ? "TEST " : ""}Sent ${sent} of ${plan.recipients.length}.`
    + (failed.length ? `\n\nSEND FAILED (a SendLog row stays, marked 'send error' if the email may have gone out — check Gmail Sent BEFORE re-running; the person is not emailed again until that row is removed): ${failed.join("; ")}` : "")
    + (stop === "time" ? `\n\n${mailNotYet_(notYet.length)}: ${notYet.join(", ")}` : "")
    + (stop === "block" ? `\n\nSTOPPED - a block appeared while sending (${notYet.length} not sent: ${notYet.join(", ")}). Fix it, then run again: ${blockMsgs.join("; ")}` : "")
    + (skipped.length ? `\n\nSKIPPED: ${skipped.join("; ")}` : "")
    + (unconfirmed.length ? `\n\nSent, but the SendLog row could not be settled (it stays 'pending' - listed on the Dashboard; fill its thread_id by hand): ${unconfirmed.join(", ")}` : "")
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

// Nudge interval: Script Property NUDGE_DAYS (menu "Set nudge days…"); the Dashboard only displays it.
function mailReadNudgeDays_(props){
  const n = parseInt(String(props.getProperty("NUDGE_DAYS") == null ? "" : props.getProperty("NUDGE_DAYS")).trim(), 10);
  return n > 0 ? n : MAIL_NUDGE_DEFAULT;
}

function setNudgeDays(e){ mailGuard_(e, "setNudgeDays"); mailSetNudgeDays_(); }
function mailSetNudgeDays_(){
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const cur = mailReadNudgeDays_(props);
  const r = ui.prompt("Set nudge days", `Nudge people who were last emailed at least this many days ago (a whole number, 1-365). Now: ${cur}.`, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const txt = String(r.getResponseText() || "").trim();
  if (!/^\d{1,3}$/.test(txt) || Number(txt) < 1 || Number(txt) > 365){ ui.alert("Set nudge days", `"${txt}" is not a whole number from 1 to 365. Nothing changed (still ${cur}).`, ui.ButtonSet.OK); return; }
  props.setProperty("NUDGE_DAYS", String(Number(txt)));
  try { mailDashboard_(SpreadsheetApp.getActiveSpreadsheet(), props, false); } catch (err){ Logger.log("dashboard rebuild failed: " + (err && err.message || err)); }
  ui.alert("Set nudge days", `Nudges now go to people last emailed ${Number(txt)}+ days ago.`, ui.ButtonSet.OK);
}

// ---- N6: rehearsal answers left by an older version ------------------------------------------
// An unflagged RSVP row (current season) that already has an answer although its player has no LIVE invite in the
// SendLog can only be a test-mode answer from a version that did not flag them. Returns the player names.
function mailStaleRehearsal_(admin, year, logRows){
  const rs = admin.getSheetByName(MAIL_TAB.rsvp);
  if (!rs) return [];
  const out = [];
  mailTable_(rs).rows.forEach(r => {
    if ((parseInt(r.year, 10) || 0) !== year || !mailNorm_(r.player) || mailYes_(r.test)) return;
    if (!String(r.answer == null ? "" : r.answer).trim()) return;
    if (mailInviteLogged_(logRows, r.player, year)) return;
    out.push(String(r.player).trim());
  });
  return out;
}
function mailRehearsalMsg_(names){
  return `These RSVP rows hold answers but the player has no live invite in SendLog - rehearsal answers from an older version: ${names.join(", ")}.\n\nClear them first (menu: GFY Mail > Clear rehearsal answers), then send.`;
}

function clearRehearsalAnswers(e){ mailGuard_(e, "clearRehearsalAnswers"); mailClearRehearsal_(); }
function mailClearRehearsal_(){
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const admin = SpreadsheetApp.getActiveSpreadsheet();
  const rs = admin.getSheetByName(MAIL_TAB.rsvp), logSheet = admin.getSheetByName(MAIL_TAB.log);
  if (!rs || !logSheet){ ui.alert("GFY Mail", "No RSVP / SendLog tab. Nothing cleared.", ui.ButtonSet.OK); return; }
  const pid = props.getProperty("PUBLIC_ID");
  const invSheet = pid ? SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites) : null;
  if (!invSheet){ ui.alert("GFY Mail", "PUBLIC_ID / public Invites tab unavailable (the current season is needed). Nothing cleared.", ui.ButtonSet.OK); return; }
  const year = mailCurrentYear_(mailTable_(invSheet).rows);
  const pick = () => {
    const stale = new Set(mailStaleRehearsal_(admin, year, mailTable_(logSheet).rows).map(mailNorm_));
    return mailTable_(rs).rows.filter(r => String(r.answer == null ? "" : r.answer).trim() && (mailYes_(r.test) || ((parseInt(r.year, 10) || 0) === year && stale.has(mailNorm_(r.player)))));
  };
  const rows = pick();
  if (!rows.length){ ui.alert("GFY Mail", "No rehearsal answers to clear.", ui.ButtonSet.OK); return; }
  const names = Array.from(new Set(rows.map(r => String(r.player).trim())));
  if (ui.alert("Clear rehearsal answers", `Clear the answer, answered_at and history of ${rows.length} RSVP row(s) (test-flagged rows, and unflagged rows whose player has no live invite)?\n\n${names.join("\n")}\n\nTokens are kept. Real answers (a player with a live invite) are never touched.`, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  mailWithLock_(() => {
    const t = mailTable_(rs);
    pick().forEach(r => ["answer", "answered_at", "history"].forEach(h => { if (h in t.idx) rs.getRange(r._row, t.idx[h] + 1).setValue(""); }));
  });
  try { mailDashboard_(admin, props, false); } catch (err){ Logger.log("dashboard rebuild failed: " + (err && err.message || err)); }
  ui.alert("GFY Mail", `Cleared ${rows.length} rehearsal answer(s).`, ui.ButtonSet.OK);
}

function sendNudges(e){ mailGuard_(e, "sendNudges"); mailSendNudges_(); }
function mailSendNudges_(){
  const t0 = Date.now();
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
  try { tpl = mailLoadDraft_(mailNudgePrefix_(props)); } catch (e){ say("GFY Mail", "Could not read Gmail drafts (" + (e && e.message || e) + "). Nothing sent."); return; }
  if (!tpl.ok){ say("Nudge BLOCKED - template draft (nothing was sent)", tpl.msg); return; }
  const rs = mailRsvpPrereq_(props, admin, tpl);
  if (rs){ say("Nudge BLOCKED - RSVP links (nothing was sent)", rs); return; }

  const test = mailIsTest_(props);
  const inv = mailTable_(invSheet).rows, year = mailCurrentYear_(inv);
  if (!test){
    const stale = mailStaleRehearsal_(admin, year, mailTable_(logSheet).rows);
    if (stale.length){ say("Nudge BLOCKED — rehearsal answers (nothing was sent)", mailRehearsalMsg_(stale)); return; }
  }
  const days = mailReadNudgeDays_(props);
  const cur = inv.filter(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player));
  const all = mailNudgeRows_(cur, mailTable_(conSheet).rows, mailTable_(logSheet).rows, days, test);
  const bouncedNames = all.filter(c => c.bounced).map(c => c.player);
  const cands = all.filter(c => c.threadId && !c.bounced), noThread = all.filter(c => !c.threadId && !c.bounced).map(c => c.player);
  const skipNote = (bouncedNames.length ? `\n\nBounced, not nudged (fix their address first): ${bouncedNames.join(", ")}` : "")
    + (noThread.length ? `\n\nNo confirmed invite thread on file (a pending / errored invite? see the Dashboard): ${noThread.join(", ")}` : "");
  if (!cands.length){ say("GFY Mail", `Nobody to nudge (invited, not answered, last send ${days}+ days ago).` + skipNote); return; }

  const quota = MailApp.getRemainingDailyQuota();
  if (quota < cands.length){ say("GFY Mail", `Daily send quota too low: ${quota} left, ${cands.length} needed. Nothing sent.`); return; }
  const msg = (test ? `TEST MODE: fresh messages go to ${MAIL_TEST_ADDR} only; nobody real is contacted.\n\n` : "LIVE: each person gets a FRESH email to the address we invited, subject \"Reminder: <their invite subject>\".\n\n")
    + `Nudge ${cands.length} ${year} player(s) (last send ${days}+ days ago)?\n\n${cands.map(c => c.player).join("\n")}` + skipNote;
  if (ui.alert("Send nudges", msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  let runId = "";
  try { runId = mailRunBegin_(props); } catch (e){ runId = ""; }
  if (!runId){ say("GFY Mail", MAIL_ANOTHER_RUN); return; }
  const failed = [], skipped = [], unconfirmed = [], notYet = [];
  let sent = 0, stop = "";
  try {
    cands.forEach(c0 => {
      if (!stop && mailOverBudget_(t0)) stop = "time";
      if (stop){ notYet.push(c0.player); return; }
      let res;
      try {
        res = mailWithLock_(() => {
          // Re-read under the lock right before this send (a concurrent run may have nudged / the person may have answered).
          const freshInv = mailTable_(invSheet).rows;
          const freshCur = freshInv.filter(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player));
          const c = mailNudgeRows_(freshCur, mailTable_(conSheet).rows, mailTable_(logSheet).rows, days, test).find(x => mailNorm_(x.player) === mailNorm_(c0.player));
          if (!c) return { skip: "no longer due - answered, out, or nudged meanwhile" };
          if (c.bounced) return { skip: "bounced meanwhile" };
          if (!c.threadId) return { skip: "no confirmed invite thread" };
          if (!test && !c.address) throw new Error("no address on file");
          const url = tpl.hasRsvp ? mailRsvpUrl_(props, mailRsvpTokenNL_(admin.getSheetByName(MAIL_TAB.rsvp), year, c.player, test)) : "";
          const m = mailBuild_(tpl, c.player, c.address, test, url);
          const base = { date: mailToday_(), player: c.player, address_used: test ? MAIL_TEST_ADDR : c.address, what: test ? "nudge-test" : "nudge" };
          mailAppend_(logSheet, Object.assign({}, base, { note: (test ? `TEST MODE (real address ${c.address}) ` : `season ${year} `) + "pending " + runId, thread_id: "" }));
          return { c, m, base };
        }, 10000);
      } catch (e){ failed.push(`${c0.player} (${e && e.message || e}; nothing was sent to them)`); return; }
      if (res.skip){ skipped.push(`${c0.player} (${res.skip})`); return; }
      const { c, m, base } = res;
      const realNote = test ? `TEST MODE (real address ${c.address})` : `season ${year} sent`;
      let threadId;
      try {
        // ALWAYS a fresh email (never a thread reply): live goes to the exact logged address as "Reminder: <invite subject>"
        // (PM ruling: no fake "Re:"); its own thread id is logged and watched.
        const out = test ? m : { to: c.address, subject: mailNudgeSubject_(c.threadId, m.subject), body: m.body, htmlBody: m.htmlBody, attachments: m.attachments };
        threadId = mailSendNew_(out);
      } catch (e){
        try { mailWithLock_(() => mailLogSettle_(logSheet, runId, base, "", (test ? `TEST MODE (real address ${c.address}) ` : `season ${year} `) + "send error — check Sent before re-running"), 10000); } catch (x){ /* stays pending */ }
        failed.push(`${c.player} (${e && e.message || e})`); return;
      }
      sent++;
      try { mailWithLock_(() => mailLogSettle_(logSheet, runId, base, threadId, realNote), 10000); } catch (e){ unconfirmed.push(c.player); }
    });
  } finally { mailRunEnd_(props, runId); }
  try { mailDashboard_(admin, props, true); } catch (e){ Logger.log("dashboard rebuild failed: " + (e && e.message || e)); }
  say("GFY Mail", `${test ? "TEST " : ""}Nudged ${sent} of ${cands.length}.`
    + (failed.length ? `\n\nNUDGE FAILED (a SendLog row stays, marked 'send error' if the email may have gone out — check Gmail Sent BEFORE re-running): ${failed.join("; ")}` : "")
    + (stop === "time" ? `\n\n${mailNotYet_(notYet.length)}: ${notYet.join(", ")}` : "")
    + (skipped.length ? `\n\nSKIPPED: ${skipped.join("; ")}` : "")
    + (unconfirmed.length ? `\n\nSent, but the SendLog row could not be settled (it stays 'pending' - fill its thread_id by hand): ${unconfirmed.join(", ")}` : "")
    + skipNote);
}

// "Reminder: " + the subject of the person's original invite (read from the logged invite thread). A missing,
// deleted or unreadable thread is not an error: fall back to the nudge draft's own subject.
function mailNudgeSubject_(threadId, fallback){
  let subject = "";
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (thread) subject = String(thread.getFirstMessageSubject() || "").trim();
  } catch (e){ subject = ""; }
  return subject ? (/^reminder:/i.test(subject) ? subject : "Reminder: " + subject) : fallback;
}

// ---- B: RSVP links (Web App in this same project) ---------------------------------
// Deploy: Apps Script -> Deploy -> New deployment -> Web app, Execute as: Me,
// Who has access: Anyone. Put the /exec URL in the WEBAPP_URL script property.

function mailRsvpPrereq_(props, admin, tpl){
  if (!tpl.hasRsvp) return "";
  if (!String(props.getProperty("WEBAPP_URL") || "").trim()) return "The template draft contains {rsvp} but the script property WEBAPP_URL is not set (deploy the Web App, then paste its /exec URL).";
  if (!admin.getSheetByName(MAIL_TAB.rsvp)) return "The template draft contains {rsvp} but the Admin sheet has no RSVP tab - run GFY Mail > Polish admin sheet first.";
  // After the fill, the HTML body must carry the link (a token that is only in the plain body leaves the HTML with no button).
  if (String(tpl.html || "").trim()){
    const probe = mailRsvpUrl_(props, "PROBEPROBEPROBEPROBEPROBE00");
    if (mailBuild_(tpl, "Probe Name", "probe@example.invalid", false, probe).htmlBody.indexOf(mailHtmlEsc_(probe)) < 0)
      return "The template draft's HTML body ends up with NO RSVP link after the fill (the {rsvp} / {rsvp_button} token is only in the plain text, or sits somewhere the mailer cannot fill). Put {rsvp_button} in the HTML text of the draft. Nothing sent.";
  }
  return "";
}

function mailRsvpUrl_(props, token){
  const base = String(props.getProperty("WEBAPP_URL")).trim();
  return base + (base.indexOf("?") >= 0 ? "&" : "?") + "t=" + token;
}

// One random token per (year, player, test?), created once and reused. Stored ONLY in the private RSVP tab.
// TEST-mode sends use their own tokens (RSVP.test = TRUE) so a rehearsal answer can never sit on the
// token a real player later receives; live sends never reuse a test token.
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
function go(c,retried){var bs=document.getElementsByTagName("button");for(var i=0;i<bs.length;i++){bs[i].disabled=true;}
document.getElementById("msg").className="";document.getElementById("msg").textContent="Saving...";
google.script.run.withSuccessHandler(function(){for(var i=0;i<bs.length;i++){bs[i].disabled=false;bs[i].className="";}
document.getElementById("b-"+c).className="sel";document.getElementById("q").textContent="Got it - you're "+c+".";
document.getElementById("cur").textContent="Your answer: "+c+". Tap another to change it.";document.getElementById("msg").textContent="Saved.";})
.withFailureHandler(function(){if(!retried){document.getElementById("msg").textContent="Saving... (retrying)";setTimeout(function(){go(c,true);},5000);return;}for(var i=0;i<bs.length;i++){bs[i].disabled=false;}document.getElementById("msg").className="err";document.getElementById("msg").textContent="Could not save - try again, or reply to the email.";}).recordRsvp(T,c);}
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
  const out = { player: "" };
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
    } catch (err){
      const log = ctx.admin.getSheetByName(MAIL_TAB.log);
      try { if (log) mailAppend_(log, { date: mailToday_(), player: out.player, what: "note", note: `RSVP ${c} recorded but the public sheet could not be updated - fix by hand` }); }
      catch (e2){ Logger.log("could not log the public-write failure: " + (e2 && e2.message || e2)); }
    }
  });
  try { mailDashboard_(ctx.admin, props, false, true); } catch (err){ Logger.log("dashboard rebuild failed: " + (err && err.message || err)); }
  return { answer: c, first: out.player.split(/\s+/)[0] };
}

// ---- C: reply watcher --------------------------------------------------------

function installMailTriggers(e){ mailGuard_(e, "installMailTriggers"); mailInstallTriggers_(); }
function mailInstallTriggers_(){
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

const MAIL_THROWS_MISSING = 3;                           // consecutive unreadable scans before a thread counts as missing
const MAIL_SCAN_BUDGET_MS = 270000;                      // 4.5 min of the 6 min execution limit
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

function scanReplies(e){ mailGuard_(e, "scanReplies"); mailScanRun_(); }
function mailScanRun_(){
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

  mailWithLock_(() => mailEnsureHeader_(repSheet, "msg_id"));
  const me = Session.getEffectiveUser().getEmail();
  const invRows = mailTable_(invSheet).rows, year = mailCurrentYear_(invRows);
  const test = mailIsTest_(props);                  // TEST MODE: the public sheet is never written (the Dashboard says what would be)
  const seen = new Set(mailTable_(repSheet).rows.map(r => String(r.msg_id)));
  const responded = new Set(invRows.filter(r => (parseInt(r.year, 10) || 0) === year && mailYes_(r.responded)).map(r => mailNorm_(r.player)));
  const errors = [];
  // Auto-reply / out-of-office message ids already classified: never fetched or classified again (capped, newest kept).
  let autoIds;
  try { autoIds = JSON.parse(props.getProperty("SCAN_AUTO") || "[]"); if (!Array.isArray(autoIds)) autoIds = []; } catch (e){ autoIds = []; }
  const autoSeen = new Set(autoIds);
  // threads Gmail no longer has: [{ k: "invite" | "nudge", id: thread id, p: player }] - keyed per THREAD so one
  // healthy sibling thread can never erase another's entry (deterministic whatever order the threads are read in)
  let missing = mailMissingLoad_(props.getProperty("SCAN_MISSING"));
  // consecutive scans in which getThreadById THREW, per thread id: 1-2 = a scan error, the 3rd = treat as missing
  let throwsN = {};
  try { throwsN = JSON.parse(props.getProperty("SCAN_THROWS") || "{}"); if (!throwsN || typeof throwsN !== "object" || Array.isArray(throwsN)) throwsN = {}; } catch (e){ throwsN = {}; }

  // every logged LIVE thread (invites AND fresh nudge threads), once each; test-mode rows are never watched
  const watched = new Set();
  const entries = mailTable_(logSheet).rows.filter(r => { const w = mailNorm_(r.what); return (w === "invite" || w === "nudge") && String(r.thread_id || "").trim(); }).filter(r => {
    const id = String(r.thread_id).trim(); if (watched.has(id)) return false; watched.add(id); return true;
  });

  // Time budget (Apps Script kills an execution at 6 min): stop early, remember where, resume next run.
  // The last-scan stamp is only written when a whole pass over the threads has completed.
  const rawBudget = props.getProperty("SCAN_BUDGET_MS");
  const budget = rawBudget != null && String(rawBudget).trim() !== "" && !isNaN(Number(rawBudget)) ? Number(rawBudget) : MAIL_SCAN_BUDGET_MS;
  const t0 = Date.now();
  let at = parseInt(props.getProperty("SCAN_CURSOR"), 10) || 0;
  if (at < 0 || at >= entries.length) at = 0;
  let partial = false, done = 0;
  for (; at < entries.length; at++){
    if (done > 0 && Date.now() - t0 > budget){ partial = true; break; }
    done++;
    const entry = entries[at];
    const player = String(entry.player).trim(), pk = mailNorm_(player);
    if (responded.has(pk)){ missing = missing.filter(m => mailNorm_(m.p) !== pk); continue; }     // already answered: no Gmail calls
    const tid = String(entry.thread_id).trim(), kind = mailNorm_(entry.what) === "nudge" ? "nudge" : "invite";
    try {
      let thread;
      try { thread = GmailApp.getThreadById(tid); delete throwsN[tid]; }
      catch (ge){
        const n = (Number(throwsN[tid]) || 0) + 1; throwsN[tid] = n;
        if (n < MAIL_THROWS_MISSING) throw ge;      // 1st / 2nd consecutive throw: a real scan error
        thread = null;                              // 3rd: Gmail cannot read it - same as deleted, never a permanent failure
      }
      if (!thread){ if (!missing.some(m => m.id === tid)) missing.push({ k: kind, id: tid, p: player }); continue; }   // deleted in Gmail: reported on the Dashboard, not an error
      missing = missing.filter(m => !(m.id === tid || (m.id === "" && m.k === kind && mailNorm_(m.p) === pk)));
      let replied = false;
      thread.getMessages().forEach(msg => {
        const id = String(msg.getId());
        if (seen.has(id)){ replied = true; return; }     // already logged => it WAS a real reply: no classification, no raw fetch
        if (autoSeen.has(id)) return;                    // an auto-reply seen before: no classification, no raw fetch
        const kind = mailClassify_(msg, me);
        if (kind === "auto"){ autoSeen.add(id); autoIds.push(id); return; }
        if (kind === "own") return;
        if (kind === "bounce"){ mailNoteBounce_(conSheet, player, mailToday_(msg.getDate())); return; }
        replied = true;
        seen.add(id);
        const snippet = mailSnippet_(msg.getPlainBody());
        mailWithLock_(() => mailAppend_(repSheet, {
          date: mailToday_(msg.getDate()), player, from: String(msg.getFrom()), snippet,
          looks_yes: mailLooksYes_(snippet), confirm: false, msg_id: id,
        }));
      });
      if (replied && !test){ mailTickPublic_(invSheet, year, player, "responded"); responded.add(pk); }
    } catch (e){ errors.push(`${player}: ${e && e.message || e}`); }
  }
  props.setProperty("SCAN_CURSOR", partial ? String(at) : "0");
  props.setProperty("SCAN_MISSING", JSON.stringify(missing));
  const liveIds = new Set(entries.map(x => String(x.thread_id).trim())); Object.keys(throwsN).forEach(k => { if (!liveIds.has(k)) delete throwsN[k]; });
  props.setProperty("SCAN_THROWS", JSON.stringify(throwsN));
  props.setProperty("SCAN_AUTO", JSON.stringify(autoIds.slice(-250)));

  if (!errors.length && !partial && readme){     // timestamp only - never names (START HERE publication is a TODO above)
    readme.getRange(1, 2).setValue("last_reply_scan");
    readme.getRange(2, 2).setNumberFormat("@").setValue(mailStamp_());
  }
  // Rebuild the private Dashboard even after a failed scan (so STALE can show).
  try { mailDashboard_(admin, props, true); } catch (e){ Logger.log("dashboard rebuild failed: " + (e && e.message || e)); }
  if (errors.length) throw new Error("reply scan incomplete — " + errors.join("; "));
}

function mailMissingLoad_(raw){
  let a; try { a = JSON.parse(raw || "[]"); } catch (e){ a = []; }
  if (!Array.isArray(a)) return [];
  return a.map(x => typeof x === "string" ? { k: "invite", id: "", p: x } : x).filter(x => x && typeof x === "object" && x.p);     // an older run stored bare names
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
function mailOnEdit(e){ mailGuard_(e, "mailOnEdit"); mailOnEditRun_(e); }
function mailOnEditRun_(e){
  if (!e || !e.range || typeof e.range.getSheet !== "function") return;
  const sh = e.range.getSheet();
  if (!sh || sh.getName() !== MAIL_TAB.replies) return;
  const t = mailTable_(sh);
  if (!("confirm" in t.idx)) return;
  const cc = t.idx.confirm + 1;
  const c0 = e.range.getColumn(), c1 = c0 + e.range.getNumColumns() - 1;
  if (cc < c0 || cc > c1) return;
  const r0 = Math.max(2, e.range.getRow()), r1 = e.range.getRow() + e.range.getNumRows() - 1;
  const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAIL_TAB.log);
  const note = (player, text) => { if (logSheet) mailWithLock_(() => mailAppend_(logSheet, { date: mailToday_(), player, what: "note", note: text })); else Logger.log(player + ": " + text); };

  const pid = PropertiesService.getScriptProperties().getProperty("PUBLIC_ID");
  const invSheet = pid ? SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites) : null;
  if (!invSheet){ Logger.log("mailOnEdit: PUBLIC_ID / Invites unavailable - nothing written"); return; }
  const year = mailCurrentYear_(mailTable_(invSheet).rows);

  const test = mailIsTest_(PropertiesService.getScriptProperties());     // test mode never writes the public sheet
  const seen = new Set();
  const tickedBy = new Set(t.rows.filter(r => mailNorm_(r.player) && mailConfirmTicked_(r)).map(r => mailNorm_(r.player)));     // fill-down: ANY row ticked counts
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
  try { mailDashboard_(SpreadsheetApp.getActiveSpreadsheet(), PropertiesService.getScriptProperties(), false, true); } catch (err){ Logger.log("dashboard rebuild failed: " + (err && err.message || err)); }
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
// boolean, nothing else is touched - a cell holding a FORMULA is never overwritten.
// Validation stops at last data row + 50.
function mailCheckboxes_(sh, cols){
  cols.forEach(c => {
    const i = mailHeaderCol_(sh, c); if (!i) return;
    const last = sh.getLastRow();
    if (last >= 2){
      const rng = sh.getRange(2, i, last - 1, 1);
      const vals = rng.getValues(), fx = rng.getFormulas();
      vals.forEach((r, k) => {
        const v = r[0];
        if (typeof v === "string" && /^(true|false)$/i.test(v.trim()) && !String((fx[k] || [""])[0] || "")) sh.getRange(2 + k, i).setValue(/^true$/i.test(v.trim()));
      });
    }
    const end = Math.min(sh.getMaxRows(), last + 50);
    sh.getRange(2, i, Math.max(1, end - 1), 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  });
}

// Our conditional-format rules carry a harmless tag clause so they can be told apart from a user's own rules.
const MAIL_CF_TAG = '"' + MAIL_POLISH_TAG + '"<>""';
function mailIsOurRule_(r){
  try {
    const vals = r.getBooleanCondition().getCriteriaValues() || [];
    return vals.some(v => String(v).indexOf(MAIL_CF_TAG) >= 0);       // the exact tag clause ONLY - never guessed from what a formula does
  } catch (e){ return false; }
}

function mailContactsRules_(sh){
  const n = Math.max(1, sh.getMaxRows() - 1);
  const rules = [];
  const re = '"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"';   // formula text: ^[^@\s]+@[^@\s]+\.[^@\s]+$
  ["email", "email_alt"].forEach(h => {
    const i = mailHeaderCol_(sh, h); if (!i) return;
    const L = mailColLetter_(i);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($${L}2<>"",NOT(REGEXMATCH($${L}2&"",${re})),${MAIL_CF_TAG})`)       // highlight only - never rejects input
      .setBackground("#f4cccc").setRanges([sh.getRange(2, i, n, 1)]).build());
  });
  const p = mailHeaderCol_(sh, "player");
  if (p){
    const P = mailColLetter_(p), M = mailColLetter_(MAIL_DASH_COL0 + MAIL_DASH_LISTS.indexOf("Name mismatches"));
    const esc = `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE($${P}2,"~","~~"),"*","~*"),"?","~?")`;
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($${P}2<>"",COUNTIF(INDIRECT("Dashboard!${M}3:${M}"),${esc})>0,${MAIL_CF_TAG})`)
      .setBackground("#fce5cd").setRanges([sh.getRange(2, p, n, 1)]).build());
  }
  // replace ONLY our own rules (idempotent); the user's rules stay, ours go last
  const keep = (sh.getConditionalFormatRules() || []).filter(r => !mailIsOurRule_(r));
  sh.setConditionalFormatRules(keep.concat(rules));
}

function mailOrderTabs_(admin){
  MAIL_ORDER.forEach((n, i) => { const s = admin.getSheetByName(n); if (s){ admin.setActiveSheet(s); admin.moveActiveSheet(i + 1); } });
  const home = admin.getSheetByName(MAIL_TAB.dash); if (home) admin.setActiveSheet(home);   // end on Dashboard
}

function adminPolish(e){ mailGuard_(e, "adminPolish"); mailAdminPolish_(); }
function mailAdminPolish_(){
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
  mailDashboard_(admin, props, true);
  const dash = admin.getSheetByName(MAIL_TAB.dash);
  mailProtectHeader_(dash);
  dash.setTabColor(MAIL_TAB_COLORS.Dashboard);
  mailOrderTabs_(admin);
  Logger.log("adminPolish complete");
}

// ---- Dashboard (PRIVATE admin tab - names are fine here, never on a published tab) ----

const MAIL_DASH_LISTS = ["Needs nudge", "Bounced", "Unconfirmed looks_yes", "Name mismatches", "Changed answer \u2014 fix by hand", "RSVP from out / DNI", "Pending / unconfirmed sends"];
const MAIL_DASH_COL0 = 4;                               // lists live in D..J (7 lists), headers on row 2, entries from row 3
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

// The rebuild runs under the script lock (it rewrites the whole tab). `refreshDrafts` = read the Gmail drafts to
// re-check the template (slow): only adminPolish / the menu / the scan do; RSVP / onEdit / nudge rebuilds reuse the
// status cached in the TPL_STATUS Script Property. The slow Gmail draft read happens BEFORE the lock is taken.
// `debounce` (RSVP / onEdit rebuilds only): skip when the last rebuild (DASH_AT) is under 60 s old; the scan,
// the menu items and the end of a send/nudge run never debounce.
const MAIL_DASH_DEBOUNCE_MS = 60000;
function mailDashboard_(admin, props, refreshDrafts, debounce){
  if (debounce){
    const age = Date.now() - (Number(props.getProperty("DASH_AT")) || 0);
    if (age >= 0 && age < MAIL_DASH_DEBOUNCE_MS) return;
  }
  const tplStatus = refreshDrafts ? mailTplStatusLive_(props) : null;
  mailWithLock_(() => mailDashboardNL_(admin, props, tplStatus));
  try { props.setProperty("DASH_AT", String(Date.now())); } catch (e){ /* debounce stamp only */ }
}
function mailTplStatusLive_(props){
  try {
    const t = mailLoadDraft_(mailTplPrefix_(props));
    if (t.ok) return `OK \u2014 ${t.subject}`;
    return ({ none: "MISSING \u2014 ", many: "2+ drafts \u2014 ", fill: "has [FILL] spots \u2014 " }[t.kind] || "BLOCKED \u2014 ") + t.msg;
  } catch (e){ return "UNKNOWN \u2014 Gmail unreadable"; }
}
// Caller holds the lock. tplStatus = a freshly read status (string) or null = use the cached TPL_STATUS.
function mailDashboardNL_(admin, props, tplStatus){
  let sh = admin.getSheetByName(MAIL_TAB.dash);
  if (!sh) sh = admin.insertSheet(MAIL_TAB.dash);

  // The nudge interval is the NUDGE_DAYS Script Property (menu: Set nudge days...); this tab only displays it.
  const nudge = mailReadNudgeDays_(props);

  const notes = [];
  const lists = {}; MAIL_DASH_LISTS.forEach(k => { lists[k] = []; });
  let year = "", counts = null;

  const pid = props.getProperty("PUBLIC_ID");
  const invSheet = pid ? SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites) : null;
  const conSheet = admin.getSheetByName(MAIL_TAB.contacts), logSheet = admin.getSheetByName(MAIL_TAB.log), repSheet = admin.getSheetByName(MAIL_TAB.replies);

  if (conSheet) mailTable_(conSheet).rows.forEach(c => { if (mailNorm_(c.player) && /BOUNCED/.test(String(c.notes == null ? "" : c.notes))) lists["Bounced"].push(String(c.player).trim()); });
  if (logSheet) lists["Pending / unconfirmed sends"] = mailUnsettled_(mailTable_(logSheet).rows);
  if (repSheet){
    const seen = new Set(), repRows = mailTable_(repSheet).rows;
    const confirmed = new Set(repRows.filter(r => mailConfirmTicked_(r)).map(r => mailNorm_(r.player)));     // any row ticked = confirmed
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
        if (!k || seenW.has(k) || !mailConfirmTicked_(r)) return;     // any ticked row of the player reaches here
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

  if (tplStatus != null){
    try { props.setProperty("TPL_STATUS", String(tplStatus).slice(0, 600)); } catch (e){ /* cache only */ }
  } else {
    tplStatus = props.getProperty("TPL_STATUS") || "not checked yet \u2014 run Polish admin sheet";
  }
  const missByKind = {};      // per THREAD kind (an invite thread and a nudge thread are different things)
  mailMissingLoad_(props.getProperty("SCAN_MISSING")).forEach(m => { (missByKind[m.k] = missByKind[m.k] || new Set()).add(String(m.p).trim()); });
  ["invite", "nudge"].forEach(k => { if (missByKind[k] && missByKind[k].size) notes.push(`${k} thread missing in Gmail (deleted?) - replies not watched for: ` + Array.from(missByKind[k]).sort().join(", ")); });
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
    [L.nudge, nudge, "set via menu: Set nudge days\u2026"],
    ["", ""],
    [L.scan, stamp],
    [L.status, status],
    ["template draft", tplStatus],
    ...notes.map(n => ["note", n]),
  ];
  const height = Math.max(left.length, 2 + Math.max(...MAIL_DASH_LISTS.map(k => lists[k].length)));
  const grid = [];
  for (let r = 0; r < height; r++){
    const row = new Array(MAIL_DASH_COL0 - 1 + MAIL_DASH_LISTS.length).fill("");
    if (left[r]){ row[0] = left[r][0]; row[1] = left[r][1]; if (left[r][2]) row[2] = left[r][2]; }
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
