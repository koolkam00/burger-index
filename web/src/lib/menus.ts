// Distinct menus: the unit the Burger Index counts (CLAUDE.md "Chains count once").
//
// Every independent restaurant is one menu. A chain's locations share one scraped menu, so a chain is
// one menu citywide and at most one menu inside any area. The pipeline computes stats.index_* and
// every area index_median/min/max this way (pipeline/build.py `menu_index_prices`); these helpers
// apply the same rule to anything the site derives itself: distributions, rankings, cheapest and
// priciest lists, thresholds and "N menus" copy. Location counts (restaurants_priced, map pins,
// table rows) stay per location.
//
// Client-safe and pure: types only from ./schema, so zod stays out of the browser bundle, and every
// function takes the list it counts, so the same call gives citywide or per-area answers.
import { formatCount, pluralize } from "./format";
import type { AreaSummary, PricedRestaurant, Restaurant } from "./schema";
import { MIN_RANKED } from "./site";

type MenuFields = Pick<PricedRestaurant, "id" | "chain">;

/**
 * The menu a restaurant's prices come from: its chain, else the restaurant itself. Chains get a
 * `chain:` prefix (as in the pipeline), which can never collide with a restaurant id (^[a-z0-9-]+$).
 */
export function menuKey(r: MenuFields): string {
  return r.chain ? `chain:${r.chain}` : r.id;
}

export type Menu = {
  key: string;
  /** The row that stands for the menu: the restaurant itself, or the chain's first priced location in the list. */
  restaurant: PricedRestaurant;
  /** Chain slug, or null for an independent restaurant. */
  chain: string | null;
  indexPrice: number;
  /** Priced locations in the list that share this menu (1 for an independent restaurant). */
  locations: number;
};

/**
 * One entry per distinct priced menu in `list`, in the order each menu first appears; unpriced rows are
 * skipped. A chain takes the index price of its first priced location, exactly like the pipeline (its
 * locations share one menu, so they share one price).
 */
export function pricedMenus(list: readonly Restaurant[]): Menu[] {
  const byKey = new Map<string, Menu>();
  for (const r of list) {
    if (r.index_price === null) continue;
    const key = menuKey(r);
    const seen = byKey.get(key);
    if (seen) seen.locations += 1;
    else byKey.set(key, { key, restaurant: r, chain: r.chain, indexPrice: r.index_price, locations: 1 });
  }
  return [...byKey.values()];
}

/** Index prices, one per distinct menu, ascending: what every distribution and percentile is drawn from. */
export function menuIndexPrices(list: readonly Restaurant[]): number[] {
  return pricedMenus(list)
    .map((m) => m.indexPrice)
    .sort((a, b) => a - b);
}

/** Distinct priced menus, cheapest index price first (ties by name, then key, so the order is stable). */
export function menusByIndexPrice(list: readonly Restaurant[]): Menu[] {
  return pricedMenus(list).sort(
    (a, b) => a.indexPrice - b.indexPrice || a.restaurant.name.localeCompare(b.restaurant.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/** Distinct priced menus, priciest index price first. */
export function menusByIndexPriceDesc(list: readonly Restaurant[]): Menu[] {
  return pricedMenus(list).sort(
    (a, b) => b.indexPrice - a.indexPrice || a.restaurant.name.localeCompare(b.restaurant.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

export type MenuCounts = {
  /** Distinct priced menus: independents + chains. */
  menus: number;
  /** Priced independent restaurants (one menu each). */
  independents: number;
  /** Chains with at least one priced location in the list (one menu each). */
  chains: number;
  /** Priced locations: every row with an index price, chain copies included. */
  locations: number;
};

export const NO_MENUS: MenuCounts = { menus: 0, independents: 0, chains: 0, locations: 0 };

/** An area summary plus its distinct priced menus (the pipeline's summary counts locations). */
export type AreaWithMenus = AreaSummary & { menuCounts: MenuCounts };

export function menuCounts(list: readonly Restaurant[]): MenuCounts {
  const menus = pricedMenus(list);
  const chains = menus.filter((m) => m.chain !== null).length;
  return { menus: menus.length, independents: menus.length - chains, chains, locations: menus.reduce((n, m) => n + m.locations, 0) };
}

/** Enough distinct priced menus to rank an area (5 locations of one chain in a neighborhood are one menu). */
export function isRankable(c: MenuCounts, median: number | null, min: number = MIN_RANKED): boolean {
  return median !== null && c.menus >= min;
}

/** A restaurant can be compared with its area's median only when the area has another priced menu. */
export function hasOtherMenus(c: MenuCounts): boolean {
  return c.menus > 1;
}

/** "56 independent restaurants and 9 chains", "12 independent restaurants", "7 chains", "no menus". */
export function menuBreakdown(c: MenuCounts): string {
  const parts: string[] = [];
  if (c.independents) parts.push(pluralize(c.independents, "independent restaurant"));
  if (c.chains) parts.push(pluralize(c.chains, "chain"));
  return parts.length ? parts.join(" and ") : "no menus";
}

/** Compact form for stat sub-lines and table cells: "56 independent + 9 chains", "7 chains". */
export function menuBreakdownShort(c: MenuCounts): string {
  if (c.independents && c.chains) return `${formatCount(c.independents)} independent + ${pluralize(c.chains, "chain")}`;
  if (c.chains) return pluralize(c.chains, "chain");
  if (c.independents) return `${formatCount(c.independents)} independent`;
  return "none";
}

/** "A", "A and B", "A, B and C" (house style: no serial comma). */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
