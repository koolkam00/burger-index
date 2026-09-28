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

const mk = (lists: { publisher: string; items: string[]; ranks?: number[]; added_on?: string; voided_on?: string }[]) => ({ version: 1, seeded_on: "2026-09-27", lists });

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
  const withRows = { ...empty, asOf: "2026-10-01", rows: [{ key: "x", firsts: 0 }] };
  assert.equal(siteBoard(withRows, FILE), withRows, "a published board's rows cover every counted list: it wins");
  assert.equal(siteBoard(empty, null), empty);
  assert.equal(siteBoard(empty, { junk: true }), empty);
  // a board the database published empty (a reset deleted every list) stays empty: no list the database dropped comes back
  const reset = { ...empty, asOf: "2026-10-01", rows: [] };
  assert.equal(siteBoard(reset, FILE), reset);
  assert.equal(siteBoard(reset, FILE).rows.length, 0);
});

test("\"#1 on N\" counts only a list whose own No. 1 the burger is", () => {
  // a list that counts only some of a publication's entries can lead with its No. 4
  const f = mk([
    { publisher: "A", items: ["k1", "k2", "k3"], ranks: [1, 2, 3] },
    { publisher: "B", items: ["k1", "k3", "k2"], ranks: [4, 7, 11] },
    { publisher: "C", items: ["k2", "k1", "k3"], ranks: [2, 3, 4] },
    { publisher: "D", items: ["k2", "k3", "k1"] },
  ]);
  const b = publishedBoard(f);
  assert.ok(b);
  const firsts = Object.fromEntries(b.rows.map((r) => [r.key, r.firsts]));
  assert.deepEqual(firsts, { k1: 1, k2: 1, k3: 0 });
  // the fit is the ladder's own: only `firsts` differs from computeBoard over the same lists
  const want = computeBoard(buildAggregates([["k1", "k2", "k3"], ["k1", "k3", "k2"], ["k2", "k1", "k3"], ["k2", "k3", "k1"]], { nets: ["A", "B", "C", "D"], asOf: "2026-09-27" }), null);
  const noFirsts = (r: { firsts: number }) => ({ ...r, firsts: 0 });
  assert.deepEqual(b.rows.map(noFirsts), want.rows.map(noFirsts));

  // the committed files: Red Hook Tavern is Brooklyn Magazine's No. 1 but Time Out's national No. 4, The Long Island Bar
  // Tasting Table's No. 2 (its No. 1, Peter Luger, has no menu price), Raoul's The Infatuation's No. 1
  const own = publishedBoard(FILE);
  assert.ok(own);
  const of = (k: string) => own.rows.find((r) => r.key === k)?.firsts;
  assert.equal(of("red-hook-tavern-carroll-gardens"), 1);
  assert.equal(of("the-long-island-bar-carroll-gardens"), 0);
  assert.equal(of("raouls-soho"), 1);
  for (const r of own.rows) {
    const no1 = FILE.lists.filter((l: { items: string[]; ranks: number[]; voided_on?: string }) => !l.voided_on && l.items[0] === r.key && l.ranks[0] === 1).length;
    assert.equal(r.firsts, no1, `${r.key}: #1 on ${r.firsts}, but the No. 1 of ${no1} list(s)`);
  }

  // a database board: its rows' firsts less the published lists it counted that lead with a lower rank
  const row = (key: string, firsts: number) => ({ key, firsts });
  const db = { ...emptyBoard(), asOf: "2026-09-30", rows: [row("red-hook-tavern-carroll-gardens", 5), row("the-long-island-bar-carroll-gardens", 1), row("raouls-soho", 3)] };
  const shown = siteBoard(db, FILE);
  assert.deepEqual(shown.rows.map((r) => r.firsts), [4, 0, 3]);
  assert.deepEqual(db.rows.map((r) => r.firsts), [5, 1, 3], "the committed board itself is untouched");
  // a board older than those lists counted none of them
  const old = { ...db, asOf: "2026-09-26" };
  assert.equal(siteBoard(old, FILE), old);
  // a list voided on or before the board's day no longer counts
  const voided = mk([{ publisher: "B", items: ["k1", "k3", "k2"], ranks: [4, 7, 11], voided_on: "2026-09-29" }]);
  const dbk = { ...emptyBoard(), asOf: "2026-09-30", rows: [row("k1", 2)] };
  assert.equal(siteBoard(dbk, voided), dbk);
  assert.equal(siteBoard({ ...dbk, asOf: "2026-09-28" }, voided).rows[0].firsts, 1, "voided after the board's day: it still counted");
  assert.equal(siteBoard({ ...dbk, rows: [row("k1", 0)] }, mk([{ publisher: "B", items: ["k1", "k3", "k2"], ranks: [4, 7, 11] }])).rows[0].firsts, 0, "never below 0");
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
