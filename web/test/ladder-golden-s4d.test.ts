// The Patty Ladder vs the simulator, S4d: the S4c trickle, then three more weeks of honest lists (test/ladder-golden.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { burgerKey, replayGolden } from "./ladder-golden";

test("S4d (the trickle, then three honest weeks): every daily board matches the simulator's", () => {
  const { golden, boards, maxScoreDiff } = replayGolden("S4d-1000");
  assert.equal(boards.length, 53);
  assert.ok(maxScoreDiff < 6e-7, `max score difference ${maxScoreDiff}`);
  const target = burgerKey(golden.specials.target);
  const last = boards[boards.length - 1].rows.find((r) => r.key === target);
  // the surge has passed (the score moves again), but the review bar still keeps it off the board
  assert.equal(last?.surging, false);
  assert.equal(last?.frozen, false);
  assert.equal(last?.tier, "ranked");
  assert.equal(last?.review, true, "the review bar holds a surge-driven climber until the owner looks");
  assert.ok(boards.every((b) => !b.top10.includes(target)), "the trickle's burger never takes a seat (FINAL.md S4d: 0%)");
});
