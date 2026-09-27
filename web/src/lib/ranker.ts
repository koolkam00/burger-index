// The burger ranker (DESIGN.md "The ranker hero"; user decisions 2026-09-25/26/27): each visitor ranks 3 to 25
// burgers, best first ("your top 10", with room for more); the list saves itself as it changes (autosave, user
// request 2026-09-27) and can be deleted. One list per browser and per connection; the People's Top 10 is made from
// everyone's lists once a day (lib/peoples-top.ts, the Patty Ladder).
//
// Pure, client-safe helpers: the list's limits and edits, the burgers as the ranker shows them and their
// search, the saved list as the backend returns it, the failures, and the words the card says. The calls
// are in ./ranker-api, the state in ./ranker-store. Nothing here explains how the Top 10 is computed
// (DESIGN.md "No methodology copy"); the page's one-liner does that.
import { normalize, queryTokens } from "./explorer";
import { formatDate, formatIsoDay, pluralize } from "./format";
import { isMenuKey, type MenuListData } from "./menu-list";
import type { PeopleStanding } from "./peoples-top";
import { RANKER_ADD_PARAM } from "./site";

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

/**
 * Where a row being dragged lands (drag to reorder, with a mouse): `mids` are the rows' vertical midpoints when the drag
 * began (list order, one coordinate system), `from` the dragged row's index and `center` its midpoint now. It passes
 * another row once its midpoint crosses that row's, and never leaves the list.
 */
export function dragIndex(mids: readonly number[], from: number, center: number): number {
  let to = from;
  while (to + 1 < mids.length && center > mids[to + 1]) to++;
  if (to === from) while (to - 1 >= 0 && center < mids[to - 1]) to--;
  return to;
}

/**
 * Where the dragged row's top is drawn: under the pointer (`pointer` minus `grab`, the pointer's distance from the row's
 * top when the drag began), kept inside the list (from its first row's top to its last row's bottom).
 */
export function dragTop(pointer: number, grab: number, top: number, bottom: number, size: number): number {
  return Math.max(top, Math.min(bottom - size, pointer - grab));
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

// ---- adding from a restaurant page ("Add to your top 10": /?add=<menu key>#rank) ----------------------

/** The menu key a link asks the ranker to add (`?add=<key>` in `search`), or null: none, or not a menu key. */
export function addParam(search: string): string | null {
  const v = new URLSearchParams(search).get(RANKER_ADD_PARAM);
  return v !== null && isMenuKey(v) ? v : null;
}

/** `search` without the add parameter (the others kept): "" or "?x=1". The ranker puts this in the address once it has read it. */
export function withoutAddParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(RANKER_ADD_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** What a link's add did: added at the end (its new place), already on the list (its place), the list full, or a burger the Burger Index doesn't have. */
export type LinkAdd = { key: string } & ({ kind: "added" | "already"; position: number } | { kind: "full" | "gone" });

/** What adding `key` from a link does to `list` (`known`: the burger is on the Burger Index). */
export function linkAddOutcome(list: readonly string[], key: string, known: (key: string) => boolean): LinkAdd {
  const at = list.indexOf(key);
  if (at >= 0) return { key, kind: "already", position: at + 1 };
  if (!known(key)) return { key, kind: "gone" };
  if (list.length >= MAX_ITEMS) return { key, kind: "full" };
  return { key, kind: "added", position: list.length + 1 };
}

/**
 * The card's line (and the announcement) for a link's add: "Emily added at #4. 4 burgers on your list.", "Emily is already
 * on your list, at #2.", "Your list is full: 25 burgers. Remove one to add Emily." or "That burger is no longer on the
 * Burger Index." (The list saves itself, so an add to a saved list says the same as any other.)
 */
export function linkAddText(r: LinkAdd, label: string): string {
  switch (r.kind) {
    case "added":
      return `${label} added at #${r.position}. ${pluralize(r.position, "burger")} on your list.`;
    case "already":
      return `${label} is already on your list, at #${r.position}.`;
    case "full":
      return `Your list is full: ${MAX_ITEMS} burgers. Remove one to add ${label}.`;
    case "gone":
      return "That burger is no longer on the Burger Index.";
  }
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
  /** Where it stands on the People's Top 10 (ranked #N, or Rising on N lists), or null: not on it. */
  people: PeopleStanding | null;
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
    out.set(m.key, { key: m.key, burger: m.burger, price: m.price, name: spot.name, id: spot.id, label: spot.name, where, locations: m.spots.length, people: m.people ?? null, hay: `${text} ${text.replace(/\./g, "")}` });
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

/** Added when the saved list holds a burger that left the Burger Index (no change to it can be saved until it goes). */
const GONE_TEXT = "Remove the burgers no longer on the Burger Index to save changes.";

/**
 * What the card says about the saved list, unchanged since its last save (DESIGN.md "The ranker hero": the status line):
 * - void: "Not counted." (a void list stays void);
 * - replaced: "Not counted: a newer list was saved from this connection." (a change, or "Count it again", saves it
 *   again, which makes it count again; with a gone burger it asks for that burger to go first);
 * - counted in the last published board: "Counted in the People's Top 10.";
 * - saved, counting from a later day: "Saved. It counts from Sep 27, 2026.";
 * - saved and counting, not yet in a published board: "Saved. It joins the People's Top 10 at its next update."
 * `gone`: a burger on it left the Burger Index.
 */
export function savedStatusText(saved: Pick<SavedRanking, "status" | "countsFrom" | "inBoard">, today: string, gone = false): string {
  if (saved.status === "replaced") {
    return gone
      ? "Not counted: a newer list was saved from this connection. Remove the burgers no longer on the Burger Index to count it again."
      : "Not counted: a newer list was saved from this connection.";
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
  return gone ? `${text} ${GONE_TEXT}` : text;
}

// ---- autosave -------------------------------------------------------------------------------------------

/** How long after the last change the list saves itself (ms). */
export const AUTOSAVE_DELAY = 2000;
/** After a save that couldn't reach the backend: try again after 5 s, 15 s, then every minute. */
export const RETRY_DELAYS = [5000, 15000, 60000] as const;
const HOUR = 3_600_000;
/** How long after the hour turns a save refused by the connection's hourly budget is tried again (ms). */
export const AFTER_HOUR_MARGIN = 15_000;

export function retryDelay(attempt: number): number {
  return RETRY_DELAYS[Math.max(0, Math.min(RETRY_DELAYS.length - 1, attempt - 1))];
}

/** From `nowMs` (epoch ms) to just after the next hour turns: the connection's budget counts clock hours. */
export function untilNextHour(nowMs: number): number {
  return HOUR - (((nowMs % HOUR) + HOUR) % HOUR) + AFTER_HOUR_MARGIN;
}

/**
 * Whether a failed save is tried again by itself, after its `attempt`-th failure in a row: a network failure always (the
 * connection comes back); an unexpected reply (a server error, a reply the site can't read) up to three times, then not
 * until the list changes (each try would count against the budgets); the connection's hourly budget once the hour turns;
 * any other refusal never (it would only be refused again).
 */
export function retriesSave(kind: RankerErrorKind, attempt: number): boolean {
  if (kind === "network" || kind === "rate_connection") return true;
  if (kind === "unknown") return attempt <= RETRY_DELAYS.length;
  return false;
}

/** How long to wait before trying a failed save again (`retriesSave` said it would be). */
export function saveRetryDelay(kind: RankerErrorKind, attempt: number, nowMs: number): number {
  return kind === "rate_connection" ? untilNextHour(nowMs) : retryDelay(attempt);
}

/**
 * A failed save in words (the list saves itself, so no "try again" button to press): one tried again by itself says when;
 * a refusal says what will save it, and, with a saved list, that the saved list is unchanged. The backend's own words
 * (RANKER_ERROR_COPY) stay for the refusals a list on the card can't cause.
 */
export function saveFailureText(f: { kind: RankerErrorKind; retrying: boolean }, hasSaved = false): string {
  if (f.retrying) {
    if (f.kind === "network") return "Couldn't reach the counter. Trying again soon.";
    // The retry lives in this page: said as such (the list on the card isn't kept once the tab closes).
    if (f.kind === "rate_connection") return `Lots of lists were saved from this connection in the last hour. Keep this page open: ${hasSaved ? "your changes save" : "your list saves"} after the hour.`;
    return "Something went wrong. Trying again soon.";
  }
  const what = hasSaved ? "your changes" : "it";
  // A daily limit with no saved list: the list lives only in this tab (sessionStorage), so the copy never promises it
  // waits until tomorrow.
  const text =
    f.kind === "rate_connection"
      ? `Lots of lists were saved from this connection in the last hour. Change your list after the hour to save ${what}.`
      : f.kind === "rate_voter"
        ? hasSaved
          ? "You've saved your list a lot today. Change it again tomorrow to save your changes."
          : "You've saved your list a lot today. Your list can't be saved until tomorrow."
        : f.kind === "rate_network"
          ? hasSaved
            ? "Lots of new lists came from this network today. Change your list again tomorrow to save your changes."
            : "Lots of new lists came from this network today. Your list can't be saved until tomorrow."
          : f.kind === "unknown" || f.kind === "network"
            ? `Something went wrong. Change your list or reload the page to save ${what}.`
            : f.kind === "invalid"
              ? `That list doesn't look right. Reload the page to save ${what}.`
              : RANKER_ERROR_COPY[f.kind];
  return hasSaved ? `${text} Your saved list is unchanged.` : text;
}

/**
 * "Count it again" failed: the saved list, replaced from this connection, sent again as it is (nothing on the card
 * changed, so no "your changes"). A refusal keeps "Not counted: …" and says when to count it again.
 */
export function countAgainFailureText(f: { kind: RankerErrorKind; retrying: boolean }): string {
  if (f.retrying) {
    if (f.kind === "network") return "Couldn't reach the counter. Trying again soon.";
    if (f.kind === "rate_connection") return "Lots of lists were saved from this connection in the last hour. Keep this page open: your list counts again after the hour.";
    return "Something went wrong. Trying again soon.";
  }
  const why =
    f.kind === "rate_voter"
      ? "You've saved your list a lot today: count it again tomorrow."
      : f.kind === "rate_network"
        ? "Lots of new lists came from this network today: count it again tomorrow."
        : f.kind === "rate_connection"
          ? "Lots of lists were saved from this connection in the last hour: count it again after the hour."
          : f.kind === "unknown" || f.kind === "network"
            ? "Something went wrong: count it again, or reload the page."
            : f.kind === "invalid"
              ? "That list doesn't look right. Reload the page to count it again."
              : RANKER_ERROR_COPY[f.kind];
  return `Not counted: a newer list was saved from this connection. ${why}`;
}

/**
 * A failed save in the words the status line and the live region both use: "Count it again" refused (a replaced list, as
 * it is) keeps "Not counted: …"; a change says what saves it.
 */
export function saveFailureLine(f: { kind: RankerErrorKind; retrying: boolean }, saved: Pick<SavedRanking, "status"> | null, dirty: boolean): string {
  return saved?.status === "replaced" && !dirty ? countAgainFailureText(f) : saveFailureText(f, saved !== null);
}

/** Said once in the live region (and shown above the list until the next change) when another tab changed the list. */
export const ELSEWHERE_COPY = {
  updated: "Showing the list saved in another tab.",
  deleted: "Your list was deleted.",
} as const;

/** What the status line under the list needs to know. */
export type AutosaveInput = {
  length: number;
  /** The saved list (null: none). */
  saved: Pick<SavedRanking, "status" | "countsFrom" | "inBoard"> | null;
  /** The list on the card differs from the saved one. */
  dirty: boolean;
  /** A save is waiting (the 2 s pause) or on its way. */
  saving: boolean;
  /** The last save failed: why, and whether it will be tried again by itself. */
  failure: { kind: RankerErrorKind; retrying: boolean } | null;
  /** Why the list can't be saved as it is (too short, a burger gone), or null. */
  problem: ListProblem | null;
  /** The list was just deleted (and nothing added since). */
  deleted: boolean;
  /** The burgers couldn't be loaded: a change can't be saved until they are. */
  menusFailed: boolean;
  /** A check of the saved list couldn't reach the backend and is asked again (a change waits for its answer). */
  checkRetrying?: boolean;
};

/**
 * The status line under the list (DESIGN.md "The ranker hero"): a failure first (with the warning icon), then a burger
 * that left the Burger Index, then what's still needed ("Add 2 more to save your list."; with a saved list "Add 1 more to
 * save your changes. Your saved list is unchanged."), then a change held by a check of the saved list that can't reach
 * the counter (in a save failure's words), then "Saving…", then what the saved list counts for; a change that
 * can't go yet says so ("Your changes save once the burgers load.", else "Saving…"), never an empty line.
 */
export function autosaveLine(s: AutosaveInput, today: string): { text: string; alert: boolean } {
  if (s.failure) return { text: saveFailureLine(s.failure, s.saved, s.dirty), alert: true };
  if (s.problem === "gone") {
    if (s.saved && !s.dirty) return { text: savedStatusText(s.saved, today, true), alert: false };
    return { text: `Remove the burgers no longer on the Burger Index to save your ${s.saved ? "changes" : "list"}.`, alert: true };
  }
  if (s.length < MIN_ITEMS) {
    if (s.length === 0 && s.deleted) return { text: "Your list was deleted.", alert: false };
    if (s.saved) return { text: `Add ${MIN_ITEMS - s.length} more to save your changes. Your saved list is unchanged.`, alert: false };
    if (s.length === 0) return { text: `Add at least ${MIN_ITEMS} burgers, your favorite first.`, alert: false };
    return { text: `Add ${MIN_ITEMS - s.length} more to save your list.`, alert: false };
  }
  // A change waiting for a check that can't reach the backend: the same words as a save that couldn't.
  if (s.dirty && s.checkRetrying) return { text: saveFailureText({ kind: "network", retrying: true }, s.saved !== null), alert: true };
  if (s.saving) return { text: "Saving…", alert: false };
  if (s.saved && !s.dirty) return { text: savedStatusText(s.saved, today), alert: false };
  // A change that can't go yet is never left unsaid: without the burgers it waits for them (the search says why);
  // otherwise it goes by itself once the burgers or the saved list are in, or its check is answered.
  if (s.dirty && s.menusFailed) return { text: `Your ${s.saved ? "changes save" : "list saves"} once the burgers load.`, alert: false };
  if (s.dirty) return { text: "Saving…", alert: false };
  return { text: "", alert: false };
}

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
  unknown_burger: "One of those burgers isn't on the Burger Index. Remove it to save your list.",
  duplicate: "Each burger can be on your list only once.",
  invalid: "That list doesn't look right. Reload the page and try again.",
  network: "Couldn't reach the counter. Check your connection and try again.",
  not_deleted: "This list can't be deleted.",
  disabled: "Lists open soon.",
  unknown: "Something went wrong. Try again.",
};

/** When the saved list couldn't be loaded. */
export const MINE_FAILED_COPY = "Couldn't load your saved list.";
