-- "What's it worth?" (user decision 2026-09-25): replaces the 1-10 ratings.
-- Each visitor says, in whole dollars, what they'd pay for a restaurant's burger. The crowd's
-- median is "the People's Price", shown next to the menu price. Answers are whole dollars from
-- $5 to $75 (user decision; applied to the live project as migrations whats_it_worth_range_5_45 then _5_75).
--
-- Private: burger_worth (one answer per visitor per menu; changeable).
-- Public, read-only, realtime: burger_worth_hist (menu_key, dollars, votes) — how many visitors
-- chose each dollar amount; enough for the site to show the median and a distribution.
-- Writes only through public.cast_worth(); 60 answers per hour per client IP (hashed), reusing
-- public.burger_vote_rate from 20260925000000_burger_votes.sql.

-- The 1-10 ratings are retired (they held no votes).
alter publication supabase_realtime drop table public.burger_scores;
drop function if exists public.cast_vote(text, uuid, integer);
drop function if exists public.my_votes(uuid);
drop table if exists public.burger_votes;
drop table if exists public.burger_scores;
drop function if exists public.burger_vote_apply();

create table public.burger_worth (
  menu_key   text        not null check (menu_key ~ '^(chain:)?[a-z0-9-]{1,120}$'),
  voter      uuid        not null,
  dollars    smallint    not null check (dollars between 5 and 75),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (menu_key, voter)
);
alter table public.burger_worth enable row level security;
revoke all on public.burger_worth from anon, authenticated;

create table public.burger_worth_hist (
  menu_key   text        not null,
  dollars    smallint    not null,
  votes      integer     not null default 0 check (votes >= 0),
  updated_at timestamptz not null default now(),
  primary key (menu_key, dollars)
);
alter table public.burger_worth_hist enable row level security;
create policy "anyone reads what burgers are worth" on public.burger_worth_hist
  for select to anon, authenticated using (true);
revoke all on public.burger_worth_hist from anon, authenticated;
grant select on public.burger_worth_hist to anon, authenticated;

create or replace function public.burger_worth_apply() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.burger_worth_hist
       set votes = votes - 1, updated_at = now()
     where menu_key = old.menu_key and dollars = old.dollars;
    delete from public.burger_worth_hist
     where menu_key = old.menu_key and dollars = old.dollars and votes = 0;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.burger_worth_hist as h (menu_key, dollars, votes)
    values (new.menu_key, new.dollars, 1)
    on conflict (menu_key, dollars) do update set votes = h.votes + 1, updated_at = now();
  end if;
  return null;
end $$;
revoke all on function public.burger_worth_apply() from public, anon, authenticated;

create trigger burger_worth_apply after insert or update or delete on public.burger_worth
  for each row execute function public.burger_worth_apply();

-- The only way to answer. Returns the burger's new People's Price (median, whole-dollar answers)
-- and answer count.
create or replace function public.cast_worth(p_menu_key text, p_voter uuid, p_dollars integer)
  returns table (menu_key text, votes bigint, median numeric)
  language plpgsql security definer set search_path = '' as $$
declare
  v_headers json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
  v_ip text := coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-real-ip',
                        split_part(v_headers->>'x-forwarded-for', ',', 1), 'unknown');
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
  values (md5(trim(v_ip)), date_trunc('hour', now()), 1)
  on conflict (ip_hash, window_start) do update set votes = r.votes + 1
  returning r.votes into v_used;
  if v_used > 60 then
    raise exception 'too many answers from this connection; try again later' using errcode = '54000';
  end if;

  insert into public.burger_worth as w (menu_key, voter, dollars)
  values (p_menu_key, p_voter, p_dollars)
  on conflict on constraint burger_worth_pkey do update
    set dollars = excluded.dollars, updated_at = now()
    where w.dollars is distinct from excluded.dollars;

  return query
    select w.menu_key, count(*)::bigint,
           percentile_cont(0.5) within group (order by w.dollars)::numeric
      from public.burger_worth w
     where w.menu_key = p_menu_key
     group by w.menu_key;
end $$;
revoke all on function public.cast_worth(text, uuid, integer) from public;
grant execute on function public.cast_worth(text, uuid, integer) to anon, authenticated;

-- A browser's own answers (to pre-fill the slider).
create or replace function public.my_worth(p_voter uuid)
  returns table (menu_key text, dollars smallint)
  language sql stable security definer set search_path = '' as $$
  select w.menu_key, w.dollars from public.burger_worth w where w.voter = p_voter;
$$;
revoke all on function public.my_worth(uuid) from public;
grant execute on function public.my_worth(uuid) to anon, authenticated;

alter publication supabase_realtime add table public.burger_worth_hist;
