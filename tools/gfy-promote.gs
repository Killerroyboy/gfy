/** @OnlyCurrentDoc */
/**
 * GFY accept→Field promotion — the invites funnel's missing middle step.
 * Paste into the LIVE sheet's Apps Script project (same project as polish/
 * triggers is fine) and reload the sheet — a "GFY" menu appears.
 *
 * Workflow: bulk-add invitees on Invites (tick `invited`); when someone says
 * yes, tick `committed`; then GFY → "Promote committed → Field" appends a
 * Field row for everyone committed who doesn't already have one for that
 * year: team BLANK (straight into the draft pool — E-TEAM, teams are drafted
 * Friday night), `since` carried from the player's latest prior Field row
 * (or set to the promoted year for a first-timer — their rookie year by
 * definition), status "In", deposit unchecked. Handicap stays yours to fill.
 *
 * NOCLOBBER: an existing (year, player) Field row is never duplicated or
 * touched — re-running is always safe. A row committed AND out/declined is
 * contradictory and is reported, never promoted (F-DECLINED). The SITE never
 * reads `committed`; a Field row remains the one meaning of committed (A1).
 * tools/event-ready.mjs WARNs on committed-but-unpromoted rows as a nudge.
 */

// LOCKSTEP with NORM in sheet-triggers.gs / nkey in index.html / NKEY in
// event-ready.mjs (F-NKEY: trim + collapse internal whitespace + casefold).
// Own copy under a unique name — same-project files share one global scope,
// so redefining NORM/headerIndex_ here would silently shadow theirs.
const pcNorm_ = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const pcYes_ = v => v === true || /^(y|yes|true|paid|in|1)$/i.test(String(v || "").trim()); // mirrors index.html yes()

function onOpen(){
  const menu = SpreadsheetApp.getUi().createMenu("GFY")
    .addItem("Promote committed → Field", "promoteCommitted");
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

    // Existing Field membership (NOCLOBBER key) + each player's latest since.
    const existing = new Set();
    const latestSince = {};                                 // pcNorm(player) -> {year, since}
    fldVals.forEach(r => {
      const p = String(r[fh.player] || "").trim(); if (!p) return;
      existing.add(String(r[fh.year]).trim() + "|" + pcNorm_(p));
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
      const prior = latestSince[pcNorm_(player)];
      row[fh.since] = prior ? prior.since : parseInt(yearKey, 10); // first-timer: rookie year by definition
      if ("deposit" in fh) row[fh.deposit] = false;         // unchecked checkbox
      newRows.push(row);
      existing.add(key);                                    // a duplicate committed row can't double-append
      promoted.push(player + (prior ? "" : " (rookie)"));
    });

    if (newRows.length) fld.getRange(fld.getLastRow() + 1, 1, newRows.length, width).setValues(newRows);

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
