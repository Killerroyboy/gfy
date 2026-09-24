/* §28 render close — REAL-BROWSER computed-style proof for #preflight.
   REQUIRES PLAYWRIGHT, which is deliberately NOT a repo dependency (chromium
   is ~95MB and the jsdom suite is the everyday gate). ESM resolves imports
   from THIS file's location, so playwright must be installed in this repo:
       npm i -D playwright && npx playwright install chromium
       node tools/pf-render-close.mjs
   (2026-09-24 it was proven 10/10 against an external install symlinked in
   for the run, then unlinked — hence no devDependency entry.)
   Kept in-repo because it is the ONLY leg that can prove the cascade — jsdom
   is structurally blind to it, and that blindness has shipped three real bugs
   here (offsetParent always null; [hidden] losing to an author display rule;
   display:none elements still counted as focusable).
   jsdom is cascade-blind; this is the leg that actually proves the hides.
   Fixture-fed via route interception (the repo's established idiom — beats
   file:// live-fetch flakiness). Read-only: nothing is written anywhere. */
import { chromium } from "playwright";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
// Screenshots go wherever you point it; default is a gitignored local dir.
const OUT = process.env.PF_SHOTS || join(REPO, "render-close-preflight");
mkdirSync(OUT, { recursive: true });

const fixtures = {};
for (const f of readdirSync(join(REPO, "fixtures"))) {
  if (f.endsWith(".csv")) fixtures[f.replace(/\.csv$/, "")] = readFileSync(join(REPO, "fixtures", f), "utf8");
}
const cfg = readFileSync(join(REPO, "config.js"), "utf8");
const gids = {};
for (const m of cfg.matchAll(/(\w+)\s*:\s*"(\d+)"/g)) gids[m[2]] = m[1];

const results = [];
const check = (name, pass, detail = "") => { results.push([name, pass]); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "   [" + detail + "]" : ""}`); };

const browser = await chromium.launch();

async function openPage({ endpointBody, endpointFail, hash = "#preflight", search = "", width = 390 }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // Serve every published-CSV request from the local fixtures.
  await page.route(/docs\.google\.com/, route => {
    const u = new URL(route.request().url());
    const tab = gids[u.searchParams.get("gid")] || "info";
    let body = fixtures[tab] ?? "";
    // The info fixture carries no score_endpoint (the repo's smoke suite has a
    // withScEndpoint() helper for the same reason) — inject one so the scoring
    // signal is exercised instead of short-circuiting on UNCONFIGURED.
    if (tab === "info" && !/score_endpoint/.test(body)) body = body.trimEnd() + "\nscore_endpoint,https://script.google.com/macros/s/TEST/exec\n";
    route.fulfill({ status: 200, contentType: "text/csv", body });
  });
  // The scorer endpoint: either an SC-IDENT envelope, the echo stub, or a hard failure.
  await page.route(/script\.google\.com/, route => {
    if (endpointFail) return route.abort("failed");
    route.fulfill({ status: 200, contentType: "application/json", body: endpointBody });
  });
  await page.goto("file://" + join(REPO, "index.html") + search + hash, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

const ARMED = JSON.stringify({ ok: true, year: 2026, teams: ["Duck"], handler: "gfy-scorer", writes: true, contract: 1 });
const STUB = JSON.stringify({ ok: true, echo: { hole: 13 } });

// ---- 1. ARMED, phone width ----
{
  const { ctx, page } = await openPage({ endpointBody: ARMED });
  const vis = await page.evaluate(() => {
    const g = id => { const e = document.getElementById(id); return e ? { text: (e.textContent || "").trim(), disp: getComputedStyle(e).display, hidden: e.hidden } : null; };
    const v = document.querySelector('[data-view="preflight"]');
    return { viewShown: !!v && !v.hidden, bodyView: document.body.dataset.view,
             scoring: g("pfScoringText"), detail: g("pfScoringDetail"),
             dot: (document.getElementById("pfDot") || {}).dataset?.state,
             progress: g("pfProgressText"), waiting: g("pfWaiting"), par: g("pfParNote"),
             btnH: document.getElementById("pfRecheck")?.getBoundingClientRect().height,
             hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             gutterL: (()=>{const t=document.querySelector('[data-view="preflight"] .pf-title'); return t?t.getBoundingClientRect().left:-1;})(),
             gutterR: (()=>{const t=document.querySelector('[data-view="preflight"] .pf-value'); return t?(window.innerWidth-t.getBoundingClientRect().right):-1;})() };
  });
  check("RC1: #preflight is the rendered view at 390w", vis.viewShown && vis.bodyView === "preflight", JSON.stringify({ bodyView: vis.bodyView }));
  check("RC2: an SC-IDENT envelope renders Live with the ARMED dot state — and the copy never claims writes are ok",
    vis.scoring.text === "Live" && vis.dot === "ARMED" && !/writes ok/i.test(vis.detail.text), JSON.stringify({ t: vis.scoring.text, dot: vis.dot, d: vis.detail.text }));
  check("RC3: no horizontal overflow at phone width", vis.hOverflow <= 0, "overflow=" + vis.hOverflow);
  check("RC4: the re-check control meets the 44px touch floor", vis.btnH >= 44, "h=" + vis.btnH);
  check("RC4b: GUTTER — content is not flush to the screen edge at phone width (the .wrap idiom every other view uses; the automated overflow probe read 0 while the screenshot showed text jammed against both edges, which is why the eyeball stays in the loop)",
    vis.gutterL >= 16 && vis.gutterR >= 16, JSON.stringify({ l: vis.gutterL, r: vis.gutterR }));
  console.log("     progress=" + JSON.stringify(vis.progress.text) + " waitingDisp=" + vis.waiting.disp + " parDisp=" + vis.par.disp);
  await page.screenshot({ path: join(OUT, "pf-armed-390.png"), fullPage: true });
  await ctx.close();
}

// ---- 2. STUB ----
{
  const { ctx, page } = await openPage({ endpointBody: STUB });
  const r = await page.evaluate(() => ({
    text: document.getElementById("pfScoringText").textContent.trim(),
    detail: document.getElementById("pfScoringDetail").textContent.trim(),
    dot: document.getElementById("pfDot").dataset.state,
  }));
  check("RC5: the echo stub renders NOT armed (never Live) and the detail names the consequence",
    r.text === "NOT armed" && r.dot === "NOT_ARMED" && /writes nothing/.test(r.detail), JSON.stringify(r));
  await page.screenshot({ path: join(OUT, "pf-stub-390.png"), fullPage: true });
  await ctx.close();
}

// ---- 3. network failure -> UNKNOWN, never Live ----
{
  const { ctx, page } = await openPage({ endpointFail: true });
  const r = await page.evaluate(() => ({
    text: document.getElementById("pfScoringText").textContent.trim(),
    dot: document.getElementById("pfDot").dataset.state,
  }));
  check("RC6: an unreachable endpoint renders Unknown, never Live and never NOT armed (S2's UNCERTAIN half on a surface an operator acts on)",
    r.text === "Unknown" && r.dot === "UNKNOWN", JSON.stringify(r));
  await ctx.close();
}

// ---- 4. THE CASCADE PROOF: [hidden] must actually compute to display:none ----
{
  const { ctx, page } = await openPage({ endpointBody: ARMED });
  const r = await page.evaluate(() => {
    const w = document.getElementById("pfWaiting"), p = document.getElementById("pfParNote");
    const before = { wHidden: w.hidden, wDisp: getComputedStyle(w).display, pHidden: p.hidden, pDisp: getComputedStyle(p).display };
    w.hidden = true; p.hidden = true;
    const hiddenNow = { wDisp: getComputedStyle(w).display, pDisp: getComputedStyle(p).display };
    w.hidden = false; p.hidden = false;
    const shownNow = { wDisp: getComputedStyle(w).display, pDisp: getComputedStyle(p).display };
    return { before, hiddenNow, shownNow };
  });
  check("RC7: CASCADE PROOF — with [hidden] set, BOTH toggled elements compute to display:none in a real browser (the companion rule beats any author display rule); with it cleared they compute to something visible. This is the leg jsdom cannot run.",
    r.hiddenNow.wDisp === "none" && r.hiddenNow.pDisp === "none"
    && r.shownNow.wDisp !== "none" && r.shownNow.pDisp !== "none",
    JSON.stringify(r));
  await ctx.close();
}

// ---- 5. ?preflight=1 alias, and hash wins over it ----
{
  const { ctx, page } = await openPage({ endpointBody: ARMED, hash: "", search: "?preflight=1" });
  const a = await page.evaluate(() => document.body.dataset.view);
  check("RC8: ?preflight=1 lands on the readiness view", a === "preflight", "view=" + a);
  await ctx.close();
  const { ctx: c2, page: p2 } = await openPage({ endpointBody: ARMED, hash: "#board", search: "?preflight=1" });
  const b = await p2.evaluate(() => document.body.dataset.view);
  check("RC9: an explicit hash WINS over a stale ?preflight=1 query string", b === "board", "view=" + b);
  await c2.close();
}

await browser.close();
const failed = results.filter(r => !r[1]).length;
console.log(`\nRENDER-CLOSE ${results.length - failed}/${results.length}`);
writeFileSync(join(OUT, "RESULTS.md"), results.map(([n, p]) => `${p ? "PASS" : "FAIL"}  ${n}`).join("\n") + "\n");
process.exit(failed ? 1 : 0);
