// The People's Price snapshot (user decision 2026-09-25: crawlers must see the crowd's numbers). Pure and
// client-safe.
//
// data/peoples_price.json holds every answered menu's histogram as of one moment (`generated_at`). It is
// written by scripts/snapshot-peoples-price.mjs, committed to main once a day by
// .github/workflows/peoples-price.yml (which redeploys the site) and read at build time, so restaurant pages,
// /best-burgers and /peoples-price carry the crowd's numbers in their static HTML; the live code
// (lib/worth-store) takes over in the browser once it has loaded the current ones. A missing, empty or broken
// snapshot never fails the build: the pages then fall back to the live numbers only.
//
// The rendering rules (DESIGN.md "People's Price in the static HTML"):
// - a menu with a verdict's worth of answers (MIN_VERDICT_ANSWERS, 3) gets the sentence "People's Price $22 from
//   14 answers, as of Sep 25, 2026." (the date is the snapshot's; live numbers drop it);
// - with fewer answers each place keeps its existing wording ("$30 · 2 answers", "No answers yet").
// - "Best value burgers" (BEST_VALUE_PATH) exists only once BEST_VALUE_MIN_VERDICTS menus have a verdict.
import { formatDate, formatPrice, pluralize, theBurger } from "./format";
import {
  buildWorthBoards,
  formatDollars,
  histCount,
  histMedian,
  isMenuKey,
  isValidAnswer,
  MIN_VERDICT_ANSWERS,
  peoplesPrice,
  type Hist,
  type WorthRow,
} from "./worth";

export const SNAPSHOT_VERSION = 1;

/** One menu's answers in the snapshot. */
export type SnapshotMenu = { answers: number; median: number; hist: Hist };

export type PeoplesPriceSnapshot = {
  /** When the numbers were read (ISO); null when there is no snapshot, and then `menus` is empty. */
  generatedAt: string | null;
  /** Answered menus only: a menu that isn't here had no answers as of `generatedAt`. */
  menus: ReadonlyMap<string, SnapshotMenu>;
};

export const EMPTY_SNAPSHOT: PeoplesPriceSnapshot = { generatedAt: null, menus: new Map() };

/**
 * The snapshot file's contents, checked. Anything that isn't a version-1 snapshot with a date gives the empty
 * snapshot; an entry that doesn't check out (a bad key, a bad cell, a count or median that doesn't match its
 * histogram) is dropped and named in `problems`. With `known` (the dataset's menu keys), other keys are
 * dropped quietly: a menu that left the dataset.
 */
export function parseSnapshot(raw: unknown, known?: ReadonlySet<string>): { snapshot: PeoplesPriceSnapshot; problems: string[]; unknown: number } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { snapshot: EMPTY_SNAPSHOT, problems: ["not a snapshot"], unknown: 0 };
  const { version, generated_at, menus } = raw as Record<string, unknown>;
  if (version !== SNAPSHOT_VERSION) return { snapshot: EMPTY_SNAPSHOT, problems: [`version ${String(version)}, expected ${SNAPSHOT_VERSION}`], unknown: 0 };
  if (generated_at === null) return { snapshot: EMPTY_SNAPSHOT, problems: [], unknown: 0 };
  if (typeof generated_at !== "string" || Number.isNaN(Date.parse(generated_at))) {
    return { snapshot: EMPTY_SNAPSHOT, problems: [`generated_at ${JSON.stringify(generated_at)} is not a date`], unknown: 0 };
  }
  if (!menus || typeof menus !== "object" || Array.isArray(menus)) return { snapshot: EMPTY_SNAPSHOT, problems: ["menus is not an object"], unknown: 0 };

  const out = new Map<string, SnapshotMenu>();
  let unknown = 0;
  for (const [key, entry] of Object.entries(menus as Record<string, unknown>)) {
    if (!isMenuKey(key)) {
      problems.push(`${JSON.stringify(key)} is not a menu key`);
      continue;
    }
    if (known && !known.has(key)) {
      unknown += 1;
      continue;
    }
    const menu = parseEntry(entry);
    if (typeof menu === "string") problems.push(`${key}: ${menu}`);
    else out.set(key, menu);
  }
  return { snapshot: { generatedAt: generated_at, menus: out }, problems, unknown };
}

function parseEntry(entry: unknown): SnapshotMenu | string {
  if (!entry || typeof entry !== "object") return "not an object";
  const { answers, median, hist } = entry as Record<string, unknown>;
  if (!hist || typeof hist !== "object" || Array.isArray(hist)) return "no hist";
  const h = new Map<number, number>();
  for (const [d, n] of Object.entries(hist as Record<string, unknown>)) {
    const dollars = Number(d);
    if (!/^\d+$/.test(d) || !isValidAnswer(dollars)) return `answer ${JSON.stringify(d)} is not a whole dollar amount from $5 to $75`;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return `the count for $${d} is not a positive whole number`;
    h.set(dollars, n);
  }
  if (!h.size) return "no answers";
  if (answers !== histCount(h)) return `answers ${String(answers)} does not match its histogram (${histCount(h)})`;
  if (median !== histMedian(h)) return `median ${String(median)} does not match its histogram (${histMedian(h)})`;
  return { answers: histCount(h), median: histMedian(h) as number, hist: h };
}

// ---- one menu ------------------------------------------------------------------------------------

/**
 * A menu's People's Price as a page prints it: the People's Price (null with no answers) and the answer count,
 * with the snapshot's date, or null for the live numbers. Plain data, so it can be a client component's prop.
 */
export type PeoplesPriceFigures = { people: number | null; answers: number; asOf: string | null };

/**
 * One menu's figures in the snapshot (no answers when it isn't there), or null when there is no snapshot: the
 * pages then show only what loads live.
 */
export function snapshotFigures(s: PeoplesPriceSnapshot, menuKey: string): PeoplesPriceFigures | null {
  if (s.generatedAt === null) return null;
  const m = s.menus.get(menuKey);
  return { people: m ? peoplesPrice(m.median) : null, answers: m?.answers ?? 0, asOf: s.generatedAt };
}

/** Live figures from a loaded histogram (no date: they are current). */
export function liveFigures(hist: Hist | undefined): PeoplesPriceFigures {
  const h = hist ?? new Map<number, number>();
  return { people: peoplesPrice(histMedian(h)), answers: histCount(h), asOf: null };
}

/** Whether the figures get the People's Price sentence: a People's Price from a verdict's worth of answers. */
export function hasPeoplesPriceSentence(f: PeoplesPriceFigures | null): f is PeoplesPriceFigures & { people: number } {
  return f !== null && f.people !== null && f.answers >= MIN_VERDICT_ANSWERS;
}

/** "as of Sep 25, 2026" (the New York day of the snapshot). */
export function asOfText(iso: string): string {
  return `as of ${formatDate(iso)}`;
}

/**
 * "People's Price $22 from 14 answers, as of Sep 25, 2026." (from the snapshot) or "People's Price $23 from 15
 * answers." (live). Only for figures with a sentence (hasPeoplesPriceSentence).
 */
export function peoplesPriceSentence(f: PeoplesPriceFigures & { people: number }): string {
  return `People's Price ${formatDollars(f.people)} from ${pluralize(f.answers, "answer")}${f.asOf ? `, ${asOfText(f.asOf)}` : ""}.`;
}

// ---- every menu (the board) ----------------------------------------------------------------------------

/** Histograms as plain arrays, `[menu key, [[dollars, answers], …]]`, so a page can hand them to the board. */
export type HistEntries = Array<[string, Array<[number, number]>]>;

/** The snapshot's histograms of `keys` (the page's menus), as plain arrays. */
export function snapshotHistEntries(s: PeoplesPriceSnapshot, keys: readonly string[]): HistEntries {
  const out: HistEntries = [];
  for (const key of new Set(keys)) {
    const m = s.menus.get(key);
    if (m) out.push([key, [...m.hist].sort((a, b) => a[0] - b[0])]);
  }
  return out;
}

export function histsFromEntries(entries: HistEntries): Map<string, Hist> {
  return new Map(entries.map(([key, cells]) => [key, new Map(cells)]));
}

/** Snapshot histograms of every menu it has (menu key -> histogram). */
export function snapshotHists(s: PeoplesPriceSnapshot): Map<string, Hist> {
  return new Map([...s.menus].map(([k, m]) => [k, m.hist]));
}

// ---- best value burgers ------------------------------------------------------------------------------

export const BEST_VALUE_PATH = "/best-value-burgers";
export const BEST_VALUE_NAME = "Best value burgers in NYC";
/** Menus with a verdict (3+ answers) before the page exists; below it there is no page, link or sitemap entry. */
export const BEST_VALUE_MIN_VERDICTS = 10;
/** How far (percent, as the verdict rounds it) the People's Price must be above the menu price to make the list. */
export const BEST_VALUE_MIN_GAP = 10;

export type BestValue<M> = {
  /** menus with a verdict (the page needs BEST_VALUE_MIN_VERDICTS) */
  verdicts: number;
  /** menus whose People's Price is BEST_VALUE_MIN_GAP% or more above the menu price, widest gap first; ties share a rank */
  rows: WorthRow<M>[];
  /** the snapshot's date */
  asOf: string;
};

/**
 * The best-value list from the snapshot: `menus` (the dataset's distinct priced menus, a chain once) whose
 * People's Price is BEST_VALUE_MIN_GAP% or more above the menu price ("A bargain by 10%" or more), ranked like the
 * People's Price board's bargains. Null, so no page, until BEST_VALUE_MIN_VERDICTS menus have a verdict.
 */
export function bestValue<M extends { key: string; name: string; price: number }>(menus: readonly M[], s: PeoplesPriceSnapshot): BestValue<M> | null {
  if (s.generatedAt === null) return null;
  const boards = buildWorthBoards(menus, snapshotHists(s));
  if (boards.indexMenus < BEST_VALUE_MIN_VERDICTS) return null;
  const rows = boards.bargains.filter((r) => Math.round(r.verdict.gap ?? 0) >= BEST_VALUE_MIN_GAP);
  return { verdicts: boards.indexMenus, rows, asOf: s.generatedAt };
}

/**
 * The page's answer-first lede: "Visitors would pay $31 for the Smash Burger at Emily, 29% more than its $24.00
 * menu price (People's Price as of Sep 25, 2026)."
 */
export function bestValueLede<M extends { name: string; burger: string; price: number }>(bv: BestValue<M>): string {
  const top = bv.rows[0];
  const date = formatDate(bv.asOf);
  if (!top || top.people === null) return `No burger's People's Price is ${BEST_VALUE_MIN_GAP}% or more above its menu price yet (as of ${date}).`;
  const pct = Math.round(top.verdict.gap ?? 0);
  return `Visitors would pay ${formatDollars(top.people)} for ${theBurger(top.burger)} at ${top.name}, ${pct}% more than its ${formatPrice(top.price, { cents: "always" })} menu price (People's Price as of ${date}).`;
}
