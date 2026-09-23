// Client-safe types and pure helpers for the /burgers explorer. The server builds a compact
// payload (short keys, restaurants referenced by index) so thousands of rows stay light.
import type { BoroughSlug } from "./boroughs";
import { BOROUGH_META } from "./boroughs";
import { PRICE_SOURCES, PROTEINS, type Borough, type PriceSource, type Protein } from "./schema";

export type ExRestaurant = {
  /** restaurant id (URL slug) */
  id: string;
  name: string;
  nb: string | null;
  nbSlug: string | null;
  borough: Borough;
  source: PriceSource | null;
};

export type ExBurger = {
  /** index into ExplorerData.restaurants */
  r: number;
  /** full burger id */
  id: string;
  name: string;
  price: number | null;
  protein: Protein;
  idx: boolean;
};

export type ExNeighborhood = { slug: string; name: string; borough: Borough };

export type ExplorerData = {
  median: number | null;
  restaurants: ExRestaurant[];
  burgers: ExBurger[];
  neighborhoods: ExNeighborhood[];
  /** Price sources present in the data ("unknown" = null source). */
  sources: Array<PriceSource | "unknown">;
  proteins: Protein[];
};

export type SortKey = "price" | "-price" | "name" | "restaurant";
export const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "price", label: "Price: low to high" },
  { key: "-price", label: "Price: high to low" },
  { key: "name", label: "Burger name" },
  { key: "restaurant", label: "Restaurant" },
];

export type SourceKey = PriceSource | "unknown";

export type Filters = {
  q: string;
  boroughs: BoroughSlug[];
  neighborhood: string;
  proteins: Protein[];
  sources: SourceKey[];
  min: number | null;
  max: number | null;
  indexOnly: boolean;
  sort: SortKey;
};

export const EMPTY_FILTERS: Filters = {
  q: "",
  boroughs: [],
  neighborhood: "",
  proteins: [],
  sources: [],
  min: null,
  max: null,
  indexOnly: false,
  sort: "price",
};

const BOROUGH_SLUGS = new Set<string>(BOROUGH_META.map((b) => b.slug));
const PROTEIN_SET = new Set<string>(PROTEINS);
const SOURCE_SET = new Set<string>([...PRICE_SOURCES, "unknown"]);
const SORT_SET = new Set<string>(["price", "-price", "name", "restaurant"]);

function list(v: string | null): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** URL → filters. Unknown values are dropped, so a hand-edited URL can't break the page. */
export function parseFilters(sp: { get(name: string): string | null }): Filters {
  return {
    q: (sp.get("q") ?? "").slice(0, 120),
    boroughs: list(sp.get("borough")).filter((s): s is BoroughSlug => BOROUGH_SLUGS.has(s)),
    neighborhood: sp.get("neighborhood") ?? "",
    proteins: list(sp.get("protein")).filter((s): s is Protein => PROTEIN_SET.has(s)),
    sources: list(sp.get("source")).filter((s): s is SourceKey => SOURCE_SET.has(s)),
    min: num(sp.get("min")),
    max: num(sp.get("max")),
    indexOnly: sp.get("index") === "1",
    sort: SORT_SET.has(sp.get("sort") ?? "") ? (sp.get("sort") as SortKey) : "price",
  };
}

/** Filters → query string (stable key order, defaults omitted). */
export function serializeFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.boroughs.length) p.set("borough", f.boroughs.join(","));
  if (f.neighborhood) p.set("neighborhood", f.neighborhood);
  if (f.proteins.length) p.set("protein", f.proteins.join(","));
  if (f.sources.length) p.set("source", f.sources.join(","));
  if (f.min !== null) p.set("min", String(f.min));
  if (f.max !== null) p.set("max", String(f.max));
  if (f.indexOnly) p.set("index", "1");
  if (f.sort !== "price") p.set("sort", f.sort);
  return p.toString().replace(/%2C/g, ",");
}

/** Lowercase, accents folded, punctuation collapsed. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9$.]+/g, " ")
    .trim();
}

export function queryTokens(q: string): string[] {
  return normalize(q).split(" ").filter(Boolean).slice(0, 8);
}

export function activeFilterCount(f: Filters): number {
  return (
    f.boroughs.length +
    (f.neighborhood ? 1 : 0) +
    f.proteins.length +
    f.sources.length +
    (f.min !== null || f.max !== null ? 1 : 0) +
    (f.indexOnly ? 1 : 0)
  );
}
