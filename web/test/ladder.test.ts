// The Patty Ladder (src/lib/ladder.mjs): the weights, the fit, the surge rule as the database applies it, and the
// board's guards (the cautious score, the daily step, the freeze, the gate and keep band, the network floor, Rising,
// the seat rule, the review bar, the owner's hold, the early label), determinism and the refusal of an unconverged
// fit. FINAL.md section 12 A; the simulator parity cases are in ladder-golden-*.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAggregates,
  computeBoard,
  fitStrength,
  LadderFitError,
  pairWeight,
  PARAMS,
  refreshInputs,
  sig9,
  surgeFactor,
  SURGE,
  type LadderBoard,
  type LadderInputs,
  type LadderPrev,
  type SavedList,
} from "../src/lib/ladder.mjs";

/** mulberry32: a small seeded generator (deterministic runs). */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A deterministic city: nKeys burgers, "b001" the strongest; each list = len of them ordered by strength + noise.
function world(nLists: number, { seed = 7, nKeys = 15, noise = 3, len = 5 } = {}): string[][] {
  const rnd = random(seed);
  const keys = Array.from({ length: nKeys }, (_, i) => "b" + String(i + 1).padStart(3, "0"));
  const lists: string[][] = [];
  for (let l = 0; l < nLists; l++) {
    const pick = [...keys].sort(() => rnd() - 0.5).slice(0, len);
    const score = new Map(pick.map((k) => [k, Number(k.slice(1)) + noise * rnd()]));
    pick.sort((a, b) => (score.get(a) as number) - (score.get(b) as number));
    lists.push(pick);
  }
  return lists;
}
const rowOf = (board: LadderBoard, key: string) => {
  const r = board.rows.find((x) => x.key === key);
  assert.ok(r, `${key} is on the board`);
  return r;
};
const agg = (lists: string[][], asOf: string, held: string[] = []) => buildAggregates(lists, { asOf, held: new Set(held) });
const nextDay = (iso: string, days = 1) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

/** Yesterday's board with chosen scores: every row ranked, score[key] as given (others unchanged). */
function craftPrev(board: LadderBoard, score: Record<string, number>, top10: string[], computed10: string[]): LadderPrev {
  return {
    asOf: board.asOf,
    rows: board.rows.map((r) => ({ key: r.key, tier: "ranked", theta: r.theta, score: score[r.key] ?? r.score ?? 0 })),
    top10,
    computed10,
  };
}

// ---- weights -----------------------------------------------------------------------------------

test("weights: a list's #1 wins 1 in total at any length, and a 25-list has about 3x a 3-list's voice", () => {
  const voice = (k: number) => {
    let v = 0;
    for (let p = 1; p < k; p++) v += (k - p) * pairWeight(k, p);
    return v;
  };
  for (let k = 3; k <= 25; k++) assert.ok(close((k - 1) * pairWeight(k, 1), 1, 1e-12), `k = ${k}`);
  assert.deepEqual([3, 5, 10, 25].map((k) => voice(k).toFixed(2)), ["1.40", "2.05", "3.08", "4.17"]);
  assert.ok(voice(25) / voice(3) <= 3.0);
  assert.equal(pairWeight(3, 1), 0.5);
  assert.ok(close(pairWeight(3, 2), 0.4, 1e-15));
  assert.ok(close(pairWeight(10, 5), 0.8 ** 4 / 9, 1e-15));
  assert.ok(pairWeight(25, 24) < 3e-4, "the tail of a long list barely counts");
});

test("matchups: a list only pairs its own burgers; leaving a burger off is never a loss", () => {
  const one = buildAggregates([["a", "b", "c"]]);
  assert.deepEqual(
    one.pairs.map((p) => [p.a, p.b, p.wab, p.wba]),
    [
      ["a", "b", 0.5, 0],
      ["a", "c", 0.5, 0],
      ["b", "c", pairWeight(3, 2), 0],
    ],
  );
  assert.ok(close(one.pairs[0].q, 0.25, 1e-15), "q sums the squared weights");
  const two = buildAggregates([["a", "b", "c"], ["d", "e", "f"]]);
  assert.ok(two.pairs.every((p) => [p.a, p.b].every((k) => "abc".includes(k)) || [p.a, p.b].every((k) => "def".includes(k))));
  assert.equal(two.pairs.length, 6);
  // "c" beaten from below: a list with c above a burger gives c a win, never a loss to the burgers it leaves off
  const three = buildAggregates([["c", "x", "y"]]);
  assert.ok(three.pairs.every((p) => (p.a === "c" ? p.wab > 0 : p.wba > 0) || !(p.a === "c" || p.b === "c")));
  assert.equal(two.items.find((it) => it.key === "a")?.firsts, 1);
});

// ---- the fit -------------------------------------------------------------------------------------

/** The dense directed weights computeBoard builds from aggregates (keys sorted). */
function denseW(inputs: LadderInputs) {
  const keys = inputs.items.map((it) => it.key).sort();
  const n = keys.length;
  const idx = new Map(keys.map((k, i) => [k, i]));
  const W = new Float64Array(n * n);
  for (const p of inputs.pairs) {
    const a = idx.get(p.a) as number;
    const b = idx.get(p.b) as number;
    W[a * n + b] = sig9(p.wab);
    W[b * n + a] = sig9(p.wba);
  }
  return { keys, n, W };
}
const sigm = (x: number) => 1 / (1 + Math.exp(-x));

test("fit: the gradient vanishes at the optimum; cold and warm starts agree; unbeaten and cut-off burgers stay finite", () => {
  const { n, W } = denseW(agg(world(300, { nKeys: 25 }), "2026-10-01"));
  const cold = fitStrength(W, n, 1, null, PARAMS.tol);
  assert.equal(cold.converged, true);
  for (let i = 0; i < n; i++) {
    let g = 1 - 2 * sigm(cold.theta[i]);
    for (let j = 0; j < n; j++) g += W[i * n + j] - (W[i * n + j] + W[j * n + i]) * sigm(cold.theta[i] - cold.theta[j]);
    assert.ok(Math.abs(g) < 1e-8, `gradient ${g} at ${i}`);
  }
  const warm = fitStrength(W, n, 1, Array.from(cold.theta, (t, i) => t + (i % 3) * 0.3 - 0.3), PARAMS.tol);
  assert.equal(warm.converged, true);
  cold.theta.forEach((t, i) => assert.ok(close(t, warm.theta[i], 1e-8)));
  const fromZero = fitStrength(W, n, 1, new Float64Array(n), PARAMS.tol);
  cold.theta.forEach((t, i) => assert.ok(close(t, fromZero.theta[i], 1e-8)));

  // x never loses; {a, b, c} and {d, e, f} never meet: the ghost burger keeps every strength finite
  const lists = [...Array.from({ length: 6 }, () => ["x", "a", "b"]), ["a", "b", "c"], ["d", "e", "f"], ["f", "e", "d"]];
  const board = computeBoard(buildAggregates(lists), null);
  for (const r of board.rows) assert.ok(Number.isFinite(r.theta) && Number.isFinite(r.sd) && Number.isFinite(r.raw), r.key);
  assert.ok(rowOf(board, "x").theta > rowOf(board, "a").theta);
  assert.ok(close(rowOf(board, "d").theta, rowOf(board, "f").theta, 1e-6), "d and f have mirror records");
  assert.ok(rowOf(board, "e").theta < rowOf(board, "d").theta, "e is second on both lists");
});

test("fit: renaming the burgers (a different key order) gives each the same strength", () => {
  const lists = world(200, { nKeys: 20 });
  const renamed = (k: string) => `z-${String(99 - Number(k.slice(1))).padStart(3, "0")}`; // reverses the key order
  const a = computeBoard(agg(lists, "2026-10-01"), null);
  const b = computeBoard(agg(lists.map((l) => l.map(renamed)), "2026-10-01"), null);
  for (const r of a.rows) {
    const s = rowOf(b, renamed(r.key));
    assert.ok(close(r.theta, s.theta, 2e-6) && close(r.sd, s.sd, 2e-6), r.key);
  }
  assert.deepEqual(a.top10.map(renamed), b.top10);
});

test("an unconverged fit is refused: LadderFitError, never a half-fitted board", () => {
  const a = agg(world(60), "2026-10-01");
  assert.ok(computeBoard(a, null).iterations <= 100);
  assert.throws(
    () => computeBoard(a, null, { ...PARAMS, tol: -1 }),
    (e: unknown) => e instanceof LadderFitError && e.code === "NOT_CONVERGED" && e.iterations === 100,
  );
  const W = new Float64Array([0, 1, 0, 0]);
  assert.equal(fitStrength(W, 2, 1, null, 1e-10).converged, true);
  const bad = fitStrength(W, 2, 1, null, -1);
  assert.deepEqual([bad.converged, bad.iterations], [false, 100]);
});

// ---- the surge rule (the database's nightly refresh) --------------------------------------------------

test("surgeFactor: 1 at or under the threshold, (T + sqrt(n - T)) / n over it, never above 1", () => {
  assert.equal(surgeFactor(3, 3, 20, 100, 0.01), 1, "n = T");
  assert.equal(surgeFactor(4, 4, 20, 100, 0.01), 1, "n - T = 1: (3 + 1) / 4 is exactly 1");
  assert.equal(surgeFactor(3.5, 3.5, 20, 100, 0.01), 1, "clamped: (3 + sqrt(0.5)) / 3.5 > 1");
  assert.equal(Number(surgeFactor(41, 41, 41, 41, 1 / 1001).toFixed(4)), 0.2235, "the worked example: T = 3, n = 41");
  assert.ok(close(surgeFactor(5, 5, 20, 100, 0.01), (3 + Math.SQRT2) / 5, 1e-15));
  // the threshold follows the burger's own earlier share: 3x the expected count
  assert.equal(surgeFactor(10, 10, 20, 100, 0.2), 1, "T = 3 x 20 x 0.2 = 12 > 10");
  assert.ok(surgeFactor(10, 16, 20, 100, 0.01) < 1, "the week window alone: T7 = 5");
});

/** `perDay` background lists a day for `days` days from `start`, over 40 burgers, each 5 long, all from different networks. */
function background(days: number, perDay: number, start = "2026-08-01"): SavedList[] {
  const rnd = random(11);
  const keys = Array.from({ length: 40 }, (_, i) => `bg-${i}`);
  const out: SavedList[] = [];
  for (let d = 0; d < days; d++)
    for (let i = 0; i < perDay; i++) out.push({ items: [...keys].sort(() => rnd() - 0.5).slice(0, 5), day: nextDay(start, d), net: `n${out.length}` });
  return out;
}
const burst = (n: number, day: string, make: (i: number) => string[]): SavedList[] =>
  Array.from({ length: n }, (_, i) => ({ items: make(i), day, net: `burst-${day}-${i}` }));
const itemOf = (inputs: LadderInputs, key: string) => inputs.items.find((it) => it.key === key);

test("refresh: a burst is damped, frozen on its day and for the week after, and flagged only once 500 lists came before", () => {
  const bg = background(40, 16); // 640 lists, 2026-08-01 .. 2026-09-09
  const day = "2026-09-09";
  const lists = [...bg, ...burst(12, day, (i) => ["x", `bg-${i % 40}`, `bg-${(i + 7) % 40}`])];
  const on = refreshInputs(lists, { asOf: day });
  assert.equal(itemOf(on, "x")?.surging, true);
  const xs = on.weights.slice(bg.length);
  assert.ok(xs.every((f) => close(f, surgeFactor(12, 12, 28, 12 + 7 * 16, 1 / (bg.length - 6 * 16 - 16 + 1)), 1e-12)), "each burst list counts (T + sqrt(n - T)) / n");
  assert.ok(on.weights.slice(0, bg.length).every((f) => f === 1), "background lists keep full weight");
  assert.ok(close(on.weightedLists, bg.length + xs.reduce((a, b) => a + b, 0), 1e-9));
  assert.equal(itemOf(on, "x")?.surgeLists, 12, "#1 on a 3-list is its top half");
  // the day after, with lists that day but none naming x: still surging through the 7-day window
  const later = [...lists, ...burst(16, nextDay(day), (i) => [`bg-${i}`, `bg-${i + 1}`, `bg-${i + 2}`])];
  assert.equal(itemOf(refreshInputs(later, { asOf: nextDay(day) }), "x")?.surging, true);
  // a week on, the burst has left the window: no longer surging (its lists stay damped)
  const weekOn = [...later, ...burst(16, nextDay(day, 7), (i) => [`bg-${i}`, `bg-${i + 2}`, `bg-${i + 4}`])];
  const w = refreshInputs(weekOn, { asOf: nextDay(day, 7) });
  assert.equal(itemOf(w, "x")?.surging, false);
  assert.ok(w.weights.slice(bg.length, bg.length + 12).every((f) => f < 1));
  // the same burst with fewer than 500 lists before its window: off
  const early = refreshInputs([...background(10, 16), ...burst(12, "2026-08-10", (i) => ["x", `bg-${i}`, `bg-${i + 1}`])], { asOf: "2026-08-10" });
  assert.equal(itemOf(early, "x")?.surging, false);
  assert.ok(early.weights.every((f) => f === 1));
});

test("refresh: surging means a factor below 1, as in the database: a 4-list day at T = 3 neither damps nor freezes", () => {
  const bg = background(40, 16);
  const day = "2026-09-09";
  const four = refreshInputs([...bg, ...burst(4, day, (i) => ["x", `bg-${i}`, `bg-${i + 1}`])], { asOf: day });
  assert.equal(itemOf(four, "x")?.surging, false, "n1 = 4 > T1 = 3, but (3 + 1) / 4 = 1");
  assert.ok(four.weights.every((f) => f === 1));
  assert.equal(four.damped.length, 0);
  const five = refreshInputs([...bg, ...burst(5, day, (i) => ["x", `bg-${i}`, `bg-${i + 1}`])], { asOf: day });
  assert.equal(itemOf(five, "x")?.surging, true);
  assert.deepEqual(five.damped.map((d) => [d.key, d.day]), [["x", day]]);
  // a board computed on those inputs freezes x's score both ways
  const prevBoard = computeBoard(five, null);
  const prev = craftPrev(prevBoard, { x: -3 }, prevBoard.top10, prevBoard.computed10);
  const next = computeBoard({ ...five, asOf: nextDay(day) }, prev);
  assert.equal(rowOf(next, "x").frozen, true);
});

test("refresh: surge support counts top-half places only; an owner clear restores full weight and lifts the flag", () => {
  const bg = background(40, 16);
  const day = "2026-09-09";
  // x last of 3 (a burial): damped and surging, but no top-half support
  const buried = refreshInputs([...bg, ...burst(12, day, (i) => [`bg-${i}`, `bg-${i + 1}`, "x"])], { asOf: day });
  assert.equal(itemOf(buried, "x")?.surging, true);
  assert.equal(itemOf(buried, "x")?.surgeLists, 0);
  // x second of 3: 2p <= k + 1 (4 <= 4) is the top half
  const second = refreshInputs([...bg, ...burst(12, day, (i) => [`bg-${i}`, "x", `bg-${i + 1}`])], { asOf: day });
  assert.equal(itemOf(second, "x")?.surgeLists, 12);
  const lists = [...bg, ...burst(12, day, (i) => ["x", `bg-${i}`, `bg-${i + 1}`])];
  const cleared = refreshInputs(lists, { asOf: day, cleared: [{ key: "x", from: "2026-09-03", to: "2026-09-15" }] });
  assert.equal(itemOf(cleared, "x")?.surging, false);
  assert.equal(itemOf(cleared, "x")?.surgeLists, 0);
  assert.ok(cleared.weights.every((f) => f === 1));
  // a clear of other days changes nothing
  const elsewhere = refreshInputs(lists, { asOf: day, cleared: [{ key: "x", from: "2026-09-01", to: "2026-09-08" }] });
  assert.equal(itemOf(elsewhere, "x")?.surging, true);
});

test("refresh: identical lists of 5+ burgers count once in the fit, but every copy counts toward the surge", () => {
  const bg = background(40, 16);
  const day = "2026-09-09";
  const copy = ["x", "bg-1", "bg-2", "bg-3", "bg-4"];
  const r = refreshInputs([...bg, ...burst(40, day, () => copy)], { asOf: day });
  assert.equal(r.countedLists, bg.length + 40);
  assert.equal(r.totalLists, bg.length + 1, "one copy enters the fit");
  assert.equal(itemOf(r, "x")?.lists, 1);
  assert.equal(itemOf(r, "x")?.surging, true, "the 40 copies still surge");
  assert.ok(r.weights.slice(bg.length).every((f) => f < 0.3));
  // identical 3-lists are not collapsed
  const short = refreshInputs([...bg, ...burst(3, day, () => ["x", "bg-1", "bg-2"])], { asOf: day });
  assert.equal(short.totalLists, bg.length + 3);
  // lists saved after asOf don't count yet
  const pending = refreshInputs([...bg, ...burst(3, nextDay(day), () => ["x", "bg-1", "bg-2"])], { asOf: day });
  assert.equal(pending.countedLists, bg.length);
  assert.equal(itemOf(pending, "x"), undefined);
  assert.equal(SURGE.minDup, 5);
});

// ---- the cautious score, the step and the freeze -------------------------------------------------------

test("cautious score: only the part of sd above 0.2 is taken off (a dead zone, not a floor); S = raw on the first board", () => {
  const check = (b: LadderBoard) => {
    for (const r of b.rows) {
      const expect = r.sd <= PARAMS.floor ? r.theta : r.theta - (r.sd - PARAMS.floor);
      assert.ok(Math.abs(r.raw - expect) <= 2e-6, `${r.key}: raw ${r.raw} vs ${expect}`);
      if (r.tier === "ranked") assert.equal(r.score, r.raw, "first board: S = raw");
    }
  };
  const few = computeBoard(agg(world(40), "2026-10-01"), null);
  check(few);
  assert.ok(few.rows.some((r) => r.sd > PARAMS.floor && r.raw < r.theta - 1e-3));
  const many = computeBoard(agg(world(4000, { nKeys: 150, noise: 300, len: 15 }), "2026-10-01"), null);
  check(many);
  const calm = many.rows.filter((r) => r.sd <= PARAMS.floor);
  assert.ok(calm.length > 0, "some burger is measured to sd <= 0.2");
  for (const r of calm) assert.equal(r.raw, r.theta, "sd <= 0.2: raw = theta, never theta - 0.2");
});

test("step: the score moves at most 0.25 a day (up to 4 days' worth after a gap), both ways; a newcomer starts from min(raw, 0)", () => {
  const inputs = agg(world(120), "2026-10-01");
  const day1 = computeBoard(inputs, null);
  const X = day1.top10[0];
  const raw = rowOf(day1, X).raw;
  const move = (base: number, days: number) => rowOf(computeBoard({ ...inputs, asOf: nextDay("2026-10-01", days) }, craftPrev(day1, { [X]: base }, day1.top10, day1.computed10)), X).score as number;
  assert.ok(close(move(raw - 2, 1), raw - 1.75));
  assert.ok(close(move(raw - 2, 2), raw - 1.5));
  assert.ok(close(move(raw - 2, 4), raw - 1));
  assert.ok(close(move(raw - 2, 9), raw - 1), "at most 4 days' worth");
  assert.ok(close(move(raw + 2, 1), raw + 1.75), "down as well");
  assert.ok(close(move(raw + 0.1, 1), raw), "within a step: the raw score");

  // a burger that wasn't ranked yesterday starts from min(raw, 0) and climbs from there
  const newcomerPrev = (key: string): LadderPrev => ({
    ...craftPrev(day1, {}, day1.top10, day1.computed10),
    rows: day1.rows.map((r) => ({ key: r.key, tier: r.key === key ? "rising" : "ranked", theta: r.theta, score: r.key === key ? null : r.score })),
  });
  const high = day1.rows.find((r) => r.raw > 0.3) as LadderBoard["rows"][number];
  const low = day1.rows.find((r) => r.raw < 0) as LadderBoard["rows"][number];
  assert.ok(high && low);
  assert.equal(rowOf(computeBoard({ ...inputs, asOf: "2026-10-02" }, newcomerPrev(high.key)), high.key).score, 0.25);
  assert.ok(close(rowOf(computeBoard({ ...inputs, asOf: "2026-10-02" }, newcomerPrev(low.key)), low.key).score as number, low.raw));
});

test("freeze: a surging burger's score doesn't move either way (not on the first board); an owner hold freezes it too, and unholding lets it move", () => {
  const inputs = agg(world(120), "2026-10-01");
  const day1 = computeBoard(inputs, null);
  const X = day1.top10[1];
  const raw = rowOf(day1, X).raw;
  const flagged = (flag: "surging" | "held") => ({ ...inputs, asOf: "2026-10-02", items: inputs.items.map((it) => (it.key === X ? { ...it, [flag]: true } : it)) });
  for (const base of [raw - 2, raw + 2]) {
    const prev = craftPrev(day1, { [X]: base }, day1.top10, day1.computed10);
    for (const flag of ["surging", "held"] as const) {
      const r = rowOf(computeBoard(flagged(flag), prev), X);
      assert.equal(r.frozen, true, flag);
      assert.ok(close(r.score as number, base), `${flag}: frozen at yesterday's score`);
    }
    assert.ok(!close(rowOf(computeBoard({ ...inputs, asOf: "2026-10-02" }, prev), X).score as number, base), "no flag: it moves");
  }
  const first = rowOf(computeBoard({ ...flagged("surging"), asOf: "2026-10-01" }, null), X);
  assert.equal(first.frozen, false, "no history to freeze on the first board");
  assert.equal(first.score, first.raw);
});

// ---- tiers ----------------------------------------------------------------------------------------

test("gate: clamp(ceil(0.5% of weighted lists), 5, 50)", () => {
  const inputs = agg(world(60), "2026-10-01");
  const gate = (weightedLists: number) => computeBoard({ ...inputs, weightedLists }, null).gate;
  assert.deepEqual([50, 1000, 1001, 2000, 10000, 50000].map(gate), [5, 5, 6, 10, 50, 50]);
});

test("keep band: a ranked burger stays ranked down to 80% of the gate; the network floor is half of it", () => {
  // k on 9 lists from 9 networks; G = 10 (2,000 weighted lists)
  const lists = (n: number) => [...Array.from({ length: n }, (_, i) => ["k", `a${i}`, `b${i}`]), ...world(40)];
  const at = (n: number) => ({ ...buildAggregates(lists(n)), weightedLists: 2000 });
  const fresh = computeBoard(at(9), null);
  assert.equal(fresh.gate, 10);
  assert.equal(rowOf(fresh, "k").tier, "rising");
  assert.equal(rowOf(fresh, "k").needs, 1);
  const wasRanked = (b: LadderBoard): LadderPrev => ({ asOf: "2026-09-30", rows: b.rows.map((r) => ({ key: r.key, tier: "ranked", theta: r.theta, score: r.raw })), top10: [], computed10: [] });
  assert.equal(rowOf(computeBoard(at(9), wasRanked(fresh)), "k").tier, "ranked", "9 >= ceil(0.8 x 10)");
  assert.equal(rowOf(computeBoard(at(8), wasRanked(fresh)), "k").tier, "ranked", "8 = ceil(0.8 x 10)");
  assert.equal(rowOf(computeBoard(at(7), wasRanked(fresh)), "k").tier, "rising", "7 < 8");
});

test("network floor and Rising: 'needs' counts lists short of the gate or networks short of the floor, never 0", () => {
  const mk = (nets: number[]) => buildAggregates(nets.map((_, i) => ["x", "a" + i, "b" + i]), { nets });
  const s = computeBoard(mk([0, 0, 0, 1, 1, 1]), null); // 6 lists from 2 networks; G = 5, floor ceil(5/2) = 3
  assert.equal(s.gate, 5);
  assert.deepEqual([rowOf(s, "x").tier, rowOf(s, "x").weighted, rowOf(s, "x").networks, rowOf(s, "x").needs], ["rising", 6, 2, 1]);
  assert.equal(rowOf(computeBoard(mk([0, 0, 1, 1, 2, 2]), null), "x").tier, "ranked");
  assert.deepEqual([rowOf(computeBoard(mk([0, 1, 2, 3]), null), "x").tier, rowOf(computeBoard(mk([0, 1, 2, 3]), null), "x").needs], ["rising", 1]);
  // Rising: 3+ weighted lists, unnumbered, by raw then key; burgers on 1-2 lists are "listed", off the board
  const board = computeBoard(mk([0, 1, 2]), null);
  assert.deepEqual([rowOf(board, "x").tier, rowOf(board, "x").rank, rowOf(board, "x").score, rowOf(board, "x").needs], ["rising", null, null, 2]);
  assert.deepEqual([rowOf(board, "a0").tier, rowOf(board, "a0").rank, rowOf(board, "a0").score], ["listed", null, null]);
  const rising = computeBoard(agg(world(30, { nKeys: 30 }), "2026-10-01"), null).rows.filter((r) => r.tier === "rising");
  assert.ok(rising.length > 1);
  for (let i = 1; i < rising.length; i++) assert.ok(rising[i - 1].raw > rising[i].raw || (rising[i - 1].raw === rising[i].raw && rising[i - 1].key < rising[i].key));
});

test("hidden burgers (not in the dataset) stay in the fit but are never ranked, rising or seated", () => {
  const inputs = agg(world(120), "2026-10-01");
  const shown = computeBoard(inputs, null);
  const X = shown.top10[0];
  const hidden = computeBoard({ ...inputs, hidden: [X] }, null);
  assert.deepEqual([rowOf(hidden, X).tier, rowOf(hidden, X).rank], ["listed", null]);
  assert.ok(!hidden.top10.includes(X) && !hidden.computed10.includes(X));
  for (const r of shown.rows) assert.equal(rowOf(hidden, r.key).theta, r.theta, "the same fit");
  assert.equal(hidden.rows.filter((r) => r.tier === "ranked").length, shown.rows.filter((r) => r.tier === "ranked").length - 1);
});

// ---- the People's Top 10 ------------------------------------------------------------------------------

test("seats: a newcomer needs two boards running in the computed ten, and to beat the weakest seat by 0.05", () => {
  const inputs = agg(world(200), "2026-10-01"); // 15 burgers, all ranked
  const day1 = computeBoard(inputs, null);
  assert.equal(day1.rows.filter((r) => r.tier === "ranked").length, 15);
  const keys = day1.rows.map((r) => r.key).sort();
  const incumbents = keys.slice(0, 10); // b001..b010
  const C = keys[10]; // b011
  // S = -10 + delta exactly: yesterday's score is S - 0.25 and today's raw is far above, so each climbs one step
  const delta: Record<string, number> = Object.fromEntries(incumbents.map((k, i) => [k, 2 - i / 10])); // b010 weakest at 1.1
  for (const k of keys.slice(11)) delta[k] = 0.5;
  const board = (cDelta: number, confirmed: boolean, extra: Partial<Record<"held" | "review", boolean>> = {}) => {
    const score = Object.fromEntries(Object.entries({ ...delta, [C]: cDelta }).map(([k, d]) => [k, -10 + d - 0.25]));
    const prev = craftPrev(day1, score, incumbents, confirmed ? [...incumbents.slice(0, 9), C] : incumbents);
    const items = inputs.items.map((it) => (it.key === C && extra.held ? { ...it, held: true } : it.key === C && extra.review ? { ...it, surgeLists: it.lists } : it));
    return computeBoard({ ...inputs, items, asOf: "2026-10-02" }, prev);
  };
  const s = (b: LadderBoard, k: string) => rowOf(b, k).score as number;

  const oneDay = board(3, false);
  assert.ok(close(s(oneDay, C), -7), "C tops the scores");
  assert.ok(oneDay.computed10.includes(C));
  assert.deepEqual([...oneDay.top10].sort(), incumbents, "one day in the computed ten is not enough");

  const short = board(1.14, true);
  assert.ok(close(s(short, C) - s(short, "b010"), 0.04));
  assert.ok(short.computed10.includes(C) && !short.top10.includes(C), "beats the weakest seat by 0.04: no seat");

  const enough = board(1.16, true);
  assert.ok(enough.top10.includes(C) && !enough.top10.includes("b010"), "beats it by 0.06: takes the weakest seat");
  assert.equal(enough.top10.length, 10);
  const order = enough.top10.map((k) => s(enough, k));
  assert.deepEqual(order, [...order].sort((a, b) => b - a), "the Top 10 in score order");
  assert.deepEqual(enough.rows.slice(0, 10).map((r) => r.key), enough.top10, "the seats rank 1-10, then the others");
  assert.equal(rowOf(enough, "b010").rank, 11);

  for (const extra of [{ held: true }, { review: true }]) {
    const barred = board(3, true, extra);
    assert.equal(rowOf(barred, C).review, true);
    assert.ok(!barred.top10.includes(C), `${Object.keys(extra)[0]}: no new seat`);
  }
});

test("seats: incumbents keep their seats (even under review or held), leave only when they stop being ranked, and empty seats fill", () => {
  const inputs = agg(world(200), "2026-10-01");
  const day1 = computeBoard(inputs, null);
  const keys = day1.rows.map((r) => r.key).sort();
  const score = Object.fromEntries(keys.map((k, i) => [k, -10 + (keys.length - i) / 10 - 0.25]));
  const worst = keys.slice(5, 15); // seated yesterday though others score higher now
  const prev = craftPrev(day1, score, worst, worst);
  const held = computeBoard({ ...inputs, asOf: "2026-10-02", items: inputs.items.map((it) => (it.key === worst[9] ? { ...it, held: true, surgeLists: it.lists } : it)) }, prev);
  assert.deepEqual([...held.top10].sort(), [...worst].sort(), "no challenger was in yesterday's computed ten: the seats stay");
  assert.equal(rowOf(held, worst[9]).review, true);

  // two incumbents leave the dataset: their seats go to the best ranked burgers not under review
  const gone = computeBoard({ ...inputs, asOf: "2026-10-02", hidden: worst.slice(0, 2), items: inputs.items.map((it) => (it.key === keys[0] ? { ...it, surgeLists: it.lists } : it)) }, prev);
  assert.equal(gone.top10.length, 10);
  assert.ok(!gone.top10.includes(worst[0]) && !gone.top10.includes(worst[1]));
  assert.ok(!gone.top10.includes(keys[0]), "under review: not seated even to fill a seat");
  assert.ok(gone.top10.includes(keys[1]) && gone.top10.includes(keys[2]), "the best ranked fill the empty seats");

  // the first board ever: the ten best ranked that aren't under review
  const first = computeBoard({ ...inputs, items: inputs.items.map((it) => (it.key === day1.top10[0] ? { ...it, surgeLists: it.lists } : it)) }, null);
  assert.ok(!first.top10.includes(day1.top10[0]) && first.computed10.includes(day1.top10[0]));
  assert.equal(first.top10.length, 10);
});

test("review bar: surge support on 25% or more of a burger's lists", () => {
  const inputs = agg(world(120), "2026-10-01");
  const X = inputs.items[0];
  const withSupport = (n: number) => computeBoard({ ...inputs, items: inputs.items.map((it) => (it.key === X.key ? { ...it, surgeLists: n } : it)) }, null);
  assert.equal(rowOf(withSupport(Math.ceil(0.25 * X.lists)), X.key).review, true);
  assert.equal(rowOf(withSupport(Math.ceil(0.25 * X.lists) - 1), X.key).review, false);
});

// ---- labels, ties, rounding, determinism ---------------------------------------------------------------

test("early results under 500 lists; adjacent rows too close to call below a 75% chance", () => {
  const inputs = agg(world(120), "2026-10-01");
  assert.equal(computeBoard({ ...inputs, totalLists: 499 }, null).early, true);
  assert.equal(computeBoard({ ...inputs, totalLists: 500 }, null).early, false);
  const board = computeBoard(inputs, null);
  const ranked = board.rows.filter((r) => r.tier === "ranked");
  for (const r of ranked.slice(0, -1)) {
    assert.ok(r.aheadP !== null && r.aheadP >= 0 && r.aheadP <= 1);
    assert.equal(r.closeToNext, (r.aheadP as number) < PARAMS.closeP);
  }
  assert.deepEqual([ranked[ranked.length - 1].aheadP, ranked[ranked.length - 1].closeToNext], [null, null]);
  assert.ok(ranked.some((r) => r.closeToNext) && ranked.some((r) => r.closeToNext === false));
});

test("ties and rounding: ranked rows after the seats go by score, then strength, then key; inputs keep 9 significant digits", () => {
  const board = computeBoard(agg(world(400, { nKeys: 40, len: 8 }), "2026-10-01"), null);
  const rest = board.rows.filter((r) => r.tier === "ranked").slice(10);
  for (let i = 1; i < rest.length; i++) {
    const [a, b] = [rest[i - 1], rest[i]];
    assert.ok((a.score as number) > (b.score as number) || (a.score === b.score && (a.theta > b.theta || (a.theta === b.theta && a.key < b.key))));
  }
  assert.equal(sig9(1.234567891234), 1.23456789);
  assert.equal(sig9(3.4e-7), 3.4e-7, "a small q survives (1e-6 absolute rounding broke phi)");
  assert.equal(sig9(3.000000004e-6), 3e-6);
  // outputs: 1e-6
  for (const r of board.rows) for (const v of [r.theta, r.sd, r.raw, r.phi]) assert.equal(v, Math.round(v * 1e6) / 1e6);
});

test("determinism: the same aggregates in any order give the same board", () => {
  const inputs = agg(world(300, { nKeys: 30 }), "2026-10-01");
  const a = computeBoard(inputs, null);
  const shuffled = { ...inputs, items: [...inputs.items].reverse(), pairs: [...inputs.pairs].reverse() };
  assert.deepEqual(computeBoard(shuffled, null), a);
  assert.deepEqual(JSON.stringify(computeBoard(inputs, null)), JSON.stringify(a));
  const day2 = { ...agg(world(330, { nKeys: 30 }), "2026-10-02") };
  assert.deepEqual(computeBoard(day2, a), computeBoard(day2, JSON.parse(JSON.stringify(a))), "yesterday read back from its JSON");
  const lists: SavedList[] = world(50).map((items, i) => ({ items, day: nextDay("2026-09-01", i % 10), net: i % 7 }));
  assert.deepEqual(refreshInputs(lists, { asOf: "2026-09-10" }), refreshInputs(lists, { asOf: "2026-09-10" }));
});

test("the owner's hold: no new seat and a frozen score; a held incumbent keeps its seat", () => {
  const lists = world(120);
  const X = "b001";
  const free1 = computeBoard(agg(lists.slice(0, 80), "2026-10-01"), null);
  assert.ok(free1.top10.includes(X));
  const held1 = computeBoard(agg(lists.slice(0, 80), "2026-10-01", [X]), null);
  assert.deepEqual([rowOf(held1, X).tier, rowOf(held1, X).held, rowOf(held1, X).review], ["ranked", true, true]);
  assert.ok(!held1.top10.includes(X) && held1.computed10.includes(X), "held on the first board: counted, not seated");
  const held2 = computeBoard(agg(lists, "2026-10-02", [X]), held1);
  assert.equal(rowOf(held2, X).score, rowOf(held1, X).score);
  assert.ok(!held2.top10.includes(X));
  const free2 = computeBoard(agg(lists, "2026-10-02"), held1);
  assert.notEqual(rowOf(free2, X).score, rowOf(held1, X).score, "unheld: the score moves");
  assert.ok(free2.top10.includes(X), "unheld: the confirmed burger takes a seat");
  const inc2 = computeBoard(agg(lists, "2026-10-02", [X]), free1);
  assert.ok(inc2.top10.includes(X));
  assert.equal(rowOf(inc2, X).score, rowOf(free1, X).score);
});

test("an empty board committed before the first publication counts as no history", () => {
  const inputs = agg(world(120), "2026-10-01");
  const empty: LadderPrev = { asOf: null, rows: [], top10: [], computed10: [] };
  assert.deepEqual(computeBoard(inputs, empty), computeBoard(inputs, null));
  const none = computeBoard({ asOf: "2026-10-01", totalLists: 0, weightedLists: 0, items: [], pairs: [] }, null);
  assert.deepEqual([none.rows, none.top10, none.gate, none.early], [[], [], 5, true]);
});
