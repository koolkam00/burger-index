import "server-only";

import { getNeighborhoods, getRestaurants, getStats } from "./data";
import type { ExBurger, ExplorerData, ExRestaurant } from "./explorer";
import { PRICE_SOURCES, PROTEINS } from "./enums";
import type { PriceSource, Protein } from "./schema";

/** Compact payload for the /burgers explorer: every burger, restaurants referenced by index. */
export function buildExplorerData(): ExplorerData {
  const restaurants: ExRestaurant[] = [];
  const burgers: ExBurger[] = [];
  const sources = new Set<PriceSource>();
  const proteins = new Set<Protein>();
  for (const r of getRestaurants()) {
    // Every published burger has a price, and its restaurant a price source (data.ts checks both).
    if (!r.burgers.length || r.price_source === null) continue;
    const ri = restaurants.length;
    restaurants.push({ id: r.id, name: r.name, nb: r.neighborhood, nbSlug: r.neighborhood_slug, borough: r.borough, source: r.price_source });
    sources.add(r.price_source);
    for (const b of r.burgers) {
      if (b.price === null) continue;
      proteins.add(b.protein);
      burgers.push({ r: ri, id: b.id, name: b.name, price: b.price, protein: b.protein, idx: b.is_index_item });
    }
  }
  return {
    median: getStats().index_median,
    restaurants,
    burgers,
    neighborhoods: getNeighborhoods().map((n) => ({ slug: n.slug, name: n.name, borough: n.borough })),
    sources: PRICE_SOURCES.filter((s) => sources.has(s)),
    proteins: PROTEINS.filter((p) => proteins.has(p)),
  };
}
