// Plain, answer-first sentences with live numbers (user decision 2026-09-25): the ranking pages' one-line
// answer and the short Q&A blocks on home, borough pages and priced neighborhood pages. Each answer is a
// list of segments (text, or a link's text and href), so the visible block and its FAQPage JSON-LD are
// built from the same words (segmentsText) and can never drift apart.
//
// Copy rules (DESIGN.md "Voice & Copy"): numbers, names and plain words; no method, no quality words.
// Each spot publishes one burger, its priciest, so "cheapest" answers name the spot with the lowest
// top-burger price and never "the cheapest burger" (user decision 2026-09-25). Every number is computed
// from the dataset at build time; pages pass the lists in. Pure, client-safe.
import { boroughInProse, inNeighborhood, inNeighborhoodPlace, neighborhoodPlace } from "./boroughs";
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
/** A place with more sentence after it: "in Astoria, Queens" closes with a comma of its own ("in Astoria, Queens, costs"). */
const midClause = (s: string) => (s.includes(",") ? `${s},` : s);

/** How a menu is placed after its restaurant's name: " in the West Village, Manhattan", " on the Upper West Side", " (5 locations)" or "". */
export type Where = (m: Menu) => string;

export const nowhere: Where = () => "";

/** Citywide: the neighborhood and borough, or a chain's location count. */
export const whereInCity: Where = (m) =>
  m.chain && m.locations > 1
    ? ` (${pluralize(m.locations, "location")})`
    : m.restaurant.neighborhood
      ? ` ${inNeighborhoodPlace(m.restaurant.neighborhood, m.restaurant.borough)}`
      : ` in ${boroughInProse(m.restaurant.borough)}`;

/** In a borough: the neighborhood, or "(3 Brooklyn locations)". */
export const whereInBorough =
  (borough: Borough): Where =>
  (m) =>
    m.chain && m.locations > 1 ? ` (${pluralize(m.locations, `${borough} location`)})` : m.restaurant.neighborhood ? ` ${inNeighborhood(m.restaurant.neighborhood)}` : "";

/** In a neighborhood: nothing, or "(2 locations here)". */
export const whereInNeighborhood: Where = (m) => (m.chain && m.locations > 1 ? ` (${pluralize(m.locations, "location")} here)` : "");

const restaurantLink = (m: Menu): Segment => ({ text: m.restaurant.name, href: `/restaurants/${m.restaurant.id}` });
/** The burger spots (priced locations) a list of menus covers: a chain counts each location. "Spots" always counts these, never menus. */
const spotCount = (menus: readonly Menu[]) => menus.reduce((n, m) => n + m.locations, 0);

/**
 * One end of a place's list, answer first. `inPlace` is the place with its preposition ("in NYC",
 * "in the Bronx", "on the Upper West Side, Manhattan"). `tied` holds every menu on the end price: two
 * are named together, three or more are counted and one is named.
 *
 * Priciest: "The most expensive burger in Brooklyn is the Double at Emily, $34.00 (September 2026)."
 * Cheapest names the spot, since each spot publishes its priciest burger: "The priciest burger at
 * Johnny's Reef is $6.00, the lowest top-burger price of any spot in NYC (September 2026)."
 */
export function endSentence(kind: "cheapest" | "priciest", inPlace: string, tied: readonly Menu[], month: string, where: Where = nowhere): Segment[] {
  if (!tied.length) return [];
  const price = money(tied[0].indexPrice);
  if (kind === "priciest") {
    const one = (m: Menu): Segment[] => [theBurger(m.restaurant.burger.name), " at ", restaurantLink(m), where(m)];
    if (tied.length === 1) return [`The most expensive burger ${midClause(inPlace)} is `, ...one(tied[0]), `, ${price} (${month}).`];
    if (tied.length === 2) return [`The most expensive burgers ${midClause(inPlace)} are `, ...one(tied[0]), " and ", ...one(tied[1]), `, ${price} each (${month}).`];
    return [`${tied.length} burgers tie for the most expensive ${midClause(inPlace)} at ${price} (${month}), among them `, ...one(tied[0]), "."];
  }
  const lowest = `the lowest top-burger price of any spot ${inPlace} (${month})`;
  // A place that ends in its own comma ("in City Island, the Bronx") closes with one before the verb.
  const spot = (m: Menu): Segment[] => [restaurantLink(m), midClause(where(m))];
  if (tied.length === 1) return ["The priciest burger at ", ...spot(tied[0]), ` is ${price}, ${lowest}.`];
  if (tied.length === 2) return ["The priciest burgers at ", restaurantLink(tied[0]), where(tied[0]), " and ", ...spot(tied[1]), ` are ${price} each, ${lowest}.`];
  return [`${spotCount(tied)} spots tie for the lowest top-burger price ${midClause(inPlace)} at ${price} (${month}), among them `, restaurantLink(tied[0]), where(tied[0]), "."];
}

/**
 * "At 96 burger spots in NYC, the priciest burger is under $15 (September 2026), from $6.00 at Johnny's
 * Reef to $14.99 at …" (`inPlace` as in endSentence). The count is of spots (a chain's 5 locations are
 * 5 spots, as on /burgers), though the rows are menus.
 */
export function underSentence(under: number, inPlace: string, rows: readonly Menu[], month: string): Segment[] {
  const limit = formatPrice(under);
  if (!rows.length) return [`No burger spot ${inPlace} has a priciest burger under ${limit} (${month}).`];
  const first = rows[0];
  const spots = spotCount(rows);
  if (rows.length === 1) {
    return spots === 1
      ? [`One burger spot ${inPlace} has a priciest burger under ${limit} (${month}): `, restaurantLink(first), `, at ${money(first.indexPrice)}.`]
      : [`${spots} burger spots ${inPlace} have a priciest burger under ${limit} (${month}): the ${spots} locations of `, restaurantLink(first), `, at ${money(first.indexPrice)}.`];
  }
  const last = rows[rows.length - 1];
  return [
    `At ${pluralize(spots, "burger spot")} ${inPlace}, the priciest burger is under ${limit} (${month}), from ${money(first.indexPrice)} at `,
    restaurantLink(first),
    ` to ${money(last.indexPrice)} at `,
    restaurantLink(last),
    ".",
  ];
}

/**
 * "At 45 burger spots in NYC, the priciest burger is a smash burger (September 2026), from $9.00 at … to
 * $31.00 at …" (`aBurger` from lib/styles.ts). Like underSentence, the count is of spots (locations).
 */
export function styleSentence(aBurger: string, inPlace: string, rows: readonly Menu[], month: string): Segment[] {
  if (!rows.length) return [`No burger spot ${inPlace} has ${aBurger} as its priciest burger (${month}).`];
  const first = rows[0];
  const spots = spotCount(rows);
  if (rows.length === 1) {
    return spots === 1
      ? [`One burger spot ${inPlace} has ${aBurger} as its priciest burger (${month}): `, restaurantLink(first), `, at ${money(first.indexPrice)}.`]
      : [`${spots} burger spots ${inPlace} have ${aBurger} as their priciest burger (${month}): the ${spots} locations of `, restaurantLink(first), `, at ${money(first.indexPrice)}.`];
  }
  const last = rows[rows.length - 1];
  return [
    `At ${pluralize(spots, "burger spot")} ${inPlace}, the priciest burger is ${aBurger} (${month}), from ${money(first.indexPrice)} at `,
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

/** " See the cheapest burger spots in Brooklyn." */
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

/**
 * "The median NYC burger costs $21.95 (September 2026)": the home page's plain answer, under its H1
 * (the board with the same number hangs below the pricer, so the sentence keeps the answer at the top
 * of the page's static HTML) and opening the first home Q&A answer.
 */
export function medianClause(median: number, generatedAt: string): string {
  return `The median NYC burger costs ${money(median)} (${formatMonthYear(generatedAt)})`;
}

export function cityFaq(d: CityFaqInput): FaqItem[] {
  const month = formatMonthYear(d.generatedAt);
  const items: FaqItem[] = [];
  if (d.median === null) return items;
  const spread = d.p10 !== null && d.p90 !== null && Math.floor(d.p10) !== Math.ceil(d.p90);
  items.push({
    q: "How much does a burger cost in NYC?",
    a: [
      // The menu count stays on the board line (DESIGN.md: a page states it once).
      `${medianClause(d.median, d.generatedAt)}: that is the Burger Index.`,
      spread ? ` Most cost between ${formatPrice(Math.floor(d.p10 as number))} and ${formatPrice(Math.ceil(d.p90 as number))}.` : "",
    ],
  });
  if (hasSpread(d.cheapest, d.priciest)) {
    items.push({ q: "Where are burgers cheapest in NYC?", a: [...endSentence("cheapest", "in NYC", d.cheapest, month, whereInCity), ...seeRanking(cheapestSpec())] });
    items.push({ q: "What is the most expensive burger in NYC?", a: [...endSentence("priciest", "in NYC", d.priciest, month, whereInCity), ...seeRanking(priciestSpec())] });
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
  /** The place with its preposition: "in Brooklyn", "in Astoria, Queens", "on the Upper West Side, Manhattan". */
  inPlace: string;
  median: number | null;
  cityMedian: number | null;
  menus: number;
  cheapest: readonly Menu[];
  priciest: readonly Menu[];
  where: Where;
};

/** "How much does a burger cost in X?", then where burgers are cheapest and the most expensive one. */
function areaFaq(d: AreaFaqInput, ranking?: { cheapest: RankingSpec; priciest: RankingSpec }): FaqItem[] {
  const month = formatMonthYear(d.generatedAt);
  const items: FaqItem[] = [];
  if (d.median === null || !d.menus || !d.cheapest.length) return items;
  const vs = d.cityMedian !== null ? versus(d.median, d.cityMedian) : null;
  const only = d.cheapest[0];
  items.push({
    q: `How much does a burger cost ${d.inPlace}?`,
    a:
      d.menus > 1
        ? [`The median burger ${midClause(d.inPlace)} costs ${money(d.median)} (${month})${vs ? `, ${vs}` : ""}.`]
        : [
            `${capFirst(midClause(d.place))} has one priced burger: `,
            theBurger(only.restaurant.burger.name),
            " at ",
            restaurantLink(only),
            d.where(only),
            `, ${money(only.indexPrice)} (${month})${vs ? `, ${vs}` : ""}.`,
          ],
  });
  if (d.menus > 1 && hasSpread(d.cheapest, d.priciest)) {
    items.push({
      q: `Where are burgers cheapest ${d.inPlace}?`,
      a: [...endSentence("cheapest", d.inPlace, d.cheapest, month, d.where), ...(ranking ? seeRanking(ranking.cheapest) : [])],
    });
    items.push({
      q: `What is the most expensive burger ${d.inPlace}?`,
      a: [...endSentence("priciest", d.inPlace, d.priciest, month, d.where), ...(ranking ? seeRanking(ranking.priciest) : [])],
    });
  }
  return items;
}

export type BoroughFaqInput = Omit<AreaFaqInput, "place" | "inPlace" | "where"> & {
  borough: { name: Borough; slug: string };
  /** The borough's ranked neighborhoods, names in prose (neighborhoodInProse). */
  neighborhoods: readonly Area[];
  /** The borough's two ranking pages (rankings.ts boroughRankings). */
  ranking: { cheapest: RankingSpec; priciest: RankingSpec };
};

export function boroughFaq(d: BoroughFaqInput): FaqItem[] {
  const place = boroughInProse(d.borough.name);
  const items = areaFaq({ ...d, place, inPlace: `in ${place}`, where: whereInBorough(d.borough.name) }, d.ranking);
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

export type NeighborhoodFaqInput = Omit<AreaFaqInput, "place" | "inPlace" | "where"> & {
  name: string;
  borough: Borough;
  /** The neighborhood's two ranking pages, when it has them (rankings.ts neighborhoodRankings). */
  ranking?: { cheapest: RankingSpec; priciest: RankingSpec };
};

/**
 * Each item names the borough too ("How much does a burger cost in Astoria, Queens?"), since it may be
 * read on its own; New Yorkers are "on" the Upper East and West Sides and the Lower East Side. A
 * neighborhood with ranking pages points to them ("See the cheapest burger spots in the West Village.").
 */
export function neighborhoodFaq(d: NeighborhoodFaqInput): FaqItem[] {
  return areaFaq({ ...d, place: neighborhoodPlace(d.name, d.borough), inPlace: inNeighborhoodPlace(d.name, d.borough), where: whereInNeighborhood }, d.ranking);
}
