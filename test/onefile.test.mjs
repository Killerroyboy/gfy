// Offline tests for the ONE-FILE layout (WO-ONE-FILE): the four Apps Script files that share ONE global scope in
// the GFY Tournament project, and the publish guard (tools/check-publish.mjs). No network, no Google.
// Run: npm run check-onefile
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const T = f => path.join(ROOT, "tools", f);
let pass = 0, total = 0;
function check(name, ok, detail = "") {
  total++; if (ok) pass++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : "   [" + String(detail).slice(0, 400) + "]"));
}

// The deployable project, by its clasp name -> the canonical repo source (one owner: tools/).
// clasp pushes in name order: Code.gs, gfy-mailer.gs, gfy-promote.gs, triggers.gs.
const CLASP_FILES = { "Code.gs": "sheet-polish.gs", "gfy-mailer.gs": "gfy-mailer.gs", "gfy-promote.gs": "gfy-promote.gs", "triggers.gs": "sheet-triggers.gs" };
const claspOrder = Object.keys(CLASP_FILES).sort();
const src = n => readFileSync(T(CLASP_FILES[n]), "utf8");

// Every top-level declaration, per file. function/var land on the global object of a fresh context; let/const/class
// do not, so a SECOND pass loads all files into ONE context where V8 itself rejects a duplicate let/const/class and a
// function-vs-const clash. (Duplicate function-vs-function is silent in V8 - Apps Script too - so it is found by
// intersecting the per-file global names.)
function declsOf(code) {
  const ctx = vm.createContext({}); const before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(code, ctx);
  return Object.getOwnPropertyNames(ctx).filter(k => !before.has(k));
}
function scopeReport(order) {
  const owners = new Map(); const problems = [];
  for (const n of order) {
    let names; try { names = declsOf(src(n)); } catch (e) { problems.push(n + " does not load on its own: " + e.message); continue; }
    for (const k of names) { owners.set(k, (owners.get(k) || []).concat(n)); }
  }
  for (const [k, fs] of owners) if (fs.length > 1) problems.push(`${k} is declared in ${fs.join(" AND ")}`);
  const ctx = vm.createContext({});
  for (const n of order) { try { vm.runInContext(src(n), ctx, { filename: n }); } catch (e) { problems.push(`loading ${n} after the earlier files: ${e.message}`); } }
  return problems;
}

{
  const p = scopeReport(claspOrder);
  check("OF1: the four project files load into ONE global scope with no duplicate top-level declaration (function, const, let, var, class)", p.length === 0, p.join(" | "));
  const q = scopeReport(claspOrder.slice().reverse());
  check("OF2: ... in either file order (nothing relies on which file loads first)", q.length === 0, q.join(" | "));
}

// ---- the merged scope, run with tiny fakes: ONE onOpen (both menus) and ONE doGet (router) ----
function mergedWorld() {
  const menus = []; const out = {};
  const sh = rows => ({ getDataRange: () => ({ getValues: () => rows }) });
  const ss = { getSheetByName: n => ({ Info: sh([["key", "value"], ["first_tee", "2027-08-14T09:00:00-06:00"]]), Field: sh([["year", "player", "team"], [2027, "A", "Eagles"], [2027, "B", "Birdies"]]) })[n] || null,
    getId: () => "TOURNEY", getSheets: () => [] };
  const ui = { createMenu: t => { const m = { title: t, items: [] }; const b = { addItem: (l, f) => { m.items.push([l, f]); return b; }, addSeparator: () => b, addToUi: () => { menus.push(m); } }; return b; } };
  const SpreadsheetApp = { getUi: () => ui, getActive: () => ss, getActiveSpreadsheet: () => ss, openById: () => { throw new Error("no"); } };
  const mk = (kind) => (content) => { const o = { kind, content, mime: null, setMimeType: m => { o.mime = m; return o; }, setTitle: () => o, addMetaTag: () => o, getContent: () => content }; return o; };
  const ContentService = { createTextOutput: mk("text"), MimeType: { JSON: "JSON" } };
  const HtmlService = { createHtmlOutput: mk("html") };
  const props = {};
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getKeys: () => Object.keys(props) }) };
  const ctx = vm.createContext({ SpreadsheetApp, ContentService, HtmlService, PropertiesService, Logger: { log() {} }, Session: { getScriptTimeZone: () => "UTC" } });
  for (const n of claspOrder) vm.runInContext(src(n), ctx, { filename: n });
  return { ctx, menus, props };
}
const call = (w, expr) => vm.runInContext(expr, w.ctx);
{
  const w = mergedWorld();
  let err = ""; try { call(w, "onOpen()"); } catch (e) { err = String(e); }
  const titles = w.menus.map(m => m.title);
  const gfy = w.menus.find(m => m.title === "GFY"), mail = w.menus.find(m => m.title === "GFY Mail");
  check("OF3: ONE onOpen builds BOTH menus - 'GFY' (promote / seed / polish) and 'GFY Mail' (send invites...)",
    !err && !!gfy && !!mail && titles.length === 2
    && gfy.items.some(([l, f]) => f === "promoteCommitted") && gfy.items.some(([l, f]) => f === "seedInvites") && gfy.items.some(([l, f]) => f === "polish")
    && mail.items.some(([l, f]) => f === "sendInvites"), err || JSON.stringify(w.menus));
}
{
  const w = mergedWorld();
  const scorer = call(w, "scorerDoGet_()");
  const same = o => o && o.kind === scorer.kind && o.content === scorer.content && o.mime === scorer.mime;
  const parsed = (() => { try { return JSON.parse(scorer.content); } catch { return null; } })();
  check("OF4: the scorer's doGet answer is unchanged - identity envelope, year 2027, both teams", !!parsed && parsed.ok === true && parsed.handler === "gfy-scorer" && parsed.writes === true && parsed.contract === 1 && parsed.year === 2027 && parsed.teams.length === 2, scorer.content);
  check("OF5: doGet with no event, an empty event, or any non-RSVP query -> the scorer's response, byte-identical",
    same(call(w, "doGet()")) && same(call(w, "doGet({})")) && same(call(w, "doGet({parameter:{}})")) && same(call(w, "doGet({parameter:{foo:'bar'}})")) && same(call(w, "doGet({parameter:{T:'x'}})")),
    "");
  const rsvp = call(w, "doGet({parameter:{t:'A'.repeat(24)}})");
  check("OF6: doGet with the RSVP token parameter 't' -> the RSVP page (HTML), never the scorer JSON", rsvp.kind === "html" && /This link is not valid/.test(rsvp.content), rsvp.kind + String(rsvp.content).slice(0, 80));
  const rsvp2 = call(w, "doGet({parameter:{t:''}})");
  check("OF7: an RSVP request with an empty token still goes to the RSVP page (a bare ?t= is a mailer link, not a scorer probe)", rsvp2.kind === "html", rsvp2.kind);
}

console.log(`\nONEFILE ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
