-- The published rankings as People's Top 10 lists (user decision 2026-09-26/27): the 4 genuinely ranked
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
    ('infatuation-smashburger-power-rankings', 'The Infatuation', 'The NYC Smashburger Power Rankings',
     'https://www.theinfatuation.com/new-york/guides/best-smashburgers-nyc', date '2026-08-03',
     array[
       'smashed-nyc-west-village-west-village',
       'gotham-burger-social-club-chinatown',
       'rolos-ridgewood',
       'milk-burger-mott-haven',
       'herbies-burgers-williamsburg',
       'burger-by-day-chinatown',
       'nowon-east-village',
       'butter-smashburgers-west-village',
       'chain:7th-street-burger',
       'chain:harlem-shake',
       'hamburger-america-soho-soho',
       'little-grenjai-bedford',
       'el-sazon-r-d-chinatown',
       'k-o-burger-chinatown',
       'flat-out-burger-stuyvesant-heights',
       'cubbys-clinton',
       'smacking-burger-west-village'
     ]::text[]),
    ('infatuation-limited-edition-burgers-ranked', 'The Infatuation', 'NYC''s Limited Edition Burgers, Ranked',
     'https://www.theinfatuation.com/new-york/guides/limited-edition-off-menu-burgers-ranked', date '2026-01-20',
     array[
       'raouls-soho',
       'lords-west-village',
       'sailor-fort-greene',
       'rolos-ridgewood',
       'le-dive-chinatown',
       'crevette-west-village',
       'quatorze-yorkville',
       'cozy-royale-east-williamsburg',
       'sip-and-guzzle-west-village'
     ]::text[]),
    ('timeout-best-burgers-nyc', 'Time Out', 'The 16 best burgers in NYC right now',
     'https://www.timeout.com/newyork/restaurants/best-burgers-nyc', date '2025-10-27',
     array[
       'deux-luxe-soho',
       'smacking-burger-west-village',
       'hamburger-america-soho-soho',
       'sip-and-guzzle-west-village',
       'the-long-island-bar-carroll-gardens',
       'red-hook-tavern-carroll-gardens',
       'chain:7th-street-burger',
       'minetta-tavern-west-village',
       'nowon-east-village',
       'gertrudes-prospect-heights',
       'j-g-melon-lenox-hill',
       'blue-collar-burger-greenpoint',
       'raouls-soho',
       'miladys-soho'
     ]::text[]),
    ('bkmag-brooklyn-9-best-burgers-2024', 'Brooklyn Magazine', 'Brooklyn Bites: The borough''s 9 best burgers',
     'https://www.bkmag.com/2024/09/10/brooklyn-bites-the-boroughs-9-best-burgers/', date '2024-09-10',
     array[
       'red-hook-tavern-carroll-gardens',
       'gator-greenpoint',
       'swoonys-carroll-gardens',
       'the-long-island-bar-carroll-gardens',
       'lori-jayne-at-danger-danger-bushwick-north'
     ]::text[])
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
  if v_n <> 4 then
    raise exception 'expected 4 published lists, found % (is every burger in ranker_private.ranker_keys?)', v_n;
  end if;
  select count(*) into v_n from ranker_private.ranker_published p
    join ranker_private.ranker_lists l on l.voter_id = p.voter_id and l.origin = 'published' and l.status = 'active';
  if v_n <> 4 then
    raise exception 'expected 4 published lists with their source, found %', v_n;
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
  if v_n <> 3 then
    raise exception 'expected 3 publisher networks, found %', v_n;
  end if;
  select count(distinct l.ip_hash) into v_n from ranker_private.ranker_lists l where l.origin = 'published';
  if v_n <> 4 then
    raise exception 'expected one connection per published list, found %', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
