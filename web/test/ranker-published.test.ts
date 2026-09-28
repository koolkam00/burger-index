// The published rankings saved as People's Top 10 lists (user decisions 2026-09-26/27; supabase/README.md
// "Published lists"): data/ranker_published_lists.json holds exactly the verified published rankings (the four seeded
// on 2026-09-27; Tasting Table's, added the same day at the user's request, "add at least one more list"; then Robert
// Sietsema's, "count the robert top 10", and Time Out's national ranking, added that evening), and the
// committed migrations (scripts/ranker-published-migration.mjs: the seeding and each addition) are the ones that file
// gives, so the file, the migrations and the live database (checked when each was applied) agree.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keysMigrationSql, MIGRATIONS_DIR } from "../scripts/ranker-keys-migration.mjs";
import {
  additionMigrations,
  additionMigrationSql,
  checkPublishedLists,
  keysBefore,
  main,
  PUBLISHED_ADD_FILE,
  PUBLISHED_FILE,
  PUBLISHED_PATH,
  publishedMigrations,
  publishedMigrationSql,
  seededLists,
} from "../scripts/ranker-published-migration.mjs";

type List = { id: string; publisher: string; items: string[]; ranks: number[]; names: string[]; length: number; added_on?: string; voided_on?: string };
const data = JSON.parse(readFileSync(PUBLISHED_PATH, "utf8"));
const clone = () => JSON.parse(JSON.stringify(data));
const TASTING_TABLE = "tastingtable-best-burgers-nyc-ranked";
const SIETSEMA = "sietsema-favorite-hamburgers-2026";
const TIMEOUT_AMERICA = "timeout-best-burgers-america";

test("the published lists are the verified rankings, and no other (user decisions 2026-09-26/27)", () => {
  const lists = data.lists as List[];
  assert.deepEqual(
    lists.map((l) => [l.id, l.publisher, l.items.length, l.added_on ?? null]),
    [
      ["infatuation-smashburger-power-rankings", "The Infatuation", 17, null],
      ["infatuation-limited-edition-burgers-ranked", "The Infatuation", 9, null],
      ["timeout-best-burgers-nyc", "Time Out", 14, null],
      ["bkmag-brooklyn-9-best-burgers-2024", "Brooklyn Magazine", 5, null],
      [TASTING_TABLE, "Tasting Table", 12, "2026-09-27"],
      [SIETSEMA, "Robert Sietsema's New York", 6, "2026-09-27"],
      [TIMEOUT_AMERICA, "Time Out", 3, "2026-09-27"],
    ],
  );
  // Tasting Table's countdown, No. 1 first: its No. 1 (Peter Luger) and No. 10 (S&P Lunch) have no menu price.
  const tt = lists[4];
  assert.deepEqual(tt.ranks, [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]);
  assert.deepEqual(tt.items.slice(0, 3), ["the-long-island-bar-carroll-gardens", "nowon-east-village", "keens-midtown"]);
  // Robert Sietsema's countdown from 10, No. 1 first: No. 2 Manuela (not on the index), No. 5 F. Ottomanelli and No. 10
  // Peter McManus (no menu price) and No. 9 Marty's (Jersey City) are left out.
  const rs = lists[5];
  assert.deepEqual(rs.ranks, [1, 3, 4, 6, 7, 8]);
  assert.deepEqual(rs.items, [
    "bar-six-west-village",
    "burgerhead-west-village",
    "hawksmoor-gramercy",
    "tavern-on-jane-west-village",
    "j-g-melon-lenox-hill",
    "union-square-cafe-gramercy",
  ]);
  // Time Out's national top 20: only its New York City entries, in its order (No. 1 is the Chicago Au Cheval).
  const ta = lists[6];
  assert.deepEqual(ta.ranks, [4, 7, 11]);
  assert.deepEqual(ta.items, ["red-hook-tavern-carroll-gardens", "hamburger-america-soho-soho", "deux-luxe-soho"]);
});

test("each list is one save_ranking accepted when its migration was written: 3 to 25 distinct keys of that day's key sync", () => {
  const [file] = publishedMigrations();
  assert.ok(file && PUBLISHED_FILE.test(file), "no supabase/migrations/*_ranker_published_lists.sql");
  const seeded = seededLists(data.lists) as List[];
  const keys = keysBefore(file.slice(0, 14));
  assert.ok(keys, `no ranker key sync before ${file}`);
  assert.equal(checkPublishedLists({ ...data, lists: seeded }, { keys: keys.keys }).length, 4);
  for (const { file: add, ids } of additionMigrations()) {
    const before = keysBefore(add.slice(0, 14));
    assert.ok(before, `no ranker key sync before ${add}`);
    const added = (data.lists as List[]).filter((l) => ids.includes(l.id));
    assert.equal(checkPublishedLists({ ...data, lists: added }, { keys: before.keys }).length, ids.length);
  }
});

test("the committed migrations are exactly the ones the data file gives: one seeding, then additions, each list once", () => {
  const files = publishedMigrations();
  assert.equal(files.length, 1, `expected one seeding migration, found ${files.join(", ") || "none"}`);
  assert.equal(readFileSync(join(MIGRATIONS_DIR, files[0]), "utf8"), publishedMigrationSql(data));
  const additions = additionMigrations();
  assert.deepEqual(
    additions.map((a) => a.ids),
    [[TASTING_TABLE], [SIETSEMA], [TIMEOUT_AMERICA]],
  );
  for (const { file, ids } of additions) {
    assert.ok(file.slice(0, 14) > files[0].slice(0, 14), `${file} comes before the seeding`);
    assert.equal(readFileSync(join(MIGRATIONS_DIR, file), "utf8"), additionMigrationSql(data, ids));
  }
  // every list with added_on is added by exactly one addition, and no seeded list by any
  const added = additions.flatMap((a) => a.ids).sort();
  const want = (data.lists as List[]).filter((l) => l.added_on).map((l) => l.id).sort();
  assert.deepEqual(added, want);
  // an added list leaves the seeding migration unchanged
  assert.equal(publishedMigrationSql({ ...data, lists: seededLists(data.lists) }), publishedMigrationSql(data));
});

test("the seeding migration changes no function the refresh or the rate limits run, and the audit view has no voter id or hash", () => {
  const sql = publishedMigrationSql(data);
  const replaced = [...sql.matchAll(/create or replace function ([\w.]+)/g)].map((m) => m[1]);
  assert.deepEqual(replaced, ["public.ranker_published_lists_rows"]);
  const columns = /returns table \(([^)]*)\)/.exec(sql)?.[1] ?? "";
  assert.doesNotMatch(columns, /voter|hash/);
  assert.match(sql, /create view public\.ranker_published_lists with \(security_invoker = true\)/);
  assert.match(sql, /grant select on public\.ranker_published_lists to anon, authenticated;/);
  assert.match(sql, /revoke all on ranker_private\.ranker_published from public, anon, authenticated;/);
  // its checks count the seeded lists and publishers; text is quoted
  assert.match(sql, /if v_n <> 4 then\n {4}raise exception 'expected 4 published lists/);
  assert.match(sql, /expected 3 publisher networks/);
  assert.match(sql, /'NYC''s Limited Edition Burgers, Ranked'/);
  assert.match(sql, /'Brooklyn Bites: The borough''s 9 best burgers'/);
  assert.doesNotMatch(sql, /tastingtable/);
});

test("an addition migration only inserts rows, skips a list already published, and checks what it added", () => {
  const sql = additionMigrationSql(data, [TASTING_TABLE]);
  assert.match(sql, /^-- adds: tastingtable-best-burgers-nyc-ranked$/m);
  // rows only: no table, column, function, view or grant changes beyond its own temporary table
  assert.doesNotMatch(sql, /create (or replace )?(function|view)|alter table|grant |revoke |create table (?!_ranker)|drop table (?!_ranker)/i);
  assert.match(sql, /create temp table _ranker_published_add/);
  assert.match(sql, /drop table _ranker_published_add;\n$/);
  // idempotent: a list whose id or link is already published is skipped; a voter id already taken inserts nothing
  assert.match(sql, /where not exists \(select 1 from ranker_private\.ranker_published p where p\.list_id = a\.list_id or p\.url = a\.url\)/);
  assert.match(sql, /on conflict \(voter_id\) do nothing/);
  // saved like the seeding's lists: active, origin published, ids and hashes from the link and the publisher
  assert.match(sql, /'active', 'published'/);
  assert.match(sql, /'\|voter\|published:' \|\| a\.url/);
  assert.match(sql, /'\|conn\|published:' \|\| a\.url/);
  assert.match(sql, /'\|net\|published:' \|\| a\.publisher/);
  // every burger a saveable key, or nothing is inserted; then the checks
  assert.match(sql, /where not exists \(select 1 from ranker_private\.ranker_keys k where k\.key = x\)\)/);
  assert.match(sql, /if v_n <> 1 then\n {4}raise exception 'expected the 1 added published list with its source/);
  assert.match(sql, /'14 Best Burgers In NYC, Ranked',\n {3}'https:\/\/www\.tastingtable\.com\/689372\/best-hamburgers-in-nyc\/', date '2023-06-13'/);
  // a seeded list, an unknown one or one named twice is refused
  assert.throws(() => additionMigrationSql(data, ["timeout-best-burgers-nyc"]), /one of the seeded lists/);
  assert.throws(() => additionMigrationSql(data, ["no-such-list"]), /has no list/);
  assert.throws(() => additionMigrationSql(data, [TASTING_TABLE, TASTING_TABLE]), /named twice/);
  assert.throws(() => additionMigrationSql(data, []), /at least one list/);
});

test("the check refuses what save_ranking would refuse, and a list that doesn't account for every entry", () => {
  const bad = (edit: (d: { lists: (List & Record<string, unknown>)[] }) => void, why: RegExp, keys?: string[]) => {
    const d = clone();
    edit(d);
    assert.throws(() => checkPublishedLists(d, keys ? { keys } : {}), why);
  };
  bad((d) => {
    d.lists[3].items = d.lists[3].items.slice(0, 2);
  }, /3 to 25 burgers/);
  bad((d) => {
    d.lists[0].items = Array.from({ length: 26 }, (_, i) => `spot-${i}`);
  }, /3 to 25 burgers/);
  bad((d) => {
    d.lists[1].items[1] = d.lists[1].items[0];
  }, /on it twice/);
  bad((d) => {
    d.lists[1].items[0] = "Raoul's";
  }, /not a menu key/);
  bad(() => {}, /is not one of the ranker's menu keys/, ["raouls-soho"]);
  bad((d) => {
    d.lists[2].names.pop();
  }, /names must name each item/);
  bad((d) => {
    d.lists[2].ranks = [...d.lists[2].ranks].reverse();
  }, /ranks must rise/);
  bad((d) => {
    d.lists[3].left_out = [];
  }, /must number 1 to 9/);
  bad((d) => {
    d.lists[4].left_out = (d.lists[4].left_out as unknown[]).slice(1);
  }, /must number 1 to 14/);
  bad((d) => {
    d.lists[0].url = "https://example.com/a'b";
  }, /plain https link/);
  bad((d) => {
    d.lists[1].id = d.lists[0].id;
  }, /used twice/);
  bad((d) => {
    d.lists[4].url = d.lists[2].url;
  }, /used twice/);
  bad((d) => {
    d.lists[0].title = "Line\nbreak";
  }, /no title/);
  bad((d) => {
    d.lists[4].added_on = "2026-09-26";
  }, /on or after seeded_on/);
  bad((d) => {
    d.lists[4].added_on = "Sept 27";
  }, /on or after seeded_on/);
});

test("a list voided later keeps its entry with a voided_on day: no migration reads it", () => {
  const voided = clone();
  voided.lists[1].voided_on = "2026-10-10";
  voided.lists[4].voided_on = "2026-10-10";
  assert.equal(checkPublishedLists(voided).length, 7);
  assert.equal(publishedMigrationSql(voided), publishedMigrationSql(data));
  assert.equal(additionMigrationSql(voided, [TASTING_TABLE]), additionMigrationSql(data, [TASTING_TABLE]));
  voided.lists[1].voided_on = "soon";
  assert.throws(() => checkPublishedLists(voided), /voided_on "soon" is not a date/);
});

test("the script: the seeding once, then explicit additions, each once; a changed file is out of sync and never re-written", () => {
  // the file as it stood with the seeding and one addition (Tasting Table's): five lists
  const five = { ...clone(), lists: clone().lists.slice(0, 5) };
  const clone5 = () => JSON.parse(JSON.stringify(five));
  const dir = mkdtempSync(join(tmpdir(), "ranker-published-"));
  const log = console.log;
  console.log = () => {};
  try {
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    const keys = [...new Set((five.lists as List[]).flatMap((l) => l.items))].sort();
    writeFileSync(join(migrations, "20260101000000_ranker_keys.sql"), keysMigrationSql(keys, null));
    const file = join(dir, "lists.json");
    const args = ["--data", file, "--dir", migrations];
    const seedOnly = clone5();
    seedOnly.lists = seededLists(seedOnly.lists);
    writeFileSync(file, JSON.stringify(seedOnly));

    // Nothing saved yet: --write seeds; --add is refused until then.
    assert.deepEqual(main(args), { inSync: false, wrote: null, lists: 4 });
    assert.throws(() => main([...args, "--add", TASTING_TABLE, "--write"]), /no seeding migration yet/);
    const seeding = main([...args, "--write"]);
    assert.ok(seeding.wrote && PUBLISHED_FILE.test(seeding.wrote.split("/").at(-1) as string));
    assert.deepEqual(main(args), { inSync: true, wrote: null, lists: 4 });

    // A list added to the file: out of sync until an addition names it; --write alone never writes a second seeding.
    writeFileSync(file, JSON.stringify(five));
    assert.deepEqual(main(args), { inSync: false, wrote: null, lists: 5 });
    assert.deepEqual(main([...args, "--write"]), { inSync: false, wrote: null, lists: 5 });
    assert.equal(readdirSync(migrations).filter((f) => PUBLISHED_FILE.test(f)).length, 1);
    assert.throws(() => main([...args, "--add", "timeout-best-burgers-nyc", "--write"]), /one of the seeded lists/);
    assert.throws(() => main([...args, "--add"]), /--add needs a list id/);
    assert.deepEqual(main([...args, "--add", TASTING_TABLE]), { inSync: false, wrote: null, lists: 5 }); // a dry run
    assert.equal(readdirSync(migrations).filter((f) => PUBLISHED_ADD_FILE.test(f)).length, 0);
    // (the next version must be after the seeding's, which the same second could reach)
    const later = readdirSync(migrations).find((f) => PUBLISHED_FILE.test(f)) as string;
    rmSync(join(migrations, later));
    writeFileSync(join(migrations, `20260101000001_ranker_published_lists.sql`), publishedMigrationSql(five));
    const addition = main([...args, "--add", TASTING_TABLE, "--write"]);
    assert.ok(addition.wrote && PUBLISHED_ADD_FILE.test(addition.wrote.split("/").at(-1) as string));
    assert.equal(readFileSync(addition.wrote as string, "utf8"), additionMigrationSql(five, [TASTING_TABLE]));
    assert.deepEqual(main(args), { inSync: true, wrote: null, lists: 5 });
    // added once: a second --add of the same list is refused
    assert.throws(() => main([...args, "--add", TASTING_TABLE, "--write"]), /already added by/);
    assert.equal(readdirSync(migrations).filter((f) => PUBLISHED_ADD_FILE.test(f)).length, 1);

    // A seeded or added list changed after its migration: out of sync, and nothing new is written.
    const changed = clone5();
    changed.lists[3].items.reverse();
    changed.lists[3].names.reverse();
    writeFileSync(file, JSON.stringify(changed));
    assert.deepEqual(main([...args, "--write"]), { inSync: false, wrote: null, lists: 5 });
    const addedChanged = clone5();
    addedChanged.lists[4].title = "Another title";
    writeFileSync(file, JSON.stringify(addedChanged));
    assert.deepEqual(main(args), { inSync: false, wrote: null, lists: 5 });
    assert.equal(readdirSync(migrations).length, 3);

    // A key the ranker doesn't accept is refused before anything is written.
    rmSync(addition.wrote as string);
    const unknown = clone5();
    unknown.lists[4].items[0] = "not-on-the-index";
    writeFileSync(file, JSON.stringify(unknown));
    assert.throws(() => main([...args, "--add", TASTING_TABLE, "--write"]), /not one of the ranker's menu keys/);
    assert.equal(existsSync(addition.wrote as string), false);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});
