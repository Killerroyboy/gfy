/** @OnlyCurrentDoc */
/**
 * GFY sheet polish — spec §13 E-SCRIPT/E-REPAIR/E-IDEM/E-VOCAB.
 * Paste into Extensions → Apps Script ON THE LIVE GFY SHEET and run polish().
 * Idempotent: re-running never changes cell values; protections are reused;
 * Course autofill only writes an empty tab or the known sample rows.
 * Operates on the ACTIVE spreadsheet only — no ids, no urls, never the vault.
 */
const FIELD_STATUS = ["In","wd","out","declined"];   // E-VOCAB — mirrors the site parser exactly
const INVITES_STATUS = ["declined","out"];           // F-DECLINED
const CHECKBOX_COLS = { "Field": ["deposit"], "Calcutta": ["collected"], "Invites": ["invited","responded"], "Ledger": ["settled"] }; // CLOSED list
const DROPDOWNS = { "Field": { "status": FIELD_STATUS }, "Invites": { "status": INVITES_STATUS } };
const COURSE_DATA = [ [1,4,319],[2,5,469],[3,4,407],[4,3,124],[5,4,357],[6,4,348],[7,4,391],[8,3,180],[9,5,499],
  [10,4,286],[11,4,354],[12,4,344],[13,3,148],[14,4,406],[15,5,433],[16,4,352],[17,3,151],[18,5,533] ];
const SAMPLE_COURSE = [ [1,4,385],[2,4,410],[3,3,175] ];
const TAG = "gfy-polish";

function polish(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    protectHeader_(sh);
    applyCheckboxes_(sh, CHECKBOX_COLS[name] || []);
    applyDropdowns_(sh, DROPDOWNS[name] || {});
    if (name === "Field") { repairHandicap_(sh); colorField_(sh); }
    if (name === "Rooms") colorRooms_(sh);
    if (name === "Course") autofillCourse_(sh);
  });
  buildStartHere_(ss);
  Logger.log("polish complete");
}

function headerIndex_(sh, header){
  const heads = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  return heads.findIndex(h => String(h).trim().toLowerCase() === header) + 1; // 0 = not found
}
function dataRange_(sh, col){ return sh.getRange(2, col, Math.max(1, sh.getMaxRows() - 1), 1); }

function protectHeader_(sh){
  sh.setFrozenRows(1);
  const existing = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .find(p => p.getDescription() === TAG);            // E-IDEM: reuse, never duplicate
  if (!existing){
    const p = sh.getRange("1:1").protect();
    p.setDescription(TAG).setWarningOnly(true);        // warn, never block
  }
}
function applyCheckboxes_(sh, cols){
  cols.forEach(c => {
    const i = headerIndex_(sh, c); if (!i) return;
    // Values untouched (E-IDEM): checkbox validation maps existing TRUE/FALSE in place.
    dataRange_(sh, i).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  });
}
function applyDropdowns_(sh, spec){
  Object.keys(spec).forEach(c => {
    const i = headerIndex_(sh, c); if (!i) return;
    dataRange_(sh, i).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(spec[c], true).setAllowInvalid(true).build()); // E-VOCAB: warn-mode, never reject
  });
}
function repairHandicap_(sh){
  const i = headerIndex_(sh, "handicap"); if (!i) return;
  const r = dataRange_(sh, i);
  r.clearDataValidations();                             // E-REPAIR: strip the checkbox sweep
  const vals = r.getValues();
  let changed = false;
  vals.forEach(row => {                                 // clear ONLY literal TRUE/FALSE junk
    const v = row[0];
    if (v === true || v === false || v === "TRUE" || v === "FALSE"){ row[0] = ""; changed = true; }
  });
  if (changed) r.setValues(vals);
  r.setNumberFormat("0.#");                             // handicap is a typed number (Riley ruling)
}
function colorField_(sh){
  const dep = headerIndex_(sh, "deposit"), since = headerIndex_(sh, "since");
  const rules = [];
  if (dep) rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND($A2<>"",${colLetter_(dep)}2=FALSE)`)
    .setBackground("#f4cccc")
    .setRanges([sh.getRange(2, 1, Math.max(1, sh.getMaxRows() - 1), Math.max(1, sh.getLastColumn()))]).build());
  if (since) rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND($A2<>"",${colLetter_(since)}2=$A2)`)     // rookie: since == row's season
    .setBackground("#fff2cc")
    .setRanges([sh.getRange(2, 1, Math.max(1, sh.getMaxRows() - 1), Math.max(1, sh.getLastColumn()))]).build());
  if (sh.getConditionalFormatRules().length > rules.length)
    Logger.log(sh.getName() + ": replacing ALL conditional formatting — hand-added rules are erased (polish owns CF on this sheet)");
  sh.setConditionalFormatRules(rules);                  // E-IDEM: rules replaced wholesale each run
  // NOTE: blank `team` is NEVER colored — teams are drafted Friday night (E-TEAM).
}
function colorRooms_(sh){
  const player = headerIndex_(sh, "player"); if (!player) return;
  const c = colLetter_(player);
  const field = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Field");
  const pcol = field ? colLetter_(headerIndex_(field, "player") || 2) : "B";
  const rules = [SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND(${c}2<>"",LEFT(${c}2,6)<>"guest:",ISNA(MATCH(${c}2,INDIRECT("Field!${pcol}:${pcol}"),0)))`)
    .setBackground("#fce5cd")
    .setRanges([sh.getRange(2, 1, Math.max(1, sh.getMaxRows() - 1), Math.max(1, sh.getLastColumn()))]).build()];
  if (sh.getConditionalFormatRules().length > rules.length)
    Logger.log(sh.getName() + ": replacing ALL conditional formatting — hand-added rules are erased (polish owns CF on this sheet)");
  sh.setConditionalFormatRules(rules);
}
function autofillCourse_(sh){
  const last = sh.getLastRow();
  const cur = last >= 2 ? sh.getRange(2, 1, last - 1, 3).getValues()
      .filter(r => String(r[0]).trim() !== "") : [];
  const eq = (a, b) => a.length === b.length && a.every((r, i) => r.every((v, j) => String(v) === String(b[i][j])));
  if (cur.length === 0 || eq(cur, SAMPLE_COURSE)){
    sh.getRange(2, 1, COURSE_DATA.length, 3).setValues(COURSE_DATA);
    Logger.log("Course: wrote real 18 (C-REAL)");
  } else if (eq(cur, COURSE_DATA)) {
    Logger.log("Course: already real data — untouched");
  } else {
    Logger.log("Course: hand-edited rows found — left untouched (E-IDEM)"); // hand-edits win
  }
}
function colLetter_(i){ let s = ""; while (i > 0){ s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); } return s; }
function buildStartHere_(ss){
  const name = "START HERE";
  let sh = ss.getSheetByName(name); if (!sh) sh = ss.insertSheet(name, 0);
  const existing = sh.getLastRow() > 0 && sh.getLastColumn() > 0
    ? sh.getDataRange().getValues() : [];
  // CONFIG-HOME MIGRATION: the old "Scoring form URL (paste once)" cell is
  // retired — score_endpoint/form_url now live on the Info tab. Never
  // silently drop a value someone already pasted here (E-IDEM): an
  // old-style row (from a polish() run before this migration) hands its
  // value forward into the new migrated slot below; once migrated, every
  // later run keeps carrying forward whatever sits in that slot, content-
  // anchored not coordinate-anchored, exactly like the old preserve did.
  const oldStyleRow = existing.find(r => String(r[0]).indexOf("Scoring form URL") === 0);
  const movedLabelIdx = existing.findIndex(r => String(r[0]).indexOf("Scoring config moved") === 0);
  const movedValueRow = movedLabelIdx >= 0 ? existing[movedLabelIdx + 1] : null;
  const keep = oldStyleRow ? oldStyleRow[1] : (movedValueRow ? movedValueRow[1] : "");
  sh.clear();
  const url = ss.getUrl();                                    // runtime — no ids in source (F-START-LINKS)
  const link = tab => { const s = ss.getSheetByName(tab); return s ? `=HYPERLINK("${url}#gid=${s.getSheetId()}","${tab}")` : tab; };
  const eventWindow = inEventWindow_(ss);
  const roster = startHereRoster_(ss);                        // current season's team labels, F-START-LINKS
  const captainUrl_ = team => "https://killerroyboy.github.io/gfy/#score?team=" + encodeURIComponent(team);
  const rows = [
    ["GFY — START HERE", ""],
    ["", ""],
    [eventWindow ? "EVENT WEEK — what matters now:" : "OFF-SEASON — what matters now:", ""],
    ...(eventWindow
      ? [["Scores land via the scoring form (link below)", ""], ["Watch the board", link("Scores")]]
      : [["Collections: tick deposits on", link("Field")], ["Invites: tick invited/responded on", link("Invites")], ["Rooms:", link("Rooms")]]),
    ["", ""],
    ["Scoring config moved → Info tab (score_endpoint + form_url)" + (keep ? " — old value preserved below, copy it to Info!" : ""), ""],
    ["", keep],
    ["", ""],
    ["COLOR LEGEND", ""],
    ["Red row = deposit unpaid", ""], ["Gold tint = rookie (since == this season)", ""], ["Orange tint = Rooms name not on Field", ""],
    ["Names: FIRST + LAST on Field / Invites / Rooms (and the vault), spelled identically everywhere.", ""],
    ["", ""],
    ["CAPTAIN SCORING LINKS — one per team, share directly:", ""],
    ...roster.map(team => [team, `=HYPERLINK("${captainUrl_(team)}","${captainUrl_(team)}")`]),
    ["", ""],
    ["FORM TEAM DROPDOWN — paste exactly this list (select column A rows below, copy, paste into the Form's Team option field):", ""],
    ...roster.map(team => [team, ""]),
    ["", ""],
    ["Team names freeze once links go out; a rename must also be applied to Scores.", ""],
    ["", ""],
    ["Before ANY email send round: npm run presend (see repo README)", ""],
    ["Polish/repair the sheet: Extensions → Apps Script → run polish()", ""],
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.setColumnWidth(1, 340); sh.getRange("A1").setFontSize(14).setFontWeight("bold");
  orderTabs_(ss, eventWindow);
}
// Review round 1: both helpers below check ONE combined condition and
// either fully delegate to tools/sheet-triggers.gs's canonical
// rosterTeams_/firstTeeYear_ (when that file has been pasted into the same
// Apps Script project — the README-recommended setup) or fully fall back to
// a standalone copy (when it hasn't been, e.g. polish() run well before the
// live-scoring triggers setup). Never a mix of one delegated + one local —
// that would let the two lanes disagree on "the current year" mid-call.
// LOCKSTEP: keep this in sync with tools/sheet-triggers.gs's rosterTeams_ /
// firstTeeYear_ (see the LOCKSTEP comments there) — the fallback copies
// duplicate their exact semantics, including F-NKEY's normalization.
function startHereCanonicalAvailable_(){
  return typeof rosterTeams_ === "function" && typeof firstTeeYear_ === "function";
}
function startHereYear_(ss){
  if (startHereCanonicalAvailable_()) return firstTeeYear_(ss);   // canonical, same-project case
  const info = ss.getSheetByName("Info"); if (!info) return null;
  for (const r of info.getDataRange().getValues()){
    if (String(r[0]).trim().toLowerCase() === "first_tee"){
      const v = r[1]; const y = v instanceof Date ? v.getFullYear() : parseInt(String(v).slice(0, 4), 10);
      return (y > 2000 && y < 2100) ? y : null;
    }
  }
  return null;
}
function startHereRoster_(ss){
  if (startHereCanonicalAvailable_()) return Array.from(rosterTeams_(ss, firstTeeYear_(ss)).values());
  // Standalone fallback — polish() must work whether or not sheet-triggers.gs
  // has been pasted into this project yet. Same semantics as rosterTeams_:
  // Field's team column, deduped by F-NKEY-normalized text (trim + collapse
  // internal whitespace + casefold — identical to NORM in sheet-triggers.gs
  // and nkey in index.html), scoped to the current first_tee year when Field
  // has a year column.
  const sh = ss.getSheetByName("Field"); if (!sh) return [];
  const tCol = headerIndex_(sh, "team"); if (!tCol) return [];
  const yCol = headerIndex_(sh, "year");
  const year = startHereYear_(ss);
  const vals = sh.getDataRange().getValues();
  const seen = new Set(); const out = [];
  for (let i = 1; i < vals.length; i++){
    if (yCol && year != null && String(vals[i][yCol - 1]) !== String(year)) continue;
    const raw = String(vals[i][tCol - 1] || "").trim(); if (!raw) continue;
    const key = raw.replace(/\s+/g, " ").toLowerCase();       // F-NKEY: trim + collapse + casefold, matches NORM/nkey exactly
    if (!seen.has(key)){ seen.add(key); out.push(raw); }
  }
  return out;
}
function inEventWindow_(ss){
  const info = ss.getSheetByName("Info"); if (!info) return false;
  for (const r of info.getDataRange().getValues()){
    if (String(r[0]).trim().toLowerCase() === "first_tee"){
      const t = new Date(String(r[1])); if (isNaN(t)) return false;
      return Math.abs(Date.now() - t.getTime()) < 3 * 864e5;   // first_tee ±3 days (F-START)
    }
  }
  return false;
}
function orderTabs_(ss, eventWindow){
  const want = eventWindow ? ["START HERE","Scores","Field","Pairings"] : ["START HERE","Field","Invites","Rooms"];
  want.forEach((n, i) => { const s = ss.getSheetByName(n); if (s){ ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); } });
}
