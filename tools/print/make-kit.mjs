#!/usr/bin/env node
/* tools/print/make-kit.mjs — S26 K-PRINT (spec §26): generates the lodge
   poster + captain cards printable pages from the published Field + Info
   CSVs. Node ESM, zero deps beyond node builtins + tools/print/qr.mjs.

   Usage:  npm run make-kit   (or: node tools/print/make-kit.mjs)
   Output: tools/print/out/poster.html + tools/print/out/captain-cards.html
   (out/ is gitignored — generated artifacts, never committed).

   VAULT GUARD: if EITHER fetched tab's header row carries an email-like
   column — an exact do_not_invite/reason name, anything containing "email"
   (Email Address, player_email, email_alt, ...), or a real address used AS
   a header — the whole run aborts nonzero, naming the offending header
   verbatim. This tool only ever touches Field + Info, which should never
   carry those columns; if one shows up, something is wrong upstream and
   printing must not proceed.

   STRUCTURAL GUARD: every dynamic (sheet-derived) field is checked for a
   bare "@" BEFORE it's interpolated into markup, naming the specific field
   that's poisoned (assertFieldsNoAt) — a whole-body scan (assertNoAt) runs
   behind it as a failsafe. Together these are the second, wider net — the
   vault guard only looks at header NAMES; this one catches an email-shaped
   string planted in a CELL (e.g. a team name) that the vault guard would
   never see. Either guard tripping is a hard abort, never a silent strip.
   Both are scoped to each page's <body>: the static <head> legitimately
   contains "@" (the CSS `@page` rule, the Google Fonts `wght@400` syntax —
   index.html's own font link carries the identical syntax), so a
   whole-document scan would false-positive on every render.

   YEAR DIVERGENCE: if the Field tab's highest normalized year exceeds the
   season being printed, that's never a hard abort either — it's a live
   roster-vs-print mismatch, surfaced loudly (stderr from main() + a
   visible note on the cards page) so a stale download doesn't quietly
   print the wrong season's captains.

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

/* ---------- VAULT GUARD ----------
   Fix round 1 (m3): exact-name matching missed "Email Address"/"player_email"
   (contain "email" but aren't equal to it) and an actual address used AS a
   header. Adopts presend-check.mjs's own EMAILISH regex verbatim (its
   scanHeaderLine precedent) alongside a substring check for "email", so all
   three shapes trip it. do_not_invite/reason stay exact-match — generic
   English words, substring-matching those would false-positive too easily
   (e.g. a legitimate "handicap_reason" column). */
const EMAILISH = /[^\s@",]+@[^\s@",]+\.[^\s@",]+/;
const BANNED_EXACT = ["do_not_invite", "reason"];
export function vaultGuardHeaders(tabName, rawHeaders) {
  const hits = [];
  rawHeaders.forEach(raw => {
    const h = String(raw || "").trim();
    if (!h) return;
    const norm = h.toLowerCase();
    // m4: name the offending header in its ORIGINAL casing (not the
    // lowercased/normalized form) — "Email Address" reported back as
    // "email address" sends someone hunting the sheet for a column that
    // isn't spelled that way.
    if (norm.includes("email") || EMAILISH.test(h) || BANNED_EXACT.includes(norm)) {
      hits.push(`${tabName}."${h}"`);
    }
  });
  return hits;
}

/* ---------- STRUCTURAL GUARD ----------
   Two layers. assertFieldsNoAt runs FIRST, over the raw dynamic inputs
   before they're interpolated into markup — its error names the SPECIFIC
   field that carries "@" (m4), not just the output filename. It never
   echoes the poisoned value itself into the error message (avoids
   re-leaking the very thing it caught into logs/stderr) — labels are
   positional/structural instead. assertNoAt is the failsafe behind it: a
   whole-string scan of the assembled body, in case some future field gets
   added to the templates without a matching assertFieldsNoAt entry. */
export function assertFieldsNoAt(fields, label) {
  const offenders = fields.filter(([, v]) => String(v ?? "").includes("@")).map(([n]) => n);
  if (offenders.length) {
    throw new Error(`STRUCTURAL GUARD: "@" found in ${offenders.join(", ")} — refusing to write ${label}`);
  }
}
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

/* ---------- year normalization ----------
   Fix round 1 (I2): mirrors index.html's normalizeYears() (lines 4170-4231)
   for the "field" tab specifically — "field" is one of YEAR_DEFAULT_TABS
   (line 4178), so a blank year cell defaults to the CURRENT season (never
   the NEXT-season branch NEXT_SEASON_TABS/"rooms" use). Every non-blank
   cell is parseInt-cleaned the identical way line 4228 does: strip commas,
   then parseInt — parseInt's own truncate-at-"." behavior handles "2026.0"
   for free, so no separate float branch is needed to match the site.
   An unparseable value is left UNCHANGED (never coerced to seasonY),
   mirroring line 4229's "row excluded from year filtering": the raw
   garbage string will never equal String(seasonY), so it naturally drops
   out of rosterMap's season match below without a second code path. */
export function normalizeFieldYear(raw, seasonY) {
  if (!raw || !String(raw).trim()) return String(seasonY);
  const n = parseInt(String(raw).trim().replace(/,/g, ""), 10);
  return isNaN(n) ? String(raw) : String(n);
}
// Task 4 folded-in fix A: the SAME predicate normalizeFieldYear's own isNaN
// branch uses (blank is never "unparseable" — it defaults to seasonY above),
// exported so generateKit() can COUNT unparseable rows without re-deriving
// the parse rule a second time. Closes the silent-empty-page residual: a
// Field tab where every year cell is garbage used to drop every row out of
// rosterMap() with zero visible sign anything was excluded (a genuinely
// empty Field tab and an all-garbage one rendered the identical "No team
// captains found" page).
export function isUnparseableYear(raw) {
  if (!raw || !String(raw).trim()) return false;
  const n = parseInt(String(raw).trim().replace(/,/g, ""), 10);
  return isNaN(n);
}

/* ---------- roster / captain ----------
   Mirrors index.html's rosterMap() (lines 1955-1966) + captainLabel()
   (lines 1985-1989): a team's captain is the Field row whose player name
   normalizes equal to the team name — "player must equal team" is the
   site's own rule (its flag() message at line 1965 reads exactly that).
   Ported textually; a drift here is a defect, not a style choice. Blank
   identity field (player) skip mirrors normalizeYears' identityFields
   check (line 4183/4210-4212, field's own identity field is "player");
   the blank-team exclusion is rosterMap's OWN filter (site line 1957), a
   separate rule from year normalization. */
export function rosterMap(fieldRows, seasonY) {
  const m = new Map();
  fieldRows.forEach(r => {
    if (!r.player || !r.team) return;
    if (normalizeFieldYear(r.year, seasonY) !== String(seasonY)) return;
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
// Fix round 1 (RULED): paper leaves its device — a bare "device-local" clock
// (index.html's own fmtClock semantics, per its comment at line 4244-4246)
// means nothing once a page is printed and handed to someone reading it days
// later on a different machine. Append the IANA short timezone abbreviation
// via Intl (e.g. "MDT") whenever it's available; degrades to no suffix
// (never a fabricated one) if Intl can't resolve it.
function tzAbbrev(d) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d);
    const tz = parts.find(p => p.type === "timeZoneName");
    return (tz && tz.value) || "";
  } catch {
    return "";
  }
}
export function genStamp(now = new Date()) {
  const tz = tzAbbrev(now);
  return `Generated ${fmtDate(now)} ${fmtClock(now)}${tz ? " " + tz : ""}`;
}
// Fix round 1 (I1): the page-level stamp doesn't survive a captain
// pocketing their OWN card, cut apart from the rest of the sheet — every
// card needs its own stamp, and (folded in) the season it was printed for,
// so a card found later can be dated against the right year's roster.
export function cardStamp(now, season) {
  return `${genStamp(now)} · ${season}`;
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

function buildPosterHtml({ datesText, courseText, lodgingText, estYear, stamp }) {
  // STRUCTURAL GUARD, field-level, BEFORE interpolation — see its own
  // comment above assertFieldsNoAt. Labels never echo the poisoned value.
  assertFieldsNoAt([
    ["Info.dates", datesText], ["Info.course", courseText],
    ["Info.lodging", lodgingText], ["Info.est_year", estYear],
  ], "poster.html");
  const body = `<div class="poster">
  <div class="frame-outer"><div class="frame-inner">
    <img class="crest" src="${CREST_REL}" alt="">
    <h1 class="title">THE GOOD FRIENDS YEARLY</h1>
    <p class="sub">McCall, Idaho · Est. ${esc(estYear)}</p>
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
  // STRUCTURAL GUARD, failsafe, scoped to the body: the static <head> this
  // gets wrapped in (POSTER_CSS's `@page` rule, the Google Fonts stylesheet
  // link's `wght@400` variable-axis syntax) legitimately contains "@" and
  // is template-constant — never influenced by sheet data — so guarding
  // the whole document would false-positive on every render. The body
  // above is the ENTIRE surface where CSV-derived text lands.
  assertNoAt(body, "poster.html");
  return htmlDoc("The Good Friends Yearly — Poster", POSTER_CSS, body);
}

/* ---------- captain cards ---------- */
const CARDS_CSS = `@page{size:letter;margin:.4in}
.cards-head{text-align:center;font-family:var(--display);font-size:1rem;letter-spacing:.16em;
  text-transform:uppercase;color:var(--brass);padding:0 0 .08in}
.cards-warn{text-align:center;font-size:.66rem;letter-spacing:.06em;color:var(--rust,#B0705E);
  padding:0 0 .18in}
.cards{display:flex;flex-wrap:wrap;gap:.3in}
.cards-empty{color:var(--sage);font-size:.85rem;padding:.3in}
.card{width:calc(50% - .15in);box-sizing:border-box;border:1px solid rgba(200,162,74,.45);
  background:var(--pine-2);padding:.32in .28in;display:flex;flex-direction:column;
  align-items:center;text-align:center;break-inside:avoid;page-break-inside:avoid}
.card-team{font-family:var(--display);font-weight:700;font-size:1.15rem;letter-spacing:.14em;
  margin:0;color:var(--bone)}
.card-captain{font-family:var(--ui);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;
  color:var(--brass);margin:.1in 0 0}
.card-note{font-size:.72rem;color:var(--sage);margin:.06in 0 0;line-height:1.55}
.card-qr{margin:.22in 0 0}
.card-qr svg{width:1.5in;height:1.5in}
.card-qr-caption{font-size:.6rem;letter-spacing:.26em;text-transform:uppercase;color:var(--brass);margin:.12in 0 0}
.card-foot{font-size:.58rem;letter-spacing:.08em;color:var(--brass-dim);margin:.2in 0 0}
.card-stamp{font-size:.56rem;letter-spacing:.04em;color:var(--brass-dim);margin:.06in 0 0}`;
// m7: the double vertical gap was `.cards{gap:.3in}` (flex row+column gap)
// STACKED with `.card{margin-bottom:.3in}` — flexbox `gap` alone already
// spaces every row and column; the per-card margin was pure duplication.
// Dropped the margin, kept `gap` as the single source of card spacing.

function cardHtml(t, stamp) {
  return `  <div class="card">
    <p class="card-team">TEAM ${esc(String(t.team).toUpperCase())}</p>
    <p class="card-captain">Captain · ${esc(t.captain)}</p>
    <p class="card-note">Scores post to the live board.</p>
    <p class="card-note">No service on the course? It saves and sends later.</p>
    <div class="card-qr">${cardQrSvg(t.team)}</div>
    <p class="card-qr-caption">SCAN TO SCORE</p>
    <p class="card-foot">The Good Friends Yearly · McCall, Idaho</p>
    <p class="card-stamp">${esc(stamp)}</p>
  </div>`;
}

function buildCardsHtml({ teams, now, season, warnings }) {
  // STRUCTURAL GUARD, field-level, BEFORE interpolation — positional labels
  // (never the poisoned team/captain text itself) name which row is bad.
  const fields = [];
  teams.forEach((t, i) => fields.push([`Field team[${i}] "team"`, t.team], [`Field team[${i}] "player" (captain)`, t.captain]));
  assertFieldsNoAt(fields, "captain-cards.html");

  // I1 (fix round 1): a page-level stamp doesn't survive a card being cut
  // apart and pocketed — every card gets its OWN "Generated ... TZ ·
  // <season>" stamp instead. The page header names the season once too
  // (folded per the review), and (I3) carries a visible divergence note
  // when a Field row's year outruns the season being printed.
  const stamp = cardStamp(now, season);
  const inner = teams.length
    ? teams.map(t => cardHtml(t, stamp)).join("\n")
    : `<p class="cards-empty">No team captains found in the ${esc(season)} Field rows.</p>`;
  const warnHtml = warnings.map(w => `<p class="cards-warn">${esc(w)}</p>`).join("\n");
  const body = `<p class="cards-head">CAPTAIN CARDS · ${esc(season)} SEASON</p>
${warnHtml}
<div class="cards">
${inner}
</div>`;
  // STRUCTURAL GUARD, failsafe, scoped to the body — see buildPosterHtml's
  // identical comment; CARDS_CSS's own `@page` rule is the same
  // template-constant exception.
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

  // I3 (fix round 1, RULED): a Field row whose YEAR outruns the season
  // being printed is a live-roster-vs-print mismatch — never a hard abort
  // (the print run must still finish; captains still need cards), but loud
  // on both ends: a warning main() sends to stderr, and a visible note on
  // the cards page itself so anyone printing from a stale download sees it
  // too. Uses the SAME normalizeFieldYear() as rosterMap's own season
  // match (I2) so "divergent" and "matched" can never disagree about what
  // a given year cell means.
  const seasonNum = parseInt(season, 10);
  const fieldYears = field.rows
    .map(r => parseInt(normalizeFieldYear(r.year, season), 10))
    .filter(n => !isNaN(n));
  const maxFieldYear = fieldYears.length ? Math.max(...fieldYears) : null;
  const warnings = [];
  if (maxFieldYear !== null && maxFieldYear > seasonNum) {
    warnings.push(`Field contains rows for ${maxFieldYear} — verify season before printing`);
  }
  // Task 4 folded-in fix A: unparseable-year rows are silently excluded from
  // rosterMap() (I2's own "row excluded from year filtering" comment) — loud
  // on the same two channels I3 already uses (stderr via main()'s warnings
  // loop, and the visible .cards-warn note via buildCardsHtml), so an
  // all-garbage Field tab reads as "excluded, N rows" rather than looking
  // identical to a genuinely empty one.
  const unparseableCount = field.rows.filter(r => isUnparseableYear(r.year)).length;
  if (unparseableCount > 0) {
    warnings.push(`${unparseableCount} Field rows had unparseable years and were excluded`);
  }

  const stamp = genStamp(now);
  const datesText = String(infoMap.dates || "").trim() || "[ 2027 DATES ]";
  const courseText = String(infoMap.course || "").trim() || "[TBD]";
  const lodgingText = String(infoMap.lodging || "").trim() || "[TBD]";
  // m5: Est. year now reads Info.est_year, falling back to the site's own
  // founding year (2019, the literal the poster always showed before this
  // key existed) only when the sheet cell is blank/absent.
  const estYear = String(infoMap.est_year || "").trim() || "2019";

  // buildPosterHtml/buildCardsHtml each run the STRUCTURAL GUARD internally
  // (assertFieldsNoAt + the assertNoAt failsafe), scoped to the
  // data-carrying body before the static <head>/CSS chrome gets wrapped
  // around it — see their own comments.
  const poster = buildPosterHtml({ datesText, courseText, lodgingText, estYear, stamp });
  const cards = buildCardsHtml({ teams, now, season, warnings });

  return { poster, cards, teamCount: teams.length, season, warnings };
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

  // I3: LOUD stderr, never an abort — console.error/warn both write to
  // stderr in node, so this surfaces distinctly from the stdout summary
  // line below without stopping the run (the cards page itself also carries
  // this note — see buildCardsHtml).
  kit.warnings.forEach(w => console.error(`make-kit: WARNING — ${w}`));

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
