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
  rankingCap,
  rankingName,
  neighborhoodRankings,
  rankingIn,
  rankingNameInSentence,
  rankingPath,
  rankingPlace,
  rankingShortName,
  rankingSpecs,
  rankMenus,
  neighborhoodsWithRankings,
  stylesWithRankings,
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
  // Each spot publishes its priciest burger: the cheap lists name spots, never "the cheapest burgers" or "burgers under $15".
  assert.equal(rankingName(cheapestSpec()), "Cheapest burger spots in NYC");
  assert.equal(rankingName(cheapestSpec(bronx)), "Cheapest burger spots in the Bronx");
  assert.equal(rankingName(priciestSpec(bronx)), "Most expensive burgers in the Bronx");
  assert.equal(rankingName(underSpec(15)), "Burger spots in NYC where the priciest burger is under $15");
  assert.equal(rankingShortName(cheapestSpec(brooklyn)), "Cheapest burger spots");
  assert.equal(rankingShortName(underSpec(20)), "Burger spots where the priciest burger is under $20");
  assert.equal(rankingNameInSentence(cheapestSpec()), "cheapest burger spots in NYC");
  assert.equal(new Set(all.map(rankingPath)).size, 14);
  for (const spec of all) assert.ok(isRankingPath(rankingPath(spec)), rankingPath(spec));
  for (const other of ["/burgers", "/restaurants/cheapest-burgers-x", "/boroughs/bronx", "/burgers-under"]) assert.ok(!isRankingPath(other), other);
});

test("rankingSpecs: a borough with nothing priced has no lists", () => {
  const list = priced([place({ price: 10, borough: "Queens" })]);
  assert.deepEqual(rankingSpecs(list).map(rankingPath), [...CITY_RANKINGS.map(rankingPath), "/cheapest-burgers/queens", "/most-expensive-burgers/queens"]);
  // The real dataset: 4 NYC lists and 10 borough lists, then each neighborhood's pair, then the styles.
  const real = loadDataset().restaurants.filter((r) => r.index_price !== null) as PricedRestaurant[];
  const specs = rankingSpecs(real);
  const hoods = neighborhoodsWithRankings(real);
  const styles = stylesWithRankings(real);
  assert.equal(specs.length, 14 + 2 * hoods.length + styles.length);
  assert.deepEqual(specs.slice(0, 14).map((s) => s.kind === "style" || s.neighborhood !== null), Array(14).fill(false));
  assert.ok(hoods.length >= 10, `${hoods.length} neighborhoods with lists`);
  assert.deepEqual(styles.map((s) => s.key), ["smash", "double", "wagyu", "dry-aged"], "patty melt has too few menus");
});

test("rankMenus: one row per menu (a chain once, with its locations), capped at half the menus, ties share a rank", () => {
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
  assert.equal(city.spots, 35, "burger spots count the chain's every location");
  assert.equal(city.rows.length, 16, "at most half of 33 menus");
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
  assert.equal(bk.total, 3);
  assert.equal(bk.spots, 4, "Alpha, Beta and the chain's two Brooklyn locations");
  assert.deepEqual(
    bk.rows.map((m) => m.restaurant.name),
    ["Alpha"],
    "3 menus: one row, so the cheapest and most expensive lists never overlap",
  );
  assert.deepEqual(
    rankMenus(list, priciestSpec(brooklyn)).rows.map((m) => [m.rank, m.restaurant.name, m.locations]),
    [
      [1, "7th Street Burger", 2],
      [1, "Beta", 1],
    ],
    "a borough list counts only that borough's locations, and a menu tied at the cut stays",
  );
  const top = rankMenus(list, priciestSpec());
  assert.equal(top.rows[0].restaurant.name, "P29");
  assert.equal(top.rows[0].rank, 1);
});

test("rankingCap: 25, at most half the menus, at least one", () => {
  assert.equal(RANKING_LIMIT, 25);
  assert.deepEqual(
    [1, 2, 3, 32, 35, 50, 51, 73, 532].map(rankingCap),
    [1, 1, 1, 16, 17, 25, 25, 25, 25],
  );
});

test("rankMenus: a cut never splits equal prices", () => {
  // 60 menus at $10, $11, … except four sharing $33 where the 25th row falls (rows 24–27).
  const prices = Array.from({ length: 60 }, (_, i) => (i >= 23 && i <= 26 ? 33 : 10 + i));
  const list = priced(prices.map((price, i) => place({ name: `R${String(i).padStart(2, "0")}`, price })));
  const r = rankMenus(list, cheapestSpec());
  assert.equal(r.total, 60);
  assert.equal(r.rows.length, 27, "rows 24–27 share rank 24, so all four stay");
  assert.deepEqual([...new Set(r.rows.slice(23).map((m) => m.rank))], [24]);
  const top = rankMenus(priced(Array.from({ length: 60 }, (_, i) => place({ price: 10 + i }))), priciestSpec());
  assert.equal(top.rows.length, 25, "no tie at the cut: exactly 25");
});

test("rankMenus under $N: strictly below, every row, cheapest first", () => {
  const list = priced([place({ price: 14.99 }), place({ price: 15 }), place({ price: 6 }), place({ price: 15.01 })]);
  const r = rankMenus(list, underSpec(15));
  assert.deepEqual(
    r.rows.map((m) => m.indexPrice),
    [6, 14.99],
  );
  assert.equal(r.total, 2);
  assert.equal(r.spots, 2);
  const withChain = rankMenus(priced([place({ price: 6 }), place({ chain: "c", name: "C", price: 10 }), place({ chain: "c", name: "C", price: 10 }), place({ price: 16 })]), underSpec(15));
  assert.deepEqual([withChain.total, withChain.spots], [2, 3], "2 menus under $15 at 3 burger spots");
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

test("endSentence: answer first, one, two or several on the end price; the cheap end names the spot and its priciest burger", () => {
  const menus = menusByIndexPrice(
    priced([
      place({ id: "a", name: "Joe's", price: 6, burger: "Cheeseburger", hood: "Harlem", borough: "Manhattan" }),
      place({ id: "b", name: "Bob's", price: 6, burger: "The Big One", hood: "Astoria", borough: "Queens" }),
      place({ id: "c", name: "Cal's", price: 6, burger: "Burger", hood: null, borough: "Bronx" }),
    ]),
  );
  const [a, b, c] = ["a", "b", "c"].map((id) => menus.find((m) => m.restaurant.id === id)!);
  const one = endSentence("cheapest", "in NYC", [b], MONTH, whereInCity);
  assert.equal(segmentsText(one), "The priciest burger at Bob's in Astoria, Queens, is $6.00, the lowest top-burger price of any spot in NYC (September 2026).");
  assert.deepEqual(one.find((s) => typeof s !== "string"), { text: "Bob's", href: "/restaurants/b" });
  assert.equal(segmentsText(endSentence("cheapest", "in NYC", [b], MONTH)), "The priciest burger at Bob's is $6.00, the lowest top-burger price of any spot in NYC (September 2026).");
  assert.equal(segmentsText(endSentence("priciest", "in Brooklyn", [a], MONTH)), "The most expensive burger in Brooklyn is the Cheeseburger at Joe's, $6.00 (September 2026).");
  assert.equal(
    segmentsText(endSentence("cheapest", "in NYC", [b, a], MONTH, whereInCity)),
    "The priciest burgers at Bob's in Astoria, Queens and Joe's in Harlem, Manhattan, are $6.00 each, the lowest top-burger price of any spot in NYC (September 2026).",
  );
  assert.equal(
    segmentsText(endSentence("priciest", "in NYC", [b, a], MONTH, whereInCity)),
    "The most expensive burgers in NYC are The Big One at Bob's in Astoria, Queens and the Cheeseburger at Joe's in Harlem, Manhattan, $6.00 each (September 2026).",
  );
  assert.equal(
    segmentsText(endSentence("cheapest", "in the Bronx", [c, a, b], MONTH, whereInBorough("Bronx"))),
    "3 spots tie for the lowest top-burger price in the Bronx at $6.00 (September 2026), among them Cal's.",
  );
  // "Spots" counts locations: a chain's two locations are two of the spots that tie.
  const pair = menusByIndexPrice(priced([place({ id: "j1", chain: "j", name: "Jimbo's", price: 6, borough: "Bronx" }), place({ id: "j2", chain: "j", name: "Jimbo's", price: 6, borough: "Bronx" })]))[0];
  assert.equal(
    segmentsText(endSentence("cheapest", "in the Bronx", [c, pair, b], MONTH)),
    "4 spots tie for the lowest top-burger price in the Bronx at $6.00 (September 2026), among them Cal's.",
  );
  assert.equal(segmentsText(endSentence("priciest", "in the Bronx", [c, a, b], MONTH, whereInBorough("Bronx"))), "3 burgers tie for the most expensive in the Bronx at $6.00 (September 2026), among them the Burger at Cal's.");
  assert.deepEqual(endSentence("cheapest", "in NYC", [], MONTH), []);
  // Never the overclaim: the cheap end is a spot's priciest burger, not "the cheapest burger".
  for (const tied of [[b], [b, a], [c, a, b]]) assert.ok(!/cheapest burger/i.test(segmentsText(endSentence("cheapest", "in NYC", tied, MONTH, whereInCity))));
});

test("a chain in a sentence is placed by its location count", () => {
  const list = priced([place({ chain: "jh", name: "Jackson Hole", price: 18, hood: "Murray Hill" }), place({ chain: "jh", name: "Jackson Hole", price: 18, hood: "Lenox Hill" })]);
  const [m] = menusByIndexPrice(list);
  assert.equal(segmentsText(endSentence("cheapest", "in NYC", [m], MONTH, whereInCity)), "The priciest burger at Jackson Hole (2 locations) is $18.00, the lowest top-burger price of any spot in NYC (September 2026).");
  assert.equal(whereInBorough("Manhattan")(m), " (2 Manhattan locations)");
  const [ev] = menusByIndexPrice(priced([place({ name: "Joe's", price: 9, hood: "East Village", borough: "Manhattan" })]));
  assert.equal(whereInCity(ev), " in the East Village, Manhattan");
  assert.equal(whereInBorough("Manhattan")(ev), " in the East Village");
  // "on" the Upper East and West Sides and the Lower East Side; a name with its borough in it stands alone.
  const [ues] = menusByIndexPrice(priced([place({ name: "J.G. Melon", price: 19, hood: "Upper East Side-Carnegie Hill", borough: "Manhattan" })]));
  assert.equal(whereInCity(ues), " on the Upper East Side-Carnegie Hill, Manhattan");
  assert.equal(whereInBorough("Manhattan")(ues), " on the Upper East Side-Carnegie Hill");
  const [les] = menusByIndexPrice(priced([place({ name: "Les", price: 19, hood: "Lower East Side-Alphabet City", borough: "Manhattan" })]));
  assert.equal(whereInBorough("Manhattan")(les), " on the Lower East Side-Alphabet City");
  const [parks] = menusByIndexPrice(priced([place({ name: "Grill", price: 19, hood: "Bronx parks", borough: "Bronx" })]));
  assert.equal(whereInCity(parks), " in Bronx parks");
});

test("underSentence: how many spots have a priciest burger under $N, and the two ends", () => {
  const rows = menusByIndexPrice(priced([place({ id: "x", name: "X", price: 6 }), place({ id: "y", name: "Y", price: 14.99 })]));
  assert.equal(segmentsText(underSentence(15, "in NYC", rows, MONTH)), "At 2 burger spots in NYC, the priciest burger is under $15 (September 2026), from $6.00 at X to $14.99 at Y.");
  assert.equal(segmentsText(underSentence(15, "in NYC", rows.slice(0, 1), MONTH)), "One burger spot in NYC has a priciest burger under $15 (September 2026): X, at $6.00.");
  assert.equal(segmentsText(underSentence(15, "in NYC", [], MONTH)), "No burger spot in NYC has a priciest burger under $15 (September 2026).");
  for (const r of [rows, rows.slice(0, 1), []]) assert.ok(!/burgers? in NYC costs? under|different burgers/i.test(segmentsText(underSentence(15, "in NYC", r, MONTH))));
  // Burger spots are locations: a chain's 3 locations are 3 spots, though the list has it once.
  const chain = (id: string) => place({ id, chain: "seventh", name: "7th Street Burger", price: 10 });
  const withChain = menusByIndexPrice(priced([place({ id: "x", name: "X", price: 6 }), chain("s1"), chain("s2"), chain("s3"), place({ id: "y", name: "Y", price: 14.99 })]));
  assert.equal(withChain.length, 3);
  assert.equal(segmentsText(underSentence(15, "in NYC", withChain, MONTH)), "At 5 burger spots in NYC, the priciest burger is under $15 (September 2026), from $6.00 at X to $14.99 at Y.");
  const onlyChain = menusByIndexPrice(priced([chain("s1"), chain("s2"), chain("s3")]));
  assert.equal(
    segmentsText(underSentence(15, "in NYC", onlyChain, MONTH)),
    "3 burger spots in NYC have a priciest burger under $15 (September 2026): the 3 locations of 7th Street Burger, at $10.00.",
  );
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
    ["How much does a burger cost in NYC?", "Where are burgers cheapest in NYC?", "What is the most expensive burger in NYC?", "Which borough has the cheapest burgers?"],
  );
  const money = (v: number) => `$${v.toFixed(2)}`;
  assert.ok(segmentsText(items[0].a).includes(money(data.stats.index_median as number)));
  assert.ok(!/menus/.test(segmentsText(items[0].a)), "the menu count stays on the board line");
  const cheapest = menusByIndexPrice(list)[0];
  assert.ok(segmentsText(items[1].a).includes(`${cheapest.restaurant.name}`) && segmentsText(items[1].a).includes(money(cheapest.indexPrice)));
  assert.match(segmentsText(items[1].a), /the lowest top-burger price of any spot in NYC \(/);
  assert.match(segmentsText(items[1].a), / See the cheapest burger spots in NYC\.$/);
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
  assert.equal(faq[1].q, "Where are burgers cheapest in the Bronx?");
  assert.equal(
    segmentsText(faq[1].a),
    "The priciest burger at A in Mott Haven is $10.00, the lowest top-burger price of any spot in the Bronx (September 2026). See the cheapest burger spots in the Bronx.",
  );
  assert.equal(faq[2].q, "What is the most expensive burger in the Bronx?");
  assert.equal(segmentsText(faq[2].a), "The most expensive burger in the Bronx is the Cheeseburger at B in Riverdale, $30.00 (September 2026). See the most expensive burgers in the Bronx.");
  assert.equal(faq[3].q, "Which Bronx neighborhood has the cheapest burgers?");
  assert.equal(segmentsText(faq[3].a), "Mott Haven: its median burger costs $10.00 (September 2026), the lowest of the 2 ranked Bronx neighborhoods. Riverdale is the priciest at $30.00.");

  const solo = neighborhoodFaq({ generatedAt: GEN, name: "Astoria", borough: "Queens", median: 18, cityMedian: 20, menus: 1, cheapest: [list[0]], priciest: [list[0]] });
  assert.equal(solo.length, 1);
  assert.equal(solo[0].q, "How much does a burger cost in Astoria, Queens?");
  assert.equal(segmentsText(solo[0].a), "Astoria, Queens, has one priced burger: the Cheeseburger at A, $10.00 (September 2026), 10% below the $20.00 NYC median.");
  assert.deepEqual(neighborhoodFaq({ generatedAt: GEN, name: "Nowhere", borough: "Queens", median: null, cityMedian: 20, menus: 0, cheapest: [], priciest: [] }), []);

  // Every item names the borough; "the" where the neighborhood takes it; a name with its borough in it stands alone.
  const ev = neighborhoodFaq({ generatedAt: GEN, name: "East Village", borough: "Manhattan", median: 20, cityMedian: 20, menus: 2, cheapest: [list[0]], priciest: [list[1]] });
  assert.deepEqual(
    ev.map((i) => i.q),
    ["How much does a burger cost in the East Village, Manhattan?", "Where are burgers cheapest in the East Village, Manhattan?", "What is the most expensive burger in the East Village, Manhattan?"],
  );
  assert.equal(segmentsText(ev[0].a), "The median burger in the East Village, Manhattan, costs $20.00 (September 2026), right at the $20.00 NYC median.");
  assert.equal(segmentsText(ev[1].a), "The priciest burger at A is $10.00, the lowest top-burger price of any spot in the East Village, Manhattan (September 2026).");
  assert.equal(segmentsText(ev[2].a), "The most expensive burger in the East Village, Manhattan, is the Cheeseburger at B, $30.00 (September 2026).");
  // New Yorkers are "on" the Upper East and West Sides and the Lower East Side ("in the East Village" stays).
  const uws = neighborhoodFaq({ generatedAt: GEN, name: "Upper West Side", borough: "Manhattan", median: 20, cityMedian: 20, menus: 2, cheapest: [list[0]], priciest: [list[1]] });
  assert.deepEqual(
    uws.map((i) => i.q),
    ["How much does a burger cost on the Upper West Side, Manhattan?", "Where are burgers cheapest on the Upper West Side, Manhattan?", "What is the most expensive burger on the Upper West Side, Manhattan?"],
  );
  assert.equal(segmentsText(uws[0].a), "The median burger on the Upper West Side, Manhattan, costs $20.00 (September 2026), right at the $20.00 NYC median.");
  assert.equal(segmentsText(uws[1].a), "The priciest burger at A is $10.00, the lowest top-burger price of any spot on the Upper West Side, Manhattan (September 2026).");
  assert.equal(segmentsText(uws[2].a), "The most expensive burger on the Upper West Side, Manhattan, is the Cheeseburger at B, $30.00 (September 2026).");
  const ues = neighborhoodFaq({ generatedAt: GEN, name: "Upper East Side-Carnegie Hill", borough: "Manhattan", median: 20, cityMedian: 20, menus: 1, cheapest: [list[0]], priciest: [list[0]] });
  assert.equal(ues[0].q, "How much does a burger cost on the Upper East Side-Carnegie Hill, Manhattan?");
  assert.equal(segmentsText(ues[0].a), "The Upper East Side-Carnegie Hill, Manhattan, has one priced burger: the Cheeseburger at A, $10.00 (September 2026), right at the $20.00 NYC median.");
  const les = neighborhoodFaq({ generatedAt: GEN, name: "Lower East Side-Alphabet City", borough: "Manhattan", median: 20, cityMedian: 20, menus: 1, cheapest: [list[0]], priciest: [list[0]] });
  assert.equal(les[0].q, "How much does a burger cost on the Lower East Side-Alphabet City, Manhattan?");
  const ct = neighborhoodFaq({ generatedAt: GEN, name: "Chinatown-Lower East Side", borough: "Manhattan", median: 20, cityMedian: 20, menus: 1, cheapest: [list[0]], priciest: [list[0]] });
  assert.equal(ct[0].q, "How much does a burger cost in Chinatown-Lower East Side, Manhattan?");
  const hood = neighborhoodFaq({ generatedAt: GEN, name: "Mott Haven", borough: "Bronx", median: 20, cityMedian: 20, menus: 1, cheapest: [list[0]], priciest: [list[0]] });
  assert.equal(hood[0].q, "How much does a burger cost in Mott Haven, the Bronx?");
  const parks = neighborhoodFaq({ generatedAt: GEN, name: "Bronx parks", borough: "Bronx", median: 20, cityMedian: 20, menus: 1, cheapest: [list[0]], priciest: [list[0]] });
  assert.equal(parks[0].q, "How much does a burger cost in Bronx parks?");
});

test("faqPageNode: Question → Answer, the text as given", () => {
  const node = JSON.parse(JSON.stringify(faqPageNode([{ question: "Q?", answer: "A & B." }])));
  assert.deepEqual(node, { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A & B." } }] });
});

test("rankingSeo on the real dataset: unique titles within 60 where they fit, descriptions within 160", () => {
  const data = loadDataset();
  const list = data.restaurants.filter((r) => r.index_price !== null) as PricedRestaurant[];
  const seos = rankingSpecs(list).map((spec) => {
    const { rows, total, spots } = rankMenus(list, spec);
    return rankingSeo({
      kind: spec.kind,
      name: rankingName(spec),
      place: rankingPlace(spec),
      inPlace: rankingIn(spec),
      shortName: rankingShortName(spec),
      under: spec.under,
      aBurger: spec.style?.aBurger,
      rows: rows.map((m) => ({ restaurant: m.restaurant.name, burger: m.restaurant.burger.name, price: m.indexPrice })),
      total,
      spots,
      generatedAt: data.generated_at,
    });
  });
  assert.equal(new Set(seos.map((s) => s.title)).size, seos.length);
  assert.equal(new Set(seos.map((s) => s.description)).size, seos.length);
  for (const s of seos) {
    // Only a neighborhood too long for even "Cheapest burger spots, <place> (Sep 2026)" runs past 60.
    assert.ok(s.title.length <= TITLE_MAX || /^(Cheapest burger spots|Most expensive burgers), [^:]+ \(Sep 2026\)$/.test(s.title), s.title);
    assert.ok(s.description.length <= DESCRIPTION_MAX, s.description);
  }
  // The title carries a real number wherever it fits (every NYC, borough and style list).
  for (const [i, s] of seos.entries()) if (!rankingSpecs(list)[i].neighborhood) assert.match(s.title, /\$\d/, s.title);
  // The search words stay (cheapest, burger, NYC, the borough); nothing claims "the cheapest burgers" or "burgers under $15".
  for (const s of seos) assert.ok(!/cheapest burgers|burgers under|cheapest burger in/i.test(`${s.title} ${s.description}`), `${s.title} | ${s.description}`);
  // Every ranking title keeps the month (a long place takes the shorter form).
  for (const s of seos) assert.match(s.title, /\(Sep 2026\)$/, s.title);
  const cheap = rankingSeo({ kind: "cheapest", name: "Cheapest burger spots in NYC", place: "NYC", under: null, rows: [{ restaurant: "Joe's", burger: "Cheeseburger", price: 6 }], total: 1, spots: 1, generatedAt: GEN });
  assert.equal(cheap.title, "Cheapest burger spots in NYC: from $6 (Sep 2026)");
  assert.equal(cheap.description, "Cheapest burger spots in NYC: the 1 menu with the lowest top-burger price (September 2026). Joe's tops the list at $6.00.");
  const staten = rankingSeo({
    kind: "cheapest",
    name: "Cheapest burger spots in Staten Island",
    place: "Staten Island",
    under: null,
    rows: [
      { restaurant: "Saucy", burger: "Burger", price: 8.89 },
      { restaurant: "Joe's", burger: "Burger", price: 9.5 },
    ],
    total: 35,
    spots: 36,
    generatedAt: GEN,
  });
  assert.equal(staten.title, "Cheapest burger spots, Staten Island: from $8.89 (Sep 2026)");
  assert.match(staten.description, /^Cheapest burger spots in Staten Island: the 2 menus with the lowest top-burger price \(September 2026\)\. Saucy tops the list at \$8\.89\./);
  const under = rankingSeo({
    kind: "under",
    name: "Burger spots in NYC where the priciest burger is under $15",
    place: "NYC",
    under: 15,
    rows: [
      { restaurant: "Joe's", burger: "Cheeseburger", price: 6 },
      { restaurant: "Bob's", burger: "Burger", price: 14.99 },
    ],
    total: 90,
    spots: 96,
    generatedAt: GEN,
  });
  // "Burger spots" counts locations (96), not the list's 90 menus.
  assert.equal(under.title, "96 NYC burger spots, priciest burger under $15 (Sep 2026)");
  assert.match(under.description, /^96 burger spots in NYC where the priciest burger is under \$15, cheapest first \(September 2026\)\. From \$6\.00 at Joe's to \$14\.99 at Bob's\./);
});

test("neighborhood lists: 10+ distinct menus and two lists that share no menu; paths, names and prepositions", () => {
  const hood = (slug: string, n: number, price: (i: number) => number, borough: "Manhattan" | "Queens" = "Manhattan") =>
    Array.from({ length: n }, (_, i) => place({ name: `${slug}-${i}`, price: price(i), hood: slug, borough }));
  // A chain's two locations in one neighborhood are one menu: 9 independents + the chain = 10 menus.
  const chainTwice = [place({ chain: "c", price: 11, hood: "upper-west-side" }), place({ chain: "c", price: 11, hood: "upper-west-side" })];
  const list = priced([
    ...hood("upper-west-side", 9, (i) => 10 + i).map((r) => ({ ...r, neighborhood: "Upper West Side" })),
    ...chainTwice.map((r) => ({ ...r, neighborhood: "Upper West Side" })),
    ...hood("astoria", 9, (i) => 10 + i, "Queens"),
    // Ten menus, but ties at the middle put the same menus on both lists.
    ...hood("tied", 10, (i) => (i < 3 ? 10 : i > 6 ? 30 : 20)),
  ]);
  const withLists = neighborhoodsWithRankings(list);
  assert.deepEqual(withLists.map((n) => n.slug), ["upper-west-side"], "astoria has 9 menus; tied's two lists meet");
  const [cheap, pricey] = neighborhoodRankings(withLists[0]);
  assert.equal(rankingPath(cheap), "/cheapest-burgers/manhattan/upper-west-side");
  assert.equal(rankingPath(pricey), "/most-expensive-burgers/manhattan/upper-west-side");
  assert.equal(rankingName(cheap), "Cheapest burger spots on the Upper West Side");
  assert.equal(rankingName(pricey), "Most expensive burgers on the Upper West Side");
  assert.equal(rankingIn(cheap), "on the Upper West Side");
  assert.equal(rankingPlace(cheap), "Upper West Side");
  assert.equal(rankingShortName(cheap), "Cheapest burger spots");
  assert.ok(isRankingPath(rankingPath(cheap)));
  assert.equal(explorerHref(pricey), "/burgers?neighborhood=upper-west-side&sort=-price");
  const r = rankMenus(list, cheap);
  assert.equal(r.total, 10, "the chain once");
  assert.equal(r.spots, 11, "its two locations are two spots");
  assert.equal(r.rows.length, 5, "half of 10");
  assert.ok(r.rows.every((m) => m.restaurant.neighborhood_slug === "upper-west-side"));
  const top = rankMenus(list, pricey).rows.map((m) => m.key);
  assert.ok(!r.rows.some((m) => top.includes(m.key)), "the two lists share no menu");
  assert.deepEqual(rankingSpecs(list).slice(-2).map(rankingPath), [rankingPath(cheap), rankingPath(pricey)]);
});

test("neighborhood Q&A points to its lists when it has them", () => {
  const n = { slug: "west-village", name: "West Village", borough: boroughBySlug("manhattan")! };
  const [cheapest, priciest] = neighborhoodRankings(n);
  const menus = menusByIndexPrice(priced([place({ name: "A", price: 10, hood: "west-village" }), place({ name: "B", price: 30, hood: "west-village" })]));
  const faq = neighborhoodFaq({ generatedAt: GEN, name: "West Village", borough: "Manhattan", median: 20, cityMedian: 20, menus: 2, cheapest: [menus[0]], priciest: [menus[1]], ranking: { cheapest, priciest } });
  assert.match(segmentsText(faq[1].a), / See the cheapest burger spots in the West Village\.$/);
  assert.match(segmentsText(faq[2].a), / See the most expensive burgers in the West Village\.$/);
  assert.ok(faq[1].a.some((s) => typeof s !== "string" && s.href === "/cheapest-burgers/manhattan/west-village"));
  const without = neighborhoodFaq({ generatedAt: GEN, name: "West Village", borough: "Manhattan", median: 20, cityMedian: 20, menus: 2, cheapest: [menus[0]], priciest: [menus[1]] });
  assert.ok(!/See the/.test(segmentsText(without[1].a)));
});

test("rankingSeo for a neighborhood: the preposition, and the month kept when the place is long", () => {
  const rows = [
    { restaurant: "A", burger: "Burger", price: 10 },
    { restaurant: "B", burger: "Burger", price: 12 },
  ];
  const uws = rankingSeo({ kind: "priciest", name: "Most expensive burgers on the Upper West Side", place: "Upper West Side", inPlace: "on the Upper West Side", under: null, rows, total: 11, spots: 12, generatedAt: GEN });
  assert.equal(uws.title, "Most expensive burgers, Upper West Side (Sep 2026)");
  assert.match(uws.description, /^The 2 most expensive burgers on the Upper West Side, ranked by price \(September 2026\)\./);
  assert.ok(!/ in the Upper West Side/.test(uws.description));
  const long = rankingSeo({
    kind: "cheapest",
    name: "Cheapest burger spots in SoHo-TriBeCa-Civic Center-Little Italy",
    place: "SoHo-TriBeCa-Civic Center-Little Italy",
    inPlace: "in SoHo-TriBeCa-Civic Center-Little Italy",
    under: null,
    rows,
    total: 23,
    spots: 24,
    generatedAt: GEN,
  });
  assert.equal(long.title, "Cheapest burger spots, SoHo-TriBeCa-Civic Center-Little Italy (Sep 2026)");
});
