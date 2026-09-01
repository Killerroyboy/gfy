// Render-close PNG battery for GFY §25b (finish-polish wave).
// Network-sealed, real-browser screenshots. Read-only against the worktree's
// product code (index.html is only ever patched IN A SERVED RESPONSE, never
// on disk). Pattern copied from
// .worktrees/s25a/.superpowers/sdd/2026-08-24-gfy-s25a-broadcast-core/render-close/render.js
// per the Task 3 brief, adapted for §25b's six-item battery (empty states,
// hole-panel frames, double-digit movement, sg-t double-rule corner,
// score-flash under normal vs. prefers-reduced-motion).
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const WORKTREE = '/Users/riley/Code/gfy/.worktrees/s25b';
const OUTDIR = path.join(WORKTREE, '.superpowers/sdd/2026-08-31-gfy-s25b-finish-polish/render-close');
const PORT = 8941; // distinct from s25a's 8940 — avoid port collision with a concurrent harness
const BASE = `http://127.0.0.1:${PORT}`;

// Same GID table as config.js ships in THIS worktree — unlike s25a, the
// announce gid here is already real (1337342920), so no served-config.js
// patch is needed at all.
const GID = {
  info: '346870487', course: '518861921', field: '943851924', scores: '2048642783',
  schedule: '1013082114', pairings: '277862431', calcutta: '1980084359', payout: '1443171064',
  ledger: '61201478', champions: '595874277', shame: '559876960', invites: '1201085989',
  rooms: '85901482', announce: '1337342920',
};
const TAB_BY_GID = Object.fromEntries(Object.entries(GID).map(([k, v]) => [v, k]));

function readFixture(tab) {
  return fs.readFileSync(path.join(WORKTREE, 'fixtures', tab + '.csv'), 'utf8');
}
const FIXTURES = {};
Object.keys(GID).forEach(t => { FIXTURES[t] = readFixture(t); });

// ---- fixture builders ----

// Item 1: Board empty state — header-only scores tab -> buildPlayers()
// returns [] regardless of field.csv -> renderLeaderboard()'s
// `if(!players.length)` branch repaints #lbBody with .lb-empty.
const SCORES_EMPTY = FIXTURES.scores.split(/\r\n|\n/)[0] + '\n';

// Item 4: double-digit movement — 12 synthetic teams, strictly increasing
// totals (no ties, so ranking + reversal is fully deterministic), fed via
// the r1/r2-totals path (idiom lifted from s25a's SCORES_TIE/FIELD_TIE
// builders). Reversing a 12-team order gives the extreme rows a movement
// of 11 places — comfortably double-digit.
const MANY_TEAMS = ['Alp', 'Bly', 'Cor', 'Dex', 'Efn', 'Fen', 'Gan', 'Hil', 'Ivy', 'Jet', 'Kip', 'Lom'];
const scoresHeader = FIXTURES.scores.split(/\r\n|\n/)[0];
const totalsRow = (team, r1, r2) => [2026, team, '', ...Array(18).fill(''), r1, r2].join(',');
const SCORES_MANY = scoresHeader + '\n'
  + MANY_TEAMS.map((t, i) => { const tot = 130 + i * 5; const r1 = Math.round(tot / 2); return totalsRow(t, r1, tot - r1); }).join('\n');
const fieldHeader = FIXTURES.field.split(/\r\n|\n/)[0];
const FIELD_MANY = fieldHeader + '\n'
  + MANY_TEAMS.map(t => `2026,${t},${t},2019,8,In,TRUE,,`).join('\n');

// Item 6: score-change flash — a REAL two-paint (not a hand-primed class).
// SCORES_FLASH_A/B are single-hole (h1) rows for the site's own default
// 5-team roster (Duck/Sully/Moose/Tex/Bear already carried by field.csv);
// hole 1's par is 4 (course.csv), so h1=4 for everyone gives rel=0 -> "E"
// on the first paint. The second paint changes ONLY Duck's h1 (4 -> 5),
// so only Duck's to-par text moves ("E" -> "+1"); Sully/Moose/Tex/Bear are
// the held-fixed control, mirroring test/smoke.mjs's S25b-T2g idiom.
const FLASH_TEAMS = ['Duck', 'Sully', 'Moose', 'Tex', 'Bear'];
const holeRow = (team, h1) => [2026, team, 1, h1, ...Array(17).fill(''), '', ''].join(',');
const SCORES_FLASH_A = scoresHeader + '\n' + FLASH_TEAMS.map(t => holeRow(t, 4)).join('\n');
const SCORES_FLASH_B = scoresHeader + '\n' + FLASH_TEAMS.map(t => holeRow(t, t === 'Duck' ? 5 : 4)).join('\n');

const VIEWPORTS = [
  { tag: 'mobile', width: 390, height: 844, deviceScaleFactor: 2 },
  { tag: 'desktop', width: 1440, height: 900, deviceScaleFactor: 2 },
];

const NOW_EVENT = '2026-08-15T14:00:00-06:00'; // inside first_tee (Aug15 09:00) ± 3d — "event" phase, same anchor s25a used
function fmtOffset(iso) { return new Date(iso).getTime(); }

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', WORKTREE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    const onData = (d) => {
      const s = d.toString();
      if (!started && /Serving HTTP/.test(s)) { started = true; resolve(srv); }
    };
    srv.stdout.on('data', onData);
    srv.stderr.on('data', onData);
    srv.on('error', reject);
    setTimeout(() => { if (!started) { started = true; resolve(srv); } }, 1500);
  });
}

async function installRoutes(context, overrides) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return route.continue();
    }
    if (url.hostname === 'docs.google.com') {
      const gid = url.searchParams.get('gid');
      const tab = TAB_BY_GID[gid];
      if (!tab) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no such gid (test harness)' });
      const ov = overrides[tab];
      const csv = ov !== undefined ? ov : (FIXTURES[tab] !== undefined ? FIXTURES[tab] : readFixture(tab));
      return route.fulfill({ status: 200, contentType: 'text/csv', body: csv });
    }
    return route.abort();
  });
}

async function waitForPaint(page) {
  await page.waitForFunction(() => document.querySelectorAll('#lbBody .lb-row').length > 0
    || document.querySelector('#lbBody .lb-empty') !== null, { timeout: 15000 });
  await page.waitForTimeout(1800); // past the .rise stagger (real compositor clock, unaffected by page.clock)
}

const results = [];
const measurements = {};

async function newCtx(browser, vp, extra) {
  const context = await browser.newContext(Object.assign({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    timezoneId: 'America/Denver',
  }, extra || {}));
  const consoleErrors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });
  return { context, page, consoleErrors };
}

async function shoot(browser, { id, now, hash, overrides, ctxExtra }, actions) {
  for (const vp of VIEWPORTS) {
    const { context, page, consoleErrors } = await newCtx(browser, vp, ctxExtra);
    await installRoutes(context, overrides || {});
    await page.clock.install({ time: fmtOffset(now) });
    await page.goto(BASE + '/index.html' + (hash || ''), { waitUntil: 'load' });
    await waitForPaint(page);

    const ctx = { page, vp, id };
    if (actions) await actions(ctx);

    results.push({ id, vp: vp.tag, consoleErrors });
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const srv = await startServer();
  let browser;
  try {
    browser = await chromium.launch();

    // ---- 1: Board empty state (.lb-empty ceremony dress) ----
    await shoot(browser, { id: '01-board-empty', now: NOW_EVENT, hash: '#board', overrides: { scores: SCORES_EMPTY } }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `01-board-empty-${vp.tag}.png`) });
      measurements['lbEmpty-' + vp.tag] = await page.evaluate(() => {
        const el = document.querySelector('#lbBody .lb-empty');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim(), color: cs.color, fontStyle: cs.fontStyle, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, textAlign: cs.textAlign };
      });
    });

    // ---- 2a: Money view empty (.mn-empty) — default fixtures, year 2026,
    // ledger.csv only has 2025 rows -> the "Nothing to settle for 2026"
    // .mn-empty flavor renders with NO override needed. ----
    await shoot(browser, { id: '02a-money-empty', now: NOW_EVENT, hash: '#money' }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `02a-money-empty-${vp.tag}.png`) });
      measurements['mnEmpty-' + vp.tag] = await page.evaluate(() => {
        const el = document.querySelector('#mnBody .mn-empty');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim(), color: cs.color, fontStyle: cs.fontStyle, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform };
      });
    });

    // ---- 2b: Photos view empty (.photo-empty) — default config.js ships
    // DRIVE_FOLDER_ID:"" so the static markup renders untouched. ----
    await shoot(browser, { id: '02b-photos-empty', now: NOW_EVENT, hash: '#photos' }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `02b-photos-empty-${vp.tag}.png`) });
      measurements['photoEmpty-' + vp.tag] = await page.evaluate(() => {
        const el = document.querySelector('#photoFrame .photo-empty');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim(), color: cs.color, fontStyle: cs.fontStyle, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, padding: cs.padding, textAlign: cs.textAlign };
      });
    });

    // ---- 3: Hole panel open — photo + map + crop, plus a crop of the
    // unpadded .sg-p-crop frame edge. Hole 3 has a real asset
    // (assets/holes/hole-3.jpg) so .sg-p-photo doesn't onerror-hide. ----
    await shoot(browser, { id: '03-hole-panel', now: NOW_EVENT, hash: '#board' }, async ({ page, vp }) => {
      await page.evaluate(() => renderHolePanel(3));
      await page.waitForTimeout(150); // crop-scroll centering runs on img load/complete
      await page.evaluate(() => document.getElementById('sgPanel')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(OUTDIR, `03-hole-panel-${vp.tag}.png`) });

      await page.evaluate(() => document.querySelector('#sgPanel .sg-p-crop')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(80);
      const cropBox = await page.evaluate(() => {
        const el = document.querySelector('#sgPanel .sg-p-crop');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (cropBox && cropBox.w > 0 && cropBox.h > 0) {
        // tight corner crop on the top-left edge — border sits flush on the
        // image content, no 4px pine-3 mat like the other two frames
        const cx = Math.max(0, Math.min(cropBox.x, vp.width - 1));
        const cy = Math.max(0, Math.min(cropBox.y, vp.height - 1));
        const cw = Math.max(1, Math.min(90, cropBox.w, vp.width - cx));
        const ch = Math.max(1, Math.min(70, cropBox.h, vp.height - cy));
        await page.screenshot({ path: path.join(OUTDIR, `03b-sg-p-crop-edge-${vp.tag}.png`), clip: { x: cx, y: cy, width: cw, height: ch } });
      }
      measurements['holePanel-' + vp.tag] = await page.evaluate(() => {
        const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { border: cs.borderWidth + ' ' + cs.borderStyle + ' ' + cs.borderColor, background: cs.backgroundColor, padding: cs.padding }; };
        return {
          photo: r('#sgPanel .sg-p-photo'),
          mapImg: r('#sgPanel .sg-p-map img'),
          crop: r('#sgPanel .sg-p-crop'),
          photoHidden: document.querySelector('#sgPanel .sg-p-photo')?.hidden ?? null,
        };
      });
    });

    // ---- 4: Board fresh, double-digit movement (12-team reversed-order
    // idiom, same mechanism as S25a-T4e/render.js #01) ----
    await shoot(browser, { id: '04-board-double-digit-mv', now: NOW_EVENT, hash: '#board', overrides: { field: FIELD_MANY, scores: SCORES_MANY } }, async ({ page, vp }) => {
      const order = await page.evaluate(() => [...document.querySelectorAll('#lbBody .lb-row')].map(r => r.dataset.player));
      const year = await page.evaluate(() => STATE.year);
      await page.evaluate(({ order, year }) => {
        STATE.prevBoard = { order: [...order].reverse(), year, at: Date.now() };
        renderLeaderboard();
      }, { order, year });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(OUTDIR, `04-board-double-digit-mv-${vp.tag}.png`) });
      const mvFacts = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('#lbBody .lb-mv')].map(el => el.className + ':' + el.textContent.trim());
        const maxN = Math.max(...cells.map(c => { const m = c.match(/:(\d+)$/); return m ? parseInt(m[1], 10) : 0; }));
        return { cells, maxN };
      });
      measurements['doubleDigitMv-' + vp.tag] = Object.assign({ teamCount: order.length }, mvFacts);
    });

    // ---- 5: sg-t grid head close-crop — sticky .sg-team corner where
    // border-right meets the 3px double rule. Default fixtures (full,
    // non-suppressed course -> grid renders normally). ----
    await shoot(browser, { id: '05-sg-t-head-corner', now: NOW_EVENT, hash: '#board' }, async ({ page, vp }) => {
      await page.evaluate(() => document.getElementById('sgWrap')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(OUTDIR, `05-sg-t-head-corner-${vp.tag}.png`) });
      const cellBox = await page.evaluate(() => {
        const el = document.querySelector('#sgTable thead th.sg-team');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (cellBox) {
        const pad = 18;
        const cx = Math.max(0, cellBox.x + cellBox.w - 40);
        const cy = Math.max(0, cellBox.y + cellBox.h - 30);
        const cw = Math.min(80, vp.width - cx);
        const ch = Math.min(60, vp.height - cy);
        if (cw > 0 && ch > 0) {
          await page.screenshot({ path: path.join(OUTDIR, `05b-sg-t-head-corner-crop-${vp.tag}.png`), clip: { x: cx, y: cy, width: cw, height: ch } });
        }
      }
      measurements['sgTeamCorner-' + vp.tag] = await page.evaluate(() => {
        const el = document.querySelector('#sgTable thead th.sg-team');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { borderRight: cs.borderRightWidth + ' ' + cs.borderRightStyle + ' ' + cs.borderRightColor, borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle + ' ' + cs.borderBottomColor };
      });
    });

    // ---- 6a: Board mid-flash — REAL two-paint via load()x2 (clock
    // fast-forwarded past the HOT_TABS 60s cadence so "scores" is due
    // again), captured within the 1.2s lbFlash animation window. ----
    {
      for (const vp of VIEWPORTS) {
        const overridesA = { scores: SCORES_FLASH_A }; // fresh per-viewport — must start at A, not a prior iteration's mutated B
        const { context, page, consoleErrors } = await newCtx(browser, vp, {});
        await installRoutes(context, overridesA);
        await page.clock.install({ time: fmtOffset(NOW_EVENT) });
        await page.goto(BASE + '/index.html#board', { waitUntil: 'load' });
        await waitForPaint(page);
        const duckBefore = await page.evaluate(() => document.querySelector('.lb-row[data-player="duck"] .lb-tot:last-child')?.textContent.trim());

        overridesA.scores = SCORES_FLASH_B; // mutate in place — installRoutes reads overrides[tab] live per-request
        await page.clock.fastForward(71000); // past HOT_TABS 60000ms cadence AND scheduleRefresh's worst-case +10000ms jitter
        await page.waitForFunction((prev) => {
          const el = document.querySelector('.lb-row[data-player="duck"] .lb-tot:last-child');
          return el && el.textContent.trim() !== prev;
        }, duckBefore, { timeout: 10000 });
        // capture immediately — real compositor clock is running the 1.2s
        // lbFlash keyframe right now, unaffected by page.clock
        const flashState = await page.evaluate(() => {
          const row = document.querySelector('.lb-row[data-player="duck"]');
          const cs = row ? getComputedStyle(row) : null;
          return { hasFlashClass: row ? row.classList.contains('lb-flash') : null, backgroundColor: cs ? cs.backgroundColor : null };
        });
        await page.screenshot({ path: path.join(OUTDIR, `06a-board-mid-flash-${vp.tag}.png`) });
        const duckAfter = await page.evaluate(() => document.querySelector('.lb-row[data-player="duck"] .lb-tot:last-child')?.textContent.trim());
        const sullyStable = await page.evaluate(() => document.querySelector('.lb-row[data-player="sully"]')?.classList.contains('lb-flash'));
        measurements['flashNormal-' + vp.tag] = { duckBefore, duckAfter, flashState, sullyFlashed: sullyStable };
        await context.close();
      }
    }

    // ---- 6b: Same real two-paint, under emulated prefers-reduced-motion —
    // proves no visual flash (animation:none in the site's one rm block,
    // so the row's background never tints, capture or no capture). ----
    {
      for (const vp of VIEWPORTS) {
        const overridesA = { scores: SCORES_FLASH_A }; // fresh per-viewport — same fix as 6a
        const { context, page, consoleErrors } = await newCtx(browser, vp, { reducedMotion: 'reduce' });
        await installRoutes(context, overridesA);
        await page.clock.install({ time: fmtOffset(NOW_EVENT) });
        await page.goto(BASE + '/index.html#board', { waitUntil: 'load' });
        await waitForPaint(page);
        const duckBefore = await page.evaluate(() => document.querySelector('.lb-row[data-player="duck"] .lb-tot:last-child')?.textContent.trim());

        overridesA.scores = SCORES_FLASH_B;
        await page.clock.fastForward(71000); // past HOT_TABS 60000ms cadence AND scheduleRefresh's worst-case +10000ms jitter
        await page.waitForFunction((prev) => {
          const el = document.querySelector('.lb-row[data-player="duck"] .lb-tot:last-child');
          return el && el.textContent.trim() !== prev;
        }, duckBefore, { timeout: 10000 });
        const flashState = await page.evaluate(() => {
          const row = document.querySelector('.lb-row[data-player="duck"]');
          const cs = row ? getComputedStyle(row) : null;
          const anim = row ? getComputedStyle(row).animationName : null;
          return { hasFlashClass: row ? row.classList.contains('lb-flash') : null, backgroundColor: cs ? cs.backgroundColor : null, animationName: anim };
        });
        await page.screenshot({ path: path.join(OUTDIR, `06b-board-flash-reduced-motion-${vp.tag}.png`) });
        // also capture ~600ms later (mid-way through where the normal
        // animation would still be visibly tinted) to prove it never pops in
        await page.waitForTimeout(600);
        const flashStateLater = await page.evaluate(() => {
          const row = document.querySelector('.lb-row[data-player="duck"]');
          const cs = row ? getComputedStyle(row) : null;
          return { backgroundColor: cs ? cs.backgroundColor : null };
        });
        measurements['flashReducedMotion-' + vp.tag] = { duckBefore, flashState, flashStateLater };
        await context.close();
      }
    }

    fs.writeFileSync(path.join(OUTDIR, 'raw-results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTDIR, 'measurements.json'), JSON.stringify(measurements, null, 2));
    console.log('DONE');
    console.log(JSON.stringify({ results, measurements }, null, 2));
  } catch (e) {
    console.error('RENDER_ERROR', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
}

main();
