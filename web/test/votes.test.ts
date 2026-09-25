import assert from "node:assert/strict";
import { test } from "node:test";
import { castVote, VoteError } from "../src/lib/vote-api";
import {
  buildLeaderboard,
  classifyVoteError,
  FALLBACK_MEAN,
  formatAverage,
  isMenuKey,
  isValidScore,
  MIN_RANKED_VOTES,
  parseScoreRow,
  RATING_PRIOR_VOTES,
  SCORES,
  searchVoteMenus,
  voteMenus,
  weightedRating,
  type ScoreRow,
} from "../src/lib/votes";
import type { Borough, Restaurant } from "../src/lib/schema";

let seq = 0;
/** A restaurant row with one burger (the dataset lists one per restaurant: its index burger). */
function place(opts: { id?: string; name?: string; chain?: string | null; price: number | null; burger?: string; borough?: Borough; hood?: string | null }): Restaurant {
  seq += 1;
  const id = opts.id ?? `${opts.chain ?? "place"}-${seq}`;
  const burger = opts.burger ?? "Cheeseburger";
  return {
    id,
    camis: null,
    name: opts.name ?? (opts.chain ? opts.chain.toUpperCase() : id),
    chain: opts.chain ?? null,
    address: `${seq} Test Street`,
    borough: opts.borough ?? "Manhattan",
    neighborhood: opts.hood ?? null,
    neighborhood_slug: opts.hood ?? null,
    zipcode: null,
    lat: null,
    lng: null,
    cuisine: null,
    website: null,
    menu_url: null,
    price_source: opts.price === null ? null : "official_site",
    status: opts.price === null ? "no_prices" : "priced",
    status_detail: null,
    scraped_at: null,
    index_price: opts.price,
    burgers: opts.price === null ? [] : [{ id: `${id}--b`, name: burger, price: opts.price, description: null, protein: "beef", is_index_item: true }],
  };
}

const row = (menu_key: string, votes: number, total: number): ScoreRow => ({ menu_key, votes, total, at: null });
const menu = (key: string, name = key) => ({ key, name });

// ---- score validation --------------------------------------------------------------------------

test("scores are whole numbers from 1 to 10, nothing else", () => {
  assert.deepEqual(SCORES, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const ok of [1, 5, 10]) assert.equal(isValidScore(ok), true, String(ok));
  for (const bad of [0, 11, -1, 7.5, 9.99, Number.NaN, Infinity, "7", null, undefined, [7], { score: 7 }, true]) {
    assert.equal(isValidScore(bad), false, String(bad));
  }
});

test("castVote refuses a bad score or key before touching the network", async () => {
  const voter = "0b6c1c7e-6c1e-4a53-9a55-0c5f3b1d2e4f";
  for (const score of [0, 11, 7.5, Number.NaN]) {
    await assert.rejects(castVote("due-west", voter, score), (err: unknown) => err instanceof VoteError && err.kind === "invalid");
  }
  await assert.rejects(castVote("Due West!", voter, 7), (err: unknown) => err instanceof VoteError && err.kind === "invalid");
});

test("menu keys match the database check", () => {
  assert.equal(isMenuKey("3-sheets-saloon-west-village"), true);
  assert.equal(isMenuKey("chain:7th-street-burger"), true);
  for (const bad of ["", "Chain:x", "chain:", "a b", "a_b", "x".repeat(121), 42, null]) assert.equal(isMenuKey(bad), false, String(bad));
});

test("parseScoreRow keeps only well-formed totals, with updated_at as epoch ms", () => {
  assert.deepEqual(parseScoreRow({ menu_key: "a", votes: 3, total: 24, updated_at: "2026-09-25T12:00:00+00:00" }), {
    menu_key: "a",
    votes: 3,
    total: 24,
    at: Date.parse("2026-09-25T12:00:00Z"),
  });
  assert.deepEqual(parseScoreRow({ menu_key: "a", votes: 0, total: 0 }), { menu_key: "a", votes: 0, total: 0, at: null });
  for (const bad of [
    null,
    "a",
    { menu_key: "A!", votes: 1, total: 5 },
    { menu_key: "a", votes: 1.5, total: 5 },
    { menu_key: "a", votes: -1, total: 0 },
    { menu_key: "a", votes: 2, total: 1 }, // below 1 per vote
    { menu_key: "a", votes: 2, total: 21 }, // above 10 per vote
    { menu_key: "a", votes: "2", total: 10 },
  ]) {
    assert.equal(parseScoreRow(bad), null, JSON.stringify(bad));
  }
});

// ---- the ranking -----------------------------------------------------------------------------

test("weightedRating pulls a thin record towards the mean", () => {
  assert.equal(weightedRating(0, 0, 7), 7, "no votes: the mean");
  assert.equal(weightedRating(30, 3, 7), (RATING_PRIOR_VOTES * 7 + 30) / (RATING_PRIOR_VOTES + 3));
  // Three 10s against forty 9s, when the rest of the board averages 6: the long record wins.
  const mean = 6;
  assert.ok(weightedRating(360, 40, mean) > weightedRating(30, 3, mean));
});

test("only menus with enough votes are ranked; the rest wait, best average first", () => {
  const menus = [menu("a"), menu("b"), menu("c"), menu("d")];
  const b = buildLeaderboard(menus, [row("a", MIN_RANKED_VOTES, 27), row("b", MIN_RANKED_VOTES - 1, 20), row("c", 1, 4), row("d", 0, 0)]);
  assert.deepEqual(
    b.ranked.map((m) => m.key),
    ["a"],
  );
  assert.equal(b.ranked[0].rank, 1);
  assert.deepEqual(
    b.pending.map((m) => [m.key, m.rank, m.average]),
    [
      ["b", null, 10],
      ["c", null, 4],
    ],
  );
  assert.equal(b.rated, 3, "a menu with no votes left is not rated");
  assert.equal(b.votes, MIN_RANKED_VOTES + MIN_RANKED_VOTES - 1 + 1);
});

test("the ranking orders by weighted rating, not the plain average", () => {
  // x: three 10s; y: forty 9s; z..: a crowd of 5s that pulls the mean down to ~6.4.
  const crowd = Array.from({ length: 10 }, (_, i) => menu(`z${i}`));
  const menus = [menu("x", "X"), menu("y", "Y"), ...crowd];
  const scores = [row("x", 3, 30), row("y", 40, 360), ...crowd.map((m) => row(m.key, 5, 25))];
  const b = buildLeaderboard(menus, scores);
  assert.deepEqual(
    b.ranked.slice(0, 2).map((m) => m.key),
    ["y", "x"],
  );
  assert.equal(b.ranked[1].average, 10, "the average shown is the plain one");
  assert.ok(Math.abs(b.mean - (30 + 360 + 250) / (3 + 40 + 50)) < 1e-12);
});

test("exact ties share a rank (1, 2, 2, 4), more votes first, then by name", () => {
  // Same votes and total: same rating. "b" and "c" tie; "a" leads; "d" trails.
  const menus = [menu("c", "Cobble"), menu("a", "Alpha"), menu("b", "Bravo"), menu("d", "Delta")];
  const b = buildLeaderboard(menus, [row("a", 4, 40), row("b", 4, 32), row("c", 4, 32), row("d", 4, 20)]);
  assert.deepEqual(
    b.ranked.map((m) => [m.key, m.rank]),
    [
      ["a", 1],
      ["b", 2],
      ["c", 2],
      ["d", 4],
    ],
  );
});

test("ties on rating with different vote counts still share the rank, the bigger record first", () => {
  // With the mean fixed at 8 by construction, any all-8 record rates exactly 8.
  const b = buildLeaderboard([menu("few", "A"), menu("many", "Z")], [row("few", 3, 24), row("many", 9, 72)]);
  assert.equal(b.mean, 8);
  assert.deepEqual(
    b.ranked.map((m) => [m.key, m.rank]),
    [
      ["many", 1],
      ["few", 1],
    ],
  );
});

test("totals for keys the dataset doesn't know are ignored, mean included", () => {
  const b = buildLeaderboard([menu("known")], [row("known", 3, 21), row("gone-restaurant", 50, 500), row("chain:closed-chain", 9, 90)]);
  assert.deepEqual(
    b.ranked.map((m) => m.key),
    ["known"],
  );
  assert.equal(b.mean, 7);
  assert.equal(b.votes, 3);
  assert.equal(b.rated, 1);
});

test("malformed rows are ignored; nobody voted means the fallback mean", () => {
  const b = buildLeaderboard([menu("a")], [{ menu_key: "a", votes: 2, total: 50 }, { menu_key: "a", votes: -1, total: 0 }]);
  assert.equal(b.rated, 0);
  assert.equal(b.mean, FALLBACK_MEAN);
  assert.deepEqual(b.ranked, []);
  assert.deepEqual(b.pending, []);
});

test("chains count once: one entry, one key, however many locations", () => {
  const list = [
    place({ chain: "7th-street-burger", name: "7th Street Burger", price: 8.75, hood: "east-village" }),
    place({ chain: "7th-street-burger", name: "7th Street Burger", price: 8.75, hood: "astoria", borough: "Queens" }),
    place({ chain: "7th-street-burger", name: "7th Street Burger", price: 8.75, hood: "williamsburg", borough: "Brooklyn" }),
    place({ id: "due-west", name: "Due West", price: 19, burger: "Due West Burger", hood: "west-village" }),
    place({ id: "closed-place", name: "Closed Place", price: null }),
  ];
  const menus = voteMenus(list);
  assert.deepEqual(
    menus.map((m) => [m.key, m.locations, m.burger, m.neighborhood]),
    [
      ["chain:7th-street-burger", 3, "Cheeseburger", null],
      ["due-west", 1, "Due West Burger", "west-village"],
    ],
  );
  assert.equal(menus[0].id, list[0].id, "the chain links to its first priced location");
  // A menu listed twice still counts once in the ranking.
  const b = buildLeaderboard([...menus, ...menus], [row("chain:7th-street-burger", 5, 45), row("due-west", 3, 24)]);
  assert.equal(b.ranked.length, 2);
  assert.equal(b.ranked.filter((m) => m.key === "chain:7th-street-burger").length, 1);
});

test("formatAverage: one decimal, half up", () => {
  assert.equal(formatAverage(8), "8.0");
  assert.equal(formatAverage(26 / 3), "8.7");
  assert.equal(formatAverage(8.25), "8.3");
  assert.equal(formatAverage(10), "10.0");
});

test("searchVoteMenus: every word must match; names that start with the query come first", () => {
  const list = voteMenus([
    place({ id: "burger-joint", name: "Burger Joint", price: 12, hood: "Midtown" }),
    place({ id: "joes", name: "Joe's Burger Joint", price: 11, hood: "Astoria", borough: "Queens" }),
    place({ id: "cafe", name: "Café Luxembourg", price: 29, burger: "Luxembourg Burger", hood: "Upper West Side" }),
  ]);
  assert.deepEqual(
    searchVoteMenus(list, "burger joint").map((m) => m.key),
    ["burger-joint", "joes"],
  );
  assert.deepEqual(
    searchVoteMenus(list, "cafe").map((m) => m.key),
    ["cafe"],
    "accents fold",
  );
  assert.deepEqual(
    searchVoteMenus(list, "queens").map((m) => m.key),
    ["joes"],
  );
  assert.deepEqual(searchVoteMenus(list, "   "), []);
  assert.deepEqual(searchVoteMenus(list, "joint pizza"), []);
});

// ---- errors ------------------------------------------------------------------------------------

test("classifyVoteError maps the backend's codes to friendly kinds", () => {
  assert.equal(classifyVoteError({ code: "54000", message: "too many votes" }), "rate");
  assert.equal(classifyVoteError({ code: "22023", message: "bad" }), "invalid");
  assert.equal(classifyVoteError({ code: "22P02", message: "bad integer" }), "invalid");
  assert.equal(classifyVoteError({ code: "", message: "TypeError: Failed to fetch" }), "network");
  assert.equal(classifyVoteError(new TypeError("Load failed")), "network");
  assert.equal(classifyVoteError({ code: "PGRST202", message: "function not found" }), "unknown");
  assert.equal(classifyVoteError(new VoteError("rate")), "rate");
  assert.equal(classifyVoteError("boom"), "unknown");
});
