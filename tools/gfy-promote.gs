/** @OnlyCurrentDoc */
/**
 * GFY accept→Field promotion — the invites funnel's missing middle step.
 * Paste into the LIVE sheet's Apps Script project (same project as polish/
 * triggers is fine) and reload the sheet — a "GFY" menu appears.
 *
 * Workflow: GFY → "Seed next season's Invites" pre-fills the tab with every
 * returning player from Field's trailing three seasons, VETERANS FIRST
 * (Riley 2026-08-24: veterans always outrank rookies) — you type only the
 * genuinely new names, recording each new invitee's sponsor in `invited_by`
 * (who invited who — the group's accountability record). Tick `invited` as
 * invites go out, `responded` as replies land, `committed` on a yes; then
 * GFY → "Promote committed → Field" appends a Field row for everyone
 * committed who doesn't already have one for that year: team BLANK
 * (straight into the draft pool — E-TEAM, teams are drafted Friday night),
 * `since` carried from the player's latest prior Field row (or set to the
 * promoted year for a first-timer — their rookie year by definition),
 * status "In", deposit unchecked. Handicap stays yours to fill.
 *
 * NOCLOBBER: an existing (year, player) Field row / (year, player) Invites
 * row is never duplicated or touched — re-running either action is always
 * safe. A row committed AND out/declined is contradictory and is reported,
 * never promoted (F-DECLINED); a player marked `out` on ANY past row is
 * out for good and never re-seeded (reported, add by hand to override).
 * The SITE never reads `committed`/`invited_by` for membership; a Field
 * row remains the one meaning of committed (A1). tools/event-ready.mjs
 * WARNs on committed-but-unpromoted rows and sponsorless first-timers.
 */

// LOCKSTEP with NORM in sheet-triggers.gs / nkey in index.html / NKEY in
// event-ready.mjs (F-NKEY: trim + collapse internal whitespace + casefold).
// Own copy under a unique name — same-project files share one global scope,
// so redefining NORM/headerIndex_ here would silently shadow theirs.
const pcNorm_ = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const pcYes_ = v => v === true || /^(y|yes|true|paid|in|1)$/i.test(String(v || "").trim()); // mirrors index.html yes()

function onOpen(){
  const menu = SpreadsheetApp.getUi().createMenu("GFY")
    .addItem("Promote committed → Field", "promoteCommitted")
    .addItem("Seed next season's Invites", "seedInvites");
  if (typeof polish === "function") menu.addItem("Polish / repair sheet", "polish");
  menu.addToUi();
}

function pcHeaderMap_(sh){
  const heads = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  const m = {};
  heads.forEach((h, i) => { const k = pcNorm_(h); if (k && !(k in m)) m[k] = i; }); // 0-based; first occurrence wins
  return m;
}

function promoteCommitted(){
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inv = ss.getSheetByName("Invites"), fld = ss.getSheetByName("Field");
  if (!inv || !fld){ ui.alert("GFY promote", "Need both an Invites and a Field tab — nothing written.", ui.ButtonSet.OK); return; }

  const ih = pcHeaderMap_(inv), fh = pcHeaderMap_(fld);
  if (!("committed" in ih)){
    ui.alert("GFY promote", 'Invites has no "committed" column. Add the header in row 1 (after "status"), re-run polish() for the checkbox, then retry.', ui.ButtonSet.OK);
    return;
  }
  const needInv = ["year", "player"].filter(c => !(c in ih));
  const needFld = ["year", "player", "status", "since", "team"].filter(c => !(c in fh));
  if (needInv.length || needFld.length){
    ui.alert("GFY promote", "Missing header(s) — Invites: " + (needInv.join(", ") || "ok") + " · Field: " + (needFld.join(", ") || "ok") + ". Nothing written.", ui.ButtonSet.OK);
    return;
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)){ ui.alert("GFY promote", "Sheet is busy — try again in a moment.", ui.ButtonSet.OK); return; }
  try {
    const invVals = inv.getLastRow() > 1 ? inv.getRange(2, 1, inv.getLastRow() - 1, inv.getLastColumn()).getValues() : [];
    const fldVals = fld.getLastRow() > 1 ? fld.getRange(2, 1, fld.getLastRow() - 1, fld.getLastColumn()).getValues() : [];

    // Existing Field membership (NOCLOBBER key), each player's latest since,
    // and who has ANY Field row at all (first-timer detection).
    const existing = new Set();
    const latestSince = {};                                 // pcNorm(player) -> {year, since}
    const fieldAnyYear = new Set();
    fldVals.forEach(r => {
      const p = String(r[fh.player] || "").trim(); if (!p) return;
      existing.add(String(r[fh.year]).trim() + "|" + pcNorm_(p));
      fieldAnyYear.add(pcNorm_(p));
      const y = parseInt(r[fh.year], 10), s = String(r[fh.since] == null ? "" : r[fh.since]).trim();
      if (s && !isNaN(y)){
        const k = pcNorm_(p);
        if (!(k in latestSince) || y > latestSince[k].year) latestSince[k] = { year: y, since: r[fh.since] };
      }
    });

    const width = fld.getLastColumn();
    const newRows = [], promoted = [], contradicted = [], malformed = [];
    let already = 0;
    invVals.forEach((r, i) => {
      if (!pcYes_(r[ih.committed])) return;
      const player = String(r[ih.player] || "").trim();
      if (!player){ malformed.push("row " + (i + 2) + " (blank player)"); return; }
      const year = r[ih.year], yearKey = String(year).trim();
      if (!yearKey || isNaN(parseInt(yearKey, 10))){ malformed.push(player + " (bad year \"" + yearKey + "\")"); return; }
      const status = "status" in ih ? String(r[ih.status] || "").trim() : "";
      if (/^(out|declined)$/i.test(status)){ contradicted.push(player + " (" + status + ")"); return; }
      const key = yearKey + "|" + pcNorm_(player);
      if (existing.has(key)){ already++; return; }

      const row = new Array(width).fill("");
      row[fh.year] = year;                                  // raw cell value — number stays a number
      row[fh.player] = player;
      row[fh.status] = "In";                                // FIELD_STATUS vocab (E-VOCAB)
      row[fh.team] = "";                                    // E-TEAM: blank until the Friday draft
      const k2 = pcNorm_(player);
      const prior = latestSince[k2];
      const returning = fieldAnyYear.has(k2);
      // TRUE first-timer (no Field row anywhere): since = the promoted year,
      // his rookie year by definition. A RETURNING player whose rows never
      // recorded a since gets BLANK — defaulting the invite year would badge
      // a veteran ROOKIE on the site, a fabricated rookie-ness (S12).
      row[fh.since] = prior ? prior.since : (returning ? "" : parseInt(yearKey, 10));
      if ("deposit" in fh) row[fh.deposit] = false;         // unchecked checkbox
      newRows.push(row);
      existing.add(key);                                    // a duplicate committed row can't double-append
      promoted.push(player + (returning ? (prior ? "" : " (since unknown — fill it)") : " (rookie)"));
    });

    if (newRows.length){
      const start = fld.getLastRow() + 1;
      const over = start + newRows.length - 1 - fld.getMaxRows();
      if (over > 0) fld.insertRowsAfter(fld.getMaxRows(), over); // getRange past maxRows throws
      fld.getRange(start, 1, newRows.length, width).setValues(newRows);
    }

    const lines = [
      newRows.length ? "Promoted " + newRows.length + ": " + promoted.join(", ") : "Promoted 0.",
      already ? already + " already in Field (untouched)." : "",
      contradicted.length ? "NOT promoted — committed but status says no: " + contradicted.join(", ") + ". Fix one or the other." : "",
      malformed.length ? "Skipped malformed: " + malformed.join(", ") + "." : "",
      newRows.length ? "Next: fill handicaps on Field; deposits tick as money lands." : "",
    ].filter(Boolean);
    Logger.log("promoteCommitted: " + lines.join(" | "));
    ui.alert("GFY promote", lines.join("\n\n"), ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function seedInvites(){
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inv = ss.getSheetByName("Invites"), fld = ss.getSheetByName("Field");
  if (!inv || !fld){ ui.alert("GFY seed", "Need both an Invites and a Field tab — nothing written.", ui.ButtonSet.OK); return; }
  const ih = pcHeaderMap_(inv), fh = pcHeaderMap_(fld);
  const needInv = ["year", "player"].filter(c => !(c in ih));
  const needFld = ["year", "player"].filter(c => !(c in fh));
  if (needInv.length || needFld.length){
    ui.alert("GFY seed", "Missing header(s) — Invites: " + (needInv.join(", ") || "ok") + " · Field: " + (needFld.join(", ") || "ok") + ". Nothing written.", ui.ButtonSet.OK);
    return;
  }

  // Pre-lock read feeds ONLY the prompt default — every set the append
  // depends on is re-read under the lock below (review F4: computing the
  // NOCLOBBER sets before a modal prompt and outside the lock let a
  // concurrent run append duplicates).
  const invValsPeek = inv.getLastRow() > 1 ? inv.getRange(2, 1, inv.getLastRow() - 1, inv.getLastColumn()).getValues() : [];
  const fldValsPeek = fld.getLastRow() > 1 ? fld.getRange(2, 1, fld.getLastRow() - 1, fld.getLastColumn()).getValues() : [];
  const fldYearsPeek = fldValsPeek.map(r => parseInt(r[fh.year], 10)).filter(y => y > 2000 && y < 2100);
  if (!fldYearsPeek.length){ ui.alert("GFY seed", "Field has no dated rows to seed from.", ui.ButtonSet.OK); return; }
  const invYearsPeek = invValsPeek.map(r => parseInt(r[ih.year], 10)).filter(y => y > 2000 && y < 2100);
  // Default = the Invites tab's own newest season when it has one (the
  // active outreach season), else Field's newest + 1. Never max(field+1,…):
  // once Promote has created next-season Field rows, that formula jumps a
  // year ahead and a blank-accept mass-seeds the wrong season (review F1).
  // Worst case of THIS default (stale tab, new season wanted): it re-offers
  // the finished season, dedup seeds 0, the report says so — safe, retype.
  const def = invYearsPeek.length ? Math.max.apply(null, invYearsPeek) : Math.max.apply(null, fldYearsPeek) + 1;

  const resp = ui.prompt("GFY seed",
    "Seed Invites for which season? Blank = " + def + ". Sources: the three Field seasons before it, veterans first.",
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const typed = String(resp.getResponseText() || "").trim();
  const seedYear = typed === "" ? def : parseInt(typed, 10);
  if (!(seedYear > 2000 && seedYear < 2100)){ ui.alert("GFY seed", 'Season "' + typed + '" is not a year — nothing written.', ui.ButtonSet.OK); return; }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)){ ui.alert("GFY seed", "Sheet is busy — try again in a moment.", ui.ButtonSet.OK); return; }
  let lines;
  try {
    // Authoritative reads — inside the lock, after the prompt.
    const invVals = inv.getLastRow() > 1 ? inv.getRange(2, 1, inv.getLastRow() - 1, inv.getLastColumn()).getValues() : [];
    const fldVals = fld.getLastRow() > 1 ? fld.getRange(2, 1, fld.getLastRow() - 1, fld.getLastColumn()).getValues() : [];

    // Candidates: distinct players from the trailing-3 window (mirrors the
    // site's F-UNIV union); canonical casing from each player's most recent
    // windowed row, but `since` from the most recent row that HAS one —
    // a blank since on the newest row must not turn a 2019 veteran into
    // Infinity and sort him after the rookies (review F5; same rule as
    // promoteCommitted's latestSince).
    const win = new Set([seedYear - 1, seedYear - 2, seedYear - 3].map(String));
    const latest = {};                                      // pcNorm(player) -> {name, y}
    const sinceBest = {};                                   // pcNorm(player) -> {y, since}
    fldVals.forEach(r => {
      const p = String(r[fh.player] || "").trim(); if (!p) return;
      const yk = String(r[fh.year]).trim(); if (!win.has(yk)) return;
      const k = pcNorm_(p), y = parseInt(yk, 10);
      if (!latest[k] || y > latest[k].y) latest[k] = { name: p, y: y };
      const sv = ("since" in fh) ? String(r[fh.since] == null ? "" : r[fh.since]).trim() : "";
      if (sv !== "" && (!sinceBest[k] || y > sinceBest[k].y)) sinceBest[k] = { y: y, since: sv };
    });
    // `out` is for good (F-DECLINED): any past out row — Field status or
    // Invites status, any year — keeps them off the seed. Declined comes
    // back into consideration on its own, so it seeds normally.
    const outSet = new Set();
    if ("status" in fh) fldVals.forEach(r => { if (/^out$/i.test(String(r[fh.status] || "").trim())) outSet.add(pcNorm_(String(r[fh.player] || ""))); });
    if ("status" in ih) invVals.forEach(r => { if (/^out$/i.test(String(r[ih.status] || "").trim())) outSet.add(pcNorm_(String(r[ih.player] || ""))); });
    const existing = new Set(invVals
      .filter(r => String(r[ih.year]).trim() === String(seedYear) && String(r[ih.player] || "").trim())
      .map(r => pcNorm_(r[ih.player])));

    const sinceNum = k => { const n = parseInt(sinceBest[k] ? sinceBest[k].since : "", 10); return isNaN(n) ? Infinity : n; };
    const picks = Object.keys(latest).filter(k => !outSet.has(k) && !existing.has(k));
    const skippedOut = Object.keys(latest).filter(k => outSet.has(k) && !existing.has(k)).map(k => latest[k].name);
    // Veterans first: earliest since, junk/blank since last (Infinity), name
    // ties alphabetical. || relies on NaN (Infinity-Infinity) being falsy.
    picks.sort((a, b) => (sinceNum(a) - sinceNum(b)) || (a < b ? -1 : a > b ? 1 : 0));

    const width = inv.getLastColumn();
    const rows = picks.map(k => {
      const row = new Array(width).fill("");
      row[ih.year] = seedYear;
      row[ih.player] = latest[k].name;
      if ("invited" in ih) row[ih.invited] = false;
      if ("responded" in ih) row[ih.responded] = false;
      if ("committed" in ih) row[ih.committed] = false;
      return row;
    });
    if (rows.length){
      const start = inv.getLastRow() + 1;
      const over = start + rows.length - 1 - inv.getMaxRows();
      if (over > 0) inv.insertRowsAfter(inv.getMaxRows(), over); // getRange past maxRows throws
      inv.getRange(start, 1, rows.length, width).setValues(rows);
    }

    lines = [
      rows.length ? "Seeded " + rows.length + " for " + seedYear + " (veterans first): " + picks.map(k => latest[k].name).join(", ")
                  : "Seeded 0 — everyone in the window is already on Invites (or out).",
      existing.size ? existing.size + " already on Invites for " + seedYear + " (untouched)." : "",
      skippedOut.length ? "Skipped (marked out — for good): " + skippedOut.join(", ") + ". Add by hand to override." : "",
      "New names you add yourself: record the sponsor in invited_by.",
    ].filter(Boolean);
  } finally {
    lock.releaseLock();
  }
  Logger.log("seedInvites: " + lines.join(" | "));
  ui.alert("GFY seed", lines.join("\n\n"), ui.ButtonSet.OK);
}
