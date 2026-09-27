// The People's Top 10's sourcing line (lib/published-lists.ts; user decision 2026-09-26/27): one short line, computed
// from the committed data/ranker_published_lists.json, naming the published rankings that count among the lists, each
// like one visitor's list, with every list linked. Checked against the file and data/best_burgers.json (the same lists,
// by id), and for the words it must never use.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkPublishedLists, PUBLISHED_PATH, publishedMigrationSql } from "../scripts/ranker-published-migration.mjs";
import { joinAnd, listsInLine, publishedLine, publishedLineText, sourceText, type PublishedList } from "../src/lib/published-lists";

const file = JSON.parse(readFileSync(PUBLISHED_PATH, "utf8")) as { seeded_on: string; lists: (PublishedList & Record<string, unknown>)[] };
const lists: PublishedList[] = file.lists.map(({ id, publisher, title, url, date }) => ({ id, publisher, title, url, date }));
const best = JSON.parse(readFileSync(new URL("../../data/best_burgers.json", import.meta.url), "utf8")) as { lists: PublishedList[] };

test("the line names the four seeded rankings, each counted like one visitor's list, by publisher and month", () => {
  const line = publishedLine(lists);
  assert.ok(line);
  assert.equal(line.count, 4);
  assert.equal(
    publishedLineText(line),
    "Includes 4 published burger rankings, each counted like one visitor's list: The Infatuation (Aug 2026, Jan 2026), Time Out (Oct 2025) and Brooklyn Magazine (Sep 2024).",
  );
  assert.deepEqual(
    line.sources.map((s) => s.publisher),
    ["The Infatuation", "Time Out", "Brooklyn Magazine"],
  );
});

test("every seeded list is linked once, to the list itself, in the file's order; they are /best-burgers' lists", () => {
  const line = publishedLine(lists)!;
  const linked = line.sources.flatMap((s) => s.lists.map((l) => ({ id: l.id, publisher: s.publisher, title: l.title, url: l.url })));
  assert.deepEqual(
    linked,
    lists.map((l) => ({ id: l.id, publisher: l.publisher, title: l.title, url: l.url })),
  );
  const byId = new Map(best.lists.map((l) => [l.id, l]));
  for (const l of lists) {
    const b = byId.get(l.id);
    assert.ok(b, `${l.id} is not a /best-burgers list`);
    assert.deepEqual([b.publisher, b.title, b.url, b.date], [l.publisher, l.title, l.url, l.date]);
  }
});

test("one list, several from one publisher, none", () => {
  const one = publishedLine(lists.slice(2, 3))!;
  assert.equal(publishedLineText(one), "Includes 1 published burger ranking, counted like one visitor's list: Time Out (Oct 2025).");
  const two = publishedLine(lists.slice(0, 2))!;
  assert.equal(two.sources.length, 1);
  assert.equal(sourceText(two.sources[0]), "The Infatuation (Aug 2026, Jan 2026)");
  assert.equal(publishedLine([]), null);
  assert.equal(joinAnd([]), "");
  assert.equal(joinAnd(["A"]), "A");
  assert.equal(joinAnd(["A", "B"]), "A and B");
  assert.equal(joinAnd(["A", "B", "C"]), "A, B and C");
});

test("it says what counts, never how it's weighed or that critics rate anything", () => {
  const text = publishedLineText(publishedLine(lists)!);
  assert.doesNotMatch(text, /critic|rated|rating|weight|score|best burger/i);
  assert.match(text, /each counted like one visitor's list/);
});

test("a list voided after seeding keeps its entry with a voided_on day: the seeding migration ignores it", () => {
  const voided = JSON.parse(JSON.stringify(file));
  voided.lists[1].voided_on = "2026-10-10";
  assert.equal(checkPublishedLists(voided).length, 4);
  assert.equal(publishedMigrationSql(voided), publishedMigrationSql(file));
  // The line is made from the lists the committed board may count (lib/published-lists-data.ts): once a board as of the
  // void day or later is committed, the voided one is out.
  const seeded = voided.lists as (PublishedList & { voided_on?: string })[];
  const counted = listsInLine(seeded, file.seeded_on, "2026-10-10");
  assert.equal(
    publishedLineText(publishedLine(counted)!),
    "Includes 3 published burger rankings, each counted like one visitor's list: The Infatuation (Aug 2026), Time Out (Oct 2025) and Brooklyn Magazine (Sep 2024).",
  );
});

test("a voided list stays in the line while the committed board still counts it", () => {
  const seeded = file.lists.map((l, i) => (i === 1 ? { ...l, voided_on: "2026-10-10" } : { ...l })) as (PublishedList & { voided_on?: string })[];
  const ids = (asOf: string | null) => listsInLine(seeded, file.seeded_on, asOf).map((l) => l.id);
  const all = file.lists.map((l) => l.id);
  const without = all.filter((_, i) => i !== 1);
  // A void reaches the board only with the next publication: a board as of a day before the void still counts the list.
  assert.deepEqual(ids("2026-10-09"), all);
  assert.deepEqual(ids(file.seeded_on), all);
  // A board as of the void day or later was made after it (the refresh runs after midnight): the list is out.
  assert.deepEqual(ids("2026-10-10"), without);
  assert.deepEqual(ids("2026-11-01"), without);
  // No board yet, or one from before the seeding: the voided list was never counted.
  assert.deepEqual(ids(null), without);
  assert.deepEqual(ids("2026-09-26"), without);
  // A list not voided is always named.
  assert.deepEqual(listsInLine(lists, file.seeded_on, null).map((l) => l.id), all);
});
