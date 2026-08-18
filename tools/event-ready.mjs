#!/usr/bin/env node
/* §24 R-READY — event-ready preflight. READ-ONLY, stdout-only, exit 0 iff no
   FAIL (WARN/INFO never change the exit code). Header states the residue
   limit honestly: this tool never claims the sheet "is clean", only "no
   verbatim residue". */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readConfig } from "./presend-check.mjs";
const HERE=dirname(fileURLToPath(import.meta.url));

export function parseCsv(text){            // minimal quoted-field CSV → array of arrays
  const rows=[[""]]; let q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], row=rows[rows.length-1];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){ row[row.length-1]+='"'; i++; } else q=false; }
           else row[row.length-1]+=c; }
    else if(c==='"') q=true;
    else if(c===",") row.push("");
    else if(c==="\n"){ if(row.length===1&&row[0]==="") row.pop(); rows.push([""]); }
    else if(c!=="\r") row[row.length-1]+=c;
  }
  const last=rows[rows.length-1];
  if(last.length===1&&last[0]==="") rows.pop();
  return rows;
}
export function toRows(grid){              // header row → array of objects, lowercase keys, trimmed
  const head=(grid[0]||[]).map(h=>String(h).trim().toLowerCase());
  return grid.slice(1).map(cells=>{ const o={}; head.forEach((h,i)=>o[h]=String(cells[i]??"").trim()); return o; });
}

export function checkFirstTee(firstTee, now){
  const m=String(firstTee||"").match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  if(!m) return {level:"FAIL", detail:`first_tee unparseable: "${firstTee}" — need ISO with offset, e.g. 2027-08-14T09:00:00-06:00`};
  const t=new Date(firstTee).getTime();
  if(now-t>7*86400000) return {level:"WARN", detail:`first_tee ${m[1]}-${m[2]}-${m[3]} is >7 days past — looks like last year's date (year rollover?)`};
  return {level:"PASS", detail:`first_tee ${firstTee}`};
}

export function checkResidue(tabRows, fingerprints){
  const out=[];
  for(const [tab,rows] of Object.entries(tabRows)){
    const fps=new Set((fingerprints[tab]||[]).map(r=>r.join("")));
    (rows||[]).forEach((cells,i)=>{
      if(fps.has(cells.map(c=>String(c).trim()).join("")))
        out.push({level:"FAIL", detail:`sample-residue: ${tab} row ${i+2} is a VERBATIM template sample row`});
    });
  }
  return out.length?out:[{level:"PASS", detail:"no verbatim template residue (edited-in-place residue is out of reach — eyeball stays in the runbook)"}];
}

// ---- shared date/time helpers (deterministic — no wall-clock reads) ----

const WEEKDAYS=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const MONTHS=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

// UTC-anchored calendar midnight for an ISO-with-offset first_tee string —
// deliberately ignores the clock/offset (only the calendar DATE matters for
// weekday/day-window math; mirrors index.html's scheduleInstants idiom of
// building a byDay map off first_tee's own calendar date).
function teeMidnight(firstTee){
  const m=String(firstTee||"").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return null;
  return { ms: Date.UTC(+m[1], +m[2]-1, +m[3]), year:+m[1] };
}
function byWeekday(teeMid){
  const map={};
  for(let k=-3;k<=3;k++){
    const mid=teeMid+k*86400000;
    const wd=WEEKDAYS[new Date(mid).getUTCDay()];
    if(!(wd in map)) map[wd]=mid;
  }
  return map;
}
// "9:00 am" / "17:30" style clock text → ms-since-midnight, or null.
function parseClock(t){
  const m=String(t||"").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if(!m) return null;
  let h=+m[1]; const mi=m[2]?+m[2]:0, ap=m[3]&&m[3].toLowerCase();
  if(mi>59) return null;
  if(ap){ if(h<1||h>12) return null; if(ap==="pm"&&h<12)h+=12; if(ap==="am"&&h===12)h=0; }
  else if(h>23) return null;
  return (h*60+mi)*60000;
}
// Announce `when` — "YYYY-MM-DD HH:MM" (24h) or bare "YYYY-MM-DD". Copies
// index.html's frozen parseWhen exactly (same interpretation the live
// banner uses) so this check validates fidelity to the runtime, not a
// second opinion about what "parses" means.
function parseWhen(v){
  const m=String(v==null?"":v).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
  if(!m) return null;
  const y=+m[1],mo=+m[2],d=+m[3],hh=m[4]?+m[4]:0,mi=m[5]?+m[5]:0;
  if(y<2000||y>2100||hh>23||mi>59) return null;
  const dt=new Date(y,mo-1,d,hh,mi);
  if(dt.getFullYear()!==y||dt.getMonth()!==mo-1||dt.getDate()!==d) return null;
  return dt.getTime();
}

export function checkSchedule(rows, firstTee, datesProse, now){
  const tee=teeMidnight(firstTee);
  if(!tee) return [{level:"FAIL", detail:`schedule coverage: first_tee unparseable ("${firstTee}") — cannot derive the event window`}];

  // Event-day window for COVERAGE: Info "dates" prose ("Aug 14–16", in
  // first_tee's month) when it parses; otherwise first_tee ±1 day, with an
  // INFO line naming which basis was used (never silently assumed).
  let eventDays=[], basis;
  const pm=String(datesProse||"").trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})$/);
  const mi=pm ? MONTHS.indexOf(pm[1].toLowerCase().slice(0,3)) : -1;
  if(pm && mi>=0){
    for(let d=+pm[2]; d<=+pm[3]; d++) eventDays.push(Date.UTC(tee.year, mi, d));
    basis=`Info dates prose "${datesProse}"`;
  } else {
    eventDays=[-1,0,1].map(k=>tee.ms+k*86400000);
    basis=`fallback first_tee ±1 day (Info dates${datesProse?` "${datesProse}"`:""} unparseable/absent)`;
  }

  const byDay=byWeekday(tee.ms);
  const out=[{level:"INFO", detail:`schedule coverage window basis: ${basis}`}];
  const rowMids=new Set();
  (rows||[]).forEach((r,i)=>{
    const wd=String(r.label||"").trim().toLowerCase();
    const mid=byDay[wd];
    const clk=parseClock(r.time);
    if(mid===undefined || clk===null)
      out.push({level:"FAIL", detail:`schedule row ${i+2} unresolvable (label="${r.label}" time="${r.time}") — Now/Next would never show it`});
    else rowMids.add(mid);
  });
  eventDays.forEach(day=>{
    if(!rowMids.has(day))
      out.push({level:"FAIL", detail:`schedule coverage: no row for event day ${new Date(day).toISOString().slice(0,10)}`});
  });
  if(out.length===1) out.push({level:"PASS", detail:"schedule covers every event day; every row resolves"});
  return out;
}

export function checkPairings(rows, year){
  const yr=(rows||[]).filter(r=>String(r.year)===String(year));
  if(!yr.length) return [{level:"FAIL", detail:`pairings: no rows for ${year}`}];
  const rounds=new Map();
  yr.forEach(r=>{
    const rd=String(r.round||"").trim()||"(blank round)";
    if(!rounds.has(rd)) rounds.set(rd,[]);
    rounds.get(rd).push(r);
  });
  const out=[];
  for(const [rd, rs] of rounds){
    if(!rs.some(r=>parseClock(r.time)!==null))
      out.push({level:"FAIL", detail:`pairings: ${rd} (${year}) has no row with a parseable time`});
  }
  return out.length?out:[{level:"PASS", detail:`pairings: ${rounds.size} round(s) covered for ${year}, each with a time`}];
}

export function checkPars(rows){
  const pars={}, yards={};
  (rows||[]).forEach(r=>{
    const h=parseInt(r.hole,10);
    if(h<1||h>18) return;
    const p=parseInt(r.par,10);
    if(Number.isInteger(p)&&p>0) pars[h]=p;
    const yRaw=String(r.yards??"").trim();
    const y=parseInt(yRaw,10);
    if(yRaw!==""&&Number.isInteger(y)&&y>0) yards[h]=y;
  });
  const out=[];
  const missingPar=[]; for(let h=1;h<=18;h++) if(!pars[h]) missingPar.push(h);
  if(missingPar.length) out.push({level:"FAIL", detail:`course pars: hole(s) ${missingPar.join(",")} missing/non-positive-int (need 18/18)`});
  const missingYards=[]; for(let h=1;h<=18;h++) if(!yards[h]) missingYards.push(h);
  if(missingYards.length) out.push({level:"WARN", detail:`course yards: hole(s) ${missingYards.join(",")} missing/non-int (yards are optional per-hole)`});
  if(!out.length) out.push({level:"PASS", detail:"course: 18/18 pars valid, yards present"});
  return out;
}

export function checkScorer(info){
  const out=[];
  const se=String((info||{}).score_endpoint||"").trim();
  if(!se) out.push({level:"FAIL", detail:"scorer: Info score_endpoint is absent — scoring is unarmed"});
  else if(!/^https:\/\/script\.google\.com\//.test(se))
    out.push({level:"FAIL", detail:`scorer: Info score_endpoint "${se}" is not an https://script.google.com/... URL`});
  else out.push({level:"PASS", detail:`scorer: score_endpoint armed (${se})`});

  const fu=String((info||{}).form_url||"").trim();
  if(!fu) out.push({level:"INFO", detail:"scorer: Info form_url not set (optional by design — the button only shows once pasted, README:314)"});
  else if(!/^https:\/\/(forms\.gle\/|docs\.google\.com\/forms\/)/.test(fu))
    out.push({level:"FAIL", detail:`scorer: Info form_url "${fu}" is not a forms.gle/docs.google.com/forms URL`});
  else out.push({level:"PASS", detail:"scorer: form_url shape OK"});
  return out;
}

export function checkField(rows, year){
  const yr=(rows||[]).filter(r=>String(r.year)===String(year));
  const out=[];
  if(!yr.length){
    out.push({level:"FAIL", detail:`field: no rows for ${year}`});
    return out;
  }
  const missingHcp=yr.filter(r=>String(r.handicap||"").trim()==="");
  if(missingHcp.length)
    out.push({level:"WARN", detail:`field: ${missingHcp.length} of ${yr.length} row(s) for ${year} missing handicap (needed for a net-basis Calcutta)`});
  if(!out.length) out.push({level:"PASS", detail:`field: ${yr.length} row(s) for ${year}, handicaps present`});
  return out;
}

export function checkAnnounce(rows, now, windowStart, windowEnd){
  if(!rows || !rows.length) return [{level:"INFO", detail:"announce: zero rows — first morning must not cry wolf"}];
  const out=[];
  const parsed=rows.map((r,i)=>({r,i,at:parseWhen(r.when)}));
  parsed.forEach(({r,i,at})=>{
    if(at===null) out.push({level:"WARN", detail:`announce row ${i+2} has an unparseable when: "${r.when}"`});
    else if(at-now>24*3600000) out.push({level:"WARN", detail:`announce row ${i+2} when is >24h in the future: "${r.when}"`});
  });
  if(now>=windowStart && now<=windowEnd){
    const resolved=parsed.filter(p=>p.at!==null);
    if(resolved.length){
      const newest=Math.max(...resolved.map(p=>p.at));
      const d=new Date(now); d.setHours(0,0,0,0);
      const dayStart=d.getTime();
      if(newest<dayStart)
        out.push({level:"WARN", detail:"announce: newest post is older than today, inside the event window — no update posted yet this event day"});
    }
  }
  if(!out.length) out.push({level:"PASS", detail:`announce: ${rows.length} row(s), all resolve, none stale`});
  return out;
}

export function checkCrossTab({scores,calcutta,rooms,field}, year){
  const yr=s=>String(s)===String(year);
  const fieldTeams=new Set((field||[]).filter(r=>yr(r.year)).map(r=>String(r.team||"").trim()).filter(Boolean));
  const fieldPlayers=new Set((field||[]).filter(r=>yr(r.year)).map(r=>String(r.player||"").trim()).filter(Boolean));
  const out=[];
  (scores||[]).filter(r=>yr(r.year)).forEach(r=>{
    const t=String(r.team||"").trim();
    if(t && !fieldTeams.has(t)) out.push({level:"FAIL", detail:`cross-tab: scores.team "${t}" (${year}) has no matching Field team`});
  });
  (calcutta||[]).filter(r=>yr(r.year)).forEach(r=>{
    const t=String(r.team||"").trim();
    if(t && !fieldTeams.has(t)) out.push({level:"FAIL", detail:`cross-tab: calcutta.team "${t}" (${year}) has no matching Field team`});
  });
  (rooms||[]).filter(r=>yr(r.year)).forEach(r=>{
    const p=String(r.player||"").trim();
    if(!p || /^guest:/i.test(p)) return;
    if(!fieldPlayers.has(p)) out.push({level:"WARN", detail:`cross-tab: rooms.player "${p}" (${year}) is not in Field and not guest:-prefixed`});
  });
  if(!out.length) out.push({level:"PASS", detail:`cross-tab: scores/calcutta teams and rooms players check out for ${year}`});
  return out;
}

function extractCfgFirstTee(configText){
  const code=String(configText).replace(/\/\/[^\n]*/g,"");
  const m=code.match(/FIRST_TEE:\s*"([^"]*)"/);
  return m?m[1]:"";
}

export function checkFallbackParity(configText, indexHtml, infoRows){
  const out=[];
  const cfgFT=extractCfgFirstTee(configText);
  const infoRow=(infoRows||[]).find(r=>String(r.key||"").trim().toLowerCase()==="first_tee");
  const infoFT=infoRow?String(infoRow.value||"").trim():"";
  if(infoFT && cfgFT && infoFT!==cfgFT)
    out.push({level:"WARN", detail:`fallback parity: config.js FIRST_TEE "${cfgFT}" != Info first_tee "${infoFT}" — the countdown lies whenever Info fails to load`});

  const html=String(indexHtml||"");
  if(!/Schedule not loaded yet — it lives in the sheet's Schedule tab\./.test(html))
    out.push({level:"FAIL", detail:"fallback parity: index.html is missing the pinned honest schedule empty-state string"});

  const factsBlock=(html.match(/<dl class="facts[^"]*"[\s\S]*?<\/dl>/)||[""])[0];
  if(/Aug\s*\d/.test(factsBlock))
    out.push({level:"FAIL", detail:"fallback parity: the facts <dd> block still contains a hardcoded 'Aug \\d'-shaped date literal"});

  if(!out.length) out.push({level:"PASS", detail:"fallback parity: config/Info first_tee agree (or nothing to compare), C-FALLBACK surfaces carry no stale hardcoded facts"});
  return out;
}

// ---------------------------------------------------------------------

const REQUIRED_TABS=["course","field","scores","schedule","pairings","calcutta","rooms"];
const RESIDUE_ONLY_TABS=["payout","ledger","champions","shame","invites"];

export async function main(){
  const args=process.argv.slice(2).filter(a=>a!=="--");
  const yearIx=args.indexOf("--year");
  const yearOverride=yearIx>=0 ? parseInt(args[yearIx+1],10) : null;
  const now=Date.now();

  console.log("=== GFY event-ready preflight (§24 R-READY) ===");
  console.log("Read-only, stdout-only. NOTE on check (a): VERBATIM template-sample-row");
  console.log('matches only — an edited-in-place sample row is out of reach. This tool');
  console.log('never claims the sheet "is clean", only "no verbatim residue"; the morning');
  console.log("eyeball stays in the runbook.\n");

  const results=[];
  const push=r=>{ (Array.isArray(r)?r:[r]).forEach(x=>results.push(x)); };
  function finish(){
    results.forEach(r=>console.log(`${r.level}  ${r.detail}`));
    const anyFail=results.some(r=>r.level==="FAIL");
    process.exit(anyFail?1:0);
  }

  let configText, indexHtml, fingerprints;
  try { configText=readFileSync(join(HERE, "..", "config.js"), "utf8"); }
  catch(e){ push({level:"FAIL", detail:`config.js unreadable: ${e.message}`}); return finish(); }
  try { indexHtml=readFileSync(join(HERE, "..", "index.html"), "utf8"); }
  catch(e){ push({level:"FAIL", detail:`index.html unreadable: ${e.message}`}); return finish(); }
  try { fingerprints=JSON.parse(readFileSync(join(HERE, "sample-fingerprints.json"), "utf8")); }
  catch(e){ push({level:"FAIL", detail:`tools/sample-fingerprints.json unreadable: ${e.message}`}); return finish(); }

  const { pub, gids } = readConfig(configText);
  if(!pub){ push({level:"FAIL", detail:"config.js has no PUB_ID — is the sheet wired?"}); return finish(); }

  const csvUrl=g=>`https://docs.google.com/spreadsheets/d/e/${pub}/pub?gid=${g}&single=true&output=csv`;
  async function fetchTab(tab){
    const gid=gids[tab];
    if(!gid) return {tab, configured:false, ok:false};
    try{
      const res=await fetch(csvUrl(gid));
      const ct=res.headers.get("content-type")||"";
      if(!res.ok || !ct.includes("text/csv")) throw new Error("HTTP "+res.status);
      const text=await res.text();
      const grid=parseCsv(text);
      return {tab, configured:true, ok:true, grid, rows:toRows(grid)};
    }catch(e){
      return {tab, configured:true, ok:false, error:(e&&e.message)||String(e)};
    }
  }

  // Check 0 runs first and, on FAIL, aborts everything else — including any
  // further network calls (never fetch tabs whose relevance we can't yet
  // establish the target year for).
  const infoRes=await fetchTab("info");
  let info={}, infoRows=[];
  if(!infoRes.configured){ push({level:"FAIL", detail:'first_tee: config.js has no gid for "info" — cannot verify'}); return finish(); }
  if(!infoRes.ok){ push({level:"FAIL", detail:`first_tee: info tab fetch failed (${infoRes.error}) — cannot verify`}); return finish(); }
  infoRows=infoRes.rows;
  infoRows.forEach(r=>{ if(r.key) info[String(r.key).trim().toLowerCase()]=r.value; });

  const effectiveFirstTee=info.first_tee || extractCfgFirstTee(configText);
  const r0=checkFirstTee(effectiveFirstTee, now);
  push(r0);
  if(r0.level==="FAIL") return finish();

  const targetYear=yearOverride || parseInt(String(effectiveFirstTee).slice(0,4),10);

  // Everything else can now fetch in parallel.
  const restTabs=["course","field","scores","schedule","pairings","calcutta","rooms","announce",...RESIDUE_ONLY_TABS];
  const fetched={ info: infoRes };
  (await Promise.all(restTabs.map(fetchTab))).forEach(r=>{ fetched[r.tab]=r; });

  function need(tab, label){
    const r=fetched[tab];
    if(!r.configured){ push({level:"FAIL", detail:`${label}: config.js has no gid for "${tab}" — cannot verify`}); return null; }
    if(!r.ok){ push({level:"FAIL", detail:`${label}: ${tab} tab fetch failed (${r.error}) — cannot verify`}); return null; }
    return r;
  }

  // (a) sample-residue — scan every tab that fetched cleanly; a configured-
  // but-unfetchable tab is named as its own FAIL (never silently skipped).
  const tabRaw={};
  for(const tab of Object.keys(fingerprints)){
    const r=fetched[tab];
    if(!r) continue;               // no fingerprints entry to check against
    if(!r.configured) continue;    // legitimately unwired (e.g. announce pre-setup) — nothing to check
    if(!r.ok){ push({level:"FAIL", detail:`sample-residue: ${tab} tab fetch failed (${r.error}) — cannot verify`}); continue; }
    tabRaw[tab]=r.grid.slice(1);
  }
  push(checkResidue(tabRaw, fingerprints));

  // (b) schedule coverage
  const sched=need("schedule", "schedule coverage");
  if(sched) push(checkSchedule(sched.rows, effectiveFirstTee, info.dates, now));

  // (c) pairings
  const pairings=need("pairings", "pairings");
  if(pairings) push(checkPairings(pairings.rows, targetYear));

  // (d) pars
  const course=need("course", "course pars");
  if(course) push(checkPars(course.rows));

  // (e) scorer armed
  push(checkScorer(info));

  // (f) field sanity
  const field=need("field", "field sanity");
  if(field) push(checkField(field.rows, targetYear));

  // (g) announce — absent gid is a legitimate not-yet-wired state (INFO),
  // never a FAIL; configured-but-unfetchable is a FAIL.
  const annRes=fetched.announce;
  if(!annRes.configured){
    push({level:"INFO", detail:'announce: config.js has no gid for "announce" yet — check skipped (wire it once the tab exists)'});
  } else if(!annRes.ok){
    push({level:"FAIL", detail:`announce: announce tab fetch failed (${annRes.error}) — cannot verify`});
  } else {
    const t=new Date(effectiveFirstTee).getTime();
    const win=3*86400000;
    push(checkAnnounce(annRes.rows, now, t-win, t+win));
  }

  // (h) cross-tab integrity
  const scores=need("scores", "cross-tab integrity");
  const calcutta=need("calcutta", "cross-tab integrity");
  const rooms=need("rooms", "cross-tab integrity");
  if(scores && calcutta && rooms && field){
    push(checkCrossTab({scores:scores.rows, calcutta:calcutta.rows, rooms:rooms.rows, field:field.rows}, targetYear));
  }

  // (i) fallback parity
  push(checkFallbackParity(configText, indexHtml, infoRows));

  finish();
}

if(process.argv[1]===fileURLToPath(import.meta.url)) main();
