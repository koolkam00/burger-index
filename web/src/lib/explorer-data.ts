import "server-only";

import { getIndexBurger, getNeighborhoodPages, getPricedRestaurants, getStats } from "./data";
import type { ExplorerData, ExRow } from "./explorer";

/** Compact payload for the /burgers explorer: one row per priced restaurant, its one burger. */
export function buildExplorerData(): ExplorerData {
  const rows: ExRow[] = [];
  for (const r of getPricedRestaurants()) {
    const b = getIndexBurger(r);
    // Every priced restaurant has its burger and a price source (data.ts checks both).
    if (!b || r.index_price === null || r.price_source === null) continue;
    rows.push({ id: r.id, name: r.name, burger: b.name, price: r.index_price, nb: r.neighborhood, nbSlug: r.neighborhood_slug, borough: r.borough, source: r.price_source });
  }
  return {
    median: getStats().index_median,
    rows,
    neighborhoods: getNeighborhoodPages().map((n) => ({ slug: n.slug, name: n.name, borough: n.borough })),
  };
}
