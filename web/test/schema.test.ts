import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateDataset } from "../scripts/validate-contract.mjs";
import { BurgerIndexSchema } from "../src/lib/schema";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/burger_index.sample.json", import.meta.url), "utf8"));

test("the sample fixture passes both the contract (ajv) and the zod mirror", () => {
  assert.deepEqual(validateDataset(fixture), []);
  assert.equal(BurgerIndexSchema.safeParse(fixture).success, true);
});

// sync-data validates with ajv-formats, then data.ts parses with zod at build. Whatever passes the
// first must pass the second, or a dataset clears sync-data and then breaks `next build`.
const DATE_TIMES = [
  "2026-09-23T14:00:00Z",
  "2026-09-23T14:00:00.123456Z",
  "2026-09-23T14:00:00+00:00",
  "2026-09-23T10:00:00-04:00",
  "2026-09-23t14:00:00z", // RFC 3339 allows lowercase; so does the pipeline's jsonschema check
  "2026-09-23 14:00:00Z",
  "2026-09-23T14:00:00+0000",
  "2026-09-23T14:00:00+00",
  "2026-12-31T23:59:60Z",
  "2026-12-31T18:59:60-05:00",
  "2026-09-23T12:59:60Z",
  "2026-09-23T14:00:00",
  "2026-09-23",
  "2026-02-29T00:00:00Z",
  "2028-02-29T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "2026-09-23T24:00:00Z",
  "2026-09-23T14:00:00+24:00",
  "2026-09-23TT14:00:00Z",
  "not a date",
];

test("zod accepts exactly the date-times the contract check accepts", () => {
  for (const value of DATE_TIMES) {
    const dataset = { ...fixture, generated_at: value };
    const contract = validateDataset(dataset).length === 0;
    const zod = BurgerIndexSchema.safeParse(dataset).success;
    assert.equal(zod, contract, `${JSON.stringify(value)}: contract ${contract ? "accepts" : "rejects"}, zod ${zod ? "accepts" : "rejects"}`);
  }
});

test("the lowercase form the Python pipeline accepts passes both", () => {
  const dataset = { ...fixture, generated_at: "2026-09-23t14:00:00z" };
  assert.deepEqual(validateDataset(dataset), []);
  assert.equal(BurgerIndexSchema.safeParse(dataset).success, true);
});
