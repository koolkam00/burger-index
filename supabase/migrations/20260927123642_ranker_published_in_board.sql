-- The published lists' audit view (public.ranker_published_lists): `in_board` says whether this exact list is in the
-- last published aggregates, whatever its status (review 2026-09-27). ranker_void leaves published_items alone, and
-- only the next publication (the 20-list batch) clears it, so a voided list is still counted by the published board
-- until then; the view read false at once (it also required status 'active'), under-reporting what the board holds.
-- Only the in_board expression changes; the function's signature, rights and the view are as before.
-- (get_my_ranking keeps its own in_board, which a visitor's list reads with its status: unchanged.)

create or replace function public.ranker_published_lists_rows()
  returns table (publisher text, title text, url text, list_date date, burgers integer, items text[],
                 list_id text, added_on date, status text, in_board boolean)
  language sql stable security definer set search_path = '' as $$
  select p.publisher, p.title, p.url, p.list_date, cardinality(l.items), l.items, p.list_id, p.added_on, l.status,
         l.published_items is not null and l.published_items = l.items and l.published_on = l.saved_on
    from ranker_private.ranker_published p
    join ranker_private.ranker_lists l on l.voter_id = p.voter_id
   where l.origin = 'published'
   order by p.list_date desc, p.list_id;
$$;
revoke all on function public.ranker_published_lists_rows() from public, anon, authenticated;
grant execute on function public.ranker_published_lists_rows() to anon, authenticated;
comment on function public.ranker_published_lists_rows() is
  'Patty Ladder: the published rankings seeded as lists, for public.ranker_published_lists (no voter id or hash). in_board: this exact list is in the last published aggregates (a voided list stays in them until the next publication).';
