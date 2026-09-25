import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { handCheckedMenus, parseHandCheck } from "../src/lib/hand-checks";
import {
  chainCoverage,
  chainNames,
  chainSourceLocation,
  hasOtherMenus,
  isAirportLocation,
  isChainOnly,
  isChainSourceLocation,
  isRankable,
  joinList,
  joinSome,
  listedChainNames,
  listedMenus,
  listedNames,
  menuBreakdown,
  menuBreakdownShort,
  menuCounts,
  menuIndexPrices,
  menuKey,
  menuSourceRows,
  menusByIndexPrice,
  menusByIndexPriceDesc,
  NO_MENUS,
  pooledBurgerPrices,
  pricedMenus,
  shareOfCity,
  splitByCoverage,
  statusTally,
} from "../src/lib/menus";
import { MIN_HISTOGRAM, MIN_RANKED } from "../src/lib/site";
import { median, percentile } from "../src/lib/stats";
import type { MenuCounts } from "../src/lib/menus";
import type { Borough, BurgerIndex, Restaurant } from "../src/lib/schema";

let seq = 0;
/** A restaurant row with only the fields the menu helpers read filled in meaningfully. */
function place(opts: { id?: string; name?: string; chain?: string | null; price: number | null; borough?: Borough; hood?: string | null; detail?: string | null }): Restaurant {
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
    status_detail: opts.detail ?? null,
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

test("chain-only detection: priced from chains alone, no independent menu", () => {
  assert.equal(isChainOnly(menuCounts([mcd("x"), mcd("x"), place({ chain: "wendys", price: 4.01, hood: "x" })])), true);
  assert.equal(isChainOnly(menuCounts([mcd("x"), place({ price: 12, hood: "x" })])), false);
  assert.equal(isChainOnly(menuCounts([place({ price: 12 })])), false);
  // An unpriced independent doesn't make an area mixed.
  assert.equal(isChainOnly(menuCounts([mcd("x"), place({ price: null, hood: "x" })])), true);
  assert.equal(isChainOnly(NO_MENUS), false, "nothing priced is not 'chain prices only'");
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

test("coverage split keeps chain-only areas out of like-for-like comparisons", () => {
  type Area = { name: string; counts: MenuCounts; median: number | null };
  const areas: Area[] = [
    { name: "Manhattan", counts: { menus: 65, independents: 56, chains: 9, locations: 133 }, median: 18 },
    { name: "Brooklyn", counts: { menus: 7, independents: 0, chains: 7, locations: 65 }, median: 6.5 },
    { name: "Queens", counts: NO_MENUS, median: null },
  ];
  const { comparable, chainOnly } = splitByCoverage(
    areas,
    (a) => a.counts,
    (a) => a.median,
  );
  assert.deepEqual(
    comparable.map((a) => a.name),
    ["Manhattan"],
  );
  assert.deepEqual(
    chainOnly.map((a) => a.name),
    ["Brooklyn"],
  );
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
  assert.equal(joinSome(["A", "B", "C", "D", "E"], 3), "A, B, C and 2 more");
});

test("chain names come most-locations first", () => {
  const list = [place({ chain: "wendys", name: "Wendy's", price: 4.01 }), mcd("a"), mcd("b"), place({ price: 12 })];
  assert.deepEqual(chainNames(list), ["McDonald's", "Wendy's"]);
});

test("listed names say 'including' only when the list is cut", () => {
  assert.equal(listedNames(["7th Street Burger", "Burger Joint"]), ": 7th Street Burger and Burger Joint");
  assert.equal(listedNames(["A", "B", "C"]), ": A, B and C");
  assert.equal(listedNames(["A", "B", "C", "D"]), ", including A, B and C");
  assert.equal(listedNames([]), "");
});

test("listed chain names count every listed location, priced or not", () => {
  const list = [
    place({ chain: "jimbos", name: "Jimbo's", price: 17.5 }),
    place({ chain: "bareburger", name: "Bareburger", price: null }),
    place({ chain: "bareburger", name: "Bareburger", price: null }),
    place({ chain: "jimbos", name: "Jimbo's", price: 17.5 }),
    place({ chain: "jimbos", name: "Jimbo's", price: 17.5 }),
    place({ price: 12 }),
  ];
  assert.deepEqual(listedChainNames(list), ["Jimbo's", "Bareburger"]);
  assert.deepEqual(listedChainNames([place({ price: 9 })]), []);
});

test("share of the city: an area holding all or most of the NYC index's menus", () => {
  const counts = (menus: number): MenuCounts => ({ menus, independents: menus, chains: 0, locations: menus });
  assert.equal(shareOfCity(counts(57), counts(57)), "all");
  assert.equal(shareOfCity(counts(44), counts(57)), "most");
  assert.equal(shareOfCity(counts(4), counts(8)), null, "exactly half is not most");
  assert.equal(shareOfCity(counts(1), counts(57)), null);
  assert.equal(shareOfCity(NO_MENUS, counts(57)), null);
  assert.equal(shareOfCity(NO_MENUS, NO_MENUS), null);
});

test("menu source rows: every independent once, a chain once at the location its menu was read from", () => {
  const detail = "Chain-level prices from one NYC location (2 Test Street, Manhattan).";
  const a = { ...place({ chain: "jh", price: 12, detail }), address: "1 Other Street" };
  const b = { ...place({ chain: "jh", price: 12, detail }), address: "2 Test Street" };
  const solo = place({ price: 15 });
  const unpricedChain = place({ chain: "bb", price: null });
  const rows = menuSourceRows([a, b, solo, unpricedChain]);
  assert.deepEqual(
    rows.map((r) => r.id),
    [solo.id, b.id, unpricedChain.id],
  );
  const withBurgers = (r: Restaurant, prices: (number | null)[]): Restaurant => ({
    ...r,
    burgers: prices.map((price, i) => ({ id: `${r.id}--b${i}`, name: `B${i}`, price, description: null, protein: "beef", is_index_item: false })),
  });
  // The chain's copied menu (row a) is left out, unpriced items too.
  assert.deepEqual(pooledBurgerPrices([withBurgers(a, [12, 14]), withBurgers(b, [12, 14]), withBurgers(solo, [15, null, 9])]), [9, 12, 14, 15]);
});

test("chain source location: the row whose menu was read, by its address", () => {
  const detail = "Prices from an online-ordering page (order.toasttab.com). Chain-level prices from one NYC location (91 East 7 Street, Manhattan); prices may vary by location.";
  assert.equal(chainSourceLocation(detail), "91 East 7 Street, Manhattan");
  assert.equal(chainSourceLocation("The chain's menu was looked up for one NYC location (2233 Broadway, Manhattan)."), "2233 Broadway, Manhattan");
  assert.equal(chainSourceLocation(null), null);
  const at = (address: string | null, borough: Borough = "Manhattan", chain: string | null = "7th-street-burger") => ({ chain, address, borough, status_detail: detail });
  assert.equal(isChainSourceLocation(at("91 East 7 Street")), true);
  assert.equal(isChainSourceLocation(at("35-02 30 Avenue", "Queens")), false);
  assert.equal(isChainSourceLocation(at("91 East 7 Street", "Brooklyn")), false, "same street, other borough");
  assert.equal(isChainSourceLocation(at("91 East 7 Street", "Manhattan", null)), false, "independents have no chain source");
  // A hand check appends its note after the scrape's; the source is still found.
  assert.equal(isChainSourceLocation({ ...at("91 East 7 Street"), status_detail: `${detail} Prices corrected by hand after re-checking the menu on 2026-09-23: wrong item.` }), true);
});

test("hand checks: corrected and withheld notes are found and split from the scrape note", () => {
  const corrected = parseHandCheck(
    "Prices from the restaurant's own site (x.com). Prices corrected by hand after re-checking the menu on 2026-09-23: the $32 burger is the lunch price; dinner lists it at $34.",
  );
  assert.deepEqual(corrected, {
    kind: "corrected",
    checkedOn: "2026-09-23",
    reason: "the $32 burger is the lunch price; dinner lists it at $34.",
    scrapeDetail: "Prices from the restaurant's own site (x.com).",
  });
  const withheld = parseHandCheck("Prices withheld after re-checking the menu on 2026-09-23: the aggregator copy looks years out of date.");
  assert.equal(withheld?.kind, "withheld");
  assert.equal(withheld?.scrapeDetail, null);
  assert.equal(parseHandCheck("Prices from a delivery app (grubhub.com)."), null);
  assert.equal(parseHandCheck(null), null);
});

test("a chain's hand check is one corrected menu, not one per location", () => {
  const note = "Prices corrected by hand after re-checking the menu on 2026-09-23: the full Burgers section starts lower.";
  const list = [
    place({ chain: "mcdonalds", price: 4.39, detail: note }),
    place({ chain: "mcdonalds", price: 4.39, detail: note }),
    place({ name: "Waverly", price: null, detail: "Prices withheld after re-checking the menu on 2026-09-23: stale copy." }),
    place({ price: 20, detail: "Prices from the restaurant's own site." }),
  ];
  const checked = handCheckedMenus(list);
  assert.deepEqual(
    checked.map((h) => [h.check.kind, h.locations]),
    [
      ["corrected", 2],
      ["withheld", 1],
    ],
  );
});

const AIRPORT = "Airport location: McDonald's's prices from its street locations are not applied here, and no airport menu has been read.";

test("listed menus count every chain and independent once, priced or not", () => {
  const list = [
    mcd("a"),
    mcd("b"),
    place({ chain: "burger-king", name: "Burger King", price: null }),
    place({ chain: "burger-king", name: "Burger King", price: null }),
    place({ price: 12 }),
    place({ price: null }),
  ];
  assert.deepEqual(listedMenus(list), { menus: 4, independents: 2, chains: 2, locations: 6 });
  // Priced menus leave the unpriced chain and restaurant out.
  assert.deepEqual(menuCounts(list), { menus: 2, independents: 1, chains: 1, locations: 3 });
});

test("airport rows and unpriced chains never borrow a chain price", () => {
  const airport = { ...place({ chain: "mcdonalds", name: "McDonald's", price: null, detail: AIRPORT }), status: "no_menu_found" as const };
  assert.equal(isAirportLocation(airport), true);
  assert.equal(isAirportLocation(mcd("x")), false);
  // The same words on an independent restaurant are not a chain's airport concession.
  assert.equal(isAirportLocation(place({ price: null, detail: AIRPORT })), false);

  const rows = [airport, mcd("a"), mcd("b")];
  const { priced, unpriced } = chainCoverage(rows);
  assert.equal(priced.length, 2, "'Same menu, same price' lists only priced locations");
  assert.deepEqual(unpriced, [airport]);
  const bk = Array.from({ length: 3 }, () => ({ ...place({ chain: "burger-king", price: null }), status: "no_menu_found" as const }));
  assert.equal(chainCoverage(bk).priced.length, 0, "an unpriced chain has no shared price to claim");
  assert.equal(pricedMenus(bk).length, 0, "and it isn't in the index");
});

test("status tally: a chain is one menu in one status, locations keep their own status", () => {
  const airport = { ...place({ chain: "mcdonalds", name: "McDonald's", price: null, detail: AIRPORT }), status: "no_menu_found" as const };
  const bk = () => ({ ...place({ chain: "burger-king", price: null }), status: "no_menu_found" as const });
  const list = [
    airport,
    mcd("a"),
    mcd("b"),
    bk(),
    bk(),
    place({ price: 12 }),
    place({ price: null }), // no_prices
    { ...place({ price: null }), status: "no_burgers" as const },
  ];
  const t = statusTally(list);
  assert.deepEqual(t.priced, { independents: 1, chains: 1, locations: 3 }, "McDonald's is priced despite its airport row");
  assert.deepEqual(t.no_menu_found, { independents: 0, chains: 1, locations: 3 }, "Burger King once; the airport row counts as a location");
  assert.deepEqual(t.no_prices, { independents: 1, chains: 0, locations: 1 });
  assert.deepEqual(t.no_burgers, { independents: 1, chains: 0, locations: 1 });
  assert.deepEqual(t.error, { independents: 0, chains: 0, locations: 0 });
  const menus = Object.values(t).reduce((n, x) => n + x.independents + x.chains, 0);
  assert.equal(menus, listedMenus(list).menus, "every listed menu lands in exactly one status");
  assert.equal(
    Object.values(t).reduce((n, x) => n + x.locations, 0),
    list.length,
  );
});

test("per-area thresholds: five locations of one chain in a neighborhood are one menu", () => {
  const hood = [...Array.from({ length: 5 }, () => mcd("midtown")), place({ price: 14, hood: "midtown" })];
  const c = menuCounts(hood);
  assert.deepEqual([c.menus, c.locations], [2, 6]);
  assert.equal(isRankable(c, 9), false, `${c.locations} locations but only ${c.menus} menus: below MIN_RANKED`);
  assert.equal(hasOtherMenus(menuCounts(hood.slice(0, 5))), false, "a McDonald's there has no other menu to compare with");
  assert.equal(hasOtherMenus(c), true);
  assert.equal(isChainOnly(c), false);
  assert.equal(isChainOnly(menuCounts(hood.slice(0, 5))), true);
});

test("empty data: every helper returns an empty, zero answer", () => {
  assert.deepEqual(pricedMenus([]), []);
  assert.deepEqual(menuIndexPrices([]), []);
  assert.deepEqual(menuCounts([]), NO_MENUS);
  assert.deepEqual(menusByIndexPrice([]), []);
  assert.deepEqual(chainNames([]), []);
  assert.deepEqual(handCheckedMenus([]), []);
  assert.equal(isRankable(NO_MENUS, null), false);
  assert.deepEqual(listedMenus([]), NO_MENUS);
  assert.deepEqual(chainCoverage([]), { priced: [], unpriced: [] });
  assert.ok(Object.values(statusTally([])).every((t) => t.independents + t.chains + t.locations === 0));
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
  close(median(pooledBurgerPrices(data.restaurants)), data.stats.all_burgers_median, "all_burgers_median (pooled over distinct menus)");
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

test("per-menu medians match the pipeline's in the sample fixture", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/burger_index.sample.json", import.meta.url), "utf8")) as BurgerIndex;
  assertMatchesPipeline("fixture", fixture);
});

const synced = new URL("../src/data/burger_index.json", import.meta.url);
test("per-menu medians match the pipeline's in the synced dataset", { skip: !existsSync(synced) && "run npm run sync-data first" }, () => {
  assertMatchesPipeline("src/data", JSON.parse(readFileSync(synced, "utf8")) as BurgerIndex);
});
