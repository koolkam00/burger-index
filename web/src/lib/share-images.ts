// Share images (user decision 2026-09-25, stage 4): every restaurant, neighborhood, borough, ranking, style
// and most-recommended page gets its own 1200×630 image, drawn at build time as the Order Board (DESIGN.md
// "Share images") and written by the static export to /og/<page path>.png. Other pages keep the site's
// /og.png. Pure and client-safe: what each card says, and where it lives. lib/share-cards.ts (server-only)
// builds the cards from the dataset; app/og/[...path]/route.tsx draws them.
//
// Numbers and labels only, like the pages (DESIGN.md "No methodology copy"): a card restates its page (the
// H1, the price, the page's own count line), and a list card names burger spots the way its page does.
import { formatPrice, theBurger } from "./format";
import { versus } from "./seo";
import type { Borough } from "./schema";

export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;
/** Where the share images live: /og/restaurants/<id>.png, /og/cheapest-burgers/brooklyn.png, … */
export const SHARE_IMAGE_DIR = "/og";

/** A page's own share image: "/restaurants/x" → "/og/restaurants/x.png". */
export function shareImagePath(pagePath: string): string {
  if (!/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(pagePath)) throw new Error(`no share image for ${pagePath}`);
  return `${SHARE_IMAGE_DIR}${pagePath}.png`;
}

/** The catch-all route's segments for a page's image: "/cheapest-burgers/brooklyn" → ["cheapest-burgers", "brooklyn.png"]. */
export function shareImageSegments(pagePath: string): string[] {
  return shareImagePath(pagePath).slice(SHARE_IMAGE_DIR.length + 1).split("/");
}

/** The page an image's segments belong to, or null: ["restaurants", "x.png"] → "/restaurants/x". */
export function pagePathOfSegments(segments: readonly string[]): string | null {
  if (!segments.length || !segments[segments.length - 1].endsWith(".png")) return null;
  const path = `/${segments.join("/").slice(0, -".png".length)}`;
  return /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(path) ? path : null;
}

// ---- cards -----------------------------------------------------------------------------------------

/** The board: an overline, a name, a sub-line, one price and the small print (restaurants and areas). */
export type BoardCard = {
  kind: "board";
  overline: string;
  title: string;
  sub: string | null;
  price: number | null;
  line: string[];
  alt: string;
};

export type ListCardRow = { rank: number; name: string; detail: string | null; price: number | null };

/** A ranking: an overline, the page's H1 and its first rows, then the page's count line. */
export type ListCard = {
  kind: "list";
  overline: string;
  title: string;
  rows: ListCardRow[];
  line: string | null;
  alt: string;
};

export type ShareCard = BoardCard | ListCard;

/** Rows a list card shows (the page's first ones). */
export const LIST_CARD_ROWS = 3;

const money = (v: number) => formatPrice(v, { cents: "always" });
const NBSP = "\u00a0";
/**
 * The board's overline in capitals, its parts joined by " · ": each "·" stays with the part before it,
 * and the last part (a borough, "New York City") never breaks, so a long neighborhood wraps before it.
 */
function overline(parts: ReadonlyArray<string | null>): string {
  const list = parts.filter((p): p is string => Boolean(p));
  return list
    .map((p, i) => (i === list.length - 1 && i > 0 ? p.replace(/ /g, NBSP) : p))
    .join(`${NBSP}· `)
    .toUpperCase();
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const WATER = "on a yellow order board hanging over the water";

/**
 * A restaurant: its neighborhood and borough over its name, its burger, the price and how it compares with
 * the NYC median ("10% above the $20.00 NYC median", the page's "vs NYC" in words).
 */
export function restaurantCard(r: {
  name: string;
  burger: string;
  price: number;
  neighborhood: string | null;
  borough: Borough;
  cityMedian: number | null;
  updated: string;
}): BoardCard {
  const vs = versus(r.price, r.cityMedian);
  return {
    kind: "board",
    overline: overline([r.neighborhood, r.borough]),
    title: r.name,
    sub: r.burger,
    price: r.price,
    line: [...(vs ? [cap(vs)] : []), `Updated ${r.updated}`],
    alt: `The Burger Index: ${theBurger(r.burger)} at ${r.name}, ${money(r.price)}, ${WATER}`,
  };
}

/** A neighborhood or borough: its median on the board, with its menu count as on the page's board. */
export function areaCard(a: { kind: "neighborhood" | "borough"; name: string; borough: Borough | null; median: number | null; menus: string; updated: string }): BoardCard {
  const where = a.kind === "neighborhood" ? (a.borough ?? "") : "New York City";
  return {
    kind: "board",
    overline: overline([`${a.kind === "neighborhood" ? "Neighborhood" : "Borough"} median`, where]),
    title: a.name,
    sub: null,
    price: a.median,
    line: a.median !== null ? [a.menus, `Updated ${a.updated}`] : ["No prices yet", `Updated ${a.updated}`],
    alt:
      a.median !== null
        ? `The Burger Index: the ${a.name} median burger price, ${money(a.median)}, ${WATER}`
        : `The Burger Index: ${a.name}, no prices yet, ${WATER}`,
  };
}

/** A ranking page (or the most-recommended burgers): its ticket, its H1 and its first rows, then its count line. */
export function listCard(l: { ticket: string; title: string; rows: readonly ListCardRow[]; count: string | null }): ListCard {
  const rows = l.rows.slice(0, LIST_CARD_ROWS);
  const priced = rows.every((r) => r.price !== null);
  return {
    kind: "list",
    overline: l.ticket.toUpperCase(),
    title: l.title.replace(/\.$/, ""),
    rows,
    line: l.count ? l.count.replace(/\.$/, "") : null,
    alt: rows.length
      ? `The Burger Index: ${l.title.replace(/\.$/, "")}, the first ${rows.length === 1 ? "one" : rows.length} ${priced ? "with prices" : "listed"} ${WATER}`
      : `The Burger Index: ${l.title.replace(/\.$/, "")}, ${WATER}`,
  };
}

// ---- fitting text on the board ---------------------------------------------------------------------

/**
 * The largest of `sizes` (descending) at which `text` should wrap into at most `lines` lines of `width`
 * pixels, estimating a character at `em` of the size (a little under the face's real average, so a line
 * rarely runs long; the card still clamps). The last size when none fits.
 */
export function fitFontSize(text: string, opts: { width: number; lines: number; sizes: readonly number[]; em: number }): number {
  for (const size of opts.sizes) if (estimateLines(text, size, opts) <= opts.lines) return size;
  return opts.sizes[opts.sizes.length - 1];
}

/** Lines `text` should take at `size`: words packed greedily into lines `width` wide. */
export function estimateLines(text: string, size: number, opts: { width: number; em: number }): number {
  const perLine = Math.max(1, Math.floor(opts.width / (size * opts.em)));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const len = word.length;
    if (used === 0) used = len;
    else if (used + 1 + len <= perLine) used += 1 + len;
    else {
      lines += 1;
      used = len;
    }
    while (used > perLine) {
      lines += 1;
      used -= perLine;
    }
  }
  return lines;
}
