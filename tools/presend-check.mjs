#!/usr/bin/env node
/* GFY pre-send checker — spec §13 V-MATCH/V-PATH/V-PROBE.
   Usage:  npm run presend -- <vault-contacts.csv> [--vault-url <admin sheet url>]
   Output: stdout ONLY. This output can contain real addresses — never redirect
   it to a file, paste it into an issue/PR, or commit it anywhere. */
import fs, { readFileSync, realpathSync } from "node:fs";
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
  // De-dup header mapping (IMPORTANT-6): an empty header becomes `col_<index>`
  // and a repeated header name becomes `<name>_<index>` — otherwise
  // Object.fromEntries silently collapses every duplicate/blank column down
  // to one key and only the LAST one's value survives, hiding data planted
  // in an earlier unnamed/duplicate column (e.g. `player,email,,,`).
  const seen = new Map();
  const headers = head.map((h, i) => {
    const raw = String(h).trim().toLowerCase();
    if (!raw) return `col_${i}`;
    const n = (seen.get(raw) || 0) + 1;
    seen.set(raw, n);
    return n === 1 ? raw : `${raw}_${i}`;
  });
  return rest.map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// Try the real (symlink/case-resolved) path; fall back to a plain resolve
// when the path doesn't exist yet (realpath requires every component to
// exist, but insideRepo must still work for a not-yet-created path).
function realOrResolved(p){
  try { return fs.realpathSync.native(p); }
  catch (e) { if (e && e.code === "ENOENT") return path.resolve(p); throw e; }
}

export function insideRepo(vaultPath, repoRoot = REPO){
  let p = realOrResolved(path.resolve(vaultPath));
  let root = realOrResolved(path.resolve(repoRoot));
  // IMPORTANT-3: a symlink can point in-repo from an out-of-repo path, and
  // APFS is case-insensitive-but-preserving by default — so on darwin/win32
  // compare case-folded to catch a Vault.csv vs vault.csv escape.
  if (process.platform === "darwin" || process.platform === "win32"){
    p = p.toLowerCase();
    root = root.toLowerCase();
  }
  return p === root || p.startsWith(root + path.sep);
}

const norm = s => String(s || "").trim().toLowerCase();
const yes = s => /^(true|yes|1|x|✓)$/i.test(String(s || "").trim());

// DNI three-state semantics (spec §13 V-MATCH): the site suppresses a
// do-not-invite person from its "needs an invite" funnel ONLY via an
// Invites-NEXT row with status out/declined. So:
//   VIOLATION — a DNI name whose Invites-NEXT row has invited/responded
//     ticked, OR whose status is anything other than out/declined. The site
//     is either actively courting them or hasn't suppressed them.
//   UNPAIRED (warn) — a DNI name with NO Invites-NEXT row at all. This is
//     the dangerous silent state: the site's funnel then counts them as
//     needing an invite, with nothing on the health strip to say otherwise.
//   silent/OK — a DNI name paired with an out/declined row. Correct state.
export function diffVault(contacts, invites){
  const nextYear = Math.max(0, ...invites.map(r => parseInt(r.year, 10) || 0));
  const inv = invites.filter(r => (parseInt(r.year, 10) || 0) === nextYear);
  const invByName = new Map(inv.map(r => [norm(r.player), r]));
  const invNames = new Set(invByName.keys());
  const vaultNames = new Set(contacts.map(c => norm(c.player)).filter(Boolean));
  const dniContacts = contacts.filter(c => c.player && yes(c.do_not_invite));
  return {
    nextYear,
    neverInvited: contacts.filter(c => c.player && !yes(c.do_not_invite) && !invNames.has(norm(c.player))),
    missingFromVault: [...invNames].filter(n => !vaultNames.has(n)).map(n => inv.find(r => norm(r.player) === n).player),
    dniViolations: dniContacts.filter(c => {
      const row = invByName.get(norm(c.player));
      if (!row) return false; // no row at all -> unpaired, not a violation
      if (yes(row.invited) || yes(row.responded)) return true;
      const status = norm(row.status);
      return status !== "out" && status !== "declined";
    }),
    dniUnpaired: dniContacts.filter(c => !invByName.has(norm(c.player))),
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

// MINOR-7: a tab with zero data rows never reaches scanForEmails at all, so
// an email-like string planted in the HEADER ROW ITSELF (a stray "@" typo, a
// leaked address used as a column name) would never be caught. Scan the raw
// first line of the CSV text before any parsing happens. Exported as a tiny
// pure function so it's independently testable without a network call.
export function scanHeaderLine(tabName, text){
  const firstLine = String(text).split(/\r\n|\r|\n/)[0] || "";
  return EMAILISH.test(firstLine) ? [`${tabName} HEADER contains email-like text`] : [];
}

// CRITICAL-2: a fetch that 400s (or otherwise fails) but still returns a body
// that happens to parse as CSV-shaped rows must never be treated as data.
// Check res.ok AND that the content-type is actually text/csv; throw with the
// status either way so callers can distinguish "no data" from "empty tab".
async function fetchCsv(url){
  const res = await fetch(url);
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !ct.includes("text/csv")) throw new Error(String(res.status));
  return res.text();
}

async function main(){
  const args = process.argv.slice(2).filter(a => a !== "--");

  // IMPORTANT-4: --vault-url present with a missing/flag-shaped value must
  // fail loudly before any other work, not silently skip the V-PROBE.
  const urlIx = args.indexOf("--vault-url");
  let vaultUrl = null;
  if (urlIx >= 0){
    const val = args[urlIx + 1];
    if (!val || val.startsWith("-")){
      console.log("ERROR: --vault-url requires a URL");
      process.exitCode = 2;
      return;
    }
    vaultUrl = args.splice(urlIx, 2)[1];
  }

  const vaultFile = args[0];
  if (!vaultFile){ console.log("usage: npm run presend -- <vault-contacts.csv> [--vault-url <url>]"); process.exitCode = 2; return; }
  if (insideRepo(vaultFile)){
    console.log("REFUSED: " + vaultFile + " is inside the public repo working tree.");
    console.log("A stray `git add` would publish every address. Download the vault export somewhere else (e.g. ~/Downloads) and re-run.");
    process.exitCode = 1;
    return;
  }
  const raw = readFileSync(vaultFile);
  if (raw[0] === 0x50 && raw[1] === 0x4b){ // xlsx = zip magic "PK"
    console.log("That's an .xlsx. In the Admin sheet: open the Contacts tab → File → Download → Comma-separated values, then re-run with that .csv.");
    process.exitCode = 1;
    return;
  }
  const contacts = parseCsv(raw.toString("utf8"));
  if (!contacts.length || !("player" in contacts[0]) || !("email" in contacts[0])){
    console.log("This CSV doesn't look like the Contacts tab (need player + email columns).");
    process.exitCode = 1;
    return;
  }
  const cfg = readFileSync(path.join(REPO, "config.js"), "utf8");
  // MINOR-9 (+ same defect on PUB_ID, found live): config.js's own comments
  // show a worked "Example: PUB_ID: ..." / "Example: GID: { ... }" line
  // BEFORE the real assignment. A naive match() grabs the FIRST occurrence —
  // i.e. the comment's example token/gids, not the real ones. Strip //
  // line-comments before extracting anything, then scope the gid-pair regex
  // to just the GID:{...} block so it can't pick up a stray pair from a
  // different comment either.
  const cfgCode = cfg.replace(/\/\/[^\n]*/g, "");
  const pub = (cfgCode.match(/PUB_ID:\s*"([^"]+)"/) || [])[1];
  const gidBlock = (cfgCode.match(/GID:\s*\{[^}]*\}/) || [])[0] || "";
  const gids = {}; [...gidBlock.matchAll(/(\w+):\s*"(\d+)"/g)].forEach(m => gids[m[1]] = m[2]);
  if (!pub || !gids.invites){ console.log("config.js has no PUB_ID / invites gid — is the sheet wired?"); process.exitCode = 1; return; }
  const csvUrl = g => `https://docs.google.com/spreadsheets/d/e/${pub}/pub?gid=${g}&single=true&output=csv`;

  // CRITICAL-2: the Invites fetch is load-bearing for the whole diff — if it
  // fails, refuse to print anything that LOOKS like a diff (an empty section
  // reads as "nothing to report", which is a lie, not a null result).
  let invitesText;
  try {
    invitesText = await fetchCsv(csvUrl(gids.invites));
  } catch (e) {
    console.log(`cannot verify — Invites tab fetch failed (HTTP ${e.message})`);
    process.exitCode = 2;
    return;
  }
  const invites = parseCsv(invitesText);

  const d = diffVault(contacts, invites);
  console.log(`\n== GFY pre-send check (next season detected: ${d.nextYear || "?"}) ==`);
  console.log(`\nDO-NOT-INVITE VIOLATIONS (${d.dniViolations.length}):` +
    (d.dniViolations.length ? "\n  " + d.dniViolations.map(c => `${c.player} — ${c.reason || "no reason recorded"}`).join("\n  ") : " none"));
  if (d.dniViolations.length) console.log("  → fix: set their Invites status to `out` (and untick invited/responded), or drop them from this send.");
  console.log(`\nUNPAIRED DO-NOT-INVITE (${d.dniUnpaired.length}):` +
    (d.dniUnpaired.length
      ? "\n  " + d.dniUnpaired.map(c => `${c.player} — unpaired do-not-invite — add an Invites row with status \`out\` so the site suppresses them`).join("\n  ")
      : " none"));
  console.log(`\nIn the vault, not yet on the Invites tab (${d.neverInvited.length}):` +
    (d.neverInvited.length ? "\n  " + d.neverInvited.map(c => `${c.player} <${c.email}>`).join("\n  ") : " none"));
  console.log(`\nOn the Invites tab, MISSING from the vault (${d.missingFromVault.length}):` +
    (d.missingFromVault.length ? "\n  " + d.missingFromVault.join("\n  ") : " none"));

  console.log("\n== published-content watchdog ==");
  let dirty = 0;
  let skipped = 0;
  for (const [tab, gid] of Object.entries(gids)){
    if (!gid || tab === "PUB_ID") continue;
    try {
      const text = await fetchCsv(csvUrl(gid));
      const headerHits = scanHeaderLine(tab, text);
      headerHits.forEach(h => console.log("  " + h));
      dirty += headerHits.length;
      const rows = parseCsv(text);
      const hits = scanForEmails(tab, rows);
      dirty += hits.length;
      hits.forEach(h => console.log("  EMAIL-LIKE VALUE PUBLISHED: " + h));
    } catch {
      skipped++;
      console.log("  (could not fetch tab " + tab + " — check skipped, NOT clean)");
    }
  }
  if (!dirty && !skipped) console.log("  clean — no email-like content in any published tab");
  // CRITICAL-2 (watchdog half): an unverified tab is not a clean tab. Count
  // it and force the final verdict + exit code to reflect "not proven clean"
  // rather than silently rolling it into an otherwise-clean summary.
  if (skipped > 0) console.log(`  ${skipped} tab(s) UNVERIFIED — not clean`);

  // CRITICAL-1 — V-PROBE. The old `redirect:"manual"` check was a proven
  // false negative: a published (leaking) vault answers the FIRST hop with a
  // 307/302 redirect toward the actual CSV, not a 200 — so the manual-mode
  // check never fired even when the vault was wide open. Follow redirects
  // and judge the FINAL response. 401/403 = the vault correctly refused an
  // anonymous request. Anything else (a 404, a 5xx, a network throw) proves
  // NOTHING either way, so it must not be reported as a pass.
  let vProbeFailed = false;
  if (vaultUrl){
    const id = (vaultUrl.match(/\/d\/([\w-]+)/) || [])[1];
    if (!id) { console.log("\nV-PROBE: could not parse a sheet id from --vault-url — NOT proven safe"); vProbeFailed = true; }
    else {
      try {
        const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, { redirect: "follow" });
        if (res.status === 200){
          console.log("\n*** ALARM: the VAULT answers anonymous requests — it is PUBLISHED/shared. Unshare it NOW. ***");
          vProbeFailed = true;
        } else if (res.status === 401 || res.status === 403){
          console.log(`\nV-PROBE ok: vault refuses anonymous access (HTTP ${res.status})`);
        } else {
          console.log(`\nV-PROBE INCONCLUSIVE (HTTP ${res.status}) — NOT proven safe`);
          vProbeFailed = true;
        }
      } catch (e) {
        console.log(`\nV-PROBE INCONCLUSIVE (${e && e.message ? e.message : "network error"}) — NOT proven safe`);
        vProbeFailed = true;
      }
    }
  }

  process.exitCode = (d.dniViolations.length || d.dniUnpaired.length || dirty || skipped || vProbeFailed) ? 1 : 0;
}

// MINOR-8: a symlinked invocation (e.g. a shim in $PATH pointing at this
// file) makes `process.argv[1]` differ textually from `import.meta.url`
// even though they're the same file, so the CLI guard silently no-ops.
// Realpath both sides before comparing.
function realpathOrSelf(p){ try { return realpathSync(p); } catch { return p; } }
const invokedReal = process.argv[1] ? realpathOrSelf(process.argv[1]) : null;
const selfReal = realpathOrSelf(fileURLToPath(import.meta.url));
if (invokedReal && pathToFileURL(invokedReal).href === pathToFileURL(selfReal).href) main();
