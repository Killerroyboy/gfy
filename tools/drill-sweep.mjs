#!/usr/bin/env node
/* SC-DRILL step 2 — the 15-tap sweep, scripted and mechanically verified.
 *
 * The drill is the blocking gate before a single captain link goes out, and step 2 is
 * its most tedious part: one submission per team, then checking each one landed. Done by
 * hand under time pressure it is exactly where an operator starts trusting the `ok` on
 * screen instead of the row in the sheet. That is the failure this script removes.
 *
 * THE PASS CONDITION IS THE ROW, NEVER THE 200. The real doPost returns the team's FULL
 * CURRENT ROUND ROW, read back from Scores AFTER the write (`holes`). So a pass here is
 * `holes.h13 === 6` — sheet state from the authoritative source — not `res.ok`, and not
 * an HTTP status. An echo stub can return `{ok:true}` all day and never write anything.
 * Verifying through the published CSV instead was considered and rejected: it lags ~5
 * minutes, so a green read would prove nothing about the row that was just written.
 *
 * IT REFUSES TO RUN AGAINST A STUB. check-endpoint's classifier is reused (§27 SC-PROBE)
 * — a sweep against the echo deployment would report 15 cheerful successes and write
 * nothing, which is worse than not drilling at all.
 *
 * WRITES TO THE LIVE SHEET. This is Riley's to run, never an agent's: it is a prod write
 * on the tournament's real scoring data. It is deliberately --dry-run by default.
 *
 * Usage:
 *   node tools/drill-sweep.mjs <endpoint>                 # dry run: probe + plan only
 *   node tools/drill-sweep.mjs <endpoint> --go            # actually submit
 *   node tools/drill-sweep.mjs <endpoint> --go --round 2 --hole 13 --score 6
 *
 * Cleanup afterwards is step 8 and is NOT automated here: deleting rows from the live
 * Scores tab by script is a destructive prod write, and the drill's own rule is that the
 * operator sees what they are removing. This prints exactly what to remove.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classify } from "./check-endpoint.mjs";
import { readConfig, parseCsv } from "./presend-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// hole !== score on purpose: a transposition mistake cannot accidentally pass.
const DEFAULTS = { round: "2", hole: 13, score: 6 };

export function drillClientId(team, stamp) {
  // The reserved `drill:` namespace (§27 SC-DRILL-NS) is what makes step 8's idempotency
  // purge possible. Without it a leftover key silently answers a REAL captain submission
  // with a stored drill verdict and never writes the score.
  return `drill:${String(team).trim().toLowerCase().replace(/\s+/g, "-")}:${stamp}`;
}

/* PURE. The whole verdict for one submission, so it can be tested without a network. */
export function judge(team, hole, score, res, err) {
  if (err) return { team, pass: false, why: `send failed: ${err}` };
  if (!res || typeof res !== "object") return { team, pass: false, why: "no response object" };
  if (res.ok !== true) return { team, pass: false, why: `endpoint refused: ${res.verdict || "no verdict"}` };
  const holes = res.holes;
  if (!holes || typeof holes !== "object") {
    // ok:true with no row echoed back is the stub's signature, and the single most
    // dangerous shape here: it looks like success and proves nothing.
    return { team, pass: false, why: "ok:true but NO row echoed back — nothing proves a row was written" };
  }
  const got = String(holes["h" + hole] ?? "").trim();
  if (got !== String(score)) return { team, pass: false, why: `row came back with h${hole}=${got || "(empty)"}, expected ${score}` };
  return { team, pass: true, why: `row confirmed: h${hole}=${got}`, verdict: res.verdict };
}

export function summarise(results) {
  const pass = results.filter(r => r.pass).length;
  return { total: results.length, pass, fail: results.length - pass, ok: pass === results.length && results.length > 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.find(a => /^https:\/\//.test(a));
  const GO = args.includes("--go");
  const num = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
  const round = String(num("--round", DEFAULTS.round));
  const hole = Number(num("--hole", DEFAULTS.hole));
  const score = Number(num("--score", DEFAULTS.score));

  console.log("SC-DRILL step 2 — the sweep. The pass condition is the ROW, never the 200.\n");
  if (!url) {
    console.log("usage: node tools/drill-sweep.mjs <score_endpoint url> [--go]");
    console.log("       (the URL is Info!score_endpoint on the live sheet)");
    process.exit(2);
  }

  // 1. refuse a stub, loudly
  let probe;
  try {
    const res = await fetch(url, { redirect: "follow" });
    probe = classify({ status: res.status, contentType: res.headers.get("content-type") || "", body: await res.text() });
  } catch (e) { probe = classify({ networkError: e.message }); }
  console.log(`endpoint: ${probe.verdict}  ${probe.why}`);
  if (probe.verdict !== "REAL") {
    console.log("\nREFUSING to sweep. A sweep against a stub reports cheerful successes and writes");
    console.log("nothing — worse than not drilling. Arm the real handler first (README step 3b).");
    process.exit(1);
  }

  // 2. roster, from the live sheet
  const { pub, gids } = readConfig(readFileSync(join(ROOT, "config.js"), "utf8"));
  const csv = async tab => {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/e/${pub}/pub?gid=${gids[tab]}&single=true&output=csv&cb=${Date.now()}`, { redirect: "follow" });
    if (!/text\/csv/.test(r.headers.get("content-type") || "")) throw new Error(`${tab}: not CSV (rate-limited or unpublished)`);
    return parseCsv(await r.text());
  };
  const info = Object.fromEntries((await csv("info")).map(r => [String(r.key || "").trim(), String(r.value || "").trim()]));
  const season = (info.first_tee || "").slice(0, 4);
  const teams = [...new Map((await csv("field"))
    .filter(r => String(r.year || "").trim() === season && String(r.team || "").trim())
    .map(r => [String(r.team).trim().toLowerCase(), String(r.team).trim()])).values()];

  console.log(`season ${season} · ${teams.length} team(s): ${teams.join(", ") || "(none)"}`);
  if (!teams.length) {
    console.log("\nNo teams on Field for this season — the draft has not happened, or the sheet is unfilled.");
    console.log("Nothing to sweep.");
    process.exit(2);
  }
  console.log(`plan: one submission per team — round ${round}, hole ${hole}, score ${score} (hole != score on purpose)\n`);

  if (!GO) {
    console.log("DRY RUN — nothing sent. Re-run with --go to submit.");
    console.log("Reminder: this WRITES to the live Scores tab. It is Riley's to run.");
    process.exit(0);
  }

  // 3. sweep
  const stamp = Date.now();
  const results = [];
  for (const team of teams) {
    const client_id = drillClientId(team, stamp);
    let res = null, err = null;
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
        body: JSON.stringify({ team, round, hole, score, client_id, seq: 1 }),
      });
      res = JSON.parse(await r.text());
    } catch (e) { err = e.message; }
    const v = judge(team, hole, score, res, err);
    results.push({ ...v, client_id });
    console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${team.padEnd(14)} ${v.why}`);
    await new Promise(r => setTimeout(r, 700));         // the lock serialises; do not stampede it
  }

  const s = summarise(results);
  console.log(`\nsweep: ${s.pass}/${s.total} rows confirmed in the sheet`);
  if (!s.ok) {
    console.log("DRILL STEP 2 FAILED — do not send captain links. Fix before continuing.");
  } else {
    console.log("Step 2 passed. Continue with steps 3-7 (pocket, airplane, clobber, concurrent, round-toggle, canary).");
  }
  console.log("\nSTEP 8 CLEANUP — not automated (deleting live rows by script is a destructive prod write):");
  console.log(`  1. delete the sweep rows from Scores: year ${season}, round ${round}, h${hole}=${score}`);
  console.log(`  2. in the Apps Script project, delete every ScriptProperties key starting: idem:drill:`);
  console.log("     a surviving drill key answers a REAL submission with the stored drill verdict and never writes it");
  process.exit(s.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
