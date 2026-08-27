// Render-close PNG battery for GFY §25a (broadcast-core wave).
// Network-sealed, real-browser screenshots. Read-only against the worktree
// (product code is only ever patched IN A SERVED RESPONSE, never on disk,
// except the one CSS-only ring-geometry fix this run may apply per the
// task-7 brief's watch-list mandate).
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const WORKTREE = '/Users/riley/Code/gfy/.worktrees/s25a';
const OUTDIR = path.join(WORKTREE, '.superpowers/sdd/2026-08-24-gfy-s25a-broadcast-core/render-close');
const PORT = 8940;
const BASE = `http://127.0.0.1:${PORT}`;

// Same GID table as the §24 harness (same live sheet, same worktree family —
// config.js's CONFIG.GID values are byte-identical across s24/s25a). The
// live sheet's Updates tab still has no real gid (config.js ships
// announce:""), so we patch the SERVED config.js response only, exactly like
// §24's render.js — never the tracked file.
const REAL_GID = {
  info: '346870487', course: '518861921', field: '943851924', scores: '2048642783',
  schedule: '1013082114', pairings: '277862431', calcutta: '1980084359', payout: '1443171064',
  ledger: '61201478', champions: '595874277', shame: '559876960', invites: '1201085989',
  rooms: '85901482',
};
const FAKE_ANNOUNCE_GID = '900002';
const GID = Object.assign({}, REAL_GID, { announce: FAKE_ANNOUNCE_GID });
const TAB_BY_GID = Object.fromEntries(Object.entries(GID).map(([k, v]) => [v, k]));

function readFixture(tab) {
  return fs.readFileSync(path.join(WORKTREE, 'fixtures', tab + '.csv'), 'utf8');
}
const FIXTURES = {};
['info', 'course', 'field', 'scores', 'schedule', 'announce'].forEach(t => { FIXTURES[t] = readFixture(t); });

// ---- fixture builders (idioms lifted straight from test/smoke.mjs) ----

// SC-PAR-VALID / X34/X37/T4g2/T5e idiom: blank hole 7's par -> courseMap()
// returns null (all-18-or-null) -> Board + Home suppress To-par to a plain
// gross Total.
const COURSE_SUPPRESSED = FIXTURES.course.split('\n')
  .map(l => (l.startsWith('7,') ? '7,,' + l.split(',')[2] : l)).join('\n');

// T5f idiom: 7 custom teams, 4 clean ranks then a 3-way tie for 5th, so the
// Home slice's tie-inclusion rule (cut may exceed 5) has something to prove.
const TIE_TEAMS = [['Alp', 140], ['Bly', 145], ['Cor', 150], ['Dex', 155],
  ['Efn', 160], ['Fen', 160], ['Gan', 160]];
const scoresHeader = FIXTURES.scores.split(/\r\n|\n/)[0];
const totalsRow = (team, r1, r2) => [2026, team, '', ...Array(18).fill(''), r1, r2].join(',');
const SCORES_TIE = scoresHeader + '\n'
  + TIE_TEAMS.map(([t, tot]) => totalsRow(t, Math.round(tot / 2), tot - Math.round(tot / 2))).join('\n');
const fieldHeader = FIXTURES.field.split(/\r\n|\n/)[0];
const FIELD_TIE = fieldHeader + '\n'
  + TIE_TEAMS.map(([t]) => `2026,${t},${t},2019,8,In,TRUE,,`).join('\n');

// §24 A-BANNER idiom: an unseen announce row (year matches the fixture's
// active season, "when" inside the >24h-future guard) so the lower-third
// banner actually paints. "now" below is pinned to 2026-08-15T14:00 local
// (America/Denver, -06:00 in August) — this message sits 30 min earlier.
const ANN_EVENT = 'year,when,message\n2026,2026-08-15 13:30,Round One tee times posted. Leaders out last.\n';

function fmtOffset(iso) { return new Date(iso).getTime(); }

const NOW_EVENT = '2026-08-15T14:00:00-06:00';   // inside first_tee (Aug15 09:00) ± 3d — "event" phase
const NOW_OFF = '2026-09-20T10:00:00-06:00';     // well outside the window — "off" phase

const VIEWPORTS = [
  { tag: 'mobile', width: 390, height: 844, deviceScaleFactor: 2 },
  { tag: 'desktop', width: 1440, height: 900, deviceScaleFactor: 2 },
];

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
      if (url.pathname.endsWith('/config.js')) {
        let body = fs.readFileSync(path.join(WORKTREE, 'config.js'), 'utf8');
        body = body.replace('announce: ""', `announce: "${FAKE_ANNOUNCE_GID}"`);
        return route.fulfill({ status: 200, contentType: 'application/javascript', body });
      }
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
  await page.waitForFunction(() => document.querySelectorAll('#lbBody .lb-row').length > 0, { timeout: 15000 });
  await page.waitForTimeout(1800); // past the .rise stagger (real compositor clock, unaffected by page.clock)
}

async function grabFacts(page) {
  return page.evaluate(() => {
    const dataView = document.body.dataset.view;
    const mvCells = [...document.querySelectorAll('#lbBody .lb-mv')].map(el => el.className + ':' + el.textContent.trim());
    const mvBasis = document.getElementById('lbMvBasis')?.textContent ?? null;
    const suppressed = !!document.querySelector('#leaderboard.lb-suppressed');
    const mastChip = document.getElementById('mastChip')?.textContent ?? null;
    const mastCtx = document.getElementById('mastCtx')?.textContent ?? null;
    const homeBoardHTML = document.getElementById('homeBoard')?.innerHTML ?? null;
    const nowNext = document.getElementById('nowNext')?.textContent ?? null;
    const announceHidden = document.getElementById('announceBar')?.hidden ?? null;
    return { dataView, mvCells, mvBasis, suppressed, mastChip, mastCtx, homeBoardHTML: homeBoardHTML && homeBoardHTML.slice(0, 300), nowNext, announceHidden };
  });
}

// ---- watch-list measurements (numbers, not just pixels) ----
async function measureRingGeometry(page) {
  return page.evaluate(() => {
    const out = { under: null, blowup: null };
    const underCell = document.querySelector('.sg-t td.under');
    if (underCell) {
      const td = underCell.getBoundingClientRect();
      const cs = getComputedStyle(underCell, '::after');
      out.under = {
        cellW: td.width, cellH: td.height,
        afterW: parseFloat(cs.width), afterH: parseFloat(cs.height),
        borderRadius: cs.borderRadius,
        aspectRatio: +(parseFloat(cs.width) / parseFloat(cs.height)).toFixed(3),
      };
    }
    const blowupCell = document.querySelector('.sg-t td.blowup');
    if (blowupCell) {
      const td = blowupCell.getBoundingClientRect();
      const cs = getComputedStyle(blowupCell, '::after');
      // box-shadow spread is the LAST length in "0 0 0 2px c1, 0 0 0 3px c2"
      const spreads = [...cs.boxShadow.matchAll(/(-?[\d.]+)px(?=[^,]*$|,)/g)];
      const maxSpread = Math.max(...cs.boxShadow.split(',').map(s => {
        const m = s.trim().match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/);
        return m ? parseFloat(m[4]) : 0;
      }));
      const insetTop = (td.height - parseFloat(cs.height)) / 2;
      const insetLeft = (td.width - parseFloat(cs.width)) / 2;
      out.blowup = {
        cellW: td.width, cellH: td.height,
        afterW: parseFloat(cs.width), afterH: parseFloat(cs.height),
        maxSpread, insetTop, insetLeft,
        clearanceTop: +(insetTop - maxSpread).toFixed(2),
        clearanceLeft: +(insetLeft - maxSpread).toFixed(2),
      };
    }
    return out;
  });
}

async function measureLbMvRow(page) {
  return page.evaluate(() => {
    const row = document.querySelector('#lbBody .lb-row');
    if (!row) return null;
    const rowRect = row.getBoundingClientRect();
    const wrap = document.querySelector('.wrap');
    const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
    return {
      viewportW: window.innerWidth,
      rowScrollWidth: row.scrollWidth,
      rowClientWidth: row.clientWidth,
      overflow: row.scrollWidth > row.clientWidth + 1,
      wrapW: wrapRect ? wrapRect.width : null,
      mvCellW: row.querySelector('.lb-mv') ? row.querySelector('.lb-mv').getBoundingClientRect().width : null,
    };
  });
}

async function measureMasthead(page) {
  return page.evaluate(() => {
    const navInner = document.querySelector('.nav-inner');
    const mastBar = document.querySelector('#mastBar');
    const mastHead = document.querySelector('.mast-head');
    const mastChip = document.querySelector('#mastChip');
    const wrap = document.querySelector('.wrap');
    const r = el => el ? el.getBoundingClientRect() : null;
    const navR = r(navInner), mastR = r(mastBar), headR = r(mastHead), chipR = r(mastChip), wrapR = r(wrap);
    return {
      viewportW: window.innerWidth,
      navInnerCenterX: navR ? +(navR.left + navR.width / 2).toFixed(1) : null,
      mastBarContentLeft: (() => {
        const mark = document.querySelector('.mast-mark');
        return mark ? +mark.getBoundingClientRect().left.toFixed(1) : null;
      })(),
      wrapLeft: wrapR ? +wrapR.left.toFixed(1) : null,
      mastHeadLeft: headR ? +headR.left.toFixed(1) : null,
      mastChipRight: chipR ? +chipR.right.toFixed(1) : null,
      mastChipWraps: (() => {
        if (!mastChip || !mastHead) return null;
        const h2 = mastHead.querySelector('h2');
        return h2 ? chipR.top > (h2.getBoundingClientRect().bottom - 2) : null;
      })(),
    };
  });
}

async function measureHomeFold(page, viewportH) {
  return page.evaluate((vh) => {
    const hb = document.getElementById('homeBoard');
    if (!hb || !hb.innerHTML) return { present: false };
    const rect = hb.getBoundingClientRect();
    const link = hb.querySelector('.home-board-link');
    const linkRect = link ? link.getBoundingClientRect() : null;
    return {
      present: true,
      bottom: +rect.bottom.toFixed(1),
      linkBottom: linkRect ? +linkRect.bottom.toFixed(1) : null,
      fitsAboveFold: linkRect ? linkRect.bottom <= vh : null,
      viewportH: vh,
    };
  }, viewportH);
}

const results = [];
const measurements = {};

async function shoot(browser, { id, now, hash, overrides, viewportOnly }, actions) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      timezoneId: 'America/Denver',
    });
    await installRoutes(context, overrides || {});
    const page = await context.newPage();
    await page.clock.install({ time: fmtOffset(now) });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });

    await page.goto(BASE + '/index.html' + (hash || ''), { waitUntil: 'load' });
    await waitForPaint(page);

    const ctx = { page, vp, id };
    if (actions) await actions(ctx);

    const facts = await grabFacts(page);
    results.push({ id, vp: vp.tag, facts, consoleErrors });
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const srv = await startServer();
  let browser;
  try {
    browser = await chromium.launch();

    // ---- 1: Board, populated, fresh movement basis ----
    await shoot(browser, { id: '01-board-fresh-arrows', now: NOW_EVENT, hash: '#board' }, async ({ page, vp }) => {
      const order = await page.evaluate(() => [...document.querySelectorAll('#lbBody .lb-row')].map(r => r.dataset.player));
      const year = await page.evaluate(() => STATE.year);
      await page.evaluate(({ order, year }) => {
        STATE.prevBoard = { order: [...order].reverse(), year, at: Date.now() };
        renderLeaderboard();
      }, { order, year });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(OUTDIR, `01-board-fresh-arrows-${vp.tag}.png`) });
      measurements['lbMvRow-' + vp.tag] = await measureLbMvRow(page);
      measurements['masthead-board-event-' + vp.tag] = await measureMasthead(page);
    });

    // ---- 2: Board, par-suppressed ----
    await shoot(browser, { id: '02-board-suppressed', now: NOW_EVENT, hash: '#board', overrides: { course: COURSE_SUPPRESSED } }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `02-board-suppressed-${vp.tag}.png`) });
    });

    // ---- 3: Board, stale movement basis ----
    await shoot(browser, { id: '03-board-stale-movement', now: NOW_EVENT, hash: '#board' }, async ({ page, vp }) => {
      const order = await page.evaluate(() => [...document.querySelectorAll('#lbBody .lb-row')].map(r => r.dataset.player));
      const year = await page.evaluate(() => STATE.year);
      await page.evaluate(({ order, year }) => {
        STATE.prevBoard = { order: [...order].reverse(), year, at: Date.now() - 11 * 60 * 1000 };
        renderLeaderboard();
      }, { order, year });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(OUTDIR, `03-board-stale-movement-${vp.tag}.png`) });
    });

    // ---- 4: Hole-by-hole grid, glyph rings + legend (Round 1 default) ----
    await shoot(browser, { id: '04-grid-glyphs-legend', now: NOW_EVENT, hash: '#board' }, async ({ page, vp }) => {
      await page.evaluate(() => document.getElementById('sgWrap')?.scrollIntoView({ behavior: 'instant' }));
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(OUTDIR, `04-grid-glyphs-legend-${vp.tag}.png`), fullPage: true });
      // blowup halo clearance measurement + crop off Round 1 (Moose h7 blowup)
      await page.evaluate(() => document.querySelector('.sg-t td.blowup')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
      await page.waitForTimeout(80);
      const blowupBox = await page.evaluate(() => {
        const c = document.querySelector('.sg-t td.blowup');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (blowupBox && blowupBox.w > 0 && blowupBox.h > 0) {
        const pad = 14;
        const cx = Math.max(0, blowupBox.x - pad), cy = Math.max(0, blowupBox.y - pad);
        const cw = Math.min(blowupBox.w + pad * 2, vp.width - cx);
        const ch = Math.min(blowupBox.h + pad * 2, vp.height - cy);
        if (cw > 0 && ch > 0) {
          await page.screenshot({ path: path.join(OUTDIR, `04b-grid-blowup-crop-${vp.tag}.png`), clip: { x: cx, y: cy, width: cw, height: ch } });
        }
      }
      measurements['ringGeometry-round1-' + vp.tag] = await measureRingGeometry(page);

      // switch to Round 2 (Duck's under cells h5/h9) for the ellipse check + fix proof
      await page.evaluate(() => { STATE.gridRound = '2'; renderScoreGrid(rankedPlayers('gross')); });
      await page.waitForTimeout(80);
      await page.evaluate(() => document.querySelector('.sg-t td.under')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
      await page.waitForTimeout(80);
      const underBox = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.sg-t td.under')];
        if (!cells.length) return null;
        const c = cells[0];
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (underBox && underBox.w > 0 && underBox.h > 0) {
        const pad = 14;
        const cx = Math.max(0, underBox.x - pad), cy = Math.max(0, underBox.y - pad);
        const cw = Math.min(underBox.w + pad * 2, vp.width - cx);
        const ch = Math.min(underBox.h + pad * 2, vp.height - cy);
        if (cw > 0 && ch > 0) {
          await page.screenshot({ path: path.join(OUTDIR, `04c-grid-under-round2-crop-${vp.tag}.png`), clip: { x: cx, y: cy, width: cw, height: ch } });
        }
      }
      measurements['ringGeometry-round2-under-' + vp.tag] = await measureRingGeometry(page);
      measurements['underBoxFound-' + vp.tag] = !!underBox;
      measurements['blowupBoxFound-' + vp.tag] = !!blowupBox;
    });

    // ---- 5a: Home, event phase, top-slice ----
    await shoot(browser, { id: '05a-home-slice', now: NOW_EVENT, hash: '' }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `05a-home-slice-${vp.tag}.png`) });
      measurements['homeFold-' + vp.tag] = await measureHomeFold(page, vp.height);
      await page.evaluate(() => document.getElementById('homeBoard')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(OUTDIR, `05a2-home-slice-scrolled-${vp.tag}.png`) });
    });

    // ---- 5b: Home, event phase, tied 5th extends the slice ----
    await shoot(browser, { id: '05b-home-slice-tie', now: NOW_EVENT, hash: '', overrides: { scores: SCORES_TIE, field: FIELD_TIE } }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `05b-home-slice-tie-${vp.tag}.png`) });
      await page.evaluate(() => document.getElementById('homeBoard')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(OUTDIR, `05b2-home-slice-tie-scrolled-${vp.tag}.png`) });
    });

    // ---- 6: Home, event phase, par-suppressed (single-total state) ----
    await shoot(browser, { id: '06-home-suppressed', now: NOW_EVENT, hash: '', overrides: { course: COURSE_SUPPRESSED } }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `06-home-suppressed-${vp.tag}.png`) });
      await page.evaluate(() => document.getElementById('homeBoard')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(OUTDIR, `06b-home-suppressed-scrolled-${vp.tag}.png`) });
    });

    // ---- 7: Home, off-phase (no slice) ----
    await shoot(browser, { id: '07-home-off-phase', now: NOW_OFF, hash: '' }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `07-home-off-phase-${vp.tag}.png`) });
    });

    // ---- 8a: masthead bar on a data view (not Board) ----
    await shoot(browser, { id: '08a-masthead-data-view', now: NOW_EVENT, hash: '#schedule' }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `08a-masthead-data-view-${vp.tag}.png`) });
      measurements['masthead-schedule-event-' + vp.tag] = await measureMasthead(page);
    });

    // ---- 8b: Board masthead, off-phase (est-line chip state) ----
    await shoot(browser, { id: '08b-board-masthead-offphase', now: NOW_OFF, hash: '#board' }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `08b-board-masthead-offphase-${vp.tag}.png`) });
      measurements['masthead-board-off-' + vp.tag] = await measureMasthead(page);
    });

    // ---- 9: Now/Next strip + announce banner (event phase, T6 lower third) ----
    await shoot(browser, { id: '09-nownext-announce', now: NOW_EVENT, hash: '', overrides: { announce: ANN_EVENT } }, async ({ page, vp }) => {
      await page.screenshot({ path: path.join(OUTDIR, `09-nownext-announce-${vp.tag}.png`) });
    });

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
