# Burger Index

The price of every burger at NYC restaurants. Python 3.12 venv at `.venv/` (`.venv/bin/pip install -r requirements.txt`).
The data pipeline (`pipeline/`) writes **`data/burger_index.json`**, which must validate against
**`contract/burger_index.schema.json`** (the output contract; `additionalProperties: false` everywhere — do not
change it casually; `pipeline/models.py` mirrors it). The site reads that file at build time.

## Commands

```bash
.venv/bin/python -m pipeline sources            # free: DOHMH + NTA names + pilot CSV -> data/restaurants.json
.venv/bin/python -m pipeline plan               # dry run: targets, calls, credit estimate. NO Context.dev calls
.venv/bin/python -m pipeline run --limit 2      # sources -> discover -> scrape -> build (spends credits)
.venv/bin/python -m pipeline run --only "Shake Shack" --only "Due West" --max-credits 50
.venv/bin/python -m pipeline build              # data/burger_index.json from cache only (no API calls)
.venv/bin/python -m pytest -q tests             # offline; Context.dev is mocked
```

`run`/`plan`/`sources` flags: `--cuisines "Hamburgers,American,Irish,Steakhouses"` (widen scope — one flag),
`--min-inspection-date 2023-01-01` (older latest inspection = treated as closed; `1900-01-01` = not yet inspected,
always kept), `--refresh-sources`. `run` also: `--limit N` (targets; a chain counts as one), `--only NAME`
(repeatable), `--max-credits` (default 6000), `--workers` (default 6), `--refresh`, `--no-build`.

## Pipeline (`pipeline/`)

| module | job |
| --- | --- |
| `sources.py` | DOHMH inspections via Socrata (`43nn-pn8j`, free) → one record per CAMIS from its latest inspection; drops boro `0`/missing, lat/lng `0` → null, stale restaurants (flag). Neighborhoods = **2010 NTA names** from `8ius-dhrr` (the 2010 NTA boundary datasets were retired), committed at `pipeline/data/nta_2010.json` (`sources --refresh-nta` to regenerate); missing NTA → most common NTA of the zipcode. Pilot CSV rows are fuzzy-matched (rapidfuzz, same borough; neighborhood and address-in-URL as tie-breakers) to DOHMH for camis/address/coords; unmatched rows keep CSV borough and map their neighborhood onto an NTA name, so every page uses one naming system. CSV rows come first; DOHMH duplicates are merged. |
| `names.py` | normalization, display casing of ALL-CAPS dba (`McDonald's`, `7th Street Burger`, `BurgerFi`; overrides map), slugs |
| `chains.py` | brand grouping (curated aliases + any brand with ≥3 locations) and scrape **targets**: one per chain, one per other restaurant |
| `discover.py` | URL classification/ranking: official menu page / PDF > official homepage (→ Map URLs) > online ordering > aggregators > delivery apps > unknown third-party pages naming the restaurant. Rejects social/review/news, platform directory pages, and results for another location/address |
| `context_client.py` | **the only module that imports the Context.dev SDK** (request builders + `execute()`) |
| `api.py` | disk cache, credit ledger, `--max-credits`, rate gate around `context_client` |
| `extract.py` | post-processing of the JSON extraction |
| `process.py` | per-target workflow + ThreadPoolExecutor runner + `data/run_log.jsonl` |
| `build.py` | ids, stats, area summaries, methodology, JSON-Schema validation |
| `cli.py` | `python -m pipeline …` |

Per target: CSV `menu_url`, then CSV `website`, else one web search. An official homepage is resolved with one
Map URLs call; if the map has no menu page the target searches (if it hasn't) and tries the homepage after
ordering pages/aggregators. Scrape candidates in rank order until a priced beef burger is found. **Hard caps per
target: 1 search, 1 map, 3 scrapes** (reason goes in `status_detail`). Chains: one NYC location's menu (a CSV
member's URL if any, else a search on a representative address) is applied to every location; big chains whose
own site shows no prices (McDonald's, Burger King, Wendy's, Shake Shack…) skip their official site.

Extraction rules (schema + instructions in `context_client.py`, clean-up in `extract.py`): numeric price of the
burger alone; market price → null; single/standard size; no combo/meal upgrades or add-ons (meal-only → null);
sliders only when sold as a burger; kids' items dropped; prices < $2 or > $150 dropped as suspect (noted);
names cleaned (trailing prices, emoji, ®); duplicates collapsed. **Lunch vs dinner:** a burger on several menus
keeps its dinner/all-day price; late-night, lunch, brunch, then happy-hour prices are used only when it is not on
the dinner menu. Status: `priced` (≥1 priced beef burger) | `no_prices` | `no_burgers` (incl. only non-beef) |
`no_menu_found` | `error`. `index_price` = cheapest priced beef burger; exactly that burger has
`is_index_item: true` (ties → first on the menu).

## Data files

- `data/burger_index.json` — THE dataset (contract above). `build` validates before writing and fails loudly.
- `data/restaurants.json` — resolved restaurant universe + match report (`build` reuses it; pass scope flags to re-derive).
- `data/run_log.jsonl` — one line per target per run: status, urls tried, attempts, credits.
- `data/credit_ledger.jsonl` — one line per **billed** live call: estimate, actual, run total, account balance, rate-limit headers.
- `data/cache/` (gitignored) — `socrata/` DOHMH snapshot; `search/`, `map/`, `scrape/` Context.dev responses at
  `data/cache/<endpoint>/<sha1(canonical request)>.json`.

## Context.dev (web data)

- **Env var:** `CONTEXT_DEV_API_KEY` in `.env` (gitignored; loaded by python-dotenv). Rotate at https://www.context.dev/dashboard/api-keys. Never hardcode or print it.
- **Wrapper:** `pipeline/context_client.py` is the only module that touches the `context.dev` SDK (`from context.dev import ContextDev`). Add new calls there (a `*_request()` builder + a branch in `execute()`); everything else goes through `pipeline.api.Api`. Tests mock `pipeline.context_client.execute`, never the live API.
- **SDK retries:** `max_retries=3` — the SDK retries 408/409/429/5xx with backoff and honors `Retry-After`. Still failing → `TransientError` (cached as a placeholder, retried by the next live run, 0 credits). 401 / `USAGE_EXCEEDED` / `PAID_PLAN_REQUIRED` → `FatalError` (run stops). Other 4xx are page answers and are cached.
- **Endpoints in use** (append `.md` to a docs URL for markdown):
  - `POST /web/search` — `client.web.search`, `numResults=10`, `country=us`, `excludeDomains` (yelp, tripadvisor, social, eater…), no inline markdown. **1 credit per 10 results.** https://docs.context.dev/api-reference/web-scraping/search
  - `GET /web/urls` (Map URLs) — `client.web.map_urls(domain, urlRegex="(?i)(menu|food|dinner|lunch|brunch|\.pdf)", maxLinks=100)`. **1 credit** (2 with `search`). https://docs.context.dev/api-reference/web-scraping/map
  - `POST /web/scrape` — `formats.json` + `jsonParams.schema` (`BURGER_MENU_SCHEMA`) + instructions, `sharedParams.parsers.pdf.ocr=auto` (≤10 pages), `dismissPopups`, `includeFrames`; response at `resp.json_.data`. **1 + 4 (JSON) credits, +1 per OCR'd PDF page**; charged even on Context.dev's own cache hits. Browser `actions` (e.g. scrolling lazy delivery-app menus, +1 credit) need a paid plan — gated off by `config.SCROLL_DELIVERY_APPS`. https://docs.context.dev/api-reference/web-scraping/scrape
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
- Live calls **reserve** their estimated cost before sending; `run` stops cleanly when the next call would pass
  `--max-credits` **or** the account balance reported by the API (`key_metadata.credits_remaining`). Finished
  targets are cached, unstarted ones are logged as `stopped`; the next `run` resumes where it stopped.
- Always `plan` first. It prints first-pass / expected / worst-case credits and the last seen account balance.
  Test with `--only "<name>"` or `--limit 1`. Never run the full pilot casually.
- **Batch API** (https://docs.context.dev/guides/scrape-websites-in-batches): outputs Markdown or HTML only —
  **no JSON extraction** — at 1 credit per successful page (+OCR), with its own rate bucket. Switching makes sense
  once we scrape thousands of known menu URLs (e.g. after widening `--cuisines`, or monthly re-pricing) *and* run
  our own extraction over the Markdown; until then `/web/scrape` + JSON (5 credits) is simpler. Not implemented.
- For scheduled re-pricing, use Monitors (https://docs.context.dev/guides/monitor-website-changes) rather than a polling loop.
