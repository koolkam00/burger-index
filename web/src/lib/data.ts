// Server-only data access. The dataset is read and validated ONCE per build worker, at import:
// if src/data/burger_index.json does not match the contract, the build fails here.
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BOROUGH_META, boroughBySlug, type BoroughMeta } from "./boroughs";
import { handCheckedMenus, type HandCheckedMenu } from "./hand-checks";
import { isRankable, menuCounts, NO_MENUS, type AreaWithMenus, type MenuCounts } from "./menus";
import {
  BurgerIndexSchema,
  type AreaSummary,
  type Borough,
  type Burger,
  type BurgerIndex,
  type Restaurant,
  type Stats,
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
  const problems: string[] = [];
  const ids = new Set<string>();
  const burgerIds = new Set<string>();
  for (const r of data.restaurants) {
    if (ids.has(r.id)) problems.push(`duplicate restaurant id ${r.id}`);
    ids.add(r.id);
    let nIndex = 0;
    for (const b of r.burgers) {
      if (burgerIds.has(b.id)) problems.push(`duplicate burger id ${b.id}`);
      burgerIds.add(b.id);
      if (b.is_index_item) nIndex += 1;
    }
    if ((r.index_price !== null) !== (nIndex === 1) || nIndex > 1) problems.push(`${r.id}: index_price/is_index_item mismatch`);
  }
  if (problems.length) throw new Error(`src/data/burger_index.json breaks dataset invariants:\n  ${problems.slice(0, 20).join("\n  ")}`);
  return data;
}

function loadSource(): "pipeline" | "fixture" {
  try {
    const meta = JSON.parse(readFileSync(join(DATA_DIR, "meta.json"), "utf8")) as { source?: string };
    return meta.source === "pipeline" ? "pipeline" : "fixture";
  } catch {
    return "fixture";
  }
}

const DATA = load();
const SOURCE = loadSource();

const RESTAURANTS_BY_ID = new Map(DATA.restaurants.map((r) => [r.id, r]));
const NEIGHBORHOODS_BY_SLUG = new Map(DATA.neighborhoods.map((n) => [n.slug, n]));
const BOROUGHS_BY_SLUG = new Map(DATA.boroughs.map((b) => [b.slug, b]));
const BURGERS_BY_ID = new Map<string, BurgerRow>();
for (const r of DATA.restaurants) for (const b of r.burgers) BURGERS_BY_ID.set(b.id, { burger: b, restaurant: r });

// Distinct priced menus per area: a chain counts once citywide and at most once per area.
function groupBy<K>(key: (r: Restaurant) => K | null): Map<K, Restaurant[]> {
  const out = new Map<K, Restaurant[]>();
  for (const r of DATA.restaurants) {
    const k = key(r);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}
const CITY_MENUS = menuCounts(DATA.restaurants);
const BOROUGH_MENUS = new Map([...groupBy((r) => r.borough)].map(([k, list]) => [k, menuCounts(list)]));
const NEIGHBORHOOD_MENUS = new Map([...groupBy((r) => r.neighborhood_slug)].map(([k, list]) => [k, menuCounts(list)]));
const HAND_CHECKED = handCheckedMenus(DATA.restaurants);

export type BurgerRow = { burger: Burger; restaurant: Restaurant };

// ---- dataset-level ---------------------------------------------------------------------------

export function getDataset(): BurgerIndex {
  return DATA;
}
export function getDataSource(): "pipeline" | "fixture" {
  return SOURCE;
}
export function getStats(): Stats {
  return DATA.stats;
}
export function getMethodology() {
  return DATA.methodology;
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
/** Menus whose prices were corrected or withheld after a manual re-check (one entry per chain). */
export function getHandCheckedMenus(): readonly HandCheckedMenu[] {
  return HAND_CHECKED;
}

// ---- restaurants -------------------------------------------------------------------------------

export function getRestaurants(): readonly Restaurant[] {
  return DATA.restaurants;
}
export function getRestaurant(id: string): Restaurant | undefined {
  return RESTAURANTS_BY_ID.get(id);
}
/**
 * Priced LOCATIONS (every chain copy included): for map pins and location tables. Anything that
 * ranks, bins or counts prices uses the per-menu helpers in ./menus instead.
 */
export function pricedLocations(list: readonly Restaurant[] = DATA.restaurants): Restaurant[] {
  return list.filter((r) => r.index_price !== null);
}
export function getIndexBurger(r: Restaurant): Burger | undefined {
  return r.burgers.find((b) => b.is_index_item);
}
export function getChainLocations(r: Restaurant): Restaurant[] {
  if (!r.chain) return [];
  return DATA.restaurants.filter((x) => x.chain === r.chain && x.id !== r.id);
}

// ---- burgers -----------------------------------------------------------------------------------

export function allBurgers(): BurgerRow[] {
  return DATA.restaurants.flatMap((restaurant) => restaurant.burgers.map((burger) => ({ burger, restaurant })));
}
export function getBurger(id: string | null): BurgerRow | undefined {
  return id ? BURGERS_BY_ID.get(id) : undefined;
}

// ---- neighborhoods -------------------------------------------------------------------------------

export type { AreaWithMenus };

export function getNeighborhoods(): readonly AreaSummary[] {
  return DATA.neighborhoods;
}
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
export function getRestaurantsInNeighborhood(slug: string): Restaurant[] {
  return DATA.restaurants.filter((r) => r.neighborhood_slug === slug);
}
/**
 * Neighborhoods with at least MIN_RANKED distinct priced menus (a chain counts once per area),
 * priciest median first. Chain-only ones can qualify; every ranking labels them.
 */
export function rankedNeighborhoods(list: readonly AreaSummary[] = DATA.neighborhoods): AreaWithMenus[] {
  return withMenuCounts(list)
    .filter((n) => isRankable(n.menuCounts, n.index_median, MIN_RANKED))
    .sort((a, b) => (b.index_median ?? 0) - (a.index_median ?? 0) || a.name.localeCompare(b.name));
}
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
export function getRestaurantsInBorough(name: Borough): Restaurant[] {
  return DATA.restaurants.filter((r) => r.borough === name);
}
export function getNeighborhoodsInBorough(name: Borough): AreaSummary[] {
  return DATA.neighborhoods.filter((n) => n.borough === name);
}
