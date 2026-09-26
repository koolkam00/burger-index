-- The Patty Ladder: the People's Top 10 force ranker (user decisions 2026-09-25/26). It replaces every
-- form of crowd pricing ("What's it worth?", the People's Price). Menu prices stay.
--
-- Each visitor submits ONE strict ranking of 3 to 25 burgers (menu keys, best first) and can edit it.
-- One list counts per browser (its random voter id) and per connection: the latest save from a
-- connection replaces the other active lists saved from it in the last 30 days. The crowd ranking
-- is computed from public aggregates by a daily GitHub job (ladder.mjs computeBoard); this file is the
-- database half: storage, the three visitor RPCs, the nightly aggregates with surge damping and the
-- privacy batch, the owner's review queue and actions. Spec: the ranker design's FINAL.md, sections
-- 3.1-3.4, 6 and 7; summary and deviations in supabase/README.md.
--
-- Private (schema ranker_private: not exposed by the API, no grants; RLS on as well):
--   ranker_lists (the lists), ranker_state (the hashing salt, last run), ranker_rate, ranker_holds,
--   ranker_clears, ranker_flags + ranker_surge_days (last night's review data), the views
--   ranker_review_queue / ranker_review_lists, and the functions ranker_refresh (pg_cron),
--   ranker_rebuild, ranker_void, ranker_clear_surge, ranker_hold, ranker_unhold (postgres only).
-- Public, read-only, no voter data: ranker_meta, ranker_items, ranker_pairs, ranker_surges,
--   ranker_daily, ranker_days, ranker_actions, and rpc ranker_board_inputs() (all of it in one call).
-- The site's publishable key can call save_ranking, get_my_ranking, delete_ranking and
-- ranker_board_inputs, and read the public tables. Nothing else.

create extension if not exists pg_cron;

create schema ranker_private;
revoke all on schema ranker_private from public;
comment on schema ranker_private is
  'The Patty Ladder''s private data and owner tools. Not exposed by the API; only postgres uses it.';

-- ------------------------------------------------------------------------------------------------
-- Private tables

-- One row. The salt for connection and network hashes: random, made when this migration ran, never
-- in the repo and never sent anywhere (not a secret key: it only keeps the hashes from being reversed
-- by trying every IP address).
create table ranker_private.ranker_state (
  id              boolean     primary key default true check (id),
  salt            text        not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  last_run_as_of  date,
  last_run_at     timestamptz,
  last_run_result jsonb
);
insert into ranker_private.ranker_state default values;

-- The lists. `items` is what the visitor sees; `counted_*` is the version the board counts (promoted
-- by the nightly refresh from the last save through as_of); `published_*` is the version in the last
-- published aggregates (the privacy batch compares against it).
create table ranker_private.ranker_lists (
  voter_id        uuid        primary key,
  items           text[]      not null check (cardinality(items) between 3 and 25),
  saved_on        date        not null,          -- America/New_York date of the last save
  saved_at        timestamptz not null,
  counted_items   text[],
  counted_on      date,
  counted_at      timestamptz,
  published_items text[],
  published_on    date,
  ip_hash         text,                          -- salted hash of the connection; cleared 30 days after the last save
  net_hash        text,                          -- salted hash of its /24 (IPv4) or /48 (IPv6); only while active
  status          text        not null default 'active'
                              check (status in ('active', 'replaced', 'deleted', 'void')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index ranker_lists_active_ip on ranker_private.ranker_lists (ip_hash) where status = 'active';
create index ranker_lists_active_net on ranker_private.ranker_lists (net_hash) where status = 'active';

create table ranker_private.ranker_rate (
  bucket       text        not null,             -- 'conn:<hash>', 'voter:<uuid>', 'net:<hash>'
  window_start timestamptz not null,
  used         integer     not null default 0,
  primary key (bucket, window_start)
);

create table ranker_private.ranker_holds (
  key        text        primary key check (key ~ '^(chain:)?[a-z0-9-]{1,120}$'),
  since      date        not null,
  created_at timestamptz not null default now()
);

create table ranker_private.ranker_clears (
  id         bigint      generated always as identity primary key,
  key        text        not null check (key ~ '^(chain:)?[a-z0-9-]{1,120}$'),
  from_day   date        not null,
  to_day     date        not null,
  created_at timestamptz not null default now(),
  check (from_day <= to_day)
);

-- Last night's per-burger numbers and damped days, for the owner's queue (rebuilt every night,
-- whether or not the aggregates were published).
create table ranker_private.ranker_flags (
  key           text             primary key,
  as_of         date             not null,
  lists         integer          not null,       -- lists in the fit (after the duplicate collapse)
  counted_lists integer          not null,       -- every counted list naming it
  weighted      double precision not null,
  firsts        integer          not null,
  networks      integer          not null,
  surging       boolean          not null,
  surge_support integer          not null,
  review_bar    boolean          not null
);

create table ranker_private.ranker_surge_days (
  key           text             not null,
  day           date             not null,
  n_day         integer          not null,
  n_week        integer          not null,
  expected_day  double precision not null,
  expected_week double precision not null,
  t_day         double precision not null,
  t_week        double precision not null,
  factor        double precision not null,
  cleared       boolean          not null,
  primary key (key, day)
);

do $$
declare t text;
begin
  foreach t in array array['ranker_state', 'ranker_lists', 'ranker_rate', 'ranker_holds', 'ranker_clears',
                           'ranker_flags', 'ranker_surge_days'] loop
    execute format('alter table ranker_private.%I enable row level security', t);
    execute format('revoke all on ranker_private.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------------------------------------
-- Public aggregates (FINAL.md section 7). Rewritten together by the nightly refresh, and only when
-- at least 20 counted lists changed since the last publication. Keys use the "C" collation so that
-- `a < b` and every ordering match JavaScript's string comparison.

create table public.ranker_meta (
  as_of              date             primary key,  -- New York date of the last save day counted
  total_lists        integer          not null,     -- lists in the fit (after the duplicate collapse)
  counted_lists      integer          not null,     -- every counted list (before the collapse)
  weighted_lists     double precision not null,     -- sum of the fit lists' surge weights
  changed_since_last integer          not null,
  params_version     text             not null,
  refreshed_at       timestamptz      not null
);

create table public.ranker_items (
  key           text collate "C" primary key,
  lists         integer          not null,
  weighted      double precision not null,
  firsts        integer          not null,
  networks      integer          not null,
  surging       boolean          not null,
  surge_support integer          not null,
  held          boolean          not null default false
);

create table public.ranker_pairs (
  a    text collate "C" not null,
  b    text collate "C" not null,
  w_ab double precision not null,
  w_ba double precision not null,
  q    double precision not null,
  primary key (a, b),
  check (a < b)
);

create table public.ranker_surges (
  key           text collate "C" not null,
  day           date             not null,
  n_day         integer          not null,
  n_week        integer          not null,
  expected_day  double precision not null,
  expected_week double precision not null,
  t_day         double precision not null,
  t_week        double precision not null,
  factor        double precision not null,
  cleared       boolean          not null,
  primary key (key, day)
);

create table public.ranker_daily (
  key         text collate "C" not null,
  day         date    not null,
  lists_saved integer not null,
  primary key (key, day)
);

create table public.ranker_days (
  day         date    primary key,
  lists_saved integer not null
);

create table public.ranker_actions (
  id     bigint  generated always as identity primary key,
  day    date    not null,
  key    text collate "C",
  action text    not null check (action in ('void', 'clear_surge', 'hold', 'unhold')),
  count  integer not null
);

do $$
declare t text;
begin
  foreach t in array array['ranker_meta', 'ranker_items', 'ranker_pairs', 'ranker_surges', 'ranker_daily',
                           'ranker_days', 'ranker_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "anyone reads the ranker aggregates" on public.%I for select to anon, authenticated using (true)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.ranker_actions_id_seq from anon, authenticated;

comment on table public.ranker_meta is 'Patty Ladder: one row per publication of the aggregates (the latest is the board''s input).';
comment on table public.ranker_items is 'Patty Ladder: per burger (menu key): lists, surge-weighted lists, #1s, networks, surge flags, owner hold.';
comment on table public.ranker_pairs is 'Patty Ladder: per pair a < b: surge-weighted matchup wins each way, and the sum of squared weights.';
comment on table public.ranker_surges is 'Patty Ladder: every damped (burger, save day), for auditing the surge damping.';
comment on table public.ranker_daily is 'Patty Ladder: counted lists naming each burger per save day (before the duplicate collapse).';
comment on table public.ranker_days is 'Patty Ladder: counted lists per save day (before the duplicate collapse).';
comment on table public.ranker_actions is 'Patty Ladder: the owner''s voids, surge clears, holds and unholds (no list contents).';

-- ------------------------------------------------------------------------------------------------
-- Helpers (private)

-- The salted connection and network hashes of the calling request (the same headers cast_worth
-- reads). The connection is the IPv4 address or the IPv6 /64 (one household's LAN, whose devices
-- rotate their addresses); the network is the /24 or /48.
create or replace function ranker_private.client_hashes(out ip_hash text, out net_hash text)
  language plpgsql stable set search_path = '' as $$
declare
  v_headers json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
  v_ip   text := trim(coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-real-ip',
                               split_part(v_headers->>'x-forwarded-for', ',', 1), 'unknown'));
  v_salt text;
  v_addr inet;
  v_conn text;
  v_net  text;
begin
  select s.salt into strict v_salt from ranker_private.ranker_state s;
  begin
    v_addr := v_ip::inet;
    if family(v_addr) = 6 and v_addr << inet '::ffff:0:0/96' then   -- IPv4-mapped IPv6
      v_addr := substring(host(v_addr) from '([0-9.]+)$')::inet;
    end if;
    if family(v_addr) = 4 then
      v_conn := host(v_addr);
      v_net  := host(network(set_masklen(v_addr, 24))) || '/24';
    else
      v_conn := host(network(set_masklen(v_addr, 64))) || '/64';
      v_net  := host(network(set_masklen(v_addr, 48))) || '/48';
    end if;
  exception when others then
    v_conn := 'raw:' || v_ip;
    v_net  := 'raw:' || v_ip;
  end;
  ip_hash  := encode(sha256(convert_to(v_salt || '|conn|' || v_conn, 'UTF8')), 'hex');
  net_hash := encode(sha256(convert_to(v_salt || '|net|' || v_net, 'UTF8')), 'hex');
end $$;

-- Count one use of a budget; over the limit, refuse with HTTP 429 (PostgREST maps SQLSTATE PTxyz to
-- status xyz). The refusal rolls the whole call back, the counter included, so it stays at the limit.
create or replace function ranker_private.rate_hit(p_bucket text, p_window timestamptz, p_limit integer,
                                                   p_code text, p_message text)
  returns void language plpgsql set search_path = '' as $$
declare v_used integer;
begin
  insert into ranker_private.ranker_rate as r (bucket, window_start, used)
  values (p_bucket, p_window, 1)
  on conflict (bucket, window_start) do update set used = r.used + 1
  returning r.used into v_used;
  if v_used > p_limit then
    raise exception using errcode = 'PT429', message = p_message, hint = p_code;
  end if;
end $$;

-- A list's winner at 1-based place p of a k-item list beats each burger below it with this weight
-- (FINAL.md 3.2; ladder.mjs pairWeight): a list's #1 wins 1 in total, each place down counts 20% less.
create or replace function ranker_private.ranker_pair_weight(p_k integer, p_p integer)
  returns double precision language sql immutable set search_path = '' as $$
  select power(0.8::double precision, (p_p - 1)::double precision) / (p_k - 1)::double precision;
$$;

-- The day a nightly run counts through, or null when it is not 00:xx in New York. pg_cron runs in
-- UTC at 04:20 and 05:20: exactly one of them is 00:20 New York time, in summer and in winter.
create or replace function ranker_private.ranker_due(p_now timestamptz)
  returns date language sql stable set search_path = '' as $$
  select case when extract(hour from (p_now at time zone 'America/New_York')) = 0
              then (p_now at time zone 'America/New_York')::date - 1 end;
$$;

-- ------------------------------------------------------------------------------------------------
-- The visitor's three calls (security definer: the only way in)

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
  if exists (select 1 from unnest(p_items) x where x is null or x !~ '^(chain:)?[a-z0-9-]{1,120}$') then
    raise exception 'One of those burgers isn''t on the Burger Index.' using errcode = '22023', hint = 'unknown_burger';
  end if;
  if (select count(distinct x) from unnest(p_items) x) <> v_n then
    raise exception 'Each burger can be on your list only once.' using errcode = '22023', hint = 'duplicate_burger';
  end if;
  v_items := array(select u.x from unnest(p_items) with ordinality as u(x, o) order by u.o);

  select h.ip_hash, h.net_hash into v_ip, v_net from ranker_private.client_hashes() h;

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

create or replace function public.get_my_ranking(p_voter uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'items', to_jsonb(l.items),
           'status', l.status,
           'saved_on', l.saved_on,
           'counts_from', case when l.status = 'active' then l.saved_on + 1 end,
           'in_board', l.status = 'active' and l.published_items is not distinct from l.items
                       and l.published_on is not distinct from l.saved_on)
    from ranker_private.ranker_lists l
   where l.voter_id = p_voter;
$$;

create or replace function public.delete_ranking(p_voter uuid)
  returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update ranker_private.ranker_lists l
     set status = 'deleted', counted_items = null, counted_on = null, counted_at = null,
         ip_hash = null, net_hash = null, updated_at = now()
   where l.voter_id = p_voter and l.status in ('active', 'replaced');
  return found;
end $$;

-- ------------------------------------------------------------------------------------------------
-- The nightly refresh (FINAL.md 3.3, 3.4 and section 6)

-- Rebuilds everything from scratch for the lists saved through p_as_of (a New York date before today).
-- Always: promotes each active list's last save through as_of to its counted version, clears old
-- hashes and rate rows, and rewrites the owner's review data (ranker_flags, ranker_surge_days).
-- Publishes the public aggregates only when at least 20 counted lists changed since the last
-- publication (the privacy batch) and as_of is later than the last published day.
create or replace function ranker_private.ranker_rebuild(p_as_of date)
  returns jsonb language plpgsql set search_path = '' as $$
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
  drop table if exists pg_temp._rk_c, pg_temp._rk_pl, pg_temp._rk_d, pg_temp._rk_kd, pg_temp._rk_dt,
                       pg_temp._rk_kw, pg_temp._rk_sf, pg_temp._rk_f, pg_temp._rk_k, pg_temp._rk_items;
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

  create temporary table _rk_pl (
    voter_id uuid not null, k integer not null, dn integer not null, key text collate "C" not null, p integer not null
  ) on commit drop;
  insert into pg_temp._rk_pl
  select c.voter_id, c.k, c.dn, u.key, u.p
    from pg_temp._rk_c c cross join lateral unnest(c.items) with ordinality as u(key, p);
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
    delete from public.ranker_pairs;
    insert into public.ranker_pairs (a, b, w_ab, w_ba, q)
    select least(m.win, m.lose), greatest(m.win, m.lose),
           coalesce(sum(m.w) filter (where m.win < m.lose), 0),
           coalesce(sum(m.w) filter (where m.win > m.lose), 0),
           sum(m.w * m.w)
      from (select a.key as win, b.key as lose, k.f * ranker_private.ranker_pair_weight(k.k, a.p) as w
              from pg_temp._rk_k k
              join pg_temp._rk_pl a on a.voter_id = k.voter_id
              join pg_temp._rk_pl b on b.voter_id = k.voter_id and b.p > a.p) m
     group by 1, 2;

    delete from public.ranker_items;
    insert into public.ranker_items (key, lists, weighted, firsts, networks, surging, surge_support, held)
    select i.key, i.lists, i.weighted, i.firsts, i.networks, i.surging, i.surge_support,
           exists (select 1 from ranker_private.ranker_holds h where h.key = i.key)
      from pg_temp._rk_items i;

    delete from public.ranker_surges;
    insert into public.ranker_surges (key, day, n_day, n_week, expected_day, expected_week, t_day, t_week, factor, cleared)
    select s.key, s.day, s.n_day, s.n_week, s.expected_day, s.expected_week, s.t_day, s.t_week, s.factor, s.cleared
      from ranker_private.ranker_surge_days s;

    delete from public.ranker_daily;
    insert into public.ranker_daily (key, day, lists_saved)
    select kd.key, v_epoch + kd.dn, kd.n from pg_temp._rk_kd kd;

    delete from public.ranker_days;
    insert into public.ranker_days (day, lists_saved)
    select v_epoch + d.dn, d.n from pg_temp._rk_d d;

    insert into public.ranker_meta (as_of, total_lists, counted_lists, weighted_lists, changed_since_last,
                                    params_version, refreshed_at)
    values (p_as_of, v_fit, v_counted, v_weighted, v_changed, 'patty-ladder/1', now());

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

-- pg_cron's entry point: runs only at 00:xx New York time (unless forced), once per as_of.
create or replace function ranker_private.ranker_refresh(p_force boolean default false)
  returns jsonb language plpgsql set search_path = '' as $$
declare
  v_as_of date := ranker_private.ranker_due(now());
  v_last  date;
begin
  if v_as_of is null then
    if not p_force then
      return jsonb_build_object('skipped', 'not 00:xx in New York');
    end if;
    v_as_of := (now() at time zone 'America/New_York')::date - 1;
  end if;
  select s.last_run_as_of into v_last from ranker_private.ranker_state s;
  if v_last is not distinct from v_as_of and not p_force then
    return jsonb_build_object('skipped', 'already ran', 'as_of', v_as_of);
  end if;
  return ranker_private.ranker_rebuild(v_as_of);
end $$;

-- ------------------------------------------------------------------------------------------------
-- The owner's actions (postgres only), each logged in public.ranker_actions without list contents.
-- They reach the board at the next publication, like everything the refresh computes.

create or replace function ranker_private.ranker_void(p_voter_ids uuid[])
  returns integer language plpgsql set search_path = '' as $$
declare v_n integer;
begin
  update ranker_private.ranker_lists l
     set status = 'void', counted_items = null, counted_on = null, counted_at = null,
         ip_hash = null, net_hash = null, updated_at = now()
   where l.voter_id = any (p_voter_ids) and l.status <> 'void';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.ranker_actions (day, key, action, count)
    values ((now() at time zone 'America/New_York')::date, null, 'void', v_n);
  end if;
  return v_n;
end $$;

-- Full weight back for p_key's lists saved from p_from to p_to, and its surge review lifted.
create or replace function ranker_private.ranker_clear_surge(p_key text, p_from date, p_to date)
  returns integer language plpgsql set search_path = '' as $$
declare v_n integer;
begin
  if p_key is null or p_key !~ '^(chain:)?[a-z0-9-]{1,120}$' then
    raise exception 'not a menu key: %', p_key;
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'the range must run from an earlier day to a later one';
  end if;
  insert into ranker_private.ranker_clears (key, from_day, to_day) values (p_key, p_from, p_to);
  select count(*) into v_n from ranker_private.ranker_lists l
   where l.status = 'active' and l.counted_items @> array[p_key] and l.counted_on between p_from and p_to;
  insert into public.ranker_actions (day, key, action, count)
  values ((now() at time zone 'America/New_York')::date, p_key, 'clear_surge', v_n);
  return v_n;
end $$;

-- Freeze p_key's published score both ways and keep it from taking a new Top-10 seat (an incumbent
-- keeps its seat) until ranker_unhold. ranker_items.held changes at once.
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
  insert into public.ranker_actions (day, key, action, count)
  values ((now() at time zone 'America/New_York')::date, p_key, 'unhold', 1);
  return true;
end $$;

-- ------------------------------------------------------------------------------------------------
-- The owner's review queue (Supabase dashboard: select * from ranker_private.ranker_review_queue).
-- phi (inconsistent records) and the raw-drop burial watch need the fit, so they come from the daily
-- board snapshot, not from here.

create view ranker_private.ranker_review_queue with (security_invoker = true) as
select coalesce(f.key, h.key) as key,
       concat_ws(', ',
         case when f.surging then 'surging' end,
         case when f.review_bar then 'review bar' end,
         case when h.key is not null then 'held since ' || h.since end) as reasons,
       f.as_of, f.lists, f.counted_lists, f.weighted, f.networks, f.surge_support,
       coalesce(f.surging, false) as surging, coalesce(f.review_bar, false) as review_bar,
       h.key is not null as held, h.since as held_since,
       (select count(*) from ranker_private.ranker_surge_days s
         where s.key = coalesce(f.key, h.key) and not s.cleared)::integer as damped_days
  from ranker_private.ranker_flags f
  full join ranker_private.ranker_holds h on h.key = f.key
 where f.surging or f.review_bar or h.key is not null;

-- The lists behind each queued burger: those saved on a day it was damped, and every active list
-- naming it saved in the last week. The voter id is what ranker_void takes; never an IP or a hash.
create view ranker_private.ranker_review_lists with (security_invoker = true) as
select q.key, l.voter_id, l.status, l.counted_on as counted_day, l.saved_on,
       array_position(coalesce(l.counted_items, l.items), q.key) as place,
       cardinality(coalesce(l.counted_items, l.items)) as list_length,
       l.counted_items, l.items as latest_items,
       s.factor as damped_to, s.cleared as surge_cleared,
       (select count(*) from ranker_private.ranker_lists o
         where o.status = 'active' and o.net_hash = l.net_hash)::integer as active_lists_on_network
  from ranker_private.ranker_review_queue q
  join ranker_private.ranker_lists l
    on l.status = 'active' and (l.counted_items @> array[q.key] or l.items @> array[q.key])
  left join ranker_private.ranker_surge_days s on s.key = q.key and s.day = l.counted_on
 where s.key is not null
    or l.saved_on >= coalesce(q.as_of, (select st.last_run_as_of from ranker_private.ranker_state st)) - 6;

-- ------------------------------------------------------------------------------------------------
-- The board's input in one call (one consistent snapshot of meta, items and pairs), for the daily
-- job's GET /rest/v1/rpc/ranker_board_inputs. Null until the first publication. Items are sorted by
-- key ("C" order, as JavaScript compares strings); pairs are [i, j, w_ab, w_ba, q] with i < j indexes
-- into items. Floats are printed exactly (shortest round-trip form).
create or replace function public.ranker_board_inputs()
  returns json language sql stable set search_path = '' set extra_float_digits = 3 as $$
  with m as (
    select * from public.ranker_meta order by as_of desc limit 1
  ), it as (
    select i.*, (row_number() over (order by i.key) - 1)::integer as ix from public.ranker_items i
  )
  select json_build_object(
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
                                join it ib on ib.key = p.b), '[]'::json))
    from m;
$$;

-- ------------------------------------------------------------------------------------------------
-- Who may call what

revoke all on function ranker_private.client_hashes() from public, anon, authenticated;
revoke all on function ranker_private.rate_hit(text, timestamptz, integer, text, text) from public, anon, authenticated;
revoke all on function ranker_private.ranker_pair_weight(integer, integer) from public, anon, authenticated;
revoke all on function ranker_private.ranker_due(timestamptz) from public, anon, authenticated;
revoke all on function ranker_private.ranker_rebuild(date) from public, anon, authenticated;
revoke all on function ranker_private.ranker_refresh(boolean) from public, anon, authenticated;
revoke all on function ranker_private.ranker_void(uuid[]) from public, anon, authenticated;
revoke all on function ranker_private.ranker_clear_surge(text, date, date) from public, anon, authenticated;
revoke all on function ranker_private.ranker_hold(text) from public, anon, authenticated;
revoke all on function ranker_private.ranker_unhold(text) from public, anon, authenticated;
revoke all on ranker_private.ranker_review_queue from public, anon, authenticated;
revoke all on ranker_private.ranker_review_lists from public, anon, authenticated;

revoke all on function public.save_ranking(uuid, text[]) from public;
revoke all on function public.get_my_ranking(uuid) from public;
revoke all on function public.delete_ranking(uuid) from public;
revoke all on function public.ranker_board_inputs() from public;
grant execute on function public.save_ranking(uuid, text[]) to anon, authenticated;
grant execute on function public.get_my_ranking(uuid) to anon, authenticated;
grant execute on function public.delete_ranking(uuid) to anon, authenticated;
grant execute on function public.ranker_board_inputs() to anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- "What's it worth?" is retired (user decision 2026-09-26): no new answers, and the answers already
-- given stay stored but hidden. Nothing is deleted; granting these back would reopen it.
revoke execute on function public.cast_worth(text, uuid, integer) from anon, authenticated;
revoke execute on function public.my_worth(uuid) from anon, authenticated;
revoke select on public.burger_worth_hist from anon, authenticated;
alter publication supabase_realtime drop table public.burger_worth_hist;

-- ------------------------------------------------------------------------------------------------
-- Nightly at 00:20 New York time: 04:20 UTC in summer, 05:20 UTC in winter (ranker_due picks).
select cron.schedule('ranker-refresh', '20 4,5 * * *', 'select ranker_private.ranker_refresh()');
