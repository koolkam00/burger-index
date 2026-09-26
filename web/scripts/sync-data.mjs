#!/usr/bin/env node
// Runs before `next dev` and `next build` (predev / prebuild).
//
// 1. Copies ../data/burger_index.json (written by the Python pipeline and committed) to
//    src/data/burger_index.json. No file there fails the build: there is no sample data to fall back on.
// 2. Validates the dataset against contract/burger_index.schema.json. Invalid data fails the build.
// 3. Copies ../data/best_burgers.json (the /best-burgers page's curated lists, committed) to
//    src/data/best_burgers.json; src/lib/best-burgers-data.ts checks it against the dataset at build.
// 4. Copies ../data/peoples_top.json (the People's Top 10 board, committed by the daily workflow on main:
//    scripts/snapshot-peoples-top.mjs) to src/data/peoples_top.json. A missing or unreadable board never fails the
//    build: the empty early board is written instead, with a warning. src/lib/peoples-top-data.ts checks it at build.
// 5. Copies the MapLibre worker modules into public/vendor/maplibre/ (served same-origin).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyBoard, readBoardText, renderBoard } from "./snapshot-peoples-top.mjs";
import { validateDataset } from "./validate-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const PIPELINE_DATA = join(web, "..", "data", "burger_index.json");
const OUT_DIR = join(web, "src", "data");
const OUT = join(OUT_DIR, "burger_index.json");

if (!existsSync(PIPELINE_DATA)) {
  console.error(
    `✗ ${relative(web, PIPELINE_DATA)} not found. The site is built from the pipeline's dataset only.\n` +
      "  Write it from the scrape cache with `.venv/bin/python -m pipeline build` (repo root), or restore it with\n" +
      "  `git checkout -- data/burger_index.json`, then run this again.",
  );
  process.exit(1);
}

let dataset;
try {
  dataset = JSON.parse(readFileSync(PIPELINE_DATA, "utf8"));
} catch (err) {
  console.error(`✗ Could not read ${relative(web, PIPELINE_DATA)}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const problems = validateDataset(dataset);
if (problems.length) {
  console.error(`✗ ${relative(web, PIPELINE_DATA)} violates contract/burger_index.schema.json:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(PIPELINE_DATA, OUT);
console.log(
  `✓ data: ${relative(web, PIPELINE_DATA)} → ${relative(web, OUT)} ` +
    `(${dataset.restaurants.length} restaurants, ${dataset.stats.restaurants_priced} priced, generated ${dataset.generated_at})`,
);

const BEST_BURGERS = join(web, "..", "data", "best_burgers.json");
if (!existsSync(BEST_BURGERS)) {
  console.error(`✗ ${relative(web, BEST_BURGERS)} not found (it is committed: \`git checkout -- data/best_burgers.json\`).`);
  process.exit(1);
}
copyFileSync(BEST_BURGERS, join(OUT_DIR, "best_burgers.json"));
console.log(`✓ best burgers: ${relative(web, BEST_BURGERS)} → ${relative(web, join(OUT_DIR, "best_burgers.json"))}`);

const PEOPLES_TOP = join(web, "..", "data", "peoples_top.json");
const PEOPLES_TOP_OUT = join(OUT_DIR, "peoples_top.json");
const boardText = existsSync(PEOPLES_TOP) ? readFileSync(PEOPLES_TOP, "utf8") : null;
const board = readBoardText(boardText);
if (board) {
  writeFileSync(PEOPLES_TOP_OUT, boardText);
  const ranked = board.rows.filter((r) => r.tier === "ranked").length;
  console.log(
    `✓ People's Top 10: ${relative(web, PEOPLES_TOP)} → ${relative(web, PEOPLES_TOP_OUT)} ` +
      `(${board.totalLists} ${board.totalLists === 1 ? "list" : "lists"}, ${ranked} ranked, as of ${board.asOf ?? "never"})`,
  );
} else {
  writeFileSync(PEOPLES_TOP_OUT, renderBoard(emptyBoard()));
  console.warn(
    `! People's Top 10: ${relative(web, PEOPLES_TOP)} is ${boardText === null ? "missing" : "not a board"}; ` +
      "the page shows the empty early board (`node scripts/snapshot-peoples-top.mjs` writes it).",
  );
}

// MapLibre v6 resolves its worker relative to its own module URL, which bundling breaks.
// Ship the worker (and the shared chunk it imports) as plain static files instead.
const vendorDir = join(web, "public", "vendor", "maplibre");
mkdirSync(vendorDir, { recursive: true });
const maplibreDist = join(web, "node_modules", "maplibre-gl", "dist");
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(maplibreDist, f), join(vendorDir, f));
}
console.log(`✓ maplibre worker → ${relative(web, vendorDir)}/`);
