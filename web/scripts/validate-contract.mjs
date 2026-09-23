#!/usr/bin/env node
// Validates a Burger Index dataset against contract/burger_index.schema.json (JSON Schema 2020-12,
// with formats) plus the invariants pipeline/build.py enforces (unique ids, one index item per
// priced restaurant). The zod schema in src/lib/schema.ts checks the same shape again at build.
//
//   node scripts/validate-contract.mjs [path/to/dataset.json]   (default: the sample fixture)

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACT_PATH = join(here, "..", "..", "contract", "burger_index.schema.json");

/** Returns a list of problems; empty means valid. */
export function validateDataset(dataset) {
  const schema = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const problems = [];
  if (!validate(dataset)) {
    for (const e of (validate.errors ?? []).slice(0, 25)) {
      problems.push(`${e.instancePath || "<root>"}: ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`);
    }
    return problems;
  }
  const ids = dataset.restaurants.map((r) => r.id);
  if (new Set(ids).size !== ids.length) problems.push("restaurant ids are not unique");
  const burgerIds = dataset.restaurants.flatMap((r) => r.burgers.map((b) => b.id));
  if (new Set(burgerIds).size !== burgerIds.length) problems.push("burger ids are not unique");
  for (const r of dataset.restaurants) {
    const nIndex = r.burgers.filter((b) => b.is_index_item).length;
    if ((r.index_price !== null) !== (nIndex === 1) || nIndex > 1) problems.push(`${r.id}: index_price/is_index_item mismatch`);
    if (r.index_price !== null && r.status !== "priced") problems.push(`${r.id}: index_price set but status is ${r.status}`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const target = resolve(process.argv[2] ?? join(here, "..", "fixtures", "burger_index.sample.json"));
  const dataset = JSON.parse(readFileSync(target, "utf8"));
  const problems = validateDataset(dataset);
  if (problems.length) {
    console.error(`✗ ${target} violates the contract:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`✓ ${target} matches contract/burger_index.schema.json`);
}
