// Offline behavioural tests for tools/gfy-mailer.gs (BACKLOG #33 parts A+C).
// Every Google service is a fake; nothing here touches the network or sends mail.
// Run:  npm run check-mailer
import { readFileSync } from "node:fs";
import path from "node:path";
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
  const sh = { name, rows: rows.map(r => r.slice()), writes: [], log, frozen: 0, tabColor: null, protections: [], validations: {}, rules: [], notes: {}, maxRows: 1000, wraps: {}, backgrounds: {} };
  const ensure = (r, c) => { while (sh.rows.length < r) sh.rows.push([]); const row = sh.rows[r - 1]; while (row.length < c) row.push(""); };
  const logW = (r, c, v, op) => { sh.writes.push({ r, c, v, op }); log.push({ ev: "write", sheet: name, r, c, v }); };
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
    return {
      getSheet: () => sh, getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
      getValue: () => (sh.rows[r - 1] || [])[c - 1] ?? "",
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((sh.rows[r - 1 + i] || [])[c - 1 + j] ?? ""); out.push(row); } return out; },
      setValue: v => { logW(r, c, v, "setValue"); ensure(r, c); sh.rows[r - 1][c - 1] = v; },
      setValues: vs => { vs.forEach((row, i) => row.forEach((v, j) => { logW(r + i, c + j, v, "setValues"); ensure(r + i, c + j); sh.rows[r - 1 + i][c - 1 + j] = v; })); },
      setDataValidation: dv => { sh.validations[key] = { r, c, nr, nc, kind: dv && dv.kind }; },
      clearDataValidations: () => { Object.keys(sh.validations).forEach(k => { const v = sh.validations[k]; if (v.c === c && v.r >= r && v.r < r + nr) delete sh.validations[k]; }); },
      setBackground: b => { sh.backgrounds[key] = b; },
      setNote: n => { sh.notes[key] = n; },
      setWrap: w => { sh.wraps[key] = w; },
      setFontWeight: () => {}, setFontSize: () => {},
    };
  };
  sh.appendRow = vals => { sh.writes.push({ op: "appendRow", v: vals }); log.push({ ev: "append", sheet: name, v: vals }); sh.rows.push(vals.slice()); };
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
const mkRuleB = () => { const o = { f: null, bg: null, ranges: [] }; const b = { whenFormulaSatisfied: f => { o.f = f; return b; }, setBackground: c => { o.bg = c; return b; }, setRanges: r => { o.ranges = r; return b; }, build: () => o }; return b; };
const mkDVB = () => { const o = { kind: null }; const b = { requireCheckbox: () => { o.kind = "checkbox"; return b; }, build: () => o }; return b; };

const PUB = "PUBLIC_SHEET_ID_FAKE";
const HDR_INV = ["year", "player", "invited", "responded", "status", "committed", "invited_by"];
const HDR_CON = ["player", "email", "email_alt", "phone", "do_not_invite", "reason", "notes"];
const HDR_LOG = ["date", "player", "address_used", "what", "note", "thread_id"];
const HDR_REP = ["date", "player", "from", "snippet", "looks_yes", "confirm", "msg_id"];

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
    mkSheet("InviteTemplate", o.template || [["field", "text"], ["subject", "Good Friends Yearly 2027, {first}?"], ["body", "Hi {first},\n\nYou in for 2027?\n\n- R"]], log),
    mkSheet("Replies", [HDR_REP, ...(o.replies || [])], log),
    mkSheet("READ ME", [["warning", "last_reply_scan"], ["be careful", ""]], log),
  ];
  const admin = mkSS("ADMIN_ID", o.adminSheets ? o.adminSheets(log) : adminSheets, log);
  const pub = mkSS(PUB, [mkSheet("Invites", [HDR_INV, ...invites], log)], log);
  const props = { ...(o.props || {}) }; if (!("PUBLIC_ID" in props) && !o.noPublicId) props.PUBLIC_ID = PUB;
  const alerts = []; const answers = o.answers || ["YES"];
  const opened = [];
  const menus = [];
  const ui = {
    alert: (title, msg, btns) => { alerts.push({ title, msg, btns }); return btns === "YES_NO" ? (answers.shift() ?? "NO") : "OK"; },
    createMenu: t => { const m = { title: t, items: [] }; const b = { addItem: (l, f) => { m.items.push([l, f]); return b; }, addSeparator: () => b, addToUi: () => { menus.push(m); } }; return b; },
    Button: { YES: "YES", NO: "NO", OK: "OK" }, ButtonSet: { YES_NO: "YES_NO", OK: "OK" },
  };
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => admin, getActive: () => admin, getUi: () => ui,
    newConditionalFormatRule: mkRuleB, newDataValidation: mkDVB, ProtectionType: { RANGE: "RANGE" },
    openById: id => { opened.push(id); if (id === PUB) return pub; throw new Error("unknown id " + id); },
  };
  // Gmail
  const sent = []; const threads = {}; let tn = 0;
  const mkMsg = m => ({ getId: () => m.id, getFrom: () => m.from, getSubject: () => m.subject, getDate: () => new Date(m.date || "2027-01-05T12:00:00Z"), getPlainBody: () => m.body || "", getRawContent: () => (m.raw || "") + "\r\n\r\n" + (m.body || "") });
  const GmailApp = {
    createDraft: (to, subject, body) => ({ send: () => {
      if (o.failTo && o.failTo === to) throw new Error("smtp boom");
      const id = "thr" + (++tn); const t = { id, msgs: [{ id: id + "m0", from: "Riley <me@gmail.com>", subject, body, date: "2027-01-05T10:00:00Z" }] };
      threads[id] = t; sent.push({ to, subject, body, threadId: id }); log.push({ ev: "send", to });
      return { getThread: () => ({ getId: () => id }) };
    } }),
    getThreadById: id => { if (o.threadError && o.threadError === id) throw new Error("gmail down"); const t = threads[id]; return t ? { getId: () => id, getMessages: () => t.msgs.map(mkMsg) } : null; },
  };
  const lockLog = log;
  const LockService = { getScriptLock: () => ({ waitLock: () => lockLog.push({ ev: "lock" }), releaseLock: () => lockLog.push({ ev: "unlock" }) }) };
  const triggers = [];
  const ScriptApp = {
    getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t.fn, getUniqueId: () => t.fn })),
    newTrigger: fn => { const t = { fn, every: null, onEdit: false }; const b = { timeBased: () => b, everyMinutes: n => { t.every = n; return b; }, forSpreadsheet: x => { t.ss = x; return b; }, onEdit: () => { t.onEdit = true; return b; }, create: () => { triggers.push(t); return t; } }; return b; },
    deleteTrigger: () => {},
  };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) };
  const MailApp = { getRemainingDailyQuota: () => (o.quota ?? 100) };
  const Session = { getEffectiveUser: () => ({ getEmail: () => "me@gmail.com" }), getScriptTimeZone: () => "UTC" };
  const Utilities = { formatDate: (d, tz, f) => f === "yyyy-MM-dd" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16).replace("T", " "), parseDate: (str, tz, f) => new Date(String(str).replace(" ", "T") + (f === "yyyy-MM-dd" ? "T00:00:00Z" : ":00Z")) };
  const Logger = { log() {} };
  const env = { SpreadsheetApp, GmailApp, MailApp, PropertiesService, LockService, ScriptApp, Session, Utilities, Logger };
  const names = ["onOpen", "sendInvites", "scanReplies", "installMailTriggers", "mailPublicWrite_", "adminPolish", "mailOnEdit", "mailDashboard_", "MAIL_SCHEMA"];
  let M;
  try { M = new Function(...Object.keys(env), SRC + "\nreturn {" + names.map(n => `${n}: typeof ${n}!=='undefined'?${n}:undefined`).join(",") + "};")(...Object.values(env)); }
  catch (e) { M = { _err: String(e) }; }
  const sheet = n => admin.getSheetByName(n);
  const invSheet = pub.getSheetByName("Invites");
  const addIncoming = (threadId, m) => { threads[threadId].msgs.push({ id: threadId + "m" + threads[threadId].msgs.length, ...m }); };
  return { M, log, admin, pub, sheet, invSheet, sent, alerts, opened, menus, triggers, threads, addIncoming, props };
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
  check("MA6a: live mode sends ONE email per person to the real address; subject/body come from InviteTemplate with {first} filled",
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
{
  const w = world({ props: { GFY_MAIL_TEST: "0" }, template: [["field", "text"], ["subject", ""], ["body", ""]] });
  const r = run(w, "sendInvites");
  check("MA9: empty InviteTemplate subject/body => alert, nothing sent", r.ok && w.sent.length === 0 && w.alerts.some(a => /InviteTemplate/.test(a.msg)), r.e || JSON.stringify(w.alerts));
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
  const okTabs = ["Replies", "SendLog", "InviteTemplate", "READ ME"].every(n => w.sheet(n) && JSON.stringify(w.sheet(n).rows[0]) === JSON.stringify(sch[n]));
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
  check("AP8: tab order Dashboard, Contacts, Replies, SendLog, InviteTemplate, READ ME; active tab ends on Dashboard; every tab coloured",
    names === "Dashboard,Contacts,Replies,SendLog,InviteTemplate,READ ME" && w.admin.active && w.admin.active.name === "Dashboard" && w.admin.sheets.every(s => !!s.tabColor), names);
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
  check("AP10: Contacts.player with no mailNorm_ match on the CURRENT-season public Invites is listed on the Dashboard (matches by trim/space/case are not) and highlighted via a rule that points at that list",
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
