// The People's Top 10 beside the home ranker's list (lib/peoples-top-reveal.ts; user decision 2026-09-26, "Once 3
// are added"): when it shows, the seats with the visitor's picks marked, where their other picks stand (ranked,
// Rising or not ranked yet), the empty and early boards' words, and the data the page hands the ranker (the seats)
// and /data/menus.json carries (every other menu's standing), checked against the /peoples-top-10 view.
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardSnapshot, renderBoard } from "../scripts/snapshot-peoples-top.mjs";
import { computeBoard, refreshInputs } from "../src/lib/ladder.mjs";
import { listedMenus, menuListData, parseMenuList } from "../src/lib/menu-list";
import { menuWhere, pricedMenus } from "../src/lib/menus";
import { EMPTY_BOARD, peopleStandings, peoplesTopView, type BoardFile, type BoardRow, type PeopleStanding } from "../src/lib/peoples-top";
import {
  REVEAL_AT,
  revealAnnouncement,
  revealBoard,
  revealEmptyText,
  revealView,
  showsReveal,
  standText,
  yourList,
  type RevealBoard,
  type RevealPick,
} from "../src/lib/peoples-top-reveal";
import { parseBoardFile } from "../src/lib/peoples-top-schema";
import { MIN_ITEMS, rankerBurgers } from "../src/lib/ranker";
import { loadDataset } from "./dataset";
import { place } from "./places";

function row(key: string, tier: BoardRow["tier"], score: number | null, extra: Partial<BoardRow> = {}): BoardRow {
  return { key, tier, rank: null, score, theta: score ?? 0, lists: 20, firsts: 2, needs: 0, held: false, review: false, closeToNext: false, ...extra };
}

/** 12 ranked burgers (s01…s12; the first 10 seated), 2 Rising (r1 on 4 lists, r2 on 3) and 1 listed. */
function boardFile(): BoardFile {
  const ranked = Array.from({ length: 12 }, (_, i) => row(`s${String(i + 1).padStart(2, "0")}`, "ranked", 1 - i * 0.1, { rank: i + 1 }));
  ranked[1].closeToNext = true; // #2 ≈ #3
  ranked[4].held = true;
  return {
    method: "patty-ladder/1",
    asOf: "2026-10-01",
    refreshedAt: "2026-10-02T04:20:03Z",
    totalLists: 260,
    gate: 5,
    early: true,
    top10: ranked.slice(0, 10).map((r) => r.key),
    rows: [...ranked, row("r1", "rising", null, { lists: 4, needs: 1 }), row("r2", "rising", null, { lists: 3, needs: 2 }), row("l1", "listed", null, { lists: 1 })],
  };
}

const describe = (key: string) => ({ name: `Place ${key}`, burger: `Burger ${key}`, where: "Astoria, Queens" });
const view = () => peoplesTopView(boardFile(), (key) => key);
const board = (): RevealBoard => revealBoard(view(), describe);

/** The visitor's picks as /data/menus.json names them, with the standings the board gives them. */
function picks(extra: Record<string, RevealPick> = {}) {
  const standings = peopleStandings(view());
  return (key: string): RevealPick | undefined => extra[key] ?? (key.startsWith("gone") ? undefined : { label: `Place ${key}`, people: standings.get(key) ?? null });
}

test("the People's Top 10 shows at 3 burgers (the fewest a list can be saved with) and hides below", () => {
  assert.equal(REVEAL_AT, 3);
  assert.equal(REVEAL_AT, MIN_ITEMS);
  assert.deepEqual([0, 1, 2, 3, 4, 25].map(showsReveal), [false, false, false, true, true, true]);
  assert.equal(revealAnnouncement(board()), "The People's Top 10 now shows after your list.");
  // Nothing seated yet: the live region mustn't say the Top 10 shows (the words after the list say when it starts).
  assert.equal(revealAnnouncement({ seats: [] }), "The People's Top 10 hasn't started yet: see after your list.");
});

test("the page hands the ranker the seats only, each named, in the page's order, with its flag and '≈'", () => {
  const b = board();
  assert.deepEqual(b.seats.map((s) => [s.rank, s.key]), view().seats.map((e) => [e.rank, e.key]));
  assert.equal(b.seats.length, 10, "never the rest of the board");
  assert.deepEqual(b.seats[0], { key: "s01", rank: 1, name: "Place s01", burger: "Burger s01", where: "Astoria, Queens", flag: null, closeToAbove: false });
  assert.equal(b.seats[2].closeToAbove, true);
  assert.equal(b.seats[4].flag, "held");
  assert.deepEqual([b.asOf, b.totalLists, b.gate, b.early], ["2026-10-01", 260, 5, true]);
});

test("every other menu's standing: ranked like the page (the seats first), Rising with its list count, listed ones none", () => {
  const s = peopleStandings(view());
  assert.deepEqual(s.get("s01"), { rank: 1 });
  assert.deepEqual(s.get("s11"), { rank: 11 });
  assert.deepEqual(s.get("r1"), { rising: 4 });
  assert.equal(s.has("l1"), false, "a burger on 1 or 2 lists isn't shown");
  assert.equal(s.size, 14);
  assert.equal(peopleStandings(peoplesTopView(EMPTY_BOARD, (k) => k)).size, 0);
});

test("the visitor's picks on the People's Top 10 are marked with their place on the list", () => {
  const v = revealView(board(), ["s03", "x9", "s01", "r1"], picks(), "unsaved");
  assert.deepEqual(v.rows.map((r) => [r.rank, r.key, r.yours]).slice(0, 4), [
    [1, "s01", 3],
    [2, "s02", null],
    [3, "s03", 1],
    [4, "s04", null],
  ]);
  assert.equal(v.rows.filter((r) => r.yours !== null).length, 2);
  assert.equal(v.rows.length, 10);
  assert.equal(v.early, true, "Early results");
  assert.equal(v.countLine, "From 260 lists, as of Oct 1, 2026.");
  assert.equal(v.empty, null);
  assert.equal(v.closeLegend, true);
});

test("where the other picks stand, in the visitor's order: ranked, Rising, or not ranked yet", () => {
  const v = revealView(board(), ["s02", "s11", "r1", "nobody", "gone-1", "s12"], picks(), "counting");
  assert.equal(v.standsLabel, "Your other picks", "one pick is a seat");
  assert.deepEqual(
    v.stands.map((s) => [s.who, s.stand]),
    [
      ["Your #2, Place s11", "#11 on the People's Top 10"],
      ["Your #3, Place r1", "Rising · on 4 lists"],
      ["Your #4, Place nobody", "Not ranked yet"],
      ["Your #6, Place s12", "#12 on the People's Top 10"],
    ],
    "a seat is marked above, not here; a burger no longer on the Burger Index is skipped (its row says so)",
  );
  const none = revealView(board(), ["s11", "r2", "nobody"], picks(), "unsaved");
  assert.equal(none.standsLabel, "Your picks", "no pick is a seat");
  assert.deepEqual(none.stands.map((s) => s.stand), ["#11 on the People's Top 10", "Rising · on 3 lists", "Not ranked yet"]);
  const allSeated = revealView(board(), ["s01", "s02", "s03"], picks(), "unsaved");
  assert.deepEqual([allSeated.stands, allSeated.standsLabel], [[], null]);
  const loading = revealView(board(), ["s01", "s11", "r1"], null, "unsaved");
  assert.deepEqual(loading.stands, [], "the stand-lines wait for the burgers");
  assert.equal(loading.rows[0].yours, 1, "the marks don't");
  assert.equal(standText({ rank: 1284 }), "#1,284 on the People's Top 10");
  assert.equal(standText({ rising: 1 }), "Rising · on 1 list");
  assert.equal(standText(null), "Not ranked yet");
});

test("an empty board says when it starts, with the real numbers, and what the visitor's list does for it", () => {
  const empty = revealBoard(peoplesTopView(EMPTY_BOARD, (k) => k), describe);
  const first = revealView(empty, ["a", "b", "c"], picks(), "unsaved");
  assert.deepEqual([first.rows, first.early, first.countLine, first.closeLegend], [[], true, null, false], "'Early results' on the empty early board too, as on /peoples-top-10");
  assert.equal(first.empty, "No People's Top 10 yet: it starts when burgers are on 5 lists each. Your list helps start it once saved.", "before the first board: no count");
  assert.deepEqual(first.stands, [], "nothing to place the picks on");
  const later = { ...empty, asOf: "2026-10-01", totalLists: 12 };
  assert.equal(revealEmptyText(later, "unsaved"), "No People's Top 10 yet: it starts when burgers are on 5 lists each (12 lists so far). Your list helps start it once saved.");
  assert.equal(revealEmptyText(later, "counting"), "No People's Top 10 yet: it starts when burgers are on 5 lists each (12 lists so far). Your list helps start it.");
  assert.equal(revealEmptyText({ ...later, totalLists: 1 }, "not_counted"), "No People's Top 10 yet: it starts when burgers are on 5 lists each (1 list so far).");
  // Rising burgers but nothing seated yet: the picks' standings still show.
  const rising = revealView(later, ["a", "r1", "b"], picks({ r1: { label: "Place r1", people: { rising: 4 } } }), "unsaved");
  assert.deepEqual(rising.stands.map((s) => [s.who, s.stand]), [
    ["Your #1, Place a", "Not ranked yet"],
    ["Your #2, Place r1", "Rising · on 4 lists"],
    ["Your #3, Place b", "Not ranked yet"],
  ]);
  assert.equal(rising.standsLabel, "Your picks");
});

test("what the visitor's list does for the empty board follows the saved list, whether or not it is being edited", () => {
  // The ranker passes yourList(snap.saved?.status, snap.dirty): a saved list keeps counting while
  // it is edited, and a void one stays uncounted.
  assert.equal(yourList("active"), "counting", "an active saved list (edited or not)");
  assert.equal(yourList("void"), "not_counted", "a void saved list (edited or not)");
  assert.equal(yourList("deleted"), "not_counted");
  assert.equal(yourList("replaced"), "replaced", "as it is: it counts again only with 'Count it again'");
  assert.equal(yourList("replaced", true), "unsaved", "edited: the change saves itself and counts");
  assert.equal(yourList("active", true), "counting");
  assert.equal(yourList(null), "unsaved");
  assert.equal(yourList(undefined), "unsaved");
  const later = { ...revealBoard(peoplesTopView(EMPTY_BOARD, (k) => k), describe), asOf: "2026-10-01", totalLists: 12 };
  assert.equal(revealView(later, ["a", "b", "c"], picks(), yourList("active")).empty, "No People's Top 10 yet: it starts when burgers are on 5 lists each (12 lists so far). Your list helps start it.");
  assert.equal(revealView(later, ["a", "b", "c"], picks(), yourList("void")).empty, "No People's Top 10 yet: it starts when burgers are on 5 lists each (12 lists so far).");
  // a replaced list as it is: saving it waits for the visitor ("Count it again"), so never "once saved"
  assert.equal(revealView(later, ["a", "b", "c"], picks(), yourList("replaced")).empty, "No People's Top 10 yet: it starts when burgers are on 5 lists each (12 lists so far). Count it again to help start it.");
});

test("a board past 500 lists isn't early; a board with no '≈' has no legend", () => {
  const b = { ...board(), early: false, seats: board().seats.map((s) => ({ ...s, closeToAbove: false })) };
  const v = revealView(b, ["s01", "s02", "s03"], picks(), "counting");
  assert.equal(v.early, false);
  assert.equal(v.closeLegend, false);
});

test("/data/menus.json carries each menu's standing; the browser keeps only well-formed ones", () => {
  const list = [
    place({ id: "sals", name: "Sal's", price: 14, borough: "Queens", hood: "astoria" }),
    place({ id: "cafe", name: "Café", price: 26, hood: "uws" }),
    place({ id: "diner", name: "Diner", price: 12, hood: "uws" }),
  ];
  const standings = new Map<string, PeopleStanding>([
    ["sals", { rank: 3 }],
    ["cafe", { rising: 4 }],
  ]);
  const data = menuListData(list, standings);
  assert.deepEqual(data.menus.map((m) => [m.key, m.people ?? null]), [["sals", { rank: 3 }], ["cafe", { rising: 4 }], ["diner", null]]);
  assert.equal("people" in data.menus[2], false, "no standing: no field");
  assert.deepEqual(parseMenuList(JSON.parse(JSON.stringify(data))), data, "it survives the trip as JSON");
  const burgers = rankerBurgers(parseMenuList(JSON.parse(JSON.stringify(data))));
  assert.deepEqual([burgers.get("sals")!.people, burgers.get("cafe")!.people, burgers.get("diner")!.people], [{ rank: 3 }, { rising: 4 }, null]);
  const good = { key: "sals", burger: "B", price: 14, spots: [{ id: "sals", name: "Sal's", hood: "astoria", borough: "Queens" }] };
  const junk = [{ rank: 0 }, { rank: 2.5 }, { rising: -1 }, { rank: 1, rising: 3 }, { rank: "1" }, [1], "#1", null];
  for (const people of junk) {
    const parsed = parseMenuList({ hoods: {}, menus: [{ ...good, people }] });
    assert.equal(parsed.menus.length, 1, "the burger stays");
    assert.equal("people" in parsed.menus[0], false, `${JSON.stringify(people)}: no standing`);
  }
  assert.deepEqual(listedMenus(list).map((m) => "people" in m), [false, false, false], "without a board: none");
});

test("a real Patty Ladder board over the dataset: the reveal's seats and every standing match /peoples-top-10", () => {
  const data = loadDataset();
  const menus = pricedMenus(data.restaurants);
  const keys = menus.map((m) => m.key);
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const lists = Array.from({ length: 90 }, (_, i) => {
    const picked = new Set<string>([keys[2], keys[5]]);
    while (picked.size < 3 + (i % 6)) picked.add(keys[Math.floor(rand() * 40)]);
    return { items: [...picked], day: i < 45 ? "2026-09-30" : "2026-10-01", net: i % 30 };
  });
  const inputs = refreshInputs(lists, { asOf: "2026-10-01" });
  const computed = computeBoard({ ...inputs, asOf: "2026-10-01" }, null);
  const parsed = parseBoardFile(JSON.parse(renderBoard(boardSnapshot(computed, { ...inputs, refreshedAt: "2026-10-02T04:20:00Z" }, "0".repeat(64), keys))));
  assert.ok(parsed.ok);
  const byKey = new Map(menus.map((m) => [m.key, m]));
  const page = peoplesTopView(parsed.board, (k) => byKey.get(k));
  const b = revealBoard(page, (m) => ({ name: m.restaurant.name, burger: m.restaurant.burger.name, where: menuWhere(m) }));
  assert.deepEqual(b.seats.map((s) => [s.rank, s.key, s.name]), page.seats.map((e) => [e.rank, e.key, e.menu.restaurant.name]));
  const burgers = rankerBurgers(menuListData(data.restaurants, peopleStandings(page)));
  for (const e of [...page.seats, ...page.rest]) assert.deepEqual(burgers.get(e.key)?.people, { rank: e.rank });
  for (const e of page.rising) assert.deepEqual(burgers.get(e.key)?.people, { rising: e.lists });
  const shown = new Set([...page.seats, ...page.rest, ...page.rising].map((e) => e.key));
  for (const [key, burger] of burgers) if (!shown.has(key)) assert.equal(burger.people, null, key);
  // A visitor who picks #1, a burger past the seats and one not on the board.
  const past = page.rest[0]?.key ?? page.rising[0]?.key;
  const off = keys.find((k) => !shown.has(k))!;
  const list = [page.seats[0].key, ...(past ? [past] : []), off];
  const v = revealView(b, list, (k) => burgers.get(k), "counting");
  assert.equal(v.rows[0].yours, 1);
  assert.equal(v.stands.at(-1)?.stand, "Not ranked yet");
  assert.equal(v.stands.at(-1)?.who, `Your #${list.length}, ${burgers.get(off)!.label}`);
});
