import assert from "node:assert/strict";
import { test } from "node:test";
import { activeFilterCount, EMPTY_FILTERS, parseFilters, serializeFilters } from "../src/lib/explorer";

const HOODS = new Set(["soho", "astoria"]);
const parse = (qs: string) => parseFilters(new URLSearchParams(qs), HOODS);

test("a neighborhood the dataset doesn't have is dropped, not applied", () => {
  assert.equal(parse("neighborhood=astoria").neighborhood, "astoria");
  // A stale "Every burger in X" link would otherwise filter out every burger with no chip to remove.
  assert.equal(parse("neighborhood=not-a-hood").neighborhood, "");
  assert.equal(activeFilterCount(parse("neighborhood=not-a-hood")), 0);
});

test("hiding delivery-app prices is one exclusion, not an inclusion list of the other sources", () => {
  const hidden = { ...EMPTY_FILTERS, hideDelivery: true };
  assert.equal(serializeFilters(hidden), "hide=delivery_app");
  const back = parse(serializeFilters(hidden));
  assert.equal(back.hideDelivery, true);
  assert.deepEqual(back.sources, []);
  assert.equal(activeFilterCount(back), 1);
});

test("the Source list stays an inclusion list alongside the delivery toggle", () => {
  const f = parse("source=official_site,official_pdf&hide=delivery_app");
  assert.deepEqual(f.sources, ["official_site", "official_pdf"]);
  assert.equal(f.hideDelivery, true);
  assert.equal(activeFilterCount(f), 3);
  assert.equal(serializeFilters(f), "source=official_site,official_pdf&hide=delivery_app");
});

test("filters round-trip through the URL", () => {
  const qs = "q=cheese&borough=brooklyn,queens&neighborhood=soho&protein=beef&source=unknown&hide=delivery_app&min=5&max=12.5&index=1&sort=-price";
  assert.equal(serializeFilters(parse(qs)), qs);
});
