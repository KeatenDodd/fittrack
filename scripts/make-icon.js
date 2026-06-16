'use strict';
// Rasterizes the FitTrack logo (rounded square + green dumbbell) into a
// multi-size Windows .ico — pure Node, no image libraries. 4x supersampled for
// clean edges. Writes public/favicon.ico (used by the browser + the tray icon).
const fs = require('fs');
const path = require('path');

const BG = [31, 41, 55];      // #1F2937
const GREEN = [34, 197, 94];  // #22C55E
const GREEN_RECTS = [         // x, y, w, h  (from the SVG, 128x128 space)
  [20, 42, 10, 44], [34, 34, 12, 60], [46, 58, 36, 12], [82, 34, 12, 60], [98, 42, 10, 44],
];

function inRect(sx, sy, x, y, w, h) { return sx >= x && sx < x + w && sy >= y && sy < y + h; }
function inRounded(sx, sy, x, y, w, h, r) {
  if (sx < x || sx >= x + w || sy < y || sy >= y + h) return false;
  const rx = Math.min(r, w / 2);
  const ry = Math.min(r, h / 2);
  let cx = null;
  let cy = null;
  if (sx < x + rx && sy < y + ry) { cx = x + rx; cy = y + ry; }
  else if (sx > x + w - rx && sy < y + ry) { cx = x + w - rx; cy = y + ry; }
  else if (sx < x + rx && sy > y + h - ry) { cx = x + rx; cy = y + h - ry; }
  else if (sx > x + w - rx && sy > y + h - ry) { cx = x + w - rx; cy = y + h - ry; }
  if (cx !== null) { const dx = sx - cx; const dy = sy - cy; return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1; }
  return true;
}

// color at an SVG-space point -> [r,g,b,a]
function sample(sx, sy) {
  for (const [x, y, w, h] of GREEN_RECTS) if (inRect(sx, sy, x, y, w, h)) return [GREEN[0], GREEN[1], GREEN[2], 255];
  if (inRounded(sx, sy, 0, 0, 128, 128, 24)) return [BG[0], BG[1], BG[2], 255];
  return [0, 0, 0, 0];
}

// Render an NxN RGBA buffer (top-down), 4x supersampled.
function render(N) {
  const SS = 4;
  const out = Buffer.alloc(N * N * 4);
  for (let py = 0; py < N; py += 1) {
    for (let px = 0; px < N; px += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const fx = ((px + (sx + 0.5) / SS) / N) * 128;
          const fy = ((py + (sy + 0.5) / SS) / N) * 128;
          const c = sample(fx, fy);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = SS * SS;
      const o = (py * N + px) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// One 32bpp BMP/DIB image (color rows bottom-up BGRA + empty AND mask).
function dibImage(N, px) {
  const rowMask = (((N + 31) >> 5) << 2);
  const maskSize = rowMask * N;
  const buf = Buffer.alloc(40 + N * N * 4 + maskSize);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(N, 4);
  buf.writeInt32LE(N * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(N * N * 4 + maskSize, 20);
  let off = 40;
  for (let row = N - 1; row >= 0; row -= 1) {
    for (let col = 0; col < N; col += 1) {
      const i = (row * N + col) * 4;
      buf[off++] = px[i + 2]; buf[off++] = px[i + 1]; buf[off++] = px[i]; buf[off++] = px[i + 3];
    }
  }
  return buf;
}

function buildIco(aSizes) {
  const aImg = aSizes.map((N) => ({ N, buf: dibImage(N, render(N)) }));
  const oHeader = Buffer.alloc(6 + 16 * aImg.length);
  oHeader.writeUInt16LE(0, 0); oHeader.writeUInt16LE(1, 2); oHeader.writeUInt16LE(aImg.length, 4);
  let iOffset = 6 + 16 * aImg.length;
  const aParts = [oHeader];
  aImg.forEach((im, idx) => {
    const e = 6 + 16 * idx;
    oHeader.writeUInt8(im.N >= 256 ? 0 : im.N, e);
    oHeader.writeUInt8(im.N >= 256 ? 0 : im.N, e + 1);
    oHeader.writeUInt16LE(1, e + 4);
    oHeader.writeUInt16LE(32, e + 6);
    oHeader.writeUInt32LE(im.buf.length, e + 8);
    oHeader.writeUInt32LE(iOffset, e + 12);
    iOffset += im.buf.length;
    aParts.push(im.buf);
  });
  return Buffer.concat(aParts);
}

// web favicon (small sizes keep the file light)
const sWeb = path.join(__dirname, '..', 'public', 'favicon.ico');
fs.writeFileSync(sWeb, buildIco([16, 32, 48]));
console.log('Wrote ' + sWeb);

// .exe application icon (full size range, incl. 256 for Explorer large icons)
const sBuildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(sBuildDir, { recursive: true });
const sApp = path.join(sBuildDir, 'FitTrack.ico');
fs.writeFileSync(sApp, buildIco([16, 24, 32, 48, 64, 128, 256]));
console.log('Wrote ' + sApp);
