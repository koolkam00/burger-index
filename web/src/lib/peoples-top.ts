// The People's Top 10 (user decisions 2026-09-25/26; DESIGN.md "The People's Top 10 page"): the burgers
// ranked highest across the lists (the home ranker's, and the published rankings counted as lists), made once
// a day by the Patty Ladder (src/lib/ladder.mjs, scripts/snapshot-peoples-top.mjs) and committed as data/peoples_top.json
// (before the database's first publication, the published rankings' own board: lib/published-board.mjs). The site
// shows that board's seats, the rest of the ranking, the Rising tier, "Early results" and the "too close to call"
// marks, and while fewer than 10 are seated it fills the top 10 from the same fit (user request 2026-09-27, "count the
// robert top 10 a populatoed peopels list needs to show when i send this to people"; `peoplesTopView`). It never explains any of it beyond the one-liner.
//
// Pure and client-safe: the board file's shape, and the board as the pages show it, joined to the dataset's
// menus. lib/peoples-top-data.ts (server-only) reads the file.
import { formatCount, formatDate, pluralize } from "./format";

/** The page's one method line (user decision 2026-09-26): the only sentence about how the board is made. */
export const PEOPLES_TOP_ONE_LINER =
  "Every list turns into head-to-head wins, with your #1 counting most; a burger you left off never loses, and a burger climbs only as far as enough different lists back it up.";
/** The page's kicker ticket (and its share image's overline). */
export const PEOPLES_TOP_TICKET = "The crew's picks";
/** Seats in the People's Top 10. */
export const SEATS = 10;

export type BoardTier = "ranked" | "rising" | "listed";

/** One row of data/peoples_top.json (scripts/snapshot-peoples-top.mjs ROW_KEYS; the auditors' numbers too). */
export type BoardRow = {
  key: string;
  tier: BoardTier;
  rank: number | null;
  score: number | null;
  theta: number;
  /** The cautious score before the day's step (every row; `score` is the published one, ranked rows only). */
  raw: number;
  lists: number;
  firsts: number;
  networks: number;
  needs: number;
  surging: boolean;
  held: boolean;
  review: boolean;
  closeToNext: boolean | null;
};

/** data/peoples_top.json, as far as the site reads it. */
export type BoardFile = {
  method: string;
  asOf: string | null;
  refreshedAt: string | null;
  totalLists: number;
  gate: number;
  early: boolean;
  top10: string[];
  rows: BoardRow[];
};

/** Before the first board: no lists, nothing ranked, early. */
export const EMPTY_BOARD: BoardFile = { method: "patty-ladder/1", asOf: null, refreshedAt: null, totalLists: 0, gate: 5, early: true, top10: [], rows: [] };

/** The label a flagged row carries: the owner's hold, or a surge under review (FINAL.md section 1). */
export type RowFlag = "held" | "surge" | null;

export type TopEntry<T> = {
  key: string;
  /** 1-based, the seats first. */
  rank: number;
  lists: number;
  firsts: number;
  flag: RowFlag;
  /** Too close to call with the row above it (the "≈" mark). */
  closeToAbove: boolean;
  menu: T;
};

export type RisingEntry<T> = { key: string; lists: number; needs: number; flag: RowFlag; menu: T };

export type PeoplesTopView<T> = {
  asOf: string | null;
  totalLists: number;
  gate: number;
  early: boolean;
  /** The People's Top 10 as shown: the seats, in order, then the fill (fewer than 10 only when fewer qualify). */
  seats: TopEntry<T>[];
  /** The rest of the ranking, numbered after the top 10. */
  rest: TopEntry<T>[];
  /** Burgers on 3+ lists that aren't ranked yet and aren't in the top 10, unnumbered. */
  rising: RisingEntry<T>[];
  /**
   * The top 10 holds burgers the method hasn't seated (the fill): Rising rows then say only their count, since a
   * top 10 row on 2 lists sits above them ("needs 2 more lists" would contradict it).
   */
  filled: boolean;
};

/** A burger fills an open place in the top 10 only with this many lists, from as many networks. */
export const FILL_MIN_LISTS = 2;

const flagOf = (r: Pick<BoardRow, "held" | "review">): RowFlag => (r.held ? "held" : r.review ? "surge" : null);
const keyOrder = (a: BoardRow, b: BoardRow) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byScore = (a: BoardRow, b: BoardRow) => (b.score ?? 0) - (a.score ?? 0) || b.theta - a.theta || keyOrder(a, b);
/** The fill's order: the cautious score (the published one where the row has it), then lists, then strength. */
const cautious = (r: BoardRow) => r.score ?? r.raw;
const byFill = (a: BoardRow, b: BoardRow) => cautious(b) - cautious(a) || b.lists - a.lists || b.theta - a.theta || keyOrder(a, b);

/**
 * Whether a row not seated may fill an open place in the top 10: on 2+ lists from 2+ networks, and not held, under
 * review or surging (a row the method keeps from a new seat, or whose score it froze, never gets one this way).
 */
export function fillsTop(r: BoardRow): boolean {
  return r.lists >= FILL_MIN_LISTS && r.networks >= FILL_MIN_LISTS && !r.held && !r.review && !r.surging;
}

/**
 * The board as the pages show it: only burgers the dataset still has (`menuOf` finds their menu; a
 * restaurant that left the dataset can linger in the file until the next board), numbered in order, the
 * seats first. A seat whose burger left is filled like the method fills an empty seat: the best ranked
 * burger not under review. "≈" marks a row too close to call with the one above it, only where the two
 * are neighbors on the board too.
 */
export function peoplesTopView<T>(board: BoardFile, menuOf: (key: string) => T | undefined): PeoplesTopView<T> {
  const known = board.rows.filter((r) => menuOf(r.key) !== undefined);
  const ranked = known.filter((r) => r.tier === "ranked");
  const byKey = new Map(ranked.map((r) => [r.key, r]));
  const seats = board.top10.filter((k) => byKey.has(k)).map((k) => byKey.get(k) as BoardRow);
  const dropped = board.top10.length - seats.length;
  if (dropped > 0) {
    const fill = ranked.filter((r) => !seats.includes(r) && !r.review && !r.held).slice(0, dropped);
    seats.push(...fill);
    seats.sort(byScore);
  }
  const seated = new Set(seats.map((r) => r.key));
  let filled = false;
  if (seats.length < SEATS) {
    const fill = known.filter((r) => !seated.has(r.key) && fillsTop(r)).sort(byFill).slice(0, SEATS - seats.length);
    seats.push(...fill);
    for (const r of fill) seated.add(r.key);
    filled = fill.length > 0;
  }
  const order = [...seats, ...ranked.filter((r) => !seated.has(r.key))];
  // The file's own neighbors: a row's closeToNext is about the ranked row right after it in the file.
  const fileRanked = board.rows.filter((r) => r.tier === "ranked");
  const nextInFile = new Map(fileRanked.map((r, i) => [r.key, fileRanked[i + 1]?.key ?? null]));
  const entries: TopEntry<T>[] = order.map((r, i) => {
    const above = i > 0 ? order[i - 1] : null;
    return {
      key: r.key,
      rank: i + 1,
      lists: r.lists,
      firsts: r.firsts,
      flag: flagOf(r),
      closeToAbove: above !== null && above.closeToNext === true && nextInFile.get(above.key) === r.key,
      menu: menuOf(r.key) as T,
    };
  });
  return {
    asOf: board.asOf,
    totalLists: board.totalLists,
    gate: board.gate,
    early: board.early,
    seats: entries.slice(0, seats.length),
    rest: entries.slice(seats.length),
    rising: known.filter((r) => r.tier === "rising" && !seated.has(r.key)).map((r) => ({ key: r.key, lists: r.lists, needs: Math.max(1, r.needs), flag: flagOf(r), menu: menuOf(r.key) as T })),
    filled,
  };
}

/**
 * Where a menu stands on the board, as /peoples-top-10 shows it: ranked (`rank`, numbered like the page, the seats
 * first) or Rising (`rising`: its list count). A menu the board doesn't show has none.
 */
export type PeopleStanding = { rank: number } | { rising: number };

/** Every menu the board shows, with its standing (the home ranker reads them from /data/menus.json). */
export function peopleStandings(view: PeoplesTopView<unknown>): Map<string, PeopleStanding> {
  const out = new Map<string, PeopleStanding>();
  for (const e of [...view.seats, ...view.rest]) out.set(e.key, { rank: e.rank });
  for (const e of view.rising) if (!out.has(e.key)) out.set(e.key, { rising: e.lists });
  return out;
}

// ---- words ------------------------------------------------------------------------------------------

/** "On 143 lists · #1 on 27" (a ranked row), "On 1 list" (nobody's #1). */
export function listsText(lists: number, firsts: number): string {
  const on = `On ${pluralize(lists, "list")}`;
  return firsts > 0 ? `${on} · #1 on ${formatCount(firsts)}` : on;
}

/** "On 7 lists · needs 3 more lists" (a Rising row; never "needs 0"). */
export function risingText(lists: number, needs: number): string {
  const n = Math.max(1, needs);
  return `On ${pluralize(lists, "list")} · needs ${formatCount(n)} more ${n === 1 ? "list" : "lists"}`;
}

/**
 * The Rising heading: "Rising: 40 burgers not ranked yet." ("Rising: 1 burger." once the top 10 is filled, whose rows on
 * 2 lists would contradict "not ranked yet").
 */
export function risingHeading(n: number, filled: boolean): string {
  return filled ? `Rising: ${pluralize(n, "burger")}.` : `Rising: ${pluralize(n, "burger")} not ranked yet.`;
}

/** A Rising row's line: "On 7 lists · needs 3 more lists", or only "On 7 lists" once the top 10 is filled. */
export function risingDetail(e: Pick<RisingEntry<unknown>, "lists" | "needs">, filled: boolean): string {
  return filled ? listsText(e.lists, 0) : risingText(e.lists, e.needs);
}

/** A flagged row's label ("Under review", FINAL.md's proposed wording, was approved as is by the user on 2026-09-26). */
export const FLAG_TEXT: Record<Exclude<RowFlag, null>, string> = {
  held: "Under review",
  surge: "Checking a surge of lists",
};

/** The top 10's heading: "The top 10." ("The top 10 so far." while early), "The top 3 so far.", "The top burger so far." */
export function seatsHeading(n: number, early = false): string {
  if (n >= SEATS) return early ? `The top ${SEATS} so far.` : `The top ${SEATS}.`;
  return n === 1 ? "The top burger so far." : `The top ${formatCount(n)} so far.`;
}

/**
 * "The ladder starts when burgers are on 5 lists each (12 lists so far)." (nothing ranked yet). Before the first
 * board (`totalLists` null: no lists have been published yet, though some may be saved) it leaves the count out.
 */
export function ladderStartText(gate: number, totalLists: number | null): string {
  const start = `The ladder starts when burgers are on ${formatCount(gate)} lists each`;
  return totalLists === null ? `${start}.` : `${start} (${pluralize(totalLists, "list")} so far).`;
}

/** "As of Sep 27, 2026" (the last day of lists the board counts), or null before the first board. */
export function asOfText(asOf: string | null): string | null {
  return asOf ? `As of ${formatDate(asOf)}` : null;
}

/**
 * The line under the Top 10 (and on its share image): "From 1,284 lists, as of Sep 27, 2026." Before anything is
 * ranked: when the ladder starts.
 */
export function boardCountLine(view: Pick<PeoplesTopView<unknown>, "seats" | "totalLists" | "gate" | "asOf">): string {
  if (!view.seats.length) return ladderStartText(view.gate, view.asOf ? view.totalLists : null);
  return `From ${pluralize(view.totalLists, "list")}${view.asOf ? `, as of ${formatDate(view.asOf)}` : ""}.`;
}

/**
 * The page's answer-first lede: "Emily tops the People's Top 10: on 143 lists, #1 on 27 of them (as of Sep 27,
 * 2026)." (`top`: the first seat's restaurant and counts). Before anything is ranked: what the page is.
 */
export function peoplesTopLede(top: { name: string; lists: number; firsts: number } | null, asOf: string | null): string {
  if (!top) return "The burgers ranked highest across the lists on The Burger Index.";
  const firsts = top.firsts > 0 ? `, #1 on ${formatCount(top.firsts)} of them` : "";
  const when = asOf ? ` (as of ${formatDate(asOf)})` : "";
  return `${top.name} tops the People's Top 10: on ${pluralize(top.lists, "list")}${firsts}${when}.`;
}
