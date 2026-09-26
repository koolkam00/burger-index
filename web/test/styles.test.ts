// Burger styles (lib/styles.ts) and their lists (lib/rankings.ts, kind "style"): a conservative classifier
// on each restaurant's one published burger, and pages only for styles with 10+ distinct menus.
import assert from "node:assert/strict";
import { test } from "node:test";
import { styleSentence, segmentsText } from "../src/lib/answers";
import { menusByIndexPrice } from "../src/lib/menus";
import { explorerHref, rankingName, rankingPath, rankingShortName, rankMenus, styleSpec, stylesWithRankings } from "../src/lib/rankings";
import type { PricedRestaurant } from "../src/lib/schema";
import { rankingSeo } from "../src/lib/seo";
import { isRankingPath } from "../src/lib/site";
import { burgerStyles, describingParts, MIN_STYLE_MENUS, styleBySlug, STYLES } from "../src/lib/styles";
import { loadDataset } from "./dataset";
import { place } from "./places";

const b = (name: string, description: string | null = null) => burgerStyles({ name, description });

test("smash: the name, or smashed patties in the description; never smashed avocado", () => {
  assert.deepEqual(b("Smash Burger"), ["smash"]);
  assert.deepEqual(b("Domi Smashburger", "4 ounce beef patty, fried salami. Add extra patty $5"), ["smash"]);
  assert.deepEqual(b("Get Smashed", "Two smashed American Wagyu beef patties, Sriracha mayo"), ["smash", "double", "wagyu"]);
  assert.deepEqual(b("Meaty Boy", "Potato Roll, Smashed Patty, American Cheese"), ["smash"]);
  assert.deepEqual(b("The Mayfly Burger", "pat lafrieda smash burger, white cheddar cheese"), ["smash"]);
  assert.deepEqual(b("Avocado Burger", "8oz patty, smashed avocado, pickled onions"), []);
  assert.deepEqual(b("Classic", "smashed potatoes on the side"), []);
});

test("double: two patties by name or description; not a triple, a fraction, double bacon or a bare Double Cheese", () => {
  assert.deepEqual(b("Double Cheeseburger"), ["double"]);
  assert.deepEqual(b("Double Cheese Burger", "Cheese burger with lettuce, tomato and onion."), ["double"]);
  assert.deepEqual(b("The L. I. Burger", "Two dry-aged beef patties, pickles, cheese, fancy sauce, & fries"), ["double", "dry-aged"]);
  assert.deepEqual(b("Double House Cheese Burger", "2 x Beef Patty | American Cheese"), ["double"]);
  assert.deepEqual(b("Double Whammy Burger", "2- 5oz ounces beef patties, Applewood Bacon"), ["double"]);
  assert.deepEqual(b("The Very Best Burger (Double Only)", "Triple Crown Champion! The Very Best Burger: double smashed patty, smoked gouda"), ["smash", "double"]);
  // Not doubles:
  assert.deepEqual(b("Triple Cheeseburger", "Three Beef Patties, American Cheese"), []);
  assert.deepEqual(b("Bacon Double Cheese Burger", "Three halal seasoned ground beef patties with American cheese"), []);
  assert.deepEqual(b("Big Boy Smash Burger", "1/2 LB Beef Patty smashed on bed of onions"), ["smash"]);
  assert.deepEqual(b("The Cadillac", "With double smoked bacon, American cheese"), []);
  assert.deepEqual(b("Double Cheese", "Same as Above, with American Cheese"), []);
  assert.deepEqual(b("Burger", "Served with two sides"), []);
  assert.deepEqual(b("Smashburger", "Double patty, American cheese. Add egg, bacon or avocado for an additional charge."), ["smash", "double"]);
});

test("wagyu and dry-aged: the beef itself, never a topping or an add-on", () => {
  assert.deepEqual(b("Tavern Burger", "a5 wagyu, potato bun, binchotan slaw"), ["wagyu"]);
  assert.deepEqual(b("Kobe Beef Burger", "Eight-ounce Kobe beef patty"), ["wagyu"]);
  assert.deepEqual(b("Pastrami Burger", "American Wagyu pastrami, organic beef burger, Swiss cheese"), []);
  assert.deepEqual(b("Classic Burger", "Angus patty, cheddar. Sub Wagyu patty +$6"), []);
  assert.deepEqual(b("Black Label Burger", "selection of prime dry aged beef cuts, caramelized onions"), ["dry-aged"]);
  assert.deepEqual(b("Creekstone 28-Day Dry Aged Burger"), ["dry-aged"]);
  assert.deepEqual(b("Steak Burger", "topped with dry-aged ribeye"), []);
});

test("patty melt, and a burger with no style", () => {
  assert.deepEqual(b("Patty Melt", "8oz Angus beef, caramelized onions, on grilled challah bread"), ["patty-melt"]);
  assert.deepEqual(b("The French Onion Patty Melt", "sourdough bread, smashed burger patty, swiss cheese"), ["smash", "patty-melt"]);
  assert.deepEqual(b("Cheeseburger", "lettuce, tomato, onion"), []);
});

test("describingParts: add-ons, swaps, options and anything with a price are dropped", () => {
  assert.deepEqual(describingParts("Smashed Double Beef Patty, Pickles • Bacon +$4.00 | Sub Beyond Burger +$5.00"), ["Smashed Double Beef Patty, Pickles"]);
  assert.deepEqual(describingParts("Double patty, cheese. Add egg for an additional charge. Make it Impossible $17.95"), ["Double patty, cheese"]);
  assert.deepEqual(describingParts(null), []);
});

test("style paths, names and specs: /burgers/<style>, the spots whose priciest burger is of the style", () => {
  const smash = styleBySlug("smash")!;
  const spec = styleSpec(smash);
  assert.equal(rankingPath(spec), "/burgers/smash");
  assert.equal(rankingName(spec), "Burger spots in NYC where the priciest burger is a smash burger");
  assert.equal(rankingShortName(spec), "Smash burger spots");
  assert.equal(explorerHref(spec), null, "the explorer has no style filter");
  assert.ok(!isRankingPath("/burgers/smash"), "style lists mark Burgers as /burgers/* pages already do");
  assert.equal(rankingName(styleSpec(styleBySlug("patty-melt")!)), "Burger spots in NYC where the priciest burger is a patty melt");
  assert.deepEqual(STYLES.map((s) => s.slug), ["smash", "double", "wagyu", "dry-aged", "patty-melt"]);
});

test("a style list: distinct menus whose burger is of the style, cheapest first, every row, spots counted by location", () => {
  const list = [
    place({ chain: "smashy", name: "Smashy", price: 12, burger: "Smash Burger", hood: "a" }),
    place({ chain: "smashy", name: "Smashy", price: 12, burger: "Smash Burger", hood: "b" }),
    place({ name: "Plain", price: 9, burger: "Cheeseburger" }),
    place({ name: "Flat", price: 10, burger: "Double Smash" }),
  ] as PricedRestaurant[];
  const r = rankMenus(list, styleSpec(styleBySlug("smash")!));
  assert.deepEqual(r.rows.map((m) => [m.rank, m.restaurant.name, m.locations]), [[1, "Flat", 1], [2, "Smashy", 2]]);
  assert.equal(r.total, 2);
  assert.equal(r.spots, 3);
  assert.equal(
    segmentsText(styleSentence("a smash burger", "in NYC", r.rows, "September 2026")),
    "At 3 burger spots in NYC, the priciest burger is a smash burger (September 2026), from $10.00 at Flat to $12.00 at Smashy.",
  );
  assert.equal(segmentsText(styleSentence("a patty melt", "in NYC", [], "September 2026")), "No burger spot in NYC has a patty melt as its priciest burger (September 2026).");
  assert.deepEqual(stylesWithRankings(list), [], "fewer than 10 menus: no page");
});

test("the real dataset: styles with 10+ menus get a page; each row's burger is of its style; titles honest", () => {
  const data = loadDataset();
  const priced = data.restaurants.filter((r) => r.index_price !== null) as PricedRestaurant[];
  const styles = stylesWithRankings(priced);
  assert.deepEqual(styles.map((s) => s.slug), ["smash", "double", "wagyu", "dry-aged"]);
  const menus = menusByIndexPrice(priced);
  for (const s of STYLES) {
    const r = rankMenus(priced, styleSpec(s));
    assert.equal(r.total >= MIN_STYLE_MENUS, styles.includes(s), s.slug);
    assert.equal(r.total, menus.filter((m) => burgerStyles(m.restaurant.burger).includes(s.key)).length);
    const seo = rankingSeo({
      kind: "style",
      name: rankingName(styleSpec(s)),
      place: "NYC",
      inPlace: "in NYC",
      shortName: s.spots,
      aBurger: s.aBurger,
      under: null,
      rows: r.rows.map((m) => ({ restaurant: m.restaurant.name, burger: m.restaurant.burger.name, price: m.indexPrice })),
      total: r.total,
      spots: r.spots,
      generatedAt: data.generated_at,
    });
    if (r.rows.length) {
      assert.match(seo.title, new RegExp(`^${s.spots} in NYC: from \\$[\\d.]+ \\(Sep 2026\\)$`), seo.title);
      assert.ok(seo.description.startsWith(`${r.spots} burger spots in NYC where the priciest burger is ${s.aBurger}, cheapest first (September 2026).`), seo.description);
      assert.ok(seo.description.length <= 160);
    }
  }
});
