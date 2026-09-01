// tools/print/qr.test.mjs — standalone test for the vendored QR encoder
// (qr-vendor.mjs) + the API layer (qr.mjs). Run directly:
//   node tools/print/qr.test.mjs
// Nonzero exit on any FAIL. Also gated by test/smoke.mjs's S26-T2a check
// (file-presence + license-header assertion — this file is the one that
// actually runs the QR logic; smoke.mjs never shells out to child tool
// tests, so it does not spawn this file).
//
// Fix round 1 (spec review CRITICAL): the K-QR-a/b/c/d/e checks below are
// all STRUCTURAL — finder/timing shape, determinism, "encodes without
// throwing", svg geometry. Every one of them passed on a build that emitted
// a structurally perfect, RS-valid QR code decoding to an EMPTY payload
// (qr-vendor.mjs's createBytes() called the single-BIT accessor
// QRBitBuffer.get(index) instead of the byte array, so every data codeword
// collapsed to 0/1; the EC codewords were then computed correctly over that
// garbage, so RS validity and all structural shape checks passed anyway).
// Structural validity does not imply a correct payload. K-QR-f1/f2 below
// are the real fix: a decoder written fresh in THIS file (reads format info
// off the matrix, unmasks, zigzag-reads codewords in the same traversal
// order the encoder uses, de-interleaves per a locally-transcribed RS block
// table, parses the byte-mode header) that proves each real kit URL comes
// back out BYTE-FOR-BYTE. It shares no code path with qr-vendor.mjs's bit
// buffer beyond calling the public isDark()/getModuleCount() — a shared
// bug in that shared machinery cannot cancel out between encode and decode
// the way it would have under the original brief's vector (c) ("round-trip
// sanity vs the library's own .createDataURL consistency"): createDataURL
// was never vendored in the first place (scoped out as a non-core
// rendering helper — see qr-vendor.mjs's provenance comment), and even had
// it been, it renders a PNG data URL, not a text decode, so it wouldn't
// have caught this bug either. The independent decoder here is strictly
// stronger than what that vector would have given us.
//
// K-QR-g (also fix round 1): a payload round-trip through qr.mjs's
// auto-selected type number is not by itself sufficient to catch a broken
// per-version RS-block-table row — a capacity-reducing mutation near a
// version boundary can silently auto-upgrade to the NEXT version (whose
// table is untouched) instead of exposing the corruption. This was caught
// live: mutating the type4-M row and re-running K-QR-f2 (SCORE_URL, which
// auto-selects type4 under the correct table) still PASSED, because the
// mutation shrank type4's capacity just enough that auto-detect moved on to
// type5 instead. K-QR-g pins typeNumber=4 explicitly through the vendor
// factory (bypassing qr.mjs's auto-select) so a broken type4-M row cannot
// be sidestepped.
import { createHash } from "node:crypto";
import { qrSvg, qrEncode, qrMatrix } from "./qr.mjs";
import qrcodeVendor from "./qr-vendor.mjs";

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

  // Re-pinned in fix round 1 after the createBytes() bit-accessor fix (see
  // file header) changed the emitted payload. Independently computed twice
  // (by the reviewer building a decoder from scratch, and by re-running
  // this exact call after applying the fix) — both computations agreed on
  // this value before it was pinned.
  const PINNED_SHA256 = "8c3a53bc8f4ff0a74422383bfe9fe06b6767aaf4aa1212ef2bf53a4b8943e237";
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

/* ---------- (f) independent decode round-trip — the real payload proof ---------- */
// A from-scratch decoder: read format info off the matrix -> unmask ->
// zigzag-read codewords in the same traversal mapData() uses -> de-interleave
// per a block table transcribed independently in THIS file (not imported
// from qr-vendor.mjs, which doesn't export it) -> parse the byte-mode
// bitstream header -> extract the payload string. No Reed-Solomon
// correction is implemented or needed: the matrix under test is clean
// (freshly generated, not scanned off paper), so the codewords are read
// exactly as written and RS is only needed to correct channel damage that
// doesn't exist here. Covers EC level M / Byte mode / types 1-10, which is
// all this decoder needs to support since qr.mjs always requests EC level
// M and both real kit URLs land at type 3 and type 4.
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

// Alignment-pattern center coordinates, versions 1-10 (index 0 = version 1).
const PATTERN_POSITION_TABLE = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
  [6, 26, 46], [6, 28, 50],
];

// RS block layout for EC level M, versions 1-10: [count,totalCodewords,
// dataCodewords, ...] per block group — this decoder only needs to know
// how many data codewords to pull out of the de-interleaved stream, not
// how the EC codewords were computed.
const BLOCK_TABLE_M = {
  1: [1, 26, 16],
  2: [1, 44, 28],
  3: [1, 70, 44],
  4: [2, 50, 32],
  5: [2, 67, 43],
  6: [4, 43, 27],
  7: [4, 49, 31],
  8: [2, 60, 38, 2, 61, 39],
  9: [3, 58, 36, 2, 59, 37],
  10: [4, 69, 43, 1, 70, 44],
};

function maskFunctionFor(pattern) {
  switch (pattern) {
    case 0: return (i, j) => (i + j) % 2 === 0;
    case 1: return (i, j) => i % 2 === 0;
    case 2: return (i, j) => j % 3 === 0;
    case 3: return (i, j) => (i + j) % 3 === 0;
    case 4: return (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return (i, j) => (i * j) % 2 + (i * j) % 3 === 0;
    case 6: return (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0;
    case 7: return (i, j) => ((i * j) % 3 + (i + j) % 2) % 2 === 0;
    default: throw new Error("decoder: bad mask pattern " + pattern);
  }
}

// Reads the 15-bit format-info word from its (redundant) vertical strip at
// column 8 and undoes the fixed XOR mask. On a clean matrix this recovers
// (ecLevel<<3 | maskPattern) directly — no BCH error correction needed.
function readFormatInfo(qr, moduleCount) {
  let bits = 0;
  for (let i = 0; i < 15; i++) {
    let row, col;
    if (i < 6) { row = i; col = 8; }
    else if (i < 8) { row = i + 1; col = 8; }
    else { row = moduleCount - 15 + i; col = 8; }
    if (qr.isDark(row, col)) bits |= (1 << i);
  }
  const data = (bits ^ G15_MASK) >> 10;
  return { ecLevel: data >> 3, maskPattern: data & 0x7 };
}

// Marks every module position that is NOT part of the data area: the three
// finder patterns (+ separators), timing patterns, alignment patterns,
// both format-info strips, the fixed dark module, and (type>=7) the
// version-info blocks. Everything left unmarked is a data-area module, in
// the same set mapData() would have written into.
function buildReservedMask(moduleCount, typeNumber) {
  const reserved = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(false));
  function markFinder(row0, col0) {
    for (let r = -1; r <= 7; r++) {
      if (row0 + r <= -1 || moduleCount <= row0 + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col0 + c <= -1 || moduleCount <= col0 + c) continue;
        reserved[row0 + r][col0 + c] = true;
      }
    }
  }
  markFinder(0, 0);
  markFinder(moduleCount - 7, 0);
  markFinder(0, moduleCount - 7);

  for (let r = 8; r < moduleCount - 8; r++) reserved[r][6] = true;
  for (let c = 8; c < moduleCount - 8; c++) reserved[6][c] = true;

  const pos = PATTERN_POSITION_TABLE[typeNumber - 1] || [];
  for (const row of pos) {
    for (const col of pos) {
      if (reserved[row][col]) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) reserved[row + r][col + c] = true;
      }
    }
  }

  for (let i = 0; i < 15; i++) {
    if (i < 6) reserved[i][8] = true;
    else if (i < 8) reserved[i + 1][8] = true;
    else reserved[moduleCount - 15 + i][8] = true;

    if (i < 8) reserved[8][moduleCount - i - 1] = true;
    else if (i < 9) reserved[8][7] = true;
    else reserved[8][14 - i] = true;
  }
  reserved[moduleCount - 8][8] = true;

  if (typeNumber >= 7) {
    for (let i = 0; i < 18; i++) {
      reserved[Math.floor(i / 3)][i % 3 + moduleCount - 8 - 3] = true;
      reserved[i % 3 + moduleCount - 8 - 3][Math.floor(i / 3)] = true;
    }
  }
  return reserved;
}

// Same zigzag column-pair traversal mapData() uses to WRITE codeword bits,
// used here to READ them back in the identical order, unmasking as it goes.
function zigzagReadBits(qr, moduleCount, reserved, maskFn) {
  const bits = [];
  let inc = -1;
  let row = moduleCount - 1;
  for (let col = moduleCount - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    while (true) {
      for (let c = 0; c < 2; c++) {
        const curCol = col - c;
        if (!reserved[row][curCol]) {
          let dark = qr.isDark(row, curCol);
          if (maskFn(row, curCol)) dark = !dark;
          bits.push(dark ? 1 : 0);
        }
      }
      row += inc;
      if (row < 0 || moduleCount <= row) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
  return bits;
}

// Decodes an already-built qr instance (isDark()/getModuleCount() only —
// works the same whether the instance came from qr.mjs's auto-selecting
// qrEncode() or from calling the vendor factory directly with a pinned
// typeNumber, which is what K-QR-g below needs).
function decodeQrInstance(qr) {
  const moduleCount = qr.getModuleCount();
  const typeNumber = (moduleCount - 17) / 4;

  const { ecLevel, maskPattern } = readFormatInfo(qr, moduleCount);
  if (ecLevel !== 0) throw new Error("decoder only supports EC level M (0), got " + ecLevel);
  const maskFn = maskFunctionFor(maskPattern);

  const reserved = buildReservedMask(moduleCount, typeNumber);
  const bitArr = zigzagReadBits(qr, moduleCount, reserved, maskFn);

  const blockRow = BLOCK_TABLE_M[typeNumber];
  if (!blockRow) throw new Error("decoder has no block table entry for type " + typeNumber);
  const blocks = [];
  for (let i = 0; i < blockRow.length; i += 3) {
    const count = blockRow[i], total = blockRow[i + 1], data = blockRow[i + 2];
    for (let k = 0; k < count; k++) blocks.push({ total, data });
  }
  const totalCodewords = blocks.reduce((s, b) => s + b.total, 0);

  // bits -> codeword bytes; ignore any trailing remainder bits past totalCodewords*8.
  const codewords = [];
  for (let i = 0; i < totalCodewords; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | (bitArr[i * 8 + b] || 0);
    codewords.push(byte);
  }

  // De-interleave: reverse createBytes()'s round-robin-across-blocks order
  // for the data codewords (EC codewords are skipped — no RS correction).
  const maxDc = Math.max(...blocks.map((b) => b.data));
  const dcPerBlock = blocks.map(() => []);
  let idx = 0;
  for (let i = 0; i < maxDc; i++) {
    for (let bi = 0; bi < blocks.length; bi++) {
      if (i < blocks[bi].data) dcPerBlock[bi].push(codewords[idx++]);
    }
  }
  const dataBytes = [].concat(...dcPerBlock);

  let bitPos = 0;
  const readBits = (n) => {
    let v = 0;
    for (let k = 0; k < n; k++) {
      const byteIdx = bitPos >> 3, bitIdx = 7 - (bitPos % 8);
      v = (v << 1) | ((dataBytes[byteIdx] >>> bitIdx) & 1);
      bitPos++;
    }
    return v;
  };
  const mode = readBits(4);
  if (mode !== 4) throw new Error("decoder only supports Byte mode (4), got mode " + mode);
  const lenBits = typeNumber < 10 ? 8 : 16; // matches QRUtil.getLengthInBits(MODE_8BIT_BYTE, type)
  const length = readBits(lenBits);
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(readBits(8));
  return out;
}

function decodeQr(text) {
  return decodeQrInstance(qrEncode(text));
}

{
  let decodedRoot = null, rootErr = "";
  try { decodedRoot = decodeQr(SITE_ROOT); } catch (e) { rootErr = e.message; }
  let decodedScore = null, scoreErr = "";
  try { decodedScore = decodeQr(SCORE_URL); } catch (e) { scoreErr = e.message; }

  check("K-QR-f1: independent decode round-trip — the site root URL decodes back to the EXACT original string (the real payload proof; catches what K-QR-a/b/c/d/e cannot — see file header)",
    decodedRoot === SITE_ROOT, "decoded=" + JSON.stringify(decodedRoot) + " err=" + rootErr);
  check("K-QR-f2: independent decode round-trip — the score-tab deep link decodes back to the EXACT original string",
    decodedScore === SCORE_URL, "decoded=" + JSON.stringify(decodedScore) + " err=" + scoreErr);
}

/* ---------- (g) forced type4-M round-trip — pins the version under test ---------- */
{
  // See the file-header note: qr.mjs's auto-select can silently escape a
  // broken per-version RS-block-table row by upgrading to the next version.
  // Calling the vendor factory directly with typeNumber=4 pinned removes
  // that escape hatch and exercises the type4-M row exactly.
  let decoded = null, err = "", moduleCount = null;
  try {
    const qr = qrcodeVendor(4, "M");
    qr.addData(SITE_ROOT);
    qr.make();
    moduleCount = qr.getModuleCount();
    if (moduleCount !== 33) throw new Error("expected forced type4 moduleCount 33, got " + moduleCount);
    decoded = decodeQrInstance(qr);
  } catch (e) { err = e.message; }

  check("K-QR-g: forced-type4-M round-trip — qrcode(4,'M').addData(siteRootUrl) (typeNumber pinned directly through the vendor factory, bypassing qr.mjs's auto-select) decodes back to the EXACT original string",
    decoded === SITE_ROOT, "decoded=" + JSON.stringify(decoded) + " err=" + err + " moduleCount=" + moduleCount);
}

console.log("");
const failed = results.filter(r => !r[1]).length;
console.log(`TALLY TOTAL ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
