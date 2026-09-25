import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHandCheck } from "../src/lib/hand-checks";
import {
  hasOtherMenus,
  isRankable,
  joinList,
  menuBreakdown,
  menuBreakdownShort,
  menuCounts,
  menuIndexPrices,
  menuKey,
  menusByIndexPrice,
  menusByIndexPriceDesc,
  NO_MENUS,
  pricedMenus,
} from "../src/lib/menus";
import { MIN_HISTOGRAM, MIN_RANKED } from "../src/lib/site";
import { median, percentile } from "../src/lib/stats";
import type { Borough, BurgerIndex, Restaurant } from "../src/lib/schema";
import { loadDataset } from "./dataset";

let seq = 0;
/** A restaurant row with only the fields the menu helpers read filled in meaningfully. */
function place(opts: { id?: string; name?: string; chain?: string | null; price: number | null; borough?: Borough; hood?: string | null }): Restaurant {
  seq += 1;
  const id = opts.id ?? `${opts.chain ?? "place"}-${seq}`;
  return {
    id,
    camis: null,
    name: opts.name ?? (opts.chain ? opts.chain.toUpperCase() : id),
    chain: opts.chain ?? null,
    address: `${seq} Test Street`,
    borough: opts.borough ?? "Manhattan",
    neighborhood: opts.hood ?? null,
    neighborhood_slug: opts.hood ?? null,
    zipcode: null,
    lat: null,
    lng: null,
    cuisine: null,
    website: null,
    menu_url: null,
    price_source: opts.price === null ? null : "official_site",
    status: opts.price === null ? "no_prices" : "priced",
    status_detail: null,
    scraped_at: null,
    index_price: opts.price,
    burgers: [],
  };
}

const mcd = (hood: string, borough: Borough = "Manhattan") => place({ chain: "mcdonalds", name: "McDonald's", price: 4.39, hood, borough });

test("menuKey: a chain is one key, an independent is its own id, and they can't collide", () => {
  assert.equal(menuKey({ id: "mcdonalds-allerton", chain: "mcdonalds" }), menuKey({ id: "mcdonalds-soho", chain: "mcdonalds" }));
  assert.equal(menuKey({ id: "due-west", chain: null }), "due-west");
  // An independent whose id happens to equal a chain slug is still a different menu.
  assert.notEqual(menuKey({ id: "mcdonalds", chain: null }), menuKey({ id: "x", chain: "mcdonalds" }));
});

test("a chain counts once citywide, however many locations it has", () => {
  const list = [...Array.from({ length: 150 }, (_, i) => mcd(`hood-${i % 7}`)), place({ price: 18 }), place({ price: 22 }), place({ price: null })];
  const menus = pricedMenus(list);
  assert.equal(menus.length, 3);
  const chain = menus.find((m) => m.chain === "mcdonalds");
  assert.equal(chain?.locations, 150);
  assert.equal(chain?.restaurant, list[0], "the chain's first priced location stands for it");
  assert.deepEqual(menuIndexPrices(list), [4.39, 18, 22]);
  // 150 copies would make the location median $4.39; per menu it is $18.
  assert.equal(median(menuIndexPrices(list)), 18);
  assert.deepEqual(menuCounts(list), { menus: 3, independents: 2, chains: 1, locations: 152 });
});

test("cheapest and priciest lists hold one entry per menu", () => {
  const list = [mcd("a"), mcd("b"), mcd("c"), place({ chain: "wendys", name: "Wendy's", price: 4.01 }), place({ chain: "wendys", name: "Wendy's", price: 4.01 }), place({ name: "Diner", price: 9 })];
  assert.deepEqual(
    menusByIndexPrice(list).map((m) => [m.restaurant.name, m.locations]),
    [
      ["Wendy's", 2],
      ["McDonald's", 3],
      ["Diner", 1],
    ],
  );
  assert.deepEqual(
    menusByIndexPriceDesc(list).map((m) => m.restaurant.name),
    ["Diner", "McDonald's", "Wendy's"],
  );
});

test("per area, a chain counts once inside each area it is in", () => {
  const all = [mcd("soho"), mcd("soho"), mcd("soho"), mcd("astoria", "Queens"), mcd("astoria", "Queens"), place({ price: 15, hood: "soho" })];
  const soho = all.filter((r) => r.neighborhood_slug === "soho");
  const astoria = all.filter((r) => r.neighborhood_slug === "astoria");
  assert.deepEqual(menuCounts(soho), { menus: 2, independents: 1, chains: 1, locations: 4 });
  assert.deepEqual(menuCounts(astoria), { menus: 1, independents: 0, chains: 1, locations: 2 });
  assert.deepEqual(menuIndexPrices(soho), [4.39, 15]);
  // Citywide the chain is still one menu.
  assert.equal(menuCounts(all).menus, 2);
});

test("ranking and comparison thresholds count distinct menus, not locations", () => {
  const fiveMcd = Array.from({ length: MIN_RANKED }, () => mcd("midtown"));
  const c = menuCounts(fiveMcd);
  assert.equal(c.locations, MIN_RANKED);
  assert.equal(c.menus, 1);
  assert.equal(isRankable(c, 4.39), false, "five McDonald's are one menu");
  assert.equal(hasOtherMenus(c), false, "a McDonald's can't be compared with a median of McDonald's");

  const five = Array.from({ length: MIN_RANKED }, (_, i) => place({ price: 10 + i, hood: "soho" }));
  assert.equal(isRankable(menuCounts(five), 12), true);
  assert.equal(isRankable(menuCounts(five), null), false, "no median, no rank");
  assert.equal(isRankable(menuCounts(five.slice(1)), 12), false);
  assert.equal(hasOtherMenus(menuCounts([mcd("x"), mcd("x"), place({ price: 9 })])), true);

  // The histogram minimum is a number of menus too.
  const manyCopies = [...Array.from({ length: 40 }, () => mcd("x")), place({ price: 9 })];
  assert.ok(menuIndexPrices(manyCopies).length < MIN_HISTOGRAM);
});

test("menu breakdown copy reads right for every mix", () => {
  assert.equal(menuBreakdown({ menus: 65, independents: 56, chains: 9, locations: 323 }), "56 independent restaurants and 9 chains");
  assert.equal(menuBreakdown({ menus: 1, independents: 1, chains: 0, locations: 1 }), "1 independent restaurant");
  assert.equal(menuBreakdown({ menus: 7, independents: 0, chains: 7, locations: 65 }), "7 chains");
  assert.equal(menuBreakdown(NO_MENUS), "no menus");
  assert.equal(menuBreakdownShort({ menus: 65, independents: 56, chains: 9, locations: 323 }), "56 independent + 9 chains");
  assert.equal(menuBreakdownShort({ menus: 1, independents: 0, chains: 1, locations: 3 }), "1 chain");
  assert.equal(joinList(["Brooklyn", "Queens", "the Bronx", "Staten Island"]), "Brooklyn, Queens, the Bronx and Staten Island");
  assert.equal(joinList(["Manhattan"]), "Manhattan");
  assert.equal(joinList([]), "");
});

test("hand checks: corrected and withheld notes are found after the scrape note", () => {
  const corrected = parseHandCheck(
    "Prices from the restaurant's own site (x.com). Prices corrected by hand after re-checking the menu on 2026-09-23: the $32 burger is the lunch price; dinner lists it at $34.",
  );
  assert.deepEqual(corrected, { kind: "corrected", checkedOn: "2026-09-23" });
  const withheld = parseHandCheck("Prices withheld after re-checking the menu on 2026-09-23: the aggregator copy looks years out of date.");
  assert.deepEqual(withheld, { kind: "withheld", checkedOn: "2026-09-23" });
  assert.equal(parseHandCheck("Prices from a delivery app (grubhub.com)."), null);
  assert.equal(parseHandCheck(null), null);
});

test("unpriced chain rows never borrow a chain price", () => {
  const unpricedRow = { ...place({ chain: "mcdonalds", name: "McDonald's", price: null }), status: "no_menu_found" as const };
  const rows = [unpricedRow, mcd("a"), mcd("b")];
  assert.equal(pricedMenus(rows)[0].locations, 2, "the chain's menu counts only its priced locations");
  const bk = Array.from({ length: 3 }, () => ({ ...place({ chain: "burger-king", price: null }), status: "no_menu_found" as const }));
  assert.equal(pricedMenus(bk).length, 0, "an unpriced chain isn't in the index");
  // Priced menus leave the unpriced chain and restaurant out.
  assert.deepEqual(menuCounts([...rows, ...bk, place({ price: 12 }), place({ price: null })]), { menus: 2, independents: 1, chains: 1, locations: 3 });
});

test("per-area thresholds: five locations of one chain in a neighborhood are one menu", () => {
  const hood = [...Array.from({ length: 5 }, () => mcd("midtown")), place({ price: 14, hood: "midtown" })];
  const c = menuCounts(hood);
  assert.deepEqual([c.menus, c.locations], [2, 6]);
  assert.equal(isRankable(c, 9), false, `${c.locations} locations but only ${c.menus} menus: below MIN_RANKED`);
  assert.equal(hasOtherMenus(menuCounts(hood.slice(0, 5))), false, "a McDonald's there has no other menu to compare with");
  assert.equal(hasOtherMenus(c), true);
});

test("empty data: every helper returns an empty, zero answer", () => {
  assert.deepEqual(pricedMenus([]), []);
  assert.deepEqual(menuIndexPrices([]), []);
  assert.deepEqual(menuCounts([]), NO_MENUS);
  assert.deepEqual(menusByIndexPrice([]), []);
  assert.equal(isRankable(NO_MENUS, null), false);
});

// The web computes distributions and thresholds itself; the pipeline computes the medians it
// publishes. Both must count menus the same way, or a histogram would disagree with its own board.
// The pipeline rounds with Python's round(x, 2) on binary floats (10.755 -> 10.75), so compare the
// unrounded web value within half a cent.
function assertMatchesPipeline(label: string, data: BurgerIndex) {
  const close = (a: number | null, b: number | null, what: string) => {
    if (a === null || b === null) return assert.equal(a, b, `${label}: ${what}`);
    assert.ok(Math.abs(a - b) <= 0.005 + 1e-9, `${label}: ${what} web ${a} vs pipeline ${b}`);
  };
  const city = menuIndexPrices(data.restaurants);
  close(median(city), data.stats.index_median, "index_median");
  close(percentile(city, 0.1), data.stats.index_p10, "index_p10");
  close(percentile(city, 0.9), data.stats.index_p90, "index_p90");
  assert.equal(
    data.restaurants.filter((r) => r.index_price !== null).length,
    data.stats.restaurants_priced,
    `${label}: restaurants_priced counts locations`,
  );
  for (const [kind, areas, inArea] of [
    ["borough", data.boroughs, (r: Restaurant, slug: string) => r.borough.toLowerCase().replace(/ /g, "-") === slug],
    ["neighborhood", data.neighborhoods, (r: Restaurant, slug: string) => r.neighborhood_slug === slug],
  ] as const) {
    for (const a of areas) {
      const list = data.restaurants.filter((r) => inArea(r, a.slug));
      const prices = menuIndexPrices(list);
      close(median(prices), a.index_median, `${kind} ${a.slug} index_median`);
      close(prices.length ? prices[0] : null, a.index_min, `${kind} ${a.slug} index_min`);
      close(prices.length ? prices[prices.length - 1] : null, a.index_max, `${kind} ${a.slug} index_max`);
      assert.equal(menuCounts(list).locations, a.restaurants_priced, `${kind} ${a.slug}: restaurants_priced counts locations`);
    }
  }
}

test("per-menu medians match the pipeline's in the real dataset", () => {
  assertMatchesPipeline("data/burger_index.json", loadDataset());
});
