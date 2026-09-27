#!/usr/bin/env node
// The published rankings seeded as People's Top 10 lists (user decision 2026-09-26/27; supabase/README.md
// "Published lists"). data/ranker_published_lists.json holds the four genuinely ranked published burger lists,
// best first, as menu keys (facts only: publisher, title, link, date, the list's own numbers and names, what was
// left out). This script checks that file and writes the one migration that saves them in the ranker's database:
// it marks where each list came from (ranker_private.ranker_lists.origin), stores each list's source
// (ranker_private.ranker_published), inserts the lists as active lists that count like a visitor's, and opens the
// public audit view public.ranker_published_lists. Apply it to the live project with the Supabase connector
// (apply_migration, name "ranker_published_lists").
//
//   node web/scripts/ranker-published-migration.mjs           # check: exit 0 when the committed migration is the file's
//   node web/scripts/ranker-published-migration.mjs --write   # write supabase/migrations/<UTC timestamp>_ranker_published_lists.sql
//
// The migration seeds once. After it is applied, a change to the lists is a new, hand-written migration (an edit
// of a list's row, or ranker_void to take one out; README "Published lists"), not a second run of this script:
// --write refuses while a seeding migration exists, and test/ranker-published.test.ts fails while the committed
// one differs from the file. No database access and no key: it reads the data file and the migrations folder.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { KEYS_FILE, MIGRATIONS_DIR, nextVersion, parseKeysMigration } from "./ranker-keys-migration.mjs";
import { ROOT } from "./snapshot-peoples-top.mjs";

export const PUBLISHED_PATH = join(ROOT, "data", "ranker_published_lists.json");
/** The seeding migration's file name: `<14-digit version>_ranker_published_lists.sql`. */
export const PUBLISHED_FILE = /^(\d{14})_ranker_published_lists\.sql$/;
const MENU_KEY = /^(chain:)?[a-z0-9-]{1,120}$/;
const LIST_ID = /^[a-z0-9-]{1,120}$/;
const URL_RE = /^https:\/\/[^\s'"\\<>]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Text that goes into a SQL literal holds no control characters. */
const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/**
 * @typedef {{ rank: number, name: string, reason: string }} LeftOut
 * @typedef {{ id: string, publisher: string, title: string, url: string, date: string, checked_on: string,
 *             length: number, items: string[], names: string[], ranks: number[], left_out: LeftOut[],
 *             notes: string[] }} PublishedList
 * @typedef {{ version: number, seeded_on: string, lists: PublishedList[] }} PublishedLists
 */

const isDate = (s) => typeof s === "string" && DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isText = (s) => typeof s === "string" && s.trim() === s && s.length > 0 && s.length <= 300 && !hasControl(s);

/**
 * Checks the data file and returns its lists. Throws on the first problem: every list needs a publisher, a title,
 * an https link, a date, and 3 to 25 distinct menu keys (a list save_ranking would accept), with the list's own
 * number and name for each, and the numbers of the kept and left-out entries together 1 to `length`.
 * @param {unknown} data
 * @param {{ keys?: string[] }} [opts] the ranker's saveable keys: when given, every item must be one
 * @returns {PublishedList[]}
 */
export function checkPublishedLists(data, opts = {}) {
  const fail = (why) => {
    throw new Error(`data/ranker_published_lists.json: ${why}`);
  };
  const d = /** @type {PublishedLists} */ (data);
  if (!d || typeof d !== "object" || d.version !== 1) fail("expected { version: 1, seeded_on, lists }");
  if (!isDate(d.seeded_on)) fail(`seeded_on ${JSON.stringify(d.seeded_on)} is not a date`);
  if (!Array.isArray(d.lists) || d.lists.length === 0) fail("no lists");
  const saveable = opts.keys ? new Set(opts.keys) : null;
  const ids = new Set();
  const urls = new Set();
  for (const l of d.lists) {
    const at = `list ${JSON.stringify(l?.id)}`;
    if (typeof l?.id !== "string" || !LIST_ID.test(l.id)) fail(`${at}: the id must be a slug`);
    if (ids.has(l.id)) fail(`${at}: the id is used twice`);
    ids.add(l.id);
    if (!isText(l.publisher)) fail(`${at}: no publisher`);
    if (!isText(l.title)) fail(`${at}: no title`);
    if (typeof l.url !== "string" || !URL_RE.test(l.url)) fail(`${at}: the url must be a plain https link`);
    if (urls.has(l.url)) fail(`${at}: the url is used twice`);
    urls.add(l.url);
    if (!isDate(l.date)) fail(`${at}: date ${JSON.stringify(l.date)} is not a date`);
    if (!isDate(l.checked_on)) fail(`${at}: checked_on ${JSON.stringify(l.checked_on)} is not a date`);
    if (!Array.isArray(l.items) || l.items.length < 3 || l.items.length > 25) fail(`${at}: a list holds 3 to 25 burgers`);
    for (const k of l.items) {
      if (typeof k !== "string" || !MENU_KEY.test(k)) fail(`${at}: not a menu key: ${JSON.stringify(k)}`);
      if (saveable && !saveable.has(k)) fail(`${at}: ${k} is not one of the ranker's menu keys`);
    }
    if (new Set(l.items).size !== l.items.length) fail(`${at}: a burger is on it twice`);
    if (!Array.isArray(l.names) || l.names.length !== l.items.length || !l.names.every(isText)) {
      fail(`${at}: names must name each item, in order`);
    }
    if (!Number.isInteger(l.length) || l.length < l.items.length) fail(`${at}: length is the list's own entry count`);
    if (!Array.isArray(l.ranks) || l.ranks.length !== l.items.length) fail(`${at}: ranks must number each item, in order`);
    if (!l.ranks.every((r, i) => Number.isInteger(r) && r >= 1 && r <= l.length && (i === 0 || r > l.ranks[i - 1]))) {
      fail(`${at}: ranks must rise from 1 to length, best first`);
    }
    if (!Array.isArray(l.left_out) || !l.left_out.every((o) => Number.isInteger(o?.rank) && isText(o.name) && isText(o.reason))) {
      fail(`${at}: each left-out entry needs its rank, name and reason`);
    }
    const all = [...l.ranks, ...l.left_out.map((o) => o.rank)].sort((a, b) => a - b);
    if (all.length !== l.length || !all.every((r, i) => r === i + 1)) {
      fail(`${at}: the kept and left-out entries must number 1 to ${l.length}, each once`);
    }
    if (!Array.isArray(l.notes) || !l.notes.every(isText)) fail(`${at}: notes must be sentences`);
  }
  return d.lists;
}

const sqlText = (s) => `'${s.replaceAll("'", "''")}'`;

/**
 * The seeding migration for these lists (deterministic: the same file gives the same bytes).
 * @param {unknown} data the data file's contents
 * @returns {string}
 */
export function publishedMigrationSql(data) {
  const lists = checkPublishedLists(data);
  const publishers = new Set(lists.map((l) => l.publisher)).size;
  const values = lists
    .map((l) =>
      [
        `    (${sqlText(l.id)}, ${sqlText(l.publisher)}, ${sqlText(l.title)},`,
        `     ${sqlText(l.url)}, date ${sqlText(l.date)},`,
        "     array[",
        l.items.map((k) => `       ${sqlText(k)}`).join(",\n"),
        "     ]::text[])",
      ].join("\n"),
    )
    .join(",\n");
  return `-- The published rankings as People's Top 10 lists (user decision 2026-09-26/27): the ${lists.length} genuinely ranked
-- published burger lists in data/ranker_published_lists.json, saved as lists that count exactly like a visitor's.
-- Written by web/scripts/ranker-published-migration.mjs from that file; supabase/README.md "Published lists".
--
-- 1. ranker_private.ranker_lists.origin marks where a list came from: 'visitor' (every list saved through
--    save_ranking, the default) or 'published'. Nothing but the audit reads it: the nightly refresh, the rate limits,
--    the one-list-per-connection rule and the owner's tools treat both alike, so no function changes.
-- 2. ranker_private.ranker_published keeps each published list's source (publisher, title, link, date).
-- 3. The lists: active, saved today (New York), so they count from tonight's refresh and reach the board with the
--    next publication (the 20-list privacy batch, as for any list). Each passes every check save_ranking makes:
--    3 to 25 distinct menu keys, every one in ranker_private.ranker_keys (the statement inserts nothing
--    otherwise, and the check at the end fails). Their ids and hashes are derived, never invented:
--    - the voter id from the list's link, hashed with the project's private salt (ranker_state.salt, never in the
--      repo): the same on every run against this database, and one nobody outside it can compute, so no visitor
--      call (save_ranking, delete_ranking) can reach these lists. It is a version-8 UUID.
--    - the connection hash from the link and the network hash from the publisher, in the visitor hashes' form
--      (salted SHA-256 of "|conn|" or "|net|" and a value) with a "published:" value no IP address can produce:
--      one connection per list, one network per publisher (The Infatuation's two lists share one), so no
--      visitor's save can replace one of them and the refresh counts the networks as for anyone.
-- 4. public.ranker_published_lists: a read-only view, open to the site's publishable key, of each published list
--    (publisher, title, link, date, how many burgers, the menu keys best first, the day it was added, its status and
--    whether it is in the last published aggregates). Never a voter id or a hash. It reads the private tables
--    through public.ranker_published_lists_rows() (security definer, like ranker_board_inputs), since the view runs
--    with the reader's rights (security_invoker).
--
-- To take a list out: ranker_private.ranker_void (README "Published lists"); never delete the rows.

-- ------------------------------------------------------------------------------------------------
-- 1. Where a list came from

alter table ranker_private.ranker_lists
  add column origin text not null default 'visitor' check (origin in ('visitor', 'published'));
comment on column ranker_private.ranker_lists.origin is
  'visitor: saved through save_ranking. published: a published ranking seeded by a migration (its source in ranker_private.ranker_published). Only the audit reads it: the refresh, the rate limits and the owner''s tools treat both alike.';

-- ------------------------------------------------------------------------------------------------
-- 2. Each published list's source

create table ranker_private.ranker_published (
  voter_id  uuid primary key references ranker_private.ranker_lists (voter_id) on delete cascade,
  list_id   text not null unique check (list_id ~ '^[a-z0-9-]{1,120}$'),
  publisher text not null check (publisher <> ''),
  title     text not null check (title <> ''),
  url       text not null unique check (url ~ '^https://'),
  list_date date not null,
  added_on  date not null
);
alter table ranker_private.ranker_published enable row level security;
revoke all on ranker_private.ranker_published from public, anon, authenticated;
comment on table ranker_private.ranker_published is
  'Patty Ladder: the source of each published ranking seeded as a list (data/ranker_published_lists.json). The list itself is its ranker_lists row (origin published).';

-- ------------------------------------------------------------------------------------------------
-- 3. The lists

with src (list_id, publisher, title, url, list_date, items) as (
  values
${values}
), hashed as (
  select src.*,
         encode(sha256(convert_to(s.salt || '|voter|published:' || src.url, 'UTF8')), 'hex') as vh,
         encode(sha256(convert_to(s.salt || '|conn|published:' || src.url, 'UTF8')), 'hex') as ip_hash,
         encode(sha256(convert_to(s.salt || '|net|published:' || src.publisher, 'UTF8')), 'hex') as net_hash
    from src cross join ranker_private.ranker_state s
), seeds as (
  -- a version-8 UUID from the first 128 bits of the voter hash (version nibble 8, variant bits 10)
  select h.*,
         overlay(overlay(substr(h.vh, 1, 32) placing '8' from 13 for 1)
                 placing substr('89ab89ab89ab89ab', strpos('0123456789abcdef', substr(h.vh, 17, 1)), 1)
                 from 17 for 1)::uuid as voter_id
    from hashed h
   -- every burger a menu key the ranker accepts, or nothing is inserted
   where not exists (select 1 from hashed h2 cross join unnest(h2.items) x
                      where not exists (select 1 from ranker_private.ranker_keys k where k.key = x))
), lists as (
  insert into ranker_private.ranker_lists (voter_id, items, saved_on, saved_at, ip_hash, net_hash, status, origin)
  select s.voter_id, s.items, (now() at time zone 'America/New_York')::date, now(), s.ip_hash, s.net_hash,
         'active', 'published'
    from seeds s
  returning voter_id, saved_on
)
insert into ranker_private.ranker_published (voter_id, list_id, publisher, title, url, list_date, added_on)
select s.voter_id, s.list_id, s.publisher, s.title, s.url, s.list_date, l.saved_on
  from seeds s join lists l on l.voter_id = s.voter_id;

-- ------------------------------------------------------------------------------------------------
-- 4. The public audit view

create or replace function public.ranker_published_lists_rows()
  returns table (publisher text, title text, url text, list_date date, burgers integer, items text[],
                 list_id text, added_on date, status text, in_board boolean)
  language sql stable security definer set search_path = '' as $$
  select p.publisher, p.title, p.url, p.list_date, cardinality(l.items), l.items, p.list_id, p.added_on, l.status,
         l.status = 'active' and l.published_items is not distinct from l.items
           and l.published_on is not distinct from l.saved_on
    from ranker_private.ranker_published p
    join ranker_private.ranker_lists l on l.voter_id = p.voter_id
   where l.origin = 'published'
   order by p.list_date desc, p.list_id;
$$;
revoke all on function public.ranker_published_lists_rows() from public, anon, authenticated;
grant execute on function public.ranker_published_lists_rows() to anon, authenticated;
comment on function public.ranker_published_lists_rows() is
  'Patty Ladder: the published rankings seeded as lists, for public.ranker_published_lists (no voter id or hash).';

create view public.ranker_published_lists with (security_invoker = true) as
select * from public.ranker_published_lists_rows();
revoke all on public.ranker_published_lists from public, anon, authenticated;
grant select on public.ranker_published_lists to anon, authenticated;
comment on view public.ranker_published_lists is
  'Patty Ladder: the published burger rankings counted as People''s Top 10 lists (publisher, title, link, date, burgers best first, status). Read-only.';

-- ------------------------------------------------------------------------------------------------
-- Checked before the migration ends: exactly these lists, saveable, one network per publisher

do $$
declare
  v_n   integer;
  v_bad text;
begin
  select count(*) into v_n from ranker_private.ranker_lists l where l.origin = 'published';
  if v_n <> ${lists.length} then
    raise exception 'expected ${lists.length} published lists, found % (is every burger in ranker_private.ranker_keys?)', v_n;
  end if;
  select count(*) into v_n from ranker_private.ranker_published p
    join ranker_private.ranker_lists l on l.voter_id = p.voter_id and l.origin = 'published' and l.status = 'active';
  if v_n <> ${lists.length} then
    raise exception 'expected ${lists.length} published lists with their source, found %', v_n;
  end if;
  select x into v_bad from ranker_private.ranker_lists l cross join unnest(l.items) x
   where l.origin = 'published' and not exists (select 1 from ranker_private.ranker_keys k where k.key = x) limit 1;
  if v_bad is not null then
    raise exception 'not one of the ranker''s menu keys: %', v_bad;
  end if;
  if exists (select 1 from ranker_private.ranker_lists l
              where l.origin = 'published'
                and (cardinality(l.items) not between 3 and 25
                     or (select count(distinct x) from unnest(l.items) x) <> cardinality(l.items))) then
    raise exception 'a published list is not 3 to 25 distinct burgers';
  end if;
  select count(distinct l.net_hash) into v_n from ranker_private.ranker_lists l where l.origin = 'published';
  if v_n <> ${publishers} then
    raise exception 'expected ${publishers} publisher networks, found %', v_n;
  end if;
  select count(distinct l.ip_hash) into v_n from ranker_private.ranker_lists l where l.origin = 'published';
  if v_n <> ${lists.length} then
    raise exception 'expected one connection per published list, found %', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
`;
}

/** The seeding migrations in the folder, oldest first. */
export function publishedMigrations(dir = MIGRATIONS_DIR) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => PUBLISHED_FILE.test(f)).sort() : [];
}

/**
 * The menu keys save_ranking accepted when a migration was written: the latest key sync before `version`
 * (or the latest one of all without it).
 * @param {string} [version]
 * @returns {{ file: string, keys: string[] } | null}
 */
export function keysBefore(version, dir = MIGRATIONS_DIR) {
  const files = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((f) => KEYS_FILE.test(f) && (!version || f.slice(0, 14) < version))
    .sort();
  const file = files.at(-1);
  return file ? { file, keys: parseKeysMigration(readFileSync(join(dir, file), "utf8")) } : null;
}

/**
 * @param {string[]} [argv]
 * @returns {{ inSync: boolean, wrote: string | null, lists: number }}
 */
export function main(argv = process.argv.slice(2)) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const dataPath = resolve(arg("--data") ?? PUBLISHED_PATH);
  const dir = resolve(arg("--dir") ?? MIGRATIONS_DIR);
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  const existing = publishedMigrations(dir);
  if (existing.length > 1) throw new Error(`more than one seeding migration: ${existing.join(", ")}`);
  if (existing.length === 1) {
    const file = existing[0];
    const keys = keysBefore(file.slice(0, 14), dir);
    if (!keys) throw new Error(`no ranker key sync before ${file}`);
    const lists = checkPublishedLists(data, { keys: keys.keys });
    const inSync = readFileSync(join(dir, file), "utf8") === publishedMigrationSql(data);
    if (inSync) {
      console.log(`✓ published lists: ${file} seeds the file's ${lists.length} lists (every burger in ${keys.file})`);
    } else {
      console.log(
        `✗ published lists: ${file} differs from data/ranker_published_lists.json. The lists are seeded once: change them ` +
          "with a hand-written migration (supabase/README.md \"Published lists\"), or put the file back.",
      );
    }
    return { inSync, wrote: null, lists: lists.length };
  }
  const keys = keysBefore(undefined, dir);
  if (!keys) throw new Error("no ranker key sync yet (ranker-keys-migration.mjs --write first)");
  const lists = checkPublishedLists(data, { keys: keys.keys });
  if (!argv.includes("--write")) {
    console.log(`✗ published lists: no seeding migration yet for the file's ${lists.length} lists. Run with --write, then apply it.`);
    return { inSync: false, wrote: null, lists: lists.length };
  }
  const file = join(dir, `${nextVersion(dir)}_ranker_published_lists.sql`);
  writeFileSync(file, publishedMigrationSql(data));
  console.log(
    `✓ published lists: wrote ${file} (${lists.length} lists; every burger in ${keys.file}). ` +
      'Apply it to the live project (apply_migration, name "ranker_published_lists").',
  );
  return { inSync: false, wrote: file, lists: lists.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { inSync, wrote } = main();
    process.exit(inSync || wrote ? 0 : 1);
  } catch (err) {
    console.error(`✗ published lists: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
