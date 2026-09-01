// Render-close PNG battery for GFY §26 (event-kit wave, K-TV/K-QR/K-PRINT).
// Network-sealed, real-browser screenshots. Read-only against the worktree's
// product code (index.html is only ever patched IN A SERVED RESPONSE, never
// on disk; the print generator runs its own PURE generateKit() with fixture
// text, writing only into the already-gitignored tools/print/out/). Pattern
// copied from .worktrees/s25b's own render-close/render.js (itself copied
// from s25a) per the Task 4 brief, adapted for this wave's TV + print
// battery. The s25a/s25b workspaces themselves are never touched.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const WORKTREE = '/Users/riley/Code/gfy/.worktrees/s26';
const OUTDIR = path.join(WORKTREE, '.superpowers/sdd/2026-09-01-gfy-s26-event-kit/render-close');
const PORT = 8942; // distinct from s25a's 8940 and s25b's 8941
const BASE = `http://127.0.0.1:${PORT}`;

// Same GID table config.js ships in THIS worktree.
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

// ---- TV fixture builders ----

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 5, 3, 4, 4, 4, 3, 5, 4]; // fixtures/course.csv, 18 holes, par sum 72
function totalsToHoles(total) {
  const delta = total - 72;
  const per = PARS.slice();
  const mag = Math.abs(delta), sign = delta < 0 ? -1 : 1;
  for (let i = 0; i < mag; i++) per[i % 18] += sign;
  return per;
}
const fieldHeader = FIXTURES.field.split(/\r\n|\n/)[0];
const scoresHeader = FIXTURES.scores.split(/\r\n|\n/)[0];
const scheduleHeader = FIXTURES.schedule.split(/\r\n|\n/)[0];
const courseHeader = FIXTURES.course.split(/\r\n|\n/)[0];

// Item: 12-team fixture with a REAL tie at the rank-5 boundary — T05/T06
// share the identical total (72), so tvLeaderboardCut's `pos===players[4].pos`
// arm includes BOTH, giving a 6-row "5-plus-ties" cut from a 12-team field.
const TIE_TEAMS = [
  ['T01', 68], ['T02', 69], ['T03', 70], ['T04', 71],
  ['T05', 72], ['T06', 72], // tie
  ['T07', 74], ['T08', 75], ['T09', 76], ['T10', 77], ['T11', 78], ['T12', 79],
];
const FIELD_TIE = fieldHeader + '\n' + TIE_TEAMS.map(([t]) => `2026,${t},${t},2020,10,In,TRUE,`).join('\n');
const SCORES_TIE = scoresHeader + '\n' + TIE_TEAMS.map(([t, total]) => {
  const holes = totalsToHoles(total);
  return [2026, t, 1, ...holes, '', ''].join(',');
}).join('\n');

// Item: Leaderboard honest-empty — header-only scores, same idiom as
// s25a/s25b's own SCORES_EMPTY fixtures.
const SCORES_EMPTY = scoresHeader + '\n';
// Item: Schedule honest-empty — header-only schedule.
const SCHEDULE_EMPTY = scheduleHeader + '\n';
// Item: Card panel empty (totals-only, no hole-by-hole card yet) — same
// five default-fixture teams, but every row carries ONLY r1/r2 totals, no
// h1..h18 — renderScoreGrid's "No hole-by-hole cards yet" branch (courseMap
// still resolves, `rounds` ends up empty since no row has .holes).
const TOTALS_ONLY_TEAMS = ['Duck', 'Sully', 'Moose', 'Tex', 'Bear'];
const SCORES_TOTALS_ONLY = scoresHeader + '\n' + TOTALS_ONLY_TEAMS.map((t, i) =>
  [2026, t, '', ...Array(18).fill(''), 70 + i, 71 + i].join(',')).join('\n');
// Item: suppressed board — course tab missing hole 18's par (17/18 valid),
// courseMap() requires all 18, so this suppresses To-par/standings site-wide
// for the season, same trigger index.html's own courseMap() comment names.
const COURSE_SUPPRESSED = courseHeader + '\n' + FIXTURES.course.split(/\r\n|\n/).slice(1, 18).join('\n');

const NOW_EVENT = '2026-08-15T14:00:00-06:00'; // inside first_tee (Aug15 09:00) +-3d, Day Two's own bucket
function fmtOffset(iso) { return new Date(iso).getTime(); }
const TV_VIEWPORTS = [
  { tag: '1280x720', width: 1280, height: 720 },
  { tag: '1920x1080', width: 1920, height: 1080 },
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
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname === 'docs.google.com') {
      const gid = url.searchParams.get('gid');
      const tab = TAB_BY_GID[gid];
      if (!tab) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no such gid (test harness)' });
      const ov = overrides[tab];
      const csv = ov !== undefined ? ov : (FIXTURES[tab] !== undefined ? FIXTURES[tab] : readFixture(tab));
      return route.fulfill({ status: 200, contentType: 'text/csv', body: csv });
    }
    // Google Fonts stylesheet the print pages link to — abort (network-
    // sealed), the pages degrade to the declared fallback stack, irrelevant
    // to every pixel check this battery makes (brass/bone/type SCALE, QR
    // finder patterns, page geometry — none depend on the webfont loading).
    return route.abort();
  });
}

async function waitForTvPaint(page) {
  await page.waitForFunction(() => document.querySelectorAll('#tvLbBody .lb-row').length > 0
    || document.querySelector('#tvLbBody .lb-empty') !== null, { timeout: 15000 });
}

const results = [];
const measurements = {};

async function newCtx(browser, vp, extra) {
  const context = await browser.newContext(Object.assign({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    timezoneId: 'America/Denver',
  }, extra || {}));
  const consoleErrors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });
  return { context, page, consoleErrors };
}

async function tvSession(browser, { overrides, now }, fn) {
  for (const vp of TV_VIEWPORTS) {
    const { context, page, consoleErrors } = await newCtx(browser, vp, {});
    await installRoutes(context, overrides || {});
    await page.clock.install({ time: fmtOffset(now) });
    await page.goto(BASE + '/index.html#tv', { waitUntil: 'load' });
    await waitForTvPaint(page);
    await fn({ page, vp });
    results.push({ vp: vp.tag, consoleErrors });
    await context.close();
  }
}

async function shootTvPanel(page, vp, id) {
  await page.screenshot({ path: path.join(OUTDIR, `${id}-${vp.tag}.png`) });
}

async function tvMeasure(page) {
  return page.evaluate(() => {
    const wrap = document.documentElement;
    const foot = document.querySelector('.tv-foot');
    const dots = [...document.querySelectorAll('.tv-dot')].map(d => ({
      on: d.classList.contains('on'), bg: getComputedStyle(d).backgroundColor,
    }));
    const dotLabels = [...document.querySelectorAll('.tv-dot-label')].map(l => ({
      text: l.textContent.trim(), color: getComputedStyle(l).color,
    }));
    const footCs = foot ? getComputedStyle(foot) : null;
    const note = document.querySelector('.tv-rotate-note');
    const noteCs = note ? getComputedStyle(note) : null;
    const mast = document.querySelector('.tv-mast');
    // Scoped to #tvMode — the bare ".mast-mark"/".mast-name" class names are
    // ALSO used by the site's normal (non-TV) #mastBar, which appears
    // EARLIER in DOM order and stays display:none on the tv view
    // (body[data-view="tv"] #mastBar{display:none}); an unscoped
    // querySelector would silently grab that hidden element instead
    // (0x0 rect, base .72rem font-size) and never see the TV override.
    const mastMark = document.querySelector('#tvMode .mast-mark');
    const mastName = document.querySelector('#tvMode .mast-name');
    const body = getComputedStyle(document.body);
    const rows = [...document.querySelectorAll('#tvLbBody .lb-row')];
    const leadRow = document.querySelector('#tvLbBody .lb-row.lead');
    return {
      pageHorizontalOverflow: wrap.scrollWidth > wrap.clientWidth,
      pageVerticalOverflow: wrap.scrollHeight > wrap.clientHeight,
      footBorderTop: footCs ? footCs.borderTopWidth + ' ' + footCs.borderTopStyle + ' ' + footCs.borderTopColor : null,
      footJustify: footCs ? footCs.justifyContent : null,
      noteAlign: note ? note.getBoundingClientRect().right : null,
      noteColor: noteCs ? noteCs.color : null,
      noteText: note ? note.textContent.trim() : null,
      dots, dotLabels,
      mastMarkSize: mastMark ? (() => { const r = mastMark.getBoundingClientRect(); return { w: r.width, h: r.height }; })() : null,
      mastNameFontSize: mastName ? getComputedStyle(mastName).fontSize : null,
      bodyBg: body.backgroundColor,
      rowCount: rows.length,
      leadRowBg: leadRow ? getComputedStyle(leadRow).backgroundColor : null,
      posFontSize: rows[0] ? getComputedStyle(rows[0].querySelector('.lb-pos')).fontSize : null,
      nameFontSize: rows[0] ? getComputedStyle(rows[0].querySelector('.lb-name')).fontSize : null,
      totFontSize: rows[0] ? getComputedStyle(rows[0].querySelector('.lb-tot:last-child')).fontSize : null,
    };
  });
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const srv = await startServer();
  let browser;
  try {
    browser = await chromium.launch();

    /* ================= TV BATTERY ================= */

    // ---- 01: Leaderboard fresh (panel 0) + Card full 18-col (panel 1) +
    // Schedule fresh (panel 2) — one session, default fixtures, NOW_EVENT
    // anchor. Panels advanced by hand (STATE.tvPanel + renderTv()) rather
    // than the real 20s timer — deterministic, no fake-clock timer cascade.
    await tvSession(browser, { now: NOW_EVENT }, async ({ page, vp }) => {
      await shootTvPanel(page, vp, '01-tv-lb-fresh');
      measurements['lbFresh-' + vp.tag] = await tvMeasure(page);
      const clockText = await page.$eval('#tvClock', el => el.textContent.trim());
      measurements['lbFresh-' + vp.tag].clockText = clockText;

      // ---- 02: stale stamp — backdate STATE.tvLastFetchAt 6min behind the
      // SAME fixed clock (no fastForward -> no REFRESH_MS/TV_TIMER firing),
      // re-render just the Leaderboard panel.
      await page.evaluate(() => { STATE.tvLastFetchAt = Date.now() - 6 * 60 * 1000; renderTv(); });
      await shootTvPanel(page, vp, '02-tv-lb-stale');
      const staleClock = await page.$eval('#tvClock', el => el.textContent.trim());
      measurements['lbStale-' + vp.tag] = { clockText: staleClock };
      // restore for the panel advances below
      await page.evaluate(() => { STATE.tvLastFetchAt = Date.now(); renderTv(); });

      // ---- Card panel (18 holes, default round-1/round-2 fixture data) ----
      await page.evaluate(() => { STATE.tvPanel = 1; renderTv(); });
      await page.waitForTimeout(80);
      await shootTvPanel(page, vp, '03-tv-card-full');
      measurements['cardFull-' + vp.tag] = await page.evaluate(() => {
        const scroll = document.querySelector('#tvGridScroll');
        const table = document.querySelector('#tvGridTable');
        const label = document.querySelector('#tvRoundLabel');
        const holeCount = table ? table.querySelectorAll('thead th.sg-h').length : 0;
        return {
          scrollWidth: scroll ? scroll.scrollWidth : null,
          clientWidth: scroll ? scroll.clientWidth : null,
          horizontalCut: scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : null,
          holeCount, roundLabel: label ? label.textContent.trim() : null,
          docScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });

      // ---- Schedule panel (today's Day Two row, NOW_EVENT anchor) ----
      await page.evaluate(() => { STATE.tvPanel = 2; renderTv(); });
      await shootTvPanel(page, vp, '04-tv-sched-fresh');
      measurements['schedFresh-' + vp.tag] = await page.evaluate(() => {
        const el = document.querySelector('#tvSchedBody');
        return { text: el ? el.textContent.trim() : null, slotCount: document.querySelectorAll('#tvSchedBody .slot').length };
      });
    });

    // ---- 05: suppressed board (course missing hole 18's par) ----
    await tvSession(browser, { now: NOW_EVENT, overrides: { course: COURSE_SUPPRESSED } }, async ({ page, vp }) => {
      await shootTvPanel(page, vp, '05-tv-lb-suppressed');
      measurements['lbSuppressed-' + vp.tag] = await page.evaluate(() => {
        const head = document.querySelector('#tvToParHead');
        const note = document.querySelector('#tvSuppNote');
        const scale = document.querySelector('.tv-scale');
        return {
          headerText: head ? head.textContent.trim() : null,
          noteHidden: note ? note.hidden : null,
          noteText: note && !note.hidden ? note.textContent.trim() : null,
          scaleHasSuppressedClass: scale ? scale.classList.contains('lb-suppressed') : null,
        };
      });
    });

    // ---- 06/07: honest-empty — header-only scores AND schedule together
    // (Leaderboard panel 0 + Schedule panel 2, one session) ----
    await tvSession(browser, { now: NOW_EVENT, overrides: { scores: SCORES_EMPTY, schedule: SCHEDULE_EMPTY } }, async ({ page, vp }) => {
      await shootTvPanel(page, vp, '06-tv-lb-empty');
      measurements['lbEmpty-' + vp.tag] = await page.evaluate(() => {
        const el = document.querySelector('#tvLbBody .lb-empty');
        return el ? { text: el.textContent.trim(), color: getComputedStyle(el).color } : null;
      });
      await page.evaluate(() => { STATE.tvPanel = 2; renderTv(); });
      await shootTvPanel(page, vp, '07-tv-sched-empty');
      measurements['schedEmpty-' + vp.tag] = await page.evaluate(() => {
        const el = document.querySelector('#tvSchedBody .sched-empty');
        return el ? { text: el.textContent.trim() } : null;
      });
    });

    // ---- 08: Card panel honest-empty (totals-only fixture -> "No
    // hole-by-hole cards yet" message, courseMap still resolves) ----
    await tvSession(browser, { now: NOW_EVENT, overrides: { scores: SCORES_TOTALS_ONLY } }, async ({ page, vp }) => {
      await page.evaluate(() => { STATE.tvPanel = 1; renderTv(); });
      await shootTvPanel(page, vp, '08-tv-card-empty');
      measurements['cardEmpty-' + vp.tag] = await page.evaluate(() => {
        const note = document.querySelector('#tvGridNote');
        return note ? { hidden: note.hidden, text: note.textContent.trim() } : null;
      });
    });

    // ---- 09: 12-team fixture, real tie at rank 5 -> 6-row "5-plus-ties"
    // cut. Confirms no overflow into the footer (measured, not eyeballed). ----
    await tvSession(browser, { now: NOW_EVENT, overrides: { field: FIELD_TIE, scores: SCORES_TIE } }, async ({ page, vp }) => {
      await shootTvPanel(page, vp, '09-tv-lb-12team-ties');
      measurements['lb12TeamTies-' + vp.tag] = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#tvLbBody .lb-row')];
        const foot = document.querySelector('.tv-foot');
        const footTop = foot ? foot.getBoundingClientRect().top : null;
        const lastRowBottom = rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom : null;
        return {
          rowCount: rows.length,
          positions: rows.map(r => r.querySelector('.lb-pos')?.textContent.trim()),
          footTop, lastRowBottom,
          overlapsFooter: (footTop !== null && lastRowBottom !== null) ? lastRowBottom > footTop : null,
          pageVerticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        };
      });
    });

    fs.writeFileSync(path.join(OUTDIR, 'raw-results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTDIR, 'measurements.json'), JSON.stringify(measurements, null, 2));
    console.log('TV BATTERY DONE');

    /* ================= PRINT BATTERY ================= */
    const makeKitUrl = pathToFileURL(path.join(WORKTREE, 'tools', 'print', 'make-kit.mjs')).href;
    const { generateKit } = await import(makeKitUrl);

    const OUT_DIR_PRINT = path.join(WORKTREE, 'tools', 'print', 'out');
    fs.mkdirSync(OUT_DIR_PRINT, { recursive: true });

    const fieldCsvFixture = readFixture('field');
    const infoCsvFixture = readFixture('info');
    const printNow = new Date('2026-09-01T12:34:00-06:00');
    const kitFixture = generateKit({ fieldCsv: fieldCsvFixture, infoCsv: infoCsvFixture, now: printNow });
    fs.writeFileSync(path.join(OUT_DIR_PRINT, 'poster.html'), kitFixture.poster, 'utf8');
    fs.writeFileSync(path.join(OUT_DIR_PRINT, 'captain-cards.html'), kitFixture.cards, 'utf8');
    measurements.printFixtureKit = { teamCount: kitFixture.teamCount, season: kitFixture.season, warnings: kitFixture.warnings };

    const PRINT_VIEWPORT = { width: 850, height: 1100 }; // ~Letter aspect at 100 CSS px/in, whole page visible

    // ---- poster.html + captain-cards.html at print (Letter) aspect ----
    {
      const { context, page } = await newCtx(browser, PRINT_VIEWPORT, { deviceScaleFactor: 2 });
      await installRoutes(context, {});
      await page.goto(BASE + '/tools/print/out/poster.html', { waitUntil: 'load' });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUTDIR, '10-poster-letter.png'), fullPage: true });
      const posterQr = await page.evaluate(() => {
        const el = document.querySelector('.qr-block');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (posterQr) {
        await page.screenshot({
          path: path.join(OUTDIR, '11-poster-qr-crop.png'),
          clip: { x: Math.max(0, posterQr.x - 6), y: Math.max(0, posterQr.y - 6), width: posterQr.w + 12, height: posterQr.h + 12 },
        });
      }
      measurements.posterPage = await page.evaluate(() => {
        const stamp = document.querySelector('.stamp');
        return {
          title: document.title,
          hasDates: !!document.querySelector('.dates'),
          datesText: document.querySelector('.dates')?.textContent.trim(),
          venueText: document.querySelector('.venue')?.textContent.trim(),
          conditionsText: document.querySelector('.conditions')?.textContent.trim(),
          stampText: stamp ? stamp.textContent.trim() : null,
          crestSrcOk: !!document.querySelector('.crest') && document.querySelector('.crest').naturalWidth > 0,
        };
      });
      await context.close();
    }
    {
      const { context, page } = await newCtx(browser, PRINT_VIEWPORT, { deviceScaleFactor: 2 });
      await installRoutes(context, {});
      await page.goto(BASE + '/tools/print/out/captain-cards.html', { waitUntil: 'load' });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUTDIR, '12-captain-cards-letter.png'), fullPage: true });
      const firstQr = await page.evaluate(() => {
        const el = document.querySelector('.card-qr');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (firstQr) {
        await page.screenshot({
          path: path.join(OUTDIR, '13-cards-qr-crop.png'),
          clip: { x: Math.max(0, firstQr.x - 6), y: Math.max(0, firstQr.y - 6), width: firstQr.w + 12, height: firstQr.h + 12 },
        });
      }
      measurements.cardsPage = await page.evaluate(() => ({
        title: document.title,
        cardCount: document.querySelectorAll('.card').length,
        headText: document.querySelector('.cards-head')?.textContent.trim(),
        atCount: (document.body.innerHTML.match(/@/g) || []).length,
      }));
      await context.close();
    }

    // ---- Chrome print-pagination check: 15-team synthetic fixture, real
    // page.pdf() paginated output. Verifies no card's own text (its "TEAM "
    // header vs its own "Generated ..." stamp, paired by strict source
    // order — see the per-card text-pairing note below) is split across a
    // page break, per the T3 reviewer's flex-wrap+break-inside flag. ----
    const CARD_TEAMS_15 = Array.from({ length: 15 }, (_, i) => `Card${String(i + 1).padStart(2, '0')}`);
    const FIELD_CSV_15 = 'year,player,team\n' + CARD_TEAMS_15.map(t => `2026,${t},${t}`).join('\n');
    const kit15 = generateKit({ fieldCsv: FIELD_CSV_15, infoCsv: infoCsvFixture, now: printNow });
    measurements.print15TeamKit = { teamCount: kit15.teamCount, season: kit15.season };
    const cards15Path = path.join(OUT_DIR_PRINT, 'captain-cards-15team.html');
    fs.writeFileSync(cards15Path, kit15.cards, 'utf8');

    {
      const { context, page } = await newCtx(browser, PRINT_VIEWPORT, { deviceScaleFactor: 1 });
      await installRoutes(context, {});
      await page.goto(BASE + '/tools/print/out/captain-cards-15team.html', { waitUntil: 'load' });
      await page.waitForTimeout(150);
      const pdfPath = path.join(OUTDIR, '14-captain-cards-15team.pdf');
      await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true });
      await context.close();

      // Analyze the PDF with pdfjs-dist (legacy/node build) — extract every
      // text item's page + reading position, then PAIR each card's "TEAM "
      // header with its own "Generated ..." stamp by strict document order
      // (cards are emitted team-header-then-stamp, in the SAME alphabetical
      // sequence make-kit.mjs sorts them into — see buildCardsHtml/cardHtml).
      // If headers[i].page !== stamps[i].page for any i, that card's box was
      // split across the page break.
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const data = new Uint8Array(fs.readFileSync(pdfPath));
      const doc = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: true }).promise;
      const headers = [], stamps = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        // Group same-line runs isn't necessary — pdfjs already yields
        // reasonably-segmented items; sort by reading order (top-to-bottom,
        // i.e. descending y, then left-to-right) purely for a stable,
        // human-checkable measurements.json dump.
        const items = content.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
          .sort((a, b) => (b.y - a.y) || (a.x - b.x));
        items.forEach(it => {
          // .card-team's letter-spacing:.14em makes Chromium's PDF text
          // layer emit one space-separated run PER GLYPH ("T E A M C A R D
          // 0 1") rather than one run for the whole line — compact out all
          // whitespace before matching so the check is robust to exactly
          // how the glyphs got segmented.
          const compact = it.str.replace(/\s+/g, '');
          if (/^TEAM/i.test(compact)) headers.push({ page: p, text: it.str.trim() });
          if (/^Generated/i.test(compact)) stamps.push({ page: p, text: it.str.trim() });
        });
      }
      const n = Math.max(headers.length, stamps.length);
      const pairs = [];
      let splitCount = 0;
      for (let i = 0; i < n; i++) {
        const h = headers[i], s = stamps[i];
        const split = !h || !s || h.page !== s.page;
        if (split) splitCount++;
        pairs.push({ i, header: h || null, stamp: s || null, split });
      }
      measurements.pdfPagination = {
        numPages: doc.numPages,
        teamCount: CARD_TEAMS_15.length,
        headerCount: headers.length,
        stampCount: stamps.length,
        splitCount,
        pairs,
      };
      console.log('PDF PAGINATION:', JSON.stringify(measurements.pdfPagination, null, 2));
    }

    fs.writeFileSync(path.join(OUTDIR, 'raw-results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTDIR, 'measurements.json'), JSON.stringify(measurements, null, 2));
    console.log('DONE');
  } catch (e) {
    console.error('RENDER_ERROR', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
}

main();
