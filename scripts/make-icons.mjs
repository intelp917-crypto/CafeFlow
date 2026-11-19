#!/usr/bin/env node
/**
 * Generates the PWA PNG icons from a tiny deterministic raster (brand square,
 * white cup, saucer line). Kept in the repository so icons can be rebuilt
 * without a design tool or an image dependency.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BRAND = [0xaa, 0x47, 0x2b];
const WHITE = [0xff, 0xff, 0xff];
const SAUCER = [0x96, 0xa0, 0x9f];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Rough pixel tests in normalized coordinates (0..1), drawn on a square. */
function cupPixel(x, y) {
  const inBody = x > 0.24 && x < 0.66 && y > 0.38 && y < 0.68;
  const bodyEdge = inBody && !(x > 0.28 && x < 0.62 && y > 0.42 && y < 0.68);
  const dx = x - 0.7;
  const dy = y - 0.52;
  const radius = Math.hypot(dx, dy);
  const handle = radius > 0.055 && radius < 0.095 && x > 0.66;
  const saucer = y > 0.82 && y < 0.86 && x > 0.24 && x < 0.66;
  if (bodyEdge || handle) return WHITE;
  if (saucer) return SAUCER;
  return null;
}

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // no PNG filter
    for (let x = 0; x < size; x += 1) {
      const color = cupPixel(x / size, y / size) ?? BRAND;
      const offset = rowStart + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 0xff;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const target = resolve(`apps/web/public/icon-${size}.png`);
  writeFileSync(target, render(size));
  console.log(`نوشته شد: ${target}`);
}
