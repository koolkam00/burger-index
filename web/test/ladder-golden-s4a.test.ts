// The Patty Ladder vs the simulator, S4a: 40 fake lists put a mid-table burger #1 on day 105 (test/ladder-golden.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardOn, burgerKey, replayGolden } from "./ladder-golden";

test("S4a (a one-day burst of 40 lists): every daily board matches the simulator's", () => {
  const { golden, boards, maxScoreDiff } = replayGolden("S4a-1000");
  assert.equal(boards.length, 32);
  assert.ok(maxScoreDiff < 6e-7, `max score difference ${maxScoreDiff}`);
  const target = burgerKey(golden.specials.target);
  const row = (t: number) => boardOn(boards, t).rows.find((r) => r.key === target);
  // the burst damps and freezes its burger for the week it stays in the window, puts it under review, and it
  // never takes a seat (FINAL.md: 0% of bursts reached the Top 10)
  for (let t = 105; t <= 111; t++) {
    assert.equal(row(t)?.surging, true, `day ${t}: surging`);
    assert.equal(row(t)?.frozen, true, `day ${t}: frozen`);
    assert.equal(row(t)?.score, row(105)?.score, `day ${t}: the score holds while it surges`);
  }
  assert.equal(row(112)?.surging, false);
  assert.equal(row(119)?.review, true, "surge-driven: under review");
  assert.ok(boards.every((b) => !b.top10.includes(target)), "the burst's burger never takes a seat");
});
