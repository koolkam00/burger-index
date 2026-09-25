// Titles, meta descriptions and llms.txt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatIsoDay, formatMonthYear } from "../src/lib/format";
import { llmsTxt } from "../src/lib/llms";
import {
  assemble,
  boroughSeo,
  DESCRIPTION_MAX,
  homeSeo,
  neighborhoodSeo,
  pickTitle,
  restaurantSeo,
  restaurantTitle,
  sharedTitleIds,
  sourceLine,
  TITLE_MAX,
  truncate,
  versus,
} from "../src/lib/seo";
import type { PricedRestaurant } from "../src/lib/schema";
import { loadDataset } from "./dataset";

const GEN = "2026-09-25T13:44:09Z";

test("formatMonthYear / formatIsoDay: New York calendar month and day", () => {
  assert.equal(formatMonthYear(GEN), "September 2026");
  assert.equal(formatMonthYear(GEN, { short: true }), "Sep 2026");
  // 02:30 UTC on Oct 1 is still September 30 in New York.
  assert.equal(formatMonthYear("2026-10-01T02:30:00Z"), "September 2026");
  assert.equal(formatIsoDay("2026-10-01T02:30:00Z"), "2026-09-30");
  assert.equal(formatIsoDay("2026-09-23"), "2026-09-23");
});

test("sourceLine: the one plain source and month line", () => {
  assert.equal(sourceLine(GEN), "Prices from restaurant menus and ordering pages, checked September 2026.");
});

test("versus: the page's vs NYC in words", () => {
  assert.equal(versus(15.99, 20), "20% below the $20.00 NYC median");
  assert.equal(versus(26, 20), "30% above the $20.00 NYC median");
  assert.equal(versus(20.05, 20), "right at the $20.00 NYC median");
  assert.equal(versus(18, 16, "Astoria median"), "13% above the $16.00 Astoria median");
  assert.equal(versus(18, null), null);
});

test("assemble: sentences in priority order while they fit, written order kept, alternatives tried in turn", () => {
  assert.equal(assemble("Lead.", ["One.", "Two."], 20), "Lead. One. Two.");
  assert.equal(assemble("Lead.", ["Too long a sentence.", "Two."], 16), "Lead. Two.");
  assert.equal(assemble("Lead.", [{ text: "Later.", rank: 2 }, { text: "First.", rank: 1 }], 13), "Lead. First.");
  assert.equal(assemble("Lead.", [{ text: "B.", rank: 1 }, { text: "A.", rank: 0 }], 30), "Lead. B. A.");
  assert.equal(assemble("Lead.", [["A much longer sentence.", "Short."]], 14), "Lead. Short.");
  assert.equal(assemble("Lead.", [null, false, undefined, ""]), "Lead.");
  assert.ok(assemble("x".repeat(200), []).length <= DESCRIPTION_MAX);
});

test("truncate: at a word boundary with an ellipsis, never over the cap", () => {
  const t = truncate("word ".repeat(60).trim(), 50);
  assert.ok(t.length <= 50);
  assert.ok(t.endsWith("…"));
  assert.ok(!t.includes(" …"));
  assert.equal(truncate("short", 50), "short");
});

test("pickTitle: the first that fits, else the last", () => {
  assert.equal(pickTitle(["x".repeat(61), "fits", "also"]), "fits");
  assert.equal(pickTitle([null, "x".repeat(70), "y".repeat(65)]), "y".repeat(65));
});

test("restaurantTitle: neighborhood, then borough, then none; the address when shared", () => {
  const base = { name: "Allswell", address: "124 Bedford Avenue", neighborhood: "Williamsburg", borough: "Brooklyn" as const, price: 22, ambiguous: false };
  assert.equal(restaurantTitle(base), "Allswell: $22 burger in Williamsburg");
  assert.equal(
    restaurantTitle({ ...base, name: "Tommy's Tavern and Tap", neighborhood: "Todt Hill-Emerson Hill-Heartland Village-Lighthouse Hill", borough: "Staten Island" }),
    "Tommy's Tavern and Tap: $22 burger in Staten Island",
  );
  assert.equal(restaurantTitle({ ...base, neighborhood: "Soundview-Castle Hill-Clason Point-Harding Park-and-more", borough: "Bronx" }), "Allswell: $22 burger in the Bronx");
  assert.equal(restaurantTitle({ ...base, ambiguous: true }), "Allswell: $22 burger at 124 Bedford Avenue");
  assert.equal(restaurantTitle({ ...base, price: 15.99 }), "Allswell: $15.99 burger in Williamsburg");
});

test("restaurantSeo: burger, place, price, vs NYC and the month, within 160 characters", () => {
  const seo = restaurantSeo({
    name: "3 Sheets Saloon",
    address: "134 West 3 Street",
    neighborhood: "West Village",
    borough: "Manhattan",
    burger: "Fatso’s Burger",
    price: 15.99,
    cityMedian: 20,
    hoodMedian: 24,
    source: "Restaurant site",
    generatedAt: GEN,
    ambiguous: false,
  });
  assert.equal(seo.title, "3 Sheets Saloon: $15.99 burger in West Village");
  assert.equal(
    seo.description,
    "Fatso’s Burger at 3 Sheets Saloon, 134 West 3 Street, West Village, Manhattan: $15.99. 20% below the $20.00 NYC median. Source: Restaurant site, September 2026.",
  );
  assert.ok(seo.description.length <= DESCRIPTION_MAX);
});

test("area titles and descriptions carry the median, the comparison and the month", () => {
  const b = boroughSeo({ borough: "Bronx", median: 16.58, menus: 32, cityMedian: 20, cheapest: { name: "Johnny's Reef", price: 6 }, priciest: { name: "Crosstown Diner", price: 26.95 }, generatedAt: GEN });
  assert.equal(b.title, "Burger prices in the Bronx: $16.58 median");
  assert.match(b.description, /^What a burger costs in the Bronx: \$16\.58, the median across 32 menus\. 17% below the \$20\.00 NYC median\./);
  assert.ok(b.description.length <= DESCRIPTION_MAX);

  const n = neighborhoodSeo({ name: "Astoria", ambiguous: false, borough: "Queens", median: 17.25, menus: 3, cityMedian: 20, cheapest: null, priciest: null, only: null, generatedAt: GEN });
  assert.equal(n.title, "Burger prices in Astoria: $17.25 median");
  assert.match(n.description, /September 2026\.$/);
  const long = neighborhoodSeo({ ...{ name: "Breezy Point-Belle Harbor-Rockaway Park-Broad Channel", ambiguous: false, borough: "Queens" as const, median: 17, menus: 4, cityMedian: 20, cheapest: null, priciest: null, only: null, generatedAt: GEN } });
  assert.equal(long.title, "Breezy Point-Belle Harbor-Rockaway Park-Broad Channel burgers: $17");
  const one = neighborhoodSeo({ name: "Old Astoria", ambiguous: false, borough: "Queens", median: 12.49, menus: 1, cityMedian: 20, cheapest: null, priciest: null, only: { restaurant: "Petey's Burger", burger: "Triple Cheeseburger" }, generatedAt: GEN });
  assert.equal(one.title, "Burger prices in Old Astoria: $12.49");
  assert.match(one.description, /^What a burger costs in Old Astoria, Queens: Triple Cheeseburger at Petey's Burger, \$12\.49\./);
  const uws = neighborhoodSeo({ name: "Upper West Side", ambiguous: false, borough: "Manhattan", median: 21.95, menus: 12, cityMedian: 20, cheapest: null, priciest: null, only: null, generatedAt: GEN });
  assert.equal(uws.title, "Burger prices in the Upper West Side: $21.95 median");
  assert.match(uws.description, /^What a burger costs in the Upper West Side, Manhattan: \$21\.95/);
  const parks = neighborhoodSeo({ name: "Bronx parks", ambiguous: false, borough: "Bronx", median: 18, menus: 2, cityMedian: 20, cheapest: null, priciest: null, only: null, generatedAt: GEN });
  assert.match(parks.description, /^What a burger costs in Bronx parks: \$18\.00/);
  assert.ok(!/median across 1 menu/.test(one.description));

  const home = homeSeo({ median: 20, menus: 532, generatedAt: GEN, cheapest: null, priciest: null });
  assert.equal(home.title, "The Burger Index: NYC burger prices, $20 median (Sep 2026)");
  assert.ok(home.title.length <= TITLE_MAX);
});

test("the real dataset: every restaurant title is unique and every description within 160 characters", () => {
  const data = loadDataset();
  const priced = data.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  const list = priced.map((r) => ({ ...r, price: r.index_price }));
  const shared = sharedTitleIds(list);
  const titles = new Map<string, string>();
  for (const r of list) {
    const seo = restaurantSeo({
      name: r.name,
      address: r.address,
      neighborhood: r.neighborhood,
      borough: r.borough,
      burger: r.burger.name,
      price: r.price,
      cityMedian: data.stats.index_median,
      hoodMedian: null,
      source: "Restaurant site",
      generatedAt: data.generated_at,
      ambiguous: shared.has(r.id),
    });
    assert.ok(!titles.has(seo.title), `"${seo.title}" for ${r.id} and ${titles.get(seo.title)}`);
    titles.set(seo.title, r.id);
    assert.ok(seo.description.length <= DESCRIPTION_MAX, r.id);
  }
});

test("llmsTxt: headline numbers, the date, links to pages and the CSV, all on the site", () => {
  const site = "https://burger-index.example";
  const txt = llmsTxt({
    site,
    generatedAt: GEN,
    sourceLine: sourceLine(GEN),
    median: 20,
    menus: 532,
    locations: 548,
    pins: 526,
    p10: 13,
    p90: 28.46,
    boroughs: [{ name: "Manhattan", slug: "manhattan", median: 21.97, menus: 306 }],
    cheapest: { restaurant: "Johnny's Reef", burger: "Cheeseburger", price: 6, where: "City Island, Bronx", path: "/restaurants/johnnys-reef" },
    priciest: null,
    neighborhoods: {
      pages: 121,
      ranked: 27,
      top: { name: "Upper East Side-Carnegie Hill", price: 25.95, path: "/neighborhoods/upper-east-side-carnegie-hill" },
      bottom: { name: "Bay Ridge", price: 14.73, path: "/neighborhoods/bay-ridge" },
    },
    csvPath: "/data/burger-prices.csv",
    sections: [{ title: "Rankings", links: [{ title: "Cheapest burgers in NYC", path: "/cheapest-burgers" }] }],
  });
  assert.match(txt, /^# The Burger Index\n\n> /);
  assert.match(txt, /The NYC Burger Index is \$20\.00/);
  assert.match(txt, /Updated Sep 25, 2026/);
  assert.match(txt, /checked September 2026/);
  assert.match(txt, /Most prices fall between \$13 and \$29/);
  assert.match(txt, /- Manhattan: \$21\.97 median across 306 menus/);
  // Neighborhood ends only among the ranked ones; the map note counts its pins.
  assert.match(txt, /- Priciest of the 27 ranked neighborhoods: \[Upper East Side-Carnegie Hill\]\([^)]+\), \$25\.95 median/);
  assert.match(txt, /- Cheapest of the 27 ranked neighborhoods: \[Bay Ridge\]\([^)]+\), \$14\.73 median/);
  assert.match(txt, /\[Map\]\([^)]+\): 526 of the 548 priced restaurants on a map/);
  assert.ok(!/every priced restaurant/.test(txt));
  assert.match(txt, /\[Burger prices \(CSV\)\]\(https:\/\/burger-index\.example\/data\/burger-prices\.csv\)/);
  assert.match(txt, /## Rankings\n\n- \[Cheapest burgers in NYC\]\(https:\/\/burger-index\.example\/cheapest-burgers\)/);
  const links = [...txt.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length > 5);
  for (const l of links) assert.ok(l === site || l.startsWith(`${site}/`), l);
});
