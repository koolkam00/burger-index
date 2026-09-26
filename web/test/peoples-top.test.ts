// The People's Top 10 page's view of the daily board (lib/peoples-top.ts): the seats, the rest of the ranking and
// Rising, only for burgers the dataset has, numbered, with the "too close to call" marks and the flags, plus the
// words the page says; and the board file the build reads (lib/peoples-top-schema.ts), from a real Patty Ladder
// board over the dataset's menus.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boardSnapshot, emptyBoard, renderBoard } from "../scripts/snapshot-peoples-top.mjs";
import { computeBoard, refreshInputs } from "../src/lib/ladder.mjs";
import { pricedMenus } from "../src/lib/menus";
import {
  asOfText,
  boardCountLine,
  EMPTY_BOARD,
  FLAG_TEXT,
  ladderStartText,
  listsText,
  PEOPLES_TOP_ONE_LINER,
  peoplesTopLede,
  peoplesTopView,
  risingText,
  seatsHeading,
  type BoardFile,
  type BoardRow,
} from "../src/lib/peoples-top";
import { parseBoardFile } from "../src/lib/peoples-top-schema";
import { loadDataset } from "./dataset";

function row(key: string, tier: BoardRow["tier"], score: number | null, extra: Partial<BoardRow> = {}): BoardRow {
  return { key, tier, rank: null, score, theta: score ?? 0, lists: 20, firsts: 2, needs: 0, held: false, review: false, closeToNext: false, ...extra };
}

/** A board of 12 ranked burgers (the 10 seats first), 2 rising and 1 listed. */
function board(): BoardFile {
  const ranked = Array.from({ length: 12 }, (_, i) => row(`b${String(i + 1).padStart(2, "0")}`, "ranked", 1 - i * 0.1, { rank: i + 1 }));
  ranked[1].closeToNext = true; // #2 ≈ #3
  ranked[3].held = true;
  ranked[3].review = true;
  ranked[4].review = true;
  return {
    method: "patty-ladder/1",
    asOf: "2026-10-01",
    refreshedAt: "2026-10-02T04:20:03Z",
    totalLists: 640,
    gate: 5,
    early: false,
    top10: ranked.slice(0, 10).map((r) => r.key),
    rows: [...ranked, row("r1", "rising", null, { lists: 4, needs: 2 }), row("r2", "rising", null, { lists: 3, needs: 0 }), row("l1", "listed", null, { lists: 1 })],
  };
}

const everything = (key: string) => ({ key });

test("the view: the 10 seats, the rest numbered after them, Rising unnumbered, listed burgers not shown", () => {
  const v = peoplesTopView(board(), everything);
  assert.deepEqual(v.seats.map((e) => [e.rank, e.key]), board().top10.map((k, i) => [i + 1, k]));
  assert.deepEqual(v.rest.map((e) => [e.rank, e.key]), [[11, "b11"], [12, "b12"]]);
  assert.deepEqual(v.rising.map((e) => [e.key, e.needs]), [["r1", 2], ["r2", 1]], "never 'needs 0'");
  assert.equal(v.seats[2].closeToAbove, true, "#3 is too close to call with #2");
  assert.equal(v.seats.filter((e) => e.closeToAbove).length, 1);
  assert.equal(v.seats[3].flag, "held", "the owner's hold wins over the surge review");
  assert.equal(v.seats[4].flag, "surge");
  assert.equal(v.seats[0].flag, null);
  assert.deepEqual([v.asOf, v.totalLists, v.gate, v.early], ["2026-10-01", 640, 5, false]);
});

test("a burger the dataset no longer has leaves the board; its seat goes to the best ranked burger not under review", () => {
  const b = board();
  b.rows[10].review = true; // b11 is under review: b12 takes the seat
  const v = peoplesTopView(b, (key) => (key === "b03" || key === "r1" ? undefined : { key }));
  assert.deepEqual(v.seats.map((e) => e.key), ["b01", "b02", "b04", "b05", "b06", "b07", "b08", "b09", "b10", "b12"]);
  assert.deepEqual(v.seats.map((e) => e.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(v.rest.map((e) => [e.rank, e.key]), [[11, "b11"]]);
  assert.equal(v.seats[2].closeToAbove, false, "#2's mark was about b03, which left: no mark on its new neighbor");
  assert.deepEqual(v.rising.map((e) => e.key), ["r2"]);
});

test("early boards: fewer than 10 seats are shown as they are, never filled", () => {
  const b = board();
  b.top10 = b.top10.slice(0, 3);
  b.rows = b.rows.filter((r) => r.tier !== "ranked" || b.top10.includes(r.key));
  const v = peoplesTopView(b, everything);
  assert.deepEqual(v.seats.map((e) => e.key), ["b01", "b02", "b03"]);
  assert.deepEqual(v.rest, []);
  assert.equal(seatsHeading(v.seats.length), "The top 3 so far.");
  const empty = peoplesTopView(EMPTY_BOARD, everything);
  assert.deepEqual([empty.seats, empty.rest, empty.rising, empty.early], [[], [], [], true]);
});

test("the words: rows, headings, the ladder's start, the count line and the lede", () => {
  assert.equal(listsText(143, 27), "On 143 lists · #1 on 27");
  assert.equal(listsText(1, 0), "On 1 list");
  assert.equal(listsText(1284, 1), "On 1,284 lists · #1 on 1");
  assert.equal(risingText(7, 3), "On 7 lists · needs 3 more lists");
  assert.equal(risingText(4, 1), "On 4 lists · needs 1 more list");
  assert.equal(risingText(4, 0), "On 4 lists · needs 1 more list");
  assert.equal(seatsHeading(10), "The top 10.");
  assert.equal(seatsHeading(1), "The top burger so far.");
  assert.equal(ladderStartText(5, 12), "The ladder starts when burgers are on 5 lists each (12 lists so far).");
  assert.equal(ladderStartText(5, 1), "The ladder starts when burgers are on 5 lists each (1 list so far).");
  assert.equal(asOfText("2026-10-01"), "As of Oct 1, 2026");
  assert.equal(asOfText(null), null);
  assert.equal(FLAG_TEXT.held, "Under review");
  assert.equal(FLAG_TEXT.surge, "Checking a surge of lists");
  const v = peoplesTopView(board(), everything);
  assert.equal(boardCountLine(v), "From 640 lists, as of Oct 1, 2026.");
  assert.equal(boardCountLine(peoplesTopView(EMPTY_BOARD, everything)), "The ladder starts when burgers are on 5 lists each (0 lists so far).");
  assert.equal(peoplesTopLede({ name: "Emily", lists: 143, firsts: 27 }, "2026-10-01"), "Emily tops the People's Top 10: on 143 lists, #1 on 27 of them (as of Oct 1, 2026).");
  assert.equal(peoplesTopLede({ name: "Emily", lists: 5, firsts: 0 }, null), "Emily tops the People's Top 10: on 5 lists.");
  assert.equal(peoplesTopLede(null, null), "The burgers visitors rank highest, from their own lists.");
  assert.equal(
    PEOPLES_TOP_ONE_LINER,
    "Every list turns into head-to-head wins, with your #1 counting most; a burger you left off never loses, and a burger climbs only as far as enough different lists back it up.",
  );
});

test("the board file: the committed one and the writer's empty board check out; junk doesn't", () => {
  const committed = parseBoardFile(JSON.parse(readFileSync(new URL("../../data/peoples_top.json", import.meta.url), "utf8")));
  assert.equal(committed.ok, true);
  const empty = parseBoardFile(JSON.parse(renderBoard(emptyBoard())));
  assert.ok(empty.ok && empty.board.rows.length === 0 && empty.board.early);
  assert.equal(parseBoardFile({}).ok, false);
  assert.equal(parseBoardFile({ ...emptyBoard(), rows: [{ key: "Bad Key!", tier: "ranked" }] }).ok, false);
  assert.equal(parseBoardFile({ ...emptyBoard(), version: 2 }).ok, false);
});

test("a real Patty Ladder board over the dataset's menus: the page shows its seats, ranks and Rising exactly", () => {
  const data = loadDataset();
  const keys = pricedMenus(data.restaurants).map((m) => m.key);
  // 120 lists on two days from 40 networks: a clear favorite, a strong second, and a long tail.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const lists = Array.from({ length: 120 }, (_, i) => {
    const picks = new Set<string>([keys[0], keys[1]]);
    while (picks.size < 3 + (i % 8)) picks.add(keys[Math.floor(rand() * 30)]);
    const items = [...picks];
    if (i % 3 === 0) [items[0], items[1]] = [items[1], items[0]];
    return { items, day: i < 60 ? "2026-09-30" : "2026-10-01", net: i % 40 };
  });
  const inputs = refreshInputs(lists, { asOf: "2026-10-01" });
  const computed = computeBoard({ ...inputs, asOf: "2026-10-01" }, null);
  const snapshot = boardSnapshot(computed, { ...inputs, refreshedAt: "2026-10-02T04:20:00Z" }, "0".repeat(64), keys);
  const parsed = parseBoardFile(JSON.parse(renderBoard(snapshot)));
  assert.ok(parsed.ok);
  const menus = new Map(pricedMenus(data.restaurants).map((m) => [m.key, m]));
  const v = peoplesTopView(parsed.board, (k) => menus.get(k));
  assert.deepEqual(v.seats.map((e) => e.key), computed.top10);
  const rankedRows = computed.rows.filter((r) => r.tier === "ranked");
  assert.deepEqual([...v.seats, ...v.rest].map((e) => [e.rank, e.key]), rankedRows.map((r) => [r.rank, r.key]));
  assert.deepEqual(v.rising.map((e) => e.key), computed.rows.filter((r) => r.tier === "rising").map((r) => r.key));
  assert.equal(v.seats[0].key, keys[0], "the favorite is #1");
  assert.equal(v.early, true, "under 500 lists");
  for (const e of [...v.seats, ...v.rest]) {
    const r = computed.rows.find((x) => x.key === e.key);
    assert.equal(e.lists, r?.lists);
    assert.equal(e.firsts, r?.firsts);
  }
});
