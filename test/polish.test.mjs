// Offline behavioural tests for tools/sheet-polish.gs - polish round item 5
// (public sheet tidy: bounded checkbox window, START HERE legibility).
// Fake SpreadsheetApp only; nothing touches Google. Run: npm run check-polish
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(ROOT, "tools", "sheet-polish.gs"), "utf8");
let pass = 0, total = 0;
function check(name, ok, detail = "") {
  total++; if (ok) pass++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : "   [" + String(detail).slice(0, 400) + "]"));
}

const lenient = o => new Proxy(o, { get: (t, k) => (k in t ? t[k] : () => lenient({})) });
function mkSheet(name, rows, o = {}) {
  const sh = { name, rows: rows.map(r => r.slice()), maxRows: o.maxRows || 1000, validations: [], rules: null, wraps: [], widths: {}, writes: [] };
  const ensure = (r, c) => { while (sh.rows.length < r) sh.rows.push([]); const row = sh.rows[r - 1]; while (row.length < c) row.push(""); };
  sh.getName = () => name;
  sh.getSheetId = () => 1;
  sh.getLastRow = () => sh.rows.length;
  sh.getLastColumn = () => sh.rows.reduce((m, r) => Math.max(m, r.length), 0);
  sh.getMaxRows = () => Math.max(sh.maxRows, sh.rows.length);
  sh.getMaxColumns = () => Math.max(26, sh.getLastColumn());
  sh.insertColumnsAfter = () => {};
  sh.frozenCalls = 0; sh.protectCalls = 0; sh.setFrozenRows = () => { sh.frozenCalls++; }; sh.getProtections = () => []; sh.setColumnWidth = (c, w) => { sh.widths[c] = w; };
  sh.clear = () => { sh.rows = []; return sh; };
  sh.getDataRange = () => ({ getValues: () => { const w = sh.getLastColumn(); return sh.rows.map(r => { const x = r.slice(); while (x.length < w) x.push(""); return x; }); } });
  sh.setConditionalFormatRules = r => { sh.rules = r; };
  sh.getConditionalFormatRules = () => sh.rules || [];
  sh.getRange = (r, c, nr = 1, nc = 1) => typeof r === "string" ? lenient({ protect: () => { sh.protectCalls++; return lenient({}); } }) : lenient({
    getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((sh.rows[r - 1 + i] || [])[c - 1 + j] ?? ""); out.push(row); } return out; },
    setValue: v => { sh.writes.push({ r, c, v }); ensure(r, c); sh.rows[r - 1][c - 1] = v; },
    setValues: vs => { vs.forEach((row, i) => row.forEach((v, j) => { sh.writes.push({ r: r + i, c: c + j, v }); ensure(r + i, c + j); sh.rows[r - 1 + i][c - 1 + j] = v; })); },
    setDataValidation: dv => { sh.validations = sh.validations.filter(v => !(v.c === c && v.r === r && v.nr === nr)); sh.validations.push({ r, c, nr, nc, kind: dv && dv.kind }); },
    clearDataValidations: () => { sh.validations = sh.validations.filter(v => !(v.c >= c && v.c < c + nc && v.r >= r && v.r < r + nr)); },
    setWrap: w => { sh.wraps.push({ r, c, nr, nc, w }); },
  });
  return sh;
}
const mkRule = () => { const o = {}; const b = { whenFormulaSatisfied: () => b, setBackground: () => b, setRanges: () => b, build: () => o }; return b; };
const mkDV = () => { const o = { kind: null }; const b = { requireCheckbox: () => { o.kind = "checkbox"; return b; }, requireValueInList: () => { o.kind = "list"; return b; }, setAllowInvalid: () => b, setHelpText: () => b, build: () => o }; return b; };
function mkSS(sheets) {
  const ss = { sheets, active: null };
  ss.getSheetByName = n => ss.sheets.find(s => s.name === n) || null;
  ss.getSheets = () => ss.sheets; ss.getUrl = () => "https://example.invalid/sheet";
  ss.setActiveSheet = s => { ss.active = s; };
  ss.moveActiveSheet = i => { ss.sheets = ss.sheets.filter(s => s !== ss.active); ss.sheets.splice(i - 1, 0, ss.active); };
  ss.insertSheet = (n, i) => { const s = mkSheet(n, []); ss.sheets.splice(i, 0, s); return s; };
  return ss;
}
function loadPolish(ss) {
  const app = { getActiveSpreadsheet: () => ss, newConditionalFormatRule: mkRule, newDataValidation: mkDV, ProtectionType: { RANGE: "RANGE" } };
  return new Function("SpreadsheetApp", "Logger", SRC + "\nreturn { polish };")(app, { log() {} });
}
// a public-sheet tab with `n` real data rows then junk FALSE booleans down to row 1000
function junkTab(name, headers, dataRows, boolCols, maxRows = 1000) {
  const rows = [headers, ...dataRows];
  for (let r = rows.length + 1; r <= maxRows; r++) { const row = headers.map(() => ""); boolCols.forEach(c => { row[c] = false; }); rows.push(row); }
  return mkSheet(name, rows, { maxRows });
}
const blankFalse = (sh, cols, fromRow) => { let n = 0; for (let r = fromRow; r <= sh.rows.length; r++) cols.forEach(c => { const v = (sh.rows[r - 1] || [])[c]; if (v === false || v === "FALSE") n++; }); return n; };
const cbRanges = (sh, col) => sh.validations.filter(v => v.kind === "checkbox" && v.c === col);

{
  const inv = junkTab("Invites", ["year", "player", "invited", "responded", "status", "committed", "invited_by"], [[2027, "A One", true, false, "", false, ""], [2027, "B Two", false, false, "", true, ""], [2027, "C Three", true, true, "", false, ""]], [2, 3, 5]);
  const ss = mkSS([inv]);
  const r = (() => { try { loadPolish(ss).polish(); return { ok: true }; } catch (e) { return { ok: false, e: String(e) }; } })();
  const lastData = 4;   // header + 3 rows
  const cols = [3, 4, 6];
  check("PT1: checkbox validation on Invites invited/responded/committed is limited to (last data row + 50), not the whole 1000-row sheet",
    r.ok && cols.every(c => cbRanges(inv, c).length === 1 && cbRanges(inv, c)[0].r === 2 && cbRanges(inv, c)[0].r + cbRanges(inv, c)[0].nr - 1 <= lastData + 50 && cbRanges(inv, c)[0].r + cbRanges(inv, c)[0].nr - 1 >= lastData), r.e || JSON.stringify(inv.validations));
  check("PT2: blank-player rows beyond the window carry NO FALSE any more (the published CSV drops ~950 junk rows), and no validation survives there",
    r.ok && blankFalse(inv, [2, 3, 5], lastData + 51) === 0 && inv.validations.filter(v => v.kind === "checkbox").every(v => v.r + v.nr - 1 <= lastData + 50), r.e || String(blankFalse(inv, [2, 3, 5], lastData + 51)));
  check("PT3: real data rows are untouched (their FALSE/TRUE values stay)", JSON.stringify(inv.rows.slice(1, 4).map(x => x.slice(0, 6))) === JSON.stringify([[2027, "A One", true, false, "", false], [2027, "B Two", false, false, "", true], [2027, "C Three", true, true, "", false]]), JSON.stringify(inv.rows.slice(0, 4)));
  check("PT4: blank rows INSIDE the window keep their values (only the excess is cleaned)", blankFalse(inv, [2, 3, 5], lastData + 1) > 0 && inv.rows[lastData][2] === false, "");
  const snap = JSON.stringify([inv.rows, inv.validations]);
  loadPolish(ss).polish();
  check("PT5: running polish again changes nothing (idempotent)", JSON.stringify([inv.rows, inv.validations]) === snap);
}
{
  // a player row far down moves the window with it; a stray TRUE on a blank-player row beyond is not touched
  const rows = [["year", "player", "invited", "responded", "status", "committed", "invited_by"]];
  for (let r = 2; r <= 1000; r++) rows.push(["", "", false, false, "", false, ""]);
  rows[599] = [2027, "Far Down", true, false, "", false, ""];          // row 600
  rows[899][5] = true;                                                    // row 900 blank player, committed TRUE
  const inv = mkSheet("Invites", rows);
  loadPolish(mkSS([inv])).polish();
  check("PT6: window = last row with a year/player value + 50 (row 600 -> 650); a row with year/player data is never touched",
    inv.rows[599][1] === "Far Down" && inv.rows[599][2] === true && cbRanges(inv, 3)[0].r + cbRanges(inv, 3)[0].nr - 1 === 650 && inv.rows[650][2] === "" && inv.rows[640][2] === false, JSON.stringify([cbRanges(inv, 3), inv.rows[650]]));
  check("PT7: an excess blank-player row's non-FALSE value (a TRUE) is left alone", inv.rows[899][5] === true && inv.rows[898][5] === "");
}
{
  const field = junkTab("Field", ["year", "player", "team", "deposit", "handicap"], [[2027, "A One", "", true, 5]], [3]);
  const cal = junkTab("Calcutta", ["year", "player", "collected"], [[2027, "A One", false]], [2]);
  const led = junkTab("Ledger", ["year", "player", "settled"], [[2027, "A One", true]], [2]);
  const ss = mkSS([field, cal, led]);
  let err = ""; try { loadPolish(ss).polish(); } catch (e) { err = String(e); }
  check("PT8: the same rule holds for every CHECKBOX_COLS tab (Field.deposit, Calcutta.collected, Ledger.settled): excess blank rows drop their FALSE",
    !err && blankFalse(field, [3], 53) === 0 && blankFalse(cal, [2], 53) === 0 && blankFalse(led, [2], 53) === 0 && field.rows[1][3] === true && cal.rows[1][2] === false, err);
}
{
  // START HERE
  const info = (extra) => mkSheet("Info", [["key", "value"], ["first_tee", "2099-06-01"], ...extra]);
  const run = (infoRows, startRows) => {
    const sh = mkSheet("START HERE", startRows || []);
    const ss = mkSS([sh, info(infoRows), mkSheet("Field", [["year", "player", "team"]])]);
    loadPolish(ss).polish();
    return sh;
  };
  const txt = sh => sh.rows.map(r => String(r[0])).join("\n");
  const full = run([["score_endpoint", "https://x.invalid/exec"], ["form_url", "https://forms.invalid/f"]]);
  check("PT9: Info carries score_endpoint + form_url -> the legacy 'Scoring config moved' row (and its value row) is dropped from START HERE", !/Scoring config moved/.test(txt(full)), txt(full).slice(0, 300));
  const partial = run([["score_endpoint", "https://x.invalid/exec"]]);
  check("PT10: Info lacks form_url -> the legacy row is KEPT (never lose the only copy)", /Scoring config moved/.test(txt(partial)));
  const none = run([], [["Scoring form URL (paste once)", "https://forms.invalid/old"]]);
  check("PT11: Info has neither -> the old pasted value is still carried forward", /Scoring config moved/.test(txt(none)) && none.rows.some(r => r[1] === "https://forms.invalid/old"), JSON.stringify(none.rows.slice(0, 12)));
  check("PT12: START HERE column A wraps text and is widened beyond the old 340px", full.wraps.some(w => w.c === 1 && w.w === true && w.nr >= full.rows.length - 1) && full.widths[1] > 340, JSON.stringify([full.wraps, full.widths]));
  const written = full.writes.map(w => w.v).concat(full.rows.flat());
  check("PT13: nothing written to START HERE carries an '@' (published tab)", !written.some(v => /@/.test(String(v))));
}

{
  // WO-ONE-FILE item 3: private tabs (Contacts, Replies, RSVP, SendLog, Dashboard, Admin READ ME) live in the same
  // spreadsheet. Public polish leaves their data/format alone and keeps them AFTER every public tab.
  const priv = () => [
    mkSheet("Contacts", [["player", "email", "email_alt", "phone", "do_not_invite", "reason", "notes"], ["Alice Able", "alice@example.com", "", "", "FALSE", "", ""]]),
    mkSheet("Replies", [["date", "player", "from", "snippet", "looks_yes", "confirm", "msg_id"], ["2027-01-02", "Alice Able", "A <a@example.com>", "yes", "TRUE", "FALSE", "m1"]]),
    mkSheet("RSVP", [["year", "player", "token", "answer", "answered_at", "history", "test"]]),
    mkSheet("SendLog", [["date", "player", "address_used", "what", "note", "thread_id"]]),
    mkSheet("Dashboard", [["GFY Admin Dashboard"]]),
    mkSheet("Admin READ ME", [["warning", "last_reply_scan"], ["be careful", ""]]),
  ];
  const pubs = () => [
    junkTab("Invites", ["year", "player", "invited", "responded", "status", "committed", "invited_by"], [[2027, "A One", true, false, "", false, ""]], [2, 3, 5]),
    mkSheet("Field", [["year", "player", "team", "deposit", "handicap"], [2027, "A One", "", true, 5]]),
    mkSheet("Info", [["key", "value"], ["first_tee", "2099-06-01"]]),
    mkSheet("Rooms", [["room", "player"]]),
    mkSheet("START HERE", []),
  ];
  const snapPriv = ss => JSON.stringify(ss.sheets.filter(x => PRIV.includes(x.name)).sort((a, b) => a.name < b.name ? -1 : 1).map(x => [x.name, x.rows, x.validations, x.rules, x.wraps, x.writes, x.frozenCalls, x.protectCalls]));
  const PRIV = ["Contacts", "Replies", "RSVP", "SendLog", "Dashboard", "Admin READ ME"];
  const ss = mkSS([...priv().slice(0, 3), ...pubs(), ...priv().slice(3)]);   // private tabs scattered among the public ones
  const before = snapPriv(ss);
  let err = ""; try { loadPolish(ss).polish(); } catch (e) { err = String(e); }
  check("PC1: public polish() leaves every private tab alone - no write, no checkbox/validation, no rule, no frozen row, no header protection", !err && snapPriv(ss) === before, err || snapPriv(ss).slice(0, 300));
  const names = ss.sheets.map(x => x.name);
  const lastPublic = Math.max(...names.map((n, i) => PRIV.includes(n) ? -1 : i)), firstPriv = Math.min(...names.map((n, i) => PRIV.includes(n) ? i : 99));
  check("PC2: polish orders the private tabs AFTER every public tab (START HERE, Field, Invites, Rooms first)", !err && firstPriv > lastPublic && names.slice(0, 4).join() === "START HERE,Field,Invites,Rooms", names.join());
  const orderAfter1 = names.join(), snapAll = JSON.stringify(ss.sheets.map(x => [x.name, x.rows, x.validations, x.writes.length]));
  const moves = []; const mv = ss.moveActiveSheet; ss.moveActiveSheet = i => { moves.push(i); mv(i); };
  loadPolish(ss).polish();
  check("PC3: a second polish() changes nothing: same tab order, same data, no tab moved, private tabs still untouched", ss.sheets.map(x => x.name).join() === orderAfter1 && moves.length === 0 && snapPriv(ss) === before && JSON.stringify(ss.sheets.map(x => [x.name, x.rows, x.validations])) === JSON.stringify(JSON.parse(snapAll).map(([n, r, v]) => [n, r, v])), moves.join());
  const inEvent = mkSS([...priv(), mkSheet("Info", [["key", "value"], ["first_tee", new Date().toISOString().slice(0, 10)]]), mkSheet("Scores", [["year"]]), mkSheet("Field", [["year", "player"]]), mkSheet("Pairings", [["year"]]), mkSheet("START HERE", [])]);
  loadPolish(inEvent).polish();
  const en = inEvent.sheets.map(x => x.name), lp = Math.max(...en.map((n, i) => PRIV.includes(n) ? -1 : i)), fp = Math.min(...en.map((n, i) => PRIV.includes(n) ? i : 99));
  check("PC4: ... also in the event-week order (START HERE, Scores, Field, Pairings): private tabs still come last", fp > lp && en.slice(0, 4).join() === "START HERE,Scores,Field,Pairings", en.join());
}

console.log(`\nPOLISH ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
