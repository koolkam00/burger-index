// The published rankings seeded as People's Top 10 lists (user decision 2026-09-26/27; supabase/README.md
// "Published lists"): data/ranker_published_lists.json holds exactly the four verified published rankings, and the
// committed seeding migration (scripts/ranker-published-migration.mjs) is the one that file gives, so the file, the
// migration and the live database (checked when it was applied) agree.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keysMigrationSql, MIGRATIONS_DIR } from "../scripts/ranker-keys-migration.mjs";
import {
  checkPublishedLists,
  keysBefore,
  main,
  PUBLISHED_FILE,
  PUBLISHED_PATH,
  publishedMigrations,
  publishedMigrationSql,
} from "../scripts/ranker-published-migration.mjs";

type List = { id: string; publisher: string; items: string[]; ranks: number[]; names: string[]; length: number };
const data = JSON.parse(readFileSync(PUBLISHED_PATH, "utf8"));
const clone = () => JSON.parse(JSON.stringify(data));

test("the published lists are the four verified rankings, and no other (user decision 2026-09-26/27)", () => {
  const lists = data.lists as List[];
  assert.deepEqual(
    lists.map((l) => [l.id, l.publisher, l.items.length]),
    [
      ["infatuation-smashburger-power-rankings", "The Infatuation", 17],
      ["infatuation-limited-edition-burgers-ranked", "The Infatuation", 9],
      ["timeout-best-burgers-nyc", "Time Out", 14],
      ["bkmag-brooklyn-9-best-burgers-2024", "Brooklyn Magazine", 5],
    ],
  );
});

test("each list is one save_ranking accepted when it was seeded: 3 to 25 distinct keys of that day's key sync", () => {
  const [file] = publishedMigrations();
  assert.ok(file && PUBLISHED_FILE.test(file), "no supabase/migrations/*_ranker_published_lists.sql");
  const keys = keysBefore(file.slice(0, 14));
  assert.ok(keys, `no ranker key sync before ${file}`);
  const lists = checkPublishedLists(data, { keys: keys.keys }) as List[];
  assert.equal(lists.length, 4);
});

test("the committed seeding migration is exactly the one the data file gives (one, never a second)", () => {
  const files = publishedMigrations();
  assert.equal(files.length, 1, `expected one seeding migration, found ${files.join(", ") || "none"}`);
  assert.equal(readFileSync(join(MIGRATIONS_DIR, files[0]), "utf8"), publishedMigrationSql(data));
});

test("the migration changes no function the refresh or the rate limits run, and the audit view has no voter id or hash", () => {
  const sql = publishedMigrationSql(data);
  const replaced = [...sql.matchAll(/create or replace function ([\w.]+)/g)].map((m) => m[1]);
  assert.deepEqual(replaced, ["public.ranker_published_lists_rows"]);
  const columns = /returns table \(([^)]*)\)/.exec(sql)?.[1] ?? "";
  assert.doesNotMatch(columns, /voter|hash/);
  assert.match(sql, /create view public\.ranker_published_lists with \(security_invoker = true\)/);
  assert.match(sql, /grant select on public\.ranker_published_lists to anon, authenticated;/);
  assert.match(sql, /revoke all on ranker_private\.ranker_published from public, anon, authenticated;/);
  // its checks count the file's lists and publishers; text is quoted
  assert.match(sql, /if v_n <> 4 then\n {4}raise exception 'expected 4 published lists/);
  assert.match(sql, /expected 3 publisher networks/);
  assert.match(sql, /'NYC''s Limited Edition Burgers, Ranked'/);
  assert.match(sql, /'Brooklyn Bites: The borough''s 9 best burgers'/);
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
    d.lists[0].url = "https://example.com/a'b";
  }, /plain https link/);
  bad((d) => {
    d.lists[1].id = d.lists[0].id;
  }, /used twice/);
  bad((d) => {
    d.lists[0].title = "Line\nbreak";
  }, /no title/);
});

test("the script: --write makes the one seeding migration, then checks it; a changed file is out of sync and never re-seeded", () => {
  const dir = mkdtempSync(join(tmpdir(), "ranker-published-"));
  const log = console.log;
  console.log = () => {};
  try {
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    const keys = [...new Set((data.lists as List[]).flatMap((l) => l.items))].sort();
    writeFileSync(join(migrations, "20260101000000_ranker_keys.sql"), keysMigrationSql(keys, null));
    const file = join(dir, "lists.json");
    writeFileSync(file, JSON.stringify(data));
    const args = ["--data", file, "--dir", migrations];
    assert.deepEqual(main(args), { inSync: false, wrote: null, lists: 4 });
    const first = main([...args, "--write"]);
    assert.ok(first.wrote && PUBLISHED_FILE.test(first.wrote.split("/").at(-1) as string));
    assert.deepEqual(main(args), { inSync: true, wrote: null, lists: 4 });
    // the lists changed after seeding: out of sync, and --write writes nothing new
    const changed = clone();
    changed.lists[3].items.reverse();
    changed.lists[3].names.reverse();
    writeFileSync(file, JSON.stringify(changed));
    assert.deepEqual(main([...args, "--write"]), { inSync: false, wrote: null, lists: 4 });
    assert.equal(readdirSync(migrations).filter((f) => PUBLISHED_FILE.test(f)).length, 1);
    // a key the ranker doesn't accept is refused before anything is written
    rmSync(first.wrote as string);
    changed.lists[3].items[0] = "not-on-the-index";
    writeFileSync(file, JSON.stringify(changed));
    assert.throws(() => main([...args, "--write"]), /not one of the ranker's menu keys/);
    assert.equal(existsSync(first.wrote as string), false);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});
