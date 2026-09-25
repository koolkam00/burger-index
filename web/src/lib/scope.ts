// Which restaurants the index covers, where that list comes from, and how much of it is read so far.
//
// The contract carries no scope fields. The pipeline (pipeline/build.py `coverage_note`) writes the
// scope into methodology.coverage_note in one of two phrasings, and this module reads it back, so no
// page hard-codes how many restaurants are in scope or how many are not yet read:
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
// dataset; the "except national ... chains" clause only appears with `--national-chains exclude`.
// Only the parts the patterns below name are load-bearing: how the list is matched to DOHMH ("matched
// to ... for address and location") and what kind of national chains are left out ("fast-food",
// "fast-food and casual-dining") can be reworded without changing the scope. A note in neither
// phrasing (the sample fixture's) gives kind "unknown".
//
// The site shows none of this as copy (DESIGN.md "No methodology copy"): only the home page reads
// `pending` and `lookedUp`, for the plain-count "Looked up so far" tile while part of the list is unread.
//
// Client-safe and pure: types only from ./schema.
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
  /** National chains (fast-food and casual-dining brands) are left out (`--national-chains exclude`, the default). */
  excludesNationalChains: boolean;
  /** The note's examples of them ("McDonald's, Burger King, Wendy's, Shake Shack and the like"), or null. */
  nationalChainExamples: string | null;
};

const LIST_ONLY = /\bour curated list of NYC burger restaurants\b/i;
const WITH_CUISINES = /\bour curated restaurant list plus every restaurant NYC DOHMH lists under '([^']+)'(?: with an inspection since (\d{4}-\d{2}-\d{2}))?/i;
// "except national fast-food chains (…)", "except national fast-food and casual-dining chains (…)", "except national chains (…)".
const NATIONAL = /\bexcept national (?:[a-z-]+ (?:and [a-z-]+ )?)?chains\b(?: \(([^)]+)\))?/i;
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
