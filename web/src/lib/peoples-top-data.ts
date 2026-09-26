// Server-only: the People's Top 10 board, src/data/peoples_top.json (copied from ../data/peoples_top.json by
// scripts/sync-data.mjs, which writes the empty early board when the file is missing or broken), read and
// checked once per build worker and joined to the dataset's menus (lib/peoples-top.ts has the rules). It never
// fails the build: a board that doesn't check out is the empty one, with a warning.
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPricedRestaurants } from "./data";
import { pricedMenus, type Menu } from "./menus";
import { EMPTY_BOARD, peoplesTopView, type BoardFile, type PeoplesTopView } from "./peoples-top";
import { parseBoardFile } from "./peoples-top-schema";

const FILE = join(process.cwd(), "src", "data", "peoples_top.json");

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

const BOARD = load();
const MENUS = new Map(pricedMenus(getPricedRestaurants()).map((m) => [m.key, m]));
const VIEW = peoplesTopView<Menu>(BOARD, (key) => MENUS.get(key));

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
