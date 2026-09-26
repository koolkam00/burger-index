// Server-only: src/data/best_burgers.json (copied from ../data/best_burgers.json by scripts/sync-data.mjs),
// read and checked once per build worker. A file that doesn't match the shape below, or that
// best-burgers.ts bestBurgersProblems finds wrong against the dataset, fails the build here.
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { bestBurgersProblems, rankBestBurgers, type BestBurgersFile, type BestEntry, type BestList } from "./best-burgers";
import { getAllRestaurants, getNeighborhoods } from "./data";

const Slug = z.string().regex(/^[a-z0-9-]+$/);

const FileSchema = z.strictObject({
  version: z.literal(1),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  years: z.strictObject({ from: z.number().int(), to: z.number().int() }),
  lists: z.array(
    z.strictObject({
      id: Slug,
      publisher: z.string().min(1),
      title: z.string().min(1),
      url: z.string().url(),
      date: z.string(),
    }),
  ),
  places: z.array(
    z.strictObject({
      key: Slug,
      name: z.string().min(1),
      restaurant_id: Slug.nullable(),
      neighborhood_slug: Slug.nullable(),
      sources: z.array(z.strictObject({ list: Slug, burger: z.string().min(1).nullable() })).min(1),
    }),
  ),
});

function load(): BestBurgersFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "best_burgers.json"), "utf8"));
  } catch (err) {
    throw new Error(`Could not read src/data/best_burgers.json (run \`npm run sync-data\`): ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`src/data/best_burgers.json is malformed:\n${z.prettifyError(parsed.error)}`);
  const file = parsed.data as BestBurgersFile;
  const problems = bestBurgersProblems(file, getAllRestaurants(), getNeighborhoods());
  if (problems.length) throw new Error(`src/data/best_burgers.json does not fit the dataset:\n  ${problems.join("\n  ")}`);
  return file;
}

const FILE = load();
const ENTRIES = rankBestBurgers(FILE, getAllRestaurants(), getNeighborhoods());

/** The ranked places (best-burgers.ts rankBestBurgers). */
export function getBestBurgers(): readonly BestEntry[] {
  return ENTRIES;
}

/** Every list the page cites, newest first. */
export function getBestLists(): readonly BestList[] {
  return FILE.lists;
}

export function getBestBurgersYears(): { from: number; to: number } {
  return FILE.years;
}
