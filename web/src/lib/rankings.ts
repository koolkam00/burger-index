// The ranking pages (user decisions 2026-09-25): static lists, each an H1 in plain words, a one-line answer
// and a ranked table. Cheapest and most expensive in NYC, in each borough and in each neighborhood with at
// least MIN_NEIGHBORHOOD_MENUS distinct priced menus (the top rankingCap, with any menus tied at the cut);
// every spot whose priciest burger is under $15 and under $20 in NYC; and every spot whose priciest burger
// is of a burger style (lib/styles.ts: smash, double, wagyu, dry-aged, patty melt), for the styles with at
// least MIN_STYLE_MENUS menus.
//
// Each restaurant publishes one burger, its highest-priced (CLAUDE.md "One burger per restaurant"), so a
// list ranks spots by their priciest burger (user decision 2026-09-25, "honest cheapest wording"): the
// cheapest and under-$N lists name burger spots, never "the cheapest burgers" or "burgers under $15" as
// if every burger on every menu were known. The most expensive lists name burgers: each row is the
// priciest burger at its spot. A style list names the spots whose priciest burger is of that style, never
// "every smash burger in NYC".
//
// Rows are distinct menus (menus.ts): an independent restaurant once, a chain once per list, with how
// many of its locations the list covers. The order is menusByIndexPrice / menusByIndexPriceDesc, the
// same as every cheapest and priciest list on the site. Pure and client-safe.
import { BOROUGH_META, boroughInProse, boroughMeta, inNeighborhood, type BoroughMeta } from "./boroughs";
import { formatCount, formatPrice } from "./format";
import { menusByIndexPrice, menusByIndexPriceDesc, pricedMenus, type Menu } from "./menus";
import type { PricedRestaurant } from "./schema";
import { hasStyle, MIN_STYLE_MENUS, STYLES, type BurgerStyle } from "./styles";

export type RankingKind = "cheapest" | "priciest" | "under" | "style";

/** A neighborhood with its own cheapest and most expensive lists (neighborhoodsWithRankings). */
export type RankingNeighborhood = { slug: string; name: string; borough: BoroughMeta };

export type RankingSpec = {
  kind: RankingKind;
  /** The borough the list covers (a neighborhood list: the neighborhood's), or null for all of NYC. */
  borough: BoroughMeta | null;
  /** The neighborhood a cheapest or most expensive list covers, or null. */
  neighborhood: RankingNeighborhood | null;
  /** "under" only: spots whose priciest burger is priced below this many whole dollars. */
  under: number | null;
  /** "style" only: spots whose priciest burger is of this style (NYC). */
  style: BurgerStyle | null;
};

/** The cheapest and most expensive lists show at most this many rows (plus ties at the cut); the under-$N lists show every row. */
export const RANKING_LIMIT = 25;

/**
 * How many rows a cheapest or most expensive list of `total` menus shows before ties: RANKING_LIMIT,
 * but at most half the place's menus, so its two lists never overlap (at least one row).
 */
export function rankingCap(total: number): number {
  return Math.max(1, Math.min(RANKING_LIMIT, Math.floor(total / 2)));
}
/** The under-$N lists (NYC only). */
export const UNDER_PRICES = [15, 20] as const;

/**
 * Distinct priced menus a neighborhood needs for its own cheapest and most expensive lists: each list then
 * has at least 5 rows (rankingCap), and the two never share a menu.
 */
export const MIN_NEIGHBORHOOD_MENUS = 10;

const BASE = { cheapest: "/cheapest-burgers", priciest: "/most-expensive-burgers" } as const;

export function rankingPath(spec: RankingSpec): string {
  if (spec.kind === "under") return `/burgers-under-${spec.under}`;
  if (spec.kind === "style") return `/burgers/${(spec.style as BurgerStyle).slug}`;
  if (spec.neighborhood) return `${BASE[spec.kind]}/${spec.neighborhood.borough.slug}/${spec.neighborhood.slug}`;
  return spec.borough ? `${BASE[spec.kind]}/${spec.borough.slug}` : BASE[spec.kind];
}

const makeSpec = (kind: RankingKind, fields: Partial<Omit<RankingSpec, "kind">> = {}): RankingSpec => ({
  kind,
  borough: null,
  neighborhood: null,
  under: null,
  style: null,
  ...fields,
});
export const cheapestSpec = (borough: BoroughMeta | null = null): RankingSpec => makeSpec("cheapest", { borough });
export const priciestSpec = (borough: BoroughMeta | null = null): RankingSpec => makeSpec("priciest", { borough });
export const underSpec = (under: number): RankingSpec => makeSpec("under", { under });
export const styleSpec = (style: BurgerStyle): RankingSpec => makeSpec("style", { style });

/** The NYC lists, in link order: cheapest, most expensive, under $15, under $20. */
export const CITY_RANKINGS: readonly RankingSpec[] = [cheapestSpec(), priciestSpec(), ...UNDER_PRICES.map(underSpec)];

/** A borough's two lists. */
export function boroughRankings(borough: BoroughMeta): RankingSpec[] {
  return [cheapestSpec(borough), priciestSpec(borough)];
}

/** A neighborhood's two lists. */
export function neighborhoodRankings(n: RankingNeighborhood): RankingSpec[] {
  return [makeSpec("cheapest", { borough: n.borough, neighborhood: n }), makeSpec("priciest", { borough: n.borough, neighborhood: n })];
}

/**
 * The neighborhoods with their own two lists, in borough order then by name: at least
 * MIN_NEIGHBORHOOD_MENUS distinct priced menus, and a cheapest list that shares no menu with the most
 * expensive one (menus tied at a cut stay on a list, so ties at the middle could make them meet).
 */
export function neighborhoodsWithRankings(restaurants: readonly PricedRestaurant[]): RankingNeighborhood[] {
  const byHood = new Map<string, PricedRestaurant[]>();
  for (const r of restaurants) {
    if (!r.neighborhood_slug || !r.neighborhood) continue;
    byHood.set(r.neighborhood_slug, [...(byHood.get(r.neighborhood_slug) ?? []), r]);
  }
  const out: RankingNeighborhood[] = [];
  for (const [slug, list] of byHood) {
    if (pricedMenus(list).length < MIN_NEIGHBORHOOD_MENUS) continue;
    const n = { slug, name: list[0].neighborhood as string, borough: boroughMeta(list[0].borough) };
    const [cheap, pricey] = neighborhoodRankings(n).map((s) => new Set(rankMenus(list, s).rows.map((m) => m.key)));
    if ([...cheap].some((k) => pricey.has(k))) continue;
    out.push(n);
  }
  const order = (n: RankingNeighborhood) => BOROUGH_META.indexOf(n.borough);
  return out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/** The styles with a list: at least MIN_STYLE_MENUS distinct priced menus whose burger is of the style. */
export function stylesWithRankings(restaurants: readonly PricedRestaurant[]): BurgerStyle[] {
  return STYLES.filter((s) => rankMenus(restaurants, styleSpec(s)).total >= MIN_STYLE_MENUS);
}

/**
 * Every ranking page: NYC first, then the boroughs in the fixed order, the neighborhoods with lists and
 * the burger styles with lists. A borough with nothing priced has no lists (they would be empty), like a
 * neighborhood with nothing priced has no page.
 */
export function rankingSpecs(restaurants: readonly PricedRestaurant[]): RankingSpec[] {
  const priced = new Set(restaurants.map((r) => r.borough));
  return [
    ...CITY_RANKINGS,
    ...BOROUGH_META.filter((b) => priced.has(b.name)).flatMap(boroughRankings),
    ...neighborhoodsWithRankings(restaurants).flatMap(neighborhoodRankings),
    ...stylesWithRankings(restaurants).map(styleSpec),
  ];
}

/** "NYC", "Brooklyn", "the Bronx", "West Village" (a neighborhood bare: titles put it after a comma). */
export function rankingPlace(spec: RankingSpec): string {
  if (spec.neighborhood) return spec.neighborhood.name;
  return spec.borough ? boroughInProse(spec.borough.name) : "NYC";
}

/** The place with its preposition: "in NYC", "in the Bronx", "in the West Village", "on the Upper West Side". */
export function rankingIn(spec: RankingSpec): string {
  return spec.neighborhood ? inNeighborhood(spec.neighborhood.name) : `in ${rankingPlace(spec)}`;
}

/**
 * Without the place (breadcrumbs): "Cheapest burger spots", "Most expensive burgers", "Burger spots
 * where the priciest burger is under $15", "Smash burger spots".
 */
export function rankingShortName(spec: RankingSpec): string {
  if (spec.kind === "under") return `Burger spots where the priciest burger is under ${formatPrice(spec.under)}`;
  if (spec.kind === "style") return (spec.style as BurgerStyle).spots;
  return spec.kind === "cheapest" ? "Cheapest burger spots" : "Most expensive burgers";
}

/**
 * The page's name in plain words (the H1, without its period): "Cheapest burger spots in NYC", "Most
 * expensive burgers in the Bronx", "Cheapest burger spots on the Upper West Side", "Burger spots in NYC
 * where the priciest burger is under $15", "Burger spots in NYC where the priciest burger is a smash burger".
 */
export function rankingName(spec: RankingSpec): string {
  if (spec.kind === "under") return `Burger spots ${rankingIn(spec)} where the priciest burger is under ${formatPrice(spec.under)}`;
  if (spec.kind === "style") return `Burger spots ${rankingIn(spec)} where the priciest burger is ${(spec.style as BurgerStyle).aBurger}`;
  return `${rankingShortName(spec)} ${rankingIn(spec)}`;
}

/** The name inside a sentence: "cheapest burger spots in NYC" ("See the …", "See all …"). */
export function rankingNameInSentence(spec: RankingSpec): string {
  const name = rankingName(spec);
  return `${name[0].toLowerCase()}${name.slice(1)}`;
}

export type RankedMenu = Menu & {
  /** 1-based; menus on the same price (to the cent) share a rank (1, 2, 2, 4). */
  rank: number;
};

export type Ranking = {
  /** The rows the page shows: the top rankingCap for cheapest and priciest plus every menu tied with the last of them; every row under $N. */
  rows: RankedMenu[];
  /** Distinct menus the list covers before the cap (every priced menu in the place, or every one under $N): "531 menus". */
  total: number;
  /** Priced locations those menus cover (a chain's every location): "96 burger spots". */
  spots: number;
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
  const scope = spec.neighborhood
    ? restaurants.filter((r) => r.neighborhood_slug === spec.neighborhood!.slug)
    : spec.borough
      ? restaurants.filter((r) => r.borough === spec.borough!.name)
      : restaurants;
  const ordered = spec.kind === "priciest" ? menusByIndexPriceDesc(scope) : menusByIndexPrice(scope);
  const matching =
    spec.kind === "under"
      ? ordered.filter((m) => cents(m.indexPrice) < (spec.under as number) * 100)
      : spec.kind === "style"
        ? ordered.filter((m) => hasStyle(m.restaurant.burger, (spec.style as BurgerStyle).key))
        : ordered;
  const ranked = withRanks(matching);
  const spots = matching.reduce((n, m) => n + m.locations, 0);
  if (spec.kind === "under" || spec.kind === "style") return { rows: ranked, total: matching.length, spots };
  // A cut never splits equal prices: menus tied with the last row shown stay (they share its rank).
  const cap = rankingCap(matching.length);
  const cut = ranked.length > cap ? ranked[cap - 1].rank : Infinity;
  return { rows: ranked.filter((m) => m.rank <= cut), total: matching.length, spots };
}

/** The kicker ticket over each kind of list (the page's ticket and its share image's overline). */
export const RANKING_TICKETS: Record<RankingKind, string> = {
  cheapest: "Cheapest on the counter",
  priciest: "Top shelf",
  under: "Catch of the day",
  style: "Off the grill",
};

/**
 * How many there are, under the table: the rows are distinct menus (a chain once), so they are counted as
 * "menus" ("The 25 cheapest of 531 menus in NYC.", "All 90 menus on this list, cheapest first."); "burger
 * spots" always counts locations.
 */
export function rankingCountLine(spec: RankingSpec, ranking: Pick<Ranking, "rows" | "total">): string {
  const shown = formatCount(ranking.rows.length);
  if (spec.kind === "under" || spec.kind === "style") return `All ${shown} menus on this list, cheapest first.`;
  return `The ${shown} ${spec.kind === "cheapest" ? "cheapest" : "most expensive"} of ${formatCount(ranking.total)} menus ${rankingIn(spec)}.`;
}

/** The rows that share first place (the cheapest or the most expensive, to the cent). */
export function topTied(rows: readonly RankedMenu[]): RankedMenu[] {
  return rows.filter((r) => r.rank === 1);
}

/**
 * Where /burgers shows the same list, one location per row: the neighborhood or borough filter, most
 * expensive first for that list, and the price cap for an under-$N list (the explorer's max is
 * inclusive). The explorer has no style filter: null for a style list.
 */
export function explorerHref(spec: RankingSpec): string | null {
  if (spec.kind === "style") return null;
  const p = new URLSearchParams();
  if (spec.neighborhood) p.set("neighborhood", spec.neighborhood.slug);
  else if (spec.borough) p.set("borough", spec.borough.slug);
  if (spec.kind === "under") p.set("max", ((spec.under as number) - 0.01).toFixed(2));
  if (spec.kind === "priciest") p.set("sort", "-price");
  const q = p.toString();
  return q ? `/burgers?${q}` : "/burgers";
}

/** /burgers searched for a chain's name (and its borough or neighborhood on their lists): every location of that menu. */
export function chainExplorerHref(menu: Menu, spec: RankingSpec): string {
  const p = new URLSearchParams({ q: menu.restaurant.name });
  if (spec.neighborhood) p.set("neighborhood", spec.neighborhood.slug);
  else if (spec.borough) p.set("borough", spec.borough.slug);
  return `/burgers?${p.toString().replace(/%2C/g, ",")}`;
}
