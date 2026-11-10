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
const MAIL_TAB = { contacts: "Contacts", log: "SendLog", tpl: "InviteTemplate", replies: "Replies", readme: "READ ME", invites: "Invites" };

const mailNorm_ = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
const mailYes_ = v => v === true || /^(y|yes|true|1|x|✓)$/i.test(String(v == null ? "" : v).trim());

function onOpen(){
  SpreadsheetApp.getUi().createMenu("GFY Mail")
    .addItem("Send invites…", "sendInvites")
    .addItem("Scan replies now", "scanReplies")
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

function mailTemplate_(admin){
  const sh = admin.getSheetByName(MAIL_TAB.tpl);
  const out = { subject: "", body: "" };
  if (!sh) return out;
  sh.getDataRange().getValues().forEach(r => {
    const k = mailNorm_(r[0]);
    if (k === "subject" || k === "body") out[k] = String(r[1] == null ? "" : r[1]);
  });
  return out;
}

function mailBuild_(tpl, player, address, test){
  const first = String(player).trim().split(/\s+/)[0];
  const fill = s => s.replace(/\{first\}/g, first);
  const subject = fill(tpl.subject);
  return test
    ? { to: MAIL_TEST_ADDR, subject: `[TEST → ${address}] ${subject}`, body: fill(tpl.body) }
    : { to: address, subject, body: fill(tpl.body) };
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

  const tpl = mailTemplate_(admin);
  if (!tpl.subject.trim() || !tpl.body.trim()){ say("GFY Mail", "The InviteTemplate tab needs a subject and a body. Nothing sent."); return; }

  const quota = MailApp.getRemainingDailyQuota();
  if (quota < plan.recipients.length){ say("GFY Mail", `Daily send quota too low: ${quota} left, ${plan.recipients.length} needed. Nothing sent.`); return; }

  const test = mailIsTest_(props);
  const list = plan.recipients.map(r => `${r.player} → ${r.address}`).join("\n");
  const msg = (test ? `TEST MODE: every message goes to ${MAIL_TEST_ADDR}; nothing is ticked on the public sheet.\n\n` : "LIVE: these people will be emailed for real.\n\n")
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
      threadId = GmailApp.createDraft(m.to, m.subject, m.body).send().getThread().getId();
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
  const have = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "scanReplies");
  if (!have) ScriptApp.newTrigger("scanReplies").timeBased().everyMinutes(15).create();
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

  if (errors.length) throw new Error("reply scan incomplete — " + errors.join("; "));
  if (readme){                       // timestamp only — never names (START HERE publication is a TODO above)
    readme.getRange(1, 2).setValue("last_reply_scan");
    readme.getRange(2, 2).setValue(mailStamp_());
  }
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
