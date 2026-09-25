import assert from "node:assert/strict";
import { test } from "node:test";
import { activeFilterCount, EMPTY_FILTERS, filterRows, parseFilters, queryTokens, searchable, serializeFilters, type ExRow, type Filters } from "../src/lib/explorer";

const HOODS = new Set(["soho", "astoria"]);
const parse = (qs: string) => parseFilters(new URLSearchParams(qs), HOODS);

test("a neighborhood the dataset doesn't have is dropped, not applied", () => {
  assert.equal(parse("neighborhood=astoria").neighborhood, "astoria");
  // A stale link to a neighborhood a rebuild no longer has would otherwise filter out every burger
  // with no chip to remove.
  assert.equal(parse("neighborhood=not-a-hood").neighborhood, "");
  assert.equal(activeFilterCount(parse("neighborhood=not-a-hood")), 0);
});

test("filters round-trip through the URL", () => {
  const qs = "q=cheese&borough=brooklyn,queens&neighborhood=soho&min=5&max=12.5&sort=-price";
  assert.equal(serializeFilters(parse(qs)), qs);
  assert.equal(activeFilterCount(parse(qs)), 4, "two boroughs, a neighborhood and one price range");
});

test("parameters of the retired filters are ignored", () => {
  // Old links: the protein, source, delivery-app and index-only filters are gone.
  const f = parse("protein=beef&source=official_pdf&hide=delivery_app&index=1&borough=bronx");
  assert.deepEqual(f, { ...EMPTY_FILTERS, boroughs: ["bronx"] });
  assert.equal(serializeFilters(f), "borough=bronx");
  assert.equal(activeFilterCount(f), 1);
});

const row = (id: string, over: Partial<ExRow> = {}): ExRow => ({
  id,
  name: id,
  burger: "Cheeseburger",
  price: 15,
  nb: "SoHo",
  nbSlug: "soho",
  borough: "Manhattan",
  source: "official_site",
  ...over,
});

const ROWS = [
  row("joes", { name: "Joe's", burger: "Smash Burger", price: 12 }),
  row("astoria-grill", { name: "Astoria Grill", burger: "Bacon Burger", price: 18, nb: "Astoria", nbSlug: "astoria", borough: "Queens", source: "delivery_app" }),
  row("zeke", { name: "Zeke's", burger: "Cheeseburger", price: 12 }),
  row("big", { name: "Big Burger", burger: "Wagyu Burger", price: 40, nb: null, nbSlug: null, borough: "Brooklyn" }),
].map(searchable);

const run = (f: Partial<Filters>, q = "") =>
  filterRows(ROWS, { ...EMPTY_FILTERS, ...f }, queryTokens(q)).map(({ row: r }) => r.id);

test("every row is one restaurant; the default sort is price, then burger name", () => {
  assert.deepEqual(run({}), ["zeke", "joes", "astoria-grill", "big"]);
  assert.deepEqual(run({ sort: "-price" }), ["big", "astoria-grill", "zeke", "joes"]);
  assert.deepEqual(run({ sort: "name" }), ["astoria-grill", "zeke", "joes", "big"]);
  assert.deepEqual(run({ sort: "restaurant" }), ["astoria-grill", "big", "joes", "zeke"]);
});

test("borough, neighborhood and price filters combine", () => {
  assert.deepEqual(run({ boroughs: ["queens", "brooklyn"] }), ["astoria-grill", "big"]);
  assert.deepEqual(run({ neighborhood: "soho" }), ["zeke", "joes"]);
  assert.deepEqual(run({ min: 12, max: 18 }), ["zeke", "joes", "astoria-grill"]);
  assert.deepEqual(run({ min: 13 }), ["astoria-grill", "big"]);
  assert.deepEqual(run({ boroughs: ["manhattan"], max: 11 }), []);
});

test("search matches the burger, the restaurant, the neighborhood and the borough", () => {
  assert.deepEqual(run({}, "smash"), ["joes"]);
  assert.deepEqual(run({}, "joe's"), ["joes"]);
  assert.deepEqual(run({}, "astoria"), ["astoria-grill"]);
  assert.deepEqual(run({}, "brooklyn wagyu"), ["big"]);
  assert.deepEqual(run({}, "burger queens"), ["astoria-grill"]);
  assert.deepEqual(run({}, "truffle"), []);
});
