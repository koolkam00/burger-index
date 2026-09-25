// The ranking pages (user decision 2026-09-25): a small, fixed set of static lists, each an H1 in plain
// words, a one-line answer and a ranked table. Cheapest and most expensive in NYC and in each borough
// (the top RANKING_LIMIT), and every burger under $15 and under $20 in NYC.
//
// Rows are distinct menus (menus.ts): an independent restaurant once, a chain once per list, with how
// many of its locations the list covers. The order is menusByIndexPrice / menusByIndexPriceDesc, the
// same as every cheapest and priciest list on the site. Pure and client-safe.
import { BOROUGH_META, boroughInProse, type BoroughMeta } from "./boroughs";
import { formatPrice } from "./format";
import { menusByIndexPrice, menusByIndexPriceDesc, type Menu } from "./menus";
import type { PricedRestaurant } from "./schema";

export type RankingKind = "cheapest" | "priciest" | "under";

export type RankingSpec = {
  kind: RankingKind;
  /** The borough the list covers, or null for all of NYC. */
  borough: BoroughMeta | null;
  /** "under" only: burgers priced below this many whole dollars. */
  under: number | null;
};

/** The cheapest and most expensive lists show this many rows; the under-$N lists show every row. */
export const RANKING_LIMIT = 25;
/** The under-$N lists (NYC only). */
export const UNDER_PRICES = [15, 20] as const;

const BASE = { cheapest: "/cheapest-burgers", priciest: "/most-expensive-burgers" } as const;

export function rankingPath(spec: RankingSpec): string {
  if (spec.kind === "under") return `/burgers-under-${spec.under}`;
  return spec.borough ? `${BASE[spec.kind]}/${spec.borough.slug}` : BASE[spec.kind];
}

export const cheapestSpec = (borough: BoroughMeta | null = null): RankingSpec => ({ kind: "cheapest", borough, under: null });
export const priciestSpec = (borough: BoroughMeta | null = null): RankingSpec => ({ kind: "priciest", borough, under: null });
export const underSpec = (under: number): RankingSpec => ({ kind: "under", borough: null, under });

/** The NYC lists, in link order: cheapest, most expensive, under $15, under $20. */
export const CITY_RANKINGS: readonly RankingSpec[] = [cheapestSpec(), priciestSpec(), ...UNDER_PRICES.map(underSpec)];

/** A borough's two lists. */
export function boroughRankings(borough: BoroughMeta): RankingSpec[] {
  return [cheapestSpec(borough), priciestSpec(borough)];
}

/**
 * Every ranking page, NYC first, then the boroughs in the fixed order. A borough with nothing priced
 * has no lists (they would be empty), like a neighborhood with nothing priced has no page.
 */
export function rankingSpecs(restaurants: readonly PricedRestaurant[]): RankingSpec[] {
  const priced = new Set(restaurants.map((r) => r.borough));
  return [...CITY_RANKINGS, ...BOROUGH_META.filter((b) => priced.has(b.name)).flatMap(boroughRankings)];
}

/** "NYC", "Brooklyn", "the Bronx". */
export function rankingPlace(spec: RankingSpec): string {
  return spec.borough ? boroughInProse(spec.borough.name) : "NYC";
}

/** Without the place: "Cheapest burgers", "Most expensive burgers", "Burgers under $15" (breadcrumbs). */
export function rankingShortName(spec: RankingSpec): string {
  if (spec.kind === "under") return `Burgers under ${formatPrice(spec.under)}`;
  return spec.kind === "cheapest" ? "Cheapest burgers" : "Most expensive burgers";
}

/** The page's name in plain words: "Cheapest burgers in NYC", "Burgers under $15 in NYC" (the H1, without its period). */
export function rankingName(spec: RankingSpec): string {
  return `${rankingShortName(spec)} in ${rankingPlace(spec)}`;
}

/** The name inside a sentence: "cheapest burgers in NYC" ("See the …", "See all …"). */
export function rankingNameInSentence(spec: RankingSpec): string {
  const name = rankingName(spec);
  return `${name[0].toLowerCase()}${name.slice(1)}`;
}

export type RankedMenu = Menu & {
  /** 1-based; menus on the same price (to the cent) share a rank (1, 2, 2, 4). */
  rank: number;
};

export type Ranking = {
  /** The rows the page shows: at most RANKING_LIMIT for cheapest and priciest, every row under $N. */
  rows: RankedMenu[];
  /** Distinct menus the list covers before the cap (every priced menu in the place, or every one under $N). */
  total: number;
};

const cents = (v: number) => Math.round(v * 100);

/** Competition ranks over a list already in price order: equal prices share the first one's rank. */
export function withRanks(menus: readonly Menu[]): RankedMenu[] {
  let rank = 0;
  return menus.map((m, i) => {
    if (i === 0 || cents(m.indexPrice) !== cents(menus[i - 1].indexPrice)) rank = i + 1;
    return { ...m, rank };
  });
}

/** One ranking page's rows, from every priced restaurant. */
export function rankMenus(restaurants: readonly PricedRestaurant[], spec: RankingSpec): Ranking {
  const scope = spec.borough ? restaurants.filter((r) => r.borough === spec.borough!.name) : restaurants;
  const ordered = spec.kind === "priciest" ? menusByIndexPriceDesc(scope) : menusByIndexPrice(scope);
  const matching = spec.kind === "under" ? ordered.filter((m) => cents(m.indexPrice) < (spec.under as number) * 100) : ordered;
  const ranked = withRanks(matching);
  return { rows: spec.kind === "under" ? ranked : ranked.slice(0, RANKING_LIMIT), total: matching.length };
}

/** The rows that share first place (the cheapest or the most expensive, to the cent). */
export function topTied(rows: readonly RankedMenu[]): RankedMenu[] {
  return rows.filter((r) => r.rank === 1);
}

/**
 * Where /burgers shows the same list, one location per row: the borough filter, most expensive first
 * for that list, and the price cap for an under-$N list (the explorer's max is inclusive).
 */
export function explorerHref(spec: RankingSpec): string {
  const p = new URLSearchParams();
  if (spec.borough) p.set("borough", spec.borough.slug);
  if (spec.kind === "under") p.set("max", ((spec.under as number) - 0.01).toFixed(2));
  if (spec.kind === "priciest") p.set("sort", "-price");
  const q = p.toString();
  return q ? `/burgers?${q}` : "/burgers";
}

/** /burgers searched for a chain's name (and its borough on a borough list): every location of that menu. */
export function chainExplorerHref(menu: Menu, spec: RankingSpec): string {
  const p = new URLSearchParams({ q: menu.restaurant.name });
  if (spec.borough) p.set("borough", spec.borough.slug);
  return `/burgers?${p.toString().replace(/%2C/g, ",")}`;
}
