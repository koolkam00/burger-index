-- The Patty Ladder, hardening after the security and algorithm review (2026-09-26). Applied on top of
-- patty_ladder and patty_ladder_fast_pairs; neither is edited. What changes:
--
-- 1. Per-save-day counts are private (review PL-1). public.ranker_daily and public.ranker_days showed, for
--    every save day, how many counted lists named each burger. A past day's counts change only when one of
--    its lists is edited, deleted, replaced or voided, so two publications side by side showed exactly which
--    burgers a changed list named, however many other lists changed in the same batch. Both tables move to
--    ranker_private (not exposed by the API, RLS on, no grants): the owner keeps them for audits, and the
--    public ranker_surges still covers every damped day. They are still written at each publication.
-- 2. Only the dataset's menu keys can be saved (PL-2; FINAL.md section 6). ranker_private.ranker_keys holds
--    every distinct priced menu of data/burger_index.json, synced by a generated migration
--    (web/scripts/ranker-keys-migration.mjs calls ranker_sync_keys); save_ranking refuses any other key with
--    the existing 'unknown_burger' hint. Made-up keys can no longer grow the public aggregates. A key that
--    leaves the dataset stays in the lists that hold it and in the fit, as FINAL.md 9 says; new saves can't
--    include it.
-- 3. Saves from one connection run one after another (PL-4): save_ranking takes a transaction advisory lock
--    on the connection hash before it reads or replaces anything, so two saves at the same moment (even on
--    either side of an hour boundary, where they share no rate-limit row) can't both stay active.
-- 4. The board's input is built once per publication (PL-5). ranker_rebuild stores the JSON that
--    rpc/ranker_board_inputs returns (ranker_private.ranker_inputs) when it publishes, and ranker_hold /
--    ranker_unhold rebuild it so a hold still reaches the next board; the RPC (now SECURITY DEFINER, since the
--    store is private) returns the stored value instead of aggregating on every anonymous call. Same format,
--    same bytes.
-- 5. A void logs how many of its lists were in the last published aggregates (F2), the only lists the daily
--    job's 20%-drop guard should treat as explained; ranker_void still returns how many lists it voided.

-- ------------------------------------------------------------------------------------------------
-- 1. ranker_daily and ranker_days leave the public schema

drop policy if exists "anyone reads the ranker aggregates" on public.ranker_daily;
drop policy if exists "anyone reads the ranker aggregates" on public.ranker_days;
revoke all on public.ranker_daily from public, anon, authenticated;
revoke all on public.ranker_days from public, anon, authenticated;
alter table public.ranker_daily set schema ranker_private;
alter table public.ranker_days set schema ranker_private;
alter table ranker_private.ranker_daily enable row level security;
alter table ranker_private.ranker_days enable row level security;
revoke all on ranker_private.ranker_daily from public, anon, authenticated;
revoke all on ranker_private.ranker_days from public, anon, authenticated;
comment on table ranker_private.ranker_daily is
  'Patty Ladder, owner audit only: counted lists naming each burger per save day at the last publication (before the duplicate collapse). Private: diffing it between publications showed which burgers a changed list named.';
comment on table ranker_private.ranker_days is
  'Patty Ladder, owner audit only: counted lists per save day at the last publication (before the duplicate collapse).';

-- ------------------------------------------------------------------------------------------------
-- 2. The menu keys a list may hold

create table ranker_private.ranker_keys (
  key      text collate "C" primary key check (key ~ '^(chain:)?[a-z0-9-]{1,120}$'),
  added_on date not null default (now() at time zone 'America/New_York')::date
);
alter table ranker_private.ranker_keys enable row level security;
revoke all on ranker_private.ranker_keys from public, anon, authenticated;
comment on table ranker_private.ranker_keys is
  'Patty Ladder: the menu keys save_ranking accepts (every distinct priced menu of data/burger_index.json), set by ranker_sync_keys from a generated migration.';

-- Makes ranker_keys exactly p_keys (the dataset's menu keys). Returns how many keys there are and how many
-- were added and removed. Lists already saved keep every key they hold.
create or replace function ranker_private.ranker_sync_keys(p_keys text[])
  returns jsonb language plpgsql set search_path = '' as $$
declare
  v_added   integer;
  v_removed integer;
  v_total   integer;
begin
  if p_keys is null or coalesce(array_ndims(p_keys), 0) <> 1 or cardinality(p_keys) = 0 then
    raise exception 'ranker_sync_keys needs the dataset''s menu keys (got none)';
  end if;
  if exists (select 1 from unnest(p_keys) x where x is null or x !~ '^(chain:)?[a-z0-9-]{1,120}$') then
    raise exception 'ranker_sync_keys: not a menu key: %',
      (select x from unnest(p_keys) x where x is null or x !~ '^(chain:)?[a-z0-9-]{1,120}$' limit 1);
  end if;
  delete from ranker_private.ranker_keys k where not (k.key = any (p_keys));
  get diagnostics v_removed = row_count;
  insert into ranker_private.ranker_keys (key)
  select distinct x from unnest(p_keys) x
  on conflict (key) do nothing;
  get diagnostics v_added = row_count;
  select count(*) into v_total from ranker_private.ranker_keys;
  return jsonb_build_object('keys', v_total, 'added', v_added, 'removed', v_removed);
end $$;

-- ------------------------------------------------------------------------------------------------
-- 2 and 3. save_ranking: dataset keys only, and one save at a time per connection

create or replace function public.save_ranking(p_voter uuid, p_items text[])
  returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now   timestamptz := now();
  v_today date := (v_now at time zone 'America/New_York')::date;
  v_day0  timestamptz := (v_today::timestamp at time zone 'America/New_York');
  v_n     integer := coalesce(cardinality(p_items), 0);
  v_items text[];
  v_ip    text;
  v_net   text;
  v_row   ranker_private.ranker_lists%rowtype;
  v_found boolean;
begin
  if p_voter is null then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023', hint = 'missing_voter';
  end if;
  if coalesce(array_ndims(p_items), 1) <> 1 then
    raise exception 'That list doesn''t look right. Reload the page and try again.' using errcode = '22023', hint = 'list_invalid';
  end if;
  if v_n < 3 then
    raise exception 'Pick at least 3 burgers.' using errcode = '22023', hint = 'list_too_short';
  end if;
  if v_n > 25 then
    raise exception 'A list holds at most 25 burgers.' using errcode = '22023', hint = 'list_too_long';
  end if;
  -- every key a menu the Burger Index lists now (FINAL.md section 6)
  if exists (select 1 from unnest(p_items) x
              where x is null or x !~ '^(chain:)?[a-z0-9-]{1,120}$'
                 or not exists (select 1 from ranker_private.ranker_keys k where k.key = x)) then
    raise exception 'One of those burgers isn''t on the Burger Index.' using errcode = '22023', hint = 'unknown_burger';
  end if;
  if (select count(distinct x) from unnest(p_items) x) <> v_n then
    raise exception 'Each burger can be on your list only once.' using errcode = '22023', hint = 'duplicate_burger';
  end if;
  v_items := array(select u.x from unnest(p_items) with ordinality as u(x, o) order by u.o);

  select h.ip_hash, h.net_hash into v_ip, v_net from ranker_private.client_hashes() h;
  -- One save at a time per connection: the replacement below must see every other save from it.
  perform pg_advisory_xact_lock(hashtext('ranker-conn:' || v_ip));

  perform ranker_private.rate_hit('conn:' || v_ip, date_trunc('hour', v_now), 20, 'rate_connection',
    'Lots of lists were saved from this connection in the last hour. Try again later.');
  perform ranker_private.rate_hit('voter:' || p_voter::text, v_day0, 10, 'rate_voter',
    'You''ve saved your list a lot today. Try again tomorrow.');

  select * into v_row from ranker_private.ranker_lists l where l.voter_id = p_voter for update;
  v_found := found;
  if not v_found then
    perform ranker_private.rate_hit('net:' || v_net, v_day0, 30, 'rate_network',
      'Lots of new lists came from this network today. Try again tomorrow.');
  end if;

  -- A voided list stays void: its owner sees the new version, which never counts and replaces nothing.
  if v_found and v_row.status = 'void' then
    update ranker_private.ranker_lists l
       set items = v_items, saved_on = v_today, saved_at = v_now, updated_at = v_now
     where l.voter_id = p_voter;
    return jsonb_build_object('status', 'void', 'saved_on', v_today, 'counts_from', null);
  end if;

  -- The same list saved again from the same connection changes nothing (not even its day).
  if v_found and v_row.status = 'active' and v_row.items = v_items and v_row.ip_hash is not distinct from v_ip then
    return jsonb_build_object('status', 'active', 'saved_on', v_row.saved_on, 'counts_from', v_row.saved_on + 1);
  end if;

  -- One list per connection: the latest save wins.
  update ranker_private.ranker_lists l
     set status = 'replaced', counted_items = null, counted_on = null, counted_at = null,
         net_hash = null, updated_at = v_now
   where l.ip_hash = v_ip and l.status = 'active' and l.voter_id <> p_voter and l.saved_on >= v_today - 30;

  insert into ranker_private.ranker_lists as l (voter_id, items, saved_on, saved_at, ip_hash, net_hash, status)
  values (p_voter, v_items, v_today, v_now, v_ip, v_net, 'active')
  on conflict (voter_id) do update
    set items = excluded.items, saved_on = excluded.saved_on, saved_at = excluded.saved_at,
        ip_hash = excluded.ip_hash, net_hash = excluded.net_hash, status = 'active', updated_at = excluded.saved_at,
        -- an edit keeps its previous version counting until the refresh; a list coming back doesn't
        counted_items = case when l.status = 'active' then l.counted_items end,
        counted_on = case when l.status = 'active' then l.counted_on end,
        counted_at = case when l.status = 'active' then l.counted_at end;

  return jsonb_build_object('status', 'active', 'saved_on', v_today, 'counts_from', v_today + 1);
end $$;

-- ------------------------------------------------------------------------------------------------
-- 4. The board's input, stored once per publication

create table ranker_private.ranker_inputs (
  id       boolean     primary key default true check (id),
  as_of    date        not null,
  inputs   json        not null,
  built_at timestamptz not null default now()
);
alter table ranker_private.ranker_inputs enable row level security;
revoke all on ranker_private.ranker_inputs from public, anon, authenticated;
comment on table ranker_private.ranker_inputs is
  'Patty Ladder: the latest publication as rpc/ranker_board_inputs returns it (built by ranker_store_inputs when the aggregates are published, a hold is set or lifted).';

-- Builds the board's input from the public aggregates (the latest ranker_meta row, ranker_items, ranker_pairs)
-- and stores it: items sorted by key ("C" order, as JavaScript compares strings), pairs [i, j, w_ab, w_ba, q]
-- with i < j indexes into items, floats printed exactly (shortest round-trip form), times in UTC. Nothing is
-- stored before the first publication.
create or replace function ranker_private.ranker_store_inputs()
  returns void language plpgsql set search_path = '' set extra_float_digits = 3 set timezone = 'UTC' as $$
begin
  delete from ranker_private.ranker_inputs;
  insert into ranker_private.ranker_inputs (id, as_of, inputs, built_at)
  with m as (
    select * from public.ranker_meta order by as_of desc limit 1
  ), it as (
    select i.*, (row_number() over (order by i.key) - 1)::integer as ix from public.ranker_items i
  )
  select true, m.as_of,
         json_build_object(
           'format', 'patty-ladder-inputs/1',
           'method', m.params_version,
           'as_of', m.as_of,
           'total_lists', m.total_lists,
           'counted_lists', m.counted_lists,
           'weighted_lists', m.weighted_lists,
           'changed_since_last', m.changed_since_last,
           'refreshed_at', m.refreshed_at,
           'items', coalesce((select json_agg(json_build_object(
                                 'key', it.key, 'lists', it.lists, 'weighted', it.weighted, 'firsts', it.firsts,
                                 'networks', it.networks, 'surging', it.surging,
                                 'surge_support', it.surge_support, 'held', it.held) order by it.ix)
                                from it), '[]'::json),
           'pairs', coalesce((select json_agg(json_build_array(ia.ix, ib.ix, p.w_ab, p.w_ba, p.q) order by ia.ix, ib.ix)
                                from public.ranker_pairs p
                                join it ia on ia.key = p.a
                                join it ib on ib.key = p.b), '[]'::json)),
         now()
    from m;
end $$;

-- The board's input in one call, for the daily job's GET /rest/v1/rpc/ranker_board_inputs: the stored
-- latest publication, or null before the first. Security definer: the store is private.
create or replace function public.ranker_board_inputs()
  returns json language sql stable security definer set search_path = '' as $$
  select s.inputs from ranker_private.ranker_inputs s;
$$;
revoke all on function public.ranker_board_inputs() from public;
grant execute on function public.ranker_board_inputs() to anon, authenticated;

-- A hold or unhold changes ranker_items.held at once and, from here, the stored input with it.
create or replace function ranker_private.ranker_hold(p_key text)
  returns boolean language plpgsql set search_path = '' as $$
begin
  if p_key is null or p_key !~ '^(chain:)?[a-z0-9-]{1,120}$' then
    raise exception 'not a menu key: %', p_key;
  end if;
  insert into ranker_private.ranker_holds (key, since)
  values (p_key, (now() at time zone 'America/New_York')::date)
  on conflict (key) do nothing;
  if not found then
    return false;
  end if;
  update public.ranker_items i set held = true where i.key = p_key;
  if found then
    perform ranker_private.ranker_store_inputs();
  end if;
  insert into public.ranker_actions (day, key, action, count)
  values ((now() at time zone 'America/New_York')::date, p_key, 'hold', 1);
  return true;
end $$;

create or replace function ranker_private.ranker_unhold(p_key text)
  returns boolean language plpgsql set search_path = '' as $$
begin
  delete from ranker_private.ranker_holds h where h.key = p_key;
  if not found then
    return false;
  end if;
  update public.ranker_items i set held = false where i.key = p_key;
  if found then
    perform ranker_private.ranker_store_inputs();
  end if;
  insert into public.ranker_actions (day, key, action, count)
  values ((now() at time zone 'America/New_York')::date, p_key, 'unhold', 1);
  return true;
end $$;

-- ------------------------------------------------------------------------------------------------
-- 5. A void logs the lists it took out of the published aggregates

create or replace function ranker_private.ranker_void(p_voter_ids uuid[])
  returns integer language plpgsql set search_path = '' as $$
declare
  v_n   integer;
  v_pub integer;
begin
  -- The void leaves published_items alone (the next publication clears it), so the returned value is
  -- whether the list was in the last published aggregates.
  with u as (
    update ranker_private.ranker_lists l
       set status = 'void', counted_items = null, counted_on = null, counted_at = null,
           ip_hash = null, net_hash = null, updated_at = now()
     where l.voter_id = any (p_voter_ids) and l.status <> 'void'
    returning l.published_items is not null as published
  )
  select count(*), count(*) filter (where u.published) into v_n, v_pub from u;
  if v_n > 0 then
    insert into public.ranker_actions (day, key, action, count)
    values ((now() at time zone 'America/New_York')::date, null, 'void', v_pub);
  end if;
  return v_n;
end $$;

-- ------------------------------------------------------------------------------------------------
-- 1 and 4. The nightly rebuild: the per-day counts go to ranker_private, and the board's input is stored
-- when the aggregates are published. Otherwise as in patty_ladder_fast_pairs.

create or replace function ranker_private.ranker_rebuild(p_as_of date)
  returns jsonb language plpgsql set search_path = '' set work_mem = '32MB' as $$
declare
  v_epoch    constant date := date '2000-01-01';
  v_today    date := (now() at time zone 'America/New_York')::date;
  v_asn      integer;
  v_last     date;
  v_counted  integer;
  v_fit      integer;
  v_weighted double precision;
  v_changed  integer;
  v_publish  boolean;
  v_result   jsonb;
begin
  if p_as_of is null or p_as_of >= v_today then
    raise exception 'as_of must be a New York date before today (got %)', p_as_of;
  end if;
  perform pg_advisory_xact_lock(hashtext('ranker_private.ranker_rebuild'));
  select max(m.as_of) into v_last from public.ranker_meta m;
  if v_last is not null and p_as_of < v_last then
    raise exception 'as_of % is before the last published day %', p_as_of, v_last;
  end if;
  v_asn := p_as_of - v_epoch;

  -- 1. The version each list counts: its last save through as_of (an edit made after as_of waits).
  update ranker_private.ranker_lists l
     set counted_items = l.items, counted_on = l.saved_on, counted_at = l.saved_at
   where l.status = 'active' and l.saved_on <= p_as_of
     and (l.counted_items is distinct from l.items or l.counted_on is distinct from l.saved_on
          or l.counted_at is distinct from l.saved_at);

  -- Connection hashes last 30 days after the last save; network hashes only while a list is active.
  update ranker_private.ranker_lists l set ip_hash = null
   where l.ip_hash is not null and l.saved_on < p_as_of + 1 - 30;
  update ranker_private.ranker_lists l set net_hash = null
   where l.net_hash is not null and l.status <> 'active';
  delete from ranker_private.ranker_rate r where r.window_start < now() - interval '2 days';

  -- 2. The counted lists (active; replaced, deleted and void lists are out), one snapshot for every
  --    step below. Days are integers (days since 2000-01-01) for the window frames.
  drop table if exists pg_temp._rk_c, pg_temp._rk_keys, pg_temp._rk_pl, pg_temp._rk_w, pg_temp._rk_d, pg_temp._rk_kd,
                       pg_temp._rk_dt, pg_temp._rk_kw, pg_temp._rk_sf, pg_temp._rk_f, pg_temp._rk_k, pg_temp._rk_items;
  create temporary table _rk_c (
    voter_id uuid primary key, items text[] not null, k integer not null, dn integer not null,
    saved_at timestamptz not null, net text not null, published_items text[], published_on date
  ) on commit drop;
  insert into pg_temp._rk_c
  select l.voter_id, l.counted_items, cardinality(l.counted_items), l.counted_on - v_epoch, l.counted_at,
         coalesce(l.net_hash, 'list:' || l.voter_id::text), l.published_items, l.published_on
    from ranker_private.ranker_lists l
   where l.status = 'active' and l.counted_items is not null and l.counted_on <= p_as_of;
  select count(*) into v_counted from pg_temp._rk_c;

  -- Lists whose counted version differs from the last publication, and published lists now gone.
  select (select count(*) from pg_temp._rk_c c
           where c.published_items is distinct from c.items or c.published_on is distinct from v_epoch + c.dn)
       + (select count(*) from ranker_private.ranker_lists l
           where l.published_items is not null
             and not exists (select 1 from pg_temp._rk_c c where c.voter_id = l.voter_id))
    into v_changed;

  -- Every key named, numbered in "C" order (comparing two ids compares their keys), and each list's
  -- placements. The pairs are summed over the ids: grouping on integers keeps it in memory.
  create temporary table _rk_keys (id integer primary key, key text collate "C" not null unique) on commit drop;
  insert into pg_temp._rk_keys
  select (row_number() over (order by x.key) - 1)::integer, x.key
    from (select distinct u.key::text collate "C" as key
            from pg_temp._rk_c c cross join lateral unnest(c.items) as u(key)) x;

  create temporary table _rk_pl (
    voter_id uuid not null, k integer not null, dn integer not null, key text collate "C" not null,
    kid integer not null, p integer not null
  ) on commit drop;
  insert into pg_temp._rk_pl
  select c.voter_id, c.k, c.dn, u.key, kk.id, u.p
    from pg_temp._rk_c c cross join lateral unnest(c.items) with ordinality as u(key, p)
    join pg_temp._rk_keys kk on kk.key = u.key;
  create index on pg_temp._rk_pl (voter_id);
  create index on pg_temp._rk_pl (key, dn);
  analyze pg_temp._rk_c;
  analyze pg_temp._rk_pl;

  -- 3. Surge damping (FINAL.md 3.3, sim.py final_surge), from every counted list before the
  --    duplicate collapse. For burger i and save day d: window d-6..d; share s = (lists naming i saved
  --    before the window + 1) / (all lists saved before it + 1); T7 = max(5, 3 N7 s), T1 = max(3, 3 N1 s);
  --    factor = the smaller of min(1, (T + sqrt(n - T)) / n) over the windows with n > T; 1 until 500
  --    lists precede the window, on days without lists, and where the owner cleared (i, d).
  create temporary table _rk_d (dn integer primary key, n integer not null) on commit drop;
  insert into pg_temp._rk_d select c.dn, count(*) from pg_temp._rk_c c group by c.dn;

  create temporary table _rk_kd (key text collate "C" not null, dn integer not null, n integer not null,
                                 primary key (key, dn)) on commit drop;
  insert into pg_temp._rk_kd select p.key, p.dn, count(*) from pg_temp._rk_pl p group by p.key, p.dn;

  create temporary table _rk_dt (dn integer primary key, n1 double precision not null,
                                 n7 double precision not null, nb double precision not null) on commit drop;
  insert into pg_temp._rk_dt
  select dd.dn,
         coalesce((select sum(x.n) from pg_temp._rk_d x where x.dn = dd.dn), 0),
         coalesce((select sum(x.n) from pg_temp._rk_d x where x.dn between dd.dn - 6 and dd.dn), 0),
         coalesce((select sum(x.n) from pg_temp._rk_d x where x.dn <= dd.dn - 7), 0)
    from (select d.dn from pg_temp._rk_d d union select v_asn) dd;

  -- per (burger, day it was named), plus (burger, as_of) for every burger named in as_of's window,
  -- so a burger can be surging on as_of through its week count alone
  create temporary table _rk_kw (key text collate "C" not null, dn integer not null, n1 double precision not null,
                                 n7 double precision not null, kb double precision not null) on commit drop;
  insert into pg_temp._rk_kw
  with r as (
    select kd.key, kd.dn, kd.n from pg_temp._rk_kd kd
    union all
    select distinct kd.key, v_asn, 0 from pg_temp._rk_kd kd
     where kd.dn between v_asn - 6 and v_asn - 1
       and not exists (select 1 from pg_temp._rk_kd y where y.key = kd.key and y.dn = v_asn)
  )
  select r.key, r.dn, r.n,
         sum(r.n) over (partition by r.key order by r.dn range between 6 preceding and current row),
         coalesce(sum(r.n) over (partition by r.key order by r.dn range between unbounded preceding and 7 preceding), 0)
    from r;

  create temporary table _rk_sf (
    key text collate "C" not null, dn integer not null, n1 double precision not null, n7 double precision not null,
    tot1 double precision not null, tot7 double precision not null, share double precision not null,
    t1 double precision not null, t7 double precision not null, factor double precision not null,
    cleared boolean not null, primary key (key, dn)
  ) on commit drop;
  insert into pg_temp._rk_sf
  select w.key, w.dn, w.n1, w.n7, t.n1, t.n7, sh.share, th.t1, th.t7,
         case when t.nb >= 500 then least(
           case when w.n7 > th.t7 then least(1::double precision, (th.t7 + sqrt(w.n7 - th.t7)) / w.n7) else 1 end,
           case when w.n1 > th.t1 then least(1::double precision, (th.t1 + sqrt(w.n1 - th.t1)) / w.n1) else 1 end)
         else 1 end,
         exists (select 1 from ranker_private.ranker_clears cl
                  where cl.key = w.key and v_epoch + w.dn between cl.from_day and cl.to_day)
    from pg_temp._rk_kw w
    join pg_temp._rk_dt t on t.dn = w.dn
    cross join lateral (select (w.kb + 1) / (t.nb + 1) as share) sh
    cross join lateral (select greatest(3::double precision, 3 * t.n1 * sh.share) as t1,
                               greatest(5::double precision, 3 * t.n7 * sh.share) as t7) th
   where t.n1 > 0;

  -- a list's weight f = the smallest factor among its burgers on its save day (a cleared one counts 1)
  create temporary table _rk_f (voter_id uuid primary key, f double precision not null) on commit drop;
  insert into pg_temp._rk_f
  select p.voter_id, min(case when s.cleared then 1 else coalesce(s.factor, 1) end)
    from pg_temp._rk_pl p left join pg_temp._rk_sf s on s.key = p.key and s.dn = p.dn
   group by p.voter_id;

  -- 4. The duplicate collapse: identical ordered lists of 5+ burgers count once in the fit, the
  --    earliest save. (The surge counts above saw every copy.)
  create temporary table _rk_k (voter_id uuid primary key, k integer not null, net text not null,
                                f double precision not null) on commit drop;
  insert into pg_temp._rk_k
  select c.voter_id, c.k, c.net, f.f
    from (select c0.*, row_number() over (partition by c0.items order by c0.saved_at, c0.voter_id) as rn
            from pg_temp._rk_c c0) c
    join pg_temp._rk_f f on f.voter_id = c.voter_id
   where c.k < 5 or c.rn = 1;
  analyze pg_temp._rk_k;
  select count(*), coalesce(sum(k.f), 0) into v_fit, v_weighted from pg_temp._rk_k k;

  -- 5. Per burger: lists, weighted = sum f, #1s, networks, surge support (fit lists naming it in their
  --    top half, 2p <= k + 1, saved on a day it was damped and not cleared), surging on as_of.
  create temporary table _rk_items (
    key text collate "C" primary key, lists integer not null, counted_lists integer not null,
    weighted double precision not null, firsts integer not null, networks integer not null,
    surging boolean not null, surge_support integer not null
  ) on commit drop;
  insert into pg_temp._rk_items
  with fit as (
    select p.key, count(*) as lists, sum(k.f) as weighted, count(*) filter (where p.p = 1) as firsts,
           count(distinct k.net) as networks,
           count(*) filter (where 2 * p.p <= p.k + 1 and s.factor < 1 and not s.cleared) as surge_support
      from pg_temp._rk_k k
      join pg_temp._rk_pl p on p.voter_id = k.voter_id
      left join pg_temp._rk_sf s on s.key = p.key and s.dn = p.dn
     group by p.key
  ), allc as (
    select p.key, count(*) as n from pg_temp._rk_pl p group by p.key
  )
  select fit.key, fit.lists, allc.n, fit.weighted, fit.firsts, fit.networks,
         exists (select 1 from pg_temp._rk_sf s where s.key = fit.key and s.dn = v_asn and s.factor < 1 and not s.cleared),
         fit.surge_support
    from fit join allc on allc.key = fit.key;

  -- The owner's review data, every night.
  delete from ranker_private.ranker_flags;
  insert into ranker_private.ranker_flags (key, as_of, lists, counted_lists, weighted, firsts, networks,
                                           surging, surge_support, review_bar)
  select i.key, p_as_of, i.lists, i.counted_lists, i.weighted, i.firsts, i.networks, i.surging, i.surge_support,
         i.surge_support >= 0.25 * greatest(1, i.lists)
    from pg_temp._rk_items i;
  delete from ranker_private.ranker_surge_days;
  insert into ranker_private.ranker_surge_days (key, day, n_day, n_week, expected_day, expected_week,
                                                t_day, t_week, factor, cleared)
  select s.key, v_epoch + s.dn, s.n1::integer, s.n7::integer, s.tot1 * s.share, s.tot7 * s.share,
         s.t1, s.t7, s.factor, s.cleared
    from pg_temp._rk_sf s
   where s.factor < 1;

  -- 6. Publish, when the privacy batch is full.
  v_publish := v_changed >= 20 and (v_last is null or p_as_of > v_last);
  if v_publish then
    -- the matchup weights w(k, p), once per (length, place)
    create temporary table _rk_w (k integer not null, p integer not null, w double precision not null,
                                  primary key (k, p)) on commit drop;
    insert into pg_temp._rk_w
    select kk, pp, ranker_private.ranker_pair_weight(kk, pp)
      from generate_series(3, 25) kk cross join generate_series(1, 24) pp
     where pp < kk;

    delete from public.ranker_pairs;
    insert into public.ranker_pairs (a, b, w_ab, w_ba, q)
    select ka.key, kb.key, s.w_ab, s.w_ba, s.q
      from (select least(m.win, m.lose) as ia, greatest(m.win, m.lose) as ib,
                   coalesce(sum(m.w) filter (where m.win < m.lose), 0) as w_ab,
                   coalesce(sum(m.w) filter (where m.win > m.lose), 0) as w_ba,
                   sum(m.w * m.w) as q
              from (select a.kid as win, b.kid as lose, k.f * w.w as w
                      from pg_temp._rk_k k
                      join pg_temp._rk_pl a on a.voter_id = k.voter_id
                      join pg_temp._rk_pl b on b.voter_id = k.voter_id and b.p > a.p
                      join pg_temp._rk_w w on w.k = k.k and w.p = a.p) m
             group by 1, 2) s
      join pg_temp._rk_keys ka on ka.id = s.ia
      join pg_temp._rk_keys kb on kb.id = s.ib;

    delete from public.ranker_items;
    insert into public.ranker_items (key, lists, weighted, firsts, networks, surging, surge_support, held)
    select i.key, i.lists, i.weighted, i.firsts, i.networks, i.surging, i.surge_support,
           exists (select 1 from ranker_private.ranker_holds h where h.key = i.key)
      from pg_temp._rk_items i;

    delete from public.ranker_surges;
    insert into public.ranker_surges (key, day, n_day, n_week, expected_day, expected_week, t_day, t_week, factor, cleared)
    select s.key, s.day, s.n_day, s.n_week, s.expected_day, s.expected_week, s.t_day, s.t_week, s.factor, s.cleared
      from ranker_private.ranker_surge_days s;

    -- the owner's audit copy of the per-day counts (private: see the header)
    delete from ranker_private.ranker_daily;
    insert into ranker_private.ranker_daily (key, day, lists_saved)
    select kd.key, v_epoch + kd.dn, kd.n from pg_temp._rk_kd kd;

    delete from ranker_private.ranker_days;
    insert into ranker_private.ranker_days (day, lists_saved)
    select v_epoch + d.dn, d.n from pg_temp._rk_d d;

    insert into public.ranker_meta (as_of, total_lists, counted_lists, weighted_lists, changed_since_last,
                                    params_version, refreshed_at)
    values (p_as_of, v_fit, v_counted, v_weighted, v_changed, 'patty-ladder/1', now());

    -- the board's input, built once for every read until the next publication
    perform ranker_private.ranker_store_inputs();

    update ranker_private.ranker_lists l
       set published_items = c.items, published_on = v_epoch + c.dn
      from pg_temp._rk_c c
     where c.voter_id = l.voter_id
       and (l.published_items is distinct from c.items or l.published_on is distinct from v_epoch + c.dn);
    update ranker_private.ranker_lists l
       set published_items = null, published_on = null
     where l.published_items is not null
       and not exists (select 1 from pg_temp._rk_c c where c.voter_id = l.voter_id);
  end if;

  v_result := jsonb_build_object(
    'as_of', p_as_of, 'counted_lists', v_counted, 'fit_lists', v_fit, 'weighted_lists', v_weighted,
    'changed_since_last', v_changed, 'published', v_publish,
    'surging', (select count(*) from pg_temp._rk_items i where i.surging),
    'review_bar', (select count(*) from ranker_private.ranker_flags f where f.review_bar));
  update ranker_private.ranker_state
     set last_run_as_of = p_as_of, last_run_at = now(), last_run_result = v_result;
  return v_result;
end $$;

-- ------------------------------------------------------------------------------------------------
-- The owner's review queue: phi (inconsistent records) and the raw-drop burial watch need the fit, so the
-- daily People's Top 10 job reports them (its log's "Inconsistent record" and "Burial watch" warnings).
comment on view ranker_private.ranker_review_queue is
  'Patty Ladder owner queue: burgers surging on the last as_of, over the review bar, or held. phi >= 2.5 and the raw-score burial watch are in the daily People''s Top 10 job''s log (::warning lines).';

-- ------------------------------------------------------------------------------------------------
-- Who may call what (the new private functions: postgres only)

revoke all on function ranker_private.ranker_sync_keys(text[]) from public, anon, authenticated;
revoke all on function ranker_private.ranker_store_inputs() from public, anon, authenticated;
revoke all on function ranker_private.ranker_rebuild(date) from public, anon, authenticated;
revoke all on function ranker_private.ranker_void(uuid[]) from public, anon, authenticated;
revoke all on function ranker_private.ranker_hold(text) from public, anon, authenticated;
revoke all on function ranker_private.ranker_unhold(text) from public, anon, authenticated;
revoke all on function public.save_ranking(uuid, text[]) from public;
grant execute on function public.save_ranking(uuid, text[]) to anon, authenticated;

-- Stored now (nothing before the first publication).
select ranker_private.ranker_store_inputs();
