# "What's it worth?" (Supabase)

Visitors say what they'd pay for each burger ("What's it worth?"); the site shows the crowd's
People's Price live. The site stays a static export: the browser talks to Supabase directly
with the project's **publishable** key, and the database decides what it may do.

**Project:** `burger-index` — ref `wtbtivqubzymhbmijnri`, region `us-east-1`, org "koolkam00's Org"
(free plan). URL `https://wtbtivqubzymhbmijnri.supabase.co`. Set up 2026-09-25 with the Supabase
connector. Schema: `migrations/20260925010000_whats_it_worth.sql` plus
`migrations/20260925020000_worth_one_per_connection.sql` and `migrations/20260925030000_worth_rate_150.sql` (applied as migrations `whats_it_worth`,
`whats_it_worth_range_5_45`, `whats_it_worth_range_5_75`, `worth_one_per_connection` and `worth_rate_150`,
which raised the per-IP budget from 60 to 150 answers an hour for the pricer-first home page).
`20260925000000_burger_votes.sql` (the retired 1-10 rating) now only supplies `burger_vote_rate`.

## How it works: "What's it worth?" (no sign-in)

Visitors say, in whole dollars from **$5 to $75**, what they'd pay for a restaurant's burger; the
crowd's median is **the People's Price**, shown next to the menu price. (This replaced a 1-10
rating on 2026-09-25; the old objects were dropped — migration `20260925010000_whats_it_worth.sql`.)

- The browser makes a random voter id (UUID in `localStorage`) the first time it answers.
- `rpc/cast_worth(p_menu_key, p_voter, p_dollars)` is the only write path: checks a whole number
  5-75 and the key format, allows 150 answers per hour per client IP (md5 hash in
  `burger_vote_rate`), then inserts or updates the one `(menu_key, voter)` answer and returns the
  burger's answer count and median.
- **One answer per connection per burger** (`worth_one_per_connection`): each answer stores the
  same IP hash, unique per `(menu_key, ip_hash)`. An answer from a connection that already
  answered that burger replaces the earlier one, even from another browser, so fresh voter ids
  can't stack answers onto a burger. A household or office on one network shares one answer per
  burger. Answers from before the migration carry `legacy:<voter>` and count on their own.
- `rpc/my_worth(p_voter)` returns that browser's own answers (to pre-fill the slider).
- `burger_worth_hist` (menu_key, dollars, votes) is public, read-only, kept in sync by a trigger,
  and in the `supabase_realtime` publication: the site computes medians and draws distributions
  from it. `burger_worth` and `burger_vote_rate` are private (RLS on, no policies, no grants).
- `menu_key` is the dataset's menu key (restaurant id, or `chain:<slug>`).

Tested end to end with the publishable key on 2026-09-25 (answers, changed answer, median, bounds
$4/$76 rejected, $19.50 rejected, distribution readable, private table and forged writes denied).
The one-per-connection rule was tested in a rolled-back transaction (same connection, two
browsers: one answer; second connection: two; a browser moving to the other connection replaces
its answer there). The security advisor flags the two public `SECURITY DEFINER` functions and the
two policy-less private tables — both intended.

`cast_worth` accepts any key in the right format, not only the dataset's: the site asks for and
shows only the dataset's menus, and an allowlist would have to be refreshed on every data update.

## Site configuration

`web/.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(the `sb_publishable_…` key). On Vercel, add the same two variables under Project → Settings →
Environment Variables. Never put the `service_role` / secret key anywhere in this repo or the site.
Without the variables the site still builds; the slider says "Answers open soon."

## Before launch, and if spam shows up

Delete test answers before launch (SQL editor): `delete from public.burger_worth; delete from
public.burger_vote_rate;` — the trigger empties `burger_worth_hist` to match. To reset one burger:
`delete from public.burger_worth where menu_key = '…';`. If spam still gets through, lower the
per-IP budget in `cast_worth`, or add Cloudflare Turnstile in front of answering.
