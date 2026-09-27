#!/usr/bin/env node
// The published rankings saved as People's Top 10 lists (user decisions 2026-09-26/27; supabase/README.md
// "Published lists"). data/ranker_published_lists.json holds the genuinely ranked published burger lists, best first,
// as menu keys (facts only: publisher, title, link, date, the list's own numbers and names, what was left out). This
// script checks that file and writes the migrations that save them in the ranker's database, each list as an active
// list that counts like any other (origin 'published', its source in ranker_private.ranker_published, shown by the
// public audit view public.ranker_published_lists):
//
// - the seeding migration, <version>_ranker_published_lists.sql: the first four lists (every list in the file without
//   `added_on`), the `origin` column, the source table and the audit view. Written once and applied as
//   "ranker_published_lists" (2026-09-27); --write never writes a second one.
// - an addition migration, <version>_ranker_published_add.sql: lists added later (each with `added_on` in the file),
//   named one by one with --add, and only lists no migration saved yet. It inserts rows only (no table, function or
//   view changes) and is idempotent: a list already published (same id or link) is skipped. Applied as
//   "ranker_published_add".
//
//   node web/scripts/ranker-published-migration.mjs                          # check: exit 0 when the committed migrations are the file's
//   node web/scripts/ranker-published-migration.mjs --write                  # the seeding migration (only while there is none)
//   node web/scripts/ranker-published-migration.mjs --add <list id> --write  # an addition migration for that list (--add repeats)
//
// Changing or removing a list already saved is a hand-written migration (an edit of its row, or ranker_void; README
// "Published lists"), never a re-run: test/ranker-published.test.ts fails while a committed migration differs from the
// file. No database access and no key: it reads the data file and the migrations folder.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { KEYS_FILE, MIGRATIONS_DIR, nextVersion, parseKeysMigration } from "./ranker-keys-migration.mjs";
import { ROOT } from "./snapshot-peoples-top.mjs";

export const PUBLISHED_PATH = join(ROOT, "data", "ranker_published_lists.json");
/** The seeding migration's file name: `<14-digit version>_ranker_published_lists.sql`. */
export const PUBLISHED_FILE = /^(\d{14})_ranker_published_lists\.sql$/;
/** An addition migration's file name: `<14-digit version>_ranker_published_add.sql`. */
export const PUBLISHED_ADD_FILE = /^(\d{14})_ranker_published_add\.sql$/;
const MENU_KEY = /^(chain:)?[a-z0-9-]{1,120}$/;
const LIST_ID = /^[a-z0-9-]{1,120}$/;
const URL_RE = /^https:\/\/[^\s'"\\<>]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Text that goes into a SQL literal holds no control characters. */
const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/**
 * @typedef {{ rank: number, name: string, reason: string }} LeftOut
 * @typedef {{ id: string, publisher: string, title: string, url: string, date: string, checked_on: string,
 *             added_on?: string, voided_on?: string, length: number, items: string[], names: string[],
 *             ranks: number[], left_out: LeftOut[], notes: string[] }} PublishedList
 * @typedef {{ version: number, seeded_on: string, lists: PublishedList[] }} PublishedLists
 */

const isDate = (s) => typeof s === "string" && DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isText = (s) => typeof s === "string" && s.trim() === s && s.length > 0 && s.length <= 300 && !hasControl(s);

/**
 * Checks the data file and returns its lists. Throws on the first problem: every list needs a publisher, a title,
 * an https link, a date, and 3 to 25 distinct menu keys (a list save_ranking would accept), with the list's own
 * number and name for each, and the numbers of the kept and left-out entries together 1 to `length`. A list added after
 * the seeding carries `added_on` (the New York day its addition migration was applied); a list taken out later may
 * carry `voided_on` (the day of its void), which no migration reads.
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
    if (l.added_on !== undefined && (!isDate(l.added_on) || l.added_on < d.seeded_on)) {
      fail(`${at}: added_on ${JSON.stringify(l.added_on)} is not a day on or after seeded_on`);
    }
    if (l.voided_on !== undefined && !isDate(l.voided_on)) fail(`${at}: voided_on ${JSON.stringify(l.voided_on)} is not a date`);
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

/** The lists the seeding migration saved: every list in the file without `added_on`, in the file's order. */
export const seededLists = (/** @type {PublishedList[]} */ lists) => lists.filter((l) => l.added_on === undefined);

/** `(id, publisher, title, url, date, array[keys]::text[])` rows for a SQL VALUES list. */
const valuesSql = (/** @type {PublishedList[]} */ lists, indent) =>
  lists
    .map((l) =>
      [
        `${indent}(${sqlText(l.id)}, ${sqlText(l.publisher)}, ${sqlText(l.title)},`,
        `${indent} ${sqlText(l.url)}, date ${sqlText(l.date)},`,
        `${indent} array[`,
        l.items.map((k) => `${indent}   ${sqlText(k)}`).join(",\n"),
        `${indent} ]::text[])`,
      ].join("\n"),
    )
    .join(",\n");

/**
 * The seeding migration: the file's first lists, those without `added_on` (deterministic: the same file gives the
 * same bytes, whatever lists were added after it).
 * @param {unknown} data the data file's contents
 * @returns {string}
 */
export function publishedMigrationSql(data) {
  const lists = seededLists(checkPublishedLists(data));
  if (!lists.length) throw new Error("data/ranker_published_lists.json: no list to seed (every list has added_on)");
  const publishers = new Set(lists.map((l) => l.publisher)).size;
  const values = valuesSql(lists, "    ");
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

/**
 * An addition migration: the lists `ids` (in that order), each one the file lists with `added_on`, saved exactly as the
 * seeding saved the first four. Rows only, and idempotent: a list whose id or link is already published is skipped, and
 * the checks at the end hold while the lists are as added. Deterministic: the same file and ids give the same bytes.
 * @param {unknown} data the data file's contents
 * @param {string[]} ids the list ids it adds
 * @returns {string}
 */
export function additionMigrationSql(data, ids) {
  const all = checkPublishedLists(data);
  if (!ids.length) throw new Error("an addition migration adds at least one list");
  if (new Set(ids).size !== ids.length) throw new Error(`a list is named twice: ${ids.join(", ")}`);
  const lists = ids.map((id) => {
    const l = all.find((x) => x.id === id);
    if (!l) throw new Error(`data/ranker_published_lists.json has no list ${JSON.stringify(id)}`);
    if (l.added_on === undefined) throw new Error(`list ${JSON.stringify(id)} is one of the seeded lists (no added_on): it is never added again`);
    return l;
  });
  const n = lists.length;
  const what = n === 1 ? "list" : "lists";
  return `-- More published rankings as People's Top 10 lists (user decision 2026-09-27, "add at least one more list"): ${n} more
-- genuinely ranked published burger ${what} from data/ranker_published_lists.json, saved as ${n === 1 ? "a list that counts" : "lists that count"} exactly like any
-- other. Written by web/scripts/ranker-published-migration.mjs --add … --write from that file; supabase/README.md
-- "Published lists".
-- adds: ${ids.join(", ")}
--
-- Saved exactly as the seeding migration (<version>_ranker_published_lists.sql) saved the first four: a
-- ranker_private.ranker_lists row with origin 'published', active, saved today (New York), so it counts from tonight's
-- refresh and reaches the board with the next publication (the 20-list batch, as for any list); its source in
-- ranker_private.ranker_published; the voter id from its link and the project's private salt (a version-8 UUID no
-- visitor call can reach), the connection hash from its link and the network hash from its publisher (a publisher
-- already published shares its network). Every burger must be one of ranker_private.ranker_keys, or nothing is
-- inserted and the check at the end fails. No table, function or view changes: the refresh, the rate limits and the
-- owner's tools treat these lists like any other, and the public audit view public.ranker_published_lists shows them.
--
-- Idempotent: a list whose id or link is already a published list is skipped, so running this again inserts nothing,
-- and the checks at the end pass while the lists are as added. To take one out: ranker_private.ranker_void (README
-- "Published lists"); never delete the rows.

create temp table _ranker_published_add (
  list_id   text primary key,
  publisher text not null,
  title     text not null,
  url       text not null unique,
  list_date date not null,
  items     text[] not null
);
insert into _ranker_published_add (list_id, publisher, title, url, list_date, items) values
${valuesSql(lists, "  ")};

with hashed as (
  select a.*,
         encode(sha256(convert_to(s.salt || '|voter|published:' || a.url, 'UTF8')), 'hex') as vh,
         encode(sha256(convert_to(s.salt || '|conn|published:' || a.url, 'UTF8')), 'hex') as ip_hash,
         encode(sha256(convert_to(s.salt || '|net|published:' || a.publisher, 'UTF8')), 'hex') as net_hash
    from _ranker_published_add a cross join ranker_private.ranker_state s
   -- not yet published (the same list id or link): a second run inserts nothing
   where not exists (select 1 from ranker_private.ranker_published p where p.list_id = a.list_id or p.url = a.url)
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
  on conflict (voter_id) do nothing
  returning voter_id, saved_on
)
insert into ranker_private.ranker_published (voter_id, list_id, publisher, title, url, list_date, added_on)
select s.voter_id, s.list_id, s.publisher, s.title, s.url, s.list_date, l.saved_on
  from seeds s join lists l on l.voter_id = s.voter_id;

-- ------------------------------------------------------------------------------------------------
-- Checked before the migration ends: these lists published as the file has them, saveable, their hashes derived,
-- one network per publisher and one connection per list among all published lists

do $$
declare
  v_n    integer;
  v_m    integer;
  v_bad  text;
  v_salt text;
begin
  select count(*) into v_n
    from _ranker_published_add a
    join ranker_private.ranker_published p
      on p.list_id = a.list_id and p.url = a.url and p.publisher = a.publisher and p.title = a.title
     and p.list_date = a.list_date
    join ranker_private.ranker_lists l on l.voter_id = p.voter_id and l.origin = 'published' and l.items = a.items;
  if v_n <> ${n} then
    raise exception 'expected the ${n} added published ${what} with ${n === 1 ? "its" : "their"} source, found % (is every burger in ranker_private.ranker_keys?)', v_n;
  end if;
  select x into v_bad from _ranker_published_add a cross join unnest(a.items) x
   where not exists (select 1 from ranker_private.ranker_keys k where k.key = x) limit 1;
  if v_bad is not null then
    raise exception 'not one of the ranker''s menu keys: %', v_bad;
  end if;
  if exists (select 1 from _ranker_published_add a
              where cardinality(a.items) not between 3 and 25
                 or (select count(distinct x) from unnest(a.items) x) <> cardinality(a.items)) then
    raise exception 'an added list is not 3 to 25 distinct burgers';
  end if;
  select s.salt into v_salt from ranker_private.ranker_state s;
  if exists (select 1 from _ranker_published_add a
               join ranker_private.ranker_published p on p.list_id = a.list_id
               join ranker_private.ranker_lists l on l.voter_id = p.voter_id
              where (l.ip_hash is not null
                     and l.ip_hash <> encode(sha256(convert_to(v_salt || '|conn|published:' || a.url, 'UTF8')), 'hex'))
                 or (l.net_hash is not null
                     and l.net_hash <> encode(sha256(convert_to(v_salt || '|net|published:' || a.publisher, 'UTF8')), 'hex'))) then
    raise exception 'an added list''s hashes are not its link''s and its publisher''s';
  end if;
  select count(distinct l.net_hash), count(distinct p.publisher) into v_n, v_m
    from ranker_private.ranker_lists l join ranker_private.ranker_published p on p.voter_id = l.voter_id
   where l.origin = 'published' and l.net_hash is not null;
  if v_n <> v_m then
    raise exception 'published lists: % networks for % publishers', v_n, v_m;
  end if;
  select count(distinct l.ip_hash), count(*) into v_n, v_m
    from ranker_private.ranker_lists l where l.origin = 'published' and l.ip_hash is not null;
  if v_n <> v_m then
    raise exception 'published lists: % connections for % lists', v_n, v_m;
  end if;
end $$;

drop table _ranker_published_add;
`;
}

/** The seeding migrations in the folder, oldest first. */
export function publishedMigrations(dir = MIGRATIONS_DIR) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => PUBLISHED_FILE.test(f)).sort() : [];
}

/** The ids an addition migration adds (its `-- adds:` line). */
export function parseAdditionIds(sql) {
  const m = /^-- adds: (.+)$/m.exec(sql);
  return m ? m[1].split(", ") : [];
}

/**
 * The addition migrations in the folder, oldest first, with the list ids each adds.
 * @returns {{ file: string, ids: string[] }[]}
 */
export function additionMigrations(dir = MIGRATIONS_DIR) {
  return (existsSync(dir) ? readdirSync(dir).filter((f) => PUBLISHED_ADD_FILE.test(f)).sort() : []).map((file) => ({
    file,
    ids: parseAdditionIds(readFileSync(join(dir, file), "utf8")),
  }));
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

/** Every list in `lists` whose burgers are all keys of the latest key sync before `version`, or throws. */
function checkKeys(data, lists, version, dir) {
  const keys = keysBefore(version, dir);
  if (!keys) throw new Error(version ? `no ranker key sync before ${version}` : "no ranker key sync yet (ranker-keys-migration.mjs --write first)");
  const ids = new Set(lists.map((l) => l.id));
  const only = { ...(/** @type {object} */ (data)), lists: checkPublishedLists(data).filter((l) => ids.has(l.id)) };
  if (only.lists.length) checkPublishedLists(only, { keys: keys.keys });
  return keys;
}

/**
 * @param {string[]} [argv]
 * @returns {{ inSync: boolean, wrote: string | null, lists: number }}
 */
export function main(argv = process.argv.slice(2)) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const adds = argv.flatMap((a, i) => (a === "--add" ? [argv[i + 1]] : []));
  if (adds.some((id) => !id || id.startsWith("--"))) throw new Error("--add needs a list id");
  const dataPath = resolve(arg("--data") ?? PUBLISHED_PATH);
  const dir = resolve(arg("--dir") ?? MIGRATIONS_DIR);
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  const lists = checkPublishedLists(data);
  const seeded = seededLists(lists);
  const existing = publishedMigrations(dir);
  if (existing.length > 1) throw new Error(`more than one seeding migration: ${existing.join(", ")}`);

  if (existing.length === 0) {
    // Nothing saved yet: the seeding migration comes first.
    if (adds.length) throw new Error("no seeding migration yet: the first lists are seeded with --write, not added");
    if (seeded.length !== lists.length) throw new Error("a list has added_on, but nothing is seeded yet");
    const keys = checkKeys(data, lists, undefined, dir);
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

  // The seeding migration: the file's lists without added_on, byte for byte.
  const seedFile = existing[0];
  const seedKeys = checkKeys(data, seeded, seedFile.slice(0, 14), dir);
  const problems = [];
  if (readFileSync(join(dir, seedFile), "utf8") !== publishedMigrationSql(data)) {
    problems.push(
      `${seedFile} differs from the file's seeded lists (those without added_on). The lists are seeded once: change them ` +
        'with a hand-written migration (supabase/README.md "Published lists"), or put the file back.',
    );
  }
  // Each addition migration: the lists it names, byte for byte; each list added by one migration only.
  const additions = additionMigrations(dir);
  const addedBy = new Map();
  for (const { file, ids } of additions) {
    if (!ids.length) throw new Error(`${file} names no list (no "-- adds:" line)`);
    for (const id of ids) {
      if (addedBy.has(id)) throw new Error(`list ${id} is added by both ${addedBy.get(id)} and ${file}`);
      addedBy.set(id, file);
    }
    const sql = additionMigrationSql(data, ids);
    checkKeys(data, lists.filter((l) => ids.includes(l.id)), file.slice(0, 14), dir);
    if (readFileSync(join(dir, file), "utf8") !== sql) {
      problems.push(`${file} differs from the file's ${ids.join(", ")}: change an added list with a hand-written migration, or put the file back.`);
    }
  }
  const pending = lists.filter((l) => l.added_on !== undefined && !addedBy.has(l.id));

  if (adds.length) {
    if (problems.length) throw new Error(`fix the committed migrations first: ${problems.join(" ")}`);
    for (const id of adds) {
      if (addedBy.has(id)) throw new Error(`list ${id} is already added by ${addedBy.get(id)}`);
    }
    const sql = additionMigrationSql(data, adds); // refuses unknown, seeded or repeated ids
    const keys = checkKeys(data, lists.filter((l) => adds.includes(l.id)), undefined, dir);
    if (!argv.includes("--write")) {
      console.log(`✗ published lists: ${adds.join(", ")} not added yet (every burger in ${keys.file}). Run with --write, then apply it.`);
      return { inSync: false, wrote: null, lists: lists.length };
    }
    const file = join(dir, `${nextVersion(dir)}_ranker_published_add.sql`);
    writeFileSync(file, sql);
    console.log(
      `✓ published lists: wrote ${file} (adds ${adds.join(", ")}; every burger in ${keys.file}). ` +
        'Apply it to the live project (apply_migration, name "ranker_published_add").',
    );
    return { inSync: false, wrote: file, lists: lists.length };
  }

  if (pending.length) {
    problems.push(`not yet added: ${pending.map((l) => l.id).join(", ")} (run with --add <id> --write, then apply it).`);
  }
  if (problems.length) {
    for (const p of problems) console.log(`✗ published lists: ${p}`);
    return { inSync: false, wrote: null, lists: lists.length };
  }
  console.log(
    `✓ published lists: ${seedFile} seeds ${seeded.length} lists (every burger in ${seedKeys.file})` +
      (additions.length ? `; ${additions.map((a) => `${a.file} adds ${a.ids.length}`).join(", ")}` : "") +
      ` (${lists.length} in all)`,
  );
  return { inSync: true, wrote: null, lists: lists.length };
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
