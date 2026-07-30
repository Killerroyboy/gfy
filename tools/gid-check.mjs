#!/usr/bin/env node
/* O-GIDCHECK (spec §19): fetch the published sheet's pubhtml, parse its
   tab-name→gid map, and diff it against config.js. PRINT-ONLY — this tool
   never writes config.js (silently repointing a tab is the failure class it
   exists to DETECT: the info-gid-"0" incident). Exit 0 = all wired gids
   match; 1 = mismatch/missing (paste-ready block printed); 2 = pubhtml
   unparseable (nothing verified — never a partial map presented as truth).
   Run: npm run check-gids */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readConfig } from "./presend-check.mjs";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const norm = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

export function parseTabMap(html){
  // pubhtml does NOT serve the tab list as markup (the <li id="sheet-button-…">
  // elements are built client-side by JS fetch() never runs). The map is
  // served as a JS array: items.push({name: "START HERE", …, gid: "1054538461", …}).
  // LIVE-VALIDATED at plan review (2026-07-30): 15 tabs parsed, all 13 config
  // gids matched. Names can carry JS escapes (\x26 for &) — unescape first.
  const map = new Map();
  const unesc = s => String(s)
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, "$1");
  for (const m of String(html).matchAll(/items\.push\(\{\s*name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g)){
    map.set(norm(unesc(m[1])), m[2]);
  }
  return map;
}

async function main(){
  const { pub, gids } = readConfig(readFileSync(path.join(REPO, "config.js"), "utf8"));
  if (!pub){ console.log("config.js has no PUB_ID — is the sheet wired?"); process.exitCode = 2; return; }
  const cfgKeys = Object.keys(gids);
  if (!cfgKeys.length){
    console.log("config.js GID block did not parse — nothing verified (this is a tool failure, not a clean result)");
    process.exitCode = 2; return;
  }
  let html;
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/e/${pub}/pubhtml`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    html = await res.text();
  } catch (e) {
    console.log(`could not fetch pubhtml (${e.message}) — nothing verified`);
    process.exitCode = 2; return;
  }
  const live = parseTabMap(html);
  if (!live.size){
    console.log("could not parse the tab map — Google may have changed the pubhtml markup; NOTHING verified (this is a tool failure, not a clean result)");
    process.exitCode = 2; return;
  }
  let bad = 0;
  console.log(`pubhtml tabs found: ${live.size} · config gids: ${cfgKeys.length}`);
  for (const [tab, gid] of Object.entries(gids)){
    const liveGid = live.get(norm(tab)) ?? live.get(norm(tab.replace(/_/g, " ")));
    if (liveGid === undefined){ console.log(`  ${tab}: gid ${gid} — NO TAB of that name in pubhtml`); bad++; }
    else if (liveGid !== gid){ console.log(`  ${tab}: config has ${gid}, live sheet says ${liveGid}  ← MISMATCH`); bad++; }
    else console.log(`  ${tab}: ${gid} OK`);
  }
  const unwired = [...live.entries()].filter(([n]) => !Object.keys(gids).some(t => norm(t) === n || norm(t.replace(/_/g, " ")) === n));
  if (unwired.length) console.log("tabs on the sheet with no config entry (fine if intentional — e.g. START HERE, Form Responses): "
    + unwired.map(([n, g]) => `${n}=${g}`).join(", "));
  if (bad){
    console.log("\npaste-ready GID block (from the LIVE sheet — review before using, this tool never writes config.js):");
    console.log("  GID: {");
    for (const tab of Object.keys(gids)){
      const g = live.get(norm(tab)) ?? live.get(norm(tab.replace(/_/g, " ")));
      console.log(`    ${tab}: "${g ?? gids[tab]}",`);
    }
    console.log("  },");
  }
  process.exitCode = bad ? 1 : 0;
}

// Import-safe CLI guard — presend's MINOR-8 realpath pattern verbatim, so a
// future test can import parseTabMap without firing a live network call.
function realpathOrSelf(p){ try { return realpathSync(p); } catch { return p; } }
const invokedReal = process.argv[1] ? realpathOrSelf(process.argv[1]) : null;
const selfReal = realpathOrSelf(fileURLToPath(import.meta.url));
if (invokedReal && pathToFileURL(invokedReal).href === pathToFileURL(selfReal).href)
  main().catch(e => { console.log("gid-check failed: " + (e && e.message ? e.message : e) + " — nothing verified"); process.exitCode = 2; });
