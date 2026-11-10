// Offline behavioural tests for tools/gfy-mailer.gs (BACKLOG #33 parts A+C).
// Every Google service is a fake; nothing here touches the network or sends mail.
// Run:  npm run check-mailer
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(ROOT, "tools", "gfy-mailer.gs"), "utf8");
const TEST_ADDR = "goodfriendsyearly@gmail.com";

let pass = 0, total = 0;
function check(name, ok, detail = "") {
  total++; if (ok) pass++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : "   [" + String(detail).slice(0, 400) + "]"));
}

// ---------- fakes ----------
function mkSheet(name, rows, log, ss) {
  const sh = { name, rows: rows.map(r => r.slice()), writes: [], log, frozen: 0, tabColor: null, protections: [], validations: {}, rules: [], notes: {}, maxRows: 1000, wraps: {}, backgrounds: {}, fmt: {}, formulas: {} };
  // Real Sheets coerces typed strings: a date-like string becomes a Date, a digit string a Number,
  // unless the cell was formatted as plain text ("@") BEFORE the write. The fake does the same.
  const coerce = (v, r, c) => {
    if (typeof v !== "string" || sh.fmt[r + "," + c] === "@") return v;
    if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v)) return new Date(v.length === 10 ? v + "T00:00:00Z" : v.replace(" ", "T") + (v.length === 16 ? ":00Z" : "Z"));
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  const ensure = (r, c) => { while (sh.rows.length < r) sh.rows.push([]); const row = sh.rows[r - 1]; while (row.length < c) row.push(""); };
  const logW = (r, c, v, op) => { sh.writes.push({ r, c, v, op }); log.push({ ev: "write", sheet: name, r, c, v, op, locked: log.isLocked ? log.isLocked() : null }); delete sh.formulas[r + "," + c]; };
  sh.getName = () => name;
  sh.getSheetId = () => 1;
  sh.getDataRange = () => ({ getValues: () => { const w = Math.max(0, ...sh.rows.map(r => r.length)); return sh.rows.map(r => { const o = r.slice(); while (o.length < w) o.push(""); return o; }); } });
  sh.getLastRow = () => sh.rows.length;
  sh.getLastColumn = () => Math.max(0, ...sh.rows.map(r => r.length));
  sh.getMaxRows = () => Math.max(sh.maxRows, sh.rows.length);
  sh.getMaxColumns = () => Math.max(26, sh.getLastColumn());
  sh.setFrozenRows = n => { sh.frozen = n; };
  sh.getFrozenRows = () => sh.frozen;
  sh.setTabColor = c => { sh.tabColor = c; return sh; };
  sh.getTabColor = () => sh.tabColor;
  sh.setColumnWidth = () => sh;
  sh.setConditionalFormatRules = r => { sh.rules = r; };
  sh.getConditionalFormatRules = () => sh.rules;
  sh.clearContents = () => { sh.rows = []; return sh; };
  sh.clear = () => { sh.rows = []; return sh; };
  sh.getProtections = () => sh.protections;
  sh.getRange = (r, c, nr = 1, nc = 1) => {
    if (typeof r === "string") return { protect: () => { const p = { desc: "", warn: false, getDescription: () => p.desc, setDescription: d => { p.desc = d; return p; }, setWarningOnly: w => { p.warn = w; return p; } }; sh.protections.push(p); return p; } };
    const key = `${r},${c},${nr},${nc}`;
    const rng = {
      getSheet: () => sh, getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
      getValue: () => (sh.rows[r - 1] || [])[c - 1] ?? "",
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((sh.rows[r - 1 + i] || [])[c - 1 + j] ?? ""); out.push(row); } return out; },
      setValue: v => { logW(r, c, v, "setValue"); ensure(r, c); sh.rows[r - 1][c - 1] = coerce(v, r, c); },
      setValues: vs => { vs.forEach((row, i) => row.forEach((v, j) => { logW(r + i, c + j, v, "setValues"); ensure(r + i, c + j); sh.rows[r - 1 + i][c - 1 + j] = coerce(v, r + i, c + j); })); },
      setNumberFormat: f => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.fmt[(r + i) + "," + (c + j)] = f; return rng; },
      getFormulas: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(sh.formulas[(r + i) + "," + (c + j)] || ""); out.push(row); } return out; },
      setDataValidation: dv => { sh.validations[key] = { r, c, nr, nc, kind: dv && dv.kind }; },
      clearDataValidations: () => { Object.keys(sh.validations).forEach(k => { const v = sh.validations[k]; if (v.c === c && v.r >= r && v.r < r + nr) delete sh.validations[k]; }); },
      setBackground: b => { sh.backgrounds[key] = b; },
      setNote: n => { sh.notes[key] = n; },
      setWrap: w => { sh.wraps[key] = w; },
      setFontWeight: () => {}, setFontSize: () => {},
    };
    return rng;
  };
  sh.appendRow = vals => { sh.writes.push({ op: "appendRow", v: vals }); log.push({ ev: "append", sheet: name, v: vals }); const rn = sh.rows.length + 1; sh.rows.push(vals.map((v, j) => coerce(v, rn, j + 1))); };
  return sh;
}
function mkSS(id, sheets, log) {
  const ss = { id, sheets, active: null };
  ss.getId = () => id; ss.getSheetByName = n => ss.sheets.find(s => s.name === n) || null; ss.getSheets = () => ss.sheets;
  ss.insertSheet = n => { const s = mkSheet(n, [], log || [], ss); ss.sheets.push(s); return s; };
  ss.setActiveSheet = s => { ss.active = s; };
  ss.getActiveSheet = () => ss.active;
  ss.moveActiveSheet = i => { ss.sheets = ss.sheets.filter(s => s !== ss.active); ss.sheets.splice(i - 1, 0, ss.active); };
  return ss;
}
const mkRuleB = () => { const o = { f: null, bg: null, ranges: [], getBooleanCondition: () => ({ getCriteriaValues: () => [o.f] }) }; const b = { whenFormulaSatisfied: f => { o.f = f; return b; }, setBackground: c => { o.bg = c; return b; }, setRanges: r => { o.ranges = r; return b; }, build: () => o }; return b; };
const mkDVB = () => { const o = { kind: null }; const b = { requireCheckbox: () => { o.kind = "checkbox"; return b; }, build: () => o }; return b; };

const PUB = "PUBLIC_SHEET_ID_FAKE";
const HDR_INV = ["year", "player", "invited", "responded", "status", "committed", "invited_by"];
const HDR_CON = ["player", "email", "email_alt", "phone", "do_not_invite", "reason", "notes"];
const HDR_LOG = ["date", "player", "address_used", "what", "note", "thread_id"];
const HDR_REP = ["date", "player", "from", "snippet", "looks_yes", "confirm", "msg_id"];
const HDR_RSVP = ["year", "player", "token", "answer", "answered_at", "history", "test"];
const TPL_DRAFT = { subject: "[GFY TEMPLATE] Good Friends Yearly 2027, {first}?", html: "<p>Hi {first},</p><p>You in for 2027?</p>", plain: "Hi {first},\n\nYou in for 2027?\n\n- R" };
const NUDGE_DRAFT = { subject: "[GFY NUDGE] Still in, {first}?", html: "<p>{first}, nudge: <a href=\"{rsvp}\">answer here</a></p>", plain: "{first}, nudge: {rsvp}" };

function world(o = {}) {
  const log = [];
  const contacts = o.contacts || [
    ["Alice Able", "alice@example.com", "", "", "FALSE", "", ""],
    ["Bob Baker", "bob@example.com", "bob.alt@example.com", "", "FALSE", "", ""],
    ["Cy Dnì", "cy@example.com", "", "", "TRUE", "because", ""],
  ];
  const invites = o.invites || [
    [2026, "Old Timer", true, true, "", false, ""],
    [2027, "Alice Able", false, false, "", false, ""],
    [2027, "Bob Baker", false, false, "", false, ""],
    [2027, "Cy Dnì", false, false, "out", false, ""],
  ];
  const adminSheets = [
    mkSheet("Contacts", [HDR_CON, ...contacts], log),
    mkSheet("SendLog", [HDR_LOG, ...(o.sendlog || [])], log),
    mkSheet("RSVP", [HDR_RSVP, ...(o.rsvp || [])], log),
    mkSheet("Replies", [HDR_REP, ...(o.replies || [])], log),
    mkSheet("READ ME", [["warning", "last_reply_scan"], ["be careful", ""]], log),
  ];
  const admin = mkSS("ADMIN_ID", o.adminSheets ? o.adminSheets(log) : adminSheets, log);
  const pub = mkSS(PUB, [mkSheet("Invites", [HDR_INV, ...invites], log)], log);
  const props = { ...(o.props || {}) }; if (!("PUBLIC_ID" in props) && !o.noPublicId) props.PUBLIC_ID = PUB;
  const prompts = [];
  const alerts = []; const answers = o.answers || ["YES"];
  const opened = [];
  const menus = [];
  const ui = {
    alert: (title, msg, btns) => { alerts.push({ title, msg, btns }); return btns === "YES_NO" ? (answers.shift() ?? "NO") : "OK"; },
    createMenu: t => { const m = { title: t, items: [] }; const b = { addItem: (l, f) => { m.items.push([l, f]); return b; }, addSeparator: () => b, addToUi: () => { menus.push(m); } }; return b; },
    prompt: (title, msg) => { prompts.push({ title, msg }); const txt = (o.promptAnswers || []).shift(); return { getSelectedButton: () => (txt === undefined ? "CANCEL" : "OK"), getResponseText: () => String(txt) }; },
    Button: { YES: "YES", NO: "NO", OK: "OK", CANCEL: "CANCEL" }, ButtonSet: { YES_NO: "YES_NO", OK: "OK", OK_CANCEL: "OK_CANCEL" },
  };
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => admin, getActive: () => admin,
    getUi: () => { if (o.noUi || flags.noUi) throw new Error("Cannot call SpreadsheetApp.getUi() from this context."); return ui; },
    newConditionalFormatRule: mkRuleB, newDataValidation: mkDVB, ProtectionType: { RANGE: "RANGE" },
    openById: id => { opened.push(id); if (id === PUB) return pub; throw new Error("unknown id " + id); },
  };
  // Gmail
  const sent = []; const threads = {}; let tn = 0;
  const hooks = {};
  const flags = {};
  const counters = { raw: 0, fetched: [], drafts: 0 };
  const pendingDrafts = new Set();
  const mkMsg = m => ({ getId: () => m.id, getFrom: () => m.from, getSubject: () => m.subject, getDate: () => new Date(m.date || "2027-01-05T12:00:00Z"), getPlainBody: () => m.body || "", getTo: () => m.to || "", getRawContent: () => { counters.raw++; return (m.raw || "") + "\r\n\r\n" + (m.body || ""); } });
  const draftOps = [];
  const mkDraft = d => {
    const msg = { getSubject: () => d.subject, getBody: () => d.html, getPlainBody: () => d.plain, getAttachments: opt => {
      const inc = !opt || opt.includeInlineImages !== false;
      return [...(d.attachments || []), ...(inc ? (d.inline || []) : [])]; } };
    return { getId: () => "d" + d.subject, getMessage: () => msg,
      send: () => { draftOps.push("send"); throw new Error("template draft must never be sent"); },
      update: () => { draftOps.push("update"); throw new Error("template draft must never be updated"); },
      deleteDraft: () => { draftOps.push("delete"); throw new Error("template draft must never be deleted"); } };
  };
  const drafts = (o.drafts || [TPL_DRAFT]).map(mkDraft);
  const threadReplies = [];
  const GmailApp = {
    getDrafts: () => { counters.drafts++; if (o.draftsError) throw new Error("gmail down"); return drafts; },
    createDraft: (to, subject, body, opts) => { const dk = {}; pendingDrafts.add(dk); return {
      deleteDraft: () => { pendingDrafts.delete(dk); },
      send: () => {
      if (lockState.held) lockState.sendsWhileHeld++;
      if (hooks.beforeSend) hooks.beforeSend(to);
      if (o.failTo && o.failTo === to) throw new Error("smtp boom");
      pendingDrafts.delete(dk);
      const id = (o.numericIds ? "0189300" : "thr") + (++tn); const t = { id, to, msgs: [{ id: id + "m0", from: "Riley <me@gmail.com>", to, subject, body, date: "2027-01-05T10:00:00Z" }] };
      threads[id] = t; sent.push({ to, subject, body, html: opts && opts.htmlBody, attachments: opts && opts.attachments, threadId: id }); log.push({ ev: "send", to });
      if (hooks.afterSend) hooks.afterSend(sent.length);
      return { getThread: () => ({ getId: () => id }) };
    } }; },
    getThreadById: id => { counters.fetched.push(id); if (o.threadError && o.threadError === id) throw new Error("gmail down"); const t = threads[id]; if (!t) return null;
      // Gmail addresses a reply to the LAST message's sender (or, for our own message, its recipients).
      const rep = all => (body, opts) => { if (o.replyFails && o.replyFails === id) throw new Error("reply boom"); const last = t.msgs[t.msgs.length - 1]; const toWho = /me@gmail\.com/.test(last.from) ? last.to : last.from;
        threadReplies.push({ id, body, html: opts && opts.htmlBody, attachments: opts && opts.attachments, subject: opts && opts.subject, all, to: toWho }); if (hooks.afterReply) hooks.afterReply(threadReplies.length); t.msgs.push({ id: id + "m" + t.msgs.length, from: "Riley <me@gmail.com>", to: toWho, subject: "Re: x", body }); log.push({ ev: "send", to: "(thread " + id + ")" }); };
      return { getId: () => id, getFirstMessageSubject: () => t.msgs[0].subject, getMessages: () => t.msgs.map(mkMsg), reply: rep(false), replyAll: rep(true) }; },
  };
  // The script lock is NOT reentrant: a second wait inside a held lock times out, like production.
  const lockState = { held: false, sendsWhileHeld: 0 };
  log.isLocked = () => lockState.held;
  const LockService = { getScriptLock: () => ({
    waitLock: () => { if (lockState.held) throw new Error("Lock timeout: another process was holding the lock for too long."); lockState.held = true; log.push({ ev: "lock" }); },
    tryLock: () => { if (lockState.held) return false; lockState.held = true; log.push({ ev: "lock" }); return true; },
    releaseLock: () => { lockState.held = false; log.push({ ev: "unlock" }); } }) };
  const triggers = [];
  const ScriptApp = {
    getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t.fn, getUniqueId: () => t.uid || t.fn })),
    newTrigger: fn => { const t = { fn, every: null, onEdit: false, uid: "uid-" + fn }; const b = { timeBased: () => b, everyMinutes: n => { t.every = n; return b; }, forSpreadsheet: x => { t.ss = x; return b; }, onEdit: () => { t.onEdit = true; return b; }, create: () => { triggers.push(t); return t; } }; return b; },
    deleteTrigger: () => {},
  };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) };
  const mails = [];
  const MailApp = { getRemainingDailyQuota: () => (o.quota ?? 100), sendEmail: (to, subj, body) => { mails.push({ to, subj, body }); } };
  const Session = { getEffectiveUser: () => ({ getEmail: () => "me@gmail.com" }), getScriptTimeZone: () => "UTC" };
  let uuidN = 0;
  const Utilities = { getUuid: () => "00000000-0000-4000-8000-" + String(++uuidN).padStart(12, "0"), formatDate: (d, tz, f) => f === "yyyy-MM-dd" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16).replace("T", " "), parseDate: (str, tz, f) => {
    // production throws on a non-string (e.g. a Date a cell was coerced to) and on any text not matching the format
    if (typeof str !== "string") throw new Error("Exception: The parameters (" + typeof str + ") don't match the method signature for Utilities.parseDate.");
    if (!(f === "yyyy-MM-dd" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).test(str)) throw new Error("Exception: Cannot parse \"" + str + "\" with " + f);
    return new Date(str.replace(" ", "T") + (f === "yyyy-MM-dd" ? "T00:00:00Z" : ":00Z")); } };
  const Logger = { log() {} };
  const htmlPages = [];
  const HtmlService = { createHtmlOutput: h => { const out = { html: h, title: "", getContent: () => h, setTitle: t => { out.title = t; return out; }, addMetaTag: () => out, setXFrameOptionsMode: () => out }; htmlPages.push(out); return out; }, XFrameOptionsMode: { ALLOWALL: "ALLOWALL" } };
  const env = { SpreadsheetApp, GmailApp, MailApp, PropertiesService, LockService, ScriptApp, Session, Utilities, Logger, HtmlService };
  const names = ["onOpen", "sendInvites", "scanReplies", "installMailTriggers", "mailPublicWrite_", "adminPolish", "mailOnEdit", "mailDashboard_", "MAIL_SCHEMA", "sendNudges", "doGet", "recordRsvp", "mailAppend_", "mailWithLock_", "setNudgeDays", "clearRehearsalAnswers"];
  let M;
  try { M = new Function(...Object.keys(env), SRC + "\nreturn {" + names.map(n => `${n}: typeof ${n}!=='undefined'?${n}:undefined`).join(",") + "};")(...Object.values(env)); }
  catch (e) { M = { _err: String(e) }; }
  const sheet = n => admin.getSheetByName(n);
  const invSheet = pub.getSheetByName("Invites");
  const addIncoming = (threadId, m) => { threads[threadId].msgs.push({ id: threadId + "m" + threads[threadId].msgs.length, ...m }); };
  return { M, log, admin, pub, sheet, invSheet, sent, alerts, opened, menus, triggers, threads, addIncoming, props, draftOps, threadReplies, mails, htmlPages, hooks, lockState, pendingDrafts, flags, counters, prompts };
}
const run = (w, fn) => { try { return { ok: true, v: w.M[fn]() }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } };
const pubWrites = w => w.log.filter(e => e.ev !== "lock" && e.ev !== "unlock" && e.ev !== "send" && e.sheet === "Invites");
const allPublicWrites = []; // aggregated for the leak test
const noteWrites = w => { pubWrites(w).forEach(e => allPublicWrites.push(e)); };

// ---------- A: menu + config ----------
{
  const w = world();
  const r = run(w, "onOpen");
  const m = w.menus.find(m => m.title === "GFY Mail");
  check("MA1: onOpen adds a 'GFY Mail' menu with 'Send invites…' -> sendInvites", r.ok && !!m && m.items.some(([l, f]) => l === "Send invites…" && f === "sendInvites"), r.e || JSON.stringify(w.menus));
}
{
  const w = world({ noPublicId: true });
  const r = run(w, "sendInvites");
  check("MA2: no PUBLIC_ID script property -> alert, public sheet never opened, nothing sent; and the source hardcodes no sheet id",
    r.ok && w.sent.length === 0 && w.opened.length === 0 && w.alerts.some(a => /PUBLIC_ID/.test(a.msg)) && !/["'][A-Za-z0-9_-]{30,}["']/.test(SRC.replace(/\/\/[^\n]*/g, "")), r.e || JSON.stringify(w.alerts));
}

// ---------- A: recipient selection ----------
{
  const w = world({
    props: { GFY_MAIL_TEST: "0" },
    contacts: [
      ["Alice Able", "alice@example.com", "", "", "FALSE", "", ""],
      ["Bob Baker", "", "bob.alt@example.com", "", "FALSE", "", ""],        // falls back to email_alt
      ["Carl Done", "carl@example.com", "", "", "FALSE", "", ""],            // already invited
      ["Dee Out", "dee@example.com", "", "", "FALSE", "", ""],               // status out
      ["Eve Nomail", "", "", "", "FALSE", "", ""],                           // no address
      ["Fay Declined", "fay@example.com", "", "", "FALSE", "", ""],
      ["Old Timer", "old@example.com", "", "", "FALSE", "", ""],             // prior-season row only
    ],
    invites: [
      [2026, "Old Timer", false, false, "", false, ""],
      [2027, "  alice   able ", false, false, "", false, ""],                 // name match is trim/space/case-insensitive
      [2027, "Bob Baker", false, false, "maybe", false, ""],
      [2027, "Carl Done", true, false, "", false, ""],
      [2027, "Dee Out", false, false, "out", false, ""],
      [2027, "Eve Nomail", false, false, "", false, ""],
      [2027, "Fay Declined", false, false, "Declined", false, ""],
    ],
  });
  const r = run(w, "sendInvites");
  const tos = w.sent.map(s => s.to).sort();
  check("MA3: recipients = current-season rows not yet invited, status not out/declined, not DNI, with an address (email, else email_alt); prior-season/no-address/invited/out people are skipped",
    r.ok && JSON.stringify(tos) === JSON.stringify(["alice@example.com", "bob.alt@example.com"]), r.e || JSON.stringify(tos));
  noteWrites(w);
}

// ---------- A: blocks ----------
{
  const base = { props: { GFY_MAIL_TEST: "0" } };
  const cases = {
    "DNI name with an active invite row": { contacts: [["Alice Able", "a@example.com", "", "", "FALSE", "", ""], ["Cy Dni", "c@example.com", "", "", "TRUE", "r", ""]], invites: [[2027, "Alice Able", false, false, "", false, ""], [2027, "Cy Dni", false, false, "", false, ""]], re: /Cy Dni/ },
    "DNI name already invited/responded even with status out": { contacts: [["Alice Able", "a@example.com", "", "", "FALSE", "", ""], ["Cy Dni", "c@example.com", "", "", "TRUE", "r", ""]], invites: [[2027, "Alice Able", false, false, "", false, ""], [2027, "Cy Dni", true, false, "out", false, ""]], re: /Cy Dni/ },
    "unpaired DNI (no current-season Invites row)": { contacts: [["Alice Able", "a@example.com", "", "", "FALSE", "", ""], ["Cy Dni", "c@example.com", "", "", "TRUE", "r", ""]], invites: [[2027, "Alice Able", false, false, "", false, ""]], re: /Cy Dni/ },
    "invitee missing from the vault": { contacts: [["Alice Able", "a@example.com", "", "", "FALSE", "", ""]], invites: [[2027, "Alice Able", false, false, "", false, ""], [2027, "Ghost Guy", false, false, "", false, ""]], re: /Ghost Guy/ },
  };
  for (const [label, c] of Object.entries(cases)) {
    const w = world({ ...base, contacts: c.contacts, invites: c.invites });
    const r = run(w, "sendInvites");
    const noWrites = w.log.filter(e => e.ev === "write" || e.ev === "append").length === 0;
    check(`MA4: BLOCKS the whole send on ${label} - nothing sent, nothing written, no confirm offered, alert names them`,
      r.ok && w.sent.length === 0 && noWrites && !w.alerts.some(a => a.btns === "YES_NO") && w.alerts.some(a => c.re.test(a.msg)), r.e || JSON.stringify(w.alerts));
  }
}

// ---------- A: confirm / cancel ----------
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, answers: ["NO"] });
  const r = run(w, "sendInvites");
  const conf = w.alerts.find(a => a.btns === "YES_NO");
  check("MA5a: confirm dialog lists 'name -> address' for each recipient; cancel = nothing sent, nothing written",
    r.ok && !!conf && /Alice Able/.test(conf.msg) && /alice@example\.com/.test(conf.msg) && /Bob Baker/.test(conf.msg) && /bob@example\.com/.test(conf.msg)
    && w.sent.length === 0 && w.log.filter(e => e.ev === "write" || e.ev === "append").length === 0, r.e || JSON.stringify(w.alerts));
}

// ---------- A: live send ----------
{
  const w = world({ props: { GFY_MAIL_TEST: "0" } });
  const r = run(w, "sendInvites");
  const log = w.sheet("SendLog").rows.slice(1);
  const a = w.sent.find(s => s.to === "alice@example.com");
  const inv = w.invSheet.rows;
  const aliceRow = inv.find(x => x[1] === "Alice Able"), bobRow = inv.find(x => x[1] === "Bob Baker"), cyRow = inv.find(x => x[1] === "Cy Dnì");
  check("MA6a: live mode sends ONE email per person to the real address; subject/body come from the [GFY TEMPLATE] Gmail draft with {first} filled",
    r.ok && w.sent.length === 2 && !!a && a.subject === "Good Friends Yearly 2027, Alice?" && a.body.startsWith("Hi Alice,") && w.sent.some(s => s.to === "bob@example.com" && s.body.startsWith("Hi Bob,")), r.e || JSON.stringify(w.sent));
  check("MA6b: SendLog gets one row per email (date, player, address_used, what=invite, note, thread_id = the Gmail thread)",
    log.length === 2 && log.every(l => /^\d{4}-\d{2}-\d{2}/.test(String(l[0])) && l[3] === "invite" && /^thr\d+$/.test(l[5])) && log.some(l => l[1] === "Alice Able" && l[2] === "alice@example.com" && l[5] === a.threadId), JSON.stringify(log));
  check("MA6c: ticks `invited` on the PUBLIC Invites row for exactly the people emailed (never the out/DNI row, never anything else)",
    aliceRow[2] === true && bobRow[2] === true && cyRow[2] === false && aliceRow[3] === false, JSON.stringify(inv));
  const ev = w.log.map(e => e.ev + (e.sheet ? ":" + e.sheet : ""));
  const lockedOk = ev.every((e, i) => e !== "write:Invites" || (ev.slice(0, i).lastIndexOf("lock") > ev.slice(0, i).lastIndexOf("unlock")));
  check("MA6d: every public-sheet write happens inside LockService (lock ... write ... unlock)", pubWrites(w).length >= 2 && lockedOk && ev.includes("unlock"), ev.join(","));
  check("MA6e: the public sheet was opened by the PUBLIC_ID script property", w.opened.length > 0 && w.opened.every(id => id === PUB));
  noteWrites(w);
  // second run: invited ticked => nobody left
  const sentBefore = w.sent.length; w.alerts.length = 0;
  const r2 = run(w, "sendInvites");
  check("MA6f: running Send invites again does not re-email anyone (invited tick excludes them)", r2.ok && w.sent.length === sentBefore, r2.e || JSON.stringify(w.alerts));
}

// ---------- A: test mode ----------
for (const [label, props] of [["unset (default ON)", {}], ["1", { GFY_MAIL_TEST: "1" }], ["blank", { GFY_MAIL_TEST: "" }], ["garbage", { GFY_MAIL_TEST: "no" }]]) {
  const w = world({ props });
  const r = run(w, "sendInvites");
  const log = w.sheet("SendLog").rows.slice(1);
  check(`MA7: GFY_MAIL_TEST ${label} => TEST MODE: every message goes to ${TEST_ADDR} with '[TEST → real address]' in the subject, nothing ticked on the public sheet, SendLog marked invite-test`,
    r.ok && w.sent.length === 2 && w.sent.every(s => s.to === TEST_ADDR) && w.sent.some(s => s.subject.startsWith("[TEST → alice@example.com]")) && w.sent.some(s => s.subject.startsWith("[TEST → bob@example.com]"))
    && pubWrites(w).length === 0 && log.length === 2 && log.every(l => l[3] === "invite-test"), r.e || JSON.stringify({ sent: w.sent, log }));
}
{
  const w = world({ props: { GFY_MAIL_TEST: " 0 " } });
  run(w, "sendInvites");
  check("MA7b: only an explicit 0 goes live (padding tolerated)", w.sent.length === 2 && w.sent.every(s => s.to !== TEST_ADDR));
  noteWrites(w);
}

// ---------- A: guards ----------
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, quota: 1 });
  const r = run(w, "sendInvites");
  check("MA8: daily-quota guard - fewer remaining sends than recipients => nothing sent, alert says so", r.ok && w.sent.length === 0 && w.alerts.some(a => /quota/i.test(a.msg)), r.e || JSON.stringify(w.alerts));
}
// ---------- Gmail draft template (WO-DRAFT-TEMPLATE) ----------
{
  for (const [label, drafts, re] of [
    ["zero template drafts", [], /\b0\b|no .*draft|missing/i],
    ["two template drafts", [TPL_DRAFT, { ...TPL_DRAFT, subject: "  [gfy template] second" }], /\b2\b/],
  ]) {
    const w = world({ props: { GFY_MAIL_TEST: "0" }, drafts });
    const r = run(w, "sendInvites");
    check(`DT1: ${label} => Send BLOCKED with a message naming the count; nothing sent or written, no confirm`,
      r.ok && w.sent.length === 0 && !w.alerts.some(a => a.btns === "YES_NO") && w.alerts.some(a => re.test(a.msg) && /template/i.test(a.msg)) && w.log.filter(e => e.ev === "write" || e.ev === "append").length === 0, r.e || JSON.stringify(w.alerts));
  }
  const w1 = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [{ ...TPL_DRAFT, subject: "   [Gfy Template]   Hello {first}" }, { subject: "Re: something else", html: "x", plain: "x" }] });
  run(w1, "sendInvites");
  check("DT2: the template is found case-insensitively/trimmed; the prefix is stripped from the sent subject; other drafts are ignored",
    w1.sent.length === 2 && w1.sent.some(s => s.subject === "Hello Alice") && w1.sent.some(s => s.subject === "Hello Bob"), JSON.stringify(w1.sent.map(s => s.subject)));
}
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [{ ...TPL_DRAFT, html: "<p>Hi {first} &amp; {first}</p>", plain: "Hi {first}" , subject: "[GFY TEMPLATE] {first}: {first}" }] });
  run(w, "sendInvites");
  const a = w.sent.find(s => s.to === "alice@example.com");
  check("DT3: {first} replaced everywhere (subject, plain body, HTML body, repeated); HTML body is sent as htmlBody",
    !!a && a.subject === "Alice: Alice" && a.body === "Hi Alice" && a.html === "<p>Hi Alice &amp; Alice</p>", JSON.stringify(a));
  check("DT3b: the draft itself is never sent, updated or deleted", w.draftOps.length === 0);
}
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [{ ...TPL_DRAFT, subject: "[GFY TEMPLATE] <b>", html: "<p>Hi {first}</p>", plain: "Hi {first}" }], contacts: [["Ann O'Brien <x>", "ann@example.com", "", "", "FALSE", "", ""]], invites: [[2027, "Ann O'Brien <x>", false, false, "", false, ""]] });
  run(w, "sendInvites");
  check("DT3c: a name is HTML-escaped inside the HTML body but plain in subject/plain body", w.sent.length === 1 && w.sent[0].html === "<p>Hi Ann</p>" , JSON.stringify(w.sent));
  const w2 = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [{ ...TPL_DRAFT, html: "<p>Hi {first}</p>", plain: "Hi {first}" }], contacts: [["<i>Zed Q", "z@example.com", "", "", "FALSE", "", ""]], invites: [[2027, "<i>Zed Q", false, false, "", false, ""]] });
  run(w2, "sendInvites");
  check("DT3d: first name '<i>Zed' becomes &lt;i&gt;Zed in HTML, raw in plain", w2.sent.length === 1 && w2.sent[0].html === "<p>Hi &lt;i&gt;Zed</p>" && w2.sent[0].body === "Hi <i>Zed", JSON.stringify(w2.sent));
}
for (const [label, draft] of [
  ["unreplaced {token} in the subject", { subject: "[GFY TEMPLATE] hi {first} {oops}", html: "<p>x</p>", plain: "x" }],
  ["unreplaced {token} in the HTML", { ...TPL_DRAFT, html: "<p>Hi {first} {date}</p>" }],
  ["unreplaced {token} in the plain body", { ...TPL_DRAFT, plain: "Hi {first} {Course Name}" }],
]) {
  const w = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [draft] });
  const r = run(w, "sendInvites");
  check(`DT4: ${label} => BLOCK, nothing sent`, r.ok && w.sent.length === 0 && w.alerts.some(a => /\{/.test(a.msg)), r.e || JSON.stringify(w.alerts));
}
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [{ ...TPL_DRAFT, html: "<style>p{color:red}</style><p>Hi {first}</p>" }] });
  run(w, "sendInvites");
  check("DT4b: CSS braces in the HTML are not mistaken for unreplaced tokens", w.sent.length === 2, JSON.stringify(w.alerts));
}
for (const [label, draft] of [
  ["[FILL in the subject", { ...TPL_DRAFT, subject: "[GFY TEMPLATE] hi {first} [fill: date]" }],
  ["[FILL in the HTML", { ...TPL_DRAFT, html: "<p>Hi {first} [FILL: course]</p>" }],
  ["[fill in the plain body (case-insensitive)", { ...TPL_DRAFT, plain: "Hi {first} [fill: course]" }],
]) {
  const w = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [draft] });
  const r = run(w, "sendInvites");
  check(`DT5: ${label} => BLOCK with 'the template draft still has [FILL] spots'`, r.ok && w.sent.length === 0 && w.alerts.some(a => /the template draft still has \[FILL\] spots/.test(a.msg)), r.e || JSON.stringify(w.alerts));
}
{
  const att = { getName: () => "schedule.pdf", kind: "att" };
  const w = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [{ ...TPL_DRAFT, attachments: [att] }] });
  run(w, "sendInvites");
  check("DT6: file attachments on the draft are copied onto every sent email", w.sent.length === 2 && w.sent.every(s => Array.isArray(s.attachments) && s.attachments.length === 1 && s.attachments[0] === att), JSON.stringify(w.sent.map(s => s.attachments && s.attachments.length)));
  const w2 = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [{ ...TPL_DRAFT, inline: [{ getName: () => "logo.png", kind: "inline" }] }] });
  const r2 = run(w2, "sendInvites");
  check("DT7: a draft with inline images => BLOCK (cid mapping not supported) with a message saying so; nothing sent", r2.ok && w2.sent.length === 0 && w2.alerts.some(a => /inline image/i.test(a.msg)), r2.e || JSON.stringify(w2.alerts));
}
{
  const w = world({ drafts: [{ ...TPL_DRAFT, subject: "[GFY TEMPLATE] Hello {first}" }], answers: ["YES"] });
  run(w, "sendInvites");
  const conf = w.alerts.find(a => a.btns === "YES_NO");
  check("DT8: test mode unchanged (to the test address, '[TEST → real address]' prefix) and the confirm dialog shows the final subject for the first recipient",
    w.sent.length === 2 && w.sent.every(s => s.to === TEST_ADDR) && w.sent.some(s => s.subject === "[TEST → alice@example.com] Hello Alice") && !!conf && /Hello Alice/.test(conf.msg), JSON.stringify([w.sent.map(s => s.subject), conf && conf.msg]));
}
{
  const w = world({ draftsError: true, props: { GFY_MAIL_TEST: "0" } });
  const r = run(w, "sendInvites");
  check("DT9: Gmail unreadable (getDrafts throws) => alert, nothing sent", r.ok && w.sent.length === 0 && w.alerts.length > 0, r.e || JSON.stringify(w.alerts));
}
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, failTo: "alice@example.com" });
  const r = run(w, "sendInvites");
  const log = w.sheet("SendLog").rows.slice(1);
  const alice = w.invSheet.rows.find(x => x[1] === "Alice Able"), bob = w.invSheet.rows.find(x => x[1] === "Bob Baker");
  check("MA10: one failed send is reported, is NOT logged or ticked, and does not stop the rest",
    r.ok && w.sent.length === 1 && w.sent[0].to === "bob@example.com" && log.length === 1 && log[0][1] === "Bob Baker" && alice[2] === false && bob[2] === true && w.alerts.some(a => /Alice Able/.test(a.msg) && /fail/i.test(a.msg)), r.e || JSON.stringify(w.alerts));
  noteWrites(w);
}

// ---------- C: triggers ----------
{
  const w = world();
  const a = run(w, "installMailTriggers"), b = run(w, "installMailTriggers");
  check("MC1: installMailTriggers creates ONE 15-minute scanReplies trigger (plus the onEdit one, see E1) and is idempotent", a.ok && b.ok && w.triggers.filter(t => t.fn === "scanReplies").length === 1 && w.triggers.find(t => t.fn === "scanReplies").every === 15 && w.triggers.length === 2, a.e || b.e || JSON.stringify(w.triggers));
}

// ---------- C: reply watcher ----------
// Build a world that has already sent live invites, then inject replies.
function afterSend(extra = {}) {
  const w = world({ props: { GFY_MAIL_TEST: "0" }, ...extra });
  run(w, "sendInvites"); w.alerts.length = 0; w.log.length = 0;
  const tid = who => w.sent.find(s => s.to === who).threadId;
  return { w, tid };
}
{
  const { w, tid } = afterSend();
  w.addIncoming(tid("alice@example.com"), { from: "Alice Able <alice@example.com>", subject: "Re: Good Friends Yearly 2027, Alice?", body: "Yes! Count me in.\n> On Jan 5 Riley wrote:\n> You in for 2027?", date: "2027-01-06T09:00:00Z" });
  w.addIncoming(tid("bob@example.com"), { from: "Bob Baker <bob@example.com>", subject: "Re: Good Friends Yearly 2027, Bob?", body: "No, I can't make it this year.", date: "2027-01-06T09:30:00Z" });
  const r = run(w, "scanReplies");
  const inv = w.invSheet.rows, alice = inv.find(x => x[1] === "Alice Able"), bob = inv.find(x => x[1] === "Bob Baker");
  const reps = w.sheet("Replies").rows.slice(1);
  const ra = reps.find(x => x[1] === "Alice Able"), rb = reps.find(x => x[1] === "Bob Baker");
  check("MC2: a real reply from someone other than the account ticks `responded` on the public Invites row", r.ok && alice[3] === true && bob[3] === true, r.e || JSON.stringify(inv));
  check("MC3: reply text goes ONLY to the private Replies tab (date, player, from, snippet, looks_yes suggestion, confirm=FALSE); quoted text is dropped from the snippet",
    !!ra && String(ra[0]).startsWith("2027-01-06") && /alice@example\.com/.test(ra[2]) && /Count me in/.test(ra[3]) && !/You in for/.test(ra[3]) && ra[5] === false, JSON.stringify(reps));
  check("MC4: looks_yes is only a suggestion: 'Yes! Count me in' -> TRUE, 'No, I can't make it' -> FALSE", ra && ra[4] === true && rb && rb[4] === false, JSON.stringify(reps));
  const cols = new Set(pubWrites(w).map(e => e.c));
  check("MC5: the watcher writes ONLY the `responded` column on the public sheet - never committed/status/invited (prose never auto-commits)", cols.size === 1 && cols.has(4) && inv.slice(1).every(x => x[5] === false || x[5] === ""), JSON.stringify([...cols]));
  check("MC6: no reply text or sender string reaches the public sheet", !pubWrites(w).some(e => /Count me in|can't make|alice@|bob@/i.test(String(e.v))));
  const ev = w.log.map(e => e.ev + (e.sheet ? ":" + e.sheet : ""));
  const lockedOk = ev.every((e, i) => e !== "write:Invites" || (ev.slice(0, i).lastIndexOf("lock") > ev.slice(0, i).lastIndexOf("unlock")));
  check("MC7: public `responded` writes happen inside LockService", lockedOk && ev.includes("lock"), ev.join(","));
  const rr = w.sheet("READ ME").rows;
  check("MC8: health stamp - READ ME B2 gets a timestamp (and contains no player names/addresses)", /^\d{4}-\d{2}-\d{2}/.test(String(rr[1][1])) && !/Alice|Bob|@/.test(String(rr[1][1])), JSON.stringify(rr));
  const n = reps.length; run(w, "scanReplies");
  check("MC9: re-running the scan does not duplicate Replies rows (msg_id dedupe)", w.sheet("Replies").rows.length - 1 === n, String(w.sheet("Replies").rows.length));
  noteWrites(w);
}
{
  const { w, tid } = afterSend();
  const t = tid("alice@example.com");
  w.addIncoming(t, { from: "Alice Able <alice@example.com>", subject: "Out of Office: Re: Good Friends", body: "I am away" });
  w.addIncoming(t, { from: "Alice Able <alice@example.com>", subject: "Re: hi", body: "auto", raw: "Auto-Submitted: auto-replied" });
  w.addIncoming(t, { from: "Alice Able <alice@example.com>", subject: "Automatic reply: hi", body: "x" });
  w.addIncoming(t, { from: "Riley <me@gmail.com>", subject: "Re: hi", body: "my own follow-up" });
  const r = run(w, "scanReplies");
  const alice = w.invSheet.rows.find(x => x[1] === "Alice Able");
  check("MC10: out-of-office subject, Auto-Submitted header, 'automatic reply' subject, and the account's own messages never count as a reply",
    r.ok && alice[3] === false && w.sheet("Replies").rows.length === 1 && pubWrites(w).length === 0, r.e || JSON.stringify(w.invSheet.rows));
  const rr = w.sheet("READ ME").rows;
  check("MC11: a clean scan with nothing to report still stamps the last-scan time", /^\d{4}-\d{2}-\d{2}/.test(String(rr[1][1])));
}
{
  const { w, tid } = afterSend();
  const t = tid("bob@example.com");
  w.addIncoming(t, { from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", body: "address not found", date: "2027-01-07T08:00:00Z" });
  const r = run(w, "scanReplies");
  const bob = w.invSheet.rows.find(x => x[1] === "Bob Baker");
  const notes = w.sheet("Contacts").rows.find(x => x[0] === "Bob Baker")[6];
  check("MC12: a bounce (mailer-daemon) writes 'BOUNCED <date>' to Contacts notes and is NOT counted as responded; no Replies row", r.ok && /BOUNCED 2027-01-07/.test(notes) && bob[3] === false && w.sheet("Replies").rows.length === 1 && pubWrites(w).length === 0, r.e || notes);
  run(w, "scanReplies");
  const notes2 = w.sheet("Contacts").rows.find(x => x[0] === "Bob Baker")[6];
  check("MC13: re-scanning does not stack duplicate BOUNCED notes", (notes2.match(/BOUNCED/g) || []).length === 1, notes2);
}
{
  // test-mode threads are never watched
  const w = world({ props: {} });
  run(w, "sendInvites");
  const t = w.sent[0].threadId;
  w.addIncoming(t, { from: "Someone <x@example.com>", subject: "Re:", body: "yes" });
  w.log.length = 0;
  const r = run(w, "scanReplies");
  check("MC14: SendLog rows with what=invite-test (TEST MODE) are ignored by the watcher - no public writes, no Replies", r.ok && pubWrites(w).length === 0 && w.sheet("Replies").rows.length === 1, r.e);
}
{
  const w3 = world({ props: { GFY_MAIL_TEST: "0" }, threadError: "thr2" });
  run(w3, "sendInvites");
  w3.addIncoming("thr1", { from: "A <alice@example.com>", subject: "Re:", body: "yes" });
  const r = run(w3, "scanReplies");
  const rr = w3.sheet("READ ME").rows;
  check("MC15: one unreadable thread does not abort the others, but the scan then throws and does NOT stamp a 'successful' scan time",
    !r.ok && w3.invSheet.rows.find(x => x[1] === "Alice Able")[3] === true && String(rr[1][1]) === "", r.e || JSON.stringify(rr));
  noteWrites(w3);
}

// ---------- BACKLOG #33 polish round: adminPolish / confirm->committed / Dashboard ----------
import { execFileSync } from "node:child_process";
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const freshStamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const colOf = (rows, name) => rows[0].findIndex(h => String(h).trim().toLowerCase() === name) + 1;
const snap = w => JSON.stringify({
  order: w.admin.sheets.map(s => s.name), active: w.admin.active && w.admin.active.name,
  sheets: w.admin.sheets.map(s => ({ n: s.name, rows: s.rows, v: s.validations, rules: s.rules, fz: s.frozen, tc: s.tabColor, pr: s.protections.map(p => [p.desc, p.warn]), bg: s.backgrounds })),
  pub: w.pub.sheets.map(s => s.rows),
});
const DASH = { season: "season", invited: "invited", responded: "responded", committed: "committed", out: "out", nudge: "nudge after (days)", scan: "last reply scan", status: "scan status" };
const dashVals = w => { const sh = w.sheet("Dashboard"); const m = {}; if (!sh) return m; sh.rows.forEach(r => { const k = String(r[0] || "").toLowerCase(); if (k && !(k in m)) m[k] = r[1]; }); return m; };
const dashList = (w, title) => { const sh = w.sheet("Dashboard"); if (!sh) return null; const hr = sh.rows[1] || []; const ci = hr.findIndex(h => String(h).trim() === title); if (ci < 0) return null; const out = []; for (let i = 2; i < sh.rows.length; i++) { const v = (sh.rows[i] || [])[ci]; if (v !== undefined && String(v) !== "") out.push(String(v)); } return out; };
const dashText = w => { const sh = w.sheet("Dashboard"); return sh ? JSON.stringify(sh.rows) : ""; };

// schema == python generator (single source)
{
  let py = null, err = "";
  try { py = JSON.parse(execFileSync("python3", ["-c", "import sys,json; sys.dont_write_bytecode=True; sys.path.insert(0,'tools'); import make_admin_template as m; print(json.dumps({k:v['headers'] for k,v in m.TABS.items()}))"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } })); } catch (e) { err = String(e); }
  const w = world();
  const sch = w.M.MAIL_SCHEMA;
  check("AP1: the .gs MAIL_SCHEMA equals make_admin_template.py TABS (same tab names, same header rows) - single source",
    !!py && !!sch && JSON.stringify(Object.keys(py).sort()) === JSON.stringify(Object.keys(sch).sort()) && Object.keys(py).every(k => JSON.stringify(py[k]) === JSON.stringify(sch[k])), err || JSON.stringify([py, sch]));
}
function bareAdmin(log) {
  return [mkSheet("Contacts", [["player", "email", "email_alt", "phone", "do_not_invite", "reason", "notes"], ["Alice Able", "alice@example.com", "", "", "FALSE", "", "keep me"]], log)];
}
{
  const w = world({ adminSheets: bareAdmin });
  const r = run(w, "adminPolish");
  const sch = w.M.MAIL_SCHEMA || {};
  const okTabs = ["Replies", "SendLog", "RSVP", "READ ME"].every(n => w.sheet(n) && JSON.stringify(w.sheet(n).rows[0]) === JSON.stringify(sch[n]));
  check("AP2: adminPolish creates every missing tab with its template headers (and a Dashboard)", r.ok && okTabs && !!w.sheet("Dashboard"), r.e || w.admin.sheets.map(s => s.name).join(","));
  check("AP2b: existing Contacts data untouched when tabs are added", JSON.stringify(w.sheet("Contacts").rows[1]) === JSON.stringify(["Alice Able", "alice@example.com", "", "", false, "", "keep me"]) || JSON.stringify(w.sheet("Contacts").rows[1]) === JSON.stringify(["Alice Able", "alice@example.com", "", "", "FALSE", "", "keep me"]), JSON.stringify(w.sheet("Contacts").rows));
}
{
  const w = world({
    adminSheets: log => [
      mkSheet("Contacts", [["player", "email", "notes"], ["Alice Able", "alice@example.com", "TRUE"]], log),
      mkSheet("SendLog", [["date", "player", "address_used", "what", "note"], ["2026-08-01", "Alice Able", "alice@example.com", "invite", "n"]], log),
      mkSheet("Replies", [["date", "player", "from", "snippet", "looks_yes", "confirm"], ["2026-08-02", "Alice Able", "A", "yes", "TRUE", "FALSE"]], log),
    ],
  });
  const before = JSON.stringify(w.sheet("SendLog").rows[1].slice(0, 5));
  const r = run(w, "adminPolish");
  const con = w.sheet("Contacts").rows, sl = w.sheet("SendLog").rows, rep = w.sheet("Replies").rows;
  check("AP3: missing headers are APPENDED at the end of row 1 (Contacts gains the rest, SendLog gains thread_id, Replies gains msg_id); no column moved, no data row moved or cleared",
    r.ok && con[0].slice(0, 3).join() === "player,email,notes" && ["email_alt", "phone", "do_not_invite", "reason"].every(h => con[0].includes(h))
    && sl[0].join() === "date,player,address_used,what,note,thread_id" && JSON.stringify(sl[1].slice(0, 5)) === before
    && rep[0].join() === "date,player,from,snippet,looks_yes,confirm,msg_id" && con[1][2] === "TRUE" && con[1][0] === "Alice Able", r.e || JSON.stringify([con, sl, rep]));
}
{
  const w = world();
  run(w, "adminPolish"); run(w, "adminPolish");
  const con = w.sheet("Contacts"), rep = w.sheet("Replies");
  const kinds = sh => Object.values(sh.validations).filter(v => v.kind === "checkbox").map(v => v.c).sort().join();
  check("AP4: freeze row 1 on every tab and ONE warning-only header protection per tab after two runs (reused, not duplicated)",
    w.admin.sheets.every(s => s.frozen === 1 && s.protections.length === 1 && s.protections[0].warn === true), JSON.stringify(w.admin.sheets.map(s => [s.name, s.frozen, s.protections.length])));
  check("AP5: checkboxes on Contacts.do_not_invite and Replies.looks_yes/confirm only", kinds(con) === String(colOf(con.rows, "do_not_invite")) && kinds(rep) === [colOf(rep.rows, "looks_yes"), colOf(rep.rows, "confirm")].sort().join(), kinds(con) + " | " + kinds(rep));
  const wins = Object.values(con.validations).filter(v => v.kind === "checkbox");
  check("AP5b: checkbox range is limited (last data row + 50), not the whole 1000-row sheet", wins.length > 0 && wins.every(v => v.r === 2 && v.nr <= con.rows.length + 50), JSON.stringify(wins));
}
{
  const w = world({
    contacts: [["Alice Able", "alice@example.com", "", "", "TRUE", "", "TRUE"], ["Bob Baker", "bob@example.com", "", "", "FALSE", "", ""], ["Cy", "c@example.com", "", "", "yes", "", "FALSE"]],
    replies: [["2027-01-01", "Alice Able", "A <a@example.com>", "TRUE", "TRUE", "FALSE", "m1"], ["2027-01-01", "Bob Baker", "B", "FALSE", true, "TRUE", "m2"]],
  });
  run(w, "adminPolish");
  const c = w.sheet("Contacts").rows, rp = w.sheet("Replies").rows;
  check("AP6: existing 'TRUE'/'FALSE' text in the checkbox columns becomes a real boolean; nothing else changes (other columns, 'yes' text, snippet 'TRUE')",
    c[1][4] === true && c[2][4] === false && c[3][4] === "yes" && c[1][6] === "TRUE" && c[3][6] === "FALSE"
    && rp[1][4] === true && rp[1][5] === false && rp[1][3] === "TRUE" && rp[2][4] === true && rp[2][5] === true && rp[2][3] === "FALSE", JSON.stringify([c, rp]));
}
{
  const w = world();
  run(w, "adminPolish");
  const con = w.sheet("Contacts");
  const rules = con.rules;
  const emailRules = rules.filter(r => /REGEXMATCH/.test(r.f || ""));
  const ef = emailRules.map(r => r.f).join("|");
  check("AP7: Contacts email/email_alt get highlight conditional-format rules (not a rejecting validation); the regex in the formula is single-escaped",
    emailRules.length === 2 && /\$B2/.test(ef) && /\$C2/.test(ef) && ef.includes('"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"') && Object.values(con.validations).every(v => v.kind === "checkbox"), JSON.stringify(rules));
}
{
  const w = world();
  run(w, "adminPolish");
  const names = w.admin.sheets.map(s => s.name).join();
  check("AP8: tab order Dashboard, Contacts, Replies, RSVP, SendLog, READ ME; active tab ends on Dashboard; every tab coloured",
    names === "Dashboard,Contacts,Replies,RSVP,SendLog,READ ME" && w.admin.active && w.admin.active.name === "Dashboard" && w.admin.sheets.every(s => !!s.tabColor), names);
}
{
  const w = world({ contacts: [["Alice Able", "alice@example.com", "", "", "TRUE", "", ""], ["Bob Baker", "bob@example.com", "", "", "FALSE", "", ""], ["Zed Nomatch", "z@example.com", "", "", "FALSE", "", ""]],
    replies: [["2027-01-01", "Alice Able", "A", "yes", "TRUE", "FALSE", "m1"]], sendlog: [["2026-12-01", "Alice Able", "alice@example.com", "invite", "", "t1"]] });
  run(w, "adminPolish");
  const s1 = snap(w), n1 = w.log.length;
  const r2 = run(w, "adminPolish");
  check("AP9: adminPolish is idempotent - the second run changes nothing (full state snapshot identical, zero cell writes)", r2.ok && snap(w) === s1 && w.log.length === n1, r2.e || w.log.slice(n1).map(e => JSON.stringify(e)).join(" "));
  check("AP9b: adminPolish never writes to the public sheet", pubWrites(w).length === 0);
}
{
  const w = world({ contacts: [["Alice Able", "a@example.com", "", "", "FALSE", "", ""], ["Zed Nomatch", "z@example.com", "", "", "FALSE", "", ""], ["  bob   BAKER ", "b@example.com", "", "", "FALSE", "", ""]] });
  run(w, "adminPolish");
  const list = dashList(w, "Name mismatches") || [];
  const con = w.sheet("Contacts");
  check("AP10: Contacts.player with no mailNorm_ match on ANY-year public Invites is listed on the Dashboard (matches by trim/space/case are not) and highlighted via a rule that points at that list",
    list.length === 1 && list[0] === "Zed Nomatch" && con.rules.some(r => /Dashboard/.test(r.f || "")), JSON.stringify([list, con.rules.map(r => r.f)]));
}
{
  const w = world({ noPublicId: true });
  const r = run(w, "adminPolish");
  check("AP11: no PUBLIC_ID -> adminPolish still polishes the admin tabs, opens no public sheet, throws nothing, Dashboard says why",
    r.ok && w.opened.length === 0 && w.sheet("Dashboard") && /PUBLIC_ID/.test(dashText(w)) && w.sheet("Contacts").frozen === 1, r.e || dashText(w));
}
{
  const w = world();
  const r = run(w, "onOpen");
  const m = w.menus.find(m => m.title === "GFY Mail");
  check("AP12: menu 'GFY Mail' gains 'Polish admin sheet' -> adminPolish", r.ok && !!m && m.items.some(([l, f]) => l === "Polish admin sheet" && f === "adminPolish"), JSON.stringify(w.menus));
}

// ---------- Dashboard ----------
function dashWorld(extra = {}) {
  return world({
    contacts: [["Alice Able", "a@example.com", "", "", "FALSE", "", ""], ["Bob Baker", "b@example.com", "", "", "FALSE", "", "BOUNCED 2027-01-07"], ["Cy Dnì", "c@example.com", "", "", "FALSE", "", ""]],
    invites: [
      [2026, "Old Timer", true, false, "", false, ""],
      [2027, "Alice Able", true, false, "", false, ""],
      [2027, "Bob Baker", true, false, "", false, ""],
      [2027, "Cy Dnì", true, true, "", true, ""],
      [2027, "Dee Out", true, false, "out", false, ""],
      [2027, "Frank Test", true, false, "", false, ""],
      [2027, "Gina Recent", true, false, "", false, ""],
      [2027, "Eve New", false, false, "", false, ""],
    ],
    sendlog: [
      [daysAgo(12), "Alice Able", "a@example.com", "invite", "", "t1"],
      [daysAgo(10), "Alice Able", "a@example.com", "invite", "", "t1b"],
      [daysAgo(10), "Bob Baker", "b@example.com", "invite", "", "t2"],
      [daysAgo(10), "Dee Out", "d@example.com", "invite", "", "t3"],
      [daysAgo(10), "Frank Test", "goodfriendsyearly@gmail.com", "invite-test", "", "t4"],
      [daysAgo(3), "Gina Recent", "g@example.com", "invite", "", "t5"],
    ],
    replies: [["2027-01-02", "Cy Dnì", "C", "yes", true, false, "m1"], ["2027-01-02", "Alice Able", "A", "yes", true, true, "m2"], ["2027-01-02", "Bob Baker", "B", "no", false, false, "m3"]],
    ...extra,
  });
}
{
  const w = dashWorld();
  const r = run(w, "adminPolish");
  const v = dashVals(w);
  check("D1: Dashboard counts for the current season only: invited 6, responded 1, committed 1, out 1 (2026 rows ignored)",
    r.ok && String(v.season) === "2027" && v.invited === 6 && v.responded === 1 && v.committed === 1 && v.out === 1, r.e || JSON.stringify(v));
  const nd = dashList(w, "Needs nudge") || [];
  check("D2: needs-nudge = invited, not responded, not out, real invite last sent >= N days ago (N default 7); recent / test-only / responded / out are excluded",
    v[DASH.nudge] === 7 && nd.length === 2 && nd.includes("Alice Able") && nd.includes("Bob Baker"), JSON.stringify([v, nd]));
  check("D3: bounced list comes from Contacts notes", JSON.stringify(dashList(w, "Bounced")) === JSON.stringify(["Bob Baker"]), JSON.stringify(dashList(w, "Bounced")));
  check("D4: unconfirmed looks_yes = Replies looks_yes ticked and confirm not ticked", JSON.stringify(dashList(w, "Unconfirmed looks_yes")) === JSON.stringify(["Cy Dnì"]), JSON.stringify(dashList(w, "Unconfirmed looks_yes")));
  // N is a Dashboard cell; changing it survives a rebuild and changes the list
  const dash = w.sheet("Dashboard");
  const nr = dash.rows.findIndex(row => String(row[0]).toLowerCase() === DASH.nudge);
  dash.rows[nr][1] = 2;
  run(w, "adminPolish");
  const nd2 = dashList(w, "Needs nudge") || [];
  check("D5: N is read from the Dashboard cell (kept across rebuilds): N=2 now also nudges Gina", dashVals(w)[DASH.nudge] === 2 && nd2.includes("Gina Recent") && nd2.length === 3, JSON.stringify([dashVals(w), nd2]));
  dash.rows[nr][1] = "junk";
  run(w, "adminPolish");
  check("D5b: a junk N falls back to 7", dashVals(w)[DASH.nudge] === 7, JSON.stringify(dashVals(w)));
}
{
  const w = dashWorld();
  w.sheet("READ ME").rows[1][1] = "2020-01-01 00:00";
  run(w, "adminPolish");
  const stale = dashVals(w);
  w.sheet("READ ME").rows[1][1] = freshStamp();
  run(w, "adminPolish");
  const fresh = dashVals(w);
  w.sheet("READ ME").rows[1][1] = "";
  run(w, "adminPolish");
  const never = dashVals(w);
  check("D6: last scan time is shown; STALE when more than 1 h old at rebuild; fresh is not STALE; never-scanned is flagged",
    /2020-01-01/.test(String(stale[DASH.scan])) && /STALE/.test(String(stale[DASH.status])) && !/STALE/.test(String(fresh[DASH.status])) && /never/i.test(String(never[DASH.status])), JSON.stringify([stale, fresh, never]));
}
{
  const { w, tid } = afterSend();
  w.addIncoming(tid("alice@example.com"), { from: "Alice Able <alice@example.com>", subject: "Re:", body: "Yes! Count me in." });
  const r = run(w, "scanReplies");
  const un = dashList(w, "Unconfirmed looks_yes") || [];
  check("D7: scanReplies ends by rebuilding the Dashboard (created if absent): fresh scan time, new looks_yes reply listed, counts current",
    r.ok && !!w.sheet("Dashboard") && un.includes("Alice Able") && !/STALE/.test(String(dashVals(w)[DASH.status])) && dashVals(w)[DASH.responded] === 1, r.e || dashText(w));
  check("D8: the dashboard rebuild writes nothing to the public sheet beyond the scan's own responded tick", pubWrites(w).every(e => e.c === 4));
  noteWrites(w);
}
{
  const w3 = world({ props: { GFY_MAIL_TEST: "0" }, threadError: "thr2" });
  run(w3, "sendInvites");
  const r = run(w3, "scanReplies");
  check("D9: a scan that fails on an unreadable thread still throws, does not stamp a success time, and still refreshes the Dashboard (so STALE can show)",
    !r.ok && !!w3.sheet("Dashboard") && String(w3.sheet("READ ME").rows[1][1]) === "", r.e);
  noteWrites(w3);
}

{
  // InviteTemplate tab retired: polish must not delete a live one, and says it is unused
  const w = world({ adminSheets: log => [...bareAdmin(log), mkSheet("InviteTemplate", [["field", "text"], ["subject", "old"], ["body", "old body"]], log)] });
  const r = run(w, "adminPolish");
  const tpl = w.sheet("InviteTemplate");
  check("DT10: adminPolish leaves an existing InviteTemplate tab alone (not deleted, not edited, not in the schema) and the Dashboard says it is no longer used",
    r.ok && !!tpl && tpl.rows.length === 3 && tpl.rows[1][1] === "old" && !("InviteTemplate" in w.M.MAIL_SCHEMA) && /InviteTemplate tab is no longer used — safe to delete/.test(dashText(w)), r.e || dashText(w));
  const w2 = world();
  run(w2, "adminPolish");
  check("DT10b: no InviteTemplate tab => no such note and none is created", !w2.sheet("InviteTemplate") && !/InviteTemplate/.test(dashText(w2)));
}
{
  const w = world();
  run(w, "adminPolish");
  check("DT11: Dashboard shows 'template draft: OK — <subject>'", /template draft/.test(dashText(w)) && dashVals(w)["template draft"] === "OK — Good Friends Yearly 2027, {first}?", JSON.stringify(dashVals(w)));
  const w0 = world({ drafts: [] }); run(w0, "adminPolish");
  const w2 = world({ drafts: [TPL_DRAFT, { ...TPL_DRAFT }] }); run(w2, "adminPolish");
  check("DT11b: ... 'MISSING' with no template draft and '2+ drafts' with two", /^MISSING/.test(String(dashVals(w0)["template draft"])) && /^2\+ drafts/.test(String(dashVals(w2)["template draft"])), JSON.stringify([dashVals(w0), dashVals(w2)]));
  const wf = world({ drafts: [{ ...TPL_DRAFT, plain: "[FILL: x] {first}" }] }); run(wf, "adminPolish");
  const wg = world({ draftsError: true }); const rg = run(wg, "adminPolish");
  check("DT11c: a template with [FILL] spots shows as such; an unreadable Gmail does not break adminPolish", /FILL/.test(String(dashVals(wf)["template draft"])) && rg.ok && /unreadable|UNKNOWN/i.test(String(dashVals(wg)["template draft"])), JSON.stringify([dashVals(wf), dashVals(wg), rg.e]));
}

// ---------- confirm -> committed (installable onEdit) ----------
{
  const w = world();
  const a = run(w, "installMailTriggers"), b = run(w, "installMailTriggers");
  const fns = w.triggers.map(t => t.fn).sort().join();
  check("E1: installMailTriggers installs ONE 15-min scanReplies timer AND ONE installable onEdit (mailOnEdit); safe to run twice",
    a.ok && b.ok && fns === "mailOnEdit,scanReplies" && w.triggers.find(t => t.fn === "mailOnEdit").onEdit === true, a.e || b.e || fns);
  const w2 = world();
  w2.triggers.push({ fn: "scanReplies", every: 15 });
  run(w2, "installMailTriggers");
  check("E1b: an older install that has only scanReplies gains just the missing onEdit trigger", w2.triggers.map(t => t.fn).sort().join() === "mailOnEdit,scanReplies", w2.triggers.map(t => t.fn).join());
}
function editEvent(w, r, c, nr = 1) { return { range: w.sheet("Replies").getRange(r, c, nr, 1) }; }
function repWorld(extra = {}) {
  return world({
    props: { GFY_MAIL_TEST: "0" },
    invites: [[2026, "Alice Able", true, true, "", false, ""], [2027, "Alice Able", true, true, "", false, ""], [2027, "Bob Baker", true, true, "", false, ""], [2027, "Cy Dnì", true, false, "", true, ""]],
    replies: [["2027-01-02", "Alice Able", "A", "yes", true, true, "m1"], ["2027-01-02", "Bob Baker", "B", "yes", true, true, "m2"], ["2027-01-02", "Cy Dnì", "C", "yes", true, true, "m3"]],
    ...extra,
  });
}
{
  const w = repWorld();
  const cc = colOf(w.sheet("Replies").rows, "confirm");
  const r = (() => { try { w.M.mailOnEdit(editEvent(w, 2, cc)); return { ok: true }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } })();
  const inv = w.invSheet.rows;
  const a27 = inv.find(x => x[0] === 2027 && x[1] === "Alice Able"), a26 = inv.find(x => x[0] === 2026), bob = inv.find(x => x[1] === "Bob Baker");
  check("E2: ticking Replies.confirm ticks committed on the PUBLIC Invites row for that player in the CURRENT year only (other years / other players untouched)",
    r.ok && a27[5] === true && a26[5] === false && bob[5] === false, r.e || JSON.stringify(inv));
  const ev = w.log.map(e => e.ev + (e.sheet ? ":" + e.sheet : ""));
  const lockedOk = ev.every((e, i) => e !== "write:Invites" || (ev.slice(0, i).lastIndexOf("lock") > ev.slice(0, i).lastIndexOf("unlock")));
  check("E3: the committed write happens under LockService and is the only public write, value exactly TRUE", lockedOk && pubWrites(w).length === 1 && pubWrites(w)[0].v === true && pubWrites(w)[0].c === 6, JSON.stringify(pubWrites(w)));
  noteWrites(w);
  // already committed -> no write; multi-row paste
  w.log.length = 0;
  w.M.mailOnEdit(editEvent(w, 2, cc, 3));
  check("E4: a multi-row paste/fill commits each ticked row once; an already-committed player is not rewritten", pubWrites(w).length === 1 && w.invSheet.rows.find(x => x[0] === 2027 && x[1] === "Bob Baker")[5] === true, JSON.stringify(pubWrites(w)));
  noteWrites(w);
}
{
  const w = repWorld();
  const cc = colOf(w.sheet("Replies").rows, "confirm");
  w.invSheet.rows.find(x => x[0] === 2027 && x[1] === "Alice Able")[5] = true;
  w.sheet("Replies").rows[1][cc - 1] = false;           // the user just UNticked
  w.log.length = 0;
  const logLen = w.sheet("SendLog").rows.length;
  w.M.mailOnEdit(editEvent(w, 2, cc));
  check("E5: UNticking confirm never unticks committed: no public write at all; a note is logged on SendLog instead",
    pubWrites(w).length === 0 && w.invSheet.rows.find(x => x[0] === 2027 && x[1] === "Alice Able")[5] === true && w.sheet("SendLog").rows.length === logLen + 1 && /unticked|untick/i.test(JSON.stringify(w.sheet("SendLog").rows.slice(-1))), JSON.stringify(w.sheet("SendLog").rows));
}
{
  const w = repWorld({ replies: [["2027-01-02", "Ghost Guy", "G", "yes", true, true, "m1"]] });
  const cc = colOf(w.sheet("Replies").rows, "confirm");
  let threw = false; try { w.M.mailOnEdit(editEvent(w, 2, cc)); } catch (e) { threw = true; }
  // edits elsewhere are ignored
  const lc = colOf(w.sheet("Replies").rows, "looks_yes");
  w.M.mailOnEdit(editEvent(w, 2, lc));
  w.M.mailOnEdit({ range: w.sheet("Contacts").getRange(2, 5) });
  w.M.mailOnEdit(editEvent(w, 1, cc));
  check("E6: unknown player = no write; edits to other columns / other tabs / the header row are ignored; never writes anything but TRUE", !threw && pubWrites(w).length === 0, JSON.stringify(pubWrites(w)));
}
{
  const w = repWorld({ noPublicId: true });
  const cc = colOf(w.sheet("Replies").rows, "confirm");
  let threw = false; try { w.M.mailOnEdit(editEvent(w, 2, cc)); } catch (e) { threw = true; }
  check("E7: no PUBLIC_ID -> no public sheet opened, no write", w.opened.length === 0 && pubWrites(w).length === 0 && !threw);
}

// ---------- B: RSVP web app (WO-PROGRAM-33 s2) ----------
const WEBAPP = "https://script.google.com/macros/s/FAKE/exec";
const RSVP_DRAFT = { subject: "[GFY TEMPLATE] Are you in, {first}?", html: "<p>Hi {first}</p><p><a href=\"{rsvp}\">IN / OUT / MAYBE</a></p>", plain: "Hi {first}\nAnswer: {rsvp}" };
const rsvpRows = w => w.sheet("RSVP").rows.slice(1);
const tokenOf = (w, who) => (rsvpRows(w).find(r => r[1] === who) || [])[2];
function rsvpWorld(extra = {}) {
  const w = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT], ...extra });
  if (!extra.noSend) { run(w, "sendInvites"); w.alerts.length = 0; w.log.length = 0; }
  return w;
}
const pageOf = (w, t) => { const n = w.htmlPages.length; const r = w.M.doGet({ parameter: t === undefined ? {} : { t } }); return { r, html: String((r && (r.html || (r.getContent && r.getContent()))) || "") }; };
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [RSVP_DRAFT] });
  const r = run(w, "sendInvites");
  check("RS1: {rsvp} in the template but no WEBAPP_URL script property => Send BLOCKED, nothing sent", r.ok && w.sent.length === 0 && w.alerts.some(a => /WEBAPP_URL/.test(a.msg)), r.e || JSON.stringify(w.alerts));
  const w2 = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [TPL_DRAFT] });
  run(w2, "sendInvites");
  check("RS1b: no {rsvp} in the draft => WEBAPP_URL not needed and no tokens are created", w2.sent.length === 2 && rsvpRows(w2).length === 0 && !w2.alerts.some(a => /WEBAPP_URL/.test(a.msg)));
  const w3 = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT], adminSheets: log => [mkSheet("Contacts", [HDR_CON, ["Alice Able", "alice@example.com", "", "", "FALSE", "", ""]], log), mkSheet("SendLog", [HDR_LOG], log)] });
  w3.invSheet.rows.splice(3);
  const r3 = run(w3, "sendInvites");
  check("RS1c: {rsvp} but no RSVP tab => BLOCK (run Polish admin sheet), nothing sent", r3.ok && w3.sent.length === 0 && w3.alerts.some(a => /RSVP/.test(a.msg)), r3.e || JSON.stringify(w3.alerts));
}
{
  const w = rsvpWorld();
  const rows = rsvpRows(w);
  const a = w.sent.find(s => s.to === "alice@example.com");
  const ta = tokenOf(w, "Alice Able"), tb = tokenOf(w, "Bob Baker");
  check("RS2: one RSVP row per (year, player), token >= 22 chars of [A-Za-z0-9], tokens differ", rows.length === 2 && rows.every(r => String(r[0]) === "2027" && /^[A-Za-z0-9]{22,}$/.test(String(r[2])) && r[3] === "") && ta !== tb, JSON.stringify(rows));
  check("RS3: {rsvp} becomes <WEBAPP_URL>?t=<token> in both the HTML and plain bodies, per recipient", !!a && a.body === `Hi Alice\nAnswer: ${WEBAPP}?t=${ta}` && a.html.includes(`href="${WEBAPP}?t=${ta}"`), JSON.stringify(a));
  check("RS4: tokens live ONLY in the private RSVP tab (not on the public sheet)", !JSON.stringify(w.pub.sheets.map(s => s.rows)).includes(ta) && !w.sheet("SendLog").rows.some(r => r.join("|").includes(ta)));
  w.alerts.length = 0; run(w, "sendInvites");
  check("RS4b: tokens are reused, never regenerated (get-or-create)", tokenOf(w, "Alice Able") === ta && rsvpRows(w).length === 2);
}
{
  const w = rsvpWorld({ noSend: true, rsvp: [[2027, "Alice Able", "A".repeat(24), "", "", ""], [2026, "Old Timer", "B".repeat(24), "IN", "x", "x IN"]] });
  const g = pageOf(w, "A".repeat(24));
  check("RS5: GET with a valid token renders the page: '<first>, are you in for 2027?' and three buttons IN / OUT / MAYBE wired to recordRsvp", /Alice, are you in for 2027\?/.test(g.html) && /IN/.test(g.html) && /OUT/.test(g.html) && /MAYBE/.test(g.html) && /google\.script\.run/.test(g.html) && /recordRsvp/.test(g.html) && !/Bob/.test(g.html), g.html.slice(0, 300));
  check("RS6: GET records NOTHING (no sheet writes of any kind - link scanners prefetch)", w.log.filter(e => e.ev === "write" || e.ev === "append").length === 0 && w.invSheet.rows.every(r => r[3] !== true || r[0] === 2026) && w.sheet("RSVP").rows[1][3] === "");
  const bad = [["unknown token", "Z".repeat(24)], ["previous-year token", "B".repeat(24)], ["missing token", undefined], ["short token", "A"]];
  for (const [label, t] of bad) {
    const x = pageOf(w, t);
    check(`RS7: ${label} => friendly 'not valid' page, no player names, no writes`, /not valid/i.test(x.html) && !/Alice|Old Timer|Bob/.test(x.html) && w.log.filter(e => e.ev === "write" || e.ev === "append").length === 0, x.html.slice(0, 200));
  }
  w.sheet("RSVP").rows[1][3] = "MAYBE";
  check("RS8: the current answer is shown on the page", /MAYBE/.test(pageOf(w, "A".repeat(24)).html.replace(/<button[\s\S]*?<\/button>/g, "")) || /current answer[^<]*MAYBE|Your answer[^<]*MAYBE/i.test(pageOf(w, "A".repeat(24)).html));
  w.sheet("RSVP").rows[1][1] = "<script>x</script> Quinn";
  check("RS8b: the first name is HTML-escaped on the page", !/<script>x/.test(pageOf(w, "A".repeat(24)).html));
}
function rsvpGo(w, who, choice) { const tk = tokenOf(w, who); try { return { ok: true, v: w.M.recordRsvp(tk, choice) }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } }
{
  const w = rsvpWorld();
  const r = rsvpGo(w, "Alice Able", "IN");
  const al = w.invSheet.rows.find(x => x[1] === "Alice Able" && x[0] === 2027);
  const row = rsvpRows(w).find(x => x[1] === "Alice Able");
  check("RS9: recordRsvp IN => RSVP tab answer + answered_at + history; public responded AND committed TRUE (nothing else)", r.ok && row[3] === "IN" && /^\d{4}-/.test(String(row[4])) && /IN/.test(String(row[5])) && al[3] === true && al[5] === true && al[2] === true, r.e || JSON.stringify([row, al]));
  const ev = w.log.map(e => e.ev + (e.sheet ? ":" + e.sheet : ""));
  const lockedOk = ev.every((e, i) => e !== "write:Invites" || (ev.slice(0, i).lastIndexOf("lock") > ev.slice(0, i).lastIndexOf("unlock")));
  check("RS10: every public write in recordRsvp happens under the lock", pubWrites(w).length >= 2 && lockedOk, ev.join(","));
  const r2 = rsvpGo(w, "Alice Able", "MAYBE");
  const row2 = rsvpRows(w).find(x => x[1] === "Alice Able");
  check("RS11: answering again replaces the answer and APPENDS to history; committed is never unticked", r2.ok && row2[3] === "MAYBE" && (String(row2[5]).match(/IN|MAYBE/g) || []).length >= 2 && al[5] === true, JSON.stringify(row2));
  check("RS12: Dashboard lists 'Changed answer - fix by hand' for committed-then-changed", (dashList(w, "Changed answer — fix by hand") || []).includes("Alice Able"), dashText(w));
  noteWrites(w);
}
{
  const w = rsvpWorld();
  rsvpGo(w, "Bob Baker", "MAYBE");
  const bob = w.invSheet.rows.find(x => x[1] === "Bob Baker" && x[0] === 2027);
  check("RS13: MAYBE => responded TRUE only (no committed, status untouched)", bob[3] === true && bob[5] === false && bob[4] === "", JSON.stringify(bob));
  rsvpGo(w, "Alice Able", "OUT");
  const al = w.invSheet.rows.find(x => x[1] === "Alice Able" && x[0] === 2027);
  check("RS14: OUT => responded TRUE and status 'declined' (status was blank); committed stays false", al[3] === true && al[4] === "declined" && al[5] === false, JSON.stringify(al));
  noteWrites(w);
}
{
  for (const st of ["out", "Declined", "maybe"]) {
    const w = rsvpWorld({ noSend: true, rsvp: [[2027, "Alice Able", "A".repeat(24), "", "", ""]], invites: [[2027, "Alice Able", true, false, st, false, ""], [2027, "Bob Baker", false, false, "", false, ""]] });
    rsvpGo(w, "Alice Able", "OUT");
    const al = w.invSheet.rows.find(x => x[1] === "Alice Able");
    check(`RS15: OUT never overwrites an existing status ('${st}' stays)`, al[4] === st && al[3] === true, JSON.stringify(al));
    noteWrites(w);
  }
}
{
  const wt = world({ props: { WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT] });
  run(wt, "sendInvites");
  const sentBefore = wt.sent.length;
  wt.log.length = 0;
  const r = rsvpGo(wt, "Alice Able", "IN");
  check("RS16: TEST MODE: RSVP works fully on the private RSVP tab but writes NOTHING to the public sheet", r.ok && rsvpRows(wt).find(x => x[1] === "Alice Able")[3] === "IN" && pubWrites(wt).length === 0 && wt.invSheet.rows.slice(1).every(x => x[3] === false || x[0] === 2026), r.e || JSON.stringify(pubWrites(wt)));
  check("RS17: in test mode the Dashboard labels it ('RSVP test mode')", /RSVP test mode/.test(dashText(wt)), dashText(wt));
}
{
  const w = rsvpWorld();
  const wr = () => w.log.filter(e => e.ev === "write" || e.ev === "append").length;
  const n0 = wr();
  const bads = [["bad choice", () => w.M.recordRsvp(tokenOf(w, "Alice Able"), "SURE")], ["unknown token", () => w.M.recordRsvp("Z".repeat(24), "IN")], ["empty token", () => w.M.recordRsvp("", "IN")]];
  for (const [label, fn] of bads) { let threw = false; try { fn(); } catch (e) { threw = true; } check(`RS18: recordRsvp rejects ${label} and writes nothing`, threw && wr() === n0, String(wr())); }
  const w2 = rsvpWorld({ noSend: true, rsvp: [[2026, "Old Timer", "B".repeat(24), "", "", ""]] });
  let t2 = false; try { w2.M.recordRsvp("B".repeat(24), "IN"); } catch (e) { t2 = true; }
  check("RS19: a previous-year token is rejected by recordRsvp too", t2 && w2.sheet("RSVP").rows[1][3] === "");
}
{
  const w = rsvpWorld();
  rsvpGo(w, "Alice Able", "IN");
  check("RS20: Dashboard is rebuilt after recordRsvp (responded/committed counts current)", dashVals(w)[DASH.committed] === 1 && dashVals(w)[DASH.responded] === 1, JSON.stringify(dashVals(w)));
}

// ---------- D: nudges (WO-PROGRAM-33 s3) ----------
{
  const w = world(); run(w, "onOpen");
  const m = w.menus.find(m => m.title === "GFY Mail");
  check("NU1: menu gains 'Send nudges…' -> sendNudges", !!m && m.items.some(([l, f]) => l === "Send nudges…" && f === "sendNudges"), JSON.stringify(w.menus));
}
const NU_CONTACTS = [["Alice Able", "alice@example.com", "", "", "FALSE", "", ""], ["Bob Baker", "bob@example.com", "", "", "FALSE", "", ""], ["Gil Gone", "gil@example.com", "", "", "FALSE", "", ""], ["Hal Replied", "hal@example.com", "", "", "FALSE", "", ""], ["Ivy Recent", "ivy@example.com", "", "", "FALSE", "", ""], ["Dee Out", "dee@example.com", "", "", "FALSE", "", ""]];
const NU_INVITES = [[2027, "Alice Able", false, false, "", false, ""], [2027, "Bob Baker", false, false, "", false, ""], [2027, "Gil Gone", false, false, "", false, ""], [2027, "Hal Replied", false, false, "", false, ""], [2027, "Ivy Recent", false, false, "", false, ""], [2027, "Dee Out", false, false, "out", false, ""]];
// everyone invited live, then back-date the SendLog and mark some outcomes
function nudgeWorld(extra = {}, ageFor = {}) {
  const w = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT, NUDGE_DRAFT], contacts: NU_CONTACTS, invites: NU_INVITES, ...extra, answers: ["YES", ...(extra.answers || ["YES", "YES", "YES"])] });
  run(w, "sendInvites"); w.alerts.length = 0;
  const sl = w.sheet("SendLog");
  sl.rows.slice(1).forEach(r => { r[0] = daysAgo(ageFor[r[1]] ?? (r[1] === "Ivy Recent" ? 3 : 10)); });
  const inv = n => w.invSheet.rows.find(x => x[0] === 2027 && x[1] === n);
  inv("Gil Gone")[5] = true; inv("Hal Replied")[3] = true;
  w.log.length = 0; w.sent.length = 0;
  return w;
}
{
  const w = nudgeWorld({}, { "Ivy Recent": 3 });
  const nThreads = Object.keys(w.threads).length;
  const r = run(w, "sendNudges");
  const conf = w.alerts.find(a => a.btns === "YES_NO");
  const replied = w.threadReplies.map(t => t.id).sort();
  const tidA = Object.values(w.threads).find(t => t.to === "alice@example.com").id, tidB = Object.values(w.threads).find(t => t.to === "bob@example.com").id;
  check("NU2: candidates = current season, invited, not responded/committed/out/DNI, last send >= 7 days (Ivy at 3 days, Gil committed, Hal responded, Dee out are NOT nudged); confirm lists the names",
    r.ok && !!conf && /Alice Able/.test(conf.msg) && /Bob Baker/.test(conf.msg) && !/Gil|Hal|Ivy|Dee/.test(conf.msg) && JSON.stringify(replied) === JSON.stringify([tidA, tidB].sort()), r.e || JSON.stringify([conf && conf.msg, replied]));
  const ra = w.threadReplies.find(t => t.id === tidA);
  const ta = tokenOf(w, "Alice Able");
  check("NU3: nudge = a REPLY in the person's existing invite thread (no new thread, no createDraft), body+HTML from the [GFY NUDGE] draft with {first} and {rsvp} filled; the draft's own subject is not forced on the thread",
    Object.keys(w.threads).length === nThreads && w.sent.length === 0 && ra.body === `Alice, nudge: ${WEBAPP}?t=${ta}` && ra.html.includes(`href="${WEBAPP}?t=${ta}"`) && ra.subject === undefined, JSON.stringify(ra));
  const log = w.sheet("SendLog").rows.slice(1).filter(x => x[3] === "nudge");
  check("NU4: SendLog what=nudge, one row each, with the thread_id of the invite thread", log.length === 2 && log.some(x => x[1] === "Alice Able" && x[5] === tidA && x[2] === "alice@example.com") && log.every(x => /^\d{4}-/.test(String(x[0]))), JSON.stringify(log));
  check("NU4b: tokens reused from the invite (RSVP tab unchanged: one row per player)", rsvpRows(w).length === 5 && tokenOf(w, "Alice Able") === ta);
  check("NU5: nudging writes nothing to the public sheet", pubWrites(w).length === 0);
  w.alerts.length = 0; w.threadReplies.length = 0;
  run(w, "sendNudges");
  check("NU6: running again does not re-nudge anyone (last send is now today)", w.threadReplies.length === 0 && w.alerts.some(a => /nobody/i.test(a.msg)), JSON.stringify(w.alerts));
  // reply watcher keeps matching on the same thread
  w.addIncoming(tidA, { from: "Alice Able <alice@example.com>", subject: "Re: Are you in", body: "Yes, count me in!" });
  const sc = run(w, "scanReplies");
  check("NU7: after a nudge the reply watcher still matches the thread (our nudge is 'own', Alice's reply ticks responded)", sc.ok && w.invSheet.rows.find(x => x[1] === "Alice Able" && x[0] === 2027)[3] === true && w.sheet("Replies").rows.length === 2, sc.e || JSON.stringify(w.sheet("Replies").rows));
  noteWrites(w);
}
{
  const w = nudgeWorld({}, { "Ivy Recent": 3 });
  run(w, "adminPolish");
  const dash = w.sheet("Dashboard");
  const nr = dash.rows.findIndex(row => String(row[0]).toLowerCase() === DASH.nudge);
  dash.rows[nr][1] = 2;
  w.alerts.length = 0; w.threadReplies.length = 0;
  run(w, "sendNudges");
  const conf = w.alerts.find(a => a.btns === "YES_NO");
  check("NU8: N is the Dashboard cell: N=2 also nudges Ivy", !!conf && /Ivy Recent/.test(conf.msg) && w.threadReplies.length === 3, JSON.stringify(conf && conf.msg));
  const nl = dashList(w, "Needs nudge") || [];
  check("NU8b: after nudging, the Dashboard 'Needs nudge' no longer lists them (nudge sends count as a send)", !nl.includes("Alice Able") && !nl.includes("Bob Baker"), JSON.stringify(nl));
}
{
  const w = nudgeWorld({ answers: ["NO"] });
  run(w, "sendNudges");
  check("NU9: Cancel sends nothing and logs nothing", w.threadReplies.length === 0 && w.log.filter(e => e.ev === "write" || e.ev === "append").length === 0);
  for (const [label, drafts, re] of [["no nudge draft", [RSVP_DRAFT], /GFY NUDGE/], ["two nudge drafts", [RSVP_DRAFT, NUDGE_DRAFT, { ...NUDGE_DRAFT }], /\b2\b/], ["FILL spots", [RSVP_DRAFT, { ...NUDGE_DRAFT, plain: "[FILL] {first}" }], /\[FILL\] spots/], ["unreplaced token", [RSVP_DRAFT, { ...NUDGE_DRAFT, plain: "{first} {when}" }], /\{when\}/]]) {
    const x = nudgeWorld({ drafts });
    run(x, "sendNudges");
    check(`NU10: ${label} => BLOCKED, nothing sent`, x.threadReplies.length === 0 && !x.alerts.some(a => a.btns === "YES_NO") && x.alerts.some(a => re.test(a.msg)), JSON.stringify(x.alerts));
  }
  const nr = nudgeWorld({ props: { GFY_MAIL_TEST: "0" }, drafts: [RSVP_DRAFT, NUDGE_DRAFT] });
  delete nr.props.WEBAPP_URL; nr.alerts.length = 0;
  run(nr, "sendNudges");
  check("NU11: {rsvp} in the nudge but no WEBAPP_URL => BLOCK", nr.threadReplies.length === 0 && nr.alerts.some(a => /WEBAPP_URL/.test(a.msg)), JSON.stringify(nr.alerts));
}
{
  const w = nudgeWorld();
  w.props.GFY_MAIL_TEST = "";                     // back to test mode
  const real = Object.values(w.threads).map(t => t.id);
  const n0 = Object.keys(w.threads).length;
  w.alerts.length = 0; w.log.length = 0;
  const r = run(w, "sendNudges");
  const fresh = w.sent;
  check("NU12: TEST MODE: nothing is posted into the real invite threads; fresh messages go only to the test address with '[TEST → real address]'; SendLog nudge-test; no public writes",
    r.ok && w.threadReplies.length === 0 && fresh.length === 2 && fresh.every(m => m.to === TEST_ADDR && /^\[TEST → (alice|bob)@example\.com\]/.test(m.subject)) && w.sheet("SendLog").rows.slice(1).filter(x => x[3] === "nudge-test").length === 2 && pubWrites(w).length === 0, r.e || JSON.stringify([fresh, w.alerts]));
  w.alerts.length = 0; w.sent.length = 0;
  run(w, "sendNudges");
  check("NU12b: nudge-test sends do not count as a send (test-mode rehearsal is repeatable)", w.sent.length === 2);
}
{
  const w = nudgeWorld({ replyFails: "thr1" });
  w.alerts.length = 0;
  const r = run(w, "sendNudges");
  const logn = w.sheet("SendLog").rows.slice(1).filter(x => x[3] === "nudge");
  check("NU13: a failed nudge is reported, NOT logged, and does not stop the others", r.ok && logn.length === 1 && logn[0][1] === "Bob Baker" && w.alerts.some(a => /Alice Able/.test(a.msg) && /fail/i.test(a.msg)), r.e || JSON.stringify([logn, w.alerts]));
}
{
  const w = nudgeWorld();
  Object.values(w.threads).find(t => t.to === "alice@example.com").msgs[0].to = "someone.else@example.com";
  w.alerts.length = 0;
  run(w, "sendNudges");
  check("NU14: if the logged thread's last message did not go to EXACTLY that person's address, no reply is posted into it - a fresh email goes to the logged address instead (M2)",
    w.threadReplies.length === 1 && w.sent.length === 1 && w.sent[0].to === "alice@example.com", JSON.stringify([w.threadReplies, w.sent]));
  const x = nudgeWorld();
  x.sheet("SendLog").rows.slice(1).filter(r => r[1] === "Bob Baker").forEach(r => { r[5] = ""; });
  x.alerts.length = 0;
  run(x, "sendNudges");
  check("NU15: an invite row with no thread_id cannot be replied to => skipped and reported by name", x.threadReplies.length === 1 && x.alerts.some(a => /Bob Baker/.test(a.msg)), JSON.stringify(x.alerts));
}

// ---------- E: health alerts (WO-PROGRAM-33 s4) ----------
const ALERT = "ops@example.org";
function failingScanWorld(props = {}) {
  const w = world({ props: { GFY_MAIL_TEST: "0", ...props }, threadError: "thr2" });
  run(w, "sendInvites"); w.alerts.length = 0; w.mails.length = 0;
  return w;
}
{
  const w = failingScanWorld();
  const r = run(w, "scanReplies");
  check("HL1: ALERT_TO unset => a failing scan still throws but sends no alert mail", !r.ok && w.mails.length === 0, r.e);
  const ok = world({ props: { ALERT_TO: ALERT } });
  const r2 = run(ok, "scanReplies");
  check("HL2: a healthy scan with ALERT_TO set sends nothing", r2.ok && ok.mails.length === 0, r2.e || JSON.stringify(ok.mails));
}
{
  const w = failingScanWorld({ ALERT_TO: ALERT });
  const r = run(w, "scanReplies");
  check("HL3: a scan that throws sends ONE MailApp alert to ALERT_TO (and still throws)", !r.ok && w.mails.length === 1 && w.mails[0].to === ALERT && /scan/i.test(w.mails[0].subj), r.e || JSON.stringify(w.mails));
  run(w, "scanReplies"); run(w, "scanReplies");
  check("HL4: never alerts in a loop: repeated failures within 24 h send no more mail", w.mails.length === 1, JSON.stringify(w.mails.length));
  w.props.ALERT_LAST = String(Date.now() - 25 * 3600 * 1000);
  run(w, "scanReplies");
  check("HL5: after 24 h the next failure alerts again (once)", w.mails.length === 2, String(w.mails.length));
}
{
  const w = world({ props: { ALERT_TO: ALERT } });
  w.sheet("READ ME").rows[1][1] = "2020-01-01 00:00";
  const r = run(w, "scanReplies");
  check("HL6: last good scan older than 3 h when a scan starts => one alert, even though this scan succeeds", r.ok && w.mails.length === 1 && w.mails[0].to === ALERT && /stale|old|3 h/i.test(w.mails[0].subj + w.mails[0].body), r.e || JSON.stringify(w.mails));
  const f = world({ props: { ALERT_TO: ALERT } });
  f.sheet("READ ME").rows[1][1] = new Date(Date.now() - 2 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  run(f, "scanReplies");
  const n = world({ props: { ALERT_TO: ALERT } });          // never scanned: first scan, no alert
  run(n, "scanReplies");
  check("HL7: 2 h old (under 3 h) and never-scanned both stay quiet", f.mails.length === 0 && n.mails.length === 0, JSON.stringify([f.mails, n.mails]));
}
{
  const w = world({ props: { ALERT_TO: ALERT }, noPublicId: true });
  const r = run(w, "scanReplies");
  check("HL8: a scan that dies before starting (no PUBLIC_ID) alerts once and still throws", !r.ok && w.mails.length === 1, r.e || JSON.stringify(w.mails));
}
{
  const w = failingScanWorld({ ALERT_TO: ALERT });
  w.M.__mailFail = true;
  const w2 = world({ props: { GFY_MAIL_TEST: "0", ALERT_TO: ALERT }, threadError: "thr2" });
  run(w2, "sendInvites");
  w2.mails.length = 0;
  const r = run(w2, "scanReplies");
  check("HL9: the alert body carries no email addresses", w2.mails.length === 1 && !/@/.test(w2.mails[0].body.replace(ALERT, "")), JSON.stringify(w2.mails));
}

// ---------- polish-round review fixes (WO-PROGRAM-33 s6) ----------
{
  const w = repWorld({ props: {} });                       // TEST MODE (GFY_MAIL_TEST unset)
  const cc = colOf(w.sheet("Replies").rows, "confirm");
  const r = (() => { try { w.M.mailOnEdit(editEvent(w, 2, cc)); return { ok: true }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } })();
  check("FX1: mailOnEdit in TEST MODE writes nothing to the public sheet", r.ok && pubWrites(w).length === 0 && w.invSheet.rows.slice(1).every(x => x[5] === false || x[1] === "Cy Dnì"), r.e || JSON.stringify(pubWrites(w)));
  check("FX1b: ... and the Dashboard notes 'test mode: would commit Alice Able' (rebuilt by the edit)", /test mode: would commit [^"]*Alice Able/.test(dashText(w)), dashText(w));
  const wl = repWorld();
  wl.M.mailOnEdit(editEvent(wl, 2, cc));
  check("FX1c: LIVE mode has no such note", !/would commit/.test(dashText(wl)));
}
{
  const w = repWorld();
  const cc = colOf(w.sheet("Replies").rows, "confirm");
  run(w, "adminPolish");
  const before = dashVals(w)[DASH.committed];
  w.M.mailOnEdit(editEvent(w, 2, cc));
  check("FX2: the Dashboard is rebuilt after a mailOnEdit commit (committed count moves)", before === 1 && dashVals(w)[DASH.committed] === 2, JSON.stringify([before, dashVals(w)]));
}
{
  const w = world({ contacts: [["Alice Able", "a@example.com", "", "", "FALSE", "", ""], ["Old Timer", "o@example.com", "", "", "FALSE", "", ""], ["  zed   NOMATCH ", "z@example.com", "", "", "FALSE", "", ""], ["Ghost", "g@example.com", "", "", "FALSE", "", ""]],
    invites: [[2026, "old   timer", true, true, "", false, ""], [2027, "Alice Able", false, false, "", false, ""]] });
  run(w, "adminPolish");
  const list = dashList(w, "Name mismatches") || [];
  check("FX3: a Contacts name is a mismatch only if it matches NO Invites row in ANY year (veteran not invited this year is not one)", list.length === 2 && list.includes("Ghost") && list.some(n => /zed/i.test(n)) && !list.includes("Old Timer"), JSON.stringify(list));
}

// ---------- REVIEW FIXES (WO-FIX-33-REVIEW) ----------
// H2 + L2: Sheets coerces text -> Date/Number. The fake does too, so these would have caught it.
{
  const w = world({ props: { GFY_MAIL_TEST: "0", ALERT_TO: ALERT } });
  run(w, "scanReplies");
  const raw = w.sheet("READ ME").rows[1][1];
  const r2 = run(w, "scanReplies");
  check("H2a: the scan stamp is stored as TEXT (not coerced to a Date), so a second scan reads it, stays quiet and the Dashboard says ok",
    typeof raw === "string" && r2.ok && w.mails.length === 0 && !/STALE/.test(String(dashVals(w)[DASH.status])), JSON.stringify([raw, r2.e, w.mails, dashVals(w)]));
  // a stamp already coerced to a Date / number by an earlier version is still understood by every reader
  const mk = v => { const x = world({ props: { ALERT_TO: ALERT } }); x.sheet("READ ME").rows[1][1] = v; return x; };
  const fresh = mk(new Date(Date.now() - 20 * 60 * 1000)); run(fresh, "scanReplies");
  const old = mk(new Date(Date.now() - 5 * 3600 * 1000)); run(old, "scanReplies");
  const oldNum = mk(Date.now() - 5 * 3600 * 1000); run(oldNum, "scanReplies");
  const dFresh = mk(new Date(Date.now() - 20 * 60 * 1000)); run(dFresh, "adminPolish");
  const dOld = mk(new Date(Date.now() - 5 * 3600 * 1000)); run(dOld, "adminPolish");
  check("H2b: readers accept Date | number | string: a fresh Date is quiet + ok, a 5 h-old Date or epoch-ms number alerts, Dashboard STALE only when old",
    fresh.mails.length === 0 && old.mails.length === 1 && oldNum.mails.length === 1 && !/STALE/.test(String(dashVals(dFresh)[DASH.status])) && /over 1 h/.test(String(dashVals(dOld)[DASH.status])),
    JSON.stringify([fresh.mails, old.mails, oldNum.mails, dashVals(dFresh), dashVals(dOld)]));
}
{
  const w = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT], numericIds: true });
  run(w, "sendInvites");
  const log = w.sheet("SendLog").rows.slice(1);
  const tok = rsvpRows(w).map(r => r[2]);
  check("L2a: thread_id and token are written as TEXT (an all-digit id keeps its leading zeros, a token is never a Number)",
    log.length === 2 && log.every(l => typeof l[5] === "string" && /^0189300\d+$/.test(l[5])) && tok.length === 2 && tok.every(t => typeof t === "string" && t.length >= 22), JSON.stringify([log, tok]));
  w.addIncoming(log[0][5], { id: "00123456", from: "Alice <alice@example.com>", subject: "Re:", body: "yes" });
  run(w, "scanReplies");
  const rep = w.sheet("Replies").rows.slice(1);
  check("L2b: Replies.msg_id stays TEXT, and a second scan still dedupes on it", rep.length === 1 && rep[0][6] === "00123456" && (run(w, "scanReplies"), w.sheet("Replies").rows.length === 2), JSON.stringify(rep));
  check("L2c: RSVP.answered_at is TEXT too", (rsvpGo(w, "Alice Able", "IN"), typeof rsvpRows(w).find(r => r[1] === "Alice Able")[4] === "string"), JSON.stringify(rsvpRows(w)));
}

// H1: a send can never double-email (re-run after a crash, concurrent click) + L8 (no orphan drafts)
const todayStr = new Date().toISOString().slice(0, 10);
{
  // crash between send and tick: SendLog has the live invite row but `invited` was never ticked
  const w = world({ props: { GFY_MAIL_TEST: "0" }, sendlog: [[todayStr, "Alice Able", "alice@example.com", "invite", "season 2027", "thrX"]] });
  const r = run(w, "sendInvites");
  check("H1a: someone with a current-season SendLog invite row is NOT emailed again even though `invited` is unticked; the dialog says why",
    r.ok && w.sent.length === 1 && w.sent[0].to === "bob@example.com" && w.alerts.some(a => /Alice Able/.test(a.msg) && /SendLog|already/i.test(a.msg)), r.e || JSON.stringify([w.sent, w.alerts]));
  const old = world({ props: { GFY_MAIL_TEST: "0" }, sendlog: [["2020-03-01", "Alice Able", "alice@example.com", "invite", "", "t0"], [todayStr, "Bob Baker", "bob@example.com", "invite", "season 2026", "t1"], [todayStr, "Bob Baker", "bob.alt@example.com", "invite-test", "", "t2"]] });
  run(old, "sendInvites");
  check("H1a2: an old-season invite row (tagged 2026, or untagged from 2020) and invite-test rows do not block this season's invite", old.sent.length === 2, JSON.stringify(old.sent.map(x => x.to)));
  const leg = world({ props: { GFY_MAIL_TEST: "0" }, sendlog: [["2026-08-01", "Bob Baker", "bob@example.com", "invite", "", "t1"]] });
  run(leg, "sendInvites");
  check("H1a3: an untagged live invite row from the run-up to the season (2026-08 for 2027) counts as already sent", leg.sent.length === 1 && leg.sent[0].to === "alice@example.com", JSON.stringify(leg.sent.map(x => x.to)));
}
{
  const w = world({ props: { GFY_MAIL_TEST: "0" } });
  w.lockState.held = true;                                  // another execution holds the script lock
  const r = run(w, "sendInvites");
  check("H1b: the whole send needs the script lock: while another send holds it, nothing is sent or written and the alert says so",
    r.ok && w.sent.length === 0 && w.sheet("SendLog").rows.length === 1 && w.alerts.some(a => /another|already|running|lock/i.test(a.msg)), r.e || JSON.stringify(w.alerts));
}
{
  const w = world({ props: { GFY_MAIL_TEST: "0" } });
  // a second click lands while the first is mid-send: Bob is logged + ticked by the other run after Alice's mail went out
  w.hooks.afterSend = n => { if (n === 1) { w.sheet("SendLog").rows.push([todayStr, "Bob Baker", "bob@example.com", "invite", "season 2027", "thrOther"]); } };
  run(w, "sendInvites");
  check("H1c: SendLog is re-read under the lock right before EACH send: Bob (logged by a concurrent run mid-send) is not emailed again", w.sent.length === 1 && w.sent[0].to === "alice@example.com", JSON.stringify(w.sent.map(x => x.to)));
  const x = world({ props: { GFY_MAIL_TEST: "0" } });
  x.hooks.afterSend = n => { if (n === 1) { x.invSheet.rows.find(r => r[1] === "Bob Baker")[2] = true; } };
  run(x, "sendInvites");
  check("H1c2: ... and the public `invited` tick is re-read too", x.sent.length === 1 && x.sent[0].to === "alice@example.com", JSON.stringify(x.sent.map(y => y.to)));
}
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, failTo: "alice@example.com" });
  run(w, "sendInvites");
  const ev = w.log.map(e => e.ev + (e.sheet ? ":" + e.sheet : ""));
  const firstSend = ev.indexOf("send"), lastSend = ev.lastIndexOf("send");
  check("H1d: the lock is held across the WHOLE send (taken before the first mail, released after the last) and is free afterwards, even after a failed send",
    firstSend > 0 && ev.slice(0, firstSend).includes("lock") && !ev.slice(0, firstSend).includes("unlock") && ev.slice(lastSend).includes("unlock") && w.lockState.held === false, ev.join(","));
  check("L8a: a send that throws leaves no orphan draft in Gmail", w.pendingDrafts.size === 0, String(w.pendingDrafts.size));
}

// H3: test-mode RSVP answers must never surface on a live token
{
  const w = world({ props: { WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT], answers: ["YES", "YES"] });     // TEST MODE
  run(w, "sendInvites");
  const testTok = tokenOf(w, "Alice Able");
  rsvpGo(w, "Alice Able", "IN");
  const trow = rsvpRows(w).find(r => r[1] === "Alice Able");
  check("H3a: a test-mode send mints a token flagged `test` in the RSVP row, and the test answer lands on that test row", trow[3] === "IN" && String(trow[6]).toUpperCase() === "TRUE", JSON.stringify(trow));
  w.props.GFY_MAIL_TEST = "0"; w.sent.length = 0; w.log.length = 0; w.alerts.length = 0;
  run(w, "sendInvites");
  const live = rsvpRows(w).filter(r => r[1] === "Alice Able" && String(r[6]).toUpperCase() !== "TRUE");
  const liveTok = live[0] && live[0][2];
  const sentA = w.sent.find(x => x.to === "alice@example.com");
  check("H3b: after go-live the real invite carries a NEW live token (never the test one) with no answer on it",
    !!liveTok && liveTok !== testTok && live.length === 1 && live[0][3] === "" && !!sentA && sentA.body.includes(liveTok) && !sentA.body.includes(testTok) && !sentA.html.includes(testTok), JSON.stringify([rsvpRows(w), sentA]));
  const pg = pageOf(w, liveTok);
  check("H3c: the live token's page shows no prior answer (the test answer is not visible)", /are you in for 2027/.test(pg.html) && !/Your answer so far/.test(pg.html) && !/>\s*IN\s*</.test(pg.html.replace(/<button[\s\S]*?<\/button>/g, "")), pg.html.slice(0, 300));
  w.log.length = 0;
  const before = JSON.stringify(w.invSheet.rows);
  const stale = rsvpGo(w, "Alice Able", "IN");     // tokenOf() = the first (test) row for Alice
  const aliceInv = w.invSheet.rows.find(x => x[1] === "Alice Able" && x[0] === 2027);
  check("H3d: even in LIVE mode a TEST token only ever writes its own private RSVP row - nothing public (no responded/committed)",
    aliceInv[3] === false && aliceInv[5] === false && pubWrites(w).every(e => e.c === 3), JSON.stringify([stale, aliceInv, pubWrites(w)]));
}
{
  const w = world({ props: { WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT, NUDGE_DRAFT], answers: ["YES", "YES"] });
  run(w, "sendInvites");
  w.sheet("SendLog").rows.slice(1).forEach(r => { r[0] = daysAgo(10); });
  const t1 = tokenOf(w, "Alice Able");
  run(w, "sendNudges");
  const tokens = rsvpRows(w).filter(r => r[1] === "Alice Able");
  check("H3e: a test-mode nudge reuses the TEST token (one flagged row), still no live row exists", tokens.length === 1 && tokens[0][2] === t1 && String(tokens[0][6]).toUpperCase() === "TRUE", JSON.stringify(tokens));
}

// M1: scanning in TEST MODE must not tick `responded` publicly
{
  const { w, tid } = afterSend();
  w.props.GFY_MAIL_TEST = "";                                // back to test mode, live threads still in the log
  w.addIncoming(tid("alice@example.com"), { from: "Alice Able <alice@example.com>", subject: "Re:", body: "Yes, count me in." });
  w.log.length = 0;
  const r = run(w, "scanReplies");
  check("M1a: scanReplies in TEST MODE writes nothing to the public sheet (responded NOT ticked); the private Replies row is still logged",
    r.ok && pubWrites(w).length === 0 && w.invSheet.rows.find(x => x[1] === "Alice Able")[3] === false && w.sheet("Replies").rows.length === 2, r.e || JSON.stringify(pubWrites(w)));
  check("M1b: ... and the Dashboard says 'test mode: would mark responded Alice Able'", /test mode: would mark responded [^"]*Alice Able/.test(dashText(w)), dashText(w));
  w.props.GFY_MAIL_TEST = "0";
  run(w, "scanReplies");
  check("M1c: the same reply ticks responded once LIVE", w.invSheet.rows.find(x => x[1] === "Alice Able")[3] === true && !/would mark responded/.test(dashText(w)));
  noteWrites(w);
}
// M5: RSVP from a do-not-invite / out / declined row never commits or declines it publicly
{
  const w = rsvpWorld({ noSend: true, rsvp: [[2027, "Cy Dnì", "C".repeat(24), "", "", "", ""]] });
  w.log.length = 0;
  const r = rsvpGo(w, "Cy Dnì", "IN");
  const cy = w.invSheet.rows.find(x => x[1] === "Cy Dnì");
  check("M5a: a do-not-invite player's RSVP is recorded privately but writes NOTHING public (no responded/committed/status), and is listed on the Dashboard",
    r.ok && rsvpRows(w).find(x => x[1] === "Cy Dnì")[3] === "IN" && pubWrites(w).length === 0 && cy[3] === false && cy[5] === false && (dashList(w, "RSVP from out / DNI") || []).includes("Cy Dnì"), r.e || JSON.stringify([pubWrites(w), dashList(w, "RSVP from out / DNI")]));
  const x = rsvpWorld({ noSend: true, rsvp: [[2027, "Dee Out", "D".repeat(24), "", "", "", ""]],
    contacts: [["Dee Out", "d@example.com", "", "", "FALSE", "", ""]], invites: [[2027, "Dee Out", true, false, "declined", false, ""]] });
  rsvpGo(x, "Dee Out", "IN");
  const dee = x.invSheet.rows.find(y => y[1] === "Dee Out");
  check("M5b: OUT/declined -> IN: committed is NOT ticked, status stays 'declined'; the player lands on 'Changed answer - fix by hand' and the out/DNI list",
    dee[5] === false && dee[4] === "declined" && (dashList(x, "Changed answer — fix by hand") || []).includes("Dee Out") && (dashList(x, "RSVP from out / DNI") || []).includes("Dee Out"), JSON.stringify([dee, dashText(x)]));
  noteWrites(w); noteWrites(x);
}
// L1: fill-down over Replies - the player counts as confirmed if ANY of their rows is ticked
{
  const w = repWorld({ replies: [["2027-01-02", "Alice Able", "A", "yes", true, false, "m1"], ["2027-01-03", "Alice Able", "A", "yes again", true, true, "m2"]] });
  const cc = colOf(w.sheet("Replies").rows, "confirm");
  w.M.mailOnEdit(editEvent(w, 2, cc, 2));
  check("L1a: a fill-down over two rows of one player where only the SECOND is ticked still commits that player", w.invSheet.rows.find(x => x[0] === 2027 && x[1] === "Alice Able")[5] === true, JSON.stringify(w.invSheet.rows));
  const d = world({ replies: [["2027-01-02", "Alice Able", "A", "yes", true, false, "m1"], ["2027-01-03", "Alice Able", "A", "yes again", true, true, "m2"]] });
  run(d, "adminPolish");
  check("L1b: the Dashboard 'Unconfirmed looks_yes' list does not include a player with ANY confirm ticked", !(dashList(d, "Unconfirmed looks_yes") || []).includes("Alice Able"), dashText(d));
  noteWrites(w);
}
// L7: more spellings of "not coming" are out for SENDING; presend mirrors it
for (const st of ["No", "not coming", "NOPE", "n", " N "]) {
  const w = world({ props: { GFY_MAIL_TEST: "0" }, invites: [[2027, "Alice Able", false, false, st, false, ""], [2027, "Bob Baker", false, false, "", false, ""], [2027, "Cy Dnì", false, false, "out", false, ""]] });
  run(w, "sendInvites");
  check(`L7a: status '${st.trim()}' is out for sending: never invited`, w.sent.length === 1 && w.sent[0].to === "bob@example.com", JSON.stringify(w.sent.map(y => y.to)));
}
{
  const pre = await import("../tools/presend-check.mjs");
  const vio = st => pre.diffVault([{ player: "Cy Dni", email: "c@example.com", do_not_invite: "TRUE" }], [{ year: "2027", player: "Cy Dni", invited: "", responded: "", status: st }]).dniViolations.length;
  check("L7b: presend-check treats no / not coming / nope / n like out for a do-not-invite name (no violation), maybe still is one", vio("no") === 0 && vio("Not Coming") === 0 && vio("nope") === 0 && vio("n") === 0 && vio("out") === 0 && vio("maybe") === 1, [vio("no"), vio("n"), vio("maybe")].join());
}

// M2: nudge delivery - never replyAll into a bounce / the wrong thread; skip bounced players; fresh mail is logged + watched
{
  const w = nudgeWorld();
  const tidA = Object.values(w.threads).find(t => t.to === "alice@example.com").id;
  w.addIncoming(tidA, { from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", to: "me@gmail.com", subject: "Delivery Status Notification (Failure)", body: "not found" });
  w.alerts.length = 0;
  const r = run(w, "sendNudges");
  const fresh = w.sent.find(x => x.to === "alice@example.com");
  check("M2a: the thread's LAST message is a bounce => nothing is replied into that thread (never replyAll to mailer-daemon); a fresh email goes to the logged address with 'Re: <invite subject>'",
    r.ok && !w.threadReplies.some(t => t.id === tidA) && !w.threadReplies.some(t => /mailer-daemon/i.test(t.to)) && !!fresh && fresh.subject === "Re: Are you in, Alice?" && fresh.threadId !== tidA, r.e || JSON.stringify([w.threadReplies, w.sent]));
  const nl = w.sheet("SendLog").rows.slice(1).filter(x => x[3] === "nudge" && x[1] === "Alice Able");
  check("M2b: the fresh nudge is logged with its NEW thread_id", nl.length === 1 && !!fresh && nl[0][5] === fresh.threadId && nl[0][2] === "alice@example.com", JSON.stringify(nl));
  w.addIncoming((fresh || { threadId: tidA }).threadId, { from: "Alice Able <alice@example.com>", subject: "Re: Are you in, Alice?", body: "yes in" });
  run(w, "scanReplies");
  check("M2c: the scanner watches EVERY logged thread of a player: a reply in the fresh nudge thread ticks responded", w.invSheet.rows.find(x => x[1] === "Alice Able" && x[0] === 2027)[3] === true && w.sheet("Replies").rows.some(x => x[1] === "Alice Able"), JSON.stringify(w.invSheet.rows));
  noteWrites(w);
}
{
  const w = nudgeWorld();
  const tidA = Object.values(w.threads).find(t => t.to === "alice@example.com").id;
  run(w, "sendNudges");
  const ra = w.threadReplies.find(t => t.id === tidA);
  check("M2d: when the last message is ours and went to exactly the logged address, the nudge uses thread.reply (not replyAll), addressed to that person", !!ra && ra.all === false && ra.to === "alice@example.com", JSON.stringify(w.threadReplies));
  const x = nudgeWorld();
  Object.values(x.threads).find(t => t.to === "alice@example.com").msgs[0].to = "notalice@example.com";     // a SUBSTRING of the logged address would have passed the old check
  run(x, "sendNudges");
  check("M2e: recipient matching is on the parsed address, not a substring: 'notalice@' does not count as alice@", x.sent.some(m => m.to === "alice@example.com") && !x.threadReplies.some(t => t.to === "notalice@example.com"), JSON.stringify([x.sent.map(m => m.to), x.threadReplies]));
  const y = nudgeWorld();
  Object.values(y.threads).find(t => t.to === "alice@example.com").msgs[0].to = "Alice <alice@example.com>, cc@example.com";
  run(y, "sendNudges");
  check("M2f: a thread whose last message also went to somebody else is not replied into", y.sent.some(m => m.to === "alice@example.com") && !y.threadReplies.some(t => /cc@/.test(t.to)), JSON.stringify([y.sent.map(m => m.to), y.threadReplies]));
  const z = nudgeWorld();
  const tid = Object.values(z.threads).find(t => t.to === "alice@example.com").id;
  delete z.threads[tid];                                       // the invite thread was deleted in Gmail
  const rz = run(z, "sendNudges");
  check("M2g: a deleted invite thread does not fail the nudge: a fresh email goes to the logged address", rz.ok && z.sent.some(m => m.to === "alice@example.com"), rz.e || JSON.stringify(z.sent.map(m => m.to)));
}
{
  const w = nudgeWorld({ contacts: NU_CONTACTS.map(c => c[0] === "Alice Able" ? [...c.slice(0, 6), "BOUNCED 2027-01-07"] : c) });
  const r = run(w, "sendNudges");
  const conf = w.alerts.find(a => a.btns === "YES_NO");
  check("M2h: a BOUNCED player is skipped (not in the confirm list, nothing sent to them) and named as bounced", r.ok && !!conf && !/Alice Able/.test(conf.msg.split("Bounced")[0]) && w.alerts.some(a => /Alice Able/.test(a.msg) && /bounce/i.test(a.msg)) && !w.threadReplies.some(t => t.to === "alice@example.com") && !w.sent.some(m => m.to === "alice@example.com"), r.e || JSON.stringify(w.alerts));
}
// H1 for nudges: the same lock + re-read
{
  const w = nudgeWorld();
  w.lockState.held = true;
  run(w, "sendNudges");
  check("M2i: nudges also need the script lock: held elsewhere => nothing sent", w.threadReplies.length === 0 && w.sent.length === 0 && w.alerts.some(a => /another|already|running|lock/i.test(a.msg)), JSON.stringify(w.alerts));
  const x = nudgeWorld();
  x.hooks.afterReply = n => { if (n === 1) x.sheet("SendLog").rows.push([todayStr, "Bob Baker", "bob@example.com", "nudge", "", "thrOther"]); };
  run(x, "sendNudges");
  check("M2j: SendLog is re-read under the lock before each nudge: a nudge logged meanwhile by another run is not repeated", x.threadReplies.length === 1 && x.lockState.held === false, JSON.stringify(x.threadReplies));
}
// L4: test-mode rehearsal sees invite-test rows
{
  const w = world({ props: { WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT, NUDGE_DRAFT], contacts: NU_CONTACTS, invites: NU_INVITES, answers: ["YES", "YES"] });
  run(w, "sendInvites");
  w.sheet("SendLog").rows.slice(1).forEach(r => { r[0] = daysAgo(10); });
  w.sent.length = 0; w.alerts.length = 0; w.log.length = 0;
  const r = run(w, "sendNudges");
  const conf = w.alerts.find(a => a.btns === "YES_NO");
  check("L4: TEST MODE rehearsal: players who only have invite-test rows are nudge candidates, mail goes ONLY to the test address, SendLog nudge-test, nothing public",
    r.ok && !!conf && /Alice Able/.test(conf.msg) && /Bob Baker/.test(conf.msg) && w.sent.length >= 2 && w.sent.every(m => m.to === TEST_ADDR) && w.sheet("SendLog").rows.slice(1).filter(x => x[3] === "nudge-test").length === w.sent.length && pubWrites(w).length === 0, r.e || JSON.stringify([w.alerts, w.sent.map(m => m.to)]));
}

// M3: Gmail rewrites links typed in a draft (javascript:void, google.com/url?q= wrappers, no button styles) - the mailer injects the button
{
  const BTN = { subject: "[GFY TEMPLATE] In, {first}?", html: "<p>Hi {first}</p><p>{rsvp_button}</p><p>or {rsvp}</p>", plain: "Hi {first}\nTap: {rsvp_button}\nor {rsvp}" };
  const w = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [BTN] });
  const r = run(w, "sendInvites");
  const a = w.sent.find(x => x.to === "alice@example.com"), ta = tokenOf(w, "Alice Able"), url = `${WEBAPP}?t=${ta}`;
  check("M3a: {rsvp_button} becomes a full inline-styled <a href=URL> in the HTML (GFY pine #0E2019 / bone #E9E3D3) and the bare URL in the plain body",
    r.ok && !!a && a.html.includes(`<a href="${url}" style="`) && /background:#0E2019/i.test(a.html) && /color:#E9E3D3/i.test(a.html) && a.body === `Hi Alice\nTap: ${url}\nor ${url}`, r.e || JSON.stringify(a));
  check("M3b: a bare {rsvp} in the HTML text is a linked URL (<a href=URL>URL</a>), never loose text", !!a && a.html.includes(`or <a href="${url}">${url}</a>`), JSON.stringify(a && a.html));
  const nb = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [BTN] });
  run(nb, "sendInvites");
  check("M3c: {rsvp_button} counts as an RSVP token: without WEBAPP_URL the send is BLOCKED", nb.sent.length === 0 && nb.alerts.some(x => /WEBAPP_URL/.test(x.msg)), JSON.stringify(nb.alerts));
  for (const [label, html, re] of [
    ["href=\"javascript:void(0);\" (what Gmail turns a {rsvp} href into)", "<p><a href=\"javascript:void(0);\">IN</a> {first}</p>", /javascript/i],
    ["a percent-encoded token href (%7Brsvp%7D)", "<p><a href=\"%7Brsvp%7D\">IN</a> {first}</p>", /%7B|encoded|token/i],
  ]) {
    const x = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [{ ...RSVP_DRAFT, html }] });
    run(x, "sendInvites");
    check(`M3d: a draft containing ${label} => BLOCKED with a clear message, nothing sent`, x.sent.length === 0 && !x.alerts.some(y => y.btns === "YES_NO") && x.alerts.some(y => re.test(y.msg) && /template|link/i.test(y.msg)), JSON.stringify(x.alerts));
  }
  const g = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [{ ...RSVP_DRAFT, html: "<p>Hi {first} <a href=\"https://www.google.com/url?q=https://example.com/menu%3Fa%3D1%26b%3D2&amp;sa=D&amp;source=gmail&amp;ust=1&amp;usg=AOv\">the menu</a> {rsvp_button}</p>", plain: "Hi {first} https://www.google.com/url?q=https://example.com/menu&sa=D {rsvp}" }] });
  run(g, "sendInvites");
  const ga = g.sent.find(x => x.to === "alice@example.com");
  check("M3e: google.com/url?q= redirect wrappers in the copied draft are unwrapped back to the real URL (decoded q), in HTML and plain",
    !!ga && ga.html.includes('href="https://example.com/menu?a=1&amp;b=2"') && !/google\.com\/url/.test(ga.html + ga.body) && ga.body.includes("https://example.com/menu "), JSON.stringify(ga));
  const nd = nudgeWorld({ drafts: [BTN, { subject: "[GFY NUDGE] Still in, {first}?", html: "<p>{first}: {rsvp_button}</p>", plain: "{first}: {rsvp_button}" }] });
  run(nd, "sendNudges");
  check("M3f: the nudge draft gets the same button treatment", nd.threadReplies.length >= 1 && nd.threadReplies.every(t => /<a href="[^"]+" style="[^"]*#0E2019/i.test(t.html)), JSON.stringify(nd.threadReplies));
}

// B: staging isolation - TEMPLATE_PREFIX / NUDGE_PREFIX script properties, exact prefix match
{
  const STG = { ...TPL_DRAFT, subject: "[GFY STAGING TEMPLATE] STAGING {first}" };
  const LONGER = { ...TPL_DRAFT, subject: "[GFY TEMPLATE STAGING] longer {first}" };
  const live = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [STG, LONGER, TPL_DRAFT] });
  run(live, "sendInvites");
  check("B1: LIVE ignores staging-prefixed drafts: with a '[GFY STAGING TEMPLATE]' and a longer '[GFY TEMPLATE STAGING]' draft present, the one real template is used (exactly 1 found)",
    live.sent.length === 2 && live.sent.every(m => !/STAGING/.test(m.subject)) && live.sent.some(m => m.subject === "Good Friends Yearly 2027, Alice?"), JSON.stringify([live.sent.map(m => m.subject), live.alerts]));
  const only = world({ props: { GFY_MAIL_TEST: "0" }, drafts: [STG, LONGER] });
  run(only, "sendInvites");
  check("B2: LIVE with only staging drafts present => 'no template draft' BLOCK, nothing sent", only.sent.length === 0 && only.alerts.some(a => /No draft/i.test(a.msg)), JSON.stringify(only.alerts));
  const stg = world({ props: { GFY_MAIL_TEST: "0", TEMPLATE_PREFIX: "[GFY STAGING TEMPLATE]" }, drafts: [STG, TPL_DRAFT] });
  run(stg, "sendInvites");
  check("B3: TEMPLATE_PREFIX picks the staging draft and ignores the live one (prefix stripped from the subject)", stg.sent.length === 2 && stg.sent.every(m => /^STAGING (Alice|Bob)$/.test(m.subject)), JSON.stringify(stg.sent.map(m => m.subject)));
  const SN = { subject: "[GFY STAGING NUDGE] stg {first}", html: "<p>STG {first} {rsvp}</p>", plain: "STG {first}: {rsvp}" };
  const nu = nudgeWorld({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP, NUDGE_PREFIX: "[GFY STAGING NUDGE]" }, drafts: [RSVP_DRAFT, NUDGE_DRAFT, SN] });
  run(nu, "sendNudges");
  check("B4: NUDGE_PREFIX likewise (a staging nudge draft is used; the live [GFY NUDGE] draft is ignored)", nu.threadReplies.length >= 1 && nu.threadReplies.every(t => /^STG (Alice|Bob): /.test(t.body)), JSON.stringify(nu.threadReplies.map(t => t.body)));
  const dl = world({ drafts: [STG, TPL_DRAFT] }); run(dl, "adminPolish");
  const ds = world({ props: { TEMPLATE_PREFIX: "[GFY STAGING TEMPLATE]" }, drafts: [STG, TPL_DRAFT] }); run(ds, "adminPolish");
  check("B5: the Dashboard's template-draft line follows the same prefix", /^OK — Good Friends Yearly/.test(dashVals(dl)["template draft"]) && /^OK — STAGING/.test(dashVals(ds)["template draft"]), JSON.stringify([dashVals(dl)["template draft"], dashVals(ds)["template draft"]]));
}

// M4: the Web App is anonymous and google.script.run can call any global without a trailing underscore
{
  // top-level lines only: skip comments and the inside of multi-line template literals (the RSVP page's inline <script>)
  let inTpl = false;
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => { const keep = inTpl ? "" : l; if ((l.match(/`/g) || []).length % 2) inTpl = !inTpl; return keep; }).join("\n").replace(/\/\/[^\n]*/g, "");
  const globals = new Set([...code.matchAll(/^function\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1]).concat([...code.matchAll(/^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/gm)].map(m => m[1])));
  const open = [...globals].filter(n => !/_$/.test(n)).sort();
  check("M4a: the ONLY globals without a trailing underscore are the allowlist (menu/trigger entrypoints + doGet + recordRsvp)",
    JSON.stringify(open) === JSON.stringify(["adminPolish", "doGet", "installMailTriggers", "mailOnEdit", "onOpen", "recordRsvp", "scanReplies", "sendInvites", "sendNudges"]), JSON.stringify(open));
}
{
  const gone = () => { const x = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP, ALERT_TO: ALERT } }); x.flags.noUi = true; return x; };
  for (const fn of ["sendInvites", "sendNudges", "adminPolish", "installMailTriggers", "scanReplies"]) {
    const w = gone();
    const writes0 = w.log.length;
    const r = run(w, fn);
    check(`M4b: ${fn}() called with no UI and no trigger event (i.e. from the web) is refused: throws, sends nothing, writes nothing, installs nothing`,
      !r.ok && w.sent.length === 0 && w.mails.length === 0 && w.triggers.length === 0 && w.log.slice(writes0).filter(e => e.ev === "write" || e.ev === "append" || e.ev === "send").length === 0, r.e || "did not throw");
    let spoofed = true;
    try { w.M[fn]({ triggerUid: "guess-me" }); } catch (e) { spoofed = false; }
    check(`M4c: ${fn}({triggerUid:'guess-me'}) - a forged trigger event is refused too`, !spoofed && w.sent.length === 0 && w.triggers.length === 0, "");
  }
  const w = gone();
  w.M.installMailTriggers && (w.flags.noUi = false, w.M.installMailTriggers(), w.flags.noUi = true);
  let ok = true; try { w.M.scanReplies({ triggerUid: "uid-scanReplies" }); } catch (e) { ok = false; }
  check("M4d: a REAL trigger event (uid of an installed trigger) runs scanReplies with no UI", ok && w.sheet("READ ME").rows[1][1] !== "", "");
  const rep = world({ props: { GFY_MAIL_TEST: "0" }, replies: [["2027-01-02", "Alice Able", "A", "yes", true, true, "m1"]], invites: [[2027, "Alice Able", true, true, "", false, ""]] });
  rep.flags.noUi = true;
  const cc = colOf(rep.sheet("Replies").rows, "confirm");
  try { rep.M.mailOnEdit({ range: rep.sheet("Replies").getRange(2, cc, 1, 1) }); } catch (x) { /* refused */ }
  check("M4e: mailOnEdit called from the web with a crafted event writes nothing", pubWrites(rep).length === 0 && rep.invSheet.rows[1][5] === false, JSON.stringify(pubWrites(rep)));
  rep.flags.noUi = false; rep.M.installMailTriggers(); rep.flags.noUi = true;
  rep.M.mailOnEdit({ triggerUid: "uid-mailOnEdit", range: rep.sheet("Replies").getRange(2, cc, 1, 1) });
  check("M4f: ... but the real installable onEdit trigger event (known uid) still commits", rep.invSheet.rows[1][5] === true, JSON.stringify(rep.invSheet.rows));
  const dw = world({ props: { WEBAPP_URL: WEBAPP }, rsvp: [[2027, "Alice Able", "A".repeat(24), "", "", "", ""]] });
  dw.flags.noUi = true;
  const g = dw.M.doGet({ parameter: { t: "A".repeat(24) } });
  let rr = true; try { dw.M.recordRsvp("A".repeat(24), "MAYBE"); } catch (x) { rr = false; }
  check("M4g: doGet and recordRsvp stay web-callable (no UI needed)", /are you in/.test(String(g.html)) && rr && dw.sheet("RSVP").rows[1][3] === "MAYBE", "");
}

// M6: scan quota / robustness
{
  const { w, tid } = afterSend();
  w.invSheet.rows.find(x => x[1] === "Alice Able")[3] = true;          // Alice already responded (publicly)
  w.addIncoming(tid("bob@example.com"), { from: "Bob <bob@example.com>", subject: "Re:", body: "yes" });
  w.counters.fetched.length = 0;
  run(w, "scanReplies");
  check("M6a: a thread whose player is already `responded` is not fetched at all; others still are",
    !w.counters.fetched.includes(tid("alice@example.com")) && w.counters.fetched.includes(tid("bob@example.com")), JSON.stringify(w.counters.fetched));
}
{
  const { w, tid } = afterSend();
  w.props.GFY_MAIL_TEST = "";                                          // test mode: `responded` never ticks, so threads are revisited every scan
  w.addIncoming(tid("alice@example.com"), { from: "Alice <alice@example.com>", subject: "Re:", body: "yes" });
  w.addIncoming(tid("alice@example.com"), { from: "Riley <me@gmail.com>", subject: "Re:", body: "thanks" });
  w.addIncoming(tid("alice@example.com"), { from: "Mail Delivery <mailer-daemon@x.com>", subject: "Bounce", body: "x" });
  w.addIncoming(tid("alice@example.com"), { from: "Alice <alice@example.com>", subject: "Out of Office", body: "away" });
  run(w, "scanReplies");
  const raw1 = w.counters.raw;
  run(w, "scanReplies");
  check("M6b: getRawContent is only fetched when the cheap checks (already logged / own / bounce / auto subject) cannot decide: 1 real reply costs 1 raw fetch once, 0 on every re-scan",
    raw1 === 1 && w.counters.raw === raw1, JSON.stringify([raw1, w.counters.raw]));
}
{
  const { w, tid } = afterSend();
  delete w.threads[tid("alice@example.com")];                          // Alice's invite thread was deleted in Gmail
  w.addIncoming(tid("bob@example.com"), { from: "Bob <bob@example.com>", subject: "Re:", body: "yes in" });
  const r = run(w, "scanReplies");
  check("M6c: a deleted/missing thread does not fail the scan: it still succeeds, still stamps, processes the other threads, and the Dashboard names the missing one",
    r.ok && w.invSheet.rows.find(x => x[1] === "Bob Baker")[3] === true && /^\d{4}-/.test(String(w.sheet("READ ME").rows[1][1])) && /missing[^"]*Alice Able/i.test(dashText(w)), r.e || dashText(w));
  const r2 = run(w, "scanReplies");
  check("M6c2: ... and keeps reporting it on later scans (no alert loop: it is not an error)", r2.ok && /missing[^"]*Alice Able/i.test(dashText(w)), r2.e);
}
{
  const { w, tid } = afterSend({ props: { GFY_MAIL_TEST: "0", SCAN_BUDGET_MS: "-1" } });
  w.addIncoming(tid("alice@example.com"), { from: "Alice <alice@example.com>", subject: "Re:", body: "yes" });
  w.addIncoming(tid("bob@example.com"), { from: "Bob <bob@example.com>", subject: "Re:", body: "yes" });
  const r1 = run(w, "scanReplies");
  const after1 = w.sheet("Replies").rows.length - 1, stamp1 = String(w.sheet("READ ME").rows[1][1]);
  const r2 = run(w, "scanReplies");
  const after2 = w.sheet("Replies").rows.length - 1, stamp2 = String(w.sheet("READ ME").rows[1][1]);
  check("M6d: the scan is budgeted: when the time budget is spent it stops, remembers where, does not stamp a success time, and the next run resumes and completes (then stamps)",
    r1.ok && after1 === 1 && stamp1 === "" && r2.ok && after2 === 2 && /^\d{4}-/.test(stamp2), JSON.stringify([r1, after1, stamp1, r2, after2, stamp2]));
}
// L3: adminPolish never overwrites formulas and only replaces ITS OWN conditional-format rules
{
  const w = world({ contacts: [["Alice Able", "a@example.com", "", "", "TRUE", "", ""], ["Bob Baker", "b@example.com", "", "", "FALSE", "", ""]] });
  const con = w.sheet("Contacts");
  con.formulas["3,5"] = '=IF(1=1,"FALSE","TRUE")';                   // do_not_invite on Bob is a formula whose text result is "FALSE"
  const userRule = { f: '=$A2="vip"', bg: "#00ff00", ranges: [], getBooleanCondition: () => ({ getCriteriaValues: () => ['=$A2="vip"'] }) };
  con.rules = [userRule];
  run(w, "adminPolish"); run(w, "adminPolish");
  const mine = con.rules.filter(r => /gfy-admin-polish/.test(r.f || "")), others = con.rules.filter(r => !/gfy-admin-polish/.test(r.f || ""));
  check("L3a: a formula in a checkbox column is left alone (still a formula, not overwritten by a literal)", con.formulas["3,5"] === '=IF(1=1,"FALSE","TRUE")', JSON.stringify([con.formulas, con.rows[2]]));
  check("L3b: the text-TRUE next to it is still converted to a real checkbox boolean", con.rows[1][4] === true, JSON.stringify(con.rows[1]));
  check("L3c: a user's own conditional-format rule on Contacts survives (twice), and our 3 tagged rules appear exactly once each after two runs",
    others.length === 1 && others[0] === userRule && mine.length === 3, JSON.stringify(con.rules.map(r => r.f)));
}


// ---------- WO-FIX-33-REREVIEW (N1-N8 + probe d) ----------
const R_TODAY = new Date().toISOString().slice(0, 10);
const lease = ms => JSON.stringify({ id: "other", expires: Date.now() + ms });
const slRows = w => w.sheet("SendLog").rows.slice(1);
{ // N1a: nothing waits on a long send
  const names = Array.from({ length: 30 }, (_, i) => `Player${i} Zed`);
  const w = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT],
    contacts: names.map((n, i) => [n, `p${i}@example.com`, "", "", "FALSE", "", ""]), invites: names.map(n => [2027, n, false, false, "", false, ""]) });
  let rsvpOk = null, rsvpErr = "";
  w.hooks.afterSend = n => { if (n === 10) { try { w.M.recordRsvp(tokenOf(w, "Player0 Zed"), "IN"); rsvpOk = true; } catch (e) { rsvpOk = false; rsvpErr = String(e && e.message || e); } } };
  const r = run(w, "sendInvites");
  const p0 = w.invSheet.rows.find(x => x[1] === "Player0 Zed");
  check("N1a: 30-recipient send: NO email is ever sent while the script lock is held, and an RSVP landing mid-send completes at once (the fake lock throws on any wait, so any contention fails this)",
    r.ok && w.sent.length === 30 && w.lockState.sendsWhileHeld === 0 && rsvpOk === true && p0[5] === true && w.lockState.held === false, r.e || rsvpErr || String(w.lockState.sendsWhileHeld));
}
{ // N1b: run-exclusivity lease
  const w1 = world({ props: { GFY_MAIL_TEST: "0", SEND_RUN: lease(60000) } });
  const l0 = w1.props.SEND_RUN;
  run(w1, "sendInvites");
  check("N1b: a live SEND_RUN lease => the second send refuses 'another send is running', sends/writes nothing, leaves the other run's lease alone",
    w1.sent.length === 0 && slRows(w1).length === 0 && w1.alerts.some(a => /another send is running/i.test(a.msg)) && w1.props.SEND_RUN === l0, JSON.stringify(w1.alerts));
  const w2 = world({ props: { GFY_MAIL_TEST: "0", SEND_RUN: lease(-1000) } });
  run(w2, "sendInvites");
  check("N1b2: an EXPIRED lease is taken over, and the lease is released when the run ends", w2.sent.length === 2 && !("SEND_RUN" in w2.props), JSON.stringify(w2.props));
  const w3 = world({ props: { GFY_MAIL_TEST: "0" }, failTo: "alice@example.com" });
  run(w3, "sendInvites");
  check("N1b3: the lease is released after a run with a failed send too", !("SEND_RUN" in w3.props));
  const w4 = world({ props: { GFY_MAIL_TEST: "0" }, answers: ["YES", "YES"] });
  let nested = [];
  w4.hooks.afterSend = n => { if (n === 1) { const a0 = w4.alerts.length; try { w4.M.sendInvites(); } catch (e) { /* */ } nested = w4.alerts.slice(a0); } };
  run(w4, "sendInvites");
  check("N1b4: a second Send invites fired WHILE the first is mid-send (lock free between emails) refuses, and nobody is emailed twice",
    w4.sent.length === 2 && new Set(w4.sent.map(x => x.to)).size === 2 && nested.some(a => /another send is running/i.test(a.msg)), JSON.stringify(nested));
  const w5 = nudgeWorld(); w5.props.SEND_RUN = lease(60000); w5.alerts.length = 0;
  run(w5, "sendNudges");
  check("N1b5: nudges share the same lease", w5.sent.length === 0 && w5.alerts.some(a => /another send is running/i.test(a.msg)), JSON.stringify(w5.alerts));
}
{ // N1c: reservation row before send(), settled after
  const w = world({ props: { GFY_MAIL_TEST: "0" } });
  const seen = [];
  w.hooks.beforeSend = to => { const mine = slRows(w).find(r => r[2] === to); seen.push({ to, row: mine ? mine.slice() : null, locked: w.lockState.held }); };
  run(w, "sendInvites");
  const after = slRows(w);
  check("N1c: BEFORE each send() a reservation row exists (what=invite, note 'season 2027 pending <runId>', no thread yet) and no lock is held",
    seen.length === 2 && seen.every(x => x.row && x.row[3] === "invite" && /^season 2027 pending \S+$/.test(String(x.row[4])) && String(x.row[5]) === "" && x.locked === false), JSON.stringify(seen));
  check("N1c2: after the send the SAME row carries the thread_id and note 'season 2027 sent' (one row per person)",
    after.length === 2 && after.every(r => r[4] === "season 2027 sent" && /^thr\d+$/.test(String(r[5]))), JSON.stringify(after));
}
{ // N1d: a pending row counts as logged; Dashboard lists it
  const w = world({ props: { GFY_MAIL_TEST: "0" }, sendlog: [[R_TODAY, "Alice Able", "alice@example.com", "invite", "season 2027 pending abc123", ""]] });
  run(w, "sendInvites");
  run(w, "adminPolish");
  const pend = dashList(w, "Pending / unconfirmed sends") || [];
  check("N1d: a pending reservation counts as already sent (never re-sent) and the Dashboard lists it under 'Pending / unconfirmed sends'",
    w.sent.length === 1 && w.sent[0].to === "bob@example.com" && pend.some(x => /Alice Able/.test(x)) && !pend.some(x => /Bob Baker/.test(x)), JSON.stringify([w.sent.map(x => x.to), pend]));
}
{ // N1e: the RSVP page retries once after ~5 s
  const w = rsvpWorld({ noSend: true, rsvp: [[2027, "Alice Able", "A".repeat(24), "", "", ""]] });
  const html = pageOf(w, "A".repeat(24)).html;
  const drive = failures => {
    const dom = new JSDOM(html, { runScripts: "dangerously" }); const win = dom.window;
    const timers = []; win.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
    let attempts = 0;
    win.google = { script: { run: { withSuccessHandler: ok => ({ withFailureHandler: bad => ({ recordRsvp: () => { attempts++; if (attempts <= failures) bad(new Error("boom")); else ok({}); } }) }) } } };
    win.document.getElementById("b-IN").click();
    const afterClick = { attempts, timers: timers.length, ms: timers[0] && timers[0].ms };
    while (timers.length && attempts < 5) timers.shift().f();
    return { afterClick, attempts, msg: win.document.getElementById("msg").textContent, err: win.document.getElementById("msg").className, left: timers.length };
  };
  const one = drive(1), two = drive(2);
  check("N1e: one failure => retried automatically after ~5 s and then 'Saved.'", one.afterClick.attempts === 1 && one.afterClick.timers === 1 && one.afterClick.ms >= 4000 && one.afterClick.ms <= 6000 && one.attempts === 2 && one.msg === "Saved.", JSON.stringify(one));
  check("N1e2: two failures => only ONE retry, then the honest 'Could not save' error", two.attempts === 2 && /Could not save/.test(two.msg) && two.err === "err" && two.left === 0, JSON.stringify(two));
}
{ // N2: mailAppend_ only under the lock
  const w = world();
  let threw = false, msg = ""; try { w.M.mailAppend_(w.sheet("SendLog"), { date: "2027-01-01", player: "X", what: "note" }); } catch (e) { threw = true; msg = String(e.message); }
  check("N2a: mailAppend_ called without the script lock throws (and writes nothing)", threw && /lock/i.test(msg) && slRows(w).length === 0, msg);
  let inside = false; try { w.M.mailWithLock_(() => w.M.mailAppend_(w.sheet("SendLog"), { date: "2027-01-01", player: "X", what: "note" })); inside = true; } catch (e) { /* */ }
  check("N2a2: ... and works inside mailWithLock_ (flag is released afterwards)", inside && slRows(w).length === 1 && (() => { try { w.M.mailAppend_(w.sheet("SendLog"), {}); return false; } catch (e) { return true; } })());
  const worlds = [];
  { const x = rsvpWorld(); worlds.push(x); x.invSheet.getRange = () => { throw new Error("public sheet down"); }; rsvpGo(x, "Alice Able", "IN"); }          // recordRsvp failure note
  { const x = repWorld({ replies: [["2027-01-02", "Alice Able", "A", "yes", true, false, "m1"]], invites: [[2027, "Alice Able", true, true, "", true, ""]] }); worlds.push(x); x.M.mailOnEdit(editEvent(x, 2, colOf(x.sheet("Replies").rows, "confirm"))); }   // unticked note
  { const x = afterSend(); worlds.push(x.w); x.w.addIncoming(x.tid("alice@example.com"), { from: "Alice <alice@example.com>", subject: "Re:", body: "yes" }); run(x.w, "scanReplies"); }   // Replies row
  { const x = nudgeWorld(); worlds.push(x); run(x, "sendNudges"); }
  const bad = [];
  worlds.forEach((x, i) => x.log.filter(e => e.ev === "write" && ["SendLog", "Replies", "RSVP", "Dashboard"].includes(e.sheet) && e.locked !== true).forEach(e => bad.push(i + ":" + e.sheet + "@" + e.r + "," + e.c)));
  const sawNote = worlds[0].sheet("SendLog").rows.some(r => r[3] === "note") && worlds[1].sheet("SendLog").rows.some(r => r[3] === "note") && worlds[2].sheet("Replies").rows.length === 2;
  check("N2b: every write to SendLog / Replies / RSVP / Dashboard in the RSVP-failure-note, onEdit-note, scan-reply and nudge paths happens under the script lock", sawNote && bad.length === 0, bad.slice(0, 6).join(" ") + (sawNote ? "" : " (scenario did not reach the append)"));
}
{ // N3: menu
  const w = world(); run(w, "onOpen");
  const m = w.menus.find(m => m.title === "GFY Mail");
  const items = Object.fromEntries((m ? m.items : []));
  check("N3: menu has 'Install / repair triggers', 'Set nudge days…', 'Clear rehearsal answers'", items["Install / repair triggers"] === "installMailTriggers" && items["Set nudge days…"] === "setNudgeDays" && items["Clear rehearsal answers"] === "clearRehearsalAnswers", JSON.stringify(m && m.items));
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  check("N3b: README installs the triggers from the menu, never 'run installMailTriggers' from the editor", /Install \/ repair triggers/.test(readme) && !/\bRun `installMailTriggers`/i.test(readme) && !/Run `installMailTriggers` again/.test(readme));
}
{ // N4: a nudge is always a fresh email
  const w = nudgeWorld();
  const tidA = Object.values(w.threads).find(t => t.to === "alice@example.com").id;
  const r = run(w, "sendNudges");
  const fa = w.sent.find(x => x.to === "alice@example.com");
  const nl = slRows(w).filter(x => x[3] === "nudge" && x[1] === "Alice Able");
  const ta = tokenOf(w, "Alice Able");
  check("N4: LIVE nudge = a fresh email to the exact logged address, subject 'Re: <original invite subject>', body from the NUDGE draft; thread.reply is never used",
    r.ok && w.threadReplies.length === 0 && !!fa && fa.subject === "Re: Are you in, Alice?" && fa.body === `Alice, nudge: ${WEBAPP}?t=${ta}` && fa.threadId !== tidA, r.e || JSON.stringify([w.threadReplies, w.sent]));
  check("N4b: ... its NEW thread_id is logged on the nudge row and the scanner watches it", nl.length === 1 && !!fa && nl[0][5] === fa.threadId && nl[0][4] === "season 2027 sent", JSON.stringify(nl));
  if (fa) w.addIncoming(fa.threadId, { from: "Alice Able <alice@example.com>", subject: "Re: Are you in, Alice?", body: "yes in" });
  run(w, "scanReplies");
  check("N4c: a reply in the nudge thread ticks responded", w.invSheet.rows.find(x => x[1] === "Alice Able" && x[0] === 2027)[3] === true);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("N4d: the source has no GmailThread.reply / replyAll / mailNudgeLive_ left", !/\.reply\(|\.replyAll\(|mailNudgeLive_/.test(code));
}
{ // N5: a throwing send keeps its reservation
  const opts = { props: { GFY_MAIL_TEST: "0" }, failTo: "alice@example.com" };
  const w = world(opts);
  run(w, "sendInvites");
  const al = slRows(w).filter(r => r[1] === "Alice Able");
  check("N5: if send() throws the reservation row is KEPT, marked 'send error — check Sent before re-running'; the message never says safe to re-run",
    al.length === 1 && al[0][3] === "invite" && /send error — check Sent before re-running/.test(al[0][4]) && !w.alerts.some(a => /safe to re-run/i.test(a.msg)) && w.alerts.some(a => /Alice Able/.test(a.msg) && /check/i.test(a.msg)), JSON.stringify([al, w.alerts]));
  delete opts.failTo; w.alerts.length = 0; w.answers && 0;
  run(w, "sendInvites");
  run(w, "adminPolish");
  check("N5b: a re-run does not email Alice (the error row counts as logged) and the Dashboard lists her under 'Pending / unconfirmed sends'",
    w.sent.length === 1 && w.sent[0].to === "bob@example.com" && (dashList(w, "Pending / unconfirmed sends") || []).some(x => /Alice Able/.test(x)), JSON.stringify([w.sent.map(x => x.to), dashList(w, "Pending / unconfirmed sends")]));
}
{ // N6: rehearsal answers from an older version
  const mk = (extra = {}) => world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT, NUDGE_DRAFT], answers: ["YES", "YES", "YES"],
    sendlog: [[R_TODAY, "Alice Able", "alice@example.com", "invite", "season 2027 sent", "thrA"]],
    rsvp: [[2027, "Alice Able", "A".repeat(24), "IN", "2027-01-01 10:00", "2027-01-01 10:00 IN", ""], [2027, "Bob Baker", "B".repeat(24), "MAYBE", "2027-01-01 10:00", "2027-01-01 10:00 MAYBE", ""], [2027, "Zed Test", "Z".repeat(24), "OUT", "2027-01-01 10:00", "2027-01-01 10:00 OUT", true]], ...extra });
  const w = mk();
  run(w, "sendInvites");
  check("N6: LIVE send is BLOCKED while an unflagged RSVP row has an answer but the player has no live invite SendLog row; names the player and the menu item; nothing sent",
    w.sent.length === 0 && !w.alerts.some(a => a.btns === "YES_NO") && w.alerts.some(a => /rehearsal answers from an older version/.test(a.msg) && /Bob Baker/.test(a.msg) && !/Alice Able/.test(a.msg) && /Clear rehearsal answers/.test(a.msg)), JSON.stringify(w.alerts));
  const r = run(w, "clearRehearsalAnswers");
  const rr = w.sheet("RSVP").rows.slice(1), by = n => rr.find(x => x[1] === n);
  check("N6b: 'Clear rehearsal answers' clears answer/answered_at/history on test-flagged rows and on unflagged rows with no live invite; keeps tokens; leaves Alice's real answer alone",
    r.ok && by("Bob Baker")[3] === "" && by("Bob Baker")[4] === "" && by("Bob Baker")[5] === "" && by("Zed Test")[3] === "" && by("Zed Test")[5] === "" && by("Bob Baker")[2] === "B".repeat(24) && by("Alice Able")[3] === "IN" && by("Alice Able")[5] !== "", r.e || JSON.stringify(rr));
  w.alerts.length = 0;
  run(w, "sendInvites");
  check("N6c: ... after clearing, the live send goes ahead (Bob only; Alice is already logged)", w.sent.length === 1 && w.sent[0].to === "bob@example.com", JSON.stringify([w.sent.map(x => x.to), w.alerts]));
  const t = mk({ props: { WEBAPP_URL: WEBAPP } });
  run(t, "sendInvites");
  check("N6d: TEST MODE is never blocked by this", t.sent.length >= 1 && !t.alerts.some(a => /rehearsal answers/.test(a.msg)), JSON.stringify(t.alerts));
  const n = nudgeWorld(); n.sheet("RSVP").rows.push([2027, "Ghost Guy", "G".repeat(24), "IN", "2027-01-01 10:00", "2027-01-01 10:00 IN", ""]); n.alerts.length = 0;
  run(n, "sendNudges");
  check("N6e: a LIVE nudge run is blocked the same way", n.sent.length === 0 && n.alerts.some(a => /rehearsal answers from an older version/.test(a.msg) && /Ghost Guy/.test(a.msg)), JSON.stringify(n.alerts));
}
{ // N7: nudge days in a Script Property; Dashboard rebuilds
  const w = dashWorld({ props: { NUDGE_DAYS: "2" } });
  run(w, "adminPolish");
  check("N7: NUDGE_DAYS=2 drives the nudge list (Gina is nudged) and the Dashboard shows it", dashVals(w)[DASH.nudge] === 2 && (dashList(w, "Needs nudge") || []).includes("Gina Recent"), JSON.stringify([dashVals(w), dashList(w, "Needs nudge")]));
  const x = dashWorld();
  run(x, "adminPolish");
  const nr = x.sheet("Dashboard").rows.findIndex(row => String(row[0]).toLowerCase() === DASH.nudge);
  x.sheet("Dashboard").rows[nr][1] = 2;
  run(x, "adminPolish");
  check("N7b: editing the Dashboard cell no longer sets the value (only the property / menu does)", dashVals(x)[DASH.nudge] === 7 && !(dashList(x, "Needs nudge") || []).includes("Gina Recent"), JSON.stringify(dashVals(x)));
  const m = dashWorld({ promptAnswers: ["3", "abc", "0", "400"] });
  run(m, "setNudgeDays");
  const ok3 = m.props.NUDGE_DAYS === "3" && dashVals(m)[DASH.nudge] === 3;
  run(m, "setNudgeDays"); run(m, "setNudgeDays"); run(m, "setNudgeDays");
  check("N7c: menu 'Set nudge days…' stores a whole number 1-365 in NUDGE_DAYS and refreshes the Dashboard; junk / 0 / 400 are refused", ok3 && m.props.NUDGE_DAYS === "3" && m.prompts.length === 4, JSON.stringify([m.props.NUDGE_DAYS, m.prompts.length]));
  const d = rsvpWorld();
  run(d, "adminPolish");
  const tplLine = dashVals(d)["template draft"], n0 = d.counters.drafts;
  rsvpGo(d, "Alice Able", "IN");
  d.M.mailOnEdit(editEvent(d, 2, 1));
  check("N7d: Dashboard rebuilds from RSVP / onEdit do NOT read Gmail drafts and keep the cached template-draft status; adminPolish and scans do read them",
    d.counters.drafts === n0 && /^OK/.test(String(tplLine)) && dashVals(d)["template draft"] === tplLine && (() => { run(d, "scanReplies"); return d.counters.drafts > n0; })(), JSON.stringify([tplLine, dashVals(d)["template draft"], n0, d.counters.drafts]));
}
{ // N8: guard, nudge subject lookup, auto-reply ids, truthiness, CF rule ownership
  const w = world({ props: { GFY_MAIL_TEST: "0" } });
  w.M.installMailTriggers && w.M.installMailTriggers();
  w.flags.noUi = true;
  let threw = false; try { w.M.sendInvites({ triggerUid: "uid-scanReplies" }); } catch (e) { threw = true; }
  let threw2 = false; try { w.M.mailOnEdit({ triggerUid: "uid-scanReplies", range: w.sheet("Replies").getRange(2, 6, 1, 1) }); } catch (e) { threw2 = true; }
  let okScan = true; try { w.M.scanReplies({ triggerUid: "uid-scanReplies" }); } catch (e) { okScan = false; }
  check("N8a: a real trigger uid only authorises ITS OWN handler: scanReplies's uid cannot run sendInvites or mailOnEdit, but still runs scanReplies", threw && threw2 && w.sent.length === 0 && okScan);
  const n = nudgeWorld({ threadError: "thr1" }); n.alerts.length = 0;
  const r = run(n, "sendNudges");
  check("N8b: getThreadById throwing while looking up the invite subject is treated as a missing thread: the nudge still goes (fresh email), nothing fails",
    r.ok && n.sent.some(x => x.to === "alice@example.com") && !n.alerts.some(a => /NUDGE FAILED|Alice Able \(/.test(a.msg)), r.e || JSON.stringify(n.alerts));
  const { w: a, tid } = afterSend();
  a.addIncoming(tid("alice@example.com"), { from: "Alice Able <alice@example.com>", subject: "Re: hi", body: "auto", raw: "Auto-Submitted: auto-replied" });
  a.counters.raw = 0; run(a, "scanReplies"); const first = a.counters.raw;
  a.counters.raw = 0; run(a, "scanReplies"); run(a, "scanReplies");
  check("N8c: an auto-reply message id is remembered after its first classification: later scans never re-fetch its raw content (and it is still not a reply)", first === 1 && a.counters.raw === 0 && a.sheet("Replies").rows.length === 1 && a.invSheet.rows.find(x => x[1] === "Alice Able")[3] === false, JSON.stringify([first, a.counters.raw]));
  const t = world({ props: { GFY_MAIL_TEST: "0" }, invites: [[2027, "Alice Able", true, true, "", false, ""]], replies: [["2027-01-02", "Alice Able", "A", "yes", true, "yes", "m1"]] });
  t.M.mailOnEdit(editEvent(t, 2, 6));
  run(t, "adminPolish");
  check("N8d: onEdit and the Dashboard share ONE truthiness: confirm='yes' text neither commits nor hides the player from 'Unconfirmed looks_yes'", t.invSheet.rows[1][5] === false && (dashList(t, "Unconfirmed looks_yes") || []).includes("Alice Able"), JSON.stringify([t.invSheet.rows[1], dashList(t, "Unconfirmed looks_yes")]));
  const c = world();
  const mk1 = f => { const b = mkRuleB(); return b.whenFormulaSatisfied(f).build(); };
  const u1 = mk1('=AND($B2<>"",REGEXMATCH($B2&"","^x"))'), u2 = mk1('=COUNTIF(INDIRECT("Dashboard!A:A"),$A2)>0');
  c.sheet("Contacts").rules = [u1, u2];
  run(c, "adminPolish"); run(c, "adminPolish");
  const rules = c.sheet("Contacts").rules;
  check("N8e: only an exact tag marks a rule as ours: a user's rule that merely uses REGEXMATCH / INDIRECT('Dashboard!') survives", rules.includes(u1) && rules.includes(u2) && rules.filter(x => /gfy-admin-polish/.test(x.f || "")).length === 3, JSON.stringify(rules.map(x => x.f)));
}
{ // probe d follow-up
  const cases = [
    ["a {token} split by inline markup in the HTML", { ...RSVP_DRAFT, html: "<p>Hi {first} {da<b>te</b>}</p><a href=\"{rsvp}\">go</a>" }, /\{/],
    ["an allowed {first} split by markup (it would never be filled)", { ...RSVP_DRAFT, html: "<p>Hi {fi<b>rst</b>}</p><a href=\"{rsvp}\">go</a>" }, /\{|split|formatting/i],
    ["a [FILL split by markup", { ...RSVP_DRAFT, html: "<p>Hi {first} [FI<b>LL</b>: x]</p><a href=\"{rsvp}\">go</a>" }, /\[FILL\]/],
  ];
  for (const [label, draft, re] of cases) {
    const w = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [draft] });
    run(w, "sendInvites");
    check(`PD1: ${label} => BLOCK, nothing sent`, w.sent.length === 0 && w.alerts.some(a => re.test(a.msg)), JSON.stringify(w.alerts));
  }
  const w = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [{ subject: "[GFY TEMPLATE] In, {first}?", html: "<p>Hi {first}</p>", plain: "Hi {first}, answer: {rsvp}" }] });
  run(w, "sendInvites");
  check("PD2: the RSVP token is only in the plain body, so the filled HTML would carry no link => BLOCK, nothing sent", w.sent.length === 0 && w.alerts.some(a => /HTML/.test(a.msg) && /link|URL/i.test(a.msg)), JSON.stringify(w.alerts));
  const ok = world({ props: { GFY_MAIL_TEST: "0", WEBAPP_URL: WEBAPP }, drafts: [RSVP_DRAFT] });
  run(ok, "sendInvites");
  check("PD3: a normal draft is unaffected", ok.sent.length === 2);
}

// ---------- no-'@' leak test ----------
{
  const bad = allPublicWrites.filter(e => /@/.test(String(e.v)));
  check("MX1: across every scenario above, no public-sheet write carries an '@' (" + allPublicWrites.length + " writes inspected)", allPublicWrites.length >= 5 && bad.length === 0, JSON.stringify(bad));
  const w = world();
  const sh = w.invSheet;
  const r1 = run({ M: { f: () => w.M.mailPublicWrite_(sh, 2, 3, "someone@example.com") } }, "f");
  const r2 = run({ M: { f: () => w.M.mailPublicWrite_(sh, 2, 3, true) } }, "f");
  check("MX2: the single public-write helper REFUSES any value containing '@' (and allows a plain boolean tick)", !r1.ok && /@/.test(r1.e) && sh.writes.filter(x => /@/.test(String(x.v))).length === 0 && r2.ok && sh.rows[1][2] === true, r1.e + "|" + r2.e);
  const src = SRC.replace(/\/\/[^\n]*/g, "");
  const direct = (src.match(/\.setValues?\(/g) || []).length;
  check("MX3: public sheet is only ever written through mailPublicWrite_ (the only .setValue on a non-admin sheet lives inside it)", /function mailPublicWrite_/.test(src) && !/appendRow\(\s*[^)]*pub/i.test(src) && direct >= 1);
}

console.log(`\nMAILER ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
