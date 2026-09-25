import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { restaurantScope } from "../src/lib/scope";
import type { BurgerIndex } from "../src/lib/schema";

// The pipeline's two phrasings of methodology.coverage_note, exactly as pipeline/build.py
// `coverage_note` writes them (tests/test_build.py pins the same starts). If the pipeline rewords
// them, these fail here instead of the home page quietly losing its "Looked up so far" tile.
const LIST_ONLY =
  "658 restaurants in scope: our curated list of NYC burger restaurants, matched to NYC DOHMH inspection records for address and location, except national fast-food chains (McDonald's, Burger King, Wendy's, Shake Shack and the like). NYC's own small chains stay in. 80 of them are in this dataset; the other 578 are not yet scraped. Chain locations share one menu price scraped from a single NYC location. Delivery-app prices usually run above in-store prices.";
const WITH_CUISINES =
  "242 restaurants in scope: our curated restaurant list plus every restaurant NYC DOHMH lists under 'Hamburgers' with an inspection since 2023-01-01 (or not yet inspected), except national fast-food chains (McDonald's, Burger King, Wendy's, Shake Shack and the like). NYC's own small chains stay in. 129 of them are in this dataset; the other 113 are not yet scraped. Chain locations share one menu price scraped from a single NYC location. Delivery-app prices usually run above in-store prices. 1 airport chain location is listed without the chain's street price.";
// Everything scraped, national chains included, three cuisines.
const WITH_CUISINES_DONE =
  "129 restaurants: our curated restaurant list plus every restaurant NYC DOHMH lists under 'Hamburgers, American, Irish' with an inspection since 2023-01-01 (or not yet inspected). Chain locations share one menu price scraped from a single NYC location. Delivery-app prices usually run above in-store prices.";
const LIST_ONLY_DONE =
  "658 restaurants: our curated list of NYC burger restaurants, matched to NYC DOHMH inspection records for address and location. Chain locations share one menu price scraped from a single NYC location. Delivery-app prices usually run above in-store prices.";
const FIXTURE_NOTE =
  "SAMPLE DATA: 52 fictional restaurants generated for development. Chain locations share one menu price scraped from a single NYC location. Delivery-app prices usually run above in-store prices.";

const note = (coverage_note: string) => ({ coverage_note });

test("list only: our curated list, matched to DOHMH for address and location", () => {
  const scope = restaurantScope(note(LIST_ONLY), 80);
  assert.deepEqual(scope, {
    kind: "list",
    cuisines: [],
    inspectedSince: null,
    inScope: 658,
    lookedUp: 80,
    pending: 578,
    excludesNationalChains: true,
    nationalChainExamples: "McDonald's, Burger King, Wendy's, Shake Shack and the like",
  });
});

test("the note's matching clause and chain wording can change without losing the scope", () => {
  const softened = LIST_ONLY.replace(
    "matched to NYC DOHMH inspection records for address and location",
    "matched where possible (499 of 658) to NYC DOHMH inspection records for address and location",
  ).replace(
    "except national fast-food chains (McDonald's, Burger King, Wendy's, Shake Shack and the like)",
    "except national fast-food and casual-dining chains (Shake Shack, Five Guys, McDonald's, White Castle, Applebee's, Outback and the like)",
  );
  const scope = restaurantScope(note(softened), 80);
  assert.deepEqual([scope.kind, scope.inScope, scope.pending, scope.excludesNationalChains], ["list", 658, 578, true]);
  assert.equal(scope.nationalChainExamples, "Shake Shack, Five Guys, McDonald's, White Castle, Applebee's, Outback and the like");
  const bare = restaurantScope(note(LIST_ONLY.replace("national fast-food chains", "national chains")), 80);
  assert.equal(bare.excludesNationalChains, true);
  assert.equal(bare.nationalChainExamples, "McDonald's, Burger King, Wendy's, Shake Shack and the like");
});

test("list plus DOHMH cuisines: every restaurant the health department files under them", () => {
  const scope = restaurantScope(note(WITH_CUISINES), 129);
  assert.equal(scope.kind, "list+cuisines");
  assert.deepEqual(scope.cuisines, ["Hamburgers"]);
  assert.equal(scope.inspectedSince, "2023-01-01");
  assert.deepEqual([scope.inScope, scope.lookedUp, scope.pending], [242, 129, 113]);
  assert.equal(scope.excludesNationalChains, true);
});

test("everything scraped: no pending count, no 'so far'", () => {
  const cuisines = restaurantScope(note(WITH_CUISINES_DONE), 129);
  assert.deepEqual(cuisines.cuisines, ["Hamburgers", "American", "Irish"]);
  assert.deepEqual([cuisines.inScope, cuisines.pending], [129, 0]);
  assert.equal(cuisines.excludesNationalChains, false, "national chains included: no 'except' clause");
  assert.equal(cuisines.nationalChainExamples, null);

  const list = restaurantScope(note(LIST_ONLY_DONE), 658);
  assert.deepEqual([list.kind, list.inScope, list.pending, list.excludesNationalChains], ["list", 658, 0, false]);
});

test("an unrecognised note names no list and claims nothing", () => {
  const scope = restaurantScope(note(FIXTURE_NOTE), 52);
  assert.deepEqual([scope.kind, scope.inScope, scope.pending, scope.excludesNationalChains], ["unknown", 52, 0, false]);
  assert.equal(restaurantScope(note(""), 0).kind, "unknown");
});

test("counts: thousands separators and one pending restaurant", () => {
  const big = restaurantScope(note(LIST_ONLY.replace("the other 578 are", "the other 1,578 are")), 80);
  assert.deepEqual([big.inScope, big.pending], [1658, 1578]);
  const one = restaurantScope(note(LIST_ONLY.replace("the other 578 are", "the other 1 are")), 1);
  assert.deepEqual([one.inScope, one.pending], [2, 1]);
});

// The published dataset must be in one of the phrasings above: an "unknown" scope would silently
// lose the not-yet-scraped count behind the "Looked up so far" tile.
const synced = new URL("../src/data/burger_index.json", import.meta.url);
const meta = new URL("../src/data/meta.json", import.meta.url);
const fromPipeline = existsSync(meta) && (JSON.parse(readFileSync(meta, "utf8")) as { source?: string }).source === "pipeline";
test("the synced pipeline dataset's coverage note is in a known phrasing", { skip: !(existsSync(synced) && fromPipeline) && "no synced pipeline dataset" }, () => {
  const data = JSON.parse(readFileSync(synced, "utf8")) as BurgerIndex;
  const scope = restaurantScope(data.methodology, data.restaurants.length);
  assert.notEqual(scope.kind, "unknown", data.methodology.coverage_note);
  const lead = /^([\d,]+) restaurants?\b/.exec(data.methodology.coverage_note);
  assert.ok(lead, "the note opens with the number of restaurants in scope");
  assert.equal(scope.inScope, Number(lead[1].replace(/,/g, "")), "in scope = in the dataset + not yet scraped");
});
