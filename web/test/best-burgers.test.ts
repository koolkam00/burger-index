// The most-recommended burgers (lib/best-burgers.ts) and its curated file, ../data/best_burgers.json:
// the 2026-09-25 decisions (lists of 2024-2026, no Upper Cut Media House, no trend features, beef burgers
// only, two or more publishers), facts only, and the ranking by distinct publishers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BEST_BURGERS_NAME,
  bestBurgersLede,
  bestBurgersProblems,
  formatListDate,
  leaders,
  rankBestBurgers,
  type BestBurgersFile,
} from "../src/lib/best-burgers";
import { itemListNode } from "../src/lib/jsonld";
import type { PricedRestaurant, Restaurant } from "../src/lib/schema";
import { bestBurgersSeo, DESCRIPTION_MAX, TITLE_MAX } from "../src/lib/seo";
import { loadDataset } from "./dataset";
import { place } from "./places";

const FILE = JSON.parse(readFileSync(new URL("../../data/best_burgers.json", import.meta.url), "utf8")) as BestBurgersFile;
const DATA = loadDataset();

test("best_burgers.json fits the dataset: every id, list and neighborhood exists, two or more publishers each", () => {
  assert.deepEqual(bestBurgersProblems(FILE, DATA.restaurants, DATA.neighborhoods), []);
  assert.equal(FILE.version, 1);
  assert.deepEqual(FILE.years, { from: 2024, to: 2026 });
});

test("best_burgers.json applies the decisions: 2024-2026 lists only, no Upper Cut, no trend piece, beef burgers only", () => {
  for (const l of FILE.lists) {
    const year = +l.date.slice(0, 4);
    assert.ok(year >= 2024 && year <= 2026, `${l.id} ${l.date}`);
    assert.ok(!/upper cut|world'?s (101|25) best/i.test(`${l.publisher} ${l.title}`), l.id);
    assert.match(l.url, /^https:\/\//);
  }
  const ids = new Set(FILE.lists.map((l) => l.id));
  for (const out of ["grubstreet-best-new-burgers-2025", "worlds-101-best-burger-places-2026", "worlds-25-best-burgers-2025", "thrillist-best-burgers-nyc", "grubstreet-absolute-best-burger-2016"]) {
    assert.ok(!ids.has(out), `${out} is left out`);
  }
  const keys = new Set(FILE.places.map((p) => p.key));
  // National chain, vegetarian/vegan and lamb picks, closed places, and a place whose only second
  // publisher named a bison burger (Old Town Bar): none are on the page.
  for (const out of ["shake-shack", "superiority", "moonburger", "toad-style", "cervos", "harts", "blue-hour", "guss", "old-town-bar"]) assert.ok(!keys.has(out), out);
  for (const p of FILE.places) for (const s of p.sources) if (s.burger) assert.ok(!/bison|lamb|turkey|chicken|veg|plant|impossible|beyond|fish|salmon/i.test(s.burger), `${p.key}: ${s.burger}`);
});

test("best_burgers.json holds facts only: names, short burger names, titles, links, dates", () => {
  const allowed = { file: ["version", "updated", "years", "lists", "places"], list: ["id", "publisher", "title", "url", "date"], place: ["key", "name", "restaurant_id", "neighborhood_slug", "sources"], source: ["list", "burger"] };
  assert.deepEqual(Object.keys(FILE).sort(), [...allowed.file].sort());
  for (const l of FILE.lists) assert.deepEqual(Object.keys(l).sort(), [...allowed.list].sort());
  for (const p of FILE.places) {
    assert.deepEqual(Object.keys(p).sort(), [...allowed.place].sort());
    for (const s of p.sources) {
      assert.deepEqual(Object.keys(s).sort(), [...allowed.source].sort());
      // A burger's name, never a sentence from the list.
      if (s.burger) assert.ok(s.burger.length <= 60 && s.burger.split(/\s+/).length <= 8 && !/[.!?]$/.test(s.burger), s.burger);
    }
  }
});

test("rankBestBurgers on the real file: most publishers first, ties share a rank and go by name, prices from the dataset", () => {
  const entries = rankBestBurgers(FILE, DATA.restaurants, DATA.neighborhoods);
  assert.equal(entries.length, FILE.places.length);
  assert.equal(entries[0].name, "Red Hook Tavern");
  assert.equal(entries[0].rank, 1);
  assert.equal(entries[0].publishers.length, 10);
  assert.equal(entries[0].restaurant?.id, "red-hook-tavern-carroll-gardens");
  for (let i = 1; i < entries.length; i++) {
    const [a, b] = [entries[i - 1], entries[i]];
    assert.ok(a.publishers.length >= b.publishers.length);
    if (a.publishers.length === b.publishers.length) {
      assert.equal(b.rank, a.rank);
      assert.ok(a.name.localeCompare(b.name, "en", { sensitivity: "base" }) <= 0, `${a.name} before ${b.name}`);
    } else assert.equal(b.rank, i + 1);
  }
  // A chain's People's Price key is its chain; unpriced places have no price, no page and no key.
  const byKey = new Map(entries.map((e) => [e.key, e]));
  assert.equal(byKey.get("7th-street-burger")?.menuKey, "chain:7th-street-burger");
  for (const k of ["peter-luger", "le-b", "crane-club"]) {
    assert.equal(byKey.get(k)?.restaurant, null, k);
    assert.equal(byKey.get(k)?.menuKey, null, k);
  }
  assert.deepEqual(byKey.get("crane-club")?.neighborhood, { name: "Hudson Yards-Chelsea-Flat Iron-Union Square", slug: "hudson-yards-chelsea-flat-iron-union-square", borough: "Manhattan", hasPage: true });
  assert.equal(byKey.get("peter-luger")?.neighborhood?.name, "Williamsburg");
  // Every list a place cites, newest first.
  for (const e of entries) for (let i = 1; i < e.sources.length; i++) assert.ok(e.sources[i - 1].list.date >= e.sources[i].list.date, e.key);
});

test("rankBestBurgers: distinct publishers, not lists; unknown ids are unpriced", () => {
  const restaurants: Restaurant[] = [place({ id: "a", price: 20, hood: "soho" }), place({ id: "b", price: null, hood: "soho" })];
  const hoods = [{ slug: "soho", name: "SoHo", borough: "Manhattan" as const, restaurants_priced: 1, index_median: 20, index_min: 20, index_max: 20 }];
  const file: BestBurgersFile = {
    version: 1,
    updated: "2026-09-25",
    years: { from: 2024, to: 2026 },
    lists: [
      { id: "x1", publisher: "X", title: "X one", url: "https://x.test/1", date: "2026-01-02" },
      { id: "x2", publisher: "X", title: "X two", url: "https://x.test/2", date: "2025" },
      { id: "y1", publisher: "Y", title: "Y one", url: "https://y.test/1", date: "2024-05" },
      { id: "z1", publisher: "Z", title: "Z one", url: "https://z.test/1", date: "2026-03-01" },
    ],
    places: [
      { key: "alpha", name: "Alpha", restaurant_id: "a", neighborhood_slug: null, sources: [{ list: "x1", burger: null }, { list: "x2", burger: "Burger" }, { list: "y1", burger: null }] },
      { key: "beta", name: "beta", restaurant_id: "b", neighborhood_slug: null, sources: [{ list: "y1", burger: null }, { list: "z1", burger: null }] },
      { key: "gamma", name: "Gamma", restaurant_id: null, neighborhood_slug: "soho", sources: [{ list: "x1", burger: null }, { list: "y1", burger: null }, { list: "z1", burger: null }] },
    ],
  };
  assert.deepEqual(bestBurgersProblems(file, restaurants, hoods), []);
  const entries = rankBestBurgers(file, restaurants, hoods);
  // Gamma: 3 publishers; Alpha (3 lists, 2 publishers) ties beta (2 lists, 2 publishers): by name.
  assert.deepEqual(entries.map((e) => [e.rank, e.name, e.publishers.length]), [[1, "Gamma", 3], [2, "Alpha", 2], [2, "beta", 2]]);
  assert.equal(entries[1].restaurant?.id, "a");
  assert.equal(entries[1].menuKey, "a");
  assert.equal(entries[2].restaurant, null, "an unpriced restaurant has no price");
  assert.deepEqual(entries[1].sources.map((s) => s.list.id), ["x1", "x2", "y1"]);
  assert.deepEqual(leaders(entries).map((e) => e.name), ["Gamma"]);
  assert.equal(bestBurgersLede(entries, "September 2026"), "Gamma tops the list: 3 publications named it.");
  assert.equal(bestBurgersLede(entries.slice(1).map((e) => ({ ...e, rank: 1 })), "September 2026"), "Alpha and beta top the list: 2 publications named each.");
});

test("bestBurgersProblems: catches what the decisions rule out", () => {
  const restaurants: Restaurant[] = [place({ id: "a", price: 20, hood: "soho" })];
  const base: BestBurgersFile = {
    version: 1,
    updated: "2026-09-25",
    years: { from: 2024, to: 2026 },
    lists: [
      { id: "x1", publisher: "X", title: "X one", url: "https://x.test/1", date: "2023-12-31" },
      { id: "u1", publisher: "Upper Cut Media House", title: "World's 101 Best Burger Places 2026", url: "https://u.test", date: "2026-06" },
      { id: "n1", publisher: "N", title: "Unused", url: "http://n.test", date: "2026" },
    ],
    places: [
      { key: "one", name: "One", restaurant_id: "a", neighborhood_slug: null, sources: [{ list: "x1", burger: null }, { list: "x1", burger: null }] },
      { key: "two", name: "Two", restaurant_id: "zzz", neighborhood_slug: null, sources: [{ list: "u1", burger: null }] },
      { key: "three", name: "Three", restaurant_id: null, neighborhood_slug: null, sources: [{ list: "nope", burger: null }] },
    ],
  };
  const problems = bestBurgersProblems(base, restaurants, []).join("\n");
  for (const want of ["outside 2024-2026", "Upper Cut Media House lists are left out", "url is not https", "restaurant zzz is not in the dataset", "counted twice", "fewer than 2", "needs a known neighborhood_slug", "unknown list nope", "names no place on the page"]) {
    assert.ok(problems.includes(want), `expected "${want}" in:\n${problems}`);
  }
});

test("formatListDate: as precise as the list's date", () => {
  assert.equal(formatListDate("2026-06-25"), "Jun 25, 2026");
  assert.equal(formatListDate("2026-06"), "Jun 2026");
  assert.equal(formatListDate("2026"), "2026");
});

test("the real page's lede, title and description: numbers and names, publications' opinion only", () => {
  const entries = rankBestBurgers(FILE, DATA.restaurants, DATA.neighborhoods);
  const lede = bestBurgersLede(entries, "September 2026");
  assert.equal(lede, "Red Hook Tavern tops the list: 10 publications named it. The Dry-Aged Red Hook Tavern Burger there costs $34.00 on the menu (September 2026).");
  const seo = bestBurgersSeo({ name: BEST_BURGERS_NAME, places: entries.length, leaders: leaders(entries).map((e) => e.name), publishers: 10, years: FILE.years, generatedAt: DATA.generated_at });
  assert.equal(seo.title, "The most-recommended burgers in NYC (Sep 2026)");
  assert.ok(seo.title.length <= TITLE_MAX);
  assert.ok(seo.description.length <= DESCRIPTION_MAX, seo.description);
  assert.match(seo.description, /^36 NYC burger places ranked by how many publications named each on a best-burger list in 2024–2026, with the menu price\./);
  for (const s of [seo.title, seo.description, lede]) assert.ok(!/\bbest burgers?\b|\btop-rated\b/i.test(s), s);
});

test("itemListNode: a place without a page is a name without a url", () => {
  const node = itemListNode("https://x.test", { name: "L", entries: [{ name: "A", path: "/restaurants/a" }, { name: "B", path: null }] }) as unknown as { itemListElement: Array<Record<string, unknown>> };
  assert.deepEqual(node.itemListElement, [
    { "@type": "ListItem", position: 1, name: "A", url: "https://x.test/restaurants/a" },
    { "@type": "ListItem", position: 2, name: "B" },
  ]);
});

test("every priced place on the page has a restaurant page and its burger is the dataset's", () => {
  const entries = rankBestBurgers(FILE, DATA.restaurants, DATA.neighborhoods);
  const priced = new Map(DATA.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null).map((r) => [r.id, r]));
  for (const e of entries) if (e.restaurant) assert.equal(priced.get(e.restaurant.id)?.burger.name, e.restaurant.burger.name);
  assert.ok(entries.filter((e) => e.restaurant).length >= 30);
});
