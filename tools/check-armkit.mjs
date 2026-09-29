#!/usr/bin/env node
/* CHECK-ARMKIT — read-only. Inspects the LOCAL tools/clasp/ workspace and says
 * whether it is safe to arm from. It performs no upload, no deploy and no
 * network call of any kind; it only reads files and reports.
 *
 * Why it exists: arming from a local directory is safer than clicking through
 * the Apps Script UI, but only if the directory is right. Two of this project's
 * scorer traps become silent disasters at exactly that moment:
 *
 *   - a STALE triggers.gs has no §27 SC-IDENT envelope, so the redeploy answers
 *     without identity, check-endpoint prints STUB, and the operator concludes
 *     arming failed when the write path is fine. One grep separates that from
 *     "the spike is still winning", and the two are fixed by OPPOSITE actions.
 *   - a push makes the live project MATCH the local directory, so a file that is
 *     missing here is DELETED there. Losing Code.gs (sheet-polish) that way would
 *     take out the sheet's formatting, checkbox and CF automation.
 *
 * So this answers one question — "is the thing I am about to upload correct?" —
 * before anything irreversible happens. It is the preflight, not the flight.
 *
 * Usage: npm run check-armkit
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WS = join(HERE, "clasp");
const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");

/* PURE — the whole verdict, testable without a filesystem. Same discipline as
   check-endpoint's classify() and drill-sweep's judge(). */
export function verdict({ exists, hasManifest, present, canonical, identityOk }) {
  const problems = [], notes = [];
  if (!exists) return { ok: false, problems: ["tools/clasp/ does not exist — nothing to check yet; see the setup block in docs/2027-DATA-PACKAGE.md"], extras: [] };
  if (!hasManifest) problems.push("appsscript.json is ABSENT — it must come from a real `clasp clone`/`pull`. It owns the web app's executeAs/access, and a hand-written one breaks the endpoint in a way that reads like a code bug.");
  for (const need of ["Code.gs", "triggers.gs"]) {
    if (!present.includes(need)) problems.push(`${need} is ABSENT — a push would DELETE it from the live project.`);
  }
  for (const [name, ok] of Object.entries(canonical)) {
    if (present.includes(name) && !ok) problems.push(`${name} does NOT match the repo's canonical source — one owner (§7). Re-copy it from tools/, never edit it inside the workspace.`);
  }
  if (present.includes("triggers.gs") && !identityOk) {
    problems.push("triggers.gs carries NO §27 SC-IDENT envelope (SCORER_HANDLER = \"gfy-scorer\") — this is the STALE-HANDLER trap. Pushing it would answer without identity and the probe would print STUB.");
  }
  const extras = present.filter(f => !["Code.gs", "triggers.gs", "appsscript.json"].includes(f));
  for (const e of extras) {
    if (/^Untitled\.gs$/i.test(e)) notes.push("Untitled.gs is still here — that is the §18 spike. DELETE IT LOCALLY (rm) so the push removes it remotely; leaving it means the spike keeps winning the shared global scope.");
    else notes.push(`${e} is here and is not one of the three expected files — a push would upload it. Look before you do.`);
  }
  return { ok: problems.length === 0, problems, notes, extras };
}

function main() {
  console.log("CHECK-ARMKIT — read-only preflight on tools/clasp/. No upload, no deploy, no network.\n");
  const exists = existsSync(WS);
  const present = exists ? readdirSync(WS).filter(f => !f.startsWith(".")) : [];
  const canonical = {};
  for (const [local, repo] of [["Code.gs", "sheet-polish.gs"], ["triggers.gs", "sheet-triggers.gs"]]) {
    canonical[local] = existsSync(join(WS, local)) && existsSync(join(HERE, repo))
      && md5(join(WS, local)) === md5(join(HERE, repo));
  }
  const identityOk = existsSync(join(WS, "triggers.gs"))
    && /SCORER_HANDLER\s*=\s*"gfy-scorer"/.test(readFileSync(join(WS, "triggers.gs"), "utf8"));

  const v = verdict({ exists, hasManifest: present.includes("appsscript.json"), present, canonical, identityOk });

  console.log(`  workspace          ${exists ? WS : "(absent)"}`);
  if (exists) {
    console.log(`  files              ${present.join(", ") || "(empty)"}`);
    console.log(`  appsscript.json    ${present.includes("appsscript.json") ? "present (must be pulled, not written)" : "ABSENT"}`);
    console.log(`  Code.gs            ${canonical["Code.gs"] ? "matches tools/sheet-polish.gs" : "missing or DRIFTED"}`);
    console.log(`  triggers.gs        ${canonical["triggers.gs"] ? "matches tools/sheet-triggers.gs" : "missing or DRIFTED"}`);
    console.log(`  SC-IDENT envelope  ${identityOk ? "present — a redeploy can answer REAL" : "ABSENT — a redeploy would serve a stub"}`);
  }
  for (const n of v.notes || []) console.log("\n  NOTE: " + n);
  if (!v.ok) {
    console.log("\nNOT SAFE TO ARM FROM:");
    for (const p of v.problems) console.log("  - " + p);
    console.log("\nSetup and the arming commands are in docs/2027-DATA-PACKAGE.md (Step 0).");
    process.exit(1);
  }
  console.log("\nThe workspace is correct: the canonical sources, the pulled manifest, and the identity envelope.");
  console.log("Arming from here cannot serve a stale handler and cannot delete Code.gs.");
  console.log("After the redeploy, check-endpoint must print REAL — a deploy that ran is not a scorer that writes.");
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
