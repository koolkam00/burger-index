// The dynamic ranking routes' params and specs (server-only: read from the dataset). Every list the site
// has is in rankings.ts rankingSpecs; a route builds exactly those, and any other param is a 404
// (dynamicParams = false). `output: "export"` fails on an empty generateStaticParams, so an empty set is
// one placeholder that renders the 404 (site.ts PLACEHOLDER_PARAM).
import "server-only";

import { getPricedRestaurants } from "./data";
import { rankingSpecs, type RankingSpec } from "./rankings";
import { atLeastOneParam, PLACEHOLDER_PARAM } from "./site";

type EndKind = "cheapest" | "priciest";

const SPECS = rankingSpecs(getPricedRestaurants());

/** A borough's cheapest or most expensive list (a borough with nothing priced has none). */
export function boroughRankingSpec(kind: EndKind, borough: string): RankingSpec | undefined {
  return SPECS.find((s) => s.kind === kind && !s.neighborhood && s.borough?.slug === borough);
}
export function boroughRankingParams(kind: EndKind): Array<{ borough: string }> {
  const params = SPECS.filter((s) => s.kind === kind && !s.neighborhood && s.borough).map((s) => ({ borough: s.borough!.slug }));
  return atLeastOneParam(params, { borough: PLACEHOLDER_PARAM });
}

/** A neighborhood's cheapest or most expensive list (rankings.ts neighborhoodsWithRankings). */
export function neighborhoodRankingSpec(kind: EndKind, borough: string, neighborhood: string): RankingSpec | undefined {
  return SPECS.find((s) => s.kind === kind && s.neighborhood?.slug === neighborhood && s.neighborhood.borough.slug === borough);
}
export function neighborhoodRankingParams(kind: EndKind): Array<{ borough: string; neighborhood: string }> {
  const params = SPECS.filter((s) => s.kind === kind && s.neighborhood).map((s) => ({ borough: s.neighborhood!.borough.slug, neighborhood: s.neighborhood!.slug }));
  return atLeastOneParam(params, { borough: PLACEHOLDER_PARAM, neighborhood: PLACEHOLDER_PARAM });
}

/** A neighborhood's cheapest and most expensive lists, when it has them. */
export function neighborhoodRankingPair(neighborhood: string): { cheapest: RankingSpec; priciest: RankingSpec } | null {
  const cheapest = SPECS.find((s) => s.kind === "cheapest" && s.neighborhood?.slug === neighborhood);
  const priciest = SPECS.find((s) => s.kind === "priciest" && s.neighborhood?.slug === neighborhood);
  return cheapest && priciest ? { cheapest, priciest } : null;
}

/** A burger style's list (rankings.ts stylesWithRankings). */
export function styleRankingSpec(style: string): RankingSpec | undefined {
  return SPECS.find((s) => s.kind === "style" && s.style?.slug === style);
}
export function styleRankingParams(): Array<{ style: string }> {
  const params = SPECS.filter((s) => s.kind === "style").map((s) => ({ style: s.style!.slug }));
  return atLeastOneParam(params, { style: PLACEHOLDER_PARAM });
}
