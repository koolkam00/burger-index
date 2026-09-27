// "Burgers near <landmark>" (lib/landmarks.ts, lib/landmarks.mjs): the points, the half-mile filter, the order, the
// pages kept, the one-line answer, the titles and descriptions, the map's view and the share cards.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALONG_WORDS,
  distanceToPathKm,
  isAlong,
  LANDMARK_RADIUS_KM,
  LANDMARK_RADIUS_MILES,
  LANDMARKS,
  LANDMARKS_PATH,
  landmarkBounds,
  landmarkBySlug,
  landmarkCountLine,
  landmarkDistanceKm,
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
    // A title's short form is shorter than the sentence form.
    if (l.short !== undefined) assert.ok(l.short.length < l.near.length, l.slug);
    assert.equal(landmarkBySlug(l.slug), l);
    assert.equal(landmarkPath(l), `/burgers-near/${l.slug}`);
    assert.ok(isRankingPath(landmarkPath(l)), "the nav marks Burgers on a landmark page");
  }
  assert.ok(isRankingPath(LANDMARKS_PATH));
  assert.equal(landmarkBySlug("nowhere"), undefined);
  assert.equal(LANDMARK_RADIUS_MILES, 0.5);
  assert.ok(Math.abs(LANDMARK_RADIUS_KM - 0.804672) < 1e-9);
  // Places that are effectively one are one landmark: no two points closer than 400 m (a long place's path runs past
  // the points beside it: Chelsea Market on the High Line, City Hall at the Brooklyn Bridge; those are other pages).
  const points = LANDMARKS.filter((l) => !isAlong(l));
  for (const a of points) for (const b of points) if (a !== b) assert.ok((distanceKm(a, b) as number) > 0.4, `${a.slug} and ${b.slug} are one place`);
  assert.equal(landmarkTitle(landmarkBySlug("empire-state-building")!), "Burgers near the Empire State Building");
  assert.equal(landmarkTitle(landmarkBySlug("times-square")!), "Burgers near Times Square");
  // A point page names only the place its one point measures (no "Columbus Circle and Central Park South": that street
  // runs on for half a mile past the point); the long places are pages of their own, measured along their length.
  for (const l of points) assert.doesNotMatch(l.near, /Central Park South|High Line|Brooklyn Bridge/, l.slug);
  const along = LANDMARKS.filter((l) => isAlong(l));
  assert.deepEqual(along.map((l) => [l.slug, l.near]).sort(), [["brooklyn-bridge", "the Brooklyn Bridge"], ["central-park-south", "Central Park South"], ["high-line", "the High Line"]]);
  // Each path runs the length of its place (OpenStreetMap: the High Line 2.3 km, Central Park South 0.8 km, the
  // Brooklyn Bridge 1.8 km with its approaches) inside NYC, and its lat/lng (the middle) lies on it.
  const lengths: Record<string, number> = { "high-line": 2.3, "central-park-south": 0.83, "brooklyn-bridge": 1.77 };
  for (const l of along) {
    const path = l.path!;
    let km = 0;
    for (let i = 1; i < path.length; i++) km += distanceKm({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] }) as number;
    assert.ok(Math.abs(km - lengths[l.slug]) < 0.1, `${l.slug}: ${km} km`);
    for (const [lat, lng] of path) assert.ok(lat > 40.49 && lat < 40.92 && lng > -74.26 && lng < -73.69, l.slug);
    assert.ok((distanceToPathKm(path, l) as number) < 0.02, `${l.slug}: its lat/lng is off its path`);
  }
  assert.deepEqual(
    ["columbus-circle", "chelsea-market", "city-hall"].map((slug) => landmarkBySlug(slug)?.near),
    ["Columbus Circle", "Chelsea Market", "City Hall"],
  );
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
    answer,
    "4 burger spots within half a mile of the Here, about a 10-minute walk; their priciest burgers run from $12.00 at Near Cheap to $34.00 at Pricey (September 2026).",
  );
  assert.doesNotMatch(answer, /cheapest burger/i);
  // Never "All 4 …" or "the one …": a priced spot without coordinates can't be measured, so it is on no list.
  assert.equal(landmarkCountLine(4), "4 burger spots within half a mile, nearest first.");
  assert.equal(landmarkCountLine(1), "One burger spot within half a mile.");
  for (const n of [1, 4]) assert.doesNotMatch(landmarkCountLine(n), /\b(all|the one)\b/i);
  assert.equal(landmarkSummary(spots), "4 burger spots · priciest burgers $12.00–$34.00");

  const same = spotsNear(HERE, [at({ id: "A", price: 15, east: 0.1 }), at({ id: "B", price: 15, east: 0.2 })]);
  assert.equal(landmarkSentence(HERE, same, MONTH), "2 burger spots within half a mile of the Here, about a 10-minute walk; their priciest burgers all cost $15.00 (September 2026).");
  assert.equal(landmarkSummary(same), "2 burger spots · priciest burgers $15.00");
  const one = spotsNear(HERE, [at({ id: "Solo", price: 9.5, east: 0.1 })]);
  assert.equal(landmarkSentence(HERE, one, MONTH), "One burger spot within half a mile of the Here, about a 10-minute walk: Solo, whose priciest burger is $9.50 (September 2026).");
  assert.equal(landmarkSentence(HERE, [], MONTH), "No burger spot within half a mile of the Here, about a 10-minute walk (September 2026).");
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
  // A long name gives way to its short form, so the title keeps the count and the month.
  const long = landmarkSeo({ near: "Penn Station and Madison Square Garden", short: "Penn Station & MSG", spots: 33, radius: "half a mile", walk: "about a 10-minute walk", low: null, high: null, generatedAt: GEN });
  assert.equal(long.title, "Burgers near Penn Station & MSG: 33 burger spots (Sep 2026)");
  assert.ok(long.description.startsWith("33 burger spots within half a mile of Penn Station and Madison Square Garden"), long.description);
  const longer = landmarkSeo({ near: "the World Trade Center and the 9/11 Memorial", short: "the World Trade Center", spots: 12, radius: "half a mile", walk: "about a 10-minute walk", low: null, high: null, generatedAt: GEN });
  assert.equal(longer.title, "Burgers near the World Trade Center: 12 spots (Sep 2026)");
  const bare = landmarkSeo({ near: "Penn Station and Madison Square Garden", spots: 33, radius: "half a mile", walk: "about a 10-minute walk", low: null, high: null, generatedAt: GEN });
  assert.equal(bare.title, "Burgers near Penn Station and Madison Square Garden", "without a short form, the bare name");
  const hub = landmarksHubSeo({ landmarks: 17, radius: "half a mile", walk: "about a 10-minute walk", most: "The most are near Washington Square Park: 59 burger spots.", generatedAt: GEN });
  assert.equal(hub.title, "Burgers near 17 NYC landmarks (Sep 2026)");
  assert.ok(hub.description.endsWith("The most are near Washington Square Park: 59 burger spots."), hub.description);

  const data = loadDataset();
  const priced = data.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  const mon = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", year: "numeric" }).format(new Date(data.generated_at));
  for (const { landmark, spots } of landmarksWithPages(priced)) {
    const ends = priceEnds(spots)!;
    const d = landmarkSeo({
      near: landmark.near,
      short: landmark.short,
      spots: spots.length,
      radius: "half a mile",
      walk: "about a 10-minute walk",
      low: { name: ends.low.restaurant.name, price: ends.low.restaurant.index_price },
      high: { name: ends.high.restaurant.name, price: ends.high.restaurant.index_price },
      generatedAt: data.generated_at,
    });
    assert.ok(d.title.length <= TITLE_MAX, d.title);
    assert.ok(d.title.startsWith(`Burgers near ${landmark.near}`) || (landmark.short && d.title.startsWith(`Burgers near ${landmark.short}`)), d.title);
    // Every landmark title carries its spot count and the month.
    assert.ok(d.title.includes(`: ${spots.length} `) && d.title.endsWith(`(${mon})`), d.title);
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

test("distanceToPathKm: to the nearest point along a line, the ends included", () => {
  // A line 1 km due east of HERE's west end: from HERE to 1 km east (about 0.0118° of longitude at this latitude).
  const east = (km: number) => HERE.lng + km / (111.32 * Math.cos((HERE.lat * Math.PI) / 180));
  const north = (km: number) => HERE.lat + km / 111.2;
  const line: Array<[number, number]> = [
    [HERE.lat, HERE.lng],
    [HERE.lat, east(0.5)],
    [HERE.lat, east(1)],
  ];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  // on the line, beside its middle, and past either end (then the end is the nearest point)
  assert.ok(near(distanceToPathKm(line, { lat: HERE.lat, lng: east(0.7) })!, 0));
  assert.ok(near(distanceToPathKm(line, { lat: north(0.3), lng: east(0.7) })!, 0.3));
  assert.ok(near(distanceToPathKm(line, { lat: north(-0.2), lng: east(0.25) })!, 0.2));
  assert.ok(near(distanceToPathKm(line, { lat: HERE.lat, lng: east(1.4) })!, 0.4));
  assert.ok(near(distanceToPathKm(line, { lat: north(0.3), lng: east(-0.4) })!, 0.5));
  // one point is a point; no coordinates or no path: nothing to measure
  const spot = { lat: north(0.3), lng: east(0.4) };
  assert.equal(distanceToPathKm([[HERE.lat, HERE.lng]], spot), distanceKm(HERE, spot));
  assert.equal(distanceToPathKm(line, { lat: null, lng: null }), null);
  assert.equal(distanceToPathKm([], spot), null);
  // landmarkDistanceKm: a point landmark measures from its point, a long one from its path
  assert.equal(landmarkDistanceKm(HERE, spot), distanceKm(HERE, spot));
  assert.ok(near(landmarkDistanceKm({ ...HERE, path: line }, spot)!, 0.3));
});

test("a long place: every spot within half a mile of any point along it, nearest first, and words that say so", () => {
  const east = (km: number) => HERE.lng + km / (111.32 * Math.cos((HERE.lat * Math.PI) / 180));
  const LINE = { ...HERE, near: "the Line", path: [[HERE.lat, HERE.lng], [HERE.lat, east(2)]] as Array<[number, number]> };
  assert.ok(isAlong(LINE) && !isAlong({ path: undefined }) && !isAlong({ path: [[40.7, -74]] }));
  const spots = spotsNear(LINE, [
    at({ id: "far-end", price: 30, east: 1.95, north: 0.3 }), // 1.95 km from HERE's point, 0.3 km from the line
    at({ id: "start", price: 12, east: 0.1, north: 0.1 }),
    at({ id: "past-the-end", price: 20, east: 2.5 }), // 0.5 km past its east end
    at({ id: "off-the-line", price: 18, east: 1, north: 0.9 }),
  ]);
  assert.deepEqual(
    spots.map((s) => [s.restaurant.id, spotDistance(s)]),
    [
      ["start", "0.1 mi"],
      ["far-end", "0.2 mi"],
      ["past-the-end", "0.3 mi"],
    ],
  );
  assert.equal(
    landmarkSentence(LINE, spots, MONTH),
    `3 burger spots within half a mile of the Line, ${ALONG_WORDS}, about a 10-minute walk; their priciest burgers run from $12.00 at start to $30.00 at far-end (September 2026).`,
  );
  assert.equal(landmarkCountLine(3, true), "3 burger spots within half a mile, anywhere along it, nearest first.");
  assert.equal(landmarkCountLine(1, true), "One burger spot within half a mile, anywhere along it.");
  assert.equal(landmarkCountLine(3), "3 burger spots within half a mile, nearest first.");
  // The map's view covers the half mile around every point of the line.
  const [[w, s], [e, n]] = landmarkBounds(LINE);
  for (const [lat, lng] of LINE.path) assert.ok(w < lng && lng < e && s < lat && lat < n);
  assert.ok(Math.abs((distanceKm({ lat: HERE.lat, lng: w }, HERE) as number) - LANDMARK_RADIUS_KM) < 0.01);
  assert.ok(Math.abs((distanceKm({ lat: HERE.lat, lng: e }, { lat: HERE.lat, lng: east(2) }) as number) - LANDMARK_RADIUS_KM) < 0.01);
  const seo = landmarkSeo({ near: "the High Line", along: true, spots: 52, radius: "half a mile", walk: "about a 10-minute walk", low: { name: "A", price: 7.25 }, high: { name: "B", price: 39 }, generatedAt: GEN });
  assert.equal(seo.title, "Burgers near the High Line: 52 burger spots (Sep 2026)");
  assert.ok(seo.description.startsWith("52 burger spots within half a mile of the High Line, anywhere along it"), seo.description);
  // The real ones: each has its page, measured along it.
  const data = loadDataset();
  const priced = data.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  const pages = landmarksWithPages(priced);
  for (const slug of ["high-line", "central-park-south", "brooklyn-bridge"]) {
    const page = pages.find((p) => p.landmark.slug === slug);
    assert.ok(page, `${slug} has a page`);
    for (const x of page.spots) assert.ok(x.km <= LANDMARK_RADIUS_KM && x.km === landmarkDistanceKm(page.landmark, x.restaurant));
  }
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
  assert.equal(card.line, "4 burger spots within half a mile, nearest first");
  assert.ok(card.alt.includes("Burgers near the Here"));
});
