// Boroughs in the fixed DESIGN.md order (never cycled, never re-sorted for color).
import { BOROUGHS } from "./enums";
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

export function boroughIndex(name: Borough): number {
  return BOROUGHS.indexOf(name);
}

/** A borough name inside a sentence: "the Bronx", "Queens". Capitalize it yourself at a sentence start. */
export function boroughInProse(name: Borough): string {
  return name === "Bronx" ? "the Bronx" : name;
}
