// The real dataset: ../data/burger_index.json, written by the pipeline and committed. It is the file
// scripts/sync-data.mjs validates and copies into src/data/ before dev and build, so tests read it
// straight from the pipeline's output and need no sync first. Test-only (not a *.test.ts file).
import { readFileSync } from "node:fs";
import type { BurgerIndex } from "../src/lib/schema";

export const DATASET_URL = new URL("../../data/burger_index.json", import.meta.url);

export function loadDataset(): BurgerIndex {
  return JSON.parse(readFileSync(DATASET_URL, "utf8")) as BurgerIndex;
}
