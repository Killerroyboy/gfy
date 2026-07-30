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

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");

const TABS = ["info","course","field","scores","schedule","pairings",
              "calcutta","payout","ledger","champions","shame","invites","rooms"];
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
const emptyConfig = `window.CONFIG = { PUB_ID:"", GID:${JSON.stringify(emptyGids)},
  SHEET_EDIT_URL:"", DRIVE_FOLDER_ID:"", FIRST_TEE:"2026-08-15T09:00:00-06:00",
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
  check("D5: debug happy path — 13 tabs OK",
    okCount === 13 && !hasFailed,
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
  const tiles = {
    pot: doc.querySelector("#calPot")?.textContent,
    rake: doc.querySelector("#calRake")?.textContent,
    payable: doc.querySelector("#calPayable")?.textContent,
    top: doc.querySelector("#calTop")?.textContent,
  };
  check("G1: calcutta tiles pot/rake/payable/top exactly per table",
    tiles.pot === "$400" && tiles.rake === "$40 (10%)" && tiles.payable === "$360" && tiles.top === "$120 · Duck",
    JSON.stringify(tiles));
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
  const owingListEl = doc.querySelector("#nyBody ul.mn-net.down");
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
     Field-2026 (9): Duck, Hammer, Sully, "Johnson, Wade", Moose, Sock, Tex,
       Tank, Bear.
     Field-2027 adds: Crash (paid 2026-09-01), Ghost (paid 2026-08-18).
       Duck/Tank also paid (2026-08-20 / 2026-08-22). Hammer present,
       unpaid. Sock present, status=out — F-OUT-HOME: Field's NEXT-season
       status is no longer authoritative, so this is now IGNORED + FLAGGED,
       not acted on.
     Invites-2027 adds: Blade (new, nothing ticked). Duck (invited+responded
       — paid overlap). "Johnson, Wade" (invited+responded). Moose (invited
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
     "Johnson, Wade" — responded, unpaid     -> responded
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
   Tex, Bear, Blade (needs), Moose (invited), "Johnson, Wade" (responded) —
   has NO Field-2027 row at all, so they move entirely behind ?admin=1. */
check("W2: public board's committed-only owing list (A1) names Hammer (has a NEXT Field row, unpaid) and carries no funnel-stage headings (Invited/Needs an invite/Declined) or refund note",
  /Hammer/.test(nyBodyText)
    && !nyBodyText.includes("Needs an invite") && !nyBodyText.includes("Invited")
    && !nyBodyText.includes("Declined") && !/refund owed/i.test(nyBodyText),
  nyBodyText.slice(0, 500));

check("W34: A1 — Tex/Bear/Blade/Moose/'Johnson, Wade' (responded/invited/needs, no Field-NEXT row) are ABSENT from the default (public) dom entirely",
  !/\bTex\b/.test(nyBodyText) && !/\bBear\b/.test(nyBodyText) && !/\bBlade\b/.test(nyBodyText)
    && !/\bMoose\b/.test(nyBodyText) && !/Johnson, Wade/.test(nyBodyText),
  nyBodyText.slice(0, 500));

check("W3: Sully (declined) and Ghost (paid+declined) are absent from the public board entirely — no owing nag, no silent money loss shown publicly (F-DECLINED)",
  !nyBodyText.includes("Sully") && !nyBodyText.includes("Ghost"),
  nyBodyText.slice(0, 500));

check("W4: no email column anywhere — Invites schema is year/player/invited/responded/status only (v2.2: email removed to the admin vault, P-VAULT — out of this codebase entirely)",
  !/email/i.test(FIXTURES.invites.split(/\r?\n/)[0]) && !/@example\.com/.test(doc.documentElement.outerHTML),
  FIXTURES.invites.split(/\r?\n/)[0]);

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
// is committed-only, the responded stage's name ("Johnson, Wade") must
// surface somewhere, and that's admin-only.
check("W31: A1 — admin dom reveals a new 'Responded' list ('Johnson, Wade') that never existed publicly or in admin before this wave",
  /Responded/.test(nyBodyTextAdmin) && /Johnson, Wade/.test(nyBodyTextAdmin),
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
  check("S3: S-NAV off-season order — Home, Next Year, Field lead the nav (first_tee pinned far-future via override, A6 — can't go red during the real event window)",
    navLinksText.slice(0, 3).join(",") === "home,nextyear,field",
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
  check("S4: S-NAV event-window order — Board, Pairings, Calcutta lead the nav (first_tee = today, inside ±3 days)",
    navLinksTextS4.slice(0, 3).join(",") === "board,pairings,calcutta",
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
  const blankGrp = grpText("Johnson, Wade · Moose · Tex");
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
  check("P4: checkbox columns are the closed list — exactly {deposit, collected, invited, responded, settled}, no extras",
    gs.includes('const CHECKBOX_COLS')
    && JSON.stringify(cbCols) === JSON.stringify(["collected","deposit","invited","responded","settled"])
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
  check("P6: scripts embed no sheet ids/urls (safe for public repo)",
    gs.length > 0 && triggs.length > 0
    && !/docs\.google\.com|spreadsheets\/d\//.test(gs) && !/docs\.google\.com|spreadsheets\/d\//.test(triggs));
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

  duckRow.click();
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
  check("U4: H-PODIUM — years without 2nd/3rd rows render only what exists (2023, 2019 single entries, no fabricated placings) and the bird holder stays the latest place-1 row (Duck)",
    entries.filter(e => e.querySelector(".entry-year")?.textContent === "2023").length === 1
    && entries.filter(e => e.querySelector(".entry-year")?.textContent === "2019").length === 1
    && (docH.querySelector("#homeBird")?.textContent || "").includes("Duck"),
    "");
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
