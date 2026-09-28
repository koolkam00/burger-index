// Server-only: the People's Top 10 board, src/data/peoples_top.json (copied from ../data/peoples_top.json by
// scripts/sync-data.mjs, which writes the empty early board when the file is missing or broken), read and
// checked once per build worker and joined to the dataset's menus (lib/peoples-top.ts has the rules). Before the
// database's first publication (a board without rows or date) it is the published rankings' own board instead
// (lib/published-board.mjs, from src/data/ranker_published_lists.json, which sync-data copies and checks). It never
// fails the build: a board that doesn't check out is the empty one, with a warning.
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPricedRestaurants } from "./data";
import { menuWhere, pricedMenus, type Menu } from "./menus";
import { EMPTY_BOARD, peopleStandings, peoplesTopView, type BoardFile, type PeopleStanding, type PeoplesTopView } from "./peoples-top";
import { revealBoard, type RevealBoard } from "./peoples-top-reveal";
import { parseBoardFile } from "./peoples-top-schema";
import { siteBoard as siteBoardOf } from "./published-board.mjs";

const FILE = join(process.cwd(), "src", "data", "peoples_top.json");
const PUBLISHED_FILE = join(process.cwd(), "src", "data", "ranker_published_lists.json");

function load(): BoardFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return EMPTY_BOARD; // sync-data writes the empty board, so this is a build without sync-data
  }
  const parsed = parseBoardFile(raw);
  if (!parsed.ok) {
    console.warn(`! src/data/peoples_top.json doesn't check out; the pages show the empty board:\n${parsed.problem}`);
    return EMPTY_BOARD;
  }
  return parsed.board;
}

/**
 * The board the pages show (lib/published-board.mjs `siteBoard`): the committed one once the database has published
 * one, else the published rankings' board (if any); either way a row's "#1 on N" counts only lists whose own No. 1 it is.
 */
function siteBoard(): BoardFile {
  const committed = load();
  let published: unknown = null;
  try {
    published = JSON.parse(readFileSync(PUBLISHED_FILE, "utf8"));
  } catch {
    published = null; // sync-data writes the file (an empty one when ../data's is missing or broken)
  }
  const board = siteBoardOf(committed, published);
  if (board === committed) return committed;
  const parsed = parseBoardFile(board);
  if (!parsed.ok) {
    console.warn(`! the People's Top 10 board shown doesn't check out; the pages show the committed board:\n${parsed.problem}`);
    return committed;
  }
  return parsed.board;
}

const BOARD = siteBoard();
const MENUS = new Map(pricedMenus(getPricedRestaurants()).map((m) => [m.key, m]));
const VIEW = peoplesTopView<Menu>(BOARD, (key) => MENUS.get(key));
const REVEAL = revealBoard(VIEW, (m) => ({ name: m.restaurant.name, burger: m.restaurant.burger.name, where: menuWhere(m) }));
const STANDINGS = peopleStandings(VIEW);

/** The board as the pages show it, each row joined to its menu (a chain once, at its usual location). */
export function getPeoplesTop(): PeoplesTopView<Menu> {
  return VIEW;
}

/** When the board's numbers were made (for the sitemap), or null before the first board. */
export function getPeoplesTopStamp(): string | null {
  return BOARD.refreshedAt ?? BOARD.asOf;
}

/** A menu's place on the ranking ("#3", with its list count), or null when it isn't ranked. */
export function getPeoplesRank(menuKey: string): { rank: number; lists: number } | null {
  const e = [...VIEW.seats, ...VIEW.rest].find((x) => x.key === menuKey);
  return e ? { rank: e.rank, lists: e.lists } : null;
}

/** The seats and the board's numbers for the home ranker's People's Top 10 beside a list of 3+ (never the whole board). */
export function getRevealBoard(): RevealBoard {
  return REVEAL;
}

/** Every menu the board shows, with where it stands (/data/menus.json carries them to the ranker). */
export function getPeopleStandings(): ReadonlyMap<string, PeopleStanding> {
  return STANDINGS;
}
