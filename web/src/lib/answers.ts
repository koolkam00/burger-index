// Plain, answer-first sentences with live numbers (user decision 2026-09-25): the ranking pages' one-line
// answer and the short Q&A blocks on home, borough pages and priced neighborhood pages. Each answer is a
// list of segments (text, or a link's text and href), so the visible block and its FAQPage JSON-LD are
// built from the same words (segmentsText) and can never drift apart.
//
// Copy rules (DESIGN.md "Voice & Copy"): numbers, names and plain words; no method, no quality words.
// Every number is computed from the dataset at build time; pages pass the lists in. Pure, client-safe.
import { boroughInProse, neighborhoodInProse, neighborhoodPlace } from "./boroughs";
import { formatMonthYear, formatPrice, pluralize, theBurger } from "./format";
import type { Menu } from "./menus";
import { cheapestSpec, priciestSpec, rankingNameInSentence, rankingPath, type RankingSpec } from "./rankings";
import type { Borough } from "./schema";
import { versus } from "./seo";

export type Segment = string | { text: string; href: string };
export type FaqItem = { q: string; a: readonly Segment[] };

/** The answer as plain text: what the page shows, links included as their words. */
export function segmentsText(segments: readonly Segment[]): string {
  return segments.map((s) => (typeof s === "string" ? s : s.text)).join("");
}

const money = (v: number) => formatPrice(v, { cents: "always" });
const cents = (v: number) => Math.round(v * 100);
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** How a menu is placed after its restaurant's name: " in the West Village, Manhattan", " (5 locations)" or "". */
export type Where = (m: Menu) => string;

export const nowhere: Where = () => "";

/** Citywide: the neighborhood and borough, or a chain's location count. */
export const whereInCity: Where = (m) =>
  m.chain && m.locations > 1
    ? ` (${pluralize(m.locations, "location")})`
    : ` in ${[m.restaurant.neighborhood && neighborhoodInProse(m.restaurant.neighborhood), boroughInProse(m.restaurant.borough)].filter(Boolean).join(", ")}`;

/** In a borough: the neighborhood, or "(3 Brooklyn locations)". */
export const whereInBorough =
  (borough: Borough): Where =>
  (m) =>
    m.chain && m.locations > 1 ? ` (${pluralize(m.locations, `${borough} location`)})` : m.restaurant.neighborhood ? ` in ${neighborhoodInProse(m.restaurant.neighborhood)}` : "";

/** In a neighborhood: nothing, or "(2 locations here)". */
export const whereInNeighborhood: Where = (m) => (m.chain && m.locations > 1 ? ` (${pluralize(m.locations, "location")} here)` : "");

const restaurantLink = (m: Menu): Segment => ({ text: m.restaurant.name, href: `/restaurants/${m.restaurant.id}` });

/**
 * "The cheapest burger in Brooklyn is the Bacon Cheeseburger at Gil's Grill and Deli in Sunset Park,
 * $7.99 (September 2026)." `tied` holds every menu on the top price: two are named together, three or
 * more are counted and one is named.
 */
export function endSentence(kind: "cheapest" | "priciest", place: string, tied: readonly Menu[], month: string, where: Where = nowhere): Segment[] {
  if (!tied.length) return [];
  const what = kind === "cheapest" ? "cheapest" : "most expensive";
  const price = money(tied[0].indexPrice);
  const one = (m: Menu): Segment[] => [theBurger(m.restaurant.burger.name), " at ", restaurantLink(m), where(m)];
  if (tied.length === 1) return [`The ${what} burger in ${place} is `, ...one(tied[0]), `, ${price} (${month}).`];
  if (tied.length === 2) return [`The ${what} burgers in ${place} are `, ...one(tied[0]), " and ", ...one(tied[1]), `, ${price} each (${month}).`];
  return [`${tied.length} burgers tie for the ${what} in ${place} at ${price} (${month}), among them `, ...one(tied[0]), "."];
}

/** "90 different burgers in NYC cost under $15 (September 2026), from $6.00 at Johnny's Reef to $14.99 at …" */
export function underSentence(under: number, place: string, rows: readonly Menu[], month: string): Segment[] {
  const limit = formatPrice(under);
  if (!rows.length) return [`No burger in ${place} costs under ${limit} (${month}).`];
  const first = rows[0];
  if (rows.length === 1) return [`One burger in ${place} costs under ${limit} (${month}): `, theBurger(first.restaurant.burger.name), " at ", restaurantLink(first), `, ${money(first.indexPrice)}.`];
  const last = rows[rows.length - 1];
  return [
    `${pluralize(rows.length, "different burger")} in ${place} cost under ${limit} (${month}), from ${money(first.indexPrice)} at `,
    restaurantLink(first),
    ` to ${money(last.indexPrice)} at `,
    restaurantLink(last),
    ".",
  ];
}

/** The items on the lowest or highest value (to the cent) of a list. */
function extremes<T>(list: readonly T[], value: (t: T) => number, end: "min" | "max"): { items: T[]; value: number } | null {
  if (!list.length) return null;
  const pick = end === "min" ? Math.min : Math.max;
  const target = pick(...list.map((t) => cents(value(t))));
  return { items: list.filter((t) => cents(value(t)) === target), value: target / 100 };
}

/** Linked names joined in house style ("A", "A and B", "A, B and C"); the first capitalized when it opens a sentence. */
function linkedNames(areas: ReadonlyArray<{ name: string; href: string }>, opening: boolean): Segment[] {
  const out: Segment[] = [];
  areas.forEach((a, i) => {
    if (i) out.push(i === areas.length - 1 ? " and " : ", ");
    out.push({ text: i === 0 && opening ? capFirst(a.name) : a.name, href: a.href });
  });
  return out;
}

/** Cheapest and priciest are two different menus on two different prices (else the questions say nothing). */
function hasSpread(cheapest: readonly Menu[], priciest: readonly Menu[]): boolean {
  return cheapest.length > 0 && priciest.length > 0 && cents(cheapest[0].indexPrice) !== cents(priciest[0].indexPrice);
}

/** " See the cheapest burgers in Brooklyn." */
function seeRanking(spec: RankingSpec): Segment[] {
  return [" See the ", { text: rankingNameInSentence(spec), href: rankingPath(spec) }, "."];
}

type Area = { name: string; href: string; median: number };

// ---- home ----------------------------------------------------------------------------------------

export type CityFaqInput = {
  generatedAt: string;
  median: number | null;
  p10: number | null;
  p90: number | null;
  /** Every menu on the lowest / highest price citywide (topTied of the NYC rankings). */
  cheapest: readonly Menu[];
  priciest: readonly Menu[];
  /** Boroughs with a median, names in prose (boroughInProse). */
  boroughs: readonly Area[];
  /** Ranked neighborhoods (any order), names in prose (neighborhoodInProse). */
  neighborhoods: readonly Area[];
};

export function cityFaq(d: CityFaqInput): FaqItem[] {
  const month = formatMonthYear(d.generatedAt);
  const items: FaqItem[] = [];
  if (d.median === null) return items;
  const spread = d.p10 !== null && d.p90 !== null && Math.floor(d.p10) !== Math.ceil(d.p90);
  items.push({
    q: "How much does a burger cost in NYC?",
    a: [
      // The menu count stays on the board line (DESIGN.md: a page states it once).
      `The median NYC burger costs ${money(d.median)} (${month}): that is the Burger Index.`,
      spread ? ` Most cost between ${formatPrice(Math.floor(d.p10 as number))} and ${formatPrice(Math.ceil(d.p90 as number))}.` : "",
    ],
  });
  if (hasSpread(d.cheapest, d.priciest)) {
    items.push({ q: "Where is the cheapest burger in NYC?", a: [...endSentence("cheapest", "NYC", d.cheapest, month, whereInCity), ...seeRanking(cheapestSpec())] });
    items.push({ q: "What is the most expensive burger in NYC?", a: [...endSentence("priciest", "NYC", d.priciest, month, whereInCity), ...seeRanking(priciestSpec())] });
  }
  const low = extremes(d.boroughs, (b) => b.median, "min");
  const high = extremes(d.boroughs, (b) => b.median, "max");
  if (low && high && low.value !== high.value) {
    const one = low.items.length === 1;
    items.push({
      q: "Which borough has the cheapest burgers?",
      a: [
        ...linkedNames(low.items, true),
        one ? `: its median burger costs ${money(low.value)}` : ` tie: their median burger costs ${money(low.value)}`,
        ` (${month}), against ${money(d.median)} for NYC. `,
        ...linkedNames(high.items, true),
        `${high.items.length === 1 ? " is" : " are"} the priciest at ${money(high.value)}.`,
      ],
    });
  }
  const top = extremes(d.neighborhoods, (n) => n.median, "max");
  const bottom = extremes(d.neighborhoods, (n) => n.median, "min");
  if (top && bottom && top.value !== bottom.value) {
    items.push({
      q: "Which NYC neighborhood has the most expensive burgers?",
      a: [
        ...linkedNames(top.items, true),
        top.items.length === 1 ? `: its median burger costs ${money(top.value)}` : ` tie: their median burger costs ${money(top.value)}`,
        ` (${month}), the highest of the ${pluralize(d.neighborhoods.length, "ranked neighborhood")}. `,
        ...linkedNames(bottom.items, true),
        `${bottom.items.length === 1 ? " is" : " are"} the cheapest at ${money(bottom.value)}.`,
      ],
    });
  }
  return items;
}

// ---- boroughs and neighborhoods --------------------------------------------------------------------

type AreaFaqInput = {
  generatedAt: string;
  /** The place in a sentence: "Brooklyn", "the Bronx", "Astoria, Queens" (neighborhoodPlace). */
  place: string;
  median: number | null;
  cityMedian: number | null;
  menus: number;
  cheapest: readonly Menu[];
  priciest: readonly Menu[];
  where: Where;
};

/** "How much does a burger cost in X?", then where the cheapest and the most expensive are. */
function areaFaq(d: AreaFaqInput, ranking?: { cheapest: RankingSpec; priciest: RankingSpec }): FaqItem[] {
  const month = formatMonthYear(d.generatedAt);
  const items: FaqItem[] = [];
  if (d.median === null || !d.menus || !d.cheapest.length) return items;
  const vs = d.cityMedian !== null ? versus(d.median, d.cityMedian) : null;
  const only = d.cheapest[0];
  // Mid-sentence, "Astoria, Queens" closes with a comma of its own: "in Astoria, Queens, costs".
  const mid = d.place.includes(",") ? `${d.place},` : d.place;
  items.push({
    q: `How much does a burger cost in ${d.place}?`,
    a:
      d.menus > 1
        ? [`The median burger in ${mid} costs ${money(d.median)} (${month})${vs ? `, ${vs}` : ""}.`]
        : [
            `${capFirst(mid)} has one priced burger: `,
            theBurger(only.restaurant.burger.name),
            " at ",
            restaurantLink(only),
            d.where(only),
            `, ${money(only.indexPrice)} (${month})${vs ? `, ${vs}` : ""}.`,
          ],
  });
  if (d.menus > 1 && hasSpread(d.cheapest, d.priciest)) {
    items.push({
      q: `Where is the cheapest burger in ${d.place}?`,
      a: [...endSentence("cheapest", mid, d.cheapest, month, d.where), ...(ranking ? seeRanking(ranking.cheapest) : [])],
    });
    items.push({
      q: `What is the most expensive burger in ${d.place}?`,
      a: [...endSentence("priciest", mid, d.priciest, month, d.where), ...(ranking ? seeRanking(ranking.priciest) : [])],
    });
  }
  return items;
}

export type BoroughFaqInput = Omit<AreaFaqInput, "place" | "where"> & {
  borough: { name: Borough; slug: string };
  /** The borough's ranked neighborhoods, names in prose (neighborhoodInProse). */
  neighborhoods: readonly Area[];
  /** The borough's two ranking pages (rankings.ts boroughRankings). */
  ranking: { cheapest: RankingSpec; priciest: RankingSpec };
};

export function boroughFaq(d: BoroughFaqInput): FaqItem[] {
  const place = boroughInProse(d.borough.name);
  const items = areaFaq({ ...d, place, where: whereInBorough(d.borough.name) }, d.ranking);
  const low = extremes(d.neighborhoods, (n) => n.median, "min");
  const high = extremes(d.neighborhoods, (n) => n.median, "max");
  if (items.length && low && high && low.value !== high.value) {
    items.push({
      q: `Which ${d.borough.name} neighborhood has the cheapest burgers?`,
      a: [
        ...linkedNames(low.items, true),
        low.items.length === 1 ? `: its median burger costs ${money(low.value)}` : ` tie: their median burger costs ${money(low.value)}`,
        ` (${formatMonthYear(d.generatedAt)}), the lowest of the ${pluralize(d.neighborhoods.length, `ranked ${d.borough.name} neighborhood`)}. `,
        ...linkedNames(high.items, true),
        `${high.items.length === 1 ? " is" : " are"} the priciest at ${money(high.value)}.`,
      ],
    });
  }
  return items;
}

export type NeighborhoodFaqInput = Omit<AreaFaqInput, "place" | "where"> & { name: string; borough: Borough };

/** Each item names the borough too ("How much does a burger cost in Astoria, Queens?"), since it may be read on its own. */
export function neighborhoodFaq(d: NeighborhoodFaqInput): FaqItem[] {
  return areaFaq({ ...d, place: neighborhoodPlace(d.name, d.borough), where: whereInNeighborhood });
}
