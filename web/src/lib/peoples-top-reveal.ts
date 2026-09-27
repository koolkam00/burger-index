// The People's Top 10 beside the home ranker's list (user decision 2026-09-26, "Once 3 are added"; DESIGN.md
// "The ranker hero", "The People's Top 10 beside your list"): as soon as the visitor's list (being built, or
// saved) holds 3 burgers, the card shows the daily board's seats next to it (below it on a phone), the
// visitor's picks on it marked, and where the rest of their picks stand. Below 3 it hides again.
//
// Pure and client-safe. The home page passes the ranker a RevealBoard (the seats and the board's numbers,
// never the whole board file); every other menu's standing rides along in /data/menus.json (lib/menu-list),
// which the ranker loads anyway. Nothing here recomputes the board or explains it (the page's one-liner does).
import { formatCount, formatDate, pluralize } from "./format";
import type { PeopleStanding, PeoplesTopView, RowFlag } from "./peoples-top";
import { MIN_ITEMS, type RankingStatus } from "./ranker";

/** The list length at which the People's Top 10 shows beside it: the fewest burgers a list can be saved with. */
export const REVEAL_AT = MIN_ITEMS;

/** Whether a list of `length` burgers shows the People's Top 10 beside it. */
export function showsReveal(length: number): boolean {
  return length >= REVEAL_AT;
}

/** One seat as the ranker shows it: the page's row less its counts and price. */
export type RevealSeat = {
  key: string;
  /** 1-based, as /peoples-top-10 numbers it. */
  rank: number;
  /** The restaurant (a chain's usual location). */
  name: string;
  burger: string;
  /** "Astoria, Queens" / "5 locations". */
  where: string;
  flag: RowFlag;
  /** Too close to call with the seat above (the "≈" mark). */
  closeToAbove: boolean;
};

/** What the home page hands the ranker: the seats and the board's numbers. */
export type RevealBoard = {
  asOf: string | null;
  totalLists: number;
  gate: number;
  early: boolean;
  seats: RevealSeat[];
};

/** The board's seats and numbers, each seat named from its menu (lib/peoples-top-data does this at build). */
export function revealBoard<T>(view: PeoplesTopView<T>, describe: (menu: T) => { name: string; burger: string; where: string }): RevealBoard {
  return {
    asOf: view.asOf,
    totalLists: view.totalLists,
    gate: view.gate,
    early: view.early,
    seats: view.seats.map((e) => ({ key: e.key, rank: e.rank, ...describe(e.menu), flag: e.flag, closeToAbove: e.closeToAbove })),
  };
}

/** A seat as the reveal shows it: `yours` is its place on the visitor's list (1-based), or null. */
export type RevealRow = RevealSeat & { yours: number | null };

/** Where one of the visitor's other picks stands: "Your #3, Emily" and "#27 on the People's Top 10". */
export type StandLine = { key: string; who: string; stand: string };

/** The visitor's list as it counts toward the board (the empty board's last sentence follows it). */
export type YourList = "counting" | "unsaved" | "replaced" | "recounting" | "not_counted";

/**
 * What the visitor's list does for the board, from the saved list's status (none: nothing saved) and whether the list on
 * the card differs from it (`edited`). A saved list keeps counting while it is being edited, so an edit in progress
 * doesn't change it: active → counting; none → unsaved (it saves itself once it holds 3); replaced (a newer list from
 * this connection counts instead) → replaced as it is (it counts again only with "Count it again"; `recounting` while that
 * save waits, an hourly wait included, or is on its way), unsaved once edited (the change saves itself and counts); void or
 * deleted → not counted.
 */
export function yourList(status: RankingStatus | null | undefined, edited = false, recounting = false): YourList {
  if (status === "active") return "counting";
  if (status === "replaced") return edited ? "unsaved" : recounting ? "recounting" : "replaced";
  if (!status) return "unsaved";
  return "not_counted";
}

/** A picked burger as the reveal needs it: its name (the ranker's label) and its standing, if any. */
export type RevealPick = { label: string; people: PeopleStanding | null };

export type RevealView = {
  /** The seats, in order, the visitor's picks marked. Empty: nothing ranked yet. */
  rows: RevealRow[];
  /** "Early results": while the board is early (under 500 lists), the empty board too, as on /peoples-top-10. */
  early: boolean;
  /** "From 260 lists, as of Sep 30, 2026." under the rows (null without rows). */
  countLine: string | null;
  /** The empty board's words (null with rows). */
  empty: string | null;
  /** A row carries "≈": the legend goes under the rows. */
  closeLegend: boolean;
  /** "Your other picks" (some pick is a seat) or "Your picks"; null without stand-lines. */
  standsLabel: string | null;
  stands: StandLine[];
};

/** What the visitor's list does for an empty board. */
const HELP_TEXT: Record<YourList, string> = {
  counting: "Your list helps start it.",
  unsaved: "Your list helps start it once saved.",
  replaced: "Count it again to help start it.",
  recounting: "Your list helps start it once it counts again.",
  not_counted: "",
};

/**
 * "No People's Top 10 yet: it starts when burgers are on 5 lists each (12 lists so far). Your list helps start it once
 * saved." Before the first board (`asOf` null: no lists published yet, though some may be saved) the count is left out,
 * as on /peoples-top-10.
 */
export function revealEmptyText(board: Pick<RevealBoard, "gate" | "totalLists" | "asOf">, you: YourList): string {
  const count = board.asOf ? ` (${pluralize(board.totalLists, "list")} so far)` : "";
  const help = HELP_TEXT[you];
  return `No People's Top 10 yet: it starts when burgers are on ${formatCount(board.gate)} lists each${count}.${help ? ` ${help}` : ""}`;
}

/** "#27 on the People's Top 10", "Rising · on 4 lists" or "Not ranked yet". */
export function standText(people: PeopleStanding | null): string {
  if (!people) return "Not ranked yet";
  if ("rank" in people) return `#${formatCount(people.rank)} on the People's Top 10`;
  return `Rising · on ${pluralize(people.rising, "list")}`;
}

/**
 * The reveal for `list` (best first): the seats with the visitor's picks marked ("#2 on your list"), then where each
 * other pick stands, in the visitor's order. `pick` names a burger and gives its standing; null while the burgers
 * load (the stand-lines wait for them; a burger that left the Burger Index has none and is skipped, since its row
 * says so). Stand-lines show once the board ranks anything, or when a pick is Rising on an empty board.
 */
export function revealView(board: RevealBoard, list: readonly string[], pick: ((key: string) => RevealPick | undefined) | null, you: YourList): RevealView {
  const place = new Map(list.map((k, i) => [k, i + 1]));
  const rows: RevealRow[] = board.seats.map((s) => ({ ...s, yours: place.get(s.key) ?? null }));
  const seated = new Set(board.seats.map((s) => s.key));
  const others = pick
    ? list.flatMap((key, i) => {
        if (seated.has(key)) return [];
        const p = pick(key);
        return p ? [{ key, position: i + 1, ...p }] : [];
      })
    : [];
  const showStands = others.length > 0 && (rows.length > 0 || others.some((o) => o.people !== null));
  const stands = showStands ? others.map((o) => ({ key: o.key, who: `Your #${o.position}, ${o.label}`, stand: standText(o.people) })) : [];
  return {
    rows,
    early: board.early,
    countLine: rows.length ? `From ${pluralize(board.totalLists, "list")}${board.asOf ? `, as of ${formatDate(board.asOf)}` : ""}.` : null,
    empty: rows.length ? null : revealEmptyText(board, you),
    closeLegend: rows.some((r) => r.closeToAbove),
    standsLabel: stands.length ? (rows.some((r) => r.yours !== null) ? "Your other picks" : "Your picks") : null,
    stands,
  };
}

/**
 * What the live region adds when the reveal first shows after a change the visitor made: that the People's Top 10 now
 * shows after the list, or, before anything is seated, that it hasn't started (the words after the list say when).
 */
export function revealAnnouncement(board: Pick<RevealBoard, "seats">): string {
  return board.seats.length ? "The People's Top 10 now shows after your list." : "The People's Top 10 hasn't started yet: see after your list.";
}
