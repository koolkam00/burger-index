// "What's it worth?" (DESIGN.md "WorthPicker" and "The People's Price page"): pure, client-safe helpers.
//
// Visitors say, in whole dollars from $5 to $75, what they would pay for a menu's burger (one answer
// per browser, changeable). The backend (supabase/README.md) keeps the answers private and publishes
// a histogram per menu (burger_worth_hist: menu_key, dollars, votes). Everything the site shows is
// computed from that histogram here:
//
// - the People's Price: the median answer, rounded to whole dollars (half up);
// - the verdict against the menu price, from the gap between the two, measured from the smaller
//   one (so "A bargain by 25%" means the People's Price is 25% above the menu price, and
//   "Overpriced by 25%" means the menu price is 25% above the People's Price); under 5% either way
//   is "Right on the money", and a menu needs 3 answers before it gets a verdict;
// - the People's Burger Index: the median of the People's Prices of menus with at least 3 answers;
// - the boards (biggest bargains, most overpriced, most answered).
//
// None of this is ever explained on the site (DESIGN.md "No methodology copy").
//
// A menu is the site's distinct menu (./menus menuKey): a restaurant id, or "chain:<slug>" for a
// chain, whose locations share one menu, one burger and so one entry here.
import { normalize, queryTokens } from "./explorer";
import { formatCount, pluralize } from "./format";
import { pricedMenus } from "./menus";
import type { Borough, Restaurant } from "./schema";

export const ANSWER_MIN = 5;
export const ANSWER_MAX = 75;
/** Where the slider starts before a visitor has answered: the middle, never the menu price. */
export const ANSWER_START = 40;
/** Answers a menu needs before it gets a verdict (and a place in the People's Burger Index). */
export const MIN_VERDICT_ANSWERS = 3;
/** A gap under this many percent is "Right on the money". */
export const EVEN_PCT = 5;

/** A whole number of dollars from 5 to 75 (the only answers the backend accepts: no cents, no strings). */
export function isValidAnswer(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= ANSWER_MIN && v <= ANSWER_MAX;
}

/** Same pattern as the database check on burger_worth.menu_key. */
export const MENU_KEY_PATTERN = /^(chain:)?[a-z0-9-]{1,120}$/;

export function isMenuKey(v: unknown): v is string {
  return typeof v === "string" && MENU_KEY_PATTERN.test(v);
}

/** "$29": a whole-dollar amount (answers, People's Prices). */
export function formatDollars(n: number): string {
  return `$${formatCount(Math.round(n))}`;
}

// ---- histograms --------------------------------------------------------------------------------

/**
 * One row of the public burger_worth_hist table: how many visitors answered `dollars` for a menu.
 * `at` is its updated_at in epoch ms (null when the source doesn't carry it), used to drop stale copies.
 */
export type HistRow = { menu_key: string; dollars: number; votes: number; at: number | null };

/** A menu's answers: dollars -> how many visitors gave that answer (only positive counts). */
export type Hist = ReadonlyMap<number, number>;

/**
 * A burger_worth_hist row from the network (REST or a realtime payload), checked: a menu key, a valid
 * answer and a whole, non-negative count. Anything else is null. A count of 0 is kept (the caller
 * treats it as "no answers here"); the database deletes such rows.
 */
export function parseHistRow(v: unknown): HistRow | null {
  if (!v || typeof v !== "object") return null;
  const { menu_key, dollars, votes, updated_at } = v as Record<string, unknown>;
  if (!isMenuKey(menu_key) || !isValidAnswer(dollars)) return null;
  if (typeof votes !== "number" || !Number.isInteger(votes) || votes < 0) return null;
  const at = typeof updated_at === "string" ? Date.parse(updated_at) : NaN;
  return { menu_key, dollars, votes, at: Number.isFinite(at) ? at : null };
}

/** Group rows into one histogram per menu (rows with no answers left out; a repeated cell: the last wins). */
export function histsFromRows(rows: Iterable<Pick<HistRow, "menu_key" | "dollars" | "votes">>): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const r of rows) {
    let h = out.get(r.menu_key);
    if (!h) out.set(r.menu_key, (h = new Map()));
    if (r.votes > 0) h.set(r.dollars, r.votes);
    else h.delete(r.dollars);
  }
  for (const [k, h] of out) if (h.size === 0) out.delete(k);
  return out;
}

/** Valid (answer, count) pairs, lowest answer first. */
function cells(hist: Iterable<readonly [number, number]>): Array<[number, number]> {
  return [...hist].filter(([d, n]) => isValidAnswer(d) && Number.isInteger(n) && n > 0).sort((a, b) => a[0] - b[0]) as Array<[number, number]>;
}

/** How many answers a histogram holds. */
export function histCount(hist: Iterable<readonly [number, number]>): number {
  return cells(hist).reduce((n, [, c]) => n + c, 0);
}

/**
 * The median answer (the middle one, or the mean of the two middle ones: the database's
 * percentile_cont(0.5)), or null with no answers.
 */
export function histMedian(hist: Iterable<readonly [number, number]>): number | null {
  const list = cells(hist);
  const n = list.reduce((s, [, c]) => s + c, 0);
  if (n === 0) return null;
  const at = (pos: number): number => {
    // pos is 0-based
    let seen = 0;
    for (const [d, c] of list) {
      seen += c;
      if (pos < seen) return d;
    }
    return list[list.length - 1][0];
  };
  return n % 2 === 1 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
}

/** The lowest and highest answers, or null with none. */
export function histRange(hist: Iterable<readonly [number, number]>): { lo: number; hi: number } | null {
  const list = cells(hist);
  return list.length ? { lo: list[0][0], hi: list[list.length - 1][0] } : null;
}

/** The People's Price: the median answer rounded to whole dollars, half up ($16.50 -> $17). */
export function peoplesPrice(median: number | null): number | null {
  return median === null ? null : Math.floor(median + 0.5);
}

// ---- $5 buckets (the answer distribution) ---------------------------------------------------------

export const BUCKET_WIDTH = 5;
/** $5–$9, $10–$14, … $65–$69, then $70–$75 (the top bucket takes $75 too). */
export const BUCKET_COUNT = (ANSWER_MAX - ANSWER_MIN) / BUCKET_WIDTH;

/** The bucket an answer falls in (0 = $5–$9 … 13 = $70–$75). */
export function bucketIndex(dollars: number): number {
  const i = Math.floor((dollars - ANSWER_MIN) / BUCKET_WIDTH);
  return Math.min(BUCKET_COUNT - 1, Math.max(0, i));
}

export type Bucket = { index: number; lo: number; hi: number; label: string; count: number };

export function bucketBounds(index: number): { lo: number; hi: number } {
  const lo = ANSWER_MIN + index * BUCKET_WIDTH;
  return { lo, hi: index === BUCKET_COUNT - 1 ? ANSWER_MAX : lo + BUCKET_WIDTH - 1 };
}

/** "$5–$9" … "$70–$75". */
export function bucketLabel(index: number): string {
  const { lo, hi } = bucketBounds(index);
  return `${formatDollars(lo)}–${formatDollars(hi)}`;
}

/** Every bucket, low to high, with how many answers fall in it (empty ones included). */
export function bucketAnswers(hist: Iterable<readonly [number, number]>): Bucket[] {
  const counts = new Array<number>(BUCKET_COUNT).fill(0);
  for (const [d, c] of cells(hist)) counts[bucketIndex(d)] += c;
  return counts.map((count, index) => ({ index, ...bucketBounds(index), label: bucketLabel(index), count }));
}

/**
 * Where a price sits on the distribution's $5–$75 axis, from 0 (left edge) to 1 (right edge): the
 * buckets are equal-width, $5 each, so this is linear. Prices off the axis are pinned to its ends.
 */
export function axisPosition(price: number): number {
  return Math.min(1, Math.max(0, (price - ANSWER_MIN) / (ANSWER_MAX - ANSWER_MIN)));
}

// ---- verdicts ----------------------------------------------------------------------------------

export type VerdictKind = "bargain" | "overpriced" | "even" | "pending";

export type Verdict = {
  kind: VerdictKind;
  /**
   * The signed gap in percent: positive when the People's Price is above the menu price (a bargain),
   * negative when below (overpriced); measured from the smaller of the two. Null while pending.
   */
  gap: number | null;
  label: string;
};

/**
 * The gap between the People's Price and the menu price in percent, measured from the smaller of the
 * two: +25 when the People's Price is 25% above the menu price, −25 when the menu price is 25% above
 * the People's Price.
 */
export function gapPct(people: number, menu: number): number {
  if (!(people > 0) || !(menu > 0)) return 0;
  return people >= menu ? (people / menu - 1) * 100 : -(menu / people - 1) * 100;
}

const EPS = 1e-9;

/**
 * The verdict for a menu: its People's Price (whole dollars) against the menu price, once it has
 * MIN_VERDICT_ANSWERS answers ("Needs a few more answers" before that).
 */
export function verdictFor(people: number | null, menu: number | null, answers: number, minAnswers: number = MIN_VERDICT_ANSWERS): Verdict {
  if (people === null || menu === null || !(menu > 0) || answers < minAnswers) return { kind: "pending", gap: null, label: "Needs a few more answers" };
  const gap = gapPct(people, menu);
  const size = Math.abs(gap);
  if (size < EVEN_PCT - EPS) return { kind: "even", gap, label: "Right on the money" };
  const pct = Math.round(size);
  return gap > 0 ? { kind: "bargain", gap, label: `A bargain by ${pct}%` } : { kind: "overpriced", gap, label: `Overpriced by ${pct}%` };
}

/** Everything the site shows about one menu's answers. */
export type WorthSummary = {
  answers: number;
  /** the exact median answer (null with no answers) */
  median: number | null;
  /** the People's Price: the median rounded to whole dollars */
  people: number | null;
  verdict: Verdict;
};

export function summarize(hist: Hist | undefined, menuPrice: number | null): WorthSummary {
  const h = hist ?? new Map<number, number>();
  const answers = histCount(h);
  const median = histMedian(h);
  const people = peoplesPrice(median);
  return { answers, median, people, verdict: verdictFor(people, menuPrice, answers) };
}

/**
 * What a screen reader hears once the visitor's answer is saved: "People's Price $26, 9 answers.
 * Right on the money." (numbers and labels only). Empty with no answers.
 */
export function worthAnnouncement(s: WorthSummary): string {
  if (s.people === null || s.answers === 0) return "";
  return `People's Price ${formatDollars(s.people)}, ${pluralize(s.answers, "answer")}. ${s.verdict.label}.`;
}

// ---- menus -------------------------------------------------------------------------------------

/** A menu as the People's Price shows it: its burger, where it is, and the page to link to. */
export type WorthMenu = {
  /** menu key (restaurant id, or "chain:<slug>") */
  key: string;
  /** restaurant id of the row that stands for the menu (a chain: its first priced location) */
  id: string;
  name: string;
  burger: string;
  /** the menu price: the menu's index price (its one burger's price) */
  price: number;
  /** null for a chain (it has many locations) or a restaurant without one */
  neighborhood: string | null;
  borough: Borough;
  /** priced locations sharing the menu (1 for an independent restaurant) */
  locations: number;
};

/**
 * Every distinct priced menu in `list`, once each (a chain once, however many locations), with the
 * burger visitors price: the restaurant's one burger, whose price is its index price.
 */
export function worthMenus(list: readonly Restaurant[]): WorthMenu[] {
  return pricedMenus(list).map(({ key, restaurant: r, chain, indexPrice, locations }) => ({
    key,
    id: r.id,
    name: r.name,
    burger: r.burger.name,
    price: indexPrice,
    neighborhood: chain ? null : r.neighborhood,
    borough: r.borough,
    locations,
  }));
}

/** The link from a board row to the restaurant page, straight to its "What would you pay?" section. */
export const WORTH_ANCHOR = "worth";
export function worthHref(id: string): string {
  return `/restaurants/${id}#${WORTH_ANCHOR}`;
}

// ---- the People's Burger Index and the boards ------------------------------------------------------

type Keyed = { key: string; name: string; price: number };

/** Known menus (first entry per key wins) joined to their histograms; unknown keys are ignored. */
function joined<M extends Keyed>(menus: readonly M[], hists: ReadonlyMap<string, Hist>): Array<{ menu: M; hist: Hist }> {
  const seen = new Set<string>();
  const out: Array<{ menu: M; hist: Hist }> = [];
  for (const m of menus) {
    if (seen.has(m.key)) continue;
    seen.add(m.key);
    const hist = hists.get(m.key);
    if (hist && histCount(hist) > 0) out.push({ menu: m, hist });
  }
  return out;
}

/** The median of a list of numbers (null when empty). */
export function medianOf(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The People's Burger Index: the median of the People's Prices (exact medians) of the menus with at
 * least `minAnswers` answers, each menu once (a chain is one menu); null when none qualifies.
 * Histograms for keys the dataset doesn't know are ignored.
 */
export function peoplesBurgerIndex<M extends Keyed>(
  menus: readonly M[],
  hists: ReadonlyMap<string, Hist>,
  minAnswers: number = MIN_VERDICT_ANSWERS,
): { value: number | null; menus: number } {
  const medians: number[] = [];
  for (const { hist } of joined(menus, hists)) {
    if (histCount(hist) < minAnswers) continue;
    const m = histMedian(hist);
    if (m !== null) medians.push(m);
  }
  return { value: medianOf(medians), menus: medians.length };
}

export type WorthRow<M> = M & WorthSummary & { rank: number | null };

export type WorthBoards<M> = {
  /** menus with a verdict of "a bargain", the widest gap first */
  bargains: WorthRow<M>[];
  /** menus with a verdict of "overpriced", the widest gap first */
  overpriced: WorthRow<M>[];
  /** every answered menu, most answers first */
  mostAnswered: WorthRow<M>[];
  /** answered menus still short of a verdict, most answers first */
  needsAnswers: WorthRow<M>[];
  /** the People's Burger Index (exact; shown rounded) */
  index: number | null;
  /** menus behind the index */
  indexMenus: number;
  /** answers across every known menu */
  answers: number;
  /** known menus with at least one answer */
  answered: number;
};

const byName = <M extends { key: string; name: string }>(a: M, b: M) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Sort by `score` (higher first; equal within EPS ties), then more answers, then name; ties on the score share a rank (1, 2, 2, 4). */
function ranked<M extends { key: string; name: string }>(rows: WorthRow<M>[], score: (r: WorthRow<M>) => number): WorthRow<M>[] {
  const sorted = rows.sort((a, b) => {
    const d = score(b) - score(a);
    return (Math.abs(d) > EPS ? d : 0) || b.answers - a.answers || byName(a, b);
  });
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    r.rank = prev && Math.abs(score(prev) - score(r)) <= EPS ? (prev.rank as number) : i + 1;
  });
  return sorted;
}

/**
 * The live boards: histograms joined to the dataset's menus by menu key. Histograms for keys the
 * dataset doesn't know are ignored, and so are menus with no answers. A menu listed twice counts once
 * (the first entry wins). Menus short of a verdict only appear in "most answered" and "needs answers".
 */
export function buildWorthBoards<M extends Keyed>(menus: readonly M[], hists: ReadonlyMap<string, Hist>, opts: { minAnswers?: number } = {}): WorthBoards<M> {
  const minAnswers = opts.minAnswers ?? MIN_VERDICT_ANSWERS;
  const rows: WorthRow<M>[] = joined(menus, hists).map(({ menu, hist }) => {
    const s = summarize(hist, menu.price);
    return { ...menu, ...s, verdict: verdictFor(s.people, menu.price, s.answers, minAnswers), rank: null };
  });
  const answers = rows.reduce((n, r) => n + r.answers, 0);
  const index = peoplesBurgerIndex(menus, hists, minAnswers);
  const copy = (list: WorthRow<M>[]) => list.map((r) => ({ ...r }));
  return {
    bargains: ranked(
      copy(rows.filter((r) => r.verdict.kind === "bargain")),
      (r) => r.verdict.gap as number,
    ),
    overpriced: ranked(
      copy(rows.filter((r) => r.verdict.kind === "overpriced")),
      (r) => -(r.verdict.gap as number),
    ),
    mostAnswered: ranked(copy(rows), (r) => r.answers),
    needsAnswers: ranked(
      copy(rows.filter((r) => r.answers < minAnswers)),
      (r) => r.answers,
    ),
    index: index.value,
    indexMenus: index.menus,
    answers,
    answered: rows.length,
  };
}

/**
 * Menus matching a search (restaurant, burger, neighborhood or borough; every word must match),
 * restaurant names that start with the query first, then names that contain it, then the rest,
 * each by name.
 */
export function searchWorthMenus<M extends Pick<WorthMenu, "key" | "name" | "burger" | "neighborhood" | "borough">>(menus: readonly M[], query: string): M[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const q = tokens.join(" ");
  const hits: Array<{ m: M; tier: number }> = [];
  for (const m of menus) {
    const name = normalize(m.name);
    const hay = `${name} ${normalize(m.burger)} ${normalize(m.neighborhood ?? "")} ${normalize(m.borough)}`;
    if (!tokens.every((t) => hay.includes(t))) continue;
    hits.push({ m, tier: name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2 });
  }
  return hits.sort((a, b) => a.tier - b.tier || a.m.name.localeCompare(b.m.name) || (a.m.key < b.m.key ? -1 : a.m.key > b.m.key ? 1 : 0)).map((h) => h.m);
}

// ---- errors ----------------------------------------------------------------------------------

export type WorthErrorKind = "rate" | "invalid" | "network" | "disabled" | "unknown";

/** What a failed call means, from a PostgREST / fetch error (SQLSTATE codes from cast_worth). */
export function classifyWorthError(err: unknown): WorthErrorKind {
  if (err && typeof err === "object") {
    const { code, message, name, kind } = err as { code?: unknown; message?: unknown; name?: unknown; kind?: unknown };
    if (kind === "rate" || kind === "invalid" || kind === "network" || kind === "disabled" || kind === "unknown") return kind;
    if (code === "54000") return "rate";
    if (code === "22023" || code === "22P02") return "invalid";
    const text = `${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`;
    if (/fetch|network|load failed|timed? ?out|abort|offline|ECONN|socket/i.test(text)) return "network";
    if (!code) return "network";
  }
  return "unknown";
}

/** When this browser's saved answers couldn't be loaded (the slider can't start at the saved one). */
export const MINE_FAILED_COPY = "Couldn't load your saved answer.";

/**
 * The status line beside "Order up!" (DESIGN.md "WorthPicker"): answers closed, the last failure,
 * sending, saved answers that didn't load, then the visitor's answer (moved and not yet sent, just
 * saved, or saved earlier), else the nudge. The home pricer passes no answer: its burgers are new.
 */
export function worthStatusText(s: {
  enabled: boolean;
  error: WorthErrorKind | null;
  saving: boolean;
  mineFailed: boolean;
  answer: number | null;
  dirty: boolean;
  justSaved: boolean;
}): string {
  if (!s.enabled) return WORTH_ERROR_COPY.disabled;
  if (s.error) return WORTH_ERROR_COPY[s.error];
  if (s.saving) return "Sending your answer…";
  if (s.mineFailed) return MINE_FAILED_COPY;
  if (s.answer !== null) {
    if (s.dirty) return `Your answer: ${formatDollars(s.answer)}. Order up to change it.`;
    return s.justSaved ? `Saved: ${formatDollars(s.answer)}.` : `Your answer: ${formatDollars(s.answer)}.`;
  }
  return "Slide to your price, then order up.";
}

/** Friendly copy for each failure (DESIGN.md "WorthPicker": error states). */
export const WORTH_ERROR_COPY: Record<WorthErrorKind, string> = {
  rate: "Too many answers from this connection — try again in a bit.",
  invalid: "That answer didn't go through. Pick a whole dollar amount from $5 to $75.",
  network: "Couldn't reach the counter. Check your connection and try again.",
  disabled: "Answers open soon.",
  unknown: "Something went wrong saving your answer. Try again.",
};
