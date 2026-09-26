// "The most-recommended burgers in NYC" (user decisions 2026-09-25): a consensus of public editorial
// best-burger lists, from ../data/best_burgers.json (curated by hand from the research, facts only: names,
// the burger names the lists give, publishers, list titles, links and dates; never a sentence from a list).
//
// Rules the file already follows and problems() checks: lists published or updated 2024-2026 only; no Upper
// Cut Media House lists (the publisher sells partnerships) and no pure trend features (Grub Street 2025, the
// New York Post's off-menu piece; chef-pick features count); beef burgers only (no national chains, no
// vegetarian, vegan, lamb or bison picks); closed places left out. One publisher is enough (user decision
// 2026-09-25, "/best-burgers should have all those burgers": the earlier two-publisher minimum is gone), so
// every open place whose beef burger a counted list names is on the page. A place ranks by how many distinct
// publishers named it (several lists from one publisher count once); ties share a rank (1, 2, 2, 4) and are
// listed by name. The page groups the places by that count ("Named by 10 publications" … "Named by 1
// publication"; groupBestBurgers).
//
// Our menu price and burger come from the dataset (a place's restaurant_id); a place without a price has
// no page and shows "Not priced". Pure and client-safe: types only from ./schema.
import { formatCount, formatDate, formatPrice, pluralize, theBurger } from "./format";
import { joinList, menuKey } from "./menus";
import type { AreaSummary, Borough, PricedRestaurant, Restaurant } from "./schema";

export const BEST_BURGERS_PATH = "/best-burgers";
/** The page's name (its H1 without the period, its ItemList and every link to it). */
export const BEST_BURGERS_NAME = "The most-recommended burgers in NYC";
/** The page's kicker ticket (and its share image's overline). */
export const BEST_BURGERS_TICKET = "Critics' catch";
/** The count under the list: "All 96 places on this list, most publications first." */
export function bestBurgersCountLine(places: number): string {
  return `All ${formatCount(places)} places on this list, most publications first.`;
}

export type BestList = {
  id: string;
  /** The publisher, as counted: one name per publisher ("Eater", "Time Out"), whichever of its lists. */
  publisher: string;
  title: string;
  url: string;
  /** Published or last updated: "2026-06-25", or "2026" when the list gives only the year. */
  date: string;
};
export type BestSource = { list: string; burger: string | null };
export type BestPlace = {
  key: string;
  name: string;
  /** Its id in burger_index.json (priced or not), or null when the dataset doesn't carry it. */
  restaurant_id: string | null;
  /** Only for a place the dataset doesn't carry: its neighborhood's slug. */
  neighborhood_slug: string | null;
  sources: BestSource[];
};
export type BestBurgersFile = {
  version: 1;
  /** When the file was last compiled (YYYY-MM-DD). */
  updated: string;
  years: { from: number; to: number };
  lists: BestList[];
  places: BestPlace[];
};

export type BestNeighborhood = { name: string; slug: string; borough: Borough; hasPage: boolean };

export type BestEntry = {
  key: string;
  name: string;
  /** 1-based; places named by as many publishers share a rank. */
  rank: number;
  /** The distinct publishers, A to Z. */
  publishers: string[];
  /** Every list that names the place, newest first, with the burger it names (when it names one). */
  sources: Array<{ list: BestList; burger: string | null }>;
  /** The priced restaurant (it has a page), or null when the place has no menu price. */
  restaurant: PricedRestaurant | null;
  neighborhood: BestNeighborhood | null;
  /** The menu key (menus.ts menuKey) of a priced place: its People's Top 10 key. */
  menuKey: string | null;
};

const YEAR = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Jun 25, 2026", "Jun 2026" or "2026", as precise as the list's date. */
export function formatListDate(date: string): string {
  const m = YEAR.exec(date);
  if (!m) return date;
  if (m[3]) return formatDate(date);
  if (m[2]) return monthFmt.format(new Date(Date.UTC(+m[1], +m[2] - 1, 15)));
  return m[1];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** The page's entries, ranked: most publishers first, ties by name, sharing a rank. */
export function rankBestBurgers(file: BestBurgersFile, restaurants: readonly Restaurant[], neighborhoods: readonly AreaSummary[]): BestEntry[] {
  const lists = new Map(file.lists.map((l) => [l.id, l]));
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  const hoods = new Map(neighborhoods.map((n) => [n.slug, n]));
  const hood = (slug: string | null): BestNeighborhood | null => {
    const n = slug ? hoods.get(slug) : undefined;
    return n ? { name: n.name, slug: n.slug, borough: n.borough, hasPage: n.restaurants_priced > 0 } : null;
  };
  const entries = file.places.map((p) => {
    const r = p.restaurant_id ? byId.get(p.restaurant_id) : undefined;
    const priced = r && r.index_price !== null ? (r as PricedRestaurant) : null;
    const sources = p.sources
      .map((s) => ({ list: lists.get(s.list) as BestList, burger: s.burger }))
      .filter((s) => s.list)
      .sort((a, b) => b.list.date.localeCompare(a.list.date) || a.list.title.localeCompare(b.list.title));
    const neighborhood = priced
      ? priced.neighborhood && priced.neighborhood_slug
        ? { ...(hood(priced.neighborhood_slug) as BestNeighborhood), name: priced.neighborhood }
        : null
      : hood(r ? r.neighborhood_slug : p.neighborhood_slug);
    return {
      key: p.key,
      name: p.name,
      rank: 0,
      publishers: [...new Set(sources.map((s) => s.list.publisher))].sort((a, b) => a.localeCompare(b)),
      sources,
      restaurant: priced,
      neighborhood,
      menuKey: priced ? menuKey(priced) : null,
    };
  });
  entries.sort((a, b) => b.publishers.length - a.publishers.length || byName(a, b));
  entries.forEach((e, i) => {
    e.rank = i > 0 && e.publishers.length === entries[i - 1].publishers.length ? entries[i - 1].rank : i + 1;
  });
  return entries;
}

export type BestGroup = {
  /** How many distinct publishers named each place in the group. */
  publishers: number;
  /** The rank the group's places share. */
  rank: number;
  /** "Named by 10 publications", "Named by 1 publication": the group's heading. */
  heading: string;
  /** Its anchor: "named-by-10". */
  id: string;
  entries: BestEntry[];
};

/** "Named by 10 publications" / "Named by 1 publication". */
export function namedByHeading(publishers: number): string {
  return `Named by ${pluralize(publishers, "publication")}`;
}

/** The ranked entries in groups of one publication count, most first; each group keeps the entries' order (by name). */
export function groupBestBurgers(entries: readonly BestEntry[]): BestGroup[] {
  const groups: BestGroup[] = [];
  for (const e of entries) {
    const n = e.publishers.length;
    const last = groups[groups.length - 1];
    if (last && last.publishers === n) last.entries.push(e);
    else groups.push({ publishers: n, rank: e.rank, heading: namedByHeading(n), id: `named-by-${n}`, entries: [e] });
  }
  return groups;
}

/** The places that share first place. */
export function leaders(entries: readonly BestEntry[]): BestEntry[] {
  return entries.filter((e) => e.rank === 1);
}

/**
 * The page's one-line answer: "Red Hook Tavern tops the list: 10 publications named it. The Dry-Aged Red
 * Hook Tavern Burger there costs $34.00 on the menu (September 2026)." Ties: "J.G. Melon and Minetta
 * Tavern top the list: 7 publications named each." (three or more are counted, then named).
 */
export function bestBurgersLede(entries: readonly BestEntry[], month: string): string {
  const top = leaders(entries);
  if (!top.length) return "No places on the list yet.";
  const n = top[0].publishers.length;
  const named = n === 1 ? "1 publication" : `${n} publications`;
  if (top.length === 1) {
    const r = top[0].restaurant;
    const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
    const price = r ? ` ${cap(theBurger(r.burger.name))} there costs ${formatPrice(r.index_price, { cents: "always" })} on the menu (${month}).` : "";
    return `${top[0].name} tops the list: ${named} named it.${price}`;
  }
  if (top.length === 2) return `${joinList(top.map((e) => e.name))} top the list: ${named} named each.`;
  return `${top.length} places top the list, each named by ${named}: ${joinList(top.map((e) => e.name))}.`;
}

/**
 * What is wrong with the file against the dataset (empty when nothing is): the decisions above, and that
 * every id, list and neighborhood it names exists. The build fails on any (best-burgers-data.ts).
 */
export function bestBurgersProblems(file: BestBurgersFile, restaurants: readonly Restaurant[], neighborhoods: readonly AreaSummary[]): string[] {
  const problems: string[] = [];
  const ids = new Set(restaurants.map((r) => r.id));
  const hoods = new Set(neighborhoods.map((n) => n.slug));
  const lists = new Map<string, BestList>();
  for (const l of file.lists) {
    if (lists.has(l.id)) problems.push(`list ${l.id} is listed twice`);
    lists.set(l.id, l);
    const m = YEAR.exec(l.date);
    if (!m) problems.push(`list ${l.id}: date "${l.date}" is not YYYY[-MM[-DD]]`);
    else if (+m[1] < file.years.from || +m[1] > file.years.to) problems.push(`list ${l.id}: ${l.date} is outside ${file.years.from}-${file.years.to}`);
    if (!/^https:\/\/\S+$/.test(l.url)) problems.push(`list ${l.id}: url is not https`);
    if (/upper cut|world'?s (101|25) best/i.test(`${l.publisher} ${l.title}`)) problems.push(`list ${l.id}: Upper Cut Media House lists are left out`);
  }
  const used = new Set<string>();
  const keys = new Set<string>();
  const rids = new Set<string>();
  for (const p of file.places) {
    if (keys.has(p.key)) problems.push(`place ${p.key} is listed twice`);
    keys.add(p.key);
    if (p.restaurant_id !== null) {
      if (!ids.has(p.restaurant_id)) problems.push(`${p.key}: restaurant ${p.restaurant_id} is not in the dataset`);
      if (rids.has(p.restaurant_id)) problems.push(`${p.key}: restaurant ${p.restaurant_id} is on the page twice`);
      rids.add(p.restaurant_id);
      if (p.neighborhood_slug !== null) problems.push(`${p.key}: neighborhood_slug is only for a place the dataset doesn't carry`);
    } else if (p.neighborhood_slug === null || !hoods.has(p.neighborhood_slug)) {
      problems.push(`${p.key}: a place without a restaurant id needs a known neighborhood_slug`);
    }
    const seen = new Set<string>();
    for (const s of p.sources) {
      if (!lists.has(s.list)) problems.push(`${p.key}: unknown list ${s.list}`);
      if (seen.has(s.list)) problems.push(`${p.key}: list ${s.list} counted twice`);
      seen.add(s.list);
      used.add(s.list);
    }
    if (!p.sources.some((s) => lists.has(s.list))) problems.push(`${p.key}: named on no list of the file`);
  }
  for (const l of file.lists) if (!used.has(l.id)) problems.push(`list ${l.id} names no place on the page`);
  return problems;
}
