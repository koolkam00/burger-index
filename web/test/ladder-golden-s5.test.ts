// The Patty Ladder vs the simulator, S5: 30 fake lists put a true top-10 burger last on day 105 (test/ladder-golden.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardOn, burgerKey, replayGolden } from "./ladder-golden";

test("S5 (a one-day burial by 30 lists): every daily board matches the simulator's", () => {
  const { golden, boards, maxScoreDiff } = replayGolden("S5-1000");
  assert.equal(boards.length, 32);
  assert.ok(maxScoreDiff < 6e-7, `max score difference ${maxScoreDiff}`);
  const victim = burgerKey(golden.specials.victim);
  const row = (t: number) => boardOn(boards, t).rows.find((r) => r.key === victim);
  assert.ok(boardOn(boards, 104).top10.includes(victim), "seated before the attack");
  // frozen both ways while the burial lists are in its surge windows, and it keeps its seat meanwhile
  for (let t = 105; t <= 111; t++) {
    assert.equal(row(t)?.frozen, true, `day ${t}: frozen`);
    assert.equal(row(t)?.score, row(104)?.score, `day ${t}: the score holds while it surges`);
    assert.ok(boardOn(boards, t).top10.includes(victim), `day ${t}: keeps its seat`);
  }
  assert.equal(row(105)?.review, false, "burial lists put it last: no top-half surge support, no review");
});
