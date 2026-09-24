# Burger Index

The price of every burger at NYC restaurants. Two halves joined by one JSON file:

- **`pipeline/`** (Python 3.12 venv at `.venv/`; `.venv/bin/pip install -r requirements.txt`) writes
  **`data/burger_index.json`**, which must validate against **`contract/burger_index.schema.json`** (the output
  contract; `additionalProperties: false` everywhere — do not change it casually; `pipeline/models.py` and
  `web/src/lib/schema.ts` (zod) mirror it, so a contract change means updating all three).
- **`web/`** (Next.js 16 static export, Node ≥ 20.9) copies that file in at build time and renders it to plain
  HTML in `web/out/`. No server code, no API keys. See "Website" below and `web/README.md`.

**Design system:** always read `DESIGN.md` before any visual or UI decision. Fonts, colors, spacing and aesthetic
direction are defined there; do not deviate without explicit user approval, and in QA flag code that doesn't match it.

## Pipeline commands

```bash
.venv/bin/python -m pipeline sources            # free: restaurant list + DOHMH match + NTA names -> data/restaurants.json
.venv/bin/python -m pipeline plan               # dry run: targets, calls, credit estimate. NO Context.dev calls
.venv/bin/python -m pipeline run --limit 2      # sources -> discover -> scrape -> build (spends credits)
.venv/bin/python -m pipeline run --only "7th Street Burger" --only "Due West" --max-credits 50
.venv/bin/python -m pipeline build              # data/burger_index.json from cache only (no API calls)
.venv/bin/python -m pytest -q tests             # offline; Context.dev is mocked
```

**The restaurant universe is `burger-list-master.csv` (user decision, 2026-09-23; `config.RESTAURANT_LIST_CSV`).**
DOHMH inspection data only *matches* its rows (address, coordinates, neighborhood); it adds restaurants only when you
pass `--cuisines`.

`run`/`plan`/`sources` flags: `--cuisines "Hamburgers,American"` adds every DOHMH restaurant of those cuisines on top
of the list (default: none; `--cuisines none` goes back to the list only; values are DOHMH `cuisine_description`s,
case-insensitive, and one no restaurant has — `Steakhouses` — stops the command with a did-you-mean, exit 2, nothing
written), `--min-inspection-date 2023-01-01` (older latest inspection = treated as
closed; `1900-01-01` = not yet inspected, always kept), `--national-chains exclude|include` (default `exclude`, see
"National chains are out" below), `--refresh-sources`. Scope flags are **remembered** in `data/restaurants.json`
(`meta`): every later `sources`/`plan`/`run`/`build` reuses them until you pass them again (`--cuisines none` to go
back to the list only).
`run` (and `plan`) also: `--limit N` (targets; a chain counts as one), `--only NAME` (repeatable), `--max-credits`
(default 6000); `run` only: `--workers` (default 6), `--refresh`, `--no-build`. `build --output PATH` writes elsewhere. Ctrl-C stops a run at once: queued targets are
cancelled, in-flight ones make no further live call (exit 130, no build); finished targets stay cached.

## Pipeline (`pipeline/`)

| module | job |
| --- | --- |
| `sources.py` | DOHMH inspections via Socrata (`43nn-pn8j`, free) → one record per CAMIS from its latest inspection; drops boro `0`/missing, lat/lng `0` → null, stale restaurants (flag), and the old CAMIS of a restaurant **re-permitted** at the same address (same brand/near-same name, permits issued apart, old one last inspected earlier; venue stands issued together stay) → `report.dohmh_superseded_permits`. Neighborhoods = **2010 NTA names** from `8ius-dhrr` (the 2010 NTA boundary datasets were retired), committed at `pipeline/data/nta_2010.json` (`sources --refresh-nta` to regenerate), with misleading ones relabeled in `NTA_DISPLAY_OVERRIDES` (MN27 Chinatown-Lower East Side, MN28 Lower East Side-Alphabet City, BK72 South Williamsburg, BK73 Williamsburg); missing NTA → most common NTA of the zipcode. Restaurant-list rows are fuzzy-matched (rapidfuzz, same borough) to DOHMH for camis/address/coords, and only to records of the same national-chain status (a `Shake Shack (…)` row only to a Shake Shack permit, any other row never to one); an acceptable candidate in the row's neighborhood or at the address its URL or notes name (`at 320 W 36th`) beats a name match elsewhere; a shorter name only counts as contained in a longer one as a phrase or word-by-word from the same first word (`american bar` ≠ `guy fieris american kitchen and bar`); unmatched rows keep CSV borough and map their neighborhood onto an NTA name, so every page uses one naming system (keys `csv:<name>-<borough>`, made unique on collision). CSV rows come first; DOHMH duplicates are merged. With `--national-chains exclude` (default), national chains are dropped after matching → `report.national_chains_excluded` (display name → locations). |
| `names.py` | normalization, display casing of ALL-CAPS dba (`McDonald's`, `7th Street Burger`, `BurgerFi`; overrides map), slugs |
| `chains.py` | brand grouping (curated aliases + any brand with ≥3 locations) and scrape **targets**: one per chain, one per other restaurant. Curated chains can carry `cheapest_item` (a delivery page without it is partial) and a pinned `menu_url` (scraped first). Airport locations (JFK/LGA) never get the chain's street price. `ChainDef.national` marks national chains; `NATIONAL_ONLY` holds more national patterns (Shake Shack stands named after their venue, IHOP, Outback, PLNT Burger…) that are never grouped; `is_national_chain()` checks the DOHMH dba, then the restaurant-list name. Add a new national brand there, with a test in `tests/test_sources.py` for its DBA spellings and a local look-alike that must stay |
| `discover.py` | URL classification/ranking: official menu page / PDF > official homepage (→ Map URLs) > online ordering > aggregators > delivery marketplaces with full store menus (Grubhub/Seamless, published as `delivery_app`) > unmapped homepage > lazy-loading delivery apps (Uber Eats, DoorDash, Postmates) > unknown third-party pages naming the restaurant. Own-domain check strips generic/place affixes (`duewestnyc` = Due West) and only trusts containment for names ≥6 chars. Rejects social/review/news, platform directory pages, and results (or scraped `location`s) for another location/address; other cities count only in a city/state position (`Houston, TX`, `White Plains, NY 10601`) or as a non-NYC ZIP, so Houston St / White Plains Rd / buffalo wings are fine; official pages are only rejected for another city when they name no NYC place |
| `context_client.py` | **the only module that imports the Context.dev SDK** (request builders + `execute()`) |
| `api.py` | disk cache, credit ledger, `--max-credits`, rate gate around `context_client` |
| `extract.py` | post-processing of the JSON extraction |
| `process.py` | per-target workflow + ThreadPoolExecutor runner + `data/run_log.jsonl` |
| `corrections.py` | hand-checked fixes from `pipeline/data/corrections.json` (per `target`: `set` / `drop` / `add` burgers, `price_source`, `withhold`; each with `source_url`, `reason`, `checked_at`), applied by `build` on top of the scraped results (cache untouched) — free, no API calls. Strict: `build` fails if one names a target or burger no longer in the scrape |
| `build.py` | ids, stats, area summaries, methodology, JSON-Schema validation |
| `cli.py` | `python -m pipeline …` |

Per target: CSV `menu_url`, then CSV `website` (website first when the menu_url is a special menu: brunch,
restaurant week, prix fixe…), else one web search. An official homepage is resolved with one Map URLs call; if the
map has no menu page the target searches (if it hasn't) and tries the homepage after ordering pages/aggregators/
Grubhub. Scrape candidates in rank order until a priced beef burger is found **with no caveat** — a lazy-loading
delivery page that looks partial (< `config.MIN_DELIVERY_BURGERS` priced beef burgers, a curated chain's
`cheapest_item` missing, or a double/triple as the cheapest), a special-menu URL, or a menu file whose URL dates it
more than `config.STALE_MENU_DAYS` before the scrape (Squarespace upload timestamp, WordPress `/uploads/YYYY/MM/`,
a date in the file name) keeps the search going; at the caps the best result wins and `status_detail` says why.
**Hard caps per target: 1 search, 1 map, 3 scrapes** (reason goes in `status_detail`). A target whose result may
have been changed by a temporary failure (429/5xx/timeout after SDK retries) is `retry_pending`: `plan`/`build`
count it as not yet scraped and the next `run` retries. Chains: one NYC location's menu (a CSV member's URL if any,
else a search on a representative address) is applied to every location except airport concessions; its
`status_detail` names the location whose menu was read (the member at the address the scraped page names, else the
restaurant-list member whose URL it was, else the representative), and that row is the chain's source row in `build`.
Curated chains whose own site shows no prices (`official_has_prices=False`: the national chains, so only with
`--national-chains include`) skip their official site.

Extraction rules (schema + instructions in `context_client.py`, clean-up in `extract.py`): numeric price of the
burger alone; market price → null; single/standard size; no combo/meal upgrades or add-ons (meal-only → null);
sliders only when sold as a burger; kids' items dropped; prices < $2 or > $150 dropped as suspect (noted);
names cleaned (trailing prices, emoji, ®); duplicates collapsed. **Lunch vs dinner:** a burger on several menus
keeps its dinner/all-day price; late-night, lunch, brunch, then happy-hour prices are used only when it is not on
the dinner menu. Status: `priced` (≥1 index-eligible beef burger) | `no_prices` | `no_burgers` (incl. only non-beef) |
`no_menu_found` | `error`. `index_price` = cheapest beef burger with a dinner/all-day price; only if none has one,
the cheapest from the next period (late-night, lunch, brunch, other); **never a happy-hour price**. Exactly that
burger has `is_index_item: true` (ties → first on the menu). Restaurant ids are assigned over every restaurant in
scope (scraped or not), so they stay stable as more targets are scraped. `cheapest_burger_id`/`priciest_burger_id`
are picked among distinct menus (a chain's source location, not its copies).

**Chains count once (product decision, 2026-09-23).** The Burger Index (`index_median`/mean/p10/p90), the
`all_burgers_median` and every borough/neighborhood median/min/max are computed over **distinct menus**
(`build.menu_index_prices`): each independent restaurant once, each chain once citywide and at most once per area
— otherwise one 7th Street Burger menu would count 22 times, once per location. Location counts
(`restaurants_priced`, `burgers`, area `restaurants`) still count every location, since each has its own page and
table rows.

**National chains are out (product decision, 2026-09-23).** McDonald's, Burger King, Wendy's, White Castle,
Checkers, Sonic, Five Guys, Smashburger and Shake Shack (the user chose to remove Shake Shack too), plus the other
national burger and casual-dining brands in `chains.py`, are left out of the index entirely (`--national-chains
exclude`, the default). NYC's own small chains stay and count once: 7th Street Burger, Jimbo's Hamburger Palace,
Bareburger, Jackson Hole, Burger Joint, Harlem Shake (and Black Tap, Bill's Bar & Burger, 5 Napkin Burger when in
scope). NY-area groups such as Burgerology and Nathan's stay too. Still open, ask the user before widening
`--cuisines`: whether upscale national groups (Capital Grille, Del Frisco's, Morton's, Ocean Prime, Hillstone),
entertainment venues (Lucky Strike, Alamo Drafthouse) and Wonder should go as well.

## Data files

- `data/burger_index.json` — THE dataset (contract above). `build` validates before writing and fails loudly.
- `burger-list-master.csv` — **the restaurant list** (`config.RESTAURANT_LIST_CSV`; 687 rows: `name, neighborhood,
  borough, website, menu_url, notes, source` where `source` is `pilot-100|uptown|downtown|outer`). It's the user's data:
  don't edit it; report duplicates (`report.csv_duplicate_matches`), unmatched rows (`report.csv_unmatched`) and closed
  places (e.g. "Guy Fieri's American Kitchen & Bar", Times Square, closed 2017) for the user to fix.
  `burger pilot list.csv` — the original 100-row pilot, now the `pilot-100` rows of the master list (kept for history).
- `data/restaurants.json` — resolved restaurant universe + match report (`build` reuses it; pass scope flags to re-derive).
- `data/run_log.jsonl` — one line per target per run: status, urls tried, attempts, credits.
- `data/credit_ledger.jsonl` — one line per **billed** live call: estimate, actual, run total, account balance, rate-limit headers.
- `data/cache/` (gitignored) — `socrata/` DOHMH snapshot; `search/`, `map/`, `scrape/` Context.dev responses at
  `data/cache/<endpoint>/<sha1(canonical request)>.json`.

## Website (`web/`)

```bash
cd web && npm install
npm run dev              # sync-data, then http://localhost:3000 (uses ../data/burger_index.json if it exists)
npm run dev:sample       # force the fictional fixture (fixtures/burger_index.sample.json)
npm run lint             # these four must pass with zero errors, with the real file AND the fixture
npm run typecheck        # next typegen && tsc --noEmit
npm test                 # node:test over test/*.test.ts (no extra deps)
npm run build            # sync-data, then static export to web/out/
npm run build:sample     # same, with the fixture
npm run preview          # serve out/ at http://localhost:4173
npm run validate:data -- ../data/burger_index.json   # ajv check against the contract (default: the fixture)
npm run fixture          # regenerate + validate the fixture (deterministic, fictional, .example domains)
```

- **Data in:** `scripts/sync-data.mjs` (runs as `predev`/`prebuild`) copies `../data/burger_index.json` to
  `src/data/`, validates it against the contract with ajv (invalid data fails the build), writes `src/data/meta.json`
  (`source: pipeline | fixture`) and copies the MapLibre worker to `public/vendor/maplibre/`. No pipeline file (or
  `BURGER_INDEX_USE_FIXTURE=1`) → the fixture, a loud warning, and a "Sample data" banner on every page. All of these
  outputs are generated and gitignored.
- **Reading data:** `src/lib/data.ts` is `server-only`: it parses the file once with the zod mirror
  (`src/lib/schema.ts`), re-checks the invariants, and exposes typed selectors (`getStats()`, `getRestaurant(id)`, …).
  Client components import enum lists from `src/lib/enums.ts` and only `import type` from `schema.ts`, which keeps zod
  out of the browser bundle.
- **Next 16** has breaking changes versus older docs: read `web/AGENTS.md` and `web/node_modules/next/dist/docs/`
  before writing Next code. `output: "export"`: every route is static (`generateStaticParams`); the only route
  handlers are force-static files (`/data/burger_index.json`, `/og.png`, sitemap, robots).
- **Counting:** the site counts distinct menus through `src/lib/menus.ts` (menu key = chain, else restaurant id), the same
  rule as `build.menu_index_prices`: histograms, typical range, rankings, cheapest/priciest lists and the `MIN_RANKED` /
  `MIN_HISTOGRAM` thresholds are per menu; map pins, restaurant pages and table rows are per location. Areas with priced chain
  menus but no priced independent are labelled "Chain prices only" (`isChainOnly`) and kept out of like-for-like copy.
  `test/menus.test.ts` checks the web's per-menu medians against the pipeline's for the fixture and the synced dataset.
- Price colors (Steal → Splurge) are always measured against the citywide median (`src/lib/price-bins.ts`), never a
  filtered subset. Fonts load through `next/font/google` (the build needs network); the OG image reads `@fontsource`.
- **Deploy (Vercel):** project Root Directory `web`, build `npm run build`, output `out`, and keep "Include files
  outside the root directory" on (the build reads `../data` and `../contract`). CLI deploys run **from the repo
  root** (`npx vercel link` once, then `npx vercel --prod`); the root `.vercelignore` is an allowlist so `.env`,
  `.venv/` and `data/cache/` are never uploaded. Set `NEXT_PUBLIC_SITE_URL` for canonical/OG URLs.
- **Refresh the live site:** `pipeline run` (spends credits) → `pipeline build` → commit `data/burger_index.json` →
  deploy.

## Context.dev (web data)

- **Env var:** `CONTEXT_DEV_API_KEY` in `.env` (gitignored; loaded by python-dotenv). Rotate at https://www.context.dev/dashboard/api-keys. Never hardcode or print it.
- **Wrapper:** `pipeline/context_client.py` is the only module that touches the `context.dev` SDK (`from context.dev import ContextDev`). Add new calls there (a `*_request()` builder + a branch in `execute()`); everything else goes through `pipeline.api.Api`. Tests mock `pipeline.context_client.execute`, never the live API.
- **SDK retries:** `max_retries=3` — the SDK retries 408/409/429/5xx with backoff and honors `Retry-After`. Still failing → `TransientError` (cached as a placeholder, retried by the next live run, 0 credits). 401 / `USAGE_EXCEEDED` / `PAID_PLAN_REQUIRED` → `FatalError` (run stops). Other 4xx are page answers and are cached.
- **Endpoints in use** (append `.md` to a docs URL for markdown):
  - `POST /web/search` — `client.web.search`, `numResults=10`, `country=us`, `excludeDomains` (yelp, tripadvisor, social, eater…), no inline markdown. **1 credit per 10 results.** https://docs.context.dev/api-reference/web-scraping/search
  - `GET /web/urls` (Map URLs) — `client.web.map_urls(domain, urlRegex="(?i)(menu|food|dinner|lunch|brunch|\.pdf)", maxLinks=100)`. **1 credit** (2 with `search`). https://docs.context.dev/api-reference/web-scraping/map
  - `POST /web/scrape` — `formats.json` + `jsonParams.schema` (`BURGER_MENU_SCHEMA`) + instructions, `sharedParams.parsers.pdf.ocr=auto` (≤10 pages), `dismissPopups`, `includeFrames`; response at `resp.json_.data`. **1 + 4 (JSON) credits, +1 per OCR'd PDF page** (a `.pdf` or site-builder-CDN URL reserves the 15-credit worst case); charged even on Context.dev's own cache hits. Browser `actions` (e.g. scrolling lazy delivery-app menus, +1 credit) need a paid plan — gated off by `config.SCROLL_DELIVERY_APPS`. https://docs.context.dev/api-reference/web-scraping/scrape
- **Rate limits:** fixed one-minute windows; the wrapper reads `X-RateLimit-Remaining/Reset` and all workers pause when ≤2 remain (https://docs.context.dev/optimization/rate-limits). 429s cost nothing.
- **Troubleshooting** empty or failed scrapes: https://docs.context.dev/optimization/troubleshooting

## Credits: cache, ledger, --max-credits (read before any live run)

- **Every** Context.dev response is cached on disk; the key is the canonical request (URL/query + schema +
  instructions, not timeouts/tags/maxAge). Re-runs spend **0 credits** unless `--refresh` (re-fetch once per run,
  `maxAgeMs=0`). Changing `BURGER_MENU_SCHEMA`/`BURGER_INSTRUCTIONS` changes every scrape key → a full re-spend.
- `build` and `plan` replay the per-target workflow offline from the cache (a miss = "not yet scraped", left out
  of the dataset and counted in `coverage_note`). So `extract.py`/`build.py` changes apply for free on the next
  `build`; changes to `discover.py`/`process.py` may make replays hit uncached calls — `run` again (only new calls
  are billed).
- Live calls **reserve** their worst-case cost before sending (PDFs: all 10 OCR pages), so `--max-credits` is a hard
  cap; `run` stops cleanly when the next call would pass `--max-credits` **or** the account balance reported by
  the API (`key_metadata.credits_remaining`, lowest value seen this run). The run starts from the ledger's last
  seen balance; until a live call reports the real one it only throttles, so a top-up never blocks a run.
  Finished targets are cached, unstarted ones are logged as `stopped`; the next `run` resumes where it stopped.
- Always `plan` first. It prints first-pass / expected / worst-case credits and the last seen account balance.
  Test with `--only "<name>"` or `--limit 1`. Never run the full list casually (`plan` first: ~5,300 credits for the master list).
- **Batch API** (https://docs.context.dev/guides/scrape-websites-in-batches): outputs Markdown or HTML only —
  **no JSON extraction** — at 1 credit per successful page (+OCR), with its own rate bucket. Switching makes sense
  once we scrape thousands of known menu URLs (e.g. after widening `--cuisines`, or monthly re-pricing) *and* run
  our own extraction over the Markdown; until then `/web/scrape` + JSON (5 credits) is simpler. Not implemented.
- For scheduled re-pricing, use Monitors (https://docs.context.dev/guides/monitor-website-changes) rather than a polling loop.
