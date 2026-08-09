#!/usr/bin/env node
// Regenerates ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon1024.png.
// Zero dependencies (node:zlib only), RGB without alpha — App Store Connect
// rejects marketing icons that carry an alpha channel. Palette is the app's
// own (src/styles.css): paper, ink espresso, brick accent, amber.
'use strict';
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const W = 1024, H = 1024;
const px = Buffer.alloc(W * H * 3);

const PAPER = [0xF1, 0xEB, 0xDD];
const INK = [0x24, 0x18, 0x13];
const BRICK = [0x94, 0x29, 0x11];
const AMBER = [0x9D, 0x84, 0x20];
const PANEL3 = [0xD8, 0xCD, 0xB6];

function rect(x0, y0, x1, y1, [r, g, b]) {
  for (let y = y0; y < y1; y++) {
    let i = (y * W + x0) * 3;
    for (let x = x0; x < x1; x++) { px[i++] = r; px[i++] = g; px[i++] = b; }
  }
}

rect(0, 0, W, H, PAPER);

// Faint drafting grid, 128 px pitch (kept off the masked corners' danger zone).
for (let k = 128; k < W; k += 128) {
  rect(k - 1, 96, k + 1, H - 96, PANEL3);
  rect(96, k - 1, W - 96, k + 1, PANEL3);
}

// Table mark: overhung slab, two legs, one stretcher.
rect(232, 400, 792, 452, INK);   // slab
rect(287, 452, 339, 760, INK);   // left leg
rect(685, 452, 737, 760, INK);   // right leg
rect(339, 668, 685, 700, INK);   // stretcher

// Tri-stripe chrome under the mark: brick / amber / ink.
rect(232, 812, 792, 830, BRICK);
rect(232, 840, 792, 858, AMBER);
rect(232, 868, 792, 886, INK);

// PNG encode: 8-bit RGB (color type 2), filter 0 per scanline.
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: truecolor, no alpha

const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}

const out = path.join(__dirname, 'App/Assets.xcassets/AppIcon.appiconset/AppIcon1024.png');
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log('wrote', out);
