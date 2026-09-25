-- One answer per connection per burger (2026-09-25). A voter id is just a UUID the browser makes,
-- so a script or a cleared browser could send three answers and put a named restaurant at the top
-- of "Most overpriced" or "Biggest bargains". Now each answer also records its connection (the
-- same md5 IP hash as burger_vote_rate), and an answer from a connection that already answered
-- that burger replaces the earlier one, whichever browser sent it. People sharing one network
-- (a household, an office) share one answer per burger.

alter table public.burger_worth add column ip_hash text;
-- Answers from before this migration keep counting on their own.
update public.burger_worth set ip_hash = 'legacy:' || voter::text where ip_hash is null;
alter table public.burger_worth alter column ip_hash set not null;
create unique index burger_worth_menu_ip on public.burger_worth (menu_key, ip_hash);

create or replace function public.cast_worth(p_menu_key text, p_voter uuid, p_dollars integer)
  returns table (menu_key text, votes bigint, median numeric)
  language plpgsql security definer set search_path = '' as $$
declare
  v_headers json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
  v_ip text := coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-real-ip',
                        split_part(v_headers->>'x-forwarded-for', ',', 1), 'unknown');
  v_hash text := md5(trim(v_ip));
  v_used integer;
begin
  if p_dollars is null or p_dollars < 5 or p_dollars > 75 then
    raise exception 'answer must be a whole number of dollars from 5 to 75' using errcode = '22023';
  end if;
  if p_menu_key is null or p_menu_key !~ '^(chain:)?[a-z0-9-]{1,120}$' then
    raise exception 'unknown burger' using errcode = '22023';
  end if;
  if p_voter is null then
    raise exception 'missing voter id' using errcode = '22023';
  end if;

  insert into public.burger_vote_rate as r (ip_hash, window_start, votes)
  values (v_hash, date_trunc('hour', now()), 1)
  on conflict (ip_hash, window_start) do update set votes = r.votes + 1
  returning r.votes into v_used;
  if v_used > 60 then
    raise exception 'too many answers from this connection; try again later' using errcode = '54000';
  end if;

  -- Another browser's answer to this burger from this connection gives way to this one.
  delete from public.burger_worth w
   where w.menu_key = p_menu_key and w.ip_hash = v_hash and w.voter <> p_voter;

  insert into public.burger_worth as w (menu_key, voter, dollars, ip_hash)
  values (p_menu_key, p_voter, p_dollars, v_hash)
  on conflict on constraint burger_worth_pkey do update
    set dollars = excluded.dollars, ip_hash = excluded.ip_hash, updated_at = now()
    where w.dollars is distinct from excluded.dollars or w.ip_hash is distinct from excluded.ip_hash;

  return query
    select w.menu_key, count(*)::bigint,
           percentile_cont(0.5) within group (order by w.dollars)::numeric
      from public.burger_worth w
     where w.menu_key = p_menu_key
     group by w.menu_key;
end $$;
revoke all on function public.cast_worth(text, uuid, integer) from public;
grant execute on function public.cast_worth(text, uuid, integer) to anon, authenticated;
