// Client-safe types and pure helpers for the /burgers explorer. The server builds one compact row per
// priced restaurant (its one published burger), so the payload stays light.
import type { BoroughSlug } from "./boroughs";
import { BOROUGH_META } from "./boroughs";
import type { Borough, PriceSource } from "./schema";

/** One priced restaurant and its burger. */
export type ExRow = {
  /** restaurant id (URL slug) */
  id: string;
  name: string;
  /** the burger's name */
  burger: string;
  price: number;
  nb: string | null;
  nbSlug: string | null;
  borough: Borough;
  source: PriceSource;
};

export type ExNeighborhood = { slug: string; name: string; borough: Borough };

export type ExplorerData = {
  median: number | null;
  rows: ExRow[];
  /** Neighborhoods with at least one row, for the neighborhood filter. */
  neighborhoods: ExNeighborhood[];
};

export type SortKey = "price" | "-price" | "name" | "restaurant";
export const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "price", label: "Price: low to high" },
  { key: "-price", label: "Price: high to low" },
  { key: "name", label: "Burger name" },
  { key: "restaurant", label: "Restaurant" },
];

export type Filters = {
  q: string;
  boroughs: BoroughSlug[];
  neighborhood: string;
  min: number | null;
  max: number | null;
  sort: SortKey;
};

export const EMPTY_FILTERS: Filters = {
  q: "",
  boroughs: [],
  neighborhood: "",
  min: null,
  max: null,
  sort: "price",
};

const BOROUGH_SLUGS = new Set<string>(BOROUGH_META.map((b) => b.slug));
const SORT_SET = new Set<string>(["price", "-price", "name", "restaurant"]);

function list(v: string | null): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const MAX_QUERY = 120;

/**
 * URL → filters. Unknown values are dropped, so a hand-edited URL (or a stale link to a neighborhood
 * a rebuild no longer has) can't leave the page filtered by something it can't show. Parameters of
 * retired filters (protein, source, hide, index) are ignored.
 */
export function parseFilters(sp: { get(name: string): string | null }, neighborhoods: ReadonlySet<string>): Filters {
  const neighborhood = sp.get("neighborhood") ?? "";
  return {
    q: (sp.get("q") ?? "").slice(0, MAX_QUERY),
    boroughs: list(sp.get("borough")).filter((s): s is BoroughSlug => BOROUGH_SLUGS.has(s)),
    neighborhood: neighborhoods.has(neighborhood) ? neighborhood : "",
    min: num(sp.get("min")),
    max: num(sp.get("max")),
    sort: SORT_SET.has(sp.get("sort") ?? "") ? (sp.get("sort") as SortKey) : "price",
  };
}

/** Filters → query string (stable key order, defaults omitted). */
export function serializeFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.boroughs.length) p.set("borough", f.boroughs.join(","));
  if (f.neighborhood) p.set("neighborhood", f.neighborhood);
  if (f.min !== null) p.set("min", String(f.min));
  if (f.max !== null) p.set("max", String(f.max));
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
  return f.boroughs.length + (f.neighborhood ? 1 : 0) + (f.min !== null || f.max !== null ? 1 : 0);
}

/** A row with its search text: burger, restaurant, neighborhood and borough, normalized once. */
export type SearchableRow = { row: ExRow; hay: string };

export function searchable(row: ExRow): SearchableRow {
  return { row, hay: normalize(`${row.burger} ${row.name} ${row.nb ?? ""} ${row.borough}`) };
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const SLUG_BY_BOROUGH = new Map<string, string>(BOROUGH_META.map((m) => [m.name, m.slug]));

/**
 * The rows that pass the filters and every query token, sorted by `f.sort` (ties: burger name, then
 * price). `tokens` comes from queryTokens(), so a half-typed query can lag the rest of the filters.
 */
export function filterRows(list: readonly SearchableRow[], f: Omit<Filters, "q">, tokens: readonly string[]): SearchableRow[] {
  const boroughs = new Set<string>(f.boroughs);
  const out = list.filter(({ row, hay }) => {
    if (boroughs.size && !boroughs.has(SLUG_BY_BOROUGH.get(row.borough) ?? "")) return false;
    if (f.neighborhood && row.nbSlug !== f.neighborhood) return false;
    if (f.min !== null && row.price < f.min) return false;
    if (f.max !== null && row.price > f.max) return false;
    for (const t of tokens) if (!hay.includes(t)) return false;
    return true;
  });
  const byPrice = (a: ExRow, z: ExRow, dir: 1 | -1) => (a.price - z.price) * dir;
  out.sort(({ row: a }, { row: z }) => {
    switch (f.sort) {
      case "-price":
        return byPrice(a, z, -1) || collator.compare(a.burger, z.burger);
      case "name":
        return collator.compare(a.burger, z.burger) || byPrice(a, z, 1);
      case "restaurant":
        return collator.compare(a.name, z.name) || byPrice(a, z, 1);
      default:
        return byPrice(a, z, 1) || collator.compare(a.burger, z.burger);
    }
  });
  return out;
}
