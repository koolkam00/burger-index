// Server-only data access. The dataset is read and validated ONCE per build worker, at import:
// if src/data/burger_index.json does not match the contract, the build fails here.
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BOROUGH_META, boroughBySlug, type BoroughMeta } from "./boroughs";
import { isRankable, menuCounts, NO_MENUS, type AreaWithMenus, type MenuCounts } from "./menus";
import {
  BurgerIndexSchema,
  type AreaSummary,
  type Borough,
  type BurgerIndex,
  type PricedRestaurant,
  type Restaurant,
  type Stats,
  type UnpricedRestaurant,
} from "./schema";
import { MIN_RANKED } from "./site";

const DATA_DIR = join(process.cwd(), "src", "data");

function load(): BurgerIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(DATA_DIR, "burger_index.json"), "utf8"));
  } catch (err) {
    throw new Error(
      `Could not read src/data/burger_index.json (run \`npm run sync-data\`): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = BurgerIndexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`src/data/burger_index.json does not match the contract:\n${z.prettifyError(parsed.error)}`);
  }
  const data = parsed.data;
  // The contract makes a priced restaurant carry its burger and price source; ids (page URLs and
  // People's Top 10 menu keys) must also be unique.
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const r of data.restaurants) {
    if (ids.has(r.id)) problems.push(`duplicate restaurant id ${r.id}`);
    ids.add(r.id);
  }
  if (problems.length) throw new Error(`src/data/burger_index.json breaks dataset invariants:\n  ${problems.slice(0, 20).join("\n  ")}`);
  return data;
}

const DATA = load();

/**
 * Only priced restaurants get a page, a sitemap URL and a row in the explorer, the map and the chain
 * lists (user decision 2026-09-25). The dataset carries the rest only as names (UnpricedRestaurant:
 * id, name, address, neighborhood slug), listed unlinked on their neighborhood's page. Ids are still
 * assigned over every restaurant.
 */
export function isPriced(r: Restaurant): r is PricedRestaurant {
  return r.index_price !== null;
}
export function isUnpriced(r: Restaurant): r is UnpricedRestaurant {
  return r.index_price === null;
}
/** A neighborhood gets a page only when at least one restaurant there is priced. */
export function hasNeighborhoodPage(n: Pick<AreaSummary, "restaurants_priced">): boolean {
  return n.restaurants_priced > 0;
}

const PRICED = DATA.restaurants.filter(isPriced);
const PRICED_BY_ID = new Map(PRICED.map((r) => [r.id, r]));
const NEIGHBORHOODS_BY_SLUG = new Map(DATA.neighborhoods.map((n) => [n.slug, n]));
const BOROUGHS_BY_SLUG = new Map(DATA.boroughs.map((b) => [b.slug, b]));

// Distinct priced menus per area: a chain counts once citywide and at most once per area.
function groupBy<K>(key: (r: PricedRestaurant) => K | null): Map<K, PricedRestaurant[]> {
  const out = new Map<K, PricedRestaurant[]>();
  for (const r of PRICED) {
    const k = key(r);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}
const CITY_MENUS = menuCounts(PRICED);
const BOROUGH_MENUS = new Map([...groupBy((r) => r.borough)].map(([k, list]) => [k, menuCounts(list)]));
const NEIGHBORHOOD_MENUS = new Map([...groupBy((r) => r.neighborhood_slug)].map(([k, list]) => [k, menuCounts(list)]));

// ---- dataset-level ---------------------------------------------------------------------------

export function getStats(): Stats {
  return DATA.stats;
}
export function getGeneratedAt(): string {
  return DATA.generated_at;
}
/** THE Burger Index (citywide median index price); null when nothing is priced yet. */
export function getIndexMedian(): number | null {
  return DATA.stats.index_median;
}
/** Distinct priced menus citywide (the count behind the index), with independents, chains and locations. */
export function getMenuCounts(): MenuCounts {
  return CITY_MENUS;
}

// ---- restaurants -------------------------------------------------------------------------------

/** Every restaurant in the dataset, priced (a page) or not (a name). */
export function getAllRestaurants(): readonly Restaurant[] {
  return DATA.restaurants;
}
/** The restaurants that get a page: the priced ones. Every menu count and price list is drawn from them. */
export function getPricedRestaurants(): readonly PricedRestaurant[] {
  return PRICED;
}
/** A priced restaurant by id; undefined for an unknown or unpriced one (it has no page). */
export function getPricedRestaurant(id: string): PricedRestaurant | undefined {
  return PRICED_BY_ID.get(id);
}
/** A chain's other priced locations (an unpriced one has no page to link to). */
export function getChainLocations(r: PricedRestaurant): PricedRestaurant[] {
  if (!r.chain) return [];
  return PRICED.filter((x) => x.chain === r.chain && x.id !== r.id);
}

// ---- neighborhoods -------------------------------------------------------------------------------

export type { AreaWithMenus };

/** Every neighborhood in the dataset, priced or not. */
export function getNeighborhoods(): readonly AreaSummary[] {
  return DATA.neighborhoods;
}
/** The neighborhoods that get a page: those with at least one priced restaurant. */
export function getNeighborhoodPages(): AreaSummary[] {
  return DATA.neighborhoods.filter(hasNeighborhoodPage);
}
/** A neighborhood by slug, whether or not it has a page. */
export function getNeighborhood(slug: string): AreaSummary | undefined {
  return NEIGHBORHOODS_BY_SLUG.get(slug);
}
export function neighborhoodMenuCounts(slug: string): MenuCounts {
  return NEIGHBORHOOD_MENUS.get(slug) ?? NO_MENUS;
}
/** Neighborhood summaries with their distinct-menu counts attached. */
export function withMenuCounts(list: readonly AreaSummary[] = DATA.neighborhoods): AreaWithMenus[] {
  return list.map((n) => ({ ...n, menuCounts: neighborhoodMenuCounts(n.slug) }));
}
/** Every restaurant in a neighborhood, priced (a page) or not (a name). */
export function getRestaurantsInNeighborhood(slug: string): Restaurant[] {
  return DATA.restaurants.filter((r) => r.neighborhood_slug === slug);
}
/**
 * Neighborhoods with at least MIN_RANKED distinct priced menus (a chain counts once per area),
 * priciest median first.
 */
export function rankedNeighborhoods(list: readonly AreaSummary[] = DATA.neighborhoods): AreaWithMenus[] {
  return withMenuCounts(list)
    .filter((n) => isRankable(n.menuCounts, n.index_median, MIN_RANKED))
    .sort((a, b) => (b.index_median ?? 0) - (a.index_median ?? 0) || a.name.localeCompare(b.name));
}
/** The rest, by name: priced ones below the threshold and (they have no page) those with nothing priced. */
export function unrankedNeighborhoods(list: readonly AreaSummary[] = DATA.neighborhoods): AreaWithMenus[] {
  return withMenuCounts(list)
    .filter((n) => !isRankable(n.menuCounts, n.index_median, MIN_RANKED))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- boroughs ------------------------------------------------------------------------------------

export type BoroughEntry = BoroughMeta & { summary: AreaSummary | null; menuCounts: MenuCounts };

function boroughEntry(meta: BoroughMeta): BoroughEntry {
  return { ...meta, summary: BOROUGHS_BY_SLUG.get(meta.slug) ?? null, menuCounts: BOROUGH_MENUS.get(meta.name) ?? NO_MENUS };
}
/** All five boroughs in DESIGN.md order, with their summary when the dataset has one. */
export function getBoroughs(): BoroughEntry[] {
  return BOROUGH_META.map(boroughEntry);
}
export function getBorough(slug: string): BoroughEntry | undefined {
  const meta = boroughBySlug(slug);
  return meta ? boroughEntry(meta) : undefined;
}
/** The priced restaurants in a borough (an unpriced one is listed only by neighborhood). */
export function getPricedRestaurantsInBorough(name: Borough): PricedRestaurant[] {
  return PRICED.filter((r) => r.borough === name);
}
export function getNeighborhoodsInBorough(name: Borough): AreaSummary[] {
  return DATA.neighborhoods.filter((n) => n.borough === name);
}
