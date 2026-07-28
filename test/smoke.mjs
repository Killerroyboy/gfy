// Headless smoke test: loads index.html in jsdom, stubs fetch to serve the
// CSV fixtures, and asserts the rendered DOM. Run:  npm test
// Must pass before every deploy.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsdom from "jsdom";

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");

const TABS = ["info","course","field","scores","schedule","pairings",
              "calcutta","payout","ledger","champions","shame"];
const GIDS = {};
TABS.forEach((t, i) => GIDS[t] = String(101 + i));
const FIXTURES = {};
TABS.forEach(t => FIXTURES[t] = readFileSync(path.join(ROOT, "fixtures", t + ".csv"), "utf8"));

const testConfig = `window.CONFIG = { PUB_ID:"TESTPUB", GID:${JSON.stringify(GIDS)},
  SHEET_EDIT_URL:"", DRIVE_FOLDER_ID:"", FIRST_TEE:"2026-08-15T09:00:00-06:00",
  CURRENCY:"$", REFRESH_MS:3600000 };`;

function fakeFetch(url) {
  const gid = new URL(url).searchParams.get("gid");
  const tab = TABS.find(t => GIDS[t] === gid);
  if (!tab) return Promise.resolve({ ok: false, status: 404, text: async () => "no such gid" });
  return Promise.resolve({ ok: true, status: 200, text: async () => FIXTURES[tab] });
}

const envNoise = /not implemented|could not parse css/i;
function makeDom(query) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!envNoise.test(e.message)) errors.push(e.message + (e.cause ? " :: " + e.cause : "")); });
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: "http://localhost/" + query, virtualConsole: vc,
    beforeParse(window) { window.fetch = fakeFetch; },
    resources: { interceptors: [requestInterceptor((request) => {
      if (request.url.endsWith("/config.js"))
        return new Response(testConfig, { headers: { "Content-Type": "application/javascript" } });
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

const dom = makeDom("");
const doc = dom.window.document;
await until(() => doc.querySelectorAll("#lbBody .lb-row").length > 0);

/* 1. leaderboard order + to-par (includes 3: tie for first at position 1) */
const rows = [...doc.querySelectorAll("#lbBody .lb-row")].map(r => ({
  pos: r.querySelector(".lb-pos").textContent,
  name: r.querySelector(".lb-name").textContent,
  thru: r.querySelector(".lb-thru").textContent,
  r1: r.querySelector(".lb-r1").textContent,
  r2: r.querySelector(".lb-r2").textContent,
  total: r.querySelectorAll(".lb-tot")[0].textContent,
  toPar: r.querySelectorAll(".lb-tot")[1].textContent,
}));
const expected = [
  { pos:"1", name:"Duck",          thru:"F",       r1:"74", r2:"74", total:"148", toPar:"+4"  },
  { pos:"1", name:"Hammer",        thru:"F",       r1:"75", r2:"73", total:"148", toPar:"+4"  },
  { pos:"3", name:"Sully",         thru:"R1 · 11", r1:"51", r2:"—",  total:"51",  toPar:"+6"  },
  { pos:"4", name:"Moose",         thru:"F",       r1:"76", r2:"76", total:"152", toPar:"+8"  },
  { pos:"5", name:"Johnson, Wade", thru:"F",       r1:"80", r2:"78", total:"158", toPar:"+14" },
];
check("leaderboard: 5 rows rendered", rows.length === 5, JSON.stringify(rows));
expected.forEach((e, i) => {
  const g = rows[i] || {};
  check(`leaderboard row ${i + 1}: ${e.pos} ${e.name} ${e.toPar}`,
    g.pos === e.pos && g.name === e.name && g.total === e.total && g.toPar === e.toPar
      && g.r1 === e.r1 && g.r2 === e.r2,
    JSON.stringify(g));
});

/* 2. partial round shows R1 · 11 in Thru */
check("partial round: Sully Thru = 'R1 · 11'", rows[2] && rows[2].thru === "R1 · 11",
  rows[2] && rows[2].thru);

/* 3. two-way tie for first: both at position 1 */
check("tie for first: Duck and Hammer both position 1",
  rows[0] && rows[1] && rows[0].pos === "1" && rows[1].pos === "1"
    && new Set([rows[0].name, rows[1].name]).size === 2);

/* 4. calcutta payout math */
const pot = 120 + 100 + 80 + 60 + 40;          // from fixtures/calcutta.csv
const payable = pot * (1 - 10 / 100);          // calcutta_rake 10 (fixtures/info.csv)
const eachTied = payable * (50 + 30) / 2 / 100; // shares for places 1+2 split two ways
check("calcutta tiles: pot/rake/payable/top lot",
  doc.querySelector("#calPot").textContent === "$400"
    && doc.querySelector("#calRake").textContent === "$40 (10%)"
    && doc.querySelector("#calPayable").textContent === "$360"
    && doc.querySelector("#calTop").textContent === "$120 · Duck",
  [doc.querySelector("#calPot").textContent, doc.querySelector("#calRake").textContent,
   doc.querySelector("#calPayable").textContent, doc.querySelector("#calTop").textContent].join(" | "));

const pays = [...doc.querySelectorAll("#payBody .pay-row")].map(r => {
  const cells = r.children;
  const toNum = t => { const n = Number(t.replace(/[^0-9.-]/g, "")); return isNaN(n) ? 0 : n; };
  return {
    place: cells[0].textContent,
    player: cells[1].firstChild.textContent,
    owner: cells[2].textContent,
    ownerCut: toNum(cells[3].textContent),
    playerCut: toNum(cells[4].textContent),
  };
});
check("payout: 3 rows (tied pair + 3rd)", pays.length === 3, JSON.stringify(pays));
check(`payout: tied pair marked and each worth $${eachTied} = payable×(50+30)/2/100`,
  pays[0] && pays[1]
    && pays[0].place === "1st*" && pays[1].place === "1st*"
    && pays[0].ownerCut + pays[0].playerCut === eachTied
    && pays[1].ownerCut + pays[1].playerCut === eachTied,
  JSON.stringify(pays.slice(0, 2)));
check("payout: Duck 50% buyback splits $72/$72 to owner Tex",
  pays[0] && pays[0].player === "Duck" && pays[0].owner === "Tex"
    && pays[0].ownerCut === 72 && pays[0].playerCut === 72);
check("payout: Hammer blank buyback pays owner full $144, player —",
  pays[1] && pays[1].player === "Hammer" && pays[1].owner === "Johnson, Wade"
    && pays[1].ownerCut === 144 && pays[1].playerCut === 0);
check("payout: 3rd place Sully $54/$18 (25% buyback) to owner Hammer",
  pays[2] && pays[2].place === "3rd" && pays[2].player === "Sully"
    && pays[2].owner === "Hammer" && pays[2].ownerCut === 54 && pays[2].playerCut === 18,
  JSON.stringify(pays[2]));

/* 5. hall of shame worst-hole award */
const shameCards = [...doc.querySelectorAll("#shameBody .sh-card")].map(c => ({
  award: c.querySelector(".sh-award").textContent,
  who: c.querySelector(".sh-who").textContent,
  detail: c.querySelector(".sh-detail").textContent,
}));
const worst = shameCards.find(c => c.award === "Hole of the weekend");
check("shame: worst hole names Johnson, Wade — 9 on the par-3 16th, round 1, +6",
  !!worst && worst.who === "Johnson, Wade"
    && worst.detail.includes("9 on the par-3 16th") && worst.detail.includes("round 1")
    && worst.detail.includes("+6"),
  JSON.stringify(worst));

/* live-path health */
check("sync line reports live data ('Updated …'), not cache",
  doc.querySelector("#lbSync").textContent.startsWith("Updated"),
  doc.querySelector("#lbSync").textContent);
check("cache written after successful pull",
  dom.window.localStorage.getItem("gfy-cache-v5") !== null);
check("zero page errors in plain mode", dom.pageErrors.length === 0,
  dom.pageErrors.join(" ;; "));

/* debug mode against the same fixtures: every tab OK */
const dbg = makeDom("?debug=1");
await until(() => dbg.window.document.getElementById("debugPanel"));
const ptext = (dbg.window.document.getElementById("debugPanel") || {}).textContent || "";
check("debug: panel lists all 11 tabs OK", (ptext.match(/\bOK\b/g) || []).length === 11
  && !ptext.includes("FAILED") && !ptext.includes("EMPTY"), ptext);
check("debug: scores parsed 8 rows", /OK\s+scores\s+8 rows/.test(ptext), ptext);

dom.window.close(); dbg.window.close();
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} assertions passed`);
process.exit(failed ? 1 : 0);
