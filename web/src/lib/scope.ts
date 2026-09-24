// Which restaurants the index covers, where that list comes from, and how much of it is read so far.
//
// The contract carries no scope fields. The pipeline (pipeline/build.py `coverage_note`) writes the
// scope into methodology.coverage_note in one of two phrasings, and this module reads it back, so no
// page hard-codes where the restaurant list comes from:
//
//   list only (the default):
//     "658 restaurants in scope: our curated list of NYC burger restaurants, matched to NYC DOHMH
//      inspection records for address and location, except national fast-food chains (McDonald's,
//      ...). NYC's own small chains stay in. 80 of them are in this dataset; the other 578 are not
//      yet scraped. ..."
//   list plus DOHMH cuisines (`--cuisines Hamburgers`):
//     "242 restaurants in scope: our curated restaurant list plus every restaurant NYC DOHMH lists
//      under 'Hamburgers' with an inspection since 2023-01-01 (or not yet inspected), except ..."
//
// " in scope" and "the other N are not yet scraped" are left out once everything in scope is in the
// dataset; the "except national fast-food chains" clause only appears with `--national-chains
// exclude`. A note in neither phrasing (the sample fixture's) gives kind "unknown", and pages fall
// back to copy that names no source.
//
// Client-safe and pure: types only from ./schema.
import { formatCount, formatDate } from "./format";
import type { Methodology } from "./schema";

export type ScopeKind = "list" | "list+cuisines" | "unknown";

export type RestaurantScope = {
  /** "list": our curated list only; "list+cuisines": the list plus DOHMH cuisine categories; "unknown": the note says neither. */
  kind: ScopeKind;
  /** DOHMH cuisine categories added to the list ("Hamburgers"); empty unless kind is "list+cuisines". */
  cuisines: readonly string[];
  /** Inspection cutoff for the DOHMH-added restaurants (YYYY-MM-DD), when the note names one. */
  inspectedSince: string | null;
  /** Restaurants in scope: every location, a chain's included (the dataset plus those not yet scraped). */
  inScope: number;
  /** Restaurants in the dataset: looked up, priced or not. */
  lookedUp: number;
  /** In scope but not yet scraped (0 once the dataset covers the whole scope). */
  pending: number;
  /** National fast-food chains are left out (`--national-chains exclude`, the default). */
  excludesNationalChains: boolean;
  /** The note's examples of them ("McDonald's, Burger King, Wendy's, Shake Shack and the like"), or null. */
  nationalChainExamples: string | null;
};

const LIST_ONLY = /\bour curated list of NYC burger restaurants, matched to NYC DOHMH inspection records\b/i;
const WITH_CUISINES = /\bour curated restaurant list plus every restaurant NYC DOHMH lists under '([^']+)'(?: with an inspection since (\d{4}-\d{2}-\d{2}))?/i;
const NATIONAL = /\bexcept national fast-food chains\b(?: \(([^)]+)\))?/i;
const PENDING = /\bthe other ([\d,]+) (?:are|is) not yet scraped\b/i;

const toInt = (s: string) => Number.parseInt(s.replace(/,/g, ""), 10);

/**
 * The scope, read from methodology.coverage_note. `lookedUp` is the dataset's own restaurant count
 * (restaurants.length), so it always matches what the site lists; the note adds what isn't in it yet.
 */
export function restaurantScope(methodology: Pick<Methodology, "coverage_note">, lookedUp: number): RestaurantScope {
  const note = methodology.coverage_note ?? "";
  const withCuisines = WITH_CUISINES.exec(note);
  const national = NATIONAL.exec(note);
  const pendingMatch = PENDING.exec(note);
  const pending = pendingMatch ? toInt(pendingMatch[1]) : 0;
  return {
    kind: withCuisines ? "list+cuisines" : LIST_ONLY.test(note) ? "list" : "unknown",
    cuisines: withCuisines
      ? withCuisines[1]
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : [],
    inspectedSince: withCuisines?.[2] ?? null,
    inScope: lookedUp + pending,
    lookedUp,
    pending,
    excludesNationalChains: national !== null,
    nationalChainExamples: national?.[1]?.trim() || null,
  };
}

// ---- copy ------------------------------------------------------------------------------------------

/** “Hamburgers”, “Hamburgers” or “American”, “Hamburgers”, “American” or “Irish” (house style: no serial comma). */
export function cuisineNames(cuisines: readonly string[]): string {
  const quoted = cuisines.map((c) => `“${c}”`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

/**
 * A count of restaurants in scope, with where they come from: "658 New York restaurants on our list
 * of burger places", "242 New York restaurants on our list of burger places or filed under
 * “Hamburgers” by the city's health department", "52 New York restaurants". Callers put "the" or
 * "all" in front.
 */
export function scopeRestaurants(scope: RestaurantScope, n: number = scope.inScope): string {
  const noun = `${formatCount(n)} New York restaurant${n === 1 ? "" : "s"}`;
  if (scope.kind === "list") return `${noun} on our list of burger places`;
  if (scope.kind === "list+cuisines") return `${noun} on our list of burger places or filed under ${cuisineNames(scope.cuisines)} by the city's health department`;
  return noun;
}

/** Where the scope's restaurants are, after a count: "on our list" (list only), else "in scope". */
export function scopeWhere(scope: RestaurantScope): string {
  return scope.kind === "list" ? "on our list" : "in scope";
}

/**
 * One sentence on how much of the scope the dataset covers: "We have looked up 80 of the 658 New
 * York restaurants on our list of burger places." while some are not yet scraped, "We looked up all
 * 658 ..." once none are, and null for an unknown scope with nothing pending (nothing to add).
 */
export function coverageSentence(scope: RestaurantScope): string | null {
  if (scope.pending) return `We have looked up ${formatCount(scope.lookedUp)} of the ${scopeRestaurants(scope)}.`;
  if (scope.kind === "unknown") return null;
  return `We looked up ${scope.inScope === 1 ? "the" : "all"} ${scopeRestaurants(scope)}.`;
}

/**
 * How much of the scope is looked up, for one-line spots (the Letterboard, the Open Graph image):
 * "80 of 658 restaurants looked up so far". Null once the dataset covers the whole scope.
 */
export function lookedUpSoFar(scope: RestaurantScope): string | null {
  if (!scope.pending) return null;
  return `${formatCount(scope.lookedUp)} of ${formatCount(scope.inScope)} restaurants looked up so far`;
}

/**
 * Step one of "How we compute it": where the restaurant list comes from, from the data.
 */
export function scopeMethod(scope: RestaurantScope): string {
  const national = scope.excludesNationalChains ? ", leaving out national fast-food chains" : "";
  if (scope.kind === "list")
    return `List restaurants: our own list of New York burger places${national}. Each one is matched to the city health department's inspection records for its address and map location.`;
  if (scope.kind === "list+cuisines")
    return `List restaurants: our own list of New York burger places, plus every restaurant the city's health department files under ${cuisineNames(scope.cuisines)}${
      scope.inspectedSince ? ` that it has inspected since ${formatDate(scope.inspectedSince)} (or not inspected yet)` : ""
    }${national}.`;
  return `List the restaurants in scope${national}. The coverage note below says which.`;
}

/** The footer's source line for the restaurant list. */
export function scopeCredit(scope: RestaurantScope): string {
  const soFar = scope.pending ? `; ${formatCount(scope.lookedUp)} of ${formatCount(scope.inScope)} looked up so far` : "";
  if (scope.kind === "list") return `Restaurants from our own list of New York burger places, matched to city health-inspection records (NYC Open Data)${soFar}.`;
  if (scope.kind === "list+cuisines") return `Restaurants from our own list of New York burger places plus city health-inspection records (NYC Open Data)${soFar}.`;
  return "Sources for the restaurant list are on the methodology page.";
}

/**
 * The area holding more than half of `total` (restaurants looked up, or priced menus), with its
 * count; null when no area does. Copy uses it to say plainly where the data so far comes from.
 */
export function mostlyIn<T>(areas: readonly T[], count: (a: T) => number, total: number): { area: T; n: number } | null {
  let best: { area: T; n: number } | null = null;
  for (const area of areas) {
    const n = count(area);
    if (!best || n > best.n) best = { area, n };
  }
  return best && total > 0 && best.n * 2 > total ? best : null;
}
