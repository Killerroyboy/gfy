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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsdom from "jsdom";

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");

const TABS = ["info","course","field","scores","schedule","pairings",
              "calcutta","payout","ledger","champions","shame","invites"];
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
  { id: "A2", pos: "1", name: "Duck & Hammer",          cap: "Duck",  thru: "F",      r1: "74", r2: "74", total: "148", toPar: "+4" },
  { id: "A3", pos: "1", name: "Sully & Johnson, Wade",  cap: "Sully", thru: "F",      r1: "75", r2: "73", total: "148", toPar: "+4" },
  { id: "A4", pos: "3", name: "Tex & Tank",             cap: "Tex",   thru: "R2 · 7", r1: "77", r2: "27", total: "104", toPar: "+5" },
  { id: "A5", pos: "4", name: "Moose & Sock",           cap: "Moose", thru: "F",      r1: "76", r2: "74", total: "150", toPar: "+6" },
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
  const healthMainText = doc.querySelector("#healthStrip")?.textContent || "";
  const warnMatch = healthMainText.match(/(\d+)\s*(data )?warning/i);
  const warnCount = warnMatch ? parseInt(warnMatch[1], 10) : -1;
  check("D3: health strip shows exactly the 3 expected flags (Hamer unmatched, Sully h9 merge conflict, Moose blank-year default)",
    warnCount === 3 && /Hamer/i.test(healthMainText) && /h9/i.test(healthMainText)
      && /(blank|defaulted)/i.test(healthMainText),
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
  check("D5: debug happy path — 12 tabs OK",
    okCount === 12 && !hasFailed,
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
  const infoPast = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", "2020-08-15T09:00:00-06:00");
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
   GROUP W — invites funnel (v2.1 Invites tab, Task 12)
   Fixture (fixtures/invites.csv, year 2027): Duck paid-overlap (already
   paid via Field 2027); "Johnson, Wade" responded; Moose invited only;
   Sock invited+responded but status=out on his Field 2027 row (must be
   suppressed — the out-cross-source rule); Blade brand-new with nothing
   ticked (needs). Hand-derived funnel: paid = Duck, Tank, Crash (all via
   Field 2027 deposit); responded = Johnson, Wade; invited = Moose;
   needs = Hammer, Sully, Tex, Bear, Blade. 3 paid · 1 responded ·
   1 invited · 5 need an invite.
   --------------------------------------------------------------------- */
check("W1: funnel line reads exact hand-derived counts — 3 paid · 1 responded · 1 invited · 5 need an invite",
  nyBodyText.includes("3 paid · 1 responded · 1 invited · 5 need an invite"),
  nyBodyText.slice(0, 260));

{
  const needsIdx = nyBodyText.indexOf("Needs an invite");
  const needsBlockText = needsIdx === -1 ? "" : nyBodyText.slice(needsIdx);
  check("W2: Needs-an-invite block lists Blade and Hammer",
    needsBlockText.includes("Blade") && needsBlockText.includes("Hammer"),
    needsBlockText.slice(0, 160));
}

check("W3: Sock appears nowhere on the Next Year board (out on his Field row suppresses him despite invited+responded on his Invites row)",
  nyBodyText.trim().length > 0 && !nyBodyText.includes("Sock"),
  nyBodyText.slice(0, 300));

{
  const fullHTML = doc.documentElement.outerHTML;
  const fixtureEmails = ["duck@example.com", "wade@example.com", "moose@example.com", "sock@example.com", "blade@example.com"];
  const leaked = fixtureEmails.filter(e => fullHTML.includes(e));
  check("W4: no fixture email address appears anywhere in the rendered document (privacy rule — email is mail-merge only)",
    leaked.length === 0, "leaked=" + JSON.stringify(leaked));
}

{
  const infoPastW5 = FIXTURES.info.replace("2026-08-15T09:00:00-06:00", "2020-08-15T09:00:00-06:00");
  const pastFetchW5 = withOverride({
    info: () => Promise.resolve({ ok: true, status: 200, text: async () => infoPastW5 }),
  });
  const domW5 = makeDom("", pastFetchW5);
  await settle();
  const homeStatusW5 = domW5.window.document.querySelector("#homeStatus")?.textContent || "";
  check("W5: Home strip contains '5 need an invite' linking #nextyear",
    homeStatusW5.includes("5 need an invite"), homeStatusW5);
  domW5.window.close();
}

{
  const domW6 = makeDom("", fakeFetch, buildTestConfig({ invites: "" }));
  await until(() => domW6.window.document.querySelectorAll("#lbBody .lb-row").length > 0);
  const nyBodyTextW6 = domW6.window.document.querySelector("#nyBody")?.textContent || "";
  check("W6: invites tab stubbed absent (rows null) — board renders exactly the v2 baseline, no funnel line, no needs block",
    nyBodyTextW6.includes("3 of 9 paid")
      && !/\d+\s*paid\s*·\s*\d+\s*responded/.test(nyBodyTextW6)
      && !nyBodyTextW6.includes("Needs an invite"),
    nyBodyTextW6.slice(0, 260));
  domW6.window.close();
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

// Z1-Z4 — the state of live main: real config.js (empty PUB_ID/GID), every
// fetch rejecting. No fabricated warnings, no fabricated stamps — just the
// printed-card fallback content and a running countdown.
{
  const realConfigJS = readFileSync(path.join(ROOT, "config.js"), "utf8");
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
        return new Response(realConfigJS, { headers: { "Content-Type": "application/javascript" } });
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

/* ---------------------------------------------------------------------
   Tally — per group, then total. Later tasks grep these lines.
   --------------------------------------------------------------------- */
const groupTally = {};
results.forEach(([name, ok]) => {
  const m = name.match(/^([A-IWZ])\d+:/);
  if (!m) return;
  const g = m[1];
  groupTally[g] = groupTally[g] || { pass: 0, total: 0 };
  groupTally[g].total++;
  if (ok) groupTally[g].pass++;
});

console.log("");
["A", "B", "C", "D", "E", "F", "G", "H", "I", "W", "Z"].forEach(g => {
  if (groupTally[g]) console.log(`TALLY ${g} ${groupTally[g].pass}/${groupTally[g].total}`);
});
const failed = results.filter(r => !r[1]).length;
console.log(`TALLY TOTAL ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
