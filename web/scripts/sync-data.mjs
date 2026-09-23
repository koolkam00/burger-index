#!/usr/bin/env node
// Runs before `next dev` and `next build` (predev / prebuild).
//
// 1. Copies ../data/burger_index.json (written by the Python pipeline) to src/data/burger_index.json.
//    If the pipeline has not produced it yet, copies fixtures/burger_index.sample.json instead and
//    says so loudly; the site then shows a "sample data" banner on every page.
// 2. Validates the dataset against contract/burger_index.schema.json. Invalid data fails the build.
// 3. Writes src/data/meta.json ({ source: "pipeline" | "fixture" }).
// 4. Copies the MapLibre worker modules into public/vendor/maplibre/ (served same-origin).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDataset } from "./validate-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const PIPELINE_DATA = join(web, "..", "data", "burger_index.json");
const FIXTURE = join(web, "fixtures", "burger_index.sample.json");
const OUT_DIR = join(web, "src", "data");
const OUT = join(OUT_DIR, "burger_index.json");
const META = join(OUT_DIR, "meta.json");

const useFixture = process.env.BURGER_INDEX_USE_FIXTURE === "1" || !existsSync(PIPELINE_DATA);
const source = useFixture ? FIXTURE : PIPELINE_DATA;

if (useFixture) {
  const bar = "!".repeat(78);
  console.warn(
    `\n${bar}\n` +
      `!! SAMPLE DATA: ${relative(web, PIPELINE_DATA)} ${existsSync(PIPELINE_DATA) ? "ignored (BURGER_INDEX_USE_FIXTURE=1)" : "not found"}.\n` +
      `!! Building with ${relative(web, FIXTURE)}: fictional restaurants, made-up prices.\n` +
      `!! Run the Python pipeline to write data/burger_index.json, then rebuild.\n` +
      `${bar}\n`,
  );
}

let dataset;
try {
  dataset = JSON.parse(readFileSync(source, "utf8"));
} catch (err) {
  console.error(`✗ Could not read ${source}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const problems = validateDataset(dataset);
if (problems.length) {
  console.error(`✗ ${relative(web, source)} violates contract/burger_index.schema.json:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(source, OUT);
writeFileSync(META, JSON.stringify({ source: useFixture ? "fixture" : "pipeline" }, null, 1) + "\n");
console.log(
  `✓ data: ${relative(web, source)} → ${relative(web, OUT)} ` +
    `(${dataset.restaurants.length} restaurants, ${dataset.stats.burgers} priced burgers, generated ${dataset.generated_at})`,
);

// MapLibre v6 resolves its worker relative to its own module URL, which bundling breaks.
// Ship the worker (and the shared chunk it imports) as plain static files instead.
const vendorDir = join(web, "public", "vendor", "maplibre");
mkdirSync(vendorDir, { recursive: true });
const maplibreDist = join(web, "node_modules", "maplibre-gl", "dist");
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(maplibreDist, f), join(vendorDir, f));
}
console.log(`✓ maplibre worker → ${relative(web, vendorDir)}/`);
