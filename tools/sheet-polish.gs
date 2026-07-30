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
    .setBackground("#3d2323")
    .setRanges([sh.getRange(2, 1, Math.max(1, sh.getMaxRows() - 1), Math.max(1, sh.getLastColumn()))]).build());
  if (since) rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND($A2<>"",${colLetter_(since)}2=$A2)`)     // rookie: since == row's season
    .setBackground("#33321f")
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
    .setBackground("#3d3223")
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
  const keep = sh.getRange("B7").getValue();                  // preserve Riley's pasted form URL (E-IDEM)
  sh.clear();
  const url = ss.getUrl();                                    // runtime — no ids in source (F-START-LINKS)
  const link = tab => { const s = ss.getSheetByName(tab); return s ? `=HYPERLINK("${url}#gid=${s.getSheetId()}","${tab}")` : tab; };
  const eventWindow = inEventWindow_(ss);
  const rows = [
    ["GFY — START HERE", ""],
    ["", ""],
    [eventWindow ? "EVENT WEEK — what matters now:" : "OFF-SEASON — what matters now:", ""],
    ...(eventWindow
      ? [["Scores land via the scoring form (link below)", ""], ["Watch the board", link("Scores")]]
      : [["Collections: tick deposits on", link("Field")], ["Invites: tick invited/responded on", link("Invites")], ["Rooms:", link("Rooms")]]),
    ["", ""],
    ["Scoring form URL (paste once):", ""],
    ["", ""],
    ["COLOR LEGEND", ""],
    ["Dark red row = deposit unpaid", ""], ["Gold tint = rookie (since == this season)", ""], ["Sage tint = Rooms name not on Field", ""],
    ["", ""],
    ["Before ANY email send round: npm run presend (see repo README)", ""],
    ["Polish/repair the sheet: Extensions → Apps Script → run polish()", ""],
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  if (keep) sh.getRange("B7").setValue(keep);                 // restore the form URL after rebuild
  sh.setColumnWidth(1, 340); sh.getRange("A1").setFontSize(14).setFontWeight("bold");
  ss.setActiveSheet(sh); ss.moveActiveSheet(1);
  orderTabs_(ss, eventWindow);
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
