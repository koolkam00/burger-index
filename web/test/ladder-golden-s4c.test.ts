// The Patty Ladder vs the simulator, S4c: 40 fake lists, 2 a day from day 100 (test/ladder-golden.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { burgerKey, replayGolden } from "./ladder-golden";

test("S4c (a trickle of 2 fake lists a day): every daily board matches the simulator's", () => {
  const { golden, boards, maxScoreDiff } = replayGolden("S4c-1000");
  assert.equal(boards.length, 32);
  assert.ok(maxScoreDiff < 6e-7, `max score difference ${maxScoreDiff}`);
  const target = burgerKey(golden.specials.target);
  const last = boards[boards.length - 1].rows.find((r) => r.key === target);
  assert.equal(last?.surging, true, "still surging at the end of the trickle");
  assert.equal(last?.review, true);
  assert.ok(boards.every((b) => !b.top10.includes(target)), "the trickle's burger never takes a seat");
});
