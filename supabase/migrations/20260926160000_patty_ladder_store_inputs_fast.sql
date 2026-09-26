-- The Patty Ladder, follow-up to patty_ladder_hardening (2026-09-26): ranker_store_inputs, made fast at scale.
-- Measured on the live project in rolled-back transactions at 10,000 lists (163k pairs): building the stored
-- board input took 7.5 s, and a hold (which rebuilds it) 17.7 s. Each pair looked up its two keys' indexes in a
-- CTE over ranker_items; right after the rebuild rewrites that table it has no statistics, and the planner scanned
-- the CTE once per pair. The indexes now come from a small temporary table with a primary key and fresh
-- statistics: 2.4 s for the store and for a hold, and the same bytes as before (compared at 10,000 lists).
-- Only ranker_store_inputs changes.

create or replace function ranker_private.ranker_store_inputs()
  returns void language plpgsql set search_path = '' set extra_float_digits = 3 set timezone = 'UTC' as $$
begin
  delete from ranker_private.ranker_inputs;
  if not exists (select 1 from public.ranker_meta) then
    return;   -- nothing before the first publication
  end if;
  -- each key's index into items ("C" order): joined twice per pair, so an indexed, analyzed table
  drop table if exists pg_temp._rk_ix;
  create temporary table _rk_ix (key text collate "C" primary key, ix integer not null) on commit drop;
  insert into pg_temp._rk_ix
  select i.key, (row_number() over (order by i.key) - 1)::integer from public.ranker_items i;
  analyze pg_temp._rk_ix;
  insert into ranker_private.ranker_inputs (id, as_of, inputs, built_at)
  with m as (
    select * from public.ranker_meta order by as_of desc limit 1
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
                                 'key', i.key, 'lists', i.lists, 'weighted', i.weighted, 'firsts', i.firsts,
                                 'networks', i.networks, 'surging', i.surging,
                                 'surge_support', i.surge_support, 'held', i.held) order by x.ix)
                                from public.ranker_items i join pg_temp._rk_ix x on x.key = i.key), '[]'::json),
           'pairs', coalesce((select json_agg(json_build_array(ia.ix, ib.ix, p.w_ab, p.w_ba, p.q) order by ia.ix, ib.ix)
                                from public.ranker_pairs p
                                join pg_temp._rk_ix ia on ia.key = p.a
                                join pg_temp._rk_ix ib on ib.key = p.b), '[]'::json)),
         now()
    from m;
end $$;

revoke all on function ranker_private.ranker_store_inputs() from public, anon, authenticated;
