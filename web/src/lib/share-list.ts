// "Share your top 10" (user decision 2026-09-27; DESIGN.md "The ranker hero", "Share your top 10"): after saving, a
// visitor can share an image of their list, up to their top 10, and a link that asks friends to rank their own. The
// image is drawn in the browser (lib/share-list-image.ts, a canvas) in two sizes, a 1080×1920 story and a 1080×1080
// square, as the site's list card: the Order Board over the water, the ranks with each restaurant over its burger, and
// "Rank yours at <site>". The link is the home ranker's, `https://<site>/?ref=share#rank`: no list, no voter id.
//
// Pure and client-safe: the rows, the words, the file name, the alt text, truncation and the layout's geometry.
import { formatCount } from "./format";
import { RANKER_ANCHOR } from "./site";

export type ShareFormat = "story" | "square";
export const SHARE_FORMATS: readonly ShareFormat[] = ["story", "square"];
export const SHARE_SIZES: Record<ShareFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};
/** "Story · 1080 × 1920": the size picker's labels (pixel sizes, written without a thousands separator). */
export function formatLabel(format: ShareFormat): string {
  const { width, height } = SHARE_SIZES[format];
  return `${format === "story" ? "Story" : "Square"} · ${width} × ${height}`;
}

/** The image shows the list's first 10 (the list is framed as "your top 10", with room for more). */
export const SHARE_TOP = 10;

/** The query parameter the shared link carries, so a visit from it can be told apart (it holds nothing else). */
export const SHARE_REF = "share";

/** The link a shared image goes with: the home ranker, `https://<site>/?ref=share#rank`. Never any list data. */
export function rankerShareUrl(site: string): string {
  return `${site.replace(/\/+$/, "")}/?ref=${SHARE_REF}#${RANKER_ANCHOR}`;
}

/** "nycburgerindex.vercel.app": the site as the image prints it (with its port on a local build). */
export function shareHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  }
}

/** A burger as the image names it (lib/ranker RankerBurger has these). */
export type ShareBurger = { name: string; burger: string; where: string };
/** One row of the image: the rank, the restaurant and "burger · where". */
export type ShareRow = { rank: number; name: string; detail: string };

/** A burger that left the Burger Index keeps its place on the list; its row says so. */
export const SHARE_GONE = "No longer on the Burger Index";

/** The image's rows: the list's first 10, best first, numbered from 1. */
export function shareRows(list: readonly string[], burgerOf: (key: string) => ShareBurger | undefined): ShareRow[] {
  return list.slice(0, SHARE_TOP).map((key, i) => {
    const b = burgerOf(key);
    return b ? { rank: i + 1, name: b.name, detail: `${b.burger} · ${b.where}` } : { rank: i + 1, name: SHARE_GONE, detail: "" };
  });
}

/** The overline painted on the sign: the ranker's own kicker. */
export const SHARE_OVERLINE = "RANK YOUR BURGERS";

/** "My top 10 burgers" (a list of 4: "My top 4 burgers"). */
export function shareTitle(length: number): string {
  const n = Math.min(length, SHARE_TOP);
  return n === 1 ? "My top burger" : `My top ${formatCount(n)} burgers`;
}

/** The image's call to action: "Rank yours at nycburgerindex.vercel.app". */
export function shareCta(url: string): { lead: string; host: string } {
  return { lead: "Rank yours at", host: shareHost(url) };
}

/** What goes with the image in the share sheet: "My top 10 burgers on The Burger Index. Rank yours: <link>" */
export function shareText(length: number, url: string): string {
  return `${shareTitle(length)} on The Burger Index. Rank yours: ${url}`;
}

/** "my-top-10-burgers-story.png" */
export function shareFileName(length: number, format: ShareFormat): string {
  return `my-top-${Math.min(length, SHARE_TOP)}-burgers-${format}.png`;
}

/**
 * The preview's alt text, what is drawn: "The Burger Index: “My top 4 burgers” on a yellow order board hanging over the
 * water: 1. Emily, Emily Burger · Clinton Hill, Brooklyn; 2. …; then “Rank yours at nycburgerindex.vercel.app”."
 */
export function shareAlt(rows: readonly ShareRow[], url: string): string {
  const list = rows.map((r) => `${r.rank}. ${r.name}${r.detail ? `, ${r.detail}` : ""}`).join("; ");
  const cta = shareCta(url);
  return `The Burger Index: “${shareTitle(rows.length)}” on a yellow order board hanging over the water: ${list}; then “${cta.lead} ${cta.host}”.`;
}

/** What the share status line says after each way of sharing. */
export function sharedText(method: "share" | "download" | "copy_link", fileName = ""): string {
  if (method === "share") return "Shared.";
  if (method === "download") return `Downloading ${fileName}.`;
  return "Link copied.";
}

/**
 * `text` cut to fit `max` (in the units `measure` returns: canvas pixels when drawing), ending in "…". Cuts between
 * characters (never inside a surrogate pair) and drops the spaces and separators left before the ellipsis
 * ("Emily Burger ·…" → "Emily Burger…"). Text that fits comes back as it is (trimmed).
 */
export function fitText(text: string, max: number, measure: (s: string) => number, ellipsis = "…"): string {
  const t = text.trim();
  if (measure(t) <= max) return t;
  const chars = [...t];
  const cut = (n: number) => chars.slice(0, n).join("").replace(/[\s·,;:/&+–—-]+$/u, "") + ellipsis;
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(cut(mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? cut(lo) : ellipsis;
}

// ---- the layout ----------------------------------------------------------------------------------------

/** Font sizes and spacing per size (px on the 1080-wide canvas). */
type Spec = {
  stripe: number;
  gapTop: number;
  boardWidth: number;
  beam: number;
  minHang: number;
  maxExtraHang: number;
  frame: number;
  padX: number;
  padTop: number;
  padBottom: number;
  overline: number;
  titleGap: number;
  title: number;
  rulesGap: number;
  row: number;
  rank: number;
  name: number;
  detail: number;
  rankWidth: number;
  rankGap: number;
  /**
   * A list shorter than 10 gets bigger rows, up to this many times the 10-row size (never taller than 10 rows): the rank
   * and the restaurant grow, the "burger · where" line keeps its 10-row size. At most 1.25, so "No longer on the Burger
   * Index" still fits on the restaurant's line (at 1.4 the story cut it to "No longer on the Burger I…").
   */
  maxRowScale: number;
  plaque: { w: number; h: number; font: number };
  ring: number;
  /** The call to action on the water above the strip (story), or on the strip beside the wordmark (square). */
  ctaOnStrip: boolean;
  ctaGap: number;
  ctaLead: number;
  ctaHost: number;
  strip: number;
  wordmark: number;
  stripRing: number;
};

const SPECS: Record<ShareFormat, Spec> = {
  story: {
    stripe: 45,
    gapTop: 64,
    boardWidth: 944,
    beam: 24,
    minHang: 52,
    maxExtraHang: 220,
    frame: 20,
    padX: 44,
    padTop: 52,
    padBottom: 36,
    overline: 30,
    titleGap: 10,
    title: 80,
    rulesGap: 22,
    row: 104,
    rank: 46,
    name: 42,
    detail: 30,
    rankWidth: 62,
    rankGap: 24,
    maxRowScale: 1.25,
    plaque: { w: 280, h: 60, font: 38 },
    ring: 124,
    ctaOnStrip: false,
    ctaGap: 70,
    ctaLead: 40,
    ctaHost: 50,
    strip: 120,
    wordmark: 54,
    stripRing: 60,
  },
  square: {
    stripe: 36,
    gapTop: 40,
    boardWidth: 920,
    beam: 18,
    minHang: 22,
    maxExtraHang: 140,
    frame: 14,
    padX: 34,
    padTop: 36,
    padBottom: 20,
    overline: 22,
    titleGap: 6,
    title: 54,
    rulesGap: 12,
    row: 62,
    rank: 30,
    name: 28,
    detail: 19,
    rankWidth: 40,
    rankGap: 18,
    maxRowScale: 1.25,
    plaque: { w: 210, h: 44, font: 28 },
    ring: 88,
    ctaOnStrip: true,
    ctaGap: 0,
    ctaLead: 24,
    ctaHost: 24,
    strip: 84,
    wordmark: 34,
    stripRing: 42,
  },
};

/** Where everything goes on the canvas (px; text positions are the text's vertical middle unless named otherwise). */
export type ShareLayout = {
  format: ShareFormat;
  width: number;
  height: number;
  awning: { stripe: number; height: number };
  beam: { x: number; y: number; width: number; height: number };
  ropes: { x: number[]; top: number; bottom: number; width: number };
  frame: { x: number; y: number; width: number; height: number; pad: number };
  face: { x: number; y: number; width: number; height: number };
  plaque: { cx: number; cy: number; w: number; h: number; font: number };
  ring: { cx: number; cy: number; size: number };
  overline: { y: number; size: number };
  title: { y: number; size: number };
  /**
   * The rows: the first row's top, each row's height, the font sizes, where the restaurant and "burger · where" sit in a
   * row (their middles, from the row's top: the two lines as one block, centered), the rank's right edge and the text's
   * left and right edges.
   */
  rows: {
    top: number;
    height: number;
    count: number;
    rank: number;
    name: number;
    detail: number;
    nameY: number;
    detailY: number;
    rankRight: number;
    textX: number;
    textRight: number;
  };
  cta: { onStrip: boolean; y: number; lead: number; host: number; hostY: number };
  strip: { y: number; height: number; wordmark: number; ring: number };
};

/** Line height of the display face (Lilita One) and the UI face (Barlow) as the image sets them. */
const TITLE_LH = 1.04;
const UI_LH = 1.2;
/** The restaurant's line in a row (Barlow 600, set tight over the burger). */
const NAME_LH = 1.1;

/**
 * The geometry of the image for `rows` rows (1 to 10): a shorter list gets bigger rows (up to `maxRowScale`, never more
 * room than 10 rows take; the rank and the restaurant grow, the burger's line stays at its 10-row size, so fewer are
 * cut), and a shorter board hangs lower on longer ropes.
 */
export function shareLayout(format: ShareFormat, rows: number): ShareLayout {
  const base = SPECS[format];
  const n = Math.max(1, Math.min(SHARE_TOP, Math.trunc(rows)));
  const k = Math.min(base.maxRowScale, SHARE_TOP / n);
  const s: Spec = {
    ...base,
    row: base.row * k,
    rank: base.rank * k,
    name: base.name * k,
    rankWidth: base.rankWidth * k,
    rankGap: base.rankGap * k,
  };
  const { width, height } = SHARE_SIZES[format];
  const awningH = s.stripe / 3 + s.stripe / 2;
  const header = s.overline * UI_LH + s.titleGap + s.title * TITLE_LH + s.rulesGap;
  const faceH = s.padTop + header + n * s.row + s.padBottom;
  const frameH = faceH + 2 * s.frame;
  // Below the frame: the life ring hangs past its lower-left corner (clear of the rows).
  const ringBelow = s.ring * 0.45;
  const ctaBlock = s.ctaOnStrip ? 0 : s.ctaLead * UI_LH + 8 + s.ctaHost * UI_LH;
  const stripY = height - s.strip;
  const used = awningH + s.gapTop + s.beam + s.minHang + frameH + ringBelow + (s.ctaOnStrip ? 24 : s.ctaGap + ctaBlock + 48);
  const spare = Math.max(0, stripY - used);
  // Half the room lengthens the ropes (up to a limit); the rest is shared above the beam and below the board.
  const extraHang = Math.min(spare / 2, s.maxExtraHang);
  const rest = spare - extraHang;
  const beamY = awningH + s.gapTop + rest / 2;
  const hang = s.minHang + extraHang;
  const x = (width - s.boardWidth) / 2;
  const frameY = beamY + s.beam + hang;
  const face = { x: x + s.frame, y: frameY + s.frame, width: s.boardWidth - 2 * s.frame, height: faceH };
  const overlineY = face.y + s.padTop + (s.overline * UI_LH) / 2;
  const titleY = face.y + s.padTop + s.overline * UI_LH + s.titleGap + (s.title * TITLE_LH) / 2;
  const rowsTop = face.y + s.padTop + header;
  const textX = face.x + s.padX + s.rankWidth + s.rankGap;
  // The restaurant over its burger, one block centered in the row (as the share images' list card sets them).
  const lineTop = (s.row - (s.name * NAME_LH + s.detail * UI_LH)) / 2;
  const ctaY = frameY + frameH + ringBelow + rest / 2 + s.ctaGap + (s.ctaLead * UI_LH) / 2;
  return {
    format,
    width,
    height,
    awning: { stripe: s.stripe, height: awningH },
    beam: { x, y: beamY, width: s.boardWidth, height: s.beam },
    ropes: { x: [x + s.boardWidth * 0.15, x + s.boardWidth * 0.85], top: beamY + s.beam / 2, bottom: frameY + s.frame, width: s.beam / 2.4 },
    frame: { x, y: frameY, width: s.boardWidth, height: frameH, pad: s.frame },
    face,
    plaque: { cx: width / 2, cy: frameY, ...s.plaque },
    ring: { cx: x + s.ring * 0.12, cy: frameY + frameH - s.ring * 0.05, size: s.ring },
    overline: { y: overlineY, size: s.overline },
    title: { y: titleY, size: s.title },
    rows: {
      top: rowsTop,
      height: s.row,
      count: n,
      rank: s.rank,
      name: s.name,
      detail: s.detail,
      nameY: lineTop + (s.name * NAME_LH) / 2,
      detailY: lineTop + s.name * NAME_LH + (s.detail * UI_LH) / 2,
      rankRight: face.x + s.padX + s.rankWidth,
      textX,
      textRight: face.x + face.width - s.padX,
    },
    cta: s.ctaOnStrip
      ? { onStrip: true, y: stripY + s.strip / 2, lead: s.ctaLead, host: s.ctaHost, hostY: stripY + s.strip / 2 }
      : { onStrip: false, y: ctaY, lead: s.ctaLead, host: s.ctaHost, hostY: ctaY + (s.ctaLead * UI_LH) / 2 + 8 + (s.ctaHost * UI_LH) / 2 },
    strip: { y: stripY, height: s.strip, wordmark: s.wordmark, ring: s.stripRing },
  };
}
