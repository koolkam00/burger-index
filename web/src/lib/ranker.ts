// The burger ranker (DESIGN.md "The ranker hero"; user decisions 2026-09-25/26): each visitor ranks 3 to 25
// burgers, best first ("your top 10", with room for more), saves the list and can edit or delete it. One list
// per browser and per connection; the People's Top 10 is made from everyone's lists once a day
// (lib/peoples-top.ts, the Patty Ladder).
//
// Pure, client-safe helpers: the list's limits and edits, the burgers as the ranker shows them and their
// search, the saved list as the backend returns it, the failures, and the words the card says. The calls
// are in ./ranker-api, the state in ./ranker-store. Nothing here explains how the Top 10 is computed
// (DESIGN.md "No methodology copy"); the page's one-liner does that.
import { normalize, queryTokens } from "./explorer";
import { formatDate, formatIsoDay, pluralize } from "./format";
import { isMenuKey, type MenuListData } from "./menu-list";

/** A list holds 3 to 25 burgers (the backend refuses anything else). */
export const MIN_ITEMS = 3;
export const MAX_ITEMS = 25;
/** The list is framed as "your top 10": rows after this one are extras. */
export const TOP_N = 10;
/** Search results shown at once. */
export const MAX_HITS = 8;

// ---- the list ------------------------------------------------------------------------------------

/** The list with `key` added at the end (unchanged when it is already there or the list is full). */
export function addItem(list: readonly string[], key: string): string[] {
  if (list.includes(key) || list.length >= MAX_ITEMS) return [...list];
  return [...list, key];
}

export function removeItem(list: readonly string[], key: string): string[] {
  return list.filter((k) => k !== key);
}

/** The list with `key` moved `delta` places (−1: up, toward #1), stopping at either end. */
export function moveItem(list: readonly string[], key: string, delta: number): string[] {
  const from = list.indexOf(key);
  if (from < 0) return [...list];
  return moveItemTo(list, key, from + delta);
}

/** The list with `key` moved to `index` (0-based, clamped). */
export function moveItemTo(list: readonly string[], key: string, index: number): string[] {
  const from = list.indexOf(key);
  if (from < 0) return [...list];
  const to = Math.max(0, Math.min(list.length - 1, Math.trunc(index)));
  const out = [...list];
  out.splice(from, 1);
  out.splice(to, 0, key);
  return out;
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** The first problem that stops a save, or null: too few or too many burgers, or one no longer listed. */
export type ListProblem = "too_short" | "too_long" | "gone";
export function listProblem(list: readonly string[], known: (key: string) => boolean): ListProblem | null {
  if (list.some((k) => !known(k))) return "gone";
  if (list.length < MIN_ITEMS) return "too_short";
  if (list.length > MAX_ITEMS) return "too_long";
  return null;
}

// ---- the burgers -----------------------------------------------------------------------------------

/** A burger as the ranker lists it: its menu, the location that stands for it and where that is. */
export type RankerBurger = {
  key: string;
  burger: string;
  price: number;
  /** The restaurant's name (a chain's usual location) and page id. */
  name: string;
  id: string;
  /** The name controls and announcements use: with where it is when another menu's restaurant has the same name. */
  label: string;
  /** "Astoria, Queens"; a chain with several locations: "7 locations"; no neighborhood: the borough. */
  where: string;
  locations: number;
  /** Normalized search text: the restaurant, the burger, the neighborhood and the borough. */
  hay: string;
};

/** The menus of /data/menus.json as the ranker shows them, by menu key. */
export function rankerBurgers(data: MenuListData): Map<string, RankerBurger> {
  const out = new Map<string, RankerBurger>();
  for (const m of data.menus) {
    const spot = m.spots[0];
    if (!spot) continue;
    const hood = spot.hood ? (data.hoods[spot.hood] ?? null) : null;
    const where = m.spots.length > 1 ? pluralize(m.spots.length, "location") : hood ? `${hood}, ${spot.borough}` : spot.borough;
    const places = [...new Set(m.spots.flatMap((s) => [s.hood ? (data.hoods[s.hood] ?? "") : "", s.borough]))].join(" ");
    // Dots dropped too, so "jg melon" finds J.G. Melon (normalize keeps them for prices like "$9.50").
    const text = normalize(`${spot.name} ${m.burger} ${places}`);
    out.set(m.key, { key: m.key, burger: m.burger, price: m.price, name: spot.name, id: spot.id, label: spot.name, where, locations: m.spots.length, hay: `${text} ${text.replace(/\./g, "")}` });
  }
  const named = new Map<string, number>();
  for (const b of out.values()) named.set(b.name, (named.get(b.name) ?? 0) + 1);
  for (const b of out.values()) if ((named.get(b.name) ?? 0) > 1) b.label = `${b.name}, ${b.where}`;
  return out;
}

/**
 * The burgers whose restaurant, burger, neighborhood or borough holds every word of the query (accents and
 * punctuation folded): restaurants whose name starts with it first, then by name.
 */
export function searchBurgers(burgers: Iterable<RankerBurger>, query: string): RankerBurger[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const q = tokens.join(" ");
  const starts = (b: RankerBurger) => (normalize(b.name).startsWith(q) ? 0 : 1);
  return [...burgers].filter((b) => tokens.every((t) => b.hay.includes(t))).sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name) || (a.key < b.key ? -1 : 1));
}

// ---- the saved list ----------------------------------------------------------------------------------

export type RankingStatus = "active" | "replaced" | "deleted" | "void";

/** get_my_ranking's reply (supabase/README.md). */
export type SavedRanking = {
  items: string[];
  status: RankingStatus;
  /** Its New York save day, "YYYY-MM-DD". */
  savedOn: string;
  /** The first day it counts (null unless active). */
  countsFrom: string | null;
  /** This exact version is in the last published board's numbers. */
  inBoard: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set<string>(["active", "replaced", "deleted", "void"]);

function isItems(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_ITEMS && v.every(isMenuKey) && new Set(v).size === v.length;
}

/** get_my_ranking's reply, checked: null for none (or anything that doesn't check out). */
export function parseMyRanking(v: unknown): SavedRanking | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { items, status, saved_on, counts_from, in_board } = v as Record<string, unknown>;
  if (!isItems(items) || typeof status !== "string" || !STATUSES.has(status)) return null;
  if (typeof saved_on !== "string" || !DAY.test(saved_on)) return null;
  const countsFrom = typeof counts_from === "string" && DAY.test(counts_from) ? counts_from : null;
  return { items: [...items], status: status as RankingStatus, savedOn: saved_on, countsFrom: status === "active" ? countsFrom : null, inBoard: in_board === true };
}

/** save_ranking's reply: the saved list's status and days. */
export type SaveReply = { status: "active" | "void"; savedOn: string; countsFrom: string | null };

export function parseSaveReply(v: unknown): SaveReply | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { status, saved_on, counts_from } = v as Record<string, unknown>;
  if ((status !== "active" && status !== "void") || typeof saved_on !== "string" || !DAY.test(saved_on)) return null;
  return { status, savedOn: saved_on, countsFrom: status === "active" && typeof counts_from === "string" && DAY.test(counts_from) ? counts_from : null };
}

/** Today in New York, "YYYY-MM-DD" (a list's days are New York days). */
export function nyToday(now: Date = new Date()): string {
  return formatIsoDay(now.toISOString());
}

/** Added when a saved list holds a burger that left the Burger Index (it can't be saved until it is replaced). */
const GONE_TEXT = "Some burgers on it are no longer on the Burger Index: edit your list to replace them";

/**
 * What the card says about the saved list (DESIGN.md "The ranker hero": Saved):
 * - void: "Not counted." (nothing to add: a void list stays void);
 * - replaced: the backend's words for it, with "Save again" beside them;
 * - counted in the last published board: "Counted in the People's Top 10.";
 * - saved, counting from a later day: "Saved. It counts from Sep 27, 2026.";
 * - saved and counting, not yet in a published board: "Saved. It joins the People's Top 10 at its next update."
 * `gone`: a burger on it left the Burger Index. A replaced list then asks for an edit instead of "Save again" (which
 * isn't offered: the list can't be saved as it is); the others add the same request.
 */
export function savedStatusText(saved: Pick<SavedRanking, "status" | "countsFrom" | "inBoard">, today: string, gone = false): string {
  if (saved.status === "replaced") {
    return gone
      ? `Not counted: a newer list was saved from this connection. ${GONE_TEXT}, then save.`
      : "Not counted: a newer list was saved from this connection. Save again to count this one.";
  }
  const text =
    saved.status === "void"
      ? "Not counted."
      : saved.status === "deleted"
        ? "Deleted."
        : saved.inBoard
          ? "Counted in the People's Top 10."
          : saved.countsFrom && saved.countsFrom > today
            ? `Saved. It counts from ${formatDate(saved.countsFrom)}.`
            : "Saved. It joins the People's Top 10 at its next update.";
  return gone ? `${text} ${GONE_TEXT}.` : text;
}

/** The line under the list: how many, and what's still needed to save. */
export function countLine(n: number): string {
  if (n === 0) return `Add at least ${MIN_ITEMS} burgers, your favorite first.`;
  if (n < MIN_ITEMS) return `${pluralize(n, "burger")}. Add ${MIN_ITEMS - n} more to save.`;
  if (n >= MAX_ITEMS) return `${MAX_ITEMS} burgers: your list is full.`;
  return `${pluralize(n, "burger")}, up to ${MAX_ITEMS}.`;
}

/** Why "Save" can't go yet, in the status line. */
export const PROBLEM_COPY: Record<ListProblem, string> = {
  too_short: `Add at least ${MIN_ITEMS} burgers to save.`,
  too_long: `A list holds at most ${MAX_ITEMS} burgers.`,
  gone: "Remove the burgers no longer on the Burger Index, then save.",
};

// ---- failures ------------------------------------------------------------------------------------------

export type RankerErrorKind =
  | "rate_connection"
  | "rate_voter"
  | "rate_network"
  | "too_short"
  | "too_long"
  | "unknown_burger"
  | "duplicate"
  | "invalid"
  | "network"
  | "not_deleted"
  | "disabled"
  | "unknown";

const HINTS: Record<string, RankerErrorKind> = {
  rate_connection: "rate_connection",
  rate_voter: "rate_voter",
  rate_network: "rate_network",
  list_too_short: "too_short",
  list_too_long: "too_long",
  unknown_burger: "unknown_burger",
  duplicate_burger: "duplicate",
  list_invalid: "invalid",
  missing_voter: "invalid",
};

/**
 * What a failed call means, from a PostgREST error (the backend's stable `hint` codes; HTTP 429 comes as
 * SQLSTATE PT429, a refusal as 22023) or a fetch failure. A thrown RankerError keeps its kind.
 */
export function classifyRankerError(err: unknown): RankerErrorKind {
  if (!err || typeof err !== "object") return "unknown";
  const { kind, code, hint, message, name, status } = err as Record<string, unknown>;
  if (typeof kind === "string" && kind in RANKER_ERROR_COPY) return kind as RankerErrorKind;
  if (typeof hint === "string" && HINTS[hint]) return HINTS[hint];
  if (code === "PT429" || status === 429) return "rate_connection";
  if (code === "22023" || code === "22P02") return "invalid";
  const text = `${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`;
  if (/fetch|network|load failed|timed? ?out|abort|offline|ECONN|socket/i.test(text)) return "network";
  if (!code && !status) return "network";
  return "unknown";
}

/** Friendly copy for each failure (the backend's own words for its refusals; DESIGN.md "The ranker hero"). */
export const RANKER_ERROR_COPY: Record<RankerErrorKind, string> = {
  rate_connection: "Lots of lists were saved from this connection in the last hour. Try again later.",
  rate_voter: "You've saved your list a lot today. Try again tomorrow.",
  rate_network: "Lots of new lists came from this network today. Try again tomorrow.",
  too_short: `Pick at least ${MIN_ITEMS} burgers.`,
  too_long: `A list holds at most ${MAX_ITEMS} burgers.`,
  unknown_burger: "One of those burgers isn't on the Burger Index. Remove it and save again.",
  duplicate: "Each burger can be on your list only once.",
  invalid: "That list doesn't look right. Reload the page and try again.",
  network: "Couldn't reach the counter. Check your connection and try again.",
  not_deleted: "This list can't be deleted.",
  disabled: "Lists open soon.",
  unknown: "Something went wrong. Try again.",
};

/** When the saved list couldn't be loaded. */
export const MINE_FAILED_COPY = "Couldn't load your saved list.";
