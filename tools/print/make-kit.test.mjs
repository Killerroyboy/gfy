// tools/print/make-kit.test.mjs — standalone test for the S26 K-PRINT
// generator (tools/print/make-kit.mjs). Run directly:
//   node tools/print/make-kit.test.mjs
// Nonzero exit on any FAIL. Also gated by test/smoke.mjs's S26-T3a check
// (file-presence + exported-surface assertion, mirroring S26-T2a's
// precedent for qr.test.mjs — smoke.mjs never shells out to child tool
// tests, this file is the one that actually runs the make-kit logic).
//
// Every check below drives make-kit.mjs's PURE exports (generateKit and the
// smaller functions it's built from) with hand-built fixture CSV text — no
// network, no filesystem write. That split (pure generator core vs. the
// fetch/write shell in main()) is what makes the vault guard and structural
// guard testable at all without standing up a fake Google Sheets endpoint.
import {
  parseCsv, vaultGuardHeaders, assertNoAt, currentSeason, rosterMap,
  genStamp, scoreUrlFor, posterQrSvg, cardQrSvg, generateKit, SITE_ROOT,
} from "./make-kit.mjs";

const results = [];
function check(name, ok, detail = "") {
  results.push([name, ok]);
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : "   [" + detail + "]"));
}

/* ---------- shared fixtures ---------- */
const FIELD_CSV = `year,player,team,since
2026,Wade Johnson,Wade Johnson,2022
2026,Sully,Wade Johnson,2021
2026,Duck,Duck,2019
2026,Hammer,Duck,2019
2027,Ghost,,`;

const INFO_CSV = `key,value
dates,Aug 14–16
course,Meadow Creek
lodging,Bear Creek Lodge
first_tee,2026-08-15T09:00:00-06:00`;

const NOW = new Date("2026-09-01T14:32:00-06:00");

/* ---------- (a) VAULT GUARD: header-named-column fires, names the header ---------- */
{
  // Unit test the guard FUNCTION directly with injected fixtures first.
  const cleanHeaders = ["year", "player", "team", "since"];
  const poisonedHeaders = ["year", "player", "team", "email"];
  const cleanHits = vaultGuardHeaders("field", cleanHeaders);
  const poisonedHits = vaultGuardHeaders("field", poisonedHeaders);

  // Then prove the pure generator core actually refuses to run end-to-end
  // when a fetched tab's header row looks like this (a live main() would
  // exit nonzero from this same thrown Error — see make-kit.mjs's main()).
  const poisonedFieldCsv = `year,player,team,email\n2026,Duck,Duck,duck@example.com\n`;
  let threw = null;
  try { generateKit({ fieldCsv: poisonedFieldCsv, infoCsv: INFO_CSV, now: NOW }); }
  catch (e) { threw = e; }

  check("S26-T3a: VAULT GUARD — clean header row (year/player/team/since) produces zero hits; a header row carrying \"email\" produces exactly one hit naming field.\"email\"; generateKit() THROWS (⇒ main() exits nonzero) end-to-end on a fixture CSV with an email header, and the thrown message names the offending header",
    cleanHits.length === 0
    && poisonedHits.length === 1 && poisonedHits[0] === 'field."email"'
    && threw !== null && /email/.test(threw.message) && /VAULT GUARD/.test(threw.message),
    "cleanHits=" + JSON.stringify(cleanHits) + " poisonedHits=" + JSON.stringify(poisonedHits) + " threw=" + (threw && threw.message));
}

/* ---------- (b) blank/absent dates -> literal placeholder ---------- */
{
  const blankDatesInfo = `key,value\ndates,\ncourse,Meadow Creek\nlodging,Bear Creek Lodge\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  const absentDatesInfo = `key,value\ncourse,Meadow Creek\nlodging,Bear Creek Lodge\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  const kitBlank = generateKit({ fieldCsv: FIELD_CSV, infoCsv: blankDatesInfo, now: NOW });
  const kitAbsent = generateKit({ fieldCsv: FIELD_CSV, infoCsv: absentDatesInfo, now: NOW });
  const kitReal = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });

  check("S26-T3b: blank Info.dates value emits the literal placeholder \"[ 2027 DATES ]\" verbatim in the poster; an ABSENT dates key does too; a real dates value (\"Aug 14–16\") shows verbatim instead and never the placeholder",
    kitBlank.poster.includes("[ 2027 DATES ]")
    && kitAbsent.poster.includes("[ 2027 DATES ]")
    && kitReal.poster.includes("Aug 14–16")
    && !kitReal.poster.includes("[ 2027 DATES ]"));
}

/* ---------- (c) generation stamp present ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const stamp = genStamp(NOW);
  const stampShape = /^Generated \d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(am|pm)$/.test(stamp);

  check("S26-T3c: genStamp(now) matches \"Generated YYYY-MM-DD h:mm(am|pm)\" verbatim shape; the identical stamp string appears in BOTH the poster and the captain-cards HTML",
    stampShape && kit.poster.includes(stamp) && kit.cards.includes(stamp),
    "stamp=" + JSON.stringify(stamp));
}

/* ---------- (d) card QR call receives the ENCODED url for a spaced team name ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const expectedUrl = scoreUrlFor("Wade Johnson");
  const expectedPosterSvg = posterQrSvg();
  const expectedCardSvg = cardQrSvg("Wade Johnson");

  check("S26-T3d: scoreUrlFor(\"Wade Johnson\") percent-encodes the space (\"" + expectedUrl + "\", %20 not +) against SITE_ROOT + \"#score?team=\"; the captain-cards HTML contains the BYTE-IDENTICAL <svg> that cardQrSvg(\"Wade Johnson\") produces over that exact encoded url (proves the QR call received the encoded string, via the qr module rather than by decoding); the poster HTML separately contains posterQrSvg()'s byte-identical <svg> over the bare SITE_ROOT",
    expectedUrl === SITE_ROOT + "#score?team=Wade%20Johnson"
    && kit.cards.includes(expectedCardSvg)
    && kit.poster.includes(expectedPosterSvg));
}

/* ---------- (e) zero "@" survives anywhere in emitted HTML ---------- */
{
  // assertNoAt as a guard function, directly.
  const okStr = assertNoAt("<p>no at signs here</p>", "test");
  let directThrew = null;
  try { assertNoAt("<p>duck@example.com</p>", "test"); } catch (e) { directThrew = e; }

  // A poisoned fixture: a team name that itself contains an email-like
  // string (not a banned HEADER — this is a cell value, so the vault guard
  // from (a) does not see it at all; only the structural guard can catch
  // it). Same captain rule as elsewhere: player === team.
  const poisonedFieldCsv = `year,player,team,since
2026,Big Slick evil@example.com,Big Slick evil@example.com,2019`;
  let poisonedThrew = null;
  try { generateKit({ fieldCsv: poisonedFieldCsv, infoCsv: INFO_CSV, now: NOW }); }
  catch (e) { poisonedThrew = e; }

  // And the clean baseline kit really does carry zero "@" in its <body> —
  // the ENTIRE surface where CSV-derived text lands (see buildPosterHtml's
  // comment). The static <head> is deliberately OUT of scope: CARDS_CSS/
  // POSTER_CSS's own `@page` rule and the Google Fonts stylesheet link's
  // `wght@400` variable-axis syntax both legitimately contain "@" and are
  // template-constant, never influenced by sheet data — index.html's own
  // <head> font link (line 13) carries the identical `wght@` syntax, so a
  // whole-document "zero @" scan would false-positive on every single
  // render, including this repo's own site chrome.
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const posterBody = (kit.poster.match(/<body>([\s\S]*)<\/body>/) || [])[1] || "";
  const cardsBody = (kit.cards.match(/<body>([\s\S]*)<\/body>/) || [])[1] || "";

  check("S26-T3e: assertNoAt() is a no-op on \"@\"-free HTML and THROWS (STRUCTURAL GUARD) on HTML containing \"@\"; a poisoned Field fixture whose TEAM NAME contains an email-like string (never a banned header, so the vault guard alone would miss it) makes generateKit() throw via that same structural guard, so nothing is ever written with an \"@\" in it; the clean baseline kit's <body> content — the entire surface CSV data can reach — contains zero literal \"@\" characters in both poster and captain-cards (the static <head>'s CSS/@page/font-link @-syntax is out of scope by design, same as index.html's own font link)",
    okStr.includes("no at signs")
    && directThrew !== null && /STRUCTURAL GUARD/.test(directThrew.message)
    && poisonedThrew !== null && /STRUCTURAL GUARD/.test(poisonedThrew.message)
    && posterBody.length > 0 && cardsBody.length > 0
    && !posterBody.includes("@") && !cardsBody.includes("@"));
}

/* ---------- (f) [TBD] for blank venue cells ---------- */
{
  const bothBlank = `key,value\ndates,Aug 14–16\ncourse,\nlodging,\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  const courseBlankOnly = `key,value\ndates,Aug 14–16\ncourse,\nlodging,Bear Creek Lodge\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  const kitBoth = generateKit({ fieldCsv: FIELD_CSV, infoCsv: bothBlank, now: NOW });
  const kitCourseOnly = generateKit({ fieldCsv: FIELD_CSV, infoCsv: courseBlankOnly, now: NOW });
  const kitReal = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });

  check("S26-T3f: blank Info.course AND Info.lodging both emit \"[TBD]\" in the poster venue line; a blank course with a real lodging value emits \"[TBD]\" for course while the real lodging value (\"Bear Creek Lodge\") still shows verbatim; real values for both never show \"[TBD]\" at all",
    (kitBoth.poster.match(/\[TBD\]/g) || []).length === 2
    && kitCourseOnly.poster.includes("[TBD]") && kitCourseOnly.poster.includes("Bear Creek Lodge")
    && !kitReal.poster.includes("[TBD]") && kitReal.poster.includes("Meadow Creek") && kitReal.poster.includes("Bear Creek Lodge"));
}

/* ---------- extra: captain/roster mirroring (currentSeason + rosterMap) ---------- */
{
  // currentSeason mirrors activeSeason()'s fallback branch (this tool never
  // fetches Scores — see make-kit.mjs's currentSeason() comment) — with
  // Info.first_tee = 2026-08-15, the season is "2026".
  const season = currentSeason({ first_tee: "2026-08-15T09:00:00-06:00" }, NOW);
  const noTeeSeason = currentSeason({}, NOW);

  const field = parseCsv(FIELD_CSV);
  const roster = rosterMap(field.rows, season);
  const wj = roster.get("wade johnson");
  const duck = roster.get("duck");

  check("S26-T3-roster: currentSeason() reads the year off Info.first_tee (\"2026\"), falling back to now.getFullYear() (\"" + NOW.getFullYear() + "\") when first_tee is absent; rosterMap mirrors index.html's \"player === team\" captain rule — team \"Wade Johnson\" resolves captain \"Wade Johnson\" with member Sully, team \"Duck\" resolves captain \"Duck\" with member Hammer; the 2027 Ghost row (blank team) contributes to neither team",
    season === "2026" && noTeeSeason === String(NOW.getFullYear())
    && wj && wj.captain === "Wade Johnson" && wj.members.includes("Sully")
    && duck && duck.captain === "Duck" && duck.members.includes("Hammer")
    && ![...roster.values()].some(t => t.members.includes("Ghost") || t.captain === "Ghost"));
}

/* ---------- extra: card content shape (TEAM name / Captain line / field note verbatim) ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  check("S26-T3-card-shape: captain-cards HTML contains \"TEAM WADE JOHNSON\" (uppercased) and \"Captain · Wade Johnson\", plus the field note verbatim on both lines (\"Scores post to the live board.\" / \"No service on the course? It saves and sends later.\"), \"SCAN TO SCORE\" caption, and the monogram footer \"The Good Friends Yearly · McCall, Idaho\"",
    kit.cards.includes("TEAM WADE JOHNSON")
    && kit.cards.includes("Captain · Wade Johnson")
    && kit.cards.includes("Scores post to the live board.")
    && kit.cards.includes("No service on the course? It saves and sends later.")
    && kit.cards.includes("SCAN TO SCORE")
    && kit.cards.includes("The Good Friends Yearly · McCall, Idaho"));
}

/* ---------- extra: poster content shape ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  check("S26-T3-poster-shape: poster HTML contains \"THE GOOD FRIENDS YEARLY\", \"McCall, Idaho · Est. 2019\" verbatim, \"FOLLOW THE FIELD · LIVE SCORING\", the exact conditions line, and references the crest via a RELATIVE path ending assets/gfy-crest.svg (not an absolute/2-up-broken path)",
    kit.poster.includes("THE GOOD FRIENDS YEARLY")
    && kit.poster.includes("McCall, Idaho · Est. 2019")
    && kit.poster.includes("FOLLOW THE FIELD · LIVE SCORING")
    && kit.poster.includes("CONDITIONS OF COMPETITION POSTED AT THE FIRST TEE")
    && /src="[.\/]+assets\/gfy-crest\.svg"/.test(kit.poster));
}

console.log("");
const failed = results.filter(r => !r[1]).length;
console.log(`TALLY TOTAL ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
