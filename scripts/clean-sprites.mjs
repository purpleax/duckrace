// Removes the off-white ring left around each duck by a cut-out from a white
// background, and gives the outline a soft edge.
//
//   node scripts/clean-sprites.mjs <source-folder> <output-folder> [preview-folder]
//
// Working inwards from the transparent area, it un-mixes pale grey pixels from
// white until it meets the dark outline. White inside the duck is not touched,
// because it is not connected to the outside. Only 8-bit RGBA PNGs are handled.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const WHITE = 205; // Anything this pale in the ring becomes fully transparent.
const MAX_DEPTH = 10; // Pixels; the ring is about five wide.
const MAX_SATURATION = 45; // The ring is grey; coloured pixels are left alone.
const MIN_LIGHT = 50; // Darker than this is the outline itself.

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decode(file) {
  const b = fs.readFileSync(file);
  let o = 8;
  let w = 0;
  let h = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString('ascii', o + 4, o + 8);
    const d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[9] !== 6 || d[12] !== 0) throw new Error(`${file}: not an 8-bit RGBA PNG`);
    }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0;
      const up = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      line[i] = v & 255;
    }
    line.copy(px, y * stride);
    prev = line;
  }
  return { w, h, px };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
}
function encode({ w, h, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function clean({ w, h, px }) {
  const depth = new Int16Array(w * h).fill(-1);
  let queue = [];
  for (let p = 0; p < w * h; p++) {
    if (px[p * 4 + 3] < 20) {
      depth[p] = 0;
      queue.push(p);
    }
  }
  const ring = [];
  while (queue.length) {
    const next = [];
    for (const p of queue) {
      if (depth[p] >= MAX_DEPTH) continue;
      const x = p % w;
      const y = (p - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (depth[q] >= 0) continue;
        const r = px[q * 4];
        const g = px[q * 4 + 1];
        const b = px[q * 4 + 2];
        const lo = Math.min(r, g, b);
        if (lo < MIN_LIGHT || Math.max(r, g, b) - lo > MAX_SATURATION) continue;
        depth[q] = depth[p] + 1;
        ring.push(q);
        next.push(q);
      }
    }
    queue = next;
  }
  // Un-mix each ring pixel from white: what is left is the outline's share of it.
  for (const q of ring) {
    const i = q * 4;
    const lo = Math.min(px[i], px[i + 1], px[i + 2]);
    const alpha = Math.max(0, Math.min(1, (WHITE - lo) / WHITE));
    for (let c = 0; c < 3; c++) {
      px[i + c] = alpha > 0 ? Math.max(0, Math.min(255, Math.round((px[i + c] - (1 - alpha) * WHITE) / alpha))) : 0;
    }
    px[i + 3] = Math.round(alpha * 255);
  }
  return ring.length;
}

/** The sprite over river blue, doubled in size, to check the edge by eye. */
function preview({ w, h, px }) {
  const out = Buffer.alloc(w * 2 * h * 2 * 4);
  const water = [73, 150, 205];
  for (let y = 0; y < h * 2; y++) {
    for (let x = 0; x < w * 2; x++) {
      const s = ((y >> 1) * w + (x >> 1)) * 4;
      const d = (y * w * 2 + x) * 4;
      const a = px[s + 3] / 255;
      for (let c = 0; c < 3; c++) out[d + c] = Math.round(px[s + c] * a + water[c] * (1 - a));
      out[d + 3] = 255;
    }
  }
  return { w: w * 2, h: h * 2, px: out };
}

const [src, dest, previews] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: node scripts/clean-sprites.mjs <source-folder> <output-folder> [preview-folder]');
  process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });
if (previews) fs.mkdirSync(previews, { recursive: true });
for (const name of fs.readdirSync(src).filter((f) => f.toLowerCase().endsWith('.png')).sort()) {
  const image = decode(path.join(src, name));
  if (previews) fs.writeFileSync(path.join(previews, `before-${name}`), encode(preview(image)));
  const changed = clean(image);
  fs.writeFileSync(path.join(dest, name), encode(image));
  if (previews) fs.writeFileSync(path.join(previews, `after-${name}`), encode(preview(image)));
  console.log(`${name}: ${changed} pixels cleaned`);
}
