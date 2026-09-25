// Boroughs in the fixed DESIGN.md order (never cycled, never re-sorted for color).
import type { Borough } from "./schema";

export type BoroughSlug = "manhattan" | "brooklyn" | "queens" | "bronx" | "staten-island";

export type BoroughMeta = { name: Borough; slug: BoroughSlug; color: string };

export const BOROUGH_META: readonly BoroughMeta[] = [
  { name: "Manhattan", slug: "manhattan", color: "var(--borough-manhattan)" },
  { name: "Brooklyn", slug: "brooklyn", color: "var(--borough-brooklyn)" },
  { name: "Queens", slug: "queens", color: "var(--borough-queens)" },
  { name: "Bronx", slug: "bronx", color: "var(--borough-bronx)" },
  { name: "Staten Island", slug: "staten-island", color: "var(--borough-staten-island)" },
];

const BY_NAME = new Map(BOROUGH_META.map((b) => [b.name, b]));
const BY_SLUG = new Map<string, BoroughMeta>(BOROUGH_META.map((b) => [b.slug, b]));

export function boroughMeta(name: Borough): BoroughMeta {
  const meta = BY_NAME.get(name);
  if (!meta) throw new Error(`unknown borough ${name}`);
  return meta;
}

export function boroughSlug(name: Borough): BoroughSlug {
  return boroughMeta(name).slug;
}

export function boroughBySlug(slug: string): BoroughMeta | undefined {
  return BY_SLUG.get(slug);
}

/** A borough name inside a sentence: "the Bronx", "Queens". Capitalize it yourself at a sentence start. */
export function boroughInProse(name: Borough): string {
  return name === "Bronx" ? "the Bronx" : name;
}

/** Neighborhoods that take "the" in a sentence ("in the East Village", "the Upper West Side"). */
const TAKES_THE = /^(East Village|West Village|Upper (East|West) Side|Lower East Side)\b/;

/** Neighborhoods New Yorkers are "on", not "in": "on the Upper East Side", "on the Lower East Side". */
const TAKES_ON = /^(Upper (East|West) Side|Lower East Side)\b/;

/** A neighborhood name inside a sentence: "the East Village", "Astoria". Capitalize it yourself at a sentence start. */
export function neighborhoodInProse(name: string): string {
  return TAKES_THE.test(name) ? `the ${name}` : name;
}

/** "in" or "on" for a neighborhood: "on the Upper West Side", but "in the East Village", "in Astoria". */
export function neighborhoodPreposition(name: string): "in" | "on" {
  return TAKES_ON.test(name) ? "on" : "in";
}

/** A neighborhood with its preposition: "on the Upper West Side", "in the West Village", "in Astoria". */
export function inNeighborhood(name: string): string {
  return `${neighborhoodPreposition(name)} ${neighborhoodInProse(name)}`;
}

/**
 * A neighborhood with its borough, for a sentence that is read on its own (a Q&A item, a meta
 * description): "Astoria, Queens", "the East Village, Manhattan", "Mott Haven, the Bronx"; a name that
 * already says its borough ("Bronx parks", "Queens Village") stands alone.
 */
export function neighborhoodPlace(name: string, borough: Borough): string {
  const prose = neighborhoodInProse(name);
  return name.includes(borough) ? prose : `${prose}, ${boroughInProse(borough)}`;
}

/** neighborhoodPlace with its preposition: "on the Upper East Side, Manhattan", "in Astoria, Queens". */
export function inNeighborhoodPlace(name: string, borough: Borough): string {
  return `${neighborhoodPreposition(name)} ${neighborhoodPlace(name, borough)}`;
}
