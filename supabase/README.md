# Supabase: the People's Top 10 (the Patty Ladder)

Visitors rank the burgers they like best; the site shows the crowd's ranking, the People's Top 10. The site
stays a static export: the browser talks to Supabase directly with the project's **publishable** key, and the
database decides what it may do. The ranking itself is computed once a day from public aggregates by a GitHub
job (`computeBoard`), not in the database and not in the browser.

**Project:** `burger-index`, ref `wtbtivqubzymhbmijnri`, region `us-east-1`, org "koolkam00's Org" (free plan).
URL `https://wtbtivqubzymhbmijnri.supabase.co`. Managed with the Supabase connector.

**Migrations** (file → name applied on the live project):

| file | applied as | what |
| --- | --- | --- |
| `20260925000000_burger_votes.sql` | `burger_votes` | the retired 1-10 rating; now only supplies `burger_vote_rate` |
| `20260925010000_whats_it_worth.sql` | `whats_it_worth`, `whats_it_worth_range_5_45`, `whats_it_worth_range_5_75` | "What's it worth?" (retired 2026-09-26, below) |
| `20260925020000_worth_one_per_connection.sql` | `worth_one_per_connection` | one answer per connection per burger |
| `20260925030000_worth_rate_150.sql` | `worth_rate_150` | 150 answers an hour per connection |
| `20260926000000_patty_ladder.sql` | `patty_ladder` | the force ranker's storage, RPCs, nightly refresh, owner tools; retires "What's it worth?" |
| `20260926010000_patty_ladder_fast_pairs.sql` | `patty_ladder_fast_pairs` | the nightly pair sums on integer ids (11.7 s → 2.8 s at 2,000 lists) |

The method is the Patty Ladder (user decisions 2026-09-25/26), specified in the ranker design's `FINAL.md` with
the reference implementation `ladder.mjs` and the simulator `sim.py`. This file covers the database half.

## Saving a list (no sign-in)

Each visitor submits **one strict ranking of 3 to 25 burgers**, best first, and can edit it. A burger is a menu
key: a restaurant id, or `chain:<slug>` for a chain (the same keys the dataset and the old worth answers use;
they never change).

- The browser makes a random voter id (a UUID in `localStorage`) the first time it saves.
- **`rpc/save_ranking(p_voter uuid, p_items text[]) → jsonb`** is the only write path.
  - Checks: a voter id; a one-dimensional list of 3-25 keys, each matching `^(chain:)?[a-z0-9-]{1,120}$`, no
    repeats. Keys are checked by format only: the board keeps to the dataset's keys (a key the dataset doesn't
    have, or no longer has, stays in the fit and never shows).
  - **One list per browser and per connection:** the save replaces the voter's own list, and marks `replaced`
    every other active list saved from the same connection in the last 30 days. The latest save wins, so fresh
    voter ids can't stack lists; a household or an office on one connection has one list.
  - The same list saved again from the same connection changes nothing (it keeps its day).
  - Returns `{"status": "active", "saved_on": "2026-09-26", "counts_from": "2026-09-27"}`. A list counts from
    the first nightly refresh after its save day (New York time); an edit keeps the previous version counting
    until then.
- **`rpc/get_my_ranking(p_voter uuid) → jsonb | null`** returns
  `{"items": [...], "status": "active" | "replaced" | "deleted" | "void", "saved_on", "counts_from" (null unless
  active), "in_board"}`. `in_board` is true when this exact version is in the last published aggregates.
  `replaced` means a newer list was saved from this connection: saving again makes this one count again.
- **`rpc/delete_ranking(p_voter uuid) → boolean`** withdraws the list (true when there was one to withdraw).

**Refusals.** Validation errors are HTTP 400, SQLSTATE `22023`; rate limits are HTTP 429 (SQLSTATE `PT429`,
which PostgREST turns into that status). The `message` is written for visitors; the `hint` is a stable code:

| hint | message |
| --- | --- |
| `missing_voter` | Something went wrong. Reload the page and try again. |
| `list_invalid` | That list doesn't look right. Reload the page and try again. |
| `list_too_short` | Pick at least 3 burgers. |
| `list_too_long` | A list holds at most 25 burgers. |
| `unknown_burger` | One of those burgers isn't on the Burger Index. |
| `duplicate_burger` | Each burger can be on your list only once. |
| `rate_connection` | Lots of lists were saved from this connection in the last hour. Try again later. (20 saves an hour per connection) |
| `rate_voter` | You've saved your list a lot today. Try again tomorrow. (10 saves a New York day per voter id) |
| `rate_network` | Lots of new lists came from this network today. Try again tomorrow. (30 new voter ids a day per /24 or /48) |

**What is stored** (`ranker_private.ranker_lists`): the voter id, the list as the visitor sees it, its New York
save day, the counted and the last published versions, a status, and two salted SHA-256 hashes: the
connection (the IPv4 address, or the IPv6 /64, since a device rotates its addresses inside it) and the network
(its /24 or /48). The salt is random, made when the migration ran, and lives only in
`ranker_private.ranker_state`; it is not a key and is never sent anywhere. The connection hash is cleared 30 days
after the last save; the network hash as soon as the list stops being active. No IP address is stored anywhere.
The client IP comes from the same request headers `cast_worth` read (`cf-connecting-ip`, `x-real-ip`, the first
`x-forwarded-for`).

## The nightly refresh

pg_cron (enabled by the migration) runs `ranker_private.ranker_refresh()` at `20 4,5 * * *` UTC. pg_cron runs in
UTC, and 00:20 New York is 04:20 UTC in summer and 05:20 UTC in winter; `ranker_due()` lets exactly one of the two
runs work each New York day (checked for summer, winter and both DST changeover days), and a run returns at once
if it already ran for that day. It rebuilds everything from scratch, as of **yesterday in New York** (`as_of`):

1. Each active list's last save through `as_of` becomes its counted version.
2. Replaced, deleted and void lists are out.
3. **Surge damping** (FINAL.md 3.3, the same numbers as `sim.py` `final_surge`), from every counted list before
   the duplicate collapse. For burger i and save day d: the window is d-6..d; its share
   s = (lists naming i saved before the window + 1) / (all lists saved before it + 1); T7 = max(5, 3·N7·s),
   T1 = max(3, 3·N1·s); factor = the smaller of min(1, (T + √(n - T))/n) over the windows where n > T. Off until
   500 lists precede the window. A list's weight f is the smallest factor among its burgers on its save day.
   A burger is **surging** when its factor on `as_of` is below 1.
4. **Duplicate collapse:** identical ordered lists of 5+ burgers count once in the fit (the earliest save).
5. **Aggregates** (FINAL.md 3.4): per pair a < b of keys sharing a list, w_ab = Σ f·0.8^(p-1)/(k-1) over the
   matchups a won (the winner at place p of a k-item list beats every burger below it), w_ba likewise, q = Σ (f·w)²;
   per burger: lists, weighted = Σ f, firsts, networks, surging, surge_support (fit lists naming it in their top
   half, 2p ≤ k + 1, saved on a day it was damped and not cleared) and held.
6. **The privacy batch:** the public tables are rewritten only when at least 20 counted lists changed since the
   last publication (new, edited or gone) and `as_of` is later than the last published day. On a quiet day
   nothing public changes and the changes add up until the next publication. The owner's review data (below) is
   rewritten every night either way.

Manual runs (SQL editor, as `postgres`): `select ranker_private.ranker_refresh(true);` runs it now for yesterday;
`select ranker_private.ranker_rebuild(date '2026-10-01');` for a given day (before today, not before the last
publication). Speed, measured on this project in rolled-back transactions: 2,000 lists 2.8 s, 10,000 lists of
3-25 burgers over 560 menus 6.5 s (156k pairs). The run log is `cron.job_run_details`; the last result is in
`ranker_private.ranker_state.last_run_result`.

## Public aggregates (read-only, no voter data)

Anyone with the publishable key can read these, and nothing else of the ranker:

| table | columns |
| --- | --- |
| `ranker_meta` | one row per publication: `as_of`, `total_lists` (lists in the fit, after the collapse), `counted_lists` (before it), `weighted_lists` (Σ f over the fit), `changed_since_last`, `params_version` (`patty-ladder/1`), `refreshed_at` |
| `ranker_items` | `key, lists, weighted, firsts, networks, surging, surge_support, held` |
| `ranker_pairs` | `a, b, w_ab, w_ba, q` with `a < b` |
| `ranker_surges` | every damped (burger, day): `key, day, n_day, n_week, expected_day, expected_week, t_day, t_week, factor, cleared` |
| `ranker_daily` | `key, day, lists_saved` (counted lists naming it, before the collapse) |
| `ranker_days` | `day, lists_saved` (all counted lists that day): with `ranker_daily`, enough to re-derive every surge flag |
| `ranker_actions` | the owner's actions: `id, day, key, action (void / clear_surge / hold / unhold), count` |

Keys use the `"C"` collation, so `a < b` and every order match JavaScript's string comparison.

**`rpc/ranker_board_inputs() → json | null`** (GET works: `/rest/v1/rpc/ranker_board_inputs`) returns the latest
publication in one consistent snapshot, or null before the first:

```json
{"format": "patty-ladder-inputs/1", "method": "patty-ladder/1", "as_of": "2026-10-01",
 "total_lists": 685, "counted_lists": 725, "weighted_lists": 683.1865457495659, "changed_since_last": 725,
 "refreshed_at": "2026-10-02T04:20:03.1+00:00",
 "items": [{"key": "b-9", "lists": 171, "weighted": 171, "firsts": 26, "networks": 119, "surging": false,
            "surge_support": 0, "held": false}, ...],
 "pairs": [[0, 1, 3.638071746031747, 2.1385287161904762, 0.8055745004183772], ...]}
```

`items` are sorted by key ("C" order); each pair is `[i, j, w_ab, w_ba, q]` with `i < j` indexes into `items`.
Floats are printed exactly (shortest round-trip form), so every reader fits the same numbers. At 10,000 lists it
is about 11 MB and takes 1 s (the anon role's limit is 3 s). No voter id, hash, IP or per-list time is in it.

**Privacy residue** (accepted in FINAL.md): a pair seen on a single list shows that some anonymous visitor ranked
A above B, and on a day with a single saved list `ranker_daily` shows which burgers that list named (never who,
never in what order).

## The owner's tools (SQL editor, as `postgres`)

The private schema `ranker_private` is not exposed by the API; none of this can be called with the site's key.

- `select * from ranker_private.ranker_review_queue;` burgers surging on the last `as_of`, over the review bar
  (surge support ≥ 25% of their lists: they can't take a new Top-10 seat), or held, with their counts.
- `select * from ranker_private.ranker_review_lists where key = '…';` the lists behind one: those saved on a
  damped day and every active list naming it saved in the last week, with the voter id, place, list, damping
  and how many active lists share its network. Never an IP or a hash.
- `select ranker_private.ranker_void(array['<voter id>'::uuid, …]);` voids lists (they drop out at the next
  refresh). A void sticks: that voter id's later saves stay void and replace nobody.
- `select ranker_private.ranker_clear_surge('<key>', date '<from>', date '<to>');` full weight back for that
  burger's lists saved on those days, and no surge flag or review for it on them. A burst's lists stay in the
  7-day window of the six days after it, so clear through the burst day + 6 to end the freeze.
- `select ranker_private.ranker_hold('<key>');` / `ranker_unhold('<key>')`: freeze a burger's published score
  both ways and keep it from taking a new seat (a seat it holds stays). `ranker_items.held` changes at once.

Each action is logged in `ranker_actions` (day, key, action, count; a void logs only how many lists). The
queue has no phi ("inconsistent record") flag and no raw-score burial watch: both need the fit, so they come from
the daily board snapshot.

## Deviations from FINAL.md

- **Private schema.** The private tables, the review views and the owner functions live in `ranker_private`, a
  schema the API doesn't expose, with RLS on and no grants, rather than in `public` with RLS alone.
- **Keys by format, no `ranker_keys` table** (build instruction): the board keeps to the dataset's keys.
- **"Surging" is the simulator's flag:** a burger's factor on `as_of` is below 1, which is `n > T + 1` in a window.
  FINAL.md's text says `n > T`; they differ only when the excess is at most one list, where the damping is 1
  anyway (a 4-list day at T = 3 damps nothing and does not freeze). This keeps the database's flags equal to
  `sim.py` `final_surge`, the definition the evidence was produced with, and `ranker_surges` (damped rows)
  re-derives them.
- **`ranker_board_inputs()` instead of `ranker_pairs_packed()`:** one call returns meta, items and pairs from one
  snapshot (PostgREST also pages table reads at 1,000 rows).
- **Extra public table `ranker_days`** and extra `ranker_meta.counted_lists`; `ranker_meta` keeps a row per
  publication.
- **Hashes:** salted SHA-256 (cast_worth used an unsalted md5); the IPv6 connection is the /64.
- **Replacement and removal are immediate** for the counted version: a replaced, deleted or voided list stops
  counting at the next refresh, and a replaced list saved again counts from the refresh after that save.
- **Owner actions reach the board at the next publication** (20 changed lists and a new `as_of`); the daily job
  refuses a stale `as_of`, so on a quiet site a hold, unhold or clear can wait days to show.

## Tested (2026-09-26, live project, every test in a transaction ended by an exception)

As `anon` with simulated request headers: save, read back, edit, the same list again; another browser on the
same connection replaces the first, a neighbour on the same /24 doesn't, the first saving again takes it back;
`cf-connecting-ip` wins over `x-forwarded-for`; IPv6 same /64 replaces, another /64 doesn't; delete; every
validation error above; the three rate limits refuse exactly the 21st, 11th and 31st call; anon and authenticated
can read only the public tables and call only the four RPCs (not the private schema, the owner functions,
`cast_worth`, `my_worth` or `burger_worth_hist`); no raw IP stored. The refresh on 725 synthetic lists
(background, a 40-list identical burst, a 5-list day, a 4-list day, a week trickle, a burger surging on `as_of`
through its week count alone, duplicates, and pending, edited, replaced, void and deleted lists) matched the
reference exactly: the same counted lists, the 50 damped list weights bit for bit against `sim.py` `final_surge`,
the same 40 lists collapsed, 7/7 damped days, 30/30 items, and 313 pairs against `ladder.mjs` `buildAggregates`
(same keys; sums equal to 6e-16). Also: the 20-list privacy batch (19 lists publish nothing, 20 do; 15 changes
wait; voids count), `in_board`, holds and unholds, a surge clear, the review queue and lists, the refresh guards,
the DST schedule, and `ranker_board_inputs()` (C order, exact floats, no uuid).
The security advisor lists only what is intended: the three `SECURITY DEFINER` visitor RPCs callable by anon
and authenticated (the only write path; they need owner rights to reach the private schema, and they validate and
rate-limit), and tables with RLS on and no policy (the private ranker tables, `burger_worth`, `burger_vote_rate`),
which is how they are kept private. The performance advisor is clean.

## "What's it worth?" is retired (user decision 2026-09-26)

The Patty Ladder replaces all crowd pricing. The `patty_ladder` migration revoked the site's access to
`cast_worth`, `my_worth` and `burger_worth_hist` and took `burger_worth_hist` out of the realtime publication, so
no new answers arrive. **Nothing was deleted:** `burger_worth`, `burger_worth_hist` and `burger_vote_rate` keep
their rows (1 answer on 2026-09-26), and the old read policy is still there; granting the privileges back would
reopen it. Until the site stops calling them, those calls fail with 401, and the `peoples-price.yml` workflow's
read fails (it exits 1 and writes nothing) until it is removed.

## Site configuration

`web/.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
`sb_publishable_…` key). On Vercel, the same two variables are set under Project → Settings → Environment
Variables. Never put the `service_role` / secret key anywhere in this repo, the site or a GitHub workflow: the
site and the daily job use only the publishable key.

## Before launch, and if spam shows up

There are no test lists (every test rolled back). To start over (SQL editor): `delete from
ranker_private.ranker_lists; delete from ranker_private.ranker_rate;` (the next refresh publishes the empty
aggregates once 20 published lists are gone). For a burst, use the review queue and the owner's tools above. If spam still gets through, lower the budgets in `save_ranking`, or add
Cloudflare Turnstile in front of saving.
