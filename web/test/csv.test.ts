import assert from "node:assert/strict";
import { test } from "node:test";
import { burgerPriceRows, burgerPricesCsv, CSV_COLUMNS, csvField, csvLine } from "../src/lib/csv";
import { PRICE_SOURCE_LABEL } from "../src/lib/labels";
import type { PricedRestaurant } from "../src/lib/schema";
import { loadDataset } from "./dataset";
import { place } from "./places";

const SITE = "https://burger-index.example";

/** RFC 4180 reader for the checks (quoted fields, doubled quotes, CRLF). */
function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && src[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

test("csvField: RFC 4180 quoting", () => {
  assert.equal(csvField("Joe's Pizza"), "Joe's Pizza");
  assert.equal(csvField("Burgers, Beer"), '"Burgers, Beer"');
  assert.equal(csvField('The "Big" One'), '"The ""Big"" One"');
  assert.equal(csvField("two\nlines"), '"two\nlines"');
  assert.equal(csvField(" padded "), '" padded "');
  assert.equal(csvField(""), "");
  assert.equal(csvField(null), "");
  assert.equal(csvField(15.99), "15.99");
});

test("csvField: a text cell a spreadsheet would run as a formula gets a leading apostrophe", () => {
  assert.equal(csvField("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField("+1 Burger"), "'+1 Burger");
  assert.equal(csvField("-Burger"), "'-Burger");
  assert.equal(csvField("@home"), "'@home");
  assert.equal(csvField("15.99"), "15.99");
});

test("csvLine joins quoted fields", () => {
  assert.equal(csvLine(["a", "b,c", null, 2]), 'a,"b,c",,2');
});

test("burgerPricesCsv: header, one CRLF-ended row per priced restaurant, the right columns", () => {
  const list = [
    place({ id: "b-place", name: "B, the Place", price: 12, burger: 'The "Classic"', hood: "west-village" }),
    place({ id: "a-place", name: "A Place", price: 20.5, hood: null }),
  ] as PricedRestaurant[];
  const csv = burgerPricesCsv(list, { site: SITE, generatedAt: "2026-09-25T02:30:00Z" });
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(!csv.startsWith("﻿"), "no BOM");
  const [header, ...rows] = parseCsv(csv);
  assert.deepEqual(header, [...CSV_COLUMNS]);
  assert.deepEqual(rows, [
    // Sorted by restaurant name; the New York day of a 02:30 UTC stamp is the day before.
    ["A Place", "", "Manhattan", "Cheeseburger", "20.50", "Restaurant site", `${SITE}/restaurants/a-place`, "2026-09-24"],
    ["B, the Place", "west-village", "Manhattan", 'The "Classic"', "12.00", "Restaurant site", `${SITE}/restaurants/b-place`, "2026-09-24"],
  ]);
});

test("the real dataset: one row per priced restaurant, equal to the dataset", () => {
  const data = loadDataset();
  const priced = data.restaurants.filter((r): r is PricedRestaurant => r.index_price !== null);
  const csv = burgerPricesCsv(priced, { site: SITE, generatedAt: data.generated_at });
  const [header, ...rows] = parseCsv(csv);
  assert.deepEqual(header, [...CSV_COLUMNS]);
  assert.equal(rows.length, priced.length);
  assert.equal(rows.length, burgerPriceRows(priced, { site: SITE, generatedAt: data.generated_at }).length);
  const byUrl = new Map(priced.map((r) => [`${SITE}/restaurants/${r.id}`, r]));
  const seen = new Set<string>();
  for (const row of rows) {
    assert.equal(row.length, CSV_COLUMNS.length);
    const [restaurant, neighborhood, borough, burger, price, source, url] = row;
    const r = byUrl.get(url);
    assert.ok(r, `row for ${url}`);
    assert.ok(!seen.has(url), `${url} once`);
    seen.add(url);
    assert.equal(restaurant, r.name);
    assert.equal(neighborhood, r.neighborhood ?? "");
    assert.equal(borough, r.borough);
    assert.equal(burger, r.burger.name);
    assert.equal(price, r.index_price.toFixed(2));
    assert.equal(source, PRICE_SOURCE_LABEL[r.price_source]);
  }
});
