// Every priced burger as one small static file, /data/menus.json (app/data/menus.json/route.ts), for the two
// places that need the list in the browser without putting it in their page's HTML: the home ranker (its
// search and the visitor's own list; DESIGN.md "The ranker hero") and the badge page's restaurant finder.
// Pure and client-safe: the file's shape, how the build writes it and how the browser checks it.
//
// A burger is a distinct menu (lib/menus menuKey: a restaurant id, or "chain:<slug>" for a chain, whose
// locations share one menu), with every priced location of it, the one that stands for the menu everywhere
// else first (the first priced location in dataset order, as lib/menus pricedMenus has it).
import { BOROUGH_META } from "./boroughs";
import { pricedMenus } from "./menus";
import type { Borough, Restaurant } from "./schema";

/** Where the browser fetches the list (a force-static route). Not linked anywhere. */
export const MENU_LIST_PATH = "/data/menus.json";

/** A menu key: a restaurant id or "chain:<slug>" (the same pattern save_ranking checks). */
export const MENU_KEY_PATTERN = /^(chain:)?[a-z0-9-]{1,120}$/;

export function isMenuKey(v: unknown): v is string {
  return typeof v === "string" && MENU_KEY_PATTERN.test(v);
}

/** One priced location of a menu. `hood` is its neighborhood's slug. */
export type MenuSpot = { id: string; name: string; hood: string | null; borough: Borough };

export type ListedMenu = {
  /** The menu key (restaurant id, or "chain:<slug>"). */
  key: string;
  /** The menu's burger (each restaurant publishes one). */
  burger: string;
  /** Its menu price. */
  price: number;
  /** Priced locations, the menu's usual one first. */
  spots: MenuSpot[];
};

/** What /data/menus.json holds: the neighborhoods' names by slug, and every distinct priced menu. */
export type MenuListData = { hoods: Record<string, string>; menus: ListedMenu[] };

/** Every distinct priced menu (a chain once) with its priced locations, the usual one first. */
export function listedMenus(list: readonly Restaurant[]): ListedMenu[] {
  const byKey = new Map<string, ListedMenu>();
  for (const m of pricedMenus(list)) byKey.set(m.key, { key: m.key, burger: m.restaurant.burger.name, price: m.indexPrice, spots: [] });
  for (const r of list) {
    if (r.index_price === null) continue;
    byKey.get(r.chain ? `chain:${r.chain}` : r.id)?.spots.push({ id: r.id, name: r.name, hood: r.neighborhood_slug, borough: r.borough });
  }
  return [...byKey.values()];
}

/** The file's contents: the menus, and the names of the neighborhoods they are in (sorted by slug). */
export function menuListData(list: readonly Restaurant[]): MenuListData {
  const hoods = new Map<string, string>();
  for (const r of list) if (r.index_price !== null && r.neighborhood_slug && r.neighborhood) hoods.set(r.neighborhood_slug, r.neighborhood);
  return { hoods: Object.fromEntries([...hoods].sort(([a], [b]) => (a < b ? -1 : 1))), menus: listedMenus(list) };
}

const BOROUGH_NAMES = new Set<string>(BOROUGH_META.map((b) => b.name));

function isSpot(v: unknown): v is MenuSpot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    isMenuKey(s.id) &&
    !s.id.startsWith("chain:") &&
    typeof s.name === "string" &&
    s.name.length > 0 &&
    (s.hood === null || typeof s.hood === "string") &&
    typeof s.borough === "string" &&
    BOROUGH_NAMES.has(s.borough)
  );
}

/** The file as the browser receives it, checked: malformed menus and names are dropped, never shown. */
export function parseMenuList(v: unknown): MenuListData {
  const raw = v && typeof v === "object" ? (v as { hoods?: unknown; menus?: unknown }) : {};
  const hoods: Record<string, string> = {};
  if (raw.hoods && typeof raw.hoods === "object" && !Array.isArray(raw.hoods)) {
    for (const [slug, name] of Object.entries(raw.hoods as Record<string, unknown>)) if (/^[a-z0-9-]{1,120}$/.test(slug) && typeof name === "string" && name) hoods[slug] = name;
  }
  const menus: ListedMenu[] = [];
  const seen = new Set<string>();
  for (const m of Array.isArray(raw.menus) ? raw.menus : []) {
    if (!m || typeof m !== "object") continue;
    const { key, burger, price, spots } = m as Record<string, unknown>;
    if (!isMenuKey(key) || seen.has(key) || typeof burger !== "string" || !burger) continue;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || !Array.isArray(spots)) continue;
    const good = spots.filter(isSpot);
    if (!good.length) continue;
    seen.add(key);
    menus.push({ key, burger, price, spots: good });
  }
  return { hoods, menus };
}
