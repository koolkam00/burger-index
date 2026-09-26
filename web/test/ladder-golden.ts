// The Patty Ladder against the ranker design's simulator (sim.py `Final`, the method's evidence), on its golden
// scenarios (FINAL.md section 12, A.10). Test-only (not a *.test.ts file): each ladder-golden-*.test.ts replays one
// scenario, so node --test runs them side by side.
//
// A fixture (test/fixtures/patty-ladder/<scenario>-<seed>.json.gz) holds one simulated city's every list in save
// order (burger b = "b%03d", its save day as a day number, its network), the simulator's surge weight for each list
// and, for every daily board from day 88 (the first board, no history) to the last, the burgers it flagged as
// surging, their surge support, its Top 10 and every ranked burger's published score. It was written by the
// design's check/dump_golden.py (seed 1000; the scenarios are FINAL.md section 10's):
//
//   S4a  40 fake lists put a mid-table burger #1 on one day (day 105)
//   S4c  the same 40 as a trickle, 2 a day from day 100
//   S4d  the trickle, then three more weeks of honest lists (141 days)
//   S5   30 fake lists put a true top-10 burger last on one day (day 105)
//
// The replay runs the whole chain in JS, as the database and the daily job do: refreshInputs (the nightly refresh:
// surge weights and flags from every list, the duplicate collapse, the aggregates), then computeBoard with the
// previous day's board. It must give the simulator's surge weights (bit for bit), flags and support, the same Top 10
// every day, and every score within 1e-6 (the simulator's fit stops at 1e-6, ours at 1e-10; the reference matched
// it within 5.01e-7).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { computeBoard, refreshInputs, type LadderBoard } from "../src/lib/ladder.mjs";

type GoldenDay = { t: number; surging: number[]; support: Record<string, number>; top10: number[]; S: Record<string, number> };
type Golden = {
  scenario: string;
  seed: number;
  lists: number[][];
  day: number[];
  net: number[];
  f: number[];
  collapsed: number[];
  days: GoldenDay[];
  specials: Record<string, number>;
};

export const burgerKey = (b: number) => `b${String(b).padStart(3, "0")}`;
/** Day t of the simulation as a New York date (day 0 = 2026-06-01). */
export const simDate = (t: number) => new Date(Date.UTC(2026, 5, 1) + t * 864e5).toISOString().slice(0, 10);

export function loadGolden(name: string): Golden {
  const gz = readFileSync(new URL(`./fixtures/patty-ladder/${name}.json.gz`, import.meta.url));
  return JSON.parse(gunzipSync(gz).toString("utf8")) as Golden;
}

/** Replays a scenario day by day, checking every board against the simulator's; returns the boards. */
export function replayGolden(name: string): { golden: Golden; boards: LadderBoard[]; maxScoreDiff: number } {
  const g = loadGolden(name);
  const lists = g.lists.map((items, i) => ({ items: items.map(burgerKey), day: simDate(g.day[i]), net: g.net[i] }));
  const boards: LadderBoard[] = [];
  let prev: LadderBoard | null = null;
  let maxScoreDiff = 0;
  for (const day of g.days) {
    const asOf = simDate(day.t);
    const inputs = refreshInputs(lists, { asOf });
    const counted = g.day.filter((d) => d <= day.t).length;
    assert.equal(inputs.countedLists, counted, `${asOf}: counted lists`);
    assert.equal(inputs.totalLists, counted - g.collapsed.filter((i) => g.day[i] <= day.t).length, `${asOf}: the duplicate collapse`);

    // the surge flags on asOf and each burger's surge support: the simulator's
    const surging = inputs.items.filter((it) => it.surging).map((it) => it.key).sort();
    assert.deepEqual(surging, day.surging.map(burgerKey).sort(), `${asOf}: surging burgers`);
    for (const it of inputs.items) assert.equal(it.surgeLists, day.support[String(Number(it.key.slice(1)))] ?? 0, `${asOf}: ${it.key} surge support`);

    const board = computeBoard(inputs, prev);
    assert.deepEqual(board.top10, day.top10.map(burgerKey), `${asOf}: the People's Top 10`);
    const ranked = board.rows.filter((r) => r.tier === "ranked");
    assert.deepEqual(ranked.map((r) => r.key).sort(), Object.keys(day.S).map((b) => burgerKey(Number(b))).sort(), `${asOf}: the ranked burgers`);
    for (const r of ranked) {
      const diff = Math.abs((r.score as number) - day.S[String(Number(r.key.slice(1)))]);
      assert.ok(diff <= 1e-6, `${asOf}: ${r.key} score ${r.score} vs the simulator's ${day.S[String(Number(r.key.slice(1)))]}`);
      maxScoreDiff = Math.max(maxScoreDiff, diff);
    }
    boards.push(board);
    prev = board;
  }
  // every list's surge weight, bit for bit (the database matched the simulator's the same way)
  const last = refreshInputs(lists, { asOf: simDate(g.days[g.days.length - 1].t) });
  assert.equal(last.weights.length, g.f.length);
  last.weights.forEach((w, i) => assert.equal(w, g.f[i], `list ${i}: surge weight`));
  assert.ok(g.f.some((w) => w < 1), "the scenario damps some lists");
  return { golden: g, boards, maxScoreDiff };
}

/** The first board on or after day t (a simulation day). */
export const boardOn = (boards: LadderBoard[], t: number) => boards.find((b) => b.asOf >= simDate(t)) as LadderBoard;
