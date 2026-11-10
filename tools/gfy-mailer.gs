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
  "RSVP": ["year", "player", "token", "answer", "answered_at", "history"],
  "READ ME": ["warning", "last_reply_scan"],
};
const MAIL_ORDER = ["Dashboard", "Contacts", "Replies", "RSVP", "SendLog", "READ ME"];
const MAIL_TAB_COLORS = { "Dashboard": "#1155cc", "Contacts": "#6aa84f", "Replies": "#f1c232", "SendLog": "#999999", "RSVP": "#e69138", "READ ME": "#cc0000" };
const MAIL_CHECKBOX = { "Contacts": ["do_not_invite"], "Replies": ["looks_yes", "confirm"] };   // CLOSED list
const MAIL_POLISH_TAG = "gfy-admin-polish";
const MAIL_NUDGE_DEFAULT = 7;
const MAIL_STALE_MS = 60 * 60 * 1000;

const mailNorm_ = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
const mailYes_ = v => v === true || /^(y|yes|true|1|x|✓)$/i.test(String(v == null ? "" : v).trim());

function onOpen(){
  SpreadsheetApp.getUi().createMenu("GFY Mail")
    .addItem("Send invites…", "sendInvites")
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

function mailAppend_(sheet, obj){
  const t = mailTable_(sheet);
  const row = new Array(t.heads.length).fill("");
  Object.keys(obj).forEach(k => { if (k in t.idx) row[t.idx[k]] = obj[k]; });
  sheet.appendRow(row);
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
  return mailWithLock_(() => {
    const t = mailTable_(invSheet);
    if (!(col in t.idx)) return false;
    const row = t.rows.find(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player) === mailNorm_(player));
    if (!row || mailYes_(row[col])) return false;
    mailPublicWrite_(invSheet, row._row, t.idx[col] + 1, true);
    return true;
  });
}

// ---- A: planning (pure) ---------------------------------------------------

/** contacts / invites: arrays of lowercase-keyed row objects. Mirrors
 *  tools/presend-check.mjs diffVault: DNI violation, unpaired DNI, missing from vault. */
function mailPlan_(contacts, invites){
  const year = mailCurrentYear_(invites);
  const cur = invites.filter(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player));
  const byName = new Map(cur.map(r => [mailNorm_(r.player), r]));
  const vault = new Map(contacts.filter(c => mailNorm_(c.player)).map(c => [mailNorm_(c.player), c]));
  const dni = contacts.filter(c => mailNorm_(c.player) && mailYes_(c.do_not_invite));
  const isOut = r => /^(out|declined)$/i.test(String(r.status == null ? "" : r.status).trim());
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

  const recipients = [], noAddress = [];
  cur.forEach(r => {
    if (mailYes_(r.invited) || isOut(r)) return;
    const c = vault.get(mailNorm_(r.player));
    if (!c || mailYes_(c.do_not_invite)) return;
    const addr = String(c.email || "").trim() || String(c.email_alt || "").trim();
    if (!addr){ noAddress.push(String(r.player).trim()); return; }
    recipients.push({ player: String(r.player).trim(), address: addr });
  });
  return { year, blocks, recipients, noAddress };
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

  const plan = mailPlan_(mailTable_(conSheet).rows, mailTable_(invSheet).rows);
  if (plan.blocks.length){
    say("Send BLOCKED — fix these first (nothing was sent)", plan.blocks.join("\n"));
    return;
  }
  if (!plan.recipients.length){ say("GFY Mail", `Nobody to invite for ${plan.year}.` + (plan.noAddress.length ? `\nNo address on file: ${plan.noAddress.join(", ")}` : "")); return; }

  let tpl;
  try { tpl = mailLoadDraft_(MAIL_TPL_PREFIX); } catch (e){ say("GFY Mail", "Could not read Gmail drafts (" + (e && e.message || e) + "). Nothing sent."); return; }
  if (!tpl.ok){ say("Send BLOCKED - template draft (nothing was sent)", tpl.msg); return; }

  const quota = MailApp.getRemainingDailyQuota();
  if (quota < plan.recipients.length){ say("GFY Mail", `Daily send quota too low: ${quota} left, ${plan.recipients.length} needed. Nothing sent.`); return; }

  const test = mailIsTest_(props);
  const list = plan.recipients.map(r => `${r.player} → ${r.address}`).join("\n");
  const msg = (test ? `TEST MODE: every message goes to ${MAIL_TEST_ADDR}; nothing is ticked on the public sheet.\n\n` : "LIVE: these people will be emailed for real.\n\n")
    + `Subject of the first email: ${mailBuild_(tpl, plan.recipients[0].player, plan.recipients[0].address, test).subject}\n\n`
    + `Send ${plan.recipients.length} ${plan.year} invite(s)?\n\n${list}`
    + (plan.noAddress.length ? `\n\nSkipped (no address): ${plan.noAddress.join(", ")}` : "");
  if (ui.alert("Send invites", msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  mailEnsureHeader_(logSheet, "thread_id");
  const failed = [], tickFailed = [];
  let sent = 0;
  plan.recipients.forEach(r => {
    const m = mailBuild_(tpl, r.player, r.address, test);
    let threadId;
    try {
      threadId = GmailApp.createDraft(m.to, m.subject, m.body, mailSendOpts_(m)).send().getThread().getId();
    } catch (e){ failed.push(`${r.player} (${e && e.message || e})`); return; }
    sent++;
    // Log BEFORE ticking: a crash after the send must never lead to a second email.
    mailAppend_(logSheet, {
      date: mailToday_(), player: r.player, address_used: m.to,
      what: test ? "invite-test" : "invite",
      note: test ? `TEST MODE (real address ${r.address})` : "", thread_id: threadId,
    });
    if (!test){
      try { mailTickPublic_(invSheet, plan.year, r.player, "invited"); }
      catch (e){ tickFailed.push(r.player); }
    }
  });
  say("GFY Mail", `${test ? "TEST " : ""}Sent ${sent} of ${plan.recipients.length}.`
    + (failed.length ? `\n\nSEND FAILED (not logged, not ticked — safe to re-run): ${failed.join("; ")}` : "")
    + (tickFailed.length ? `\n\nSent and logged, but could NOT tick invited on the public sheet — tick by hand: ${tickFailed.join(", ")}` : ""));
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

function scanReplies(){
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
  const seen = new Set(mailTable_(repSheet).rows.map(r => String(r.msg_id)));
  const errors = [];

  mailTable_(logSheet).rows.filter(r => mailNorm_(r.what) === "invite" && String(r.thread_id || "").trim()).forEach(entry => {
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
      if (replied) mailTickPublic_(invSheet, year, player, "responded");
    } catch (e){ errors.push(`${player}: ${e && e.message || e}`); }
  });

  if (!errors.length && readme){     // timestamp only — never names (START HERE publication is a TODO above)
    readme.getRange(1, 2).setValue("last_reply_scan");
    readme.getRange(2, 2).setValue(mailStamp_());
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
 *  mailPublicWrite_, under the lock). UNticking never unticks committed - it
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

  const seen = new Set();
  t.rows.filter(r => r._row >= r0 && r._row <= r1 && mailNorm_(r.player)).forEach(r => {
    const key = mailNorm_(r.player);
    if (seen.has(key)) return; seen.add(key);
    const ticked = r.confirm === true || /^true$/i.test(String(r.confirm == null ? "" : r.confirm).trim());
    const player = String(r.player).trim();
    if (ticked){
      try { mailTickPublic_(invSheet, year, player, "committed"); }
      catch (err){ note(player, "confirm ticked but could NOT tick committed on the public sheet - tick by hand (" + (err && err.message || err) + ")"); }
    } else {
      const pt = mailTable_(invSheet);
      const row = pt.rows.find(x => (parseInt(x.year, 10) || 0) === year && mailNorm_(x.player) === key);
      if (row && "committed" in pt.idx && mailYes_(row.committed)) note(player, "confirm unticked - committed left ticked on the public sheet (untick it there by hand if wanted)");
    }
  });
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

const MAIL_DASH_LISTS = ["Needs nudge", "Bounced", "Unconfirmed looks_yes", "Name mismatches"];
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
  let nudge = MAIL_NUDGE_DEFAULT;
  if (sh.getLastRow() >= 1){
    const old = sh.getDataRange().getValues().find(r => mailNorm_(r[0]) === MAIL_DASH_LABELS.nudge);
    const n = old ? parseInt(old[1], 10) : NaN;
    if (n > 0) nudge = n;
  }

  const notes = [];
  const lists = { "Needs nudge": [], "Bounced": [], "Unconfirmed looks_yes": [], "Name mismatches": [] };
  let year = "", counts = null;

  const pid = props.getProperty("PUBLIC_ID");
  const invSheet = pid ? SpreadsheetApp.openById(pid).getSheetByName(MAIL_TAB.invites) : null;
  const conSheet = admin.getSheetByName(MAIL_TAB.contacts), logSheet = admin.getSheetByName(MAIL_TAB.log), repSheet = admin.getSheetByName(MAIL_TAB.replies);

  if (conSheet) mailTable_(conSheet).rows.forEach(c => { if (mailNorm_(c.player) && /BOUNCED/.test(String(c.notes == null ? "" : c.notes))) lists["Bounced"].push(String(c.player).trim()); });
  if (repSheet){
    const seen = new Set();
    mailTable_(repSheet).rows.forEach(r => {
      const k = mailNorm_(r.player);
      if (k && mailYes_(r.looks_yes) && !mailYes_(r.confirm) && !seen.has(k)){ seen.add(k); lists["Unconfirmed looks_yes"].push(String(r.player).trim()); }
    });
  }

  if (!invSheet){
    notes.push(pid ? "Public Invites tab not found - counts and name checks unavailable." : "PUBLIC_ID script property not set - counts and name checks unavailable.");
  } else {
    const inv = mailTable_(invSheet).rows;
    year = mailCurrentYear_(inv);
    const cur = inv.filter(r => (parseInt(r.year, 10) || 0) === year && mailNorm_(r.player));
    const isOut = r => /^(out|declined)$/i.test(String(r.status == null ? "" : r.status).trim());
    counts = {
      invited: cur.filter(r => mailYes_(r.invited)).length,
      responded: cur.filter(r => mailYes_(r.responded)).length,
      committed: cur.filter(r => mailYes_(r.committed)).length,
      out: cur.filter(isOut).length,
    };
    // last REAL invite send per player (test-mode rows are not invites)
    const lastSent = new Map();
    if (logSheet) mailTable_(logSheet).rows.filter(r => mailNorm_(r.what) === "invite").forEach(r => {
      const d = mailDateOf_(r.date); if (!d) return;
      const k = mailNorm_(r.player);
      if (!lastSent.has(k) || d > lastSent.get(k)) lastSent.set(k, d);
    });
    const today = mailDateOf_(mailToday_());
    cur.forEach(r => {
      if (!mailYes_(r.invited) || mailYes_(r.responded) || mailYes_(r.committed) || isOut(r)) return;
      const d = lastSent.get(mailNorm_(r.player)); if (!d) return;
      if (Math.round((today - d) / 864e5) >= nudge) lists["Needs nudge"].push(String(r.player).trim());
    });
    const names = new Set(cur.map(r => mailNorm_(r.player)));
    if (conSheet) mailTable_(conSheet).rows.forEach(c => { if (mailNorm_(c.player) && !names.has(mailNorm_(c.player))) lists["Name mismatches"].push(String(c.player)); });
  }

  // last scan health
  const readme = admin.getSheetByName(MAIL_TAB.readme);
  const stamp = readme ? String(readme.getRange(2, 2).getValue() == null ? "" : readme.getRange(2, 2).getValue()).trim() : "";
  let status = "STALE - never scanned";
  if (stamp){
    let t = null;
    try { t = Utilities.parseDate(stamp, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"); } catch (e){ t = null; }
    status = (!t || isNaN(t.getTime())) ? "STALE - unreadable scan time" : (Date.now() - t.getTime() > MAIL_STALE_MS ? "STALE - over 1 h old" : "ok");
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
  sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  sh.getRange(1, 1).setFontWeight("bold");
  sh.getRange(2, MAIL_DASH_COL0, 1, MAIL_DASH_LISTS.length).setFontWeight("bold");
}
