import assert from "node:assert/strict";
import { test } from "node:test";
import { datasetMenuKeys } from "../scripts/snapshot-peoples-top.mjs";
import { isMenuKey, listedMenus, MENU_KEY_PATTERN, menuListData, parseMenuList } from "../src/lib/menu-list";
import {
  addItem,
  classifyRankerError,
  countLine,
  listProblem,
  MAX_ITEMS,
  MIN_ITEMS,
  moveItem,
  moveItemTo,
  nyToday,
  parseMyRanking,
  parseSaveReply,
  RANKER_ERROR_COPY,
  rankerBurgers,
  removeItem,
  sameList,
  savedStatusText,
  searchBurgers,
} from "../src/lib/ranker";
import type { Restaurant } from "../src/lib/schema";
import { THEME_BOOT_SCRIPT } from "../src/lib/theme-script";
import { loadDataset } from "./dataset";
import { place } from "./places";

// A small city: two independents in Astoria, one on the Upper West Side, a chain with locations in Manhattan
// (first: its usual location), Queens and the Bronx, and an unpriced place.
function city(): Restaurant[] {
  const list = [
    place({ id: "sals", name: "Sal's", price: 14, burger: "Smash Burger", borough: "Queens", hood: "astoria" }),
    place({ id: "jimbos-harlem", name: "Jimbo's", chain: "jimbos", price: 9.5, borough: "Manhattan", hood: "harlem" }),
    place({ id: "cafe", name: "Café Luxembourg", price: 26, burger: "Steak Frites Burger", borough: "Manhattan", hood: "upper-west-side" }),
    place({ id: "jimbos-astoria", name: "Jimbo's", chain: "jimbos", price: 9.5, borough: "Queens", hood: "astoria" }),
    place({ id: "astoria-diner", name: "Astoria Diner", price: 12.25, borough: "Queens", hood: "astoria" }),
    place({ id: "jimbos-bronx", name: "Jimbo's", chain: "jimbos", price: 9.5, borough: "Bronx", hood: "mott-haven" }),
    place({ id: "closed", name: "Closed", price: null, hood: "astoria" }),
  ];
  const names: Record<string, string> = { astoria: "Astoria", harlem: "Harlem", "upper-west-side": "Upper West Side", "mott-haven": "Mott Haven" };
  return list.map((r) => (r.index_price !== null && r.neighborhood_slug ? { ...r, neighborhood: names[r.neighborhood_slug] } : r));
}

// ---- /data/menus.json ----------------------------------------------------------------------------------

test("menus.json: every distinct priced menu once (a chain once, its usual location first), with the neighborhoods' names", () => {
  const data = menuListData(city());
  assert.deepEqual(
    data.menus.map((m) => [m.key, m.price, m.spots.map((s) => s.id)]),
    [
      ["sals", 14, ["sals"]],
      ["chain:jimbos", 9.5, ["jimbos-harlem", "jimbos-astoria", "jimbos-bronx"]],
      ["cafe", 26, ["cafe"]],
      ["astoria-diner", 12.25, ["astoria-diner"]],
    ],
  );
  assert.deepEqual(data.hoods, { astoria: "Astoria", harlem: "Harlem", "mott-haven": "Mott Haven", "upper-west-side": "Upper West Side" });
  assert.deepEqual(parseMenuList(JSON.parse(JSON.stringify(data))), data, "it survives the trip as JSON");
});

test("menus.json: the browser drops anything that doesn't check out", () => {
  const good = { key: "sals", burger: "B", price: 14, spots: [{ id: "sals", name: "Sal's", hood: "astoria", borough: "Queens" }] };
  const parsed = parseMenuList({
    hoods: { astoria: "Astoria", "Bad Slug": "x", empty: "" },
    menus: [
      good,
      good, // a repeated key
      { ...good, key: "Nope!" },
      { ...good, key: "zero", price: 0 },
      { ...good, key: "no-spots", spots: [] },
      { ...good, key: "bad-borough", spots: [{ id: "x", name: "X", hood: null, borough: "Hoboken" }] },
      { ...good, key: "chain-spot", spots: [{ id: "chain:x", name: "X", hood: null, borough: "Queens" }] },
      null,
    ],
  });
  assert.deepEqual(parsed.menus.map((m) => m.key), ["sals"]);
  assert.deepEqual(parsed.hoods, { astoria: "Astoria" });
  assert.deepEqual(parseMenuList(null), { hoods: {}, menus: [] });
});

test("the real dataset: menus.json lists exactly the menu keys the daily board keeps", () => {
  const data = loadDataset();
  const keys = listedMenus(data.restaurants).map((m) => m.key);
  assert.deepEqual([...keys].sort(), datasetMenuKeys(data));
  assert.ok(keys.every(isMenuKey));
  assert.equal(String(MENU_KEY_PATTERN), String(/^(chain:)?[a-z0-9-]{1,120}$/), "the pattern save_ranking checks");
});

// ---- the list ----------------------------------------------------------------------------------------

test("a list: add at the end (once, never past 25), remove, move up and down stopping at the ends", () => {
  let list: string[] = [];
  list = addItem(list, "a");
  list = addItem(list, "b");
  list = addItem(list, "a");
  assert.deepEqual(list, ["a", "b"], "no repeats");
  list = addItem(list, "c");
  assert.deepEqual(moveItem(list, "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveItem(list, "a", -1), ["a", "b", "c"], "the top stays the top");
  assert.deepEqual(moveItem(list, "c", 1), ["a", "b", "c"], "the bottom stays the bottom");
  assert.deepEqual(moveItem(list, "a", 2), ["b", "c", "a"]);
  assert.deepEqual(moveItemTo(list, "c", 0), ["c", "a", "b"]);
  assert.deepEqual(moveItemTo(list, "a", 99), ["b", "c", "a"], "clamped");
  assert.deepEqual(moveItem(list, "zzz", 1), list, "an unknown key changes nothing");
  assert.deepEqual(removeItem(list, "b"), ["a", "c"]);
  const full = Array.from({ length: MAX_ITEMS }, (_, i) => `k${i}`);
  assert.equal(addItem(full, "one-more").length, MAX_ITEMS);
  assert.equal(sameList(["a", "b"], ["a", "b"]), true);
  assert.equal(sameList(["a", "b"], ["b", "a"]), false);
});

test("a list can be saved with 3 to 25 burgers, each still on the Burger Index", () => {
  const known = (k: string) => k !== "gone";
  assert.equal(listProblem(["a", "b"], known), "too_short");
  assert.equal(listProblem(["a", "b", "c"], known), null);
  assert.equal(listProblem(["a", "b", "gone"], known), "gone", "a burger no longer listed comes first");
  assert.equal(listProblem(Array.from({ length: 26 }, (_, i) => `k${i}`), known), "too_long");
  assert.equal(MIN_ITEMS, 3);
  assert.equal(MAX_ITEMS, 25);
  assert.equal(countLine(0), "Add at least 3 burgers, your favorite first.");
  assert.equal(countLine(1), "1 burger. Add 2 more to save.");
  assert.equal(countLine(3), "3 burgers, up to 25.");
  assert.equal(countLine(25), "25 burgers: your list is full.");
});

// ---- the burgers and their search ------------------------------------------------------------------

test("burgers as the ranker lists them: a chain once at its usual location, 'N locations'; else the neighborhood and borough", () => {
  const burgers = rankerBurgers(menuListData(city()));
  const jimbos = burgers.get("chain:jimbos")!;
  assert.deepEqual([jimbos.name, jimbos.id, jimbos.where, jimbos.locations], ["Jimbo's", "jimbos-harlem", "3 locations", 3]);
  assert.equal(burgers.get("sals")!.where, "Astoria, Queens");
  assert.equal(burgers.size, 4);
});

test("a restaurant name two menus share is told apart by where it is (in buttons and announcements)", () => {
  const list = [
    place({ id: "smash-house-midtown", name: "Smash House", price: 21, borough: "Manhattan", hood: "midtown" }),
    place({ id: "smash-house-kew", name: "Smash House", price: 20, borough: "Queens", hood: "kew" }),
    place({ id: "jg", name: "J.G. Melon", price: 16.25, burger: "Bacon Cheeseburger", borough: "Manhattan", hood: "uws" }),
  ];
  const burgers = rankerBurgers(menuListData(list));
  assert.equal(burgers.get("smash-house-midtown")!.label, "Smash House, midtown, Manhattan");
  assert.equal(burgers.get("smash-house-kew")!.label, "Smash House, kew, Queens");
  assert.equal(burgers.get("jg")!.label, "J.G. Melon");
  assert.deepEqual(searchBurgers(burgers.values(), "jg melon").map((b) => b.key), ["jg"], "dots are optional");
  assert.deepEqual(searchBurgers(burgers.values(), "j.g.").map((b) => b.key), ["jg"]);
});

test("search: every word in the restaurant, burger, neighborhood or borough; accents folded; names starting with it first", () => {
  const burgers = [...rankerBurgers(menuListData(city())).values()];
  const keys = (q: string) => searchBurgers(burgers, q).map((b) => b.key);
  assert.deepEqual(keys("astoria"), ["astoria-diner", "chain:jimbos", "sals"], "the diner's name starts with it; the chain has a location there");
  assert.deepEqual(keys("cafe"), ["cafe"]);
  assert.deepEqual(keys("CAFÉ lux"), ["cafe"]);
  assert.deepEqual(keys("smash"), ["sals"], "the burger's name");
  assert.deepEqual(keys("bronx"), ["chain:jimbos"]);
  assert.deepEqual(keys("sals"), ["sals"], "apostrophes folded");
  assert.deepEqual(keys("   "), []);
  assert.deepEqual(keys("zzz"), []);
});

// ---- the backend's replies -------------------------------------------------------------------------

test("get_my_ranking and save_ranking replies are checked; anything odd is no list", () => {
  assert.deepEqual(parseMyRanking({ items: ["a", "chain:b", "c"], status: "active", saved_on: "2026-09-26", counts_from: "2026-09-27", in_board: false }), {
    items: ["a", "chain:b", "c"],
    status: "active",
    savedOn: "2026-09-26",
    countsFrom: "2026-09-27",
    inBoard: false,
  });
  assert.deepEqual(parseMyRanking({ items: ["a", "b", "c"], status: "replaced", saved_on: "2026-09-26", counts_from: "2026-09-27", in_board: true })?.countsFrom, null, "counts_from only while active");
  assert.equal(parseMyRanking(null), null);
  assert.equal(parseMyRanking({ items: ["a", "a", "b"], status: "active", saved_on: "2026-09-26" }), null, "repeats");
  assert.equal(parseMyRanking({ items: ["A!"], status: "active", saved_on: "2026-09-26" }), null);
  assert.equal(parseMyRanking({ items: ["a", "b", "c"], status: "maybe", saved_on: "2026-09-26" }), null);
  assert.equal(parseMyRanking({ items: ["a", "b", "c"], status: "active", saved_on: "yesterday" }), null);
  assert.deepEqual(parseSaveReply({ status: "active", saved_on: "2026-09-26", counts_from: "2026-09-27" }), { status: "active", savedOn: "2026-09-26", countsFrom: "2026-09-27" });
  assert.deepEqual(parseSaveReply({ status: "void", saved_on: "2026-09-26", counts_from: null }), { status: "void", savedOn: "2026-09-26", countsFrom: null });
  assert.equal(parseSaveReply({ status: "replaced", saved_on: "2026-09-26" }), null);
});

test("what the card says about a saved list", () => {
  const today = "2026-09-26";
  assert.equal(savedStatusText({ status: "active", countsFrom: "2026-09-27", inBoard: false }, today), "Saved. It counts from Sep 27, 2026.");
  assert.equal(savedStatusText({ status: "active", countsFrom: "2026-09-26", inBoard: false }, today), "Saved. It joins the People's Top 10 at its next update.");
  assert.equal(savedStatusText({ status: "active", countsFrom: "2026-09-20", inBoard: true }, today), "Counted in the People's Top 10.");
  assert.equal(savedStatusText({ status: "replaced", countsFrom: null, inBoard: false }, today), "Not counted: a newer list was saved from this connection. Save again to count this one.");
  assert.equal(savedStatusText({ status: "void", countsFrom: null, inBoard: false }, today), "Not counted.");
  assert.match(nyToday(new Date("2026-09-27T03:30:00Z")), /^2026-09-26$/, "New York's day, not UTC's");
});

test("failures: the backend's hint codes, rate limits (HTTP 429), refusals and network errors", () => {
  assert.equal(classifyRankerError({ code: "PT429", hint: "rate_connection", message: "Lots of lists…" }), "rate_connection");
  assert.equal(classifyRankerError({ code: "PT429", hint: "rate_voter" }), "rate_voter");
  assert.equal(classifyRankerError({ code: "PT429", hint: "rate_network" }), "rate_network");
  assert.equal(classifyRankerError({ code: "PT429" }), "rate_connection");
  assert.equal(classifyRankerError({ status: 429, message: "Too Many Requests" }), "rate_connection");
  assert.equal(classifyRankerError({ code: "22023", hint: "list_too_short" }), "too_short");
  assert.equal(classifyRankerError({ code: "22023", hint: "list_too_long" }), "too_long");
  assert.equal(classifyRankerError({ code: "22023", hint: "unknown_burger" }), "unknown_burger");
  assert.equal(classifyRankerError({ code: "22023", hint: "duplicate_burger" }), "duplicate");
  assert.equal(classifyRankerError({ code: "22023", hint: "missing_voter" }), "invalid");
  assert.equal(classifyRankerError({ code: "22023" }), "invalid");
  assert.equal(classifyRankerError({ message: "TypeError: Failed to fetch", code: "" }), "network");
  assert.equal(classifyRankerError(new TypeError("Load failed")), "network");
  assert.equal(classifyRankerError({ kind: "disabled" }), "disabled");
  assert.equal(classifyRankerError({ code: "XX000", status: 500, message: "boom" }), "unknown");
  assert.equal(classifyRankerError("nope"), "unknown");
  for (const copy of Object.values(RANKER_ERROR_COPY)) assert.ok(copy.length > 0 && !/voter|hash|ip\b/i.test(copy));
});

test("the <head> script flags a saved ranking (and no longer a pricer area)", () => {
  assert.match(THEME_BOOT_SCRIPT, /localStorage\.getItem\('bi-ranker-saved'\)\)d\.classList\.add\('ranker-saved'\)/);
  assert.doesNotMatch(THEME_BOOT_SCRIPT, /pricer/);
});
