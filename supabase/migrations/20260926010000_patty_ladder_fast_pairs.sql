-- The Patty Ladder, follow-up (2026-09-26): the nightly rebuild's pair step, made fast enough for the
-- spec's scale. Measured on the live project inside a rolled-back transaction, 2,000 lists of 3-25
-- burgers over 560 menus took 11.7 s, 8.3 s of it summing ~226k matchups into ~120k pairs: the
-- grouping on two text keys spilled to disk under the default 4 MB work_mem, and the matchup weight
-- was a function call per matchup (its SET search_path keeps Postgres from inlining it).
-- Now the keys are numbered in "C" order (so comparing ids compares keys) and the pairs are summed
-- over integers, the weights come from a 276-row table built once from ranker_pair_weight, and the
-- function runs with work_mem 32 MB. The numbers it writes are the same (same weights, same sums);
-- only ranker_rebuild changes.

-- Rebuilds everything from scratch for the lists saved through p_as_of (a New York date before today).
-- Always: promotes each active list's last save through as_of to its counted version, clears old
-- hashes and rate rows, and rewrites the owner's review data (ranker_flags, ranker_surge_days).
-- Publishes the public aggregates only when at least 20 counted lists changed since the last
-- publication (the privacy batch) and as_of is later than the last published day.
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

revoke all on function ranker_private.ranker_rebuild(date) from public, anon, authenticated;
