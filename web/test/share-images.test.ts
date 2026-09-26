// Share images (lib/share-images.ts): where each page's image lives, what its card says, and the text fitting.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bestBurgersCountLine } from "../src/lib/best-burgers";
import { BOROUGH_META } from "../src/lib/boroughs";
import { rankingCountLine, RANKING_TICKETS, rankingName, rankingPath, rankingSpecs, rankMenus } from "../src/lib/rankings";
import type { PricedRestaurant } from "../src/lib/schema";
import {
  areaCard,
  estimateLines,
  fitFontSize,
  LIST_CARD_ROWS,
  listCard,
  pagePathOfSegments,
  restaurantCard,
  shareImagePath,
  shareImageSegments,
} from "../src/lib/share-images";
import { loadDataset } from "./dataset";

const NBSP = " ";

test("shareImagePath / segments: /og/<page path>.png, and back", () => {
  assert.equal(shareImagePath("/restaurants/allswell-williamsburg"), "/og/restaurants/allswell-williamsburg.png");
  assert.equal(shareImagePath("/cheapest-burgers"), "/og/cheapest-burgers.png");
  assert.deepEqual(shareImageSegments("/cheapest-burgers/manhattan/west-village"), ["cheapest-burgers", "manhattan", "west-village.png"]);
  assert.deepEqual(shareImageSegments("/best-burgers"), ["best-burgers.png"]);
  for (const path of ["/restaurants/x-1", "/burgers/smash", "/most-expensive-burgers/staten-island", "/best-burgers"]) {
    assert.equal(pagePathOfSegments(shareImageSegments(path)), path);
  }
  assert.equal(pagePathOfSegments(["restaurants", "x"]), null, "not a .png");
  assert.equal(pagePathOfSegments(["..", "x.png"]), null);
  assert.equal(pagePathOfSegments([]), null);
  assert.throws(() => shareImagePath("/"), /no share image/);
  assert.throws(() => shareImagePath("/burgers?q=x"), /no share image/);
});

test("restaurantCard: where, name, burger, price, the vs NYC line and the alt text", () => {
  const card = restaurantCard({ name: "Allswell", burger: "Classic Allswell", price: 22, neighborhood: "Williamsburg", borough: "Brooklyn", cityMedian: 20, updated: "Sep 25, 2026" });
  assert.equal(card.kind, "board");
  assert.equal(card.overline, `WILLIAMSBURG${NBSP}· BROOKLYN`);
  assert.equal(card.title, "Allswell");
  assert.equal(card.sub, "Classic Allswell");
  assert.equal(card.price, 22);
  assert.deepEqual(card.line, ["10% above the $20.00 NYC median", "Updated Sep 25, 2026"]);
  assert.equal(card.alt, "The Burger Index: the Classic Allswell at Allswell, $22.00, on a yellow order board hanging over the water");
  // The last part never breaks: a long neighborhood wraps before "STATEN ISLAND", never inside it.
  const si = restaurantCard({ name: "X", burger: "Burger", price: 20.05, neighborhood: "Todt Hill-Emerson Hill", borough: "Staten Island", cityMedian: 20, updated: "Sep 25, 2026" });
  assert.equal(si.overline, `TODT HILL-EMERSON HILL${NBSP}· STATEN${NBSP}ISLAND`);
  assert.equal(si.line[0], "Right at the $20.00 NYC median");
  const noHood = restaurantCard({ name: "X", burger: "The Big One", price: 15, neighborhood: null, borough: "Queens", cityMedian: null, updated: "Sep 25, 2026" });
  assert.equal(noHood.overline, "QUEENS");
  assert.deepEqual(noHood.line, ["Updated Sep 25, 2026"]);
  assert.match(noHood.alt, /: The Big One at X, \$15\.00,/);
});

test("areaCard: the median on the board with the menu count, as on the page's board", () => {
  const n = areaCard({ kind: "neighborhood", name: "West Village", borough: "Manhattan", median: 24, menus: "67 menus", updated: "Sep 25, 2026" });
  assert.equal(n.overline, `NEIGHBORHOOD MEDIAN${NBSP}· MANHATTAN`);
  assert.equal(n.title, "West Village");
  assert.equal(n.sub, null);
  assert.deepEqual(n.line, ["67 menus", "Updated Sep 25, 2026"]);
  assert.match(n.alt, /the West Village median burger price, \$24\.00/);
  const b = areaCard({ kind: "borough", name: "Staten Island", borough: "Staten Island", median: null, menus: "0 menus", updated: "Sep 25, 2026" });
  assert.equal(b.overline, `BOROUGH MEDIAN${NBSP}· NEW${NBSP}YORK${NBSP}CITY`);
  assert.equal(b.price, null);
  assert.deepEqual(b.line, ["No prices yet", "Updated Sep 25, 2026"]);
});

test("listCard: the ticket, the H1 without its period, the first rows and the count line", () => {
  const rows = [1, 2, 3, 4].map((rank) => ({ rank, name: `Spot ${rank}`, detail: "Cheeseburger", price: 5 + rank }));
  const card = listCard({ ticket: "Cheapest on the counter", title: "Cheapest burger spots in NYC.", rows, count: "The 25 cheapest of 531 menus in NYC." });
  assert.equal(card.overline, "CHEAPEST ON THE COUNTER");
  assert.equal(card.title, "Cheapest burger spots in NYC");
  assert.equal(card.rows.length, LIST_CARD_ROWS);
  assert.equal(card.line, "The 25 cheapest of 531 menus in NYC");
  assert.equal(card.alt, "The Burger Index: Cheapest burger spots in NYC, the first 3 with prices on a yellow order board hanging over the water");
  const unpriced = listCard({ ticket: "Critics' catch", title: "The most-recommended burgers in NYC", rows: [{ rank: 1, name: "A", detail: null, price: null }], count: null });
  assert.equal(unpriced.line, null);
  assert.match(unpriced.alt, /the first one listed on a yellow order board/);
});

test("fitFontSize / estimateLines: the largest size that keeps the text to its lines", () => {
  const opts = { width: 500, em: 0.5 };
  assert.equal(estimateLines("short", 50, opts), 1);
  // 20 characters a line at 50px: two ten-letter words fit on one line of 21, not 20.
  assert.equal(estimateLines("aaaaaaaaaa bbbbbbbbbb", 50, opts), 2);
  assert.equal(estimateLines("a".repeat(45), 50, opts), 3, "a long word breaks across lines");
  assert.equal(fitFontSize("Emily", { ...opts, lines: 1, sizes: [76, 68, 60] }), 76);
  assert.equal(fitFontSize("Brooklyn Diner LaGuardia Airport", { ...opts, lines: 1, sizes: [76, 60, 30] }), 30);
  assert.equal(fitFontSize("x".repeat(500), { ...opts, lines: 2, sizes: [60, 50] }), 50, "the last size when none fits");
});

test("the dataset: one card per restaurant, neighborhood, borough, ranking and style page, true to the page", () => {
  const data = loadDataset();
  const priced = data.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  // Every ranking card's rows are the ranking's first rows, with the page's count line.
  for (const spec of rankingSpecs(priced)) {
    const ranking = rankMenus(priced, spec);
    const card = listCard({
      ticket: RANKING_TICKETS[spec.kind],
      title: rankingName(spec),
      rows: ranking.rows.map((m) => ({ rank: m.rank, name: m.restaurant.name, detail: m.restaurant.burger.name, price: m.indexPrice })),
      count: rankingCountLine(spec, ranking),
    });
    assert.equal(card.title, rankingName(spec), rankingPath(spec));
    assert.deepEqual(
      card.rows.map((r) => r.name),
      ranking.rows.slice(0, LIST_CARD_ROWS).map((m) => m.restaurant.name),
    );
    assert.ok(!/cheapest burgers? (in|at|on|of)\b|burgers under \$/i.test(`${card.title} ${card.line} ${card.alt}`), card.alt);
  }
  assert.equal(bestBurgersCountLine(33), "All 33 places on this list, most publications first.");
  assert.equal(BOROUGH_META.length, 5);
  for (const r of priced.slice(0, 50)) assert.equal(shareImagePath(`/restaurants/${r.id}`), `/og/restaurants/${r.id}.png`);
});
