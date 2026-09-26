// Server-only: the People's Price snapshot, src/data/peoples_price.json (copied from ../data/peoples_price.json
// by scripts/sync-data.mjs; lib/peoples-price.ts has the rules), read once per build worker and joined to the
// dataset's menus. It never fails the build: a missing file is the empty snapshot, and an entry that doesn't
// check out is dropped with a warning.
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPricedRestaurants } from "./data";
import { menuKey } from "./menus";
import {
  bestValue,
  EMPTY_SNAPSHOT,
  parseSnapshot,
  snapshotFigures,
  snapshotHistEntries,
  type BestValue,
  type HistEntries,
  type PeoplesPriceFigures,
  type PeoplesPriceSnapshot,
} from "./peoples-price";
import { worthMenus, type WorthMenu } from "./worth";

const FILE = join(process.cwd(), "src", "data", "peoples_price.json");

function load(): PeoplesPriceSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return EMPTY_SNAPSHOT; // no snapshot yet (sync-data says so): the pages show the live numbers only
  }
  const known = new Set(getPricedRestaurants().map(menuKey));
  const { snapshot, problems } = parseSnapshot(raw, known);
  if (problems.length) console.warn(`! src/data/peoples_price.json: left out ${problems.length} entries:\n  ${problems.slice(0, 20).join("\n  ")}`);
  return snapshot;
}

const SNAPSHOT = load();
const MENUS = worthMenus(getPricedRestaurants());
const BEST_VALUE = bestValue(MENUS, SNAPSHOT);

export function getPeoplesPriceSnapshot(): PeoplesPriceSnapshot {
  return SNAPSHOT;
}

/** When the snapshot's numbers were read (ISO), or null without a snapshot. */
export function getSnapshotAsOf(): string | null {
  return SNAPSHOT.generatedAt;
}

/** One menu's People's Price in the snapshot, or null without a snapshot (see lib/peoples-price snapshotFigures). */
export function getSnapshotFigures(key: string): PeoplesPriceFigures | null {
  return snapshotFigures(SNAPSHOT, key);
}

/** The snapshot's histograms of `keys`, as plain arrays for a client component. */
export function getSnapshotHistEntries(keys: readonly string[]): HistEntries {
  return snapshotHistEntries(SNAPSHOT, keys);
}

/** The best-value list over the dataset's distinct menus, or null while the page doesn't exist. */
export function getBestValue(): BestValue<WorthMenu> | null {
  return BEST_VALUE;
}

/** Whether /best-value-burgers exists (and so is linked, listed in the sitemap and llms.txt). */
export function hasBestValuePage(): boolean {
  return BEST_VALUE !== null;
}
