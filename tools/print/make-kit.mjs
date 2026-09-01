#!/usr/bin/env node
/* tools/print/make-kit.mjs — S26 K-PRINT (spec §26): generates the lodge
   poster + captain cards printable pages from the published Field + Info
   CSVs. Node ESM, zero deps beyond node builtins + tools/print/qr.mjs.

   Usage:  npm run make-kit   (or: node tools/print/make-kit.mjs)
   Output: tools/print/out/poster.html + tools/print/out/captain-cards.html
   (out/ is gitignored — generated artifacts, never committed).

   VAULT GUARD: if EITHER fetched tab's header row carries an email-like
   column name (email, email_alt, do_not_invite, reason) the whole run
   aborts nonzero, naming the offending header(s) — this tool only ever
   touches Field + Info, which should never carry those columns; if one
   shows up, something is wrong upstream and printing must not proceed.

   STRUCTURAL GUARD: the fully-rendered HTML for each page is scanned for a
   bare "@" before anything is written to disk. This is the second, wider
   net — the vault guard only looks at header NAMES; this one catches an
   email-shaped string planted in a CELL (e.g. a team name) that the vault
   guard would never see. Either guard tripping is a hard abort, never a
   silent strip — see assertNoAt() below.

   Anonymous-fetch discipline (mirrors presend-check.mjs's fetchCsv /
   index.html's pull()): a 401/403, a redirect to a Google login page, or an
   HTML body where CSV was expected are all loud aborts, never treated as
   "empty tab".

   Generator core (generateKit) is a PURE function over injected CSV text —
   see tools/print/make-kit.test.mjs — so every rule above is network-free
   testable. main() is the only network/filesystem-touching part; keep it
   that way so the tests never need a live fetch. */

import { qrSvg } from "./qr.mjs";
import { readFileSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const OUT_DIR = path.join(REPO, "tools", "print", "out");

export const SITE_ROOT = "https://killerroyboy.github.io/gfy/";

// spec §26 says the crest reference is "../../assets/gfy-crest.svg" (2 ups),
// but tools/print/out/ is THREE levels below the repo root (out -> print ->
// tools -> repo root) — a literal 2-up path would 404 the crest when the
// poster/cards are opened from tools/print/out/. Computed here instead of
// hardcoded so it stays correct if the output location ever moves; verified
// today: out -> print -> tools -> repo root -> assets/gfy-crest.svg.
const CREST_REL = path.relative(OUT_DIR, path.join(REPO, "assets", "gfy-crest.svg")).split(path.sep).join("/");

/* ---------- config.js textual parse ----------
   Mirrors tools/gid-check.mjs's readConfig (which itself is shared with
   presend-check.mjs) — re-implemented locally rather than imported, to keep
   this tool's dependency surface at node builtins + qr.mjs only. */
export function readConfig(cfgText) {
  const cfgCode = String(cfgText).replace(/\/\/[^\n]*/g, "");
  const pub = (cfgCode.match(/PUB_ID:\s*"([^"]+)"/) || [])[1];
  const gidBlock = (cfgCode.match(/GID:\s*\{[^}]*\}/) || [])[0] || "";
  const gids = {};
  [...gidBlock.matchAll(/(\w+):\s*"(\d+)"/g)].forEach(m => gids[m[1]] = m[2]);
  return { pub, gids };
}

/* ---------- CSV parsing ----------
   Mirrors presend-check.mjs's parseCsv (same quoted-field state machine,
   same IMPORTANT-6 dedup-header discipline: a blank header becomes col_N,
   a repeated header becomes name_N so a planted duplicate/blank column can
   never silently collapse into another column's value). Returns the RAW
   header row (pre-dedup, lowercased/trimmed) alongside the row objects —
   the vault guard checks the raw headers so a dedup rename can't dodge it. */
export function parseCsv(text) {
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (cell !== "" || row.length) { row.push(cell); out.push(row); row = []; cell = ""; } }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  const [head, ...rest] = out;
  if (!head) return { rawHeaders: [], headers: [], rows: [] };
  const rawHeaders = head.map(h => String(h).trim().toLowerCase());
  const seen = new Map();
  const headers = rawHeaders.map((raw, i) => {
    if (!raw) return `col_${i}`;
    const n = (seen.get(raw) || 0) + 1;
    seen.set(raw, n);
    return n === 1 ? raw : `${raw}_${i}`;
  });
  const rows = rest.map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { rawHeaders, headers, rows };
}

/* ---------- VAULT GUARD ---------- */
const BANNED_HEADERS = ["email", "email_alt", "do_not_invite", "reason"];
export function vaultGuardHeaders(tabName, rawHeaders) {
  const norm = h => String(h || "").trim().toLowerCase();
  return rawHeaders.map(norm).filter(h => BANNED_HEADERS.includes(h)).map(h => `${tabName}."${h}"`);
}

/* ---------- STRUCTURAL GUARD ---------- */
export function assertNoAt(html, label) {
  if (String(html).includes("@")) {
    throw new Error(`STRUCTURAL GUARD: "@" survived in ${label} — refusing to write it`);
  }
  return html;
}

const nkey = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- season ----------
   Mirrors index.html's activeSeason() (lines 1905-1918):
     const t=new Date(INFO.first_tee||CONFIG.FIRST_TEE);
     const teeYear=isNaN(t.getTime())?null:t.getFullYear();
     const ceiling=teeYear===null?Infinity:teeYear+1;
     const ysAll=(STATE.data.scores||[]).map(r=>parseInt(r.year,10)).filter(n=>n>0);
     const ys=ysAll.filter(n=>n<=ceiling);
     ...
     if(ys.length) return String(Math.max(...ys));
     return String(teeYear===null?new Date().getFullYear():teeYear);
   This tool never fetches the Scores tab (spec §26 wires Field + Info
   only), so ysAll/ys are always the empty array here — `ys.length` is
   always falsy, so this is always the fallback branch (teeYear, or the
   calendar year when first_tee itself doesn't parse), ported byte-for-byte.
   The Scores-driven branch above it cannot fire without Scores data to
   drive it, so it is intentionally not reproduced. */
export function currentSeason(infoMap, now = new Date()) {
  const t = new Date(infoMap.first_tee || "");
  const teeYear = isNaN(t.getTime()) ? null : t.getFullYear();
  return String(teeYear === null ? now.getFullYear() : teeYear);
}

/* ---------- roster / captain ----------
   Mirrors index.html's rosterMap() (lines 1955-1966) + captainLabel()
   (lines 1985-1989): a team's captain is the Field row whose player name
   normalizes equal to the team name — "player must equal team" is the
   site's own rule (its flag() message at line 1965 reads exactly that).
   Ported textually; a drift here is a defect, not a style choice. */
export function rosterMap(fieldRows, seasonY) {
  const m = new Map();
  fieldRows.filter(r => r.player && r.team && r.year === seasonY).forEach(r => {
    const k = nkey(r.team);
    if (!m.has(k)) m.set(k, { team: r.team, captain: null, members: [] });
    const t = m.get(k);
    if (nkey(r.player) === k) { t.captain = r.player; t.team = r.team; } // captain row's own spelling wins for display
    else t.members.push(r.player);
  });
  return m;
}

/* ---------- generation stamp ----------
   Mirrors index.html's fmtClock (line 4242-4243): 12-hour, no leading zero,
   am/pm suffix — the site's one and only "h:mm" vocabulary, reused here
   rather than inventing a second clock format. */
function fmtClock(d) {
  const h = d.getHours() % 12 || 12;
  return h + ":" + String(d.getMinutes()).padStart(2, "0") + (d.getHours() < 12 ? "am" : "pm");
}
function fmtDate(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function genStamp(now = new Date()) {
  return `Generated ${fmtDate(now)} ${fmtClock(now)}`;
}

/* ---------- score URL ----------
   RULED (K-QR interface note): percent-encode the team name at THIS call
   boundary — qr.mjs's vendored encoder is Latin-1 (stringToBytes), so the
   text handed to qrSvg must already be ASCII-safe. encodeURIComponent does
   that AND gives scorerTeamFromHash (index.html:1934-1947) exactly the
   %XX-escaped hash it expects to decodeURIComponent back off location.hash. */
export function scoreUrlFor(teamName) {
  return `${SITE_ROOT}#score?team=${encodeURIComponent(teamName)}`;
}

// Exported so tests can assert the exact SVG each page embeds (byte-for-byte
// via the qr module, per the K-QR test file's own precedent) without
// duplicating — and risking drift on — the moduleSize/margin options below.
export function posterQrSvg() {
  return qrSvg(SITE_ROOT, { moduleSize: 6, margin: 3 });
}
export function cardQrSvg(teamName) {
  return qrSvg(scoreUrlFor(teamName), { moduleSize: 5, margin: 3 });
}

/* ---------- shared page chrome ---------- */
const FONTS_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500;6..96,700&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">`;

const TOKENS_CSS = `:root{
  --pine:#0E2019; --pine-2:#132B21; --pine-3:#0A1712;
  --bone:#E9E3D3; --sage:#8A9B8C; --brass:#C8A24A; --brass-dim:#6F5A26;
  --display:"Bodoni Moda", Didot, Georgia, serif;
  --ui:"Jost", Futura, "Helvetica Neue", Arial, sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--pine-3);color:var(--bone);font-family:var(--ui);
  -webkit-print-color-adjust:exact;print-color-adjust:exact}`;

function htmlDoc(title, css, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${FONTS_LINK}
<style>
${TOKENS_CSS}
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/* ---------- poster ---------- */
const POSTER_CSS = `@page{size:letter;margin:0}
.poster{width:8.5in;height:11in;margin:0 auto;padding:.55in;position:relative;
  display:flex;flex-direction:column}
.frame-outer{flex:1;border:1px solid rgba(200,162,74,.55);padding:.22in;display:flex}
.frame-inner{flex:1;border:1px solid rgba(200,162,74,.25);padding:.55in .4in;
  display:flex;flex-direction:column;align-items:center;text-align:center}
.crest{width:1.15in;height:auto;color:var(--brass);margin-bottom:.3in}
.title{font-family:var(--display);font-weight:700;font-size:2.05rem;
  letter-spacing:.3em;text-indent:.3em;margin:0;color:var(--bone)}
.sub{font-family:var(--ui);font-size:.85rem;letter-spacing:.22em;text-transform:uppercase;
  color:var(--brass);margin:.2in 0 0}
.hairline{width:60px;height:1px;background:var(--brass-dim);margin:.4in auto;border:0}
.dates{font-family:var(--display);font-size:1.65rem;color:var(--bone);margin:0}
.venue{font-family:var(--ui);font-size:.95rem;letter-spacing:.06em;color:var(--sage);margin:.14in 0 0}
.qr-block{margin:.5in 0;display:flex;flex-direction:column;align-items:center}
.qr-block svg{width:1.9in;height:1.9in}
.qr-caption{font-size:.65rem;letter-spacing:.28em;text-transform:uppercase;color:var(--brass);margin:.16in 0 0}
.conditions{margin-top:auto;font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--sage)}
.stamp{position:absolute;bottom:.28in;right:.45in;font-size:.6rem;letter-spacing:.08em;color:var(--brass-dim)}`;

function buildPosterHtml({ datesText, courseText, lodgingText, stamp }) {
  const body = `<div class="poster">
  <div class="frame-outer"><div class="frame-inner">
    <img class="crest" src="${CREST_REL}" alt="">
    <h1 class="title">THE GOOD FRIENDS YEARLY</h1>
    <p class="sub">McCall, Idaho · Est. 2019</p>
    <hr class="hairline">
    <p class="dates">${esc(datesText)}</p>
    <p class="venue">${esc(courseText)} · ${esc(lodgingText)}</p>
    <div class="qr-block">
      ${posterQrSvg()}
      <p class="qr-caption">FOLLOW THE FIELD · LIVE SCORING</p>
    </div>
    <p class="conditions">CONDITIONS OF COMPETITION POSTED AT THE FIRST TEE</p>
  </div></div>
  <p class="stamp">${esc(stamp)}</p>
</div>`;
  // STRUCTURAL GUARD, scoped to the body: the static <head> this gets
  // wrapped in (POSTER_CSS's `@page` rule, the Google Fonts stylesheet
  // link's `wght@400` variable-axis syntax) legitimately contains "@" and
  // is template-constant — never influenced by sheet data — so guarding
  // the whole document would false-positive on every render. The body
  // above is the ENTIRE surface where CSV-derived text lands.
  assertNoAt(body, "poster.html");
  return htmlDoc("The Good Friends Yearly — Poster", POSTER_CSS, body);
}

/* ---------- captain cards ---------- */
const CARDS_CSS = `@page{size:letter;margin:.4in}
.stamp{text-align:center;font-size:.6rem;letter-spacing:.08em;color:var(--brass-dim);padding:0 0 .2in}
.cards{display:flex;flex-wrap:wrap;gap:.3in}
.cards-empty{color:var(--sage);font-size:.85rem;padding:.3in}
.card{width:calc(50% - .15in);box-sizing:border-box;border:1px solid rgba(200,162,74,.45);
  background:var(--pine-2);padding:.32in .28in;display:flex;flex-direction:column;
  align-items:center;text-align:center;break-inside:avoid;page-break-inside:avoid;margin-bottom:.3in}
.card-team{font-family:var(--display);font-weight:700;font-size:1.15rem;letter-spacing:.14em;
  margin:0;color:var(--bone)}
.card-captain{font-family:var(--ui);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;
  color:var(--brass);margin:.1in 0 0}
.card-note{font-size:.72rem;color:var(--sage);margin:.06in 0 0;line-height:1.55}
.card-qr{margin:.22in 0 0}
.card-qr svg{width:1.5in;height:1.5in}
.card-qr-caption{font-size:.6rem;letter-spacing:.26em;text-transform:uppercase;color:var(--brass);margin:.12in 0 0}
.card-foot{font-size:.58rem;letter-spacing:.08em;color:var(--brass-dim);margin:.2in 0 0}`;

function cardHtml(t) {
  return `  <div class="card">
    <p class="card-team">TEAM ${esc(String(t.team).toUpperCase())}</p>
    <p class="card-captain">Captain · ${esc(t.captain)}</p>
    <p class="card-note">Scores post to the live board.</p>
    <p class="card-note">No service on the course? It saves and sends later.</p>
    <div class="card-qr">${cardQrSvg(t.team)}</div>
    <p class="card-qr-caption">SCAN TO SCORE</p>
    <p class="card-foot">The Good Friends Yearly · McCall, Idaho</p>
  </div>`;
}

function buildCardsHtml({ teams, stamp, season }) {
  const inner = teams.length
    ? teams.map(cardHtml).join("\n")
    : `<p class="cards-empty">No team captains found in the ${esc(season)} Field rows.</p>`;
  const body = `<p class="stamp">${esc(stamp)}</p>
<div class="cards">
${inner}
</div>`;
  // STRUCTURAL GUARD, scoped to the body — see buildPosterHtml's identical
  // comment; CARDS_CSS's own `@page` rule is the same template-constant
  // exception.
  assertNoAt(body, "captain-cards.html");
  return htmlDoc("The Good Friends Yearly — Captain Cards", CARDS_CSS, body);
}

/* ---------- pure generator core ----------
   Everything above this point is pure/synchronous. This is the single seam
   tools/print/make-kit.test.mjs drives with injected fixture text — no
   network, no filesystem. main() below is the only caller that touches
   either. */
export function generateKit({ fieldCsv, infoCsv, now = new Date() }) {
  const field = parseCsv(fieldCsv);
  const info = parseCsv(infoCsv);

  const guardHits = [
    ...vaultGuardHeaders("Field", field.rawHeaders),
    ...vaultGuardHeaders("Info", info.rawHeaders),
  ];
  if (guardHits.length) {
    throw new Error(`VAULT GUARD: refusing to generate — email-like column(s) found: ${guardHits.join(", ")}`);
  }

  const infoMap = {};
  info.rows.forEach(r => { if (r.key) infoMap[String(r.key).trim().toLowerCase()] = r.value || ""; });

  const season = currentSeason(infoMap, now);
  const roster = rosterMap(field.rows, season);
  const teams = [...roster.values()]
    .filter(t => t.captain)
    .sort((a, b) => a.team.localeCompare(b.team));

  const stamp = genStamp(now);
  const datesText = String(infoMap.dates || "").trim() || "[ 2027 DATES ]";
  const courseText = String(infoMap.course || "").trim() || "[TBD]";
  const lodgingText = String(infoMap.lodging || "").trim() || "[TBD]";

  // buildPosterHtml/buildCardsHtml each run the STRUCTURAL GUARD internally
  // (assertNoAt), scoped to the data-carrying body before the static
  // <head>/CSS chrome gets wrapped around it — see their own comments.
  const poster = buildPosterHtml({ datesText, courseText, lodgingText, stamp });
  const cards = buildCardsHtml({ teams, stamp, season });

  return { poster, cards, teamCount: teams.length, season };
}

/* ---------- network / filesystem shell (not covered by pure tests) ---------- */
// CRITICAL: an unpublished/login-gated tab must never be silently treated as
// an empty tab. 401/403 abort by status; a redirect that lands on Google's
// own login host aborts by destination; and — since Google Sheets often
// answers an unpublished pubhtml/pub request with a 200 HTML page rather
// than a redirect — an HTML-shaped body where CSV was expected aborts too
// (same check index.html's pull() and presend-check.mjs's fetchCsv both use).
async function fetchCsv(tabLabel, url) {
  const res = await fetch(url, { redirect: "follow" });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${tabLabel} tab: HTTP ${res.status} — anonymous fetch was refused; aborting rather than treat this as empty`);
  }
  if (res.redirected && /accounts\.google\.com/i.test(res.url)) {
    throw new Error(`${tabLabel} tab: redirected to a Google login page (${res.url}) — the tab is not published anonymously; aborting`);
  }
  if (!res.ok) {
    throw new Error(`${tabLabel} tab: HTTP ${res.status}`);
  }
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(`${tabLabel} tab: HTML response instead of CSV — wrong PUB_ID, not published, or a login page landed as 200; aborting`);
  }
  return text;
}

async function main() {
  const cfgText = readFileSync(path.join(REPO, "config.js"), "utf8");
  const { pub, gids } = readConfig(cfgText);
  if (!pub || !gids.field || !gids.info) {
    console.log("make-kit: config.js has no PUB_ID / field / info gid — is the sheet wired?");
    process.exitCode = 2;
    return;
  }
  const csvUrl = g => `https://docs.google.com/spreadsheets/d/e/${pub}/pub?gid=${g}&single=true&output=csv`;

  let fieldCsv, infoCsv;
  try {
    fieldCsv = await fetchCsv("Field", csvUrl(gids.field));
    infoCsv = await fetchCsv("Info", csvUrl(gids.info));
  } catch (e) {
    console.log(`make-kit: ${e.message} — nothing written`);
    process.exitCode = 1;
    return;
  }

  let kit;
  try {
    kit = generateKit({ fieldCsv, infoCsv, now: new Date() });
  } catch (e) {
    console.log(`make-kit: ${e.message} — nothing written`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "poster.html"), kit.poster, "utf8");
  writeFileSync(path.join(OUT_DIR, "captain-cards.html"), kit.cards, "utf8");
  console.log(`make-kit: wrote poster.html + captain-cards.html (season ${kit.season}, ${kit.teamCount} captain card(s)) to tools/print/out/`);
}

// Import-safe CLI guard — gid-check.mjs's MINOR-8 realpath pattern verbatim,
// so tools/print/make-kit.test.mjs can import the pure exports above without
// firing a live network call.
function realpathOrSelf(p) { try { return realpathSync(p); } catch { return p; } }
const invokedReal = process.argv[1] ? realpathOrSelf(process.argv[1]) : null;
const selfReal = realpathOrSelf(fileURLToPath(import.meta.url));
if (invokedReal && pathToFileURL(invokedReal).href === pathToFileURL(selfReal).href)
  main().catch(e => { console.log("make-kit failed: " + (e && e.message ? e.message : e) + " — nothing written"); process.exitCode = 1; });
