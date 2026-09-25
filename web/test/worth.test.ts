import assert from "node:assert/strict";
import { test } from "node:test";
import { castWorth, WorthError } from "../src/lib/worth-api";
import {
  ANSWER_START,
  axisPosition,
  BUCKET_COUNT,
  bucketAnswers,
  bucketIndex,
  bucketLabel,
  buildWorthBoards,
  classifyWorthError,
  formatDollars,
  gapPct,
  histCount,
  histMedian,
  histRange,
  histsFromRows,
  isMenuKey,
  isValidAnswer,
  medianOf,
  MIN_VERDICT_ANSWERS,
  parseHistRow,
  peoplesBurgerIndex,
  peoplesPrice,
  searchWorthMenus,
  summarize,
  verdictFor,
  worthAnnouncement,
  worthHref,
  worthMenus,
  type Hist,
} from "../src/lib/worth";
import type { Borough } from "../src/lib/schema";
import { place } from "./places";

/** A histogram from a list of answers: h(20, 20, 30) = {20: 2, 30: 1}. */
function h(...answers: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const a of answers) out.set(a, (out.get(a) ?? 0) + 1);
  return out;
}

const menu = (key: string, price: number, name = key) => ({ key, name, price });

// ---- answer validation --------------------------------------------------------------------------

test("answers are whole dollars from $5 to $75, nothing else", () => {
  for (const ok of [5, 6, 40, 74, 75]) assert.equal(isValidAnswer(ok), true, String(ok));
  for (const bad of [4, 76, 0, -5, 19.5, 5.01, 74.99, Number.NaN, Infinity, "20", null, undefined, [20], { dollars: 20 }, true]) {
    assert.equal(isValidAnswer(bad), false, String(bad));
  }
  assert.equal(ANSWER_START, 40, "the slider starts in the middle, never at the menu price");
});

test("castWorth refuses a bad answer or key before touching the network", async () => {
  const voter = "0b6c1c7e-6c1e-4a53-9a55-0c5f3b1d2e4f";
  for (const dollars of [4, 76, 19.5, Number.NaN]) {
    await assert.rejects(castWorth("due-west", voter, dollars), (err: unknown) => err instanceof WorthError && err.kind === "invalid");
  }
  await assert.rejects(castWorth("Due West!", voter, 20), (err: unknown) => err instanceof WorthError && err.kind === "invalid");
  // A valid answer outside a browser (or without the Supabase settings) is refused as "disabled".
  await assert.rejects(castWorth("due-west", voter, 20), (err: unknown) => err instanceof WorthError && err.kind === "disabled");
});

test("menu keys match the database check", () => {
  assert.equal(isMenuKey("3-sheets-saloon-west-village"), true);
  assert.equal(isMenuKey("chain:7th-street-burger"), true);
  for (const bad of ["", "Chain:x", "chain:", "a b", "a_b", "x".repeat(121), 42, null]) assert.equal(isMenuKey(bad), false, String(bad));
});

test("parseHistRow keeps only well-formed cells, with updated_at as epoch ms", () => {
  assert.deepEqual(parseHistRow({ menu_key: "a", dollars: 20, votes: 3, updated_at: "2026-09-25T12:00:00+00:00" }), {
    menu_key: "a",
    dollars: 20,
    votes: 3,
    at: Date.parse("2026-09-25T12:00:00Z"),
  });
  assert.deepEqual(parseHistRow({ menu_key: "a", dollars: 75, votes: 0 }), { menu_key: "a", dollars: 75, votes: 0, at: null });
  for (const bad of [
    null,
    "x",
    { menu_key: "A!", dollars: 20, votes: 1 },
    { menu_key: "a", dollars: 4, votes: 1 },
    { menu_key: "a", dollars: 76, votes: 1 },
    { menu_key: "a", dollars: 20.5, votes: 1 },
    { menu_key: "a", dollars: 20, votes: -1 },
    { menu_key: "a", dollars: 20, votes: 1.5 },
    { menu_key: "a", dollars: "20", votes: 1 },
  ]) {
    assert.equal(parseHistRow(bad), null, JSON.stringify(bad));
  }
});

test("histsFromRows groups cells per menu and drops empty ones", () => {
  const got = histsFromRows([
    { menu_key: "a", dollars: 20, votes: 2 },
    { menu_key: "a", dollars: 30, votes: 1 },
    { menu_key: "b", dollars: 10, votes: 0 },
  ]);
  assert.deepEqual([...got.keys()], ["a"]);
  assert.deepEqual([...(got.get("a") as Map<number, number>)], [
    [20, 2],
    [30, 1],
  ]);
});

// ---- the median ---------------------------------------------------------------------------------

test("histMedian is the middle answer, or the mean of the two middle ones", () => {
  assert.equal(histMedian(new Map()), null);
  assert.equal(histMedian(h(25)), 25);
  assert.equal(histMedian(h(10, 20, 30)), 20);
  assert.equal(histMedian(h(10, 10, 20, 30)), 15, "percentile_cont(0.5): (10 + 20) / 2");
  assert.equal(histMedian(h(20, 21)), 20.5);
  assert.equal(histMedian(h(5, 75, 75, 75)), 75);
  assert.equal(histMedian(h(5, 5, 5, 75)), 5);
  // Order doesn't matter, and zero or malformed cells are ignored.
  const messy = new Map<number, number>([
    [30, 1],
    [10, 1],
    [50, 0],
    [20, 1],
    [99, 4],
    [15, -2],
  ]);
  assert.equal(histMedian(messy), 20);
  assert.equal(histCount(messy), 3);
  assert.deepEqual(histRange(messy), { lo: 10, hi: 30 });
  assert.equal(histRange(new Map()), null);
});

test("the People's Price is the median rounded to whole dollars, half up", () => {
  assert.equal(peoplesPrice(null), null);
  assert.equal(peoplesPrice(17), 17);
  assert.equal(peoplesPrice(16.5), 17);
  assert.equal(peoplesPrice(16.49), 16);
  assert.equal(peoplesPrice(histMedian(h(16, 17))), 17);
  assert.equal(formatDollars(17), "$17");
  assert.equal(formatDollars(1250), "$1,250");
});

test("medianOf", () => {
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([4, 1, 3, 2]), 2.5);
});

// ---- $5 buckets ---------------------------------------------------------------------------------

test("answers fall in $5 buckets from $5 to $75; the top bucket takes $75", () => {
  assert.equal(BUCKET_COUNT, 14);
  const cases: Array<[number, number]> = [
    [5, 0],
    [9, 0],
    [10, 1],
    [14, 1],
    [15, 2],
    [69, 12],
    [70, 13],
    [74, 13],
    [75, 13],
  ];
  for (const [d, i] of cases) assert.equal(bucketIndex(d), i, `$${d}`);
  assert.equal(bucketLabel(0), "$5–$9");
  assert.equal(bucketLabel(1), "$10–$14");
  assert.equal(bucketLabel(13), "$70–$75");
  const b = bucketAnswers(h(5, 9, 9, 12, 70, 75, 75));
  assert.equal(b.length, 14);
  assert.deepEqual(
    b.map((x) => x.count),
    [3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3],
  );
  assert.deepEqual([b[13].lo, b[13].hi, b[13].label], [70, 75, "$70–$75"]);
  assert.equal(
    bucketAnswers(new Map()).every((x) => x.count === 0),
    true,
  );
});

test("the menu-price marker sits on the $5–$75 axis, pinned to the ends when off it", () => {
  assert.equal(axisPosition(5), 0);
  assert.equal(axisPosition(75), 1);
  assert.equal(axisPosition(40), 0.5);
  assert.equal(axisPosition(3.5), 0, "a menu price under $5");
  assert.equal(axisPosition(95), 1, "a menu price over $75 still gets a marker, at the right edge");
});

// ---- verdicts -------------------------------------------------------------------------------------

test("verdicts: a bargain or overpriced from 5% either way, right on the money under 5%", () => {
  // People's Price above the menu price: a bargain, measured from the menu price.
  const five = verdictFor(21, 20, 3);
  assert.deepEqual([five.kind, five.label], ["bargain", "A bargain by 5%"]);
  assert.ok(Math.abs((five.gap as number) - 5) < 1e-9);
  assert.equal(verdictFor(30, 20, 3).label, "A bargain by 50%");
  assert.equal(verdictFor(20, 19.05, 3).kind, "even", "4.99% is right on the money");
  // Menu price above the People's Price: overpriced, measured from the People's Price.
  assert.equal(verdictFor(19, 20, 3).label, "Overpriced by 5%", "5.26%");
  assert.equal(verdictFor(10, 20, 3).label, "Overpriced by 100%");
  assert.equal(verdictFor(20, 20.99, 3).label, "Right on the money", "4.95%");
  assert.equal(verdictFor(20, 20, 3).label, "Right on the money");
  // A menu priced above the slider's top still gets a verdict.
  assert.equal(verdictFor(75, 90, 5).label, "Overpriced by 20%");
  // Rounding: 12.5% -> 13%, 7.4% -> 7%.
  assert.equal(verdictFor(18, 16, 3).label, "A bargain by 13%");
  assert.equal(gapPct(16, 20), -25);
  assert.equal(gapPct(25, 20), 25);
});

test("no verdict before three answers", () => {
  assert.equal(MIN_VERDICT_ANSWERS, 3);
  for (const n of [0, 1, 2]) assert.deepEqual(verdictFor(40, 20, n), { kind: "pending", gap: null, label: "Needs a few more answers" });
  assert.equal(verdictFor(null, 20, 5).kind, "pending");
  assert.equal(verdictFor(40, 20, 3).kind, "bargain");
  const s = summarize(h(20, 30), 16.5);
  assert.deepEqual([s.answers, s.median, s.people, s.verdict.kind], [2, 25, 25, "pending"]);
  const t = summarize(h(15, 16, 17), 16.5);
  assert.deepEqual([t.answers, t.median, t.people, t.verdict.label], [3, 16, 16, "Right on the money"]);
  assert.deepEqual(summarize(undefined, 16.5), { answers: 0, median: null, people: null, verdict: { kind: "pending", gap: null, label: "Needs a few more answers" } });
});

// ---- menus, the People's Burger Index and the boards ------------------------------------------------

test("worthMenus lists each priced menu once, a chain once, at its index price", () => {
  const list = [
    place({ id: "due-west", name: "Due West", price: 18, burger: "Due West Burger", hood: "West Village" }),
    place({ chain: "7th-street-burger", name: "7th Street Burger", price: 9.49, hood: "East Village" }),
    place({ chain: "7th-street-burger", name: "7th Street Burger", price: 9.49, hood: "Chelsea" }),
    place({ chain: "7th-street-burger", name: "7th Street Burger", price: 9.49, hood: "Astoria", borough: "Queens" }),
    place({ id: "no-price", price: null }),
  ];
  const menus = worthMenus(list);
  assert.deepEqual(
    menus.map((m) => [m.key, m.price, m.locations, m.neighborhood]),
    [
      ["due-west", 18, 1, "West Village"],
      ["chain:7th-street-burger", 9.49, 3, null],
    ],
  );
  assert.equal(menus[0].burger, "Due West Burger");
  assert.equal(worthHref(menus[1].id), `/restaurants/${menus[1].id}#worth`);
});

test("the People's Burger Index: the median People's Price over menus with 3+ answers, chains once", () => {
  const list = [
    place({ id: "a", price: 10 }),
    place({ id: "b", price: 20 }),
    place({ id: "c", price: 30 }),
    place({ chain: "jackson-hole", price: 15 }),
    place({ chain: "jackson-hole", price: 15 }),
    place({ chain: "jackson-hole", price: 15 }),
  ];
  const menus = worthMenus(list);
  const hists = new Map<string, Hist>([
    ["a", h(10, 12, 14)], // median 12
    ["b", h(20, 25, 30, 35)], // median 27.5
    ["c", h(50, 60)], // only 2 answers: left out
    ["chain:jackson-hole", h(40, 40, 40)], // 40, once however many locations
    ["gone-restaurant", h(70, 70, 70)], // not in the dataset: ignored
  ]);
  assert.deepEqual(peoplesBurgerIndex(menus, hists), { value: 27.5, menus: 3 });
  assert.equal(peoplesPrice(peoplesBurgerIndex(menus, hists).value), 28);
  assert.deepEqual(peoplesBurgerIndex(menus, new Map()), { value: null, menus: 0 });
  // A menu listed twice counts once.
  assert.deepEqual(peoplesBurgerIndex([...menus, ...menus], hists), { value: 27.5, menus: 3 });
});

test("boards: bargains and overpriced by the widest gap, ties share a rank, then more answers, then name", () => {
  const menus = [
    menu("even", 20, "Even Steven"),
    menu("big-bargain", 10, "Zed's"),
    menu("bargain-tie-a", 20, "Bravo"),
    menu("bargain-tie-b", 20, "Alpha"),
    menu("bargain-tie-c", 20, "Charlie"),
    menu("rip-off", 40, "Rip Off"),
    menu("bit-steep", 22, "Bit Steep"),
    menu("few", 20, "Few Answers"),
    menu("quiet", 20, "Nobody"),
  ];
  const hists = new Map<string, Hist>([
    ["even", h(20, 20, 20)],
    ["big-bargain", h(20, 20, 20)], // +100%
    ["bargain-tie-a", h(30, 30, 30)], // +50%, 3 answers
    ["bargain-tie-b", h(30, 30, 30, 30)], // +50%, 4 answers: first of the tie
    ["bargain-tie-c", h(30, 30, 30)], // +50%, 3 answers, name after Bravo
    ["rip-off", h(20, 20, 20, 20, 20)], // −100%
    ["bit-steep", h(20, 20, 20)], // −10%
    ["few", h(60, 60)], // 2 answers: no verdict
    ["unknown-key", h(5, 5, 5)], // not in the dataset
  ]);
  const b = buildWorthBoards(menus, hists);
  assert.deepEqual(
    b.bargains.map((r) => [r.key, r.rank, r.verdict.label]),
    [
      ["big-bargain", 1, "A bargain by 100%"],
      ["bargain-tie-b", 2, "A bargain by 50%"],
      ["bargain-tie-a", 2, "A bargain by 50%"],
      ["bargain-tie-c", 2, "A bargain by 50%"],
    ],
  );
  assert.deepEqual(
    b.overpriced.map((r) => [r.key, r.rank, r.verdict.label]),
    [
      ["rip-off", 1, "Overpriced by 100%"],
      ["bit-steep", 2, "Overpriced by 10%"],
    ],
  );
  // "Right on the money" and menus short of a verdict are on neither of those boards.
  for (const k of ["even", "few"]) {
    assert.equal(b.bargains.some((r) => r.key === k) || b.overpriced.some((r) => r.key === k), false, k);
  }
  assert.deepEqual(
    b.mostAnswered.map((r) => [r.key, r.answers, r.rank]),
    [
      ["rip-off", 5, 1],
      ["bargain-tie-b", 4, 2],
      ["bit-steep", 3, 3],
      ["bargain-tie-a", 3, 3],
      ["bargain-tie-c", 3, 3],
      ["even", 3, 3],
      ["big-bargain", 3, 3],
      ["few", 2, 8],
    ],
  );
  assert.deepEqual(
    b.needsAnswers.map((r) => [r.key, r.verdict.label, r.people]),
    [["few", "Needs a few more answers", 60]],
  );
  assert.equal(b.answered, 8, "the unknown key and the unanswered menu don't count");
  assert.equal(b.answers, 3 + 3 + 3 + 4 + 3 + 5 + 3 + 2);
  // People's Prices of menus with 3+ answers: 20, 20, 30, 30, 30, 20, 20 -> median 20.
  assert.deepEqual([b.index, b.indexMenus], [20, 7]);
});

test("boards ignore unknown keys, count a repeated menu once and survive no answers at all", () => {
  const menus = [menu("a", 10), menu("a", 99), menu("b", 10)];
  const b = buildWorthBoards(menus, new Map<string, Hist>([["a", h(20, 20, 20)], ["zzz", h(5, 5, 5)]]));
  assert.deepEqual(
    b.bargains.map((r) => [r.key, r.price]),
    [["a", 10]],
    "the first entry wins",
  );
  assert.equal(b.answered, 1);
  const empty = buildWorthBoards(menus, new Map());
  assert.deepEqual([empty.bargains.length, empty.overpriced.length, empty.mostAnswered.length, empty.needsAnswers.length, empty.index, empty.answers], [0, 0, 0, 0, null, 0]);
});

test("searchWorthMenus: every word must match; name prefixes first", () => {
  const list = [
    { key: "joes", name: "Joe's Pizza & Burgers", burger: "Cheeseburger", neighborhood: "Astoria", borough: "Queens" as Borough },
    { key: "burger-joint", name: "Burger Joint", burger: "Hamburger", neighborhood: "Midtown", borough: "Manhattan" as Borough },
    { key: "cafe", name: "Café Luxembourg", burger: "Luxembourg Burger", neighborhood: "Upper West Side", borough: "Manhattan" as Borough },
  ];
  assert.deepEqual(
    searchWorthMenus(list, "burger").map((m) => m.key),
    ["burger-joint", "joes", "cafe"],
  );
  assert.deepEqual(
    searchWorthMenus(list, "cafe").map((m) => m.key),
    ["cafe"],
  );
  assert.deepEqual(
    searchWorthMenus(list, "queens").map((m) => m.key),
    ["joes"],
  );
  assert.deepEqual(searchWorthMenus(list, "   "), []);
});

// ---- errors ------------------------------------------------------------------------------------

test("classifyWorthError maps the backend's codes to friendly kinds", () => {
  assert.equal(classifyWorthError({ code: "54000", message: "too many answers from this connection" }), "rate");
  assert.equal(classifyWorthError({ code: "22023", message: "answer must be a whole number of dollars from 5 to 75" }), "invalid");
  assert.equal(classifyWorthError({ code: "22P02", message: "invalid input syntax for type integer" }), "invalid");
  assert.equal(classifyWorthError({ code: "", message: "TypeError: Failed to fetch" }), "network");
  assert.equal(classifyWorthError(new TypeError("Load failed")), "network");
  assert.equal(classifyWorthError({ code: "PGRST202", message: "function not found" }), "unknown");
  assert.equal(classifyWorthError(new WorthError("rate")), "rate");
  assert.equal(classifyWorthError("boom"), "unknown");
});

test("the screen-reader line after an answer: People's Price, count and verdict, nothing else", () => {
  const h = (answers: number[]) => histsFromRows(answers.map((d) => ({ menu_key: "m", dollars: d, votes: 1 }))).get("m");
  assert.equal(worthAnnouncement(summarize(h([30]), 27)), "People's Price $30, 1 answer. Needs a few more answers.");
  assert.equal(worthAnnouncement(summarize(h([22, 26, 30]), 27)), "People's Price $26, 3 answers. Right on the money.");
  assert.equal(worthAnnouncement(summarize(h([10, 11, 12]), 20)), "People's Price $11, 3 answers. Overpriced by 82%.");
  assert.equal(worthAnnouncement(summarize(undefined, 20)), "", "no answers: nothing to say");
  assert.doesNotMatch(worthAnnouncement(summarize(h([22, 26, 30]), 27)), /median|needs? 3|5%|measured/i, "no methodology");
});
