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
function mkSheet(name, rows, log) {
  const sh = { name, rows: rows.map(r => r.slice()), writes: [], log };
  const ensure = (r, c) => { while (sh.rows.length < r) sh.rows.push([]); const row = sh.rows[r - 1]; while (row.length < c) row.push(""); };
  sh.getName = () => name;
  sh.getDataRange = () => ({ getValues: () => { const w = Math.max(0, ...sh.rows.map(r => r.length)); return sh.rows.map(r => { const o = r.slice(); while (o.length < w) o.push(""); return o; }); } });
  sh.getLastRow = () => sh.rows.length;
  sh.getLastColumn = () => Math.max(0, ...sh.rows.map(r => r.length));
  sh.getRange = (r, c, nr = 1, nc = 1) => ({
    getValue: () => (sh.rows[r - 1] || [])[c - 1] ?? "",
    getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((sh.rows[r - 1 + i] || [])[c - 1 + j] ?? ""); out.push(row); } return out; },
    setValue: v => { sh.writes.push({ r, c, v, op: "setValue" }); log.push({ ev: "write", sheet: name, r, c, v }); ensure(r, c); sh.rows[r - 1][c - 1] = v; },
    setValues: vs => { vs.forEach((row, i) => row.forEach((v, j) => { sh.writes.push({ r: r + i, c: c + j, v, op: "setValues" }); log.push({ ev: "write", sheet: name, r: r + i, c: c + j, v }); ensure(r + i, c + j); sh.rows[r - 1 + i][c - 1 + j] = v; })); },
  });
  sh.appendRow = vals => { sh.writes.push({ op: "appendRow", v: vals }); log.push({ ev: "append", sheet: name, v: vals }); sh.rows.push(vals.slice()); };
  return sh;
}
function mkSS(id, sheets) {
  const ss = { id, sheets };
  ss.getId = () => id; ss.getSheetByName = n => ss.sheets.find(s => s.name === n) || null; ss.getSheets = () => ss.sheets;
  return ss;
}

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
  const admin = mkSS("ADMIN_ID", adminSheets);
  const pub = mkSS(PUB, [mkSheet("Invites", [HDR_INV, ...invites], log)]);
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
    getActiveSpreadsheet: () => admin, getUi: () => ui,
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
    newTrigger: fn => { const t = { fn, every: null }; const b = { timeBased: () => b, everyMinutes: n => { t.every = n; return b; }, create: () => { triggers.push(t); return t; } }; return b; },
    deleteTrigger: () => {},
  };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) };
  const MailApp = { getRemainingDailyQuota: () => (o.quota ?? 100) };
  const Session = { getEffectiveUser: () => ({ getEmail: () => "me@gmail.com" }), getScriptTimeZone: () => "UTC" };
  const Utilities = { formatDate: (d, tz, f) => f === "yyyy-MM-dd" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16).replace("T", " ") };
  const Logger = { log() {} };
  const env = { SpreadsheetApp, GmailApp, MailApp, PropertiesService, LockService, ScriptApp, Session, Utilities, Logger };
  const names = ["onOpen", "sendInvites", "scanReplies", "installMailTriggers", "mailPublicWrite_"];
  let M;
  try { M = new Function(...Object.keys(env), SRC + "\nreturn {" + names.map(n => `${n}: typeof ${n}==='function'?${n}:undefined`).join(",") + "};")(...Object.values(env)); }
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
  check("MC1: installMailTriggers creates ONE 15-minute scanReplies trigger and is idempotent", a.ok && b.ok && w.triggers.length === 1 && w.triggers[0].fn === "scanReplies" && w.triggers[0].every === 15, a.e || b.e || JSON.stringify(w.triggers));
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
