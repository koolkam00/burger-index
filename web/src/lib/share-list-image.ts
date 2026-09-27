// "Share your top 10": the image, drawn in the browser on a canvas (DESIGN.md "Share your top 10"). The site's list
// card (the share images' Order Board, components/og/) at 1080×1920 or 1080×1080: the sea, the awning across the top,
// the beam, the ropes and the framed yellow sign with its "ORDER UP!" plaque and life ring; on the sign the ranker's
// kicker, "My top 10 burgers" and the rows (the rank, the restaurant over "burger · where", each cut with an ellipsis
// to fit); "Rank yours at <site>"; the wordmark on a wood strip along the bottom. Day-shift colors in both themes, like
// the board and every share image. The fonts are the page's own (next/font's Lilita One and Barlow, read from the
// --font-display and --font-ui tokens and loaded before drawing). Browser only; the geometry and the words are pure
// (lib/share-list.ts).
import { fitText, SHARE_OVERLINE, SHARE_SIZES, shareCta, shareLayout, shareTitle, type ShareFormat, type ShareLayout, type ShareRow } from "./share-list";

/** Day-shift token values (DESIGN.md "Color"), as components/og/board.tsx draws them. */
const C = {
  seaTop: "#A7E3DC",
  seaBot: "#62C3C3",
  awningA: "#C4221B",
  awningB: "#FFF4DE",
  sign: "#FFCD3C",
  signInk: "#3A1F0C",
  plaque: "#B0170F",
  plaqueInk: "#FFE08A",
  frame1: "#C68842",
  frame2: "#9A6128",
  nail: "#5A3410",
  rope1: "#E2C089",
  rope2: "#A77C45",
  wood: "#DDA764",
  woodInk: "#2B1B10",
  ink: "#2B1B10",
  ringA: "#C4221B",
  ringB: "#FFF4DE",
  ringLine: "#2B1B10",
  rule: "rgba(58,31,12,0.22)",
};

type Fonts = { display: string; ui: string };
type Ctx = CanvasRenderingContext2D;

/** The page's font stacks (the design tokens), with the tokens' own fallbacks if they can't be read. */
function pageFonts(): Fonts {
  const cs = getComputedStyle(document.documentElement);
  return {
    display: cs.getPropertyValue("--font-display").trim() || '"Arial Rounded MT Bold", "Arial Black", sans-serif',
    ui: cs.getPropertyValue("--font-ui").trim() || '"Helvetica Neue", Arial, sans-serif',
  };
}

/** Make sure the faces the image uses are loaded (the page loads them on demand; a canvas won't wait for them). */
async function loadFonts(f: Fonts): Promise<void> {
  if (!document.fonts?.load) return;
  const specs = [`400 60px ${f.display}`, `500 30px ${f.ui}`, `600 30px ${f.ui}`, `700 30px ${f.ui}`];
  await Promise.all(specs.map((s) => document.fonts.load(s, "My top 10 burgers").catch(() => [])));
}

/** Tracking, where the browser's canvas supports it (else the text is drawn untracked). */
function track(ctx: Ctx, px: number) {
  const c = ctx as Ctx & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawAwning(ctx: Ctx, L: ShareLayout) {
  const s = L.awning.stripe;
  const band = s / 3;
  const n = Math.ceil(L.width / s);
  // The drop shade under the scallops, then the stripes.
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(i * s + s / 2, band + 3, s / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? C.awningB : C.awningA;
    ctx.fillRect(i * s, 0, s, band);
    ctx.beginPath();
    ctx.arc(i * s + s / 2, band, s / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRig(ctx: Ctx, L: ShareLayout) {
  const { beam, ropes, frame } = L;
  // The ropes first (the beam and the frame cover their ends).
  for (const x of ropes.x) {
    ctx.save();
    roundRect(ctx, x - ropes.width / 2, ropes.top, ropes.width, ropes.bottom - ropes.top, ropes.width / 2);
    ctx.clip();
    const band = ropes.width * 0.6;
    for (let y = ropes.top, i = 0; y < ropes.bottom; y += band, i++) {
      ctx.fillStyle = i % 2 ? C.rope2 : C.rope1;
      ctx.fillRect(x - ropes.width / 2, y, ropes.width, band);
    }
    ctx.restore();
  }
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(ctx, beam.x, beam.y + 3, beam.width, beam.height, 4);
  ctx.fill();
  ctx.fillStyle = C.frame2;
  roundRect(ctx, beam.x, beam.y, beam.width, beam.height, 4);
  ctx.fill();
  // The frame, with the sign's soft hanging shadow (DESIGN.md --shadow-sign).
  ctx.save();
  ctx.shadowColor = "rgba(43,27,16,0.55)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = C.frame1;
  roundRect(ctx, frame.x + 16, frame.y + 16, frame.width - 32, frame.height - 32, 22);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = C.frame1;
  roundRect(ctx, frame.x, frame.y, frame.width, frame.height, 22);
  ctx.fill();
  // Four nail heads in the frame's corners.
  ctx.fillStyle = C.nail;
  const inset = frame.pad / 2;
  for (const [nx, ny] of [
    [frame.x + inset + 4, frame.y + inset + 4],
    [frame.x + frame.width - inset - 4, frame.y + inset + 4],
    [frame.x + inset + 4, frame.y + frame.height - inset - 4],
    [frame.x + frame.width - inset - 4, frame.y + frame.height - inset - 4],
  ]) {
    ctx.beginPath();
    ctx.arc(nx, ny, Math.max(3, frame.pad / 5), 0, Math.PI * 2);
    ctx.fill();
  }
  // The sign face: flat --sign with its sheen.
  const f = L.face;
  ctx.fillStyle = C.sign;
  roundRect(ctx, f.x, f.y, f.width, f.height, 12);
  ctx.fill();
  const sheen = ctx.createLinearGradient(f.x, f.y, f.x + f.width * 0.45, f.y + f.height * 0.6);
  sheen.addColorStop(0, "rgba(255,255,255,0.35)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  roundRect(ctx, f.x, f.y, f.width, f.height, 12);
  ctx.fill();
}

function drawPlaque(ctx: Ctx, L: ShareLayout, fonts: Fonts) {
  const p = L.plaque;
  ctx.save();
  ctx.translate(p.cx, p.cy);
  ctx.rotate((-2 * Math.PI) / 180);
  ctx.fillStyle = C.plaque;
  roundRect(ctx, -p.w / 2, -p.h / 2, p.w, p.h, 8);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.nail;
  ctx.stroke();
  ctx.fillStyle = C.plaqueInk;
  ctx.font = `400 ${p.font}px ${fonts.display}`;
  track(ctx, p.font * 0.04);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ORDER UP!", 0, 2);
  ctx.restore();
}

/** The life ring (the nautical set's, on its 24px grid), `size` px across, turned `deg`. */
function drawRing(ctx: Ctx, cx: number, cy: number, size: number, deg: number) {
  const k = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.scale(k, k);
  const r = 7.75;
  ctx.lineWidth = 5.5;
  ctx.strokeStyle = C.ringB;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  const seg = (2 * Math.PI * r) / 8;
  ctx.save();
  ctx.rotate((-112.5 * Math.PI) / 180);
  ctx.setLineDash([seg, seg]);
  ctx.strokeStyle = C.ringA;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = C.ringLine;
  ctx.lineCap = "round";
  for (const rr of [10.5, 5]) {
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const a of [45, 135, 225, 315]) {
    const t = ((a - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(4.4 * Math.cos(t), 4.4 * Math.sin(t));
    ctx.lineTo(11.1 * Math.cos(t), 11.1 * Math.sin(t));
    ctx.stroke();
  }
  ctx.restore();
}

function drawSign(ctx: Ctx, L: ShareLayout, rows: readonly ShareRow[], length: number, fonts: Fonts) {
  const f = L.face;
  const R = L.rows;
  const cx = f.x + f.width / 2;
  // The face's side padding: the rows' text ends that far from its right edge.
  const pad = f.x + f.width - R.textRight;
  const left = f.x + pad;
  const right = R.textRight;
  ctx.fillStyle = C.signInk;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${L.overline.size}px ${fonts.ui}`;
  track(ctx, L.overline.size * 0.1);
  ctx.fillText(SHARE_OVERLINE, cx, L.overline.y);
  ctx.font = `400 ${L.title.size}px ${fonts.display}`;
  track(ctx, L.title.size * 0.005);
  ctx.fillText(fitText(shareTitle(length), right - left, (s) => ctx.measureText(s).width), cx, L.title.y);
  track(ctx, 0);

  ctx.fillStyle = C.rule;
  ctx.fillRect(left, R.top - 1, right - left, 2);
  rows.slice(0, R.count).forEach((row, i) => {
    const top = R.top + i * R.height;
    const mid = top + R.height / 2;
    ctx.fillStyle = C.rule;
    ctx.fillRect(left, top + R.height - 1, right - left, 2);
    ctx.fillStyle = C.signInk;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.font = `700 ${R.rank}px ${fonts.ui}`;
    ctx.fillText(String(row.rank), R.rankRight, mid);
    ctx.textAlign = "left";
    const width = right - R.textX;
    ctx.font = `600 ${R.name}px ${fonts.ui}`;
    ctx.fillText(fitText(row.name, width, (s) => ctx.measureText(s).width), R.textX, row.detail ? top + R.nameY : mid);
    if (row.detail) {
      ctx.font = `500 ${R.detail}px ${fonts.ui}`;
      ctx.fillText(fitText(row.detail, width, (s) => ctx.measureText(s).width), R.textX, top + R.detailY);
    }
  });
}

/** The wordmark ("THE" small and raised, then "BURGER INDEX"), left edge at `x`, centered on `y`; returns its width. */
function wordmark(ctx: Ctx, x: number, y: number, size: number, fonts: Fonts, draw: boolean): number {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const base = y + size * 0.36;
  ctx.font = `400 ${size * 0.6}px ${fonts.display}`;
  track(ctx, size * 0.6 * 0.02);
  const the = ctx.measureText("THE").width;
  if (draw) ctx.fillText("THE", x, base - size * 0.2);
  ctx.font = `400 ${size}px ${fonts.display}`;
  track(ctx, size * 0.02);
  const rest = ctx.measureText("BURGER INDEX").width;
  if (draw) ctx.fillText("BURGER INDEX", x + the + size * 0.24, base);
  track(ctx, 0);
  return the + size * 0.24 + rest;
}

function drawStrip(ctx: Ctx, L: ShareLayout, url: string, fonts: Fonts) {
  const S = L.strip;
  ctx.fillStyle = C.wood;
  ctx.fillRect(0, S.y, L.width, S.height);
  ctx.fillStyle = C.rope2;
  ctx.fillRect(0, S.y, L.width, Math.round(S.height / 14));
  const cy = S.y + S.height / 2 + S.height / 28;
  const gap = S.ring * 0.3;
  const mark = wordmark(ctx, 0, cy, S.wordmark, fonts, false);
  const cta = shareCta(url);
  let ctaText = "";
  let ctaWidth = 0;
  const sep = L.cta.onStrip ? S.wordmark * 0.9 : 0;
  if (L.cta.onStrip) {
    ctx.font = `600 ${L.cta.lead}px ${fonts.ui}`;
    const room = L.width - 64 - (S.ring + gap + mark + sep);
    ctaText = fitText(`${cta.lead} ${cta.host}`, room, (s) => ctx.measureText(s).width);
    ctaWidth = ctx.measureText(ctaText).width;
  }
  const total = S.ring + gap + mark + (L.cta.onStrip ? sep + ctaWidth : 0);
  let x = (L.width - total) / 2;
  drawRing(ctx, x + S.ring / 2, cy, S.ring, 0);
  x += S.ring + gap;
  ctx.fillStyle = C.woodInk;
  wordmark(ctx, x, cy, S.wordmark, fonts, true);
  x += mark;
  if (L.cta.onStrip) {
    ctx.fillStyle = C.woodInk;
    ctx.beginPath();
    ctx.arc(x + sep / 2, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 ${L.cta.lead}px ${fonts.ui}`;
    ctx.textBaseline = "middle";
    ctx.fillText(ctaText, x + sep, cy);
  }
}

function drawCta(ctx: Ctx, L: ShareLayout, url: string, fonts: Fonts) {
  if (L.cta.onStrip) return;
  const cta = shareCta(url);
  const room = L.width - 120;
  ctx.fillStyle = C.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${L.cta.lead}px ${fonts.ui}`;
  ctx.fillText(cta.lead, L.width / 2, L.cta.y);
  ctx.font = `700 ${L.cta.host}px ${fonts.ui}`;
  ctx.fillText(fitText(cta.host, room, (s) => ctx.measureText(s).width), L.width / 2, L.cta.hostY);
}

/** Draws the image for `rows` (a list of `length` burgers; the rows are its first 10) and returns it as a PNG. */
export async function renderShareImage({ format, rows, length, url }: { format: ShareFormat; rows: readonly ShareRow[]; length: number; url: string }): Promise<Blob> {
  const fonts = pageFonts();
  await loadFonts(fonts);
  const { width, height } = SHARE_SIZES[format];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  const L = shareLayout(format, rows.length);
  const sea = ctx.createLinearGradient(0, 0, 0, height);
  sea.addColorStop(0, C.seaTop);
  sea.addColorStop(1, C.seaBot);
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, width, height);
  drawAwning(ctx, L);
  drawRig(ctx, L);
  drawSign(ctx, L, rows, length, fonts);
  drawPlaque(ctx, L, fonts);
  drawRing(ctx, L.ring.cx, L.ring.cy, L.ring.size, -14);
  drawCta(ctx, L, url, fonts);
  drawStrip(ctx, L, url, fonts);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("the image could not be encoded"))), "image/png"));
}
