-- The Burger Index: visitor ratings (1-10, whole numbers), one per visitor per burger, and a
-- public running total per burger that the site reads (and subscribes to for live updates).
--
-- No sign-in: each browser makes a random voter id (a UUID kept in localStorage) the first time it
-- votes. The browser can only call public.cast_vote() and public.my_votes(); it can't read or
-- write burger_votes directly. The public reads burger_scores (counts and sums per burger, no
-- voter ids). cast_vote allows 60 votes per hour per client IP (stored only as an md5 hash).
--
-- menu_key is the dataset's menu key: a restaurant id ("due-west-west-village") or a chain
-- ("chain:7th-street-burger"), so a vote follows the restaurant's menu even when its featured
-- burger changes, and a chain's locations share one ranking entry. Keys the site doesn't know are
-- stored but never shown.

create table public.burger_votes (
  menu_key   text        not null check (menu_key ~ '^(chain:)?[a-z0-9-]{1,120}$'),
  voter      uuid        not null,
  score      smallint    not null check (score between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (menu_key, voter)
);

-- RLS on with no policies: only the security-definer functions below touch it.
alter table public.burger_votes enable row level security;
revoke all on public.burger_votes from anon, authenticated;

-- Public running totals, written only by the trigger below.
create table public.burger_scores (
  menu_key   text        primary key,
  votes      integer     not null default 0 check (votes >= 0),
  total      integer     not null default 0 check (total >= 0),
  updated_at timestamptz not null default now()
);

alter table public.burger_scores enable row level security;
create policy "anyone reads burger scores" on public.burger_scores
  for select to anon, authenticated using (true);
revoke all on public.burger_scores from anon, authenticated;
grant select on public.burger_scores to anon, authenticated;

create or replace function public.burger_vote_apply() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.burger_scores
       set votes = votes - 1, total = total - old.score, updated_at = now()
     where menu_key = old.menu_key;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.burger_scores as s (menu_key, votes, total)
    values (new.menu_key, 1, new.score)
    on conflict (menu_key) do update
      set votes = s.votes + 1, total = s.total + excluded.total, updated_at = now();
  end if;
  return null;
end $$;
revoke all on function public.burger_vote_apply() from public, anon, authenticated;

create trigger burger_votes_apply after insert or update or delete on public.burger_votes
  for each row execute function public.burger_vote_apply();

-- Per-IP vote budget (hashed IP, one row per hour).
create table public.burger_vote_rate (
  ip_hash      text        not null,
  window_start timestamptz not null,
  votes        integer     not null default 0,
  primary key (ip_hash, window_start)
);
alter table public.burger_vote_rate enable row level security;
revoke all on public.burger_vote_rate from anon, authenticated;

-- The only way to vote. Returns the burger's new totals.
create or replace function public.cast_vote(p_menu_key text, p_voter uuid, p_score integer)
  returns table (menu_key text, votes integer, total integer)
  language plpgsql security definer set search_path = '' as $$
declare
  v_headers json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
  v_ip text := coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-real-ip',
                        split_part(v_headers->>'x-forwarded-for', ',', 1), 'unknown');
  v_used integer;
begin
  if p_score is null or p_score < 1 or p_score > 10 then
    raise exception 'score must be a whole number from 1 to 10' using errcode = '22023';
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
    raise exception 'too many votes from this connection; try again later' using errcode = '54000';
  end if;

  insert into public.burger_votes as v (menu_key, voter, score)
  values (p_menu_key, p_voter, p_score)
  on conflict on constraint burger_votes_pkey do update
    set score = excluded.score, updated_at = now()
    where v.score is distinct from excluded.score;

  return query
    select s.menu_key, s.votes, s.total from public.burger_scores s where s.menu_key = p_menu_key;
end $$;
revoke all on function public.cast_vote(text, uuid, integer) from public;
grant execute on function public.cast_vote(text, uuid, integer) to anon, authenticated;

-- A browser's own votes (so the picker can show what it already chose).
create or replace function public.my_votes(p_voter uuid)
  returns table (menu_key text, score smallint)
  language sql stable security definer set search_path = '' as $$
  select v.menu_key, v.score from public.burger_votes v where v.voter = p_voter;
$$;
revoke all on function public.my_votes(uuid) from public;
grant execute on function public.my_votes(uuid) to anon, authenticated;

-- Live updates: the site subscribes to changes in the public totals only.
alter publication supabase_realtime add table public.burger_scores;
