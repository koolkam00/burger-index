import assert from "node:assert/strict";
import { test } from "node:test";
import { datasetMenuKeys } from "../scripts/snapshot-peoples-top.mjs";
import { isMenuKey, listedMenus, MENU_KEY_PATTERN, menuListData, parseMenuList } from "../src/lib/menu-list";
import {
  addItem,
  addParam,
  classifyRankerError,
  autosaveLine,
  autosaveTrouble,
  AUTOSAVE_DELAY,
  retriesSave,
  retryDelay,
  saveFailureText,
  countAgainFailureText,
  saveFailureLine,
  saveRetryDelay,
  untilNextHour,
  dragIndex,
  dragTop,
  linkAddOutcome,
  linkAddText,
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
  withoutAddParam,
} from "../src/lib/ranker";
import { RANKER_ADD_PARAM, rankerAddHref } from "../src/lib/site";
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
});

test("autosave's status line: a failure, a gone burger, what's still needed, saving, then what the saved list counts for", () => {
  const today = "2026-09-26";
  const counting = { status: "active" as const, countsFrom: "2026-09-27", inBoard: false };
  const base = { length: 0, saved: null, dirty: false, saving: false, failure: null, problem: null, deleted: false, menusFailed: false };
  const line = (o: Partial<Parameters<typeof autosaveLine>[0]>) => autosaveLine({ ...base, ...o }, today);
  assert.deepEqual(line({}), { text: "Add at least 3 burgers, your favorite first.", alert: false });
  assert.deepEqual(line({ length: 1, dirty: true, problem: "too_short" }), { text: "Add 2 more to save your list.", alert: false });
  assert.deepEqual(line({ length: 3, dirty: true, saving: true }), { text: "Saving…", alert: false });
  assert.deepEqual(line({ length: 3, saved: counting }), { text: "Saved. It counts from Sep 27, 2026.", alert: false });
  assert.deepEqual(line({ length: 3, saved: { ...counting, inBoard: true } }), { text: "Counted in the People's Top 10.", alert: false });
  assert.deepEqual(line({ length: 4, saved: counting, dirty: true, saving: true }), { text: "Saving…", alert: false });
  // a saved list edited under 3: not saved, and the saved one stays as it was
  assert.deepEqual(line({ length: 2, saved: counting, dirty: true, problem: "too_short" }), { text: "Add 1 more to save your changes. Your saved list is unchanged.", alert: false });
  assert.deepEqual(line({ length: 0, saved: counting, dirty: true, problem: "too_short" }), { text: "Add 3 more to save your changes. Your saved list is unchanged.", alert: false });
  assert.deepEqual(line({ deleted: true }), { text: "Your list was deleted.", alert: false });
  // a change held by a check of the saved list that can't reach the counter: said like a save that couldn't
  assert.deepEqual(line({ length: 4, saved: counting, dirty: true, checkRetrying: true }), { text: "Couldn't reach the counter. Trying again soon.", alert: true });
  assert.deepEqual(line({ length: 3, saved: counting, checkRetrying: true }), { text: "Saved. It counts from Sep 27, 2026.", alert: false });
  // failures first: one tried again says so; a refusal says what saves it (no button to press), and that a saved list is unchanged
  assert.deepEqual(line({ length: 3, dirty: true, saving: true, failure: { kind: "network", retrying: true } }), { text: "Couldn't reach the counter. Trying again soon.", alert: true });
  assert.deepEqual(line({ length: 3, dirty: true, failure: { kind: "rate_voter", retrying: false } }), { text: "You've saved your list a lot today. Your list can't be saved until tomorrow.", alert: true });
  assert.deepEqual(line({ length: 4, saved: counting, dirty: true, failure: { kind: "rate_voter", retrying: false } }), {
    text: "You've saved your list a lot today. Change it again tomorrow to save your changes. Your saved list is unchanged.",
    alert: true,
  });
  assert.equal(saveFailureText({ kind: "unknown", retrying: true }), "Something went wrong. Trying again soon.");
  assert.equal(saveFailureText({ kind: "unknown", retrying: false }, true), "Something went wrong. Change your list or reload the page to save your changes. Your saved list is unchanged.");
  // the retry after the hour lives in the page: the copy says to keep it open
  assert.equal(saveFailureText({ kind: "rate_connection", retrying: true }), "Lots of lists were saved from this connection in the last hour. Keep this page open: your list saves after the hour.");
  assert.equal(saveFailureText({ kind: "rate_connection", retrying: true }, true), "Lots of lists were saved from this connection in the last hour. Keep this page open: your changes save after the hour.");
  assert.equal(saveFailureText({ kind: "invalid", retrying: false }), "That list doesn't look right. Reload the page to save it.");
  assert.equal(saveFailureText({ kind: "invalid", retrying: false }, true), "That list doesn't look right. Reload the page to save your changes. Your saved list is unchanged.");
  // a daily limit with no saved list: the list lives only in this tab, so the copy never says it waits for tomorrow
  assert.equal(saveFailureText({ kind: "rate_network", retrying: false }), "Lots of new lists came from this network today. Your list can't be saved until tomorrow.");
  assert.equal(saveFailureText({ kind: "rate_network", retrying: false }, true), "Lots of new lists came from this network today. Change your list again tomorrow to save your changes. Your saved list is unchanged.");
  assert.equal(saveFailureText({ kind: "unknown_burger", retrying: false }), RANKER_ERROR_COPY.unknown_burger);
  const refusals = (["rate_connection", "rate_voter", "rate_network", "too_short", "too_long", "unknown_burger", "duplicate", "invalid", "network", "disabled", "unknown"] as const).flatMap((kind) =>
    [false, true].flatMap((retrying) => [saveFailureText({ kind, retrying }), saveFailureText({ kind, retrying }, true)]),
  );
  for (const text of refusals) {
    assert.doesNotMatch(text, /try again/i, "nothing to press: the copy says what saves it");
  }
  // "Count it again" refused: the list as it is, so no "your changes", and "Not counted" stays
  const replaced = { status: "replaced" as const, countsFrom: null, inBoard: false };
  assert.deepEqual(line({ length: 3, saved: replaced, failure: { kind: "rate_voter", retrying: false } }), {
    text: "Not counted: a newer list was saved from this connection. You've saved your list a lot today: count it again tomorrow.",
    alert: true,
  });
  assert.equal(
    line({ length: 3, saved: replaced, failure: { kind: "rate_connection", retrying: true } }).text,
    "Lots of lists were saved from this connection in the last hour. Keep this page open: your list counts again after the hour.",
  );
  assert.equal(line({ length: 3, saved: replaced, failure: { kind: "network", retrying: true } }).text, "Couldn't reach the counter. Trying again soon.");
  assert.equal(
    line({ length: 3, saved: replaced, failure: { kind: "unknown", retrying: false } }).text,
    "Not counted: a newer list was saved from this connection. Something went wrong: count it again, or reload the page.",
  );
  // a replaced list changed: its change is what's refused
  assert.match(line({ length: 3, saved: replaced, dirty: true, failure: { kind: "rate_voter", retrying: false } }).text, /to save your changes\. Your saved list is unchanged\.$/);
  for (const kind of ["rate_connection", "rate_voter", "rate_network", "invalid", "network", "unknown"] as const) {
    for (const retrying of [false, true]) {
      assert.doesNotMatch(countAgainFailureText({ kind, retrying }), /your changes|try again/i);
      // the live region (saveFailureLine) and the status line (autosaveLine) say the same words
      for (const dirty of [false, true]) {
        for (const saved of [null, counting, replaced]) {
          const f = { kind, retrying };
          assert.equal(saveFailureLine(f, saved, dirty), line({ length: 3, saved, dirty, failure: f }).text, `${kind} ${retrying} ${dirty} ${saved?.status}`);
        }
      }
    }
  }
  assert.equal(
    saveFailureLine({ kind: "rate_connection", retrying: true }, replaced, false),
    "Lots of lists were saved from this connection in the last hour. Keep this page open: your list counts again after the hour.",
  );
  assert.equal(
    saveFailureLine({ kind: "unknown", retrying: false }, replaced, false),
    "Not counted: a newer list was saved from this connection. Something went wrong: count it again, or reload the page.",
  );
  // a change that can't go yet is never left unsaid
  assert.deepEqual(line({ length: 3, saved: counting, dirty: true, menusFailed: true }), { text: "Your changes save once the burgers load.", alert: false });
  assert.deepEqual(line({ length: 3, dirty: true, menusFailed: true }), { text: "Your list saves once the burgers load.", alert: false });
  assert.deepEqual(line({ length: 3, saved: counting, dirty: true }), { text: "Saving…", alert: false }, "held by a check of the saved list, or the burgers loading");
  assert.deepEqual(line({ length: 3, saved: counting, menusFailed: true }), { text: "Saved. It counts from Sep 27, 2026.", alert: false });
  // a burger that left the Burger Index
  assert.deepEqual(line({ length: 4, dirty: true, problem: "gone" }), { text: "Remove the burgers no longer on the Burger Index to save your list.", alert: true });
  assert.deepEqual(line({ length: 4, saved: counting, dirty: true, problem: "gone" }), { text: "Remove the burgers no longer on the Burger Index to save your changes.", alert: true });
  assert.deepEqual(line({ length: 4, saved: counting, problem: "gone" }), { text: "Saved. It counts from Sep 27, 2026. Remove the burgers no longer on the Burger Index to save changes.", alert: false });
  // the timing
  assert.equal(AUTOSAVE_DELAY, 2000);
  assert.deepEqual([1, 2, 3, 4, 9].map(retryDelay), [5000, 15000, 60000, 60000, 60000]);
  // what is tried again by itself: the network always, an odd reply three times, the hourly budget after the hour, no other refusal
  assert.deepEqual([1, 2, 3, 4, 50].map((n) => retriesSave("network", n)), [true, true, true, true, true]);
  assert.deepEqual([1, 2, 3, 4].map((n) => retriesSave("unknown", n)), [true, true, true, false]);
  assert.equal(retriesSave("rate_connection", 7), true);
  assert.deepEqual(["rate_voter", "rate_network", "unknown_burger", "invalid", "too_short"].map((k) => retriesSave(k as never, 1)), [false, false, false, false, false]);
  const t = Date.UTC(2026, 8, 27, 14, 59, 30);
  assert.equal(untilNextHour(t), 30_000 + 15_000, "just after the hour turns");
  assert.equal(untilNextHour(Date.UTC(2026, 8, 27, 15)), 3_600_000 + 15_000);
  assert.equal(saveRetryDelay("rate_connection", 1, t), 45_000);
  assert.equal(saveRetryDelay("network", 2, t), 15_000);
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
  assert.equal(savedStatusText({ status: "replaced", countsFrom: null, inBoard: false }, today), "Not counted: a newer list was saved from this connection.");
  assert.equal(savedStatusText({ status: "void", countsFrom: null, inBoard: false }, today), "Not counted.");
  // a burger on it left the Burger Index: no change can be saved until it goes
  assert.equal(
    savedStatusText({ status: "replaced", countsFrom: null, inBoard: false }, today, true),
    "Not counted: a newer list was saved from this connection. Remove the burgers no longer on the Burger Index to count it again.",
  );
  assert.equal(
    savedStatusText({ status: "active", countsFrom: "2026-09-20", inBoard: true }, today, true),
    "Counted in the People's Top 10. Remove the burgers no longer on the Burger Index to save changes.",
  );
  assert.equal(savedStatusText({ status: "void", countsFrom: null, inBoard: false }, today, true), "Not counted. Remove the burgers no longer on the Burger Index to save changes.");
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

test("a restaurant page's 'Add to your top 10': the link, the parameter read back, and the address without it", () => {
  assert.equal(RANKER_ADD_PARAM, "add");
  assert.equal(rankerAddHref("due-west-west-village"), "/?add=due-west-west-village#rank");
  assert.equal(rankerAddHref("chain:7th-street-burger"), "/?add=chain%3A7th-street-burger#rank");
  // read back from the address the link opens (the hash is not in location.search)
  for (const key of ["due-west-west-village", "chain:7th-street-burger"]) assert.equal(addParam(new URL(rankerAddHref(key), "https://x.test").search), key);
  assert.equal(addParam("?add=chain:jimbos"), "chain:jimbos");
  // anything that isn't a menu key is ignored
  for (const bad of ["", "?q=x", "?add=", "?add=Not%20A%20Key", "?add=%3Cscript%3E", `?add=${"a".repeat(121)}`]) assert.equal(addParam(bad), null, bad);
  assert.equal(withoutAddParam("?add=chain%3Ajimbos"), "");
  assert.equal(withoutAddParam("?x=1&add=sals&y=2"), "?x=1&y=2");
  assert.equal(withoutAddParam(""), "");
});

test("adding from a link: at the end when there is room, else it says why; the words for each", () => {
  const known = (k: string) => k !== "gone";
  assert.deepEqual(linkAddOutcome([], "sals", known), { key: "sals", kind: "added", position: 1 });
  assert.deepEqual(linkAddOutcome(["a", "b", "c"], "sals", known), { key: "sals", kind: "added", position: 4 });
  assert.deepEqual(linkAddOutcome(["a", "sals", "c"], "sals", known), { key: "sals", kind: "already", position: 2 });
  const full = Array.from({ length: MAX_ITEMS }, (_, i) => `b${i}`);
  assert.deepEqual(linkAddOutcome(full, "sals", known), { key: "sals", kind: "full" });
  assert.deepEqual(linkAddOutcome([...full.slice(0, 24), "sals"], "sals", known), { key: "sals", kind: "already", position: 25 }, "on a full list it is still already there");
  assert.deepEqual(linkAddOutcome(["a"], "gone", known), { key: "gone", kind: "gone" });

  assert.equal(linkAddText({ key: "sals", kind: "added", position: 1 }, "Sal's"), "Sal's added at #1. 1 burger on your list.");
  assert.equal(linkAddText({ key: "sals", kind: "added", position: 6 }, "Sal's"), "Sal's added at #6. 6 burgers on your list.", "to a saved list too: it saves itself");
  assert.equal(linkAddText({ key: "sals", kind: "already", position: 2 }, "Sal's"), "Sal's is already on your list, at #2.");
  assert.equal(linkAddText({ key: "sals", kind: "full" }, "Sal's"), "Your list is full: 25 burgers. Remove one to add Sal's.");
  assert.equal(linkAddText({ key: "gone", kind: "gone" }, "A burger no longer listed"), "That burger is no longer on the Burger Index.");
});

test("drag to reorder: where a dragged row lands, where it is drawn, and the list it leaves", () => {
  // Five 56px rows: midpoints 28, 84, 140, 196, 252 (a row passes another once its middle crosses the other's).
  const mids = [28, 84, 140, 196, 252];
  assert.equal(dragIndex(mids, 1, 84), 1, "not moved");
  assert.equal(dragIndex(mids, 1, 139), 1, "not yet past #3's middle");
  assert.equal(dragIndex(mids, 1, 141), 2);
  assert.equal(dragIndex(mids, 1, 250), 3);
  assert.equal(dragIndex(mids, 1, 9999), 4, "never past the end");
  assert.equal(dragIndex(mids, 3, 29), 1);
  assert.equal(dragIndex(mids, 3, 27), 0);
  assert.equal(dragIndex(mids, 3, -500), 0, "never before the start");
  assert.equal(dragIndex([100], 0, 400), 0, "a list of one");
  // Rows of different heights (the #11 row carries the "Beyond your top 10" rule): still by midpoints.
  assert.equal(dragIndex([28, 84, 164, 244], 0, 165), 2);

  // The row is drawn under the pointer, inside the list: a list from 100 to 380, a 56px row grabbed 20px below its top.
  assert.equal(dragTop(250, 20, 100, 380, 56), 230);
  assert.equal(dragTop(90, 20, 100, 380, 56), 100, "not above the first row");
  assert.equal(dragTop(900, 20, 100, 380, 56), 324, "not below the last row");
  // where it lands follows the pointer, so past the list's end is the last place though the row stops at the edge
  assert.equal(dragIndex([128, 184, 240, 296, 352], 0, 900 - 20 + 28), 4);
  assert.equal(dragIndex([128, 184, 240, 296, 352], 4, 0 - 20 + 28), 0);
  // The drop is a move to that place (the numbers shown while dragging are the landing order).
  const list = ["a", "b", "c", "d", "e"];
  assert.deepEqual(moveItemTo(list, "b", dragIndex(mids, 1, 250)), ["a", "c", "d", "b", "e"]);
  assert.deepEqual(moveItemTo(list, "d", dragIndex(mids, 3, 20)), ["d", "a", "b", "c", "e"]);
});

test("the live region's words for the status line: a failed save, or a change held by a failing check, only while the line shows them", () => {
  const today = "2026-09-26";
  const counting = { status: "active" as const, countsFrom: "2026-09-27", inBoard: false };
  const base = { length: 0, saved: null, dirty: false, saving: false, failure: null, problem: null, deleted: false, menusFailed: false };
  const held = "Couldn't reach the counter. Trying again soon.";
  // a check that can't reach the counter while the list is under 3, or holds a gone burger: the line asks for that, so nothing is said
  assert.equal(autosaveTrouble({ ...base, length: 2, saved: counting, dirty: true, problem: "too_short", checkRetrying: true }), "");
  assert.equal(autosaveTrouble({ ...base, length: 4, saved: counting, dirty: true, problem: "gone", checkRetrying: true }), "");
  assert.equal(autosaveTrouble({ ...base, length: 4, saved: counting, dirty: false, checkRetrying: true }), "");
  assert.equal(autosaveTrouble({ ...base, length: 4, saved: counting, dirty: true, checkRetrying: true }), held);
  // whatever it says, the status line shows the same words, as an alert
  const saved = [null, counting] as const;
  for (const length of [0, 2, 3, 4]) {
    for (const problem of [null, "too_short", "gone"] as const) {
      for (const dirty of [false, true]) {
        for (const checkRetrying of [false, true]) {
          for (const failure of [null, { kind: "network" as const, retrying: true }, { kind: "rate_voter" as const, retrying: false }]) {
            for (const s of saved) {
              const input = { ...base, length, problem, dirty, checkRetrying, failure, saved: s };
              const said = autosaveTrouble(input);
              const line = autosaveLine(input, today);
              if (said) assert.deepEqual(line, { text: said, alert: true });
              else assert.ok(!line.alert || problem === "gone", JSON.stringify(input));
            }
          }
        }
      }
    }
  }
});
