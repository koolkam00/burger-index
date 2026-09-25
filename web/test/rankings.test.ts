// The ranking pages (lib/rankings.ts) and the answer-first sentences and Q&A items (lib/answers.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { boroughFaq, cityFaq, endSentence, neighborhoodFaq, segmentsText, underSentence, whereInBorough, whereInCity } from "../src/lib/answers";
import { BOROUGH_META, boroughBySlug } from "../src/lib/boroughs";
import { theBurger } from "../src/lib/format";
import { faqPageNode } from "../src/lib/jsonld";
import { menusByIndexPrice, menusByIndexPriceDesc } from "../src/lib/menus";
import {
  boroughRankings,
  chainExplorerHref,
  CITY_RANKINGS,
  cheapestSpec,
  explorerHref,
  priciestSpec,
  RANKING_LIMIT,
  rankingName,
  rankingPath,
  rankingSpecs,
  rankMenus,
  topTied,
  underSpec,
  withRanks,
} from "../src/lib/rankings";
import type { PricedRestaurant } from "../src/lib/schema";
import { DESCRIPTION_MAX, rankingSeo, TITLE_MAX } from "../src/lib/seo";
import { isRankingPath } from "../src/lib/site";
import { loadDataset } from "./dataset";
import { place } from "./places";

const GEN = "2026-09-25T13:44:09Z";
const MONTH = "September 2026";
const brooklyn = boroughBySlug("brooklyn")!;
const bronx = boroughBySlug("bronx")!;
const priced = (list: ReturnType<typeof place>[]) => list as PricedRestaurant[];

test("ranking paths and names: 14 plain URLs and headings", () => {
  const all = [...CITY_RANKINGS, ...BOROUGH_META.flatMap(boroughRankings)];
  assert.equal(all.length, 14);
  assert.deepEqual(CITY_RANKINGS.map(rankingPath), ["/cheapest-burgers", "/most-expensive-burgers", "/burgers-under-15", "/burgers-under-20"]);
  assert.equal(rankingPath(cheapestSpec(brooklyn)), "/cheapest-burgers/brooklyn");
  assert.equal(rankingPath(priciestSpec(boroughBySlug("staten-island")!)), "/most-expensive-burgers/staten-island");
  assert.equal(rankingName(cheapestSpec()), "Cheapest burgers in NYC");
  assert.equal(rankingName(priciestSpec(bronx)), "Most expensive burgers in the Bronx");
  assert.equal(rankingName(underSpec(15)), "Burgers under $15 in NYC");
  assert.equal(new Set(all.map(rankingPath)).size, 14);
  for (const spec of all) assert.ok(isRankingPath(rankingPath(spec)), rankingPath(spec));
  for (const other of ["/burgers", "/restaurants/cheapest-burgers-x", "/boroughs/bronx", "/burgers-under"]) assert.ok(!isRankingPath(other), other);
});

test("rankingSpecs: a borough with nothing priced has no lists", () => {
  const list = priced([place({ price: 10, borough: "Queens" })]);
  assert.deepEqual(rankingSpecs(list).map(rankingPath), [...CITY_RANKINGS.map(rankingPath), "/cheapest-burgers/queens", "/most-expensive-burgers/queens"]);
  assert.equal(rankingSpecs(loadDataset().restaurants.filter((r) => r.index_price !== null) as PricedRestaurant[]).length, 14);
});

test("rankMenus: one row per menu (a chain once, with its locations), capped at 25, ties share a rank", () => {
  const chain = (hood: string, borough: "Brooklyn" | "Queens" = "Brooklyn") => place({ chain: "seventh", name: "7th Street Burger", price: 10, hood, borough });
  const list = priced([
    chain("a"),
    chain("b"),
    chain("c", "Queens"),
    place({ name: "Alpha", price: 9, borough: "Brooklyn" }),
    place({ name: "Beta", price: 10, borough: "Brooklyn" }),
    ...Array.from({ length: 30 }, (_, i) => place({ name: `P${String(i).padStart(2, "0")}`, price: 20 + i, borough: "Queens" })),
  ]);
  const city = rankMenus(list, cheapestSpec());
  assert.equal(city.total, 33, "30 + Alpha + Beta + the chain once");
  assert.equal(city.rows.length, RANKING_LIMIT);
  assert.deepEqual(
    city.rows.slice(0, 3).map((m) => [m.rank, m.restaurant.name, m.locations]),
    [
      [1, "Alpha", 1],
      [2, "7th Street Burger", 3],
      [2, "Beta", 1],
    ],
  );
  assert.equal(city.rows[3].rank, 4, "competition ranking: 1, 2, 2, 4");
  const bk = rankMenus(list, cheapestSpec(brooklyn));
  assert.deepEqual(
    bk.rows.map((m) => [m.restaurant.name, m.locations]),
    [
      ["Alpha", 1],
      ["7th Street Burger", 2],
      ["Beta", 1],
    ],
    "a borough list counts only that borough's locations",
  );
  const top = rankMenus(list, priciestSpec());
  assert.equal(top.rows[0].restaurant.name, "P29");
  assert.equal(top.rows[0].rank, 1);
});

test("rankMenus under $N: strictly below, every row, cheapest first", () => {
  const list = priced([place({ price: 14.99 }), place({ price: 15 }), place({ price: 6 }), place({ price: 15.01 })]);
  const r = rankMenus(list, underSpec(15));
  assert.deepEqual(
    r.rows.map((m) => m.indexPrice),
    [6, 14.99],
  );
  assert.equal(r.total, 2);
  const many = priced(Array.from({ length: 40 }, (_, i) => place({ price: 5 + i * 0.1 })));
  assert.equal(rankMenus(many, underSpec(15)).rows.length, 40, "under-$N lists are not capped");
});

test("withRanks / topTied: equal prices to the cent share first place", () => {
  const menus = menusByIndexPrice(priced([place({ name: "A", price: 8 }), place({ name: "B", price: 8.001 }), place({ name: "C", price: 9 })]));
  const ranked = withRanks(menus);
  assert.deepEqual(
    ranked.map((m) => m.rank),
    [1, 1, 3],
  );
  assert.deepEqual(
    topTied(ranked).map((m) => m.restaurant.name),
    ["A", "B"],
  );
});

test("explorer links: the same list on /burgers, a chain searched by name", () => {
  assert.equal(explorerHref(cheapestSpec()), "/burgers");
  assert.equal(explorerHref(priciestSpec(brooklyn)), "/burgers?borough=brooklyn&sort=-price");
  assert.equal(explorerHref(underSpec(15)), "/burgers?max=14.99");
  const chain = rankMenus(priced([place({ chain: "jimbos", name: "Jimbo's Hamburger Palace", price: 12, borough: "Bronx" })]), cheapestSpec(bronx)).rows[0];
  assert.equal(chainExplorerHref(chain, cheapestSpec(bronx)), "/burgers?q=Jimbo%27s+Hamburger+Palace&borough=bronx");
});

test("theBurger: an article unless the name brings its own or opens with a possessive", () => {
  assert.equal(theBurger("Cheeseburger"), "the Cheeseburger");
  assert.equal(theBurger("The Big Flat"), "The Big Flat");
  assert.equal(theBurger("Crosstown's Monster Double Deluxe"), "Crosstown's Monster Double Deluxe");
  assert.equal(theBurger("Fatso’s Burger"), "Fatso’s Burger");
  assert.equal(theBurger("Our Famous Burger"), "Our Famous Burger");
  assert.equal(theBurger("Smash Burgers"), "the Smash Burgers");
  assert.equal(theBurger("10oz Double Wagyu Cheeseburger"), "the 10oz Double Wagyu Cheeseburger");
});

test("endSentence: answer first, one, two or several on the top price", () => {
  const menus = menusByIndexPrice(
    priced([
      place({ id: "a", name: "Joe's", price: 6, burger: "Cheeseburger", hood: "Harlem", borough: "Manhattan" }),
      place({ id: "b", name: "Bob's", price: 6, burger: "The Big One", hood: "Astoria", borough: "Queens" }),
      place({ id: "c", name: "Cal's", price: 6, burger: "Burger", hood: null, borough: "Bronx" }),
    ]),
  );
  const [a, b, c] = ["a", "b", "c"].map((id) => menus.find((m) => m.restaurant.id === id)!);
  const one = endSentence("cheapest", "NYC", [b], MONTH, whereInCity);
  assert.equal(segmentsText(one), "The cheapest burger in NYC is The Big One at Bob's in Astoria, Queens, $6.00 (September 2026).");
  assert.deepEqual(one.find((s) => typeof s !== "string"), { text: "Bob's", href: "/restaurants/b" });
  assert.equal(segmentsText(endSentence("priciest", "Brooklyn", [a], MONTH)), "The most expensive burger in Brooklyn is the Cheeseburger at Joe's, $6.00 (September 2026).");
  assert.equal(
    segmentsText(endSentence("cheapest", "NYC", [b, a], MONTH, whereInCity)),
    "The cheapest burgers in NYC are The Big One at Bob's in Astoria, Queens and the Cheeseburger at Joe's in Harlem, Manhattan, $6.00 each (September 2026).",
  );
  assert.equal(segmentsText(endSentence("cheapest", "the Bronx", [c, a, b], MONTH, whereInBorough("Bronx"))), "3 burgers tie for the cheapest in the Bronx at $6.00 (September 2026), among them the Burger at Cal's.");
  assert.deepEqual(endSentence("cheapest", "NYC", [], MONTH), []);
});

test("a chain in a sentence is placed by its location count", () => {
  const list = priced([place({ chain: "jh", name: "Jackson Hole", price: 18, hood: "Murray Hill" }), place({ chain: "jh", name: "Jackson Hole", price: 18, hood: "Lenox Hill" })]);
  const [m] = menusByIndexPrice(list);
  assert.equal(segmentsText(endSentence("cheapest", "NYC", [m], MONTH, whereInCity)), "The cheapest burger in NYC is the Cheeseburger at Jackson Hole (2 locations), $18.00 (September 2026).");
  assert.equal(whereInBorough("Manhattan")(m), " (2 Manhattan locations)");
});

test("underSentence: how many, and the two ends", () => {
  const rows = menusByIndexPrice(priced([place({ id: "x", name: "X", price: 6 }), place({ id: "y", name: "Y", price: 14.99 })]));
  assert.equal(segmentsText(underSentence(15, "NYC", rows, MONTH)), "2 burgers in NYC cost under $15 (September 2026), from $6.00 at X to $14.99 at Y.");
  assert.equal(segmentsText(underSentence(15, "NYC", rows.slice(0, 1), MONTH)), "One burger in NYC costs under $15 (September 2026): the Cheeseburger at X, $6.00.");
  assert.equal(segmentsText(underSentence(15, "NYC", [], MONTH)), "No burger in NYC costs under $15 (September 2026).");
});

test("cityFaq on the real dataset: live numbers, links to the pages they name", () => {
  const data = loadDataset();
  const list = data.restaurants.filter((r) => r.index_price !== null) as PricedRestaurant[];
  const boroughs = data.boroughs.filter((b) => b.index_median !== null).map((b) => ({ name: b.name === "Bronx" ? "the Bronx" : b.name, href: `/boroughs/${b.slug}`, median: b.index_median as number }));
  const items = cityFaq({
    generatedAt: data.generated_at,
    median: data.stats.index_median,
    p10: data.stats.index_p10,
    p90: data.stats.index_p90,
    cheapest: topTied(rankMenus(list, cheapestSpec()).rows),
    priciest: topTied(rankMenus(list, priciestSpec()).rows),
    boroughs,
    neighborhoods: [],
  });
  assert.deepEqual(
    items.map((i) => i.q),
    ["How much does a burger cost in NYC?", "Where is the cheapest burger in NYC?", "What is the most expensive burger in NYC?", "Which borough has the cheapest burgers?"],
  );
  const money = (v: number) => `$${v.toFixed(2)}`;
  assert.ok(segmentsText(items[0].a).includes(money(data.stats.index_median as number)));
  assert.ok(!/menus/.test(segmentsText(items[0].a)), "the menu count stays on the board line");
  const cheapest = menusByIndexPrice(list)[0];
  assert.ok(segmentsText(items[1].a).includes(`${cheapest.restaurant.name}`) && segmentsText(items[1].a).includes(money(cheapest.indexPrice)));
  assert.ok(items[1].a.some((s) => typeof s !== "string" && s.href === "/cheapest-burgers"));
  const priciest = menusByIndexPriceDesc(list)[0];
  assert.ok(segmentsText(items[2].a).includes(money(priciest.indexPrice)));
  const lowest = [...boroughs].sort((a, b) => a.median - b.median)[0];
  assert.ok(segmentsText(items[3].a).startsWith(lowest.name[0].toUpperCase() + lowest.name.slice(1)), "a borough opening the answer is capitalized");
});

test("boroughFaq and neighborhoodFaq: vs NYC in words, one priced burger, ranked neighborhoods", () => {
  const list = menusByIndexPrice(priced([place({ id: "a", name: "A", price: 10, hood: "Mott Haven", borough: "Bronx" }), place({ id: "b", name: "B", price: 30, hood: "Riverdale", borough: "Bronx" })]));
  const faq = boroughFaq({
    generatedAt: GEN,
    borough: { name: "Bronx", slug: "bronx" },
    median: 20,
    cityMedian: 25,
    menus: 2,
    cheapest: [list[0]],
    priciest: [list[1]],
    neighborhoods: [
      { name: "Mott Haven", href: "/neighborhoods/mott-haven", median: 10 },
      { name: "Riverdale", href: "/neighborhoods/riverdale", median: 30 },
    ],
    ranking: { cheapest: cheapestSpec(bronx), priciest: priciestSpec(bronx) },
  });
  assert.equal(segmentsText(faq[0].a), "The median burger in the Bronx costs $20.00 (September 2026), 20% below the $25.00 NYC median.");
  assert.equal(faq[1].q, "Where is the cheapest burger in the Bronx?");
  assert.equal(segmentsText(faq[1].a), "The cheapest burger in the Bronx is the Cheeseburger at A in Mott Haven, $10.00 (September 2026). See the cheapest burgers in the Bronx.");
  assert.equal(faq[3].q, "Which Bronx neighborhood has the cheapest burgers?");
  assert.equal(segmentsText(faq[3].a), "Mott Haven: its median burger costs $10.00 (September 2026), the lowest of the 2 ranked Bronx neighborhoods. Riverdale is the priciest at $30.00.");

  const solo = neighborhoodFaq({ generatedAt: GEN, name: "Astoria", median: 18, cityMedian: 20, menus: 1, cheapest: [list[0]], priciest: [list[0]] });
  assert.equal(solo.length, 1);
  assert.equal(segmentsText(solo[0].a), "Astoria has one priced burger: the Cheeseburger at A, $10.00 (September 2026), 10% below the $20.00 NYC median.");
  assert.deepEqual(neighborhoodFaq({ generatedAt: GEN, name: "Nowhere", median: null, cityMedian: 20, menus: 0, cheapest: [], priciest: [] }), []);
});

test("faqPageNode: Question → Answer, the text as given", () => {
  const node = JSON.parse(JSON.stringify(faqPageNode([{ question: "Q?", answer: "A & B." }])));
  assert.deepEqual(node, { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A & B." } }] });
});

test("rankingSeo on the real dataset: unique titles within 60 where they fit, descriptions within 160", () => {
  const data = loadDataset();
  const list = data.restaurants.filter((r) => r.index_price !== null) as PricedRestaurant[];
  const seos = rankingSpecs(list).map((spec) => {
    const { rows, total } = rankMenus(list, spec);
    return rankingSeo({
      kind: spec.kind,
      name: rankingName(spec),
      place: spec.borough ? (spec.borough.name === "Bronx" ? "the Bronx" : spec.borough.name) : "NYC",
      under: spec.under,
      rows: rows.map((m) => ({ restaurant: m.restaurant.name, burger: m.restaurant.burger.name, price: m.indexPrice })),
      total,
      generatedAt: data.generated_at,
    });
  });
  assert.equal(new Set(seos.map((s) => s.title)).size, seos.length);
  assert.equal(new Set(seos.map((s) => s.description)).size, seos.length);
  for (const s of seos) {
    assert.ok(s.title.length <= TITLE_MAX, s.title);
    assert.ok(s.description.length <= DESCRIPTION_MAX, s.description);
    assert.match(s.title, /\$\d/, "the title carries a real number");
  }
  assert.equal(
    rankingSeo({ kind: "cheapest", name: "Cheapest burgers in NYC", place: "NYC", under: null, rows: [{ restaurant: "Joe's", burger: "Cheeseburger", price: 6 }], total: 1, generatedAt: GEN }).title,
    "Cheapest burgers in NYC: from $6 (Sep 2026)",
  );
});
