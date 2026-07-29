#!/usr/bin/env node
/* GFY pre-send checker — spec §13 V-MATCH/V-PATH/V-PROBE.
   Usage:  npm run presend -- <vault-contacts.csv> [--vault-url <admin sheet url>]
   Output: stdout ONLY. This output can contain real addresses — never redirect
   it to a file, paste it into an issue/PR, or commit it anywhere. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function parseCsv(text){
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){ if (c === '"' && text[i+1] === '"'){ cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r"){ if (cell !== "" || row.length){ row.push(cell); out.push(row); row = []; cell = ""; } }
    else cell += c;
  }
  if (cell !== "" || row.length){ row.push(cell); out.push(row); }
  const [head, ...rest] = out;
  if (!head) return [];
  return rest.map(r => Object.fromEntries(head.map((h, i) => [String(h).trim().toLowerCase(), (r[i] ?? "").trim()])));
}

export function insideRepo(vaultPath, repoRoot = REPO){
  const p = path.resolve(vaultPath);
  return p === repoRoot || p.startsWith(repoRoot + path.sep);
}

const norm = s => String(s || "").trim().toLowerCase();
const yes = s => /^(true|yes|1|x|✓)$/i.test(String(s || "").trim());

export function diffVault(contacts, invites){
  const nextYear = Math.max(0, ...invites.map(r => parseInt(r.year, 10) || 0));
  const inv = invites.filter(r => (parseInt(r.year, 10) || 0) === nextYear);
  const invNames = new Set(inv.map(r => norm(r.player)).filter(Boolean));
  const vaultNames = new Set(contacts.map(c => norm(c.player)).filter(Boolean));
  return {
    nextYear,
    neverInvited: contacts.filter(c => c.player && !yes(c.do_not_invite) && !invNames.has(norm(c.player))),
    missingFromVault: [...invNames].filter(n => !vaultNames.has(n)).map(n => inv.find(r => norm(r.player) === n).player),
    dniViolations: contacts.filter(c => yes(c.do_not_invite) && invNames.has(norm(c.player))),
  };
}

const EMAILISH = /[^\s@",]+@[^\s@",]+\.[^\s@",]+/;
export function scanForEmails(tabName, rows){
  const hits = [];
  rows.forEach((r, i) => Object.entries(r).forEach(([k, v]) => {
    if (EMAILISH.test(String(k)) || EMAILISH.test(String(v))) hits.push(`${tabName} row ${i + 2} column "${k}"`);
  }));
  return hits;
}

async function main(){
  const args = process.argv.slice(2).filter(a => a !== "--");
  const urlIx = args.indexOf("--vault-url");
  const vaultUrl = urlIx >= 0 ? args.splice(urlIx, 2)[1] : null;
  const vaultFile = args[0];
  if (!vaultFile){ console.log("usage: npm run presend -- <vault-contacts.csv> [--vault-url <url>]"); process.exit(2); }
  if (insideRepo(vaultFile)){
    console.log("REFUSED: " + vaultFile + " is inside the public repo working tree.");
    console.log("A stray `git add` would publish every address. Download the vault export somewhere else (e.g. ~/Downloads) and re-run.");
    process.exit(1);
  }
  const raw = readFileSync(vaultFile);
  if (raw[0] === 0x50 && raw[1] === 0x4b){ // xlsx = zip magic "PK"
    console.log("That's an .xlsx. In the Admin sheet: open the Contacts tab → File → Download → Comma-separated values, then re-run with that .csv.");
    process.exit(1);
  }
  const contacts = parseCsv(raw.toString("utf8"));
  if (!contacts.length || !("player" in contacts[0]) || !("email" in contacts[0])){
    console.log("This CSV doesn't look like the Contacts tab (need player + email columns)."); process.exit(1);
  }
  const cfg = readFileSync(path.join(REPO, "config.js"), "utf8");
  const pub = (cfg.match(/PUB_ID:\s*"([^"]+)"/) || [])[1];
  const gids = {}; [...cfg.matchAll(/(\w+):\s*"(\d+)"/g)].forEach(m => gids[m[1]] = m[2]);
  if (!pub || !gids.invites){ console.log("config.js has no PUB_ID / invites gid — is the sheet wired?"); process.exit(1); }
  const csvUrl = g => `https://docs.google.com/spreadsheets/d/e/${pub}/pub?gid=${g}&single=true&output=csv`;
  const invites = parseCsv(await (await fetch(csvUrl(gids.invites))).text());

  const d = diffVault(contacts, invites);
  console.log(`\n== GFY pre-send check (next season detected: ${d.nextYear || "?"}) ==`);
  console.log(`\nDO-NOT-INVITE VIOLATIONS (${d.dniViolations.length}):` +
    (d.dniViolations.length ? "\n  " + d.dniViolations.map(c => `${c.player} — ${c.reason || "no reason recorded"}`).join("\n  ") : " none"));
  console.log(`\nIn the vault, not yet on the Invites tab (${d.neverInvited.length}):` +
    (d.neverInvited.length ? "\n  " + d.neverInvited.map(c => `${c.player} <${c.email}>`).join("\n  ") : " none"));
  console.log(`\nOn the Invites tab, MISSING from the vault (${d.missingFromVault.length}):` +
    (d.missingFromVault.length ? "\n  " + d.missingFromVault.join("\n  ") : " none"));

  console.log("\n== published-content watchdog ==");
  let dirty = 0;
  for (const [tab, gid] of Object.entries(gids)){
    if (!gid || tab === "PUB_ID") continue;
    try {
      const rows = parseCsv(await (await fetch(csvUrl(gid))).text());
      const hits = scanForEmails(tab, rows);
      dirty += hits.length;
      hits.forEach(h => console.log("  EMAIL-LIKE VALUE PUBLISHED: " + h));
    } catch { console.log("  (could not fetch tab " + tab + " — check skipped, NOT clean)"); }
  }
  if (!dirty) console.log("  clean — no email-like content in any published tab");

  if (vaultUrl){ // V-PROBE
    const id = (vaultUrl.match(/\/d\/([\w-]+)/) || [])[1];
    if (!id) console.log("\nV-PROBE: could not parse a sheet id from --vault-url");
    else {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, { redirect: "manual" });
      console.log(res.status === 200
        ? "\n*** ALARM: the VAULT answers anonymous requests — it is PUBLISHED/shared. Unshare it NOW. ***"
        : `\nV-PROBE ok: vault refuses anonymous access (HTTP ${res.status})`);
      if (res.status === 200) process.exit(1);
    }
  }
  process.exit(d.dniViolations.length || dirty ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
