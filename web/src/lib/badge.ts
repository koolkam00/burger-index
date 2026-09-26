// The restaurant price badge (user decision 2026-09-25, stage 4): a small sign a priced restaurant can put
// on its own site, linked back to its page here. A static SVG per priced restaurant at /badge/<id>.svg
// (app/badge/[file]/route.tsx, drawn at build time with its text as outlines, so it looks the same on any
// site) and the page that explains it, /badge, with copyable snippets. Honest text only: the price of the
// restaurant's burger here, how it compares with the NYC median and the month, never a rating or a word of
// praise. Pure and client-safe.
import { normalize, queryTokens } from "./explorer";
import { formatMonthYear, formatPrice } from "./format";
import type { MenuListData } from "./menu-list";
import type { Borough } from "./schema";
import { versus } from "./seo";

/** The page that explains the badge and hands out the snippets. */
export const BADGE_PAGE_PATH = "/badge";
export const BADGE_PAGE_NAME = "Burger price badge";
/** The badge's size in CSS pixels (its SVG scales cleanly to any size). */
export const BADGE_WIDTH = 300;
export const BADGE_HEIGHT = 84;

/** A priced restaurant's badge image: "/badge/<id>.svg". */
export function badgePath(id: string): string {
  return `${BADGE_PAGE_PATH}/${id}.svg`;
}

/** The badge page opened for one restaurant: "/badge?r=<id>". */
export function badgePageFor(id: string): string {
  return `${BADGE_PAGE_PATH}?r=${encodeURIComponent(id)}`;
}

export type BadgeText = {
  /** "$22 burger", "$15.99 burger" */
  price: string;
  /** "10% above the $20.00 NYC median", "Right at the $20.00 NYC median"; null without a median. */
  compare: string | null;
  /** "THE BURGER INDEX · SEP 2026" */
  brand: string;
  /** The whole badge in one sentence (the SVG's title and the snippet's alt text, after the restaurant's name). */
  label: string;
};

export function badgeText(d: { price: number; cityMedian: number | null; generatedAt: string }): BadgeText {
  const vs = versus(d.price, d.cityMedian);
  const compare = vs ? vs[0].toUpperCase() + vs.slice(1) : null;
  const price = `${formatPrice(d.price)} burger`;
  return {
    price,
    compare,
    brand: `The Burger Index · ${formatMonthYear(d.generatedAt, { short: true })}`.toUpperCase(),
    label: `${price}${vs ? `, ${vs}` : ""} (The Burger Index, ${formatMonthYear(d.generatedAt)})`,
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The badge's alt text on a restaurant's site: "Allswell on The Burger Index: $22 burger, 10% above …". */
export function badgeAlt(name: string, text: BadgeText): string {
  return `${name} on The Burger Index: ${text.label.replace(/ \(The Burger Index, /, " (")}`;
}

/** The HTML a restaurant pastes: the badge image, linked to its page here. */
export function badgeSnippet(d: { site: string; id: string; name: string; text: BadgeText }): string {
  const page = `${d.site}/restaurants/${d.id}`;
  const img = `${d.site}${badgePath(d.id)}`;
  return `<a href="${escapeHtml(page)}"><img src="${escapeHtml(img)}" width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" alt="${escapeHtml(badgeAlt(d.name, d.text))}"></a>`;
}

// ---- the badge page's restaurant finder ---------------------------------------------------------------

/** A priced restaurant the badge page can show: its id, name, neighborhood slug, borough and price. */
export type BadgeSpot = { id: string; name: string; hood: string | null; borough: Borough; price: number };

/**
 * Every priced location from /data/menus.json (lib/menu-list; a menu's price is each of its locations'
 * price), which the badge page fetches when it needs the list, by name.
 */
export function badgeSpots(data: Pick<MenuListData, "menus">): BadgeSpot[] {
  return data.menus
    .flatMap((m) => m.spots.map((s) => ({ id: s.id, name: s.name, hood: s.hood, borough: s.borough, price: m.price })))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

/** The spots whose name holds every word of the query (accents and punctuation folded), names that start with it first. */
export function searchBadgeSpots(spots: readonly BadgeSpot[], query: string): BadgeSpot[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const q = tokens.join(" ");
  const hits = spots.filter((s) => {
    const name = normalize(s.name);
    return tokens.every((t) => name.includes(t));
  });
  const starts = (s: BadgeSpot) => (normalize(s.name).startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b));
}
