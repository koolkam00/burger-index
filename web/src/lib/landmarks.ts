// "Burgers near <landmark>" (user decision 2026-09-26): for searches like "burger near Times Square", a page per NYC
// landmark listing every priced burger spot within half a mile of it (about a 10-minute walk), nearest first, with
// its priciest burger, the price and how far it is, and a hub page listing the landmarks. The landmarks and their
// points are in ./landmarks.mjs (plain data, shared with scripts/check-seo.mjs). A long place (the High Line, Central
// Park South, the Brooklyn Bridge) has a `path` and is measured along its length (user decision 2026-09-26): its page
// lists the spots within half a mile of any point along it, and says so ("anywhere along it").
//
// Rows are locations, not menus: each is a real place to walk to, so a chain's two locations near one landmark are
// two rows, and "burger spots" counts them (as it does everywhere on the site). Each spot publishes one burger, its
// priciest (CLAUDE.md "One burger per restaurant"), so the copy says "their priciest burgers run from … to …", never
// "the cheapest burger near …" (user decision 2026-09-25, honest wording). Distances are as the crow flies, from
// the landmark's point (or the nearest point along its path) to the restaurant's coordinates. A priced restaurant without coordinates (a restaurant-list row
// that DOHMH doesn't match, or a DOHMH record without a location) can't be measured, so it is never on a list, and no
// line claims "all" the spots near a landmark (the count line is the plain count: DESIGN.md "No methodology copy" rules
// out a note saying why). A DOHMH record without a location gets its coordinates in pipeline/data/dohmh_overrides.json,
// and a restaurant-list row DOHMH does not match its address and point in pipeline/data/location_overrides.json.
// Pure and client-safe (the map reads landmarkBySlug and landmarkBounds).
import { BOROUGH_META } from "./boroughs";
import { formatCount, formatPrice, pluralize } from "./format";
import { LANDMARK_RADIUS_KM, LANDMARK_RADIUS_MILES, LANDMARKS, MIN_LANDMARK_SPOTS, type Landmark } from "./landmarks.mjs";
import { distanceKm, formatMiles } from "./nearby";
import type { PricedRestaurant } from "./schema";

export { LANDMARK_RADIUS_KM, LANDMARK_RADIUS_MILES, LANDMARKS, MIN_LANDMARK_SPOTS, type Landmark };

/** The hub: every landmark with a page. */
export const LANDMARKS_PATH = "/burgers-near";
/** The hub's name (its H1 without the period, its breadcrumb and its footer link). */
export const LANDMARKS_NAME = "Burgers near NYC landmarks";
/** The hub's breadcrumb on a landmark page. */
export const LANDMARKS_CRUMB = "Burgers near landmarks";
/** The kicker ticket on the hub and every landmark page (and the landmark share images' overline). */
export const LANDMARKS_TICKET = "Shore leave";
/** "half a mile": the radius in words. */
export const RADIUS_WORDS = LANDMARK_RADIUS_MILES === 0.5 ? "half a mile" : `${LANDMARK_RADIUS_MILES} miles`;
/** How long the radius takes on foot, roughly (20 minutes a mile). */
export const WALK_WORDS = `about a ${Math.round(LANDMARK_RADIUS_MILES * 20)}-minute walk`;
/** What a long place's pages add after its name: the radius runs from any point along it. */
export const ALONG_WORDS = "anywhere along it";

/** A long place, measured along its length (it has a path of at least two points). */
export function isAlong(l: Pick<Landmark, "path">): boolean {
  return (l.path?.length ?? 0) >= 2;
}

export function landmarkPath(l: Pick<Landmark, "slug">): string {
  return `${LANDMARKS_PATH}/${l.slug}`;
}

const BY_SLUG = new Map<string, Landmark>(LANDMARKS.map((l) => [l.slug, l]));

export function landmarkBySlug(slug: string): Landmark | undefined {
  return BY_SLUG.get(slug);
}

/** "Burgers near Times Square", "Burgers near the Empire State Building": the page's H1 without its period. */
export function landmarkTitle(l: Pick<Landmark, "near">): string {
  return `Burgers near ${l.near}`;
}

export type LandmarkSpot = {
  restaurant: PricedRestaurant;
  /** Kilometers from the landmark's point, as the crow flies. */
  km: number;
};

const byName = (a: PricedRestaurant, b: PricedRestaurant) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type LatLng = { lat: number | null; lng: number | null };

/**
 * Kilometers from `p` to the nearest point of a line of [lat, lng] points (as the crow flies), or null when `p` has no
 * coordinates. For each segment, the nearest point is found in a flat plane around `p` (longitude scaled by the cosine of
 * its latitude: exact enough over a few kilometers), then measured on the globe like every other distance (distanceKm).
 * One point is a point.
 */
export function distanceToPathKm(path: ReadonlyArray<readonly [number, number]>, p: LatLng): number | null {
  if (p.lat === null || p.lng === null || !path.length) return null;
  const k = Math.cos((p.lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < Math.max(1, path.length - 1); i++) {
    const [aLat, aLng] = path[i];
    const [bLat, bLng] = path[Math.min(i + 1, path.length - 1)];
    const [ax, ay] = [(aLng - p.lng) * k, aLat - p.lat];
    const [dx, dy] = [(bLng - aLng) * k, bLat - aLat];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const km = distanceKm(p, { lat: aLat + t * (bLat - aLat), lng: aLng + t * (bLng - aLng) }) as number;
    if (km < best) best = km;
  }
  return best;
}

/** How far a place is from a landmark: from its point, or from the nearest point along a long place's path. */
export function landmarkDistanceKm(l: Pick<Landmark, "lat" | "lng" | "path">, p: LatLng): number | null {
  return l.path && isAlong(l) ? distanceToPathKm(l.path, p) : distanceKm(l, p);
}

/** Every priced spot within the radius of `l` (of any point along it, for a long place), nearest first (ties by name, then id). */
export function spotsNear(l: Pick<Landmark, "lat" | "lng" | "path">, restaurants: readonly PricedRestaurant[]): LandmarkSpot[] {
  const out: LandmarkSpot[] = [];
  for (const r of restaurants) {
    const km = landmarkDistanceKm(l, r);
    if (km !== null && km <= LANDMARK_RADIUS_KM) out.push({ restaurant: r, km });
  }
  return out.sort((a, b) => a.km - b.km || byName(a.restaurant, b.restaurant));
}

export type LandmarkPage = { landmark: Landmark; spots: LandmarkSpot[] };

/**
 * The landmarks with a page, in the fixed borough order and then the order of LANDMARKS: at least
 * MIN_LANDMARK_SPOTS priced spots within the radius.
 */
export function landmarksWithPages(restaurants: readonly PricedRestaurant[]): LandmarkPage[] {
  const order = (l: Landmark) => BOROUGH_META.findIndex((b) => b.name === l.borough);
  return LANDMARKS.map((landmark) => ({ landmark, spots: spotsNear(landmark, restaurants) }))
    .filter((p) => p.spots.length >= MIN_LANDMARK_SPOTS)
    .sort((a, b) => order(a.landmark) - order(b.landmark) || LANDMARKS.indexOf(a.landmark) - LANDMARKS.indexOf(b.landmark));
}

const cents = (v: number) => Math.round(v * 100);
const money = (v: number) => formatPrice(v, { cents: "always" });

/**
 * The spots at the two ends of the price range: the lowest and the highest priciest-burger price, a tie going to
 * the nearer spot. Null for no spots.
 */
export function priceEnds(spots: readonly LandmarkSpot[]): { low: LandmarkSpot; high: LandmarkSpot } | null {
  if (!spots.length) return null;
  let low = spots[0];
  let high = spots[0];
  // `spots` is nearest first, so the first spot met on a price is the nearest one on it.
  for (const s of spots) {
    if (cents(s.restaurant.index_price) < cents(low.restaurant.index_price)) low = s;
    if (cents(s.restaurant.index_price) > cents(high.restaurant.index_price)) high = s;
  }
  return { low, high };
}

/**
 * The page's one-line answer (its lede, plain text like the ranking pages' ledes: the table links every spot):
 * "36 burger spots within half a mile of Times Square, about a 10-minute walk; their priciest burgers run from $12.65
 * at … to $34.00 at … (September 2026)." A long place: "… within half a mile of the High Line, anywhere along it, about a
 * 10-minute walk; …". Each spot's priciest burger, never "the cheapest burger near …".
 */
export function landmarkSentence(l: Pick<Landmark, "near" | "path">, spots: readonly LandmarkSpot[], month: string): string {
  const where = `within ${RADIUS_WORDS} of ${l.near}, ${isAlong(l) ? `${ALONG_WORDS}, ` : ""}${WALK_WORDS}`;
  const ends = priceEnds(spots);
  if (!ends) return `No burger spot ${where} (${month}).`;
  const [low, high] = [ends.low.restaurant, ends.high.restaurant];
  if (spots.length === 1) return `One burger spot ${where}: ${low.name}, whose priciest burger is ${money(low.index_price)} (${month}).`;
  const head = `${pluralize(spots.length, "burger spot")} ${where}; their priciest burgers `;
  if (cents(low.index_price) === cents(high.index_price)) return `${head}all cost ${money(low.index_price)} (${month}).`;
  return `${head}run from ${money(low.index_price)} at ${low.name} to ${money(high.index_price)} at ${high.name} (${month}).`;
}

/**
 * Under the table, and on the share image: "36 burger spots within half a mile, nearest first." (a long place: "… within
 * half a mile, anywhere along it, nearest first."). Never "All 36 …" or "the one …": a priced spot without coordinates
 * can't be measured (see the top of this file).
 */
export function landmarkCountLine(spots: number, along = false): string {
  const within = `within ${RADIUS_WORDS}${along ? `, ${ALONG_WORDS}` : ""}`;
  return spots === 1 ? `One burger spot ${within}.` : `${formatCount(spots)} burger spots ${within}, nearest first.`;
}

/** A hub row's sub-line: "36 burger spots · priciest burgers $12.65–$34.00". */
export function landmarkSummary(spots: readonly LandmarkSpot[]): string {
  const ends = priceEnds(spots);
  if (!ends) return "No burger spots";
  const lo = money(ends.low.restaurant.index_price);
  const hi = money(ends.high.restaurant.index_price);
  if (spots.length === 1) return `1 burger spot · priciest burger ${lo}`;
  return `${pluralize(spots.length, "burger spot")} · priciest burgers ${lo === hi ? lo : `${lo}–${hi}`}`;
}

/** The landmarks with the most spots (every one tied on the count), in page order, and that count. Null for none. */
export function mostSpots(pages: readonly LandmarkPage[]): { landmarks: Landmark[]; spots: number } | null {
  if (!pages.length) return null;
  const spots = Math.max(...pages.map((p) => p.spots.length));
  return { landmarks: pages.filter((p) => p.spots.length === spots).map((p) => p.landmark), spots };
}

/** The hub's lede: "Burger spots within half a mile of 17 New York landmarks, … (September 2026). The most are near …" */
export function landmarksHubSentence(pages: readonly LandmarkPage[], month: string): string {
  if (!pages.length) return `No landmark has burger spots within ${RADIUS_WORDS} yet (${month}).`;
  const most = mostSpots(pages) as { landmarks: Landmark[]; spots: number };
  const lead = `Burger spots within ${RADIUS_WORDS} of ${pluralize(pages.length, "New York landmark")}, ${WALK_WORDS}, with each spot's priciest burger (${month}).`;
  if (pages.length === 1) return lead;
  return `${lead} ${mostSentence(most)}`;
}

/** "The most are near Washington Square Park: 59 burger spots." (a tie: "near A and B: 12 burger spots each."). */
export function mostSentence(most: { landmarks: readonly Pick<Landmark, "near">[]; spots: number }): string {
  const names = most.landmarks.map((l) => l.near);
  const joined = names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The most are near ${joined}: ${pluralize(most.spots, "burger spot")}${names.length > 1 ? " each" : ""}.`;
}

/** How far a spot is, as the table and the share image print it: "0.3 mi" (one decimal, at least 0.1). */
export function spotDistance(s: Pick<LandmarkSpot, "km">): string {
  return formatMiles(s.km);
}

/**
 * The map's view of a landmark (/map?near=<slug>): the box around its radius, [[west, south], [east, north]], so the
 * whole half-mile circle is on screen at any size; for a long place, around every point of its path.
 */
export function landmarkBounds(l: Pick<Landmark, "lat" | "lng" | "path">, km: number = LANDMARK_RADIUS_KM): [[number, number], [number, number]] {
  const points: ReadonlyArray<readonly [number, number]> = l.path && isAlong(l) ? l.path : [[l.lat, l.lng]];
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lat, lng] of points) {
    const dLat = km / 111.2;
    const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
    [w, s, e, n] = [Math.min(w, lng - dLng), Math.min(s, lat - dLat), Math.max(e, lng + dLng), Math.max(n, lat + dLat)];
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** The map link of a landmark page: the map opened on the landmark's half-mile. */
export function landmarkMapHref(l: Pick<Landmark, "slug">): string {
  return `/map?near=${l.slug}`;
}
