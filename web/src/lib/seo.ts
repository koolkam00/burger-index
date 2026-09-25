// Search titles and meta descriptions for every page type (user decision 2026-09-25: search-style
// titles and descriptions carrying the real numbers and the month). Pure and client-safe: pages
// gather the numbers from data.ts / menus.ts and pass them in; pageMetadata (metadata.ts) adds the
// " · The Burger Index" suffix when the title leaves room.
//
// Copy rules (DESIGN.md "Voice & Copy"): numbers and plain labels, no methodology, no quality words.
// Titles aim at 60 characters or fewer, descriptions at 150–160 (DESCRIPTION_MAX is a hard cap).
import { boroughInProse, inNeighborhoodPlace, neighborhoodInProse, neighborhoodPreposition } from "./boroughs";
import { formatCount, formatMonthYear, formatPrice, pctDiff, pluralize, theBurger } from "./format";
import { rankingShortName } from "./rankings";
import type { Borough } from "./schema";

export const DESCRIPTION_MAX = 160;
/** Search results cut titles at about 60 characters. */
export const TITLE_MAX = 60;

export type Seo = { title: string; description: string };

/** A named price: the cheapest or priciest menu of a slice, or a restaurant's burger. */
export type NamedPrice = { name: string; price: number };

const money = (v: number) => formatPrice(v, { cents: "always" });
const short = (v: number) => formatPrice(v);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The first title that fits in TITLE_MAX characters, else the last (the shortest form). */
export function pickTitle(candidates: ReadonlyArray<string | null | false | undefined>): string {
  const list = candidates.filter((c): c is string => Boolean(c));
  return list.find((c) => c.length <= TITLE_MAX) ?? list[list.length - 1];
}

/** Cut `text` to at most `max` characters at a word boundary, ending in "…". */
export function truncate(text: string, max: number = DESCRIPTION_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.(–-]+$/, "")}…`;
}

/** A sentence, or alternatives for one slot (the first that fits is used). */
export type Choice = string | readonly string[];
/** An optional sentence; `{ text, rank }` tries it before (lower rank) or after (higher) its position. */
export type Sentence = Choice | null | false | undefined | { text: Choice | null | false | undefined; rank: number };

/**
 * A description built from sentences: `lead` always (truncated if it alone is too long), then each
 * optional sentence, in priority order (its position unless ranked), while the whole stays within
 * `max`; for a slot with alternatives, the first that fits. Sentences keep their written order.
 */
export function assemble(lead: string, optional: readonly Sentence[], max: number = DESCRIPTION_MAX): string {
  const slots = optional
    .map((s, i) => {
      const ranked = s !== null && typeof s === "object" && !Array.isArray(s) ? (s as { text: Choice | null | false | undefined; rank: number }) : null;
      const text = ranked ? ranked.text : (s as Choice | null | false | undefined);
      const alternatives = !text ? [] : typeof text === "string" ? [text] : [...text];
      return { alternatives, rank: ranked ? ranked.rank : i, i };
    })
    .filter((s) => s.alternatives.length);
  const chosen = new Map<number, string>();
  let length = lead.length;
  for (const s of [...slots].sort((a, b) => a.rank - b.rank || a.i - b.i)) {
    const fit = s.alternatives.find((t) => length + 1 + t.length <= max);
    if (fit !== undefined) {
      chosen.set(s.i, fit);
      length += 1 + fit.length;
    }
  }
  return truncate([lead, ...slots.filter((s) => chosen.has(s.i)).map((s) => chosen.get(s.i) as string)].join(" "), max);
}

/**
 * "12% below the $20.00 NYC median", "8% above the …", "right at the …" (the page's "vs NYC" in
 * words; |Δ| under 0.5% is "at", as formatDelta has it). Null without a median.
 */
export function versus(price: number, median: number | null, label = "NYC median"): string | null {
  if (median === null || median === 0) return null;
  const pct = pctDiff(price, median);
  const what = `the ${money(median)} ${label}`;
  if (Math.abs(pct) < 0.5) return `right at ${what}`;
  return `${Math.round(Math.abs(pct))}% ${pct > 0 ? "above" : "below"} ${what}`;
}

/** "From $9.50 at Joe's to $38.00 at Minetta Tavern." (null when both ends are the same menu or price). */
function span(cheapest: NamedPrice | null, priciest: NamedPrice | null): string | null {
  if (!cheapest || !priciest || Math.round(cheapest.price * 100) === Math.round(priciest.price * 100)) return null;
  return `From ${money(cheapest.price)} at ${cheapest.name} to ${money(priciest.price)} at ${priciest.name}.`;
}

const updated = (generatedAt: string) => `Updated ${formatMonthYear(generatedAt)}.`;

/**
 * The one plain source/date line (user decision 2026-09-25), month from generated_at. True for every
 * price source: restaurant sites, menu PDFs and aggregators are menus; online ordering and delivery
 * apps are ordering pages. The only sourcing sentence the site carries; never extend it into method.
 */
export function sourceLine(generatedAt: string): string {
  return `Prices from restaurant menus and ordering pages, checked ${formatMonthYear(generatedAt)}.`;
}

// ---- top-level pages ---------------------------------------------------------------------------

export function homeSeo(d: { median: number | null; menus: number; generatedAt: string; cheapest: NamedPrice | null; priciest: NamedPrice | null }): Seo {
  if (d.median === null) {
    return { title: "The Burger Index: what a burger costs in New York", description: "What a burger costs in New York: burger prices by borough, neighborhood and restaurant." };
  }
  return {
    title: `The Burger Index: NYC burger prices, ${short(d.median)} median (${formatMonthYear(d.generatedAt, { short: true })})`,
    description: assemble(`What a burger costs in New York: the NYC Burger Index is ${money(d.median)} across ${pluralize(d.menus, "menu")}, updated ${formatMonthYear(d.generatedAt)}.`, [
      span(d.cheapest, d.priciest),
      "By borough, neighborhood and restaurant.",
    ]),
  };
}

export function burgersSeo(d: { count: number; generatedAt: string; cheapest: NamedPrice | null; priciest: NamedPrice | null }): Seo {
  if (!d.count || !d.cheapest || !d.priciest) return { title: "Every burger", description: "Search every New York burger we priced by name, restaurant or neighborhood." };
  return {
    title: `${formatCount(d.count)} NYC burgers by price, ${short(d.cheapest.price)} to ${short(d.priciest.price)}`,
    description: assemble(`Search ${pluralize(d.count, "New York burger")} by name, restaurant or neighborhood.`, [
      span(d.cheapest, d.priciest),
      updated(d.generatedAt),
    ]),
  };
}

export function mapSeo(d: { pins: number; median: number | null; generatedAt: string }): Seo {
  if (!d.pins) return { title: "Burger price map", description: "New York burger restaurants and their prices on a map." };
  return {
    title: `NYC burger price map: ${pluralize(d.pins, "restaurant")}`,
    description: assemble(`${pluralize(d.pins, "New York burger restaurant")} on a map, one pin each, colored by price.`, [
      d.median !== null ? `Colors against the ${money(d.median)} NYC median.` : null,
      "Tap a pin for the burger and its price.",
      updated(d.generatedAt),
    ]),
  };
}

export function neighborhoodsSeo(d: {
  pages: number;
  ranked: number;
  top: NamedPrice | null;
  bottom: NamedPrice | null;
  generatedAt: string;
}): Seo {
  const title = d.pages ? `Burger prices in ${formatCount(d.pages)} NYC neighborhoods` : "Neighborhoods";
  const ends =
    d.top && d.bottom
      ? `${d.top.name} is the priciest at ${money(d.top.price)}, ${d.bottom.name} the cheapest at ${money(d.bottom.price)}.`
      : null;
  const lead =
    d.ranked > 1 ? `${pluralize(d.ranked, "New York neighborhood")} ranked by median burger price.` : `New York neighborhoods and what a burger costs in each.`;
  return { title, description: assemble(lead, [ends, "The median, cheapest and priciest in each.", updated(d.generatedAt)]) };
}

export function peoplesPriceSeo(d: { menus: number; median: number | null }): Seo {
  return {
    title: "The People's Price: what visitors would pay for NYC burgers",
    description: assemble(`What visitors would pay for ${pluralize(d.menus, "New York burger")}, next to what the menus charge.`, [
      d.median !== null ? `The Burger Index: ${money(d.median)}.` : null,
      "Biggest bargains, most overpriced and most answered.",
      "Name your price for any burger.",
    ]),
  };
}

// ---- areas ---------------------------------------------------------------------------------------

export function boroughSeo(d: {
  borough: Borough;
  median: number | null;
  menus: number;
  cityMedian: number | null;
  cheapest: NamedPrice | null;
  priciest: NamedPrice | null;
  generatedAt: string;
}): Seo {
  const where = boroughInProse(d.borough);
  if (d.median === null || !d.menus) {
    return { title: `Burger prices in ${where}`, description: `Burger prices in ${where}, New York City. No priced restaurants there yet.` };
  }
  const vs = versus(d.median, d.cityMedian);
  return {
    title: `Burger prices in ${where}: ${short(d.median)} median`,
    description: assemble(`What a burger costs in ${where}: ${money(d.median)}, the median across ${pluralize(d.menus, "menu")}.`, [
      vs ? `${cap(vs)}.` : null,
      span(d.cheapest, d.priciest),
      updated(d.generatedAt),
    ]),
  };
}

export function neighborhoodSeo(d: {
  name: string;
  /** Another neighborhood has the same name: the title adds the borough. */
  ambiguous: boolean;
  borough: Borough;
  median: number;
  menus: number;
  cityMedian: number | null;
  cheapest: NamedPrice | null;
  priciest: NamedPrice | null;
  /** The one burger when exactly one menu is priced here. */
  only: { restaurant: string; burger: string } | null;
  generatedAt: string;
}): Seo {
  const place = d.ambiguous ? `${d.name}, ${d.borough}` : d.name;
  // "in the East Village", "on the Upper West Side" (boroughs.ts); the "X burgers" forms use the bare name.
  const inPlace = `${neighborhoodPreposition(d.name)} ${d.ambiguous ? `${neighborhoodInProse(d.name)}, ${d.borough}` : neighborhoodInProse(d.name)}`;
  const where = inNeighborhoodPlace(d.name, d.borough);
  const m = short(d.median);
  const vs = versus(d.median, d.cityMedian);
  // Long neighborhood names ("Breezy Point-Belle Harbor-Rockaway Park-Broad Channel") take the shorter forms.
  const titles = (median: boolean) =>
    pickTitle([
      median && `Burger prices ${inPlace}: ${m} median`,
      `Burger prices ${inPlace}: ${m}`,
      median && `${place} burgers: ${m} median`,
      `${place} burgers: ${m}`,
    ]);
  if (d.menus <= 1 && d.only) {
    return {
      title: titles(false),
      description: assemble(`What a burger costs ${where}: ${d.only.burger} at ${d.only.restaurant}, ${money(d.median)}.`, [
        vs ? `${cap(vs)}.` : null,
        updated(d.generatedAt),
      ]),
    };
  }
  return {
    title: titles(true),
    description: assemble(`What a burger costs ${where}: ${money(d.median)}, the median across ${pluralize(d.menus, "menu")}.`, [
      vs ? `${cap(vs)}.` : null,
      span(d.cheapest, d.priciest),
      updated(d.generatedAt),
    ]),
  };
}

// ---- ranking pages -------------------------------------------------------------------------------

export type RankingSeoInput = {
  kind: "cheapest" | "priciest" | "under";
  /**
   * The page's name (rankings.ts rankingName): "Cheapest burger spots in NYC", "Most expensive burgers
   * in the Bronx", "Burger spots in NYC where the priciest burger is under $15".
   */
  name: string;
  /** "NYC", "Brooklyn", "the Bronx". */
  place: string;
  /** "under" only: the price the spots' priciest burgers stay under. */
  under: number | null;
  /** The rows the page shows, in order. */
  rows: ReadonlyArray<{ restaurant: string; burger: string; price: number }>;
  /** Distinct menus the list covers before the cap (a chain once): "Out of 531 menus". */
  total: number;
  /** Priced locations those menus cover (a chain's every location): the under-$N lists' "96 burger spots". */
  spots: number;
  generatedAt: string;
};

/**
 * "Cheapest burger spots in NYC: from $6 (Sep 2026)", "Most expensive burgers in Brooklyn: up to $34
 * (Sep 2026)", "96 NYC burger spots, priciest burger under $15 (Sep 2026)". Each spot publishes its
 * priciest burger, so the cheapest and under-$N lists rank spots by it and say so, and never claim "the
 * cheapest burgers" or "burgers under $15" (user decision 2026-09-25). Each number matches its noun:
 * "burger spots" counts locations, "menus" distinct menus (a chain once). The description names the first rows.
 */
export function rankingSeo(d: RankingSeoInput): Seo {
  const mon = formatMonthYear(d.generatedAt, { short: true });
  const month = formatMonthYear(d.generatedAt);
  const [first, second, third] = d.rows;
  if (!first) return { title: d.name, description: `${d.name}: no priced burgers yet.` };
  const menus = pluralize(d.total, "menu");
  if (d.kind === "under") {
    const spots = pluralize(d.spots, "burger spot");
    const last = d.rows[d.rows.length - 1];
    const limit = short(d.under as number);
    return {
      title: pickTitle([
        `${pluralize(d.spots, `${d.place} burger spot`)}, priciest burger under ${limit} (${mon})`,
        `${spots} in ${d.place} where the priciest burger is under ${limit}`,
        `${spots} in ${d.place} with a priciest burger under ${limit}`,
        d.name,
      ]),
      description: assemble(`${spots} in ${d.place} where the priciest burger is under ${limit}, cheapest first (${month}).`, [
        d.rows.length > 1 ? `From ${money(first.price)} at ${first.restaurant} to ${money(last.price)} at ${last.restaurant}.` : `${first.restaurant}, at ${money(first.price)}.`,
        "With each restaurant's neighborhood and price.",
      ]),
    };
  }
  const cheapest = d.kind === "cheapest";
  const edge = cheapest ? `from ${short(first.price)}` : `up to ${short(first.price)}`;
  const then = [
    second && third ? `Then ${second.restaurant} at ${money(second.price)} and ${third.restaurant} at ${money(third.price)}.` : null,
    second ? `Then ${second.restaurant} at ${money(second.price)}.` : null,
  ].filter((s): s is string => Boolean(s));
  // A long place ("Staten Island") keeps the month with the shorter "Cheapest burger spots, Staten Island".
  const shortName = rankingShortName({ kind: d.kind, borough: null, under: d.under });
  return {
    title: pickTitle([`${d.name}: ${edge} (${mon})`, `${shortName}, ${d.place}: ${edge} (${mon})`, `${d.name}: ${edge}`, d.name]),
    description: assemble(
      cheapest
        ? `${d.name}: the ${pluralize(d.rows.length, "menu")} with the lowest top-burger price (${month}).`
        : `The ${pluralize(d.rows.length, "most expensive burger")} in ${d.place}, ranked by price (${month}).`,
      [
        cheapest ? `${first.restaurant} tops the list at ${money(first.price)}.` : `${cap(theBurger(first.burger))} at ${first.restaurant} tops the list at ${money(first.price)}.`,
        then.length ? then : null,
        d.total > d.rows.length ? `Out of ${menus} in ${d.place}.` : null,
      ],
    ),
  };
}

// ---- restaurants ---------------------------------------------------------------------------------

export type RestaurantSeoInput = {
  name: string;
  address: string | null;
  neighborhood: string | null;
  borough: Borough;
  burger: string;
  price: number;
  cityMedian: number | null;
  /** The neighborhood median when the neighborhood has another priced menu (the page's "vs West Village"). */
  hoodMedian: number | null;
  /** The source badge label ("Restaurant site", "Delivery app", …). */
  source: string;
  generatedAt: string;
  /** Another priced restaurant would get the same title: name the street address instead of the neighborhood. */
  ambiguous: boolean;
};

/**
 * "Allswell: $22 burger in Williamsburg"; a neighborhood too long for the title gives way to the
 * borough ("… burger in Staten Island"), then to nothing. A title another page would share names the
 * street address instead ("7th Street Burger: $12.50 burger at 91 E 7th St").
 */
export function restaurantTitle(r: Pick<RestaurantSeoInput, "name" | "address" | "neighborhood" | "borough" | "price" | "ambiguous">): string {
  const head = `${r.name}: ${short(r.price)} burger`;
  if (r.ambiguous && r.address) return `${head} at ${r.address}`;
  return pickTitle([r.neighborhood && `${head} in ${r.neighborhood}`, `${head} in ${boroughInProse(r.borough)}`, head]);
}

type TitleFields = Pick<RestaurantSeoInput, "name" | "address" | "neighborhood" | "borough" | "price">;

/**
 * The ids whose title another restaurant in `list` would share (chain locations in one neighborhood,
 * or whose long neighborhood names both fall back to the borough): their pages name the address.
 */
export function sharedTitleIds(list: ReadonlyArray<TitleFields & { id: string }>): Set<string> {
  const byTitle = new Map<string, string[]>();
  for (const r of list) {
    const t = restaurantTitle({ ...r, ambiguous: false });
    byTitle.set(t, [...(byTitle.get(t) ?? []), r.id]);
  }
  return new Set([...byTitle.values()].filter((ids) => ids.length > 1).flat());
}

export function restaurantSeo(r: RestaurantSeoInput): Seo {
  const place = [r.neighborhood, r.borough].filter(Boolean).join(", ");
  const full = [r.address, place].filter(Boolean).join(", ");
  const lead = (where: string) => `${r.burger} at ${r.name}, ${where}: ${money(r.price)}.`;
  const first = lead(full).length <= DESCRIPTION_MAX - 40 ? lead(full) : lead(place);
  const vsCity = versus(r.price, r.cityMedian);
  const vsHood = r.neighborhood && r.hoodMedian !== null ? versus(r.price, r.hoodMedian, `${r.neighborhood} median`) : null;
  return {
    title: restaurantTitle(r),
    // Priority: vs NYC, then the source and month (or the month alone), then vs the neighborhood;
    // read in that order.
    description: assemble(first, [
      { text: vsCity ? `${cap(vsCity)}.` : null, rank: 0 },
      { text: vsHood ? `${cap(vsHood)}.` : null, rank: 2 },
      { text: [`Source: ${r.source}, ${formatMonthYear(r.generatedAt)}.`, updated(r.generatedAt), `${formatMonthYear(r.generatedAt)}.`], rank: 1 },
    ]),
  };
}
