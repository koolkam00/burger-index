import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  chainLocationsWhere,
  coverageSentence,
  cuisineNames,
  lookedUpSoFar,
  lookedUpWhen,
  mostlyIn,
  restaurantScope,
  scopeCredit,
  scopeMethod,
  scopeRestaurants,
  scopeSources,
  scopeWhere,
} from "../src/lib/scope";
import type { BurgerIndex } from "../src/lib/schema";

// The pipeline's two phrasings of methodology.coverage_note, exactly as pipeline/build.py
// `coverage_note` writes them (tests/test_build.py pins the same starts). If the pipeline rewords
// them, these fail here instead of the site quietly falling back to copy that names no source.
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
  assert.equal(scopeRestaurants(scope), "658 New York restaurants on our list of burger places");
  assert.equal(scopeWhere(scope), "on our list");
  assert.equal(coverageSentence(scope), "We have looked up 80 of the 658 New York restaurants on our list of burger places.");
  assert.equal(lookedUpSoFar(scope), "80 of 658 restaurants looked up so far");
  const method = scopeMethod(scope);
  assert.match(method, /^List restaurants: our own list of New York burger places, leaving out national chains\./);
  assert.match(method, /We match each restaurant we can to the city health department's inspection records, which give its address and map location\./);
  assert.doesNotMatch(method, /files under|hamburgers/i, "list only: the health department adds no restaurants");
  assert.doesNotMatch(method, /\bEach one is matched\b/, "not every restaurant on the list matches a health-department record");
  assert.equal(
    scopeCredit(scope),
    "Restaurants from our own list of New York burger places, with addresses from city health-inspection records (NYC Open Data) where they match; 80 of 658 looked up so far.",
  );
  assert.equal(lookedUpWhen(scope), "looked up so far");
  assert.equal(chainLocationsWhere(scope), " on our list");
});

test("method: how many restaurants the health department's records place, from the dataset", () => {
  const scope = restaurantScope(note(LIST_ONLY), 80);
  assert.equal(
    scopeMethod(scope, 77),
    "List restaurants: our own list of New York burger places, leaving out national chains. We match each restaurant we can to the city health department's inspection records, which give its address and map location (77 of the 80 looked up so far). The rest keep the neighborhood from our list and are not on the map.",
  );
  assert.match(scopeMethod(scope, 80), /which give its address and map location \(all 80 looked up so far\)\.$/, "all matched: no 'the rest'");
  const done = restaurantScope(note(LIST_ONLY_DONE), 658);
  assert.match(scopeMethod(done, 499), /\(499 of the 658\)\. The rest keep the neighborhood from our list and are not on the map\.$/);
  assert.match(scopeMethod(done, 499), /^List restaurants: our own list of New York burger places\. /, "national chains included: no 'leaving out'");
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

// methodology.sources as pipeline/build.py SOURCES wrote them when the list became ours.
const SOURCES = [
  "NYC DOHMH Restaurant Inspection Results (NYC Open Data 43nn-pn8j): restaurant list, addresses, coordinates, cuisine.",
  "2010 Neighborhood Tabulation Areas (NYC Open Data 8ius-dhrr): neighborhood names.",
  "The Burger Index restaurant list: a curated list of NYC burger restaurants.",
  "Menu prices from each restaurant's own site or menu PDF, online-ordering pages, menu aggregators and delivery apps, read with Context.dev web scraping.",
];

test("sources: with our list, the health department's records only match it, and the list goes first", () => {
  assert.deepEqual(scopeSources(SOURCES, restaurantScope(note(LIST_ONLY), 80)), [
    "The Burger Index restaurant list: a curated list of NYC burger restaurants.",
    "NYC DOHMH Restaurant Inspection Results (NYC Open Data 43nn-pn8j): addresses, coordinates and cuisine for the restaurants on our list that match its records.",
    SOURCES[1],
    SOURCES[3],
  ]);
  assert.equal(
    scopeSources(SOURCES, restaurantScope(note(WITH_CUISINES), 129))[1],
    "NYC DOHMH Restaurant Inspection Results (NYC Open Data 43nn-pn8j): every restaurant it files under “Hamburgers” inspected since Jan 1, 2023 (or not inspected yet), and addresses, coordinates and cuisine for the restaurants on our list that match its records.",
  );
  // A DOHMH line that no longer claims the list is left as it is; an unknown scope changes nothing.
  const fixed = ["The Burger Index restaurant list: a curated list of NYC burger restaurants.", "NYC DOHMH Restaurant Inspection Results (NYC Open Data 43nn-pn8j): addresses and coordinates."];
  assert.deepEqual(scopeSources(fixed, restaurantScope(note(LIST_ONLY), 80)), fixed);
  assert.deepEqual(scopeSources(SOURCES, restaurantScope(note(FIXTURE_NOTE), 52)), SOURCES);
});

test("list plus DOHMH cuisines: every restaurant the health department files under them", () => {
  const scope = restaurantScope(note(WITH_CUISINES), 129);
  assert.equal(scope.kind, "list+cuisines");
  assert.deepEqual(scope.cuisines, ["Hamburgers"]);
  assert.equal(scope.inspectedSince, "2023-01-01");
  assert.deepEqual([scope.inScope, scope.lookedUp, scope.pending], [242, 129, 113]);
  assert.equal(scope.excludesNationalChains, true);
  assert.equal(scopeRestaurants(scope), "242 New York restaurants on our list of burger places or filed under “Hamburgers” by the city's health department");
  assert.equal(scopeWhere(scope), "in scope");
  assert.equal(
    scopeMethod(scope, 120),
    "List restaurants: our own list of New York burger places, plus every restaurant the city's health department files under “Hamburgers” that it has inspected since Jan 1, 2023 (or not inspected yet), leaving out national chains. We match each restaurant we can to the city health department's inspection records, which give its address and map location (120 of the 129 looked up so far). The rest keep the neighborhood from our list and are not on the map.",
  );
  assert.equal(chainLocationsWhere(scope), " in scope");
  assert.equal(scopeCredit(scope), "Restaurants from our own list of New York burger places plus city health-inspection records (NYC Open Data); 129 of 242 looked up so far.");
});

test("everything scraped: no pending count, no 'so far'", () => {
  const cuisines = restaurantScope(note(WITH_CUISINES_DONE), 129);
  assert.deepEqual(cuisines.cuisines, ["Hamburgers", "American", "Irish"]);
  assert.deepEqual([cuisines.inScope, cuisines.pending], [129, 0]);
  assert.equal(cuisines.excludesNationalChains, false, "national chains included: no 'except' clause");
  assert.equal(cuisines.nationalChainExamples, null);
  assert.equal(lookedUpSoFar(cuisines), null);
  assert.match(coverageSentence(cuisines) ?? "", /^We looked up all 129 New York restaurants on our list of burger places or filed under “Hamburgers”, “American” or “Irish”/);
  assert.doesNotMatch(scopeMethod(cuisines), /leaving out/);

  const list = restaurantScope(note(LIST_ONLY_DONE), 658);
  assert.deepEqual([list.kind, list.inScope, list.pending, list.excludesNationalChains], ["list", 658, 0, false]);
  assert.equal(coverageSentence(list), "We looked up all 658 New York restaurants on our list of burger places.");
  assert.doesNotMatch(scopeCredit(list), /so far/);
  assert.equal(lookedUpWhen(list), "looked up");
});

test("an unrecognised note names no source and claims nothing", () => {
  const scope = restaurantScope(note(FIXTURE_NOTE), 52);
  assert.deepEqual([scope.kind, scope.inScope, scope.pending, scope.excludesNationalChains], ["unknown", 52, 0, false]);
  assert.equal(coverageSentence(scope), null);
  assert.equal(scopeRestaurants(scope), "52 New York restaurants");
  assert.doesNotMatch(scopeMethod(scope), /DOHMH|health|curated|our own list/);
  assert.doesNotMatch(scopeMethod(scope, 40), /DOHMH|health|curated|our own list/);
  assert.doesNotMatch(scopeCredit(scope), /Open Data|our own list/);
  assert.equal(chainLocationsWhere(scope), "", "an unknown scope names no list");
  assert.equal(restaurantScope(note(""), 0).kind, "unknown");
});

test("counts: thousands separators and one pending restaurant", () => {
  const big = restaurantScope(note(LIST_ONLY.replace("the other 578 are", "the other 1,578 are")), 80);
  assert.equal(big.pending, 1578);
  assert.equal(lookedUpSoFar(big), "80 of 1,658 restaurants looked up so far");
  const one = restaurantScope(note(LIST_ONLY.replace("the other 578 are", "the other 1 are")), 1);
  assert.deepEqual([one.inScope, one.pending], [2, 1]);
});

test("cuisine names: quoted, no serial comma, 'or'", () => {
  assert.equal(cuisineNames(["Hamburgers"]), "“Hamburgers”");
  assert.equal(cuisineNames(["Hamburgers", "American"]), "“Hamburgers” or “American”");
  assert.equal(cuisineNames(["Hamburgers", "American", "Irish"]), "“Hamburgers”, “American” or “Irish”");
  assert.equal(cuisineNames([]), "");
});

test("mostly in: only an area with more than half", () => {
  const areas = [
    { name: "West Village", n: 57 },
    { name: "East Village", n: 4 },
  ];
  assert.equal(mostlyIn(areas, (a) => a.n, 80)?.area.name, "West Village");
  assert.equal(mostlyIn(areas, (a) => a.n, 114), null, "exactly half is not most");
  assert.equal(mostlyIn([], (a: { n: number }) => a.n, 10), null);
  assert.equal(mostlyIn(areas, (a) => a.n, 0), null);
});

// The published dataset must be in one of the phrasings above: an "unknown" scope would silently
// drop every sentence about where the list comes from.
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
