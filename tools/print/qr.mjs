// tools/print/qr.mjs — thin API over the vendored QR encoder core
// (tools/print/qr-vendor.mjs). Builds a self-contained inline <svg> string:
// one dark rect per dark module, on a solid light background rect, with
// shape-rendering="crispEdges" so print/screen rendering never blurs module
// edges. EC level is fixed at M; the type number is auto-selected (smallest
// version that fits the given text) by passing typeNumber=0 to the vendor
// factory.
import qrcode from "./qr-vendor.mjs";

const EC_LEVEL = "M";

// Runs the vendored encoder and returns the finished qrcode instance
// (isDark(row,col) / getModuleCount()) — the "module-matrix API" callers
// should use instead of parsing rendered SVG.
export function qrEncode(text) {
  const qr = qrcode(0, EC_LEVEL);
  qr.addData(String(text));
  qr.make();
  return qr;
}

// Returns the module matrix as a plain boolean[][] (row-major), for callers
// that want a snapshot rather than the live qrcode instance.
export function qrMatrix(text) {
  const qr = qrEncode(text);
  const count = qr.getModuleCount();
  const matrix = new Array(count);
  for (let row = 0; row < count; row++) {
    const r = new Array(count);
    for (let col = 0; col < count; col++) r[col] = qr.isDark(row, col);
    matrix[row] = r;
  }
  return matrix;
}

export function qrSvg(text, { moduleSize = 4, margin = 4, dark = "#0E2019", light = "#E9E3D3" } = {}) {
  const qr = qrEncode(text);
  const count = qr.getModuleCount();
  const size = (count + margin * 2) * moduleSize;

  let rects = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        const x = (col + margin) * moduleSize;
        const y = (row + margin) * moduleSize;
        rects += `<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}" fill="${dark}"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect x="0" y="0" width="${size}" height="${size}" fill="${light}"/>${rects}</svg>`;
}
