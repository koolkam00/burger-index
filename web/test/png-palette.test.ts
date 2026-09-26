// Palette PNGs for the share images (lib/png-palette.ts): decode every PNG row filter, quantize, re-encode.
import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { decodeOpaquePng, encodeIndexedPng, paletteSmaller, quantize } from "../src/lib/png-palette";

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** A truecolor PNG (RGB or RGBA) whose rows use filters 0-4 in turn, as encoders mix them. */
function truecolorPng(width: number, height: number, pixel: (x: number, y: number) => number[], alpha: boolean): Buffer {
  const bpp = alpha ? 4 : 3;
  const stride = width * bpp;
  const rows: Buffer[] = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) cur.set(pixel(x, y).slice(0, bpp), x * bpp);
    const filter = y % 5;
    const out = Buffer.alloc(stride + 1);
    out[0] = filter;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][filter];
      out[i + 1] = (cur[i] - pred) & 0xff;
    }
    rows.push(out);
    prev = cur;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

/** An indexed PNG's pixels, read back independently of the module. */
function readIndexed(png: Buffer): { width: number; height: number; colorType: number; palette: Uint8Array; rgb: number[][] } {
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Buffer = Buffer.alloc(0);
  const idat: Buffer[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + len);
    assert.equal(png.readUInt32BE(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len)) >>> 0, `${type} CRC`);
    if (type === "IHDR") [width, height, colorType] = [data.readUInt32BE(0), data.readUInt32BE(4), data[9]];
    if (type === "PLTE") palette = data;
    if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgb: number[][] = [];
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width + 1)], 0, "rows unfiltered");
    for (let x = 0; x < width; x++) {
      const i = raw[y * (width + 1) + 1 + x];
      rgb.push([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]]);
    }
  }
  return { width, height, colorType, palette, rgb };
}

const gradient = (x: number, y: number) => [(x * 7) % 256, (y * 11) % 256, (x + y) % 256, 255];

test("decodeOpaquePng: every row filter, RGB and RGBA", () => {
  for (const alpha of [false, true]) {
    const png = truecolorPng(23, 17, gradient, alpha);
    const img = decodeOpaquePng(png);
    assert.ok(img);
    assert.equal(img.width, 23);
    assert.equal(img.height, 17);
    for (let y = 0; y < 17; y++) for (let x = 0; x < 23; x++) assert.deepEqual([...img.rgb.subarray((y * 23 + x) * 3, (y * 23 + x) * 3 + 3)], gradient(x, y).slice(0, 3));
  }
  // A pixel that isn't opaque, or anything that isn't a PNG: not converted.
  assert.equal(decodeOpaquePng(truecolorPng(4, 4, (x, y) => [1, 2, 3, x === 1 && y === 2 ? 128 : 255], true)), null);
  assert.throws(() => decodeOpaquePng(new Uint8Array([1, 2, 3])), /not a PNG/);
});

test("quantize + encodeIndexedPng: lossless up to 256 colors, 256 at most beyond, a valid indexed PNG", () => {
  // 6 colors: exact.
  const few = decodeOpaquePng(truecolorPng(30, 10, (x) => [x % 6 * 40, 10, 200, 255], true));
  assert.ok(few);
  const q = quantize(few);
  assert.equal(q.palette.length / 3, 6);
  const back = readIndexed(encodeIndexedPng(few.width, few.height, q.palette, q.indices));
  assert.equal(back.colorType, 3);
  back.rgb.forEach((c, p) => assert.deepEqual(c, [...few.rgb.subarray(p * 3, p * 3 + 3)]));
  // Thousands of colors: 256 at most, each pixel close to its own.
  const many = decodeOpaquePng(truecolorPng(120, 90, gradient, false));
  assert.ok(many);
  const qm = quantize(many);
  assert.ok(qm.palette.length / 3 <= 256);
  const backMany = readIndexed(encodeIndexedPng(many.width, many.height, qm.palette, qm.indices));
  let worst = 0;
  backMany.rgb.forEach((c, p) => c.forEach((v, k) => (worst = Math.max(worst, Math.abs(v - many.rgb[p * 3 + k])))));
  assert.ok(worst <= 48, `worst channel error ${worst}`);
});

test("paletteSmaller: smaller when it can be, the input otherwise", () => {
  const flat = truecolorPng(200, 100, (x, y) => (y < 50 ? [255, 205, 60, 255] : [176, 23, 15, 255]), true);
  const out = paletteSmaller(flat);
  assert.ok(out.length < flat.length);
  assert.equal(readIndexed(Buffer.from(out)).colorType, 3);
  const translucent = truecolorPng(8, 8, () => [0, 0, 0, 10], true);
  assert.equal(paletteSmaller(translucent), translucent);
});
