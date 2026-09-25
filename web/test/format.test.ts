import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, formatSpan, spreadEnds } from "../src/lib/format";
import { atLeastOneParam, PLACEHOLDER_PARAM } from "../src/lib/site";

test("a range whose ends print the same collapses to one value", () => {
  assert.equal(formatSpan("$4.19", "$4.19"), "$4.19");
  assert.equal(formatSpan("$4.19", "$6.50"), "$4.19–$6.50");
  assert.equal(formatSpan("Sep 23, 2026", "Sep 23, 2026", " to "), "Sep 23, 2026");
});

test("spreadEnds tells a real spread from a tie or a single item", () => {
  const price = (x: { p: number | null }) => x.p;
  assert.equal(spreadEnds([], price), null);
  assert.equal(spreadEnds([{ p: 4.19 }], price), null);
  // "Manhattan is the priciest at $4.19; Staten Island is the cheapest at $4.19" is the bug.
  assert.equal(spreadEnds([{ p: 4.19 }, { p: 4.19 }, { p: 4.19 }], price), null);
  assert.equal(spreadEnds([{ p: 4.19 }, { p: 4.1900000001 }], price), null);
  const spread = spreadEnds([{ p: 6.5 }, { p: 5 }, { p: 4.19 }], price);
  assert.deepEqual([spread?.top.p, spread?.bottom.p], [6.5, 4.19]);
});

test("an empty dataset still gives every dynamic route one (404) param to export", () => {
  assert.deepEqual(atLeastOneParam([], { slug: PLACEHOLDER_PARAM }), [{ slug: "_none" }]);
  assert.deepEqual(atLeastOneParam([{ slug: "soho" }], { slug: PLACEHOLDER_PARAM }), [{ slug: "soho" }]);
  // Real slugs and ids match ^[a-z0-9-]+$, so the placeholder can never shadow one.
  assert.doesNotMatch(PLACEHOLDER_PARAM, /^[a-z0-9-]+$/);
});

test("a midnight-UTC stamp is a calendar day, not 8 PM the evening before in New York", () => {
  // pipeline/corrections.py writes a hand check's day as "<YYYY-MM-DD>T00:00:00Z".
  assert.equal(formatDate("2026-09-23T00:00:00Z"), "Sep 23, 2026");
  assert.equal(formatDate("2026-09-23T00:00:00.000Z"), "Sep 23, 2026");
  assert.equal(formatDate("2026-09-23T00:00:00+00:00"), "Sep 23, 2026");
  assert.equal(formatDate("2026-09-23"), "Sep 23, 2026");
  // A real timestamp is still shown in New York time: 02:30 UTC on the 24th is the evening of the 23rd.
  assert.equal(formatDate("2026-09-24T02:30:00Z"), "Sep 23, 2026");
  assert.equal(formatDate("2026-09-23T18:49:23Z"), "Sep 23, 2026");
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate("not a date"), "—");
});
