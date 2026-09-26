// "Nearby at a similar price" on restaurant pages (lib/nearby.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { menuKey, menusByIndexPrice } from "../src/lib/menus";
import { distanceKm, formatMiles, MORE_IN_MAX, moreInNeighborhood, NEARBY_KM, NEARBY_MAX, NEARBY_PRICE_GAP, nearbySimilar } from "../src/lib/nearby";
import type { PricedRestaurant } from "../src/lib/schema";
import { loadDataset } from "./dataset";
import { place } from "./places";

/** A priced place at a point: `east` km east and `north` km north of 40.73, -74.0 (roughly). */
function at(opts: { id: string; price: number; east?: number | null; north?: number; chain?: string | null; hood?: string | null }): PricedRestaurant {
  const r = place({ id: opts.id, name: opts.id, price: opts.price, chain: opts.chain ?? null, hood: opts.hood ?? "home" }) as PricedRestaurant;
  if (opts.east === null) return r;
  return { ...r, lat: 40.73 + (opts.north ?? 0) / 111.2, lng: -74.0 + (opts.east ?? 0) / (111.32 * Math.cos((40.73 * Math.PI) / 180)) };
}

test("distanceKm and formatMiles", () => {
  // Times Square to the Empire State Building: about 1.0 km.
  const d = distanceKm({ lat: 40.758, lng: -73.9855 }, { lat: 40.7484, lng: -73.9857 });
  assert.ok(d !== null && d > 1.0 && d < 1.1, String(d));
  assert.equal(distanceKm({ lat: null, lng: null }, { lat: 40.7, lng: -74 }), null);
  assert.equal(formatMiles(1.609344), "1.0 mi");
  assert.equal(formatMiles(0.5), "0.3 mi");
  assert.equal(formatMiles(0.01), "0.1 mi", "never 0.0");
});

test("nearbySimilar: within 1.5 km and $4, nearest first, a menu once, never its own chain", () => {
  const me = at({ id: "me", price: 20, chain: "mine" });
  const all = [
    me,
    at({ id: "own-chain", price: 20, east: 0.1, chain: "mine" }),
    at({ id: "far", price: 20, east: 1.6 }),
    at({ id: "pricey", price: 24.01, east: 0.2 }),
    at({ id: "edge", price: 24, east: 1.4 }),
    at({ id: "cheap-edge", price: 16, east: 0.9 }),
    at({ id: "near", price: 21, east: 0.3 }),
    at({ id: "chain-a", price: 19, east: 0.5, chain: "other" }),
    at({ id: "chain-b", price: 19, east: 0.4, chain: "other" }),
    at({ id: "no-coords", price: 20, east: null, hood: "elsewhere" }),
  ];
  const rows = nearbySimilar(me, all);
  assert.deepEqual(
    rows.map((r) => r.restaurant.id),
    ["near", "chain-b", "cheap-edge", "edge"],
  );
  assert.ok(rows.every((r) => r.near && r.km !== null && r.km <= NEARBY_KM));
  assert.ok(rows.length <= NEARBY_MAX);
  assert.ok(rows.every((r) => Math.abs(r.restaurant.index_price - me.index_price) <= NEARBY_PRICE_GAP));
  assert.ok(rows.every((r) => menuKey(r.restaurant) !== menuKey(me)));
});

test("nearbySimilar: the rest from the same neighborhood, closest in price first; nothing without either", () => {
  const me = at({ id: "me", price: 20, east: null, hood: "astoria" });
  const all = [
    me,
    at({ id: "hood-3", price: 23, east: 5, hood: "astoria" }),
    at({ id: "hood-1", price: 20.5, east: 4, hood: "astoria" }),
    at({ id: "hood-far-price", price: 30, east: 1, hood: "astoria" }),
    at({ id: "other-hood", price: 20, east: 0, hood: "lic" }),
  ];
  const rows = nearbySimilar(me, all);
  assert.deepEqual(
    rows.map((r) => [r.restaurant.id, r.near, r.km]),
    [
      ["hood-1", false, null],
      ["hood-3", false, null],
    ],
  );
  // A place near nothing at its price, in a neighborhood of its own: no section.
  assert.deepEqual(nearbySimilar(at({ id: "alone", price: 20, hood: "alone" }), [at({ id: "x", price: 50, east: 0.1 })]), []);
  // Near first, then the neighborhood fills the rest (a neighborhood place already near is not repeated).
  const me2 = at({ id: "me2", price: 20, east: 0, hood: "h" });
  const mixed = nearbySimilar(me2, [me2, at({ id: "near-1", price: 20, east: 0.2, hood: "h" }), at({ id: "hood-2", price: 21, east: 3, hood: "h" })]);
  assert.deepEqual(
    mixed.map((r) => [r.restaurant.id, r.near]),
    [
      ["near-1", true],
      ["hood-2", false],
    ],
  );
});

test("the dataset: every row a priced restaurant, a menu once, within $4, near or in the neighborhood", () => {
  const priced = loadDataset().restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  let withRows = 0;
  for (const r of priced) {
    const rows = nearbySimilar(r, priced);
    if (rows.length) withRows += 1;
    assert.ok(rows.length <= NEARBY_MAX);
    const keys = rows.map((x) => menuKey(x.restaurant));
    assert.equal(new Set(keys).size, keys.length, r.id);
    assert.ok(!keys.includes(menuKey(r)), r.id);
    for (const x of rows) {
      assert.ok(Math.round(Math.abs(x.restaurant.index_price - r.index_price) * 100) <= NEARBY_PRICE_GAP * 100, `${r.id} → ${x.restaurant.id}`);
      assert.ok(x.near ? x.km !== null && x.km <= NEARBY_KM : x.restaurant.neighborhood_slug === r.neighborhood_slug, `${r.id} → ${x.restaurant.id}`);
    }
  }
  assert.ok(withRows > priced.length / 2, `${withRows} of ${priced.length}`);
});

test("moreInNeighborhood: the menus Nearby doesn't show, and the neighborhood link even when Nearby took them all", () => {
  const me = at({ id: "me", price: 20, east: 0, hood: "h" });
  const a = at({ id: "a", price: 21, east: 0.2, hood: "h" });
  const b = at({ id: "b", price: 22, east: 0.3, hood: "h" });
  const all = [me, a, b];
  const hood = menusByIndexPrice(all);
  // Nearby shows both others: no "More in" rows, but the page still links "All of <neighborhood>".
  const nearby = nearbySimilar(me, all);
  assert.deepEqual(nearby.map((n) => n.restaurant.id), ["a", "b"]);
  assert.deepEqual(moreInNeighborhood(me, hood, nearby), { menus: [], linkNeighborhood: true });
  // Nothing nearby: the others are "More in" rows (never this restaurant), with the link.
  const more = moreInNeighborhood(me, hood, []);
  assert.deepEqual(more.menus.map((m) => m.key), ["a", "b"]);
  assert.equal(more.linkNeighborhood, true);
  // Alone in its neighborhood (or no neighborhood): no rows, no link.
  assert.deepEqual(moreInNeighborhood(me, menusByIndexPrice([me]), []), { menus: [], linkNeighborhood: false });
  const nowhere = { ...me, neighborhood: null, neighborhood_slug: null } as PricedRestaurant;
  assert.equal(moreInNeighborhood(nowhere, hood, []).linkNeighborhood, false);
});

test("the dataset: every page whose neighborhood has another menu links that neighborhood in its body", () => {
  const data = loadDataset();
  const priced = data.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  let linkOnly = 0;
  for (const r of priced) {
    if (!r.neighborhood_slug) continue;
    const hood = menusByIndexPrice(priced.filter((x) => x.neighborhood_slug === r.neighborhood_slug));
    const more = moreInNeighborhood(r, hood, nearbySimilar(r, priced));
    const others = hood.some((m) => m.key !== menuKey(r));
    assert.equal(more.linkNeighborhood, others, r.id);
    assert.ok(more.menus.length <= MORE_IN_MAX);
    if (others && !more.menus.length) linkOnly += 1;
  }
  // Pages like Affy's Grill (Maspeth), whose Nearby rows are every other menu there, keep the link.
  assert.ok(linkOnly > 0, "some pages have the link under Nearby only");
});
