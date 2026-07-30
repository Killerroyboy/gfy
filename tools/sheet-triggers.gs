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

/* ---------- shared validator (§18 SC-VALIDATE) ---------- */
// ONE validator for both lanes: the form trigger below AND doPost. Caller holds NO lock;
// applyScore_ owns the DocumentLock itself (F-LOCK: concurrent shotgun-start submissions).
// p = {team, round, hole, score} (string or number inputs both fine — parsed here).
function applyScore_(ss, p){
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return {ok:false, verdict:"busy — resubmit", team:p.team, round:0, holes:null};
  try{
    const year = firstTeeYear_(ss);                            // F-YEAR: the form/endpoint serve the current event only
    if (!year) return {ok:false, verdict:"Info first_tee unreadable — check sheet setup", team:p.team, round:0, holes:null};
    const roster = rosterTeams_(ss, year);                     // Map NORM(team) -> canonical casing, scoped to this year (F-NKEY)
    const tk = NORM(p.team);
    const team = roster.get(tk);
    if (!team) return {ok:false, verdict:"team not in roster", team:p.team, round:0, holes:null};
    const round = parseInt(p.round, 10), hole = parseInt(p.hole, 10), score = parseInt(p.score, 10);
    if (round !== 1 && round !== 2) return {ok:false, verdict:"invalid round", team:team, round:round || 0, holes:null};
    if (!(hole >= 1 && hole <= 18)) return {ok:false, verdict:"invalid hole", team:team, round:round, holes:null};
    if (!(score >= 1 && score <= 19)) return {ok:false, verdict:"invalid score", team:team, round:round, holes:null};
    return writeScore_(ss, year, team, round, hole, score);    // {ok, verdict, team, round, holes}
  } finally { lock.releaseLock(); }
}

/* ---------- form writer (F-WRITE, F-YEAR, F-NKEY) ---------- */
function onScoreFormSubmit(e){
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ans = namedAnswers_(e);                              // {team, round, hole, score} by header prefix
    const r = applyScore_(ss, ans);                            // shared validator+writer; owns its own lock
    markResponse_(e, r.ok ? "applied" : "rejected: " + r.verdict);
  } catch(err) { markResponse_(e, "rejected: internal error — " + String(err).slice(0, 80)); }
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
  const roundNum = parseInt(round, 10);
  const rTotalCol = head.indexOf("r" + roundNum);            // r1/r2 round-total column for THIS row's round, if present
  for (let i = 1; i < vals.length; i++){
    if (String(vals[i][yc]) === String(year) && NORM(vals[i][tc]) === NORM(team)
        && parseInt(vals[i][rc], 10) === roundNum){
      if (rTotalCol >= 0 && String(vals[i][rTotalCol] || "").trim() !== ""){
        // §18 SC-VALIDATE totals guard: a round total already lives on this row — never silently
        // convert it to hole-scoring. Row is left untouched; caller must clear r1/r2 first.
        return {ok:false, verdict:"round total already entered — clear r1/r2 first", team:team, round:roundNum, holes:null};
      }
      sh.getRange(i + 1, hc + 1).setValue(score);
      const updated = sh.getRange(i + 1, 1, 1, head.length).getValues()[0];
      return {ok:true, verdict:"applied", team:team, round:roundNum, holes:holesMap_(head, updated)};
    }
  }
  const row = new Array(head.length).fill("");
  row[yc] = year; row[tc] = team; row[rc] = roundNum; row[hc] = score;
  sh.appendRow(row);
  return {ok:true, verdict:"applied", team:team, round:roundNum, holes:holesMap_(head, row)};
}
function holesMap_(head, rowValues){
  // builds {h1:…, …, h18:…} from a Scores row — the "team's full current round row" the client paints as truth
  const out = {};
  for (let h = 1; h <= 18; h++){
    const idx = head.indexOf("h" + h);
    out["h" + h] = idx >= 0 ? rowValues[idx] : "";
  }
  return out;
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

/* ---------- JSON endpoint (§18 SC-WRITE) + idempotency ring (SC-IDEMPOTENT) ---------- */
function doPost(e){
  let p; try{ p = JSON.parse(e.postData.contents); }catch(err){ return jsonOut_({ok:false, verdict:"bad request", team:"", round:0, holes:null}); }
  const key = "idem:" + String(p.client_id || "").slice(0, 40) + ":" + String(p.seq || "");
  const props = PropertiesService.getScriptProperties();
  if (p.client_id && p.seq != null){
    const prior = props.getProperty(key);
    if (prior) return ContentService.createTextOutput(prior).setMimeType(ContentService.MimeType.JSON);
  }
  let r;
  try{ r = applyScore_(SpreadsheetApp.getActive(), p); }
  catch(err){
    // Never cache this (same reasoning as the busy exclusion, one step earlier: a renamed/
    // missing tab or other unexpected sheet state is a transient problem, not a stable answer —
    // a retry after Riley fixes the sheet must re-execute, not replay a frozen "internal error"
    // forever). Returning here, before the cache-write block below, is what guarantees that.
    return jsonOut_({ok:false, verdict:"internal error", team:String((p && p.team) || ""), round:0, holes:null});
  }
  const out = JSON.stringify(r);
  if (p.client_id && p.seq != null && r.verdict !== "busy — resubmit"){
    props.setProperty(key, out);                             // bounded: cleanupIdem_ below
    cleanupIdem_(props);
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}
function doGet(){
  try{
    const ss = SpreadsheetApp.getActive();
    const year = firstTeeYear_(ss);
    return jsonOut_({ok:true, year:year, teams:Array.from(rosterTeams_(ss, year).values())});
  } catch(err){ return jsonOut_({ok:false, verdict:"internal error"}); }
}
function jsonOut_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
// Keep at most 600 idem keys (15 teams x 2 rounds x 18 holes + retries headroom).
// getKeys() order is unspecified by Apps Script — acceptable: the ring only bounds growth,
// exact eviction order is NOT load-bearing (a replay racing eviction just re-executes once more).
function cleanupIdem_(props){
  const keys = props.getKeys().filter(k => k.indexOf("idem:") === 0);
  if (keys.length > 600) keys.slice(0, keys.length - 600).forEach(k => props.deleteProperty(k));
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
