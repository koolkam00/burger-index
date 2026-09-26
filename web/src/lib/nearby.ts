// "Nearby at a similar price" on restaurant pages (user decision 2026-09-25, stage 4): up to four other
// priced burger spots within about 1.5 km whose burger costs within about $4 of this one, nearest first;
// when fewer are that close (or the restaurant has no coordinates), the rest come from its own
// neighborhood, closest in price first. Every row is a priced restaurant with a page (an unpriced place
// has none), one per menu: this restaurant's own chain is left out and another chain shows once, at its
// nearest location. Computed at build time from the dataset. Pure and client-safe.
import { menuKey, type Menu } from "./menus";
import type { PricedRestaurant } from "./schema";

/** How far "nearby" reaches, in kilometers (as the crow flies). */
export const NEARBY_KM = 1.5;
/** How far apart two prices may be and still be "similar", in dollars (inclusive, to the cent). */
export const NEARBY_PRICE_GAP = 4;
/** At most this many rows. */
export const NEARBY_MAX = 4;

type Place = Pick<PricedRestaurant, "lat" | "lng">;

const EARTH_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometers, or null when either place has no coordinates. */
export function distanceKm(a: Place, b: Place): number | null {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "0.3 mi" (one decimal, at least 0.1): how far a nearby spot is, for a New York page. */
export function formatMiles(km: number): string {
  return `${Math.max(0.1, Math.round((km / 1.609344) * 10) / 10).toFixed(1)} mi`;
}

export type NearbySpot = {
  restaurant: PricedRestaurant;
  /** Kilometers away, or null when either place has no coordinates. */
  km: number | null;
  /** True when it is within NEARBY_KM; false for a neighborhood fallback row. */
  near: boolean;
};

const cents = (v: number) => Math.round(v * 100);
const byName = (a: PricedRestaurant, b: PricedRestaurant) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The rows for `r`'s "Nearby at a similar price" section, from every priced restaurant. */
export function nearbySimilar(r: PricedRestaurant, all: readonly PricedRestaurant[]): NearbySpot[] {
  const own = menuKey(r);
  const similar = all
    .filter((x) => x.id !== r.id && menuKey(x) !== own && Math.abs(cents(x.index_price) - cents(r.index_price)) <= NEARBY_PRICE_GAP * 100)
    .map((x) => ({ restaurant: x, km: distanceKm(r, x) }));
  const gap = (x: PricedRestaurant) => Math.abs(cents(x.index_price) - cents(r.index_price));

  const out: NearbySpot[] = [];
  const menus = new Set<string>();
  const take = (list: Array<{ restaurant: PricedRestaurant; km: number | null }>, near: boolean) => {
    for (const s of list) {
      if (out.length >= NEARBY_MAX) return;
      const key = menuKey(s.restaurant);
      if (menus.has(key)) continue;
      menus.add(key);
      out.push({ ...s, near });
    }
  };
  // Within NEARBY_KM, nearest first (a chain once, at its nearest location).
  take(
    similar.filter((s) => s.km !== null && s.km <= NEARBY_KM).sort((a, b) => (a.km as number) - (b.km as number) || gap(a.restaurant) - gap(b.restaurant) || byName(a.restaurant, b.restaurant)),
    true,
  );
  // Then the same neighborhood, closest in price first.
  if (r.neighborhood_slug) {
    take(
      similar
        .filter((s) => s.restaurant.neighborhood_slug === r.neighborhood_slug)
        .sort((a, b) => gap(a.restaurant) - gap(b.restaurant) || (a.km ?? Infinity) - (b.km ?? Infinity) || byName(a.restaurant, b.restaurant)),
      false,
    );
  }
  return out;
}

/** "More in <neighborhood>" shows at most this many menus. */
export const MORE_IN_MAX = 6;

/**
 * "More in <neighborhood>" under the nearby rows: the neighborhood's other menus (`hoodMenus`, cheapest
 * first, from menusByIndexPrice) less this restaurant's own and those Nearby already shows, and whether the
 * page links "All of <neighborhood>". The link stays whenever the neighborhood has another menu, even when
 * Nearby took them all (the page then puts it under Nearby), so no page loses its in-body neighborhood link.
 */
export function moreInNeighborhood(
  r: PricedRestaurant,
  hoodMenus: readonly Menu[],
  nearby: readonly NearbySpot[],
): { menus: Menu[]; linkNeighborhood: boolean } {
  const own = menuKey(r);
  const shown = new Set(nearby.map((n) => menuKey(n.restaurant)));
  const others = hoodMenus.filter((m) => m.key !== own);
  return { menus: others.filter((m) => !shown.has(m.key)).slice(0, MORE_IN_MAX), linkNeighborhood: r.neighborhood_slug !== null && others.length > 0 };
}
