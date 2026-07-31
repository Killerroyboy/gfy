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
  const warnedX33 = stripX33 && !stripX33.hidden &&
    /Course tab: hole 7 par missing or invalid — To-par suppressed \(strokes only\)/.test(stripX33.textContent);
  domX33.window.close();
  check("X33: SC-PAR-VALID — blank par cell (hole 7 row present, par empty) => tally data-mode=strokes (not topar w/ silent 0), hole-7 cell 'Par —', hole-8 still labeled, healthStrip names hole 7 with the pinned copy",
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
  domX35.window.close();
  check("X35: SC-PAR-VALID — blank par cell hides the score grid behind the 'needs all 18 holes' note (same degrade as a missing row; no Par-0 header row can render)",
    !!noteShown && scrollHiddenX35, `note=${note && note.textContent} hidden=${note && note.hidden} scrollHidden=${scrollHiddenX35}`);
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
  const cssTextX37 = [...docBX37.querySelectorAll("style")].map(s => s.textContent).join("");
  const wideRuleStructuralX37 = /#leaderboard\.lb-suppressed\s*\.lb-total\s*\{\s*display:\s*none/.test(cssTextX37);
  // STRUCTURAL: the pre-existing ≤560px rule that already hides the SAME
  // redundant column unconditionally is still present, untouched — the
  // narrow-width half of "both widths".
  const narrowRuleStructuralX37 = /@media \(max-width:560px\)/.test(cssTextX37) &&
    /\.lb-r1,\.lb-r2,\.lb-total\{display:none\}/.test(cssTextX37);
  // STRUCTURAL (whole-branch review Imp-1 fix): hiding the Total column out
  // of the explicit 7-track grid without redefining the template leaves a
  // dead 7th track — the surviving 6 columns must get their own template,
  // and it MUST be scoped to widths ABOVE the ≤560px breakpoint (an
  // unscoped id-selector rule would out-specify — id beats class — the
  // ≤560px 4-track rule above and regress phones, since .lb-suppressed is a
  // viewport-independent state class). Sliced from the media query's own
  // start (same index-based technique K5 already established for this
  // file's CSS-source checks) so the assert is scoped to THIS rule, not
  // just "these tokens appear somewhere in the file"; the closing
  // `\s*[};]` after the 6th value guards against a regression that leaves
  // a stray 7th track back in (must be EXACTLY 6 tracks, not 6-then-more).
  const mqStartX37 = cssTextX37.indexOf("@media (min-width:561px)");
  const mqSliceX37 = mqStartX37 >= 0 ? cssTextX37.slice(mqStartX37, mqStartX37 + 300) : "";
  const gridTemplateRuleStructuralX37 =
    /#leaderboard\.lb-suppressed\s*\.lb-head\s*,\s*#leaderboard\.lb-suppressed\s*\.lb-row/.test(mqSliceX37) &&
    /grid-template-columns:\s*2\.4rem\s+1fr\s+4rem\s+3\.2rem\s+3\.2rem\s+4rem\s*[};]/.test(mqSliceX37);
  domBX37.window.close();

  check("X37: SC-PAR-LABEL — board label honesty (§20 amendment 2): complete course => #lbToParHead reads 'To par', #leaderboard NOT .lb-suppressed, real to-par form rendered; blank-par-7 course => header flips to 'Total', #leaderboard IS .lb-suppressed, the To-par-column span holds the IDENTICAL plain-digit gross the Total column holds (never a differently-valued or mislabeled figure); STRUCTURAL: the wide-width collapse rule, the pre-existing ≤560px rule that hides the redundant Total column, AND a min-width:561px-scoped 6-track grid-template-columns redefinition for #leaderboard.lb-suppressed .lb-head/.lb-row (no dangling 7th track/dead gutter at wide widths, correctly NOT applying at ≤560px so the narrow 4-track template stays governing there) are all present in the page's own CSS source (whole-branch review Imp-1)",
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
  const rowsExistBX39 = posCellsBX39.length >= 5;
  const allDashBX39 = rowsExistBX39 && posCellsBX39.every(t => t === "—");
  const noLeadBX39 = !docBX39.querySelector("#lbBody .lb-row.lead");
  domBX39.window.close();

  check("X39: SC-RANK-POS — complete course: first Pos '1' + a .lead row present; blank-par: all Pos cells '—', zero .lead rows, all teams still listed (no standing claims off the raw-gross fallback)",
    okPos1X39 && okLeadX39 && rowsExistBX39 && allDashBX39 && noLeadBX39,
    `okPos1=${okPos1X39} okLead=${okLeadX39} rows=${posCellsBX39.length} allDash=${allDashBX39} noLead=${noLeadBX39}`);
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
  const basisBX40 = /Paused · Course pars incomplete/.test(docBX40.querySelector("#calBasis").textContent);
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
