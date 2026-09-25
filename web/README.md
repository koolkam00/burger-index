# The Burger Index: website

The public site for the NYC Burger Index: the median index price across the New York menus we have priced, from
the restaurants in the pipeline's scope (by default our curated list of burger restaurants).
It is a fully static Next.js site (App Router, TypeScript strict, Tailwind v4, zod). There is no server code and no secret key: the Python
pipeline writes one JSON file, and `next build` turns it into plain HTML in `out/`. The one live part, "What's it worth?", talks to
Supabase straight from the browser with a public key (see "What's it worth? (Supabase)" below). Product analytics (PostHog) run in
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

Requires Node 20.9 or later.

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

## What's it worth? (Supabase)

On every priced restaurant page, visitors say what they would pay for the menu's burger, in whole dollars from $5 to $75 (a
native range slider starting at their saved answer, else $40, and an "Order up!" button; one answer per device, changeable).
Once they have answered, the card shows the crowd's median, **the People's Price** (rounded to whole dollars), next to the
menu price and their own answer, the answer count, a verdict ("A bargain by 7%", "Overpriced by 43%", "Right on the money"; only
from 3 answers) and the answer distribution in $5 ranges. `/peoples-price` shows the People's Burger Index (the median People's
Price over burgers with a verdict) beside the real Burger Index, and live boards: biggest bargains, most overpriced, most
answered, plus the burgers that need a few more answers. It replaced a 1–10 rating on 2026-09-25 (that never shipped).

The backend is the Supabase project `burger-index`; its schema, API (`cast_worth`, `my_worth`, the public `burger_worth_hist`
table and its realtime feed), rate limit (60 answers per hour per IP) and security notes are in
[`../supabase/README.md`](../supabase/README.md) and `../supabase/migrations/`.

The site needs two public build-time variables, in `web/.env.local` locally (gitignored) **and on Vercel** (Project → Settings →
Environment Variables, for Production and Preview):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's **publishable** key (`sb_publishable_…`), never the secret / `service_role` key |

Both are inlined into the JavaScript at build time (so a change needs a rebuild) and are public by design: the database only lets
that key call `cast_worth` / `my_worth` and read `burger_worth_hist`. Without them the site still builds; the slider and button
are disabled and say "Answers open soon.", and `/peoples-price` shows the same.

Code map:

- `src/lib/worth-config.ts`: the two variables (`WORTH_ENABLED`).
- `src/lib/worth-voter.ts`: the anonymous voter id, a `crypto.randomUUID()` in `localStorage` under `burger-index-voter` (in memory
  when storage is blocked; the key keeps that name so returning visitors keep their answers). Tested in `test/worth-voter.test.ts`.
- `src/lib/worth-api.ts`: the only module that talks to Supabase. `@supabase/supabase-js` is imported lazily on the first call, so
  it is its own chunk and loads only on pages that mount the slider or the boards (restaurant pages, `/peoples-price`), and there
  only once the slider is near the viewport. Histograms are fetched by menu key (100 keys per request), never the whole table:
  `cast_worth` accepts any well-formed key, so rows for keys the dataset doesn't know are never downloaded.
- `src/lib/worth-store.ts`: this browser's answers and the public histograms, shared by every component on a page. Answers are
  optimistic and serialized per burger; while one is on its way the burger's histogram is frozen and shown with the visitor's answer
  moved by hand, realtime events for it are held back, and a fresh fetch after the save replaces it, so the visitor's own answer
  is never counted twice. Tested with a fake backend in `test/worth-store.test.ts`.
- `src/lib/worth.ts`: pure helpers: answer validation, the median from a histogram, the People's Price (half up), verdicts, $5
  buckets, the People's Burger Index, board ordering and ties, search, error copy. Tested in `test/worth.test.ts`.
- `src/components/worth/`: `WorthPicker` (the restaurant card: "Order up!" waits for a returning visitor's saved answer unless
  the slider was moved; once the People's Price shows, it refreshes every 30 seconds while the tab is visible, a poll rather than
  a realtime channel per page view), `AnswerSpread` (the distribution), `PeoplesPriceBoard` (the page body: tiles, boards,
  search; loads the dataset's menus only, realtime on `burger_worth_hist` filtered to those menus, with a 30-second polling
  fallback while the channel is down).

The rules behind the numbers (the People's Price is the median answer; a verdict needs 3 answers; "Right on the money" is a gap
under 5%, measured from the smaller of the two prices; the People's Burger Index counts each burger with a verdict once, a chain
once) are never explained on the site.

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
  stripped.
  Events tracked before it has loaded are queued (up to 50).
- **Automatic, per the project settings:** `$pageview`, `$pageleave`, autocapture, web vitals, heatmaps and session replay. The
  explorer's filter URL updates (`replaceState` with a new query string) are not pageviews: only path changes are.
- **Custom events** (`src/lib/analytics.ts`, the typed `AnalyticsEvents` map; components call `track()`):

| Event | Properties | Sent from |
|---|---|---|
| `burger_search` | `surface` (`burgers` / `peoples_price`), `query`, `results` | the /burgers search box and "Find a burger" on /peoples-price, once typing pauses for 1 s; empty and repeated queries are skipped |
| `burger_filter_changed` | `filter` (`borough`, `neighborhood`, `price`, `sort`, `clear_all`), `value`, `results` | every /burgers control: filter popovers, the mobile sheet, chips, price presets, the sort select and the column headers |
| `worth_answered` | `menu_key`, `restaurant_id`, `dollars`, `menu_price`, `first_answer`, `previous_dollars` (a changed answer only) | `WorthPicker`, after Supabase has saved the answer (`worthStore.onSaved`) |
| `peoples_price_board_clicked` | `board` (`bargains`, `overpriced`, `most_answered`, `needs_answers`, `find`), `menu_key`, `restaurant_id`, `rank`, `position` | a row link on /peoples-price |
| `map_pin_opened` | `restaurant_id`, `source` (`pin` tapped, or `link` for `/map?r=<id>`) | `MapCanvas` |
| `map_popup_link_clicked` | `restaurant_id` | the restaurant link in a map popup |
| `map_view_changed` | `view` (`map` / `list`) | the Map / List toggle |
| `menu_link_clicked`, `website_link_clicked` | `restaurant_id`, `host`, `price_source` | "Menu page:" and "Website:" on restaurant pages (`components/RestaurantLinks.tsx`) |
| `see_on_map_clicked` | `restaurant_id` | "See it on the map" |

- **No personal data.** Events carry ids, prices, counts and control names. The only free text is the search query: trimmed,
  lowercased and cut to 60 characters. The full query in the page URL (`?q=`) is replaced by `<MASKED>` in every URL PostHog
  records (`mask_personal_data_properties` with `q`, plus a `before_send` for referrers). The voter id never reaches an event,
  and session recordings drop Supabase request bodies (they carry it).
- **Proxy:** in production `posthog-js` talks to `/ingest` on the site itself; `web/vercel.json` rewrites `/ingest/static/*` and
  `/ingest/array/*` to `https://us-assets.i.posthog.com` and the rest of `/ingest/*` to `https://us.i.posthog.com`, so ad
  blockers that block PostHog's domains don't drop the events. The site has no Content-Security-Policy to update.
- **Bots:** `posthog-js` drops events from automated browsers (headless Chrome, `navigator.webdriver`), so a Playwright or
  gstack check sees no events unless it poses as a normal browser.
- **Tests:** `test/analytics.test.ts` (off without a key, loading and queueing, property shaping, URL masking, the debounce) and
  the `onSaved` cases in `test/worth-store.test.ts`.

## Deploy to Vercel

The Vercel project uses **Root Directory** `web`, **Build Command** `npm run build`, **Output Directory** `out`. Either:

- Import the repo on Vercel with those settings (every push to the production branch deploys), or
- From the CLI, **run it from the repo root, not from `web/`** (Vercel's monorepo rule; `sync-data` also needs `../data` and
  `../contract` in the upload): `npx vercel link` once (set Root Directory to `web`), then `npx vercel --prod`.

Notes:

- The build reads `../data/burger_index.json` and `../contract/burger_index.schema.json`, both outside `web/`. Commit the dataset, and
  keep Vercel's "Include files outside the root directory in the Build Step" setting on (the default for new projects).
- The repo-root `.vercelignore` is an allowlist (`web/`, `contract/`, `data/burger_index.json`). Vercel does not read
  `.gitignore`, so without it a CLI deploy from the root would upload `.env` (the Context.dev key), `.venv/` and the scrape cache.
- Environment variables (Project → Settings → Environment Variables, for Production and Preview). All are public, inlined into the
  JavaScript at build time, so a change needs a redeploy:

  | Variable | Value | Without it |
  |---|---|---|
  | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` (also in `web/.env.local`) | answers stay closed ("Answers open soon.") |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the Supabase **publishable** key, `sb_publishable_…` (also in `web/.env.local`) | answers stay closed |
  | `NEXT_PUBLIC_POSTHOG_KEY` | `phc_soMqVLQsk4hmuZYyWwGDrjjPQwRng7a6bK4i9E9vpBQ9` (the PostHog project's public token; **Vercel only**, never in `web/.env.local`) | no analytics |
  | `NEXT_PUBLIC_POSTHOG_HOST` | optional; leave unset for the `/ingest` proxy in `web/vercel.json` | `/ingest` |
  | `NEXT_PUBLIC_SITE_URL` | for example `https://burgerindex.nyc` | Vercel's production URL, then `https://burgerindex.nyc` |

  `NEXT_PUBLIC_SITE_URL` sets canonical URLs, the sitemap and Open Graph tags. `NEXT_PUBLIC_POSTHOG_HOST` is only for a build
  served somewhere without the proxy (for example `https://us.i.posthog.com` for a local check).
- `web/vercel.json` (read from the Root Directory, and uploaded by the `.vercelignore` allowlist) holds the PostHog `/ingest`
  rewrites. Vercel applies rewrites to external origins for every framework, this Next.js static export included; Next's own
  `rewrites` don't work with `output: "export"`. After a deploy, the browser's network tab should show `/ingest/e/` (or
  `/ingest/i/v0/e/`) answering 200. PostHog accepts its endpoints with or without the trailing slash, so a trailing-slash
  redirect on the way doesn't lose events.
- Any static host works: upload `out/`. Routes are emitted as `name.html` files, so the host needs clean URLs (`/map` → `map.html`),
  which Vercel, Netlify and `serve` handle by default.

## What's in the site

| Route | Page |
|---|---|
| `/` | The headline index on the Order Board, price histogram, borough bars with links to the five borough pages (`#boroughs`, which replaced `/boroughs`), cheapest and priciest, neighborhood ranking |
| `/burgers` | Every priced restaurant's burger, one row each: search, filters (borough, neighborhood, price), sort, all synced to the URL |
| `/peoples-price` | The People's Price: the People's Burger Index beside the Burger Index, live boards (biggest bargains, most overpriced, most answered), burgers that need a few more answers, and a search that links to any burger's slider (all loaded in the browser) |
| `/restaurants/[id]` | Priced restaurants only: "The burger" (name, price, description, vs neighborhood and NYC, price source), menu page and website links, "See it on the map" (`/map?r=<id>`), hand-check label, "What would you pay?" (the slider, then the People's Price), more in the neighborhood, other chain locations |
| `/neighborhoods`, `/neighborhoods/[slug]` | Sortable ranking (areas with at least 5 distinct priced menus; a chain counts once) and a page for every neighborhood with a priced restaurant (its unpriced restaurants listed as plain names); neighborhoods with nothing priced are plain names on `/neighborhoods` |
| `/boroughs/[slug]` | The five borough pages (there is no `/boroughs` index) |
| `/map` | MapLibre GL map of the priced restaurants, pins colored by price level, legend, list view, priced restaurants without coordinates |
| `/og.png`, `/sitemap.xml`, `/robots.txt` | Open Graph image (the Order Board), sitemap, robots |

## Notes for maintainers

- **Types:** the contract is the source of truth. If it changes, update `src/lib/schema.ts` (zod) and `pipeline/models.py` to
  match; `npm run typecheck` then shows every page that needs attention. Components that show a restaurant take a
  `PricedRestaurant`, so an unpriced one can't reach a page, a card or a map pin by accident.
- **Pages only for priced places (user decision 2026-09-25):** a restaurant without a price has no page, no sitemap URL and no
  row in the explorer, the map lists or a chain list; it shows up only as a plain name on its neighborhood's page. A neighborhood
  gets a page only when something there is priced; the others are plain names on `/neighborhoods`. Their old URLs are 404s.
  Restaurant ids are still assigned over every restaurant in scope, so a priced restaurant's id (and its People's Price key)
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
