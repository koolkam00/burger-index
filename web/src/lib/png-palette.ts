// Palette PNGs for the share images (server-only by use: node:zlib). next/og writes 8-bit RGBA PNGs of
// about 100 KB for a 1200×630 board; the boards are flat fills, one gradient and anti-aliased type, so the
// same picture in 256 colors (median cut, no dithering) looks the same at about a third of the size. With
// a share image for every restaurant, neighborhood, borough and ranking page, that keeps the static export
// (and each deploy) tens of megabytes smaller. Only opaque, 8-bit, non-interlaced RGB or RGBA input is
// converted; anything else comes back untouched. zlib.crc32 needs Node 20.15+ or 22.2+ (package.json engines).
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type RgbImage = { width: number; height: number; /** width × height × 3 bytes, row by row */ rgb: Uint8Array };

function chunks(png: Uint8Array): Array<{ type: string; data: Buffer }> {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  const out: Array<{ type: string; data: Buffer }> = [];
  let at = 8;
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    out.push({ type, data: buf.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

/** The pixels of an opaque 8-bit RGB or RGBA PNG, or null for any other kind (or a pixel that isn't opaque). */
export function decodeOpaquePng(png: Uint8Array): RgbImage | null {
  const list = chunks(png);
  const ihdr = list.find((c) => c.type === "IHDR")?.data;
  if (!ihdr) return null;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const [depth, colorType, , , interlace] = [ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]];
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) return null;
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(list.filter((c) => c.type === "IDAT").map((c) => c.data)));
  if (raw.length < height * (stride + 1)) return null;
  const rgb = new Uint8Array(width * height * 3);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) return null;
      cur[i] = v & 0xff;
    }
    let o = y * width * 3;
    for (let k = 0; k < stride; k += bpp) {
      if (bpp === 4 && cur[k + 3] !== 255) return null;
      rgb[o++] = cur[k];
      rgb[o++] = cur[k + 1];
      rgb[o++] = cur[k + 2];
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, rgb };
}

type Box = { colors: Uint32Array; counts: Uint32Array; population: number; score: number; channel: number };

function makeBox(colors: Uint32Array, counts: Uint32Array): Box {
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  let population = 0;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    const ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    for (let k = 0; k < 3; k++) {
      if (ch[k] < lo[k]) lo[k] = ch[k];
      if (ch[k] > hi[k]) hi[k] = ch[k];
    }
    population += counts[i];
  }
  const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const channel = ranges.indexOf(Math.max(...ranges));
  // Split the widest boxes first, weighted by how many pixels they cover: gradients and big fills get
  // their shades, rare anti-aliasing colors share theirs.
  return { colors, counts, population, channel, score: colors.length > 1 ? ranges[channel] * Math.sqrt(population) : -1 };
}

function splitBox(box: Box): [Box, Box] {
  const shift = 16 - box.channel * 8;
  const order = Array.from(box.colors.keys()).sort((a, b) => ((box.colors[a] >> shift) & 255) - ((box.colors[b] >> shift) & 255));
  const colors = Uint32Array.from(order, (i) => box.colors[i]);
  const counts = Uint32Array.from(order, (i) => box.counts[i]);
  let seen = 0;
  let cut = 1;
  for (let i = 0; i < colors.length - 1; i++) {
    seen += counts[i];
    cut = i + 1;
    if (seen >= box.population / 2) break;
  }
  return [makeBox(colors.subarray(0, cut), counts.subarray(0, cut)), makeBox(colors.subarray(cut), counts.subarray(cut))];
}

/** Up to `max` colors for the image (median cut), and each pixel's index into them. */
export function quantize(img: RgbImage, max = 256): { palette: Uint8Array; indices: Uint8Array } {
  const n = img.width * img.height;
  // Pixels come in runs of one color (fills, the sea's rows), so a run is counted once.
  const histogram = new Map<number, number>();
  let run = -1;
  let runLength = 0;
  for (let p = 0; p <= n; p++) {
    const c = p < n ? (img.rgb[p * 3] << 16) | (img.rgb[p * 3 + 1] << 8) | img.rgb[p * 3 + 2] : -2;
    if (c === run) {
      runLength++;
      continue;
    }
    if (runLength) histogram.set(run, (histogram.get(run) ?? 0) + runLength);
    run = c;
    runLength = 1;
  }
  let boxes = [makeBox(Uint32Array.from(histogram.keys()), Uint32Array.from(histogram.values()))];
  while (boxes.length < max) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].score > 0 && (best < 0 || boxes[i].score > boxes[best].score)) best = i;
    if (best < 0) break;
    boxes = [...boxes.slice(0, best), ...splitBox(boxes[best]), ...boxes.slice(best + 1)];
  }
  const palette = new Uint8Array(boxes.length * 3);
  const indexOf = new Map<number, number>();
  boxes.forEach((box, b) => {
    const sum = [0, 0, 0];
    for (let i = 0; i < box.colors.length; i++) {
      const c = box.colors[i];
      sum[0] += ((c >> 16) & 255) * box.counts[i];
      sum[1] += ((c >> 8) & 255) * box.counts[i];
      sum[2] += (c & 255) * box.counts[i];
      indexOf.set(c, b);
    }
    for (let k = 0; k < 3; k++) palette[b * 3 + k] = Math.round(sum[k] / box.population);
  });
  const indices = new Uint8Array(n);
  let last = -1;
  let lastIndex = 0;
  for (let p = 0; p < n; p++) {
    const c = (img.rgb[p * 3] << 16) | (img.rgb[p * 3 + 1] << 8) | img.rgb[p * 3 + 2];
    if (c !== last) {
      last = c;
      lastIndex = indexOf.get(c) as number;
    }
    indices[p] = lastIndex;
  }
  return { palette, indices };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** An 8-bit indexed PNG (color type 3), each row unfiltered, deflated at the highest level. */
export function encodeIndexedPng(width: number, height: number, palette: Uint8Array, indices: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed color
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("PLTE", palette), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

/** The PNG in at most 256 colors when that makes it smaller; otherwise (or for PNGs it doesn't convert) the PNG as it was. */
export function paletteSmaller(png: Uint8Array): Uint8Array {
  const img = decodeOpaquePng(png);
  if (!img) return png;
  const { palette, indices } = quantize(img);
  const out = encodeIndexedPng(img.width, img.height, palette, indices);
  return out.length < png.length ? out : png;
}
