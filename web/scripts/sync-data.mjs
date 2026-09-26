#!/usr/bin/env node
// Runs before `next dev` and `next build` (predev / prebuild).
//
// 1. Copies ../data/burger_index.json (written by the Python pipeline and committed) to
//    src/data/burger_index.json. No file there fails the build: there is no sample data to fall back on.
// 2. Validates the dataset against contract/burger_index.schema.json. Invalid data fails the build.
// 3. Copies ../data/best_burgers.json (the /best-burgers page's curated lists, committed) to
//    src/data/best_burgers.json; src/lib/best-burgers-data.ts checks it against the dataset at build.
// 4. Copies ../data/peoples_price.json (the People's Price snapshot, committed by the daily workflow on main:
//    scripts/snapshot-peoples-price.mjs) to src/data/peoples_price.json. A missing or unreadable snapshot never
//    fails the build: an empty one is written instead (the pages then show the live numbers only), with a warning.
//    src/lib/peoples-price-data.ts checks every entry at build.
// 5. Copies the MapLibre worker modules into public/vendor/maplibre/ (served same-origin).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readSnapshotText, renderSnapshot } from "./snapshot-peoples-price.mjs";
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

const PEOPLES_PRICE = join(web, "..", "data", "peoples_price.json");
const PEOPLES_PRICE_OUT = join(OUT_DIR, "peoples_price.json");
const snapshotText = existsSync(PEOPLES_PRICE) ? readFileSync(PEOPLES_PRICE, "utf8") : null;
const snapshot = readSnapshotText(snapshotText);
if (snapshot) {
  writeFileSync(PEOPLES_PRICE_OUT, snapshotText);
  console.log(
    `✓ People's Price: ${relative(web, PEOPLES_PRICE)} → ${relative(web, PEOPLES_PRICE_OUT)} ` +
      `(${Object.keys(snapshot.menus).length} answered ${Object.keys(snapshot.menus).length === 1 ? "menu" : "menus"}, as of ${snapshot.generatedAt ?? "never"})`,
  );
} else {
  writeFileSync(PEOPLES_PRICE_OUT, renderSnapshot({ generatedAt: null, menus: {} }));
  console.warn(
    `! People's Price: ${relative(web, PEOPLES_PRICE)} is ${snapshotText === null ? "missing" : "not a snapshot"}; ` +
      "the pages show the live numbers only (`node scripts/snapshot-peoples-price.mjs` reads them).",
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
