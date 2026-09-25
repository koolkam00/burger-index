import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDataset } from "../scripts/validate-contract.mjs";
import { BurgerIndexSchema, type BurgerIndex, type PricedRestaurant } from "../src/lib/schema";
import { loadDataset } from "./dataset";

const dataset = loadDataset();

/** Whether the contract (ajv) and the zod mirror each accept the dataset. */
function verdicts(data: unknown): { contract: boolean; zod: boolean } {
  return { contract: validateDataset(data).length === 0, zod: BurgerIndexSchema.safeParse(data).success };
}

test("the pipeline's dataset passes both the contract (ajv) and the zod mirror", () => {
  assert.deepEqual(validateDataset(dataset), []);
  assert.equal(BurgerIndexSchema.safeParse(dataset).success, true);
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
    const withDate = { ...dataset, generated_at: value };
    const contract = validateDataset(withDate).length === 0;
    const zod = BurgerIndexSchema.safeParse(withDate).success;
    assert.equal(zod, contract, `${JSON.stringify(value)}: contract ${contract ? "accepts" : "rejects"}, zod ${zod ? "accepts" : "rejects"}`);
  }
});

test("the lowercase form the Python pipeline accepts passes both", () => {
  const lowercase = { ...dataset, generated_at: "2026-09-23t14:00:00z" };
  assert.deepEqual(validateDataset(lowercase), []);
  assert.equal(BurgerIndexSchema.safeParse(lowercase).success, true);
});

// Restaurants come in two shapes, told apart by index_price: priced (a page) and unpriced (a name).
test("both checks tell the two restaurant shapes apart the same way", () => {
  const i = dataset.restaurants.findIndex((r) => r.index_price !== null);
  const u = dataset.restaurants.findIndex((r) => r.index_price === null);
  assert.ok(i >= 0 && u >= 0, "the dataset has priced and unpriced restaurants");
  const priced = dataset.restaurants[i] as PricedRestaurant;
  const unpriced = dataset.restaurants[u];
  assert.deepEqual(Object.keys(unpriced).sort(), ["address", "burger", "id", "index_price", "name", "neighborhood_slug"]);
  const withRow = (row: unknown, at: number): BurgerIndex =>
    ({ ...dataset, restaurants: dataset.restaurants.map((r, k) => (k === at ? row : r)) }) as BurgerIndex;
  // Each case replaces the row it was made from (so ids stay unique).
  const cases: Array<[string, unknown, number, boolean]> = [
    ["a priced row as written", priced, i, true],
    ["an unpriced row as written", unpriced, u, true],
    ["a priced row without its burger", { ...priced, burger: null }, i, false],
    ["a burger with a price of its own", { ...priced, burger: { ...priced.burger, price: priced.index_price } }, i, false],
    ["a priced row without a price source", { ...priced, price_source: null }, i, false],
    ["an unpriced row with a burger", { ...unpriced, burger: priced.burger }, u, false],
    ["an unpriced row with a page's fields", { ...unpriced, borough: priced.borough, menu_url: priced.menu_url }, u, false],
    ["a hand check without its date", { ...priced, hand_check: {} }, i, false],
  ];
  for (const [what, row, at, ok] of cases) {
    assert.deepEqual(verdicts(withRow(row, at)), { contract: ok, zod: ok }, what);
  }
  // Unique ids are checked beside the schema (here, and by data.ts at build).
  assert.deepEqual(validateDataset(withRow({ ...priced, id: unpriced.id }, i)), ["restaurant ids are not unique"]);
  assert.deepEqual(verdicts({ ...dataset, version: 1 }), { contract: false, zod: false }, "a version 1 dataset");
});

// [checked_on, accepted]: a real calendar day written YYYY-MM-DD, nothing else.
const DATES: Array<[string, boolean]> = [
  ["2026-09-23", true],
  ["2028-02-29", true],
  ["2026-02-29", false],
  ["2026-13-01", false],
  ["2026-09-31", false],
  ["2026-9-23", false],
  ["2026-09-23T00:00:00Z", false],
  ["Sep 23", false],
  ["", false],
];

test("zod accepts exactly the hand-check dates the contract check accepts", () => {
  const i = dataset.restaurants.findIndex((r) => r.index_price !== null);
  for (const [checked_on, ok] of DATES) {
    const row = { ...(dataset.restaurants[i] as PricedRestaurant), hand_check: { checked_on } };
    const v = verdicts({ ...dataset, restaurants: dataset.restaurants.map((r, k) => (k === i ? row : r)) });
    assert.deepEqual(v, { contract: ok, zod: ok }, JSON.stringify(checked_on));
  }
  assert.ok(dataset.restaurants.some((r) => r.index_price !== null && r.hand_check !== null), "the dataset has hand checks");
});
