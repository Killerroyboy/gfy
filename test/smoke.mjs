// Headless smoke test: loads index.html in jsdom, stubs fetch to serve the
// CSV fixtures, and asserts the rendered DOM. Run:  npm test
// Must pass before every deploy.
//
// v2 (team scramble) assertion suite. This suite encodes the TARGET state
// from docs/superpowers/plans/2026-07-28-gfy-v2-team-scramble.md and is
// expected to go mostly RED at commit time — tasks 3-8 turn it green group
// by group (A-C @ task 3, D @ task 4, E @ task 5, F @ task 6, G/H @ task 7,
// I @ task 8). Do not "fix" the app here; that is later tasks' job.
//
// Group W (v2.1 "Invites") added at task 12 — the next-year funnel that
// tracks outreach (invited/responded) ahead of who's actually paid.
//
// v2.2 Wave 1 (task 13, docs/superpowers/specs/2026-07-28-gfy-v2-teams-design.md
// §12) hardens the anchors/dates, makes the funnel counts-only public with
// names gated behind ?admin=1, fixes the S-STALE live bug, and derives
// VIEWS/nav order from the DOM. Group W is rewritten (not just extended) for
// the new semantics; groups A/F/G/H gain a few checks; groups M and S are
// new.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsdom from "jsdom";
import {
  checkFirstTee, checkResidue, checkSchedule, checkPairings, checkPars,
  checkScorer, checkField, checkAnnounce, checkCrossTab, checkFallbackParity,
  checkInvitesPromotion,
} from "../tools/event-ready.mjs";

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");

const TABS = ["info","course","field","scores","schedule","pairings",
              "calcutta","payout","ledger","champions","shame","invites","rooms","announce"];
const GIDS = {};
TABS.forEach((t, i) => GIDS[t] = String(101 + i));
const FIXTURES = {};
TABS.forEach(t => FIXTURES[t] = readFileSync(path.join(ROOT, "fixtures", t + ".csv"), "utf8"));

// `buildTestConfig` defaults to the standard GIDS map so every existing call
// site (`testConfig`) behaves exactly as in v2. Group W's "invites tab
// absent" variant (W6) overrides just GID.invites to "" to simulate an
// unconfigured 12th tab without touching any other tab's gid.
function buildTestConfig(gidOverrides = {}) {
  const gid = Object.assign({}, GIDS, gidOverrides);
  return `window.CONFIG = { PUB_ID:"TESTPUB", GID:${JSON.stringify(gid)},
  SHEET_EDIT_URL:"", DRIVE_FOLDER_ID:"", FIRST_TEE:"2026-08-15T09:00:00-06:00",
  CURRENCY:"$", REFRESH_MS:3600000 };`;
}
const testConfig = buildTestConfig();

// Z group: empty config for unconfigured deploy (empty PUB_ID/GID)
const emptyGids = {};
TABS.forEach(t => emptyGids[t] = "");
// Z2 asserts a RUNNING countdown off the config fallback, so this FIRST_TEE must be
// far-future (E2's idiom) — a real-calendar date here is a time bomb: the suite went
// 214/215 the day after 2026-08-15 passed, with zero code changes.
const emptyConfig = `window.CONFIG = { PUB_ID:"", GID:${JSON.stringify(emptyGids)},
  SHEET_EDIT_URL:"", DRIVE_FOLDER_ID:"", FIRST_TEE:"2099-08-15T09:00:00-06:00",
  CURRENCY:"$", REFRESH_MS:3600000 };`;

function fakeFetch(url) {
  const gid = new URL(url).searchParams.get("gid");
  const tab = TABS.find(t => GIDS[t] === gid);
  if (!tab) return Promise.resolve({ ok: false, status: 404, text: async () => "no such gid" });
  return Promise.resolve({ ok: true, status: 200, text: async () => FIXTURES[tab] });
}

const envNoise = /not implemented|could not parse css/i;
// `fetchImpl` defaults to the standard fixture stub (fakeFetch) so every
// existing call site (`makeDom("")`, `makeDom("?debug=1")`) behaves exactly
// as in v1. Variant doms (B2, D1, D2, E2, E3) pass a wrapped stub that
// overrides one tab's response — see `withOverride` below. `configText`
// defaults to the standard `testConfig` so every pre-invites call site is
// unaffected; W6 passes a `buildTestConfig({invites:""})` variant to
// simulate the Invites tab being unconfigured.
function makeDom(query, fetchImpl = fakeFetch, configText = testConfig) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!envNoise.test(e.message)) errors.push(e.message + (e.cause ? " :: " + e.cause : "")); });
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: "http://localhost/" + query, virtualConsole: vc,
    beforeParse(window) { window.fetch = fetchImpl; },
    resources: { interceptors: [requestInterceptor((request) => {
      if (request.url.endsWith("/config.js"))
        return new Response(configText, { headers: { "Content-Type": "application/javascript" } });
      return new Response("", { headers: { "Content-Type": "text/css" } });
    })] },
  });
  dom.pageErrors = errors;
  return dom;
}

async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); }
  return false;
}

const results = [];
function check(name, ok, detail = "") {
  results.push([name, ok, detail]);
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : "   [" + detail + "]"));
}

/* ---------- helpers for variant doms + soft DOM matching ---------- */

// Build a fetch stub that serves the default fixture bytes for every tab
// EXCEPT the ones named in `overrides`, where `overrides[tab](url)` supplies
// the Response-like object instead. Pattern: wrap the default stub, override
// one tab (per the controller's variant-dom instruction).
function withOverride(overrides) {
  return function (url) {
    const gid = new URL(url).searchParams.get("gid");
    const tab = TABS.find(t => GIDS[t] === gid);
    if (tab && overrides[tab]) return overrides[tab](url);
    return fakeFetch(url);
  };
}

const settle = (ms = 2000) => new Promise(r => setTimeout(r, ms));

// True if `html` (an innerHTML string) marks `captain` with class="cap".
function capMarked(html, captain) {
  const esc = captain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp('class="cap">\\s*' + esc).test(html || "");
}

// Walk up from `el` looking for an ancestor whose textContent includes
// `needle` (used when the exact wrapping element for a badge/strip isn't
// specified by the DOM contract).
function nearestTextAncestor(el, needle, maxDepth = 6) {
  let cur = el;
  for (let i = 0; i < maxDepth && cur; i++) {
    if (cur.textContent && cur.textContent.includes(needle)) return true;
    cur = cur.parentElement;
  }
  return false;
}

// §24 announce-tab helpers (hoisted to file scope so Task 3+ can reuse
// `iso`, not just X48-X50). `annCsv` builds an announce-tab CSV fixture from
// [year, when, message] rows; `iso` formats an epoch ms as the
// "YYYY-MM-DD HH:MM" string `parseWhen` accepts, in local time (relative-to-
// now — never a real-calendar literal, per the no-time-bomb rule).
const annCsv = (rows) => "year,when,message\n" + rows.map(r => r.join(",")).join("\n");
const iso = (ms) => {
  const d = new Date(ms); const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// §24 test rule: no real-calendar dates. Event fixtures are built RELATIVE to now.
// dynInfo(daysFromNow) → an info CSV whose first_tee is now+days at 09:00 in a
// FIXED -06:00 offset regardless of the machine's TZ (offset math is the thing
// under test — the resolver must be TZ-independent by construction).
function dynFirstTee(daysFromNow){
  const d=new Date(Date.now()+daysFromNow*86400000);
  // format the McCall wall-date of that instant using -06:00
  const mc=new Date(d.getTime()-6*3600000);
  const p=n=>String(n).padStart(2,"0");
  return `${mc.getUTCFullYear()}-${p(mc.getUTCMonth()+1)}-${p(mc.getUTCDate())}T09:00:00-06:00`;
}
function dynInfo(daysFromNow){
  return FIXTURES.info.replace("2026-08-15T09:00:00-06:00", dynFirstTee(daysFromNow));
}

/* =====================================================================
   Main dom — default fixtures, 2026 selected by default (activeSeason).
   ===================================================================== */
const dom = makeDom("");
const doc = dom.window.document;
await until(() => doc.querySelectorAll("#lbBody .lb-row").length > 0);

/* ---------------------------------------------------------------------
   GROUP A — canonical keys & scoring guards (Task 3)
   --------------------------------------------------------------------- */
const rows = [...doc.querySelectorAll("#lbBody .lb-row")].map(r => ({
  pos: r.querySelector(".lb-pos")?.textContent,
  name: r.querySelector(".lb-name")?.textContent,
  nameHTML: r.querySelector(".lb-name")?.innerHTML || "",
  thru: r.querySelector(".lb-thru")?.textContent,
  r1: r.querySelector(".lb-r1")?.textContent,
  r2: r.querySelector(".lb-r2")?.textContent,
  total: r.querySelectorAll(".lb-tot")[0]?.textContent,
  toPar: r.querySelectorAll(".lb-tot")[1]?.textContent,
}));

check("A1: board has exactly 5 rows (Hamer excluded, duck merged — not 6, not 7)",
  rows.length === 5, "count=" + rows.length + " names=" + JSON.stringify(rows.map(r => r.name)));

const expectedA = [
  { id: "A2", pos: "1", name: "Duck",                   cap: "Duck",  thru: "F",      r1: "74", r2: "74", total: "148", toPar: "+4" },
  { id: "A3", pos: "1", name: "Sully",                  cap: "Sully", thru: "F",      r1: "75", r2: "73", total: "148", toPar: "+4" },
  { id: "A4", pos: "3", name: "Tex",                    cap: "Tex",   thru: "R2 · 7", r1: "77", r2: "27", total: "104", toPar: "+5" },
  { id: "A5", pos: "4", name: "Moose",                  cap: "Moose", thru: "F",      r1: "76", r2: "74", total: "150", toPar: "+6" },
  { id: "A6", pos: "5", name: "Bear",                   cap: "Bear",  thru: "totals", r1: "76", r2: "76", total: "152", toPar: "+8" },
];
expectedA.forEach((e, i) => {
  const g = rows[i] || {};
  check(`${e.id}: row ${i + 1} — ${e.name} ${e.toPar} (team display + captain span)`,
    g.pos === e.pos && g.name === e.name && g.total === e.total && g.toPar === e.toPar
      && g.r1 === e.r1 && g.r2 === e.r2 && capMarked(g.nameHTML, e.cap),
    JSON.stringify(g));
});

check("A7: Sully R1 total is 75 (h9 conflict 5→6 resolved, later wins)",
  rows[1]?.r1 === "75", rows[1] && JSON.stringify(rows[1]));
check("A8: Tex thru is 'R2 · 7' (h1=0 not a score)",
  rows[2]?.thru === "R2 · 7", rows[2] && JSON.stringify(rows[2]));
check("A9: Moose has BOTH rounds (76/74 — word round labels didn't collide)",
  rows[3]?.r1 === "76" && rows[3]?.r2 === "74", rows[3] && JSON.stringify(rows[3]));

/* ---------------------------------------------------------------------
   GROUP A (cont'd) — A-SANE (v2.2 Wave 1, Task 13): activeSeason() ignores
   a Scores year past first_tee+1 (typo guard), and every year cell across
   every tab is parseInt-normalized at ingest (commas/decimals tolerated,
   truly unparseable text flagged and excluded from year filtering).
   --------------------------------------------------------------------- */
{
  const scoresOutlier = FIXTURES.scores + "2099,Duck,1,4,4,4,5,4,4,4,4,5,4,5,3,4,4,4,3,5,4,,\n";
  const outlierFetch = withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresOutlier }),
  });
  const domA10 = makeDom("", outlierFetch);
  await until(() => domA10.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const yearBtnsA10 = [...domA10.window.document.querySelectorAll("#years .year-btn")];
  const pressedA10 = yearBtnsA10.find(b => b.getAttribute("aria-pressed") === "true");
  const healthTextA10 = domA10.window.document.querySelector("#healthStrip")?.textContent || "";
  check("A10: A-SANE — a Scores year past first_tee+1 (2099) does not win activeSeason (still 2026), and is flagged",
    !!pressedA10 && pressedA10.textContent.trim() === "2026" && /2099/.test(healthTextA10),
    "pressed=" + (pressedA10 ? pressedA10.textContent : "none") + " health=" + healthTextA10.slice(0, 240));
  domA10.window.close();
}

{
  // CSV-quote the comma-formatted year so it stays one field, not two.
  const fieldCommaYear = FIXTURES.field.replace("2026,Bear,Bear,2023,11,In,TRUE,", '"2,026",Bear,Bear,2023,11,In,TRUE,');
  const commaFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldCommaYear }),
  });
  const domA11a = makeDom("", commaFetch);
  await until(() => domA11a.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const fldTextA11a = domA11a.window.document.querySelector("#fldBody")?.textContent || "";
  const healthTextA11a = domA11a.window.document.querySelector("#healthStrip")?.textContent || "";
  check("A11a: A-SANE — comma-formatted year cell ('2,026') parseInt-normalizes cleanly; Bear still shows in the 2026 Field roster, no spurious flag",
    /Bear/.test(fldTextA11a) && !/unparseable/i.test(healthTextA11a),
    "fld=" + fldTextA11a.slice(0, 160) + " health=" + healthTextA11a.slice(0, 200));
  domA11a.window.close();
}

{
  const fieldBadYear = FIXTURES.field.replace("2026,Bear,Bear,2023,11,In,TRUE,", "N/A,Bear,Bear,2023,11,In,TRUE,");
  const badFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldBadYear }),
  });
  const domA11b = makeDom("", badFetch);
  await until(() => domA11b.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const fldTextA11b = domA11b.window.document.querySelector("#fldBody")?.textContent || "";
  const healthTextA11b = domA11b.window.document.querySelector("#healthStrip")?.textContent || "";
  check("A11b: A-SANE — unparseable year cell ('N/A') is flagged and the row drops out of year filtering rather than silently matching",
    /unparseable/i.test(healthTextA11b) && /N\/A/.test(healthTextA11b) && !/Bear/.test(fldTextA11b),
    "fld=" + fldTextA11b.slice(0, 160) + " health=" + healthTextA11b.slice(0, 200));
  domA11b.window.close();
}

/* ---------------------------------------------------------------------
   GROUP B — season/year (Task 3)
   --------------------------------------------------------------------- */
const fldBodyText = doc.querySelector("#fldBody")?.textContent || "";
check("B1: with 2027 Field rows present and 2026 selected, Field shows only 2026 rows (no all-years merge)",
  /Duck/.test(fldBodyText) && !/Crash/.test(fldBodyText),
  fldBodyText.slice(0, 200));

{
  const scoresHeaderOnly = FIXTURES.scores.split(/\r\n|\n/)[0] + "\r\n";
  const emptyScoresFetch = withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresHeaderOnly }),
  });
  const domB2 = makeDom("", emptyScoresFetch);
  await settle();
  const fldBodyTextB2 = domB2.window.document.querySelector("#fldBody")?.textContent || "";
  check("B2: empty-Scores variant still shows the 2026 Field roster, not merged years",
    /Duck/.test(fldBodyTextB2) && !/Crash/.test(fldBodyTextB2),
    fldBodyTextB2.slice(0, 200));
  domB2.window.close();
}

/* ---------------------------------------------------------------------
   GROUP C — roster (Task 3)
   --------------------------------------------------------------------- */
const teamGroups = [...doc.querySelectorAll("#fldBody .team-group")];
check("C1: Field tab groups 5 teams", teamGroups.length === 5, "count=" + teamGroups.length);

{
  const bearGroup = teamGroups.find(g => /Bear/.test(g.textContent || ""));
  const bearRows = bearGroup?.querySelectorAll(".fld")?.length ?? 0;
  check("C2: Bear renders as roster-of-one",
    !!bearGroup && bearRows === 1,
    "bearGroup found=" + !!bearGroup + " rows=" + bearRows);
}

{
  const rookieStrip = doc.querySelector(".rookie-strip");
  const rsText = rookieStrip?.textContent || "";
  const otherNames = ["Duck", "Hammer", "Sully", "Moose", "Sock", "Tex", "Bear"];
  const hasOtherName = otherNames.some(n => rsText.includes(n));
  check("C3: rookie strip lists exactly Tank",
    rsText.includes("Rookie Class of 2026") && rsText.includes("Tank") && !hasOtherName,
    rsText);
}

/* ---------------------------------------------------------------------
   GROUP D — resilience (Task 4)
   --------------------------------------------------------------------- */
{
  const scores500Fetch = withOverride({
    scores: () => Promise.resolve({ ok: false, status: 500, text: async () => "server error" }),
  });
  const domD1 = makeDom("", scores500Fetch);
  await settle();
  const d1doc = domD1.window.document;
  const schedText = d1doc.querySelector("#scheduleBody")?.textContent || "";
  const fldText = d1doc.querySelector("#fldBody")?.textContent || "";
  const lbSyncText = d1doc.querySelector("#lbSync")?.textContent || "";
  check("D1: scores tab 500s — other sections still render live data, board shows its own stale/failed stamp",
    /Bear Creek Lodge|Meadow Creek|Friday/i.test(schedText) && /Duck/.test(fldText)
      && lbSyncText.trim().length > 0 && !/^Updated/i.test(lbSyncText.trim()),
    "sched=" + schedText.slice(0, 40) + " | fld=" + fldText.slice(0, 40) + " | lbSync=" + lbSyncText);
  domD1.window.close();
}

{
  const swapFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => FIXTURES.scores }),
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => FIXTURES.field }),
  });
  const domD2 = makeDom("", swapFetch);
  await settle();
  const healthText = domD2.window.document.querySelector("#healthStrip")?.textContent || "";
  domD2.window.close();

  const domD2dbg = makeDom("?debug=1", swapFetch);
  await until(() => domD2dbg.window.document.getElementById("debugPanel"));
  const dbgText = domD2dbg.window.document.getElementById("debugPanel")?.textContent || "";
  domD2dbg.window.close();

  check("D2: swapped field/scores gids — health strip AND debug panel report a fingerprint mismatch",
    /gid swapped|doesn't look like|fingerprint/i.test(healthText)
      && /FAILED/i.test(dbgText) && /gid swapped|doesn't look like|header/i.test(dbgText),
    "health=" + healthText.slice(0, 160) + " | debug=" + dbgText.slice(0, 200));
}

{
  // v2.2 Wave 2 recompute (D3 semantics — the count legitimately changes
  // when fixtures/behavior change): the original 4 (Hamer unmatched, Sully
  // h9 merge conflict, Moose blank-year default, Sock's Field-2027 status
  // ignored) plus 3 new Rooms flags from fixtures/rooms.csv's deliberately
  // planted cases (Hammer assigned-but-not-paid, Zeke unknown-name, Duck
  // double-booked across Lodge·1 and Cabin·A) = 7. Exact new set documented
  // in the task-14 report.
  const healthMainText = doc.querySelector("#healthStrip")?.textContent || "";
  const warnMatch = healthMainText.match(/(\d+)\s*(data )?warning/i);
  const warnCount = warnMatch ? parseInt(warnMatch[1], 10) : -1;
  check("D3: health strip shows exactly the 7 expected flags (4 original + 3 new Rooms flags: Hammer unpaid, Zeke unknown, Duck double-booked)",
    warnCount === 7 && /Hamer/i.test(healthMainText) && /h9/i.test(healthMainText)
      && /(blank|defaulted)/i.test(healthMainText) && /ignored/i.test(healthMainText) && /Sock/.test(healthMainText)
      && /not on the paid list/i.test(healthMainText) && /Zeke/.test(healthMainText)
      && /assigned to two rooms/i.test(healthMainText) && /Duck/.test(healthMainText),
    healthMainText);
}

{
  const calSyncText = doc.querySelector("#calSync")?.textContent || "";
  const nySyncText = doc.querySelector("#nySync")?.textContent || "";
  check("D4: calcutta and next-year sections have their own 'Updated' freshness stamps",
    /^Updated/.test(calSyncText.trim()) && /^Updated/.test(nySyncText.trim()),
    "calSync=" + calSyncText + " | nySync=" + nySyncText);
}

{
  const domD5 = makeDom("?debug=1");
  await until(() => domD5.window.document.getElementById("debugPanel"));
  const dbgPanel = domD5.window.document.getElementById("debugPanel");
  const dbgText = dbgPanel?.textContent || "";
  const okCount = (dbgText.match(/\bOK\b/g) || []).length;
  const hasFailed = /FAILED/i.test(dbgText);
  domD5.window.close();
  check("D5: debug happy path — 14 tabs OK",
    okCount === 14 && !hasFailed,
    "okCount=" + okCount + " hasFailed=" + hasFailed + " | " + dbgText.slice(0, 300));
}

/* ---------------------------------------------------------------------
   GROUP E — tabs/Home (Task 5)
   --------------------------------------------------------------------- */
{
  const domE1 = makeDom("");
  await until(() => domE1.window.document.querySelectorAll(".view").length > 0, 1500);
  domE1.window.location.hash = "#calcutta";
  domE1.window.dispatchEvent(new domE1.window.Event("hashchange"));
  const views = [...domE1.window.document.querySelectorAll(".view")];
  const calcuttaView = views.find(v => v.dataset.view === "calcutta");
  const others = views.filter(v => v.dataset.view !== "calcutta");
  check("E1: '#calcutta' hash shows only the calcutta view (others carry hidden)",
    views.length > 0 && !!calcuttaView && !calcuttaView.hidden && others.length > 0 && others.every(v => v.hidden),
    "views=" + views.map(v => v.dataset.view + ":" + v.hidden).join(","));
  domE1.window.close();
}

{
  const infoFuture = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", "2099-08-15T09:00:00-06:00");
  const futureFetch = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoFuture }),
  });
  const domE2 = makeDom("", futureFetch);
  await settle();
  const e2doc = domE2.window.document;
  const cdUnits = e2doc.querySelectorAll("#countdown .cd-unit").length;
  const homeStatusE2 = e2doc.querySelector("#homeStatus")?.textContent?.trim() || "";
  check("E2: far-future first_tee — Home shows pre-event countdown, no post-event status strip",
    cdUnits > 0 && homeStatusE2 === "",
    "cdUnits=" + cdUnits + " homeStatus=" + homeStatusE2);
  domE2.window.close();
}

{
  // A-SANE ceilings activeSeason() at first_tee_year+1, so the "past
  // first_tee" simulation has to stay inside the fixture's real season
  // (2026) — an arbitrarily distant year (the old 2020 override) would push
  // every real Scores row past the ceiling and collapse activeSeason().
  const infoPast = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", "2026-06-01T09:00:00-06:00");
  const pastFetch = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoPast }),
  });
  const domE3 = makeDom("", pastFetch);
  await settle();
  const homeStatusE3 = domE3.window.document.querySelector("#homeStatus")?.textContent || "";
  check("E3: past first_tee — Home flips to status strip reading '3 of 9 paid' and '$180'",
    homeStatusE3.includes("3 of 9 paid") && homeStatusE3.includes("$180"),
    homeStatusE3);
  domE3.window.close();
}

{
  const homeBirdText = doc.querySelector("#homeBird")?.textContent || "";
  check("E4: Bird holder on Home = latest Champions row (2024 Duck)",
    homeBirdText.includes("Duck"), homeBirdText);
}

/* ---------------------------------------------------------------------
   GROUP F — seniority/Field (Task 6)
   --------------------------------------------------------------------- */
{
  const eightCount = (fldBodyText.match(/8th year/g) || []).length;
  const rookieBadge = doc.querySelector("#fldBody .badge-rookie");
  const fourNamesOk = ["Duck","Hammer","Moose","Tex"].every(name => {
    const body = doc.querySelector("#fldBody");
    const nameEl = [...body.querySelectorAll("*")].find(el => el.textContent.includes(name));
    return nameEl && nearestTextAncestor(nameEl, "8th year");
  });
  check("F1: seniority badges — '8th year' ×4 (Duck/Hammer/Moose/Tex), ROOKIE on Tank",
    eightCount === 4 && !!rookieBadge && nearestTextAncestor(rookieBadge, "Tank") && fourNamesOk,
    "eightCount=" + eightCount + " rookieBadgeText=" + (rookieBadge?.textContent || "none") + " fourNamesOk=" + fourNamesOk);
}

{
  const groups = [...doc.querySelectorAll(".team-group")];
  const idxDuck = groups.findIndex(g => /Duck/.test(g.textContent || ""));
  const idxBear = groups.findIndex(g => /Bear/.test(g.textContent || ""));
  check("F2: veterans-first ordering — Duck (since 2019) group before Bear (since 2023) group",
    groups.length > 0 && idxDuck !== -1 && idxBear !== -1 && idxDuck < idxBear,
    "idxDuck=" + idxDuck + " idxBear=" + idxBear + " order=" + groups.map(g => (g.textContent || "").slice(0, 12)).join("|"));
}

{
  // F-DECLINED seniority invariant (v2.2 Wave 1): Sully declines on the
  // 2027 Invites row (fixtures/invites.csv). Her Field badge is computed
  // purely from `since` (2021) on the 2026 Field tab — 2026-2021+1 = "6th
  // year" — and must be completely unaffected by an unrelated tab's status.
  const body = doc.querySelector("#fldBody");
  const sullyEl = [...body.querySelectorAll("*")].find(el => el.textContent.includes("Sully"));
  check("F3: seniority-through-declined invariant — Sully's Field badge ('6th year') is unchanged by her declined status on the 2027 Invites row",
    !!sullyEl && nearestTextAncestor(sullyEl, "6th year"),
    "found=" + !!sullyEl);
}

/* ---------------------------------------------------------------------
   GROUP G — calcutta collections (Task 7)
   --------------------------------------------------------------------- */
{
  // 2026-09-01 (Riley): the dollar amount is the tile's ONLY big line — Jost
  // semibold tabular figures (Bodoni hairlines were unreadable at 1.6rem on
  // the dark ground); annotations (rake %, top-lot owner) demote to the
  // existing .pot dd small sub-line, matching Outstanding's shape.
  const bigLine = el => el ? [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim() : null;
  const smallOf = el => el && el.querySelector("small") ? el.querySelector("small").textContent : null;
  const rakeEl = doc.querySelector("#calRake"), topEl = doc.querySelector("#calTop");
  const idxG1 = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const potDD = (idxG1.match(/\.pot dd\{[^}]*\}/) || [""])[0];
  check("G1: calcutta tiles — pot/payable plain amounts; rake and top-lot are amount-only big lines with their annotations ('10% rake', 'Duck') in small sub-lines; .pot dd set in var(--ui) semibold (no Bodoni hairlines)",
    doc.querySelector("#calPot")?.textContent === "$400"
      && bigLine(rakeEl) === "$40" && smallOf(rakeEl) === "10% rake"
      && doc.querySelector("#calPayable")?.textContent === "$360"
      && bigLine(topEl) === "$120" && smallOf(topEl) === "Duck"
      && /var\(--ui\)/.test(potDD) && /font-weight:600/.test(potDD) && !/var\(--display\)/.test(potDD),
    JSON.stringify({ pot: doc.querySelector("#calPot")?.textContent, rakeBig: bigLine(rakeEl), rakeSmall: smallOf(rakeEl),
      topBig: bigLine(topEl), topSmall: smallOf(topEl), potDD }));
}

{
  const calOutText = doc.querySelector("#calOut")?.textContent || "";
  check("G2: Outstanding rollup — Tex $100 + Sock $80, total $180",
    calOutText.includes("$180") && calOutText.includes("Tex $100") && calOutText.includes("Sock $80"),
    calOutText);
}

{
  const aucRows = [...doc.querySelectorAll("#aucBody .auc-row")];
  const isMarkedCollected = row => /collect/i.test(row.className || "") || /✓|check/i.test(row.textContent || "");
  const findRow = team => aucRows.find(r => new RegExp("\\b" + team + "\\b").test(r.children[0]?.textContent || ""));
  const collectedOk = ["Duck", "Tex", "Bear"].every(t => { const r = findRow(t); return !!r && isMarkedCollected(r); });
  const uncollectedOk = ["Sully", "Moose"].every(t => { const r = findRow(t); return !!r && !isMarkedCollected(r); });
  check("G3: collected lots marked (Duck, Tex, Bear) vs uncollected (Sully, Moose)",
    aucRows.length === 5 && collectedOk && uncollectedOk,
    "rows=" + aucRows.length + " collectedOk=" + collectedOk + " uncollectedOk=" + uncollectedOk);
}

{
  const toNum = t => { const n = Number((t || "").replace(/[^0-9.-]/g, "")); return isNaN(n) ? 0 : n; };
  const payRows = [...doc.querySelectorAll("#payBody .pay-row")].map(r => {
    const cells = r.children;
    return {
      place: cells[0]?.textContent, team: cells[1]?.textContent, owner: cells[2]?.textContent,
      ownerCut: toNum(cells[3]?.textContent), cellCount: cells.length,
    };
  });
  check("G4: payout rows exactly per table — tie asterisks, owners, $144/$144/$72, no player-cut column",
    payRows.length === 3
      && payRows[0]?.place === "1st*" && /Duck/.test(payRows[0]?.team || "") && /Tex/.test(payRows[0]?.owner || "") && payRows[0]?.ownerCut === 144
      && payRows[1]?.place === "1st*" && /Sully/.test(payRows[1]?.team || "") && /Tex/.test(payRows[1]?.owner || "") && payRows[1]?.ownerCut === 144
      && payRows[2]?.place === "3rd" && /Tex/.test(payRows[2]?.team || "") && /Bear/.test(payRows[2]?.owner || "") && payRows[2]?.ownerCut === 72
      && payRows.every(p => p.cellCount === 4),
    JSON.stringify(payRows));
}

{
  // W-RAKE0 (v2.2 Wave 1): a non-blank, non-"0" calcutta_rake cell that
  // num() reads as 0% (no digits at all) is a broken cell, not a genuine
  // no-rake house.
  const infoRakeBad = FIXTURES.info.replace("calcutta_rake,10", "calcutta_rake,TBD");
  const rakeFetch = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoRakeBad }),
  });
  const domG5 = makeDom("", rakeFetch);
  await until(() => domG5.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const healthTextG5 = domG5.window.document.querySelector("#healthStrip")?.textContent || "";
  check("G5: W-RAKE0 — calcutta_rake cell that parses to 0 from a non-blank/non-zero value ('TBD') is flagged",
    /calcutta_rake/i.test(healthTextG5) && /TBD/.test(healthTextG5),
    healthTextG5.slice(0, 220));
  domG5.window.close();
}

/* ---------------------------------------------------------------------
   GROUP V — Would-pay (§12 W-ONE, W-WD)

   Derivation (default fixture, 2026, reusing G4's already-established
   rowsOut/ownerCut): rowsOut = { duck: $144 (1st*, owner Tex), sully: $144
   (1st*, owner Tex), tex: $72 (3rd, owner Bear) } — Moose (pos 4) and Bear
   (pos 5) are ranked but OUTSIDE the 3 paying places -> "—". done=false
   (Tex has played only 25/36 holes, thru "R2 · 7") -> Projected -> label
   "Wins if it ended now".
   --------------------------------------------------------------------- */
function findAucRow(dom, team) {
  // Match against innerHTML with a ">NAME<" anchor, not textContent — the
  // team cell's name span sits directly against the .auc-would sub-line
  // with no separating whitespace (e.g. "Bear" immediately followed by
  // "waiting on cards"), which defeats a plain \bNAME\b textContent regex.
  const rows = [...dom.querySelectorAll("#aucBody .auc-row")];
  return rows.find(r => (r.children[0]?.innerHTML || "").includes(">" + team + "<"));
}
function wouldTextFor(dom, team) {
  return findAucRow(dom, team)?.querySelector(".auc-would")?.textContent || "";
}

{
  const duckWould = wouldTextFor(doc, "Duck");
  const duckPayRow = [...doc.querySelectorAll("#payBody .pay-row")].find(r => /Duck/.test(r.children[1]?.textContent || ""));
  const duckPayCut = duckPayRow?.children[3]?.textContent || "";
  check("V1: W-ONE — Duck's 'wins if it ended now' value on the auction board equals the payout table's number for the SAME lot ($144, same-source proof — refactored to compute rowsOut once, never a second formula)",
    duckWould === "Wins if it ended now: $144" && duckPayCut === "$144",
    "duckWould=" + duckWould + " duckPayCut=" + duckPayCut);
}

{
  const mooseWould = wouldTextFor(doc, "Moose");
  const bearWould = wouldTextFor(doc, "Bear");
  check("V2: W-ONE — out-of-money lots (Moose pos 4, Bear pos 5 — ranked but outside the 3 paying places) show a plain '—', not a fabricated $0",
    mooseWould === "—" && bearWould === "—",
    "mooseWould=" + mooseWould + " bearWould=" + bearWould);
}

{
  // No cards posted yet for this specific lot's team (Bear) — distinct text
  // from the generic out-of-money dash.
  const scoresNoBear = FIXTURES.scores.split(/\r?\n/).filter(l => !l.startsWith("2026,Bear,")).join("\n");
  const noBearFetch = withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresNoBear }),
  });
  const domV3 = makeDom("", noBearFetch);
  await until(() => domV3.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const bearWouldV3 = wouldTextFor(domV3.window.document, "Bear");
  check("V3: W-ONE — a lot whose team hasn't posted any card yet shows 'waiting on cards' (Bear's scores removed)",
    bearWouldV3 === "waiting on cards",
    "bearWouldV3=" + bearWouldV3);
  domV3.window.close();
}

{
  // A lot with no owner at all — "unsold", regardless of the team's rank.
  const calcuttaNoOwner = FIXTURES.calcutta.replace("2026,Moose,Sock,80,", "2026,Moose,,80,");
  const noOwnerFetch = withOverride({
    calcutta: () => Promise.resolve({ ok: true, status: 200, text: async () => calcuttaNoOwner }),
  });
  const domV4 = makeDom("", noOwnerFetch);
  await until(() => domV4.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const mooseWouldV4 = wouldTextFor(domV4.window.document, "Moose");
  check("V4: W-ONE — an unsold lot (no owner) shows 'unsold'",
    mooseWouldV4 === "unsold",
    "mooseWouldV4=" + mooseWouldV4);
  domV4.window.close();
}

{
  // Fill in Tex's remaining round-2 holes (was 7 of 18) so every ranked
  // team reaches 36 holes played -> done flips true -> Final/"Won", same
  // $144 value for Duck's lot (only the LABEL changes, not the number,
  // because it's still the same rowsOut computation).
  const scoresTexDone = FIXTURES.scores.replace(
    "2026,Tex,2,0,4,3,5,4,4,3,4,,,,,,,,,,,,",
    "2026,Tex,2,4,4,3,5,4,4,3,4,5,4,5,3,4,4,4,3,5,4,,"
  );
  const texDoneFetch = withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresTexDone }),
  });
  const domV5 = makeDom("", texDoneFetch);
  await until(() => domV5.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const duckWouldV5 = wouldTextFor(domV5.window.document, "Duck");
  const calBasisV5 = domV5.window.document.querySelector("#calBasis")?.textContent || "";
  check("V5: W-ONE — Projected/Final label flip via variant: once every team reaches 36 holes, Duck's lot flips from 'Wins if it ended now: $144' to 'Won: $144' (same value, label only) and calBasis reads Final",
    duckWouldV5 === "Won: $144" && /^Final/.test(calBasisV5),
    "duckWouldV5=" + duckWouldV5 + " calBasis=" + calBasisV5);
  domV5.window.close();
}

{
  // W-WD: mark Tex (the only incomplete team, "R2 · 7") wd — every OTHER
  // ranked team is already at 36 holes in the default fixture, so if the
  // exclusion works, done flips true purely because Tex no longer blocks
  // it (not because Tex finished — Tex's card is untouched here).
  const fieldTexWD = FIXTURES.field.replace("2026,Tex,Tex,2019,18,In,TRUE,", "2026,Tex,Tex,2019,18,wd,TRUE,");
  const texWdFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldTexWD }),
  });
  const domV6 = makeDom("", texWdFetch);
  await until(() => domV6.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const healthTextV6 = domV6.window.document.querySelector("#healthStrip")?.textContent || "";
  const texAucHTML = findAucRow(domV6.window.document, "Tex")?.children[0]?.innerHTML || "";
  const calBasisV6 = domV6.window.document.querySelector("#calBasis")?.textContent || "";
  check("V6: W-WD — Field status wd (Tex, still incomplete) is flagged, gets a WD board annotation, and is excluded from the done-check: the rest of the field is already at 36 holes, so calBasis reaches Final purely via the exclusion (Tex's card itself is untouched)",
    /Tex/.test(healthTextV6) && /wd/i.test(healthTextV6) && /withdrawn/i.test(healthTextV6)
      && /badge">WD</.test(texAucHTML) && /^Final/.test(calBasisV6),
    "health=" + healthTextV6.slice(0, 240) + " texAucHTML=" + texAucHTML + " calBasis=" + calBasisV6);
  domV6.window.close();
}

check("V7: W-ONE — the Calcutta board states the copy line 'You owe the price regardless.'",
  /You owe the price regardless\./.test(doc.body?.textContent || ""), "");

{
  // NEW-3 (PAY-WD, controller default: a withdrawn team cannot collect):
  // same wd fixture as V6 (Tex marked wd, still incomplete) but asserting
  // the PAYOUT side this time. Pre-fix, Tex sat at raw-standings pos 3 (a
  // paying place, $72 per V1/V2's default derivation) purely because a
  // partial card can rank par-relative better than a finished one, and
  // still collected despite being withdrawn. Fixed: Tex is excluded from
  // the ranking BEFORE paying places are assigned, so it gets no payout
  // row; Moose (pos 4, previously "—" per V2, outside the money) promotes
  // into the vacated 3rd place — same $72 (same payout-table share,
  // wherever it lands is 20% of the same $360 payable, now sourced from a
  // different team, same-source as the auction board's own would-pay
  // number). Tex keeps its WD badge (V6) but its own would-pay cell now
  // reads "withdrawn" instead of a dollar figure.
  const fieldTexWD8 = FIXTURES.field.replace("2026,Tex,Tex,2019,18,In,TRUE,", "2026,Tex,Tex,2019,18,wd,TRUE,");
  const texWdFetch8 = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldTexWD8 }),
  });
  const domV8 = makeDom("", texWdFetch8);
  await until(() => domV8.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const v8doc = domV8.window.document;
  const texPayRow = [...v8doc.querySelectorAll("#payBody .pay-row")].find(r => /Tex/.test(r.children[1]?.textContent || ""));
  const moosePayRow = [...v8doc.querySelectorAll("#payBody .pay-row")].find(r => /Moose/.test(r.children[1]?.textContent || ""));
  const moosePlace = moosePayRow?.children[0]?.textContent || "";
  const mooseCut = moosePayRow?.children[3]?.textContent || "";
  const texWouldV8 = wouldTextFor(v8doc, "Tex");
  check("V8: PAY-WD (NEW-3) — a wd team (Tex, pos 3 on raw standings, a paying place) gets no payout row; Moose (pos 4, previously out of the money per V2) promotes into the vacated 3rd place at the same $72 payout-table share; Tex's own auction would-pay cell reads 'withdrawn'",
    !texPayRow && !!moosePayRow && moosePlace === "3rd" && mooseCut === "$72" && texWouldV8 === "withdrawn",
    "texPayRow=" + (texPayRow?.textContent || "none") + " moosePlace=" + moosePlace + " mooseCut=" + mooseCut + " texWould=" + texWouldV8);
  domV8.window.close();
}

{
  // V9: all-withdrawn payout guard — mark all teams (Duck, Sully, Moose, Tex,
  // Bear) as wd so rowsOut is empty: lots exist, cards exist (ranked has many
  // rows), but all eligible teams are withdrawn. Payout table must show
  // explicit empty state ("No eligible teams — withdrawals") instead of
  // rendering an empty rowsOut.map().
  const fieldAllWD = FIXTURES.field
    .replace("2026,Duck,Duck,2019,8,In,TRUE,", "2026,Duck,Duck,2019,8,wd,TRUE,")
    .replace("2026,Sully,Sully,2021,15,In,TRUE,", "2026,Sully,Sully,2021,15,wd,TRUE,")
    .replace("2026,Moose,Moose,2019,9,In,TRUE,", "2026,Moose,Moose,2019,9,wd,TRUE,")
    .replace("2026,Tex,Tex,2019,18,In,TRUE,", "2026,Tex,Tex,2019,18,wd,TRUE,")
    .replace("2026,Bear,Bear,2023,11,In,TRUE,", "2026,Bear,Bear,2023,11,wd,TRUE,");
  const allWdFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldAllWD }),
  });
  const domV9 = makeDom("", allWdFetch);
  await until(() => domV9.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const v9doc = domV9.window.document;
  const payBodyText = v9doc.querySelector("#payBody")?.textContent || "";
  check("V9: all-withdrawn payout guard — when all top paying teams are wd, payout body shows 'No eligible teams — withdrawals' (not empty)",
    payBodyText.includes("No eligible teams — withdrawals"),
    "payBody=" + payBodyText.slice(0, 100));
  domV9.window.close();
}

/* ---------------------------------------------------------------------
   GROUP H — next year (Task 7)
   --------------------------------------------------------------------- */
const nyBodyText = doc.querySelector("#nyBody")?.textContent || "";
check("H1: next-year header reads '3 of 9 paid'", nyBodyText.includes("3 of 9 paid"), nyBodyText.slice(0, 100));

{
  const paidItems = [...doc.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  check("H2: paid order Duck → Tank → Crash, each with its paid_date",
    paidItems.length === 3
      && /Duck/.test(paidItems[0]) && /2026-08-20/.test(paidItems[0])
      && /Tank/.test(paidItems[1]) && /2026-08-22/.test(paidItems[1])
      && /Crash/.test(paidItems[2]) && /2026-09-01/.test(paidItems[2]),
    JSON.stringify(paidItems));
}

check("H3: Crash present (union — paid for next year, not in 2026 roster)",
  nyBodyText.includes("Crash"), nyBodyText.slice(0, 160));
check("H4: Sock absent (status=out suppressed)",
  nyBodyText.trim().length > 0 && !nyBodyText.includes("Sock"), nyBodyText.slice(0, 160));
check("H5: deposit amount and payment handle rendered",
  nyBodyText.includes("$200") && nyBodyText.includes("Venmo @gfy-duck"), nyBodyText.slice(0, 200));

{
  const domH6 = makeDom("");
  await until(() => domH6.window.document.querySelectorAll("#years .year-btn").length >= 2);
  const h6doc = domH6.window.document;
  const btn2025 = [...h6doc.querySelectorAll("#years .year-btn")].find(b => (b.textContent || "").trim() === "2025");
  btn2025?.click();
  const nyTextAfterClick = h6doc.querySelector("#nyBody")?.textContent || "";
  check("H6: next-year board stays pinned to 2027 even when the year picker selects the 2025 archive",
    nyTextAfterClick.includes("3 of 9 paid") && nyTextAfterClick.includes("2027"),
    "years=" + [...h6doc.querySelectorAll("#years .year-btn")].map(b => b.textContent).join(",")
      + " nyBody=" + nyTextAfterClick.slice(0, 160));
  domH6.window.close();
}

{
  // A1 (C2, Riley ruled "committed only"): owing is no longer
  // responded+invited+needs — it's ONLY people with a NEXT-season Field row
  // who haven't paid. Hammer (2027,Hammer,,,,,, — blank deposit) is the sole
  // such person in the default fixture; still rendered as a real <ul><li>
  // list, not a comma-joined blob (S-structure carries forward).
  // 2026-08-28 polish: owing moved from .mn-net (money-column, right-aligned)
  // to .name-list — the anchor follows; the A1 semantics asserted are unchanged.
  const owingListEl = doc.querySelector("#nyBody ul.name-list.down");
  const owingItems = owingListEl ? [...owingListEl.querySelectorAll("li")].map(li => li.textContent) : [];
  check("H7: A1 — committed-only owing list renders as a real <ul><li> (1 item: Hammer), not a comma-joined blob",
    !!owingListEl && owingItems.length === 1 && owingItems[0] === "Hammer",
    "owingItems=" + JSON.stringify(owingItems));
}

/* ---------------------------------------------------------------------
   GROUP I — shame/net/copy (Task 8)
   --------------------------------------------------------------------- */
{
  const shameCards = [...doc.querySelectorAll("#shameBody .sh-card")].map(c => ({
    award: c.querySelector(".sh-award")?.textContent || "",
    who: c.querySelector(".sh-who")?.textContent || "",
    detail: c.querySelector(".sh-detail")?.textContent || "",
  }));

  const worstHole = shameCards.find(c => /worst team hole/i.test(c.award));
  check("I1: worst-team-hole card — Moose & Sock, 7 on the par-3 7th, round 1, +4",
    !!worstHole && /Moose/.test(worstHole.who) && /Sock/.test(worstHole.who)
      && /7 on the par-3 7th/i.test(worstHole.detail) && /round 1/i.test(worstHole.detail) && /\+4/.test(worstHole.detail),
    JSON.stringify(worstHole));

  const collapse = shameCards.find(c => /back-nine collapse/i.test(c.award));
  check("I2: back-nine-collapse card — Duck & Hammer, round 2 (out 34 → in 40, +6 swing)",
    !!collapse && /Duck/.test(collapse.who) && /Hammer/.test(collapse.who) && /round 2/i.test(collapse.detail) && /out -2/.test(collapse.detail) && /in \+4/.test(collapse.detail),
    JSON.stringify(collapse));

  const committee = shameCards.find(c => /most balls lost/i.test(c.award));
  check("I3: committee card (Tank, most balls lost) renders",
    !!committee && /Tank/.test(committee.who) && /Eleven/.test(committee.detail),
    JSON.stringify(committee));
}

{
  const lbHead = doc.querySelector(".lb-head");
  const aucHead = doc.querySelector(".auc-head");
  const payHead = doc.querySelector(".pay-head");
  const lbHeadText = lbHead?.textContent || "";
  const aucHeadText = aucHead?.textContent || "";
  const payHeadText = payHead?.textContent || "";
  check("I4: no 'Player' header remains in board/calcutta DOM (label sweep)",
    !!lbHead && !!aucHead && !!payHead
      && !/Player/.test(lbHeadText) && !/Player/.test(aucHeadText) && !/Player/.test(payHeadText),
    "lb=" + lbHeadText + " | auc=" + aucHeadText + " | pay=" + payHeadText);
}

{
  const bodyText = doc.body?.textContent || "";
  check("I5: lede/rules copy contains no 'buy back' and no 'Stroke play'",
    bodyText.length > 1000 && !/buy back/i.test(bodyText) && !/stroke play/i.test(bodyText),
    "bodyLen=" + bodyText.length);
}

/* ---------------------------------------------------------------------
   GROUP W — invites funnel, hardened (v2.2 Wave 1, Task 13; supersedes the
   v2.1 Task-12 suite it grew from — see docs/superpowers/specs §12).

   Fixture re-derivation (fixtures/field.csv + fixtures/invites.csv, both
   dated 2027 = NEXT). Universe = Field(trailing 3 seasons: 2024-2026, only
   2026 has rows) ∪ Field-2027 ∪ Invites-2027:
     Field-2026 (9): Duck, Hammer, Sully, Wade Johnson, Moose, Sock, Tex,
       Tank, Bear.
     Field-2027 adds: Crash (paid 2026-09-01), Ghost (paid 2026-08-18).
       Duck/Tank also paid (2026-08-20 / 2026-08-22). Hammer present,
       unpaid. Sock present, status=out — F-OUT-HOME: Field's NEXT-season
       status is no longer authoritative, so this is now IGNORED + FLAGGED,
       not acted on.
     Invites-2027 adds: Blade (new, nothing ticked). Duck (invited+responded
       — paid overlap). Wade Johnson (invited+responded). Moose (invited
       only). Sock (status=out — the AUTHORITATIVE source now). Sully
       (invited+responded+status=declined). Ghost (status=declined, no
       invited/responded ticks).
   Per-person resolution (F-DECLINED precedence: paid+dead > out > declined
   > paid > responded > invited > needs):
     Sock    — status=out, unpaid            -> excluded everywhere (silent)
     Sully   — status=declined, unpaid       -> declined (admin-only)
     Ghost   — status=declined, PAID         -> refund-owed (admin-only)
     Duck    — paid 2026-08-20               -> paid
     Tank    — paid 2026-08-22               -> paid
     Crash   — paid 2026-09-01               -> paid
     Wade Johnson   — responded, unpaid     -> responded
     Moose   — invited only, unpaid          -> invited
     Hammer, Tex, Bear, Blade — nothing, unpaid -> needs
   Remaining population (all) = 9: 3 paid + 1 responded + 1 invited +
   4 needs. "3 of 9 paid" — unchanged from the pre-Wave-1 fixture by
   coincidence (Sully leaves the denominator via declined, Blade enters via
   the new Invites row; the count nets to the same 9).
   --------------------------------------------------------------------- */
check("W1: funnel line reads the hand-derived counts — 3 paid · 1 responded · 1 invited · 4 need an invite",
  nyBodyText.includes("3 paid · 1 responded · 1 invited · 4 need an invite"),
  nyBodyText.slice(0, 260));

/* A1 (C2, Riley ruled "committed only"): the public owing list is now ONLY
   people who have a NEXT-season Field row and haven't paid — Hammer is the
   sole such person in the default fixture (2027,Hammer,,,,,, — a Field-2027
   row with a blank deposit). Everyone who used to appear in the old
   "responded+invited+needs" owing list purely via Invites/trailing-Field —
   Tex, Bear, Blade (needs), Moose (invited), Wade Johnson (responded) —
   has NO Field-2027 row at all, so they move entirely behind ?admin=1. */
check("W2: public board's committed-only owing list (A1) names Hammer (has a NEXT Field row, unpaid) and carries no funnel-stage headings (Invited/Needs an invite/Declined) or refund note",
  /Hammer/.test(nyBodyText)
    && !nyBodyText.includes("Needs an invite") && !nyBodyText.includes("Invited")
    && !nyBodyText.includes("Declined") && !/refund owed/i.test(nyBodyText),
  nyBodyText.slice(0, 500));

check("W34: A1 — Tex/Bear/Blade/Moose/'Wade Johnson' (responded/invited/needs, no Field-NEXT row) are ABSENT from the default (public) dom entirely",
  !/\bTex\b/.test(nyBodyText) && !/\bBear\b/.test(nyBodyText) && !/\bBlade\b/.test(nyBodyText)
    && !/\bMoose\b/.test(nyBodyText) && !/Wade Johnson/.test(nyBodyText),
  nyBodyText.slice(0, 500));

check("W3: Sully (declined) and Ghost (paid+declined) are absent from the public board entirely — no owing nag, no silent money loss shown publicly (F-DECLINED)",
  !nyBodyText.includes("Sully") && !nyBodyText.includes("Ghost"),
  nyBodyText.slice(0, 500));

// W4: retitled 2026-08-24 — the schema grew committed + invited_by, but the
// point of this test was never the column list: it's P-VAULT, no email
// column anywhere. Now also scans the TEMPLATE generator's Invites headers
// (the fixture alone could drift from the template silently).
{
  const tplInvHeads = (readFileSync(path.join(ROOT, "tools", "make_template.py"), "utf8")
    .match(/"Invites":[\s\S]*?"headers":\s*\[([^\]]*)\]/) || ["", ""])[1];
  check("W4: no email column anywhere — fixture header, template generator's Invites headers, and the rendered DOM are all email-free (v2.2 P-VAULT: emails live only in the never-published admin vault)",
    !/email/i.test(FIXTURES.invites.split(/\r?\n/)[0])
      && tplInvHeads.length > 0 && !/email/i.test(tplInvHeads)
      && !/@example\.com/.test(doc.documentElement.outerHTML),
    "fixture=" + FIXTURES.invites.split(/\r?\n/)[0] + " tpl=" + tplInvHeads);
}

{
  // The default dom's first_tee (2026-08-15) is only ~18 days out from
  // "now", inside pre-event — Home shows the countdown, not the status
  // strip, so this uses the same "shift first_tee earlier, same season"
  // past-fetch pattern as E3 above rather than the live default dom.
  const infoPastW5 = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", "2026-06-01T09:00:00-06:00");
  const pastFetchW5 = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoPastW5 }),
  });
  const domW5 = makeDom("", pastFetchW5);
  await settle();
  const homeStatusW5 = domW5.window.document.querySelector("#homeStatus")?.textContent || "";
  check("W5: Home strip contains '4 need an invite' linking #nextyear",
    homeStatusW5.includes("4 need an invite"), homeStatusW5);
  domW5.window.close();
}

{
  // A4 (I3) — F-OUT-HOME is now CONDITIONED on Invites-NEXT rows existing.
  // With the Invites tab stubbed entirely absent, Field's own NEXT-season
  // status column is HONORED again (restores the pre-Invites workflow):
  // Sock (Field-2027 status=out) is excluded exactly as before Wave 1.
  // Ghost has no declined marker at all without Invites (that lived only on
  // his Invites row), so he's a plain paid entry, not a refund-owed case.
  // Universe: trailing 9 + Crash(new) + Ghost(new) = 11, minus Sock
  // (excluded) = 10. Paid = Duck, Tank, Crash, Ghost = 4. "4 of 10 paid".
  const domW6 = makeDom("", fakeFetch, buildTestConfig({ invites: "" }));
  await until(() => domW6.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const nyBodyTextW6 = domW6.window.document.querySelector("#nyBody")?.textContent || "";
  check("W6: A4 — invites tab stubbed absent: Field's NEXT-season status column is honored again (Sock excluded), 4 of 10 paid, no funnel line, no admin headings",
    nyBodyTextW6.includes("4 of 10 paid") && !/\bSock\b/.test(nyBodyTextW6)
      && !/\d+\s*paid\s*·\s*\d+\s*responded/.test(nyBodyTextW6)
      && !nyBodyTextW6.includes("Needs an invite"),
    nyBodyTextW6.slice(0, 260));
  domW6.window.close();
}

{
  const fieldBadDate = FIXTURES.field.replace("2027,Crash,,,,,TRUE,2026-09-01", "2027,Crash,,,,,TRUE,not-a-date");
  const badDateFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldBadDate }),
  });
  const domW7 = makeDom("", badDateFetch);
  await until(() => domW7.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const healthTextW7 = domW7.window.document.querySelector("#healthStrip")?.textContent || "";
  const paidItemsW7 = [...domW7.window.document.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  check("W7: A-DATE — unparseable paid_date ('not-a-date') is flagged and sorts Crash after the two dated rows",
    /unparseable/i.test(healthTextW7) && paidItemsW7.length === 3 && /Crash/.test(paidItemsW7[2]),
    "paidItems=" + JSON.stringify(paidItemsW7) + " health=" + healthTextW7.slice(0, 220));
  domW7.window.close();
}

check("W8: A-DATE — tie-break rule stated on the paid queue ('same-day ties keep sheet order')",
  /same-day/i.test(nyBodyText) && /sheet order/i.test(nyBodyText),
  nyBodyText.slice(0, 400));

{
  const fieldSlashDate = FIXTURES.field.replace("2027,Tank,,,,,TRUE,2026-08-22", "2027,Tank,,,,,TRUE,8/22/26");
  const slashFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldSlashDate }),
  });
  const domW9 = makeDom("", slashFetch);
  await until(() => domW9.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const paidItemsW9 = [...domW9.window.document.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  const healthTextW9 = domW9.window.document.querySelector("#healthStrip")?.textContent || "";
  check("W9: A-DATE — M/D/YY paid_date ('8/22/26') parses and keeps Tank in its correct paid-order slot, no flag",
    paidItemsW9.length === 3 && /Tank/.test(paidItemsW9[1]) && !/unparseable/i.test(healthTextW9),
    "paidItems=" + JSON.stringify(paidItemsW9) + " health=" + healthTextW9.slice(0, 220));
  domW9.window.close();
}

{
  // C3 spec r1: JS's Date silently rolls Feb 30 into Mar 2 — round-trip
  // validation must catch that instead of trusting the rolled-over date.
  const fieldRollover = FIXTURES.field.replace("2027,Crash,,,,,TRUE,2026-09-01", "2027,Crash,,,,,TRUE,2026-02-30");
  const rolloverFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldRollover }),
  });
  const domW18 = makeDom("", rolloverFetch);
  await until(() => domW18.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const healthTextW18 = domW18.window.document.querySelector("#healthStrip")?.textContent || "";
  const paidItemsW18 = [...domW18.window.document.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  check("W18: A-DATE round-trip (spec r1) — invalid calendar date '2026-02-30' is flagged, not silently read as March 2, and sorts Crash after the two dated rows",
    /unparseable/i.test(healthTextW18) && paidItemsW18.length === 3
      && /Crash/.test(paidItemsW18[2]) && /2026-02-30/.test(paidItemsW18[2])
      && !/March|Mar\s*2\b|2026-03-02|03\/02\/2026/.test(paidItemsW18[2]),
    "paidItems=" + JSON.stringify(paidItemsW18) + " health=" + healthTextW18.slice(0, 220));
  domW18.window.close();
}

{
  // C3 spec r2: out-of-range month must flag, not roll into the next year.
  const fieldOOB = FIXTURES.field.replace("2027,Crash,,,,,TRUE,2026-09-01", "2027,Crash,,,,,TRUE,2026-13-05");
  const oobFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldOOB }),
  });
  const domW19 = makeDom("", oobFetch);
  await until(() => domW19.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const healthTextW19 = domW19.window.document.querySelector("#healthStrip")?.textContent || "";
  const paidItemsW19 = [...domW19.window.document.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  check("W19: A-DATE round-trip (spec r2) — out-of-range month '2026-13-05' is flagged and sorts Crash after the two dated rows",
    /unparseable/i.test(healthTextW19) && paidItemsW19.length === 3 && /Crash/.test(paidItemsW19[2]),
    "paidItems=" + JSON.stringify(paidItemsW19) + " health=" + healthTextW19.slice(0, 220));
  domW19.window.close();
}

{
  // C3 spec r3: '03/08/2026' is genuinely ambiguous (both components <=12) —
  // the M/D reading (March 8) is kept, but the normalized ISO reading must
  // be visible in parentheses beside the raw string so a reader can see how
  // it was interpreted.
  const fieldAmbiguous = FIXTURES.field.replace("2027,Tank,,,,,TRUE,2026-08-22", "2027,Tank,,,,,TRUE,03/08/2026");
  const ambiguousFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldAmbiguous }),
  });
  const domW20 = makeDom("", ambiguousFetch);
  await until(() => domW20.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const paidItemsW20 = [...domW20.window.document.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  const tankItemW20 = paidItemsW20.find(t => /Tank/.test(t)) || "";
  check("W20: A-DATE ambiguity disclosure (spec r3) — ambiguous slash date '03/08/2026' keeps the M/D reading but shows the normalized ISO date '(2026-03-08)' beside the raw string",
    /03\/08\/2026/.test(tankItemW20) && /\(2026-03-08\)/.test(tankItemW20),
    "paidItems=" + JSON.stringify(paidItemsW20));
  domW20.window.close();
}

{
  const invitesBlankYear = FIXTURES.invites.split(/\r?\n/).map((line, i) => {
    if (i === 0 || !line.trim()) return line;
    return line.replace(/^\d+,/, ",");
  }).join("\n");
  const blankYearFetch = withOverride({
    invites: () => Promise.resolve({ ok: true, status: 200, text: async () => invitesBlankYear }),
  });
  const domW10 = makeDom("", blankYearFetch);
  await until(() => domW10.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const healthTextW10 = domW10.window.document.querySelector("#healthStrip")?.textContent || "";
  const nyBodyTextW10 = domW10.window.document.querySelector("#nyBody")?.textContent || "";
  check("W10: A-NEXT2 — Invites rows with a blank year default to NEXT (2027), not activeSeason, and are flagged",
    /defaulted to 2027/.test(healthTextW10) && nyBodyTextW10.includes("2027"),
    healthTextW10.slice(0, 300));
  domW10.window.close();
}

{
  // A-NEXT2: Invites already has rows for 2028 (ahead of S-NEXT=2027) — the
  // anchor should run ahead to 2028 rather than treat those rows as inert.
  // Field also needs a 2028 row so F-OPEN admits the model at all.
  const invites2028 = FIXTURES.invites.replace(/\b2027\b/g, "2028");
  const field2028 = FIXTURES.field + "\n2028,Zed,,,,,TRUE,2027-08-20\n";
  const futureInvitesFetch = withOverride({
    invites: () => Promise.resolve({ ok: true, status: 200, text: async () => invites2028 }),
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => field2028 }),
  });
  const domW11 = makeDom("?admin=1", futureInvitesFetch);
  await until(() => domW11.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle();
  const nyBodyTextW11 = domW11.window.document.querySelector("#nyBody")?.textContent || "";
  const healthTextW11 = domW11.window.document.querySelector("#healthStrip")?.textContent || "";
  check("W11: A-NEXT2 — Invites anchor runs ahead to 2028 (max year in its own tab) when the tab is already prepped past S-NEXT; admin view shows its rows (Blade)",
    nyBodyTextW11.includes("Blade"),
    nyBodyTextW11.slice(0, 500));
  // A5 (I4+I5+M7) — this is exactly the "Invites runs ahead of nextSeason()"
  // case: the paid header stays pinned to S-NEXT (2027) while the funnel
  // counts are actually about Invites-2028 rows — flag it, and label the
  // funnel block with the Invites season explicitly so that's never silent.
  check("W33: A5 — Invites-ahead-of-nextSeason() is flagged, and the funnel block is explicitly labeled with the Invites season (2028), not silently mixed into the 2027 paid header",
    /2028.*ahead of 2027|ahead of 2027.*2028/.test(healthTextW11) && /Invites — 2028/.test(nyBodyTextW11),
    "health=" + healthTextW11.slice(0, 260) + " ny=" + nyBodyTextW11.slice(0, 260));
  domW11.window.close();
}

{
  // F-UNIV reappearance: roll the season to 2027 (next=2028). Sully (Field
  // 2026, since=2021) is still inside the trailing-3 window {2025,2026,2027}
  // even though she declined for 2027 — no 2028 Invites row exists for her,
  // so she lands back in Needs (admin view) purely from the trailing union,
  // no special-case carry-forward code required.
  const scoresWith2027 = FIXTURES.scores + "\n2027,Duck,1,4,4,4,5,4,4,4,4,5,4,5,3,4,4,4,3,5,4,,\n";
  const fieldWith2028 = FIXTURES.field + "\n2028,Zed,,,,,TRUE,2027-08-20\n";
  const nextSeasonFetch = withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresWith2027 }),
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldWith2028 }),
  });
  const domW12 = makeDom("?admin=1", nextSeasonFetch);
  await until(() => domW12.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle();
  const nyBodyTextW12 = domW12.window.document.querySelector("#nyBody")?.textContent || "";
  check("W12: F-UNIV — season rolls to 2027 (next=2028): Sully reappears in the universe via the trailing-3-years union despite declining for 2027",
    nyBodyTextW12.includes("2028") && nyBodyTextW12.includes("Sully"),
    nyBodyTextW12.slice(0, 600));
  domW12.window.close();
}

{
  const fieldNo2027 = FIXTURES.field.split(/\r?\n/).filter(line => !line.startsWith("2027,")).join("\n");
  const no2027Fetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldNo2027 }),
  });
  const domW13 = makeDom("", no2027Fetch);
  await until(() => domW13.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const nyBodyTextW13 = domW13.window.document.querySelector("#nyBody")?.textContent || "";
  check("W13: F-OPEN — Field-2027 rows removed but Invites-2027 rows present: collection is still open (union, not Field-only)",
    !nyBodyTextW13.includes("not open yet") && nyBodyTextW13.includes("2027"),
    nyBodyTextW13.slice(0, 300));
  domW13.window.close();
}

const domAdmin = makeDom("?admin=1");
await until(() => domAdmin.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
await settle();
const nyBodyTextAdmin = domAdmin.window.document.querySelector("#nyBody")?.textContent || "";

check("W14: admin dom (?admin=1) reveals the Invited list (Moose) and Needs-an-invite list (Hammer, Tex, Bear, Blade) — F-NAMES",
  /Invited/.test(nyBodyTextAdmin) && /Moose/.test(nyBodyTextAdmin)
    && nyBodyTextAdmin.includes("Needs an invite")
    && ["Hammer", "Tex", "Bear", "Blade"].every(n => nyBodyTextAdmin.includes(n)),
  nyBodyTextAdmin.slice(0, 700));

check("W15: admin dom reveals Declined (Sully) and Paid — refund owed (Ghost) — F-DECLINED",
  nyBodyTextAdmin.includes("Declined") && /Sully/.test(nyBodyTextAdmin)
    && /refund owed/i.test(nyBodyTextAdmin) && /Ghost/.test(nyBodyTextAdmin),
  nyBodyTextAdmin.slice(0, 700));

// A1: "responded" never had a name list at all before this wave (design
// decision recorded in the task-13 report) — now that the public owing list
// is committed-only, the responded stage's name ("Wade Johnson") must
// surface somewhere, and that's admin-only.
check("W31: A1 — admin dom reveals a new 'Responded' list ('Wade Johnson') that never existed publicly or in admin before this wave",
  /Responded/.test(nyBodyTextAdmin) && /Wade Johnson/.test(nyBodyTextAdmin),
  nyBodyTextAdmin.slice(0, 700));

check("W16: admin gating is explicitly documented as non-cryptographic (social gating only, not a security boundary)",
  /non-cryptographic|not a security boundary/i.test(nyBodyTextAdmin),
  nyBodyTextAdmin.slice(0, 400));

check("W17: F-FRESH — funnel block states its own freshness caveat ('ticked by hand' / 'may lag')",
  /ticked by hand/i.test(nyBodyText) && /may lag/i.test(nyBodyText),
  nyBodyText.slice(0, 400));

domAdmin.window.close();

/* ---------------------------------------------------------------------
   GROUP W (cont'd) — v2.2 Wave 2 pinned review fixes (A2-A4, A7)
   --------------------------------------------------------------------- */
{
  // A2 (I1) — the paid-order tie-break must use TRUE Field-NEXT sheet
  // order, not incidental Map/iteration order. Give Duck and Tank the SAME
  // paid_date and swap their Field-NEXT row order (Tank's row now precedes
  // Duck's). Duck would still win under the old bug — he's touched earlier
  // via the trailing-Field loop (Field's 2026 block lists Duck before Tank)
  // regardless of the NEXT block's own row order; the fix must seat Tank
  // first because his Field-2027 ROW comes first now.
  const fieldTieSwap = FIXTURES.field
    .replace("2027,Tank,,,,,TRUE,2026-08-22", "2027,Tank,,,,,TRUE,2026-08-20")
    .replace(
      "2027,Duck,,,,,TRUE,2026-08-20\n2027,Tank,,,,,TRUE,2026-08-20",
      "2027,Tank,,,,,TRUE,2026-08-20\n2027,Duck,,,,,TRUE,2026-08-20"
    );
  const tieSwapFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldTieSwap }),
  });
  const domW21 = makeDom("", tieSwapFetch);
  await until(() => domW21.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const paidItemsW21 = [...domW21.window.document.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  check("W21: A2 (I1) — paid-order tie-break uses TRUE Field-NEXT sheet order (Tank's row now precedes Duck's, same paid_date) — not incidental touch/insertion order",
    paidItemsW21.length === 3 && /Tank/.test(paidItemsW21[0]) && /Duck/.test(paidItemsW21[1]) && /Crash/.test(paidItemsW21[2]),
    "paidItems=" + JSON.stringify(paidItemsW21));
  domW21.window.close();
}

{
  // A3 (I2) — a duplicate NEXT-season Field row for the same person, with
  // BLANK deposit/paid_date, must never erase the non-blank data the first
  // row already recorded (S-MERGE pattern: duplicates are normal, not an
  // error). Duck stays paid, keeps his original date, no spurious flag.
  const hammerBlankRow = FIXTURES.field.split(/\r?\n/).find(l => l.startsWith("2027,Hammer,"));
  const fieldBlankDup = FIXTURES.field.replace(
    "2027,Duck,,,,,TRUE,2026-08-20",
    "2027,Duck,,,,,TRUE,2026-08-20\n" + hammerBlankRow.replace("Hammer", "Duck")
  );
  const blankDupFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldBlankDup }),
  });
  const domW22 = makeDom("", blankDupFetch);
  await until(() => domW22.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const paidItemsW22 = [...domW22.window.document.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  const healthTextW22 = domW22.window.document.querySelector("#healthStrip")?.textContent || "";
  check("W22: A3 (I2) — duplicate Field-NEXT row with blank deposit/paid_date never overwrites Duck's already-recorded paid status/date, no spurious conflict flag",
    paidItemsW22.some(t => /Duck/.test(t) && /2026-08-20/.test(t)) && !/conflicting \w+ for Duck NEXT rows/i.test(healthTextW22),
    "paidItems=" + JSON.stringify(paidItemsW22) + " health=" + healthTextW22.slice(0, 400));
  domW22.window.close();
}

{
  // A3 (I2) — TWO non-blank, DIFFERENT paid_date values on duplicate rows
  // for the same person is a real conflict: the later row wins and it's
  // flagged (mirrors S-MERGE's "later row's value, health flag" rule).
  const fieldConflictDup = FIXTURES.field.replace(
    "2027,Tank,,,,,TRUE,2026-08-22",
    "2027,Tank,,,,,TRUE,2026-08-22\n2027,Tank,,,,,TRUE,2026-08-25"
  );
  const conflictDupFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldConflictDup }),
  });
  const domW23 = makeDom("", conflictDupFetch);
  await until(() => domW23.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const paidItemsW23 = [...domW23.window.document.querySelectorAll("#nyBody ol li")].map(li => li.textContent || "");
  const healthTextW23 = domW23.window.document.querySelector("#healthStrip")?.textContent || "";
  const tankItemW23 = paidItemsW23.find(t => /Tank/.test(t)) || "";
  check("W23: A3 (I2) — conflicting non-blank paid_date on duplicate Field-NEXT rows for Tank: later row wins (2026-08-25) and a health flag names the conflict",
    /2026-08-25/.test(tankItemW23) && !/2026-08-22/.test(tankItemW23)
      && /conflicting/i.test(healthTextW23) && /paid_date/i.test(healthTextW23) && /Tank/.test(healthTextW23),
    "tankItem=" + tankItemW23 + " health=" + healthTextW23.slice(0, 240));
  domW23.window.close();
}

{
  // A3 (I2) — duplicate Invites-NEXT rows merge PARTIAL data instead of the
  // second row's blanks overwriting the first row's ticks: Moose invited on
  // row 1, responded on row 2 — the merge keeps BOTH, so Moose lands in
  // Responded (the higher stage), not Invited. Invited becomes empty (Moose
  // was its only member in the default fixture) and its heading disappears.
  const invitesMergeDup = FIXTURES.invites.replace(
    "2027,Moose,TRUE,,",
    "2027,Moose,TRUE,,\n2027,Moose,,TRUE,"
  );
  const mergeDupFetch = withOverride({
    invites: () => Promise.resolve({ ok: true, status: 200, text: async () => invitesMergeDup }),
  });
  const domW24 = makeDom("?admin=1", mergeDupFetch);
  await until(() => domW24.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle();
  const nyBodyTextW24 = domW24.window.document.querySelector("#nyBody")?.textContent || "";
  check("W24: A3 (I2) — duplicate Invites-NEXT rows merge partial data (Moose: invited on row 1, responded on row 2) rather than the second overwriting the first's invited with blank — Moose lands in Responded, Invited heading disappears (was Moose-only)",
    /Responded/.test(nyBodyTextW24) && /Moose/.test(nyBodyTextW24) && !/Invited/.test(nyBodyTextW24),
    nyBodyTextW24.slice(0, 700));
  domW24.window.close();
}

{
  // A4 (I3) — Field-NEXT status=declined is HONORED (not ignored) when
  // Invites is entirely absent for this season: Ghost (paid + declined,
  // sourced purely from his Field row) shows the admin "refund owed" line
  // exactly as he would via Invites — the workflow is restored, not lost.
  const fieldGhostDeclined = FIXTURES.field.replace(
    "2027,Ghost,,,,,TRUE,2026-08-18",
    "2027,Ghost,,,,declined,TRUE,2026-08-18"
  );
  const ghostDeclinedFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldGhostDeclined }),
  });
  const domW25 = makeDom("?admin=1", ghostDeclinedFetch, buildTestConfig({ invites: "" }));
  await until(() => domW25.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle();
  const nyBodyTextW25 = domW25.window.document.querySelector("#nyBody")?.textContent || "";
  check("W25: A4 (I3) — Field-NEXT status=declined is HONORED (not ignored) when Invites is entirely absent: Ghost (paid + declined, Field-only) shows admin 'refund owed'",
    /refund owed/i.test(nyBodyTextW25) && /Ghost/.test(nyBodyTextW25),
    nyBodyTextW25.slice(0, 700));
  domW25.window.close();
}

{
  // A4 (I3) — benign Field-NEXT status values ("in", "yes", blank) are
  // NEVER flagged as ignored, even with Invites present and authoritative —
  // only out/declined carry any meaning to ignore in the first place.
  const fieldBenignStatus = FIXTURES.field.replace("2027,Hammer,,,,,,", "2027,Hammer,,,,in,,");
  const benignFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldBenignStatus }),
  });
  const domW26 = makeDom("?admin=1", benignFetch);
  await until(() => domW26.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle();
  const healthTextW26 = domW26.window.document.querySelector("#healthStrip")?.textContent || "";
  const nyBodyTextW26 = domW26.window.document.querySelector("#nyBody")?.textContent || "";
  check("W26: A4 (I3) — benign Field-NEXT status ('in') is never flagged as ignored even with Invites present, and Hammer stays in the committed-owing list",
    !/for Hammer ignored/i.test(healthTextW26) && /Hammer/.test(nyBodyTextW26),
    "health=" + healthTextW26.slice(0, 260) + " ny=" + nyBodyTextW26.slice(0, 200));
  domW26.window.close();
}

{
  // A4 (I3) — Invites authority is TAB-LEVEL, not per-person: even with
  // Sock's own Invites-2027 row removed, the Invites tab still has OTHER
  // 2027 rows, so Sock's Field status=out is still ignored+flagged (not
  // honored) — Sock reappears (admin-visible, Needs an invite) rather than
  // being silently excluded via his now-absent Invites row.
  const invitesNoSock = FIXTURES.invites.split(/\r?\n/).filter(l => !l.startsWith("2027,Sock,")).join("\n");
  const noSockFetch = withOverride({
    invites: () => Promise.resolve({ ok: true, status: 200, text: async () => invitesNoSock }),
  });
  const domW27 = makeDom("?admin=1", noSockFetch);
  await until(() => domW27.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle();
  const healthTextW27 = domW27.window.document.querySelector("#healthStrip")?.textContent || "";
  const nyBodyTextW27 = domW27.window.document.querySelector("#nyBody")?.textContent || "";
  check("W27: A4 (I3) — Invites authority is tab-level: with Sock's own Invites-2027 row removed (but other 2027 Invites rows present), Sock's Field status=out is still ignored+flagged, and Sock reappears (admin, Needs an invite)",
    /Sock[^]*ignored|ignored[^]*Sock/i.test(healthTextW27) && /Needs an invite/.test(nyBodyTextW27) && /Sock/.test(nyBodyTextW27),
    "health=" + healthTextW27.slice(0, 260) + " ny=" + nyBodyTextW27.slice(0, 400));
  domW27.window.close();
}

{
  // A7 (I7) — W4 gains teeth: scan real SOURCE, not just the fixture header
  // and rendered DOM (which miss anything the app source might do with an
  // email field without a fixture ever exercising it).
  check("W28: A7 (I7) — index.html JS/HTML source contains no reference to 'email' anywhere (the app never reads, stores, or renders it — P-VAULT keeps addresses entirely out of this codebase)",
    !/\bemail\b/i.test(html),
    "");

  const templatePySrc = readFileSync(path.join(ROOT, "tools", "make_template.py"), "utf8");
  const sheetsDictSrc = templatePySrc.slice(templatePySrc.indexOf("SHEETS = {"), templatePySrc.indexOf("def main"));
  check("W29: A7 (I7) — tools/make_template.py's actual sheet/column generator (the SHEETS dict — excludes the module docstring's prose explanation of P-VAULT, which legitimately says 'email') contains no email column or reference",
    sheetsDictSrc.length > 500 && !/\bemail\b/i.test(sheetsDictSrc),
    "len=" + sheetsDictSrc.length);

  const readmeSrc = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const inviteSectionStart = readmeSrc.indexOf("## The invite list");
  const inviteSectionEndIdx = readmeSrc.indexOf("\n## ", inviteSectionStart + 1);
  const inviteSection = readmeSrc.slice(inviteSectionStart, inviteSectionEndIdx === -1 ? undefined : inviteSectionEndIdx);
  const schemaSpans = [...inviteSection.matchAll(/`([^`]+)`/g)].map(m => m[1]).join(" | ");
  check("W30: A7 (I7) — README's invite-list section: every backtick-quoted schema/header-paste string (the exact leak vector C1 fixed) contains no 'email' — surrounding prose describing the vault workflow may still say the word",
    inviteSectionStart !== -1 && schemaSpans.length > 0 && !/\bemail\b/i.test(schemaSpans),
    "spans=" + schemaSpans.slice(0, 300));
}

/* ---------------------------------------------------------------------
   GROUP M — Money tab (v2.2 Wave 1, Task 13)
   --------------------------------------------------------------------- */
check("M1: Money tab off-season empty state (Ledger has 2025 rows but none for the selected 2026) points to Next Year, not the generic 'Add a Ledger tab' message",
  /#nextyear/.test(doc.querySelector("#mnBody")?.innerHTML || "") && /Next Year/i.test(doc.querySelector("#mnBody")?.textContent || "")
    && !/Add a Ledger tab/i.test(doc.querySelector("#mnBody")?.textContent || ""),
  doc.querySelector("#mnBody")?.textContent || "");

{
  const domM2 = makeDom("", fakeFetch, buildTestConfig({ ledger: "" }));
  await until(() => domM2.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const mnBodyTextM2 = domM2.window.document.querySelector("#mnBody")?.textContent || "";
  check("M2: Money tab with NO Ledger tab configured at all still shows the generic 'Add a Ledger tab' message (regression guard vs M1's off-season case)",
    /Add a Ledger tab/i.test(mnBodyTextM2),
    mnBodyTextM2);
  domM2.window.close();
}

/* ---------------------------------------------------------------------
   GROUP S — structure (v2.2 Wave 1, Task 13): S-VIEWS, S-NAV, S-STALE
   --------------------------------------------------------------------- */
{
  const domS = makeDom("");
  await until(() => domS.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const beforeRows = domS.window.document.querySelectorAll("#lbBody .lb-row").length;
  domS.window.eval("STATE.data.scores = []; renderLeaderboard();");
  const afterRowCount = domS.window.document.querySelectorAll("#lbBody .lb-row").length;
  const afterEmptyText = domS.window.document.querySelector("#lbBody .lb-empty")?.textContent || "";
  check("S1: S-STALE (live bug, fixed) — leaderboard repaints the honest empty state when scores go to zero rows, no stale rows left behind",
    beforeRows > 0 && afterRowCount === 0 && /No cards posted yet/.test(afterEmptyText),
    "before=" + beforeRows + " after=" + afterRowCount + " emptyText=" + afterEmptyText);
  domS.window.close();
}

check("S2: S-VIEWS — VIEWS is derived from the [data-view] DOM (deduped), not a hardcoded literal; alias map still present",
  /VIEWS\s*=\s*\[\.\.\.new Set\(/.test(html) && /querySelectorAll\((["'])\.view\1\)/.test(html)
    && /\.map\(s\s*=>\s*s\.dataset\.view\)/.test(html) && /VIEW_ALIASES/.test(html),
  "");

{
  // A6 (I6): pin first_tee to a far-future date via withOverride rather than
  // relying on the default dom's real first_tee (2026-08-15) staying safely
  // outside the ±3-day event window — that assumption goes red for real
  // during the actual event week. Same pattern as E2's far-future override.
  const infoFarFutureS3 = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", "2099-08-15T09:00:00-06:00");
  const farFutureFetchS3 = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoFarFutureS3 }),
  });
  const domS3 = makeDom("", farFutureFetchS3);
  await until(() => domS3.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const navLinksText = [...domS3.window.document.querySelectorAll(".nav-links a")].map(a => a.hash.slice(1));
  check("S3: N-ORDER canonical off-season nav — the full lifecycle order, no shuffle (first_tee pinned far-future via override, A6)",
    navLinksText.join(",") === "home,field,draft,board,pairings,calcutta,money,nextyear,schedule,rooms,champions,shame,photos,rules",
    navLinksText.join(","));
  domS3.window.close();
}

{
  const now = new Date();
  const pad2 = n => String(n).padStart(2, "0");
  const nowISO = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T09:00:00-06:00`;
  const infoEventWindow = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", nowISO);
  const eventFetch = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoEventWindow }),
  });
  const domS4 = makeDom("", eventFetch);
  await until(() => domS4.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const navLinksTextS4 = [...domS4.window.document.querySelectorAll(".nav-links a")].map(a => a.hash.slice(1));
  check("S4: S-NAV event-window flip — Board/Draft/Pairings/Calcutta/Rooms lead, remainder in canonical order (first_tee = today, inside ±3 days)",
    navLinksTextS4.join(",") === "board,draft,pairings,calcutta,rooms,home,field,money,nextyear,schedule,champions,shame,photos,rules",
    navLinksTextS4.join(","));
  domS4.window.close();
}

check("S5: S-NAV right-edge fade — .nav-inner::after gradient overlay present in the stylesheet",
  /\.nav-inner::after\s*\{[^}]*gradient/i.test(html), "");

{
  // P-SHOTGUN (§14.1): fixtures/pairings.csv's Round One/Two rows
  // carry a start=1 / start=blank / start="TBD" / start=7.5 spread across the group
  // that already exercises the valid/blank/junk/decimal paths in one shared dom —
  // no new variant dom needed since the fixture's year (2026) matches the
  // main dom's activeSeason().
  const pairGroups = [...doc.querySelectorAll("#pairBody .grp")];
  const grpText = who => pairGroups.find(g => (g.textContent || "").includes(who))?.textContent || "";
  const validGrp = grpText("Duck · Hammer · Sully");
  const blankGrp = grpText("Wade Johnson · Moose · Tex");
  const decimalGrp = grpText("Decimal test");
  const junkGrp = grpText("Leaders out last");

  // Header-absent variant: CSV with no start column
  const domHeaderAbsent = makeDom("?test=withOverride", "year,round,when,time,players\n2026,Round One,Saturday,9:00 am,Test Group");
  await until(() => domHeaderAbsent.window.document.querySelectorAll("#pairBody .grp").length > 0);
  await settle();
  const headerAbsentHoles = [...domHeaderAbsent.window.document.querySelectorAll("#pairBody .grp-hole")].length;
  domHeaderAbsent.window.close();

  check("S6: P-SHOTGUN — Pairings optional start column: a parseable 1-18 value (start=1) renders 'Hole 1' beside the time, a blank start renders no 'Hole' text at all, decimals (start=7.5) render as raw text '7.5' (not truncated 'Hole 7'), unparseable junk (start=TBD) renders as raw text verbatim, and missing start column renders zero 'Hole' spans",
    /Hole 1/.test(validGrp) && !/Hole/.test(blankGrp) && /7\.5/.test(decimalGrp) && !/Hole 7/.test(decimalGrp) && /TBD/.test(junkGrp) && headerAbsentHoles === 0,
    "valid=" + JSON.stringify(validGrp) + " blank=" + JSON.stringify(blankGrp) + " decimal=" + JSON.stringify(decimalGrp) + " junk=" + JSON.stringify(junkGrp) + " headerAbsentHoles=" + headerAbsentHoles);
}

/* ---------------------------------------------------------------------
   GROUP R — Rooms (§12 R-DERIVE, R-PUBLIC, R-FILTER, A-NEXT2)

   fixtures/rooms.csv derivation (anchor = max(Rooms years)=2027, floor
   nextSeason()-1=2026 -> anchor 2027; this deliberately reuses Field-2027's
   existing paid/unpaid mix rather than adding a new fixture dimension):
     2027 rows: Duck (Lodge·1 AND Cabin·A — double-booked), Ghost (Lodge·2),
       Hammer (Cabin·B, has a Field-2027 row but UNPAID), guest:Pat
       (Cabin·B), Zeke (Cabin·C, no Field row anywhere — unknown).
     2026 row: Duck (Lodge·3) — prior-year row for the admin memory lens.
   Paid-2027 order (A-DATE, established by H2/W1): Duck, Tank, Crash.
   Assigned(2027) = {Duck, Ghost, Hammer, Pat, Zeke}. Paid minus assigned =
   Tank, Crash (in that paid order) — the queue.
   --------------------------------------------------------------------- */
{
  const roomsBodyText = doc.querySelector("#roomsBody")?.textContent || "";
  const propLabels = [...doc.querySelectorAll("#roomsBody .room-prop")].map(p => p.textContent);
  // NEW-1: the header must label the anchor year it's actually showing
  // ("Rooms — 2027"), with NO run-ahead flag on the default fixture — its
  // anchor (2027) equals nextSeason() (2027) exactly, not past it, so the
  // Invites-style run-ahead case never triggers here. NEW-2: no blank-year
  // rooms rows exist in the default fixture either, so its own new flag
  // must stay silent too (both are exercised on dedicated variant fixtures
  // below/elsewhere, not the default one).
  const roomsHeaderText = doc.querySelector("#rooms h2")?.textContent || "";
  const healthTextDefault = doc.querySelector("#healthStrip")?.textContent || "";
  check("R1: Rooms view groups property -> room -> players (Lodge & Cabin present) with correct public names, including a plain unflagged player (Ghost); header labels the anchor year ('Rooms — 2027', NEW-1); neither the NEW-1 run-ahead flag nor the NEW-2 blank-year-default flag fires on the default fixture",
    propLabels.includes("Lodge") && propLabels.includes("Cabin")
      && /Duck/.test(roomsBodyText) && /Ghost/.test(roomsBodyText) && /Hammer/.test(roomsBodyText)
      && roomsHeaderText === "Rooms — 2027"
      && !/Rooms tab already has rows for/.test(healthTextDefault)
      && !/rooms row with blank year defaulted/.test(healthTextDefault),
    "props=" + JSON.stringify(propLabels) + " header=" + roomsHeaderText + " body=" + roomsBodyText.slice(0, 300));
}

{
  const guestLi = [...doc.querySelectorAll("#roomsBody .room-player")].find(li => /Pat/.test(li.textContent || ""));
  const guestText = guestLi?.textContent || "";
  check("R2: guest:Pat renders with the prefix stripped ('Pat', not 'guest:Pat') plus a small (guest) mark, and is never flagged unknown/unpaid",
    !!guestLi && guestText.includes("Pat") && !guestText.includes("guest:") && /guest/i.test(guestLi.innerHTML)
      && !/"Pat"/.test(doc.querySelector("#healthStrip")?.textContent || ""),
    "guestHTML=" + (guestLi?.innerHTML || "none"));
}

{
  const healthTextR = doc.querySelector("#healthStrip")?.textContent || "";
  check("R3: health flags — same player (Duck) in two rooms (Lodge·1 and Cabin·A)",
    /Duck/.test(healthTextR) && /two rooms/i.test(healthTextR) && /Lodge · 1/.test(healthTextR) && /Cabin · A/.test(healthTextR),
    healthTextR.slice(0, 400));
  check("R4: health flags — assigned player not on the paid list (Hammer, has a Field-2027 row but unpaid)",
    /Hammer/.test(healthTextR) && /not on the paid list/i.test(healthTextR),
    healthTextR.slice(0, 400));
  check("R5: health flags — unknown name without a guest: prefix (Zeke, no Field row any trailing season)",
    /Zeke/.test(healthTextR) && /unknown name/i.test(healthTextR),
    healthTextR.slice(0, 400));
}

{
  const domRAdmin = makeDom("?admin=1");
  await until(() => domRAdmin.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle();
  const rAdminDoc = domRAdmin.window.document;
  const duckLis = [...rAdminDoc.querySelectorAll("#roomsBody .room-player")].filter(li => /Duck/.test(li.textContent || ""));
  const duckAdminHTML = duckLis.map(li => li.innerHTML).join(" | ");
  const publicHadPresent = /had:/i.test(doc.querySelector("#roomsBody")?.textContent || "");
  check("R6: ?admin=1 memory lens shows Duck's PRIOR-year (2026) room 'had: Lodge · 3' beside his current assignment; the default (public) dom shows no 'had:' text at all",
    duckLis.length > 0 && duckAdminHTML.includes("had: Lodge · 3") && !publicHadPresent,
    "duckAdminHTML=" + duckAdminHTML + " publicHadPresent=" + publicHadPresent);
  domRAdmin.window.close();
}

check("R7: client-side name filter input is present on the Rooms view",
  !!doc.querySelector("#roomsFilter") && doc.querySelector("#roomsFilter").tagName === "INPUT",
  "");

{
  const queueItems = [...doc.querySelectorAll("#roomsQueue ul li")].map(li => li.textContent || "");
  check("R8: paid-but-unassigned queue = paid list MINUS assigned, in paid order (Tank then Crash — Duck/Ghost/Hammer already assigned, Crash never was)",
    queueItems.length === 2 && /Tank/.test(queueItems[0]) && /Crash/.test(queueItems[1]),
    "queueItems=" + JSON.stringify(queueItems));
}

{
  // NEW-2: a "current event" Rooms fixture variant — every explicit row is
  // 2026 (nextSeason()-1, the Rooms anchor floor), plus one row with a
  // BLANK year for a third player. Pre-fix, normalizeYears defaulted every
  // blank Rooms row straight to nextSeason() (2027) regardless of what the
  // rest of the tab said, which would drag the whole anchor to 2027 too
  // (years=[2026,2026,2027] -> max=2027) and strand the blank row alone on
  // a board its own sheet-mates never reached. Fixed: the blank row
  // defaults to Rooms' OWN max non-blank year (2026) instead, so it lands
  // on the SAME current-event board as Duck and Ghost.
  const roomsCurrentEventBlank = "year,property,room,player\n2026,Lodge,1,Duck\n2026,Lodge,2,Ghost\n,Cabin,A,Bear\n";
  const roomsBlankFetch = withOverride({
    rooms: () => Promise.resolve({ ok: true, status: 200, text: async () => roomsCurrentEventBlank }),
  });
  const domR9 = makeDom("", roomsBlankFetch);
  await until(() => domR9.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const r9doc = domR9.window.document;
  const roomsHeaderTextR9 = r9doc.querySelector("#rooms h2")?.textContent || "";
  const roomsBodyTextR9 = r9doc.querySelector("#roomsBody")?.textContent || "";
  const healthTextR9 = r9doc.querySelector("#healthStrip")?.textContent || "";
  check("R9: NEW-2 — a blank-year row (Bear) in a current-event Rooms fixture variant (Duck/Ghost both 2026) defaults to Rooms' own max year (2026) and lands on the SAME current board as Duck/Ghost, not next season's; header reads 'Rooms — 2026'; the flag names the tab and the chosen year",
    roomsHeaderTextR9 === "Rooms — 2026"
      && /Duck/.test(roomsBodyTextR9) && /Ghost/.test(roomsBodyTextR9) && /Bear/.test(roomsBodyTextR9)
      && /rooms row with blank year defaulted to 2026/.test(healthTextR9),
    "header=" + roomsHeaderTextR9 + " body=" + roomsBodyTextR9.slice(0, 300) + " health=" + healthTextR9.slice(0, 300));
  domR9.window.close();
}

/* ---------------------------------------------------------------------
   GROUP Z — guardrails (Z0) + unconfigured deploy (Z1-Z4, final review)
   --------------------------------------------------------------------- */
check("Z0: zero page errors in plain mode", dom.pageErrors.length === 0,
  JSON.stringify(dom.pageErrors));

{
  const cacheRaw = dom.window.localStorage.getItem("gfy-cache-v2");
  let cacheOK = false, cacheDetail = cacheRaw;
  try {
    const parsed = JSON.parse(cacheRaw);
    cacheOK = !!(parsed && parsed.tabs && parsed.tabs.scores
      && Array.isArray(parsed.tabs.scores.rows) && parsed.tabs.scores.rows.length > 0);
  } catch (e) { cacheDetail = "parse error: " + e.message + " raw=" + cacheRaw; }
  check("Z0: localStorage cache retains scores rows after a live load", cacheOK, cacheDetail);
}

dom.window.close();

// Z1-Z4 — the state of live main: synthesized empty config (empty PUB_ID/GID),
// every fetch rejecting. No fabricated warnings, no fabricated stamps — just the
// printed-card fallback content and a running countdown.
{
  const rejectAllFetch = () => Promise.reject(new Error("network unavailable in test"));
  const errorsZ = [];
  const vcZ = new VirtualConsole();
  vcZ.on("jsdomError", e => { if (!envNoise.test(e.message)) errorsZ.push(e.message + (e.cause ? " :: " + e.cause : "")); });
  vcZ.on("error", (...a) => errorsZ.push("console.error: " + a.join(" ")));
  const domZ = new JSDOM(html, {
    runScripts: "dangerously", url: "http://localhost/", virtualConsole: vcZ,
    beforeParse(window) { window.fetch = rejectAllFetch; },
    resources: { interceptors: [requestInterceptor((request) => {
      if (request.url.endsWith("/config.js"))
        return new Response(emptyConfig, { headers: { "Content-Type": "application/javascript" } });
      return new Response("", { headers: { "Content-Type": "text/css" } });
    })] },
  });
  domZ.pageErrors = errorsZ;
  await settle();
  const zdoc = domZ.window.document;

  const lbEmptyText = zdoc.querySelector("#lbBody .lb-empty")?.textContent || "";
  check("Z1: unconfigured deploy — fallback board content renders ('No cards posted yet')",
    /No cards posted yet/.test(lbEmptyText), "lbBody=" + lbEmptyText + " pageErrors=" + JSON.stringify(domZ.pageErrors));

  const cdUnitsZ = zdoc.querySelectorAll("#countdown .cd-unit").length;
  check("Z2: unconfigured deploy — countdown still renders off config.js's default FIRST_TEE",
    cdUnitsZ > 0, "cdUnits=" + cdUnitsZ);

  const healthElZ = zdoc.querySelector("#healthStrip");
  const healthHasContent = !!healthElZ && !healthElZ.hidden && (healthElZ.textContent || "").trim().length > 0;
  check("Z3: unconfigured deploy — no #healthStrip with content (no fabricated warnings)",
    !healthHasContent,
    "present=" + !!healthElZ + " hidden=" + (healthElZ ? healthElZ.hidden : "n/a") + " text=" + (healthElZ?.textContent || ""));

  const stampIdsZ = ["lbSync", "schedSync", "calSync", "nySync"];
  const stampsZ = stampIdsZ.map(id => (zdoc.querySelector("#" + id)?.textContent || "").trim());
  check("Z4: unconfigured deploy — all four freshness stamps are empty (no fabricated Offline text)",
    stampsZ.every(s => s === ""), JSON.stringify(stampsZ));

  // X56: §24 C-FALLBACK — the old renderSchedule() empty branch printed a
  // hardcoded sample weekend (LAST YEAR's actual times) whenever the sheet
  // was unreachable, same S12 class as a mislabeled number. Unconfigured
  // deploy (this Z harness — empty PUB_ID/GID, every fetch rejecting) is the
  // sharpest proof: nothing was ever fetched, so any fact on screen is fake.
  const schedBodyTextZ = (zdoc.querySelector("#scheduleBody")?.textContent || "").trim();
  const factsDdZ = Array.from(zdoc.querySelectorAll("dl.facts dd[data-info]"))
    .map(d => (d.textContent || "").trim());
  check("X56: §24 C-FALLBACK — unconfigured deploy: #scheduleBody shows the honest empty-state message verbatim (no hardcoded fake weekend, no 'Steaks'/'9:00 am' relic), and every facts <dd> reads '—' (no stale year-baked fact)",
    schedBodyTextZ === "Schedule not loaded yet — it lives in the sheet's Schedule tab."
      && !schedBodyTextZ.includes("Steaks") && !schedBodyTextZ.includes("9:00 am")
      && factsDdZ.length === 4 && factsDdZ.every(t => t === "—"),
    "sched=" + JSON.stringify(schedBodyTextZ) + " dds=" + JSON.stringify(factsDdZ));

  domZ.window.close();
}

{
  // Identity-less rows (checkbox-range noise) are skipped entirely, producing
  // NO health flag and NO funnel count change. Append a blank-player Invites
  // row to the default fixture and verify both stay stable vs baseline.
  const invitesWithBlank = FIXTURES.invites + "2027,,TRUE,FALSE,\n";
  const blankPlayerFetch = withOverride({
    invites: () => Promise.resolve({ ok: true, status: 200, text: async () => invitesWithBlank }),
  });
  const domZ5 = makeDom("", blankPlayerFetch);
  await until(() => domZ5.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const z5doc = domZ5.window.document;
  const healthTextZ5 = z5doc.querySelector("#healthStrip")?.textContent || "";
  const warnMatchZ5 = healthTextZ5.match(/(\d+)\s*(data )?warning/i);
  const warnCountZ5 = warnMatchZ5 ? parseInt(warnMatchZ5[1], 10) : -1;
  const nyBodyTextZ5 = z5doc.querySelector("#nyBody")?.textContent || "";
  check("Z5: checkbox-range noise — identity-less Invites row (blank player, has invited/responded ticks) produces NO new health flag and NO funnel change (still '3 paid · 1 responded · 1 invited · 4 need an invite')",
    warnCountZ5 === 7 && nyBodyTextZ5.includes("3 paid · 1 responded · 1 invited · 4 need an invite"),
    "warnCount=" + warnCountZ5 + " ny=" + nyBodyTextZ5.slice(0, 200));
  domZ5.window.close();
}

/* ---------- K: scorecard grid (v2.3 §13) ---------- */
{
  const domK1 = makeDom("");
  await until(() => domK1.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  // courseYards is an internal fn; probe it via the page's own script scope
  // (same pattern as the existing S-group eval probe). try/catch so the RED
  // step prints FAIL rather than aborting the suite on ReferenceError:
  let yds; try { yds = domK1.window.eval("courseYards()"); } catch { yds = undefined; }
  check("K1: courseYards returns 18 ints from fixture", !!yds && Object.keys(yds).length === 18 && yds[1] === 385,
    JSON.stringify(yds ?? null).slice(0, 80));
  domK1.window.close();
}
{
  const domK2 = makeDom("");
  await until(() => domK2.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const d = domK2.window.document;
  const table = d.querySelector("#sgTable");
  const sgCss = [...d.querySelectorAll("style")].map(s => s.textContent).join("");
  const parSize = parseFloat((sgCss.match(/\.sg-t tr\.sg-par[^{]*\{[^}]*font-size:\s*([\d.]+)rem/) || [])[1] || 0);
  const ydsSize = parseFloat((sgCss.match(/\.sg-t tr\.sg-yds[^{]*\{[^}]*font-size:\s*([\d.]+)rem/) || [])[1] || 0);
  check("K2: grid renders one row per team + par/yds header rows",
    !!table && table.querySelectorAll("tr.sg-teamrow").length === d.querySelectorAll("#lbBody .lb-row").length
    && !!table.querySelector("tr.sg-par") && !!table.querySelector("tr.sg-yds")
    && parSize >= 0.78 && ydsSize >= 0.68);
  // Default round is "1". Duck r1: h1 4 vs par 4 → neutral; h3 4 vs par 3 → bogey.
  // Moose r1: h7 7 vs par 3 → blowup.
  const row = name => table && [...table.querySelectorAll("tr.sg-teamrow")].find(r => r.textContent.includes(name));
  const duck = row("Duck"), moose = row("Moose");
  const dc = duck ? duck.querySelectorAll("td[data-hole]") : [];
  check("K3: score-vs-par coloring classes (neutral/bogey/blowup)", dc.length === 18
    && dc[0].className === "" && dc[2].className.includes("bogey")
    && moose && moose.querySelectorAll("td[data-hole]")[6].className.includes("blowup"),
    duck ? duck.innerHTML.slice(0, 200) : "no Duck row");
  // Bear is totals-only (r1=76) — G-TOTALS: an honest totals row, no fabricated cells
  const bear = row("Bear");
  check("K4: totals-only team gets a totals row, never fabricated cells",
    bear && bear.textContent.includes("round total 76") && bear.querySelectorAll("td[data-hole]").length === 0,
    bear ? bear.textContent : "no Bear row");
  // G-SCROLL: the grid's horizontal overflow must live on .sg-scroll alone —
  // assert against the page's own CSS text, not just DOM presence.
  const cssTextK5 = [...d.querySelectorAll("style")].map(s => s.textContent).join("");
  const sgStartK5 = cssTextK5.indexOf(".sg{");
  const sgEndK5 = cssTextK5.indexOf("/* field */", sgStartK5);
  const sgCssK5 = cssTextK5.slice(sgStartK5, sgEndK5 === -1 ? sgStartK5 : sgEndK5);
  const overflowMatchesK5 = sgCssK5.match(/overflow-x/g) || [];
  const overflowLineK5 = sgCssK5.split("\n").find(l => l.includes("overflow-x")) || "";
  check("K5: page body does not scroll sideways (grid scroll is contained)",
    !!d.querySelector("#sgScroll") && overflowMatchesK5.length === 1 && overflowLineK5.includes(".sg-scroll"),
    "overflowCount=" + overflowMatchesK5.length + " overflowLine=" + overflowLineK5.trim());
  domK2.window.close();
}
{
  // G-HIDE: course tab short → honest note, cards untouched
  const domK6 = makeDom("", withOverride({ course: () => Promise.resolve({ ok: true, status: 200,
    text: async () => "hole,par,yards\n1,4,385\n2,4,410\n" }) }));
  await until(() => domK6.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const d6 = domK6.window.document;
  check("K6: partial course data hides grid behind honest note",
    d6.querySelector("#sgNote") && !d6.querySelector("#sgNote").hidden
    && d6.querySelector("#sgNote").textContent.includes("18 holes")
    && d6.querySelector("#sgScroll").hidden === true
    && d6.querySelectorAll("#lbBody .lb-row").length > 0);
  domK6.window.close();
}
{
  // K7: unplayed and zero-valued cells render blank, never 0. Tex round-2
  // fixture: h1=0 (posInt drops non-positive scores → cell stays blank)
  // and h9+ unplayed (never recorded → cell stays blank).
  const domK7 = makeDom("");
  await until(() => domK7.window.document.querySelectorAll("tr.sg-teamrow").length > 0);
  domK7.window.eval("STATE.gridRound='2';renderLeaderboard()");
  const d7 = domK7.window.document;
  const table7 = d7.querySelector("#sgTable");
  const texRow = table7 && [...table7.querySelectorAll("tr.sg-teamrow")].find(r => r.textContent.includes("Tex"));
  const texCells = texRow ? texRow.querySelectorAll("td[data-hole]") : [];
  check("K7: unplayed and zero-valued cells render blank, never 0",
    texCells.length === 18 && texCells[8].textContent.trim() === "" && texCells[0].textContent.trim() === "",
    texRow ? texRow.innerHTML.slice(0, 300) : "no Tex row");
  domK7.window.close();
}

/* ---------- L: grid focus + round toggle (v2.3 §13) ---------- */
{
  const domL = makeDom("");
  await until(() => domL.window.document.querySelectorAll("#sgTable tr.sg-teamrow").length > 0);
  const d = domL.window.document;
  check("L1: toggle visible with two rounds, round 1 active, no live hole (r1 complete)",
    d.querySelector("#sgRounds").hidden === false
    && d.querySelectorAll("#sgRounds button").length === 2
    && d.querySelector("#sgRounds button.on").dataset.rd === "1"
    && d.querySelector("#sgTable").dataset.liveHole === undefined,
    "liveHole=" + d.querySelector("#sgTable").dataset.liveHole);
  d.querySelectorAll("#sgRounds button")[1].click();
  await until(() => d.querySelector("#sgTable").dataset.round === "2");
  const row = name => [...d.querySelectorAll("#sgTable tr.sg-teamrow")].find(r => r.textContent.includes(name));
  const duckCells = row("Duck").querySelectorAll("td[data-hole]");
  const texCells = row("Tex").querySelectorAll("td[data-hole]");
  check("L2: toggling renders round 2 — live hole 1 (Tex h1=0 dropped), under coloring, blank unplayed",
    d.querySelector("#sgTable").dataset.liveHole === "1"
    && duckCells[4].className.includes("under")     // duck r2 h5: 3 vs par 4
    && texCells[0].textContent.trim() === ""        // 0 is not a score
    && texCells[17].textContent.trim() === "",      // unplayed stays blank, never 0
    "liveHole=" + d.querySelector("#sgTable").dataset.liveHole + " duckH5=" + duckCells[4].outerHTML);
  domL.window.close();
}
{
  // Single-round override → toggle hidden (G-ROUND)
  const domL3 = makeDom("", withOverride({ scores: () => Promise.resolve({ ok: true, status: 200,
    text: async () => "year,team,round,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12,h13,h14,h15,h16,h17,h18,r1,r2\n"
      + "2026,Duck,1,4,4,4,5,4,4,4,4,5,4,5,3,4,4,4,3,5,4,,\n" }) }));
  await until(() => domL3.window.document.querySelectorAll("#sgTable tr.sg-teamrow").length > 0);
  check("L3: round toggle hidden with a single round",
    domL3.window.document.querySelector("#sgRounds").hidden === true);
  domL3.window.close();
}
{
  // G-ROUND (spec): a round with ONLY totals data (no hole map) must not
  // count toward the toggle, and must never become the unswitchable
  // DEFAULT round either. Duck has a real round-1 hole card; Bear's row
  // has a blank "round" column and only r1/r2 totals, which the parser
  // (index.html ~1044-1054) turns into rounds["1"]={total} AND
  // rounds["2"]={total} — two totals-only round keys, no hole data at all.
  // Pre-fix, rounds=["1","2"] (raw key union) → toggle shown for a round 2
  // nobody has hole data for. Post-fix, rounds must derive from hole-data
  // only → rounds=["1"] → toggle hidden, and Duck's 18-cell round-1 card
  // plus Bear's honest totals row both render under round 1.
  const domL4 = makeDom("", withOverride({ scores: () => Promise.resolve({ ok: true, status: 200,
    text: async () => "year,team,round,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12,h13,h14,h15,h16,h17,h18,r1,r2\n"
      + "2026,Duck,1,4,4,4,5,4,4,4,4,5,4,5,3,4,4,4,3,5,4,,\n"
      + "2026,Bear,,,,,,,,,,,,,,,,,,,,76,76\n" }) }));
  await until(() => domL4.window.document.querySelectorAll("#sgTable tr.sg-teamrow").length > 0);
  const d4 = domL4.window.document;
  const duckRow4 = [...d4.querySelectorAll("#sgTable tr.sg-teamrow")].find(r => r.textContent.includes("Duck"));
  const bearRow4 = [...d4.querySelectorAll("#sgTable tr.sg-teamrow")].find(r => r.textContent.includes("Bear"));
  check("L4: totals-only second round shows no toggle (G-ROUND hole-data gate)",
    d4.querySelector("#sgRounds").hidden === true
    && !!duckRow4 && duckRow4.querySelectorAll("td[data-hole]").length === 18
    && !!bearRow4 && bearRow4.textContent.includes("round total 76"),
    "roundsHidden=" + d4.querySelector("#sgRounds").hidden
      + " duckCells=" + (duckRow4 ? duckRow4.querySelectorAll("td[data-hole]").length : "no Duck row")
      + " bear=" + (bearRow4 ? bearRow4.textContent : "no Bear row"));
  domL4.window.close();
}

/* ---------- N: hole panel (v2.3 §13) ---------- */
{
  const domN = makeDom("");
  await until(() => domN.window.document.querySelectorAll("#sgTable th.sg-h").length === 18);
  const d = domN.window.document;
  d.querySelector('#sgTable th.sg-h[data-hole="3"]').click();
  await until(() => !d.querySelector("#sgPanel").hidden);
  const p = d.querySelector("#sgPanel");
  check("N1: hole panel opens with par + yards + every team's score",
    p.textContent.includes("Hole 3") && p.textContent.includes("Par 3") && p.textContent.includes("175")
    && p.querySelectorAll(".sg-p-row").length === d.querySelectorAll("#sgTable tr.sg-teamrow").length,
    p.textContent.slice(0, 160));
  check("N2: map locator pin positioned from PINS",
    p.querySelector(".sg-pin") && p.querySelector(".sg-pin").getAttribute("style").includes("27")
    && p.querySelector(".sg-p-crop") && p.querySelector(".sg-p-crop-inner")
    && p.querySelector(".sg-p-crop-inner img.sg-p-crop-img") && p.querySelector(".sg-p-crop-inner .sg-pin")
    && p.querySelector("img.sg-p-crop-img").getAttribute("data-pin-x") === "27"
    && p.querySelector("img.sg-p-crop-img").getAttribute("data-pin-y") === "27"
    && !!p.querySelector(".sg-p-map"));
  check("N3: hole photo uses the assets convention with error-hide",
    p.querySelector("img.sg-p-photo") && p.querySelector("img.sg-p-photo").getAttribute("src") === "assets/holes/hole-3.jpg");
  d.querySelector('#sgTable th.sg-h[data-hole="3"]').click();
  await until(() => d.querySelector("#sgPanel").hidden);
  check("N4: second tap closes the panel (full-cycle, S14)", d.querySelector("#sgPanel").hidden === true);
  domN.window.close();
}

/* ---------- P: sheet-polish.gs parity (v2.3 §13 E-VOCAB, C-REAL) ---------- */
{
  const gsPath = path.join(ROOT, "tools", "sheet-polish.gs");
  let gs = ""; try { gs = readFileSync(gsPath, "utf8"); } catch {}
  const grab = name => { const m = gs.match(new RegExp("const " + name + "\\s*=\\s*(\\[[^;]*\\]);", "s")); return m ? JSON.parse(m[1].replace(/'/g, '"')) : null; };
  const fieldStatus = grab("FIELD_STATUS"), invStatus = grab("INVITES_STATUS"), course = grab("COURSE_DATA");
  check("P1: FIELD_STATUS matches site vocabulary In/wd/out/declined",
    JSON.stringify(fieldStatus) === JSON.stringify(["In","wd","out","declined"]), String(fieldStatus));
  check("P2: INVITES_STATUS matches F-DECLINED vocabulary",
    JSON.stringify(invStatus) === JSON.stringify(["declined","out"]), String(invStatus));
  check("P3: site actually parses that vocabulary (parity's other leg)",
    html.includes('statusLower==="out"||statusLower==="declined"') && html.includes('/^in$/i') && html.includes('"wd"'));
  // P4: parse the CHECKBOX_COLS object literal itself (not just substring
  // includes()) and set-compare its column values so an extra/renamed
  // column would fail this just as loudly as a missing one.
  const cbBody = (gs.match(/const CHECKBOX_COLS\s*=\s*(\{[^;]*\});/s) || [])[1] || "";
  const cbCols = [...cbBody.matchAll(/:\s*\[([^\]]*)\]/g)]
    .flatMap(m => m[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean))
    .sort();
  check("P4: checkbox columns are the closed list — exactly {deposit, collected, invited, responded, committed, settled}, no extras",
    gs.includes('const CHECKBOX_COLS')
    && JSON.stringify(cbCols) === JSON.stringify(["collected","committed","deposit","invited","responded","settled"])
    && !/CHECKBOX_COLS[^;]*handicap/s.test(gs));
  // P5 sibling: tools/make_template.py holds the SECOND copy of the course
  // truth (the xlsx-template rows). Regex the Course dict's rows out of the
  // python source (scoped between the "Course" and "Field" keys so we don't
  // pick up an unrelated 3-number tuple from Payout elsewhere in the file)
  // and guard it with the same C-REAL checksums.
  const pyPath = path.join(ROOT, "tools", "make_template.py");
  let py = ""; try { py = readFileSync(pyPath, "utf8"); } catch {}
  const pyCourseBlock = (py.match(/"Course":\s*\{([\s\S]*?)\n\s{4}"Field":/) || [])[1] || "";
  const pyCourse = [...pyCourseBlock.matchAll(/\[(\d+),\s*(\d+),\s*(\d+)\]/g)]
    .map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
  check("P5: COURSE_DATA passes C-REAL checksums (both the .gs and tools/make_template.py copies), including the 36/36 front/back par split so a within-course par swap across nines can't pass",
    !!course && course.length === 18
    && course.reduce((s, r) => s + r[1], 0) === 72
    && course.slice(0,9).reduce((s, r) => s + r[1], 0) === 36
    && course.slice(9).reduce((s, r) => s + r[1], 0) === 36
    && course.slice(0,9).reduce((s, r) => s + r[2], 0) === 3094
    && course.slice(9).reduce((s, r) => s + r[2], 0) === 3007
    && pyCourse.length === 18
    && pyCourse.reduce((s, r) => s + r[1], 0) === 72
    && pyCourse.slice(0,9).reduce((s, r) => s + r[1], 0) === 36
    && pyCourse.slice(9).reduce((s, r) => s + r[1], 0) === 36
    && pyCourse.slice(0,9).reduce((s, r) => s + r[2], 0) === 3094
    && pyCourse.slice(9).reduce((s, r) => s + r[2], 0) === 3007,
    "pyCourse=" + JSON.stringify(pyCourse));
  const triggs = (() => { try { return readFileSync(path.join(ROOT, "tools", "sheet-triggers.gs"), "utf8"); } catch { return ""; } })();
  const promo = (() => { try { return readFileSync(path.join(ROOT, "tools", "gfy-promote.gs"), "utf8"); } catch { return ""; } })();
  check("P6: scripts embed no sheet ids/urls (safe for public repo) — polish, triggers, AND gfy-promote",
    gs.length > 0 && triggs.length > 0 && promo.length > 0
    && !/docs\.google\.com|spreadsheets\/d\//.test(gs) && !/docs\.google\.com|spreadsheets\/d\//.test(triggs)
    && !/docs\.google\.com|spreadsheets\/d\//.test(promo));
  // P7: 2026-08-24 wave structural parity — the sheet-side halves the jsdom
  // suite can't execute. colorInvites_ must exist in polish and be year-aware
  // (COUNTIFS against Field, not a name-only MATCH) with BOTH dead statuses;
  // gfy-promote must carry both menu actions and seed veterans-first (a
  // `since` sort); START HERE must point at the GFY menu flow.
  const ciBody = (gs.match(/function colorInvites_[\s\S]*?\n\}/) || [""])[0];
  // seedBody extracted the same way as ciBody (review F9: a bare
  // /seedInvites[\s\S]*since/ matched the onOpen menu registration plus
  // promoteCommitted's own "since" — the seed sort could vanish unseen).
  const seedBody = (promo.match(/function seedInvites[\s\S]*?\n\}/) || [""])[0];
  check("P7: colorInvites_ is year-aware COUNTIFS w/ out+declined; promote has Promote+Seed menu items; seedInvites' OWN body carries the veterans-first since sort; START HERE names the GFY menu",
    ciBody.includes("COUNTIFS") && ciBody.includes('INDIRECT("Field!') && ciBody.includes("committed")
    && ciBody.includes('"out"') && ciBody.includes('"declined"')
    && promo.includes('"promoteCommitted"') && promo.includes('"seedInvites"')
    && seedBody.includes(".sort") && seedBody.includes("since")
    && gs.includes("GFY menu"),
    "ciBody.len=" + ciBody.length + " seedBody.len=" + seedBody.length);
  // P8 (BACKLOG #16 — confirmed live 2026-09-01): a CF formula is evaluated
  // RELATIVE to every cell of its range, and polish applies these rules across
  // the sheet's FULL WIDTH. An un-anchored column ref therefore shifts per
  // column: `G2=FALSE` reads H2 in column B, I2 in column C, and so on — the
  // row tint only *looked* right because blank cells coerce to FALSE. Live
  // Field row 7 proved it (B7 white, the rest red). Every cell reference in a
  // whenFormulaSatisfied formula must carry a `$` column anchor.
  // Teeth: the detector is run against the CURRENT source AND against a
  // mutant with the anchors stripped — if the mutant does not trip, the check
  // is vacuous and P8 fails on that leg alone.
  const cfFormulas = src => [...src.matchAll(/whenFormulaSatisfied\(`([^`]*)`\)/g)].map(m => m[1]);
  const unanchoredRefs = f => [
    // interpolated column ref immediately followed by a row number: ${col}2
    ...[...f.matchAll(/(?<!\$)(\$\{[^}]*\})(\d+)/g)].map(m => m[1] + m[2]),
    // literal column ref: A2 / AB2, not already anchored and not part of a
    // quoted A1 range like "Field!B:B"
    ...[...f.matchAll(/(?<![$A-Za-z0-9_!:])([A-Z]{1,2})(\d+)\b/g)].map(m => m[1] + m[2]),
  ];
  const cfBody = name => (gs.match(new RegExp("function " + name + "[\\s\\S]*?\\n\\}")) || [""])[0];
  const cfNames = ["colorField_", "colorRooms_", "colorInvites_"];
  const cfLive = cfNames.map(n => ({ n, body: cfBody(n) }));
  const liveOffenders = cfLive.flatMap(({ n, body }) =>
    cfFormulas(body).flatMap(f => unanchoredRefs(f).map(r => n + ":" + r)));
  // Mutant: strip the `$` that anchors an interpolated ref (`$${c}2` -> `${c}2`)
  // and the `$` on literal refs (`$A2` -> `A2`), then re-run the detector.
  const cfMutant = cfLive.map(({ n, body }) =>
    ({ n, body: body.replace(/\$(\$\{)/g, "$1").replace(/\$([A-Z]{1,2}\d)/g, "$1") }));
  const mutantOffenders = cfMutant.flatMap(({ n, body }) =>
    cfFormulas(body).flatMap(f => unanchoredRefs(f).map(r => n + ":" + r)));
  check("P8: every conditional-format formula in polish ($-anchoring, BACKLOG #16) — colorField_/colorRooms_/colorInvites_ carry NO un-anchored cell reference, and the detector has teeth (an anchor-stripped mutant trips it)",
    cfLive.every(({ body }) => body.length > 0)
    && cfLive.some(({ body }) => cfFormulas(body).length > 0)
    && liveOffenders.length === 0
    && mutantOffenders.length > 0,
    "live=" + JSON.stringify(liveOffenders) + " mutant=" + JSON.stringify(mutantOffenders));
  // P9 (BACKLOG #19.1 — the wipe's fabrication): promote's `since` decision,
  // exercised as REAL LOGIC rather than by regex. gfy-promote.gs needs a live
  // spreadsheet, so pcSinceFor_ was isolated as a pure function precisely so
  // this leg can run. Riley's 09-02 ruling empties Field; the pre-fix rule
  // ("no Field row anywhere" => since = promoted year) then badges the ENTIRE
  // field ROOKIE on a public site. Rookie-ness is only provable when Field
  // carries a season EARLIER than the one promoted into.
  const sinceSrc = (promo.match(/function pcSinceFor_[\s\S]*?\n\}/) || [""])[0];
  const buildSince = src => { try { return new Function(src + "\nreturn pcSinceFor_;")(); } catch { return null; } };
  const since = buildSince(sinceSrc);
  // Mutant restores the pre-fix rule: rookie-ness provable whenever the player
  // has no Field row, regardless of whether any history exists to be absent from.
  const sinceMutant = buildSince(sinceSrc.replace(/\(fieldYears \|\| \[\]\)\.some\(function\(fy\)\{ return fy < y; \}\)/, "true"));
  const legs = since && sinceMutant ? (() => {
    const wiped = [], history = [2019, 2025, 2026], sameYearOnly = [2027];
    return {
      // THE FIX: Field wiped -> nothing could be absent -> blank + fill it.
      wiped:       since("",     false, 2027, wiped),
      // mid-wipe: rows are accumulating for 2027 but still no earlier season.
      sameYear:    since("",     false, 2027, sameYearOnly),
      // real history present and he is genuinely absent from it -> rookie.
      realRookie:  since("",     false, 2027, history),
      // a recorded since always wins, untouched.
      recorded:    since(2019,   true,  2027, history),
      // returning player whose rows never recorded a since -> blank (pre-existing rule, preserved).
      returning:   since("",     true,  2027, history),
      // the pre-fix rule, proving these legs have teeth.
      mutantWiped: sinceMutant("", false, 2027, wiped),
    };
  })() : null;
  check("P9: promote's since rule is honest on a wiped Field (BACKLOG #19.1) — no earlier season on Field means NO rookie claim (blank + 'fill it'), a real history still yields '(rookie)', a recorded since always wins; the pre-fix rule is carried as a mutant and must disagree",
    !!legs
    && legs.wiped.since === "" && / \(since unknown — fill it\)$/.test(legs.wiped.note)
    && legs.sameYear.since === "" && / \(since unknown — fill it\)$/.test(legs.sameYear.note)
    && legs.realRookie.since === 2027 && legs.realRookie.note === " (rookie)"
    && legs.recorded.since === 2019 && legs.recorded.note === ""
    && legs.returning.since === "" && / \(since unknown — fill it\)$/.test(legs.returning.note)
    // teeth: the pre-fix rule fabricates exactly what the fix removes
    && legs.mutantWiped.since === 2027
    // and the fix is actually WIRED — promoteCommitted must route through it,
    // with no surviving promoted-year default at the call site.
    && /const dec = pcSinceFor_\(/.test(promo)
    && !/row\[fh\.since\]\s*=\s*prior\s*\?/.test(promo),
    JSON.stringify(legs));
}

/* ---------- Q: presend-check (v2.3 §13 V-MATCH/V-PATH) ---------- */
{
  const mod = await import("../tools/presend-check.mjs").catch(() => null);
  check("Q1: presend-check exports its pure functions",
    !!mod && [mod.parseCsv, mod.insideRepo, mod.diffVault, mod.scanForEmails].every(f => typeof f === "function"));
  if (mod) {
    const rows = mod.parseCsv('player,email\n"Duck, Sr.",d@example.com\nTex,t@example.com\n"Multi\nLine",m@example.com');
    check("Q2: parseCsv handles quoted commas and a quoted embedded newline",
      rows.length === 3 && rows[0].player === "Duck, Sr."
      && rows[2].player === "Multi\nLine" && rows[2].email === "m@example.com",
      JSON.stringify(rows));
    const contacts = [
      { player: "Duck", email: "d@example.com", do_not_invite: "FALSE" },
      { player: "Sully", email: "s@example.com", do_not_invite: "FALSE" },
      { player: "Tank", email: "t@example.com", do_not_invite: "TRUE", reason: "sample" },
      // Bear: DNI, paired with an out-status Invites row, no ticks —
      // correctly suppressed, must be SILENT (not a violation, not unpaired).
      { player: "Bear", email: "b@example.com", do_not_invite: "TRUE", reason: "paired" },
      // Ghost: DNI with NO Invites-NEXT row at all — the dangerous unpaired
      // state (the site's funnel would resurface them).
      { player: "Ghost", email: "g@example.com", do_not_invite: "TRUE", reason: "unpaired" },
      // Wolf: DNI, Invites-NEXT row has NO ticks and a BLANK status —
      // isolates the STATUS leg alone: must still be a violation even though
      // the ticks leg has nothing to fire on.
      { player: "Wolf", email: "w@example.com", do_not_invite: "TRUE", reason: "status-leg-only" },
      // Fox: DNI, Invites-NEXT row is `declined` with no ticks — must be
      // SILENT, proving "declined" (not just "out") is honored as a dead
      // status by the status leg.
      { player: "Fox", email: "f@example.com", do_not_invite: "TRUE", reason: "declined-silent" },
    ];
    const invites = [
      { year: "2027", player: "Duck" },
      // Tank: ticks fired but status is already a clean "out" — isolates the
      // TICKS leg alone: must still be a violation even though the status
      // leg would call this row clean.
      { year: "2027", player: "Tank", invited: "TRUE", status: "out" },
      { year: "2027", player: "Hammer" },
      { year: "2027", player: "Bear", status: "out" },      // DNI + out, no ticks -> paired/silent
      { year: "2027", player: "Wolf" },                     // DNI, no ticks, blank status -> status-leg violation
      { year: "2027", player: "Fox", status: "declined" },  // DNI + declined, no ticks -> paired/silent
    ];
    const d = mod.diffVault(contacts, invites);
    const violationNames = d.dniViolations.map(c => c.player).sort();
    const unpairedNames = d.dniUnpaired.map(c => c.player).sort();
    check("Q3: diff both directions + DNI three-state, BOTH violation legs gated INDEPENDENTLY (Tank = ticks-leg-only, status already clean 'out'; Wolf = status-leg-only, no ticks at all; Fox proves 'declined' is honored as a dead status same as 'out')",
      d.neverInvited.length === 1 && d.neverInvited[0].player === "Sully"
      && d.missingFromVault.length === 1 && d.missingFromVault[0] === "Hammer"
      // exact violation set, pinned by name: Tank (ticks leg alone) + Wolf (status leg alone).
      && JSON.stringify(violationNames) === JSON.stringify(["Tank", "Wolf"])
      // exact unpaired set, pinned by name: Ghost only (no Invites-NEXT row at all).
      && JSON.stringify(unpairedNames) === JSON.stringify(["Ghost"])
      // Bear (out) and Fox (declined) are paired/silent -> absent from BOTH sets.
      && !d.dniViolations.some(c => c.player === "Bear") && !d.dniUnpaired.some(c => c.player === "Bear")
      && !d.dniViolations.some(c => c.player === "Fox") && !d.dniUnpaired.some(c => c.player === "Fox"),
      JSON.stringify(d));
    // IMPORTANT-6 dedup proof: header "player,email,,," has three unnamed
    // trailing columns; pre-fix they all collapsed onto one "" key (last
    // value wins) and silently swallowed an address planted in an earlier
    // one. Leave the named "email" column blank so the only email-ish value
    // in the row lives in the de-duped unnamed column (col_3).
    const dedupRows = mod.parseCsv("player,email,,,\nDuck,,,hidden@example.com,\n");
    // MINOR-7 proof: an email-like string in the HEADER LINE itself (never
    // reached by scanForEmails, which only walks parsed data rows).
    const headerHit = typeof mod.scanHeaderLine === "function"
      ? mod.scanHeaderLine("rooms", "player,notes@example.com,reason\nDuck,x,y\n")
      : [];
    check("Q4: value-level email watchdog fires (headers clean, value dirty); duplicate/empty-header de-dup preserves a value hidden in an unnamed column; header-line scan flags an email-like header",
      mod.scanForEmails("rooms", [{ notes: "mail me at stray@example.com" }]).length === 1
      && mod.scanForEmails("rooms", [{ notes: "no address here" }]).length === 0
      && mod.scanForEmails("rooms", dedupRows).length === 1
      && headerHit.length === 1 && /rooms HEADER contains email-like text/.test(headerHit[0]),
      "dedupRows=" + JSON.stringify(dedupRows) + " headerHit=" + JSON.stringify(headerHit));
    check("Q5: vault file inside the repo is refused; the repo root itself counts as inside; a sibling-prefix path is NOT inside (path.sep boundary, not a string prefix)",
      mod.insideRepo(path.join(ROOT, "vault.csv"), ROOT) === true
      && mod.insideRepo("/tmp/contacts.csv", ROOT) === false
      && mod.insideRepo(ROOT, ROOT) === true
      && mod.insideRepo(path.join(path.dirname(ROOT), path.basename(ROOT) + "-notes", "vault.csv"), ROOT) === false);
  }
}

/* ---------- T: sheet-triggers.gs parity (v2.4 §14) ---------- */
{
  let tg = ""; try { tg = readFileSync(path.join(ROOT, "tools", "sheet-triggers.gs"), "utf8"); } catch {}
  check("T1: triggers script exists with OnlyCurrentDoc + no ids/urls",
    tg.includes("@OnlyCurrentDoc") && !/docs\.google\.com|spreadsheets\/d\//.test(tg) && tg.length > 0);
  check("T2: writer uses LockService + S-KEY normalization + first_tee year (F-LOCK/F-NKEY/F-YEAR)",
    tg.includes("LockService.getDocumentLock") && tg.includes('replace(/\\s+/g, " ").toLowerCase()')
    && tg.includes("first_tee") && !/new Date\(\)\.getFullYear\(\)[^]*writeScore/.test(tg));
  check("T3: writer touches Scores only; stamp touches Field only (closed surfaces)",
    /getSheetByName\("Scores"\)/.test(tg) && /getSheetByName\("Field"\)/.test(tg)
    && !/getSheetByName\("(Calcutta|Ledger|Rooms|Invites|Course|Payout|Champions|Shame|Schedule|Pairings)"\)/.test(tg.split("function onDepositEdit")[0] || tg));
  check("T4: stamp uses sheet timezone + never erases (F-STAMP-IMPL)",
    tg.includes("getSpreadsheetTimeZone()") && tg.includes('Utilities.formatDate') && /never erases|do not erase/i.test(tg));
  const ps = readFileSync(path.join(ROOT, "tools", "sheet-polish.gs"), "utf8");
  check("T5: buildStartHere_ dashboard + seasonal logic (F-START-LINKS, F-START, F-IDEM)",
    ps.includes("function buildStartHere_") && ps.includes('ss.getUrl()') && !/docs\.google\.com|spreadsheets\/d\//.test(ps)
    && ps.includes('"START HERE"') && ps.includes("inEventWindow_") && ps.includes("first_tee")
    && ps.includes("Scoring form URL") && /findIndex|indexOf\("Scoring form URL"\)|indexOf\('Scoring form URL'\)/.test(ps)
    && !/getRange\("B7"\)/.test(ps));
}

/* ---------- U: v2.5 tournament refinement (§15) ---------- */
{
  // 4-player team + a draft pool (B-CAPTAIN / D-DRAFT fixtures — synthetic)
  const fieldU = [
    "year,player,team,since,handicap,status,deposit,paid_date,strengths",
    "2026,Duck,Duck,2019,8,In,TRUE,,steady putter",
    "2026,Hammer,Duck,2019,10,In,TRUE,,",
    "2026,Sully,Duck,2021,15,In,TRUE,,",
    "2026,Tank,Duck,2026,20,In,TRUE,,",
    "2026,Wade Boggs,,2022,9,In,TRUE,,long drives",
    "2026,Jake,,2024,,In,TRUE,,",
    "2026,Ghost,,2020,12,out,,,",
    "2026,Blade,,2020,13,wd,,,",
    "2026,Crash,,2020,14,declined,,,",
  ].join("\n");
  const fetchU = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldU }),
  });
  const domU = makeDom("", fetchU);
  const docU = domU.window.document;
  await until(() => docU.querySelectorAll("#lbBody .lb-row").length > 0);

  const duckRow = [...docU.querySelectorAll("#lbBody .lb-row")]
    .find(r => (r.querySelector(".lb-name")?.textContent || "").includes("Duck"));
  const duckName = duckRow?.querySelector(".lb-name");
  const gridTh = [...docU.querySelectorAll("#sgTable tr.sg-teamrow th.sg-team")]
    .find(th => th.textContent.includes("Duck"));
  check("U1: B-CAPTAIN — 4-player team's board row and grid sticky column show the captain ONLY (cap-marked), no partner names",
    !!duckName && duckName.textContent.trim() === "Duck" && capMarked(duckName.innerHTML, "Duck")
    && !!gridTh && gridTh.textContent.trim() === "Duck",
    "board=" + JSON.stringify(duckName?.textContent) + " grid=" + JSON.stringify(gridTh?.textContent));

  duckRow?.click();
  await until(() => !!docU.querySelector("#lbBody .card-drop"));
  const rosterHead = docU.querySelector("#lbBody .card-drop .card-roster");
  check("U2: B-CAPTAIN — tap-open card gains a roster header with ALL FOUR names, captain cap-marked",
    !!rosterHead && ["Duck","Hammer","Sully","Tank"].every(n => rosterHead.textContent.includes(n))
    && capMarked(rosterHead.innerHTML, "Duck"),
    rosterHead ? rosterHead.textContent : "no .card-roster");
  domU.window.close();
}

{
  // H-PODIUM on the default fixtures (own dom — the main one is closed upstream)
  const domH = makeDom("");
  const docH = domH.window.document;
  await until(() => docH.querySelectorAll("#lbBody .lb-row").length > 0);
  const entries = [...docH.querySelectorAll("#champBody .entry")];
  const minors = entries.filter(e => e.classList.contains("entry-minor"));
  check("U3: H-PODIUM — 2024 renders a full podium: place-1 Duck (blank place = 1st, legacy), 2nd Sully, 3rd Tex, each with its roster",
    entries.length === 5 && minors.length === 2
    && minors.some(e => e.querySelector(".entry-year")?.textContent === "2nd" && /Sully/.test(e.textContent) && /Wade Johnson/.test(e.querySelector(".entry-roster")?.textContent || ""))
    && minors.some(e => e.querySelector(".entry-year")?.textContent === "3rd" && /Tex & Tank/.test(e.querySelector(".entry-roster")?.textContent || ""))
    && entries.some(e => !e.classList.contains("entry-minor") && /Duck/.test(e.textContent) && /Duck · Hammer/.test(e.querySelector(".entry-roster")?.textContent || "")),
    "entries=" + entries.length + " minors=" + minors.length + " :: " + entries.map(e => e.querySelector(".entry-year")?.textContent + "|" + e.querySelector(".entry-name")?.textContent).join(" ; "));
  const champsNo1 = 'year,champion,score,place,players\n2026,Moose,150 (+6),2,\n2024,Duck,151 (+7),,Duck · Hammer\n';
  const domB = makeDom("", withOverride({
    champions: () => Promise.resolve({ ok: true, status: 200, text: async () => champsNo1 }),
  }));
  await until(() => domB.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docB = domB.window.document;
  const birdB = docB.querySelector("#homeBird")?.textContent || "";
  const b2026 = [...docB.querySelectorAll("#champBody .entry")].filter(e => /Moose/.test(e.textContent));
  check("U4: H-PODIUM — years without 2nd/3rd rows render only what exists (2023, 2019 single entries, no fabricated placings); bird holder stays the latest place-1 row (Duck); and a latest year WITHOUT any place-1 row never fabricates a bird nor falls back to an older year",
    entries.filter(e => e.querySelector(".entry-year")?.textContent === "2023").length === 1
    && entries.filter(e => e.querySelector(".entry-year")?.textContent === "2019").length === 1
    && (docH.querySelector("#homeBird")?.textContent || "").includes("Duck")
    && !/Moose/.test(birdB) && !/since 2026/.test(birdB) && !/since 2024/.test(birdB)
    && b2026.length === 1 && b2026[0].classList.contains("entry-minor") && b2026[0].querySelector(".entry-year")?.textContent === "2nd",
    "");
  domB.window.close();
  domH.window.close();
}
{
  // U-DUPES: two place-1 rows same year → BOTH render + health flag, no silent
  // de-dup. Gate on the BOARD, not #champBody — static markup ships 6 .entry
  // divs, so a champBody-based until() fires before the fetch resolves.
  const champsDup = 'year,champion,score,place,players\n2024,Duck,151 (+7),1,\n2024,Moose,151 (+7),1,\n';
  const fetchDup = withOverride({
    champions: () => Promise.resolve({ ok: true, status: 200, text: async () => champsDup }),
  });
  const domDup = makeDom("", fetchDup);
  const docDup = domDup.window.document;
  await until(() => docDup.querySelectorAll("#lbBody .lb-row").length > 0);
  const dupEntries = [...docDup.querySelectorAll("#champBody .entry")];
  const healthDup = docDup.querySelector("#healthStrip")?.textContent || "";
  check("U5: U-DUPES — duplicate same-year place-1 rows ALL render + health-strip flag (no silent de-dup, no fabricated podium)",
    dupEntries.length === 2 && /Duck/.test(dupEntries.map(e=>e.textContent).join(" ")) && /Moose/.test(dupEntries.map(e=>e.textContent).join(" "))
    && /duplicate/i.test(healthDup),
    "entries=" + dupEntries.length + " health=" + healthDup.slice(0, 160));
  domDup.window.close();
}

{
  // D-DRAFT: pool/drafted split + U-POOL filter + U-TOKENS badges.
  // Field: 4-player Duck team drafted; Wade Boggs + Jake in the pool;
  // Ghost(out)/Blade(wd)/Crash(declined) excluded. Champions: Wade wins 2024
  // (messy-token spelling — normalization), Jake takes 2nd 2023, and
  // "Jakeb Smith" must NOT badge Jake (exact-token, never substring).
  const fieldU2 = [
    "year,player,team,since,handicap,status,deposit,paid_date,strengths",
    "2026,Duck,Duck,2019,8,In,TRUE,,steady putter",
    "2026,Hammer,Duck,2019,10,In,TRUE,,",
    "2026,Sully,Duck,2021,15,In,TRUE,,",
    "2026,Tank,Duck,2026,20,In,TRUE,,",
    "2026,Wade Boggs,,2022,9,In,TRUE,,long drives",
    "2026,Jake,,2024,,In,TRUE,,",
    "2026,Ghost,,2020,12,out,,,",
    "2026,Blade,,2020,13,wd,,,",
    "2026,Crash,,2020,14,declined,,,",
  ].join("\n");
  const champsU2 = [
    "year,champion,score,place,players",
    '2024,Duck,151 (+7),,"Jakeb Smith · wade  BOGGS"',
    '2023,Sully,150 (+6),2,"Jake, Bo"',
  ].join("\n");
  const fetchU2 = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldU2 }),
    champions: () => Promise.resolve({ ok: true, status: 200, text: async () => champsU2 }),
  });
  const domU2 = makeDom("", fetchU2);
  const docU2 = domU2.window.document;
  await until(() => docU2.querySelectorAll("#draftPool .drow, #draftPool .lb-empty").length > 0);

  const poolRows = [...docU2.querySelectorAll("#draftPool .drow")];
  const poolNames = poolRows.map(r => r.querySelector(".drow-player")?.textContent.trim());
  check("U6: U-POOL — pool = active-season blank-team rows minus out/wd/declined, handicap ascending with blank handicaps last",
    poolRows.length === 2 && poolNames[0] === "Wade Boggs" && poolNames[1] === "Jake",
    JSON.stringify(poolNames));

  const wade = poolRows.find(r => r.textContent.includes("Wade Boggs"));
  const jake = poolRows.find(r => r.querySelector(".drow-player")?.textContent.trim() === "Jake");
  check("U7: U-TOKENS — Wade Boggs gets 🏆 2024 (messy token normalized), Jake gets a lighter 2nd '23 and NO trophy (Jakeb must not match Jake); strengths render",
    !!wade && /🏆/.test(wade.textContent) && /2024/.test(wade.querySelector(".pod-win")?.textContent || "")
    && /long drives/.test(wade.textContent)
    && !!jake && !/🏆/.test(jake.textContent) && /2nd/.test(jake.querySelector(".pod-minor")?.textContent || "")
    && /2nd ’23/.test(jake.querySelector(".pod-minor")?.textContent || ""),
    "wade=" + (wade?.textContent || "").slice(0, 120) + " jake=" + (jake?.textContent || "").slice(0, 120));

  const teamGroups = [...docU2.querySelectorAll("#draftTeams .draft-team")];
  const duckNames = teamGroups.length === 1
    ? [...teamGroups[0].querySelectorAll(".drow-player")].map(e => e.textContent.trim()) : [];
  check("U8: D-DRAFT — drafted column groups by team, captain FIRST, all four members listed",
    teamGroups.length === 1 && duckNames[0] === "Duck"
    && ["Hammer","Sully","Tank"].every(n => duckNames.includes(n))
    && duckNames.length === 4,
    JSON.stringify(duckNames));
  domU2.window.close();
}
{
  // Honest empty state: base 2026 field is fully drafted → the pool announces
  // draft complete. Own dom — the main one is closed upstream.
  const domU9 = makeDom("");
  const docU9 = domU9.window.document;
  await until(() => docU9.querySelectorAll("#lbBody .lb-row").length > 0);
  const poolEmpty = docU9.querySelector("#draftPool")?.textContent || "";
  check("U9: D-DRAFT — all-drafted pool renders 'draft complete' empty state on the default fixture",
    /pool empty — draft complete/i.test(poolEmpty), poolEmpty.slice(0, 120));
  domU9.window.close();
}
{
  // No active-season Field rows at all → the view says so, honestly. Gate on
  // the DISAPPEARANCE of #draftPool: the static markup ships the Pool/Drafted
  // shell, so a textContent-length gate would fire before the fetch resolves;
  // the empty-state branch replaces #draftBody's innerHTML, destroying the node.
  const fieldNone = "year,player,team,since,handicap,status,deposit,paid_date,strengths\n2027,Duck,,,,,TRUE,2026-08-20,\n";
  const fetchNone = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldNone }),
  });
  const domNone = makeDom("", fetchNone);
  const docNone = domNone.window.document;
  await until(() => !docNone.querySelector("#draftPool"));
  check("U10: D-DRAFT — zero active-season Field rows renders the view's own note (no fabricated pool)",
    /lights up|fills in/i.test(docNone.querySelector("#draftBody")?.textContent || ""),
    (docNone.querySelector("#draftBody")?.textContent || "").slice(0, 120));
  domNone.window.close();
}
{
  const py = readFileSync(path.join(ROOT, "tools", "make_template.py"), "utf8");
  check("U11: template generator carries the §15 columns — Champions place+players, Field strengths",
    /"place",\s*"players"/.test(py.slice(py.indexOf('"Champions"'), py.indexOf('"Shame"')))
    && /"strengths"/.test(py.slice(py.indexOf('"Field"'), py.indexOf('"Scores"'))),
    "");
  const gsPolish = readFileSync(path.join(ROOT, "tools", "sheet-polish.gs"), "utf8");
  check("U12: START HERE states the N-FULLNAMES convention (first + last, matching everywhere)",
    /first\s*\+\s*last/i.test(gsPolish),
    "");
}

/* ---------- J: ops hardening (§19) ---------- */
{
  const polishSrc = readFileSync(path.join(ROOT, "tools", "sheet-polish.gs"), "utf8");
  const trigSrc = readFileSync(path.join(ROOT, "tools", "sheet-triggers.gs"), "utf8");
  check("J1: O-SCOPE — BOTH .gs files carry @OnlyCurrentDoc (repo copies are paste-safe)",
    polishSrc.includes("@OnlyCurrentDoc") && trigSrc.includes("@OnlyCurrentDoc"), "");
  check("J2: O-REJECT — rejections name their real cause: missing-Team-answer message + year-scoped roster miss",
    trigSrc.includes('rejected: no Team answer') && /rejected: team not in roster for " \+ year/.test(trigSrc), "");
  check("J3: O-REPLACED — overwrite audit: prior value read before setValue, applied (replaced N) mark, semantics recorded not arbitrated",
    /getValue\(\)[^]*setValue\(score\)/.test(trigSrc.split("function writeScore_")[1] || "")
    && trigSrc.includes('"applied (replaced " + replaced + ")"'), "");
  // J4 ADAPTED (v2.6 reconciliation merge, scorer-v26 x v2.1-invites): the target's
  // O-TEAMLIST wrote a SECOND, redundant team-list block ("FORM TEAM LIST" +
  // teamList_/seasonYear_) alongside the branch's pre-existing "FORM TEAM DROPDOWN"
  // block (startHereRoster_/startHereYear_, typeof-guarded delegation to
  // sheet-triggers.gs's canonical rosterTeams_/firstTeeYear_ when pasted into the
  // same Apps Script project). Per the reconciliation checklist these collapse to
  // ONE block — the branch's naming + derivation wins structurally. The original
  // J4 also asserted the retired "Scoring form URL (paste once):" START HERE
  // anchor, which the branch deliberately retired (config-home migration:
  // score_endpoint/form_url now live on the Info tab, with a content-anchored
  // value-preservation row carrying forward anything already pasted in the old
  // slot). J4 is rewritten to assert that migration's replacement reality instead
  // of the retired cell, and to assert the collapse actually happened (one
  // surviving block, no leftover redundant derivation).
  //
  // COMPANION ASSERT (post-approval fix, same reconciliation): the collapse above
  // dropped O-TEAMLIST's honest "(no teams yet...)" empty-roster placeholder — a
  // real regression flagged in the reconciliation report and restored in
  // buildStartHere_ for BOTH blocks (CAPTAIN SCORING LINKS and FORM TEAM
  // DROPDOWN). The entire J group (like T5 above it) is a STATIC source-text
  // harness — sheet-polish.gs/sheet-triggers.gs are read as raw strings via
  // readFileSync, never executed (SpreadsheetApp doesn't exist in Node), so
  // there is no polish() fixture to re-run with an empty Field roster. Per the
  // reviewer's authorized fallback, this asserts the placeholder string's
  // presence directly in the buildStartHere_ SOURCE, twice (once per block,
  // each gated on its own `roster.length ?` ternary) — weaker than an
  // executed empty-roster render, but honest about what this harness can
  // check.
  check("J4: (ADAPTED, v2.6 reconciliation + reviewer fix-now) FORM TEAM DROPDOWN is the ONE surviving team-list block (O-TEAMLIST's FORM TEAM LIST + teamList_ collapsed into it); the retired 'Scoring form URL (paste once)' anchor was superseded by the config-home migration (moved-to-Info label + value-preservation row); the honest empty-roster placeholder is restored in BOTH surviving blocks (static source check — no runtime polish() fixture exists in this harness)",
    polishSrc.includes("FORM TEAM DROPDOWN") && polishSrc.includes("Scoring config moved")
    && polishSrc.includes("old value preserved below, copy it to Info")
    && !polishSrc.includes("FORM TEAM LIST") && !/function teamList_/.test(polishSrc)
    && (polishSrc.match(/\(no teams yet — the draft fills this in; re-run polish\(\) after\)/g) || []).length === 2
    && (polishSrc.match(/roster\.length \?/g) || []).length === 2, "");
}
{
  const preSrc = readFileSync(path.join(ROOT, "tools", "presend-check.mjs"), "utf8");
  check("J5: O-EXTRAGID — repeatable --extra-gid name=gid, strict validation + collision guard exit 2, merged into the watchdog loop, exported readConfig",
    preSrc.includes('"--extra-gid"') && /--extra-gid needs name=gid/.test(preSrc)
    && /collides with a config GID key/.test(preSrc)
    && /\{\s*\.\.\.gids,\s*\.\.\.extraGids\s*\}/.test(preSrc)
    && preSrc.includes("export function readConfig"), "");
  check("J6: O-VPROBE-LOUD — missing --vault-url prints the NOT-proven-unpublished warning (in the else of the vaultUrl gate)",
    preSrc.includes("V-PROBE SKIPPED — no --vault-url given; the vault is NOT proven unpublished this run.")
    && /\}\s*else\s*\{[^{}]*V-PROBE SKIPPED/.test(preSrc), "");
}
{
  let ctSrc = ""; try { ctSrc = readFileSync(path.join(ROOT, "tools", "check_template.py"), "utf8"); } catch {}
  let gcSrc = ""; try { gcSrc = readFileSync(path.join(ROOT, "tools", "gid-check.mjs"), "utf8"); } catch {}
  const adminSrc = readFileSync(path.join(ROOT, "tools", "make_admin_template.py"), "utf8");
  check("J7: O-TEMPLATECHECK — read-only content diff (no xlsx write anywhere in the checker)",
    ctSrc.length > 0 && !ctSrc.includes(".save(") && /load_workbook/.test(ctSrc), "");
  check("J8: O-GIDCHECK — print-only (no config write), fail-loud on unparseable pubhtml, shares presend's readConfig",
    gcSrc.length > 0 && !/writeFileSync|createWriteStream/.test(gcSrc)
    && /could not parse the tab map/.test(gcSrc)
    && /import\s*\{[^}]*readConfig[^}]*\}\s*from/.test(gcSrc)
    && /GID block did not parse/.test(gcSrc), "");
  check("J9: O-ADMINPATH — __file__-resolved output, __main__ guard, READ ME teaches --vault-url",
    /__file__/.test(adminSrc) && /__main__/.test(adminSrc) && adminSrc.includes("--vault-url"), "");
}
{
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  // J10 ADAPTED (v2.6 reconciliation merge): same collapse as J4 above — README's
  // operational instructions must point at the block that actually exists on the
  // sheet (FORM TEAM DROPDOWN), not the superseded "FORM TEAM LIST" name from
  // O-TEAMLIST, which would otherwise send an operator hunting START HERE for a
  // block that no longer exists.
  check("J10: (ADAPTED, v2.6 reconciliation) §19 docs — README teaches --extra-gid responses scan, check-template, check-gids, the surviving FORM TEAM DROPDOWN block, and has ONE vault section with a pointer",
    readme.includes("--extra-gid responses=") && readme.includes("npm run check-template")
    && readme.includes("npm run check-gids") && readme.includes("FORM TEAM DROPDOWN")
    && (readme.match(/^## .*[Vv]ault/gm) || []).length === 1, "");
}

/* ---------------------------------------------------------------------
   Group Y: crest v3 Park Badge (spec §16). Y1 = outline enforcement (the
   hero's only <text> is the live EST ribbon), Y2 = MARK_PATH single
   authority, Y3 = sheet-driven est_year still lands in the ribbon.
   --------------------------------------------------------------------- */
{
  // Y1/Y2: static assertions against a fresh dom + raw html source. The
  // file-level `dom` const is already closed by Group Z's guardrail
  // teardown (which runs earlier in file order, before Group U/Y), so Y1
  // gets its own dom like every other isolated check in this file; `html`
  // is a file-level const and never closes.
  const domY1 = makeDom("");
  const crestY = domY1.window.document.querySelector("svg.crest");
  const textsY = crestY ? crestY.querySelectorAll("text") : [];
  check("Y1: crest v3 — hero svg has exactly one <text> and it is #crestEst (outlined band type)",
    !!crestY && textsY.length === 1 && textsY[0].id === "crestEst",
    crestY ? "texts=" + textsY.length : "no svg.crest");
  domY1.window.close();

  const markCount = (html.match(/M 91 17 C 92 9, 100 3, 110 3/g) || []).length;
  check("Y2: crest v3 — MARK_PATH literal occurs exactly once in index.html (keyline is injected, not copied)",
    markCount === 1, "count=" + markCount);

  // Y3: variant dom — Info est_year 1987 must land in the live ribbon text.
  const infoVariant = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200,
      text: async () => FIXTURES.info.replace("est_year,2019", "est_year,1987") }),
  });
  const domY3 = makeDom("", infoVariant);
  await until(() => domY3.window.document.querySelector("#crestEst")?.textContent === "EST. 1987");
  const estY3 = domY3.window.document.querySelector("#crestEst")?.textContent || "";
  check("Y3: crest v3 — #crestEst renders sheet est_year (variant 1987)",
    estY3 === "EST. 1987", "got=" + estY3);
  domY3.window.close();

  // Y4: the standalone asset's fist must equal MARK_PATH in BOTH copies —
  // keyline stroke + brass fill (S8 parity — the asset is a copy by
  // necessity; this is the lockstep gate). A single .includes() would pass
  // if only one of the two copies matched, so count exact occurrences.
  let assetSvg = "";
  try { assetSvg = readFileSync(path.join(ROOT, "assets", "gfy-crest.svg"), "utf8"); } catch {}
  const markConst = (html.match(/const MARK_PATH="([^"]+)"/) || [])[1] || "";
  const markNeedle = 'd="' + markConst + '"';
  const assetMarkCount = assetSvg ? assetSvg.split(markNeedle).length - 1 : 0;
  check("Y4: crest v3 — assets/gfy-crest.svg fist d === MARK_PATH, both copies (asset parity)",
    !!assetSvg && !!markConst && assetMarkCount === 2,
    assetSvg ? "count=" + assetMarkCount : "asset file missing");
}

/* ---------------------------------------------------------------------
   Group X: v2.6 captain live scorer (spec §18 rev 2).
   X1-X6: routing + team resolution (SC-LINK, SC-YEAR).
   --------------------------------------------------------------------- */
{
  // X1: hash query must not break routing (pressure-test Critical)
  const domX1 = makeDom("#score?team=" + encodeURIComponent("Duck"));
  await until(() => !domX1.window.document.querySelector("[data-view=score]")?.hidden);
  const scoreVisX1 = !domX1.window.document.querySelector("[data-view=score]")?.hidden;
  const homeHidX1 = domX1.window.document.querySelector("[data-view=home]")?.hidden === true;
  check("X1: #score?team=… routes to the score view, not home", scoreVisX1 && homeHidX1,
    "scoreHidden=" + domX1.window.document.querySelector("[data-view=score]")?.hidden);

  // X2: matched team renders the identity confirm naming the team
  await until(() => /Duck/.test(domX1.window.document.querySelector("#scConfirm")?.textContent || ""));
  check("X2: matched team shows one-time identity confirm with team name",
    /Duck/.test(domX1.window.document.querySelector("#scConfirm")?.textContent || ""),
    (domX1.window.document.querySelector("#scConfirm")?.textContent || "").slice(0, 120));
  domX1.window.close();

  // X3: unmatched team -> picker listing team values (never an error)
  const domX3 = makeDom("#score?team=NoSuchTeam");
  await until(() => (domX3.window.document.querySelectorAll("#scPicker .sc-pick") || []).length > 0);
  const picksX3 = [...domX3.window.document.querySelectorAll("#scPicker .sc-pick")].map(b => b.textContent);
  const noErrorsX3 = domX3.pageErrors.length === 0;

  // I5 (final review): an SMS-truncated link's team= value can decode-throw
  // (a lone "%2" is an invalid percent-escape — decodeURIComponent(m[1])
  // was unguarded, so renderScorer's unguarded call to scorerTeamFromHash()
  // threw a URIError on every paint, bricking the whole view). Malformed
  // and unmatched must both fall through to the SAME picker path, and
  // neither may leave an uncaught page error behind.
  const domX3b = makeDom("#score?team=Big%2");
  await until(() => (domX3b.window.document.querySelectorAll("#scPicker .sc-pick") || []).length > 0);
  const picksX3b = [...domX3b.window.document.querySelectorAll("#scPicker .sc-pick")].map(b => b.textContent);
  const noErrorsX3b = domX3b.pageErrors.length === 0;
  domX3b.window.close();

  check("X3: unmatched team renders picker with Field team values; a malformed/decode-throwing team= (SMS-truncated '%2') ALSO renders the picker rather than bricking on an uncaught URIError; neither case leaves a page error behind",
    picksX3.some(t => /Duck/.test(t)) && picksX3.some(t => /Sully/.test(t)) && noErrorsX3 &&
      picksX3b.some(t => /Duck/.test(t)) && noErrorsX3b,
    "picks=" + JSON.stringify(picksX3).slice(0, 160) + " pageErrors=" + JSON.stringify(domX3.pageErrors) +
      " picksMalformed=" + JSON.stringify(picksX3b).slice(0, 160) + " pageErrorsMalformed=" + JSON.stringify(domX3b.pageErrors));
  domX3.window.close();

  // X4: bare #score with no stored team -> picker too
  const domX4 = makeDom("#score");
  await until(() => (domX4.window.document.querySelectorAll("#scPicker .sc-pick") || []).length > 0);
  check("X4: bare #score with no remembered team renders picker",
    (domX4.window.document.querySelectorAll("#scPicker .sc-pick") || []).length >= 2, "");
  domX4.window.close();

  // X5: SC-YEAR — scorer season must come from Info first_tee, NOT activeSeason()
  // (Scores-derived). Discriminating variant (review round 1): bump first_tee to 2027
  // and give Field a 2027-only team (Walrus, absent from 2026) — but leave Scores
  // untouched so activeSeason() still resolves 2026 on its own Scores-derived logic.
  // A scorerSeason() that mistakenly delegated to activeSeason() would look for
  // "Walrus" in the 2026 Field set, not find it, and fall through to the picker —
  // so this variant actually proves SC-YEAR, unlike the prior rogue-Scores-row one.
  const infoX5 = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", "2027-08-15T09:00:00-06:00");
  const fieldX5 = FIXTURES.field + "2027,Walrus,Walrus,2027,10,In,TRUE,\n";
  const domX5 = makeDom("#score?team=Walrus", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX5 }),
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldX5 }),
  }));
  await until(() => /Walrus/.test(domX5.window.document.querySelector("#scConfirm")?.textContent || ""));
  const pickerHiddenX5 = domX5.window.document.querySelector("#scPicker")?.hidden === true;
  check("X5: SC-YEAR — scorer matches teams from the first_tee season even when activeSeason() (Scores-derived) is a different year",
    /Walrus/.test(domX5.window.document.querySelector("#scConfirm")?.textContent || "") && pickerHiddenX5, "");
  domX5.window.close();

  // X6: nav has NO score link (link-only view)
  const domX6 = makeDom("");
  check("X6: nav carries no #score anchor",
    ![...domX6.window.document.querySelectorAll(".nav a")].some(a => a.hash === "#score"), "");
  domX6.window.close();
}

/* ---------------------------------------------------------------------
   X7-X12: card-first scorecard, par-labeled pad, momentary round chip
   (spec §18 rev 2, SC-UI/SC-PAR/SC-ROUND — task 3).
   --------------------------------------------------------------------- */
// Task 4 note: reaching the CARD (not the inert copy) now requires a
// configured score_endpoint (SC-LOUD-CONFIG's rollback gate — see X13/X14).
// X7-X12 predate that gate and only exercise card/pad/round behavior, not
// the endpoint itself, so every dom below is built via withScEndpoint()
// (info override adding score_endpoint) to keep reaching the card exactly
// as before Task 4 — no assertion in X7-X12 changed, only the fixture
// needed to arrive at the same card state.
const INFO_WITH_ENDPOINT = FIXTURES.info + "score_endpoint,https://script.example/exec\n";
function withScEndpoint(overrides = {}) {
  return withOverride(Object.assign({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => INFO_WITH_ENDPOINT }),
  }, overrides));
}

// Confirm-tap (X1-X5's flow, one step further) then wait for the 18 cells.
// `noSheet` (additive, default false — X24-26 need the REAL derivation and
// pass nothing): pre-Task-6 tests (X7-X23) were built and reviewed against
// window.scSheetHoles's Task-5 ()=>null seam stub (see task-5-report.md's
// "X7-X12 state-source edits: None" — scCellState resolved to {kind:"empty"}
// for every hole those tests touch). Task 6's REAL derivation now finds
// genuine sheet data for Duck (both fixture rounds are fully populated), so
// those tests need the seam explicitly held back at its pre-Task-6 value to
// keep exercising the SAME scenario they were written and reviewed against
// — same technique X20/X21 already established (a direct scSheetHoles
// override), just applied proactively here instead of reactively mid-test.
// Must be set AFTER the confirm button exists (the script's function
// hoisting for `function scSheetHoles(){}` happens the instant its single
// execution begins, well before this point — setting the override any
// EARLIER, before the script has run at all, gets silently clobbered by
// that hoisting the first time the script actually executes).
async function openScorer(dom, { noSheet = false } = {}) {
  const doc = dom.window.document;
  await until(() => !!doc.querySelector("#scConfirmBtn"));
  if (noSheet) dom.window.scSheetHoles = () => null;
  doc.querySelector("#scConfirmBtn").click();
  await until(() => doc.querySelectorAll("#scCard .sc-cell").length > 0);
  return doc;
}
{
  // X7 (rev 3, SC-UI-V): vertical Out|In card — #scCard > .sc-cardgrid holds
  // exactly 2 .sc-col containers (9 button.sc-cell[data-hole] each, 18
  // total); every cell carries .sc-hole-n (the hole face), .sc-hole-par
  // (matching /Par \d/ AND /yds/ — fixtures/course.csv has real par+yards
  // for all 18 holes), a .sc-score span, and a .sc-mark span (present on
  // every cell, even when its text is empty under noSheet/no-journal, so a
  // state mark always has somewhere to render). The old 9-across .sc-row
  // assert is retired with the layout it described.
  const domX7 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX7 = await openScorer(domX7, { noSheet: true });
  const colsX7 = [...docX7.querySelectorAll("#scCard .sc-cardgrid .sc-col")];
  const cellsX7 = [...docX7.querySelectorAll("#scCard .sc-cardgrid .sc-cell")];
  const perColX7 = colsX7.map(c => c.querySelectorAll(".sc-cell").length);
  const partsOkX7 = cellsX7.every(b =>
    !!b.querySelector(".sc-hole-n") &&
    /Par \d/.test(b.querySelector(".sc-hole-par")?.textContent || "") &&
    /yds/.test(b.querySelector(".sc-hole-par")?.textContent || "") &&
    !!b.querySelector(".sc-score") &&
    !!b.querySelector(".sc-mark"));
  const holeNOkX7 = cellsX7.every((b, i) => b.querySelector(".sc-hole-n")?.textContent === String(i + 1));
  const ariaOkX7 = cellsX7.every((b, i) => new RegExp("^Hole " + (i + 1) + ", par \\d").test(b.getAttribute("aria-label") || ""));
  check("X7: SC-UI-V — #scCard > .sc-cardgrid holds 2 .sc-col x 9 button.sc-cell[data-hole] (18 total, split 9/9 Out|In); every cell has .sc-hole-n/.sc-hole-par (/Par \\d/ + /yds/)/.sc-score/.sc-mark; aria-label='Hole N, par P...'",
    cellsX7.length === 18 && colsX7.length === 2 && perColX7.every(n => n === 9) && partsOkX7 && holeNOkX7 && ariaOkX7,
    "cells=" + cellsX7.length + " cols=" + JSON.stringify(perColX7) + " parts=" + partsOkX7 +
      " holeN=" + holeNOkX7 + " aria=" + ariaOkX7 + " aria0=" + (cellsX7[0]?.getAttribute("aria-label")));
  domX7.window.close();

  // X8: SC-PAR — pad labels derive from THAT hole's real par. fixtures/course.csv
  // (actual MeadowCreek data, not a stand-in): hole 7 = par 3 (160 yds), hole 8 =
  // par 4 (415 yds) — the reverse of the brief's illustrative example, so this
  // uses the fixture's real holes per the controller's resolution.
  // Review round 1 (finding 1): asserting only the Par label lets a regression
  // that hardcodes scParLabel(delta) -> "Par" unconditionally pass silently
  // (it would still pass X9 too, since X9 only checks the null-par holes have
  // NO label). Now also asserts a non-Par label on each hole, AND the SAME
  // raw score (2) reading as a DIFFERENT label across the two holes — Birdie
  // on the par-3 (delta -1), Eagle on the par-4 (delta -2) — the strongest
  // proof the label tracks each hole's own par rather than a hardcoded/global
  // score->label table.
  const domX8 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX8 = await openScorer(domX8, { noSheet: true });
  // Rev 3 (SC-PAD-SHEET, task 2): .sc-num -> .sc-key / .sc-num-lab ->
  // .sc-key-lab (the "Other" overflow row's keys share the SAME .sc-key
  // class+data-score, but never a .sc-key-lab span, so this query still
  // reads only the par-relative grid's own labels).
  const labFor = (pad, score) => [...pad.querySelectorAll(".sc-key[data-score]")]
    .find(b => b.dataset.score === score)?.querySelector(".sc-key-lab")?.textContent;
  // Rev 3 addition (same X-number, no new check() count, per the brief's own
  // "X8 adapted to .sc-key/.sc-parkey" instruction): the par key ALONE
  // carries the primary .sc-parkey class — proves the par-shift labeling
  // and the visual-primacy class are driven by the SAME delta===0 branch,
  // not two independently-maintained lists that could drift apart.
  const parKeyClassFor = (pad, score) => [...pad.querySelectorAll(".sc-key[data-score]")]
    .find(b => b.dataset.score === score)?.classList.contains("sc-parkey");
  docX8.querySelector('.sc-cell[data-hole="7"]').click();
  await until(() => (docX8.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 7"));
  const pad7 = docX8.querySelector("#scSheet");
  const lab7Par = labFor(pad7, "3");    // hole7 par3, delta 0
  const lab7Birdie = labFor(pad7, "2"); // hole7 par3, delta -1
  const parKeyOkX8 = parKeyClassFor(pad7, "3") === true;
  // Fix wave item 4: X8's own name claims the par key "alone carries" the
  // primary class — but until now the check only asserted the ONE known
  // par key HAS .sc-parkey, never that it's the ONLY .sc-key with it. A
  // regression that slapped .sc-parkey on every key in the grid would still
  // pass the pre-existing assert. Count .sc-parkey occurrences in the whole
  // pad grid instead.
  const parKeyCountX8 = pad7.querySelectorAll(".sc-key.sc-parkey").length;
  docX8.querySelector('.sc-cell[data-hole="8"]').click();
  await until(() => (docX8.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 8"));
  const pad8 = docX8.querySelector("#scSheet");
  const lab8Par = labFor(pad8, "4");    // hole8 par4, delta 0
  const lab8Birdie = labFor(pad8, "3"); // hole8 par4, delta -1
  const lab8Eagle = labFor(pad8, "2");  // hole8 par4, delta -2 — same raw score as hole7's Birdie above
  const parKeyOkX8b = parKeyClassFor(pad8, "4") === true;
  const parKeyCountX8b = pad8.querySelectorAll(".sc-key.sc-parkey").length;
  check("X8: SC-PAR — pad(7)[par3]/pad(8)[par4] both label their own par 'Par' AND their own par-1 'Birdie'; the SAME score (2) reads 'Birdie' on the par-3 but 'Eagle' on the par-4 (delta tracks each hole's real par, not a hardcoded label); the par key ALONE carries the .sc-parkey primary class on both holes — exactly ONE .sc-parkey per pad grid, not just present (rev 3)",
    lab7Par === "Par" && lab8Par === "Par" && lab7Birdie === "Birdie" && lab8Birdie === "Birdie" && lab8Eagle === "Eagle" &&
      parKeyOkX8 && parKeyOkX8b && parKeyCountX8 === 1 && parKeyCountX8b === 1,
    "h7Par:" + lab7Par + " h8Par:" + lab8Par + " h7Birdie:" + lab7Birdie + " h8Birdie:" + lab8Birdie + " h8Eagle:" + lab8Eagle +
      " parKeyOk7:" + parKeyOkX8 + " parKeyOk8:" + parKeyOkX8b +
      " parKeyCount7:" + parKeyCountX8 + " parKeyCount8:" + parKeyCountX8b);
  domX8.window.close();

  // X9/X10 variant: course fixture with hole 5's row entirely removed. courseMap()
  // (index.html) only returns a par map when all 18 holes have a row — dropping
  // one hole's row (not just blanking its par value, which would still leave the
  // key in place at 0) is what actually flips courseMap() to null, confirmed by
  // reading the function directly.
  const courseX9 = FIXTURES.course.split("\n").filter(l => !l.startsWith("5,")).join("\n");
  const overrideX9 = withScEndpoint({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseX9 }),
  });

  // X9: SC-PAR degrade — hole 5 (blanked) shows plain numbers, no golf-term
  // labels; hole 7 (untouched, real par 3) is still labeled via the per-hole
  // raw-parse fallback (scHolePar), which is exactly the point of the fallback.
  const domX9 = makeDom("#score?team=" + encodeURIComponent("Duck"), overrideX9);
  const docX9 = await openScorer(domX9, { noSheet: true });
  docX9.querySelector('.sc-cell[data-hole="5"]').click();
  await until(() => (docX9.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 5"));
  const pad5 = docX9.querySelector("#scSheet");
  const labs5 = [...pad5.querySelectorAll(".sc-key[data-score] .sc-key-lab")];
  docX9.querySelector('.sc-cell[data-hole="7"]').click();
  await until(() => (docX9.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 7"));
  const pad7b = docX9.querySelector("#scSheet");
  const lab7b = [...pad7b.querySelectorAll(".sc-key[data-score]")]
    .find(b => b.dataset.score === "3")?.querySelector(".sc-key-lab")?.textContent;
  check("X9: SC-PAR degrade — course variant blanking h5's row: pad(5) has NO golf-term labels (plain numbers); pad(7) (untouched) still labeled",
    labs5.length === 0 && lab7b === "Par",
    "labs5.length=" + labs5.length + " lab7b=" + lab7b);
  domX9.window.close();

  // X10: to-par tally reflects courseMap()'s all-or-nothing rule in BOTH
  // directions. Review round 1 (finding 2): only exercising the degraded
  // branch let a regression that hardcodes data-mode="strokes" unconditionally
  // pass 171/171 — now also asserts the happy path (complete course data ->
  // data-mode="topar") on the standard fixture, alongside the h5-blanked
  // variant degrading to strokes-only.
  // Rev 3 (task 3, header/SC-TALLY-HONEST): #scTally moved from #scCard's own
  // innerHTML into the sticky #scHeader block — selector updated to match
  // (by id, so it's found regardless of which container renders it); the
  // data-mode semantics this check actually cares about are unchanged.
  const domX10std = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX10std = await openScorer(domX10std, { noSheet: true });
  const tallyX10std = docX10std.querySelector("#scTally");
  const domX10 = makeDom("#score?team=" + encodeURIComponent("Duck"), overrideX9);
  const docX10 = await openScorer(domX10, { noSheet: true });
  const tallyX10 = docX10.querySelector("#scTally");
  check("X10: to-par tally — complete course data renders data-mode='topar' (happy path); the h5-blanked variant degrades to strokes-only (data-mode='strokes') when courseMap() is null (all-18 rule)",
    !!tallyX10std && tallyX10std.getAttribute("data-mode") === "topar" &&
    !!tallyX10 && tallyX10.getAttribute("data-mode") === "strokes",
    "standard_mode=" + tallyX10std?.getAttribute("data-mode") + " degraded_mode=" + tallyX10?.getAttribute("data-mode"));
  domX10std.window.close();
  domX10.window.close();

  // X11: SC-ROUND spring — toggling #scRound flips the chip for exactly ONE
  // submission, then auto-returns to the natively-derived default. Per the
  // controller's scoping (scRoundDefault() is date-rule-only at this task —
  // the R1-board-complete branch needs the sheet merge, which is Task 6's),
  // this asserts the SPRING behavior itself rather than hardcoding which
  // round is "the" default (that depends on wall-clock time vs first_tee).
  const domX11 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX11 = await openScorer(domX11, { noSheet: true });
  const chipX11 = () => docX11.querySelector("#scRound")?.textContent;
  const initialX11 = chipX11();
  docX11.querySelector("#scRound").click();
  const toggledX11 = chipX11();
  docX11.querySelector('.sc-cell[data-hole="1"]').click();
  await until(() => !docX11.querySelector("#scSheet")?.hidden);
  docX11.querySelector("#scSheet .sc-key[data-score]").click();
  await until(() => chipX11() === initialX11);
  check("X11: SC-ROUND spring — toggle flips the chip for one submission, then auto-returns to the derived default",
    !!initialX11 && initialX11 !== toggledX11 && chipX11() === initialX11,
    "initial=" + initialX11 + " toggled=" + toggledX11 + " after=" + chipX11());
  domX11.window.close();

  // X12 (rev 3, SC-PAD-SHEET — task 2 adaptation): re-tapping an
  // already-filled cell shows the rev-3 replace-line naming the current
  // value; a SINGLE number tap then fires the send immediately (the
  // replace-line's named current value + this one deliberate number tap
  // together ARE the explicit two-number act, I2/C3 — the separate
  // "Replace N with M" arm-and-confirm button, #scPadReplace, is retired).
  const domX12 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX12 = await openScorer(domX12, { noSheet: true });
  docX12.querySelector('.sc-cell[data-hole="2"]').click(); // hole 2, par 4
  await until(() => !docX12.querySelector("#scSheet")?.hidden);
  [...docX12.querySelectorAll("#scSheet .sc-key[data-score]")].find(b => b.dataset.score === "4").click();
  await until(() => docX12.querySelector('.sc-cell[data-hole="2"] .sc-score')?.textContent === "4");
  // Fresh tap already closed the sheet (send-on-tap, unchanged behavior) —
  // half of S14's open->close proof, before the edit-mode leg below.
  const closedAfterFreshX12 = docX12.querySelector("#scSheet")?.hidden === true;

  docX12.querySelector('.sc-cell[data-hole="2"]').click(); // re-tap the filled cell -> edit mode
  await until(() => /currently 4/i.test(docX12.querySelector("#scSheet .sc-replace-line")?.textContent || ""));
  const replaceLineOkX12 = /currently 4/i.test(docX12.querySelector("#scSheet .sc-replace-line")?.textContent || "") &&
    docX12.querySelector("#scSheet .sc-replace-line b")?.textContent === "4";
  const noReplaceBtnX12 = !docX12.querySelector("#scPadReplace"); // retired — no arm-and-confirm element exists

  // Spy on window.scJournalSave (the real Task-5 implementation, a plain
  // top-level function reached via `window.` explicitly in scSubmitScore —
  // the same seam X20/X11 already override for scSheetHoles) to prove the
  // replace tap fires it EXACTLY once, directly, rather than inferring
  // "no second confirm" only from the DOM.
  let saveCallsX12 = 0;
  const realSaveX12 = domX12.window.scJournalSave;
  domX12.window.scJournalSave = function (...args) { saveCallsX12++; return realSaveX12.apply(this, args); };
  [...docX12.querySelectorAll("#scSheet .sc-key[data-score]")].find(b => b.dataset.score === "6").click(); // the ONE tap that replaces
  await until(() => docX12.querySelector('.sc-cell[data-hole="2"] .sc-score')?.textContent === "6");
  const oneSaveOnReplaceX12 = saveCallsX12 === 1;
  const closedAfterReplaceX12 = docX12.querySelector("#scSheet")?.hidden === true; // send-on-tap closes the sheet, same as a fresh tap

  // S14: full open -> close -> reopen cycle, both named exits (veil tap AND
  // the sheet-head's Close button), on the now-filled hole 2 cell.
  docX12.querySelector('.sc-cell[data-hole="2"]').click();
  await until(() => !docX12.querySelector("#scSheet")?.hidden);
  const openViaCellX12 = !docX12.querySelector("#scSheet")?.hidden;
  // Fix round 1 (review Important #1, structural assert): #scSheet/#scVeil
  // must NOT be nested inside .wrap — .wrap establishes its own stacking
  // context (position:relative+z-index:1), which traps position:fixed
  // descendants below OTHER top-level z-index layers (.nav z:20,
  // #healthStrip z:999) regardless of these elements' own (now-raised)
  // z-index. closest(".wrap") returning null proves the escape structurally
  // (via #scSheetHost), not just "it happens to render on top" by accident.
  const sheetEscapesWrapX12 = !docX12.querySelector("#scSheet")?.closest(".wrap") &&
    !docX12.querySelector("#scVeil")?.closest(".wrap");
  docX12.querySelector("#scVeil").click(); // exit #1: veil tap
  await until(() => docX12.querySelector("#scSheet")?.hidden === true);
  const closedViaVeilX12 = docX12.querySelector("#scSheet")?.hidden === true;
  docX12.querySelector('.sc-cell[data-hole="2"]').click(); // reopen
  await until(() => !docX12.querySelector("#scSheet")?.hidden);
  const reopenedX12 = !docX12.querySelector("#scSheet")?.hidden;
  docX12.querySelector("#scSheetClose").click(); // exit #2: the sheet-head's Close button
  await until(() => docX12.querySelector("#scSheet")?.hidden === true);
  const closedViaCloseBtnX12 = docX12.querySelector("#scSheet")?.hidden === true;

  // Review round 1 (finding 3), rev-3 mechanism (task-2 pinned resolution):
  // the periodic refresh drives renderScorer() -> scShowCard() -> an
  // UNCONDITIONAL renderScCard() rebuild (same path a 60s auto-refresh
  // takes). STATE.scPadOtherVal's free-text-input echo is RETIRED (the
  // overflow rows now cover the full range as buttons); the SAME
  // refresh-survival protection is now proven via STATE.scPadOtherOpen
  // (already existed, unchanged mechanism) — open the numrow, force the
  // SAME rebuild a refresh takes, and assert it's still open afterward on a
  // genuinely NEW DOM node (not a leftover — node-identity inequality,
  // same proof style the old input-node check used).
  docX12.querySelector('.sc-cell[data-hole="9"]').click();
  await until(() => (docX12.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 9"));
  // Fix round 1 (review Important #2 — Riley RULED in-chat: the 1-19 hard
  // rule governs the pinned formula): exhaustive reachability audit, not a
  // two-value boundary spot-check — every value 1-19 must have EXACTLY ONE
  // tappable .sc-key[data-score] across the main grid + overflow row
  // combined. The overflow row's buttons are unconditionally in the DOM
  // regardless of the numrow's `.on` toggle (only its CSS display class is
  // gated by STATE.scPadOtherOpen — scPadKeysHTML always renders the
  // buttons), so this counts correctly whether or not "Other" has been
  // tapped open. Run across all 3 representative pars the fixture actually
  // has (hole 9 par 5, hole 7 par 3, hole 8 par 4 — fixtures/course.csv) —
  // proves the down-range guard (par-2>1) AND the uncapped up-range both
  // hold across the low/mid/high-par spectrum, not just at two extremes.
  const scKeyAuditX12 = sheetEl => {
    const counts = {};
    [...sheetEl.querySelectorAll(".sc-key[data-score]")].forEach(b => {
      counts[b.dataset.score] = (counts[b.dataset.score] || 0) + 1;
    });
    const bad = [];
    for (let v = 1; v <= 19; v++) { const c = counts[String(v)] || 0; if (c !== 1) bad.push(v + ":" + c); }
    return { ok: bad.length === 0, bad };
  };
  const audit9X12 = scKeyAuditX12(docX12.querySelector("#scSheet")); // par 5 (fixtures h9=5): main grid bottoms at 3, overflow must add 1-2 low + 10-19 high

  docX12.querySelector("#scPadOtherBtn").click();
  await until(() => docX12.querySelector(".sc-numrow")?.classList.contains("on"));
  const numrowBeforeX12 = docX12.querySelector(".sc-numrow");

  domX12.window.renderScCard(); // simulate the periodic-refresh's unconditional rebuild

  const numrowAfterX12 = docX12.querySelector(".sc-numrow");
  const numrowRebuiltX12 = !!numrowAfterX12 && numrowAfterX12 !== numrowBeforeX12;
  const numrowSurvivedX12 = numrowAfterX12?.classList.contains("on") === true &&
    numrowAfterX12.querySelectorAll(".sc-key[data-score]").length > 0;

  docX12.querySelector('.sc-cell[data-hole="7"]').click(); // hole 7, par 3 — second scPadOpen
  await until(() => (docX12.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 7"));
  const audit7X12 = scKeyAuditX12(docX12.querySelector("#scSheet")); // par 3 (h7=3): main grid already reaches 1 via par-2 — overflow must NOT duplicate it

  docX12.querySelector('.sc-cell[data-hole="8"]').click(); // hole 8, par 4 — third scPadOpen
  await until(() => (docX12.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 8"));
  const audit8X12 = scKeyAuditX12(docX12.querySelector("#scSheet")); // par 4 (h8=4): main grid bottoms at 2, overflow adds 1 low + 9-19 high

  // Fix round 2 (review Important — regression introduced by fix round 1's
  // OWN #scSheetHost escape): #scSheetHost is now a body-level sibling of
  // <footer>, OUTSIDE <section id="score" class="view">, so the
  // .view[hidden] cascade that used to hide a stray-open sheet "for free"
  // whenever #score itself hid no longer reaches it — showView() (a
  // separate hash-router script) only ever toggles `.hidden` on `.view`
  // elements, never #scSheetHost. Open the sheet on hole 3 (untouched
  // elsewhere in this dom), navigate away via hashchange to #board (same
  // pattern X24/X25 use) — this specifically bypasses the veil's own
  // click-to-close, since no click ever happens (back button/typed
  // URL/nav tap are indistinguishable from this dom's perspective) —
  // assert the sheet+veil are gone (not just visually hidden: #scSheetHost
  // genuinely cleared, matching the SAME reset renderScCard's own
  // `!STATE.scTeam` branch already performs). Then navigate BACK to
  // #score and assert the sheet stays closed (S14-style full cycle — "it
  // got cleared once" isn't proof it doesn't come back unbidden on the
  // very next repaint).
  docX12.querySelector('.sc-cell[data-hole="3"]').click(); // hole 3, par 3 — untouched elsewhere in this dom
  await until(() => !docX12.querySelector("#scSheet")?.hidden);
  const openBeforeNavX12 = !docX12.querySelector("#scSheet")?.hidden;
  domX12.window.location.hash = "#board";
  domX12.window.dispatchEvent(new domX12.window.Event("hashchange"));
  const sheetGoneAfterNavX12 = !docX12.querySelector("#scSheet");
  const veilGoneAfterNavX12 = !docX12.querySelector("#scVeil");
  const sheetHostClearedX12 = (docX12.querySelector("#scSheetHost")?.innerHTML || "") === "";
  domX12.window.location.hash = "#score?team=" + encodeURIComponent("Duck");
  domX12.window.dispatchEvent(new domX12.window.Event("hashchange"));
  await until(() => docX12.querySelectorAll("#scCard .sc-cell").length > 0);
  const noResurrectX12 = docX12.querySelector("#scSheet")?.hidden === true;

  domX12.window.close();

  // Review round 2 (finding #3, CONFIRMED GAP): I2's auto-override-through-
  // replace-confirm path (scSubmitScore's overrideSheet check, Task 5 fix
  // round 1) had ZERO committed coverage — a mutation forcing
  // overrideSheet to false slipped through 182/182 undetected (reviewer-
  // proven). Folded in here, same edit-mode/replace theme as the rest of
  // X12: stub the sheet to a DIFFERING value for hole 7 (par 3, sheet
  // already says 3), tap the cell — this opens in edit mode against the
  // SHEET's value (not a plain fresh pad, since scCellState's "sheet" kind
  // behaves like an existing score for pad purposes) — pick a new number
  // via the SAME single tap used everywhere else in this suite (rev 3: no
  // second confirm, no force-send tap anywhere — there IS no confirm
  // element to tap), and assert the POST actually reaches the network while
  // the hole was genuinely sheet-differing the whole time.
  const epUrlX12b = "https://script.example/exec";
  const bodiesX12b = [];
  const fetchX12b = (url, opts) => {
    if (String(url).indexOf(epUrlX12b) === 0) {
      bodiesX12b.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 1, holes: {} }) });
    }
    return withScEndpoint()(url);
  };
  const domX12b = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX12b);
  const docX12b = await openScorer(domX12b, { noSheet: true });
  domX12b.window.scSheetHoles = () => ({ 7: 3 }); // hole 7, par 3 — sheet already shows 3
  docX12b.querySelector('.sc-cell[data-hole="7"]').click();
  await until(() => /currently 3/i.test(docX12b.querySelector("#scSheet .sc-replace-line")?.textContent || ""));
  const editModeFromSheetX12b = /currently 3/i.test(docX12b.querySelector("#scSheet .sc-replace-line")?.textContent || "");
  docX12b.querySelector('#scSheet .sc-key[data-score="5"]').click(); // par 3, delta +2 ("+2" label) — a valid preset; the ONE tap — I2: carries override through
  await until(() => bodiesX12b.some(b => b.hole === 7));
  await settle(150);
  const overrideSentX12b = bodiesX12b.length === 1 && bodiesX12b[0].hole === 7 && bodiesX12b[0].score === 5;
  domX12b.window.close();

  check("X12: edit mode — re-tapping a filled cell shows the rev-3 replace-line naming the current value; a SINGLE number tap fires exactly one scJournalSave with the new value and closes the sheet (no second confirm element anywhere, #scPadReplace retired); the sheet/veil structurally escape .wrap's stacking context (fix round 1, review Important #1 — closest('.wrap') is null, not just 'renders on top by accident'); the full open->close->reopen cycle works via BOTH the veil tap and the sheet-head's Close button (S14); the 'Other' overflow row survives a forced renderScCard() rebuild (periodic-refresh regression, rev-3 mechanism via STATE.scPadOtherOpen); every value 1-19 has EXACTLY ONE tappable key across main grid + overflow row on 3 representative real-fixture pars (fix round 1, review Important #2, RULED — hole 7=par3, hole 8=par4, hole 9=par5); navigating away from #score via hashchange while the sheet is open clears it (not just visually hidden — #scSheetHost genuinely emptied) instead of lingering over the next view, and it does NOT resurrect on navigating back (fix round 2, review Important — regression from fix round 1's OWN #scSheetHost escape); replace-confirming an ALREADY-KNOWN differing sheet value (I2) sends via that SAME single number tap, no second tap anywhere",
    closedAfterFreshX12 && replaceLineOkX12 && noReplaceBtnX12 && oneSaveOnReplaceX12 && closedAfterReplaceX12 &&
      openViaCellX12 && sheetEscapesWrapX12 && closedViaVeilX12 && reopenedX12 && closedViaCloseBtnX12 &&
      numrowRebuiltX12 && numrowSurvivedX12 &&
      audit9X12.ok && audit7X12.ok && audit8X12.ok &&
      openBeforeNavX12 && sheetGoneAfterNavX12 && veilGoneAfterNavX12 && sheetHostClearedX12 && noResurrectX12 &&
      editModeFromSheetX12b && overrideSentX12b,
    "closedAfterFresh=" + closedAfterFreshX12 + " replaceLineOk=" + replaceLineOkX12 + " noReplaceBtn=" + noReplaceBtnX12 +
      " oneSaveOnReplace=" + oneSaveOnReplaceX12 + " (calls=" + saveCallsX12 + ") closedAfterReplace=" + closedAfterReplaceX12 +
      " openViaCell=" + openViaCellX12 + " sheetEscapesWrap=" + sheetEscapesWrapX12 + " closedViaVeil=" + closedViaVeilX12 + " reopened=" + reopenedX12 +
      " closedViaCloseBtn=" + closedViaCloseBtnX12 +
      " numrowRebuilt=" + numrowRebuiltX12 + " numrowSurvived=" + numrowSurvivedX12 +
      " audit9(par5).bad=" + JSON.stringify(audit9X12.bad) + " audit7(par3).bad=" + JSON.stringify(audit7X12.bad) + " audit8(par4).bad=" + JSON.stringify(audit8X12.bad) +
      " openBeforeNav=" + openBeforeNavX12 + " sheetGoneAfterNav=" + sheetGoneAfterNavX12 + " veilGoneAfterNav=" + veilGoneAfterNavX12 +
      " sheetHostCleared=" + sheetHostClearedX12 + " noResurrect=" + noResurrectX12 +
      " editModeFromSheet=" + editModeFromSheetX12b + " overrideSent=" + overrideSentX12b +
      " bodiesX12b=" + JSON.stringify(bodiesX12b));
}

/* ---------------------------------------------------------------------
   X13-X15: transport module + loud misconfig + debug ping
   (spec §18 rev 2, SC-WRITE client / SC-LOUD-CONFIG — task 4).

   Controller narrowing (both X14 and X15, recorded in task-4-report.md):
   Task 3's tap wiring still calls the Task-5 stub `scJournalSave` (a
   no-op) — Task 5 owns wiring `scSend` into real taps and rendering a
   rejected send into a cell/banner. So X14/X15 exercise `scSend`/`scPing`
   directly via a temporary test-only bridge (they're plain top-level
   function declarations in a classic, non-module script — already
   `window.scSend` etc. with no extra wiring needed, same as `renderScCard`
   in X12 above) rather than through a pad tap. X14's "cell shows the sent
   value" half of the plan's original text is Task 5's X17, which
   supersedes it.
   --------------------------------------------------------------------- */
{
  // X13: absent score_endpoint -> scorer inert state (SC-LOUD-CONFIG's
  // rollback clause). A matched+CONFIRMED team (confirm-tap, same flow as
  // X1-X12) never gets a dead scoring surface: #scCard hides and empties,
  // "scoring opens at the tournament" copy shows in its place, no error.
  // Default fixtures also lack the raw-form-link Info key (this task's own
  // naming choice, `form_url` — see task-4-report.md) -> no dead link.
  // A second dom variant (info override adding `form_url`) proves the link
  // branch is real, not just "never render a link" — both assertions live
  // in this one check per the controller's "no new X-numbers" constraint.
  const domX13 = makeDom("#score?team=" + encodeURIComponent("Duck"));
  const docX13 = domX13.window.document;
  await until(() => !!docX13.querySelector("#scConfirmBtn"));
  docX13.querySelector("#scConfirmBtn").click();
  await until(() => /scoring opens at the tournament/i.test(docX13.querySelector("#scHeader")?.textContent || ""));
  const cardHiddenX13 = docX13.querySelector("#scCard")?.hidden === true;
  const cardEmptyX13 = (docX13.querySelector("#scCard")?.innerHTML || "").trim() === "";
  const copyOkX13 = /scoring opens at the tournament/i.test(docX13.querySelector("#scHeader")?.textContent || "");
  const noLinkX13 = !docX13.querySelector("#scHeader a");
  const noErrorsX13 = domX13.pageErrors.length === 0;
  domX13.window.close();

  const infoLinkX13 = FIXTURES.info + "form_url,https://forms.gle/exampleFormXYZ\n";
  const domX13b = makeDom("#score?team=" + encodeURIComponent("Duck"), withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoLinkX13 }),
  }));
  const docX13b = domX13b.window.document;
  await until(() => !!docX13b.querySelector("#scConfirmBtn"));
  docX13b.querySelector("#scConfirmBtn").click();
  await until(() => !!docX13b.querySelector("#scHeader a"));
  const linkX13b = docX13b.querySelector("#scHeader a");
  const linkOkX13b = linkX13b?.getAttribute("href") === "https://forms.gle/exampleFormXYZ";
  domX13b.window.close();

  check("X13: absent score_endpoint -> inert state (#scCard hidden+empty, 'scoring opens at the tournament' copy, no error); default fixtures also lack the form-url Info key -> no raw form link; a variant WITH that key renders the link (proves the branch is real)",
    cardHiddenX13 && cardEmptyX13 && copyOkX13 && noLinkX13 && noErrorsX13 && linkOkX13b,
    "cardHidden=" + cardHiddenX13 + " cardEmpty=" + cardEmptyX13 + " copyOk=" + copyOkX13 +
      " noLink=" + noLinkX13 + " noErrors=" + noErrorsX13 + " linkHref=" + linkX13b?.getAttribute("href"));
}

{
  // X14 (narrowed — see block comment above and task-4-report.md).
  // FIXTURE REALITY (controller ruling): this variant (a) adds
  // score_endpoint to the info fixture, AND (b) drops the lowercase
  // "duck,2" scores row — future-proofing so Task 6's sheet-merge later
  // doesn't turn this same variant's h13 into a conflict state (uppercase
  // "Duck" round 1 + lowercase "duck" round 2 both normalize to the same
  // nkey team, "Duck").
  const infoX14 = FIXTURES.info + "score_endpoint,https://script.example/exec\n";
  const scoresX14 = FIXTURES.scores.split("\n").filter(l => !l.startsWith("2026,duck,2,")).join("\n");
  const epUrlX14 = "https://script.example/exec";
  // Review round 1 finding: the original stub branched only on URL prefix and
  // returned canned JSON regardless of the POST body/options — a scSend
  // regression that mangled the payload (wrong field name/casing, dropped
  // client_id/seq, wrong types) would still pass 100%. Now captures the real
  // request options so the check below can inspect them.
  let capturedX14;
  const fetchX14 = (url, opts) => {
    if (String(url).indexOf(epUrlX14) === 0) {
      capturedX14 = opts;
      return Promise.resolve({
        ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 2, holes: { h13: 6 } }),
      });
    }
    return withOverride({
      info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX14 }),
      scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresX14 }),
    })(url);
  };
  const domX14 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX14);
  const docX14 = await openScorer(domX14, { noSheet: true }); // endpoint configured -> live card (NOT inert) — positive branch of X13
  const cardVisibleX14 = docX14.querySelectorAll("#scCard .sc-cell").length === 18
    && docX14.querySelector("#scCard")?.hidden !== true;
  let sendResultX14, sendErrX14;
  try {
    sendResultX14 = await domX14.window.scSend({ team: "Duck", round: 2, hole: 13, score: 6 }, "client-x14", 1);
  } catch (e) { sendErrX14 = e; }

  // Wire-format assertions (review round 1): the exact key set, values,
  // method, and content-type of the REAL request scSend sent — not just the
  // canned response it got back.
  let bodyX14 = null, bodyParseErrX14;
  try { bodyX14 = JSON.parse(capturedX14?.body); } catch (e) { bodyParseErrX14 = e; }
  const bodyKeysX14 = bodyX14 ? Object.keys(bodyX14).sort() : [];
  const expectedKeysX14 = ["client_id", "hole", "round", "score", "seq", "team"];
  const keysOkX14 = JSON.stringify(bodyKeysX14) === JSON.stringify(expectedKeysX14);
  const valuesOkX14 = !!bodyX14 && bodyX14.team === "Duck" && bodyX14.round === 2 && bodyX14.hole === 13 &&
    bodyX14.score === 6 && typeof bodyX14.client_id === "string" && bodyX14.client_id.length > 0 && bodyX14.seq === 1;
  const methodOkX14 = capturedX14?.method === "POST";
  const contentTypeX14 = capturedX14?.headers?.["Content-Type"];
  const ctOkX14 = contentTypeX14 === "text/plain;charset=utf-8";

  check("X14: scSend resolves the endpoint's JSON verdict (stubbed) AND posts the exact wire format — key set {team,round,hole,score,client_id,seq} (no extras/missing), real values, POST, text/plain;charset=utf-8",
    cardVisibleX14 && !sendErrX14 && !!sendResultX14 &&
      sendResultX14.ok === true && sendResultX14.verdict === "applied" && sendResultX14.holes?.h13 === 6 &&
      keysOkX14 && valuesOkX14 && methodOkX14 && ctOkX14,
    "cardVisible=" + cardVisibleX14 + " result=" + JSON.stringify(sendResultX14) + " err=" + JSON.stringify(sendErrX14) +
      " bodyKeys=" + JSON.stringify(bodyKeysX14) + " body=" + JSON.stringify(bodyX14) +
      " bodyParseErr=" + (bodyParseErrX14 ? bodyParseErrX14.message : "") +
      " method=" + capturedX14?.method + " contentType=" + contentTypeX14);
  domX14.window.close();
}

{
  // X15: SC-LOUD-CONFIG. The endpoint returns an HTML sign-in page instead
  // of JSON — scSend must REJECT with {kind:"config"}, never resolve, never
  // guess at a verdict (transport contract, fully Task 4's to prove; the
  // narrowing above explains why this isn't exercised through a real tap).
  // The "view" this task actually wires for a broken endpoint is the
  // ?debug=1 ping row (scPingRow_/loadDebug) — combining a hash team with
  // ?debug=1 in one dom lets this check assert BOTH in one go: the card
  // still renders (endpoint's URL is well-formed, so inert-vs-card doesn't
  // change just because it's unreachable) AND the debug panel carries the
  // spec's literal "scoring endpoint not reachable" wording, with no cell
  // showing the value that would have been sent.
  const infoX15 = FIXTURES.info + "score_endpoint,https://script.example/exec\n";
  const epUrlX15 = "https://script.example/exec";
  const fetchX15 = (url) => {
    if (String(url).indexOf(epUrlX15) === 0) {
      return Promise.resolve({ ok: true, status: 200, text: async () => "<html>Sign in</html>" });
    }
    return withOverride({
      info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX15 }),
    })(url);
  };
  const domX15 = makeDom("?debug=1#score?team=" + encodeURIComponent("Duck"), fetchX15);
  const docX15 = await openScorer(domX15, { noSheet: true });
  await until(() => /scoring endpoint not reachable/i.test(docX15.getElementById("debugPanel")?.textContent || ""));
  const dbgTextX15 = docX15.getElementById("debugPanel")?.textContent || "";
  const cardVisibleX15 = docX15.querySelectorAll("#scCard .sc-cell").length === 18
    && docX15.querySelector("#scCard")?.hidden !== true;
  const noSentCellX15 = [...docX15.querySelectorAll("#scCard .sc-cell .sc-score")].every(b => b.textContent === "–");

  let sendErrX15;
  try {
    await domX15.window.scSend({ team: "Duck", round: 2, hole: 13, score: 6 }, "client-x15", 1);
  } catch (e) { sendErrX15 = e; }
  domX15.window.close();

  check("X15: SC-LOUD-CONFIG — HTML (non-JSON) response rejects scSend with {kind:'config'}, never resolves, never guesses; the ?debug=1 panel shows the spec's literal 'scoring endpoint not reachable' wording; card still renders (URL well-formed) with no cell showing a sent value",
    !!sendErrX15 && sendErrX15.kind === "config" && typeof sendErrX15.detail === "string" &&
      /scoring endpoint not reachable/i.test(dbgTextX15) && cardVisibleX15 && noSentCellX15,
    "err=" + JSON.stringify(sendErrX15) + " cardVisible=" + cardVisibleX15 + " noSentCell=" + noSentCellX15 +
      " dbg=" + dbgTextX15.slice(0, 200));
}

/* ---------------------------------------------------------------------
   X16-X23: journal, queue, and truth states (spec §18 rev 2,
   SC-HONEST/SC-NOCLOBBER/SC-QUEUE — task 5). Taps now save for real
   (window.scJournalSave is Task 5's real implementation, no longer Task
   3's no-op stub) and drain through scSend for real. Every dom below uses
   withScEndpoint() (score_endpoint present) to reach the live card, same
   pattern X7-X12/X14 established.
   --------------------------------------------------------------------- */
const epUrl = "https://script.example/exec";

{
  // X16: offline-first — the endpoint fetch always rejects (network down).
  // Tapping a fresh hole's number must update the cell to a "queued" state
  // INSTANTLY — synchronously, before any network attempt resolves — with
  // no error UI anywhere on the page. (scJournalSave defers its own drain
  // kickoff via setTimeout precisely so this synchronous assertion, run
  // with no await in between, observes "queued" and not a transient
  // "sending".)
  const fetchX16 = (url) => {
    if (String(url).indexOf(epUrl) === 0) return Promise.reject(new TypeError("offline (simulated)"));
    return withScEndpoint()(url);
  };
  const domX16 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX16);
  const docX16 = await openScorer(domX16, { noSheet: true });
  docX16.querySelector('.sc-cell[data-hole="3"]').click();        // hole 3, par 3
  await until(() => !docX16.querySelector("#scSheet")?.hidden);
  docX16.querySelector('#scSheet .sc-key[data-score="3"]').click(); // fresh cell, send-on-tap
  const cellX16 = docX16.querySelector('.sc-cell[data-hole="3"]');
  const queuedNowX16 = !!cellX16 && cellX16.classList.contains("sc-queued") && cellX16.querySelector(".sc-score")?.textContent === "3";
  // C4 (review round 1): the queued state was color-only (the sc-queued
  // CSS class alone) — a regression that dropped the CSS class but kept
  // the cell otherwise looking identical would be invisible to a
  // class-only assertion. Requiring the ⇡ mark's actual TEXT (not just a
  // class name) closes that gap and matches the never-color-only rule.
  // Rev 3 (SC-UI-V/SC-SKIN): the mark lives in .sc-mark now (renamed from
  // the bare state glyph), but the glyph itself is UNCHANGED for queued/
  // sending (⇡ — only the conflict glyph moves, ? -> ▲, asserted in X20).
  const glyphShownX16 = /⇡/.test(cellX16?.querySelector(".sc-mark")?.textContent || "");
  const noErrorUIX16 = !docX16.querySelector(".sc-degrade") && !docX16.querySelector(".sc-loud-config");
  domX16.window.close();

  // Rev 3 addition (same X-number, no new check() count): an on-sheet cell
  // via the REAL SC-DERIVE merge (no noSheet stub) carries the rev-3 ▮ mark
  // and the renamed .sc-onsheet class (was .sc-sheet pre-rev-3). Duck's
  // round-1 sheet fixture is fully populated (18/18 holes), so
  // scRoundDefault()'s team-state-first rule always lands on round 2 here
  // regardless of wall-clock date — hole 1 is on the sheet at 4 either way
  // (r1 h1=4, r2 h1=4 — fixtures/scores.csv), so no round-pinning trick is
  // needed for this assertion to be deterministic.
  const domX16b = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX16b = await openScorer(domX16b);
  const cellX16b = docX16b.querySelector('.sc-cell[data-hole="1"]');
  const onSheetClassX16b = !!cellX16b && cellX16b.classList.contains("sc-onsheet");
  const onSheetMarkX16b = (cellX16b?.querySelector(".sc-mark")?.textContent || "") === "▮";
  domX16b.window.close();

  check("X16: offline-first — stub fetch rejects (network): tap score -> cell shows queued state INSTANTLY (class AND the ⇡ mark — never color-only), no error UI; PLUS (rev 3) an on-sheet cell via the real derivation carries the ▮ mark + .sc-onsheet class",
    queuedNowX16 && glyphShownX16 && noErrorUIX16 && domX16.pageErrors.length === 0 &&
      onSheetClassX16b && onSheetMarkX16b,
    "queuedNow=" + queuedNowX16 + " glyphShown=" + glyphShownX16 + " noErrorUI=" + noErrorUIX16 +
      " cellClass=" + cellX16?.className + " cellText=" + cellX16?.textContent + " pageErrors=" + domX16.pageErrors.length +
      " onSheetClass=" + onSheetClassX16b + " onSheetMark=" + onSheetMarkX16b);
}

// Shared shape for X17's three independent trigger scenarios (online,
// pageshow, visibilitychange): fetch stays "offline" (rejects) until the
// test flips a flag, then captures the real body on the branch that
// actually resolves — a genuine network failure never reaches "the
// server" to record a body, so the earlier failed attempt never inflates
// the count.
function makeGatedEndpointFetch() {
  const state = { online: false, bodies: [] };
  state.fetch = (url, opts) => {
    if (String(url).indexOf(epUrl) === 0) {
      if (!state.online) return Promise.reject(new TypeError("offline (simulated)"));
      state.bodies.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 2, holes: {} }) });
    }
    return withScEndpoint()(url);
  };
  return state;
}
async function cellSettledOk(doc, hole) {
  return until(() => {
    const c = doc.querySelector('.sc-cell[data-hole="' + hole + '"]');
    return !!c && !c.classList.contains("sc-queued") && !c.classList.contains("sc-sending") &&
      !c.classList.contains("sc-rejected") && c.querySelector(".sc-score")?.textContent != null;
  });
}

{
  // X17: drain on reconnect. Review round 1 (I3): the brief pins 3 drain
  // triggers beyond "after each save" — online, pageshow, visibilitychange
  // — but only "online" had committed coverage. Extended (same check, no
  // new X-number) to independently exercise pageshow and visibilitychange
  // too, each draining its OWN queued entry; plus a structural assertion
  // on the 20s timer's lifecycle (scIsDrainTimerActive() — a real,
  // introspectable function, since scDrainTimer itself is a `let` and
  // never becomes a window property).

  // (a) online — the original scenario.
  const online17 = makeGatedEndpointFetch();
  const domOnline17 = makeDom("#score?team=" + encodeURIComponent("Duck"), online17.fetch);
  const docOnline17 = await openScorer(domOnline17, { noSheet: true });
  docOnline17.querySelector('.sc-cell[data-hole="4"]').click();        // hole 4, par 5
  await until(() => !docOnline17.querySelector("#scSheet")?.hidden);
  docOnline17.querySelector('#scSheet .sc-key[data-score="5"]').click();
  await until(() => docOnline17.querySelector('.sc-cell[data-hole="4"]')?.classList.contains("sc-queued"));
  online17.online = true;
  domOnline17.window.dispatchEvent(new domOnline17.window.Event("online"));
  await cellSettledOk(docOnline17, 4);
  const onlineOk17 = online17.bodies.length === 1 && online17.bodies[0].hole === 4 && online17.bodies[0].score === 5;

  // (b) 20s timer wiring, using this same (still-open) dom: active while
  // #score is showing, stopped the moment it hides.
  const timerActiveWhileVisible17 = domOnline17.window.scIsDrainTimerActive();
  domOnline17.window.location.hash = "#home";
  domOnline17.window.dispatchEvent(new domOnline17.window.Event("hashchange"));
  const timerStoppedAfterHide17 = !domOnline17.window.scIsDrainTimerActive();
  domOnline17.window.close();

  // (c) pageshow.
  const pageshow17 = makeGatedEndpointFetch();
  const domPageshow17 = makeDom("#score?team=" + encodeURIComponent("Duck"), pageshow17.fetch);
  const docPageshow17 = await openScorer(domPageshow17, { noSheet: true });
  docPageshow17.querySelector('.sc-cell[data-hole="10"]').click();      // hole 10, par 4
  await until(() => !docPageshow17.querySelector("#scSheet")?.hidden);
  docPageshow17.querySelector('#scSheet .sc-key[data-score="4"]').click();
  await until(() => docPageshow17.querySelector('.sc-cell[data-hole="10"]')?.classList.contains("sc-queued"));
  pageshow17.online = true;
  domPageshow17.window.dispatchEvent(new domPageshow17.window.Event("pageshow"));
  await cellSettledOk(docPageshow17, 10);
  const pageshowOk17 = pageshow17.bodies.length === 1 && pageshow17.bodies[0].hole === 10 && pageshow17.bodies[0].score === 4;
  domPageshow17.window.close();

  // (d) visibilitychange (becoming visible).
  const vis17 = makeGatedEndpointFetch();
  const domVis17 = makeDom("#score?team=" + encodeURIComponent("Duck"), vis17.fetch);
  const docVis17 = await openScorer(domVis17, { noSheet: true });
  docVis17.querySelector('.sc-cell[data-hole="11"]').click();          // hole 11, par 5
  await until(() => !docVis17.querySelector("#scSheet")?.hidden);
  docVis17.querySelector('#scSheet .sc-key[data-score="5"]').click();
  await until(() => docVis17.querySelector('.sc-cell[data-hole="11"]')?.classList.contains("sc-queued"));
  vis17.online = true;
  domVis17.window.document.dispatchEvent(new domVis17.window.Event("visibilitychange"));
  await cellSettledOk(docVis17, 11);
  const visOk17 = vis17.bodies.length === 1 && vis17.bodies[0].hole === 11 && vis17.bodies[0].score === 5;
  domVis17.window.close();

  check("X17: drain on reconnect — the 3 named triggers (online, pageshow, visibilitychange) each independently drain a queued entry, exactly ONE POST body seen each time; the 20s timer is active while the #score view is visible and stops the moment it hides",
    onlineOk17 && timerActiveWhileVisible17 && timerStoppedAfterHide17 && pageshowOk17 && visOk17,
    "onlineOk=" + onlineOk17 + " online.bodies=" + JSON.stringify(online17.bodies) +
      " timerActiveWhileVisible=" + timerActiveWhileVisible17 + " timerStoppedAfterHide=" + timerStoppedAfterHide17 +
      " pageshowOk=" + pageshowOk17 + " pageshow.bodies=" + JSON.stringify(pageshow17.bodies) +
      " visOk=" + visOk17 + " vis.bodies=" + JSON.stringify(vis17.bodies));
}

{
  // X18: coalescing — while offline, tap 4 then 6 on the same hole (the
  // second tap goes through the edit-mode replace-line flow, same as X12 —
  // the ONLY way to change an already-filled cell; rev 3: that second tap
  // fires the replace directly, no separate confirm element). The journal
  // must hold ONE entry per hole: the earlier value is fully replaced, not
  // queued alongside it, so once reconnected at most one body is ever
  // captured for that hole, and its score is the FINAL value (6).
  let onlineX18 = false;
  const bodiesX18 = [];
  const fetchX18 = (url, opts) => {
    if (String(url).indexOf(epUrl) === 0) {
      if (!onlineX18) return Promise.reject(new TypeError("offline (simulated)"));
      bodiesX18.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 2, holes: {} }) });
    }
    return withScEndpoint()(url);
  };
  const domX18 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX18);
  const docX18 = await openScorer(domX18, { noSheet: true });
  docX18.querySelector('.sc-cell[data-hole="6"]').click();        // hole 6, par 4
  await until(() => !docX18.querySelector("#scSheet")?.hidden);
  docX18.querySelector('#scSheet .sc-key[data-score="4"]').click(); // tap #1: fresh, send-on-tap -> queued 4
  await until(() => docX18.querySelector('.sc-cell[data-hole="6"] .sc-score')?.textContent === "4");
  docX18.querySelector('.sc-cell[data-hole="6"]').click();        // re-tap the filled cell -> edit mode
  await until(() => /currently 4/i.test(docX18.querySelector("#scSheet .sc-replace-line")?.textContent || ""));
  docX18.querySelector('#scSheet .sc-key[data-score="6"]').click(); // tap #2: fires the replace directly -> coalesces to score 6, new seq
  await until(() => docX18.querySelector('.sc-cell[data-hole="6"] .sc-score')?.textContent === "6");
  onlineX18 = true;
  domX18.window.dispatchEvent(new domX18.window.Event("online"));
  await until(() => bodiesX18.length > 0);
  await settle(300); // give a (buggy) second send every chance to land before asserting there isn't one
  check("X18: coalescing — while offline, tap 4 then 6 on the same hole: stub captures show at most one in-flight body for that hole and its score is 6",
    bodiesX18.length === 1 && bodiesX18[0].hole === 6 && bodiesX18[0].score === 6,
    "bodies=" + JSON.stringify(bodiesX18));
  domX18.window.close();
}

{
  // X19: ordered drain — offline taps on holes 2 then 3 (different holes,
  // no coalescing): the captured POST order must be [h2, h3], proving the
  // drain sends strictly in seq order, one at a time (no Promise.all).
  let onlineX19 = false;
  const bodiesX19 = [];
  const fetchX19 = (url, opts) => {
    if (String(url).indexOf(epUrl) === 0) {
      if (!onlineX19) return Promise.reject(new TypeError("offline (simulated)"));
      bodiesX19.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 2, holes: {} }) });
    }
    return withScEndpoint()(url);
  };
  const domX19 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX19);
  const docX19 = await openScorer(domX19, { noSheet: true });
  docX19.querySelector('.sc-cell[data-hole="2"]').click();        // hole 2, par 4
  await until(() => !docX19.querySelector("#scSheet")?.hidden);
  docX19.querySelector('#scSheet .sc-key[data-score="4"]').click();
  await until(() => docX19.querySelector('.sc-cell[data-hole="2"] .sc-score')?.textContent === "4");
  docX19.querySelector('.sc-cell[data-hole="3"]').click();        // hole 3, par 3
  await until(() => !docX19.querySelector("#scSheet")?.hidden);
  docX19.querySelector('#scSheet .sc-key[data-score="3"]').click();
  await until(() => docX19.querySelector('.sc-cell[data-hole="3"] .sc-score')?.textContent === "3");
  onlineX19 = true;
  domX19.window.dispatchEvent(new domX19.window.Event("online"));
  await until(() => bodiesX19.length >= 2);
  const orderX19 = bodiesX19.map(b => b.hole);
  // Self-review finding (mutation check): a broken seq assignment (e.g.
  // every save minting the SAME seq) would still pass a hole-order-only
  // assertion, since a stable sort on equal seqs happens to preserve
  // object-key insertion order anyway — masking a real idempotency-ring
  // hazard (the server dedups on client_id+seq; two distinct scores
  // sharing one seq could get one silently treated as a replay of the
  // other). Also asserting DISTINCT, increasing seqs closes that gap.
  const seqsX19 = bodiesX19.map(b => b.seq);
  const seqsDistinctIncreasingX19 = seqsX19.length === 2 && seqsX19[0] !== seqsX19[1] && seqsX19[1] > seqsX19[0];
  check("X19: ordered drain — offline taps on holes 2 then 3: captured POST order is [h2, h3], each with its own distinct, increasing seq",
    JSON.stringify(orderX19) === JSON.stringify([2, 3]) && seqsDistinctIncreasingX19,
    "order=" + JSON.stringify(orderX19) + " seqs=" + JSON.stringify(seqsX19));
  domX19.window.close();
}

{
  // X20: SC-NOCLOBBER — sheet value for h14 = duck r2 fixture value (4)
  // (fixtures/scores.csv row "2026,duck,2,...,h14=4"). Simulated through
  // the Task-6 seam by stubbing window.scSheetHoles directly in this test
  // — that IS the Task-6 seam contract (brief's own note: Task 6 replaces
  // the stub with the real derivation and this check keeps passing).
  // Round pinned to "2" via a first_tee dynamically set 2 days before "now"
  // (never wall-clock-date-dependent) so scActiveRound()'s native DATE
  // default lands on round 2 for the WHOLE sequence.
  //
  // Review round 1 (I2/C3/I4) restructuring: the ORIGINAL version of this
  // test created the conflicting entry by editing a KNOWN sheet value via
  // the ordinary Replace-confirm — but I2's fix makes exactly that flow
  // carry override:true through automatically (the confirm already named
  // both numbers, so a SECOND confirm for the same decision would be
  // redundant friction). That's now the RIGHT behavior, but it means this
  // test's conflict must instead come from "drain-time discovery": the
  // phone queues 6 while the sheet value is still unknown (a genuinely
  // fresh tap, no edit flow at all), and ONLY AFTER that save does the
  // sheet value (4) become known — exactly the scenario the separate
  // scPadForceSend override still exists for.
  //
  // Review round 2 (finding #2): the ORIGINAL cellTextX20 assertion
  // matched the WHOLE cell's textContent, which also contains the
  // hole-NUMBER span ("14") — a "4" appears there regardless of any real
  // conflict, so `/4/.test(cellTextX20)` was a false positive that never
  // actually proved the sheet value rendered. Fixed to read the score <b>
  // span specifically ("6·4", not "6⇡14"). The conflict marker is now also
  // asserted with NO intervening tap (fix #2a made scDrain's hold-discovery
  // exit repaint immediately, so this needs no reopen-pad click to appear).
  const pastTeeX20 = new Date(Date.now() - 2 * 86400000).toISOString();
  const infoX20 = FIXTURES.info.replace(/^first_tee,.*$/m, "first_tee," + pastTeeX20) +
    "score_endpoint," + epUrl + "\n";
  const bodiesX20 = [];
  // Review round 2 (NEW CRITICAL, finding #1): the force-send request's
  // resolution is held open under test control (deliverForceSendX20) so
  // the mid-flight race window (up to C2's real 12s deadline in
  // production) can be exercised deterministically and fast here.
  let deliverForceSendX20;
  const forceSendGateX20 = new Promise(resolve => { deliverForceSendX20 = resolve; });
  const fetchX20 = (url, opts) => {
    if (String(url).indexOf(epUrl) === 0) {
      bodiesX20.push(JSON.parse(opts.body));
      return forceSendGateX20.then(() => ({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 2, holes: {} }) }));
    }
    return withOverride({ info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX20 }) })(url);
  };
  const domX20 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX20);
  const docX20 = await openScorer(domX20, { noSheet: true });
  await until(() => /Round 2/.test(docX20.querySelector("#scRound")?.textContent || ""));
  const roundOkX20 = /Round 2/.test(docX20.querySelector("#scRound")?.textContent || "");

  // Fresh tap — scSheetHoles is still the default `()=>null` at this point,
  // so hole 14 opens the plain numeric pad (no edit mode) and picking 6
  // sends-on-tap immediately: a plain queued entry, override:false.
  docX20.querySelector('.sc-cell[data-hole="14"]').click();
  await until(() => !docX20.querySelector("#scSheet")?.hidden);
  docX20.querySelector('#scSheet .sc-key[data-score="6"]').click();
  // Stub the sheet value IMMEDIATELY after (still synchronous, before the
  // save's deferred setTimeout(scDrain,0) has had a single tick to run) so
  // the very FIRST drain attempt already sees the conflict — never a race
  // where an unheld send could slip out before the stub lands.
  domX20.window.scSheetHoles = () => ({ 14: 4 });
  // NO intervening tap between here and the assertions below — fix #2a
  // (scDrain's hold-discovery repaint) must be what paints "conflict".
  await until(() => docX20.querySelector('.sc-cell[data-hole="14"]')?.classList.contains("sc-conflict"));
  await settle(300); // give the auto-drain every chance to (wrongly) fire before asserting it didn't
  const cellX20 = docX20.querySelector('.sc-cell[data-hole="14"]');
  const cellConflictClassX20 = !!cellX20 && cellX20.classList.contains("sc-conflict");
  // Rev 3 (SC-UI-V/SC-SKIN): the state mark moved to .sc-mark (renamed from
  // .sc-state-glyph) and the conflict glyph itself changed, ? -> ▲. The
  // score span's number order also flips to the spec's literal SHEET·MINE
  // wording (was MINE·SHEET pre-rev-3) — sheet=4 (stubbed above), mine=6
  // (queued), so "4·6".
  const cellGlyphX20 = (cellX20?.querySelector(".sc-mark")?.textContent || "") === "▲";
  const scoreSpanX20 = cellX20?.querySelector(".sc-score")?.textContent || "";
  const scoreSpanOkX20 = scoreSpanX20 === "4·6";
  const noPostYetX20 = bodiesX20.length === 0;

  // Read the held entry's seq directly from the journal (scKey/nkey are
  // `const`-bound and never become window properties — scJournalRead,
  // scEntryKeyOf, scorerSeason, scActiveRound are all plain top-level
  // `function` declarations, which DO, so this is the legitimate route).
  const seasonX20 = domX20.window.scorerSeason();
  const roundActiveX20 = domX20.window.scActiveRound();
  const journalKeyX20 = "gfy-scorer:" + seasonX20 + ":duck"; // nkey("Duck") === "duck", established elsewhere
  const entryKeyX20 = domX20.window.scEntryKeyOf(roundActiveX20, 14);
  const heldEntryX20 = domX20.window.scJournalRead(journalKeyX20).entries[entryKeyX20];
  const heldSeqX20 = heldEntryX20 && heldEntryX20.seq;

  // Task 4 (SC-CONFLICT-UI): reopening a conflict cell now renders a
  // SEPARATE dialog, #scConSheet — never #scSheet (which stays hidden+empty
  // the whole time a conflict is open, the SAME "closed" contract every
  // other state relies on) — with the prototype's verbatim two-button
  // ruling copy, no number-picking grid at all (Task 2's interim 3-way
  // layout is retired).
  docX20.querySelector('.sc-cell[data-hole="14"]').click(); // reopen -> conflict SHEET (#scConSheet)
  await until(() => !!docX20.querySelector("#scConSheet #scPadForceSend"));
  const conSheetVisibleX20 = !!docX20.querySelector("#scConSheet") &&
    docX20.querySelector("#scSheet")?.hidden === true;
  const conCopyTextX20 = docX20.querySelector("#scConSheet .sc-con-copy")?.textContent || "";
  // Review fix (Important #1): the ORIGINAL version of this assert only
  // checked the two fixture NUMBERS — it never guarded the pinned plain-
  // words sentence itself, nor the two button LABELS, so deleting "Nothing
  // resends on its own — pick which number is true." (the exact sentence
  // the global constraint calls out by name) or relabelling either button
  // left the suite green. Both are now asserted explicitly.
  const copyMatchesX20 = /sheet says 4/i.test(conCopyTextX20) && /this phone sent 6/i.test(conCopyTextX20) &&
    /Nothing resends on its own — pick which number is true\./.test(conCopyTextX20);
  const noKeyGridInConSheetX20 = !docX20.querySelector("#scConSheet .sc-key");
  const conBtnsX20 = [...docX20.querySelectorAll("#scConSheet .sc-con-btn")];
  const twoBtnsX20 = conBtnsX20.length === 2;
  const conBtnLabelsOkX20 = conBtnsX20.some(b => /Keep the sheet/.test(b.textContent || "")) &&
    conBtnsX20.some(b => /Replace with mine/i.test(b.textContent || ""));
  const padHasKeepSheetX20 = !!docX20.querySelector("#scConSheet #scPadKeepSheet");
  const padHasForceSendX20 = !!docX20.querySelector("#scConSheet #scPadForceSend");
  const keepSheetEnabledBeforeX20 = docX20.querySelector("#scConSheet #scPadKeepSheet")?.disabled !== true;

  // I4 + NEW CRITICAL fix (round 2, carried): click force-send — the
  // request goes out (captured) but stays UNRESOLVED (forceSendGateX20).
  // Reopen the pad MID-FLIGHT: BOTH ruling buttons must render disabled
  // with "sending — wait" (the v2.6 in-flight assert, carried). Attempt the
  // race anyway (click Keep-the-sheet) — it must be a no-op: the held entry
  // must still exist in the journal, untouched, while the send is in flight.
  docX20.querySelector("#scPadForceSend").click();
  await until(() => bodiesX20.some(b => b.hole === 14)); // request captured...
  await until(() => docX20.querySelector('.sc-cell[data-hole="14"]')?.classList.contains("sc-sending")); // ...state flips synchronously, before the await
  docX20.querySelector('.sc-cell[data-hole="14"]').click(); // reopen mid-flight
  await until(() => !!docX20.querySelector("#scConSheet #scPadKeepSheet"));
  const keepSheetDisabledMidFlightX20 = docX20.querySelector("#scConSheet #scPadKeepSheet")?.disabled === true;
  const forceSendDisabledMidFlightX20 = docX20.querySelector("#scConSheet #scPadForceSend")?.disabled === true;
  const midFlightCopyOkX20 = /sending — wait/i.test(docX20.querySelector("#scConSheet")?.textContent || "");
  docX20.querySelector("#scConSheet #scPadKeepSheet")?.click(); // the race — must no-op (disabled attr AND function-level guard)
  await settle(150);
  const entrySurvivedRaceX20 = !!domX20.window.scJournalRead(journalKeyX20).entries[entryKeyX20];

  // Now let the send actually resolve and settle to completion.
  deliverForceSendX20();
  await until(() => {
    const c = docX20.querySelector('.sc-cell[data-hole="14"]');
    return !!c && !c.classList.contains("sc-sending");
  });
  await settle(200); // let scDrain's own async continuation (post-await renderScCard + loop) fully finish before tearing the window down
  const sentHolesX20 = bodiesX20.map(b => b.hole);
  const forceSendBodyX20 = bodiesX20.find(b => b.hole === 14);

  // NEW (Task 4 Step 1): a CLEAN (not mid-flight) "Keep the sheet" click —
  // journal entry gone + cell reverts — on a SEPARATE hole (5) so it can't
  // interact with hole 14's already-resolved force-send above. Same
  // drain-time-discovery technique: a fresh tap+pick queues the phone's own
  // value BEFORE the sheet value (9) becomes known, so the very first drain
  // attempt discovers the mismatch and holds — never a race where an unheld
  // send could slip out first.
  docX20.querySelector('.sc-cell[data-hole="5"]').click();
  await until(() => !docX20.querySelector("#scSheet")?.hidden);
  docX20.querySelector('#scSheet .sc-key[data-score="3"]').click();
  domX20.window.scSheetHoles = () => ({ 14: 4, 5: 9 });
  await until(() => docX20.querySelector('.sc-cell[data-hole="5"]')?.classList.contains("sc-conflict"));
  await settle(200); // give the auto-drain every chance to (wrongly) fire before the keep-sheet click below
  const noPostForHole5X20 = !bodiesX20.some(b => b.hole === 5);
  const entryKey5X20 = domX20.window.scEntryKeyOf(roundActiveX20, 5);
  const heldBeforeKeepX20 = !!domX20.window.scJournalRead(journalKeyX20).entries[entryKey5X20];
  docX20.querySelector('.sc-cell[data-hole="5"]').click(); // reopen -> conflict sheet for hole 5
  await until(() => !!docX20.querySelector("#scConSheet #scPadKeepSheet"));
  const keepCopyOkX20 = /sheet says 9/i.test(docX20.querySelector("#scConSheet .sc-con-copy")?.textContent || "") &&
    /this phone sent 3/i.test(docX20.querySelector("#scConSheet .sc-con-copy")?.textContent || "");
  docX20.querySelector("#scConSheet #scPadKeepSheet").click(); // clean keep — no in-flight race this time
  await until(() => !docX20.querySelector('.sc-cell[data-hole="5"]')?.classList.contains("sc-conflict"));
  const entryGoneAfterKeepX20 = !domX20.window.scJournalRead(journalKeyX20).entries[entryKey5X20];
  const cellRevertedX20 = !docX20.querySelector('.sc-cell[data-hole="5"]')?.classList.contains("sc-conflict");
  const sheetClosedAfterKeepX20 = docX20.querySelector("#scSheet")?.hidden === true && !docX20.querySelector("#scConSheet");
  domX20.window.close();

  check("X20: SC-NOCLOBBER/SC-CONFLICT-UI — sheet value for h14 = duck r2 fixture value (4) -> use queued 6 (differs): NO POST for h14 on drain; cell renders conflict IMMEDIATELY with no intervening tap (score span '4·6' SHEET·MINE, .sc-conflict class, ▲ mark); reopening renders #scConSheet (never #scSheet, which stays hidden) with the prototype's verbatim ruling copy ('sheet says 4' / 'this phone sent 6' / 'Nothing resends on its own — pick which number is true.'), exactly 2 .sc-con-btns labeled 'Keep the sheet' / 'Replace with mine', no number grid; Keep-the-sheet/Replace-with-mine disable mid-flight with 'sending — wait' text and a race-click while sending never deletes the entry; force-send (I4) carries the SAME seq the held entry already had; on a separate hole, a CLEAN (non-racing) Keep-the-sheet click deletes the journal entry and reverts the cell out of conflict",
    roundOkX20 && noPostYetX20 && cellConflictClassX20 && cellGlyphX20 && scoreSpanOkX20 &&
      conSheetVisibleX20 && copyMatchesX20 && noKeyGridInConSheetX20 && twoBtnsX20 && conBtnLabelsOkX20 &&
      padHasKeepSheetX20 && padHasForceSendX20 && keepSheetEnabledBeforeX20 &&
      keepSheetDisabledMidFlightX20 && forceSendDisabledMidFlightX20 && midFlightCopyOkX20 && entrySurvivedRaceX20 &&
      JSON.stringify(sentHolesX20) === JSON.stringify([14]) &&
      !!forceSendBodyX20 && forceSendBodyX20.score === 6 && forceSendBodyX20.seq === heldSeqX20 &&
      typeof heldSeqX20 === "number" &&
      noPostForHole5X20 && heldBeforeKeepX20 && keepCopyOkX20 &&
      entryGoneAfterKeepX20 && cellRevertedX20 && sheetClosedAfterKeepX20,
    "roundOk=" + roundOkX20 + " noPostYet=" + noPostYetX20 + " cellConflictClass=" + cellConflictClassX20 +
      " cellGlyph=" + cellGlyphX20 + " scoreSpan=" + scoreSpanX20 +
      " conSheetVisible=" + conSheetVisibleX20 + " copyMatches=" + copyMatchesX20 + " conCopyText=" + conCopyTextX20 +
      " noKeyGrid=" + noKeyGridInConSheetX20 + " twoBtns=" + twoBtnsX20 + " conBtnLabelsOk=" + conBtnLabelsOkX20 +
      " padHasKeepSheet=" + padHasKeepSheetX20 + " padHasForceSend=" + padHasForceSendX20 +
      " keepSheetEnabledBefore=" + keepSheetEnabledBeforeX20 +
      " keepSheetDisabledMidFlight=" + keepSheetDisabledMidFlightX20 +
      " forceSendDisabledMidFlight=" + forceSendDisabledMidFlightX20 + " midFlightCopyOk=" + midFlightCopyOkX20 +
      " entrySurvivedRace=" + entrySurvivedRaceX20 +
      " sentHoles=" + JSON.stringify(sentHolesX20) + " heldSeq=" + heldSeqX20 +
      " forceSendBody=" + JSON.stringify(forceSendBodyX20) +
      " noPostForHole5=" + noPostForHole5X20 + " heldBeforeKeep=" + heldBeforeKeepX20 + " keepCopyOk=" + keepCopyOkX20 +
      " entryGoneAfterKeep=" + entryGoneAfterKeepX20 + " cellReverted=" + cellRevertedX20 +
      " sheetClosedAfterKeep=" + sheetClosedAfterKeepX20);
}

{
  // X21: rejected verdict — stub RESOLVES {ok:false, verdict:"team not in
  // roster"} (a server-shaped rejection, not a transport failure — scSend
  // resolves normally, so the drain's rejected-state branch fires, not the
  // config one). Cell loud state carries the VERBATIM verdict (title
  // attribute); the pad shows it too, plus a Retry that keeps the same
  // seq (idempotency — proven directly by X22; here just the UI); "text
  // Riley" escalates once retries reach 2.
  const fetchX21 = (url) => {
    if (String(url).indexOf(epUrl) === 0) {
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: false, verdict: "team not in roster", team: "Duck", round: 2, holes: null }) });
    }
    return withScEndpoint()(url);
  };
  const domX21 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX21);
  const docX21 = await openScorer(domX21, { noSheet: true });
  docX21.querySelector('.sc-cell[data-hole="9"]').click();        // hole 9, par 5
  await until(() => !docX21.querySelector("#scSheet")?.hidden);
  docX21.querySelector('#scSheet .sc-key[data-score="5"]').click();
  await until(() => docX21.querySelector('.sc-cell[data-hole="9"]')?.classList.contains("sc-rejected"));
  const cellX21 = docX21.querySelector('.sc-cell[data-hole="9"]');
  const cellVerdictOkX21 = (cellX21?.getAttribute("title") || "").includes("team not in roster");
  docX21.querySelector('.sc-cell[data-hole="9"]').click();        // reopen -> rejected pad
  await until(() => !!docX21.querySelector("#scPadRetry"));
  const padVerdictOkX21 = /team not in roster/.test(docX21.querySelector("#scSheet")?.textContent || "");
  const noEscalateYetX21 = !/text Riley/i.test(docX21.querySelector("#scSheet")?.textContent || "");
  docX21.querySelector("#scPadRetry").click();                    // manual retry #1 — same seq, still rejected
  await until(() => docX21.querySelector('.sc-cell[data-hole="9"]')?.classList.contains("sc-rejected"));
  docX21.querySelector("#scPadRetry").click();                    // manual retry #2
  await until(() => /text Riley/i.test(docX21.querySelector("#scSheet")?.textContent || ""));
  const escalateOkX21 = /text Riley/i.test(docX21.querySelector("#scSheet")?.textContent || "");
  domX21.window.close();

  // Carried requirement (Task 4's review): when a drain hits {kind:"config"}
  // the CAPTAIN-FACING view (not just the ?debug=1 panel X15 already
  // covers) must show the loud banner — "scoring endpoint not reachable",
  // plus the raw form link when form_url is configured. Folded into this
  // same check per the controller's instruction (no new X-number).
  const infoX21b = FIXTURES.info + "score_endpoint," + epUrl + "\nform_url,https://forms.gle/exampleFormXYZ\n";
  const fetchX21b = (url) => {
    if (String(url).indexOf(epUrl) === 0) return Promise.resolve({ ok: true, status: 200, text: async () => "<html>Sign in</html>" });
    return withOverride({ info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX21b }) })(url);
  };
  const domX21b = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX21b);
  const docX21b = await openScorer(domX21b, { noSheet: true });
  docX21b.querySelector('.sc-cell[data-hole="10"]').click();      // hole 10, par 4
  await until(() => !docX21b.querySelector("#scSheet")?.hidden);
  docX21b.querySelector('#scSheet .sc-key[data-score="4"]').click();
  await until(() => /scoring endpoint not reachable/i.test(docX21b.querySelector("#scHeader")?.textContent || ""));
  const bannerTextX21b = docX21b.querySelector("#scHeader")?.textContent || "";
  const bannerOkX21b = /scoring endpoint not reachable/i.test(bannerTextX21b);
  const bannerLinkX21b = docX21b.querySelector("#scHeader a");
  const linkOkX21b = bannerLinkX21b?.getAttribute("href") === "https://forms.gle/exampleFormXYZ";
  domX21b.window.close();

  // I5 (review round 1): a REJECTED entry from a round OTHER than the
  // active one must be NAMED in the old-round summary line (not muted into
  // a bare count) and remain reachable via a read-only expandable verdict
  // list. Uses the SC-ROUND spring (X11's mechanism): toggle to the OTHER
  // round for exactly one submission, tap+pick — the spring reverts the
  // active round immediately after, leaving a rejected entry filed under a
  // round that is no longer active.
  const fetchX21c = (url) => {
    if (String(url).indexOf(epUrl) === 0) {
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: false, verdict: "round total already entered — clear r1/r2 first", team: "Duck", round: 2, holes: null }) });
    }
    return withScEndpoint()(url);
  };
  const domX21c = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX21c);
  const docX21c = await openScorer(domX21c, { noSheet: true });
  docX21c.querySelector("#scRound").click();                      // spring to the OTHER round for one submission
  docX21c.querySelector('.sc-cell[data-hole="6"]').click();        // hole 6, par 4
  await until(() => !docX21c.querySelector("#scSheet")?.hidden);
  docX21c.querySelector('#scSheet .sc-key[data-score="4"]').click();
  await until(() => /rejected — text Riley/i.test(docX21c.querySelector("#scCard")?.textContent || ""));
  const oldRoundLineOkX21c = /rejected — text Riley/i.test(
    [...docX21c.querySelectorAll(".sc-old-round")].map(e => e.textContent).join(" "));
  const oldRoundBtnX21c = docX21c.querySelector("button.sc-old-round[data-old-round]");
  const oldRoundIsButtonX21c = !!oldRoundBtnX21c; // rule 4 still holds: only rejections make it clickable
  oldRoundBtnX21c?.click();
  await until(() => !!docX21c.querySelector(".sc-old-round-verdict"));
  const verdictShownX21c = /round total already entered/i.test(docX21c.querySelector("#scCard")?.textContent || "");
  domX21c.window.close();

  check("X21: rejected verdict — cell loud state + pad carry the verbatim verdict; 'text Riley' escalates after 2 manual retries; the carried SC-LOUD-CONFIG banner (drain hit kind:'config') shows in the captain view too, with the form link when configured; a rejected entry in a NON-active round is named in the old-round summary (not muted) and its verdict is reachable via a read-only expandable list",
    cellVerdictOkX21 && padVerdictOkX21 && noEscalateYetX21 && escalateOkX21 && bannerOkX21b && linkOkX21b &&
      oldRoundLineOkX21c && oldRoundIsButtonX21c && verdictShownX21c,
    "cellVerdict=" + cellVerdictOkX21 + " padVerdict=" + padVerdictOkX21 + " noEscalateYet=" + noEscalateYetX21 +
      " escalate=" + escalateOkX21 + " banner=" + bannerOkX21b + " link=" + linkOkX21b +
      " oldRoundLine=" + oldRoundLineOkX21c + " oldRoundIsButton=" + oldRoundIsButtonX21c +
      " verdictShown=" + verdictShownX21c);
}

{
  // X22: idempotent seq — the same entry retried (stub: first
  // network-reject, then success) sends the SAME seq both times. A
  // network-level reject reverts the entry to queued WITHOUT touching its
  // seq; the AUTOMATIC retry (triggered here by the 'online' event, not a
  // manual tap) must reuse that same seq for the server's idempotency
  // pairing to work. Captures the seq from every attempt (including the
  // failed one) — the request body is genuinely constructed before the
  // network decides whether to deliver it.
  let attemptsX22 = 0;
  const seqsX22 = [];
  const fetchX22 = (url, opts) => {
    if (String(url).indexOf(epUrl) === 0) {
      attemptsX22++;
      seqsX22.push(JSON.parse(opts.body).seq);
      if (attemptsX22 === 1) return Promise.reject(new TypeError("first attempt offline (simulated)"));
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 2, holes: {} }) });
    }
    return withScEndpoint()(url);
  };
  const domX22 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX22);
  const docX22 = await openScorer(domX22, { noSheet: true });
  docX22.querySelector('.sc-cell[data-hole="11"]').click();       // hole 11, par 5
  await until(() => !docX22.querySelector("#scSheet")?.hidden);
  docX22.querySelector('#scSheet .sc-key[data-score="5"]').click();
  await until(() => attemptsX22 >= 1);
  await until(() => docX22.querySelector('.sc-cell[data-hole="11"]')?.classList.contains("sc-queued"));
  domX22.window.dispatchEvent(new domX22.window.Event("online"));
  await until(() => attemptsX22 >= 2);
  await until(() => {
    const c = docX22.querySelector('.sc-cell[data-hole="11"]');
    return !!c && !c.classList.contains("sc-queued") && !c.classList.contains("sc-sending");
  });
  domX22.window.close();

  // C1 (review round 1), mutation evidence folded in here (same idempotent-
  // seq theme): a "sending" entry stranded by a phone that died mid-POST
  // in a PREVIOUS session must normalize to "queued" on the FIRST journal
  // read of a fresh load, and then drain — carrying the SAME pre-existing
  // seq (the server's idempotency ring is exactly what makes a resend of
  // an already-applied write safe). Pre-seed localStorage BEFORE the
  // confirm tap (the confirm click's own scStore call becomes the natural
  // first read for this key, so the app's OWN normal code path — not test
  // scaffolding — performs the normalization).
  const bodiesC1 = [];
  const fetchC1 = (url, opts) => {
    if (String(url).indexOf(epUrl) === 0) {
      bodiesC1.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 1, holes: {} }) });
    }
    return withScEndpoint()(url);
  };
  const domC1 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchC1);
  const docC1 = domC1.window.document;
  await until(() => !!docC1.querySelector("#scConfirmBtn")); // confirm screen shown, BEFORE clicking -- no journal read has happened yet
  // Pre-Task-6 baseline (see openScorer's noSheet comment above): this test
  // predates SC-DERIVE and must stay isolated from the real sheet merge —
  // set only now the script has genuinely run once (function hoisting for
  // scSheetHoles already happened before this point).
  domC1.window.scSheetHoles = () => null;
  const seasonC1 = domC1.window.scorerSeason();
  const roundC1 = domC1.window.scActiveRound(); // whatever the native default resolves to in this config
  const journalKeyC1 = "gfy-scorer:" + seasonC1 + ":duck"; // nkey("Duck") === "duck"
  const entryKeyC1 = domC1.window.scEntryKeyOf(roundC1, 8);
  const strandedRoot = { client_id: "c-prior-session-01", seq: 5, confirmed: true,
    entries: { [entryKeyC1]: { round: roundC1, hole: 8, score: 4, seq: 5, state: "sending", verdict: null, ts: Date.now(), retries: 0 } } };
  domC1.window.localStorage.setItem(journalKeyC1, JSON.stringify(strandedRoot));
  docC1.querySelector("#scConfirmBtn").click(); // first-ever read of this key: scJournalRead must normalize sending->queued right here
  await until(() => docC1.querySelectorAll("#scCard .sc-cell").length > 0);
  const normalizedToQueuedC1 = docC1.querySelector('.sc-cell[data-hole="8"]')?.classList.contains("sc-queued");
  domC1.window.dispatchEvent(new domC1.window.Event("online")); // external trigger -- normalization alone doesn't auto-drain
  await until(() => bodiesC1.length > 0);
  await settle(200);
  const drainedC1 = bodiesC1.length === 1 && bodiesC1[0].hole === 8 && bodiesC1[0].score === 4 && bodiesC1[0].seq === 5;
  domC1.window.close();

  // C1 (final review — CRITICAL, cross-round NOCLOBBER, the "day-2 ghost
  // resend"): a queued ROUND-1 entry whose round-1 SHEET hole holds a
  // DIFFERENT value must NOT be posted by a drain running once round 2 is
  // active — before this fix, scEntryHeld's round-scoping gave every
  // non-active-round entry an unconditional pass, so a round-1 entry queued
  // on a dead phone would drain UNCHECKED on day 2, silently overwriting a
  // manual sheet correction. Active round forced to 2 via a first_tee 2
  // days in the past (same technique as X20/X24/X25) — Duck's round-1
  // fixture is also fully populated (18/18 holes), so I4's team-state-first
  // rule independently agrees round 2 is active. Runs the REAL sheet
  // derivation (no noSheet stub — this needs genuine round-1 sheet truth to
  // check against). The conflicting entry is seeded directly into
  // localStorage (same technique as the stranded-session case just above)
  // as a plain queued entry with override:false — going through the actual
  // replace-confirm UI tap flow would auto-carry override:true (I2's
  // existing behavior) and mask the exact bug this proves fixed.
  const pastTeeC1x = new Date(Date.now() - 2 * 86400000).toISOString();
  const infoC1x = FIXTURES.info.replace(/^first_tee,.*$/m, "first_tee," + pastTeeC1x) +
    "score_endpoint," + epUrl + "\n";
  const bodiesC1x = [];
  const fetchC1x = (url, opts) => {
    if (String(url).indexOf(epUrl) === 0) {
      bodiesC1x.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 1, holes: {} }) });
    }
    return withOverride({ info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoC1x }) })(url);
  };
  const domC1x = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchC1x);
  const docC1x = domC1x.window.document;
  await until(() => !!docC1x.querySelector("#scConfirmBtn")); // confirm screen shown, before any journal read
  const seasonC1x = domC1x.window.scorerSeason();
  const journalKeyC1x = "gfy-scorer:" + seasonC1x + ":duck";
  const entryKeyC1x = domC1x.window.scEntryKeyOf("1", 4); // hole 4 — Duck R1 fixture h4=5 (par 5)
  const staleRoot = { client_id: "c-day1-phone", seq: 1, confirmed: true,
    entries: { [entryKeyC1x]: { round: "1", hole: 4, score: 8, seq: 1, state: "queued", verdict: null, ts: Date.now(), retries: 0, override: false } } };
  domC1x.window.localStorage.setItem(journalKeyC1x, JSON.stringify(staleRoot));
  docC1x.querySelector("#scConfirmBtn").click();
  await until(() => docC1x.querySelectorAll("#scCard .sc-cell").length > 0);
  const activeRoundC1x = domC1x.window.scActiveRound(); // must resolve to "2" — date rule AND I4 team-state-first agree for Duck
  domC1x.window.dispatchEvent(new domC1x.window.Event("online")); // external trigger, same as every other drain test here
  await settle(300); // give a wrongly-unheld drain every chance to (wrongly) fire before asserting it didn't
  const heldEntryC1x = domC1x.window.scJournalRead(journalKeyC1x).entries[entryKeyC1x];
  const stillQueuedC1x = !!heldEntryC1x && heldEntryC1x.state === "queued";
  const noPostForHole4C1x = !bodiesC1x.some(b => b.hole === 4);
  domC1x.window.close();

  check("X22: idempotent seq — the same entry retried (stub: first network-reject, then success) sends the SAME seq both times; a stranded 'sending' entry from a killed-mid-POST prior session normalizes to queued on the FIRST read of a fresh load and drains with its ORIGINAL seq (C1); a queued ROUND-1 entry (hole 4, score 8) whose round-1 sheet hole holds a DIFFERENT value (Duck fixture h4=5) is NOT posted by a day-2/round-2-active drain — cross-round NOCLOBBER now applies identically to non-active-round entries (C1, final review)",
    attemptsX22 === 2 && seqsX22.length === 2 && seqsX22[0] === seqsX22[1] && typeof seqsX22[0] === "number" &&
      normalizedToQueuedC1 && drainedC1 &&
      activeRoundC1x === "2" && stillQueuedC1x && noPostForHole4C1x,
    "attempts=" + attemptsX22 + " seqs=" + JSON.stringify(seqsX22) +
      " normalizedToQueued=" + normalizedToQueuedC1 + " drained=" + drainedC1 + " bodiesC1=" + JSON.stringify(bodiesC1) +
      " activeRoundC1x=" + activeRoundC1x + " stillQueuedC1x=" + stillQueuedC1x + " noPostForHole4C1x=" + noPostForHole4C1x +
      " bodiesC1x=" + JSON.stringify(bodiesC1x));
}

{
  // X23: storage-dead degrade — localStorage.setItem throws. jsdom's real
  // Storage is a WebIDL "legacy platform object" whose named-property
  // semantics make a plain `.setItem = fn` reassignment silently
  // ineffective (verified by hand before writing this test) — the only
  // reliable way to force a throw is replacing window.localStorage
  // entirely with a stub. Confirm-tap happens with REAL storage first (so
  // the confirmed flag persists normally, unaffected); only AFTER the card
  // is up does storage go dead, isolating the journal-write failure.
  const fetchX23 = (url) => {
    if (String(url).indexOf(epUrl) === 0) {
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, verdict: "applied", team: "Duck", round: 2, holes: {} }) });
    }
    return withScEndpoint()(url);
  };
  const domX23 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX23);
  const docX23 = await openScorer(domX23, { noSheet: true });
  const deadStorageX23 = {
    getItem() { return null; },
    setItem() { throw new Error("storage dead (simulated)"); },
    removeItem() {}, clear() {}, key() { return null; }, length: 0,
  };
  Object.defineProperty(domX23.window, "localStorage", { value: deadStorageX23, configurable: true });
  docX23.querySelector('.sc-cell[data-hole="12"]').click();       // hole 12, par 3
  await until(() => !docX23.querySelector("#scSheet")?.hidden);
  docX23.querySelector('#scSheet .sc-key[data-score="3"]').click();
  await until(() => docX23.querySelector('.sc-cell[data-hole="12"] .sc-score')?.textContent === "3");
  await settle(300); // let the deferred drain (and its own scStore attempts against dead storage) run through
  const cellX23 = docX23.querySelector('.sc-cell[data-hole="12"]');
  const cellOkX23 = cellX23?.querySelector(".sc-score")?.textContent === "3";
  const headerOkX23 = /can't remember sends/i.test(docX23.querySelector("#scHeader")?.textContent || "");
  const noErrorsX23 = domX23.pageErrors.length === 0;
  check("X23: storage-dead degrade — makeDom variant where localStorage.setItem throws: tap still updates the cell in-memory and the header shows the 'can't remember sends' copy; no uncaught errors",
    cellOkX23 && headerOkX23 && noErrorsX23,
    "cellOk=" + cellOkX23 + " headerOk=" + headerOkX23 + " pageErrors=" + domX23.pageErrors.length +
      " headerText=" + (docX23.querySelector("#scHeader")?.textContent || "").slice(0, 120));
  domX23.window.close();
}

/* ---------------------------------------------------------------------
   X24-X26: sheet truth merge, glance strip, render boundary (spec §18
   SC-DERIVE/SC-GLANCE — task 6). window.scSheetHoles is no longer the
   Task 5 ()=>null seam stub. X24 and X25 are the FIRST tests to exercise
   the REAL derivation end to end (no noSheet override). X26 is mixed —
   its FIRST dom (pad-open/Other-survives) passes { noSheet: true }
   deliberately: it is proving PRE-Task-6 pad mechanics (Task 3/5's
   STATE-driven idempotent renderScCard()) survive a full load() cycle,
   not the sheet merge itself, so it stays isolated from real sheet data
   for the same reason X7-X23 do (review round 1: corrected here after
   the report overclaimed "no noSheet override anywhere below" for all
   three). Its SECOND dom (the #scConfirm boundary) uses no override —
   it never renders a card at all (picker/confirm only), so the real vs.
   stubbed sheet is moot there either way.
   --------------------------------------------------------------------- */
{
  // X24: SC-YEAR independence — duck's r2 fixture natively has h1..h6 =
  // 4,4,3,5,3,4 (fixtures/scores.csv "2026,duck,2,..."). Round pinned to
  // "2" via the same past-first_tee trick X20 established (never
  // wall-clock-dependent). The card's sheet-derived cells must never move
  // when the #board year picker changes STATE.year — scSheetHoles() is
  // keyed off scorerSeason() (buildPlayers(seasonY), an independent read),
  // never STATE.year. Proven by actually poking the picker to a DIFFERENT
  // year (2025) on #board, then navigating back to #score, and re-reading
  // the exact same cells.
  const pastTeeX24 = new Date(Date.now() - 2 * 86400000).toISOString();
  const infoX24 = FIXTURES.info.replace(/^first_tee,.*$/m, "first_tee," + pastTeeX24) +
    "score_endpoint," + epUrl + "\n";
  const fetchX24 = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX24 }),
  });
  const domX24 = makeDom("#score?team=" + encodeURIComponent("Duck"), fetchX24);
  const docX24 = await openScorer(domX24);
  await until(() => /Round 2/.test(docX24.querySelector("#scRound")?.textContent || ""));
  const sheetVal = h => docX24.querySelector('.sc-cell[data-hole="' + h + '"] .sc-score')?.textContent;
  const isSheet = h => !!docX24.querySelector('.sc-cell[data-hole="' + h + '"]')?.classList.contains("sc-onsheet");
  const expectedX24 = ["4", "4", "3", "5", "3", "4"];
  const beforeValsX24 = [1, 2, 3, 4, 5, 6].map(sheetVal);
  const beforeClassesX24 = [1, 2, 3, 4, 5, 6].every(isSheet);

  // Poke the year picker on #board to a DIFFERENT year (STATE.year away).
  domX24.window.location.hash = "#board";
  domX24.window.dispatchEvent(new domX24.window.Event("hashchange"));
  await until(() => docX24.querySelector('[data-view="board"]')?.hidden === false);
  await until(() => !!docX24.querySelector('#years .year-btn[data-year="2025"]'));
  docX24.querySelector('#years .year-btn[data-year="2025"]').click();

  // ...and back to #score.
  domX24.window.location.hash = "#score?team=" + encodeURIComponent("Duck");
  domX24.window.dispatchEvent(new domX24.window.Event("hashchange"));
  await until(() => docX24.querySelectorAll("#scCard .sc-cell").length > 0);

  const afterValsX24 = [1, 2, 3, 4, 5, 6].map(sheetVal);
  const afterClassesX24 = [1, 2, 3, 4, 5, 6].every(isSheet);
  domX24.window.close();

  check("X24: SC-YEAR independence — duck r2 h1..h6 (4,4,3,5,3,4) render on-sheet, unaffected by poking the #board year picker to 2025 and back to #score",
    JSON.stringify(beforeValsX24) === JSON.stringify(expectedX24) && beforeClassesX24 &&
      JSON.stringify(afterValsX24) === JSON.stringify(expectedX24) && afterClassesX24,
    "before=" + JSON.stringify(beforeValsX24) + " after=" + JSON.stringify(afterValsX24) +
      " beforeClasses=" + beforeClassesX24 + " afterClasses=" + afterClassesX24);
}

{
  // X25: SC-GLANCE honesty. Team chosen: Tex — board pos 3 (per group A's
  // existing A4/A8 assertions), with a genuinely PARTIAL round-2 card (7
  // holes; h1's on-sheet "0" is excluded per S-ZERO, matching A8's own
  // "R2 · 7"). Reporting count verified against the fixture directly (not
  // assumed) at implementation time: of the 5 registered teams, only
  // duck/sully/moose/tex have an actual hole-by-hole round-2 card — Bear's
  // round 2 is a totals-only lump score (76, no per-hole breakdown, no
  // "thru" to report) — so M=4, stated here per the brief's instruction to
  // verify and report the real number (see task-6-report.md).
  const pastTeeX25 = new Date(Date.now() - 2 * 86400000).toISOString();
  const infoX25 = FIXTURES.info.replace(/^first_tee,.*$/m, "first_tee," + pastTeeX25) +
    "score_endpoint," + epUrl + "\n";
  const fetchX25 = (url) => {
    if (String(url).indexOf(epUrl) === 0) return Promise.reject(new TypeError("offline (simulated)"));
    return withOverride({ info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX25 }) })(url);
  };
  const domX25 = makeDom("#score?team=" + encodeURIComponent("Tex"), fetchX25);
  const docX25 = await openScorer(domX25);
  await until(() => /Round 2/.test(docX25.querySelector("#scRound")?.textContent || ""));
  const glanceText = () => docX25.querySelector("#scGlance")?.textContent || "";

  const posOkX25 = /3rd of 4 reporting/.test(glanceText());
  const thruOkX25 = /thru 7/.test(glanceText());
  const leaderOkX25 = /Duck/.test(glanceText()) && /thru 18/.test(glanceText());
  const neighborsOkX25 = /Sully/.test(glanceText()) && /Moose/.test(glanceText());
  const noPendingYetX25 = !docX25.querySelector(".sc-glance-pending");

  // Tap two FRESH holes (9, 10 — blank on Tex's r2 sheet row) while
  // offline: they queue locally but never reach the sheet.
  docX25.querySelector('.sc-cell[data-hole="9"]').click();
  await until(() => !docX25.querySelector("#scSheet")?.hidden);
  docX25.querySelector('#scSheet .sc-key[data-score="4"]').click();
  await until(() => docX25.querySelector('.sc-cell[data-hole="9"]')?.classList.contains("sc-queued"));
  docX25.querySelector('.sc-cell[data-hole="10"]').click();
  await until(() => !docX25.querySelector("#scSheet")?.hidden);
  docX25.querySelector('#scSheet .sc-key[data-score="4"]').click();
  await until(() => docX25.querySelector('.sc-cell[data-hole="10"]')?.classList.contains("sc-queued"));

  const pendingTextX25 = docX25.querySelector(".sc-glance-pending")?.textContent || "";
  const pendingOkX25 = /2 pending/.test(pendingTextX25);
  // Board-data-only: the two fresh phone-only taps must NOT move the
  // board's own thru/reporting numbers — they're not on the sheet.
  const stillThru7X25 = /thru 7/.test(glanceText()) && !/thru 9/.test(glanceText());
  const stillM4X25 = /of 4 reporting/.test(glanceText());

  // Review round 1 (Important finding): the glance's leader/neighbor names
  // must be season-pinned (scorerSeason(), SC-YEAR) — captainLabel/teamLabel
  // internally call rosterMap(seasonY), not bare rosterMap()=rosterMap
  // (STATE.year). Poke the year picker on #board (X24's own technique) to
  // 2025 (a year Field has NO rows for), then return to #score, and assert
  // the leader/neighbor names are STILL cap-styled. Asserting only the raw
  // name TEXT would be a false-positive test: a broken bare-rosterMap()
  // path also falls through to captainLabel/teamLabel's raw-esc(rawFallback)
  // branch (no roster match for 2025) and still shows "Duck"/"Sully"/"Moose"
  // as plain text — only the .cap class distinguishes a genuine season-
  // pinned roster hit from that fallback.
  domX25.window.location.hash = "#board";
  domX25.window.dispatchEvent(new domX25.window.Event("hashchange"));
  await until(() => docX25.querySelector('[data-view="board"]')?.hidden === false);
  await until(() => !!docX25.querySelector('#years .year-btn[data-year="2025"]'));
  docX25.querySelector('#years .year-btn[data-year="2025"]').click();
  domX25.window.location.hash = "#score?team=" + encodeURIComponent("Tex");
  domX25.window.dispatchEvent(new domX25.window.Event("hashchange"));
  await until(() => docX25.querySelectorAll("#scCard .sc-cell").length > 0);

  const namesAfterPokeX25 = /Duck/.test(glanceText()) && /Sully/.test(glanceText()) && /Moose/.test(glanceText());
  const leaderCapAfterPokeX25 = !!docX25.querySelector(".sc-glance-leader .cap");
  const neighborCapsAfterPokeX25 = docX25.querySelectorAll(".sc-glance-neighbor .cap").length === 2;

  domX25.window.close();

  check("X25: SC-GLANCE honesty — Tex shows '3rd of 4 reporting · thru 7' (M verified against the fixture: 4 of 5 registered teams have an actual r2 hole-by-hole card; Bear's r2 is totals-only), leader Duck (thru 18), neighbors Sully/Moose named; 2 fresh offline taps render as their OWN 'pending on your phone' line (2 pending) without moving the board's thru/reporting numbers; leader/neighbor names stay CAP-STYLED (season-pinned via scorerSeason(), not STATE.year) after poking the #board year picker to 2025 and back",
    posOkX25 && thruOkX25 && leaderOkX25 && neighborsOkX25 && noPendingYetX25 &&
      pendingOkX25 && stillThru7X25 && stillM4X25 &&
      namesAfterPokeX25 && leaderCapAfterPokeX25 && neighborCapsAfterPokeX25,
    "pos=" + posOkX25 + " thru=" + thruOkX25 + " leader=" + leaderOkX25 + " neighbors=" + neighborsOkX25 +
      " pendingBefore=" + !noPendingYetX25 + " pendingText=" + pendingTextX25 +
      " namesAfterPoke=" + namesAfterPokeX25 + " leaderCapAfterPoke=" + leaderCapAfterPokeX25 +
      " neighborCapsAfterPoke=" + neighborCapsAfterPokeX25 +
      " glanceText=" + glanceText().slice(0, 220));
}

{
  // X26: render boundary. (a) open pad(7), open the "Other" overflow row,
  // then run the SAME path the 60s auto-refresh timer uses (window.load()
  // — a plain top-level `function load(){}` declaration, which DOES become
  // a window property in a classic script, unlike scDrainTimer's `let`, per
  // the precedent Task 5 already established) — the pad must still be open
  // on hole 7 and the overflow row must still be open afterward too (rev 3,
  // task 2 pinned resolution: STATE.scPadOtherVal's free-text-input echo is
  // retired — the SAME refresh-survival protection this test always proved
  // now runs through STATE.scPadOtherOpen instead, asserted via node
  // identity on the numrow container, not just a leftover value). (b)
  // separately, the boundary must also protect #scConfirm: a captain
  // reached via the PICKER (no hash team — scShowConfirm called directly
  // from the pick button, nothing persisted) must not be bounced back to
  // #scPicker by a background load() cycle before tapping Confirm
  // (ledgered carry-over from Task 1's review). Combined into ONE check
  // per the "no new X-numbers beyond the brief" constraint.
  const domX26 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX26 = await openScorer(domX26, { noSheet: true });
  docX26.querySelector('.sc-cell[data-hole="7"]').click();
  await until(() => (docX26.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 7"));
  docX26.querySelector("#scPadOtherBtn").click();
  await until(() => docX26.querySelector(".sc-numrow")?.classList.contains("on"));
  const numrowBeforeX26 = docX26.querySelector(".sc-numrow");

  await domX26.window.load(); // the SAME path the 60s timer uses (setInterval(load, CONFIG.REFRESH_MS))

  const padOpenAfterX26 = !docX26.querySelector("#scSheet")?.hidden;
  const holeStillX26 = (docX26.querySelector("#scSheet .sc-sheet-head")?.textContent || "").includes("Hole 7");
  const numrowAfterX26 = docX26.querySelector(".sc-numrow");
  // Both layers: (1) the pad genuinely got torn down and rebuilt (a
  // DIFFERENT DOM node — proving this isn't just an untouched leftover),
  // (2) the open state re-hydrated from STATE (STATE.scPadOtherOpen), not
  // carried by an accident of DOM survival.
  const rebuiltX26 = !!numrowAfterX26 && numrowAfterX26 !== numrowBeforeX26;
  const otherSurvivedX26 = numrowAfterX26?.classList.contains("on") === true &&
    numrowAfterX26.querySelectorAll(".sc-key[data-score]").length > 0;
  domX26.window.close();

  const domX26b = makeDom("#score", withScEndpoint());
  const docX26b = domX26b.window.document;
  await until(() => docX26b.querySelectorAll("#scPicker .sc-pick").length > 0);
  const teamBtnX26b = [...docX26b.querySelectorAll("#scPicker .sc-pick")].find(b => /Duck/.test(b.textContent));
  teamBtnX26b.click(); // -> scShowConfirm(seasonY,"Duck"), no hash change, nothing persisted yet
  await until(() => !docX26b.querySelector("#scConfirm")?.hidden);
  const confirmTextBeforeX26b = docX26b.querySelector("#scConfirm")?.textContent || "";

  await domX26b.window.load(); // background repaint, BEFORE any Confirm tap

  const confirmStillUpX26b = !docX26b.querySelector("#scConfirm")?.hidden;
  const pickerStillHiddenX26b = docX26b.querySelector("#scPicker")?.hidden === true;
  const confirmTextAfterX26b = docX26b.querySelector("#scConfirm")?.textContent || "";
  const sameTeamNamedX26b = /Duck/.test(confirmTextAfterX26b);
  domX26b.window.close();

  check("X26: render boundary — a full load()/paint()/renderScorer() cycle (the 60s auto-refresh path) leaves pad(7) open on hole 7 with its in-progress 'Other' overflow row still open, surviving a genuine DOM rebuild (fresh node, STATE-backed via STATE.scPadOtherOpen — rev 3 mechanism); separately, a captain mid-decision on the identity confirm (reached via the picker, nothing persisted yet) is NOT bounced back to #scPicker by the same background cycle",
    padOpenAfterX26 && holeStillX26 && rebuiltX26 && otherSurvivedX26 &&
      confirmStillUpX26b && pickerStillHiddenX26b && sameTeamNamedX26b,
    "padOpen=" + padOpenAfterX26 + " holeStill=" + holeStillX26 + " rebuilt=" + rebuiltX26 +
      " otherSurvived=" + otherSurvivedX26 + " numrowAfterClass=" + numrowAfterX26?.className +
      " confirmTextBefore=" + confirmTextBeforeX26b.slice(0, 80) + " confirmTextAfter=" + confirmTextAfterX26b.slice(0, 80) +
      " confirmStillUp=" + confirmStillUpX26b + " pickerStillHidden=" + pickerStillHiddenX26b);
}

{
  // X27: SC-PUBBTN — the public "Enter scores" hero button (and its
  // CONFIG.SHEET_EDIT_URL wiring) are REMOVED, not just hidden. Checks the
  // rendered DOM (no #sheetBtn node, any dom), the raw index.html source
  // for no lingering "sheetBtn" identifier anywhere (markup or wiring code),
  // AND — independently, review round 1 — no literal "CONFIG.SHEET_EDIT_URL"
  // consumer reference in the source either: the brief's literal
  // consumer-wiring check, which also closes an id-rename blind spot the
  // bare /sheetBtn/ regex would miss (rename #sheetBtn to something else
  // while leaving a CONFIG.SHEET_EDIT_URL consumer wired to it, and the
  // first regex alone would go quiet).
  const noBtnInDom = !doc.querySelector("#sheetBtn");
  const noBtnInSource = !/sheetBtn/.test(html);
  const noConfigConsumerInSource = !/CONFIG\.SHEET_EDIT_URL/.test(html);
  check("X27: SC-PUBBTN — no #sheetBtn anywhere in the DOM, and the raw index.html source contains no 'sheetBtn' reference NOR any 'CONFIG.SHEET_EDIT_URL' consumer wiring at all (markup + wiring both fully removed, not hidden, not renamed)",
    noBtnInDom && noBtnInSource && noConfigConsumerInSource,
    "domHasBtn=" + !noBtnInDom + " sourceHasSheetBtn=" + !noBtnInSource + " sourceHasConfigConsumer=" + !noConfigConsumerInSource);
}

{
  // X28: SC-PUBBTN — config.js's SHEET_EDIT_URL VALUE is retired to "" (the
  // key itself stays, per the brief, in case other tooling reads it as
  // optional); the live sheet's document id that used to sit in that value
  // is nowhere left in the file; AND — review round 1 widening — config.js
  // contains no live Google Sheets EDIT url under ANY key at all (not just
  // the one old doc-id fragment), so a future re-add under a renamed key
  // (or a second key) can't slip past this check unnoticed.
  const configSrc = readFileSync(path.join(ROOT, "config.js"), "utf8");
  const valueCleared = /SHEET_EDIT_URL:\s*""/.test(configSrc);
  const noLiveId = !/16Co2b/.test(configSrc);
  const noLiveEditUrl = !/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit/.test(configSrc);
  check("X28: SC-PUBBTN — config.js's SHEET_EDIT_URL value is \"\" (key preserved), the live sheet's document id (16Co2b...) is nowhere in the file, and no live spreadsheet edit URL appears under any key",
    valueCleared && noLiveId && noLiveEditUrl,
    "valueCleared=" + valueCleared + " noLiveId=" + noLiveId + " noLiveEditUrl=" + noLiveEditUrl);
}

/* ---------------------------------------------------------------------
   X29-X31: sticky header — honest tallies, next-hint, always-reachable
   switch (spec §18 rev 3, SC-TALLY-HONEST/SC-NEXT-HINT/header — task 3).
   --------------------------------------------------------------------- */
{
  // X29: SC-TALLY-HONEST — Out/In/Total/To-par tiles all derive from ONE
  // per-hole scCellState() walk (scTallyHTML in index.html); a conflicted
  // hole counts toward NEITHER Out/In/Total nor the par sum behind To-par,
  // on EITHER its sheet number or its phone number. Real SC-DERIVE merge
  // active (no noSheet stub) — Duck's r2 sheet fixture (fixtures/scores.csv)
  // is fully populated, so every OTHER hole renders real "sheet" state.
  // Hole 9 (par 5, real sheet value 4) gets a planted journal entry scoring
  // 8 — written directly via scStore (the SAME low-level seeding technique
  // the C1/C1x journal tests already use), never through scJournalSave/the
  // UI, so no send is ever attempted and there's no scConfigBroken banner
  // risk. 8 is deliberately far from both the sheet's 4 AND hole 9's own
  // par (5) — an implementation that wrongly counts the conflict via EITHER
  // number would visibly wreck Out/Total/To-par/thru-N all at once, not
  // just coincidentally match one of them.
  const domX29 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX29 = await openScorer(domX29); // real derivation, not noSheet — Duck r1 is ALSO fully populated, so round 2 is the active round (X16b's own established reasoning)
  const seasonX29 = domX29.window.scorerSeason();
  const roundX29 = domX29.window.scActiveRound();
  const roundOkX29 = roundX29 === "2"; // sanity-check the precedent this test's fixture arithmetic depends on
  const keyX29 = "gfy-scorer:" + seasonX29 + ":duck"; // nkey("Duck") === "duck"
  const entryKeyX29 = domX29.window.scEntryKeyOf(roundX29, 9);
  domX29.window.scStore(keyX29, root => {
    root.seq = (root.seq || 0) + 1;
    root.entries[entryKeyX29] = { round: roundX29, hole: 9, score: 8, seq: root.seq,
      state: "queued", verdict: null, ts: Date.now(), retries: 0, override: false };
  });
  domX29.window.renderScCard();
  await until(() => docX29.querySelector('.sc-cell[data-hole="9"]')?.classList.contains("sc-conflict"));

  // Fixture arithmetic, computed HERE from the raw fixture files (never
  // trusted from the app under test) — fixtures/scores.csv's Duck r2 h1-h18
  // row and fixtures/course.csv's par column, hole 9 excluded (the planted
  // conflict):
  const R2 = [4, 4, 3, 5, 3, 4, 3, 4, 4, 4, 5, 4, 5, 4, 5, 3, 5, 5];   // hole 1..18
  const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 5, 3, 4, 4, 4, 3, 5, 4];  // hole 1..18
  let outSum = 0, inSum = 0, outPar = 0, inPar = 0, thruExpected = 0;
  for (let h = 1; h <= 18; h++) {
    if (h === 9) continue; // the planted conflict — absent from BOTH sides
    const score = R2[h - 1], par = PAR[h - 1];
    thruExpected++;
    if (h <= 9) { outSum += score; outPar += par; } else { inSum += score; inPar += par; }
  }
  const totalExpected = outSum + inSum;
  const relExpected = totalExpected - (outPar + inPar);
  const toParExpected = relExpected === 0 ? "E" : (relExpected > 0 ? "+" : "") + relExpected;

  const tallyElX29 = docX29.querySelector("#scTally");
  const tilesX29 = [...(tallyElX29?.querySelectorAll(".sc-tile") || [])];
  const tileV = i => tilesX29[i]?.querySelector(".sc-tile-v")?.textContent.trim();
  const outOkX29 = tileV(0) === String(outSum);
  const inOkX29 = tileV(1) === String(inSum);
  const totalOkX29 = tileV(2) === String(totalExpected);
  const toParOkX29 = tileV(3) === toParExpected;
  const parLabelX29 = tilesX29[3]?.querySelector(".sc-tile-k")?.textContent || "";
  const thruRegexOkX29 = /thru \d+/.test(parLabelX29);
  const thruExactOkX29 = new RegExp("thru " + thruExpected + "\\b").test(parLabelX29);
  const modeOkX29 = tallyElX29?.getAttribute("data-mode") === "topar";
  // Hole 9's own conflict cell must show BOTH numbers (SHEET·MINE) — proves
  // the exclusion is a TALLY-only rule, not the cell silently losing its own
  // conflict truth.
  const conflictCellScoreX29 = docX29.querySelector('.sc-cell[data-hole="9"] .sc-score')?.textContent;
  const cellShowsBothX29 = conflictCellScoreX29 === "4·8";

  domX29.window.close();

  // Structural, source-level check (stated honestly as such — the actual
  // sticky-range PROOF lives in a real-browser measurement harness outside
  // this suite, per fix-round-1's report: jsdom does no layout at all, so
  // it cannot observe whether position:sticky has any real travel room —
  // only that the declaration is textually present). Fix round 1 (review
  // CRITICAL): #scHeader had no CSS rule at all, so its box height equalled
  // its sticky child's own height (zero slack — the child unstuck almost
  // immediately and scrolled away with the page, measured directly:
  // getBoundingClientRect().top went from 52 to roughly -200 after a full
  // scroll). `#scHeader{display:contents}` removes it from the render tree
  // as a box, making .sc-top's containing block .wrap instead — spanning
  // the whole scrollable score view — confirmed fixed in the SAME harness
  // (top stayed exactly 52 across the full scroll range, banner present or
  // not). See task-3-report.md's fix-round-1 section for the harness
  // command + full before/after measurements.
  const scHeaderDisplayContentsX29 = /#scHeader\{[^}]*display:\s*contents/.test(html);

  check("X29: SC-TALLY-HONEST — Out/In/Total/To-par all computed from ONE scCellState() walk over Duck's real r2 fixture, with hole 9's planted sheet(4)/phone(8) conflict excluded from every tally number (fixture-derived expectations: Out=" + outSum + " In=" + inSum + " Total=" + totalExpected + " toPar=" + toParExpected + " thru=" + thruExpected + "); to-par tile label matches /thru \\d+/ AND the exact count; data-mode stays 'topar' (full course fixture); the conflicted cell itself still shows both numbers (4·8); STRUCTURAL (source-check only — real sticky-range proof is a real-browser harness, see task-3-report.md fix round 1): #scHeader{display:contents} is present in the source, so .sc-top's containing block is .wrap (spans the whole scrollable view) rather than a zero-slack #scHeader box",
    roundOkX29 && outOkX29 && inOkX29 && totalOkX29 && toParOkX29 && thruRegexOkX29 && thruExactOkX29 && modeOkX29 && cellShowsBothX29 &&
      scHeaderDisplayContentsX29,
    "roundOk=" + roundOkX29 + "(was " + roundX29 + ") out=" + tileV(0) + "(want " + outSum + ") in=" + tileV(1) + "(want " + inSum +
      ") total=" + tileV(2) + "(want " + totalExpected + ") toPar=" + tileV(3) + "(want " + toParExpected + ") parLabel=" +
      JSON.stringify(parLabelX29) + " mode=" + tallyElX29?.getAttribute("data-mode") + " conflictCellScore=" + conflictCellScoreX29 +
      " scHeaderDisplayContents=" + scHeaderDisplayContentsX29);
}

{
  // X30: SC-NEXT-HINT — .sc-next lands on exactly one cell: the FIRST hole
  // whose scCellState().kind==="empty" (scFirstEmptyHole(), index.html) —
  // never a queued/sheet/conflict/rejected cell, and never more than one at
  // once. Presentational only: no click-behavior assertion here (a
  // .sc-next cell gets the SAME plain scPadOpen(h) every other empty cell
  // already gets — nothing new to prove there).
  const domX30 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX30 = await openScorer(domX30, { noSheet: true }); // every hole starts "empty" — no real derivation, no journal entries yet
  const nextCellsFreshX30 = [...docX30.querySelectorAll(".sc-cell.sc-next")];
  const uniqueFreshX30 = nextCellsFreshX30.length === 1;
  const firstHoleFreshX30 = nextCellsFreshX30[0]?.dataset.hole === "1";

  // Fill holes 1-3 directly via scStore (same seeding technique as X29 — no
  // network, no scJournalSave) and force a repaint: .sc-next must move to 4.
  const seasonX30 = domX30.window.scorerSeason();
  const roundX30 = domX30.window.scActiveRound();
  const keyX30 = "gfy-scorer:" + seasonX30 + ":duck";
  [1, 2, 3].forEach(h => {
    const entryKey = domX30.window.scEntryKeyOf(roundX30, h);
    domX30.window.scStore(keyX30, root => {
      root.seq = (root.seq || 0) + 1;
      root.entries[entryKey] = { round: roundX30, hole: h, score: 4, seq: root.seq,
        state: "ok", verdict: "applied", ts: Date.now(), retries: 0, override: false };
    });
  });
  domX30.window.renderScCard();
  const nextCellsFilledX30 = [...docX30.querySelectorAll(".sc-cell.sc-next")];
  const uniqueFilledX30 = nextCellsFilledX30.length === 1;
  const movedToFourX30 = nextCellsFilledX30[0]?.dataset.hole === "4";
  const filledCellsNotNextX30 = [1, 2, 3].every(h =>
    !docX30.querySelector('.sc-cell[data-hole="' + h + '"]')?.classList.contains("sc-next"));

  domX30.window.close();

  // Structural, source-level check (stated honestly as such — this proves
  // the CSS SHAPE, not any runtime media-query evaluation, which jsdom
  // can't do anyway): the .sc-next BREATHE ANIMATION must live textually
  // inside a `@media (prefers-reduced-motion: no-preference)` block —
  // never unconditional, never gated only by a JS check (there is none
  // anywhere in the file — CSS-only, matching the prototype). Brace-counts
  // the block (a naive lazy regex would truncate at the nested @keyframes'
  // own first `}`) and confirms the ONE '.sc-next{...animation:...}' rule
  // in the WHOLE file is the one found inside it — so moving the animation
  // outside the media query, or deleting the gate entirely, fails this the
  // same way a missing gate would.
  const mqNeedle = "@media (prefers-reduced-motion: no-preference)";
  const mqIdx = html.indexOf(mqNeedle);
  let mqBlock = "";
  if (mqIdx >= 0) {
    const openIdx = html.indexOf("{", mqIdx);
    let depth = 0, i = openIdx;
    for (; i < html.length; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") { depth--; if (depth === 0) break; }
    }
    mqBlock = html.slice(openIdx, i + 1);
  }
  const animRe = /\.sc-next[^{}]*\{[^{}]*animation\s*:/;
  const wholeFileAnimCountX30 = (html.match(new RegExp(animRe.source, "g")) || []).length;
  const blockAnimCountX30 = (mqBlock.match(new RegExp(animRe.source, "g")) || []).length;
  const hasKeyframesInBlockX30 = /@keyframes/.test(mqBlock);
  const structuralOkX30 = mqIdx >= 0 && wholeFileAnimCountX30 === 1 && blockAnimCountX30 === 1 && hasKeyframesInBlockX30;

  check("X30: SC-NEXT-HINT — exactly one .sc-next cell, always the FIRST hole whose scCellState().kind==='empty' (hole 1 on a fresh board; moves to hole 4 once holes 1-3 are filled via direct journal writes, and 1-3 themselves never carry .sc-next); reduced-motion is CSS-only (structural check, stated honestly as such): the ONE '.sc-next{...animation:...}' rule in the whole file lives inside `@media (prefers-reduced-motion: no-preference)` alongside its @keyframes, found via brace-matching rather than a lazy-regex guess",
    uniqueFreshX30 && firstHoleFreshX30 && uniqueFilledX30 && movedToFourX30 && filledCellsNotNextX30 && structuralOkX30,
    "uniqueFresh=" + uniqueFreshX30 + " firstFresh=" + nextCellsFreshX30[0]?.dataset.hole +
      " uniqueFilled=" + uniqueFilledX30 + " movedTo=" + nextCellsFilledX30[0]?.dataset.hole +
      " filledCellsNotNext=" + filledCellsNotNextX30 +
      " mqFound=" + (mqIdx >= 0) + " wholeFileAnimCount=" + wholeFileAnimCountX30 + " blockAnimCount=" + blockAnimCountX30 +
      " hasKeyframesInBlock=" + hasKeyframesInBlockX30);
}

{
  // X31: #scSwitch — always-reachable now (unlike rev 2's confirm-only
  // #scNotYou link), wired to the SAME scShowPicker() the pre-confirm flow
  // already used. Any confirmed-state dom works, per the brief — Duck's
  // noSheet flow (openScorer's default confirm-then-cells wait) is the
  // simplest one already established in this suite; Duck is genuinely
  // {confirmed:true}-persisted by this point (openScorer's own confirm tap),
  // which is exactly the precondition the fix-round-1 bug needed (a
  // REMEMBERED/hash-matched team, not a fresh unconfirmed one).
  // Fix round 1 (review Important #2, extended — same X-number, no new
  // check()): #scSwitch used to (a) leave the previous team's #scCard/
  // #scGlance/#scSheetHost fully visible UNDERNEATH the picker, and (b) get
  // silently closed by the very next renderScorer() repaint (the 60s
  // paint() cycle, worst case, possibly mid-tap) — location.hash still
  // names Duck the whole time (#scSwitch never changes it), so the ONLY
  // guard renderScorer() honored (scConfirmPending) never even applied:
  // scConfirmedTeam()/hashTeam routing fired first and bounced straight
  // back to scShowCard(). Both are asserted directly below, then the normal
  // pick-a-team flow is proven to still resume correctly afterward, and the
  // guard is proven not to strand the app once a team IS picked.
  const domX31 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docX31 = await openScorer(domX31, { noSheet: true });
  const pickerHiddenBeforeX31 = docX31.querySelector("#scPicker")?.hidden !== false;
  const switchBtnX31 = docX31.querySelector("#scSwitch");
  const switchIsButtonX31 = switchBtnX31?.tagName === "BUTTON"; // never an <a> — see X21b's #scHeader-a note in index.html
  switchBtnX31?.click();
  const pickerVisibleX31 = docX31.querySelector("#scPicker")?.hidden === false;
  const teamBtnsX31 = [...docX31.querySelectorAll("#scPicker .sc-pick")];
  const hasTeamBtnsX31 = teamBtnsX31.length > 0;
  const hasDuckBtnX31 = teamBtnsX31.some(b => /Duck/.test(b.textContent || ""));

  // (a) the previous team's card/rank-panel must not be visible underneath.
  const cardHiddenAfterSwitchX31 = docX31.querySelector("#scCard")?.hidden === true;
  const cardEmptyAfterSwitchX31 = (docX31.querySelector("#scCard")?.innerHTML || "").trim() === "";
  const glanceEmptyAfterSwitchX31 = (docX31.querySelector("#scGlance")?.innerHTML || "").trim() === "";

  // (b) repaint survival — the EXACT failure mode: force the same
  // renderScorer() call the 60s paint() cycle (and every hashchange) makes,
  // with location.hash STILL naming the already-confirmed Duck the whole
  // time. Pre-fix this silently closed the picker and re-showed Duck's card.
  domX31.window.renderScorer();
  const pickerSurvivesRepaintX31 = docX31.querySelector("#scPicker")?.hidden === false;
  const teamBtnsSurviveRepaintX31 = docX31.querySelectorAll("#scPicker .sc-pick").length > 0;
  const cardStillHiddenAfterRepaintX31 = docX31.querySelector("#scCard")?.hidden === true;

  // Fix wave item 1 (picker guard bypass, cross-task lifecycle gap — same
  // X-number, no new check() per the instruction): renderScorer()'s own
  // scPickerOpen check only guards ROUTING — but scDrain (the 20s poll,
  // still running the whole time the picker is open, since the picker is
  // part of the SAME #score view) calls renderScCard() DIRECTLY on every
  // entry state flip, a path renderScorer()'s guard never sees at all.
  // Simulate that EXACT drain-driven repaint: picker still open, hash still
  // naming the already-confirmed team, call renderScCard() directly (not
  // renderScorer()) and assert the picker survives with no header/glance
  // chrome resurrecting underneath/around it.
  domX31.window.renderScCard();
  const pickerSurvivesDrainRepaintX31 = docX31.querySelector("#scPicker")?.hidden === false;
  const teamBtnsSurviveDrainRepaintX31 = docX31.querySelectorAll("#scPicker .sc-pick").length > 0;
  const cardStillHiddenAfterDrainRepaintX31 = docX31.querySelector("#scCard")?.hidden === true;
  const cardStillEmptyAfterDrainRepaintX31 = (docX31.querySelector("#scCard")?.innerHTML || "").trim() === "";
  const headerStillEmptyAfterDrainRepaintX31 = (docX31.querySelector("#scHeader")?.innerHTML || "").trim() === "";
  const glanceStillEmptyAfterDrainRepaintX31 = (docX31.querySelector("#scGlance")?.innerHTML || "").trim() === "";

  // Complete a team pick — the normal flow must still fully resume:
  // picker -> confirm -> card, exactly like the pre-confirm path.
  [...docX31.querySelectorAll("#scPicker .sc-pick")].find(b => /Duck/.test(b.textContent || "")).click();
  const confirmVisibleAfterPickX31 = docX31.querySelector("#scConfirm")?.hidden === false;
  docX31.querySelector("#scConfirmBtn")?.click();
  const cardVisibleAfterConfirmX31 = docX31.querySelector("#scCard")?.hidden !== true &&
    docX31.querySelectorAll("#scCard .sc-cell").length > 0;
  const pickerHiddenAfterConfirmX31 = docX31.querySelector("#scPicker")?.hidden === true;

  // Guard must not strand the app: one more forced repaint, now that a team
  // IS confirmed and the picker is closed again, must NOT re-show the
  // picker (STATE.scPickerOpen was cleared in scShowConfirm/scShowCard).
  domX31.window.renderScorer();
  const stillOnCardAfterFinalRepaintX31 = docX31.querySelector("#scCard")?.hidden !== true &&
    docX31.querySelector("#scPicker")?.hidden === true;

  domX31.window.close();
  check("X31: #scSwitch — a <button> (never an <a>), click opens #scPicker (visible, hidden=false) with real team buttons (.sc-pick, including Duck), wired to the existing scShowPicker() — no new picker logic; the previous team's #scCard/#scGlance are hidden+cleared underneath (not layered under the picker); a forced renderScorer() (the exact 60s-paint()/hashchange repaint failure mode, with location.hash STILL naming the already-confirmed team) does NOT silently close the picker or re-show the old card; a DIRECT renderScCard() call (the exact scDrain repaint path, which bypasses renderScorer()'s routing guard entirely) ALSO does not close the picker, re-show the old card, or resurrect the old team's #scHeader/#scGlance chrome around it (fix wave item 1); completing a team pick still resumes the normal picker->confirm->card flow, and a further forced repaint afterward stays on the card (guard doesn't strand the app once a team is confirmed)",
    pickerHiddenBeforeX31 && switchIsButtonX31 && pickerVisibleX31 && hasTeamBtnsX31 && hasDuckBtnX31 &&
      cardHiddenAfterSwitchX31 && cardEmptyAfterSwitchX31 && glanceEmptyAfterSwitchX31 &&
      pickerSurvivesRepaintX31 && teamBtnsSurviveRepaintX31 && cardStillHiddenAfterRepaintX31 &&
      pickerSurvivesDrainRepaintX31 && teamBtnsSurviveDrainRepaintX31 && cardStillHiddenAfterDrainRepaintX31 &&
      cardStillEmptyAfterDrainRepaintX31 && headerStillEmptyAfterDrainRepaintX31 && glanceStillEmptyAfterDrainRepaintX31 &&
      confirmVisibleAfterPickX31 && cardVisibleAfterConfirmX31 && pickerHiddenAfterConfirmX31 &&
      stillOnCardAfterFinalRepaintX31,
    "hiddenBefore=" + pickerHiddenBeforeX31 + " isButton=" + switchIsButtonX31 + " visibleAfter=" + pickerVisibleX31 +
      " teamBtnCount=" + teamBtnsX31.length + " hasDuck=" + hasDuckBtnX31 +
      " cardHiddenAfterSwitch=" + cardHiddenAfterSwitchX31 + " cardEmptyAfterSwitch=" + cardEmptyAfterSwitchX31 +
      " glanceEmptyAfterSwitch=" + glanceEmptyAfterSwitchX31 +
      " pickerSurvivesRepaint=" + pickerSurvivesRepaintX31 + " teamBtnsSurviveRepaint=" + teamBtnsSurviveRepaintX31 +
      " cardStillHiddenAfterRepaint=" + cardStillHiddenAfterRepaintX31 +
      " pickerSurvivesDrainRepaint=" + pickerSurvivesDrainRepaintX31 + " teamBtnsSurviveDrainRepaint=" + teamBtnsSurviveDrainRepaintX31 +
      " cardStillHiddenAfterDrainRepaint=" + cardStillHiddenAfterDrainRepaintX31 +
      " cardStillEmptyAfterDrainRepaint=" + cardStillEmptyAfterDrainRepaintX31 +
      " headerStillEmptyAfterDrainRepaint=" + headerStillEmptyAfterDrainRepaintX31 +
      " glanceStillEmptyAfterDrainRepaint=" + glanceStillEmptyAfterDrainRepaintX31 +
      " confirmVisibleAfterPick=" + confirmVisibleAfterPickX31 + " cardVisibleAfterConfirm=" + cardVisibleAfterConfirmX31 +
      " pickerHiddenAfterConfirm=" + pickerHiddenAfterConfirmX31 +
      " stillOnCardAfterFinalRepaint=" + stillOnCardAfterFinalRepaintX31);
}

{
  // X32 (rev 3, SC-BOARD-BTN): #boardScoreBtn on the Leaderboard is gated
  // STRICTLY on the persisted scorer identity — scConfirmedTeam()'s own
  // localStorage read (the SAME scKey/{confirmed:true} shape scShowConfirm's
  // real confirm-tap click handler already writes; read-only here, no new
  // storage path). A fresh dom with no such key must render nothing at all.
  const domX32 = makeDom("#board", withScEndpoint());
  const docX32 = domX32.window.document;
  await until(() => docX32.querySelectorAll("#lbBody .lb-row").length > 0);
  const noBtnBeforeX32 = !docX32.querySelector("#boardScoreBtn");
  const yearsPresentBeforeX32 = !!docX32.querySelector("#years"); // sanity: the row it's meant to sit beside is actually there

  // Plant the SAME {confirmed:true} shape scShowConfirm's real write
  // produces, hand-constructed exactly like journalKeyX20/entryKeyX20 above
  // (scKey/nkey are `const`-bound, never window properties — scorerSeason()
  // IS a plain top-level `function`, so it's used for the season half; team
  // key literal "duck" is nkey("Duck"), established elsewhere in this file).
  const seasonX32 = domX32.window.scorerSeason();
  domX32.window.localStorage.setItem("gfy-scorer:" + seasonX32 + ":duck", JSON.stringify({ confirmed: true }));
  domX32.window.renderAll(); // the SAME function periodic reload already calls — no new render path
  await until(() => !!docX32.querySelector("#boardScoreBtn"));
  const btnX32 = docX32.querySelector("#boardScoreBtn");
  const btnTextOkX32 = /Enter scores/.test(btnX32?.textContent || "") && /Duck/.test(btnX32?.textContent || "");
  const btnHrefOkX32 = btnX32?.getAttribute("href") === "#score";
  const btnBesideYearsX32 = btnX32?.closest(".sc-board-row")?.contains(docX32.querySelector("#years")) === true;

  btnX32.click();
  await until(() => docX32.querySelector('.view[data-view="score"]')?.hidden === false);
  const scoreViewShownX32 = docX32.querySelector('.view[data-view="score"]')?.hidden === false &&
    docX32.querySelector('.view[data-view="board"]')?.hidden === true;
  domX32.window.close();

  check("X32: SC-BOARD-BTN — #boardScoreBtn is absent on a fresh #board load with no persisted scorer identity; planting the SAME {confirmed:true} localStorage key scShowConfirm's real confirm-tap writes makes it appear beside the year picker (#years) reading 'Enter scores — Team Duck', href=\"#score\"; clicking it shows the score view (and hides the board)",
    noBtnBeforeX32 && yearsPresentBeforeX32 && btnTextOkX32 && btnHrefOkX32 && btnBesideYearsX32 && scoreViewShownX32,
    "noBtnBefore=" + noBtnBeforeX32 + " yearsPresentBefore=" + yearsPresentBeforeX32 +
      " btnText=" + (btnX32?.textContent || "") + " btnHref=" + btnX32?.getAttribute("href") +
      " btnBesideYears=" + btnBesideYearsX32 + " scoreViewShown=" + scoreViewShownX32);
}

/* ---------------------------------------------------------------------
   X33-X35: SC-PAR-VALID value-validated course maps + SC-PAR-WARN hole-
   naming health flag (spec §20 D3 par-integrity — task 1). A Course-tab
   row with a BLANK par cell (row present, e.g. "7,,160") used to create a
   par[7]=0 key — courseMap() still read as non-null (18 keys present) and
   the to-par arithmetic silently counted every stroke against a par of
   zero. The fix keys pars ONLY for parseInt(...)>0 values, so a blank/
   invalid cell drops out of the map entirely (courseMap() correctly goes
   null, same all-18-or-null contract a genuinely missing row already
   triggered — X9/X10) — and flags a per-hole health warning naming which
   hole is bad, deduped via flag()'s own HEALTH.includes() check.
   --------------------------------------------------------------------- */
{
  // X33: SC-PAR-VALID scorer degrade — a BLANK par cell (row present)
  // suppresses to-par exactly like a missing row, warns by hole, and
  // leaves the other 17 holes' labels alive (scHolePar row-fallback).
  // Course fixture variant computed from the real fixture: hole 7's row
  // stays present (yards intact) with its par cell blanked — mirrors the
  // D3 report's own hole 7 example.
  const courseBlank7X33 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  // Same withScEndpoint+course-override idiom X9 uses (test/smoke.mjs:2435)
  // to reach the confirmed-team card — X29's own confirm+card setup, one
  // course-fixture override added.
  const overrideX33 = withScEndpoint({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X33 }),
  });
  const domX33 = makeDom("#score?team=" + encodeURIComponent("Duck"), overrideX33);
  const docX33 = await openScorer(domX33, { noSheet: true });
  const tallyX33 = docX33.querySelector("#scTally");
  const modeStrokesX33 = tallyX33 && tallyX33.getAttribute("data-mode") === "strokes";
  const cell7X33 = docX33.querySelector('.sc-cell[data-hole="7"] .sc-hole-par');
  const cell8X33 = docX33.querySelector('.sc-cell[data-hole="8"] .sc-hole-par');
  const cell7DashX33 = cell7X33 && /Par —/.test(cell7X33.textContent);
  const cell8RealX33 = cell8X33 && /Par \d/.test(cell8X33.textContent);
  const stripX33 = docX33.querySelector("#healthStrip");
  // §22 SC-PAR-FLAG-2 (copy re-pin, supersedes the §20 flag line): the
  // health flag's text widens to name standings, not just to-par, as
  // suppressed — byte-exact assert, meaning preserved from the prior pin.
  const warnedX33 = stripX33 && !stripX33.hidden &&
    /Course tab: hole 7 par missing or invalid — To-par and standings suppressed \(strokes only\)/.test(stripX33.textContent);
  domX33.window.close();
  check("X33: SC-PAR-VALID — blank par cell (hole 7 row present, par empty) => tally data-mode=strokes (not topar w/ silent 0), hole-7 cell 'Par —', hole-8 still labeled, healthStrip names hole 7 with the pinned copy (§22 SC-PAR-FLAG-2 re-pin)",
    modeStrokesX33 && cell7DashX33 && cell8RealX33 && warnedX33,
    `mode=${tallyX33 && tallyX33.getAttribute("data-mode")} cell7=${cell7X33 && cell7X33.textContent} cell8=${cell8X33 && cell8X33.textContent} warned=${warnedX33}`);
}

{
  // X34: SC-PAR-VALID board suppression, BOTH directions — complete
  // fixture shows to-par; blank-par fixture shows gross totals (rel=null),
  // never a skewed to-par.
  //
  // Grounding note (delegated by the brief): #lbBody's leaderboard row
  // renders TWO ".lb-tot" spans — <span class="lb-tot lb-total"> (raw
  // strokes, always digits) THEN <span class="lb-tot"> (to-par, or the
  // gross-total fallback when rel is null) — index.html renderLeaderboard.
  // A bare ".lb-tot" selector matches BOTH (classList still contains
  // "lb-tot" on the first span) and document order returns the FIRST one,
  // i.e. the wrong (always-digits) span — confirmed empirically and via
  // this file's own established idiom for the same two spans (line ~152:
  // `total: r.querySelectorAll(".lb-tot")[0]`, `toPar: [...][1]`). Using
  // index [1] (the established idiom) targets the real to-par/fallback
  // column this check actually cares about.
  const domOKX34 = makeDom("");
  await until(() => domOKX34.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const rowOKX34 = domOKX34.window.document.querySelector("#lbBody .lb-row");
  const totOK = rowOKX34 && rowOKX34.querySelectorAll(".lb-tot")[1];
  const toParForm = totOK && /^[+−\-]?\d+$|^E$/.test(totOK.textContent.trim()) && /^[+−\-E]/.test(totOK.textContent.trim());
  domOKX34.window.close();

  const courseBlank7X34 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  const overrideX34 = withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X34 }),
  });
  const domB = makeDom("", overrideX34);
  await until(() => domB.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docB = domB.window.document;
  const rowB = docB.querySelector("#lbBody .lb-row");
  // expected: plain gross total (digits only), equal to the leader's computed gross from the scores fixture
  const totB = rowB && rowB.querySelectorAll(".lb-tot")[1];
  const grossOnly = totB && /^\d+$/.test(totB.textContent.trim());

  // compute the leader's expected gross IN-TEST from FIXTURES.scores (sum that
  // team's round strokes) — never hardcode. Suppressing rel flips the sort key
  // from to-par to raw total (rankedPlayers: key = p.rel!==null ? p.rel : p.total),
  // so a DIFFERENT team can end up on top than in the complete-course fixture —
  // read whichever team is actually first via #lbBody's own data-player, then
  // mirror buildPlayers' round merge (index.html:1504-1560) by hand from the raw
  // fixture text: hole-by-hole rows sum posInt-valid holes per round (later row's
  // value wins on a repeated hole, same as ex.holes[h]=holes[h]); totals-only rows
  // (no hole values at all) use r1/r2 as that round's total; a scores row with a
  // blank year cell defaults to the active season, mirroring normalizeYears'
  // "row with blank year defaulted to <activeSeason()> (scores)" fill (Moose's
  // second round row exercises exactly this in the standard fixture).
  const seasonX34 = domB.window.activeSeason(); // plain top-level function — same window-call idiom X29/X32 already use
  const leaderKeyX34 = rowB && rowB.dataset.player;
  const HOLES18X34 = Array.from({ length: 18 }, (_, i) => i + 1);
  const posIntX34 = v => { const n = parseInt(v, 10); return (isNaN(n) || n <= 0) ? null : n; };
  const roundNormX34 = v => {
    const d = String(v || "").replace(/[^0-9]/g, "");
    if (d) return d;
    const w = String(v || "").trim().toLowerCase().split(/\s+/).pop();
    return ({ one: "1", two: "2", three: "3" })[w] || "1";
  };
  function teamGrossFromFixturesX34(teamKey, year) {
    const lines = FIXTURES.scores.trim().split("\n");
    // fixtures/scores.csv uses CRLF line endings — split("\n") leaves a
    // trailing \r on each line's LAST field. Row cell VALUES are already
    // .trim()'d below, but the header array itself wasn't, so the final
    // header column parsed as the literal key "r2\r" instead of "r2" —
    // silently orphaning every totals-only row's r2 value under a key
    // nothing ever reads (found via X34's new leader-selection assert,
    // which is the first check in this suite to depend on a totals-only
    // team's r2 field — Bear — through this mirror). .trim() strips \r.
    const header = lines[0].split(",").map(h => h.trim());
    const rows = lines.slice(1).map(l => {
      const cells = l.split(",");
      const o = {}; header.forEach((h, i) => o[h] = (cells[i] || "").trim());
      return o;
    });
    const rounds = {};
    rows
      .filter(r => r.team)
      .filter(r => r.team.trim().replace(/\s+/g, " ").toLowerCase() === teamKey)
      .filter(r => (r.year && r.year.trim() ? r.year.trim() : year) === year)
      .forEach(r => {
        const rd = roundNormX34(r.round);
        const holes = {}; let any = false;
        HOLES18X34.forEach(h => { const v = posIntX34(r["h" + h]); if (v !== null) { holes[h] = v; any = true; } });
        if (any) {
          if (!rounds[rd] || !rounds[rd].holes) rounds[rd] = { holes: {} };
          Object.assign(rounds[rd].holes, holes);
        } else {
          const r1 = posIntX34(r.r1), r2 = posIntX34(r.r2);
          if (r1 !== null && !(rounds["1"] && rounds["1"].holes)) rounds["1"] = { total: r1 };
          if (r2 !== null && !(rounds["2"] && rounds["2"].holes)) rounds["2"] = { total: r2 };
        }
      });
    return Object.values(rounds).reduce((s, r) => s + (r.holes ? Object.values(r.holes).reduce((a, b) => a + b, 0) : r.total), 0);
  }
  const expectedGross = leaderKeyX34 ? teamGrossFromFixturesX34(leaderKeyX34, seasonX34) : null;
  const grossMatches = totB && expectedGross != null && parseInt(totB.textContent.trim(), 10) === expectedGross;

  // §20 amendment (Task-1 review escalation) — leader-selection assert: the
  // FIRST rendered row must be the field's true MINIMUM raw gross under
  // suppression, not merely "whichever team happens to render first"
  // coincidentally showing a correct-looking own total (grossMatches above
  // alone can't catch a broken sort that always puts the WRONG team first —
  // it would still display that team's own accurate total). Independently
  // compute EVERY rendered team's gross via the SAME in-test fixture mirror
  // (never trust the app's own displayed numbers as the ground truth for
  // this comparison) and assert row 0 is the argmin. Candidate teams are
  // read from #lbBody's own rendered rows (not every row in FIXTURES.scores
  // directly) so an unrostered team buildPlayers already excludes (e.g.
  // "Hamer" — flagged "unknown team ... not counted", never gets a row) is
  // correctly out of contention here too, exactly as it is on the real board.
  const allRowsX34 = [...docB.querySelectorAll("#lbBody .lb-row")];
  const grossesX34 = allRowsX34.map(r => ({ key: r.dataset.player, gross: teamGrossFromFixturesX34(r.dataset.player, seasonX34) }));
  const trueMinX34 = grossesX34.length ? Math.min(...grossesX34.map(g => g.gross)) : null;
  const leaderIsMinX34 = grossesX34.length > 0 && trueMinX34 != null && grossesX34[0].gross === trueMinX34;
  domB.window.close();

  check("X34: SC-PAR-VALID — leaderboard To-par column: complete course => to-par form (+N/−N/E); blank-par-7 course => plain gross total equal to the leader's fixture-computed strokes (rel suppressed; ranking falls back to raw gross), and the FIRST row is verified to be the field's true minimum-gross team (leader-selection assert, §20 amendment)",
    toParForm && grossOnly && grossMatches && leaderIsMinX34,
    `ok=${totOK && totOK.textContent} blank=${totB && totB.textContent} leader=${leaderKeyX34} expected=${expectedGross} allGross=${JSON.stringify(grossesX34)} trueMin=${trueMinX34}`);
}

{
  // X35: SC-PAR-VALID grid degrade — blank par hides the hole-by-hole grid
  // behind the existing honest note (no 'Par 0' artifact can render).
  //
  // Grounding note (delegated by the brief): renderScoreGrid's note element
  // (index.html:1722/1735-1738) is `note=$("#sgNote")`, set via
  // `note.textContent="Hole-by-hole view needs all 18 holes on the Course
  // tab."; note.hidden=false; scroll.hidden=true;` when courseMap() is
  // null — the same degrade K6 (test/smoke.mjs, "G-HIDE") already exercises
  // for a short/partial course fixture; this block is that established
  // setup, applied to the blank-par-7 (row present) variant instead.
  const courseBlank7X35 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  const domX35 = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X35 }),
  }));
  await until(() => domX35.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docX35 = domX35.window.document;
  const note = docX35.querySelector("#sgNote");
  const noteShown = note && !note.hidden && /needs all 18 holes/i.test(note.textContent);
  const scrollHiddenX35 = docX35.querySelector("#sgScroll")?.hidden === true;
  // Fix round 1, §25a FIX1: renderScoreGrid's !pars early return used to
  // leave #sgLegend visible underneath this exact note (the legend has no
  // meaning when there's no grid to key it to). Mirrors how note/scroll are
  // already asserted here — same real fixture, same render pass.
  const legendHiddenX35 = docX35.querySelector("#sgLegend")?.hidden === true;
  domX35.window.close();
  check("X35: SC-PAR-VALID — blank par cell hides the score grid behind the 'needs all 18 holes' note (same degrade as a missing row; no Par-0 header row can render); the legend hides with it (fix round 1, FIX1 — a legend with nothing to key it to must not linger)",
    !!noteShown && scrollHiddenX35 && legendHiddenX35,
    `note=${note && note.textContent} hidden=${note && note.hidden} scrollHidden=${scrollHiddenX35} legendHidden=${legendHiddenX35}`);
}

/* ---------------------------------------------------------------------
   X36 (§20 amendment, Task-1 review escalation I1): per-hole yards
   fallback in the grid/panel. Value-validating courseYards() means ONE
   blank/invalid yards cell nulls the WHOLE map (all-18-or-null, correct
   and unchanged) — but renderScoreGrid's Yds row and renderHolePanel's
   yardage suffix used to read the map directly (`yds&&yds[h]`, `yds?...`),
   so that single bad cell blanked all 18 real yardages, not just the bad
   hole's. The fix reuses the EXISTING per-hole scHoleYards(h) fallback
   (index.html:3318-3323, byte-frozen, same one the scorer card already
   uses) at those two call sites: the other 17 true yardages survive, only
   the bad hole shows "—"/no suffix, and courseMap() (pars) is untouched —
   a blank YARDS cell alone must not hide the grid at all (par map stays
   fully valid, so no "needs all 18 holes" note fires here — a different
   degrade axis than X33/X35's blank-PAR splice).
   --------------------------------------------------------------------- */
{
  // Splice: hole 7's PAR cell stays intact, its YARDS cell is blanked
  // ("7,<par>,") — computed from the real fixture, never hand-typed.
  const courseBlankYds7X36 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7," + l.split(",")[1] + "," : l)
    .join("\n");

  // Grid + Yds row.
  const domX36 = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlankYds7X36 }),
  }));
  await until(() => domX36.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docX36 = domX36.window.document;
  // Par map is fully valid (only yards blanked) — the grid itself must
  // render, not fall behind the "needs all 18 holes" note.
  const noteHiddenX36 = docX36.querySelector("#sgNote")?.hidden === true;
  const scrollShownX36 = docX36.querySelector("#sgScroll")?.hidden === false;
  const table = docX36.querySelector("#sgTable");
  const ydsRow = table && table.querySelector("tr.sg-yds");
  const ydsCells = ydsRow ? [...ydsRow.querySelectorAll("td[data-hole]")] : [];
  const cellForX36 = h => ydsCells.find(c => c.dataset.hole === String(h));
  const cell7YdsX36 = cellForX36(7);
  const hole7DashX36 = cell7YdsX36 && cell7YdsX36.textContent.trim() === "—";
  // At least a few OTHER real yardages, computed from the untouched fixture
  // text (never hardcoded) — proves the fallback reads real per-hole data,
  // not just "blank everywhere except hole 7".
  const trueYdsX36 = h => parseInt(FIXTURES.course.split("\n").find(l => l.startsWith(h + ",")).split(",")[2], 10);
  const otherHolesX36 = [1, 2, 8, 18].map(h => ({ h, cell: cellForX36(h), expect: trueYdsX36(h) }));
  const othersRealX36 = otherHolesX36.every(o => o.cell && parseInt(o.cell.textContent.trim(), 10) === o.expect);
  domX36.window.close();

  // Scorer card: hole-7 cell has NO .sc-hole-yds span; hole-8 (untouched) keeps one.
  const overrideX36sc = withScEndpoint({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlankYds7X36 }),
  });
  const domX36sc = makeDom("#score?team=" + encodeURIComponent("Duck"), overrideX36sc);
  const docX36sc = await openScorer(domX36sc, { noSheet: true });
  const cardCell7X36 = docX36sc.querySelector('.sc-cell[data-hole="7"]');
  const cardCell8X36 = docX36sc.querySelector('.sc-cell[data-hole="8"]');
  const cell7NoYdsX36 = cardCell7X36 && !cardCell7X36.querySelector(".sc-hole-yds");
  const cell8HasYdsX36 = cardCell8X36 && !!cardCell8X36.querySelector(".sc-hole-yds");
  domX36sc.window.close();

  check("X36: §20 amendment — blank-yards cell (hole 7 par intact, yards blank): grid renders (par map fully valid, no note), Yds row keeps the OTHER holes' true fixture yardages with '—' on hole 7 only (per-hole scHoleYards fallback, not a whole-map null-out); scorer card hole-7 cell has no .sc-hole-yds span while hole 8 keeps one",
    noteHiddenX36 && scrollShownX36 && !!hole7DashX36 && othersRealX36 && !!cell7NoYdsX36 && !!cell8HasYdsX36,
    `noteHidden=${noteHiddenX36} scrollShown=${scrollShownX36} hole7=${cell7YdsX36 && cell7YdsX36.textContent} others=${JSON.stringify(otherHolesX36.map(o => o.cell && o.cell.textContent))} cell7HasYds=${cardCell7X36 && !!cardCell7X36.querySelector(".sc-hole-yds")} cell8HasYds=${cardCell8X36 && !!cardCell8X36.querySelector(".sc-hole-yds")}`);
}

/* ---------------------------------------------------------------------
   X37-X38 (§20 amendment 2, Task-2 S11 escalation): suppression must be
   honest at EVERY surface, not just the tally tile. SC-PAR-LABEL: no gross
   total may render under a "To par" label. SC-PAR-GLANCE: rank claims
   ("You're leading", "3rd of N reporting") are suppressed when courseMap()
   is null — the raw-gross fallback ordering compares unequal hole counts
   and can't back a rank claim; neutral facts (thru N, pending-on-phone)
   survive. renderLeaderboard/scGlanceHTML (+ their markup/CSS) are
   UNFROZEN for exactly these changes; courseMap/courseYards/rankedPlayers/
   buildPlayers/scTallyHTML stay frozen and untouched.
   --------------------------------------------------------------------- */
{
  // X37: SC-PAR-LABEL — board label honesty, both directions + both widths
  // (structural). jsdom does no layout/media-query evaluation, so the only
  // honest way to assert "hidden at width W" is to confirm the CSS rule
  // that would do it is actually present in the page's own <style> source
  // — same technique K5/X29 already established for this file's sticky/
  // scroll CSS checks (named structural, per the brief's instruction).
  const domOKX37 = makeDom("");
  await until(() => domOKX37.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docOKX37 = domOKX37.window.document;
  const headOKX37 = docOKX37.querySelector("#lbToParHead")?.textContent.trim();
  const boardOKX37 = docOKX37.querySelector("#leaderboard");
  const notSuppressedX37 = boardOKX37 && !boardOKX37.classList.contains("lb-suppressed");
  const rowOKX37 = docOKX37.querySelector("#lbBody .lb-row");
  const toParCellOKX37 = rowOKX37 && rowOKX37.querySelectorAll(".lb-tot")[1];
  const toParFormOKX37 = toParCellOKX37 && /^[+−\-]?\d+$|^E$/.test(toParCellOKX37.textContent.trim()) && /^[+−\-E]/.test(toParCellOKX37.textContent.trim());
  domOKX37.window.close();

  const courseBlank7X37 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  const domBX37 = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X37 }),
  }));
  await until(() => domBX37.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docBX37 = domBX37.window.document;
  const headBX37 = docBX37.querySelector("#lbToParHead")?.textContent.trim();
  const boardBX37 = docBX37.querySelector("#leaderboard");
  const suppressedX37 = boardBX37 && boardBX37.classList.contains("lb-suppressed");
  const rowBX37 = docBX37.querySelector("#lbBody .lb-row");
  const totalCellBX37 = rowBX37 && rowBX37.querySelectorAll(".lb-tot")[0];
  const toParCellBX37 = rowBX37 && rowBX37.querySelectorAll(".lb-tot")[1];
  // Never two differently-valued columns under one name: whatever the two
  // spans hold, they must be IDENTICAL when suppressed (both honestly the
  // same gross total) — and both plain digits (never a stray to-par sign).
  const sameValueX37 = totalCellBX37 && toParCellBX37 &&
    totalCellBX37.textContent.trim() === toParCellBX37.textContent.trim() &&
    /^\d+$/.test(toParCellBX37.textContent.trim());
  // STRUCTURAL: the new wide-width collapse rule is present in source.
  // Fix round 1 (§25a B-HOME Imp-1): the Board's #leaderboard.lb-suppressed
  // .lb-total rule must carry Home's .home-board.lb-suppressed .lb-total
  // as a SECOND selector on the very same declaration (never a duplicate
  // rule elsewhere) — that's what keeps the two surfaces from drifting
  // apart again. The regex now requires both selectors on one rule.
  const cssTextX37 = [...docBX37.querySelectorAll("style")].map(s => s.textContent).join("");
  const wideRuleStructuralX37 =
    /#leaderboard\.lb-suppressed\s*\.lb-total\s*,\s*\.home-board\.lb-suppressed\s*\.lb-total\s*\{\s*display:\s*none/.test(cssTextX37);
  // STRUCTURAL: the pre-existing ≤560px rule that already hides the SAME
  // redundant column unconditionally is still present, untouched — the
  // narrow-width half of "both widths".
  const narrowRuleStructuralX37 = /@media \(max-width:560px\)/.test(cssTextX37) &&
    /\.lb-r1,\.lb-r2,\.lb-total\{display:none\}/.test(cssTextX37);
  // STRUCTURAL (whole-branch review Imp-1 fix): hiding the Total column out
  // of the explicit 8-track grid (§25a Task 4 added the mv column as track 2)
  // without redefining the template leaves a dead 8th track — the surviving
  // 7 columns (pos, mv, name, thru, r1, r2, to-par-or-fallback) must get
  // their own template, and it MUST be scoped to widths ABOVE the ≤560px
  // breakpoint (an unscoped id-selector rule would out-specify — id beats
  // class — the ≤560px 4-track rule above and regress phones, since
  // .lb-suppressed is a viewport-independent state class). Sliced from the
  // media query's own start (same index-based technique K5 already
  // established for this file's CSS-source checks) so the assert is scoped
  // to THIS rule, not just "these tokens appear somewhere in the file"; the
  // closing `\s*[};]` after the 7th value guards against a regression that
  // leaves a stray 8th track back in (must be EXACTLY 7 tracks, not
  // 7-then-more).
  // Fix round 1 (§25a B-HOME Imp-1): .home-board.lb-suppressed .lb-row must
  // join this SAME min-width:561px-scoped rule (third selector, after the
  // pre-existing two) — a separate/unscoped .home-board-only rule would
  // reopen exactly the id-beats-class narrow-width regression the comment
  // above this block warns about.
  const mqStartX37 = cssTextX37.indexOf("@media (min-width:561px)");
  const mqSliceX37 = mqStartX37 >= 0 ? cssTextX37.slice(mqStartX37, mqStartX37 + 300) : "";
  const gridTemplateRuleStructuralX37 =
    /#leaderboard\.lb-suppressed\s*\.lb-head\s*,\s*#leaderboard\.lb-suppressed\s*\.lb-row\s*,\s*\.home-board\.lb-suppressed\s*\.lb-row\s*\{/.test(mqSliceX37) &&
    /grid-template-columns:\s*2\.4rem\s+2\.2rem\s+1fr\s+4rem\s+3\.2rem\s+3\.2rem\s+4rem\s*[};]/.test(mqSliceX37);
  domBX37.window.close();

  check("X37: SC-PAR-LABEL — board label honesty (§20 amendment 2): complete course => #lbToParHead reads 'To par', #leaderboard NOT .lb-suppressed, real to-par form rendered; blank-par-7 course => header flips to 'Total', #leaderboard IS .lb-suppressed, the To-par-column span holds the IDENTICAL plain-digit gross the Total column holds (never a differently-valued or mislabeled figure); STRUCTURAL: the wide-width collapse rule, the pre-existing ≤560px rule that hides the redundant Total column, AND a min-width:561px-scoped 7-track grid-template-columns redefinition for #leaderboard.lb-suppressed .lb-head/.lb-row (no dangling 8th track/dead gutter at wide widths, correctly NOT applying at ≤560px so the narrow 5-track template — §25a Task 4's mv column — stays governing there; fix round 1 m1: label corrected from the pre-§25a 6/7th/4-track counts) are all present in the page's own CSS source (whole-branch review Imp-1); Task 5 fix round 1 (§25a B-HOME Imp-1): both rules now also carry .home-board.lb-suppressed as a joint selector on the SAME declaration, never a separate Home-only rule",
    headOKX37 === "To par" && !!notSuppressedX37 && !!toParFormOKX37 &&
      headBX37 === "Total" && !!suppressedX37 && !!sameValueX37 && wideRuleStructuralX37 && narrowRuleStructuralX37 && gridTemplateRuleStructuralX37,
    `headOK=${headOKX37} notSuppressed=${!!notSuppressedX37} toParFormOK=${!!toParFormOKX37} headB=${headBX37} suppressed=${!!suppressedX37} sameValue=${!!sameValueX37} totalCell=${totalCellBX37 && totalCellBX37.textContent} toParCell=${toParCellBX37 && toParCellBX37.textContent} wideRule=${wideRuleStructuralX37} narrowRule=${narrowRuleStructuralX37} gridTemplateRule=${gridTemplateRuleStructuralX37}`);
}

{
  // X38: SC-PAR-GLANCE — rank-claim suppression. Complete fixture: a rank
  // claim (leading / Nth-of-N-reporting) is present. Blank-par-7 fixture:
  // courseMap() null => no leading/place claim survives, but the neutral
  // facts (thru N, pending-on-phone) do. Same confirmed-team setup X29's
  // block establishes (test/smoke.mjs:3822 onward); noSheet:true per X33/
  // X36's own idiom — scGlanceRoundThru/rankedPlayers read straight from
  // buildPlayers' real fixture derivation regardless of the sheet stub
  // (unaffected either way), while scGlancePendingCount's sheet-absence
  // check IS affected by it, which is exactly what lets the planted
  // journal entry below register as genuinely "pending".
  const courseBlank7X38 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");

  const domOKX38 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docOKX38 = await openScorer(domOKX38, { noSheet: true });
  const glanceOKX38 = docOKX38.querySelector("#scGlance");
  const rankClaimOKX38 = glanceOKX38 && (!!glanceOKX38.querySelector(".sc-glance-leader") || /of \d+ reporting/.test(glanceOKX38.textContent));
  domOKX38.window.close();

  const overrideX38 = withScEndpoint({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X38 }),
  });
  const domBX38 = makeDom("#score?team=" + encodeURIComponent("Duck"), overrideX38);
  const docBX38 = await openScorer(domBX38, { noSheet: true });
  // Plant one queued journal entry for a hole with no sheet value (the
  // noSheet stub means EVERY hole qualifies) — same low-level scStore
  // seeding technique C1/X29 already establish — so scGlancePendingCount
  // has something real to count, proving suppression doesn't ALSO wipe the
  // neutral pending line.
  const seasonX38 = domBX38.window.scorerSeason();
  const roundX38 = domBX38.window.scActiveRound();
  const keyX38 = "gfy-scorer:" + seasonX38 + ":duck";
  const entryKeyX38 = domBX38.window.scEntryKeyOf(roundX38, 1);
  domBX38.window.scStore(keyX38, root => {
    root.seq = (root.seq || 0) + 1;
    root.entries[entryKeyX38] = { round: roundX38, hole: 1, score: 4, seq: root.seq,
      state: "queued", verdict: null, ts: Date.now(), retries: 0, override: false };
  });
  domBX38.window.renderScCard();
  await until(() => !!domBX38.window.document.querySelector("#scGlance .sc-glance-pending"));
  const glanceBX38 = docBX38.querySelector("#scGlance");
  const noRankClaimX38 = glanceBX38 && !glanceBX38.querySelector(".sc-glance-leader") &&
    !glanceBX38.querySelector(".sc-glance-neighbor") && !/of \d+ reporting/.test(glanceBX38.textContent);
  const thruStillPresentX38 = glanceBX38 && !!glanceBX38.querySelector(".sc-glance-thru") && /\d/.test(glanceBX38.querySelector(".sc-glance-thru").textContent);
  const pendingStillPresentX38 = glanceBX38 && !!glanceBX38.querySelector(".sc-glance-pending") && /pending on your phone/i.test(glanceBX38.textContent);
  domBX38.window.close();

  check("X38: SC-PAR-GLANCE — rank-claim suppression (§20 amendment 2): complete course => #scGlance carries a rank claim (.sc-glance-leader present, or 'of N reporting'); blank-par-7 course => courseMap() null suppresses EVERY rank claim (no .sc-glance-leader, no .sc-glance-neighbor, no 'of N reporting' text) while BOTH neutral facts survive — thru-N AND a planted pending-on-phone entry",
    !!rankClaimOKX38 && !!noRankClaimX38 && !!thruStillPresentX38 && !!pendingStillPresentX38,
    `rankClaimOK=${!!rankClaimOKX38} glanceOK=${glanceOKX38 && glanceOKX38.textContent.slice(0, 160)} noRankClaim=${!!noRankClaimX38} thruStillPresent=${!!thruStillPresentX38} pendingStillPresent=${!!pendingStillPresentX38} glanceB=${glanceBX38 && glanceBX38.textContent.slice(0, 200)}`);
}

/* ---------------------------------------------------------------------
   X39-X40 (§21, suppression-rank wave): amendment 2's rationale — the raw-
   gross fallback ordering compares unequal hole counts and must not be
   presented as standing — extended to the two remaining standing surfaces:
   the board's Pos column + .lead crown, and the calcutta's payout places +
   per-lot win claims (gross basis only; money is never suppressed).
   --------------------------------------------------------------------- */
{
  // X39: SC-RANK-POS — the board makes no place claims when pars are
  // suppressed. Complete course: Pos numbers + .lead crown exactly as today
  // (both-direction honesty, X37 idiom). Blank par: every Pos cell is
  // em-dash, no .lead row, while the rows themselves still render (order is
  // a sort, not a claim).
  const domOKX39 = makeDom("");
  await until(() => domOKX39.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docOKX39 = domOKX39.window.document;
  const okPosFirstX39 = docOKX39.querySelector("#lbBody .lb-row .lb-pos");
  const okPos1X39 = okPosFirstX39 && okPosFirstX39.textContent.trim() === "1";
  const okLeadX39 = !!docOKX39.querySelector("#lbBody .lb-row.lead");
  // Captured before the control dom closes, so the blank-par dom's row
  // count can be checked for PARITY against it below (replaces a hardcoded
  // >=5 floor with a same-fixture same-field-size same-run comparison).
  const okRowCountX39 = docOKX39.querySelectorAll("#lbBody .lb-row").length;
  domOKX39.window.close();

  const courseBlank7X39 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  const domBX39 = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X39 }),
  }));
  await until(() => domBX39.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docBX39 = domBX39.window.document;
  const posCellsBX39 = [...docBX39.querySelectorAll("#lbBody .lb-pos")].map(e => e.textContent.trim());
  // PARITY, not a floor: blanking one hole's par must not drop or duplicate
  // a single team row — every team from the control dom is still listed.
  const rowsParityBX39 = posCellsBX39.length === okRowCountX39;
  const allDashBX39 = rowsParityBX39 && posCellsBX39.every(t => t === "—");
  const noLeadBX39 = !docBX39.querySelector("#lbBody .lb-row.lead");
  domBX39.window.close();

  check("X39: SC-RANK-POS — complete course: first Pos '1' + a .lead row present; blank-par: all Pos cells '—', zero .lead rows, row count at PARITY with the control dom (no team gained or lost, no standing claims off the raw-gross fallback)",
    okPos1X39 && okLeadX39 && rowsParityBX39 && allDashBX39 && noLeadBX39,
    `okPos1=${okPos1X39} okLead=${okLeadX39} okRows=${okRowCountX39} blankRows=${posCellsBX39.length} rowsParity=${rowsParityBX39} allDash=${allDashBX39} noLead=${noLeadBX39}`);
}

{
  // X40: SC-RANK-CAL — gross-basis calcutta suppresses PLACES and WIN
  // CLAIMS, never MONEY. Complete course: today's exact behavior (a paying
  // place and a "Wins if it ended now: $N" claim exist). Blank par: no
  // .pay-row, pinned empty-state + paused basis line, owned+ranked lots
  // read "awaiting pars", and every money tile is byte-identical across the
  // two renders.
  const domOKX40 = makeDom("");
  await until(() => domOKX40.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docOKX40 = domOKX40.window.document;
  const okWouldX40 = /Wins if it ended now: \$\d+/.test(docOKX40.querySelector("#aucBody").textContent);
  const okPlaceX40 = !!docOKX40.querySelector("#payBody .pay-row");
  const moneyOKX40 = ["#calPot", "#calRake", "#calPayable", "#calTop"].map(s => docOKX40.querySelector(s).textContent);
  const outOKX40 = docOKX40.querySelector("#calOut").textContent;
  domOKX40.window.close();

  const courseBlank7X40 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  const domBX40 = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X40 }),
  }));
  await until(() => domBX40.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docBX40 = domBX40.window.document;
  const payBodyBX40 = docBX40.querySelector("#payBody");
  const noPlacesBX40 = payBodyBX40 && !payBodyBX40.querySelector(".pay-row") &&
    /Payouts wait on the Course tab — standings need all 18 pars\./.test(payBodyBX40.textContent);
  const basisBX40 = docBX40.querySelector("#calBasis").textContent === "Paused · Course pars incomplete";
  const aucTextBX40 = docBX40.querySelector("#aucBody").textContent;
  const awaitingBX40 = /awaiting pars/.test(aucTextBX40) && !/Wins if it ended now|Won: \$/.test(aucTextBX40);
  const moneyBX40 = ["#calPot", "#calRake", "#calPayable", "#calTop"].map(s => docBX40.querySelector(s).textContent);
  const outBX40 = docBX40.querySelector("#calOut").textContent;
  domBX40.window.close();
  const moneySameX40 = JSON.stringify(moneyOKX40) === JSON.stringify(moneyBX40) && outOKX40 === outBX40;

  check("X40: SC-RANK-CAL — complete course: paying place + 'Wins if it ended now: $N' present; blank-par: zero .pay-row + pinned 'Payouts wait on the Course tab' empty-state + 'Paused · Course pars incomplete' basis + owned lots 'awaiting pars' (no win claims) + pot/rake/payable/top/outstanding byte-identical across both renders",
    okWouldX40 && okPlaceX40 && noPlacesBX40 && basisBX40 && awaitingBX40 && moneySameX40,
    `okWould=${okWouldX40} okPlace=${okPlaceX40} noPlaces=${noPlacesBX40} basis=${basisBX40} awaiting=${awaitingBX40} moneySame=${moneySameX40}`);
}

/* ---------------------------------------------------------------------
   X41 (§22 C-UNSOLD, Riley ratified 2026-07-31): an unsold lot (owner
   "—") that belongs to a PLACING team must not book an owner cut, and
   must not swell the covered-lots largest-remainder reconciliation — its
   share stays in the pot, disclosed. The auction board's would-text
   already reads "unsold" correctly today; the defect is payout-table-side
   only (a cut IS booked to the unsold lot pre-fix, and the stays-in-pot
   note fires only for lot-LESS rows, never unsold-but-owned rows).

   Fixture: blank the OWNER cell on the "Duck" lot (one of the two teams
   tied 1st under the default fixture — G4: Duck & Sully tied 1st, Tex
   3rd). Duck is also bumped $120 -> $121 — its OWN price only, Sully/
   Moose/Tex/Bear untouched — deliberately breaking a coincidence in the
   unmodified numbers: at the stock $400 pot/$360 payable, every placing
   share (40/40/20) lands on an exact whole dollar with zero remainder to
   redistribute, so which rows are "covered" is invisible in the rendered
   cuts no matter which lot is unsold (verified: unselling Tex, the
   non-tied 3rd lot, is a proven-equivalent mutant for the covered filter
   at ANY price, since Tex's share is a fixed 1:2 ratio of Duck/Sully's —
   the largest-remainder outcome for the tied pair is a structural
   invariant of that ratio, independent of Tex's own fraction). A $1 bump
   makes payable=$361, giving Duck/Sully each a genuine $0.40 fractional
   remainder that the largest-remainder pass must award to exactly one of
   the tied pair — so whether Duck legitimately competes for that penny
   (control, still sold) or is excluded from the race (test, unsold)
   changes SULLY's own rendered cut ($144 vs $145): the covered filter's
   effect becomes observable, not masked by the (separately fixed)
   zeroing line. Duck stays `collected:TRUE` in both variants, so #calOut
   (outstanding excludes collected lots) never moves either.
   --------------------------------------------------------------------- */
{
  const toNum = t => { const n = Number((t || "").replace(/[^0-9.-]/g, "")); return isNaN(n) ? 0 : n; };
  // Mirror the app's own largest-remainder allocation (index.html
  // ~2498-2509) here, so the expected sold-lot cuts are DERIVED from
  // payable + shares in-test, not re-typed from a pinned total.
  function largestRemainderCuts(payableAmt, sharesArr) {
    const raws = sharesArr.map(s => payableAmt * s / 100);
    const floors = raws.map(v => Math.floor(v));
    const flooredSum = floors.reduce((a, b) => a + b, 0);
    const coveredShares = sharesArr.reduce((a, b) => a + b, 0);
    let remainder = Math.round(payableAmt * coveredShares / 100) - flooredSum;
    raws.map((v, idx) => ({ idx, frac: v - floors[idx] }))
      .sort((a, b) => b.frac - a.frac || a.idx - b.idx)
      .forEach(o => { if (remainder > 0) { floors[o.idx] += 1; remainder--; } });
    return floors;
  }

  // Twin doms, same pattern as X40: `doc` is long since closed by this
  // point in the suite (Z0, ~line 1512), so the "unmodified fixture"
  // comparison needs its own fresh control dom, not the stale top-level one.
  // Control: Duck's price bumped (so pot/payable match the test dom) but
  // Duck's owner left intact — Duck genuinely competes in the covered set.
  const calcuttaDuckPriceOnly = FIXTURES.calcutta.replace("2026,Duck,Tex,120,TRUE", "2026,Duck,Tex,121,TRUE");
  const duckPriceOnlyFetch = withOverride({
    calcutta: () => Promise.resolve({ ok: true, status: 200, text: async () => calcuttaDuckPriceOnly }),
  });
  const domOKX41 = makeDom("", duckPriceOnlyFetch);
  await until(() => domOKX41.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docOKX41 = domOKX41.window.document;

  // Duck stays `collected:TRUE` here (only the OWNER cell is blanked) —
  // this intentionally suppresses calcuttaModel's own separate "lot has no
  // owner — counted under Unassigned" flag, which only fires for
  // NOT-YET-collected lots (`lots.filter(l=>!l.collected)`, index.html
  // 2116). That flag is a distinct, pre-existing signal for an outstanding
  // unassigned balance; this fixture deliberately keeps it silent so the
  // test isolates the payout-table/auction-board behavior under review
  // (C-UNSOLD) from that unrelated collection-side flag.
  const calcuttaDuckUnsold = FIXTURES.calcutta.replace("2026,Duck,Tex,120,TRUE", "2026,Duck,,121,TRUE");
  const duckUnsoldFetch = withOverride({
    calcutta: () => Promise.resolve({ ok: true, status: 200, text: async () => calcuttaDuckUnsold }),
  });
  const domX41 = makeDom("", duckUnsoldFetch);
  await until(() => domX41.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docX41 = domX41.window.document;

  const payRows = doc => [...doc.querySelectorAll("#payBody .pay-row")].map(r => ({
    team: r.children[1]?.textContent || "", cutText: r.children[3]?.textContent || "",
  }));
  const payRowsX41 = payRows(docX41);
  const duckRowX41 = payRowsX41.find(r => /Duck/.test(r.team));
  const sullyRowX41 = payRowsX41.find(r => /Sully/.test(r.team));
  const texRowX41 = payRowsX41.find(r => /Tex/.test(r.team));

  // Negative control: the all-sold control dom (Duck's own price bumped but
  // its OWNER left intact, so every placing lot is sold) must NOT carry the
  // stays-in-pot disclosure — that note is specific to a lot-less/unsold
  // placing row, and this fixture has none.
  const noteAbsentControlX41 = !/unsold lots' shares stay in the pot/.test(docOKX41.querySelector("#calBasis")?.textContent || "");

  // (a) the unsold placing team's own row books no cut.
  const noCutX41 = duckRowX41?.cutText === "—";

  // (b) the auction board still reads "unsold" for that lot.
  const duckWouldX41 = wouldTextFor(docX41, "Duck");
  const stillUnsoldX41 = duckWouldX41 === "unsold";

  // (c) the stays-in-pot disclosure fires for this unsold-but-PLACING row
  // (pre-fix it only fires for lot-LESS rows, and Duck still has a lot).
  const noteX41 = /unsold lots' shares stay in the pot/.test(docX41.querySelector("#calBasis")?.textContent || "");

  // (d) the sold placing lots' cuts (Sully, Tex) equal the largest-
  // remainder allocation re-derived over the NARROWED covered set (Duck
  // excluded, shares [40,20]) — computed here from payable + shares, not
  // re-typed. Cross-checked against the control dom (Duck still sold, so
  // the ORIGINAL covered set is [40,40,20]): control's Sully cut is
  // EXPECTED to differ from the narrowed-set figure (Duck legitimately
  // wins the one available remainder penny there, per the code's own
  // idx tie-break for equal fracs) — the "unless...shifted" branch this
  // fixture was built to exercise, not the trivial "unchanged" case.
  const payableX41 = toNum(docX41.querySelector("#calPayable")?.textContent);
  const [sullyExpectedX41, texExpectedX41] = largestRemainderCuts(payableX41, [40, 20]);
  const docPayRowsOK = payRows(docOKX41);
  const sullyCutOrig = toNum(docPayRowsOK.find(r => /Sully/.test(r.team))?.cutText);
  const sullyCutX41 = toNum(sullyRowX41?.cutText);
  const texCutX41 = toNum(texRowX41?.cutText);
  const soldMatchesDerivationX41 = sullyCutX41 === sullyExpectedX41 && texCutX41 === texExpectedX41;
  const shiftedFromControlX41 = sullyCutX41 !== sullyCutOrig; // proves this fixture exercises real reallocation, not a no-op

  // (e) pot/payable tiles never keyed on ownership — byte-identical to the
  // control dom (both carry Duck's bumped price, differing ONLY in owner).
  const potPayableSameX41 = docOKX41.querySelector("#calPot")?.textContent === docX41.querySelector("#calPot")?.textContent &&
    docOKX41.querySelector("#calPayable")?.textContent === docX41.querySelector("#calPayable")?.textContent;

  domOKX41.window.close();
  domX41.window.close();

  check("X41: §22 C-UNSOLD — a placing team's UNSOLD lot (owner '—', lot present) books no owner cut ('—' not a dollar figure), the auction board still reads 'unsold', the stays-in-pot disclosure note fires for this unsold-but-owned row (and is ABSENT from the all-sold control dom), the remaining SOLD placing lots' cuts equal the largest-remainder allocation re-derived over the narrowed covered set (a genuine reallocation vs. the control dom, not a coincidental no-op), and #calPot/#calPayable stay byte-identical",
    noCutX41 && stillUnsoldX41 && noteX41 && noteAbsentControlX41 && soldMatchesDerivationX41 && shiftedFromControlX41 && potPayableSameX41,
    `noCut=${noCutX41} duckCut=${duckRowX41?.cutText} stillUnsold=${stillUnsoldX41} note=${noteX41} noteAbsentControl=${noteAbsentControlX41} soldMatchesDerivation=${soldMatchesDerivationX41} shiftedFromControl=${shiftedFromControlX41} sullyX41=${sullyCutX41}(exp${sullyExpectedX41},controlOrig${sullyCutOrig}) texX41=${texCutX41}(exp${texExpectedX41}) potPayableSame=${potPayableSameX41}`);
}

/* ---------------------------------------------------------------------
   X42 (§22, SC-PAR-CORNER's sibling coverage — SC-RANK-CAL net guard):
   `rankSuppressed = basis==="gross" && !courseMap()` (index.html:2445) is
   gross-basis ONLY — net-basis standings derive from handicaps/totals, not
   pars, so a net-basis calcutta must stay fully live (places + win claims)
   even while the Course tab's pars are incomplete. The repo's stock
   fixtures always carry a Field roster, and `renderCalcutta` forces
   basis="gross" whenever a roster exists (`if(roster.size){...} else
   {basis=...}` — a scramble roster has no per-player handicap to net
   against), regardless of `calcutta_basis`. Reaching a genuine net-basis
   render therefore requires a synthetic fixture that empties the Field
   roster the way `rosterMap()` reads it (year+player+team all present) —
   documented as a deliberately skipped/unrenderable visual state in the
   §21 suppression-rank wave's own task-2 report (roster deletion perturbs
   too much for a *screenshot* to prove the guard in isolation) but exactly
   right for an in-DOM assertion, which only reads the three calcutta
   surfaces under test and ignores the rest of the page.

   Fixture: field truncated to its header row only (zero data rows ->
   `rosterMap().size===0` for every season) + `calcutta_basis` flipped
   gross->net on the Info tab (already present as a real row in
   fixtures/info.csv, so this is a single-line substitution, not an
   addition) + the same blank-hole-7 course splice X39/X40 use. Scores and
   Calcutta tabs are untouched — with the roster empty, `buildPlayers`'s
   `roster.size&&!roster.has(k)` guard short-circuits, so every scored team
   still gets counted (falling back to its raw team-column name).
   --------------------------------------------------------------------- */
{
  const fieldHeaderOnlyX42 = FIXTURES.field.split(/\r?\n/)[0] + "\r\n";
  const infoNetX42 = FIXTURES.info.replace("calcutta_basis,gross", "calcutta_basis,net");
  const courseBlank7X42 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  const domX42 = makeDom("", withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldHeaderOnlyX42 }),
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoNetX42 }),
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X42 }),
  }));
  await until(() => domX42.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docX42 = domX42.window.document;

  const payRowX42 = !!docX42.querySelector("#payBody .pay-row");
  const aucTextX42 = docX42.querySelector("#aucBody")?.textContent || "";
  const winClaimX42 = /Wins if it ended now: \$\d+/.test(aucTextX42);
  const paidOnNetX42 = /paid on net/.test(docX42.querySelector("#calBasis")?.textContent || "");
  // Both-direction honesty (X37/X40 idiom): the suppressed-arm text and the
  // pars-incomplete empty-state copy must be ABSENT — net truly stays live,
  // this isn't the gross-suppression path rendering by coincidence.
  const noAwaitingParsX42 = !/awaiting pars/.test(aucTextX42);
  const noParsEmptyStateX42 = !/Payouts wait on the Course tab/.test(docX42.querySelector("#payBody")?.textContent || "");
  domX42.window.close();

  check("X42: §22 SC-RANK-CAL net guard — roster-less + calcutta_basis=net + blank par 7: the calcutta payout table stays fully LIVE (a real .pay-row renders, a 'Wins if it ended now: $N' claim is present, basis line reads 'paid on net'), with no 'awaiting pars' text and no pars-incomplete empty state — net-basis standings never key off courseMap()",
    payRowX42 && winClaimX42 && paidOnNetX42 && noAwaitingParsX42 && noParsEmptyStateX42,
    `payRow=${payRowX42} winClaim=${winClaimX42} paidOnNet=${paidOnNetX42} noAwaitingPars=${noAwaitingParsX42} noParsEmptyState=${noParsEmptyStateX42}`);
}

/* ---------------------------------------------------------------------
   X43 (§22, SC-RANK-CAL arm priority under suppression): each of the
   auction board's would-text branches (`withdrawn` / `unsold` / `waiting
   on cards`) is checked, in that order, BEFORE the `rankSuppressed`
   ("awaiting pars") branch is ever reached (index.html ~2520-2532) — a
   suppressed course must never overwrite a more specific, already-known
   state with the generic "pars are the reason" text. A normal owned+
   ranked lot, with nothing else going on, DOES read "awaiting pars" under
   suppression (that's the X40 control case) — this test's point is that
   the other three arms outrank it on their own lots.

   Fixture (gross basis — the stock Field roster is untouched, so basis
   stays forced-gross regardless of Info; only pars are blanked): Tex's
   Field status flipped to `wd` (W-WD's own fixture idiom) so its lot
   reads "withdrawn"; Moose's calcutta owner blanked (V4's idiom) so its
   lot reads "unsold"; Bear's scores rows removed entirely (V3's idiom) so
   its lot — still owned, still a lot, never posted a card — reads
   "waiting on cards"; Duck (untouched) is the normal owned+ranked control
   arm and reads "awaiting pars". Course: the same blank-hole-7 splice.
   --------------------------------------------------------------------- */
{
  const fieldTexWdX43 = FIXTURES.field.replace("2026,Tex,Tex,2019,18,In,TRUE,", "2026,Tex,Tex,2019,18,wd,TRUE,");
  const calcuttaMooseUnsoldX43 = FIXTURES.calcutta.replace("2026,Moose,Sock,80,", "2026,Moose,,80,");
  const scoresNoBearX43 = FIXTURES.scores.split(/\r?\n/).filter(l => !l.startsWith("2026,Bear,")).join("\n");
  const courseBlank7X43 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  const domX43 = makeDom("", withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldTexWdX43 }),
    calcutta: () => Promise.resolve({ ok: true, status: 200, text: async () => calcuttaMooseUnsoldX43 }),
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresNoBearX43 }),
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X43 }),
  }));
  await until(() => domX43.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docX43 = domX43.window.document;

  const duckWouldX43 = wouldTextFor(docX43, "Duck");
  const mooseWouldX43 = wouldTextFor(docX43, "Moose");
  const texWouldX43 = wouldTextFor(docX43, "Tex");
  const bearWouldX43 = wouldTextFor(docX43, "Bear");
  domX43.window.close();

  check("X43: §22 SC-RANK-CAL arm priority under suppression — withdrawn/unsold/waiting-on-cards each win over the generic 'awaiting pars' text on their own lot (Tex wd -> 'withdrawn', Moose no-owner -> 'unsold', Bear no-scores -> 'waiting on cards'), while an untouched owned+ranked lot (Duck) reads 'awaiting pars' as normal",
    texWouldX43 === "withdrawn" && mooseWouldX43 === "unsold" && bearWouldX43 === "waiting on cards" && duckWouldX43 === "awaiting pars",
    `duck=${duckWouldX43} moose=${mooseWouldX43} tex=${texWouldX43} bear=${bearWouldX43}`);
}

/* ---------------------------------------------------------------------
   X44 (§22 amendment, 2026-07-31 — Task-2 review): SC-PAR-CORNER's own
   byte-assert, both directions in one check. The corner arm only fires
   inside the `!ranked.length` branch (index.html ~2548-2555), so BOTH
   variants here start from a header-only Scores fixture (zero score rows
   -> buildPlayers produces nothing -> ranked.length===0, same idiom as
   B2/scoresHeaderOnly). Direction (a) additionally blanks hole 7's par
   (the standard X39/X40/X42/X43 splice) so `rankSuppressed` is ALSO true
   -> the widened corner copy. Direction (b) leaves the course fixture
   untouched (complete pars) so `rankSuppressed` is false -> the original,
   preserved single-state copy — proving the widening is conditional, not
   a blanket rewrite. No leaderboard rows exist in either variant, so
   `settle()` (B2's own idiom) stands in for the usual
   `until(...#lbBody .lb-row...)` wait, which would never resolve here.
   --------------------------------------------------------------------- */
{
  const scoresHeaderOnlyX44 = FIXTURES.scores.split(/\r\n|\n/)[0] + "\r\n";
  const courseBlank7X44 = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");

  // (a) no cards AND suppressed pars together -> widened corner string.
  const domAX44 = makeDom("", withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresHeaderOnlyX44 }),
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7X44 }),
  }));
  await settle();
  const calBasisAX44 = domAX44.window.document.querySelector("#calBasis")?.textContent || "";
  domAX44.window.close();

  // (b) no cards, pars complete -> the ORIGINAL single-state string, byte-
  // exact and unwidened (proves the ternary's false branch is untouched).
  const domBX44 = makeDom("", withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresHeaderOnlyX44 }),
  }));
  await settle();
  const calBasisBX44 = domBX44.window.document.querySelector("#calBasis")?.textContent || "";
  domBX44.window.close();

  check("X44: §22 SC-PAR-CORNER byte-assert — no cards + suppressed pars => calBasis reads 'Bids locked. Payouts post once cards and Course pars are in.' byte-exact; no cards + complete pars => calBasis reads the preserved 'Bids locked. Payouts post once cards do.' byte-exact",
    calBasisAX44 === "Bids locked. Payouts post once cards and Course pars are in." &&
    calBasisBX44 === "Bids locked. Payouts post once cards do.",
    `corner=${JSON.stringify(calBasisAX44)} single=${JSON.stringify(calBasisBX44)}`);
}

/* ---------------------------------------------------------------------
   X45 (§23 C-EMPTY-SPLIT): the shared #payBody empty-state splits per
   branch. No-LOTS (the `!lots.length` early-out, index.html ~2412) keeps
   the bids line — bids are genuinely absent, so that copy stays true. No-
   CARDS (lots exist, `!ranked.length`, index.html ~2549 — the SAME branch
   X44 exercises) reads a DIFFERENT line naming cards instead of bids,
   since bids clearly ARE in (the lots exist) — the old shared copy there
   was a last-panel self-contradiction sitting above a "Bids locked."
   basis line. Direction (a) is GREEN today (the no-lots line is
   unchanged); direction (b) is RED today (the no-cards branch still
   renders the bids-line copy pre-fix). One combined byte-exact check, X44's
   idiom.
   --------------------------------------------------------------------- */
{
  // (a) no-LOTS: header-only calcutta fixture (zero data rows) -> lots=[]
  // -> the `!lots.length` early-out. Scores stay the normal fixture so the
  // leaderboard renders as usual; only the Calcutta tab's own data is empty.
  const calcuttaHeaderOnlyX45 = FIXTURES.calcutta.split(/\r\n|\n/)[0] + "\r\n";
  const domAX45 = makeDom("", withOverride({
    calcutta: () => Promise.resolve({ ok: true, status: 200, text: async () => calcuttaHeaderOnlyX45 }),
  }));
  await until(() => domAX45.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const payBodyAX45 = domAX45.window.document.querySelector("#payBody")?.textContent || "";
  domAX45.window.close();

  // (b) no-CARDS: lots present (default calcutta fixture untouched), header-
  // only scores -> ranked.length===0, the `!ranked.length` branch. Course
  // stays complete (rankSuppressed false) so this isolates the plain no-
  // cards line from the §22 corner widening, which X44 already covers.
  const scoresHeaderOnlyX45 = FIXTURES.scores.split(/\r\n|\n/)[0] + "\r\n";
  const domBX45 = makeDom("", withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresHeaderOnlyX45 }),
  }));
  await settle();
  const payBodyBX45 = domBX45.window.document.querySelector("#payBody")?.textContent || "";
  domBX45.window.close();

  check("X45: §23 C-EMPTY-SPLIT — no-LOTS #payBody reads 'Payouts calculate off the live leaderboard once bids are in.' byte-exact; no-CARDS (lots present, no scores yet) #payBody reads 'Payouts calculate off the live leaderboard once cards are in.' byte-exact",
    payBodyAX45 === "Payouts calculate off the live leaderboard once bids are in." &&
    payBodyBX45 === "Payouts calculate off the live leaderboard once cards are in.",
    `noLots=${JSON.stringify(payBodyAX45)} noCards=${JSON.stringify(payBodyBX45)}`);
}

/* ---------------------------------------------------------------------
   X46 (§23 C-OWNERLESS-COLLECTED): a lot with NO owner but marked
   collected=TRUE is a sheet-data contradiction (money marked collected
   from nobody) rendered faithfully today with no signal — calcuttaModel
   gains ONE flag line beside the existing unassigned-lot gate (index.html
   ~2116, which only fires for UNCOLLECTED ownerless lots via its
   `lots.filter(l=>!l.collected)` guard) — zero math change, flag only.
   Fixture: X41's own shape (blank the OWNER cell on the already-
   collected:TRUE "Duck" row). Three negative doms prove the new flag is
   specific, not a broad "any collected lot" or "any ownerless lot" net:
   normal (all-owned, mixed collected states) never fires it; unsold-
   uncollected (ownerless but NOT collected — the EXISTING flag's own
   territory) fires the EXISTING flag but must not ALSO fire the new one;
   all-sold (every lot owned, every lot collected:TRUE) proves universal
   collection alone, with no ownerless lot anywhere, never fires it either.
   Per the shared-#healthStrip note (X33 and X45/X46 all read it), negative
   doms assert the NEW string specifically absent rather than the strip
   empty — other flags may legitimately be present (e.g. the existing
   unassigned-lot flag in the unsold-uncollected dom). The three negative
   doms' contradiction candidate is NOT always Duck (dom (c) blanks MOOSE's
   owner cell) — so their absence check uses a TEAM-AGNOSTIC regex (no team
   name pinned) to actually catch a regressed guard regardless of which lot
   it would fire for; only the positive dom (a) — which controls its own
   fixture team — asserts the Duck-specific string (§23 review round 1
   fix: a Duck-only regex on dom (c) would have been vacuous against a
   guard that dropped the `l.collected` check, since Moose's flag text
   never matches a Duck-pinned pattern).
   --------------------------------------------------------------------- */
{
  const flagReDuckX46 = /lot "Duck" marked collected but has no owner — check the Calcutta tab/;
  const flagReAnyX46 = /marked collected but has no owner — check the Calcutta tab/;

  // (a) positive: ownerless + collected:TRUE (X41's fixture shape).
  const calcuttaOwnerlessCollectedX46 = FIXTURES.calcutta.replace("2026,Duck,Tex,120,TRUE", "2026,Duck,,120,TRUE");
  const domAX46 = makeDom("", withOverride({
    calcutta: () => Promise.resolve({ ok: true, status: 200, text: async () => calcuttaOwnerlessCollectedX46 }),
  }));
  await until(() => domAX46.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const stripAX46 = domAX46.window.document.querySelector("#healthStrip");
  const firesX46 = !!stripAX46 && !stripAX46.hidden && flagReDuckX46.test(stripAX46.textContent);
  domAX46.window.close();

  // (b) negative: normal (default fixture — all lots owned, mixed collected
  // states, no data contradiction anywhere).
  const domBX46 = makeDom("");
  await until(() => domBX46.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const absentNormalX46 = !flagReAnyX46.test(domBX46.window.document.querySelector("#healthStrip")?.textContent || "");
  domBX46.window.close();

  // (c) negative: unsold-uncollected (ownerless, NOT collected — V4's own
  // fixture shape, on MOOSE) fires the EXISTING unassigned-lot flag but
  // must not ALSO fire the new one.
  const calcuttaUnsoldUncollectedX46 = FIXTURES.calcutta.replace("2026,Moose,Sock,80,", "2026,Moose,,80,");
  const domCX46 = makeDom("", withOverride({
    calcutta: () => Promise.resolve({ ok: true, status: 200, text: async () => calcuttaUnsoldUncollectedX46 }),
  }));
  await until(() => domCX46.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const stripCX46 = domCX46.window.document.querySelector("#healthStrip");
  const existingFlagFiresX46 = !!stripCX46 && !stripCX46.hidden && /has no owner — counted under Unassigned/.test(stripCX46.textContent);
  const absentUnsoldUncollectedX46 = !flagReAnyX46.test(stripCX46?.textContent || "");
  domCX46.window.close();

  // (d) negative: all-sold (every lot owned, every lot ALSO collected:TRUE)
  // — proves universal collection alone, with zero ownerless lots in the
  // mix, never fires the new flag.
  const calcuttaAllSoldX46 = FIXTURES.calcutta
    .replace("2026,Sully,Tex,100,", "2026,Sully,Tex,100,TRUE")
    .replace("2026,Moose,Sock,80,", "2026,Moose,Sock,80,TRUE");
  const domDX46 = makeDom("", withOverride({
    calcutta: () => Promise.resolve({ ok: true, status: 200, text: async () => calcuttaAllSoldX46 }),
  }));
  await until(() => domDX46.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const absentAllSoldX46 = !flagReAnyX46.test(domDX46.window.document.querySelector("#healthStrip")?.textContent || "");
  domDX46.window.close();

  check("X46: §23 C-OWNERLESS-COLLECTED — ownerless+collected:TRUE lot (Duck, X41's shape) fires 'lot \"Duck\" marked collected but has no owner — check the Calcutta tab' in #healthStrip; absent on the normal default dom; absent on an unsold-uncollected dom (which fires only the EXISTING unassigned-lot flag); absent on an all-sold+all-collected dom",
    firesX46 && absentNormalX46 && existingFlagFiresX46 && absentUnsoldUncollectedX46 && absentAllSoldX46,
    `fires=${firesX46} absentNormal=${absentNormalX46} existingFlagFires=${existingFlagFiresX46} absentUnsoldUncollected=${absentUnsoldUncollectedX46} absentAllSold=${absentAllSoldX46}`);
}

// X47: parseWhen — format matrix (§24 A-WHEN). parseDate stays date-only and frozen.
{
  const dom=makeDom("", fakeFetch); await settle(); const w=dom.window;
  const ok=(s)=>w.parseWhen(s), no=(s)=>w.parseWhen(s)===null;
  const at=ok("2099-08-15 14:30");
  check("X47: parseWhen — 'YYYY-MM-DD HH:MM' parses; bare date = 00:00 same day; garbage/invalid-calendar/out-of-range all null; same-day ordering by time",
    at!==null
    && ok("2099-08-15")===new w.Date(2099,7,15,0,0).getTime()
    && at===new w.Date(2099,7,15,14,30).getTime()
    && ok("2099-08-15 09:00") < at                      // same-day ordering
    && no("2099-02-30 10:00") && no("2099-08-15 24:00") // fake calendar / bad clock
    && no("08/15/2099") && no("tomorrow") && no("") && no("2099-8-15 9:00") // strict widths
    && no("1999-08-15") && no("2101-08-15"),            // year range, parseDate idiom
    "at="+at);
  dom.window.close();
}

/* ---------------------------------------------------------------------
   X48-X50 (§24 A-BANNER/A-SEEN): announcements banner, watermark, dismiss,
   Updates list, scorer suppression. Uses the hoisted `annCsv`/`iso`
   helpers (defined near nearestTextAncestor above) and an announce-tab
   `withOverride` per dom, same idiom as the D-block. All timestamps are
   relative to `nowW` (or 2099) — never a real-calendar literal (Z2's
   time-bomb lesson: a hardcoded date one day stale silently flips truthy).
   --------------------------------------------------------------------- */
const nowW = Date.now();

// X48: two parseable, current-season, past (already-unseen) rows. Bar shows
// both, newest first; message text present; esc proof on the HTML-bearing
// message; dismiss hides the bar and persists the watermark at the NEWEST
// unseen row's parsed instant; a repeat renderAnnouncements() call (no
// reload) stays hidden — both the in-session ANN_DISMISSED flag and the
// now-covering watermark independently keep it down.
{
  const rowsX48 = annCsv([
    [2026, iso(nowW - 3600000), "R2 tee times posted"],
    [2026, iso(nowW - 7200000), "<b>x</b> & y"],
    [2026, "<i>bad</i>", "Third update"],
  ]);
  const domX48 = makeDom("", withOverride({
    announce: () => Promise.resolve({ ok: true, status: 200, text: async () => rowsX48 }),
  }));
  await until(() => domX48.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const wX48 = domX48.window;
  const barX48 = wX48.document.getElementById("announceBar");
  const visibleX48 = !!barX48 && !barX48.hidden;
  const htmlX48 = barX48 ? barX48.innerHTML : "";
  const hasNewestX48 = htmlX48.includes("R2 tee times posted");
  const escProofX48 = htmlX48.includes("&lt;b&gt;x&lt;/b&gt;") && !htmlX48.includes("<b>x</b>");
  const newestFirstX48 = hasNewestX48 && escProofX48 &&
    htmlX48.indexOf("R2 tee times posted") < htmlX48.indexOf("&lt;b&gt;");

  // review round 1 finding 3: esc() on the Updates list was unheld (a mutant
  // dropping esc() from either field there survived the whole suite). The
  // third row above has markup in `when` (malformed — never reaches the bar);
  // row 2's `<b>x</b> & y` message covers the message field. Assert BOTH
  // escape in #annUpdates specifically, not just in the bar.
  const updatesHtmlX48 = wX48.document.getElementById("annUpdates")?.innerHTML || "";
  const escProofMsgUpdatesX48 = updatesHtmlX48.includes("&lt;b&gt;x&lt;/b&gt;") && !updatesHtmlX48.includes("<b>x</b>");
  const escProofWhenUpdatesX48 = updatesHtmlX48.includes("&lt;i&gt;bad&lt;/i&gt;") && !updatesHtmlX48.includes("<i>bad</i>");

  const expectTopX48 = wX48.parseWhen(iso(nowW - 3600000));
  barX48.querySelector("#annDismiss").click();
  const hiddenAfterDismissX48 = barX48.hidden === true;
  const storedX48 = wX48.localStorage.getItem("gfyAnnSeen");
  const watermarkOkX48 = storedX48 === String(expectTopX48);

  wX48.renderAnnouncements();
  const staysHiddenX48 = barX48.hidden === true;

  check("X48: §24 A-BANNER/A-SEEN — #announceBar visible with two unseen rows (newest first), message text present, esc proof (innerHTML carries &lt;b&gt;, never raw <b>x</b>) in BOTH the bar and #annUpdates (message field), and #annUpdates also escapes a markup-bearing `when` field; dismiss hides the bar and sets localStorage.gfyAnnSeen to the newest row's parsed instant; a repeat renderAnnouncements() stays hidden (session + watermark)",
    visibleX48 && newestFirstX48 && escProofMsgUpdatesX48 && escProofWhenUpdatesX48 &&
      hiddenAfterDismissX48 && watermarkOkX48 && staysHiddenX48,
    "visible="+visibleX48+" newestFirst="+newestFirstX48+
      " escProofMsgUpdates="+escProofMsgUpdatesX48+" escProofWhenUpdates="+escProofWhenUpdatesX48+
      " hiddenAfterDismiss="+hiddenAfterDismissX48+
      " watermarkOk="+watermarkOkX48+" (got="+storedX48+" want="+expectTopX48+")"+" staysHidden="+staysHiddenX48+
      " html="+JSON.stringify(htmlX48).slice(0,220)+" updatesHtml="+JSON.stringify(updatesHtmlX48).slice(0,260));
  domX48.window.close();
}

// X49: watermark honesty (future-guard), malformed-`when` ordering, and
// storage-dead degrade. Three sub-doms (a/b/c), one combined assertion.
{
  // (a) future-guard: a row >24h out never counts as "unseen" (bar), but it
  // still shows in Updates; dismissing the OTHER (real, past) row advances
  // the watermark only to that row's instant — strictly below the
  // future-guarded row's instant, proving the guard, not just absence.
  const pastAtX49a = nowW - 3600000;
  const futureAtRawX49a = nowW + 3*86400000;
  const rowsX49a = annCsv([
    [2026, iso(pastAtX49a), "Past update"],
    [2026, iso(futureAtRawX49a), "Future typo update"],
  ]);
  const domX49a = makeDom("", withOverride({
    announce: () => Promise.resolve({ ok: true, status: 200, text: async () => rowsX49a }),
  }));
  await until(() => domX49a.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const wA49 = domX49a.window;
  const updatesHtmlA49 = wA49.document.getElementById("annUpdates")?.innerHTML || "";
  const futureInUpdatesA49 = updatesHtmlA49.includes("Future typo update");
  const barA49 = wA49.document.getElementById("announceBar");
  const barTextA49 = barA49 ? barA49.textContent : "";
  const futureNotUnseenA49 = !barTextA49.includes("Future typo update") && barTextA49.includes("Past update");
  const futureAtA49 = wA49.parseWhen(iso(futureAtRawX49a));
  barA49.querySelector("#annDismiss").click();
  const wmStoredA49 = +wA49.localStorage.getItem("gfyAnnSeen");
  const wmBelowFutureA49 = wmStoredA49 === wA49.parseWhen(iso(pastAtX49a)) && wmStoredA49 < futureAtA49;
  domX49a.window.close();

  // (b) malformed `when` renders last in Updates (sheet order after
  // parseables) and never counts as unseen.
  const rowsX49b = annCsv([
    [2026, iso(nowW - 3600000), "Real update"],
    [2026, "soon", "Malformed update"],
  ]);
  const domX49b = makeDom("", withOverride({
    announce: () => Promise.resolve({ ok: true, status: 200, text: async () => rowsX49b }),
  }));
  await until(() => domX49b.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const wB49 = domX49b.window;
  const annRowsB49 = [...wB49.document.querySelectorAll("#annUpdates .ann-row")];
  const malformedLastB49 = annRowsB49.length === 2 &&
    annRowsB49[0].textContent.includes("Real update") &&
    annRowsB49[1].textContent.includes("Malformed update");
  const malformedNeverUnseenB49 = !(wB49.document.getElementById("announceBar")?.textContent || "")
    .includes("Malformed update");
  domX49b.window.close();

  // (c) storage-dead degrade: window.localStorage THROWS on access (getter
  // override, per the controller's idiom — distinct from X23's throwing-
  // setItem stub, because both reads (annWatermark) and writes (dismiss)
  // must be exercised here). Override BEFORE the render call under test,
  // then re-render explicitly so the throwing path is actually hit.
  const rowsX49c = annCsv([[2026, iso(nowW - 3600000), "Blocked storage update"]]);
  const domX49c = makeDom("", withOverride({
    announce: () => Promise.resolve({ ok: true, status: 200, text: async () => rowsX49c }),
  }));
  await until(() => domX49c.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const wC49 = domX49c.window;
  Object.defineProperty(wC49, "localStorage", { get(){ throw new Error("blocked"); } });
  wC49.renderAnnouncements();
  const barC49 = wC49.document.getElementById("announceBar");
  const rendersUnderBlockC49 = !!barC49 && !barC49.hidden && barC49.textContent.includes("Blocked storage update");
  barC49.querySelector("#annDismiss").click();
  const dismissHidesC49 = barC49.hidden === true;
  // review round 1 finding 4: the session-dismiss flag (ANN_DISMISSED) was
  // unheld under storage-dead — with localStorage permanently throwing, the
  // watermark can never advance (annWatermark() always returns 0), so a
  // second render call after dismiss stays hidden ONLY if ANN_DISMISSED is
  // doing the work. Re-render explicitly and assert it stays down.
  wC49.renderAnnouncements();
  const staysHiddenAfterDismissC49 = barC49.hidden === true;
  const noPageErrorsC49 = domX49c.pageErrors.length === 0;
  domX49c.window.close();

  check("X49: §24 A-SEEN watermark honesty — a >24h-future row renders in Updates but never shows as unseen in the bar, and dismissing the real row leaves the watermark strictly below the future row's instant; a malformed `when` renders last in Updates and never counts as unseen; with window.localStorage throwing on every access, the bar still renders, dismiss still hides it for the session, and a repeat renderAnnouncements() after dismiss stays hidden (ANN_DISMISSED alone, since the watermark can never advance under permanent storage failure), with zero page errors",
    futureInUpdatesA49 && futureNotUnseenA49 && wmBelowFutureA49 &&
    malformedLastB49 && malformedNeverUnseenB49 &&
    rendersUnderBlockC49 && dismissHidesC49 && staysHiddenAfterDismissC49 && noPageErrorsC49,
    "futureInUpdates="+futureInUpdatesA49+" futureNotUnseen="+futureNotUnseenA49+" wmBelowFuture="+wmBelowFutureA49+
      " (wm="+wmStoredA49+" futureAt="+futureAtA49+")"+
      " malformedLast="+malformedLastB49+" malformedNeverUnseen="+malformedNeverUnseenB49+
      " rendersUnderBlock="+rendersUnderBlockC49+" dismissHides="+dismissHidesC49+
      " staysHiddenAfterDismiss="+staysHiddenAfterDismissC49+" pageErrors="+noPageErrorsC49);
}

// X50: Home's #annUpdates lists ALL current-season rows (seen + unseen
// alike — a seeded watermark that "sees" one of them must not drop it from
// the list); scorer suppression via body[data-view="score"] hides
// #announceBar (computed style, not just the [hidden] attribute) and #board
// restores it.
{
  const atUnseenX50 = nowW - 3600000;
  const atSeenX50 = nowW - 7200000;
  const rowsX50 = annCsv([
    [2026, iso(atUnseenX50), "Unseen headline"],
    [2026, iso(atSeenX50), "Seen headline"],
    // review round 1 finding 5: current-season filter was unheld — a
    // wrong-year row (fresher than both current-season rows above, so it
    // WOULD sort first if the year filter were dropped) must not leak into
    // either the bar or #annUpdates.
    [2025, iso(nowW - 1800000), "Wrong year headline"],
  ]);
  const domX50 = makeDom("", withOverride({
    announce: () => Promise.resolve({ ok: true, status: 200, text: async () => rowsX50 }),
  }));
  await until(() => domX50.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const w50 = domX50.window;

  // Seed the watermark strictly between the two rows so "Seen headline" is
  // already seen and "Unseen headline" is not, then re-render.
  w50.localStorage.setItem("gfyAnnSeen", String(w50.parseWhen(iso(atSeenX50))));
  w50.renderAnnouncements();

  const updatesTextX50 = w50.document.getElementById("annUpdates")?.textContent || "";
  const bothInUpdatesX50 = updatesTextX50.includes("Unseen headline") && updatesTextX50.includes("Seen headline");
  const barTextX50 = w50.document.getElementById("announceBar")?.textContent || "";
  const onlyUnseenInBarX50 = barTextX50.includes("Unseen headline") && !barTextX50.includes("Seen headline");
  const wrongYearExcludedX50 = !updatesTextX50.includes("Wrong year headline") && !barTextX50.includes("Wrong year headline");

  w50.location.hash = "#score";
  w50.dispatchEvent(new w50.Event("hashchange"));
  const displayScoreX50 = w50.getComputedStyle(w50.document.getElementById("announceBar")).display;

  w50.location.hash = "#board";
  w50.dispatchEvent(new w50.Event("hashchange"));
  const displayBoardX50 = w50.getComputedStyle(w50.document.getElementById("announceBar")).display;

  check("X50: §24 A-BANNER — Home's #annUpdates lists ALL current-season rows regardless of seen/unseen (a seeded watermark makes one seen, one unseen; both still listed; the bar itself only carries the unseen one); a wrong-year row (fresher than either current-season row) renders in NEITHER the bar NOR #annUpdates (current-season filter); navigating to #score computes #announceBar to display:none (suppression), and #board restores a non-none display",
    bothInUpdatesX50 && onlyUnseenInBarX50 && wrongYearExcludedX50 && displayScoreX50 === "none" && displayBoardX50 !== "none",
    "bothInUpdates="+bothInUpdatesX50+" onlyUnseenInBar="+onlyUnseenInBarX50+" wrongYearExcluded="+wrongYearExcludedX50+
      " displayScore="+displayScoreX50+" displayBoard="+displayBoardX50);
  domX50.window.close();
}

/* ---------------------------------------------------------------------
   GROUP X (cont'd) — §24 H-NOWNEXT: Now/Next strip resolver, selection,
   render honesty (Task 3)
   --------------------------------------------------------------------- */

// X51: scheduleInstants resolver truth — offset-anchored, TZ-independent.
// first_tee is a fixed FAR-FUTURE calendar date (2099-08-15, a confirmed
// Saturday) so expected epochs can be hand-computed from ISO strings,
// independent of the resolver under test (same far-future idiom as
// E2/X5, not a "real calendar date" in the time-bomb sense — it is never
// asserted to be "now"). A second dom swaps the offset to +09:00 (same
// calendar date, different UTC offset) to prove the offset CARRIED BY
// first_tee — not the test machine's TZ — is what drives every instant.
{
  const infoX51 = FIXTURES.info.replace("first_tee,2026-08-15T09:00:00-06:00", "first_tee,2099-08-15T09:00:00-06:00");
  const domX51 = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX51 }),
  }));
  await until(() => domX51.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const wX51 = domX51.window;

  const rowsX51 = [
    { label: "Friday", time: "3:00 pm" },
    { label: "Saturday", time: "9:00 am" },
    { label: "Sunday", time: "8:30 am" },
    { label: "Satruday", time: "9:00 am" },  // typo'd label — never in the byDay map
    { label: "Saturday", time: "noon" },      // unparseable time
  ];
  const outX51 = wX51.scheduleInstants(rowsX51);

  const expFriX51 = new Date("2099-08-14T15:00:00-06:00").getTime();
  const expSatX51 = new Date("2099-08-15T09:00:00-06:00").getTime();
  const expSunX51 = new Date("2099-08-16T08:30:00-06:00").getTime();

  const baseOkX51 = outX51[0].at === expFriX51 && outX51[1].at === expSatX51 && outX51[2].at === expSunX51;
  const nullsOkX51 = outX51[3].at === null && outX51[4].at === null;

  const infoX51b = FIXTURES.info.replace("first_tee,2026-08-15T09:00:00-06:00", "first_tee,2099-08-15T09:00:00+09:00");
  const domX51b = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX51b }),
  }));
  await until(() => domX51b.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const outX51b = domX51b.window.scheduleInstants(rowsX51.slice(0, 3));
  const shiftOkX51 = [0, 1, 2].every(i => outX51[i].at - outX51b[i].at === 15 * 3600000);

  check("X51: §24 H-NOWNEXT — scheduleInstants resolves Friday/Saturday/Sunday rows to the exact offset-anchored instant (independently computed from ISO strings), a typo'd label and an unparseable time both come back at:null, and swapping first_tee's offset from -06:00 to +09:00 shifts every instant by exactly 15h (the offset carried by first_tee — not host TZ — is the single owner of the day/time mapping)",
    baseOkX51 && nullsOkX51 && shiftOkX51,
    "base=" + JSON.stringify(outX51.map(x => x.at)) + " nulls=" + nullsOkX51 +
      " plus09=" + JSON.stringify(outX51b.map(x => x.at)) + " shiftOk=" + shiftOkX51);
  domX51.window.close();
  domX51b.window.close();
}

// X52: nowNextModel selection — pure calls, rows resolving off the same
// 2099/-06:00 fixture as X51 so expected instants stay independently
// hand-computed. Exercises: mid-day now/next with a day boundary
// crossed; McCall-midnight expiry (dayEnd, not the next row's start,
// ends "now"); before-all and after-all edges, including the "last row
// stays now until ITS OWN dayEnd" rule (not cleared the instant its own
// clock time has passed).
{
  const infoX52 = FIXTURES.info.replace("first_tee,2026-08-15T09:00:00-06:00", "first_tee,2099-08-15T09:00:00-06:00");
  const domX52 = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoX52 }),
  }));
  await until(() => domX52.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const wX52 = domX52.window;
  const rowsX52 = [
    { label: "Friday", time: "3:00 pm" },
    { label: "Saturday", time: "9:00 am" },
    { label: "Sunday", time: "8:30 am" },
  ];

  const friAtX52 = new Date("2099-08-14T15:00:00-06:00").getTime();
  const satAtX52 = new Date("2099-08-15T09:00:00-06:00").getTime();
  const satDayEndX52 = new Date("2099-08-16T00:00:00-06:00").getTime();  // McCall midnight ending Saturday
  const sunAtX52 = new Date("2099-08-16T08:30:00-06:00").getTime();

  const midSatX52 = wX52.nowNextModel(rowsX52, satAtX52 + 3600000); // Saturday 10am
  const midSatOkX52 = !!midSatX52.now && midSatX52.now.r.label === "Saturday" &&
    !!midSatX52.next && midSatX52.next.r.label === "Sunday";

  const pastMidnightX52 = wX52.nowNextModel(rowsX52, satDayEndX52 + 60000); // Saturday 23:59 McCall +1min past dayEnd
  const pastMidnightOkX52 = pastMidnightX52.now === null &&
    !!pastMidnightX52.next && pastMidnightX52.next.r.label === "Sunday";

  const beforeAllX52 = wX52.nowNextModel(rowsX52, friAtX52 - 3600000);
  const beforeAllOkX52 = beforeAllX52.now === null &&
    !!beforeAllX52.next && beforeAllX52.next.r.label === "Friday";

  const afterAllX52 = wX52.nowNextModel(rowsX52, sunAtX52 + 3600000); // Sunday 9:30am — still Sunday's calendar day
  const afterAllOkX52 = !!afterAllX52.now && afterAllX52.now.r.label === "Sunday" && afterAllX52.next === null;

  check("X52: §24 H-NOWNEXT — nowNextModel selection: mid-Saturday returns now=Saturday/next=Sunday (day boundary crossed); 1 minute past Saturday's McCall-midnight dayEnd expires 'now' to null while 'next' still resolves to Sunday; before all rows now=null/next=first (Friday); after the last row's own instant but still inside ITS dayEnd, now stays the last row (Sunday, not cleared) and next is null",
    midSatOkX52 && pastMidnightOkX52 && beforeAllOkX52 && afterAllOkX52,
    "midSat=" + JSON.stringify(midSatX52) + " pastMidnight=" + JSON.stringify(pastMidnightX52) +
      " beforeAll=" + JSON.stringify(beforeAllX52) + " afterAll=" + JSON.stringify(afterAllX52));
  domX52.window.close();
}

// X53: render honesty — #nowNext only ever claims a row it could
// actually resolve, and clears entirely off-phase. dynInfo(+1) keeps
// first_tee inside the ±3d event window (seasonPhase()==="event"); the
// resolvable row's day is the TEE DAY itself (k=0 in the resolver's
// byDay window) — since daysFromNow=+1, that calendar day (in the fixed
// -06:00 reference the fixture carries) is ALWAYS strictly later than
// "now"'s -06:00 calendar day, so the row deterministically lands as
// `next` (never `now`) no matter what wall-clock hour the suite runs at
// — no flakiness from real-time proximity. The unresolvable "Someday"
// label must still render on the Schedule tab (renderSchedule has no
// resolvability filter — only an `event` filter) but must never reach
// #nowNext's Now/Next claims. A second dom at dynInfo(+10) (off phase)
// proves the strip goes fully empty outside the event window.
{
  const WD_X53 = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const teeDateX53 = dynFirstTee(1).slice(0, 10);
  const teeWeekdayX53 = WD_X53[new Date(teeDateX53 + "T00:00:00Z").getUTCDay()];
  const scheduleX53 = "year,day,label,time,event,location\n" +
    `2026,Day One,${teeWeekdayX53},9:00 am,Round One,Meadow Creek\n` +
    `2026,Day Two,Someday,10:00 am,Mystery Session,Clubhouse\n`;

  const domX53a = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => dynInfo(1) }),
    schedule: () => Promise.resolve({ ok: true, status: 200, text: async () => scheduleX53 }),
  }));
  await until(() => domX53a.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const docX53a = domX53a.window.document;
  const nnHtmlX53a = docX53a.querySelector("#nowNext")?.innerHTML || "";
  const chipsX53a = docX53a.querySelectorAll('#nowNext a[href="#pairings"],#nowNext a[href="#board"],#nowNext a[href="#rooms"]').length;
  const claimsResolvableX53a = /Round One/.test(nnHtmlX53a) && /Meadow Creek/.test(nnHtmlX53a);
  const neverClaimsSomedayX53a = !/Someday/.test(nnHtmlX53a) && !/Mystery Session/.test(nnHtmlX53a);
  const scheduleTabTextX53a = docX53a.querySelector("#scheduleBody")?.textContent || "";
  const somedayInScheduleTabX53a = /Mystery Session/.test(scheduleTabTextX53a);
  domX53a.window.close();

  const domX53b = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => dynInfo(10) }),
    schedule: () => Promise.resolve({ ok: true, status: 200, text: async () => scheduleX53 }),
  }));
  await until(() => domX53b.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const nnHtmlX53b = domX53b.window.document.querySelector("#nowNext")?.innerHTML || "";
  const offPhaseEmptyX53b = nnHtmlX53b.trim() === "";
  domX53b.window.close();

  check("X53: §24 H-NOWNEXT — render honesty: inside the event window (dynInfo(+1)) #nowNext claims the resolvable row (event+location text) and shows exactly 3 static chips (#pairings/#board/#rooms), never claims the unresolvable 'Someday'/'Mystery Session' row even though that row still renders on the Schedule tab; off phase (dynInfo(+10)) #nowNext is entirely empty",
    claimsResolvableX53a && neverClaimsSomedayX53a && chipsX53a === 3 && somedayInScheduleTabX53a && offPhaseEmptyX53b,
    "claimsResolvable=" + claimsResolvableX53a + " neverClaimsSomeday=" + neverClaimsSomedayX53a +
      " chips=" + chipsX53a + " somedayInScheduleTab=" + somedayInScheduleTabX53a +
      " offPhaseEmpty=" + offPhaseEmptyX53b + " nn=" + JSON.stringify(nnHtmlX53a).slice(0, 300));
}

// X54: §24 H-REFRESH — the visibility seam. jsdom's own `document.hidden`
// defaults to true (a "prerender" tab) so the bootstrap's FIRST load() call
// (unconditional, not gated by pageVisible()) still fires regardless — only
// the periodic/wake path goes through the seam. refreshTick is a top-level
// function declaration in index.html's inline script, hence a `window`
// property the suite can call directly (no synthetic timer-advance needed).
// Fetches are counted by wrapping the fixture stub passed to makeDom.
{
  let fetchCountX54 = 0;
  const countingFetchX54 = (url) => { fetchCountX54++; return fakeFetch(url); };
  const domX54 = makeDom("", countingFetchX54);
  const docX54 = domX54.window.document;
  await until(() => docX54.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle(200); // let the bootstrap load()'s full cycle land before capturing the baseline count
  const afterInitialLoadX54 = fetchCountX54; // unconditional first load(): TABS.length fetches

  Object.defineProperty(docX54, "hidden", { configurable: true, get: () => true });
  // FT tiers: age history BEFORE the hidden tick too — otherwise nothing is
  // due and a DELETED seam would still fetch zero (mutation-proven vacuous).
  domX54.window.eval("Object.keys(LAST_GOT).forEach(t=>{LAST_GOT[t].reqAt-=COLD_MS+1000})");
  domX54.window.refreshTick();
  await settle(300); // give a (buggy) hidden-tab fetch every chance to land before asserting there isn't one
  const afterHiddenTickX54 = fetchCountX54;

  Object.defineProperty(docX54, "hidden", { configurable: true, get: () => false });
  // FT tiers (08-28): a load() only fetches DUE tabs — age all history past
  // COLD_MS so the wake fetch is observable; the seam remains what's tested.
  domX54.window.eval("Object.keys(LAST_GOT).forEach(t=>{LAST_GOT[t].reqAt-=COLD_MS+1000})");
  docX54.dispatchEvent(new domX54.window.Event("visibilitychange"));
  // settle, not a tight until(): fetchCountX54 jumps synchronously the instant
  // load()'s Promise.all(TABS.map(pull)) fires each pull()'s first fetch() call,
  // long before that load() cycle's own await-chain (fetch->res.text()->...->
  // paint()) actually finishes — a count-based until() would resolve mid-cycle
  // and let a later close() race a still-in-flight paint() (observed: crashes
  // on a post-close `document` inside renderInfo). settle() gives the WHOLE
  // cycle real wall-clock time to land before we read the counter or move on.
  await settle(300);
  const afterWakeX54 = fetchCountX54; // wake fires load() immediately, no 60s wait

  // FT tiers: age history again so the visible tick's fetch is observable.
  domX54.window.eval("Object.keys(LAST_GOT).forEach(t=>{LAST_GOT[t].reqAt-=COLD_MS+1000})");
  domX54.window.refreshTick();
  await settle(300); // same reasoning: let this tick's full load() cycle finish
  const afterTickX54 = fetchCountX54; // a subsequent visible refreshTick() still loads

  await settle(300); // drain any straggler before closing — close() nulls `document` under an in-flight paint()
  domX54.window.close();

  check("X54: §24 H-REFRESH — refreshTick() is a no-op while document.hidden is true (fetch count unchanged), flipping hidden to false and dispatching visibilitychange fires load() immediately (wake = instant freshness, no 60s wait), and a further refreshTick() while visible loads again (the retained cadence path)",
    afterHiddenTickX54 === afterInitialLoadX54 && afterWakeX54 > afterHiddenTickX54 && afterTickX54 > afterWakeX54,
    `initial=${afterInitialLoadX54} afterHiddenTick=${afterHiddenTickX54} afterWake=${afterWakeX54} afterTick=${afterTickX54}`);
}

// X55: §24 H-FRESH — event-phase Home stamp. eventStampFor reads pull()'s
// scores-tab result: live:true+at ⇒ the "Checked" honesty copy; a failed
// re-load falls to cacheTab's cache-served result (live:false, at = the
// cache's last-success write time — pull()'s own honesty rule, not
// re-derived here) ⇒ "Couldn't refresh" with the SAME h:mm, since a backoff
// poll can never advance the stamp. The h:mm itself is real-clock-dependent
// so it's asserted by shape, then by byte-identity across the two states
// (proves the failed fetch didn't silently re-stamp); the fixed copy around
// it is asserted byte-exact. Off phase (dynInfo(+10)) #homeSync is empty —
// #lbSync (untouched, per the spec amendment) carries the board's stamp.
{
  const domX55 = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => dynInfo(1) }),
  }));
  const docX55 = domX55.window.document;
  await until(() => docX55.querySelectorAll("#lbBody .lb-row").length > 0);
  await until(() => !!docX55.querySelector("#homeSync")?.textContent);
  const liveTextX55 = docX55.querySelector("#homeSync")?.textContent || "";
  const liveMatchX55 = /^Checked (\d{1,2}:\d{2}(?:am|pm)) · the sheet publishes a few minutes behind edits$/.exec(liveTextX55);
  const hmmX55 = liveMatchX55 ? liveMatchX55[1] : null;

  // Force the wake-visible path (jsdom's document.hidden defaults true — see
  // X54) so this refreshTick() actually re-loads, per the brief's mechanism.
  Object.defineProperty(docX55, "hidden", { configurable: true, get: () => false });
  domX55.window.fetch = () => Promise.reject(new Error("network down"));
  // FT tiers (08-28): age the history so this refreshTick's load() actually
  // attempts the (failing) fetches — the stamp honesty is what's tested.
  domX55.window.eval("Object.keys(LAST_GOT).forEach(t=>{LAST_GOT[t].reqAt-=COLD_MS+1000})");
  domX55.window.refreshTick();
  await until(() => /^Couldn't refresh/.test(docX55.querySelector("#homeSync")?.textContent || ""));
  const failTextX55 = docX55.querySelector("#homeSync")?.textContent || "";
  const failMatchX55 = hmmX55 !== null && failTextX55 === `Couldn't refresh — showing data from ${hmmX55}`;
  await settle(100); // drain any straggler before closing (X54's post-close crash lesson)
  domX55.window.close();

  const domX55b = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => dynInfo(10) }),
  }));
  await until(() => domX55b.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  await settle(300); // off-phase: prove #homeSync stays empty through a full paint, not just pre-render
  const offTextX55b = domX55b.window.document.querySelector("#homeSync")?.textContent || "";
  domX55b.window.close();

  check("X55: §24 H-FRESH — event-phase #homeSync reads 'Checked ‹h:mm› · the sheet publishes a few minutes behind edits' after a live load (h:mm = fmtClock of the scores tab's successful fetch); a subsequent failed refresh flips it to 'Couldn't refresh — showing data from ‹same h:mm›' (pull()'s cache-served at never advances the stamp); off-phase (dynInfo(+10)) #homeSync is empty",
    !!liveMatchX55 && failMatchX55 && offTextX55b === "",
    `live=${JSON.stringify(liveTextX55)} fail=${JSON.stringify(failTextX55)} off=${JSON.stringify(offTextX55b)}`);
}

// X57: §24 C-FALLBACK — hero sub + the .ics builder's LOCATION/DESCRIPTION
// lines compose from Info keys (heroLine()) instead of carrying a hardcoded
// fact that can outlive its year. Normal fixtures (course=Meadow Creek,
// lodging=Bear Creek Lodge) render the full sentence and the full LOCATION;
// an Info fetch with both keys missing (still a valid row set — just
// without those two) falls back to the neutral sentence, the bare
// "McCall, Idaho" LOCATION (no dangling prefix/comma), and the neutral
// DESCRIPTION. Review round 1 additions: (a) DESCRIPTION pin on the keyless
// run, and (b) icsEsc() — a lodging value carrying a comma must come out
// backslash-escaped per RFC 5545 TEXT, not corrupt the LOCATION field.
{
  const domX57a = makeDom("");
  const docX57a = domX57a.window.document;
  await until(() => docX57a.querySelectorAll("#lbBody .lb-row").length > 0);
  const heroX57a = (docX57a.querySelector("#heroSub")?.textContent || "").trim();

  let capturedBlobX57a = null;
  domX57a.window.URL.createObjectURL = (blob) => { capturedBlobX57a = blob; return "blob:captured-x57a"; };
  domX57a.window.URL.revokeObjectURL = () => {};
  docX57a.querySelector("#icsBtn").click();
  const icsTextX57a = capturedBlobX57a ? await capturedBlobX57a.text() : "";
  domX57a.window.close();

  const infoNoCourseLodgingX57 = FIXTURES.info.split(/\r?\n/)
    .filter(l => !l.startsWith("course,") && !l.startsWith("lodging,")).join("\n");
  const domX57b = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoNoCourseLodgingX57 }),
  }));
  const docX57b = domX57b.window.document;
  await until(() => docX57b.querySelectorAll("#lbBody .lb-row").length > 0);
  const heroX57b = (docX57b.querySelector("#heroSub")?.textContent || "").trim();

  let capturedBlobX57b = null;
  domX57b.window.URL.createObjectURL = (blob) => { capturedBlobX57b = blob; return "blob:captured-x57b"; };
  domX57b.window.URL.revokeObjectURL = () => {};
  docX57b.querySelector("#icsBtn").click();
  const icsTextX57b = capturedBlobX57b ? await capturedBlobX57b.text() : "";
  domX57b.window.close();

  // (c) review round 1 / icsEsc: lodging value carries a comma (CSV-quoted
  // so parseCSV keeps it as one field) — the .ics LOCATION line must carry
  // it backslash-escaped, not raw (which would split the TEXT field).
  const infoLodgingCommaX57 = FIXTURES.info.split(/\r?\n/)
    .map(l => l.startsWith("lodging,") ? 'lodging,"Bear Creek Lodge, Unit 4"' : l).join("\n");
  const domX57c = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoLodgingCommaX57 }),
  }));
  const docX57c = domX57c.window.document;
  await until(() => docX57c.querySelectorAll("#lbBody .lb-row").length > 0);

  let capturedBlobX57c = null;
  domX57c.window.URL.createObjectURL = (blob) => { capturedBlobX57c = blob; return "blob:captured-x57c"; };
  domX57c.window.URL.revokeObjectURL = () => {};
  docX57c.querySelector("#icsBtn").click();
  const icsTextX57c = capturedBlobX57c ? await capturedBlobX57c.text() : "";
  domX57c.window.close();

  check("X57: §24 C-FALLBACK — hero sub + .ics LOCATION/DESCRIPTION compose from Info via heroLine(): normal fixtures (course=Meadow Creek, lodging=Bear Creek Lodge) render the full hero sentence and the full LOCATION line; an Info fetch missing both course and lodging keys falls back to the neutral hero sentence, the bare LOCATION (no dangling comma/prefix), and the pinned neutral DESCRIPTION; a lodging value containing a comma (Bear Creek Lodge, Unit 4) comes out of icsEsc() backslash-escaped in LOCATION, not raw",
    heroX57a === "Two rounds at Meadow Creek. Two nights at Bear Creek Lodge. One trophy nobody wants to explain."
      && icsTextX57a.includes("LOCATION:Bear Creek Lodge, McCall, Idaho")
      && heroX57b === "Two rounds. Two nights. One trophy nobody wants to explain."
      && icsTextX57b.includes("LOCATION:McCall, Idaho") && !icsTextX57b.includes("LOCATION:Bear Creek Lodge")
      && icsTextX57b.includes("DESCRIPTION:Two rounds. Two nights.")
      && icsTextX57c.includes("Bear Creek Lodge\\, Unit 4"),
    "heroA=" + JSON.stringify(heroX57a) + " icsA=" + JSON.stringify(icsTextX57a) +
      " heroB=" + JSON.stringify(heroX57b) + " icsB=" + JSON.stringify(icsTextX57b) +
      " icsC=" + JSON.stringify(icsTextX57c));
}

// X58: §24 C-FALLBACK (review round 1) — the STATIC seed markup inside
// #scheduleBody (what paints before renderSchedule() ever runs, i.e. every
// page load until the schedule fetch resolves) must not carry last year's
// hardcoded fake weekend either. Source-level check (raw index.html text,
// not the rendered DOM): zero occurrences of the old "Steaks on the lodge
// grill" relic anywhere in the file, and the #scheduleBody seed region
// itself (pre-JS) carries the pinned honest empty-state string verbatim.
{
  const steaksCountX58 = (html.match(/Steaks on the lodge grill/g) || []).length;
  const schedBodySrcX58 = (html.match(/<div id="scheduleBody">([\s\S]*?)<\/div>/) || [, ""])[1];
  check("X58: §24 C-FALLBACK — index.html source contains zero occurrences of the old hardcoded 'Steaks on the lodge grill' fact, and the static #scheduleBody seed markup (pre-JS, first paint) carries the pinned honest empty-state string verbatim",
    steaksCountX58 === 0
      && schedBodySrcX58.includes("Schedule not loaded yet — it lives in the sheet's Schedule tab."),
    "steaksCount=" + steaksCountX58 + " schedBodySrc=" + JSON.stringify(schedBodySrcX58));
}

/* ---------------------------------------------------------------------
   EV group — §24 R-READY (task 6): tools/event-ready.mjs preflight checks.
   Pure unit tests over the exported check functions with inline fixture
   row arrays (the toRows() shape: lowercase-keyed objects, trimmed string
   values) — no network, no fetch mocking. main() is the only fetch site
   and is intentionally not unit-tested here.

   FORWARD-RISK (Task 1 review, binding): sample-fingerprints.json carries
   real-calendar dates from the template's sample rows. Every `now` below
   is a synthetic fixture instant (Date.UTC/local Date literal picked for
   the test's own arithmetic), never "real today" — these tests must stay
   true regardless of what today's real date is.
   --------------------------------------------------------------------- */

// EV1: checkFirstTee — malformed/incomplete first_tee FAILs before anything
// else (no fallthrough to a false PASS via NaN comparisons); a first_tee
// >7 days past `now` WARNs "year rollover?".
{
  const nowEV1 = Date.UTC(2026, 7, 20);
  const r1a = checkFirstTee("2026-13-01", nowEV1);
  const r1b = checkFirstTee("2026-08-01T09:00:00-06:00", nowEV1);
  check("EV1: checkFirstTee — an incomplete/malformed first_tee (no ISO+offset shape) FAILs before anything else; a first_tee >7 days past `now` WARNs 'year rollover'",
    r1a.level === "FAIL" && /unparseable/.test(r1a.detail) &&
      r1b.level === "WARN" && /rollover/i.test(r1b.detail),
    "r1a=" + JSON.stringify(r1a) + " r1b=" + JSON.stringify(r1b));
}

// EV2: checkResidue — a verbatim template Field row FAILs naming tab+row;
// the same row with ONE cell edited PASSes (documents the stated
// verbatim-only limit — an edited-in-place sample is out of reach).
{
  const fpEV2 = { field: [["2026", "Duck", "Duck", "2019", "8", "In", "TRUE", "", "steady off the tee"]] };
  const verbatimEV2 = { field: [["2026", "Duck", "Duck", "2019", "8", "In", "TRUE", "", "steady off the tee"]] };
  const editedEV2 = { field: [["2026", "Duck", "Duck", "2019", "9", "In", "TRUE", "", "steady off the tee"]] };
  const rVerbatim = checkResidue(verbatimEV2, fpEV2);
  const rEdited = checkResidue(editedEV2, fpEV2);
  check("EV2: checkResidue — a verbatim template Field row FAILs naming tab+row; the same row with ONE cell edited PASSes (documents the stated verbatim-only limit)",
    rVerbatim.length === 1 && rVerbatim[0].level === "FAIL" &&
      /field row 2/.test(rVerbatim[0].detail) &&
      rEdited.length === 1 && rEdited[0].level === "PASS",
    "verbatim=" + JSON.stringify(rVerbatim) + " edited=" + JSON.stringify(rEdited));
}

// EV3: checkSchedule — a missing event day FAILs naming the day; an
// unresolvable row label FAILs naming the row; full coverage with
// resolvable rows PASSes alongside an INFO line naming the window basis.
{
  const ftEV3 = "2026-08-15T09:00:00-06:00"; // Fri/Sat/Sun = Aug 14/15/16
  const yearEV3 = "2026";
  const missing = checkSchedule(
    [{ year: "2026", label: "Friday", time: "3:00 pm" }, { year: "2026", label: "Saturday", time: "9:00 am" }],
    ftEV3, "Aug 14–16", yearEV3);
  const badLabel = checkSchedule(
    [{ year: "2026", label: "Friday", time: "3:00 pm" }, { year: "2026", label: "Saturday", time: "9:00 am" }, { year: "2026", label: "Blursday", time: "9:00 am" }],
    ftEV3, "Aug 14–16", yearEV3);
  const clean = checkSchedule(
    [{ year: "2026", label: "Friday", time: "3:00 pm" }, { year: "2026", label: "Saturday", time: "9:00 am" }, { year: "2026", label: "Sunday", time: "8:30 am" }],
    ftEV3, "Aug 14–16", yearEV3);
  check("EV3: checkSchedule — a missing event day FAILs naming the day; an unresolvable row label FAILs naming the row; full coverage PASSes with an INFO line naming the window basis",
    missing.some(r => r.level === "FAIL" && r.detail.includes("2026-08-16")) &&
      badLabel.some(r => r.level === "FAIL" && r.detail.includes("row 4") && r.detail.includes("Blursday")) &&
      clean.some(r => r.level === "INFO" && /basis/.test(r.detail)) &&
      clean.some(r => r.level === "PASS"),
    "missing=" + JSON.stringify(missing) + " badLabel=" + JSON.stringify(badLabel) + " clean=" + JSON.stringify(clean));
}

// EV3b: checkSchedule — a resolvable row from the WRONG year must not
// satisfy target-year coverage (year-rollover false-PASS class from the
// whole-branch review: leftover prior-year rows must not paper over a
// missing current-year day, matching forYear's strict year filter).
{
  const ftEV3b = "2026-08-15T09:00:00-06:00"; // Fri/Sat/Sun = Aug 14/15/16
  const yearEV3b = "2026";
  const wrongYear = checkSchedule(
    [{ year: "2026", label: "Friday", time: "3:00 pm" },
     { year: "2026", label: "Saturday", time: "9:00 am" },
     { year: "2025", label: "Sunday", time: "8:30 am" }], // last year's Sunday row — resolvable, but wrong year
    ftEV3b, "Aug 14–16", yearEV3b);
  check("EV3b: checkSchedule — a resolvable row from a prior year does NOT satisfy target-year coverage; the missing day still FAILs even though a same-label/time row exists under the wrong year",
    wrongYear.some(r => r.level === "FAIL" && r.detail.includes("2026-08-16")) &&
      !wrongYear.some(r => r.level === "FAIL" && /Sunday/.test(r.detail)),
    "wrongYear=" + JSON.stringify(wrongYear));
}

// EV3c: checkSchedule — an archive-year row with a garbage label/time must
// NOT FAIL the per-row resolution check (Now/Next never reads a
// non-target-year row, so it should never false-FAIL the label/time
// resolution class either); target-year coverage still PASSes.
{
  const ftEV3c = "2026-08-15T09:00:00-06:00"; // Fri/Sat/Sun = Aug 14/15/16
  const yearEV3c = "2026";
  const archiveGarbage = checkSchedule(
    [{ year: "2026", label: "Friday", time: "3:00 pm" },
     { year: "2026", label: "Saturday", time: "9:00 am" },
     { year: "2026", label: "Sunday", time: "8:30 am" },
     { year: "2019", label: "Whenevs", time: "not-a-time" }], // archive-year garbage row
    ftEV3c, "Aug 14–16", yearEV3c);
  check("EV3c: checkSchedule — an archive-year row with an unresolvable label/time does not FAIL (filtered out before resolution logic runs); full target-year coverage still PASSes",
    !archiveGarbage.some(r => r.level === "FAIL") &&
      archiveGarbage.some(r => r.level === "PASS"),
    "archiveGarbage=" + JSON.stringify(archiveGarbage));
}

// EV4: checkPairings — a round with no timed row FAILs naming the round;
// every round timed PASSes; zero rows for the target year FAILs.
{
  const bad = checkPairings(
    [{ year: "2026", round: "Round One", time: "9:00 am" }, { year: "2026", round: "Round Two", time: "" }],
    "2026");
  const clean = checkPairings(
    [{ year: "2026", round: "Round One", time: "9:00 am" }, { year: "2026", round: "Round Two", time: "8:30 am" }],
    "2026");
  const noYear = checkPairings([{ year: "2025", round: "Round One", time: "9:00 am" }], "2026");
  check("EV4: checkPairings — a round with no row carrying a parseable time FAILs naming the round; every round timed PASSes; zero rows for the target year FAILs",
    bad.some(r => r.level === "FAIL" && /Round Two/.test(r.detail)) &&
      clean.length === 1 && clean[0].level === "PASS" &&
      noYear.length === 1 && noYear[0].level === "FAIL",
    "bad=" + JSON.stringify(bad) + " clean=" + JSON.stringify(clean) + " noYear=" + JSON.stringify(noYear));
}

// EV5: checkPars — 18/18 positive-int pars PASSes; a missing hole FAILs
// naming it; missing/non-int yards WARN only (yards optional per-hole).
{
  const full18 = Array.from({ length: 18 }, (_, i) => ({ hole: String(i + 1), par: "4", yards: String(300 + i) }));
  const okAll = checkPars(full18);
  const missingPar = checkPars(full18.slice(0, 17));
  const missingYards = checkPars(full18.map((r, i) => (i === 0 ? { ...r, yards: "" } : r)));
  check("EV5: checkPars — 18/18 positive-int pars PASSes; a missing hole's par FAILs naming the hole; missing/non-int yards WARN only",
    okAll.length === 1 && okAll[0].level === "PASS" &&
      missingPar.some(r => r.level === "FAIL" && /hole\(s\) 18\b/.test(r.detail)) &&
      missingYards.some(r => r.level === "WARN" && /hole\(s\) 1\b/.test(r.detail)),
    "okAll=" + JSON.stringify(okAll) + " missingPar=" + JSON.stringify(missingPar) + " missingYards=" + JSON.stringify(missingYards));
}

// EV6: checkScorer — score_endpoint absent FAILs; an https://script.google.com/...
// URL PASSes; form_url absent is INFO only (optional by design, README:314);
// form_url present but not forms.gle/docs.google.com/forms FAILs.
{
  const rAbsent = checkScorer({});
  const rArmed = checkScorer({ score_endpoint: "https://script.google.com/macros/s/abc/exec" });
  const rBadForm = checkScorer({ score_endpoint: "https://script.google.com/macros/s/abc/exec", form_url: "https://example.com/form" });
  check("EV6: checkScorer — score_endpoint absent FAILs; a valid script.google.com URL PASSes; form_url absent is INFO only; form_url present but wrong-shape FAILs",
    rAbsent.some(r => r.level === "FAIL" && /score_endpoint/.test(r.detail)) &&
      rAbsent.some(r => r.level === "INFO" && /form_url/.test(r.detail)) &&
      rArmed.some(r => r.level === "PASS" && /score_endpoint/.test(r.detail)) &&
      rBadForm.some(r => r.level === "FAIL" && /form_url/.test(r.detail)),
    "absent=" + JSON.stringify(rAbsent) + " armed=" + JSON.stringify(rArmed) + " badForm=" + JSON.stringify(rBadForm));
}

// EV7: checkField — a missing handicap on a target-year row WARNs; zero
// target-year rows FAILs; non-target-year rows are never flagged.
{
  const rowsEV7 = [
    { year: "2026", player: "Duck", handicap: "8" },
    { year: "2026", player: "Hammer", handicap: "" },
    { year: "2027", player: "Duck", handicap: "" },
  ];
  const rWarn = checkField(rowsEV7, "2026");
  const rNoRows = checkField(rowsEV7, "2099");
  check("EV7: checkField — a missing handicap on a target-year row WARNs; zero target-year rows FAILs; non-target-year rows (Next Year collections) are never flagged",
    rWarn.some(r => r.level === "WARN" && /handicap/.test(r.detail)) &&
      !rWarn.some(r => r.level === "FAIL") &&
      rNoRows.length === 1 && rNoRows[0].level === "FAIL",
    "warn=" + JSON.stringify(rWarn) + " noRows=" + JSON.stringify(rNoRows));
}

// EV8: checkAnnounce — zero rows is INFO only (first morning must not cry
// wolf); the newest post older than the current event day, inside the
// event window, WARNs; a >24h-future `when` WARNs naming the row.
{
  function fmtLocalEV8(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const nowEV8 = new Date(2026, 7, 15, 12, 0, 0).getTime();
  const winStartEV8 = nowEV8 - 5 * 86400000, winEndEV8 = nowEV8 + 5 * 86400000;
  const zero = checkAnnounce([], nowEV8, winStartEV8, winEndEV8);
  const stale = checkAnnounce([{ when: "2026-08-10 09:00", message: "old" }], nowEV8, winStartEV8, winEndEV8);
  const future = checkAnnounce([{ when: fmtLocalEV8(nowEV8 + 30 * 3600000), message: "future" }], nowEV8, winStartEV8, winEndEV8);
  check("EV8: checkAnnounce — zero rows is INFO only; the newest post older than today inside the event window WARNs; a >24h-future `when` WARNs naming the row",
    zero.length === 1 && zero[0].level === "INFO" &&
      stale.some(r => r.level === "WARN" && /older than today/.test(r.detail)) &&
      future.some(r => r.level === "WARN" && /future/.test(r.detail)),
    "zero=" + JSON.stringify(zero) + " stale=" + JSON.stringify(stale) + " future=" + JSON.stringify(future));
}

// EV9: checkCrossTab — scores.team "Duck" with Field teams ["Jake","Greg"]
// FAILs; calcutta.team mismatch FAILs; rooms.player "Pat" not in field and
// not "guest:"-prefixed WARNs; "guest:Pat" never flags. (2026-08-15 live shape.)
{
  const fieldEV9 = [{ year: "2026", player: "Jake", team: "Jake" }, { year: "2026", player: "Greg", team: "Jake" }];
  const rBad = checkCrossTab({
    scores: [{ year: "2026", team: "Duck" }],
    calcutta: [{ year: "2026", team: "Duck", owner: "Sully" }],
    rooms: [{ year: "2026", player: "Pat" }],
    field: fieldEV9,
  }, "2026");
  const rGuest = checkCrossTab({
    scores: [], calcutta: [],
    rooms: [{ year: "2026", player: "guest:Pat" }],
    field: fieldEV9,
  }, "2026");
  check("EV9: checkCrossTab — scores.team not in Field FAILs; calcutta.team not in Field FAILs; rooms.player not in Field and not guest:-prefixed WARNs; guest:-prefixed never flags",
    rBad.some(r => r.level === "FAIL" && /scores\.team "Duck"/.test(r.detail)) &&
      rBad.some(r => r.level === "FAIL" && /calcutta\.team "Duck"/.test(r.detail)) &&
      rBad.some(r => r.level === "WARN" && /rooms\.player "Pat"/.test(r.detail)) &&
      rGuest.length === 1 && rGuest[0].level === "PASS",
    "bad=" + JSON.stringify(rBad) + " guest=" + JSON.stringify(rGuest));
}

// EV10: checkFallbackParity — config FIRST_TEE vs Info first_tee drift
// WARNs; a matching pair with the pinned empty-state string and no stale
// facts-literal PASSes; a missing empty-state string FAILs; a hardcoded
// "Aug \d" literal inside the facts block FAILs. Fixtures use the REAL
// index.html class shape (`class="facts rise d4"`, index.html:918) — not a
// bare `class="facts"`, which doesn't exist in the app and made the check
// vacuous (review round 1: factsBlock was always "" against real markup, so
// the FAIL branch could never fire no matter what got hardcoded back).
{
  const cfgTextEV10 = 'window.CONFIG = { FIRST_TEE: "2026-08-15T09:00:00-06:00" };';
  const infoRowsMatch = [{ key: "first_tee", value: "2026-08-15T09:00:00-06:00" }];
  const infoRowsDrift = [{ key: "first_tee", value: "2027-08-14T09:00:00-06:00" }];
  const htmlGood = '<dl class="facts rise d4"><dd data-info="dates">—</dd></dl>Schedule not loaded yet — it lives in the sheet\'s Schedule tab.';
  const htmlMissingEmptyState = '<dl class="facts rise d4"><dd data-info="dates">—</dd></dl>';
  const htmlStaleLiteral = '<dl class="facts rise d4"><dd data-info="dates">Aug 14–16</dd></dl>Schedule not loaded yet — it lives in the sheet\'s Schedule tab.';
  const drift = checkFallbackParity(cfgTextEV10, htmlGood, infoRowsDrift);
  const clean = checkFallbackParity(cfgTextEV10, htmlGood, infoRowsMatch);
  const missingEmpty = checkFallbackParity(cfgTextEV10, htmlMissingEmptyState, infoRowsMatch);
  const staleFact = checkFallbackParity(cfgTextEV10, htmlStaleLiteral, infoRowsMatch);

  // Real-shape proof (review round 1, Important): the exact multi-<div>
  // #home facts markup index.html actually renders (index.html:918-923),
  // with the Dates <dd> hardcoded back to "Aug 14–16" instead of the honest
  // "—" fallback. Must FAIL — this is the literal regression check (i)
  // exists to catch, and the pre-fix regex missed it entirely.
  const htmlRealShapeStale =
    '<dl class="facts rise d4">\n' +
    '  <div class="fact"><dt>Dates</dt><dd data-info="dates">Aug 14–16</dd></div>\n' +
    '  <div class="fact"><dt>Course</dt><dd data-info="course">—</dd></div>\n' +
    '  <div class="fact"><dt>Lodging</dt><dd data-info="lodging">—</dd></div>\n' +
    '  <div class="fact"><dt>Format</dt><dd data-info="format">—</dd></div>\n' +
    '</dl>\n' +
    'Schedule not loaded yet — it lives in the sheet\'s Schedule tab.';
  const realShapeStale = checkFallbackParity(cfgTextEV10, htmlRealShapeStale, infoRowsMatch);

  check("EV10: checkFallbackParity — config/Info first_tee drift WARNs; a clean matching pair (real facts-rise-d4 shape) PASSes; a missing pinned empty-state string FAILs; a hardcoded 'Aug \\d' literal in the facts block FAILs against the REAL `class=\"facts rise d4\"` shape (not just a nonexistent bare `class=\"facts\"`)",
    drift.some(r => r.level === "WARN" && /FIRST_TEE/.test(r.detail)) &&
      clean.length === 1 && clean[0].level === "PASS" &&
      missingEmpty.some(r => r.level === "FAIL" && /empty-state/.test(r.detail)) &&
      staleFact.some(r => r.level === "FAIL" && /Aug/.test(r.detail)) &&
      realShapeStale.some(r => r.level === "FAIL" && /Aug/.test(r.detail)),
    "drift=" + JSON.stringify(drift) + " clean=" + JSON.stringify(clean) +
      " missingEmpty=" + JSON.stringify(missingEmpty) + " staleFact=" + JSON.stringify(staleFact) +
      " realShapeStale=" + JSON.stringify(realShapeStale));
}

// EV11: checkInvitesPromotion — a committed Invites row with no same-year
// Field row WARNs naming the player + the sheet menu ("promotion not yet
// run"); a committed row whose player HAS a same-year Field row (F-NKEY
// name matching: trim + collapse internal whitespace + casefold) PASSes; a
// prior-YEAR Field row never satisfies it; committed AND status out/declined
// WARNs as a contradictory row (and is NOT also flagged as unpromoted);
// unticked rows never flag; zero committed rows is a quiet PASS.
{
  const fieldEV11 = [
    { year: "2027", player: "Duck  Jones" },            // internal double space — NKEY must still match
    { year: "2026", player: "Tex" },                    // prior-year row only
  ];
  // Sully carries invited_by: he's a first-time invitee, and without a
  // sponsor the EV12 sponsor WARN would (correctly) fire here too — this
  // case isolates the promotion logic's quiet-PASS.
  const none = checkInvitesPromotion(
    [{ year: "2027", player: "Sully", invited: "TRUE", responded: "TRUE", committed: "", invited_by: "Duck" }], fieldEV11);
  const pending = checkInvitesPromotion(
    [{ year: "2027", player: "Wade Johnson", committed: "TRUE" }], fieldEV11);
  // invited_by here too: Duck Jones' only Field row is the SAME year (the
  // promoted row), so under the review-hardened first-timer definition
  // (no Field row EARLIER than the invite year) he'd correctly draw a
  // sponsor WARN — sponsored to isolate the promotion check.
  const promoted = checkInvitesPromotion(
    [{ year: "2027", player: "duck jones", committed: "TRUE", invited_by: "Tex" }], fieldEV11);
  const priorYear = checkInvitesPromotion(
    [{ year: "2027", player: "Tex", committed: "TRUE" }], fieldEV11);
  const contra = checkInvitesPromotion(
    [{ year: "2027", player: "Bear", committed: "TRUE", status: "declined" }], fieldEV11);
  check("EV11: checkInvitesPromotion — committed w/o same-year Field row WARNs (names player + menu); committed with NKEY-matched same-year Field row PASSes; a prior-year Field row never satisfies; committed+out/declined WARNs as contradictory only; unticked/zero committed rows PASS quietly",
    none.length === 1 && none[0].level === "PASS" &&
      pending.some(r => r.level === "WARN" && /"Wade Johnson" \(2027\) committed but has no Field row/.test(r.detail) && /Promote committed/.test(r.detail)) &&
      promoted.length === 1 && promoted[0].level === "PASS" &&
      priorYear.some(r => r.level === "WARN" && /"Tex" \(2027\) committed but has no Field row/.test(r.detail)) &&
      contra.some(r => r.level === "WARN" && /contradictory/.test(r.detail)) &&
      !contra.some(r => /no Field row/.test(r.detail)),
    "none=" + JSON.stringify(none) + " pending=" + JSON.stringify(pending) +
      " promoted=" + JSON.stringify(promoted) + " priorYear=" + JSON.stringify(priorYear) +
      " contra=" + JSON.stringify(contra));
}

// EV12: sponsor accountability (Riley 2026-08-24: track who invited who) —
// a FIRST-TIME invitee (no Field row in ANY season, F-NKEY matched) with a
// blank invited_by WARNs, scoped to the LATEST Invites year only (historic
// rows can't retroactively grow sponsors — no noise); a sponsored
// first-timer and a returning player without a sponsor never WARN; the
// WARN fires independent of the committed tick.
{
  const fieldEV12 = [
    { year: "2026", player: "duck  jones" },      // NKEY: casefold + collapse must match
    { year: "2027", player: "Promoted Kid" },     // SAME-year row only — a promote ran before the sponsor was recorded
  ];
  const r = checkInvitesPromotion([
    { year: "2027", player: "Fresh Face", invited: "TRUE", invited_by: "" },      // WARN — first-timer, no sponsor, not even committed
    { year: "2027", player: "Sponsored Kid", invited: "TRUE", invited_by: "Tex" },// ok — sponsored
    { year: "2027", player: "Duck Jones", invited: "TRUE", invited_by: "" },      // ok — returning (2026 Field row, NKEY, EARLIER year)
    { year: "2026", player: "Old Ghost", invited: "TRUE", invited_by: "" },       // ok — not the latest Invites year
    { year: "2027", player: "Promoted Kid", committed: "TRUE", invited_by: "" },  // WARN — a same-year Field row must NOT launder a first-timer into "returning" (review F2)
    { year: "2027", player: "Twin Rows", invited: "TRUE", invited_by: "" },       // ok — sponsor lives on the OTHER duplicate row (per-person, review F8)
    { year: "2027", player: "Twin Rows", invited: "TRUE", invited_by: "Tex" },
  ], fieldEV12);
  check("EV12: first-time invitee w/o invited_by WARNs (latest Invites year only, committed not required); sponsored first-timer, EARLIER-year returning player, and older-year rows never WARN; a SAME-year (just-promoted) Field row keeps the WARN alive; duplicate rows are judged per-person (any row's sponsor satisfies)",
    r.some(x => x.level === "WARN" && /"Fresh Face" \(2027\)/.test(x.detail) && /invited_by/.test(x.detail))
      && !r.some(x => /Sponsored Kid/.test(x.detail))
      && !r.some(x => /Duck Jones/.test(x.detail))
      && !r.some(x => /Old Ghost/.test(x.detail))
      && r.some(x => x.level === "WARN" && /"Promoted Kid" \(2027\)/.test(x.detail) && /invited_by/.test(x.detail))
      && !r.some(x => /Twin Rows/.test(x.detail) && /invited_by/.test(x.detail)),
    JSON.stringify(r));
}

// EV13 (review F7): one fat-fingered year (20277) must not hijack the
// latest-year scope and silently disable the sponsor check for the real
// season — years outside 2000-2100 are ignored when picking the scope.
{
  const r = checkInvitesPromotion([
    { year: "20277", player: "Typo Row", invited: "TRUE", invited_by: "" },
    { year: "2027", player: "Real Rookie", invited: "TRUE", invited_by: "" },
  ], []);
  check("EV13: a junk year (20277) never becomes the sponsor-check scope — the real 2027 first-timer still WARNs",
    r.some(x => x.level === "WARN" && /"Real Rookie" \(2027\)/.test(x.detail) && /invited_by/.test(x.detail)),
    JSON.stringify(r));
}

/* ---------------------------------------------------------------------
   GROUP FV — Field veterans-priority display + invited_by (sponsor) lens.
   Riley rulings 2026-08-24: veterans ALWAYS outrank rookies (pre-draft
   flat roster sorts by `since`); who-invited-who is recorded on Invites
   (`invited_by`), shown as "via X" ONLY under ?admin=1.
   --------------------------------------------------------------------- */

// FV1+FV2: pre-draft flat state (no team values this season) — rows order
// veterans-first by since (rookie last among known, junk since sorts after
// everything, sheet order breaks ties), and the count strip counts ONLY
// status-In rows: a wd row is listed but counted neither as in nor as paid
// (its deposit tick must not inflate "paid" — S12).
{
  const flatCSV = [
    "year,player,team,since,handicap,status,deposit,paid_date,strengths",
    "2026,Newguy,,2026,,In,FALSE,,",
    "2026,Duck,,2019,8,In,TRUE,,",
    "2026,Midvet,,2022,12,In,TRUE,,",
    "2026,Junky,,oops,7,In,FALSE,,",
    "2026,Wady,,2020,9,wd,TRUE,,",
  ].join("\n");
  const flatFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => flatCSV }),
  });
  const domFV = makeDom("", flatFetch);
  await until(() => (domFV.window.document.querySelectorAll("#fldBody .fld").length) > 0);
  const dFV = domFV.window.document;
  const namesFV = [...dFV.querySelectorAll("#fldBody .fld")]
    .map(r => (r.querySelector("div")?.textContent || "").replace(/ROOKIE|\d+\w+ year/g, "").trim());
  check("FV1: flat pre-draft roster sorts veterans-first by since (Duck 2019, Wady 2020, Midvet 2022, Newguy 2026, junk-since last) with zero .team-group wrappers",
    JSON.stringify(namesFV) === JSON.stringify(["Duck", "Wady", "Midvet", "Newguy", "Junky"])
      && dFV.querySelectorAll("#fldBody .team-group").length === 0,
    "names=" + JSON.stringify(namesFV));
  const stripFV = dFV.querySelector("#fldBody .fld-strip");
  check("FV2: count strip counts only status-In rows — '4 in · 2 paid · 2 owing' (Wady wd: listed but excluded from in AND paid despite deposit TRUE)",
    !!stripFV && (stripFV.textContent || "").trim() === "4 in · 2 paid · 2 owing",
    "strip=" + JSON.stringify(stripFV?.textContent));
  domFV.window.close();
}

// FV3: all-blank statuses (the raw next-year collection shape) — the strip
// does NOT render at all: no claim beats a misleading "0 in" over a list
// of 2 visible people (S12). Rows themselves still list.
{
  const blankCSV = [
    "year,player,team,since,handicap,status,deposit,paid_date,strengths",
    "2026,Ghosty,,2019,,,TRUE,,",
    "2026,Newish,,2026,,,,,",
  ].join("\n");
  const blankFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => blankCSV }),
  });
  const domFV3 = makeDom("", blankFetch);
  await until(() => (domFV3.window.document.querySelectorAll("#fldBody .fld").length) > 0);
  const dFV3 = domFV3.window.document;
  check("FV3: zero status-In rows — no .fld-strip rendered, both rows still listed",
    !dFV3.querySelector("#fldBody .fld-strip")
      && dFV3.querySelectorAll("#fldBody .fld").length === 2,
    "strip=" + JSON.stringify(dFV3.querySelector("#fldBody .fld-strip")?.textContent) +
      " rows=" + dFV3.querySelectorAll("#fldBody .fld").length);
  domFV3.window.close();
}

// FV4: the strip also renders in the team-grouped state — standard 2026
// fixture: 9 rows, all In, all paid → "9 in · 9 paid", and the zero-owing
// segment is omitted rather than shown as "0 owing". Own dom: the shared
// top-level doc's year picker has been moved by earlier tests (T8-class
// shared-state trap), so this asserts against a fresh deterministic render.
{
  const domFV4 = makeDom("");
  await until(() => (domFV4.window.document.querySelectorAll("#fldBody .team-group").length) > 0);
  const stripFV4 = domFV4.window.document.querySelector("#fldBody .fld-strip");
  check("FV4: grouped-state strip on the standard fixture reads exactly '9 in · 9 paid' (no owing segment at zero)",
    !!stripFV4 && (stripFV4.textContent || "").trim() === "9 in · 9 paid",
    "strip=" + JSON.stringify(stripFV4?.textContent));
  domFV4.window.close();
}

// FV5: invited_by — admin funnel names carry "via <sponsor>"; the public
// view NEVER does, anywhere in the Next Year board (leak guard: same
// override, no ?admin). Sponsor shows on stage lists AND the Declined list.
{
  const invCSV = [
    "year,player,invited,responded,status,committed,invited_by",
    "2027,Duck,TRUE,TRUE,,,",
    "2027,Newbie,TRUE,,,,Duck",
    "2027,Quitty,TRUE,TRUE,declined,,Hammer",
  ].join("\n");
  const viaFetch = withOverride({
    invites: () => Promise.resolve({ ok: true, status: 200, text: async () => invCSV }),
  });
  const domPub = makeDom("", viaFetch);
  const domAdm = makeDom("?admin=1", viaFetch);
  await until(() => (domPub.window.document.querySelector("#nyBody")?.textContent || "").includes("paid"));
  await until(() => (domAdm.window.document.querySelector("#nyBody")?.textContent || "").includes("Invited"));
  const pubText = domPub.window.document.querySelector("#nyBody")?.textContent || "";
  const admText = domAdm.window.document.querySelector("#nyBody")?.textContent || "";
  check("FV5: ?admin=1 shows 'via Duck' beside Newbie (Invited) and 'via Hammer' beside Quitty (Declined); the public board contains NEITHER string anywhere",
    /Newbie/.test(admText) && /via Duck/.test(admText)
      && /Quitty/.test(admText) && /via Hammer/.test(admText)
      && /Newbie/.test(pubText) === false            // Newbie is invited-stage: name itself is admin-only
      && !/via Duck/.test(pubText) && !/via Hammer/.test(pubText),
    "adm=" + admText.slice(0, 400) + " pub=" + pubText.slice(0, 300));
  domPub.window.close(); domAdm.window.close();
}

// FV6 (review F6): duplicate same-year rows for one player must not
// inflate the count strip — counts are per PERSON (nkey, last row wins,
// mirroring the grouped branch's byPlayer semantics): Duck's two rows
// count once, with his LAST row's unpaid deposit deciding paid/owing.
// The flat list itself still renders every row (existing behavior).
{
  const dupCSV = [
    "year,player,team,since,handicap,status,deposit,paid_date,strengths",
    "2026,Duck,,2019,8,In,TRUE,,",
    "2026,Duck,,2019,8,In,FALSE,,",
    "2026,Vet,,2020,10,In,TRUE,,",
  ].join("\n");
  const dupFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => dupCSV }),
  });
  const domFV6 = makeDom("", dupFetch);
  await until(() => (domFV6.window.document.querySelectorAll("#fldBody .fld").length) > 0);
  const dFV6 = domFV6.window.document;
  const stripFV6 = dFV6.querySelector("#fldBody .fld-strip");
  check("FV6: dup same-year rows count as one person, last row wins — '2 in · 1 paid · 1 owing' over 3 rendered rows",
    !!stripFV6 && (stripFV6.textContent || "").trim() === "2 in · 1 paid · 1 owing"
      && dFV6.querySelectorAll("#fldBody .fld").length === 3,
    "strip=" + JSON.stringify(stripFV6?.textContent) +
      " rows=" + dFV6.querySelectorAll("#fldBody .fld").length);
  domFV6.window.close();
}

/* ===== §25a broadcast-core checks ===== */
{ // T1: score tiers + tokens + mechanical contrast
  const idx = readFileSync(path.join(ROOT, "index.html"), "utf8");
  // token presence
  const tokPresentT1a = {
    under: /--score-under:\s*#D08A76/.test(idx), even: /--score-even:\s*#C8A24A/.test(idx),
    over: /--score-over:\s*#E9E3D3/.test(idx), bogey: /--score-bogey:\s*#8A9B8C/.test(idx),
    blowup: /--score-blowup:\s*#B0705E/.test(idx),
  };
  check("S25a-T1a: five semantic score tokens on :root",
    Object.values(tokPresentT1a).every(Boolean),
    "found=" + JSON.stringify(tokPresentT1a));
  // tier boundaries via the page's own scoreClass (jsdom window from the suite's dom —
  // index.html's scripts are plain non-module <script> tags run with runScripts:
  // "dangerously", so a top-level `function scoreClass(...)` attaches directly to
  // dom.window, same as any other global in this suite's main `dom`)
  const scoreClass = dom.window.scoreClass;
  const scT1b = {
    eagle: scoreClass(2,4), under: scoreClass(3,4), even: scoreClass(4,4),
    bogey: scoreClass(5,4), blowup1: scoreClass(6,4), blowup2: scoreClass(9,4),
    par0: scoreClass(3,0), parNull: scoreClass(3,null),
  };
  check("S25a-T1b: scoreClass tiers — eagle additive, boundaries exact",
    scT1b.eagle === " under eagle" && scT1b.under === " under"
    && scT1b.even === "" && scT1b.bogey === " bogey"
    && scT1b.blowup1 === " blowup" && scT1b.blowup2 === " blowup"
    && scT1b.par0 === "" && scT1b.parNull === "",
    "got=" + JSON.stringify(scT1b));
  // mechanical WCAG contrast — no eyeballs gate color. Fix round 1 (review
  // finding 2): the five hex values are PARSED out of index.html's own
  // --score-* tokens (not hardcoded literals) so this gate tracks the page —
  // if a token's hex ever drifts, this check fails against the REAL value,
  // not a frozen copy of it.
  const lum = (hex) => { const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
    .map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4);
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
  const ratio = (f,b) => { const [hi,lo]=[Math.max(lum(f),lum(b)),Math.min(lum(f),lum(b))];
    return (hi+0.05)/(lo+0.05); };
  const pines = ["#0E2019","#132B21","#0A1712"];
  const tok = (n) => (idx.match(new RegExp("--score-" + n + ":\\s*(#[0-9A-Fa-f]{6})")) || [])[1];
  const text = ["under","even","over","bogey"].map(tok);   // text tokens: 4.5 floor
  const rings = ["blowup"].map(tok);                       // ring-only: 3.0 floor
  const allParsedT1c = text.every(Boolean) && rings.every(Boolean);
  check("S25a-T1c: contrast — text tokens ≥4.5, ring tokens ≥3.0 on every pine (values parsed live from index.html's --score-* tokens)",
    allParsedT1c
    && text.every(f=>pines.every(b=>ratio(f,b)>=4.5))
    && rings.every(f=>pines.every(b=>ratio(f,b)>=3.0)),
    "text=" + JSON.stringify(text) + " rings=" + JSON.stringify(rings));
}
{ // T1d: eagle scores keep the ▾ glyph — fix round 1 (review finding 1)
  // regression guard for scCellHTML's glyph derivation (index.html ~4326):
  // strict equality (scoreCls==="under") let " under eagle" fall through to
  // no glyph at all, making the best score on the scorer card color-only —
  // the exact thing the comment directly above that line forbids. The fix
  // is scoreCls.includes("under"); this check fails again if that reverts.
  const domG = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const docG = await openScorer(domG, { noSheet: true });
  docG.querySelector('.sc-cell[data-hole="8"]').click();   // hole 8, par 4 (course fixture)
  await until(() => !docG.querySelector("#scSheet")?.hidden);
  [...docG.querySelectorAll("#scSheet .sc-key[data-score]")]
    .find(b => b.dataset.score === "2").click();            // par4-2 = eagle (X8 confirms "2" labels "Eagle" on hole 8)
  await until(() => docG.querySelector('.sc-cell[data-hole="8"] .sc-score')?.textContent === "2");
  const cell8 = docG.querySelector('.sc-cell[data-hole="8"]');
  check("S25a-T1d: eagle score (2 on a par-4) still carries the ▾ glyph, same as any other under-par score — never color-only",
    !!cell8 && cell8.classList.contains("under") && cell8.classList.contains("eagle")
    && cell8.querySelector(".sc-glyph")?.textContent === "▾",
    "class=" + (cell8 ? cell8.className : "no cell") +
      " glyph=" + JSON.stringify(cell8?.querySelector(".sc-glyph")?.textContent ?? null));
  domG.window.close();
}
{ // T2: color flip + rings + legend
  const idx = readFileSync(path.join(ROOT, "index.html"), "utf8");

  // Fix round 1 (§25a review) shared helper: a real (if minimal) CSS-rule
  // parser over ONLY the <style> block, splitting each rule's selector list
  // on commas so lookups are by EXACT selector token, not loose substring —
  // the original draft's `.test(idx)` regexes were satisfied by finding ANY
  // matching occurrence anywhere in the file, which is exactly the blind
  // spot review finding FIX2/M9 exploited (a LATER duplicate rule with the
  // wrong color still lets a `.test()` scan succeed via the earlier correct
  // one). Every fix-round check below instead collects ALL rule bodies for
  // an exact selector and asserts across ALL of them, so a later duplicate
  // or a reverted single occurrence both fail closed.
  // CSS comments MUST be stripped before rule-parsing: a comment sitting on
  // its own line right before a selector (very common in this file, incl.
  // pre-existing comments unrelated to this task) has no {}s of its own, so
  // the naive [^{}]+ selector-scan swallows it INTO the next rule's
  // "selector" text — e.g. "/* §25a B-CONV: ... */\n  .hcell.under .hs" as
  // one combined string, which then silently fails an exact-match lookup
  // for the clean ".hcell.under .hs" token. Caught this the hard way: T2a
  // false-FAILed on real, correct CSS on the first run of the fix-round
  // checks until this strip was added.
  const styleBlock = (idx.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1].replace(/\/\*[\s\S]*?\*\//g, "");
  const cssRules = [...styleBlock.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ selectors: sel.split(",").map(s => s.trim()).filter(Boolean), body }));
  const rulesFor = (selector) => cssRules.filter(r => r.selectors.includes(selector)).map(r => r.body);

  // T2a (fix round 1: renamed + extended to match its own name — the
  // original only asserted the "under" tier on three selectors, which is
  // narrower than "under/even/over/bogey cells" claimed). Now covers every
  // TEXT-color binding across all four selector families x all three tiers,
  // and — the M9/M3 guard — asserts NO occurrence of that exact selector
  // anywhere in the file (a later duplicate included) binds its color to a
  // raw --brass/--sage/--rust literal.
  const tierTextSelectors = {
    ".hcell.under .hs": "--score-under", ".hcell.bogey .hs": "--score-bogey", ".hcell.blowup .hs": "--score-over",
    ".sg-t td.under": "--score-under", ".sg-t td.bogey": "--score-bogey", ".sg-t td.blowup": "--score-over",
    ".sc-tile-v.under": "--score-under",
    ".sc-cell.under .sc-score": "--score-under", ".sc-cell.bogey .sc-score": "--score-bogey", ".sc-cell.blowup .sc-score": "--score-over",
  };
  const t2aDetail = {};
  const t2aOK = Object.entries(tierTextSelectors).every(([sel, tok]) => {
    const bodies = rulesFor(sel);
    const hasToken = bodies.some(b => new RegExp("color:\\s*var\\(" + tok + "\\)").test(b));
    const noRawLeak = bodies.every(b => !/color:\s*var\(--(brass|sage|rust)\)/.test(b));
    t2aDetail[sel] = { count: bodies.length, hasToken, noRawLeak };
    return hasToken && noRawLeak;
  });
  check("S25a-T2a: every tier TEXT-color binding (hcell .hs / sg-t td / sc-tile-v.under / sc-cell .sc-score, all applicable tiers) uses its --score-* token, and NO occurrence of that exact selector anywhere in the file — including a later duplicate rule — binds color to raw --brass/--sage/--rust",
    t2aOK, "detail=" + JSON.stringify(t2aDetail));

  // T2b (fix round 1: extended from td.blowup-only to every selector that
  // mentions "blowup" — hcell/sg-t td/sc-cell alike, text AND ring rules —
  // so a reverted .sc-cell.blowup .sc-score (review finding M3) dies here
  // too, independently of T2a).
  const blowupRules = cssRules.filter(r => r.selectors.some(s => /\bblowup\b/.test(s)));
  const t2bNoRust = blowupRules.length > 0 && blowupRules.every(r => !/var\(--rust\)/.test(r.body));
  check("S25a-T2b: blowup styling (text AND ring, hcell/sg-t td/sc-cell alike) never uses the raw --rust literal anywhere — the blowup tier's color must come from --score-over/--score-blowup tokens only",
    t2bNoRust,
    "blowupRules=" + JSON.stringify(blowupRules.map(r => r.selectors.join(",") + "{" + r.body + "}")));

  // T2c (fix round 1: extended from .sg-t td-only to ALSO cover .hcell .hs
  // / .sc-cell .sc-score — review findings M5 (eagle double-ring dropped)
  // and M7 (entire hcell/sc-cell ring block deleted) both survived the
  // original .sg-t td-only checks untouched. The hcell blowup ring is
  // explicitly load-bearing: .hcell.blowup .hs's TEXT color is
  // --score-over, which is the IDENTICAL hex to --bone (the default,
  // untiered .hs color) — with no ring, a blowup score on the hole strip
  // is pixel-identical to a plain par score, a real "never color-only"
  // violation, not just a cosmetic gap.) Gets a real `detail` arg (was a
  // static string before).
  const ringSpecs = [
    { sel: ".sg-t td.under::after", must: [/border-radius:\s*50%/] },
    { sel: ".sg-t td.under.eagle::after", must: [/box-shadow/] },
    { sel: ".sg-t td.bogey::after", must: [/border-color/], mustNotRadius: true },
    { sel: ".sg-t td.blowup::after", must: [/box-shadow/] },
    { sel: ".hcell.under .hs", must: [/border-radius:\s*50%/] },
    { sel: ".sc-cell.under .sc-score", must: [/border-radius:\s*50%/] },
    { sel: ".hcell.under.eagle .hs", must: [/box-shadow/] },
    { sel: ".sc-cell.under.eagle .sc-score", must: [/box-shadow/] },
    { sel: ".hcell.bogey .hs", must: [/border-color/], mustNotRadius: true },
    { sel: ".sc-cell.bogey .sc-score", must: [/border-color/], mustNotRadius: true },
    { sel: ".hcell.blowup .hs", must: [/box-shadow/] },
    { sel: ".sc-cell.blowup .sc-score", must: [/box-shadow/] },
  ];
  const ringDetail = {};
  const ringOK = ringSpecs.every(spec => {
    const bodies = rulesFor(spec.sel);
    const hasAll = spec.must.every(re => bodies.some(b => re.test(b)));
    const noRadiusLeak = !spec.mustNotRadius || bodies.every(b => !/border-radius:\s*50%/.test(b));
    ringDetail[spec.sel] = { count: bodies.length, hasAll, noRadiusLeak };
    return hasAll && noRadiusLeak;
  });
  check("S25a-T2c: ring vocabulary present on BOTH the grid table (.sg-t td) AND the hole-strip/scorer-card (.hcell .hs / .sc-cell .sc-score) — circle under, double eagle, square bogey, double-square blowup",
    ringOK, "detail=" + JSON.stringify(ringDetail));

  // NOTE: the file-scope `dom` was already `.window.close()`d earlier in the
  // suite (lines ~1546/5081) — jsdom nulls out `.document` on a closed
  // window, so reusing it here would throw. Static markup like the legend
  // needs no route/fetch state, so a fresh throwaway dom is used, guarded in
  // try/catch (idiom per task-1-report.md) so a missing symbol/DOM shape
  // FAILs the check instead of crashing the whole suite.
  let legend = null, legendErr = null;
  try {
    const domLg = makeDom("");
    legend = domLg.window.document.querySelector("#sgLegend");
    domLg.window.close();
  } catch (e) { legendErr = e.message; }
  const t2dLabels = ["Eagle", "Birdie", "Par", "Bogey", "Double or worse"];
  check("S25a-T2d: legend — five labels verbatim",
    !!legend && !legendErr && t2dLabels.every(t => legend.textContent.includes(t)),
    "legend=" + JSON.stringify(legend ? legend.textContent.replace(/\s+/g, " ").trim() : null) +
      (legendErr ? " err=" + legendErr : ""));
}
{ // T2e (fix round 1, §25a FIX1): legend visibility mirrors note/scroll on
  // BOTH of renderScoreGrid's early-return note paths. X35 (extended above)
  // already grounds the !pars branch on a real fixture. The SECOND branch
  // (!rounds.length, "No hole-by-hole cards yet — totals only so far.") has
  // no existing real-fixture test to extend — building one would mean
  // crafting a whole alternate players/rounds fixture set just for this.
  // renderScoreGrid is reachable directly instead (confirmed top-level,
  // non-closure via grep, same idiom as scoreClass — see task-1-report.md):
  // it takes `players` as a plain argument and reads its DOM refs via $(),
  // so calling it with a synthetic totals-only players array on a dom
  // that's already completed one REAL load exercises the branch precisely,
  // and — bonus — that same real load's own prior render proves the
  // positive case (legend shown after a genuine successful grid render) in
  // the same check. Guarded in try/catch per the established idiom.
  let normalLegendHidden = null, notePath2LegendHidden = null, notePath2Text = null, t2eErr = null;
  try {
    const domE = makeDom("");
    await until(() => domE.window.document.querySelectorAll("#sgTable tr.sg-teamrow").length > 0);
    normalLegendHidden = domE.window.document.querySelector("#sgLegend")?.hidden;
    domE.window.renderScoreGrid([{ key: "ZZ", name: "ZZ Totals-Only", rounds: { "1": { total: 70 } } }]);
    const noteE = domE.window.document.querySelector("#sgNote");
    notePath2Text = noteE && noteE.textContent;
    notePath2LegendHidden = domE.window.document.querySelector("#sgLegend")?.hidden;
    domE.window.close();
  } catch (e) { t2eErr = e.message; }
  check("S25a-T2e: legend shown after a real successful grid render, and hides again on renderScoreGrid's OTHER early-return note path ('No hole-by-hole cards yet') — not the same branch X35 exercises",
    normalLegendHidden === false && notePath2LegendHidden === true
    && !!notePath2Text && /totals only so far/i.test(notePath2Text) && !t2eErr,
    "normalLegendHidden=" + normalLegendHidden + " notePath2LegendHidden=" + notePath2LegendHidden +
      " notePath2Text=" + JSON.stringify(notePath2Text) + (t2eErr ? " err=" + t2eErr : ""));
}

{ // T3: ceremonial mastheads (S25a B-NAME) — fresh throwaway dom (the suite's
  // shared `dom` is closed by this point; same hazard T2d hit, same fix).
  const domT3 = makeDom("");
  const d = domT3.window.document;
  const idxT3 = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const bar = d.querySelector("#mastBar");
  check("S25a-T3a: compact masthead bar — full ceremonial name + single-authority #mark use + hidden-on-home CSS",
    !!bar && /THE GOOD FRIENDS YEARLY/.test(bar.textContent || "")
    && !!bar.querySelector('svg use[href="#mark"]')
    && /body\[data-view="home"\] #mastBar\{[^}]*display:\s*none/.test(idxT3),
    "bar=" + !!bar + " mark=" + !!(bar && bar.querySelector('svg use[href="#mark"]')));
  const board = d.querySelector('[data-view="board"]');
  const boardH2T3b = board && board.querySelector("h2");
  // 2026-08-28 polish (FV9): the eyebrow is now PHASE-AWARE — "Live from the
  // course" only inside the event window (FV9 owns that behavior); this check
  // keeps asserting the element + the rest of the copy verbatim.
  check("S25a-T3b: Board masthead — copy intact (eyebrow phase-aware per FV9) + double rule + chip slot + Leaderboard heading (fix round 1, M7)",
    !!board && !!board.querySelector("#boardEyebrow")
    && /Gross decides The Bird/.test(board.textContent || "")
    && !!board.querySelector(".mast-rule") && !!board.querySelector("#mastChip")
    && !!boardH2T3b && boardH2T3b.textContent.trim() === "Leaderboard",
    "rule=" + !!(board && board.querySelector(".mast-rule")) + " chip=" + !!(board && board.querySelector("#mastChip"))
      + " h2=" + JSON.stringify(boardH2T3b && boardH2T3b.textContent));
  domT3.window.close();

  // S25a-T3c (fix round 1, M1): the fixture default first_tee (2026-08-15) is
  // a real calendar date that drifts into/out of the ±3-day event window as
  // wall-clock time passes — anchoring the off-phase assertion to it is a
  // time-bomb. Force off-phase explicitly via the dynInfo() idiom (X53)
  // instead: a first_tee ~1 year out is unambiguously outside the ±3-day
  // window regardless of when this suite runs.
  const offPhaseInfoT3c = dynInfo(365);
  const domT3c = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => offPhaseInfoT3c }),
  }));
  let chipTextC = null, t3cErr = "";
  const t3cReady = await until(() => typeof domT3c.window.renderMastChip === "function");
  try {
    if (!t3cReady) throw new Error("page scripts never exposed renderMastChip");
    domT3c.window.eval("renderMastChip()");
    chipTextC = (domT3c.window.document.querySelector("#mastChip") || {}).textContent;
  } catch (e) { t3cErr = String((e && e.message) || e); }
  domT3c.window.close();
  check("S25a-T3c: chip honest off-phase — est line verbatim, never a fabricated round/day (first_tee forced ~1yr out via dynInfo(365), never the real calendar — fix round 1, M1)",
    chipTextC === "McCall, Idaho · Est. 2019" && !/Round \d/.test(chipTextC || "") && !t3cErr,
    "chip=" + JSON.stringify(chipTextC) + (t3cErr ? " err=" + t3cErr : ""));

  // S25a-T3d/e/f (fix round 1, I1): event-phase branch coverage — zero prior
  // coverage let two mutations survive: dropping the `rds.length` guard
  // (event + no scores ⇒ Math.max(...[]) ⇒ "Round -Infinity") and replacing
  // the `off!==null` guard with a device-clock fallback (event + an
  // unparseable offset ⇒ a guessed weekday instead of refusing). Each check
  // below isolates one guard; T3d is the baseline positive path.
  const inWindowInfoT3 = dynInfo(1);

  const domT3d = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT3 }),
  }));
  let chipTextD = null, t3dErr = "";
  const t3dReady = await until(() => typeof domT3d.window.renderMastChip === "function");
  try {
    if (!t3dReady) throw new Error("page scripts never exposed renderMastChip");
    domT3d.window.eval("renderMastChip()");
    chipTextD = (domT3d.window.document.querySelector("#mastChip") || {}).textContent;
  } catch (e) { t3dErr = String((e && e.message) || e); }
  domT3d.window.close();
  check("S25a-T3d: chip event-phase — fixture scores derive a real Round 1|2 + weekday (fix round 1, I1); weekday not pinned since it derives from the relative dynInfo() date",
    /^Round [12] · [A-Z][a-z]+$/.test(chipTextD || "") && !t3dErr,
    "chip=" + JSON.stringify(chipTextD) + (t3dErr ? " err=" + t3dErr : ""));

  const emptyScoresT3e = FIXTURES.scores.split(/\r\n|\n/)[0] + "\r\n";
  const domT3e = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT3 }),
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => emptyScoresT3e }),
  }));
  let chipTextE = null, t3eErr = "";
  const t3eReady = await until(() => typeof domT3e.window.renderMastChip === "function");
  try {
    if (!t3eReady) throw new Error("page scripts never exposed renderMastChip");
    domT3e.window.eval("renderMastChip()");
    chipTextE = (domT3e.window.document.querySelector("#mastChip") || {}).textContent;
  } catch (e) { t3eErr = String((e && e.message) || e); }
  domT3e.window.close();
  check("S25a-T3e: chip event-phase — EMPTY scores tab (no rounds at all) falls back to the est line, never 'Round -Infinity' (fix round 1, I1 — guards the rds.length check)",
    chipTextE === "McCall, Idaho · Est. 2019" && !/Round/.test(chipTextE || "") && !t3eErr,
    "chip=" + JSON.stringify(chipTextE) + (t3eErr ? " err=" + t3eErr : ""));

  const noOffsetInfoT3f = FIXTURES.info.replace(
    "2026-08-15T09:00:00-06:00", dynFirstTee(1).replace(/[+-]\d{2}:\d{2}$/, ""));
  const domT3f = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => noOffsetInfoT3f }),
  }));
  let chipTextF = null, t3fErr = "";
  const t3fReady = await until(() => typeof domT3f.window.renderMastChip === "function");
  try {
    if (!t3fReady) throw new Error("page scripts never exposed renderMastChip");
    domT3f.window.eval("renderMastChip()");
    chipTextF = (domT3f.window.document.querySelector("#mastChip") || {}).textContent;
  } catch (e) { t3fErr = String((e && e.message) || e); }
  domT3f.window.close();
  check("S25a-T3f: chip event-phase — first_tee with no parseable UTC offset falls back to the est line, never a device-clock-guessed weekday (fix round 1, I1 — guards the off!==null check)",
    chipTextF === "McCall, Idaho · Est. 2019" && !/Round \d/.test(chipTextF || "") && !t3fErr,
    "chip=" + JSON.stringify(chipTextF) + (t3fErr ? " err=" + t3fErr : ""));

  // S25a-T3g (fix round 1, I2): the round domain is bounded to exactly {1,2}
  // — the authoritative domain per tools/sheet-triggers.gs:65 and the board's
  // own R1/R2 rendering. A hand-typed Scores round of "3" or "2026" must
  // never headline the chip; if no round survives the filter, fall back to
  // the est line rather than guess.
  const bogusPlusValidT3g = FIXTURES.scores +
    "\n2026,Duck,3,4,4,4,5,4,4,4,4,5,4,5,3,4,4,4,3,5,4,,\n";
  const domT3g1 = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT3 }),
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => bogusPlusValidT3g }),
  }));
  let chipTextG1 = null, t3g1Err = "";
  const t3g1Ready = await until(() => typeof domT3g1.window.renderMastChip === "function");
  try {
    if (!t3g1Ready) throw new Error("page scripts never exposed renderMastChip");
    domT3g1.window.eval("renderMastChip()");
    chipTextG1 = (domT3g1.window.document.querySelector("#mastChip") || {}).textContent;
  } catch (e) { t3g1Err = String((e && e.message) || e); }
  domT3g1.window.close();

  const allBogusT3g = FIXTURES.scores.split(/\r\n|\n/)[0] + "\r\n" +
    "2026,Duck,3,4,4,4,5,4,4,4,4,5,4,5,3,4,4,4,3,5,4,,\n" +
    "2026,Sully,2026,4,4,4,5,4,4,4,4,5,4,5,3,4,4,4,3,5,4,,\n";
  const domT3g2 = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT3 }),
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => allBogusT3g }),
  }));
  let chipTextG2 = null, t3g2Err = "";
  const t3g2Ready = await until(() => typeof domT3g2.window.renderMastChip === "function");
  try {
    if (!t3g2Ready) throw new Error("page scripts never exposed renderMastChip");
    domT3g2.window.eval("renderMastChip()");
    chipTextG2 = (domT3g2.window.document.querySelector("#mastChip") || {}).textContent;
  } catch (e) { t3g2Err = String((e && e.message) || e); }
  domT3g2.window.close();

  check("S25a-T3g: round domain bounded to {1,2} (fix round 1, I2) — a bogus round ('3') alongside a valid Round 2 row still headlines 'Round 2', never '3'; when ONLY bogus rounds exist ('3'/'2026'), falls back to the est line rather than guess",
    /^Round 2 · [A-Z][a-z]+$/.test(chipTextG1 || "") && !t3g1Err
    && chipTextG2 === "McCall, Idaho · Est. 2019" && !/Round/.test(chipTextG2 || "") && !t3g2Err,
    "bogusPlusValid=" + JSON.stringify(chipTextG1) + (t3g1Err ? " err1=" + t3g1Err : "")
      + " allBogus=" + JSON.stringify(chipTextG2) + (t3g2Err ? " err2=" + t3g2Err : ""));

  // S25a-T3h (final fix wave, F3 — ratified S11 ruling): #mastCtx wrapped
  // into 3 ragged lines at 390w in the render-close eyeball pass
  // (progress.md 08-24) — a "finished"-test failure to a cold viewer. Ruled:
  // hide it below 560px (the Board's own #mastChip, a DIFFERENT element,
  // already carries the same context on phones). Same anchor-and-slice
  // idiom T4i/T4j use for this exact media block, rather than a bare
  // substring .test() that could match a stray duplicate anywhere else in
  // the file.
  const narrowMqAnchorT3h = idxT3.indexOf("@media (max-width:560px)");
  // window sized to the WHOLE block (measured ~1640 chars incl. braces) —
  // the rule sits at the block's tail end, after every pre-existing
  // narrow-width override, not up front where it would shift T4j's own
  // (independently sized) slice window over the .lb-head/.lb-row rule.
  const narrowMqSliceT3h = narrowMqAnchorT3h >= 0 ? idxT3.slice(narrowMqAnchorT3h, narrowMqAnchorT3h + 1800) : "";
  check("S25a-T3h: final fix wave (F3, ratified S11 ruling) — .mast-ctx{display:none} present inside the @media (max-width:560px) block, so the top bar's context line never wraps into ragged lines on a phone",
    /\.mast-ctx\{display:\s*none\}/.test(narrowMqSliceT3h),
    "slice=" + JSON.stringify(narrowMqSliceT3h.slice(0, 200)));
}

{ // T4: movement arrows + honest staleness basis (S25a B-MV) — fresh
  // throwaway doms per scenario (the shared `dom` is closed by this point,
  // same hazard T2d/T3 hit).
  const domT4 = makeDom("");
  await until(() => typeof domT4.window.movementFor === "function");
  const mv = domT4.window.movementFor;
  check("S25a-T4a: movement diff — first load, up, down, tie-shuffle, new team",
    typeof mv === "function" && (() => {
      const first = mv(null, ["a", "b"]);
      const m = mv(["a", "b", "c", "d"], ["b", "a", "d", "c"]);
      const n = mv(["a"], ["a", "z"]);
      return first.get("a").dir === "same" && first.get("a").n === 0
        && m.get("b").dir === "up" && m.get("b").n === 1
        && m.get("a").dir === "down" && m.get("a").n === 1
        && m.get("d").dir === "up" && m.get("d").n === 1
        && n.get("z").dir === "new";
    })(),
    "movementFor typeof=" + typeof mv);
  domT4.window.close();

  const idxT4 = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const hasConstT4b = /STALE_BASIS_MS\s*=\s*10\*60\*1000/.test(idxT4);
  const hasCopyT4b = idxT4.includes("Movement paused — last refresh");
  check("S25a-T4b: staleness rule — 10-minute basis cap present with paused copy",
    hasConstT4b && hasCopyT4b,
    "const=" + hasConstT4b + " copy=" + hasCopyT4b);
  const hasAriaT4c = idxT4.includes('aria-label="moved up');
  const hasClassT4c = /lb-mv/.test(idxT4);
  check("S25a-T4c: arrows are aria-labeled inline SVG in rows",
    hasAriaT4c && hasClassT4c,
    "aria=" + hasAriaT4c + " class=" + hasClassT4c);

  // S25a-T4d: FIRST paint (no prior STATE.prevBoard yet) — every row's mv
  // cell reads the dash (never a fabricated arrow before a prior paint
  // exists to diff against) and the basis footer is honestly empty.
  const domT4d = makeDom("");
  await until(() => domT4d.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const mvCellsT4d = [...domT4d.window.document.querySelectorAll("#lbBody .lb-mv")];
  const allDashT4d = mvCellsT4d.length > 0 && mvCellsT4d.every(el => el.textContent.trim() === "—");
  const basisT4d = domT4d.window.document.querySelector("#lbMvBasis")?.textContent ?? null;
  domT4d.window.close();
  check("S25a-T4d: first paint — every row shows the mv dash, basis footer empty (no fabricated movement before a prior paint exists)",
    mvCellsT4d.length > 0 && allDashT4d && basisT4d === "",
    "cells=" + mvCellsT4d.length + " allDash=" + allDashT4d + " basis=" + JSON.stringify(basisT4d));

  // S25a-T4e: a FRESH basis (STATE.prevBoard just captured, well under the
  // 10-minute cap, SAME year) with the live order reversed forces real
  // up/down movement — proves the mechanism, not just source-text presence
  // (T4b/c only prove the strings exist somewhere in the file). The injected
  // STATE.prevBoard carries `year` (fix round 1, Imp-1) matching STATE.year
  // so this isolates the TIME-based freshness path from the year-match
  // guard T4h covers separately.
  const domT4e = makeDom("");
  await until(() => domT4e.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const yearT4e = domT4e.window.eval("STATE.year");
  const liveOrderT4e = [...domT4e.window.document.querySelectorAll("#lbBody .lb-row")].map(r => r.dataset.player);
  domT4e.window.eval("STATE.prevBoard = " + JSON.stringify({ order: [...liveOrderT4e].reverse(), year: yearT4e, at: Date.now() }) + "; renderLeaderboard();");
  const rowsT4e = [...domT4e.window.document.querySelectorAll("#lbBody .lb-row")];
  const firstMvT4e = rowsT4e[0]?.querySelector(".lb-mv");
  const lastMvT4e = rowsT4e[rowsT4e.length - 1]?.querySelector(".lb-mv");
  const basisT4e = domT4e.window.document.querySelector("#lbMvBasis")?.textContent ?? "";
  // fix round 1 (m4): read every element prop BEFORE closing the window, not
  // after — consistent with T4d/f/g's idiom, and avoids relying on jsdom
  // node state surviving window.close().
  const firstUpT4e = !!firstMvT4e?.classList.contains("up");
  const firstAriaT4e = firstMvT4e?.getAttribute("aria-label") || "";
  const firstClassT4e = firstMvT4e && firstMvT4e.className;
  const lastDownT4e = !!lastMvT4e?.classList.contains("down");
  const lastAriaT4e = lastMvT4e?.getAttribute("aria-label") || "";
  const lastClassT4e = lastMvT4e && lastMvT4e.className;
  domT4e.window.close();
  // fix round 1 (m3): the multi-row precondition is asserted, not ||-ed away
  // — a fixture that ever collapses to one row must FAIL this check loudly
  // (nothing to prove movement with) rather than pass vacuously.
  const multiRowT4e = liveOrderT4e.length > 1;
  const movementOkT4e = firstUpT4e && /^moved up \d+$/.test(firstAriaT4e) &&
    lastDownT4e && /^moved down \d+$/.test(lastAriaT4e);
  check("S25a-T4e: fresh basis (same year) — reversing the live order produces real aria-labeled up/down arrows + 'Movement since h:mm' footer",
    multiRowT4e && movementOkT4e && /^Movement since \d{1,2}:\d{2}/.test(basisT4e),
    "teams=" + liveOrderT4e.length + " multiRow=" + multiRowT4e + " firstClass=" + firstClassT4e +
      " firstAria=" + JSON.stringify(firstAriaT4e) +
      " lastClass=" + lastClassT4e + " basis=" + JSON.stringify(basisT4e));

  // S25a-T4f: a STALE basis (captured >10 minutes ago, SAME year) suppresses
  // every arrow back to the dash and swaps the footer to the honest paused
  // copy — never keep showing an old diff as if it were current.
  const domT4f = makeDom("");
  await until(() => domT4f.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const yearT4f = domT4f.window.eval("STATE.year");
  const liveOrderT4f = [...domT4f.window.document.querySelectorAll("#lbBody .lb-row")].map(r => r.dataset.player);
  const staleAtT4f = Date.now() - 11 * 60 * 1000;
  domT4f.window.eval("STATE.prevBoard = " + JSON.stringify({ order: [...liveOrderT4f].reverse(), year: yearT4f, at: staleAtT4f }) + "; renderLeaderboard();");
  const mvCellsT4f = [...domT4f.window.document.querySelectorAll("#lbBody .lb-mv")];
  const allDashT4f = mvCellsT4f.length > 0 && mvCellsT4f.every(el => el.textContent.trim() === "—");
  const basisT4f = domT4f.window.document.querySelector("#lbMvBasis")?.textContent ?? "";
  domT4f.window.close();
  check("S25a-T4f: stale basis (>10min old, same year) suppresses every arrow to the dash and shows 'Movement paused — last refresh h:mm'",
    mvCellsT4f.length > 0 && allDashT4f && /^Movement paused — last refresh \d{1,2}:\d{2}/.test(basisT4f),
    "cells=" + mvCellsT4f.length + " allDash=" + allDashT4f + " basis=" + JSON.stringify(basisT4f));

  // S25a-T4h (fix round 1, Imp-1): a prior basis from a DIFFERENT year is
  // not a stale basis, it's the WRONG basis — reviewer reproduced switching
  // the year picker fabricating "moved up 2" arrows with nothing actually
  // moved (the old code diffed the new year's order against the old year's
  // order under a still-fresh timestamp). A year mismatch must render
  // exactly like a first paint: every row dashed, footer empty — never an
  // arrow, never "since"/"paused" text.
  const domT4h = makeDom("");
  await until(() => domT4h.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const yearNowT4h = domT4h.window.eval("STATE.year");
  const liveOrderT4h = [...domT4h.window.document.querySelectorAll("#lbBody .lb-row")].map(r => r.dataset.player);
  // a genuinely different (reversed) prior order under the SAME year, fresh
  // timestamp — exactly what T4e proves DOES produce real arrows — so that
  // switching the year with the guard removed would show the same
  // reviewer-reported false arrows if this check regresses.
  domT4h.window.eval("STATE.prevBoard = " + JSON.stringify({ order: [...liveOrderT4h].reverse(), year: yearNowT4h, at: Date.now() }) + ";");
  const yearBtnsT4h = [...domT4h.window.document.querySelectorAll("#years .year-btn")].map(b => b.dataset.year);
  const otherYearT4h = yearBtnsT4h.find(y => y !== yearNowT4h);
  let mvCellsT4h = [], basisT4h = "";
  if (otherYearT4h) {
    // the exact pre-fix code path: only STATE.year changes, STATE.prevBoard
    // is left completely untouched (renderYears()'s own year-button handler
    // never mentions STATE.prevBoard).
    domT4h.window.eval("STATE.year=" + JSON.stringify(otherYearT4h) + "; STATE.open=null; renderLeaderboard();");
    mvCellsT4h = [...domT4h.window.document.querySelectorAll("#lbBody .lb-mv")];
    basisT4h = domT4h.window.document.querySelector("#lbMvBasis")?.textContent ?? "";
  }
  const allDashT4h = mvCellsT4h.length > 0 && mvCellsT4h.every(el => el.textContent.trim() === "—");
  domT4h.window.close();
  check("S25a-T4h: year switch never diffs against the other year's basis — dashes + empty footer, never a fabricated arrow or 'since'/'paused' text",
    !!otherYearT4h && allDashT4h && basisT4h === "",
    "years=" + JSON.stringify(yearBtnsT4h) + " from=" + yearNowT4h + " switchedTo=" + otherYearT4h +
      " cells=" + mvCellsT4h.length + " allDash=" + allDashT4h + " basis=" + JSON.stringify(basisT4h));

  // S25a-T4g (ruled scope addition, B-CONV, controller ruling): the Board's
  // to-par cell (renderLeaderboard's last span) gains tier coloring — under,
  // even, over, and the suppressed/null fallback all asserted from a
  // rendered board (fixture teams spanning all four cases).
  const scoresT4g = "year,team,round,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12,h13,h14,h15,h16,h17,h18,r1,r2\n"
    + "2026,Duck,,,,,,,,,,,,,,,,,,,,,68,68\n"    // total 136, par 144 -> rel -8 (under)
    + "2026,Sully,,,,,,,,,,,,,,,,,,,,,72,72\n"   // total 144, par 144 -> rel 0 (even)
    + "2026,Tex,,,,,,,,,,,,,,,,,,,,,80,80\n";    // total 160, par 144 -> rel +16 (over)
  const domT4g = makeDom("", withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresT4g }),
  }));
  await until(() => domT4g.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const byTeamT4g = {};
  domT4g.window.document.querySelectorAll("#lbBody .lb-row").forEach(r => {
    const toParSpan = r.querySelectorAll(".lb-tot")[1];
    byTeamT4g[r.dataset.player] = toParSpan ? toParSpan.className : null;
  });
  domT4g.window.close();
  const clsListT4g = (s) => (s || "").split(" ");
  const underOkT4g = clsListT4g(byTeamT4g.duck).includes("lb-under");
  const evenOkT4g = clsListT4g(byTeamT4g.sully).includes("lb-even");
  const overOkT4g = clsListT4g(byTeamT4g.tex).includes("lb-over");

  const courseBlank7T4g = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l).join("\n");
  const domT4g2 = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7T4g }),
  }));
  await until(() => domT4g2.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const rowT4g2 = domT4g2.window.document.querySelector("#lbBody .lb-row");
  const toParSpanT4g2 = rowT4g2 && rowT4g2.querySelectorAll(".lb-tot")[1];
  const nullClassT4g2 = toParSpanT4g2 ? toParSpanT4g2.className : null;
  domT4g2.window.close();
  const nullOkT4g = !!toParSpanT4g2 && !/lb-under|lb-even|lb-over/.test(nullClassT4g2 || "");

  check("S25a-T4g: ruled scope addition (B-CONV) — Board to-par cell tier coloring: rel<0 -> lb-under, rel===0 -> lb-even, rel>0 -> lb-over, suppressed/null -> no tier class",
    underOkT4g && evenOkT4g && overOkT4g && nullOkT4g,
    "duck=" + JSON.stringify(byTeamT4g.duck) + " sully=" + JSON.stringify(byTeamT4g.sully) +
      " tex=" + JSON.stringify(byTeamT4g.tex) + " nullCase=" + JSON.stringify(nullClassT4g2));

  // S25a-T4i/T4j (fix round 1, Imp-2): the base and narrow grid templates
  // had zero structural coverage — reverting EITHER one to its pre-mv track
  // count (dropping the 2.2rem/2rem mv column) still passed the full suite.
  // Same slicing idiom X37 established for its own suppressed-variant grid
  // check: anchor on a stable marker, slice forward, regex the EXACT track
  // list with a closing `\s*;` boundary so neither a dropped nor an extra
  // stray track can sneak back in unnoticed.
  const leaderboardAnchorT4 = idxT4.indexOf("/* leaderboard */");
  const leaderboardSliceT4 = leaderboardAnchorT4 >= 0 ? idxT4.slice(leaderboardAnchorT4, leaderboardAnchorT4 + 200) : "";
  const baseGridOkT4i = /\.lb-head,\.lb-row\{display:grid;grid-template-columns:\s*2\.4rem\s+2\.2rem\s+1fr\s+4rem\s+3\.2rem\s+3\.2rem\s+4rem\s+4rem\s*;/.test(leaderboardSliceT4);
  check("S25a-T4i: base leaderboard grid — EXACTLY 8 tracks (pos, mv, name, thru, r1, r2, total, to-par) — the mv column can't be silently dropped or an extra track silently added",
    baseGridOkT4i,
    "slice=" + JSON.stringify(leaderboardSliceT4.slice(0, 160)));

  const narrowMqAnchorT4 = idxT4.indexOf("@media (max-width:560px)");
  const narrowMqSliceT4 = narrowMqAnchorT4 >= 0 ? idxT4.slice(narrowMqAnchorT4, narrowMqAnchorT4 + 600) : "";
  const narrowGridOkT4j = /\.lb-head,\.lb-row\{grid-template-columns:\s*1\.9rem\s+2rem\s+1fr\s+3\.4rem\s+4rem\s*;/.test(narrowMqSliceT4);
  check("S25a-T4j: narrow (≤560px) leaderboard grid — EXACTLY 5 tracks (pos, mv, name, thru, to-par-or-total) — the mv column can't be silently dropped or an extra track silently added",
    narrowGridOkT4j,
    "slice=" + JSON.stringify(narrowMqSliceT4.slice(0, 260)));

  // S25a-T4k (fix round 1, Imp-3): head/row column PARITY unguarded —
  // deleting the aria-hidden mv head cell from the static .lb-head markup
  // passed the full suite untouched (the grid checks above only assert the
  // CSS track COUNT, not that the actual rendered markup fills every
  // track). Layout-free: element childElementCount, not layout geometry.
  const domT4k = makeDom("");
  await until(() => domT4k.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const headChildrenT4k = domT4k.window.document.querySelector(".lb-head")?.children.length ?? null;
  const rowChildrenT4k = domT4k.window.document.querySelector("#lbBody .lb-row")?.children.length ?? null;
  domT4k.window.close();
  check("S25a-T4k: lb-head/lb-row column parity — head and a rendered row carry the SAME number of grid children (deleting the mv head cell must not pass silently)",
    !!headChildrenT4k && headChildrenT4k === rowChildrenT4k,
    "head=" + headChildrenT4k + " row=" + rowChildrenT4k);

  // S25a-T4m (final fix wave, F1 — RULED: suppression suppresses movement):
  // every T4 check above hand-primes STATE.prevBoard against the DEFAULT
  // (non-suppressed) course fixture — none of them exercise parsSuppressed
  // at all. courseMap()===null already forces Pos to the dash (X34/X37); the
  // ▲/▼ rank-delta arrows and the "since"/"paused" footer must be suppressed
  // right alongside it, not keep showing a diff the Pos column itself can't
  // honestly back. Reuses T4e's exact fresh-basis precondition (hand-primed
  // STATE.prevBoard, same year, reversed live order, well under the 10-min
  // cap) — the ONE thing T4e proves DOES render real up/down arrows when NOT
  // suppressed — plus X34/X37's blank-hole-7 course-fixture idiom to force
  // parsSuppressed=true. Must FAIL if the parsSuppressed gate on mv/basis is
  // removed from renderLeaderboard.
  const courseBlank7T4m = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l).join("\n");
  const domT4m = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7T4m }),
  }));
  await until(() => domT4m.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const yearT4m = domT4m.window.eval("STATE.year");
  const liveOrderT4m = [...domT4m.window.document.querySelectorAll("#lbBody .lb-row")].map(r => r.dataset.player);
  domT4m.window.eval("STATE.prevBoard = " + JSON.stringify({ order: [...liveOrderT4m].reverse(), year: yearT4m, at: Date.now() }) + "; renderLeaderboard();");
  const mvCellsT4m = [...domT4m.window.document.querySelectorAll("#lbBody .lb-mv")];
  const allDashT4m = mvCellsT4m.length > 0 && mvCellsT4m.every(el => el.textContent.trim() === "—");
  const noUpDownT4m = mvCellsT4m.every(el => !el.classList.contains("up") && !el.classList.contains("down"));
  const basisT4m = domT4m.window.document.querySelector("#lbMvBasis")?.textContent ?? "";
  domT4m.window.close();
  check("S25a-T4m (final fix wave, F1, RULED): par-suppressed board — a fresh, same-year, hand-primed STATE.prevBoard (T4e's exact precondition, which DOES render real arrows when NOT suppressed) still renders every .lb-mv as the plain dash (no up/down class) and #lbMvBasis stays empty (neither 'since' nor 'paused') — suppression suppresses movement",
    mvCellsT4m.length > 0 && allDashT4m && noUpDownT4m && basisT4m === "",
    "cells=" + mvCellsT4m.length + " allDash=" + allDashT4m + " noUpDown=" + noUpDownT4m + " basis=" + JSON.stringify(basisT4m));

  // S25a-T4l (final fix wave, F2b — paint()-capture seam): every T4 check
  // above primes STATE.prevBoard BY HAND — none of them drive the REAL
  // paint()/load() capture path, so dropping `year:` (or the whole capture
  // line) from paint() would kill B-MV in production while this whole suite
  // stayed green. Drives the page's actual load() entry point (the SAME
  // top-level `function load(){}` X26 already established becomes a window
  // property in a classic script, and is the exact path the 60s auto-refresh
  // timer uses) TWICE: the dom's own automatic initial load() (first paint,
  // captures STATE.prevBoard from a 3-team custom totals fixture) then a
  // second explicit `window.load()` after flipping a mutable phase flag the
  // fetch stub reads live (a "dyn fixture override" — same withOverride
  // wrapper every other variant dom uses, but the returned Response's text()
  // depends on a variable this test mutates BETWEEN the two load() calls) so
  // Duck and Tex swap 1st/last. Asserts real up/down arrows render on the
  // SECOND paint, and that STATE.prevBoard — inspected AFTER that same
  // second paint — holds {order, year, at} matching what that render
  // actually produced. Fails if paint() drops `year:` (prevBoard.year !==
  // STATE.year) or drops the whole capture line entirely (prevBoard.order
  // would stay stale at phase-1's order instead of matching the live DOM).
  let phaseT4l = 1;
  const scoresHeaderT4l = FIXTURES.scores.split(/\r\n|\n/)[0];
  const totalsRowT4l = (team, r1, r2) => [2026, team, "", ...Array(18).fill(""), r1, r2].join(",");
  const scoresPhase1T4l = scoresHeaderT4l + "\n"
    + totalsRowT4l("Duck", 70, 70) + "\n"
    + totalsRowT4l("Sully", 75, 75) + "\n"
    + totalsRowT4l("Tex", 80, 80);
  const scoresPhase2T4l = scoresHeaderT4l + "\n"
    + totalsRowT4l("Duck", 80, 80) + "\n"
    + totalsRowT4l("Sully", 75, 75) + "\n"
    + totalsRowT4l("Tex", 70, 70);
  const domT4l = makeDom("", withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => phaseT4l === 1 ? scoresPhase1T4l : scoresPhase2T4l }),
  }));
  await until(() => domT4l.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  phaseT4l = 2;
  // FT tiers (08-28): age the history so the second load() actually refetches
  // scores — the paint()-capture seam is what's tested, not the cadence.
  domT4l.window.eval("Object.keys(LAST_GOT).forEach(t=>{LAST_GOT[t].reqAt-=COLD_MS+1000})");
  await domT4l.window.load(); // second REAL paint — the same load() path X26 exercises
  const liveOrderT4l = [...domT4l.window.document.querySelectorAll("#lbBody .lb-row")].map(r => r.dataset.player);
  const rowForT4l = (k) => domT4l.window.document.querySelector('#lbBody .lb-row[data-player="' + k + '"]');
  const duckMvT4l = rowForT4l("duck")?.querySelector(".lb-mv");
  const texMvT4l = rowForT4l("tex")?.querySelector(".lb-mv");
  const arrowsOkT4l = !!duckMvT4l && !!texMvT4l
    && duckMvT4l.classList.contains("down") && texMvT4l.classList.contains("up");
  const prevBoardT4l = domT4l.window.eval("STATE.prevBoard");
  const yearNowT4l = domT4l.window.eval("STATE.year");
  domT4l.window.close();
  const shapeOkT4l = !!prevBoardT4l && Array.isArray(prevBoardT4l.order)
    && JSON.stringify(prevBoardT4l.order) === JSON.stringify(liveOrderT4l)
    && prevBoardT4l.year === yearNowT4l && typeof prevBoardT4l.at === "number";
  check("S25a-T4l (final fix wave, F2b): end-to-end paint()-capture seam — driving the REAL load()/paint() path TWICE (X26's window.load() idiom) with team order changed between paints via a mutable fetch-stub phase flag (dyn fixture override) renders real up/down arrows on the second paint, AND leaves STATE.prevBoard — read AFTER that same second paint — holding {order,year,at} matching that paint's own rendered order/year, not stale from the first paint",
    arrowsOkT4l && shapeOkT4l,
    "duckClass=" + (duckMvT4l && duckMvT4l.className) + " texClass=" + (texMvT4l && texMvT4l.className) +
      " liveOrder=" + JSON.stringify(liveOrderT4l) + " prevBoard=" + JSON.stringify(prevBoardT4l) + " year=" + yearNowT4l);
}

{ // T5: event-phase Home leaderboard top-slice (S25a B-HOME) — a literal
  // prefix of the Board's own render. Fresh throwaway doms per scenario
  // (same hazard T3/T4 hit — the shared `dom` is long closed by this
  // point), phase forced via the dynInfo()/withOverride() idiom T3d..T3h
  // established rather than raced against the real calendar.
  const rowSig = (row) => ({
    name: row.querySelector(".lb-name")?.textContent ?? null,
    pos: row.querySelector(".lb-pos")?.textContent ?? null,
    topar: row.querySelectorAll(".lb-tot")[1]?.textContent ?? null,
  });
  const inWindowInfoT5 = dynInfo(1);
  const offPhaseInfoT5 = dynInfo(365);

  // T5a: structural — #homeBoard sits right after #nowNext (phase-independent).
  const domT5a = makeDom("");
  await until(() => domT5a.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const dT5a = domT5a.window.document;
  const nnT5a = dT5a.querySelector("#nowNext"), hbT5a = dT5a.querySelector("#homeBoard");
  const adjacentT5a = !!nnT5a && !!hbT5a && nnT5a.nextElementSibling === hbT5a;
  domT5a.window.close();
  check("S25a-T5a: #homeBoard exists right after #nowNext",
    adjacentT5a, "nn=" + !!nnT5a + " hb=" + !!hbT5a + " adjacent=" + adjacentT5a);

  // T5b: event-phase parity — home slice rows equal the board's top rows,
  // in order (name + pos text + to-par text). Fix round 1 (Imp-2): the
  // comparison basis is explicitly the Board rendered ON the active season
  // (STATE.year=activeSeason() forced before capturing board rows) — Home
  // is now pinned there internally, so this is the correct apples-to-apples
  // basis regardless of whatever year the fixture happens to default to.
  const domT5b = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
  }));
  await until(() => domT5b.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  domT5b.window.eval("STATE.year=activeSeason(); STATE.open=null; renderLeaderboard();");
  const dT5b = domT5b.window.document;
  const boardRowsT5b = [...dT5b.querySelectorAll("#lbBody .lb-row")].map(rowSig);
  const homeRowsT5b = [...dT5b.querySelectorAll("#homeBoard .lb-row")].map(rowSig);
  domT5b.window.close();
  check("S25a-T5b: event-phase — home slice rows = board's top rows, in order (name + pos text + to-par text)",
    homeRowsT5b.length > 0 && homeRowsT5b.length <= boardRowsT5b.length
      && homeRowsT5b.every((r, i) => r.name === boardRowsT5b[i].name && r.pos === boardRowsT5b[i].pos && r.topar === boardRowsT5b[i].topar),
    "home=" + JSON.stringify(homeRowsT5b) + " board=" + JSON.stringify(boardRowsT5b));

  // T5c (the brief's SKELETON, completed): off-phase Home carries no board —
  // a real phase-gating assertion, not the brief's `return true` stub.
  const domT5c = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => offPhaseInfoT5 }),
  }));
  await until(() => domT5c.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  domT5c.window.eval("renderHomeBoard()");
  const homeHtmlT5c = domT5c.window.document.querySelector("#homeBoard")?.innerHTML;
  domT5c.window.close();
  check("S25a-T5c: off-phase Home carries no board (real phase toggle via dynInfo(365), never the real calendar)",
    homeHtmlT5c === "",
    "homeBoard.innerHTML=" + JSON.stringify(homeHtmlT5c));

  // T5d: non-interactive — <div> rows, no aria-expanded/aria-controls, a
  // click never opens a card (home rows carry no click handler at all).
  const domT5d = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
  }));
  await until(() => domT5d.window.document.querySelectorAll("#homeBoard .lb-row").length > 0);
  const homeRowElsT5d = [...domT5d.window.document.querySelectorAll("#homeBoard .lb-row")];
  const allDivsT5d = homeRowElsT5d.length > 0 && homeRowElsT5d.every(r => r.tagName === "DIV");
  const noAriaT5d = homeRowElsT5d.every(r => !r.hasAttribute("aria-expanded") && !r.hasAttribute("aria-controls"));
  homeRowElsT5d[0]?.dispatchEvent(new domT5d.window.Event("click", { bubbles: true }));
  const noCardT5d = !domT5d.window.document.querySelector("#homeBoard .card-drop");
  domT5d.window.close();
  check("S25a-T5d: Home rows are non-interactive — <div> not <button>, no aria-expanded/aria-controls, a click never opens a card",
    allDivsT5d && noAriaT5d && noCardT5d,
    "allDivs=" + allDivsT5d + " noAria=" + noAriaT5d + " noCardAfterClick=" + noCardT5d);

  // T5e: suppressed-pars state (parsSuppressed) flows through ctx identically
  // on Home — reuses X34/X37's blank-hole-7 course fixture idiom. Fix round 1
  // (Imp-1) extends this to the mechanism half of the CSS fix: X37 already
  // proves the Board's two .lb-tot spans hold an IDENTICAL plain-digit value
  // when suppressed (so hiding either one loses no information); this check
  // now proves the SAME honesty semantics on Home's rows, plus that the
  // .home-board wrapper actually carries lb-suppressed (the class the fixed
  // CSS selectors above key off — without it the hiding rule never engages).
  const courseBlank7T5e = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l)
    .join("\n");
  const domT5e = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7T5e }),
  }));
  await until(() => domT5e.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  // fix round 1 (Imp-2): board rendered explicitly ON the active season —
  // same reasoning as T5b.
  domT5e.window.eval("STATE.year=activeSeason(); STATE.open=null; renderLeaderboard();");
  const dT5e = domT5e.window.document;
  const boardRowsT5e = [...dT5e.querySelectorAll("#lbBody .lb-row")].map(rowSig);
  const homeRowsT5e = [...dT5e.querySelectorAll("#homeBoard .lb-row")].map(rowSig);
  const homeWrapperT5e = dT5e.querySelector("#homeBoard .home-board");
  const homeWrapperSuppressedT5e = !!homeWrapperT5e && homeWrapperT5e.classList.contains("lb-suppressed");
  // exactly ONE total-ish semantic value per home row: the raw .lb-tot.lb-total
  // span and the to-par-fallback .lb-tot span must hold the identical
  // plain-digit gross total — same idiom X37 uses on the Board side.
  const homeRowElsT5e = [...dT5e.querySelectorAll("#homeBoard .lb-row")];
  const sameValueHomeT5e = homeRowElsT5e.length > 0 && homeRowElsT5e.every(r => {
    const spans = r.querySelectorAll(".lb-tot");
    const raw = spans[0]?.textContent.trim(), fallback = spans[1]?.textContent.trim();
    return raw !== undefined && raw === fallback && /^\d+$/.test(fallback || "");
  });
  domT5e.window.close();
  check("S25a-T5e: suppressed-pars state flows through ctx identically on Home — dash positions + gross-total fallback match the Board row for row; .home-board wrapper carries lb-suppressed; each home row's raw-total and to-par-fallback spans hold the IDENTICAL plain-digit value (fix round 1, Imp-1 — same honesty semantics X37 asserts on the Board)",
    homeRowsT5e.length > 0 && homeRowsT5e.every(r => r.pos === "—")
      && homeRowsT5e.every((r, i) => r.name === boardRowsT5e[i].name && r.pos === boardRowsT5e[i].pos && r.topar === boardRowsT5e[i].topar)
      && homeWrapperSuppressedT5e && sameValueHomeT5e,
    "home=" + JSON.stringify(homeRowsT5e) + " board=" + JSON.stringify(boardRowsT5e)
      + " wrapperSuppressed=" + homeWrapperSuppressedT5e + " sameValueHome=" + sameValueHomeT5e);

  // T5f: ties at the cut include every tied row (slice may exceed 5). 7
  // custom teams, 4 clean ranks then a 3-way tie for 5th — the brief's cut
  // algorithm must keep all three tied rows, not clip to 5.
  const tieTeamsT5f = [["Alp", 140], ["Bly", 145], ["Cor", 150], ["Dex", 155],
    ["Efn", 160], ["Fen", 160], ["Gan", 160]];
  const scoresHeaderT5f = FIXTURES.scores.split(/\r\n|\n/)[0];
  const totalsRowT5f = (team, r1, r2) => [2026, team, "", ...Array(18).fill(""), r1, r2].join(",");
  const scoresT5f = scoresHeaderT5f + "\n"
    + tieTeamsT5f.map(([t, tot]) => totalsRowT5f(t, Math.round(tot / 2), tot - Math.round(tot / 2))).join("\n");
  const fieldHeaderT5f = FIXTURES.field.split(/\r\n|\n/)[0];
  const fieldT5f = fieldHeaderT5f + "\n"
    + tieTeamsT5f.map(([t]) => `2026,${t},${t},2019,8,In,TRUE,,`).join("\n");
  const domT5f = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => scoresT5f }),
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldT5f }),
  }));
  await until(() => domT5f.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  // fix round 1 (Imp-2): board rendered explicitly ON the active season —
  // same reasoning as T5b.
  domT5f.window.eval("STATE.year=activeSeason(); STATE.open=null; renderLeaderboard();");
  const dT5f = domT5f.window.document;
  const boardNamesT5f = [...dT5f.querySelectorAll("#lbBody .lb-row .lb-name")].map(e => e.textContent);
  const homeNamesT5f = [...dT5f.querySelectorAll("#homeBoard .lb-row .lb-name")].map(e => e.textContent);
  domT5f.window.close();
  check("S25a-T5f: ties at the cut include every tied row — a 3-way tie for 5th keeps the slice at 7, not clipped to 5",
    boardNamesT5f.length === 7 && homeNamesT5f.length === 7
      && homeNamesT5f.every((n, i) => n === boardNamesT5f[i]),
    "boardCount=" + boardNamesT5f.length + " homeCount=" + homeNamesT5f.length
      + " board=" + JSON.stringify(boardNamesT5f) + " home=" + JSON.stringify(homeNamesT5f));

  // T5g: the "Full leaderboard" link — exact copy + #board href.
  const domT5g = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
  }));
  await until(() => domT5g.window.document.querySelectorAll("#homeBoard .lb-row").length > 0);
  const linkT5g = domT5g.window.document.querySelector("#homeBoard .home-board-link");
  const linkOkT5g = !!linkT5g && linkT5g.getAttribute("href") === "#board"
    && linkT5g.textContent.trim() === "Full leaderboard →";
  domT5g.window.close();
  check("S25a-T5g: 'Full leaderboard →' link present with href=#board, exact copy",
    linkOkT5g,
    "href=" + (linkT5g && linkT5g.getAttribute("href")) + " text=" + JSON.stringify(linkT5g && linkT5g.textContent));

  // T5h: empty players (zero score rows) → Home carries no board either,
  // same honest-empty rule as the Board's own #lbBody. No positive DOM
  // marker to poll for (zero rows is the expected steady state), so settle
  // instead of until — same idiom as the pre-existing B2 empty-scores check.
  const emptyScoresT5h = FIXTURES.scores.split(/\r\n|\n/)[0] + "\r\n";
  const domT5h = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => emptyScoresT5h }),
  }));
  await settle();
  const homeHtmlT5h = domT5h.window.document.querySelector("#homeBoard")?.innerHTML;
  domT5h.window.close();
  check("S25a-T5h: empty players (no cards posted) → #homeBoard empty even in event phase",
    homeHtmlT5h === "",
    "homeBoard.innerHTML=" + JSON.stringify(homeHtmlT5h));

  // T5i: no second timestamp — the slice inherits the §24 strip's stamp
  // above it; #homeBoard itself must never render its own sync/stamp text.
  const domT5i = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
  }));
  await until(() => domT5i.window.document.querySelectorAll("#homeBoard .lb-row").length > 0);
  const homeHtmlT5i = domT5i.window.document.querySelector("#homeBoard").innerHTML;
  domT5i.window.close();
  check("S25a-T5i: no second timestamp inside #homeBoard (the §24 strip's stamp above it is the only one)",
    !/class="sync"/i.test(homeHtmlT5i) && !/Checked |Updated |Couldn't refresh|Saved copy/.test(homeHtmlT5i),
    "homeBoard.innerHTML=" + JSON.stringify(homeHtmlT5i.slice(0, 200)));

  // T5j (fix round 1, Imp-3): T5b/T5e only compare three TEXT fields (name,
  // pos, to-par) — a Home-only divergence in the to-par TIER CLASS, the
  // `lead` class, or the " WD" marker would change none of those three
  // strings and pass both checks silently. Per-index STRUCTURAL comparison
  // instead: home row innerHTML with the .lb-mv span stripped (Home always
  // passes mv:null while the Board may show a real arrow — that's an
  // intentional, already-asserted difference, not a defect) must equal the
  // board row's identically-stripped innerHTML, AND the row wrapper's own
  // className must match (the interactive button-vs-div TAG itself is the
  // only allowed difference — asserted separately by T5d). Reuses V6's
  // exact WD-fixture idiom so the WD-marker path is actually exercised
  // (default fixture never has a wd team); the default fixture's own
  // tied-for-1st rows already exercise `lead`, and its spread of rel
  // values already exercises all three to-par tier classes.
  const fieldTexWdT5j = FIXTURES.field.replace("2026,Tex,Tex,2019,18,In,TRUE,", "2026,Tex,Tex,2019,18,wd,TRUE,");
  const domT5j = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => fieldTexWdT5j }),
  }));
  await until(() => domT5j.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  domT5j.window.eval("STATE.year=activeSeason(); STATE.open=null; renderLeaderboard();");
  const dT5j = domT5j.window.document;
  const stripMvT5j = (el) => {
    const clone = el.cloneNode(true);
    const mv = clone.querySelector(".lb-mv");
    if (mv) mv.remove();
    return clone.innerHTML;
  };
  const boardRowElsT5j = [...dT5j.querySelectorAll("#lbBody .lb-row")];
  const homeRowElsT5j = [...dT5j.querySelectorAll("#homeBoard .lb-row")];
  const innerMatchT5j = homeRowElsT5j.length > 0
    && homeRowElsT5j.every((r, i) => stripMvT5j(r) === stripMvT5j(boardRowElsT5j[i]));
  const classMatchT5j = homeRowElsT5j.every((r, i) => r.className === boardRowElsT5j[i].className);
  const wdExercisedT5j = homeRowElsT5j.some(r => /\bWD\b/.test(r.textContent));
  const tierExercisedT5j = boardRowElsT5j.some(r => /lb-under|lb-even|lb-over/.test(r.innerHTML));
  const leadExercisedT5j = boardRowElsT5j.some(r => r.className.includes("lead"));
  domT5j.window.close();
  check("S25a-T5j: per-index STRUCTURAL parity (fix round 1, Imp-3) — home row innerHTML with .lb-mv stripped equals the board row's (WD marker + to-par tier class both included, not just name/pos/to-par text), and the row wrapper's own className matches (lead class included)",
    innerMatchT5j && classMatchT5j && wdExercisedT5j && tierExercisedT5j && leadExercisedT5j,
    "innerMatch=" + innerMatchT5j + " classMatch=" + classMatchT5j + " wdExercised=" + wdExercisedT5j
      + " tierExercised=" + tierExercisedT5j + " leadExercised=" + leadExercisedT5j
      + " homeClasses=" + JSON.stringify(homeRowElsT5j.map(r => r.className))
      + " boardClasses=" + JSON.stringify(boardRowElsT5j.map(r => r.className)));

  // T5k (fix round 1, Imp-2, RULED): the year picker flipped to an archive
  // year must NOT rewrite Home's hero out from under a live countdown —
  // Home stays pinned to activeSeason() even while the Board itself now
  // shows a different year's (different) roster. Reuses T4h's own
  // otherYear/.year-btn idiom (the default fixture reliably carries a 2025
  // archive row alongside 2026, same precondition T4h already depends on).
  // Must FAIL if the activeSeason() pin in renderHomeBoard/wdKeySet is
  // removed (Home would then follow STATE.year like the Board does).
  const domT5k = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
  }));
  await until(() => domT5k.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const dT5k = domT5k.window.document;
  const activeSeasonT5k = domT5k.window.eval("activeSeason()");
  const homeNamesBeforeT5k = [...dT5k.querySelectorAll("#homeBoard .lb-row .lb-name")].map(e => e.textContent);
  const yearBtnsT5k = [...dT5k.querySelectorAll("#years .year-btn")];
  const otherBtnT5k = yearBtnsT5k.find(b => b.dataset.year !== activeSeasonT5k);
  let switchedToT5k = null, boardNamesAfterT5k = null, homeNamesAfterT5k = null;
  if (otherBtnT5k) {
    otherBtnT5k.click();
    switchedToT5k = domT5k.window.eval("STATE.year");
    boardNamesAfterT5k = [...dT5k.querySelectorAll("#lbBody .lb-row .lb-name")].map(e => e.textContent);
    homeNamesAfterT5k = [...dT5k.querySelectorAll("#homeBoard .lb-row .lb-name")].map(e => e.textContent);
  }
  domT5k.window.close();
  check("S25a-T5k: fix round 1 (Imp-2, RULED) — year picker flipped to an archive year: Home's slice stays pinned to the active season (unchanged names before/after), even though the Board itself now shows the archive year's different roster",
    !!otherBtnT5k && switchedToT5k !== activeSeasonT5k
      && homeNamesBeforeT5k.length > 0 && homeNamesAfterT5k !== null
      && JSON.stringify(homeNamesAfterT5k) === JSON.stringify(homeNamesBeforeT5k)
      && JSON.stringify(boardNamesAfterT5k) !== JSON.stringify(homeNamesBeforeT5k),
    "activeSeason=" + activeSeasonT5k + " years=" + JSON.stringify(yearBtnsT5k.map(b => b.dataset.year))
      + " switchedTo=" + switchedToT5k
      + " homeBefore=" + JSON.stringify(homeNamesBeforeT5k)
      + " homeAfter=" + JSON.stringify(homeNamesAfterT5k)
      + " boardAfter=" + JSON.stringify(boardNamesAfterT5k));

  // S25a-T5l (final fix wave, F2a — Home mv-cell alignment): T5j strips
  // .lb-mv before comparing home/board innerHTML (by design — Home always
  // passes ctx.mv=null while the Board may show a real arrow), which means
  // a regression where lbRowHTML only builds the mv cell for the
  // interactive path (e.g. `${interactive?mvHtml:""}`) would pass T5j/T5b/
  // T5e untouched while silently misaligning Home's grid columns against
  // the Board's own 8-track template (T4i/T4k's column-count contract).
  // Asserted directly instead: a rendered Home row must CONTAIN a .lb-mv
  // span, in its dash form (ctx.mv is always null on Home).
  const domT5l = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => inWindowInfoT5 }),
  }));
  await until(() => domT5l.window.document.querySelectorAll("#homeBoard .lb-row").length > 0);
  const homeRowT5l = domT5l.window.document.querySelector("#homeBoard .lb-row");
  const mvSpanT5l = homeRowT5l?.querySelector(".lb-mv");
  const dashOkT5l = !!mvSpanT5l && mvSpanT5l.textContent.trim() === "—";
  domT5l.window.close();
  check("S25a-T5l (final fix wave, F2a): Home row renders a .lb-mv span (dash form) — lbRowHTML must fill the mv cell on BOTH render paths so Home's grid stays column-aligned with the Board's (T4i/T4k contract), even though Home always passes ctx.mv=null",
    dashOkT5l,
    "hasSpan=" + !!mvSpanT5l + " text=" + JSON.stringify(mvSpanT5l && mvSpanT5l.textContent));
}

{ // T6: broadcast lower-third restyle of the §24 strip + announce banner
  // (S25a B-LT). CSS-ONLY task — zero JS edits. Reuses T2's exact
  // rule-parser idiom (strip comments, split each rule's selector list on
  // commas, look up bodies by EXACT selector token) so a later duplicate
  // or reverted rule fails closed instead of passing on an earlier stale
  // match elsewhere in the file.
  const idx = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const styleBlock = (idx.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1].replace(/\/\*[\s\S]*?\*\//g, "");
  const cssRules = [...styleBlock.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ selectors: sel.split(",").map(s => s.trim()).filter(Boolean), body }));
  const rulesFor = (selector) => cssRules.filter(r => r.selectors.includes(selector)).map(r => r.body);
  const letterSpacingEm = (body) => { const m = body.match(/letter-spacing:\s*([\d.]+)em/); return m ? parseFloat(m[1]) : null; };

  // T6a: the strip container carries the 2px brass left rule, keyed to
  // #nowNext:not(:empty) rather than bare #nowNext — paintHome's own
  // nn.innerHTML="" off-event branch (untouched — no JS edited by this
  // task) already leaves the container CSS-:empty, so the rule only paints
  // while there's real content, with no JS class-toggle needed.
  const nnBodies = rulesFor("#nowNext:not(:empty)");
  const nnRuleOK = nnBodies.some(b => /border-left:\s*2px\s+solid\s+var\(--brass\)/.test(b));
  check("S25a-T6a: strip container (#nowNext:not(:empty)) carries a 2px solid var(--brass) left rule",
    nnRuleOK, "bodies=" + JSON.stringify(nnBodies));

  // T6b: the strip's kicker (the Now:/Next: label, `.nn-row strong` in
  // paintHome's existing template — untouched) is letterspaced (>=.2em)
  // sage caps, the .eyebrow idiom; the row's own content stays bone
  // (unchanged from §24 — this restyle must not regress that color).
  const kickerBodies = rulesFor(".nn-row strong");
  const kickerOK = kickerBodies.some(b => /color:\s*var\(--sage\)/.test(b)
    && /text-transform:\s*uppercase/.test(b) && (letterSpacingEm(b) ?? 0) >= 0.2);
  const rowBodies = rulesFor(".nn-row");
  const rowBoneOK = rowBodies.some(b => /color:\s*var\(--bone\)/.test(b));
  check("S25a-T6b: strip kicker (.nn-row strong) is letterspaced (>=.2em) sage caps, following the .eyebrow idiom; row content (.nn-row) stays bone, unregressed",
    kickerOK && rowBoneOK, "kickerBodies=" + JSON.stringify(kickerBodies) + " rowBodies=" + JSON.stringify(rowBodies));

  // T6c: the announce banner gets the same rule-family treatment — a 2px
  // left rule — AND its §24 fix-round-1 contrast floor (comment on
  // #announceBar: "#fff on brass was ~2.2:1; pine on brass is ~7.5:1") must
  // not regress. The banner's OWN background is brass, so a brass rule
  // would be invisible; var(--pine) is its already-established
  // high-contrast partner (the same color #annDismiss already borders
  // itself in), so the rule color differs from the strip's on purpose.
  // Contrast is parsed LIVE from index.html's own --pine/--brass tokens
  // (T1c's idiom), not a frozen literal, so a future token edit is caught
  // here too.
  const bannerBodies = rulesFor("#announceBar");
  const bannerRuleOK = bannerBodies.some(b => /border-left:\s*2px\s+solid\s+var\(--pine\)/.test(b));
  const lum = (hex) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (f, b) => { const [hi, lo] = [Math.max(lum(f), lum(b)), Math.min(lum(f), lum(b))];
    return (hi + 0.05) / (lo + 0.05); };
  const pineHexT6 = (idx.match(/--pine:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
  const brassHexT6 = (idx.match(/--brass:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
  const bannerRatio = pineHexT6 && brassHexT6 ? ratio(pineHexT6, brassHexT6) : 0;
  check("S25a-T6c: announce banner (#announceBar) carries the same 2px solid left-rule family (in var(--pine), its own high-contrast partner) AND its pine-on-brass text contrast still holds the 4.5:1 floor, never regressed by this restyle",
    bannerRuleOK && bannerRatio >= 4.5,
    "ruleBodies=" + JSON.stringify(bannerBodies) + " pine=" + pineHexT6 + " brass=" + brassHexT6 + " ratio=" + bannerRatio.toFixed(3));
}

/* ---------------------------------------------------------------------
   S25b-T1: finish audits — numerals, hairline rules, empty-state ceremony
   (2026-08-31-gfy-s25b-finish-polish, task-1). §25a is FROZEN in semantics
   (tokens, tier classes, masthead/mv/home code) — this wave is FORM only,
   zero copy changes. Full three-part audit (numerals, rules, gold-as-metal)
   is in task-1-report.md; these checks encode only the findings that
   produced a real CSS change.
   --------------------------------------------------------------------- */
{
  const idxB1 = readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("S25b-T1a: .lb-head carries the Identity-board double hairline (border-bottom rgba(200,162,74,.45) + ::after rgba(200,162,74,.2)), matching .mast-rule's own two-tone convention — the Board's head/body seam now reads with the same masthead-grade emphasis as the top of the page",
    /\.lb-head\{[^}]*border-bottom:1px solid rgba\(200,162,74,\.45\)/.test(idxB1)
    && /\.lb-head::after\{[^}]*rgba\(200,162,74,\.2\)/.test(idxB1),
    "lb-head rules");
  check("S25b-T1b: empty states styled as ceremony (small-caps letterspaced sage, centered, not an italic brass-dim apology) — the WORDS are untouched, only the dress changed",
    /\.lb-empty,\.sched-empty\{[^}]*letter-spacing:\.24em/.test(idxB1)
    && /\.lb-empty,\.sched-empty\{[^}]*text-align:center/.test(idxB1)
    && !/\.lb-empty,\.sched-empty\{[^}]*font-style:italic/.test(idxB1),
    "empty-state css");
  // T1c: numerals audit — every selector the audit found holding a digit
  // that stacks down a real column (or ticks in place) without
  // font-variant-numeric:tabular-nums. Money/scorecard/countdown numerals
  // (.mn-*/.pot dd/.sg-t td/.sc-tile-v/.cd-num/etc.) already carried it —
  // confirmed present in the audit, not re-asserted here (already covered
  // by earlier S25a checks; re-asserting would test frozen rules, not this
  // task's own findings).
  const numT1c = {
    "lb-pos": /\.lb-pos\{[^}]*font-variant-numeric:tabular-nums/.test(idxB1),
    "lb-mv": /\.lb-mv\{[^}]*font-variant-numeric:tabular-nums/.test(idxB1),
    "entry-year": /\.entry-year\{[^}]*font-variant-numeric:tabular-nums/.test(idxB1),
    "pay-place": /\.pay-place\{[^}]*font-variant-numeric:tabular-nums/.test(idxB1),
    "grp-time": /\.grp-time\{[^}]*font-variant-numeric:tabular-nums/.test(idxB1),
    "slot-time": /\.slot-time\{[^}]*font-variant-numeric:tabular-nums/.test(idxB1),
  };
  check("S25b-T1c: numerals audit additions — .lb-pos (Board position column), .lb-mv (movement-count column), .entry-year (Champions ledger year column), .pay-place (payout place column), .grp-time (pairing tee-time column), .slot-time (schedule slot-time column) all gained font-variant-numeric:tabular-nums",
    Object.values(numT1c).every(Boolean),
    "found=" + JSON.stringify(numT1c));
  check("S25b-T1d: rules audit — .sg-t thead th carries a double-rule head/body seam (border-bottom:3px double rgba(200,162,74,.45)) instead of the plain .14-alpha grid line every body cell shares; border-style:double (not a .lb-head-style ::after) because the sticky .sg-team column immediately below is position:sticky;z-index:2 and would win any stacking fight against an absolutely-positioned, z-index:auto pseudo",
    /\.sg-t thead th\{border-bottom:3px double rgba\(200,162,74,\.45\)\}/.test(idxB1),
    "sg-t thead rule");
}

/* ---------------------------------------------------------------------
   S25b-T2: hole-panel photo/map frames + the wave's two sanctioned motion
   moments (2026-08-31-gfy-s25b-finish-polish, task-2), plus the folded-in
   .mn-empty/.photo-empty ceremony catch-up (same bar as T1's empty-state
   pass). §25a/§24 scorer path frozen — zero copy changes.
   --------------------------------------------------------------------- */
{
  const idxB2 = readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("S25b-T2a: hole-panel imagery carries the hairline frame treatment — .sg-p-photo, .sg-p-map img, AND .sg-p-crop (the overflow-crop WRAPPER, since .sg-p-crop-img itself is the 350%-wide scrolling layer inside it and can't be bordered/padded directly) all carry the rgba(200,162,74,.28) hairline + pine-3 ground; dropping any ONE of the three fails this check",
    /\.sg-p-photo\{[^}]*border:1px solid rgba\(200,162,74,\.28\)[^}]*background:var\(--pine-3\)/.test(idxB2)
    && /\.sg-p-map img\{[^}]*border:1px solid rgba\(200,162,74,\.28\)[^}]*background:var\(--pine-3\)/.test(idxB2)
    && /\.sg-p-crop\{[^}]*border:1px solid rgba\(200,162,74,\.28\)[^}]*background:var\(--pine-3\)/.test(idxB2),
    "photo frames");
  check("S25b-T2b: score-flash + arrow entrance exist AND are disabled under prefers-reduced-motion (the site's ONE general reduced-motion block, never a second)",
    /\.lb-flash\{[^}]*animation:\s*lbFlash/.test(idxB2)
    && /\.lb-mv\.up,\.lb-mv\.down\{[^}]*animation:\s*mvIn/.test(idxB2)
    && /prefers-reduced-motion[\s\S]*?\.lb-flash,\.lb-mv\.up,\.lb-mv\.down\{[^}]*animation:\s*none/.test(idxB2.replace(/\n/g," ")),
    "motion + rm guard");
  check("S25b-T2c (fold-in, controller ruling): .mn-empty and .photo-empty get the SAME ceremony delta T1 gave .lb-empty,.sched-empty — sage not brass-dim, normal not italic, small-caps letterspaced kicker — words untouched",
    /\.mn-empty\{[^}]*color:var\(--sage\)[^}]*letter-spacing:\.24em[^}]*text-transform:uppercase/.test(idxB2)
    && !/\.mn-empty\{[^}]*font-style:italic/.test(idxB2)
    && /\.photo-empty\{[^}]*color:var\(--sage\)[^}]*letter-spacing:\.24em[^}]*text-transform:uppercase/.test(idxB2)
    && !/\.photo-empty\{[^}]*font-style:italic/.test(idxB2),
    "mn-empty/photo-empty css");
}

{ // S25b-T2d: score-change flash — real DOM mechanism, not just source text.
  // Order is left UNCHANGED between the hand-primed prevBoard and the live
  // board (isolates the VALUE diff from B-MV's own order diff); only the
  // FIRST team's prior to-par text is forced different from its current
  // text, every other team's prior value is set to match current exactly —
  // proves the flash is per-row, not a board-wide toggle.
  const domT2d = makeDom("");
  await until(() => domT2d.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const yearT2d = domT2d.window.eval("STATE.year");
  const rowsT2d = [...domT2d.window.document.querySelectorAll("#lbBody .lb-row")];
  const keysT2d = rowsT2d.map(r => r.dataset.player);
  const curValsT2d = rowsT2d.map(r => r.querySelectorAll(".lb-tot")[1]?.textContent);
  const primeValsT2d = keysT2d.map((k, i) => [k, i === 0 ? (curValsT2d[i] + "·prior") : curValsT2d[i]]);
  domT2d.window.eval(
    "STATE.prevBoard = " + JSON.stringify({ order: keysT2d, year: yearT2d, at: Date.now() }) + "; " +
    "STATE.prevVals = { vals: new Map(" + JSON.stringify(primeValsT2d) + "), year: " + JSON.stringify(yearT2d) + ", at: Date.now() }; " +
    "renderLeaderboard();"
  );
  const flashFlagsT2d = [...domT2d.window.document.querySelectorAll("#lbBody .lb-row")].map(r => r.classList.contains("lb-flash"));
  domT2d.window.close();
  const multiRowT2d = keysT2d.length > 1;
  const onlyFirstFlashedT2d = multiRowT2d && flashFlagsT2d[0] === true && flashFlagsT2d.slice(1).every(f => f === false);
  check("S25b-T2d: score-change flash fires ONLY on the row whose to-par text actually changed since the previous paint (fresh, same-year basis — the identical honesty state S25a-T4e already proves live for the arrows) — every unchanged row stays un-flashed",
    onlyFirstFlashedT2d,
    "teams=" + keysT2d.length + " keys=" + JSON.stringify(keysT2d) + " flashFlags=" + JSON.stringify(flashFlagsT2d));
}

{ // S25b-T2e (mutation-kill target): par-suppressed board — a fresh,
  // same-year, hand-primed STATE.prevVals whose values genuinely differ
  // from every live row (T2d's own positive precondition, reused verbatim)
  // must still produce ZERO .lb-flash rows — the flash rides mv's own
  // suppression gate (S25a-T4m's exact precondition) rather than a second,
  // independently-driftable one.
  const courseBlank7T2e = FIXTURES.course.split("\n")
    .map(l => l.startsWith("7,") ? "7,," + l.split(",")[2] : l).join("\n");
  const domT2e = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBlank7T2e }),
  }));
  await until(() => domT2e.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const yearT2e = domT2e.window.eval("STATE.year");
  const keysT2e = [...domT2e.window.document.querySelectorAll("#lbBody .lb-row")].map(r => r.dataset.player);
  domT2e.window.eval(
    "STATE.prevBoard = " + JSON.stringify({ order: keysT2e, year: yearT2e, at: Date.now() }) + "; " +
    "STATE.prevVals = { vals: new Map(" + JSON.stringify(keysT2e.map(k => [k, "SOMETHING_ELSE_ENTIRELY"])) + "), year: " + JSON.stringify(yearT2e) + ", at: Date.now() }; " +
    "renderLeaderboard();"
  );
  const flashAnyT2e = [...domT2e.window.document.querySelectorAll("#lbBody .lb-row")].some(r => r.classList.contains("lb-flash"));
  domT2e.window.close();
  check("S25b-T2e: par-suppressed board — a fresh, same-year, hand-primed STATE.prevVals whose values genuinely differ from every live row still produces ZERO .lb-flash rows — suppression suppresses the flash exactly like S25a-T4m already proves it suppresses the arrows",
    keysT2e.length > 0 && !flashAnyT2e,
    "keys=" + JSON.stringify(keysT2e) + " flashAny=" + flashAnyT2e);
}

{ // S25b-T2f: first paint — STATE.prevVals is still null (this dom's very
  // first render), so the flash gate can't fire regardless of anything
  // else, mirroring S25a-T4d's first-paint dash proof for the arrows.
  const domT2f = makeDom("");
  await until(() => domT2f.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const rowsT2f = [...domT2f.window.document.querySelectorAll("#lbBody .lb-row")];
  const flashAnyT2f = rowsT2f.some(r => r.classList.contains("lb-flash"));
  domT2f.window.close();
  check("S25b-T2f: first paint (no prior STATE.prevVals yet) never flashes any row",
    rowsT2f.length > 0 && !flashAnyT2f,
    "rows=" + rowsT2f.length + " flashAny=" + flashAnyT2f);
}

{ // S25b-T2g (fix round 1, review Important — capture-seam coverage): T2d/
  // e/f all hand-prime STATE.prevVals directly and call renderLeaderboard()
  // themselves, so BOTH real capture lines — the STATE.lastBoardVals stash
  // in renderLeaderboard() and its promotion into STATE.prevVals in paint()
  // — are removable with the whole suite still green. Exactly the risk
  // class S25a-T4l guards for prevBoard/arrows; this is that SAME guard for
  // prevVals/flash. Mirrors T4l's idiom verbatim: drives the REAL
  // load()/paint() path TWICE via a mutable fetch-stub phase flag, with
  // ONLY Duck's total changed between paints (Sully/Tex totals held fixed,
  // so their to-par text is byte-identical both paints — a same-value
  // control the flash gate must NOT fire on).
  let phaseT2g = 1;
  const scoresHeaderT2g = FIXTURES.scores.split(/\r\n|\n/)[0];
  const totalsRowT2g = (team, r1, r2) => [2026, team, "", ...Array(18).fill(""), r1, r2].join(",");
  const scoresPhase1T2g = scoresHeaderT2g + "\n"
    + totalsRowT2g("Duck", 70, 70) + "\n"
    + totalsRowT2g("Sully", 75, 75) + "\n"
    + totalsRowT2g("Tex", 80, 80);
  const scoresPhase2T2g = scoresHeaderT2g + "\n"
    + totalsRowT2g("Duck", 75, 70) + "\n"   // Duck's total (+5) — to-par text must change
    + totalsRowT2g("Sully", 75, 75) + "\n"  // unchanged — control
    + totalsRowT2g("Tex", 80, 80);          // unchanged — control
  const domT2g = makeDom("", withOverride({
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => phaseT2g === 1 ? scoresPhase1T2g : scoresPhase2T2g }),
  }));
  await until(() => domT2g.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const yearT2g = domT2g.window.eval("STATE.year");
  // shape asserted right after the FIRST real paint — must already reflect
  // paint()'s own capture line, not a test-side stand-in.
  const prevValsShapeT2g = domT2g.window.eval(
    "(function(){var v=STATE.prevVals; return v && {isMap: v.vals instanceof Map, size: (v.vals&&v.vals.size)||0, year: v.year, atType: typeof v.at};})()"
  );
  const rowForT2g = (k) => domT2g.window.document.querySelector('#lbBody .lb-row[data-player="' + k + '"]');
  const duckParFirstT2g = rowForT2g("duck")?.querySelectorAll(".lb-tot")[1]?.textContent;
  phaseT2g = 2;
  // age the history so the second load() actually refetches scores (same
  // idiom S25a-T4l uses) — the paint()-capture seam is what's tested.
  domT2g.window.eval("Object.keys(LAST_GOT).forEach(t=>{LAST_GOT[t].reqAt-=COLD_MS+1000})");
  await domT2g.window.load(); // second REAL paint — the same load() path T4l exercises
  const duckRowT2g = rowForT2g("duck"), sullyRowT2g = rowForT2g("sully"), texRowT2g = rowForT2g("tex");
  const duckParSecondT2g = duckRowT2g?.querySelectorAll(".lb-tot")[1]?.textContent;
  const duckFlashT2g = !!duckRowT2g?.classList.contains("lb-flash");
  const sullyFlashT2g = !!sullyRowT2g?.classList.contains("lb-flash");
  const texFlashT2g = !!texRowT2g?.classList.contains("lb-flash");
  domT2g.window.close();
  const parChangedT2g = duckParFirstT2g !== undefined && duckParSecondT2g !== undefined && duckParFirstT2g !== duckParSecondT2g;
  const shapeOkT2g = !!prevValsShapeT2g && prevValsShapeT2g.isMap === true && prevValsShapeT2g.size > 0
    && prevValsShapeT2g.year === yearT2g && prevValsShapeT2g.atType === "number";
  const flashOkT2g = duckFlashT2g && !sullyFlashT2g && !texFlashT2g;
  check("S25b-T2g (fix round 1, review Important): capture-seam coverage — the REAL load()/paint() path, driven TWICE with Duck's total changed between paints (S25a-T4l's own dyn fixture-override idiom), leaves STATE.prevVals holding {vals:Map,year,at:number} after the FIRST paint (paint()'s own promotion line, never hand-primed), Duck's to-par text is proven to actually differ between paints, and the SECOND paint flashes Duck ONLY — Sully/Tex (unchanged totals, same-value control) never flash",
    parChangedT2g && shapeOkT2g && flashOkT2g,
    "duckParFirst=" + JSON.stringify(duckParFirstT2g) + " duckParSecond=" + JSON.stringify(duckParSecondT2g) +
      " prevValsShape=" + JSON.stringify(prevValsShapeT2g) + " year=" + JSON.stringify(yearT2g) +
      " duckFlash=" + duckFlashT2g + " sullyFlash=" + sullyFlashT2g + " texFlash=" + texFlashT2g);
}

/* ---------------------------------------------------------------------
   GROUP FV (cont.) — 2026-08-28 polish wave (Riley-approved):
   FV7 name-list class split, FV8 stale-calendar CTA, FV9 phase-aware
   board eyebrow, FV10 draft-list legibility.
   --------------------------------------------------------------------- */

// FV7: funnel/rooms NAME lists get .name-list (left-aligned) — .mn-net is a
// right-aligned MONEY-COLUMN class (live defect: bullet far left, name far
// right). Structural: source CSS defines .name-list without text-align:right
// and keeps .down/.up color modifiers; the rendered lists carry .name-list
// and NOT .mn-net; the money table's Net column keeps .mn-net untouched.
{
  const idxFV7 = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const nlCSS = (idxFV7.match(/\.name-list\{[^}]*\}/) || [""])[0];
  const domFV7 = makeDom("?admin=1");
  await until(() => (domFV7.window.document.querySelector("#nyBody")?.textContent || "").includes("paid"));
  const d7 = domFV7.window.document;
  const nyLists = [...d7.querySelectorAll("#nyBody ul")];
  const roomsQ = d7.querySelector("#roomsQueue ul");
  check("FV7: every Next Year name <ul> (owing + admin stages/declined/refunds) and the Rooms queue carry .name-list and never .mn-net; .name-list CSS exists w/o text-align:right (+ .down modifier); money Net column keeps .mn-net",
    nyLists.length >= 3
      && nyLists.every(u => u.classList.contains("name-list") && !u.classList.contains("mn-net"))
      && !!roomsQ && roomsQ.classList.contains("name-list") && !roomsQ.classList.contains("mn-net")
      && nlCSS.length > 0 && !/text-align:\s*right/.test(nlCSS)
      && /\.name-list\.down\{/.test(idxFV7)
      && /class="mn-net"/.test(idxFV7)                       // money table header cell untouched
      && /mn-net\$\{cls\}/.test(idxFV7),                     // money net cell untouched
    "lists=" + nyLists.map(u => u.className).join("|") + " rooms=" + (roomsQ && roomsQ.className) + " css=" + nlCSS);
  domFV7.window.close();
}

// FV8: "Add to calendar" is honest about the calendar — hidden once the
// effective first_tee is >7 days past (there is no upcoming event to add);
// visible again the moment a future first_tee is configured. Default
// fixtures (first_tee 2026-08-15, long past) = hidden.
{
  const domPast = makeDom("");
  await until(() => (domPast.window.document.querySelectorAll("#lbBody .lb-row").length) > 0);
  const btnPast = domPast.window.document.querySelector("#icsBtn");
  // NO offsetParent here — jsdom does no layout, offsetParent is ALWAYS null
  // (a vacuous pass, caught red-handed on this check's first run).
  const hiddenPast = !btnPast || btnPast.hidden === true;
  domPast.window.close();
  const futureISO = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10) + "T09:00:00-06:00";
  const infoFuture = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", futureISO);
  const futFetch = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoFuture }),
  });
  const domFut = makeDom("", futFetch);
  await until(() => (domFut.window.document.querySelectorAll("#lbBody .lb-row").length) > 0);
  const btnFut = domFut.window.document.querySelector("#icsBtn");
  const shownFut = !!btnFut && btnFut.hidden !== true;
  domFut.window.close();
  // jsdom has no cascade: the hidden ATTRIBUTE alone is invisible-blind when
  // an author display rule wins (review 08-28, mutation-proven) — so also
  // assert the companion `.btn[hidden]` rule exists in the source.
  const idxFV8 = readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("FV8: stale-event calendar honesty — #icsBtn hidden when first_tee >7d past (default fixtures), visible with a future first_tee; companion .btn[hidden]{display:none} cascade rule present",
    hiddenPast && shownFut && /\.btn\[hidden\]\{display:none\}/.test(idxFV8),
    "hiddenPast=" + hiddenPast + " shownFut=" + shownFut);
}

// FV9: the Board eyebrow only claims "Live from the course" inside the
// event window; off-season it reads "Final standings" (phase-aware, same
// seasonPhase() the masthead chip uses — never a second phase model).
{
  const domOff = makeDom("");
  await until(() => (domOff.window.document.querySelectorAll("#lbBody .lb-row").length) > 0);
  const offText = (domOff.window.document.querySelector('[data-view="board"] .eyebrow') || {}).textContent || "";
  domOff.window.close();
  const nowISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10) + "T09:00:00-06:00"; // yesterday = inside ±3d window
  const infoEvent = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", nowISO);
  const evFetch = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoEvent }),
  });
  const domEv = makeDom("", evFetch);
  await until(() => (domEv.window.document.querySelectorAll("#lbBody .lb-row").length) > 0);
  const evText = (domEv.window.document.querySelector('[data-view="board"] .eyebrow') || {}).textContent || "";
  domEv.window.close();
  check("FV9: board eyebrow phase-aware — 'Final standings' off-season, 'Live from the course' only inside the event window",
    offText.trim() === "Final standings" && evText.trim() === "Live from the course",
    "off=" + JSON.stringify(offText) + " ev=" + JSON.stringify(evText));
}

// FV10: draft legibility — a drafted group whose team label matches no
// captain shows the RAW team label as its header (never a headerless
// cluster; the live sheet's orphan labels rendered exactly that); both
// draft columns carry a small Hcp header.
{
  const orphanCSV = [
    "year,player,team,since,handicap,status,deposit,paid_date,strengths",
    "2026,Duck,Voss,2019,8,In,TRUE,,",
    "2026,Hammer,Voss,2019,10,In,TRUE,,",
    "2026,Sully,,2021,15,In,TRUE,,",
  ].join("\n");
  const orphanFetch = withOverride({
    field: () => Promise.resolve({ ok: true, status: 200, text: async () => orphanCSV }),
  });
  const domFV10 = makeDom("", orphanFetch);
  await until(() => (domFV10.window.document.querySelectorAll("#draftTeams .draft-team").length) > 0);
  const d10 = domFV10.window.document;
  const lab = d10.querySelector("#draftTeams .draft-team .draft-lab");
  const subs = [...d10.querySelectorAll(".draft-h .draft-sub")].map(s => s.textContent || "");
  check("FV10: orphan-label drafted group headed by its raw team label ('Voss'); both draft column headers carry explanatory subtitles (low-handicap-first / captain-first)",
    !!lab && /Voss/.test(lab.textContent || "")
      && subs.length === 2 && /handicap/i.test(subs[0]) && /captain/i.test(subs[1]),
    "lab=" + JSON.stringify(lab && lab.textContent) + " subs=" + JSON.stringify(subs));
  domFV10.window.close();
}

/* ---------------------------------------------------------------------
   GROUP FT — fetch tiers + jitter (refine wave 2, Riley-approved 08-27).
   Grounding: published-CSV rate-limits bursts AND lags the sheet ~1-5min,
   so 60s polling of archive tabs oversamples its own source; lodge-wifi
   NAT amplifies. HOT tabs keep 60s during the event window; everything
   else (and everything off-season) refreshes at 5min; the timer jitters
   ±10s to desynchronize clients behind one NAT.
   --------------------------------------------------------------------- */

// FT1: dueTabs(now, lastAt, phase) pure matrix — hot-only at 60s in event
// phase; NOTHING due at 60s off-season; everything due at 301s or with no
// history. Cadence changes must fail here first.
{
  const domFT1 = makeDom("");
  await until(() => (domFT1.window.document.querySelectorAll("#lbBody .lb-row").length) > 0);
  const w = domFT1.window;
  const tabs = w.eval("TABS");
  const HOT = w.eval("CONFIG.REFRESH_MS"), COLD = w.eval("COLD_MS");   // harness sets REFRESH_MS=1h; COLD_MS=5x — derive, never assume 60s
  const NOW = 1e12;
  const mk = ms => { const o = {}; for (const t of tabs) o[t] = NOW - ms; return o; };
  const due = (last, phase) => w.eval(`dueTabs(${NOW}, ${JSON.stringify(last)}, ${JSON.stringify(phase)})`);
  const dueEvHot = due(mk(HOT + 1000), "event");
  const dueOffHot = due(mk(HOT + 1000), "off");
  const dueEvCold = due(mk(COLD + 1000), "event");
  const dueEmpty = due({}, "off");
  check("FT1: dueTabs — event@hot-elapsed = hot set only (scores/info/announce in, champions/rooms out); off@hot-elapsed = none; @cold-elapsed and empty history = all (cadences derived from the page, never assumed)",
    ["scores", "info", "announce", "field"].every(t => dueEvHot.includes(t))
      && !dueEvHot.includes("champions") && !dueEvHot.includes("rooms")
      && dueOffHot.length === 0
      && dueEvCold.length === tabs.length && dueEmpty.length === tabs.length
      && COLD > HOT,
    "evHot=" + JSON.stringify(dueEvHot) + " offHot=" + JSON.stringify(dueOffHot));
  domFT1.window.close();
}

// FT2: the REAL load() honors the tiers — counted per-tab through the fetch
// layer: an immediate second load() fetches NOTHING; +61s in event phase
// fetches EXACTLY the hot set; +301s fetches everything. Reused (skipped)
// tabs keep painting their last rows (board still renders after a
// zero-fetch load — partial-load regression guard).
{
  const counts = {};
  const countingOverride = {};
  for (const t of Object.keys(FIXTURES)) {
    countingOverride[t] = () => { counts[t] = (counts[t] || 0) + 1;
      return Promise.resolve({ ok: true, status: 200, text: async () => FIXTURES[t] }); };
  }
  const domFT2 = makeDom("", withOverride(countingOverride));
  await until(() => (domFT2.window.document.querySelectorAll("#lbBody .lb-row").length) > 0);
  const w = domFT2.window;
  const snap = () => JSON.parse(JSON.stringify(counts));
  const delta = (a, b) => Object.keys(b).filter(t => (b[t] || 0) > (a[t] || 0));
  const HOT2 = w.eval("CONFIG.REFRESH_MS"), COLD2 = w.eval("COLD_MS");
  const s0 = snap();
  await w.load();                                            // immediate: nothing due
  const dNone = delta(s0, snap());
  const nowIso = new Date().toISOString().slice(0, 10) + "T09:00:00-06:00";
  w.eval(`Object.keys(LAST_GOT).forEach(t=>{LAST_GOT[t].reqAt-=${HOT2 + 1000}})`);
  w.eval(`INFO.first_tee=${JSON.stringify(nowIso)}`);        // ±3d window → event phase; paint() re-clobbers, so set right before EACH load
  const s1 = snap();
  await w.load();
  const dHot = delta(s1, snap());
  w.eval(`Object.keys(LAST_GOT).forEach(t=>{LAST_GOT[t].reqAt-=${COLD2 + 1000}})`);
  const s2 = snap();
  await w.load();
  const dAll = delta(s2, snap());
  const boardRows = w.document.querySelectorAll("#lbBody .lb-row").length;
  check("FT2: load() tiering measured at the fetch layer — 0 fetches immediately; hot-only at +61s (event); all at +301s; board still rendered after the zero-fetch load",
    dNone.length === 0
      && dHot.includes("scores") && dHot.includes("info") && !dHot.includes("champions") && !dHot.includes("rooms")
      && dAll.length === Object.keys(FIXTURES).length
      && boardRows > 0,
    "none=" + JSON.stringify(dNone) + " hot=" + JSON.stringify(dHot) + " all=" + dAll.length + " rows=" + boardRows);
  domFT2.window.close();
}

// FT3: jitter + seam survival — structural: the fixed setInterval(refreshTick)
// is gone, replaced by a self-rescheduling bounded-jitter timer; refreshTick
// still exists and still gates through pageVisible(); the wake listener stays.
{
  const idxFT3 = readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("FT3: no fixed setInterval(refreshTick); scheduleRefresh jitters via Math.random with a floor; pageVisible seam + visibilitychange wake path intact",
    !/setInterval\(refreshTick/.test(idxFT3)
      && /function scheduleRefresh/.test(idxFT3)
      && /scheduleRefresh[\s\S]{0,200}Math\.random/.test(idxFT3)
      && /Math\.max\(\s*15000/.test(idxFT3)
      && /function refreshTick\(\)\{ if\(pageVisible\(\)\) load\(\); \}/.test(idxFT3)
      && /visibilitychange/.test(idxFT3));
}

/* ---------------------------------------------------------------------
   GROUP AY — a11y + accepted follow-ups wave (BACKLOG #5, 2026-08-31).
   Sheet focus/keyboard, instant board-btn on confirm (+ season-pin),
   suppressed-board on-surface explainer. Hole-panel-head hardening was
   found ALREADY carried by the D3-era sgPanel checks — not duplicated.
   --------------------------------------------------------------------- */

// AY1: score-sheet focus contract — opening the pad moves focus INTO the
// dialog; Tab wraps within it; Escape closes via the SAME shared closeSheet
// the veil uses (keep-then-reopen — nothing destructive) and focus RETURNS
// to the invoking hole's cell in the rebuilt card. The keydown wiring binds
// to the shared `pad` const (#scConSheet||#scSheet), so the conflict sheet
// rides the same path (source-asserted; behavioral proof on #scSheet).
{
  const domAY1 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());  // scorer is armed-gated: no endpoint = no card
  const w = domAY1.window;
  const d = await openScorer(domAY1);
  d.querySelector('.sc-cell[data-hole="3"]').click();
  await until(() => { const sh = d.querySelector("#scSheet"); return !!sh && !sh.hidden; });
  const sheet = d.querySelector("#scSheet");
  const focusIn = !!d.activeElement && sheet.contains(d.activeElement);
  // Review F1: the trap must wrap over VISIBLE buttons — the closed Other
  // overflow row (.sc-numrow, display:none) always sits LAST in the DOM and
  // jsdom is display-blind, so this list is built INDEPENDENTLY of the
  // handler's own selector (validating a trap against its own list was how
  // the escape shipped). Fresh pad = numrow closed = these differ.
  const btns = [...sheet.querySelectorAll("button:not([disabled])")]
    .filter(b => !b.closest(".sc-numrow"));
  const hadHiddenTail = sheet.querySelectorAll(".sc-numrow button").length > 0;
  btns[btns.length - 1].focus();
  sheet.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  const wrapped = d.activeElement === btns[0];
  btns[0].focus();
  sheet.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  const wrappedBack = d.activeElement === btns[btns.length - 1];
  // container itself counts as before-first: Shift+Tab from the freshly
  // focused pad must wrap to the last VISIBLE button, never escape.
  sheet.focus();
  sheet.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  const containerBack = d.activeElement === btns[btns.length - 1];
  d.querySelector("#scSheet").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await until(() => { const sh = d.querySelector("#scSheet"); return !sh || sh.hidden; });
  const returned = d.activeElement === d.querySelector('.sc-cell[data-hole="3"]');
  const idxAY = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sharedWiring = /pad\.addEventListener\("keydown"/.test(idxAY);
  const visibleFilter = /closest\("\.sc-numrow"\)/.test(idxAY);   // F1: the handler filters the hidden overflow row
  check("AY1: pad focus contract — focus enters the open sheet; Tab and Shift+Tab wrap over VISIBLE buttons (hidden Other-row tail excluded, container counts as before-first); Escape closes (shared closeSheet) and focus returns to the invoking cell; keydown bound to the shared pad const (conflict sheet same path)",
    focusIn && wrapped && wrappedBack && containerBack && hadHiddenTail && visibleFilter && returned && sharedWiring,
    "focusIn=" + focusIn + " wrapped=" + wrapped + " wrappedBack=" + wrappedBack + " containerBack=" + containerBack +
      " returned=" + returned + " shared=" + sharedWiring +
      " active=" + (d.activeElement && (d.activeElement.id || d.activeElement.className)));
  domAY1.window.close();
}

// AY3: identity confirm renders the board button IMMEDIATELY (no <=60s
// renderAll wait — the accepted rev-3 residual, now closed), and the button
// stays scorerSeason-pinned when the archive year picker moves.
{
  const domAY3 = makeDom("#score?team=" + encodeURIComponent("Duck"), withScEndpoint());
  const w = domAY3.window, d = w.document;
  await until(() => !!d.querySelector("#scConfirmBtn"));
  d.querySelector("#scConfirmBtn").click();
  const instant = !!d.querySelector("#boardScoreBtn");   // synchronous — no until() before this read
  w.eval("STATE.year='2025'; renderAll();");
  const afterPoke = d.querySelector("#boardScoreBtn");
  check("AY3: #boardScoreBtn exists synchronously after Confirm (no renderAll wait) and survives a year-picker poke still naming Team Duck (scorerSeason pin)",
    instant && !!afterPoke && /Duck/.test(afterPoke.textContent || ""),
    "instant=" + instant + " afterPoke=" + JSON.stringify(afterPoke && afterPoke.textContent));
  domAY3.window.close();
}

// AY4: suppressed-board on-surface explainer (§21 follow-up) — with a
// null courseMap (blank par) the Board itself SAYS why Pos is dashes;
// the normal fixture never shows it. Rendered conditionally in JS (no
// [hidden]-vs-cascade exposure — the .btn[hidden] lesson).
{
  const courseBad = ["hole,par,yards"]
    .concat(Array.from({ length: 18 }, (_, i) => (i + 1) + "," + (i === 6 ? "" : 4) + ",400"))
    .join("\n");
  const badFetch = withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBad }),
  });
  const domBad = makeDom("", badFetch);
  await until(() => (domBad.window.document.querySelectorAll("#lbBody .lb-row").length) > 0);
  const badText = (domBad.window.document.querySelector('[data-view="board"]') || {}).textContent || "";
  domBad.window.close();
  const domOk = makeDom("");
  await until(() => (domOk.window.document.querySelectorAll("#lbBody .lb-row").length) > 0);
  const okText = (domOk.window.document.querySelector('[data-view="board"]') || {}).textContent || "";
  domOk.window.close();
  // Review F3: an EMPTY suppressed board has no "order shown" to describe —
  // the note must not contradict the empty state above it.
  const emptyBadFetch = withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBad }),
    scores: () => Promise.resolve({ ok: true, status: 200, text: async () => "year,team,player\n" }),
  });
  const domEmpty = makeDom("", emptyBadFetch);
  await until(() => /No cards posted yet/.test(domEmpty.window.document.querySelector("#lbBody")?.textContent || ""));
  const emptyText = (domEmpty.window.document.querySelector('[data-view="board"]') || {}).textContent || "";
  domEmpty.window.close();
  check("AY4: suppressed board carries its own explainer (/need all 18 pars/ + raw gross) on-surface; absent on a complete course; absent again on an EMPTY suppressed board (no order to describe)",
    /need all 18 pars/.test(badText) && /raw gross/.test(badText)
      && !/need all 18 pars/.test(okText)
      && !/need all 18 pars/.test(emptyText) && /No cards posted yet/.test(emptyText),
    "bad=" + badText.slice(0, 200) + " empty=" + emptyText.slice(0, 120));
}

/* =====================================================================
   §26 K-TV: lodge television route (task 1). Render-reuse core: lbRowHTML
   (mv:null, interactive:false — the same ctx idiom S25a-T5 already proves
   for renderHomeBoard) for the Leaderboard panel, renderScoreGrid's own
   builder (parameter-with-default target ids — SG_IDS/TV_SG_IDS, zero
   copied row/table logic) for the Card panel. Placed inside the §25a
   broadcast-core block (no new section header) per the ledger: this task
   builds directly on §25a/§25b's render-reuse core rather than starting a
   fresh section.
   ===================================================================== */

{ // S26-T1a: route + chrome — #tv renders the tv section, hides nav/
  // #mastBar/the diagnostic strips, hides the cursor. CSS source assert
  // (the hiding rule + the cursor:none rule, both exact) + a real
  // showView("tv") DOM assert (fresh dom — the shared `dom` never visits
  // #tv elsewhere, but a fresh one keeps this check independent of suite
  // order like T3's own mastBar check does). Fix round 1, m2: #announceBar
  // joins the hidden set (undismissable on a kiosk — no cursor to dismiss
  // it with, and it must never survive on-screen forever). Task 4
  // render-close finding: the page's own site-wide <footer> joins it too —
  // it never overlaps the visible TV frame (next sibling after #tvMode in
  // normal flow, invisible on a real fixed-resolution kiosk), but it was
  // inflating document scrollHeight and would leak into view on any
  // hardware/software combination that allows a scroll/resize past the
  // physical frame — a real gap against this rule's own "hides entirely"
  // claim.
  const idxT1a = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const hidesChrome = /body\[data-view="tv"\]\s*\.nav,\s*body\[data-view="tv"\]\s*#mastBar,\s*body\[data-view="tv"\]\s*#announceBar,\s*body\[data-view="tv"\]\s*#healthStrip,\s*body\[data-view="tv"\]\s*#debugPanel,\s*body\[data-view="tv"\]\s*footer\{[^}]*display:\s*none\s*!important\}/.test(idxT1a);
  const hidesCursor = /body\[data-view="tv"\]\{[^}]*cursor:\s*none\}/.test(idxT1a);

  const domT1a = makeDom("");
  const wT1a = domT1a.window;
  await until(() => wT1a.document.querySelectorAll("#lbBody .lb-row").length > 0);
  wT1a.location.hash = "#tv";
  wT1a.dispatchEvent(new wT1a.Event("hashchange"));
  const dT1a = wT1a.document;
  const tvSection = dT1a.querySelector('[data-view="tv"]');
  const boardSection = dT1a.querySelector('[data-view="board"]');
  const routeOk = dT1a.body.dataset.view === "tv"
    && !!tvSection && tvSection.hidden === false
    && !!boardSection && boardSection.hidden === true
    && !!dT1a.getElementById("tvClock");
  domT1a.window.close();

  check("S26-T1a: #tv route renders #tvMode and hides every other .view (showView DOM assert); CSS hides .nav/#mastBar/#announceBar/#healthStrip/#debugPanel/footer under body[data-view=\"tv\"] (fix round 1, m2 adds #announceBar — undismissable on a kiosk; Task 4 render-close adds the page's own <footer> — never overlaps the frame, but was leaking into scrollHeight) AND sets cursor:none on it (source assert, exact selectors)",
    hidesChrome && hidesCursor && routeOk,
    "hidesChrome=" + hidesChrome + " hidesCursor=" + hidesCursor + " routeOk=" + routeOk);
}

{ // S26-T1b: rotation state machine — tvNextPanel(current) is a pure
  // 0->1->2->0 cycle (called directly, no interval/timer involved), and
  // STATE.tvPanel + renderTv() (driven directly, same "drive it directly"
  // idiom as S25b-T2e/T2f's hand-primed STATE) toggles exactly one
  // .tv-panel visible per state.
  const domT1b = makeDom("");
  const wT1b = domT1b.window;
  await until(() => wT1b.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const cycleOk = wT1b.tvNextPanel(0) === 1 && wT1b.tvNextPanel(1) === 2 && wT1b.tvNextPanel(2) === 0
    && wT1b.tvNextPanel(1) !== 0;   // guards against a mutant that always returns (current+1) unmodded
  const visibleFor = (n) => {
    wT1b.eval("STATE.tvPanel=" + n + "; renderTv();");
    const panels = [...wT1b.document.querySelectorAll(".tv-panel")];
    const visible = panels.filter((p) => !p.hidden).map((p) => p.dataset.tvPanel);
    return visible.length === 1 && visible[0] === String(n);
  };
  const swapOk = visibleFor(0) && visibleFor(1) && visibleFor(2) && visibleFor(1);
  domT1b.window.close();

  check("S26-T1b: tvNextPanel(current) is a pure 0→1→2→0 cycle; STATE.tvPanel + renderTv() driven directly toggles exactly ONE .tv-panel[data-tv-panel] visible, matching STATE.tvPanel, at every state (0, 1, 2, and back to 1)",
    cycleOk && swapOk,
    "cycle=" + cycleOk + " swap=" + swapOk);
}

{ // S26-T1c: honesty stamp — fresh "Checked h:mm", stale (>5min) "Checked
  // h:mm — data stale", and "no data + no cache" (a failed scores fetch on
  // a brand-new dom, no localStorage cache) falls back to the panel's OWN
  // existing empty copy (zero new user-facing strings) with an honestly
  // blank clock (no fabricated "Checked" claim for an instant that never
  // happened). seasonPhase-gated (S24 eventStampFor's own pattern) — the
  // shared suite fixture (first_tee 2026-08-15) is off-phase against the
  // real clock, so this needs its own dynInfo(0)-forced event-phase dom,
  // T3d-style, same reason S25a-T3d/e/f needed it.
  const eventInfoT1c = dynInfo(0);
  const domT1c = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => eventInfoT1c }),
  }));
  const wT1c = domT1c.window;
  await until(() => wT1c.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const now = Date.now();

  wT1c.eval("STATE.tvLastFetchAt=" + now + "; renderTv();");
  const freshText = wT1c.document.getElementById("tvClock").textContent;
  const freshOk = freshText === "Checked " + wT1c.fmtClock(now);

  const staleAt = now - 6 * 60 * 1000;
  wT1c.eval("STATE.tvLastFetchAt=" + staleAt + "; renderTv();");
  const staleText = wT1c.document.getElementById("tvClock").textContent;
  const staleOk = staleText === "Checked " + wT1c.fmtClock(staleAt) + " — data stale";

  wT1c.eval("STATE.tvLastFetchAt=null; renderTv();");
  const nullClockText = wT1c.document.getElementById("tvClock").textContent;
  domT1c.window.close();

  const domT1c2 = makeDom("", withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => eventInfoT1c }),
    scores: () => Promise.resolve({ ok: false, status: 404, text: async () => "missing" }),
  }));
  const wT1c2 = domT1c2.window;
  // try/catch: STATE is a `let` binding (TDZ) for the brief window before
  // the main script reaches its own initializer — a poll landing inside
  // that window must read as "not ready yet", never throw the whole run.
  await until(() => {
    try { return wT1c2.eval("!!(STATE.data && STATE.data.scores === null)"); }
    catch (e) { return false; }
  });
  const lbEmptyText = wT1c2.document.getElementById("tvLbBody").textContent;
  const lbEmptyOk = /No cards posted yet\. Scores appear here as the sheet fills in\./.test(lbEmptyText);
  const noCacheClockText = wT1c2.document.getElementById("tvClock").textContent;
  domT1c2.window.close();

  check("S26-T1c: honesty stamp — fresh tvLastFetchAt ⇒ 'Checked h:mm' verbatim; >5min old ⇒ 'Checked h:mm — data stale' verbatim (seasonPhase forced to 'event' via dynInfo(0), T3d-style, since the shared fixture is off-phase against the real clock); no fetch instant at all ⇒ blank clock, never a fabricated claim; a failed scores fetch with no cache (fresh dom, no localStorage) ⇒ the Leaderboard panel falls back to the SAME 'No cards posted yet' string the Board's own empty state uses, clock stays blank",
    freshOk && staleOk && nullClockText === "" && lbEmptyOk && noCacheClockText === "",
    "fresh=" + JSON.stringify(freshText) + " stale=" + JSON.stringify(staleText)
      + " nullClock=" + JSON.stringify(nullClockText) + " lbEmptyOk=" + lbEmptyOk
      + " noCacheClock=" + JSON.stringify(noCacheClockText));
}

{ // S26-T1d: labeled-dot indicator — three dots, aria-labeled exactly
  // "Leaderboard"/"The Card"/"Schedule" (canvas-normative), and driving
  // STATE.tvPanel + renderTv() directly marks exactly one .on per state.
  // Fix round 1, I3: each dot also carries a VISIBLE caption (13px caps
  // .24em) — the canvas's bottom strip shows sighted labels, not just an
  // accessible name on the dot itself.
  const domT1d = makeDom("");
  const wT1d = domT1d.window;
  await until(() => wT1d.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const dots = () => [...wT1d.document.querySelectorAll(".tv-dot")];
  const captions = () => [...wT1d.document.querySelectorAll(".tv-dot-label")];
  const d0 = dots();
  const labelsOk = d0.length === 3
    && d0[0].getAttribute("aria-label") === "Leaderboard"
    && d0[1].getAttribute("aria-label") === "The Card"
    && d0[2].getAttribute("aria-label") === "Schedule";
  const c0 = captions();
  const captionsOk = c0.length === 3
    && c0[0].textContent === "Leaderboard" && c0[1].textContent === "The Card" && c0[2].textContent === "Schedule";
  const onFor = (n) => {
    wT1d.eval("STATE.tvPanel=" + n + "; renderTv();");
    const on = dots().filter((d) => d.classList.contains("on")).map((d) => d.dataset.dot);
    return on.length === 1 && on[0] === String(n);
  };
  const dotsOk = onFor(0) && onFor(2) && onFor(1);
  domT1d.window.close();

  check("S26-T1d: three .tv-dot indicators, aria-labeled 'Leaderboard'/'The Card'/'Schedule' verbatim (canvas-normative panel labels); each carries a VISIBLE .tv-dot-label caption with the identical text (I3 — the canvas's bottom-strip captions, not just an accessible name); exactly one .tv-dot carries .on, matching STATE.tvPanel, at every state",
    labelsOk && captionsOk && dotsOk,
    "labels=" + labelsOk + " captions=" + captionsOk + " dots=" + dotsOk);
}

{ // S26-T1e: reduced-motion — the panel-swap CSS (the whole S26 K-TV
  // <style> block: chrome hiding, .tv-panel, .tv-dot, .tv-scale) carries NO
  // transition/animation property anywhere — a hard cut for everyone, not a
  // prefers-reduced-motion-guarded carve-out (the simplest compliant form
  // the ledger calls for). Property-declaration regex (`transition\s*:`),
  // not a bare word match, so the block's own prose comment explaining the
  // no-animation rule (which says the words "transition"/"animation" without
  // a trailing colon) can't produce a false pass. Fix round 1, m4: the scan
  // is bounded on BOTH ends by explicit markers (the block's own opening
  // comment AND its own closing "/S26 K-TV CSS" comment), not an open-ended
  // slice to the next </style> — a later CSS addition landing between this
  // block and </style> can no longer silently widen what the scan covers.
  const idxT1e = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const styleStart = idxT1e.indexOf('S26 K-TV: lodge television route ----------');
  const styleEnd = idxT1e.indexOf("/S26 K-TV CSS", styleStart);
  const tvCssBlock = styleStart >= 0 && styleEnd > styleStart ? idxT1e.slice(styleStart, styleEnd) : "";
  const blockFound = tvCssBlock.length > 0 && /\.tv-panel\{/.test(tvCssBlock) && /\.tv-dot\{/.test(tvCssBlock);
  const noTransition = !/\btransition\s*:/i.test(tvCssBlock);
  const noAnimation = !/\banimation\s*:/i.test(tvCssBlock);

  check("S26-T1e: reduced-motion — the S26 K-TV CSS block (chrome hiding + .tv-panel/.tv-dot/.tv-scale) carries no `transition:`/`animation:` declaration anywhere — a hard cut for everyone on the panel swap, never a prefers-reduced-motion-guarded exception; the scan is block-bounded on BOTH ends (fix round 1, m4), not open-ended to </style>",
    blockFound && noTransition && noAnimation,
    "blockFound=" + blockFound + " noTransition=" + noTransition + " noAnimation=" + noAnimation);
}

{ // S26-T1f (beyond the brief's a-e list, added for the ledger's OWN stated
  // core constraint — render reuse — which a-e's chrome/cycle/stamp/dot/
  // motion checks never actually exercise): the Leaderboard and Card panels
  // carry REAL data through the reused builders, not just empty/chrome
  // plumbing, and tvTodayRows correctly buckets a schedule row by the
  // McCall day boundary (pure, hand-built fixture — independent of which
  // real weekday the suite happens to run on).
  const domT1f = makeDom("");
  const wT1f = domT1f.window;
  await until(() => wT1f.document.querySelectorAll("#lbBody .lb-row").length > 0);

  // Leaderboard reuse: TV's row count matches tvLeaderboardCut(fullBoard)
  // (fix round 1, I8 — TV cuts to top-5-plus-ties, the Board shows everyone,
  // so an exact-equality assumption would be wrong on a roster bigger than
  // 5; this fixture happens to have exactly 5 teams, so the cut formula
  // still resolves to "everyone" here — S26-T1j drives the cut formula
  // directly against synthetic larger/tied rosters), and the FIRST row's
  // name/pos text is byte-identical between the two surfaces — same
  // lbRowHTML call (mv:null, interactive:false), same rankedPlayers data.
  const boardRows = [...wT1f.document.querySelectorAll("#lbBody .lb-row")];
  const tvRows = [...wT1f.document.querySelectorAll("#tvLbBody .lb-row")];
  // sequential 1..N positions (no ties assumed) is the correct expectation
  // for THIS fixture (5 distinct-scoring teams); a tied fixture is covered
  // separately and precisely by S26-T1j's synthetic-roster drive.
  const expectedTvCount = wT1f.tvLeaderboardCut(boardRows.map((r, i) => ({ pos: i + 1 })));
  const rowCountOk = tvRows.length > 0 && tvRows.length === expectedTvCount;
  const firstNameOk = rowCountOk
    && tvRows[0].querySelector(".lb-name")?.textContent === boardRows[0].querySelector(".lb-name")?.textContent
    && tvRows[0].querySelector(".lb-pos")?.textContent === boardRows[0].querySelector(".lb-pos")?.textContent;

  // Card grid reuse: the SAME 18-hole head + the SAME team-row count as the
  // Board's own #sgTable, for the same round — renderScoreGrid(players,
  // TV_SG_IDS), never a copied table.
  const boardHoleTh = wT1f.document.querySelectorAll("#sgTable thead th.sg-h").length;
  const tvHoleTh = wT1f.document.querySelectorAll("#tvGridTable thead th.sg-h").length;
  const boardTeamRows = wT1f.document.querySelectorAll("#sgTable tbody tr.sg-teamrow").length;
  const tvTeamRows = wT1f.document.querySelectorAll("#tvGridTable tbody tr.sg-teamrow").length;
  const gridOk = boardHoleTh === 18 && tvHoleTh === 18 && boardTeamRows > 0 && tvTeamRows === boardTeamRows;
  // m3: the TV grid's own head cells carry no role/tabindex (no click
  // wiring exists for them, no cursor to use one with) — a post-process on
  // the TV render only; the Board's own #sgTable head cells are UNTOUCHED
  // (same shared builder, not a second one that never sets these at all).
  const tvThAttrs = [...wT1f.document.querySelectorAll("#tvGridTable thead th.sg-h")];
  const boardThAttrs = [...wT1f.document.querySelectorAll("#sgTable thead th.sg-h")];
  const m3Ok = tvThAttrs.length > 0 && tvThAttrs.every((th) => !th.hasAttribute("role") && !th.hasAttribute("tabindex"))
    && boardThAttrs.length > 0 && boardThAttrs.every((th) => th.getAttribute("role") === "button" && th.getAttribute("tabindex") === "0");
  domT1f.window.close();

  // tvTodayRows: pure. first_tee pinned via eval (real Saturday, 2026-08-15
  // — verified against the real calendar, not assumed) so the day buckets
  // are exact, never relative to whatever real weekday the suite runs on.
  const domT1f2 = makeDom("");
  const wT1f2 = domT1f2.window;
  await until(() => wT1f2.document.querySelectorAll("#lbBody .lb-row").length > 0);
  wT1f2.eval('INFO.first_tee="2026-08-15T09:00:00-06:00";');
  const rowsT1f2 = [
    { day: "Day One", label: "Friday", time: "3:00 pm", event: "Check in", location: "Bear Creek Lodge" },
    { day: "Day Two", label: "Saturday", time: "9:00 am", event: "Round One", location: "Meadow Creek" },
    { day: "Day Three", label: "Sunday", time: "2:00 pm", event: "Presentation", location: "18th green" },
  ];
  const satAt = new Date("2026-08-15T12:00:00-06:00").getTime();   // Saturday noon, first_tee's own day
  const fridayAt = new Date("2026-08-14T12:00:00-06:00").getTime(); // Friday noon, the adjacent day
  const todayPure = wT1f2.tvTodayRows(rowsT1f2, satAt);
  const todayPureOk = todayPure.length === 1 && todayPure[0].event === "Round One";
  const fridayPure = wT1f2.tvTodayRows(rowsT1f2, fridayAt);
  const fridayPureOk = fridayPure.length === 1 && fridayPure[0].event === "Check in";
  domT1f2.window.close();

  check("S26-T1f: render-reuse content (the ledger's core constraint) — TV Leaderboard panel shows the cut row count + first-row name/pos text matching the Board (same lbRowHTML call, real rankedPlayers data, not an empty render); TV Card panel's grid carries the same 18-hole head + same team-row count as the Board's own #sgTable (renderScoreGrid reuse via TV_SG_IDS); fix round 1, m3: the TV grid's OWN head cells carry no role/tabindex (no click wiring, no cursor) while the Board's own #sgTable head cells keep theirs — a post-process on the TV render, not a second builder; tvTodayRows(rows,now) (pure) buckets a hand-built Friday/Saturday/Sunday fixture correctly by the McCall day boundary — Saturday noon returns ONLY the Saturday row, Friday noon returns ONLY the Friday row",
    rowCountOk && firstNameOk && gridOk && m3Ok && todayPureOk && fridayPureOk,
    "rowCount=" + rowCountOk + " firstName=" + firstNameOk + " grid=" + gridOk + " m3=" + m3Ok
      + " todayPure=" + todayPureOk + " fridayPure=" + fridayPureOk);
}

/* =====================================================================
   §26 K-TV fix round 1 — spec review findings (CRITICAL 1/2, ruled I1-I8,
   m2-m5). Placed immediately after the task-1 checks, same block.
   ===================================================================== */

{ // S26-T1g (fix round 1, CRITICAL 1 — honesty): par-suppressed TV — a
  // suppressed course (courseMap()===null, same AY4 fixture idiom) must
  // flip the TV header to "Total", carry .lb-suppressed on .tv-scale, show
  // the SAME explainer text the Board shows, and hold the IDENTICAL
  // plain-digit gross total the Board's own suppressed row holds — never
  // "To par 104" with no explanation.
  const courseBadT1g = ["hole,par,yards"]
    .concat(Array.from({ length: 18 }, (_, i) => (i + 1) + "," + (i === 6 ? "" : 4) + ",400"))
    .join("\n");
  const domT1g = makeDom("", withOverride({
    course: () => Promise.resolve({ ok: true, status: 200, text: async () => courseBadT1g }),
  }));
  const dT1g = domT1g.window.document;
  await until(() => dT1g.querySelectorAll("#tvLbBody .lb-row").length > 0);
  const toParHeadText = dT1g.getElementById("tvToParHead")?.textContent;
  const suppNoteEl = dT1g.getElementById("tvSuppNote");
  const suppNoteVisible = !!suppNoteEl && suppNoteEl.hidden === false;
  const suppNoteText = suppNoteEl?.textContent || "";
  const scaleClassOk = !!dT1g.querySelector(".tv-scale.lb-suppressed");
  const tvFirstToPar = dT1g.querySelector("#tvLbBody .lb-row .lb-tot:last-child")?.textContent;
  const boardFirstToPar = dT1g.querySelector("#lbBody .lb-row .lb-tot:last-child")?.textContent;
  domT1g.window.close();

  check("S26-T1g (CRITICAL 1 fix): par-suppressed TV honesty — the TV header (#tvToParHead) flips to 'Total' verbatim (never 'To par' over a raw gross total), .tv-scale carries .lb-suppressed, the SAME explainer text the Board shows ('Standings need all 18 pars on the Course tab — order shown is raw gross, no rank claims.') renders un-hidden, and the remaining to-par cell holds the IDENTICAL plain-digit gross total the Board's own suppressed row holds",
    toParHeadText === "Total" && scaleClassOk && suppNoteVisible
      && /Standings need all 18 pars on the Course tab — order shown is raw gross, no rank claims\./.test(suppNoteText)
      && tvFirstToPar !== undefined && tvFirstToPar === boardFirstToPar,
    "toParHead=" + JSON.stringify(toParHeadText) + " scaleClass=" + scaleClassOk + " suppNoteVisible=" + suppNoteVisible
      + " tvFirstToPar=" + JSON.stringify(tvFirstToPar) + " boardFirstToPar=" + JSON.stringify(boardFirstToPar));
}

{ // S26-T1h (fix round 1, CRITICAL 2 + m5-ii): state coupling — the
  // reviewer's 6-step repro. Board opens a hole panel -> switch to #tv ->
  // one rotation tick (tvAdvance(), the exact function the 20s interval
  // calls; ids=TV_SG_IDS) -> switch back to #board -> a natural repaint
  // (renderLeaderboard(), the exact call paint()/renderAll() makes; ids=
  // SG_IDS default) must still close the Board's own, genuinely-still-open
  // panel — STATE.gridHole is the Board's OWN G-PANEL flag, and only the
  // Board's own render call (ids===SG_IDS) may clear it.
  const domT1h = makeDom("");
  const wT1h = domT1h.window, dT1h = wT1h.document;
  await until(() => dT1h.querySelectorAll("#lbBody .lb-row").length > 0);
  await until(() => dT1h.querySelectorAll("#sgTable th.sg-h").length > 0);
  const holeCell = dT1h.querySelector('#sgTable th.sg-h[data-hole="1"]');
  holeCell.click();
  const openedOk = dT1h.getElementById("sgPanel")?.hidden === false && wT1h.eval("STATE.gridHole") === 1;
  wT1h.location.hash = "#tv";
  wT1h.dispatchEvent(new wT1h.Event("hashchange"));
  wT1h.tvAdvance();
  wT1h.location.hash = "#board";
  wT1h.dispatchEvent(new wT1h.Event("hashchange"));
  wT1h.renderLeaderboard();
  const closedOk = dT1h.getElementById("sgPanel")?.hidden === true
    && (dT1h.getElementById("sgPanel")?.innerHTML || "") === "";
  domT1h.window.close();

  check("S26-T1h (CRITICAL 2 + m5-ii fix): the reviewer's 6-step repro (Board opens a hole panel -> #tv -> one rotation tick -> back to #board -> a natural repaint) leaves the Board's #sgPanel CLOSED (hidden, emptied) afterward — the TV rotation never touches STATE.gridHole (renderScoreGrid's ids===SG_IDS gate), so the Board's own next render still finds it set and closes its own panel correctly",
    openedOk && closedOk,
    "opened=" + openedOk + " closed=" + closedOk);
}

{ // S26-T1i (fix round 1, I6 + I8 mechanism): the Leaderboard shows only 4
  // columns (Pos/Team/Thru/ToPar) via CSS — mv/R1/R2/Total drop
  // unconditionally, suppressed or not, at equal specificity either way —
  // and the scaling mechanism is REAL font-size growth on those columns,
  // never a CSS transform (which paints bigger without reserving layout
  // height — the reviewer's overlap concern).
  const idxT1i = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const styleStartT1i = idxT1i.indexOf('S26 K-TV: lodge television route ----------');
  const styleEndT1i = idxT1i.indexOf("/S26 K-TV CSS", styleStartT1i);
  const tvCssBlockT1i = styleStartT1i >= 0 && styleEndT1i > styleStartT1i ? idxT1i.slice(styleStartT1i, styleEndT1i) : "";
  const columnsHiddenOk = /\.tv-scale \.lb-mv,\.tv-scale \.lb-r1,\.tv-scale \.lb-r2,\.tv-scale \.lb-total\{display:none\}/.test(tvCssBlockT1i);
  const gridRuleMatch = tvCssBlockT1i.match(/\.tv-scale \.lb-head,\.tv-scale \.lb-row,[\s\S]*?\{[^}]*grid-template-columns:([^;}]+)[;}]/);
  const trackCount = gridRuleMatch ? gridRuleMatch[1].trim().split(/\s+/).length : 0;
  const fourTrackOk = trackCount === 4;
  const suppressedArmOk = /\.tv-scale\.lb-suppressed \.lb-head,\.tv-scale\.lb-suppressed \.lb-row/.test(tvCssBlockT1i);
  const noTransformOk = !/\.tv-scale[^{]*\{[^}]*transform\s*:/.test(tvCssBlockT1i.replace(/\n/g, " "));

  check("S26-T1i (I6 + I8 mechanism): TV leaderboard hides mv/R1/R2/Total unconditionally via CSS (.tv-scale .lb-mv,.lb-r1,.lb-r2,.lb-total{display:none}), leaving the canvas's 4 columns (Pos/Team/Thru/ToPar) with an explicit 4-track grid-template-columns; a .tv-scale.lb-suppressed arm exists at equal specificity so neither suppression state can regress the other's column count; the scaling mechanism carries no `transform:` anywhere inside .tv-scale (real font-size growth instead — it reserves real layout height, a transform would not)",
    columnsHiddenOk && fourTrackOk && suppressedArmOk && noTransformOk,
    "columnsHidden=" + columnsHiddenOk + " trackCount=" + trackCount + " suppressedArm=" + suppressedArmOk + " noTransform=" + noTransformOk);
}

{ // S26-T1j (fix round 1, I8 cut + m5-iii teeth): tvLeaderboardCut mirrors
  // renderHomeBoard's exact 5-plus-ties formula — pure, driven directly
  // with synthetic {pos} arrays (the formula only reads .pos). A 12-team,
  // no-tie roster cuts to exactly 5 (the overflow guard holds regardless of
  // roster size); a 3-way tie AT the 5th spot keeps ALL tied rows (a
  // slice(0,5)-hard mutant, which would silently drop the 6th/7th tied
  // row, must die on this fixture).
  const domT1j = makeDom("");
  const wT1j = domT1j.window;
  await until(() => wT1j.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const twelveNoTie = Array.from({ length: 12 }, (_, i) => ({ pos: i + 1 }));
  const cutTwelve = wT1j.tvLeaderboardCut(twelveNoTie);
  const tieRoster = [1, 2, 3, 4, 5, 5, 5, 8, 9, 10, 11, 12].map((pos) => ({ pos }));
  const cutTie = wT1j.tvLeaderboardCut(tieRoster);
  const cutFiveOrFewer = wT1j.tvLeaderboardCut([{ pos: 1 }, { pos: 2 }]);
  domT1j.window.close();

  check("S26-T1j (I8 cut + m5-iii): tvLeaderboardCut([...12 no-tie]) === 5 (a long roster is always cut — the overflow guard, independent of the scaling mechanism); tvLeaderboardCut([...3-way tie AT 5th]) === 7 (every tied row survives — a slice(0,5)-hard mutant that silently drops tied rows must fail this); tvLeaderboardCut([2 players]) === 2 (players.length<=5 keeps everyone, mirroring renderHomeBoard's own <=5 branch)",
    cutTwelve === 5 && cutTie === 7 && cutFiveOrFewer === 2,
    "twelve=" + cutTwelve + " tie=" + cutTie + " fiveOrFewer=" + cutFiveOrFewer);
}

{ // S26-T1k (fix round 1, I7): the TV Card panel always shows the LATEST
  // round, with a visible "Round N" label, and never reads STATE.gridRound
  // — toggling the Board's own round control must NEVER change what TV
  // shows (the default fixture has Round 1 AND Round 2 posted for several
  // teams, so the Board's toggle genuinely has more than one button here).
  // Critical to actually exercising the vulnerable line: the Board's own
  // toggle click only re-renders the BOARD's own grid (renderScoreGrid's
  // click handler is scoped to #sgRounds) — it does NOT touch #tvGridTable
  // by itself, so a bug that let TV's round selection read the now-changed
  // STATE.gridRound would stay silently uncaught until TV's OWN next
  // render. This test forces that next render explicitly (renderTv(), the
  // same call the 20s rotation and every data refresh already make) so the
  // shared-state mutant actually has a chance to show up.
  const domT1k = makeDom("");
  const wT1k = domT1k.window, dT1k = wT1k.document;
  await until(() => dT1k.querySelectorAll("#tvGridTable thead th.sg-h").length > 0);
  const roundBtns = [...(dT1k.getElementById("sgRounds")?.querySelectorAll(".year-btn") || [])];
  // the LAST toggle button in DOM order is the latest round (Board renders
  // them from its own sorted `rounds` list) — the ground truth this whole
  // check is proving TV matches, independent of STATE.gridRound.
  const latestRound = roundBtns.length ? roundBtns[roundBtns.length - 1].dataset.rd : undefined;
  const tvRoundBefore = dT1k.getElementById("tvGridTable")?.dataset.round;
  const labelBefore = dT1k.getElementById("tvRoundLabel")?.textContent;
  // On the very FIRST render, STATE.gridRound is still null — a bug that
  // fell back to the Board's OWN default (rounds[0], the EARLIEST round)
  // for TV too would show up right here, before any toggle click is even
  // involved.
  const showsLatestOk = roundBtns.length > 1 ? tvRoundBefore === latestRound : true;
  let boardToggleOk = true, tvRoundAfter = tvRoundBefore, labelAfter = labelBefore;
  if (roundBtns.length > 1) {
    roundBtns[0].click();   // flip the Board to its EARLIEST round
    wT1k.renderTv();        // force the next TV render the shared state could leak into
    tvRoundAfter = dT1k.getElementById("tvGridTable")?.dataset.round;
    labelAfter = dT1k.getElementById("tvRoundLabel")?.textContent;
    boardToggleOk = tvRoundAfter === tvRoundBefore && labelAfter === labelBefore;
  }
  const labelMatchesRoundOk = !!tvRoundAfter && labelAfter === "Round " + tvRoundAfter;
  domT1k.window.close();

  check("S26-T1k (I7): on the very first render (STATE.gridRound still null) the TV Card panel already shows the LATEST posted round, not the Board's own rounds[0] default (roundsAvailable=" + roundBtns.length + " here, latest=" + JSON.stringify(latestRound) + "); the round label reads 'Round N' matching #tvGridTable's own rendered round; toggling the Board's round control THEN forcing a TV re-render never changes the TV grid's round or its label — renderScoreGrid never reads STATE.gridRound for the TV_SG_IDS target",
    showsLatestOk && labelMatchesRoundOk && boardToggleOk,
    "latest=" + JSON.stringify(latestRound) + " before=" + JSON.stringify(tvRoundBefore) + " after=" + JSON.stringify(tvRoundAfter)
      + " labelBefore=" + JSON.stringify(labelBefore) + " labelAfter=" + JSON.stringify(labelAfter)
      + " showsLatestOk=" + showsLatestOk + " boardToggleOk=" + boardToggleOk);
}

{ // S26-T1l (fix round 1, I1): schedule empty-state honesty. Date.now is
  // pinned via eval — never relying on the real wall clock happening to sit
  // outside the default fixture's own Aug-15-2026 week, which would be
  // exactly the real-calendar time-bomb class this suite's own conventions
  // forbid — so "today" deterministically misses every schedule row while
  // the season still genuinely HAS schedule data.
  const domT1l = makeDom("");
  const wT1l = domT1l.window;
  await until(() => wT1l.document.querySelectorAll("#lbBody .lb-row").length > 0);
  wT1l.eval('Date.now=()=>new Date("2026-08-20T12:00:00-06:00").getTime(); renderTv();');
  const todayEmptyText = wT1l.document.getElementById("tvSchedBody").textContent;
  domT1l.window.close();

  const noScheduleFetch = withOverride({
    schedule: () => Promise.resolve({ ok: true, status: 200, text: async () => "year,day,label,time,event,location\n" }),
  });
  const domT1l2 = makeDom("", noScheduleFetch);
  const wT1l2 = domT1l2.window;
  await until(() => wT1l2.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const notLoadedText = wT1l2.document.getElementById("tvSchedBody").textContent;
  domT1l2.window.close();

  check("S26-T1l (I1): TV Schedule panel — season HAS schedule data but Date.now (pinned, never the real clock) falls outside every row's day bucket shows 'No events scheduled today.' verbatim (the ruled new line, never the old false 'not loaded' claim); a season with genuinely NO schedule rows at all keeps the ORIGINAL 'Schedule not loaded yet — it lives in the sheet's Schedule tab.' line unchanged",
    /No events scheduled today\./.test(todayEmptyText) && !/not loaded yet/i.test(todayEmptyText)
      && /Schedule not loaded yet — it lives in the sheet's Schedule tab\./.test(notLoadedText),
    "todayEmpty=" + JSON.stringify(todayEmptyText.trim()) + " notLoaded=" + JSON.stringify(notLoadedText.trim()));
}

{ // S26-T1m (fix round 1, I2 de-fork): (a) the schedule row template —
  // renderSchedule() and the TV Schedule panel both call the SAME
  // scheduleSlotHTML helper, never independently-drift-able copies; (b) the
  // Card panel's legend is a LIVE clone of the Board's own #sgLegend, not a
  // second hand-maintained copy — mutating the Board's legend content and
  // re-rendering TV must pick up the SAME new content.
  const domT1m = makeDom("");
  const wT1m = domT1m.window, dT1m = wT1m.document;
  await until(() => dT1m.querySelectorAll("#lbBody .lb-row").length > 0);

  const slotSample = wT1m.scheduleSlotHTML({ time: "9:00 am", event: "Sample Event", location: "Sample Place" });
  const slotHelperOk = /class="slot"/.test(slotSample) && /class="slot-time"/.test(slotSample)
    && /class="slot-what"/.test(slotSample) && /class="slot-where"/.test(slotSample)
    && /Sample Event/.test(slotSample) && /Sample Place/.test(slotSample);

  const legendMatchesOk = dT1m.getElementById("tvGridLegend")?.innerHTML === dT1m.getElementById("sgLegend")?.innerHTML
    && (dT1m.getElementById("sgLegend")?.innerHTML || "").length > 0;
  wT1m.eval('document.getElementById("sgLegend").innerHTML="<span class=\\"lg\\">MUTATED-LEGEND-MARKER</span>"; renderTv();');
  const legendClonedLiveOk = /MUTATED-LEGEND-MARKER/.test(dT1m.getElementById("tvGridLegend")?.innerHTML || "");
  domT1m.window.close();

  check("S26-T1m (I2 de-fork): scheduleSlotHTML(s) is a real, directly-callable helper producing the .slot/.slot-time/.slot-what/.slot-where shape; #tvGridLegend starts byte-identical to the Board's #sgLegend and picks up a LIVE mutation of #sgLegend's content on the next renderTv() (a clone at render time, not a second hand-maintained static copy — it structurally CANNOT drift)",
    slotHelperOk && legendMatchesOk && legendClonedLiveOk,
    "slotHelper=" + slotHelperOk + " legendMatches=" + legendMatchesOk + " legendClonedLive=" + legendClonedLiveOk);
}

{ // S26-T1n (fix round 1, m5-i): the 20s rotation interval — enter/exit the
  // tv view three times; TV_TIMER (a `let`, read via eval like STATE) must
  // be exactly 0-then-1 active at every step, never accumulating (a leak
  // mutant that forgets to clear on exit would stack up multiple intervals,
  // each firing tvAdvance() independently and racing the rotation).
  const domT1n = makeDom("");
  const wT1n = domT1n.window;
  await until(() => wT1n.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const isActive = () => wT1n.eval("TV_TIMER !== null");
  const goTo = (hash) => { wT1n.location.hash = hash; wT1n.dispatchEvent(new wT1n.Event("hashchange")); };
  const states = [];
  for (let i = 0; i < 3; i++) {
    goTo("#tv"); states.push(isActive());
    goTo("#board"); states.push(isActive());
  }
  domT1n.window.close();
  const cycleOk = states.every((v, i) => v === (i % 2 === 0));   // on,off,on,off,on,off

  check("S26-T1n (m5-i): the rotation interval (TV_TIMER) is active immediately after every #tv entry and cleared immediately after every #board exit, across three full enter/exit cycles — never leaks a second interval",
    cycleOk,
    "states=" + JSON.stringify(states));
}

{ // S26-T2a: K-QR vendored encoder — file presence + license-header gate.
  // The actual QR logic (finder/timing patterns, determinism, the pinned
  // sha256 change-detector, both real kit URLs) is exercised by
  // tools/print/qr.test.mjs, run standalone via `node tools/print/qr.test.mjs`
  // (also wired as the `check-qr` npm script). This suite has no existing
  // precedent for shelling out to a child tool test (no child_process usage
  // anywhere in smoke.mjs — presend-check/event-ready/gid-check are instead
  // dynamically imported and their exported pure functions are called
  // in-process, or their source text is read and pattern-matched), so this
  // check follows THAT precedent: it asserts the vendored file's license
  // header is verbatim, the provenance line is present, and the ESM export
  // + qr.mjs API surface exist — a change-detector for the vendoring
  // contract, not a re-run of qr.test.mjs's own assertions.
  const vendorSrc = readFileSync(path.join(ROOT, "tools", "print", "qr-vendor.mjs"), "utf8");
  const apiSrc = readFileSync(path.join(ROOT, "tools", "print", "qr.mjs"), "utf8");
  let testFileExists = true;
  try { readFileSync(path.join(ROOT, "tools", "print", "qr.test.mjs"), "utf8"); }
  catch { testFileExists = false; }

  const licenseOk = vendorSrc.includes("Copyright (c) 2009 Kazuhiko Arase")
    && vendorSrc.includes("Licensed under the MIT license:")
    && vendorSrc.includes("http://www.opensource.org/licenses/mit-license.php");
  const provenanceOk = /Reconstructed from:\s*qrcode-generator \(Kazuhiko Arase\),\s*v[\d.]+/.test(vendorSrc);
  const esmExportOk = /export default qrcode;/.test(vendorSrc);
  const apiOk = /export function qrSvg\(/.test(apiSrc) && /export function qrEncode\(/.test(apiSrc);

  check("S26-T2a: tools/print/qr-vendor.mjs carries the MIT license header verbatim (Copyright + license line + URL) plus a one-line provenance comment (upstream name + version), ESM-wraps the factory (`export default qrcode;`, no behavioral edits); tools/print/qr.mjs exports qrSvg/qrEncode; tools/print/qr.test.mjs exists and runs standalone via `node tools/print/qr.test.mjs`",
    licenseOk && provenanceOk && esmExportOk && apiOk && testFileExists,
    "license=" + licenseOk + " provenance=" + provenanceOk + " esmExport=" + esmExportOk + " api=" + apiOk + " testFile=" + testFileExists);
}

{ // S26-T3a: K-PRINT poster + captain-cards generator — file presence +
  // exported-surface gate, following S26-T2a's own precedent exactly: the
  // actual generator logic (vault guard, structural guard, dates/venue
  // fallbacks, generation stamp, encoded QR targets, roster/captain
  // mirroring) is exercised by tools/print/make-kit.test.mjs, run
  // standalone via `node tools/print/make-kit.test.mjs`. This suite has no
  // child_process precedent (see S26-T2a's comment), so this check instead
  // asserts make-kit.mjs's pure exports and make-kit.test.mjs's presence —
  // a change-detector for the module's public surface, not a re-run of
  // make-kit.test.mjs's own assertions.
  const kitSrc = readFileSync(path.join(ROOT, "tools", "print", "make-kit.mjs"), "utf8");
  let testFileExists = true;
  try { readFileSync(path.join(ROOT, "tools", "print", "make-kit.test.mjs"), "utf8"); }
  catch { testFileExists = false; }

  const exportsOk = [
    "export function readConfig(", "export function parseCsv(",
    "export function vaultGuardHeaders(", "export function assertNoAt(",
    "export function assertFieldsNoAt(", "export function currentSeason(",
    "export function normalizeFieldYear(", "export function rosterMap(",
    "export function genStamp(", "export function cardStamp(",
    "export function scoreUrlFor(",
    "export function posterQrSvg(", "export function cardQrSvg(",
    "export function generateKit(", "export const SITE_ROOT",
  ].every(sig => kitSrc.includes(sig));
  const qrImportOk = /import\s*\{\s*qrSvg\s*\}\s*from\s*"\.\/qr\.mjs"/.test(kitSrc);
  const importLines = kitSrc.split("\n").filter(l => /^import\b/.test(l));
  const nonNodeImports = importLines.filter(l => !/from\s+"node:/.test(l));
  const noOtherImportsOk = nonNodeImports.length === 1 && /from\s*"\.\/qr\.mjs"/.test(nonNodeImports[0]);
  const gitignoreOk = readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("tools/print/out/");

  check("S26-T3a: tools/print/make-kit.mjs exists, imports qrSvg from ./qr.mjs (and no non-node-builtin dependency beyond it), and exports the pure generator surface (readConfig/parseCsv/vaultGuardHeaders/assertNoAt/assertFieldsNoAt/currentSeason/normalizeFieldYear/rosterMap/genStamp/cardStamp/scoreUrlFor/posterQrSvg/cardQrSvg/generateKit/SITE_ROOT); tools/print/make-kit.test.mjs exists and runs standalone via `node tools/print/make-kit.test.mjs` (also `npm run check-kit`, T2 symmetry with check-qr); .gitignore excludes tools/print/out/",
    exportsOk && qrImportOk && noOtherImportsOk && testFileExists && gitignoreOk,
    "exports=" + exportsOk + " qrImport=" + qrImportOk + " noOtherImports=" + noOtherImportsOk + " testFile=" + testFileExists + " gitignore=" + gitignoreOk);
}

/* ---------------------------------------------------------------------
   Tally — per group, then total. Later tasks grep these lines.
   --------------------------------------------------------------------- */
const groupTally = {};
results.forEach(([name, ok]) => {
  const m = name.match(/^([A-Z])\d+:/);
  if (!m) return;
  const g = m[1];
  groupTally[g] = groupTally[g] || { pass: 0, total: 0 };
  groupTally[g].total++;
  if (ok) groupTally[g].pass++;
});

console.log("");
Object.keys(groupTally).sort().forEach(g => console.log(`TALLY ${g} ${groupTally[g].pass}/${groupTally[g].total}`));
const failed = results.filter(r => !r[1]).length;
console.log(`TALLY TOTAL ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
