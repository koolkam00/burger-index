// The People's Top 10 before the database's first publication (lib/published-board.mjs): the published rankings'
// own board, fitted by the Patty Ladder's code, and the top 10 the pages show from it (lib/peoples-top.ts), over the
// committed data/ranker_published_lists.json, whatever lists it holds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { emptyBoard } from "../scripts/snapshot-peoples-top.mjs";
import { buildAggregates, computeBoard } from "../src/lib/ladder.mjs";
import { pricedMenus } from "../src/lib/menus";
import { FILL_MIN_LISTS, peoplesTopView, SEATS } from "../src/lib/peoples-top";
import { parseBoardFile } from "../src/lib/peoples-top-schema";
import { publishedBoard, publishedSaves, siteBoard } from "../src/lib/published-board.mjs";
import { loadDataset } from "./dataset";

const FILE = JSON.parse(readFileSync(new URL("../../data/ranker_published_lists.json", import.meta.url), "utf8"));

const mk = (lists: { publisher: string; items: string[]; added_on?: string; voided_on?: string }[]) => ({ version: 1, seeded_on: "2026-09-27", lists });

test("the saves: each counting list on its day, one network per publisher, a voided list left out", () => {
  const saves = publishedSaves(
    mk([
      { publisher: "B", items: ["b1", "b2", "b3"], added_on: "2026-09-29" },
      { publisher: "A", items: ["a1", "a2", "a3"] },
      { publisher: "A", items: ["a4", "a5", "a6"] },
      { publisher: "C", items: ["c1", "c2", "c3"], voided_on: "2026-09-28" },
    ]),
  );
  assert.deepEqual(
    saves?.map((s) => [s.items[0], s.day, s.net]),
    [
      ["a1", "2026-09-27", "published:A"],
      ["a4", "2026-09-27", "published:A"],
      ["b1", "2026-09-29", "published:B"],
    ],
  );
  assert.equal(publishedSaves({ version: 2, lists: [] }), null);
  assert.equal(publishedSaves(mk([{ publisher: "A", items: ["a1", "a1", "a2"] }])), null, "a list with a burger twice isn't one");
  assert.equal(publishedSaves(mk([{ publisher: "A", items: ["Not A Key", "a2", "a3"] }])), null);
  assert.equal(publishedBoard(mk([])), null);
  assert.equal(publishedBoard(mk([{ publisher: "A", items: ["a1", "a2", "a3"], voided_on: "2026-09-28" }])), null, "every list voided: no board");
});

test("the published board is computeBoard over the lists' aggregates, and checks out as a board file", () => {
  const lists = [
    { publisher: "A", items: ["k1", "k2", "k3", "k4"] },
    { publisher: "A", items: ["k2", "k1", "k5"] },
    { publisher: "B", items: ["k1", "k3", "k5"], added_on: "2026-09-28" },
  ];
  const b = publishedBoard(mk(lists));
  assert.ok(b);
  const want = computeBoard(buildAggregates(lists.map((l) => l.items), { nets: ["A", "A", "B"], asOf: "2026-09-28" }), null);
  assert.deepEqual(b.rows, want.rows);
  assert.deepEqual([b.asOf, b.totalLists, b.gate, b.early, b.refreshedAt], ["2026-09-28", 3, 5, true, null]);
  assert.equal(b.rows.find((r) => r.key === "k1")?.networks, 2);
  assert.equal(b.rows.find((r) => r.key === "k2")?.networks, 1, "one publisher's two lists are one network");
  assert.ok(parseBoardFile(b).ok);
});

test("the site's board: the committed one when it has rows, else the published lists' board", () => {
  const empty = emptyBoard();
  const own = siteBoard(empty, FILE);
  assert.notEqual(own, empty);
  assert.equal(own.asOf, FILE.lists.reduce((m: string, l: { added_on?: string }) => ((l.added_on ?? FILE.seeded_on) > m ? (l.added_on ?? FILE.seeded_on) : m), FILE.seeded_on));
  const withRows = { ...empty, rows: [{ key: "x" }] };
  assert.equal(siteBoard(withRows, FILE), withRows, "a published board's rows cover every counted list: it wins");
  assert.equal(siteBoard(empty, null), empty);
  assert.equal(siteBoard(empty, { junk: true }), empty);
});

test("the committed published lists fill a top 10 of burgers on 2+ lists from 2+ publishers", () => {
  const data = loadDataset();
  const menus = new Map(pricedMenus(data.restaurants).map((m) => [m.key, m]));
  const counting = FILE.lists.filter((l: { voided_on?: string }) => !l.voided_on);
  const board = publishedBoard(FILE);
  assert.ok(board);
  assert.equal(board.totalLists, counting.length);
  const parsed = parseBoardFile(board);
  assert.ok(parsed.ok);
  const v = peoplesTopView(parsed.board, (k) => menus.get(k));
  const rowOf = new Map(parsed.board.rows.map((r) => [r.key, r]));
  const qualifying = parsed.board.rows.filter((r) => menus.has(r.key) && r.lists >= FILL_MIN_LISTS && r.networks >= FILL_MIN_LISTS);
  assert.equal(v.seats.length, Math.min(SEATS, parsed.board.top10.length + qualifying.filter((r) => !parsed.board.top10.includes(r.key)).length));
  assert.ok(v.seats.length > 0, "the published lists show a top 10");
  for (const e of v.seats) {
    const r = rowOf.get(e.key)!;
    assert.ok(r.tier === "ranked" || (r.lists >= 2 && r.networks >= 2), `${e.key} is on too few lists`);
    // "On N lists" is the real count: the lists naming it among the published ones
    assert.equal(e.lists, counting.filter((l: { items: string[] }) => l.items.includes(e.key)).length);
  }
  const shown = new Set(v.seats.map((e) => e.key));
  assert.ok(v.rising.every((e) => !shown.has(e.key)));
  assert.deepEqual(v.seats.map((e) => e.rank), v.seats.map((_, i) => i + 1));
});
