// The burger pricer on the home page (DESIGN.md "The pricer hero"; user decision 2026-09-25): pick an
// area, then price one burger at a time with its menu price hidden until the answer is saved. Pure,
// client-safe helpers: the data the static /data/pricer.json route ships, areas, the queue and the
// reveal's difference. The answers themselves go through the worth store (lib/worth-store), into the
// same People's Price pool as the restaurant pages' "What would you pay?".
//
// A burger is a distinct menu (lib/menus menuKey: a chain once), shown at one of its locations: the
// one in the chosen area, else its usual location (the row that stands for the menu everywhere else).
import { BOROUGH_META, boroughBySlug, boroughInProse, inNeighborhood, type BoroughSlug } from "./boroughs";
import { formatPrice, MINUS } from "./format";
import { pricedMenus } from "./menus";
import type { Borough, Restaurant } from "./schema";
import { isMenuKey } from "./worth";

/** Where the home page fetches the pricer's burgers (a force-static route: app/data/pricer.json). */
export const PRICER_DATA_PATH = "/data/pricer.json";
/** Descriptions longer than this are left out of the card (and of the data file). */
export const SHORT_DESCRIPTION = 120;

// ---- data ----------------------------------------------------------------------------------------

/** One priced location of a menu. `hood` is the neighborhood slug. */
export type PricerSpot = { id: string; name: string; hood: string | null; borough: Borough };

export type PricerMenu = {
  /** menu key (restaurant id, or "chain:<slug>") */
  key: string;
  burger: string;
  /** the burger's description when it is short, else null */
  description: string | null;
  /** the menu price (the menu's index price), hidden until the visitor answers */
  price: number;
  /** priced locations, the menu's usual one first */
  spots: PricerSpot[];
};

/** A neighborhood the picker offers: one with a priced menu. */
export type PricerHood = { slug: string; name: string; borough: Borough };

/** What /data/pricer.json holds (the picker's neighborhoods come with the page instead). */
export type PricerData = { menus: PricerMenu[] };

/**
 * Every distinct priced menu (a chain once) with its priced locations, the one that stands for the
 * menu everywhere else first (the first priced location in dataset order, as on the People's Price
 * page). Written at build time to /data/pricer.json.
 */
export function pricerMenus(list: readonly Restaurant[]): PricerMenu[] {
  const byKey = new Map<string, PricerMenu>();
  for (const m of pricedMenus(list)) {
    const r = m.restaurant;
    const d = r.burger.description?.trim() ?? "";
    byKey.set(m.key, {
      key: m.key,
      burger: r.burger.name,
      description: d && d.length <= SHORT_DESCRIPTION ? d : null,
      price: m.indexPrice,
      spots: [],
    });
  }
  for (const r of list) {
    if (r.index_price === null) continue;
    const menu = byKey.get(r.chain ? `chain:${r.chain}` : r.id);
    menu?.spots.push({ id: r.id, name: r.name, hood: r.neighborhood_slug, borough: r.borough });
  }
  return [...byKey.values()];
}

/** Neighborhoods with a priced menu, in the fixed borough order, then by name. */
export function pricerHoods(list: readonly Restaurant[]): PricerHood[] {
  const bySlug = new Map<string, PricerHood>();
  for (const r of list) {
    if (r.index_price === null || !r.neighborhood_slug || !r.neighborhood) continue;
    if (!bySlug.has(r.neighborhood_slug)) bySlug.set(r.neighborhood_slug, { slug: r.neighborhood_slug, name: r.neighborhood, borough: r.borough });
  }
  const order = new Map(BOROUGH_META.map((b, i) => [b.name, i]));
  return [...bySlug.values()].sort((a, b) => (order.get(a.borough) ?? 9) - (order.get(b.borough) ?? 9) || a.name.localeCompare(b.name));
}

export function pricerData(list: readonly Restaurant[]): PricerData {
  return { menus: pricerMenus(list) };
}

const BOROUGH_NAMES = new Set<string>(BOROUGH_META.map((b) => b.name));

function isSpot(v: unknown): v is PricerSpot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.id === "string" && isMenuKey(s.id) && !s.id.startsWith("chain:") && typeof s.name === "string" && (s.hood === null || typeof s.hood === "string") && typeof s.borough === "string" && BOROUGH_NAMES.has(s.borough);
}

/** The data file as the browser receives it, checked: malformed menus are dropped, never shown. */
export function parsePricerData(v: unknown): PricerMenu[] {
  const menus = v && typeof v === "object" ? (v as { menus?: unknown }).menus : null;
  if (!Array.isArray(menus)) return [];
  const out: PricerMenu[] = [];
  const seen = new Set<string>();
  for (const m of menus) {
    if (!m || typeof m !== "object") continue;
    const { key, burger, description, price, spots } = m as Record<string, unknown>;
    if (!isMenuKey(key) || seen.has(key) || typeof burger !== "string" || !burger) continue;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    if (!Array.isArray(spots)) continue;
    const good = spots.filter(isSpot);
    if (!good.length) continue;
    seen.add(key);
    out.push({ key, burger, description: typeof description === "string" && description ? description : null, price, spots: good });
  }
  return out;
}

// ---- areas ---------------------------------------------------------------------------------------

export type PricerArea = { kind: "nyc" } | { kind: "borough"; slug: BoroughSlug } | { kind: "neighborhood"; slug: string };

export const ANYWHERE: PricerArea = { kind: "nyc" };

/** "nyc", "borough:brooklyn", "neighborhood:astoria": the area as stored and compared. */
export function areaId(a: PricerArea): string {
  return a.kind === "nyc" ? "nyc" : `${a.kind}:${a.slug}`;
}

/**
 * A stored area id back to an area, or null when it isn't one (a neighborhood must be one the picker
 * still offers: `hoods` holds their slugs).
 */
export function parseAreaId(v: unknown, hoods: ReadonlySet<string>): PricerArea | null {
  if (typeof v !== "string") return null;
  if (v === "nyc") return ANYWHERE;
  const m = /^(borough|neighborhood):([a-z0-9-]{1,120})$/.exec(v);
  if (!m) return null;
  if (m[1] === "borough") {
    const b = boroughBySlug(m[2]);
    return b ? { kind: "borough", slug: b.slug } : null;
  }
  return hoods.has(m[2]) ? { kind: "neighborhood", slug: m[2] } : null;
}

/** The analytics area type. */
export function areaType(a: PricerArea): "anywhere" | "borough" | "neighborhood" {
  return a.kind === "nyc" ? "anywhere" : a.kind;
}

/** The analytics area value: "nyc", a borough slug or a neighborhood slug. */
export function areaSlug(a: PricerArea): string {
  return a.kind === "nyc" ? "nyc" : a.slug;
}

/** The area as a label: "Anywhere in NYC", "Brooklyn", "Astoria". */
export function areaName(a: PricerArea, hoods: ReadonlyMap<string, PricerHood>): string {
  if (a.kind === "nyc") return "Anywhere in NYC";
  if (a.kind === "borough") return boroughBySlug(a.slug)?.name ?? a.slug;
  return hoods.get(a.slug)?.name ?? a.slug;
}

/** The area inside a sentence, with its preposition: "in NYC", "in the Bronx", "on the Upper West Side". */
export function inArea(a: PricerArea, hoods: ReadonlyMap<string, PricerHood>): string {
  if (a.kind === "nyc") return "in NYC";
  if (a.kind === "borough") {
    const b = boroughBySlug(a.slug);
    return `in ${b ? boroughInProse(b.name) : a.slug}`;
  }
  const h = hoods.get(a.slug);
  return h ? inNeighborhood(h.name) : `in ${a.slug}`;
}

function spotIn(s: PricerSpot, a: PricerArea): boolean {
  if (a.kind === "nyc") return true;
  if (a.kind === "borough") return boroughBySlug(a.slug)?.name === s.borough;
  return s.hood === a.slug;
}

/** A burger as the pricer shows it: its menu and the location it is shown at. */
export type PricerPick = { menu: PricerMenu; spot: PricerSpot };

/**
 * The menus with a location in the area, each once (a chain once), shown at its first location there
 * (its usual location when that one is in the area, and always for "Anywhere in NYC"). Keyed by menu key.
 */
export function areaPicks(menus: readonly PricerMenu[], a: PricerArea): Map<string, PricerPick> {
  const out = new Map<string, PricerPick>();
  for (const menu of menus) {
    if (out.has(menu.key)) continue;
    const spot = menu.spots.find((s) => spotIn(s, a));
    if (spot) out.set(menu.key, { menu, spot });
  }
  return out;
}

/** A shuffled copy (Fisher–Yates). `random` returns [0, 1), like Math.random. */
export function shuffled<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The first key of the queue that isn't excluded (priced already, or served this session), or null. */
export function nextKey(order: readonly string[], excluded: (key: string) => boolean): string | null {
  for (const k of order) if (!excluded(k)) return k;
  return null;
}

// ---- the reveal ------------------------------------------------------------------------------------

export type AnswerGap = {
  /** answer minus menu price, in cents */
  cents: number;
  /** "+$2.50", "−$3.50", "$0.00" */
  text: string;
  side: "over" | "under" | "even";
};

/** The visitor's answer against the menu price, to the cent (the answer is whole dollars, the price may carry cents). */
export function answerGap(answer: number, menuPrice: number): AnswerGap {
  const cents = Math.round(answer * 100) - Math.round(menuPrice * 100);
  const text = `${cents > 0 ? "+" : cents < 0 ? MINUS : ""}${formatPrice(Math.abs(cents) / 100, { cents: "always" })}`;
  return { cents, text, side: cents > 0 ? "over" : cents < 0 ? "under" : "even" };
}

/** The sub-line under the difference. */
export const GAP_LABEL: Record<AnswerGap["side"], string> = {
  over: "Above the menu price",
  under: "Below the menu price",
  even: "Same as the menu price",
};

// ---- storage ---------------------------------------------------------------------------------------

/** localStorage: the visitor's last area (a returning visitor starts there; the <head> script reads it too). */
export { PRICER_AREA_KEY } from "./theme-script";
/** sessionStorage: the menus served this session and how many were answered. */
export const PRICER_SESSION_KEY = "bi-pricer-session";
/** At most this many served menus are remembered (every menu fits). */
const MAX_SEEN = 2000;

export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type PricerSession = { seen: string[]; answered: number };

/** The stored session, checked (unknown entries dropped); a fresh one when missing or unreadable. */
export function parseSession(raw: string | null): PricerSession {
  if (!raw) return { seen: [], answered: 0 };
  try {
    const v = JSON.parse(raw) as { seen?: unknown; answered?: unknown };
    const seen = Array.isArray(v.seen) ? [...new Set(v.seen.filter(isMenuKey))].slice(-MAX_SEEN) : [];
    const answered = typeof v.answered === "number" && Number.isInteger(v.answered) && v.answered >= 0 ? v.answered : 0;
    return { seen, answered };
  } catch {
    return { seen: [], answered: 0 };
  }
}

/** Storage can be missing or throw (private windows, blocked site data): every access is wrapped. */
export function readItem(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeItem(storage: KeyValueStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // storage full or blocked: it lasts for this page view only
  }
}
