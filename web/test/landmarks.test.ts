// "Burgers near <landmark>" (lib/landmarks.ts, lib/landmarks.mjs): the points, the half-mile filter, the order, the
// pages kept, the one-line answer, the titles and descriptions, the map's view and the share cards.
import assert from "node:assert/strict";
import { test } from "node:test";
import { segmentsText } from "../src/lib/answers";
import {
  LANDMARK_RADIUS_KM,
  LANDMARK_RADIUS_MILES,
  LANDMARKS,
  LANDMARKS_PATH,
  landmarkBounds,
  landmarkBySlug,
  landmarkCountLine,
  landmarkMapHref,
  landmarkPath,
  landmarkSentence,
  landmarksHubSentence,
  landmarkSummary,
  landmarksWithPages,
  landmarkTitle,
  MIN_LANDMARK_SPOTS,
  mostSentence,
  mostSpots,
  priceEnds,
  spotDistance,
  spotsNear,
} from "../src/lib/landmarks";
import { distanceKm } from "../src/lib/nearby";
import type { PricedRestaurant } from "../src/lib/schema";
import { DESCRIPTION_MAX, landmarkSeo, landmarksHubSeo, TITLE_MAX } from "../src/lib/seo";
import { isRankingPath } from "../src/lib/site";
import { listCard } from "../src/lib/share-images";
import { loadDataset } from "./dataset";
import { place } from "./places";

const MONTH = "September 2026";
const GEN = "2026-09-26T16:33:55Z";
const HERE = { slug: "here", name: "Here", near: "the Here", borough: "Manhattan" as const, lat: 40.73, lng: -74.0 };

/** A priced place `north` km north and `east` km east of HERE (roughly), or without coordinates. */
function at(opts: { id: string; price: number; north?: number; east?: number; chain?: string | null; noCoords?: boolean }): PricedRestaurant {
  const r = place({ id: opts.id, name: opts.id, price: opts.price, chain: opts.chain ?? null, hood: "home" }) as PricedRestaurant;
  if (opts.noCoords) return r;
  return { ...r, lat: HERE.lat + (opts.north ?? 0) / 111.2, lng: HERE.lng + (opts.east ?? 0) / (111.32 * Math.cos((HERE.lat * Math.PI) / 180)) };
}

test("LANDMARKS: unique slugs that make paths, points inside New York City, a borough each, names that fit a sentence", () => {
  const slugs = LANDMARKS.map((l) => l.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const l of LANDMARKS) {
    assert.match(l.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, l.slug);
    assert.ok(l.lat > 40.49 && l.lat < 40.92 && l.lng > -74.26 && l.lng < -73.69, `${l.slug} is outside NYC`);
    assert.ok(["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"].includes(l.borough), l.slug);
    assert.ok(l.name && l.near, l.slug);
    // The sentence form is the name, or the name with its article ("the Empire State Building", "the Met").
    assert.ok(l.near === l.name || l.near.startsWith("the "), l.slug);
    assert.equal(landmarkBySlug(l.slug), l);
    assert.equal(landmarkPath(l), `/burgers-near/${l.slug}`);
    assert.ok(isRankingPath(landmarkPath(l)), "the nav marks Burgers on a landmark page");
  }
  assert.ok(isRankingPath(LANDMARKS_PATH));
  assert.equal(landmarkBySlug("nowhere"), undefined);
  assert.equal(LANDMARK_RADIUS_MILES, 0.5);
  assert.ok(Math.abs(LANDMARK_RADIUS_KM - 0.804672) < 1e-9);
  // Places that are effectively one are one landmark: no two points closer than 400 m.
  for (const a of LANDMARKS) for (const b of LANDMARKS) if (a !== b) assert.ok((distanceKm(a, b) as number) > 0.4, `${a.slug} and ${b.slug} are one place`);
  assert.equal(landmarkTitle(landmarkBySlug("empire-state-building")!), "Burgers near the Empire State Building");
  assert.equal(landmarkTitle(landmarkBySlug("times-square")!), "Burgers near Times Square");
});

test("spotsNear: every priced spot within half a mile, nearest first, each location its own row", () => {
  const all = [
    at({ id: "b-far", price: 20, north: 0.81 }),
    at({ id: "c-edge", price: 18, north: 0.8 }),
    at({ id: "a-close", price: 30, east: 0.1 }),
    at({ id: "chain-1", price: 12, north: -0.3, chain: "burgerco" }),
    at({ id: "chain-2", price: 12, east: -0.5, chain: "burgerco" }),
    at({ id: "tie-b", price: 15, east: 0.2 }),
    at({ id: "tie-a", price: 15, east: -0.2 }),
    at({ id: "no-coords", price: 10, noCoords: true }),
  ];
  const spots = spotsNear(HERE, all);
  assert.deepEqual(
    spots.map((s) => s.restaurant.id),
    ["a-close", "tie-a", "tie-b", "chain-1", "chain-2", "c-edge"],
  );
  assert.ok(spots.every((s) => s.km <= LANDMARK_RADIUS_KM));
  for (let i = 1; i < spots.length; i++) assert.ok(spots[i - 1].km <= spots[i].km);
  assert.equal(spotDistance(spots[0]), "0.1 mi");
  assert.equal(spotDistance(spots[spots.length - 1]), "0.5 mi");
});

test("priceEnds, landmarkSentence, landmarkCountLine, landmarkSummary: spots and their priciest burgers", () => {
  const spots = spotsNear(HERE, [
    at({ id: "Near Cheap", price: 12, east: 0.1 }),
    at({ id: "Pricey", price: 34, east: 0.3 }),
    at({ id: "Far Cheap", price: 12, east: 0.6 }),
    at({ id: "Middle", price: 20, north: 0.2 }),
  ]);
  const ends = priceEnds(spots)!;
  assert.equal(ends.low.restaurant.id, "Near Cheap", "a tie goes to the nearer spot");
  assert.equal(ends.high.restaurant.id, "Pricey");
  const answer = landmarkSentence(HERE, spots, MONTH);
  assert.equal(
    segmentsText(answer),
    "4 burger spots within half a mile of the Here, about a 10-minute walk; their priciest burgers run from $12.00 at Near Cheap to $34.00 at Pricey (September 2026).",
  );
  assert.deepEqual(
    answer.filter((s) => typeof s !== "string"),
    [
      { text: "Near Cheap", href: "/restaurants/Near Cheap" },
      { text: "Pricey", href: "/restaurants/Pricey" },
    ],
  );
  assert.doesNotMatch(segmentsText(answer), /cheapest burger/i);
  assert.equal(landmarkCountLine(4), "All 4 burger spots within half a mile, nearest first.");
  assert.equal(landmarkCountLine(1), "The one burger spot within half a mile.");
  assert.equal(landmarkSummary(spots), "4 burger spots · priciest burgers $12.00–$34.00");

  const same = spotsNear(HERE, [at({ id: "A", price: 15, east: 0.1 }), at({ id: "B", price: 15, east: 0.2 })]);
  assert.equal(segmentsText(landmarkSentence(HERE, same, MONTH)), "2 burger spots within half a mile of the Here, about a 10-minute walk; their priciest burgers all cost $15.00 (September 2026).");
  assert.equal(landmarkSummary(same), "2 burger spots · priciest burgers $15.00");
  const one = spotsNear(HERE, [at({ id: "Solo", price: 9.5, east: 0.1 })]);
  assert.equal(segmentsText(landmarkSentence(HERE, one, MONTH)), "One burger spot within half a mile of the Here, about a 10-minute walk: Solo, whose priciest burger is $9.50 (September 2026).");
  assert.equal(segmentsText(landmarkSentence(HERE, [], MONTH)), "No burger spot within half a mile of the Here, about a 10-minute walk (September 2026).");
  assert.equal(priceEnds([]), null);
});

test("landmarksWithPages: the landmarks with at least 5 spots, in borough order; mostSpots and the hub's sentence", () => {
  const data = loadDataset();
  const priced = data.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  const pages = landmarksWithPages(priced);
  assert.ok(pages.length > 0);
  const order = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];
  for (let i = 1; i < pages.length; i++) assert.ok(order.indexOf(pages[i - 1].landmark.borough) <= order.indexOf(pages[i].landmark.borough));
  const kept = new Set(pages.map((p) => p.landmark.slug));
  for (const l of LANDMARKS) {
    const spots = spotsNear(l, priced);
    assert.equal(kept.has(l.slug), spots.length >= MIN_LANDMARK_SPOTS, `${l.slug}: ${spots.length} spots`);
  }
  for (const p of pages) {
    assert.ok(p.spots.length >= MIN_LANDMARK_SPOTS);
    for (const s of p.spots) {
      assert.ok(s.restaurant.lat !== null && s.restaurant.lng !== null);
      assert.ok(s.km <= LANDMARK_RADIUS_KM, `${p.landmark.slug}: ${s.restaurant.id} at ${s.km} km`);
    }
    assert.equal(new Set(p.spots.map((s) => s.restaurant.id)).size, p.spots.length, "a location once");
  }
  const most = mostSpots(pages)!;
  assert.ok(pages.every((p) => p.spots.length <= most.spots));
  const hub = landmarksHubSentence(pages, MONTH);
  assert.ok(hub.startsWith(`Burger spots within half a mile of ${pages.length} New York landmarks, about a 10-minute walk, with each spot's priciest burger (September 2026). The most are near `), hub);
  assert.equal(mostSentence({ landmarks: [{ near: "Times Square" }], spots: 36 }), "The most are near Times Square: 36 burger spots.");
  assert.equal(mostSentence({ landmarks: [{ near: "A" }, { near: "the B" }], spots: 12 }), "The most are near A and the B: 12 burger spots each.");
  assert.equal(landmarksHubSentence([], MONTH), "No landmark has burger spots within half a mile yet (September 2026).");
});

test("landmarkSeo / landmarksHubSeo: counts, the month and the ends; within the caps; no cheapest-burger claim", () => {
  const seo = landmarkSeo({
    near: "Times Square",
    spots: 36,
    radius: "half a mile",
    walk: "about a 10-minute walk",
    low: { name: "Blake's Tavern NYC", price: 12.65 },
    high: { name: "Somewhere", price: 34 },
    generatedAt: GEN,
  });
  assert.equal(seo.title, "Burgers near Times Square: 36 burger spots (Sep 2026)");
  assert.equal(
    seo.description,
    "36 burger spots within half a mile of Times Square (September 2026). Their priciest burgers run from $12.65 at Blake's Tavern NYC to $34.00 at Somewhere.",
  );
  const short = landmarkSeo({ near: "DUMBO", spots: 6, radius: "half a mile", walk: "about a 10-minute walk", low: { name: "A", price: 10 }, high: { name: "B", price: 20 }, generatedAt: GEN });
  assert.equal(short.description, "6 burger spots within half a mile of DUMBO, about a 10-minute walk (September 2026). Their priciest burgers run from $10.00 at A to $20.00 at B. Nearest first.");
  const long = landmarkSeo({ near: "Penn Station and Madison Square Garden", spots: 33, radius: "half a mile", walk: "about a 10-minute walk", low: null, high: null, generatedAt: GEN });
  assert.ok(long.title.length <= TITLE_MAX, long.title);
  assert.equal(long.title, "Burgers near Penn Station and Madison Square Garden");
  const hub = landmarksHubSeo({ landmarks: 17, radius: "half a mile", walk: "about a 10-minute walk", most: "The most are near Washington Square Park: 59 burger spots.", generatedAt: GEN });
  assert.equal(hub.title, "Burgers near 17 NYC landmarks (Sep 2026)");
  assert.ok(hub.description.endsWith("The most are near Washington Square Park: 59 burger spots."), hub.description);

  const data = loadDataset();
  const priced = data.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  for (const { landmark, spots } of landmarksWithPages(priced)) {
    const ends = priceEnds(spots)!;
    const d = landmarkSeo({
      near: landmark.near,
      spots: spots.length,
      radius: "half a mile",
      walk: "about a 10-minute walk",
      low: { name: ends.low.restaurant.name, price: ends.low.restaurant.index_price },
      high: { name: ends.high.restaurant.name, price: ends.high.restaurant.index_price },
      generatedAt: data.generated_at,
    });
    assert.ok(d.title.length <= TITLE_MAX, d.title);
    assert.ok(d.title.startsWith(`Burgers near ${landmark.near}`), d.title);
    assert.ok(d.description.length <= DESCRIPTION_MAX, d.description);
    assert.ok(d.description.startsWith(`${spots.length} burger spots within half a mile of ${landmark.near}`), d.description);
    assert.ok(d.description.includes("Their priciest burgers run from $"), d.description);
    for (const s of [d.title, d.description]) assert.doesNotMatch(s, /cheapest burgers? (near|in|at)|burgers under \$/i);
  }
});

test("landmarkBounds and landmarkMapHref: the map shows the whole half mile", () => {
  const ts = landmarkBySlug("times-square")!;
  const [[w, s], [e, n]] = landmarkBounds(ts);
  assert.ok(w < ts.lng && ts.lng < e && s < ts.lat && ts.lat < n);
  // Each edge is the radius from the point (within 1%).
  for (const edge of [{ lat: ts.lat, lng: w }, { lat: ts.lat, lng: e }, { lat: s, lng: ts.lng }, { lat: n, lng: ts.lng }]) {
    const km = distanceKm(ts, edge) as number;
    assert.ok(Math.abs(km - LANDMARK_RADIUS_KM) / LANDMARK_RADIUS_KM < 0.01, String(km));
  }
  assert.equal(landmarkMapHref(ts), "/map?near=times-square");
});

test("a landmark share card: the ticket, the H1, the nearest spots without a rank, the count line", () => {
  const spots = spotsNear(HERE, [at({ id: "One", price: 12, east: 0.1 }), at({ id: "Two", price: 20, east: 0.3 }), at({ id: "Three", price: 18, east: 0.4 }), at({ id: "Four", price: 9, east: 0.5 })]);
  const card = listCard({
    ticket: "Shore leave",
    title: landmarkTitle(HERE),
    rows: spots.map((s) => ({ rank: null, name: s.restaurant.name, detail: `${s.restaurant.burger.name} · ${spotDistance(s)}`, price: s.restaurant.index_price })),
    count: landmarkCountLine(spots.length),
  });
  assert.equal(card.overline, "SHORE LEAVE");
  assert.equal(card.title, "Burgers near the Here");
  assert.deepEqual(
    card.rows.map((r) => `${r.rank ?? "-"} ${r.name} · ${r.detail} · ${r.price}`),
    ["- One · Cheeseburger · 0.1 mi · 12", "- Two · Cheeseburger · 0.2 mi · 20", "- Three · Cheeseburger · 0.2 mi · 18"],
  );
  assert.equal(card.line, "All 4 burger spots within half a mile, nearest first");
  assert.ok(card.alt.includes("Burgers near the Here"));
});
