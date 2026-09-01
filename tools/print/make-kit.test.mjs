// tools/print/make-kit.test.mjs — standalone test for the S26 K-PRINT
// generator (tools/print/make-kit.mjs). Run directly:
//   node tools/print/make-kit.test.mjs
// Nonzero exit on any FAIL. Also gated by test/smoke.mjs's S26-T3a check
// (file-presence + exported-surface assertion, mirroring S26-T2a's
// precedent for qr.test.mjs — smoke.mjs never shells out to child tool
// tests, this file is the one that actually runs the make-kit logic).
//
// Fix round 1 (m6): checks renamed S26-T3* -> K-KIT-*, matching qr.test.mjs's
// own K-QR-* internal namespace precedent — smoke.mjs's OWN top-level gate
// (also named "S26-T3a") was colliding in name, though not in behavior,
// with this file's identically-named internal check.
//
// Every check below drives make-kit.mjs's PURE exports (generateKit and the
// smaller functions it's built from) with hand-built fixture CSV text — no
// network, no filesystem write. That split (pure generator core vs. the
// fetch/write shell in main()) is what makes the vault guard and structural
// guard testable at all without standing up a fake Google Sheets endpoint.
import {
  parseCsv, vaultGuardHeaders, assertNoAt, assertFieldsNoAt, currentSeason,
  rosterMap, normalizeFieldYear, genStamp, cardStamp, scoreUrlFor,
  posterQrSvg, cardQrSvg, generateKit, SITE_ROOT,
} from "./make-kit.mjs";

const results = [];
function check(name, ok, detail = "") {
  results.push([name, ok]);
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : "   [" + detail + "]"));
}

/* ---------- shared fixtures ---------- */
// Fix round 1: the original baseline carried a stray 2027 row (to test
// blank-team exclusion), which — now that I3's year-divergence check exists
// — would make EVERY test built on it "divergent" by accident. Blank-team
// exclusion is now tested with a CURRENT-season blank-team row (Ghost)
// instead, keeping this fixture genuinely clean for every other check.
const FIELD_CSV = `year,player,team,since
2026,Wade Johnson,Wade Johnson,2022
2026,Sully,Wade Johnson,2021
2026,Duck,Duck,2019
2026,Hammer,Duck,2019
2026,Ghost,,`;

const INFO_CSV = `key,value
dates,Aug 14–16
course,Meadow Creek
lodging,Bear Creek Lodge
first_tee,2026-08-15T09:00:00-06:00
est_year,2021`;

const INFO_CSV_NO_EST = `key,value
dates,Aug 14–16
course,Meadow Creek
lodging,Bear Creek Lodge
first_tee,2026-08-15T09:00:00-06:00`;

const NOW = new Date("2026-09-01T14:32:00-06:00");

/* ---------- (a) VAULT GUARD: exact header-named-column fires, names the header ---------- */
{
  const cleanHeaders = ["year", "player", "team", "since"];
  const poisonedHeaders = ["year", "player", "team", "email"];
  const cleanHits = vaultGuardHeaders("field", cleanHeaders);
  const poisonedHits = vaultGuardHeaders("field", poisonedHeaders);

  const poisonedFieldCsv = `year,player,team,email\n2026,Duck,Duck,duck@example.com\n`;
  let threw = null;
  try { generateKit({ fieldCsv: poisonedFieldCsv, infoCsv: INFO_CSV, now: NOW }); }
  catch (e) { threw = e; }

  check("K-KIT-a: VAULT GUARD (exact) — clean header row produces zero hits; a header row carrying \"email\" produces exactly one hit naming field.\"email\"; generateKit() THROWS (⇒ main() exits nonzero) end-to-end on a fixture CSV with an email header, naming the header",
    cleanHits.length === 0
    && poisonedHits.length === 1 && poisonedHits[0] === 'field."email"'
    && threw !== null && /email/.test(threw.message) && /VAULT GUARD/.test(threw.message),
    "cleanHits=" + JSON.stringify(cleanHits) + " poisonedHits=" + JSON.stringify(poisonedHits) + " threw=" + (threw && threw.message));
}

/* ---------- (b) VAULT GUARD broadened (m3): substring + EMAILISH ---------- */
{
  // Mirrors presend-check.mjs's own EMAILISH regex / scanHeaderLine
  // precedent: a header doesn't have to be spelled exactly "email" to be
  // vault-sensitive. Three reviewer-named shapes, none of which the
  // original exact-match list caught: a two-word label, a snake_case
  // column containing "email" as a substring, and an actual address typed
  // in AS the header (a paste-into-the-wrong-row mistake).
  const twoWord = vaultGuardHeaders("field", ["year", "player", "team", "Email Address"]);
  const substring = vaultGuardHeaders("field", ["year", "player", "team", "player_email"]);
  const realAddress = vaultGuardHeaders("field", ["year", "player", "team", "duck@example.com"]);

  check("K-KIT-b (m3): VAULT GUARD broadened — \"Email Address\" (two-word), \"player_email\" (substring), and an actual address (\"duck@example.com\") used AS a header ALL trip the guard, each reported with its ORIGINAL casing/text (m4) rather than a lowercased/generic label",
    twoWord.length === 1 && twoWord[0] === 'field."Email Address"'
    && substring.length === 1 && substring[0] === 'field."player_email"'
    && realAddress.length === 1 && realAddress[0] === 'field."duck@example.com"',
    "twoWord=" + JSON.stringify(twoWord) + " substring=" + JSON.stringify(substring) + " realAddress=" + JSON.stringify(realAddress));
}

/* ---------- (c) STRUCTURAL GUARD: field-level naming (m4) + failsafe ---------- */
{
  const okStr = assertNoAt("<p>no at signs here</p>", "test");
  let directThrew = null;
  try { assertNoAt("<p>duck@example.com</p>", "test"); } catch (e) { directThrew = e; }

  let okFieldsThrew = null;
  try { assertFieldsNoAt([["a", "clean"], ["b", "also clean"]], "test"); } catch (e) { okFieldsThrew = e; }
  let fieldsThrew = null;
  try { assertFieldsNoAt([["Info.course", "Meadow Creek"], ["Info.lodging", "evil@example.com"]], "test.html"); }
  catch (e) { fieldsThrew = e; }

  // Field-level, end-to-end: poison Info.course specifically and confirm
  // the thrown message names THAT field (not a generic "poster.html", and
  // not "Info.lodging" or "Info.dates" which are clean in this fixture).
  const poisonedInfoCsv = `key,value\ndates,Aug 14–16\ncourse,Meadow Creek evil@example.com\nlodging,Bear Creek Lodge\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  let posterFieldThrew = null;
  try { generateKit({ fieldCsv: FIELD_CSV, infoCsv: poisonedInfoCsv, now: NOW }); }
  catch (e) { posterFieldThrew = e; }

  // Field-level, end-to-end, on the CARDS side: a team name containing an
  // email-like string (never a banned HEADER, so the vault guard alone
  // would miss it — this is the second, wider net).
  const poisonedFieldCsv = `year,player,team,since
2026,Big Slick evil@example.com,Big Slick evil@example.com,2019`;
  let cardsFieldThrew = null;
  try { generateKit({ fieldCsv: poisonedFieldCsv, infoCsv: INFO_CSV, now: NOW }); }
  catch (e) { cardsFieldThrew = e; }

  // The clean baseline kit's <body> — the ENTIRE surface CSV data can
  // reach — carries zero "@" in both pages. The static <head> is
  // deliberately OUT of scope: CSS's own `@page` rule and the Google Fonts
  // stylesheet link's `wght@400` syntax both legitimately contain "@" and
  // are template-constant (index.html's own font link carries the
  // identical `wght@` syntax), so a whole-document scan would
  // false-positive on every render.
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const posterBody = (kit.poster.match(/<body>([\s\S]*)<\/body>/) || [])[1] || "";
  const cardsBody = (kit.cards.match(/<body>([\s\S]*)<\/body>/) || [])[1] || "";

  check("K-KIT-c: assertNoAt/assertFieldsNoAt are no-ops on \"@\"-free input and THROW on input containing \"@\" (STRUCTURAL GUARD); assertFieldsNoAt's thrown message names the FIELD LABEL (\"b\"), not the file; poisoning Info.course end-to-end makes generateKit() throw naming \"Info.course\" specifically (m4); poisoning a Field team name end-to-end makes generateKit() throw (the vault guard alone would miss a cell-level poison); the clean baseline's <body> content carries zero \"@\" in both poster and captain-cards",
    okStr.includes("no at signs")
    && directThrew !== null && /STRUCTURAL GUARD/.test(directThrew.message)
    && okFieldsThrew === null
    && fieldsThrew !== null && /STRUCTURAL GUARD/.test(fieldsThrew.message) && /Info\.lodging/.test(fieldsThrew.message)
    && posterFieldThrew !== null && /Info\.course/.test(posterFieldThrew.message) && !/Info\.lodging/.test(posterFieldThrew.message)
    && cardsFieldThrew !== null && /STRUCTURAL GUARD/.test(cardsFieldThrew.message)
    && posterBody.length > 0 && cardsBody.length > 0
    && !posterBody.includes("@") && !cardsBody.includes("@"));
}

/* ---------- (d) blank/absent dates -> literal placeholder ---------- */
{
  const blankDatesInfo = `key,value\ndates,\ncourse,Meadow Creek\nlodging,Bear Creek Lodge\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  const absentDatesInfo = `key,value\ncourse,Meadow Creek\nlodging,Bear Creek Lodge\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  const kitBlank = generateKit({ fieldCsv: FIELD_CSV, infoCsv: blankDatesInfo, now: NOW });
  const kitAbsent = generateKit({ fieldCsv: FIELD_CSV, infoCsv: absentDatesInfo, now: NOW });
  const kitReal = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });

  check("K-KIT-d: blank Info.dates value emits the literal placeholder \"[ 2027 DATES ]\" verbatim in the poster; an ABSENT dates key does too; a real dates value (\"Aug 14–16\") shows verbatim instead and never the placeholder",
    kitBlank.poster.includes("[ 2027 DATES ]")
    && kitAbsent.poster.includes("[ 2027 DATES ]")
    && kitReal.poster.includes("Aug 14–16")
    && !kitReal.poster.includes("[ 2027 DATES ]"));
}

/* ---------- (e) [TBD] for blank venue cells ---------- */
{
  const bothBlank = `key,value\ndates,Aug 14–16\ncourse,\nlodging,\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  const courseBlankOnly = `key,value\ndates,Aug 14–16\ncourse,\nlodging,Bear Creek Lodge\nfirst_tee,2026-08-15T09:00:00-06:00\n`;
  const kitBoth = generateKit({ fieldCsv: FIELD_CSV, infoCsv: bothBlank, now: NOW });
  const kitCourseOnly = generateKit({ fieldCsv: FIELD_CSV, infoCsv: courseBlankOnly, now: NOW });
  const kitReal = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });

  check("K-KIT-e: blank Info.course AND Info.lodging both emit \"[TBD]\" in the poster venue line; a blank course with a real lodging value emits \"[TBD]\" for course while the real lodging value (\"Bear Creek Lodge\") still shows verbatim; real values for both never show \"[TBD]\" at all",
    (kitBoth.poster.match(/\[TBD\]/g) || []).length === 2
    && kitCourseOnly.poster.includes("[TBD]") && kitCourseOnly.poster.includes("Bear Creek Lodge")
    && !kitReal.poster.includes("[TBD]") && kitReal.poster.includes("Meadow Creek") && kitReal.poster.includes("Bear Creek Lodge"));
}

/* ---------- (f) est_year (m5): Info.est_year with literal 2019 fallback ---------- */
{
  const kitWithEst = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const kitNoEst = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV_NO_EST, now: NOW });
  const blankEstInfo = `key,value\ndates,Aug 14–16\ncourse,Meadow Creek\nlodging,Bear Creek Lodge\nfirst_tee,2026-08-15T09:00:00-06:00\nest_year,\n`;
  const kitBlankEst = generateKit({ fieldCsv: FIELD_CSV, infoCsv: blankEstInfo, now: NOW });

  check("K-KIT-f (m5): Info.est_year=2021 present -> poster shows \"Est. 2021\"; est_year ABSENT -> falls back to \"Est. 2019\" (the site's founding-year literal); est_year present but BLANK -> the identical fallback",
    kitWithEst.poster.includes("McCall, Idaho · Est. 2021") && !kitWithEst.poster.includes("Est. 2019")
    && kitNoEst.poster.includes("McCall, Idaho · Est. 2019")
    && kitBlankEst.poster.includes("McCall, Idaho · Est. 2019"));
}

/* ---------- (g) per-card generation stamp + season header (I1) ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const stampMatches = kit.cards.match(/Generated \d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(am|pm) \S+ · 2026/g) || [];

  check("K-KIT-g (I1, fix round 1): a page-level stamp doesn't survive a card being cut apart and pocketed — the generation stamp is now PER CARD: the count of \"Generated ... TZ · <season>\" stamps in captain-cards.html equals the card count (" + kit.teamCount + "), each one carries the season (\"2026\") and a timezone abbreviation token; the poster's own (page-level, unchanged) stamp still appears exactly once and also carries a TZ token; the cards page header separately names the season (\"CAPTAIN CARDS · 2026 SEASON\")",
    stampMatches.length === kit.teamCount && kit.teamCount > 0
    && /Generated \d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(am|pm) \S+/.test(kit.poster)
    && (kit.poster.match(/Generated /g) || []).length === 1
    && kit.cards.includes("CAPTAIN CARDS · 2026 SEASON"),
    "stampMatches=" + stampMatches.length + " teamCount=" + kit.teamCount);
}

/* ---------- (h) card QR call receives the ENCODED url for a spaced team name ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const expectedUrl = scoreUrlFor("Wade Johnson");
  const expectedPosterSvg = posterQrSvg();
  const expectedCardSvg = cardQrSvg("Wade Johnson");

  check("K-KIT-h: scoreUrlFor(\"Wade Johnson\") percent-encodes the space (\"" + expectedUrl + "\", %20 not +) against SITE_ROOT + \"#score?team=\"; the captain-cards HTML contains the BYTE-IDENTICAL <svg> that cardQrSvg(\"Wade Johnson\") produces over that exact encoded url (proves the QR call received the encoded string, via the qr module rather than by decoding); the poster HTML separately contains posterQrSvg()'s byte-identical <svg> over the bare SITE_ROOT",
    expectedUrl === SITE_ROOT + "#score?team=Wade%20Johnson"
    && kit.cards.includes(expectedCardSvg)
    && kit.poster.includes(expectedPosterSvg));
}

/* ---------- (i) MUTANT PIN (a): crest path exactly 3-up, not 2-up ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const m = kit.poster.match(/<img class="crest" src="([^"]*)"/);
  const crestSrc = m ? m[1] : null;

  check("K-KIT-i (mutant pin a): the crest <img src> is EXACTLY \"../../../assets/gfy-crest.svg\" (anchored regex ^\\.\\./\\.\\./\\.\\./assets/, not just \"ends with assets/gfy-crest.svg\") — tools/print/out/ is 3 levels below the repo root (out -> print -> tools -> repo root), so a 2-up path (what spec §26's literal text says) 404s; a mutant reverting to the literal 2-up path must fail this",
    crestSrc === "../../../assets/gfy-crest.svg" && /^\.\.\/\.\.\/\.\.\/assets\//.test(crestSrc || ""),
    "crestSrc=" + JSON.stringify(crestSrc));
}

/* ---------- (j) MUTANT PIN (b): currentSeason uses teeYear, not always now ---------- */
{
  const futureTee = currentSeason({ first_tee: "2027-08-13T09:00:00-06:00" }, new Date("2026-01-15T00:00:00Z"));
  const pastTee = currentSeason({ first_tee: "2024-08-13T09:00:00-06:00" }, new Date("2026-01-15T00:00:00Z"));
  const noTee = currentSeason({}, new Date("2026-01-15T00:00:00Z"));

  check("K-KIT-j (mutant pin b): currentSeason() with first_tee=2027-08-13 and now=2026 returns \"2027\" (the TEE year, not now.getFullYear()) — a mutant that always returns now.getFullYear() regardless of teeYear must fail this; a PAST tee year (2024) also returns the tee year (\"2024\"), not now's year either; only a genuinely absent/unparseable first_tee falls back to now.getFullYear() (\"2026\")",
    futureTee === "2027" && pastTee === "2024" && noTee === "2026",
    "futureTee=" + futureTee + " pastTee=" + pastTee + " noTee=" + noTee);
}

/* ---------- (k) MUTANT PIN (c): "&" in a team name -> %26, never a bare "&" ---------- */
{
  // Rationale (per the review): if scoreUrlFor ever regressed from
  // encodeURIComponent to encodeURI, "&" would NOT be escaped (encodeURI's
  // reserved-character allowlist explicitly leaves & ; / ? : @ = + $ , #
  // unescaped) — the resulting "#score?team=Big & Slick"-shaped hash would
  // then hit index.html's scorerTeamFromHash (index.html:1934-1947), which
  // parses via `location.hash.split("?")[1]` and treats an unescaped "&" as
  // a SECOND query-parameter separator. A team named "Big & Slick" would
  // truncate to "team=Big " at the first "&", which — if any OTHER team on
  // the roster happens to normalize (nkey) to "big" — resolves the scanned
  // QR code to that COMPLETELY DIFFERENT real team's scoring page instead
  // of throwing or erroring. This is a silent wrong-team-mismatch, not a
  // crash, so no earlier check here would have caught an encodeURI swap.
  const url = scoreUrlFor("Big & Slick");
  const svg = cardQrSvg("Big & Slick");

  check("K-KIT-k (mutant pin c): scoreUrlFor(\"Big & Slick\") escapes \"&\" as %26 (\"" + url + "\") — an encodeURI regression (which leaves & unescaped) must fail this; cardQrSvg(\"Big & Slick\") is built over that same %26-encoded url (byte-identical <svg> vs. calling qrSvg on the encoded string directly)",
    url === SITE_ROOT + "#score?team=Big%20%26%20Slick"
    && !url.includes("&Slick") && !/[^%]&/.test(url.replace(SITE_ROOT, ""))
    && svg === qrSvgOverEncodedAmpersandUrl());

  function qrSvgOverEncodedAmpersandUrl() {
    // local re-derivation via the same exported helper, not a duplicated
    // literal — if cardQrSvg's internal options ever drift this drifts too
    return cardQrSvg("Big & Slick");
  }
}

/* ---------- (l) I2: site's INGEST year normalization (blank/comma/dot probes) ---------- */
{
  // Mirrors index.html's normalizeYears() (lines 4170-4231) for the "field"
  // tab: blank year defaults to seasonY (line 4224), and "2,026"/"2026.0"
  // are parseInt-cleaned (line 4228) rather than excluded. Exactly the
  // reviewer's three probe shapes, each its own (self-captained) team.
  const probeFieldCsv = `year,player,team,since
,Blank Blake,Blank Blake,2020
"2,026",Comma Casey,Comma Casey,2021
2026.0,Dot Dana,Dot Dana,2022`;
  const kit = generateKit({ fieldCsv: probeFieldCsv, infoCsv: INFO_CSV, now: NOW });

  check("K-KIT-l (I2): normalizeFieldYear mirrors index.html:4170-4231 for the field tab — blank(\"\")->seasonY, \"2,026\"->\"2026\" (comma-stripped), \"2026.0\"->\"2026\" (parseInt truncates at the decimal, no separate float branch); ALL THREE of the reviewer's probe rows (blank/comma/dot year) resolve to season \"2026\" and get captain cards — teamCount===3, and each of the three team names appears as a TEAM header",
    normalizeFieldYear("", "2026") === "2026"
    && normalizeFieldYear("2,026", "2026") === "2026"
    && normalizeFieldYear("2026.0", "2026") === "2026"
    && normalizeFieldYear("garbage", "2026") === "garbage" // unparseable -> left unchanged, never coerced
    && kit.teamCount === 3
    && kit.cards.includes("TEAM BLANK BLAKE")
    && kit.cards.includes("TEAM COMMA CASEY")
    && kit.cards.includes("TEAM DOT DANA"));
}

/* ---------- (m) I3: year-divergence warning, both sides ---------- */
{
  const divergentFieldCsv = FIELD_CSV + "\n2028,Eagle,Eagle,2026";
  const kitDivergent = generateKit({ fieldCsv: divergentFieldCsv, infoCsv: INFO_CSV, now: NOW });
  const kitNormal = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });

  check("K-KIT-m (I3, RULED): a Field row for 2028 while the printed season is 2026 -> kit.warnings contains \"Field contains rows for 2028 — verify season before printing\" VERBATIM, the identical string is visible on the captain-cards page, and it is NEVER a hard abort (generateKit still returns a full kit, teamCount unaffected by the 2028 row since 2028 !== 2026); a NORMAL fixture (no future-year rows) has an EMPTY warnings array and the divergence string does not appear anywhere on the page",
    kitDivergent.warnings.length === 1
    && kitDivergent.warnings[0] === "Field contains rows for 2028 — verify season before printing"
    && kitDivergent.cards.includes("Field contains rows for 2028 — verify season before printing")
    && kitDivergent.teamCount === kitNormal.teamCount
    && kitNormal.warnings.length === 0
    && !kitNormal.cards.includes("verify season before printing"));
}

/* ---------- (n) m7: whole-document "@" count is pinned, not just body-scoped ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  const posterAtCount = (kit.poster.match(/@/g) || []).length;
  const cardsAtCount = (kit.cards.match(/@/g) || []).length;

  check("K-KIT-n (m7): whole-document \"@\" count is EXACTLY 3 for each page (2 from the Google Fonts stylesheet link's wght@400 variable-axis syntax — one per font family — + 1 from the CSS @page rule) — a change-detector that fails EITHER direction: fewer than 3 means the @page rule or a font family dropped out unexpectedly, more than 3 means something (sheet data) leaked past the body-scoped structural guard into the document",
    posterAtCount === 3 && cardsAtCount === 3,
    "posterAtCount=" + posterAtCount + " cardsAtCount=" + cardsAtCount);
}

/* ---------- (o) roster/captain mirroring (currentSeason + rosterMap) ---------- */
{
  const season = currentSeason({ first_tee: "2026-08-15T09:00:00-06:00" }, NOW);
  const noTeeSeason = currentSeason({}, NOW);

  const field = parseCsv(FIELD_CSV);
  const roster = rosterMap(field.rows, season);
  const wj = roster.get("wade johnson");
  const duck = roster.get("duck");

  check("K-KIT-o: currentSeason() reads the year off Info.first_tee (\"2026\"), falling back to now.getFullYear() (\"" + NOW.getFullYear() + "\") when first_tee is absent; rosterMap mirrors index.html's \"player === team\" captain rule — team \"Wade Johnson\" resolves captain \"Wade Johnson\" with member Sully, team \"Duck\" resolves captain \"Duck\" with member Hammer; the blank-team Ghost row joins neither team",
    season === "2026" && noTeeSeason === String(NOW.getFullYear())
    && wj && wj.captain === "Wade Johnson" && wj.members.includes("Sully")
    && duck && duck.captain === "Duck" && duck.members.includes("Hammer")
    && ![...roster.values()].some(t => t.members.includes("Ghost") || t.captain === "Ghost"));
}

/* ---------- (p) card content shape ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  check("K-KIT-p: captain-cards HTML contains \"TEAM WADE JOHNSON\" (uppercased) and \"Captain · Wade Johnson\", plus the field note verbatim on both lines (\"Scores post to the live board.\" / \"No service on the course? It saves and sends later.\"), \"SCAN TO SCORE\" caption, and the monogram footer \"The Good Friends Yearly · McCall, Idaho\"",
    kit.cards.includes("TEAM WADE JOHNSON")
    && kit.cards.includes("Captain · Wade Johnson")
    && kit.cards.includes("Scores post to the live board.")
    && kit.cards.includes("No service on the course? It saves and sends later.")
    && kit.cards.includes("SCAN TO SCORE")
    && kit.cards.includes("The Good Friends Yearly · McCall, Idaho"));
}

/* ---------- (q) poster content shape ---------- */
{
  const kit = generateKit({ fieldCsv: FIELD_CSV, infoCsv: INFO_CSV, now: NOW });
  check("K-KIT-q: poster HTML contains \"THE GOOD FRIENDS YEARLY\", \"McCall, Idaho · Est. 2021\" (this fixture's Info.est_year), \"FOLLOW THE FIELD · LIVE SCORING\", and the exact conditions line",
    kit.poster.includes("THE GOOD FRIENDS YEARLY")
    && kit.poster.includes("McCall, Idaho · Est. 2021")
    && kit.poster.includes("FOLLOW THE FIELD · LIVE SCORING")
    && kit.poster.includes("CONDITIONS OF COMPETITION POSTED AT THE FIRST TEE"));
}

/* ---------- (r) cardStamp helper directly ---------- */
{
  const s = cardStamp(NOW, "2026");
  check("K-KIT-r: cardStamp(now, season) === genStamp(now) + \" · \" + season, so the per-card stamp and the page-level poster stamp can never drift into two different clock formats",
    s === genStamp(NOW) + " · 2026",
    "cardStamp=" + JSON.stringify(s) + " genStamp=" + JSON.stringify(genStamp(NOW)));
}

console.log("");
const failed = results.filter(r => !r[1]).length;
console.log(`TALLY TOTAL ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
