// The restaurant price badge (lib/badge.ts), its smaller SVG paths (lib/svg-path.ts) and the press kit's credit line.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  badgeAlt,
  badgePageFor,
  badgePath,
  badgeSnippet,
  badgeSpots,
  badgeText,
  BADGE_HEIGHT,
  BADGE_WIDTH,
  searchBadgeSpots,
} from "../src/lib/badge";
import { PRESS_PATH, pressCitation } from "../src/lib/press";
import { badgePageSeo, DESCRIPTION_MAX, pressSeo, TITLE_MAX } from "../src/lib/seo";
import { compactPath, compactSvgPaths } from "../src/lib/svg-path";

const GEN = "2026-09-25T13:44:09Z";

test("badgeText: the price, how it compares with the NYC median, the brand and month", () => {
  const t = badgeText({ price: 22, cityMedian: 20, generatedAt: GEN });
  assert.equal(t.price, "$22 burger");
  assert.equal(t.compare, "10% above the $20.00 NYC median");
  assert.equal(t.brand, "THE BURGER INDEX · SEP 2026");
  assert.equal(t.label, "$22 burger, 10% above the $20.00 NYC median (The Burger Index, September 2026)");
  assert.equal(badgeText({ price: 15.99, cityMedian: 20, generatedAt: GEN }).price, "$15.99 burger");
  assert.equal(badgeText({ price: 15.99, cityMedian: 20, generatedAt: GEN }).compare, "20% below the $20.00 NYC median");
  assert.equal(badgeText({ price: 20.05, cityMedian: 20, generatedAt: GEN }).compare, "Right at the $20.00 NYC median");
  const none = badgeText({ price: 18, cityMedian: null, generatedAt: GEN });
  assert.equal(none.compare, null);
  assert.equal(none.label, "$18 burger (The Burger Index, September 2026)");
  // Honest text only: a price and a comparison, never praise.
  for (const p of [6, 20, 75]) assert.ok(!/best|top|great|award|rated/i.test(JSON.stringify(badgeText({ price: p, cityMedian: 20, generatedAt: GEN }))));
});

test("badge paths, the page link and the HTML snippet", () => {
  assert.equal(badgePath("allswell-williamsburg"), "/badge/allswell-williamsburg.svg");
  assert.equal(badgePageFor("allswell-williamsburg"), "/badge?r=allswell-williamsburg");
  const text = badgeText({ price: 22, cityMedian: 20, generatedAt: GEN });
  assert.equal(badgeAlt("Allswell", text), "Allswell on The Burger Index: $22 burger, 10% above the $20.00 NYC median (September 2026)");
  const html = badgeSnippet({ site: "https://x.example", id: "a-b", name: `Joe's "Best" & Co <Bar>`, text });
  assert.equal(
    html,
    `<a href="https://x.example/restaurants/a-b"><img src="https://x.example/badge/a-b.svg" width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" alt="Joe's &quot;Best&quot; &amp; Co &lt;Bar&gt; on The Burger Index: $22 burger, 10% above the $20.00 NYC median (September 2026)"></a>`,
  );
});

test("badgeSpots / searchBadgeSpots: every priced location by name; accents folded, names that start with the query first", () => {
  const spots = badgeSpots({
    menus: [
      { key: "chain:x", burger: "B", description: null, price: 12.5, spots: [{ id: "x-1", name: "Xavier's", hood: "astoria", borough: "Queens" }, { id: "x-2", name: "Xavier's", hood: null, borough: "Bronx" }] },
      { key: "cafe", burger: "B", description: null, price: 20, spots: [{ id: "cafe", name: "Café Luxembourg", hood: "uws", borough: "Manhattan" }] },
      { key: "old", burger: "B", description: null, price: 30, spots: [{ id: "old", name: "Old Cafe", hood: null, borough: "Brooklyn" }] },
    ],
  });
  assert.deepEqual(
    spots.map((s) => [s.id, s.price]),
    [["cafe", 20], ["old", 30], ["x-1", 12.5], ["x-2", 12.5]],
  );
  assert.deepEqual(searchBadgeSpots(spots, "cafe").map((s) => s.id), ["cafe", "old"]);
  assert.deepEqual(searchBadgeSpots(spots, "CAFÉ lux").map((s) => s.id), ["cafe"]);
  assert.deepEqual(searchBadgeSpots(spots, "xaviers").map((s) => s.id), ["x-1", "x-2"]);
  assert.deepEqual(searchBadgeSpots(spots, "   "), []);
});

/** Absolute points a path passes through (end points and control points), for comparing two spellings. */
function points(d: string): number[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const out: number[][] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  let i = 0;
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === "m") cmd = "l";
    else if (cmd === "M") cmd = "L";
    const rel = cmd === cmd.toLowerCase();
    const n = () => Number(tokens[i++]);
    const up = cmd.toUpperCase();
    if (up === "Z") {
      x = sx;
      y = sy;
      out.push([x, y]);
      continue;
    }
    if (up === "H") x = (rel ? x : 0) + n();
    else if (up === "V") y = (rel ? y : 0) + n();
    else {
      const k = up === "Q" ? 2 : up === "C" ? 3 : 1;
      const [bx, by] = [x, y];
      for (let j = 0; j < k; j++) {
        const px = (rel ? bx : 0) + n();
        const py = (rel ? by : 0) + n();
        out.push([px, py]);
        if (j === k - 1) [x, y] = [px, py];
      }
      if (up === "M") [sx, sy] = [x, y];
      continue;
    }
    out.push([x, y]);
  }
  return out;
}

test("compactPath: the same outline, relative and shorter; zero-length lines dropped; anything else untouched", () => {
  const d = "M73.1 44.9Q73.2 44.9 73.3 44.9L73.3 44.9L74.5 44.9L74.5 46.2L70 50Q71.5 52.25 73 54.5C74 55 75 56 76 57Z M10 10L20 10L20 20Z";
  const c = compactPath(d);
  assert.ok(c.length < d.length, c);
  assert.ok(!/[MLQCZ]/.test(c), "relative commands only");
  const a = points(d).filter((p, i, list) => i === 0 || p[0] !== list[i - 1][0] || p[1] !== list[i - 1][1]);
  const b = points(c).filter((p, i, list) => i === 0 || p[0] !== list[i - 1][0] || p[1] !== list[i - 1][1]);
  assert.equal(a.length, b.length);
  a.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - b[i][0]) < 0.051 && Math.abs(p[1] - b[i][1]) < 0.051, `${p} vs ${b[i]}`);
  });
  // Arcs and relative input are left as they are.
  for (const keep of ["M4.1,4.1 A14,14 0 0 1 14,0 h272", "m1 2l3 4z", "M1 2 X 3"]) assert.equal(compactPath(keep), keep);
  assert.equal(compactSvgPaths(`<svg><path d="M1 1L1 1L2 1Z"/><path d="m0 0h1"/></svg>`), `<svg><path d="m1 1h1z"/><path d="m0 0h1"/></svg>`);
});

test("the badge page's and the press kit's titles and descriptions; the credit line", () => {
  for (const seo of [badgePageSeo({ restaurants: 563, median: 20 }), badgePageSeo({ restaurants: 1, median: null }), pressSeo({ median: 20, menus: 531, locations: 563, generatedAt: GEN }), pressSeo({ median: null, menus: 0, locations: 0, generatedAt: GEN })]) {
    assert.ok(seo.title.length <= TITLE_MAX, seo.title);
    assert.ok(seo.description.length <= DESCRIPTION_MAX, seo.description);
  }
  assert.match(badgePageSeo({ restaurants: 563, median: 20 }).description, /^A free badge for the 563 NYC restaurants on The Burger Index/);
  assert.equal(pressSeo({ median: 20, menus: 531, locations: 563, generatedAt: GEN }).title, "Press kit: NYC burger prices, $20.00 median (Sep 2026)");
  assert.equal(PRESS_PATH, "/press");
  assert.equal(pressCitation("https://x.example", GEN), "The Burger Index, “NYC burger prices,” September 2026. https://x.example. CC BY 4.0.");
});
