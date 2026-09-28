-- More published rankings as People's Top 10 lists (user decision 2026-09-27, "add at least one more list"): 1 more
-- genuinely ranked published burger list from data/ranker_published_lists.json, saved as a list that counts exactly like any
-- other. Written by web/scripts/ranker-published-migration.mjs --add … --write from that file; supabase/README.md
-- "Published lists".
-- adds: timeout-best-burgers-america
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
  ('timeout-best-burgers-america', 'Time Out', 'The best burgers in America to sink your teeth into',
   'https://www.timeout.com/usa/restaurants/best-burgers-in-america', date '2026-07-29',
   array[
     'red-hook-tavern-carroll-gardens',
     'hamburger-america-soho-soho',
     'deux-luxe-soho'
   ]::text[]);

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
  if v_n <> 1 then
    raise exception 'expected the 1 added published list with its source, found % (is every burger in ranker_private.ranker_keys?)', v_n;
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
