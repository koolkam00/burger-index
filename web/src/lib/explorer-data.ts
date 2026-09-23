import "server-only";

import { getNeighborhoods, getRestaurants, getStats } from "./data";
import type { ExBurger, ExplorerData, ExRestaurant, SourceKey } from "./explorer";
import { PRICE_SOURCES, PROTEINS } from "./enums";
import type { Protein } from "./schema";

/** Compact payload for the /burgers explorer: every burger, restaurants referenced by index. */
export function buildExplorerData(): ExplorerData {
  const restaurants: ExRestaurant[] = [];
  const burgers: ExBurger[] = [];
  const sources = new Set<SourceKey>();
  const proteins = new Set<Protein>();
  for (const r of getRestaurants()) {
    if (!r.burgers.length) continue;
    const ri = restaurants.length;
    restaurants.push({ id: r.id, name: r.name, nb: r.neighborhood, nbSlug: r.neighborhood_slug, borough: r.borough, source: r.price_source });
    sources.add(r.price_source ?? "unknown");
    for (const b of r.burgers) {
      proteins.add(b.protein);
      burgers.push({ r: ri, id: b.id, name: b.name, price: b.price, protein: b.protein, idx: b.is_index_item });
    }
  }
  const order: SourceKey[] = [...PRICE_SOURCES, "unknown"];
  return {
    median: getStats().index_median,
    restaurants,
    burgers,
    neighborhoods: getNeighborhoods().map((n) => ({ slug: n.slug, name: n.name, borough: n.borough })),
    sources: order.filter((s) => sources.has(s)),
    proteins: PROTEINS.filter((p) => proteins.has(p)),
  };
}
