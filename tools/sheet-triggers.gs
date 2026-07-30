/** @OnlyCurrentDoc */
/**
 * GFY live-scoring + paid-date triggers — spec §14 (hardened).
 * One-time: paste into the LIVE sheet's Apps Script (same project as polish
 * is fine), run setup() once, authorize. teardown() removes the triggers.
 * The scoring Google Form must target this spreadsheet (README walkthrough).
 */
const NORM = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase(); // S-KEY / F-NKEY

function setup(){
  teardown();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("onScoreFormSubmit").forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger("onDepositEdit").forSpreadsheet(ss).onEdit().create();
  Logger.log("triggers installed: onScoreFormSubmit, onDepositEdit");
}
function teardown(){
  ScriptApp.getProjectTriggers().forEach(t => {
    if (["onScoreFormSubmit","onDepositEdit"].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
}

/* ---------- form writer (F-WRITE, F-LOCK, F-YEAR, F-NKEY) ---------- */
function onScoreFormSubmit(e){
  const lock = LockService.getDocumentLock();               // F-LOCK: concurrent shotgun-start submissions
  try { lock.waitLock(10000); }
  catch(_) { markResponse_(e, "rejected: busy — resubmit"); return; }
  try {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const ans = namedAnswers_(e);                            // {team, round, hole, score} by header prefix
      const year = firstTeeYear_(ss);                          // F-YEAR: the form serves the current event only
      if (!year){ markResponse_(e, "rejected: Info first_tee unreadable — check sheet setup"); return; }
      const roster = rosterTeams_(ss, year);                   // Map NORM(team) -> canonical casing, scoped to this year
      const team = roster.get(NORM(ans.team));
      const round = String(parseInt(ans.round, 10));
      const hole = parseInt(ans.hole, 10);
      const score = parseInt(ans.score, 10);
      if (!team){ markResponse_(e, "rejected: team not in roster"); return; }
      if (!(round === "1" || round === "2")){ markResponse_(e, "rejected: invalid round"); return; }
      if (!(hole >= 1 && hole <= 18)){ markResponse_(e, "rejected: invalid hole"); return; }
      if (!(score >= 1 && score <= 19)){ markResponse_(e, "rejected: invalid score"); return; }
      writeScore_(ss, year, team, round, hole, score);
      markResponse_(e, "applied");
    } catch(err) { markResponse_(e, "rejected: internal error — " + String(err).slice(0, 80)); }
  } finally { lock.releaseLock(); }
}
function namedAnswers_(e){
  // e.namedValues: {questionTitle: [answer]} — match by title prefix so cosmetic renames survive
  const nv = e.namedValues || {}; const out = {};
  Object.keys(nv).forEach(k => {
    if (!nv[k] || !String(nv[k][0] || "").trim()) return;
    const key = NORM(k);
    if (key.startsWith("team") && key.includes("score")) out.score = nv[k][0];
    else if (key.startsWith("team")) out.team = nv[k][0];
    else if (key.startsWith("round")) out.round = nv[k][0];
    else if (key.startsWith("hole")) out.hole = nv[k][0];
    else if (key.startsWith("score")) out.score = nv[k][0];
  });
  return out;
}
function rosterTeams_(ss, year){
  const sh = ss.getSheetByName("Field"); const m = new Map();
  if (!sh) return m;
  const vals = sh.getDataRange().getValues(); const head = vals[0].map(h => NORM(h));
  const t = head.indexOf("team"), yIdx = head.indexOf("year");
  for (let i = 1; i < vals.length; i++){
    if (yIdx >= 0 && String(vals[i][yIdx]) !== String(year)) continue;
    const raw = String(vals[i][t] || "").trim(); if (raw) m.set(NORM(raw), raw);
  }
  return m;
}
function firstTeeYear_(ss){
  const sh = ss.getSheetByName("Info"); if (!sh) return null;
  const vals = sh.getDataRange().getValues();
  for (const r of vals){ if (NORM(r[0]) === "first_tee"){ const v = r[1]; const y = v instanceof Date ? v.getFullYear() : parseInt(String(v).slice(0, 4), 10); return (y > 2000 && y < 2100) ? y : null; } }
  return null;
}
function writeScore_(ss, year, team, round, hole, score){
  const sh = ss.getSheetByName("Scores");
  const vals = sh.getDataRange().getValues(); const head = vals[0].map(h => NORM(h));
  const yc = head.indexOf("year"), tc = head.indexOf("team"), rc = head.indexOf("round"), hc = head.indexOf("h" + hole);
  if (yc < 0 || tc < 0 || rc < 0 || hc < 0) throw new Error("Scores tab headers missing (need year/team/round/h" + hole + ")");
  for (let i = 1; i < vals.length; i++){
    if (String(vals[i][yc]) === String(year) && NORM(vals[i][tc]) === NORM(team)
        && String(parseInt(vals[i][rc], 10)) === round){
      sh.getRange(i + 1, hc + 1).setValue(score); return;
    }
  }
  const row = new Array(head.length).fill("");
  row[yc] = year; row[tc] = team; row[rc] = parseInt(round, 10); row[hc] = score;
  sh.appendRow(row);
}
function markResponse_(e, status){
  // audit trail on the response row: writes/extends a "status" column on the responses sheet
  try {
    const range = e.range; const sh = range.getSheet();
    let col = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => NORM(h)).indexOf("status") + 1;
    if (!col){ col = sh.getLastColumn() + 1; sh.getRange(1, col).setValue("status"); }
    sh.getRange(range.getRow(), col).setValue(status);
  } catch(_) { Logger.log("markResponse failed: " + status); }
}

/* ---------- paid_date stamp (F-STAMP-IMPL) — never erases, sheet timezone ---------- */
function onDepositEdit(e){
  const sh = e.range.getSheet(); if (sh.getName() !== "Field") return;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => NORM(h));
  const dep = head.indexOf("deposit") + 1, pd = head.indexOf("paid_date") + 1;
  if (!dep || !pd) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  for (let r = e.range.getRow(); r <= e.range.getLastRow(); r++){    // multi-cell pastes: every row
    for (let c = e.range.getColumn(); c <= e.range.getLastColumn(); c++){
      if (c !== dep || r === 1) continue;
      const ticked = sh.getRange(r, dep).getValue() === true;
      const cur = String(sh.getRange(r, pd).getValue() || "").trim();
      if (ticked && !cur) sh.getRange(r, pd).setValue(today);        // blank only; re-tick never overwrites, untick never erases
    }
  }
}
