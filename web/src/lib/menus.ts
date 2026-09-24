// Distinct menus: the unit the Burger Index counts (CLAUDE.md "Chains count once").
//
// Every independent restaurant is one menu. A chain's locations share one scraped menu, so a chain is
// one menu citywide and at most one menu inside any area. The pipeline computes stats.index_* and
// every area index_median/min/max this way (pipeline/build.py `menu_index_prices`); these helpers
// apply the same rule to anything the site derives itself: distributions, rankings, cheapest and
// priciest lists, thresholds and "N menus" copy. Location counts (restaurants_priced, burgers, map
// pins, table rows) stay per location.
//
// Client-safe and pure: types only from ./schema, so zod stays out of the browser bundle, and every
// function takes the list it counts, so the same call gives citywide or per-area answers.
import { STATUSES } from "./enums";
import { formatCount, formatPrice, pluralize } from "./format";
import type { AreaSummary, Restaurant, Status } from "./schema";
import { MIN_RANKED } from "./site";

type MenuFields = Pick<Restaurant, "id" | "chain">;

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
  restaurant: Restaurant;
  /** Chain slug, or null for an independent restaurant. */
  chain: string | null;
  indexPrice: number;
  /** Priced locations in the list that share this menu (1 for an independent restaurant). */
  locations: number;
};

/**
 * One entry per distinct priced menu in `list`, in the order each menu first appears. A chain takes
 * the index price of its first priced location, exactly like the pipeline (its locations share one
 * menu, so they share one price).
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

/**
 * Priced, but only from chain menus: no independent restaurant is priced here yet. Such an area's
 * median is a chain median, so it is labelled and never presented as a like-for-like comparison.
 */
export function isChainOnly(c: MenuCounts): boolean {
  return c.chains > 0 && c.independents === 0;
}

/** Enough distinct priced menus to rank an area (5 locations of one chain in a neighborhood are one menu). */
export function isRankable(c: MenuCounts, median: number | null, min: number = MIN_RANKED): boolean {
  return median !== null && c.menus >= min;
}

/**
 * Priced areas split by coverage: `comparable` have at least one independent menu (like-for-like with
 * each other); `chainOnly` are priced from chain menus alone and are only ever shown labelled.
 * Input order is kept in both lists.
 */
export function splitByCoverage<T>(areas: readonly T[], counts: (a: T) => MenuCounts, median: (a: T) => number | null): { comparable: T[]; chainOnly: T[] } {
  const priced = areas.filter((a) => median(a) !== null && counts(a).menus > 0);
  return { comparable: priced.filter((a) => !isChainOnly(counts(a))), chainOnly: priced.filter((a) => isChainOnly(counts(a))) };
}

/** A restaurant can be compared with its area's median only when the area has another priced menu. */
export function hasOtherMenus(c: MenuCounts): boolean {
  return c.menus > 1;
}

/**
 * Every distinct menu in `list`, priced or not: each independent restaurant once, each chain once.
 * `locations` here counts every row (listed locations), not only priced ones.
 */
export function listedMenus(list: readonly Restaurant[]): MenuCounts {
  const independents = new Set<string>();
  const chains = new Set<string>();
  for (const r of list) (r.chain ? chains : independents).add(menuKey(r));
  return { menus: independents.size + chains.size, independents: independents.size, chains: chains.size, locations: list.length };
}

/**
 * A chain's airport concession (JFK, LaGuardia): the pipeline never applies the chain's street price
 * there (pipeline/build.py `airport_result`), so the row is listed unpriced with this note.
 */
export function isAirportLocation(r: Pick<Restaurant, "chain" | "status_detail">): boolean {
  return r.chain !== null && /^Airport location\b/.test(r.status_detail ?? "");
}

/** A chain's rows split by whether they carry its shared menu price (input order kept). */
export function chainCoverage(rows: readonly Restaurant[]): { priced: Restaurant[]; unpriced: Restaurant[] } {
  return { priced: rows.filter((r) => r.index_price !== null), unpriced: rows.filter((r) => r.index_price === null) };
}

/** Per status: distinct menus (independents, chains) and every listed location with that status. */
export type StatusTally = { independents: number; chains: number; locations: number };

/**
 * How many menus and locations sit in each status. A menu's status is `priced` when any of its
 * locations is priced (a chain's airport rows don't make it unpriced); otherwise the status of its
 * first location that is not an airport concession. Locations are counted by their own status.
 */
export function statusTally(list: readonly Restaurant[]): Record<Status, StatusTally> {
  const out = Object.fromEntries(STATUSES.map((s) => [s, { independents: 0, chains: 0, locations: 0 }])) as Record<Status, StatusTally>;
  const byKey = new Map<string, Restaurant[]>();
  for (const r of list) {
    out[r.status].locations += 1;
    const k = menuKey(r);
    const rows = byKey.get(k);
    if (rows) rows.push(r);
    else byKey.set(k, [r]);
  }
  for (const rows of byKey.values()) {
    const status = rows.some((r) => r.index_price !== null) ? "priced" : (rows.find((r) => !isAirportLocation(r)) ?? rows[0]).status;
    if (rows[0].chain) out[status].chains += 1;
    else out[status].independents += 1;
  }
  return out;
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

/**
 * Chain names in `list`, most priced locations first (ties by name): the chains a chain-only area
 * is priced from. Names come from the chain's location rows, which share the chain's display name.
 */
export function chainNames(list: readonly Restaurant[]): string[] {
  return pricedMenus(list)
    .filter((m) => m.chain !== null)
    .sort((a, b) => b.locations - a.locations || a.restaurant.name.localeCompare(b.restaurant.name))
    .map((m) => m.restaurant.name);
}

/** Every chain listed in `list`, priced or not, most listed locations first (ties by name). */
export function listedChainNames(list: readonly Restaurant[]): string[] {
  const byChain = new Map<string, { name: string; n: number }>();
  for (const r of list) {
    if (!r.chain) continue;
    const seen = byChain.get(r.chain);
    if (seen) seen.n += 1;
    else byChain.set(r.chain, { name: r.name, n: 1 });
  }
  return [...byChain.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((c) => c.name);
}

/** "A", "A and B", "A, B and C" (house style: no serial comma). */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Up to `max` names, then "and N more": "7th Street Burger, Jackson Hole, Burger Joint and 4 more". */
export function joinSome(items: readonly string[], max = 3): string {
  if (items.length <= max) return joinList(items);
  return `${items.slice(0, max).join(", ")} and ${formatCount(items.length - max)} more`;
}

/**
 * Names after a count: ": A and B" when `items` is the whole list, ", including A, B and C" only when
 * it has to be cut to `max` (so "including" never implies names that don't exist).
 */
export function listedNames(items: readonly string[], max = 3): string {
  if (!items.length) return "";
  return items.length <= max ? `: ${joinList(items)}` : `, including ${joinList(items.slice(0, max))}`;
}

// Whether national fast-food chains are left out is part of the scope: see ./scope (restaurantScope).

// ---- chain source location ------------------------------------------------------------------------

const CHAIN_SOURCE = /\bone NYC location \(([^)]+)\)/;

/**
 * The location whose menu a chain's shared price was read from, as the pipeline writes it into every
 * chain row's status_detail (process.py: "Chain-level prices from one NYC location (91 East 7 Street,
 * Manhattan)"), or null when the note doesn't name one.
 */
export function chainSourceLocation(statusDetail: string | null | undefined): string | null {
  const m = CHAIN_SOURCE.exec(statusDetail ?? "");
  return m ? m[1].trim() : null;
}

/** This chain row is the location the chain's menu was read from (same "address, borough" as the note). */
export function isChainSourceLocation(r: Pick<Restaurant, "chain" | "address" | "borough" | "status_detail">): boolean {
  if (!r.chain) return false;
  const source = chainSourceLocation(r.status_detail);
  if (!source) return false;
  const here = [r.address, r.borough].filter(Boolean).join(", ");
  return source.toLowerCase() === here.toLowerCase();
}

// ---- what counting per location would do -----------------------------------------------------------

const toCents = (x: number) => Math.round(x * 100);

/**
 * The methodology's "counted per location" sentence, computed from the priced menus: how many priced
 * locations belong to chains, the biggest chain's share, and which chain's price (if any) a median over
 * locations lands on. It says one chain "would set the number" only when that chain has more than half
 * of the priced locations (then the location median is its price by construction). Null when counting
 * per location changes nothing (no chain has a second priced location) or nothing is priced.
 */
export function perLocationNote(menus: readonly Menu[], locationMedian: number | null, menuMedian: number | null): string | null {
  const chains = menus.filter((m) => m.chain !== null).sort((a, b) => b.locations - a.locations || a.restaurant.name.localeCompare(b.restaurant.name));
  const total = menus.reduce((n, m) => n + m.locations, 0);
  const chainLocations = chains.reduce((n, m) => n + m.locations, 0);
  if (!total || !chains.length || chainLocations <= chains.length || locationMedian === null || menuMedian === null) return null;
  const top = chains[0];
  const dominant = top.locations * 2 > total;
  const first = dominant
    ? `Counted per location, one chain would set the number: ${top.restaurant.name} alone has ${formatCount(top.locations)} of the ${formatCount(total)} priced locations.`
    : chains.length === 1
      ? `Counted per location, ${top.restaurant.name} would count ${formatCount(top.locations)} times, not once: it has ${formatCount(top.locations)} of the ${formatCount(total)} priced locations.`
      : `Counted per location, a chain would count again at every location: ${pluralize(chains.length, "chain")} hold ${formatCount(chainLocations)} of the ${formatCount(total)} priced locations, and ${top.restaurant.name} alone has ${formatCount(top.locations)}.`;
  if (toCents(locationMedian) === toCents(menuMedian))
    return `${first} Right now a median over locations happens to land on the same price, but it would move with every chain opening or closing, not with what burgers cost.`;
  // The chain whose price the location median lands on (most locations first), if it lands on one.
  const landsOn = chains.find((m) => toCents(m.indexPrice) === toCents(locationMedian));
  const whose = landsOn ? (dominant && landsOn === top ? ", its price" : `, the ${landsOn.restaurant.name} price`) : "";
  return `${first} A median over locations would be ${formatPrice(locationMedian, { cents: "always" })}${whose}; over distinct menus it is ${formatPrice(menuMedian, { cents: "always" })}.`;
}
