-- Autosave (user request 2026-09-27: "can it just autosave without them having to hit save?"): the ranker now saves the
-- list about 2 seconds after each change once it holds 3 burgers, so one visitor makes many more save_ranking calls than
-- with a Save button. The two per-save budgets rise; nothing else changes:
--   rate_connection: 20 -> 120 saves an hour per connection (the IPv4 address, or the IPv6 /64)
--   rate_voter:      10 -> 200 saves a New York day per voter id
--   rate_network:    30 new voter ids a day per /24 or /48, unchanged (it counts new lists, not saves)
-- save_ranking is replaced as it was (patty_ladder_hardening), the two numbers aside: the same checks, the connection
-- lock, the one-list-per-connection rule, the same security definer, search_path and grants. Every call that passes
-- validation still counts against both budgets (an identical list too: the site never sends one), a refused call rolls
-- its counts back, and get_my_ranking and delete_ranking count against nothing.

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

  perform ranker_private.rate_hit('conn:' || v_ip, date_trunc('hour', v_now), 120, 'rate_connection',
    'Lots of lists were saved from this connection in the last hour. Try again later.');
  perform ranker_private.rate_hit('voter:' || p_voter::text, v_day0, 200, 'rate_voter',
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

revoke all on function public.save_ranking(uuid, text[]) from public;
grant execute on function public.save_ranking(uuid, text[]) to anon, authenticated;
