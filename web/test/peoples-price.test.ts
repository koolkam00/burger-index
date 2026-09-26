// The People's Price in the static HTML (lib/peoples-price.ts, user decision 2026-09-25): reading the snapshot
// (a missing, empty or broken one never fails the build), the rendering rules (the sentence from 3 answers, the
// existing wording below, live numbers without a date) and "Best value burgers", which only exists once 10 menus
// have a verdict, tested in both states with fixture snapshots.
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderSnapshot, snapshotMenus } from "../scripts/snapshot-peoples-price.mjs";
import {
  asOfText,
  BEST_VALUE_MIN_GAP,
  BEST_VALUE_MIN_VERDICTS,
  BEST_VALUE_NAME,
  BEST_VALUE_PATH,
  bestValue,
  bestValueLede,
  EMPTY_SNAPSHOT,
  hasPeoplesPriceSentence,
  histsFromEntries,
  liveFigures,
  parseSnapshot,
  peoplesPriceSentence,
  snapshotFigures,
  snapshotHistEntries,
  type PeoplesPriceSnapshot,
} from "../src/lib/peoples-price";
import { menuKey } from "../src/lib/menus";
import { bestValueSeo, DESCRIPTION_MAX, TITLE_MAX } from "../src/lib/seo";
import { MIN_VERDICT_ANSWERS, worthMenus, type WorthMenu } from "../src/lib/worth";
import { loadDataset } from "./dataset";
import { place } from "./places";

const AS_OF = "2026-09-26T09:00:04Z";

/** A snapshot file's contents as the writer makes them, from answers per menu: { key: [20, 22, 22] }. */
function file(answers: Record<string, number[]>, generatedAt: string | null = AS_OF): unknown {
  const rows = Object.entries(answers).flatMap(([menu_key, list]) => list.map((dollars) => ({ menu_key, dollars, votes: 1 })));
  const merged = new Map<string, { menu_key: string; dollars: number; votes: number }>();
  for (const r of rows) {
    const id = `${r.menu_key} ${r.dollars}`;
    merged.set(id, { ...r, votes: (merged.get(id)?.votes ?? 0) + 1 });
  }
  return JSON.parse(renderSnapshot({ generatedAt, menus: snapshotMenus([...merged.values()], Object.keys(answers)) }));
}

function snapshot(answers: Record<string, number[]>, known?: ReadonlySet<string>): PeoplesPriceSnapshot {
  const { snapshot: s, problems } = parseSnapshot(file(answers), known);
  assert.deepEqual(problems, []);
  return s;
}

// ---- reading the snapshot -------------------------------------------------------------------------

test("parseSnapshot reads what the writer writes", () => {
  const s = snapshot({ "due-west": [20, 22, 22, 30], "chain:jackson-hole": [15] });
  assert.equal(s.generatedAt, AS_OF);
  assert.deepEqual([...s.menus.keys()], ["chain:jackson-hole", "due-west"]);
  const dw = s.menus.get("due-west")!;
  assert.equal(dw.answers, 4);
  assert.equal(dw.median, 22);
  assert.deepEqual([...dw.hist], [[20, 1], [22, 2], [30, 1]]);
});

test("a missing, empty or broken snapshot is the empty one: never a build failure", () => {
  for (const raw of [undefined, null, "text", [], {}, { version: 2, generated_at: AS_OF, menus: {} }, { version: 1, generated_at: "yesterday", menus: {} }, { version: 1, generated_at: AS_OF, menus: [] }]) {
    const { snapshot: s } = parseSnapshot(raw);
    assert.equal(s, EMPTY_SNAPSHOT, JSON.stringify(raw));
  }
  // What sync-data writes when there is no snapshot: empty, and quiet.
  assert.deepEqual(parseSnapshot(JSON.parse(renderSnapshot({ generatedAt: null, menus: {} }))), { snapshot: EMPTY_SNAPSHOT, problems: [], unknown: 0 });
  assert.equal(snapshotFigures(EMPTY_SNAPSHOT, "due-west"), null, "no snapshot: the pages show the live numbers only");
});

test("entries that don't check out are dropped and named; the rest stay", () => {
  const raw = {
    version: 1,
    generated_at: AS_OF,
    menus: {
      good: { answers: 2, median: 21, hist: { "20": 1, "22": 1 } },
      "Bad Key": { answers: 1, median: 20, hist: { "20": 1 } },
      "too-low": { answers: 1, median: 4, hist: { "4": 1 } },
      "half-dollar": { answers: 1, median: 19.5, hist: { "19.5": 1 } },
      "zero-count": { answers: 0, median: 20, hist: { "20": 0 } },
      "wrong-count": { answers: 3, median: 20, hist: { "20": 2 } },
      "wrong-median": { answers: 2, median: 20, hist: { "20": 1, "30": 1 } },
      "no-hist": { answers: 1, median: 20 },
      empty: { answers: 0, median: null, hist: {} },
    },
  };
  const { snapshot: s, problems } = parseSnapshot(raw);
  assert.deepEqual([...s.menus.keys()], ["good"]);
  assert.equal(problems.length, 8);
  assert.ok(problems.some((p) => p.startsWith("wrong-median: median 20 does not match its histogram (25)")));
});

test("menus the dataset no longer has are left out quietly", () => {
  const { snapshot: s, problems, unknown } = parseSnapshot(file({ a: [20], gone: [30, 30, 30] }), new Set(["a", "b"]));
  assert.deepEqual([...s.menus.keys()], ["a"]);
  assert.deepEqual(problems, []);
  assert.equal(unknown, 1);
});

// ---- the rendering rules --------------------------------------------------------------------------

test("a menu's figures: the People's Price (the median, half up), the count and the snapshot's date", () => {
  const s = snapshot({ even: [21, 22], many: [20, 22, 23, 30], one: [44] });
  assert.deepEqual(snapshotFigures(s, "even"), { people: 22, answers: 2, asOf: AS_OF }, "$21.50 rounds half up to $22");
  assert.deepEqual(snapshotFigures(s, "many"), { people: 23, answers: 4, asOf: AS_OF });
  assert.deepEqual(snapshotFigures(s, "unanswered"), { people: null, answers: 0, asOf: AS_OF }, "not in the snapshot: no answers as of its date");
  assert.deepEqual(liveFigures(new Map([[20, 2], [30, 1]])), { people: 20, answers: 3, asOf: null });
  assert.deepEqual(liveFigures(undefined), { people: null, answers: 0, asOf: null });
});

test("the sentence: 3+ answers only, dated from the snapshot, undated when live", () => {
  const s = snapshot({ three: [20, 22, 24], two: [30, 31], many: Array.from({ length: 14 }, (_, i) => 15 + i) });
  const three = snapshotFigures(s, "three");
  const many = snapshotFigures(s, "many");
  assert.equal(MIN_VERDICT_ANSWERS, 3);
  assert.ok(hasPeoplesPriceSentence(three) && hasPeoplesPriceSentence(many));
  assert.equal(peoplesPriceSentence(three), "People's Price $22 from 3 answers, as of Sep 26, 2026.");
  assert.equal(peoplesPriceSentence(many), "People's Price $22 from 14 answers, as of Sep 26, 2026.");
  // Fewer answers keep each page's existing wording: no sentence.
  assert.equal(hasPeoplesPriceSentence(snapshotFigures(s, "two")), false);
  assert.equal(hasPeoplesPriceSentence(snapshotFigures(s, "unanswered")), false);
  assert.equal(hasPeoplesPriceSentence(null), false);
  // Live numbers: no date.
  const live = liveFigures(new Map([[23, 15]]));
  assert.ok(hasPeoplesPriceSentence(live));
  assert.equal(peoplesPriceSentence(live), "People's Price $23 from 15 answers.");
});

test("the date is New York's day: a snapshot taken at 02:00 UTC is dated the evening before", () => {
  assert.equal(asOfText("2026-09-26T02:00:00Z"), "as of Sep 25, 2026");
  assert.equal(asOfText("2026-09-26T09:00:04Z"), "as of Sep 26, 2026");
});

test("the board's histograms travel as plain arrays: only the page's menus, answers ascending", () => {
  const s = snapshot({ a: [30, 20, 20], b: [40], c: [10] });
  const entries = snapshotHistEntries(s, ["a", "b", "a", "missing"]);
  assert.deepEqual(entries, [
    ["a", [[20, 2], [30, 1]]],
    ["b", [[40, 1]]],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(entries)), entries, "serializable");
  assert.deepEqual([...histsFromEntries(entries).get("a")!], [[20, 2], [30, 1]]);
});

// ---- best value burgers: both states, with fixture snapshots --------------------------------------

/** Twelve independent menus priced $10…$21, plus a chain of three locations at $20 (one menu). */
const PLACES = [
  ...Array.from({ length: 12 }, (_, i) => place({ id: `spot-${i}`, name: `Spot ${String.fromCharCode(65 + i)}`, price: 10 + i, burger: `Burger ${i}` })),
  place({ chain: "jackson-hole", name: "Jackson Hole", price: 20 }),
  place({ chain: "jackson-hole", name: "Jackson Hole", price: 20 }),
  place({ chain: "jackson-hole", name: "Jackson Hole", price: 20 }),
];
const MENUS = worthMenus(PLACES);
const KNOWN = new Set(MENUS.map((m) => m.key));
const three = (dollars: number) => [dollars, dollars, dollars];

test("fixture with 9 verdicts: no page (and so no route, link or sitemap entry)", () => {
  const answers: Record<string, number[]> = {};
  for (let i = 0; i < 9; i++) answers[`spot-${i}`] = three(40);
  answers["spot-9"] = [40, 40]; // two answers: no verdict
  answers["chain:jackson-hole"] = [40]; // one
  const s = snapshot(answers, KNOWN);
  assert.equal(bestValue(MENUS, s), null);
  assert.equal(BEST_VALUE_MIN_VERDICTS, 10);
  assert.equal(bestValue(MENUS, EMPTY_SNAPSHOT), null, "no snapshot, no page");
});

test("fixture with 10 verdicts: the page lists the menus 10% or more above their menu price, widest gap first", () => {
  // Menu prices: spot-i costs $10 + i; the chain $20 (three locations, one menu).
  const s = snapshot(
    {
      "spot-0": three(15), // $10 -> $15: +50%
      "spot-1": [13, 14, 14], // $11 -> $14: +27%
      "spot-2": [18, 18, 18, 18], // $12 -> $18: +50%, the same gap as spot-0 with more answers
      "spot-3": [14, 15, 15, 15], // $13 -> $15: +15%, 4 answers
      "spot-4": three(16), // $14 -> $16: +14%
      "spot-5": three(16), // $15 -> $16: +6.7%, a bargain but under 10%
      "spot-6": three(12), // $16 -> $12: overpriced
      "spot-7": three(17), // $17 -> $17: right on the money
      "spot-8": three(20), // $18 -> $20: +11.1%
      "chain:jackson-hole": three(22), // $20 -> $22: +10% exactly: in
      "spot-9": [40, 40], // $19, two answers: no verdict, not listed
      "spot-10": three(23), // $20 -> $23: +15%
      "gone-restaurant": three(70), // not in the dataset
    },
    KNOWN,
  );
  const bv = bestValue(MENUS, s);
  assert.ok(bv, "10+ verdicts: the page exists");
  assert.equal(bv.verdicts, 11);
  assert.equal(bv.asOf, AS_OF);
  assert.deepEqual(
    bv.rows.map((r) => [r.rank, r.key, r.people, Math.round(r.verdict.gap!), r.verdict.label]),
    [
      // A tie shares its rank; more answers first.
      [1, "spot-2", 18, 50, "A bargain by 50%"],
      [1, "spot-0", 15, 50, "A bargain by 50%"],
      [3, "spot-1", 14, 27, "A bargain by 27%"],
      [4, "spot-3", 15, 15, "A bargain by 15%"],
      [5, "spot-10", 23, 15, "A bargain by 15%"],
      [6, "spot-4", 16, 14, "A bargain by 14%"],
      [7, "spot-8", 20, 11, "A bargain by 11%"],
      [8, "chain:jackson-hole", 22, 10, "A bargain by 10%"],
    ],
  );
  assert.equal(bv.rows.filter((r) => r.key === "chain:jackson-hole").length, 1, "a chain once");
  assert.ok(bv.rows.every((r) => Math.round(r.verdict.gap!) >= BEST_VALUE_MIN_GAP));
  assert.equal(
    bestValueLede(bv),
    "Visitors would pay $18 for the Burger 2 at Spot C, 50% more than its $12.00 menu price (People's Price as of Sep 26, 2026).",
  );
  const seo = bestValueSeo({ name: BEST_VALUE_NAME, minGap: BEST_VALUE_MIN_GAP, rows: bv.rows, asOf: bv.asOf, asOfDay: "Sep 26, 2026" });
  assert.equal(seo.title, "Best value burgers in NYC (Sep 2026)");
  assert.ok(seo.title.length <= TITLE_MAX && seo.description.length <= DESCRIPTION_MAX);
  assert.match(seo.description, /^8 NYC burgers whose People's Price, what visitors would pay, is 10% or more above the menu price\./);
  assert.doesNotMatch(`${seo.title} ${seo.description}`, /\bbest burgers?\b|cheapest burgers? in|burgers under \$/i);
  assert.equal(BEST_VALUE_PATH, "/best-value-burgers");
});

test("the gap as the verdict rounds it: 9.6% shows as 10% and is in, 9.4% is out", () => {
  // $52 menu price: $57 is +9.6%, $56.88 can't be answered, so use $53 -> $58 (+9.43%) for the out case.
  const list = [place({ id: "in", name: "In", price: 52 }), place({ id: "out", name: "Out", price: 53 }), ...Array.from({ length: 9 }, (_, i) => place({ id: `f-${i}`, price: 30 }))];
  const menus = worthMenus(list);
  const answers: Record<string, number[]> = { in: three(57), out: three(58) };
  for (let i = 0; i < 9; i++) answers[`f-${i}`] = three(30);
  const bv = bestValue(menus, snapshot(answers));
  assert.ok(bv);
  assert.deepEqual(
    bv.rows.map((r) => [r.key, r.verdict.label]),
    [["in", "A bargain by 10%"]],
  );
});

test("a page with 10 verdicts but no burger 10% above its price says so", () => {
  const s = snapshot(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`spot-${i}`, three(10 + i)])), KNOWN);
  const bv = bestValue(MENUS, s);
  assert.ok(bv);
  assert.deepEqual(bv.rows, []);
  assert.equal(bestValueLede(bv), "No burger's People's Price is 10% or more above its menu price yet (as of Sep 26, 2026).");
  const seo = bestValueSeo({ name: BEST_VALUE_NAME, minGap: BEST_VALUE_MIN_GAP, rows: [], asOf: AS_OF, asOfDay: "Sep 26, 2026" });
  assert.match(seo.description, /None yet\./);
});

test("on the real dataset: menu keys are the site's, and a fixture over its menus builds the page", () => {
  const data = loadDataset();
  const menus: WorthMenu[] = worthMenus(data.restaurants);
  const priced = data.restaurants.filter((r) => r.index_price !== null);
  assert.deepEqual(new Set(menus.map((m) => m.key)), new Set(priced.map((r) => menuKey(r as Parameters<typeof menuKey>[0]))));
  const answers = Object.fromEntries(menus.slice(0, 12).map((m) => [m.key, three(Math.min(75, Math.ceil(m.price * 1.3)))]));
  const bv = bestValue(menus, snapshot(answers, new Set(menus.map((m) => m.key))));
  assert.ok(bv);
  assert.equal(bv.verdicts, 12);
  assert.ok(bv.rows.length > 0);
});
