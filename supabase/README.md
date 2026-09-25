# Burger votes (Supabase)

Visitors rate each burger 1–10 (whole numbers), one vote per visitor per burger (changeable); the
site shows a live ranking. The site stays a static export: the browser talks to Supabase directly
with the project's **publishable** key, and the database decides what it may do.

**Project:** `burger-index` — ref `wtbtivqubzymhbmijnri`, region `us-east-1`, org "koolkam00's Org"
(free plan). URL `https://wtbtivqubzymhbmijnri.supabase.co`. Set up 2026-09-25 with the Supabase
connector; schema in `migrations/20260925000000_burger_votes.sql` (applied as migration
`burger_votes`).

## How voting works (no sign-in)

- The browser makes a random voter id (UUID in `localStorage`) the first time it votes.
- `rpc/cast_vote(p_menu_key, p_voter, p_score)` is the only write path: checks the score is a whole
  number 1–10 and the key looks like a menu key, allows 60 votes per hour per client IP (stored as
  an md5 hash in `burger_vote_rate`), then inserts or updates the one `(menu_key, voter)` vote and
  returns the burger's new totals.
- `rpc/my_votes(p_voter)` returns that browser's own votes (to pre-fill the picker).
- `burger_scores` (menu_key, votes, total) is public, read-only, kept in sync by a trigger, and in
  the `supabase_realtime` publication for live updates. `burger_votes` and `burger_vote_rate` are
  private (RLS on, no policies, no grants).
- `menu_key` is the dataset's menu key (restaurant id, or `chain:<slug>`), so a vote follows the
  restaurant's menu even when its featured burger changes, and a chain's locations share an entry.

Tested end to end with the publishable key on 2026-09-25 (vote, change vote, reject 11 and 7.5,
read totals, read own votes, direct reads/writes of private tables denied); test rows deleted.
Supabase's security advisor flags the two public `SECURITY DEFINER` functions and the two
policy-less private tables — both intended.

## Site configuration

`web/.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(the `sb_publishable_…` key). On Vercel, add the same two variables under Project → Settings →
Environment Variables. Never put the `service_role` / secret key anywhere in this repo or the site.
Without the variables the site still builds; the voting section says voting isn't open yet.

## If spam shows up

Lower the per-IP budget in `cast_vote`, or add Cloudflare Turnstile in front of voting. To reset a
burger: `delete from public.burger_votes where menu_key = '…'` (the trigger updates the totals).
