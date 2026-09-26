# The Burger Index: website

The public site for the NYC Burger Index: the median index price across the New York menus we have priced, from
the restaurants in the pipeline's scope (by default our curated list of burger restaurants).
It is a fully static Next.js site (App Router, TypeScript strict, Tailwind v4, zod). There is no server code and no secret key: the Python
pipeline writes one JSON file, and `next build` turns it into plain HTML in `out/`. The one live part, the burger ranker, talks to
Supabase straight from the browser with a public key (see "The burger ranker (Supabase)" below). Product analytics (PostHog) run in
the browser too, only in builds that have the PostHog key (see "Analytics (PostHog)").

Design rules live in [`../DESIGN.md`](../DESIGN.md) (fonts, color tokens, components, voice). Read it before changing anything visual.

## How data gets in

```
pipeline (Python) ──> ../data/burger_index.json ──> npm run sync-data ──> src/data/burger_index.json ──> next build ──> out/
                          (contract: ../contract/burger_index.schema.json)
```

1. `scripts/sync-data.mjs` runs automatically before `dev` and `build`. It copies `../data/burger_index.json` (committed) into
   `src/data/`. There is no sample data: if that file is missing, `dev` and `build` stop with a message saying how to get it back
   (`.venv/bin/python -m pipeline build` from the repo root rewrites it from the scrape cache).
2. The same script validates the file against the JSON Schema contract (ajv, draft 2020-12 with formats). Invalid data stops the build.
3. `src/lib/data.ts` (server-only) parses it again with the zod mirror in `src/lib/schema.ts` and checks that restaurant ids
   are unique. All pages read data through its typed selectors: `getStats()`, `getPricedRestaurants()`,
   `getPricedRestaurant(id)`, `getNeighborhoodPages()`, `getNeighborhood(slug)`, `getBorough(slug)`, and others.

The dataset (contract version 2) carries only what the site reads. A restaurant comes in one of two shapes, picked by
`index_price`: a `PricedRestaurant` (a page: address, coordinates, links, price source, `index_price`, its one `burger`
`{name, description}` and `hand_check` `{checked_on}` or null) or an `UnpricedRestaurant` (a name on its neighborhood's
page: `id`, `name`, `address`, `neighborhood_slug`, with `index_price` and `burger` null). `isPriced` / `isUnpriced` in
`data.ts` tell them apart.

`src/data/` and `public/vendor/` are generated; both are gitignored.

## Run it locally

Requires Node 20.15 or later (the share images use `zlib.crc32`); `npm test` needs Node 22.6 or later (it runs the
TypeScript tests with `--experimental-strip-types`). Vercel builds on Node 22.x.

```bash
cd web
npm install
npm run dev            # http://localhost:3000, from ../data/burger_index.json
```

Local runs send no analytics: the PostHog key is set only on Vercel, never in `web/.env.local`.

Build and preview the static export:

```bash
npm run build          # writes out/
npm run preview        # serves out/ at http://localhost:4173
```

Checks (all must pass with zero errors):

```bash
npm run lint
npm run typecheck      # next typegen && tsc --noEmit
npm test               # node:test on the TypeScript in src/lib (test/*.test.ts, no extra deps; reads ../data/burger_index.json)
npm run build
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run sync-data` | Copy and validate the dataset (runs before dev and build) |
| `npm run validate:data [file]` | Validate a dataset against the contract (defaults to `../data/burger_index.json`) |
| `npm run check:seo [-- --site https://…]` | After a build: check `out/` (titles, descriptions, canonicals, JSON-LD, sitemap, robots, llms.txt, CSV, internal links); see "Search engines and AI assistants" |
| `npm run indexnow [-- --dry-run] [-- --site https://…]` | After a production deploy: submit the live sitemap to IndexNow |
| `node scripts/snapshot-peoples-top.mjs [--out PATH] [--inputs-out PATH] [--allow-drop]` | Compute the day's People's Top 10 (the Patty Ladder) from the public aggregates in Supabase (read-only GETs) into `../data/peoples_top.json`; the daily workflow runs it on `main` (see "The People's Top 10 (daily board)") |

## The burger ranker (Supabase)

User decisions 2026-09-25/26: the ranker replaced all crowd pricing ("What's it worth?", the home pricer, the People's Price,
`/peoples-price` and `/best-value-burgers` are gone; the old answers stay stored in Supabase, hidden, and none are accepted).
The home page opens on it (`#rank`; DESIGN.md "The ranker hero"): search the priced burgers (every distinct menu, a chain once),
add 3 to 25 of them best first ("your top 10", with room for more), move them with up and down buttons, remove them, and save.
A returning browser sees its saved list, what it counts for ("Saved. It counts from Sep 27, 2026.", "Counted in the People's
Top 10.", "Not counted: a newer list was saved from this connection. Save again to count this one."), and can edit or delete
it (a voided list, "Not counted.", can be edited but not deleted: the backend keeps it void). One list per browser and per
connection: the backend keeps the latest. A burger saved in a list must be one of the dataset's menus (the database's
`ranker_keys`, synced by `scripts/ranker-keys-migration.mjs`). The header's "Rank your burgers" links to `/#rank`
from every page (on home it scrolls to the ranker and focuses it). The crowd's ranking is the People's Top 10 below.

The backend is the Supabase project `burger-index`; its schema, the three RPCs (`save_ranking`, `get_my_ranking`,
`delete_ranking`), the refusals and rate limits are in [`../supabase/README.md`](../supabase/README.md).

Configuration: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the project's **publishable** key, `sb_publishable_…`)
in `.env.local` (gitignored) and in the Vercel project. Both are public by design: the database lets that key call the three
RPCs and read the public aggregates, nothing else. Without them the site still builds; the ranker says "Lists open soon." and
fetches nothing.

- `src/lib/supabase-config.ts`: the two variables (`RANKER_ENABLED`).
- `src/lib/voter.ts`: the anonymous voter id, a `crypto.randomUUID()` in `localStorage` under `burger-index-voter` (in memory
  when storage is blocked; the key keeps the name the old worth store gave it, so a returning browser keeps its id), made on the
  first save. Tested in `test/voter.test.ts`.
- `src/lib/ranker-api.ts`: the only module that talks to Supabase. `@supabase/supabase-js` is imported lazily on the first call,
  so it is its own chunk and loads only when the ranker needs it: a returning browser's saved list on mount, else the first
  save. Refusals come back as HTTP 400 (SQLSTATE 22023) and rate limits as 429 (PT429), each with a stable `hint` code.
- `src/lib/ranker.ts`: pure helpers: the list's limits and edits, the burgers as the ranker shows them (a chain at its usual
  location with "N locations"; a name two menus share gets its neighborhood), search (accents and dots folded), the replies
  checked, the status lines and the error copy. Tested in `test/ranker.test.ts`.
- `src/lib/ranker-store.ts`: the ranker's state as an external store (the burgers, the saved list, the list on the card, what
  is on its way); an unsaved list is kept in `sessionStorage` (`bi-ranker-draft`), and `localStorage` `bi-ranker-saved` says
  this browser has a saved list, which the `<head>` script turns into `html.ranker-saved` (a skeleton, not an empty list,
  until the saved one loads). Every storage access is wrapped. Tested with a fake backend in `test/ranker-store.test.ts`.
- `src/lib/menu-list.ts` and `src/app/data/menus.json/route.ts`: the force-static `/data/menus.json` (every distinct priced
  menu with its priced locations, and the neighborhoods' names), fetched when the ranker mounts (and by the badge page's
  finder), so no menu sits in the home page's HTML.
- `src/components/ranker/`: `Ranker` (the card: search, the list with its controls, save, the saved view, edit, delete with a
  confirmation, loading, error, rate-limit and closed states; focus follows each step and a polite live region says what
  changed) and `PeoplesTopLink` (a link to the People's Top 10 that reports `peoples_top_clicked`).

### The People's Top 10 (daily board)

User decisions 2026-09-25/26: each visitor saves one strict ranking of 3 to 25 burgers (the ranker above; Supabase
`save_ranking`, one list per browser and per connection; see [`../supabase/README.md`](../supabase/README.md)), and the
crowd's ranking is **the Patty Ladder**. In one sentence, the one the page carries as its only method line: "Every list
turns into head-to-head wins, with your #1 counting most; a burger you left off never loses, and a burger climbs only as
far as enough different lists back it up."

```
Supabase ranker lists ──(pg_cron, 00:20 New York: surge damping, duplicate collapse, public aggregates)──> rpc/ranker_board_inputs
rpc/ranker_board_inputs ──(read-only GET, publishable key)──> scripts/snapshot-peoples-top.mjs + src/lib/ladder.mjs ──> ../data/peoples_top.json
   (.github/workflows/peoples-top.yml, 10:00 UTC daily: commits it to main when it changed ──> Vercel production deploy)
```

- **The method** (`src/lib/ladder.mjs`, a port of the ranker design's reference `ladder.mjs`; plain JS with no imports, so
  the workflow needs no npm install): `computeBoard(inputs, yesterday)` turns each list into head-to-head matchups (the burger
  at place p beats every burger below it with weight 0.8^(p-1)/(k-1), times the list's surge weight), fits strengths
  (Bradley-Terry with one virtual win and one loss against an average burger; damped Newton to 1e-10, at most 100
  iterations, else `LadderFitError`), scores each burger cautiously (θ - max(0, sd - 0.2)), moves the published score at
  most 0.25 a day (frozen while the burger is surging or held by the owner), ranks burgers on at least
  clamp(ceil(0.5% of weighted lists), 5, 50) weighted lists from half as many networks (80% of that to stay ranked), lists
  the rest with 3+ as Rising ("needs N more lists"), and seats the Top 10: incumbents stay while ranked; a newcomer needs
  two boards running in the computed ten, to beat the weakest seat by 0.05 when full, and no surge review or hold.
  `refreshInputs(lists, {asOf, held, cleared})` is the JS twin of the nightly database refresh (for tests and audits),
  `buildAggregates(lists)` the aggregates alone.
- **The file** `../data/peoples_top.json`: `version`, `method` (`patty-ladder/1`), `params`, `asOf` (the last New York save
  day counted), `refreshedAt`, `inputsSha256` (the SHA-256 of the aggregates' response body), `totalLists`, `countedLists`,
  `weightedLists`, `gate`, `early` (fewer than 500 lists), `iterations`, `top10`, `computed10` and `rows` (one per burger in
  the fit that the dataset has, ranked rows in board order, then rising, then listed: `key, tier, rank, score, theta, sd,
  phi, raw, lists, weighted, firsts, networks, needs, surging, inconsistent, held, review, frozen, aheadP, closeToNext`).
  Two-space JSON with one row per line, so a day's diff reads burger by burger. Before the first publication it is the
  empty early board. Yesterday's file is the ladder's only memory: never edit it by hand.
- **The writer** (`scripts/snapshot-peoples-top.mjs`): GETs `rpc/ranker_board_inputs` with the publishable key (it refuses
  a secret or service_role key), checks the reply, runs `computeBoard` with the committed board as yesterday, keeps only the
  dataset's menu keys in the file (other keys stay in the fit), and writes the file only when it changes (deterministic:
  no wall-clock stamp). A quiet day (aggregates as of the board's own day: the database publishes only once 20 lists
  changed) writes nothing. It exits 1, writes nothing and keeps yesterday's board on a failed or odd read, another method's
  aggregates, aggregates older than the board or none after one, counted lists down by more than 20% beyond the published
  lists the owner voided (`--allow-drop` overrides), or a fit that did not converge. `--inputs-out PATH` saves the
  aggregates read. Each new board also prints the owner's watch as GitHub warnings: "Burial watch" (a raw score down more
  than 0.5 since the committed board) and "Inconsistent record" (phi ≥ 2.5); they change nothing on the board.
- **The keys** (`scripts/ranker-keys-migration.mjs`): `save_ranking` accepts only the dataset's menu keys, set in the
  database by the latest `../supabase/migrations/<version>_ranker_keys.sql`. When the priced menus change, `--write` makes
  the next one; apply it with the Supabase connector (`apply_migration`, name `ranker_keys`). `test/ranker-keys.test.ts`
  fails while the latest sync differs from the dataset.
- **The workflow** (`../.github/workflows/peoples-top.yml`): daily at 10:00 UTC and on `workflow_dispatch` (with an
  `allow_drop` input); checks out `main`, Node 22, runs the writer, keeps the aggregates as the `ranker-board-inputs`
  artifact for 90 days, and if the file changed commits "Update People's Top 10" as `github-actions[bot]` and pushes to
  `main` (`permissions: contents: write`, no secrets). It runs only from the default branch. **Once merged, the file belongs
  to it: branches never edit or commit `data/peoples_top.json`** (merge `main` in to get the latest). GitHub disables the
  schedule after 60 days without repository activity; re-enable it with `gh workflow enable peoples-top.yml`.
- **The page** (`/peoples-top-10`, `src/app/peoples-top-10/page.tsx`, `src/components/PeoplesTop.tsx`): `sync-data` copies the
  file to `src/data/` (the empty early board when it is missing or broken, with a warning); `src/lib/peoples-top-data.ts`
  (server-only) reads it once per worker, checks it with the zod mirror in `src/lib/peoples-top-schema.ts` (a board that
  doesn't check out is the empty one, with a warning) and joins it to the dataset's menus through `src/lib/peoples-top.ts`
  (pure): only burgers the dataset still has, numbered with the seats first (a seat whose burger left goes to the best ranked
  burger not under review, as the method fills a seat), "≈" only between rows that are neighbors on the board too. The page
  shows the 10 seats ("The top 3 so far." early on), the rest of the ranking, Rising ("On 7 lists · needs 3 more lists"),
  "Early results" under 500 lists, "Under review" (an owner hold) and "Checking a surge of lists" (the surge review bar),
  the one-liner, and before anything is ranked "The ladder starts when burgers are on 5 lists each (12 lists so far)."
  (before the first board, with no count: the lists saved so far aren't published yet)
  ItemList JSON-LD only; its own share image; in the sitemap (dated by the board), llms.txt, the nav, the footer and "More
  burger rankings."; `/best-burgers` rows show a ranked menu's People's rank. Tested in `test/peoples-top.test.ts`.
- **Tests:** `test/ladder.test.ts` (weights, the fit, the surge rule as the database applies it, the cautious score, step,
  freeze, gate, keep band, network floor, Rising, seats, review bar, hold, early label, rounding, determinism, the refusal
  of an unconverged fit); `test/ladder-golden-*.test.ts` replay the design's four attack scenarios (a one-day burst, a
  trickle, the trickle then three honest weeks, a burial; seed 1000, 149 daily boards) from their lists and must match the
  design's simulator: surge weights bit for bit, the same surge flags, surge support and Top 10 every day, scores within
  1e-6 (fixtures in `test/fixtures/patty-ladder/`, gzipped); `test/peoples-top-snapshot.test.ts` covers the writer with
  Supabase faked.

## Analytics (PostHog)

The site sends product analytics to the PostHog project "Burger Index" (id 628020, US cloud). Nothing on the page changes:
there is no banner, and surveys, product tours and the conversations widget are switched off in code. Cookies are allowed
(user decision 2026-09-25), so there is no consent banner.

- **Off without the key.** `NEXT_PUBLIC_POSTHOG_KEY` is read at build time. Without it (local dev, local builds, tests)
  `posthog-js` is never loaded and no request goes to PostHog; `track()` does nothing. Its chunk is still emitted into `out/`,
  but nothing ever fetches it.
- **Start-up:** `src/instrumentation-client.ts` (Next's client instrumentation file, run before hydration) calls
  `initAnalytics()`, which imports `posthog-js` in its own chunk and starts it with `defaults: "2026-08-30"`, the newest config
  defaults of the installed version: among them a `$pageview` on every client-side navigation that changes the path (the page
  left behind rides along as `$prev_pageview_*` properties), `$pageleave` when the visitor leaves the site, and URL hashes
  stripped. A client-side `$pageview` carries no `title`: posthog-js sends it before Next has swapped in the new page's
  `<title>`, so `before_send` drops the stale one (a full page load keeps its title).
  Events tracked before it has loaded are queued (up to 50).
- **Automatic, per the project settings:** `$pageview`, `$pageleave`, autocapture, web vitals, heatmaps and session replay. The
  explorer's filter URL updates (`replaceState` with a new query string) are not pageviews: only path changes are.
- **Custom events** (`src/lib/analytics.ts`, the typed `AnalyticsEvents` map; components call `track()`):

| Event | Properties | Sent from |
|---|---|---|
| `burger_search` | `surface` (`burgers`), `query`, `results` | the /burgers search box, once typing pauses for 1 s; empty and repeated queries are skipped (the ranker's search sends nothing) |
| `burger_filter_changed` | `filter` (`borough`, `neighborhood`, `price`, `sort`, `clear_all`), `value`, `results` | every /burgers control: filter popovers, the mobile sheet, chips, price presets, the sort select and the column headers |
| `ranking_started` | `edited` (the list being changed was saved before) | the first change to a list in the home ranker (a new one, or the saved one being edited) |
| `ranking_item_added` | `menu_key`, `position` (1-based: the list's new length) | "Add" in the ranker's search |
| `ranking_saved` | `length`, `edited` | a list saved (once Supabase saved it) |
| `ranking_deleted` | `length` | "Delete my list", confirmed and done |
| `peoples_top_clicked` | `surface` (`nav`, `menu_sheet`, `ranker`, `home`), `from_path` (the path only: no query, no hash) | a link to the People's Top 10 in the header nav, the menu sheet, the ranker card or under the home board |
| `map_pin_opened` | `restaurant_id`, `source` (`pin` tapped, or `link` for `/map?r=<id>`, once per visit: a List/Map round trip reopens the popup without sending it again) | `MapCanvas` |
| `map_popup_link_clicked` | `restaurant_id` | the restaurant link in a map popup |
| `map_view_changed` | `view` (`map` / `list`) | the Map / List toggle |
| `menu_link_clicked`, `website_link_clicked` | `restaurant_id`, `host`, `price_source` | "Menu page:" and "Website:" on restaurant pages (`components/RestaurantLinks.tsx`) |
| `see_on_map_clicked` | `restaurant_id` | "See it on the map" |
| `snippet_copied` | `surface` (`badge` / `press`), `what` (`badge_html`, `badge_image`, `citation`), `restaurant_id` (a badge only) | a "Copy" button on `/badge` or `/press` (`components/CopyField.tsx`), once the text is on the clipboard |

- **No personal data.** Events carry ids, prices, counts, paths and control names. The only free text is the search query: trimmed,
  lowercased and cut to 60 characters. The full query in the page URL (`?q=`) is replaced by `<MASKED>` in every URL PostHog
  records (`mask_personal_data_properties` with `q`, plus a `before_send` for referrers). Session recordings mask the search
  boxes (every input) and the search text echoed in the "No burgers match “…”" messages (`ph-mask`). The voter id never
  reaches an event, a ranking's events carry its length and menu keys but never the list, and session recordings drop
  Supabase request bodies (they carry the voter id and the list).
- **Proxy:** in production `posthog-js` talks to `/ingest` on the site itself; `web/vercel.json` rewrites `/ingest/static/*` and
  `/ingest/array/*` to `https://us-assets.i.posthog.com` and the rest of `/ingest/*` to `https://us.i.posthog.com`, so ad
  blockers that block PostHog's domains don't drop the events. The site has no Content-Security-Policy to update.
- **Bots:** `posthog-js` drops events from automated browsers (headless Chrome, `navigator.webdriver`), so a Playwright or
  gstack check sees no events unless it poses as a normal browser.
- **Tests:** `test/analytics.test.ts` (off without a key, loading and queueing, property shaping, URL masking, the debounce, the
  ranker's events).

## Search engines and AI assistants

User decisions of 2026-09-25 (SEO, answer engines and generative search). Everything is static and built from the dataset.

- **Titles and descriptions:** `src/lib/seo.ts` builds them for every page type from the real numbers and the month
  ("Allswell: $22 burger in Williamsburg", "Burger prices in Astoria: $17.25 median"); pages pass the numbers in and
  `pageMetadata()` (`src/lib/metadata.ts`) adds " · The Burger Index" only when the title stays within 60 characters.
  Descriptions are sentences assembled to at most 160 characters. Every title and description is unique (restaurant titles
  that would repeat, such as chain locations, name the street address: `sharedTitleIds`). `sourceLine()` is the one plain
  source/date line ("Prices from restaurant menus and ordering pages, checked September 2026."), shown under the home H1 and
  in the footer.
- **Ranking pages:** `src/lib/rankings.ts` defines the lists and their rows (`rankingSpecs`; `rankMenus`: distinct menus in
  the site's usual cheapest/priciest order, a chain once with its location count, ties sharing a rank; the first 25 or half
  the place's menus, whichever is fewer (`rankingCap`), plus every menu tied at the cut, or every row under $N or of a style):
  the 14 NYC and borough lists; each neighborhood's cheapest and most expensive when it has at least 10 distinct priced menus
  and the two lists share no menu (`neighborhoodsWithRankings`, `MIN_NEIGHBORHOOD_MENUS`; 13 neighborhoods today); and the
  burger-style lists (`stylesWithRankings`: the spots whose priciest burger is a smash, double, wagyu, dry-aged burger or
  patty melt, from the conservative classifier in `src/lib/styles.ts`, for the styles with at least 10 menus; patty melt has
  5, so no page). `components/RankingPage.tsx` draws them (breadcrumbs, a ticket, the H1, a one-line answer, the table, a link
  to the same list on `/burgers` (none for a style: the explorer has no style filter), "More burger rankings.") and
  `rankingSeo()` titles them. Each route is a thin static page reading `src/lib/ranking-routes.ts`:
  `app/cheapest-burgers/page.tsx`, `app/cheapest-burgers/[borough]/page.tsx`, `app/cheapest-burgers/[borough]/[neighborhood]/page.tsx`
  (both params come from the child, since `[borough]` has no layout), the same for `most-expensive-burgers`,
  `app/burgers-under-15|20/page.tsx` and `app/burgers/[style]/page.tsx`. They are linked from the home and borough card lists
  ("See all"), `/burgers`, every ranking page ("More burger rankings.": a neighborhood's own pair first, New York City, Burger
  styles, the boroughs), each neighborhood page with lists (two links under its restaurant heading and its Q&A) and the
  footer's "Rankings" group (the NYC lists), never the nav.
- **The most-recommended burgers (`/best-burgers`, user decisions 2026-09-25):** places ranked by how many distinct publishers
  named them on a best-burger list published or updated in 2024-2026 (ties share a rank and go by name), shown in groups of one
  publication count ("Named by 10 publications" … "Named by 1 publication", `groupBestBurgers`), each with every list
  that names it (publisher, title linked, date, the burger it names), our menu price and burger (linked to the restaurant
  page's burger block, or "Not priced") and, where the menu is ranked, its People's rank ("#3 on 143 lists", from the daily
  board). The data
  is `../data/best_burgers.json` (committed, curated by hand, facts only: no list text; no Upper Cut Media House lists, no
  trend features, beef burgers only, no closed places; one publisher is enough, so every open place a counted list names is
  on it), copied by `sync-data`, checked by
  `src/lib/best-burgers-data.ts` (server-only: the build fails on a bad file) and ranked by `src/lib/best-burgers.ts`
  (`rankBestBurgers`, `bestBurgersProblems`). To change a list, edit the JSON (ids from `data/burger_index.json`), then run
  `npm test` (`test/best-burgers.test.ts`) and `check:seo`.
  **Honest wording (user decision 2026-09-25):** each restaurant publishes only its priciest burger, so the cheapest and
  under-$N lists rank burger spots by it and say so: "Cheapest burger spots in NYC.", "Burger spots in NYC where the priciest
  burger is under $15.", "The priciest burger at Johnny's Reef is $6.00, the lowest top-burger price of any spot in NYC
  (September 2026).", and the Q&A "Where are burgers cheapest in NYC?". Each count matches its noun: "burger spots" counts
  locations ("At 96 burger spots in NYC, …", `rankMenus(…).spots`), the ranked rows are "menus", a chain once ("The 25
  cheapest of 531 menus in NYC.", `.total`); `check:seo` checks both. Nothing says "the cheapest
  burger in …", "cheapest burgers in …" or "burgers under $15" (`check:seo` fails on those phrases anywhere in the build). The
  most expensive lists keep "Most expensive burgers" (each row is the priciest burger at its spot). Sentences place things "on
  the Upper East Side / Upper West Side / Lower East Side" and "in" everywhere else (`inNeighborhood`, `inNeighborhoodPlace` in
  `src/lib/boroughs.ts`).
- **Q&A blocks:** `src/lib/answers.ts` builds plain answer-first sentences from the dataset (`cityFaq`, `boroughFaq`,
  `neighborhoodFaq`; `endSentence` and `underSentence` also make the ranking pages' one-line answers). Each answer is a list of
  text and link segments; `components/QandA.tsx` renders them as a `<dl>` and emits FAQPage JSON-LD from the same segments
  (`segmentsText`), so the markup is the visible text word for word.
- **JSON-LD:** pure builders in `src/lib/jsonld.ts`, rendered by `components/JsonLd.tsx` as a native
  `<script type="application/ld+json">` (Next 16 guide "JSON-LD"); `serializeJsonLd` escapes `<`, `>` and `&` so data can
  never close the tag. Home: WebSite, Organization, Dataset (the CSV as a `DataDownload`, `license` CC BY 4.0: `CSV_LICENSE`
  in `src/lib/csv.ts`, which llms.txt names next to the CSV link and the footer links after it) and
  an ItemList per cheapest/priciest card list (`menuEndsLists`, the same lists `MenuEnds` draws). Restaurant pages:
  Restaurant (PostalAddress, GeoCoordinates, `sameAs` the restaurant's site) → Menu → MenuItem → Offer (price, USD).
  Every page below home: BreadcrumbList (the visible breadcrumbs where the page shows them). `/neighborhoods`: an ItemList of
  the ranking; neighborhood pages: an ItemList of the restaurant table (`byIndexPrice`); ranking pages: an ItemList of the
  ranked table. Home, borough and neighborhood pages: FAQPage (the Q&A block). `/peoples-top-10`: an ItemList of the ranked
  rows. The People's Top 10 is never marked up as a Review, Rating or AggregateRating.
- **robots.txt** (`src/lib/robots.ts`): every crawler is allowed, AI search and training bots are named (OAI-SearchBot,
  ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, GPTBot, ClaudeBot, Google-Extended,
  Applebot-Extended, CCBot), and only the analytics proxy `/ingest/` is disallowed.
- **`/llms.txt`** (`src/lib/llms.ts`) and **`/data/burger-prices.csv`** (`src/lib/csv.ts`: `restaurant, neighborhood, borough,
  burger, price_usd, source, page_url, checked`; RFC 4180 quoting, CRLF, UTF-8, formula-looking text cells prefixed with `'`)
  are force-static route handlers. llms.txt lists every ranking page (neighborhood and style lists included),
  `/best-burgers` and the People's Top 10 (with its first three) under "Rankings".
- **Share images, the price badge, the press kit (user decisions 2026-09-25, stage 4):**
  - Every restaurant, neighborhood, borough, ranking and style page and `/best-burgers` names its own 1200×630 share image,
    `/og/<page path>.png` (`og:image`, `twitter:image` and their alt text through `pageMetadata({ image })`); the rest keep
    `/og.png`. `src/lib/share-images.ts` says what each card holds (a board: the name, burger and price, or the area's median
    and menu count; a list: the page's ticket, H1, first three rows and count line) and fits the text; `src/lib/share-cards.ts`
    (server-only) builds one per page from the dataset; `components/og/board.tsx` holds the Order Board pieces `/og.png`
    uses too, `components/og/cards.tsx` the two cards; `app/og/[...path]/route.tsx` renders each at build time with next/og and
    stores it in 256 colors (`src/lib/png-palette.ts`: median cut, no dithering; about a third of next/og's RGBA file, no
    visible change). 734 images, about 24 MB; they make `npm run build` take about 2 minutes (from 17 s) on a 12-core Mac.
  - `/badge/<id>.svg`: a 300×84 badge for every priced restaurant ("$22 burger", "10% above the $20.00 NYC median", "THE
    BURGER INDEX · SEP 2026"; `src/lib/badge.ts`), drawn by `satori` (a dependency, pinned to the version next/og bundles)
    in `app/badge/[file]/route.tsx`, so the text is outlines and looks the same on any site; `src/lib/svg-path.ts` rewrites
    the outlines relative to the pen (about half the size). Files, not pages: never in the sitemap. `/badge`
    (`app/badge/page.tsx`, `components/badge/`) explains it: the badge of `?r=<id>` (each restaurant page's "Get its price
    badge") or an example, a finder over `/data/menus.json`, the HTML and the image address to copy, how to add it.
  - `/press`: the headline numbers and borough medians from the dataset, the source line, the CSV and its CC BY 4.0 license
    with a credit line to copy (`src/lib/press.ts`), the share image, a short description, and the contact: GitHub issues
    (`src/lib/contact.ts`). The site publishes no email address.
  - Restaurant pages: "Nearby at a similar price." (`src/lib/nearby.ts`): up to 4 other priced spots within 1.5 km whose
    price is within $4, nearest first, a menu once and never the page's own chain, then the same neighborhood, closest in
    price first; "More in …" leaves out what it shows.
  - `/press` and `/badge` are linked from the footer and listed in the sitemap and llms.txt.
- **IndexNow:** `public/<key>.txt` holds the key (public by design: IndexNow fetches it to check we control the host). After
  each production deploy, from `web/`: `SITE_URL=https://<production host> npm run indexnow` (or `-- --site https://…`). It
  checks that the live site serves the key file, reads the live sitemap, refuses URLs on another host, and POSTs them to
  `https://api.indexnow.org/indexnow` (Bing, Yandex, Seznam, Naver and the others that share it). `-- --dry-run` checks
  and prints without sending; `-- --sitemap out/sitemap.xml` reads a local build's sitemap instead.
- **Check a build:** `npm run check:seo` reads `out/` and the dataset: one `<title>`, a description, an absolute
  self-referencing canonical and one `<h1>` per page, no skipped heading levels, JSON-LD that parses, has the expected types
  and matches the page (names, prices, breadcrumbs, list order), each ranking table (ranks, restaurants, prices, count line
  and ItemList) against a ranking it recomputes from the dataset, its description naming every menu sharing first place (and that exactly the neighborhoods with 10+ menus and
  non-overlapping lists have them, each linked from its neighborhood page), each style list row by row (distinct menus,
  dataset prices, order, ranks, a style word in each burger, the "where the priciest burger is a …" H1), `/best-burgers`
  against `../data/best_burgers.json` (groups and their place counts, rows in order, prices, every list link, the count line, the ItemList), no "best
  burger" in our own titles, descriptions or H1s, `/peoples-top-10` recomputed from `../data/peoples_top.json` and the dataset
  (seats, the rest and Rising row by row with ranks, list counts, flags and links; the ItemList; "Early results" exactly while
  early; the one-liner; each `/best-burgers` row's People's rank), no "People's Price", "What's it worth" or "Price a burger"
  left anywhere and `/peoples-price`, `/best-value-burgers` and `/data/pricer.json` not built, the ranker's region on home,
  any `/_none` placeholder noindex and unlisted, every page's share image (its own `/og/<path>.png` for restaurant,
  area, ranking, style and most-recommended pages, else `/og.png`; a 1200×630 PNG that exists; an alt naming the page's
  price or H1; no image unused or shared), one badge per priced restaurant and nothing else (its title's price and comparison
  recomputed, no script) with its page's `/badge?r=<id>` link, `/badge` (the example snippet) and `/press` (median, borough
  medians, source line, CSV, license and GitHub links, share image, credit line), no email address on any page or in
  llms.txt, each restaurant's "Nearby at a similar price" recomputed from the dataset (and "More in …" not repeating it),
  every Q&A block against its FAQPage word for word (and
  one on home, every borough and every neighborhood page), the footer's source line, CSV link with its CC BY 4.0 license
  link and ranking links on every page, the Dataset's license, no overclaiming "cheapest" or "under $N" phrase in any page,
  title, description, JSON-LD, llms.txt or the CSV, unique titles and descriptions (with a length summary), the sitemap equal
  to the pages (each `lastmod` the dataset's date, or the board's where the People's Top 10 is in the HTML: `/peoples-top-10` and `/best-burgers`), robots.txt, every llms.txt link (and the license named next to the CSV), the CSV against the dataset, and no
  broken or orphaned internal links. `-- --site https://…` also asserts the origin. Tests:
  `test/seo.test.ts`, `test/jsonld.test.ts`, `test/rankings.test.ts` (ranking rows, neighborhood lists, answers, FAQ, ranking
  titles), `test/styles.test.ts` (the style classifier and lists), `test/best-burgers.test.ts` (the curated file and its ranking),
  `test/peoples-top.test.ts` (the board as the page shows it, its words, the board file, a real ladder board end to end),
  `test/share-images.test.ts` (image paths, the cards, text fitting), `test/png-palette.test.ts` (every PNG row filter, the
  quantizer, the indexed encoder), `test/badge.test.ts` (badge text, snippet, finder, path compaction, the press kit's credit
  line and both pages' titles), `test/nearby.test.ts`,
  `test/csv.test.ts`, `test/site.test.ts` (origin, titles, robots) and `test/indexnow.test.ts`.

## Deploy to Vercel

The Vercel project "burger-index" (team koolkam00s-projects) is linked to GitHub `koolkam00/burger-index`: the production
branch is `main` (every push deploys production), other branches get preview deployments, and previews are protected
(Vercel Authentication). Project settings:

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** |
| Root Directory | `web` |
| Build Command | `npm run build` |
| Output Directory | **leave empty**: Vercel handles `output: "export"` itself. Setting it to `out` makes the deploy fail with `NEXT_NO_ROUTES_MANIFEST` |
| Node.js Version | 22.x |
| Include files outside the root directory in the Build Step | on |

To deploy:

- Push to GitHub (the Git integration builds every push with those settings), or
- From the CLI, **run it from the repo root, not from `web/`** (Vercel's monorepo rule; `sync-data` also needs `../data` and
  `../contract` in the upload): `npx vercel link` once (set Root Directory to `web`), then `npx vercel --prod`.

Notes:

- The build reads `../data/burger_index.json` and `../contract/burger_index.schema.json`, both outside `web/`. Commit the dataset, and
  keep Vercel's "Include files outside the root directory in the Build Step" setting on (the default for new projects).
- The repo-root `.vercelignore` is an allowlist (`web/`, `contract/`, `data/burger_index.json`). Vercel does not read
  `.gitignore`, so without it a CLI deploy from the root would upload `.env` (the Context.dev key), `.venv/` and the scrape cache.
- Environment variables (Project → Settings → Environment Variables): `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Production and Preview, `NEXT_PUBLIC_POSTHOG_KEY` on Production only. All are public,
  inlined into the JavaScript at build time, so a change needs a redeploy:

  | Variable | Value | Without it |
  |---|---|---|
  | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` (also in `web/.env.local`) | answers stay closed ("Answers open soon.") |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the Supabase **publishable** key, `sb_publishable_…` (also in `web/.env.local`) | answers stay closed |
  | `NEXT_PUBLIC_POSTHOG_KEY` | `phc_soMqVLQsk4hmuZYyWwGDrjjPQwRng7a6bK4i9E9vpBQ9` (the PostHog project's public token; **Vercel, Production environment only**, never in `web/.env.local`: a Preview deployment with the key would count as real traffic on the dashboard, whose filters only drop localhost) | no analytics |
  | `NEXT_PUBLIC_POSTHOG_HOST` | optional; leave unset for the `/ingest` proxy in `web/vercel.json` | `/ingest` |
  | `NEXT_PUBLIC_SITE_URL` | only for a custom domain, once there is one (`https://…`) | Vercel's production URL (`https://$VERCEL_PROJECT_PRODUCTION_URL`, the `*.vercel.app` address), else `http://localhost:4173` with a build warning |

  The origin (`src/lib/site-url.ts`) sets canonical URLs, the sitemap, robots.txt, llms.txt, JSON-LD, the CSV's `page_url` and
  Open Graph tags. The site launches on its free `*.vercel.app` address (user decision 2026-09-25), which Vercel passes to every
  build as `VERCEL_PROJECT_PRODUCTION_URL`, so nothing needs setting until a custom domain arrives. A build with neither
  variable (a local one) uses the preview origin and says so; it never names a domain we don't own.
  `NEXT_PUBLIC_POSTHOG_HOST` is only for a build served somewhere without the proxy (for example `https://us.i.posthog.com`
  for a local check).
- `web/vercel.json` (read from the Root Directory, and uploaded by the `.vercelignore` allowlist) holds the PostHog `/ingest`
  rewrites. Vercel applies rewrites to external origins for every framework, this Next.js static export included; Next's own
  `rewrites` don't work with `output: "export"`. After a deploy, the browser's network tab should show `/ingest/e/` (or
  `/ingest/i/v0/e/`) answering 200. PostHog accepts its endpoints with or without the trailing slash, so a trailing-slash
  redirect on the way doesn't lose events.
- After a production deploy, submit the pages to IndexNow: `SITE_URL=https://<production host> npm run indexnow` (see
  "Search engines and AI assistants").
- Any static host works: upload `out/`. Routes are emitted as `name.html` files, so the host needs clean URLs (`/map` → `map.html`),
  which Vercel, Netlify and `serve` handle by default.

## What's in the site

| Route | Page |
|---|---|
| `/` | The burger ranker first (`#rank`), beside the H1, the median as a sentence and the source line; then the headline index on the Order Board with "See the People's Top 10" and "Most-recommended burgers" under it, price histogram, borough bars with links to the five borough pages (`#boroughs`, which replaced `/boroughs`), cheapest and priciest (each with "See all"), neighborhood ranking, Q&A |
| `/burgers` | Every priced restaurant's burger, one row each: search, filters (borough, neighborhood, price), sort, all synced to the URL; then links to every ranking page |
| `/cheapest-burgers`, `/most-expensive-burgers` (and `/[borough]` and `/[borough]/[neighborhood]` under each), `/burgers-under-15`, `/burgers-under-20`, `/burgers/[style]` | Ranking pages: a one-line answer and a ranked table, one row per distinct menu (top 25 or half the place's menus, ties at the cut kept; every row under $N or of the style) |
| `/best-burgers` | The most-recommended burgers in NYC: places ranked by how many publications named them on a best-burger list in 2024-2026, each with its lists, menu price and People's rank (where ranked) |
| `/peoples-top-10` | The People's Top 10: the daily board of the burgers visitors rank highest (the 10 seats, the rest of the ranking, Rising), "Early results" under 500 lists, the one-liner, "Rank your burgers" (`/peoples-price` redirects here: `vercel.json`) |
| `/restaurants/[id]` | Priced restaurants only: "The burger" (name, price, description, vs neighborhood and NYC, price source), menu page and website links, "See it on the map" (`/map?r=<id>`), hand-check label, nearby at a similar price, more in the neighborhood, other chain locations, and "Get its price badge" (`/badge?r=<id>`) |
| `/neighborhoods`, `/neighborhoods/[slug]` | Sortable ranking (areas with at least 5 distinct priced menus; a chain counts once) and a page for every neighborhood with a priced restaurant (its unpriced restaurants listed as plain names, then a Q&A); neighborhoods with nothing priced are plain names on `/neighborhoods` |
| `/boroughs/[slug]` | The five borough pages (there is no `/boroughs` index), each with "See all" links to its two ranking pages and a Q&A |
| `/map` | MapLibre GL map of the priced restaurants, pins colored by price level, legend, list view, priced restaurants without coordinates |
| `/og.png`, `/sitemap.xml`, `/robots.txt` | Open Graph image (the Order Board), sitemap (every page), robots (every crawler welcome, AI bots named, only `/ingest/` disallowed) |
| `/og/<page path>.png` | Each restaurant, neighborhood, borough, ranking and style page's and `/best-burgers`' own share image (256-color PNG) |
| `/badge`, `/badge/<id>.svg` | The price badge page (the badge of `?r=<id>` or an example, a finder, copyable snippets, how to add it) and every priced restaurant's badge |
| `/press` | Press kit: the headline numbers, the source line, the CSV and how to credit it, the share image, the contact (GitHub issues) |
| `/llms.txt` | Plain summary for AI assistants: the headline numbers and date, links to the main pages, the ranking pages and the CSV |
| `/data/burger-prices.csv` | The public price list, one row per priced restaurant location, licensed CC BY 4.0 (linked from the footer, the license link after it) |
| `/data/menus.json` | Every distinct priced menu with its locations (not linked; fetched by the home ranker and the badge finder) |
| `/<key>.txt` | The IndexNow key file (`public/`, public by design) |

## Notes for maintainers

- **Types:** the contract is the source of truth. If it changes, update `src/lib/schema.ts` (zod) and `pipeline/models.py` to
  match; `npm run typecheck` then shows every page that needs attention. Components that show a restaurant take a
  `PricedRestaurant`, so an unpriced one can't reach a page, a card or a map pin by accident.
- **Pages only for priced places (user decision 2026-09-25):** a restaurant without a price has no page, no sitemap URL and no
  row in the explorer, the map lists or a chain list; it shows up only as a plain name on its neighborhood's page. A neighborhood
  gets a page only when something there is priced; the others are plain names on `/neighborhoods`. Their old URLs are 404s.
  Restaurant ids are still assigned over every restaurant in scope, so a priced restaurant's id (and its People's Top 10 menu key)
  never changes.
- **Menus, not locations:** the index counts each distinct menu once (every independent restaurant, each chain once citywide
  and at most once per area). Anything the site derives itself (histograms, rankings, cheapest/priciest lists, the
  `MIN_RANKED` / `MIN_HISTOGRAM` thresholds, "N menus" copy) goes through `src/lib/menus.ts` (`menuKey`, `pricedMenus`,
  `menuIndexPrices`, `menuCounts`, `isRankable`). Location counts (`restaurants_priced`, map pins, table rows) stay per
  location. An area priced only from chain menus is treated like any other area (the "Chain prices only" label was removed
  on 2026-09-25). A hand correction is the restaurant's `hand_check` (`{checked_on}`, set by `pipeline/corrections.py`
  only on restaurants that stay priced), shown as the "Prices corrected by hand" slip on its page.
- **Explorer payload:** `src/lib/explorer-data.ts` sends one row per priced restaurant (`{id, name, burger, price, nb, nbSlug,
  borough, source}`, `ExRow` in `src/lib/explorer.ts`); `filterRows()` there does the filtering and sorting, tested in
  `test/explorer.test.ts`. Old `protein`, `source`, `hide` and `index` URL parameters are ignored.
- **No methodology copy:** the site has no Methodology page and explains nowhere how the data is gathered, computed, counted,
  filtered, corrected or limited (user decision 2026-09-25; DESIGN.md "No methodology copy"). Keep new copy to numbers and
  short labels.
- **Price colors** (Steal → Splurge) are always measured against the citywide median, never a filtered subset. See `src/lib/price-bins.ts`.
- **Map:** tiles and styles come from [OpenFreeMap](https://openfreemap.org) (`positron` for light, `dark` for dark), recolored to the
  DESIGN.md map tokens at runtime. MapLibre v6 loads its worker relative to its own module URL, which bundling breaks, so `sync-data`
  copies the worker into `public/vendor/maplibre/`. If the tiles can't load, pins are drawn on a blank basemap and the list view
  still has every restaurant.
- **Theme:** light and dark follow the system; the toggle stores `bi-theme` in `localStorage`, and an inline `<head>` script applies it
  before first paint. "Use system setting" in the footer clears it.
