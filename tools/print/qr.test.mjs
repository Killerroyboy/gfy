// tools/print/qr.test.mjs — standalone test for the vendored QR encoder
// (qr-vendor.mjs) + the API layer (qr.mjs). Run directly:
//   node tools/print/qr.test.mjs
// Nonzero exit on any FAIL. Also gated by test/smoke.mjs's S26-T2a check
// (file-presence + license-header assertion — this file is the one that
// actually runs the QR logic; smoke.mjs never shells out to child tool
// tests, so it does not spawn this file).
import { createHash } from "node:crypto";
import { qrSvg, qrEncode, qrMatrix } from "./qr.mjs";

const results = [];
function check(name, ok, detail = "") {
  results.push([name, ok]);
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : "   [" + detail + "]"));
}

const SITE_ROOT = "https://killerroyboy.github.io/gfy/";
const SCORE_URL = "https://killerroyboy.github.io/gfy/#score?team=Wade%20Johnson";

/* ---------- (a) finder patterns at three corners (module-matrix API) ---------- */
{
  // The QR spec's 7x7 finder pattern: a solid dark border ring (row/col 0
  // or 6), a light ring inside that (row/col 1 or 5), and a solid dark 3x3
  // core (rows/cols 2-4) — exactly what setupPositionProbePattern draws in
  // the vendored core.
  function finderPatternAt(matrix, r0, c0) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const expectedDark = (r === 0 || r === 6 || c === 0 || c === 6)
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        if (matrix[r0 + r][c0 + c] !== expectedDark) {
          return false;
        }
      }
    }
    return true;
  }

  const matrix = qrMatrix(SITE_ROOT);
  const count = matrix.length;
  const topLeftOk = finderPatternAt(matrix, 0, 0);
  const topRightOk = finderPatternAt(matrix, 0, count - 7);
  const bottomLeftOk = finderPatternAt(matrix, count - 7, 0);

  check("K-QR-a: 7x7 finder pattern (dark border ring, light ring, dark 3x3 core) present at all three corners of the module matrix",
    topLeftOk && topRightOk && bottomLeftOk,
    "topLeft=" + topLeftOk + " topRight=" + topRightOk + " bottomLeft=" + bottomLeftOk + " moduleCount=" + count);
}

/* ---------- (b) determinism + pinned change-detector hash ---------- */
{
  const svg1 = qrSvg(SITE_ROOT);
  const svg2 = qrSvg(SITE_ROOT);
  const deterministicOk = svg1 === svg2;

  const PINNED_SHA256 = "589cb8f0e66d4abcfdacf70eee9b3286f22993eff0fd78bc25778a7f49e98c20";
  const actualSha256 = createHash("sha256").update(svg1).digest("hex");
  const hashOk = actualSha256 === PINNED_SHA256;

  check("K-QR-b: qrSvg(text) is deterministic — two calls with the same input produce byte-identical svg strings",
    deterministicOk, "len1=" + svg1.length + " len2=" + svg2.length);
  check("K-QR-b2: qrSvg(\"" + SITE_ROOT + "\") sha256 matches the pinned change-detector hash",
    hashOk, "expected=" + PINNED_SHA256 + " actual=" + actualSha256);
}

/* ---------- (c) both real kit URLs encode without throwing ---------- */
{
  let siteRootOk = false, siteRootErr = "";
  try { qrEncode(SITE_ROOT); siteRootOk = true; }
  catch (e) { siteRootErr = e.message; }

  let scoreUrlOk = false, scoreUrlErr = "";
  try { qrEncode(SCORE_URL); scoreUrlOk = true; }
  catch (e) { scoreUrlErr = e.message; }

  check("K-QR-c1: the site root URL (" + SITE_ROOT + ") encodes without throwing",
    siteRootOk, siteRootErr);
  check("K-QR-c2: the score-tab deep link with a URL-encoded space (" + SCORE_URL + ") encodes without throwing",
    scoreUrlOk, scoreUrlErr);
}

/* ---------- (d) timing patterns: alternating modules on row/col 6 ---------- */
{
  const matrix = qrMatrix(SITE_ROOT);
  const count = matrix.length;

  // setupTimingPattern fills row 6 / col 6 with alternating dark/light for
  // indices in [8, moduleCount-9] — the band strictly between the two
  // finder patterns (which otherwise occupy rows/cols 0-7 near each end).
  let rowOk = true;
  for (let c = 8; c <= count - 9; c++) {
    if (matrix[6][c] !== (c % 2 === 0)) { rowOk = false; break; }
  }
  let colOk = true;
  for (let r = 8; r <= count - 9; r++) {
    if (matrix[r][6] !== (r % 2 === 0)) { colOk = false; break; }
  }

  check("K-QR-d: timing patterns — row 6 and col 6 alternate dark/light (starting dark at the first even index) in the band between the finder patterns",
    rowOk && colOk, "rowOk=" + rowOk + " colOk=" + colOk + " moduleCount=" + count);
}

/* ---------- (e) svg sanity: viewBox + rect count ---------- */
{
  const moduleSize = 4, margin = 4; // qrSvg defaults
  const matrix = qrMatrix(SITE_ROOT);
  const count = matrix.length;
  const expectedSize = (count + margin * 2) * moduleSize;

  const svg = qrSvg(SITE_ROOT);
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const viewBoxOk = !!vb && Number(vb[1]) === expectedSize && Number(vb[2]) === expectedSize;

  const rectTags = svg.match(/<rect /g) || [];
  const darkCount = matrix.reduce((n, row) => n + row.filter(Boolean).length, 0);
  // rectTags includes the one solid background rect plus one rect per dark module.
  const rectCountOk = rectTags.length - 1 === darkCount;

  check("K-QR-e1: svg viewBox equals (moduleCount + 2*margin) * moduleSize",
    viewBoxOk, "expected=" + expectedSize + " viewBox=" + (vb ? vb[0] : "none"));
  check("K-QR-e2: svg rect count (excluding the background rect) equals the dark-module count",
    rectCountOk, "rects=" + rectTags.length + " darkCount=" + darkCount);
}

console.log("");
const failed = results.filter(r => !r[1]).length;
console.log(`TALLY TOTAL ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
