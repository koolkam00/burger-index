# Burger Index

The price of every burger at NYC restaurants. Two halves joined by one JSON file:

- **`pipeline/`** (Python 3.12 venv at `.venv/`; `.venv/bin/pip install -r requirements.txt`) writes
  **`data/burger_index.json`**, which must validate against **`contract/burger_index.schema.json`** (the output
  contract; `additionalProperties: false` everywhere — do not change it casually; `pipeline/models.py` and
  `web/src/lib/schema.ts` (zod) mirror it, so a contract change means updating all three). **Version 2
  (2026-09-25) carries only what the site reads:** `version`, `generated_at`, `stats` (`restaurants_priced`,
  `index_median`, `index_p10`, `index_p90`), `boroughs`/`neighborhoods` (`slug`, `name`, `borough`,
  `restaurants_priced`, `index_median`/`min`/`max`; every area with a restaurant, priced or not) and `restaurants`
  in two shapes picked by `index_price`: a **priced** restaurant (`id`, `name`, `chain`, `address`, `borough`,
  `neighborhood`, `neighborhood_slug`, `lat`, `lng`, `website`, `menu_url`, `price_source`, `index_price`,
  `burger: {name, description}`, `hand_check: {checked_on} | null`) and an **unpriced** one, a name the site lists on
  its neighborhood's page (`id`, `name`, `address`, `neighborhood_slug`, `index_price: null`, `burger: null`). Status,
  scrape notes, DOHMH ids, cuisine and the like stay in the pipeline (`data/restaurants.json`,
  `data/run_log.jsonl`).
- **`web/`** (Next.js 16 static export, Node ≥ 20.15; `npm test` needs Node ≥ 22.6) copies that file in at build time and renders it to plain
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
| `sources.py` | DOHMH inspections via Socrata (`43nn-pn8j`, free) → one record per CAMIS from its latest inspection; drops boro `0`/missing, lat/lng `0` → null, stale restaurants (flag), and the old CAMIS of a restaurant **re-permitted** at the same address (same brand/near-same name, permits issued apart, old one last inspected earlier; venue stands issued together stay) → `report.dohmh_superseded_permits`. Neighborhoods = **2010 NTA names** from `8ius-dhrr` (the 2010 NTA boundary datasets were retired), committed at `pipeline/data/nta_2010.json` (`sources --refresh-nta` to regenerate), with misleading ones relabeled in `NTA_DISPLAY_OVERRIDES` (MN27 Chinatown-Lower East Side, MN28 Lower East Side-Alphabet City, BK72 South Williamsburg, BK73 Williamsburg, and the placeholders BX99 `park-cemetery-etc-Bronx` as Bronx parks and BK99 `park-cemetery-etc-Brooklyn` as Other Brooklyn areas; a park/cemetery NTA's restaurant ids keep the placeholder's `park` whatever its label, `build._nbhd_short`); missing NTA → most common NTA of the zipcode. Restaurant-list rows are matched (rapidfuzz, same borough) to DOHMH for camis/address/coords, only to records of the same national-chain status (a `Shake Shack (…)` row only to a Shake Shack permit, any other row never to one), and only where the **location agrees** (`Matcher`): tier 2 = at an address the row's notes or URLs name (`at 320 W 36th`, `…-34-canal-st`; every record there is a candidate, so a renamed or company-registered place still matches when it shares a real word: `Holy Cow` → HOLY BURGER, `Popchew Burger` → THE HIGH NOTE / POPCHEW); tier 1 = in one of the row's neighborhood NTAs (`NEIGHBORHOOD_ALIASES`, several NTAs each: Midtown East→MN19/MN20, Harlem→MN11/MN03/MN06, UES→MN40/MN31/MN32, NoHo→MN23/MN22, Cobble Hill→BK09/BK38/BK33…; a parenthetical like `(UES)` adds its NTAs) or on a street its notes, URLs or name name (`Court St outpost`; `Westville Hudson` → 333 Hudson St; `Shake Shack (Madison Square Park)` → the stand at that address: `street_in_name`); tier 0 = a name match elsewhere only when the name is the same, the permit has been inspected (never a `1900-01-01` one), the row names no other address, and no other place in NYC with that name (or a near one starting the same way: NEPTUNE DINER II yes, L'WREN for `The Wren` no) is left for it (`Gertie`, one location, stale CSV neighborhood: yes; `Neptune Diner` Astoria → the Bayside one: no). Names are compared without generic words (`PJ Brady's Bar and Restaurant` = P.J. BRADY'S TAVERN ≠ BRASAS RESTAURANT & BAR), combined DBAs are split (`ACME / THE NINES`, `CITY ISLAND DINER , SNUG BAR`), a name inside another only counts from its first word (`burgers & beer` ≠ `black tap craft burgers & beer`, `BFB Highline` ≠ HIGHLINE CAFE; a DBA may put an owner or street before the row's name: KENN'S BROOME STREET BAR, 10TH AVENUE COOKSHOP), and one ordinary word never carries a match (`Spring Cafe` ≠ SPRING, `The Junction Bar` ≠ THE JUNCTION: `COMMON_NAME_WORDS`, words in 20+ DBAs, the row's own neighborhood names). CAMIS are assigned **independently of CSV order** (`assign_matches`): strongest evidence first, a row whose record another row took falls back to its next one, and a row whose best records tie waits until other rows have taken all but one of them. Records that tie on everything else are told apart by `near` only: the one next to the address the row's notes name, placed from the DOHMH records on that street (`Matcher.locate`; `Brooklyn Diner` "212 W 57th" → its corner permit at 888 7th Ave), else, for a row that names no address, the one in its neighborhood's ZIP codes (`NEIGHBORHOOD_ZIPS`: West Village 10014 → Jack's Wife Freda at 50 Carmine St, not University Place); the method then ends `+near-named-address` / `+neighborhood-zip`. Report: `csv_unmatched` (with why), `csv_duplicate_matches` (two rows, one record; `first_row` kept it), `csv_ambiguous` (records tie, e.g. two STOUT NYC in MN17: the row stays CSV-only instead of taking the lowest CAMIS; permits at one address are one place), `csv_address_now_other_business` (the address a row names holds another business now: likely closed; a business the row's notes name there, like At The Office's "beside The Consulate (same address)", doesn't count), `csv_stale_matches` (last inspected before `--min-inspection-date`: flagged, kept). Every record carries `csv_row` (1-based data row of the list; null for DOHMH-only records). Unmatched rows keep CSV borough and map their neighborhood onto an NTA name, so every page uses one naming system (keys `csv:<name>-<borough>`, made unique on collision). CSV rows come first; DOHMH duplicates are merged. With `--national-chains exclude` (default), national chains are dropped after matching → `report.national_chains_excluded` (display name → locations). |
| `names.py` | normalization, display casing of ALL-CAPS dba (`McDonald's`, `7th Street Burger`, `BurgerFi`, `57's`; overrides map), `LIST_NAME_DISPLAY` (restaurant-list names copied from a DOHMH DBA with broken casing, shown as the restaurant spells them; display only, same slug/id), slugs |
| `chains.py` | brand grouping (curated aliases + any brand with ≥3 locations) and scrape **targets**: one per chain, one per other restaurant. Curated chains can carry `cheapest_item` (a delivery page without it is partial) and a pinned `menu_url` (scraped first). Airport locations (JFK/LGA) never get the chain's street price. `ChainDef.national` marks national chains; `NATIONAL_ONLY` holds more national patterns (Shake Shack stands named after their venue, IHOP, Outback, PLNT Burger…, and Tex's / Texas Chicken & Burgers) that are never grouped; `is_national_chain()` checks the DOHMH dba, then the restaurant-list name. Add a new national brand there, with a test in `tests/test_sources.py` for its DBA spellings and a local look-alike that must stay |
| `discover.py` | URL classification/ranking: official menu page / PDF > official homepage (→ Map URLs) > online ordering > aggregators > delivery marketplaces with full store menus (Grubhub/Seamless, published as `delivery_app`) > unmapped homepage > lazy-loading delivery apps (Uber Eats, DoorDash, Postmates) > unknown third-party pages naming the restaurant. Own-domain check strips generic/place affixes (`duewestnyc` = Due West) and only trusts containment for names ≥6 chars. Rejects social/review/news, platform directory pages, and results (or scraped `location`s) for another location/address; other cities count only in a city/state position (`Houston, TX`, `White Plains, NY 10601`) or as a non-NYC ZIP, so Houston St / White Plains Rd / buffalo wings are fine; official pages are only rejected for another city when they name no NYC place |
| `context_client.py` | **the only module that imports the Context.dev SDK** (request builders + `execute()`) |
| `api.py` | disk cache, credit ledger, `--max-credits`, rate gate around `context_client` |
| `extract.py` | post-processing of the JSON extraction |
| `process.py` | per-target workflow + ThreadPoolExecutor runner + `data/run_log.jsonl` |
| `corrections.py` | hand-checked fixes from `pipeline/data/corrections.json` (per `target`: `set` / `drop` / `add` burgers, `price_source`, `withhold`; each with `source_url`, `reason`, `checked_at`), applied by `build` on top of the scraped results (cache untouched) — free, no API calls. Strict: `build` fails if one names a target or burger no longer in the scrape. The correction's `source_url` becomes `menu_url` (and its `price_source` the price source); a correction that leaves the restaurant priced records `hand_check: {checked_on: checked_at}`, published on every priced location it applies to (the site's "Prices corrected by hand" slip); a withheld one records none (the restaurant is unpriced). The `reason` is never published |
| `build.py` | `restaurant_rows` (corrections, template rule, airport rule, the one burger, ids; each row keeps the pipeline's `status` for the CLI summary), then `dataset`: stats, area summaries and each row published in its contract shape (`publish`), JSON-Schema validation |
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
count it as not yet scraped and the next `run` retries — until the same call has failed on
`config.TRANSIENT_ACCEPT_RUNS` (2) separate runs in `data/run_log.jsonl`; then the best result stands, with a note. Chains: one NYC location's menu (a CSV member's URL if any,
else a search on a representative address) is applied to every location except airport concessions; its
`status_detail` names the location whose menu was read (the member at the address the scraped page names, else the
restaurant-list member whose URL it was, else the representative), and that row is the chain's source row in `build`.
Curated chains whose own site shows no prices (`official_has_prices=False`: the national chains, so only with
`--national-chains include`) skip their official site.

Extraction rules (schema + instructions in `context_client.py`, clean-up in `extract.py`): numeric price of the
burger alone; market price → null; single/standard size; no combo/meal upgrades or add-ons (meal-only → null);
sliders only when sold as a burger; kids' items dropped; prices < $2 or > $150 dropped as suspect (noted);
names cleaned (trailing prices, emoji, ®; a `...with cheese` continuation line takes the name of the burger above it,
as on Henry Public's menu); duplicates collapsed. **Lunch vs dinner:** a burger on several menus
keeps its dinner/all-day price; late-night, lunch, brunch, then happy-hour prices are used only when it is not on
the dinner menu. Status (pipeline only: `run_log.jsonl`, `plan`, the `build` summary; not in the dataset):
`priced` (≥1 index-eligible beef burger) | `no_prices` | `no_burgers` (incl. only non-beef) | `no_menu_found` |
`error`. Restaurant ids are assigned over every restaurant in scope (scraped or not), so they stay stable as more
targets are scraped (People's Top 10 lists are keyed on them).

**One burger per restaurant: its highest-priced burger (user decision, 2026-09-24).** Every restaurant publishes
exactly one burger, `extract.top_item` (build only): its highest-priced eligible beef burger with a dinner/all-day
price; only if none has one, the highest from the next period (late-night, lunch, brunch, other); **never a
happy-hour price**; ties → first on the menu. That burger is the restaurant's `burger` (`name`, `description`) and
its price is `index_price`. Eligible = one burger for one person at its listed price: doubles, triples,
specialty/wagyu burgers and a burger plated with fries (`Burger Platter`, `Burger & Fries`) count, and so does **a
burger club** (user decision, 2026-09-25: `Cheeseburger Club`, `Bacon Burger Club`, a triple-decker `Cheeseburger Club
Sandwich`; nothing treats `club` as a plate, group item or sides mark, and a scrape that missed a club section is
fixed with an `add` correction); burgers sold in sizes stay at the single size; **never** a diner's **bunless diet
plate** (user decision, 2026-09-25; `extract.is_diet_plate`: by name `Slim-Line`/`Slim Line`/`Slimline`/`Slime Line`,
`Lo-Cal`/`Low Cal`/`Low-Calorie`, `Diet` (`Diet Delights`), `Dieter's`, `Weight Watchers`, `Bunless`/`No Bun`; a
`Keto`/`Atkins`/`Low-Carb` burger only when bunless; otherwise only a description saying both diet plate and no bun,
"cottage cheese on a bed of lettuce"; `Slim Jim Burger`, `Local Burger`, a keto burger on a zucchini bun and a
lettuce-wrapped burger stay eligible), never a
group item (`extract.top_item_exclusion`: `for 4`, family/party/catering/tray/dozen/bucket/tower/flight/sampler/kit/
box/bundle, a count of 6+ like `(6)`/`x6`/`12 pc`, `serves 3`, a description opening with "10 … cheeseburgers"
such as Cubby's catering platters), a combo/meal deal (`Meal`, `Combo`, `Deal`, a drink in the price: "+ fries &
Can Soda", or a beer: "Served with a 16oz Gigawatt beer", `HH Burger & Beer`; beer as an ingredient such as `IPA
caramelized onions`, `beer battered`, `beer cheese` or `Beer Fed Wagyu` is fine), an eating challenge (Clinton
Hall's $50 `The CH Challenge`: "challenge", "it's free", "time limit"), a kids' item or a hot dog/pet item; **a burger
with sides next to its plain twin** (`extract.is_sides_twin`: `BBQ Burger Deluxe` $20.25 beside `BBQ Burger` $15.25,
`Deluxe Bacon Cheeseburger`, `Burger with Fries`, `X - Deluxe` beside `X - Plain`) gives way to the cheaper plain
burger, since the extra is the sides (a menu that lists only the Deluxe/Platter form keeps it); **plates of several
burgers** (`extract.is_multi_burger_plate`: slider plates, "Three sliders per order", a `Twin Burger` of two burgers
on two buns, a count of 2–5 like `Smash Burger (2)`) only when the menu has no other eligible beef burger. A page `process` found priced only through
group platters or combos builds as `no_prices`. An unpriced restaurant publishes no burger (`burger: null`,
`index_price: null`) and only its name fields. `extract.index_item` (the cheapest beef burger) is unchanged: `process.py` uses it,
through `classify_menu`, to decide whether a page is priced and whether to keep searching, so the cache replays
exactly; don't switch process to `top_item` without planning a re-scrape. Corrections apply to the full scraped
menu before the pick. The 2026-09-25 corrections come from a review of these picks: another city's menu (Carnegie
Diner's Vienna, VA page for both Midtown locations), and **Grubhub/Seamless pages whose burger section never loaded**
(the cached scrape's `metadata.headings` show only Best Sellers / recently ordered items, so the highest-priced burger
is unknown: 26 such pages are withheld; drop the entry once a full menu is scraped). **Marked-up delivery / online
prices are published when they are the only price (user decision, 2026-09-25):** a markup alone is never a reason
to withhold, so American Whiskey (its Grubhub/Seamless `Burger`, $20.40, `delivery_app`), Grillify-NYC (Postmates,
`delivery_app`) and XO Burgers (no correction: its webshop's scraped $22.54, the price that page shows) publish;
where the restaurant's own price was read and set by hand (Boeuf & Bun: Uber Eats = own price / 0.56, so its own
ordering page's $32) the own price stays. Withholds remain for closed places, another restaurant's page, stale copies
and partial pages (Brooklyn Diner's LaGuardia Terminal B row is withheld: its search found only the Manhattan menu, and an
airport concession never gets a street restaurant's price; Nana's Kitchen in the Bronx is withheld since 2026-09-27: its
only menu found is Nana's Kitchen and Pizzeria's in Auburn, NH, and its own site is a parked domain). **Sauce (`getsauce.com`) is a third-party pickup and delivery
platform, not the restaurant's site:** it is not yet in `discover.ONLINE_ORDERING` (adding it changes the offline replay:
plan it with a re-run), so a CSV `menu_url` there reads as `official_menu`; corrections relabel the six such pages
`online_ordering` (BK Jani, whose Sauce prices are a flat $2 above its year-old own menu image, Fat Boys, Gracie's,
Moe's, Murray Hill Diner, The Flame Diner), and a new one needs the same entry.

Post-processing index rules (`extract.py`/`build.py`; free on the next `build`, no re-scrape; `normalize_menu` never
removes these rows, because `corrections.json` names them and `process` counts them):
- **Slider plates** (`extract.is_slider_plate`: `Cheeseburger Sliders (3)`, a single `Beef Slider`, `Mini Burgers`, `2 Mini Slammers`, `Baby Burgers (3)`, `Trio of Sliders`) are never the index item while a standard beef burger is eligible; a page with only slider plates keeps its slider price. These do not match: `Slider Burger`, `Bistro Mini`, a single `Mini Burger`, and `Little`/`Junior`/`Jr.` burgers.
- **Not burgers** (`extract.is_not_a_burger`: a hot dog or sausage whose name lacks `burger`, such as `The Frank`, and pet items such as `The Pup Patty (Patty for Puppy)`) never set the index, never make a page `priced` and are never published.
- **Site-builder template placeholders** (`extract.is_template_placeholder`: "This is an item on your menu…", every item $9) are dropped by `build.drop_template_placeholders` after corrections. A page with nothing else becomes `no_menu_found`.

**Chains count once (product decision, 2026-09-23).** The Burger Index (`index_median`/p10/p90) and every
borough/neighborhood median/min/max are computed over **distinct menus** (`build.menu_index_prices`): each
independent restaurant once, each chain once citywide and at most once per area — otherwise one 7th Street Burger
menu would count 22 times, once per location. Location counts (`restaurants_priced`, citywide and per area) still
count every location, since each has its own page and table rows.

**National chains are out (product decision, 2026-09-23).** McDonald's, Burger King, Wendy's, White Castle,
Checkers, Sonic, Five Guys, Smashburger and Shake Shack (the user chose to remove Shake Shack too), plus the other
national burger and casual-dining brands in `chains.py` (PLNT Burger, Slutty Vegan, Umami Burger, Cheeburger
Cheeburger, BurgerFi, Applebee's, Outback, Dave & Buster's, Hard Rock Cafe…), are left out of the index entirely
(`--national-chains exclude`, the default). So is Tex's / Texas Chicken & Burgers: NY-area, but fast food with ~35
NYC permits (user decision). NYC's own small chains stay and count once: 7th Street Burger, Jimbo's Hamburger Palace,
Bareburger, Jackson Hole, Burger Joint, Harlem Shake, 8-Bit Bites, Black Tap (an NYC original, kept by the user),
Bill's Bar & Burger, 5 Napkin Burger. NY-area groups such as Burgerology and Nathan's stay too. **National upscale /
sit-down restaurants stay** (user decision): Del Frisco's, Smith & Wollensky, STK, Hillstone, Burger & Lobster (read
as covering the likes of Capital Grille and Morton's too), and so do the Swingers and Puttery venues. Still open,
ask the user before widening `--cuisines`: other entertainment venues (Lucky Strike, Alamo Drafthouse) and Wonder.

## Data files

- `data/burger_index.json` — THE dataset (contract v2 above). `build` validates before writing and fails loudly.
- `data/best_burgers.json` — the `/best-burgers` page's lists and places, curated by hand from the 2026-09-25 research
  (facts only: publisher, list title, link, date; place name, dataset `restaurant_id` (or a `neighborhood_slug` for a place
  the dataset doesn't carry: Crane Club, Julius', Lundy's), the burger each list names). **Every open place whose beef burger
  a counted list names is on it: one publisher is enough** (user decision 2026-09-25, "/best-burgers should have all those
  burgers"; the earlier two-publisher minimum was not the user's rule). Decisions applied in the file: lists published or
  updated 2024-2026; no Upper Cut Media House lists (the publisher sells partnerships) and no pure trend features (Grub
  Street 2025, the New York Post's Aug 2025 off-menu piece; chef-pick features count); beef burgers only (no national chains,
  no vegetarian/vegan, lamb or bison picks, and a source naming only a non-beef burger doesn't count: Eater's Old Town Bar
  entry mentions only a bison burger, so Old Town Bar is there for The Infatuation's cheeseburger alone); closed places left
  out (Blue Hour, Gus's Chop House, Bandits Burger & Dive, Debbie's Burgers, Loring Place, Paper Plate, F. Ottomanelli:
  temporarily closed; Little Fino no longer serves a burger). 96 places from 23 lists by 11 publications; the places the
  lists name were added to the restaurant list (`source` `best-lists-2026-09`) and priced, so 91 carry a menu price (Peter
  Luger, Le B., Crane Club, Julius' and Lundy's publish none). The page groups them by publication count ("Named by 10
  publications" … "Named by 1 publication"). The web build (`web/src/lib/best-burgers-data.ts`) fails if an id, list or
  neighborhood is missing or a rule is broken. Not a pipeline output: `pipeline build` never touches it, but a dataset
  change that drops a `restaurant_id` breaks the web build until the file is fixed.
- `data/peoples_top.json` — **the People's Top 10 board** (the Patty Ladder's daily board, user decisions 2026-09-25/26).
  **Owned by the daily workflow on `main` once merged: never edit, regenerate or commit it on a branch**, and never
  hand-edit it anywhere: it is the ladder's only memory (yesterday's scores, tiers and seats). See "People's Top 10
  snapshot" under "Website". Not a pipeline output; `pipeline build` never touches it.
- `data/ranker_published_lists.json` — **the five published burger rankings counted as People's Top 10 lists** (user
  decisions 2026-09-26/27: the critics' rankings seeded "as peoples lists in the database", then "add at least one more
  list"; only genuinely ranked lists, none invented). Facts only: per list its `id` (the `/best-burgers` list id, or its
  own slug), `publisher`, `title`, `url`, `date`, `checked_on`, `added_on` (a list added after the seeding: the New York
  day its addition was applied), `length` (the list's own entry count), `items` (menu keys, best first), the list's own
  `ranks` and `names` for them, `left_out` (rank, name, reason) and short mapping `notes`; plus `seeded_on`. The
  Infatuation's Smashburger Power Rankings (17), its Limited Edition Burgers, Ranked (9), Time Out's 16 best burgers (14;
  numbered, never called a ranking) and Brooklyn Magazine's 9 best burgers (5), seeded by
  `supabase/migrations/20260927113449_ranker_published_lists.sql`, and Tasting Table's 14 Best Burgers In NYC, Ranked
  (12; June 2023, though its page shows the 2014 date of the earlier article at that link), added by
  `20260927165759_ranker_published_add.sql`. Both are written from this file by `web/scripts/ranker-published-migration.mjs`
  (`--write` seeds once; `--add <id> --write` adds a list marked `added_on`); `web/test/ranker-published.test.ts` pins the
  five lists and fails if the file and a migration differ: **don't edit it to change the lists** (see "Published rankings
  in the People's Top 10" under "Website"). Not a pipeline output, and the site doesn't read it (the sourcing line that did
  was removed at the user's request on 2026-09-27).
- `burger-list-master.csv` — **the restaurant list** (`config.RESTAURANT_LIST_CSV`; 1,125 rows after the 2026-09-23 clean-up, the 2026-09-24 passes and DOHMH expansion, the 2026-09-25 deletions, the 2026-09-25 best-burger-list additions (two rounds) and the 2026-09-26 deletions (Bandits Burger + Dive, closed, and the old Lori Jayne row at Alphaville), see `data/list_changes_2026-09-23.md`: `name, neighborhood,
  borough, website, menu_url, notes, source` where `source` is `pilot-100|uptown|downtown|outer|dohmh-diner-pub|dohmh-hamburgers|best-lists-2026-09`). It's the user's data:
  don't edit it without their approval; report duplicates (`report.csv_duplicate_matches`), unmatched rows (`report.csv_unmatched`),
  ambiguous rows (`report.csv_ambiguous`) and closed places (`report.csv_address_now_other_business`,
  `report.csv_stale_matches`; e.g. "Guy Fieri's American Kitchen & Bar", Times Square, closed 2017) for the user to fix.
  The original 100-row pilot list is its `pilot-100` rows (the pilot CSV itself was deleted on 2026-09-25; git history has it).
- `data/restaurants.json` — resolved restaurant universe + match report (`build` reuses it; pass scope flags to re-derive).
- `pipeline/data/dohmh_overrides.json` — per-CAMIS fixes for typos in DOHMH records (e.g. Rosemary's `1820` → `18`
  Greenwich Ave with real coordinates), applied by `sources`; `report.dohmh_overrides_applied` lists them and an unused
  override is reported. `pipeline/data/corrections.json` — hand-checked menu price corrections applied by `build`.
- `pipeline/data/location_overrides.json` — hand-checked locations of restaurant-list rows no DOHMH record matches
  (`csv:…` key → `address`, `lat`, `lng`, `address_source`, `geocode_source`, `checked_at`, `reason`; added 2026-09-26 so
  priced places reach the map, the landmark pages and Nearby): the address from the restaurant's own site (DOHMH's current
  inspection record where the site blocks automated browsers), the point from NYC Planning's GeoSearch (a pier has no
  address point: Frying Pan's is OpenStreetMap's node for it at Pier 66). Never place a row that is another row's restaurant
  under another name (Blue Road Burger = Blueroad, Millard Fillmore Tavern = Fillmore's Tavern: same site, menu and
  address; left for the user to resolve in the list): it would show twice on the map and be its own "nearby". `sources` attaches
  it as the record's `location_override` (`report.location_overrides_applied`/`_unused`) and `build` publishes it
  (`sources.located`); the record's own `address`/`lat`/`lng` stay empty, because the scrape reads them (the search query,
  the page location check, a chain's representative), so the cached replay never changes. Never a neighborhood, NTA or
  zipcode (the id is name + neighborhood). Add one only for a place checked open at that address; a DOHMH record's own
  location goes in `dohmh_overrides.json` instead (coordinates only).
- `pipeline/data/menu_urls.json` — hand-checked menu pages per restaurant key (`camis:…`/`csv:…` → `menu_url`, `checked_at`,
  `reason`), applied by `sources` (CSV untouched; `report.menu_url_overrides_applied`/`_unused`): scraped first, as is, and
  trusted as that restaurant's page. Each new one is a re-scrape on the next `run` (credits); never also correct that target.
- `data/run_log.jsonl` (gitignored, local only) — one line per target per run: status, urls tried, attempts, credits.
  **Never delete it:** `plan` and `build` replay from it (retry_pending, transient acceptance), so it changes what is published.
- `data/credit_ledger.jsonl` (gitignored, local only) — one line per **billed** live call: estimate, actual, run total,
  account balance, rate-limit headers.
- `data/cache/` (gitignored) — `socrata/` DOHMH snapshot; `search/`, `map/`, `scrape/` Context.dev responses at
  `data/cache/<endpoint>/<sha1(canonical request)>.json`.

## Website (`web/`)

```bash
cd web && npm install
npm run dev              # sync-data, then http://localhost:3000 (from ../data/burger_index.json)
npm run lint             # these four must pass with zero errors
npm run typecheck        # next typegen && tsc --noEmit
npm test                 # node:test over test/*.test.ts (no extra deps; reads ../data/burger_index.json)
npm run build            # sync-data, then static export to web/out/
npm run preview          # serve out/ at http://localhost:4173
npm run check:seo        # after a build: titles, descriptions, canonicals, JSON-LD, sitemap, robots, llms.txt, CSV, links
npm run validate:data    # ajv check against the contract (default ../data/burger_index.json; pass a path for another)
npm run indexnow         # after a production deploy: submit the live sitemap to IndexNow (SITE_URL=https://… or --site)
```

- **Data in:** `scripts/sync-data.mjs` (runs as `predev`/`prebuild`) copies `../data/burger_index.json` to
  `src/data/`, validates it against the contract with ajv (invalid data fails the build), copies
  `../data/best_burgers.json` and `../data/peoples_top.json` (the People's Top 10 board: the empty early board when missing or broken) and
  copies the MapLibre worker to `public/vendor/maplibre/`; all outputs are generated and gitignored. There is no sample data: a missing
  `data/burger_index.json` fails `dev` and `build` with a message (it is committed; `pipeline build` rewrites it from the
  cache). The web tests read the same file (`test/dataset.ts`) or small inline rows.
- **Reading data:** `src/lib/data.ts` is `server-only`: it parses the file once with the zod mirror
  (`src/lib/schema.ts`), checks that ids are unique, and exposes typed selectors (`getStats()`,
  `getPricedRestaurants()`, `getPricedRestaurant(id)`, `isPriced`/`isUnpriced`, …). Only priced restaurants
  (`PricedRestaurant`) get a page; unpriced ones (`UnpricedRestaurant`) are names on their neighborhood's page.
  Client components import enum lists from `src/lib/enums.ts` and only `import type` from `schema.ts`, which keeps zod
  out of the browser bundle.
- **Next 16** has breaking changes versus older docs: read `web/AGENTS.md` and `web/node_modules/next/dist/docs/`
  before writing Next code. `output: "export"`: every route is static (`generateStaticParams`); the only route
  handlers are force-static files (`/og.png`, `/llms.txt`, `/data/burger-prices.csv`, `/data/menus.json`, sitemap, robots).
- **The burger ranker (user decisions 2026-09-25/26; it replaced all crowd pricing)** is the home page's first screen
  (`#rank`, full width, above the H1 "What a burger costs in New York.", user decision 2026-09-26; DESIGN.md "The ranker
  hero"): search the priced burgers (distinct menus, a chain once), add 3 to 25 best first
  ("your top 10", room for more), move them with up/down buttons (or, with a mouse, drag them by a grip at the row's start:
  user decision 2026-09-26, pointer only, from 480px where the pointer is fine and hovers; a press is a drag only after
  5px of movement), remove them. **It autosaves** (user request 2026-09-27; no Save button): once the list holds 3, about 2 s
  after the last change, one save at a time, never the list already saved, network failures retried (5 s, 15 s, every
  minute; an odd reply 3 times; the hourly budget after the hour, while the page stays open), other refusals not until
  the next change, a waiting save flushed when the page is hidden (the newest list as a keepalive `fetch` on close, even
  with a save on its way; never a refusal's or an odd reply's retry early); a list another tab deleted or a page back from
  the bfcache is checked again (after the saved list loading or a save on its way lands) before any save: a retry the close
  dropped comes back, one whose list a keepalive landed is done, and a newer list another tab saved shows (never overwritten);
  a `replaced` list is saved again only after a change made from then on or "Count it again", never just by loading; one view: a returning browser finds its saved list on the card, editable, under it a status line, "Share your top 10" and
  "Delete my list". The per-save budgets were raised for it (`ranker_rate_autosave`: 120 an hour per connection, 200 a day
  per voter id). `components/ranker/Ranker.tsx` (UI), `src/lib/ranker-store.ts` (state as an external
  store; an unsaved list in `sessionStorage` `bi-ranker-draft`, `localStorage` `bi-ranker-saved` = this browser has a saved
  list, which the `<head>` script turns into `html.ranker-saved`: a skeleton instead of an empty list until it loads),
  `src/lib/ranker.ts` (pure: limits, edits, search, the backend's replies, the status line, autosave timing, error copy) and
  `src/lib/ranker-api.ts` (the three RPCs, `save_ranking` / `get_my_ranking` / `delete_ranking`, supabase-js imported
  lazily: a returning browser's saved list on mount, else the first save), tested in `test/ranker.test.ts` and
  `test/ranker-store.test.ts`. The voter id is `src/lib/voter.ts` (`localStorage` `burger-index-voter`, the name the old
  worth store gave it). The burgers come from the force-static `/data/menus.json` (`src/lib/menu-list.ts`: every distinct
  priced menu with its priced locations, its People's Top 10 standing where the board shows it, and the neighborhoods'
  names; the badge finder reads it too), fetched when the ranker mounts, so the home HTML holds no menus. **Once the list
  on the card holds 3 burgers, the People's Top 10 shows beside it** (below it on a phone; user decision 2026-09-26, "Once
  3 are added", chosen knowing it can anchor later picks): the board's seats (the home page passes only those,
  `getRevealBoard()`), the visitor's picks on it marked, where their other picks stand, the empty board's sentence
  (`src/lib/peoples-top-reveal.ts`, `components/ranker/PeoplesTopReveal.tsx`, `test/peoples-top-reveal.test.ts`). **"Add to
  your top 10" on every restaurant page** (user decision 2026-09-26; only while lists are open) links `/?add=<menu key>#rank`
  (`rankerAddHref` in `src/lib/site.ts`; a chain's locations all add the chain's menu key; nofollow): the ranker reads the
  key once, drops it from the address, and once the burgers and the saved list are known adds it at the end if there is
  room (then it saves itself), saying so on the card and in its live region ("Emily added at #4. 4 burgers on your list.",
  "… is already on your list, at #2.", "Your list is full: 25 burgers. Remove one to add …"); the live region and `ranking_item_added` fire once
  per add (`claimLinkAdd` in the store, so a remount on a return to home repeats neither); `check:seo` checks every
  restaurant page's link. **"Share your top 10"** (user decision 2026-09-27) under a saved list (held while the list on the card
  differs from the saved one) opens a panel: a 1080×1920 story or 1080×1080 square image of the list's first 10
  (restaurant over "burger · where", names cut with an ellipsis; the share images' list card), drawn in the browser on a
  canvas with the page's own fonts (`src/lib/share-list-image.ts`; words, rows and geometry pure in `src/lib/share-list.ts`,
  `test/share-list.test.ts`; `components/ranker/ShareList.tsx`), then "Share image" (the Web Share API with the file, where
  the browser can share files), "Download image" and "Copy link"; the link is the home ranker, `https://<site>/?ref=share#rank`
  (`rankerShareUrl(SITE_URL)`, passed by the home page): no list, no voter id. Without the Supabase settings the card says "Lists open soon.",
  fetches nothing, and restaurant pages have no "Add to your top 10". The header's "Rank your burgers" (and the menu sheet's) links to `/#rank` from every page; on home it
  scrolls to the ranker and focuses it; the search icon button sits next to it at every width. Under the home board:
  "See the People's Top 10" and "Most-recommended burgers". Menu keys and restaurant ids must never change (lists are
  keyed on them). "What's it worth?" is gone from the site: no pricer, no WorthPicker, no `/peoples-price` (Vercel
  redirects it to `/peoples-top-10`, `web/vercel.json`), no `/best-value-burgers`, no People's Price anywhere; the old
  answers stay stored in Supabase, hidden, and none are accepted (`supabase/README.md`).
- **The People's Top 10 (`/peoples-top-10`, user decisions 2026-09-25/26)** shows the daily board
  (`data/peoples_top.json`, see "People's Top 10 snapshot"), read at build by `src/lib/peoples-top-data.ts` (server-only;
  checked by the zod mirror in `src/lib/peoples-top-schema.ts`; a board that doesn't check out is the empty one, with a
  warning) and joined to the dataset's menus by `src/lib/peoples-top.ts` (pure: only burgers the dataset has, numbered,
  seats first; a seat whose burger left the dataset goes to the best ranked burger not under review; "≈" only between
  rows that are neighbors on the board too). The page: the 10 seats ("The top 3 so far." early on), the rest of the
  ranking, Rising ("On 7 lists · needs 3 more lists"), "Early results" under 500 lists, "Under review" (an owner hold) and
  "Checking a surge of lists" (the surge review bar), the one-liner as the only method line (**no sourcing line**: the
  one naming the published rankings, "Includes 4 published burger rankings, each counted like one visitor's list: …", was
  removed from the page, the ranker's People's Top 10 and llms.txt at the user's request on 2026-09-27; since the lists
  include published rankings, copy says plain "lists", never "visitors rank" or "their own lists": the empty lede is "The
  burgers ranked highest across the lists on The Burger Index.", and `check:seo` fails on the old wording), an empty state before
  anything is ranked ("The ladder starts when burgers are on 5 lists each (12 lists so far)."), ItemList JSON-LD only
  (never Review, Rating or AggregateRating), its own share image, the sitemap (dated by the board) and llms.txt; linked
  from the nav ("People's Top 10", replacing "People's Price"), the footer, "More burger rankings." and under the home
  board. `/best-burgers` rows show a ranked menu's People's rank ("#3 on 143 lists"). Tested in
  `test/peoples-top.test.ts`; `check:seo` recomputes the page from the board file.
- **SEO / AEO / GEO (user decisions 2026-09-25):** the origin comes from `src/lib/site-url.ts`: `NEXT_PUBLIC_SITE_URL`,
  else `https://$VERCEL_PROJECT_PRODUCTION_URL` (the free `*.vercel.app` address), else `http://localhost:4173` with a
  build warning (never a domain the user doesn't own). Titles and meta descriptions for every page type are built in
  `src/lib/seo.ts` from the real numbers and the month (titles ≤ 60 characters where possible, " · The Burger Index" only
  when it fits; descriptions ≤ 160; `pageMetadata` in `src/lib/metadata.ts` applies them); `sourceLine()` there is the one
  plain source/date line. JSON-LD: builders in `src/lib/jsonld.ts` (pure; `serializeJsonLd` escapes `<`, `>`, `&`),
  rendered by `components/JsonLd.tsx` as a native `<script type="application/ld+json">`: WebSite, Organization and Dataset
  (the CSV, licensed CC BY 4.0: `CSV_LICENSE` in `src/lib/csv.ts`, also named in llms.txt and linked after the footer's
  CSV link) plus ItemLists of the cheapest/priciest cards on home, Restaurant →
  Menu → MenuItem → Offer on restaurant pages, BreadcrumbList on every page below home (the visible crumbs where shown),
  ItemList for the `/neighborhoods` ranking, each neighborhood's restaurant table and each ranking page, FAQPage for the Q&A
  blocks (home, borough and neighborhood pages; `src/lib/answers.ts` + `components/QandA.tsx`, visible text = markup text).
  The ranking pages (`/cheapest-burgers[/<borough>[/<neighborhood>]]`, `/most-expensive-burgers[/<borough>[/<neighborhood>]]`,
  `/burgers-under-15|20`, `/burgers/<style>`; `src/lib/rankings.ts`, `components/RankingPage.tsx`) are per distinct menu
  and stay out of the nav: a neighborhood has its two lists only with 10+ distinct priced menus and lists that share no menu
  (`neighborhoodsWithRankings`), linked from its page; a burger style (`src/lib/styles.ts`: smash, double, wagyu, dry-aged,
  patty melt; a conservative classifier on the published burger's name and description, add-ons dropped) has a list only
  with 10+ menus, titled for what it is: "Burger spots in NYC where the priciest burger is a smash burger." **The
  most-recommended burgers (`/best-burgers`, user decisions 2026-09-25):** places ranked by how many distinct publishers named
  them on a best-burger list of 2024-2026 (one publisher is enough), from `data/best_burgers.json` (see "Data files"),
  grouped under sticky bars by publication count ("Named by 10 publications" … "Named by 1 publication"), each with every
  list linked (publisher, title, date), our menu price and, where it is ranked, its People's rank; one ranking-note line, the lists' own words
  never quoted, ItemList JSON-LD (no Review or Rating). **Honest wording (user
  decision 2026-09-25):** each restaurant publishes only its priciest burger, so the cheapest and under-$N lists rank
  burger spots by their priciest burger and say so ("Cheapest burger spots in NYC.", "Burger spots in NYC where the priciest
  burger is under $15.", "The priciest burger at Johnny's Reef is $6.00, the lowest top-burger price of any spot in NYC", the Q&A
  "Where are burgers cheapest in NYC?"); no copy, title, JSON-LD, llms.txt or CSV says "the cheapest burger in …", "cheapest
  burgers in …" or "burgers under $15" (`check:seo` fails on them). The most expensive lists keep "Most expensive burgers".
  Sentences say "on the Upper East Side / Upper West Side / Lower East Side" (`inNeighborhood` in `src/lib/boroughs.ts`). Never mark up the People's Top 10
  as Review, Rating or AggregateRating (ItemList only). `robots.ts` (`src/lib/robots.ts`) allows every crawler, names the AI search and
  training bots, and disallows only the `/ingest/` analytics proxy. `/llms.txt` (`src/lib/llms.ts`) and
  `/data/burger-prices.csv` (`src/lib/csv.ts`: one row per priced location; restaurant, neighborhood, borough, burger,
  price_usd, source badge label, page_url, checked; linked once from the footer) are force-static. IndexNow: the key
  file is `public/<key>.txt` (public by design) and `scripts/indexnow.mjs` submits the live sitemap. `npm run check:seo`
  verifies a build end to end (`-- --site https://…` also asserts the origin).
- **Published rankings in the People's Top 10 (user decisions 2026-09-26/27):** five published burger rankings
  (`data/ranker_published_lists.json`) are saved in the ranker's database as five lists, each counting exactly like one
  visitor's list (`supabase/README.md` "Published lists"): `origin = 'published'` rows of `ranker_private.ranker_lists`,
  their sources in `ranker_private.ranker_published`, active since 2026-09-27 (the four seeded, then Tasting Table's added
  the same day when the user asked to "add at least one more list"). **The site doesn't name them** (user decision
  2026-09-27: the sourcing line was removed at the user's request); the public audit view and these docs do, and the
  site's copy never says every list is a visitor's own. No function treats them differently (the nightly refresh, surge
  damping, rate limits, one-list-per-connection rule and owner tools are unchanged); their voter ids come from each link
  and the private salt (no visitor call can reach them), and their network hashes from the publisher (The Infatuation's
  two lists are one network: four in all). Anyone can audit them with the publishable key at
  `GET /rest/v1/ranker_published_lists` (publisher, title, url, list_date, burgers, items, added_on, status, in_board;
  never a voter id or hash). **Only genuinely ranked lists** (the publication calls it a ranking or counts its picks down
  or numbers them best first; a reader-vote ranking counts as one list) from a reputable publication, with 3+ entries
  that are priced menu keys; never an unordered roundup given an invented order, never an Upper Cut Media House list or a
  trend feature; prefer 2022-2026. Waiting for the user: Robert Sietsema's 2026 ranking on his own Substack (a critic's
  newsletter, not an edited publication). **To add one** (only with the user): its entry in the data file with
  `added_on`, `node web/scripts/ranker-published-migration.mjs --add <id> --write`, `apply_migration` (name
  `ranker_published_add`: rows only, idempotent, every key checked against `ranker_private.ranker_keys` first), the file
  renamed to the version the project recorded, and the list pinned in `web/test/ranker-published.test.ts`. **To remove
  them** (all, or one by `list_id`):
  `select ranker_private.ranker_void(array(select voter_id from ranker_private.ranker_published));` — a void is logged,
  so the daily job's 20%-drop guard accepts the fall; the board changes with the next publication (a void counts toward
  its 20-list batch only for a list already in the published aggregates). **Never delete the rows** (unlogged, not
  counted as a change, trips the guard). Then record it in the data file: the list's entry gets a `"voided_on":
  "YYYY-MM-DD"`, the New York day of the void (the file keeps what was saved; no migration reads the field). **To fade
  them:** there is no per-list weight (adding one changes the Patty Ladder: `PARAMS.version`, the database's
  `params_version`, the simulation gate); they fade as visitors' lists grow, and the owner decides when to void them (for
  example once the board leaves "Early results" at 500 lists). A publication that updates its ranking is a hand-written
  migration editing that row like a visitor's edit; the generator writes the seeding once and adds a list once. Never add
  another list, voter or network without the user.
- **Burgers near a landmark (user decision 2026-09-26, for searches like "burger near Times Square"):** `/burgers-near` (the
  hub) and `/burgers-near/<landmark>`: every priced burger spot (location) within **half a mile** (0.804672 km as the crow
  flies, "about a 10-minute walk") of a NYC landmark, nearest first, with its distance ("0.3 mi"), priciest burger, price chip,
  neighborhood and source badge. The landmarks and their points (each landmark's Wikipedia coordinates, the article named in a
  comment) are in `web/src/lib/landmarks.mjs`, plain JS that `check-seo.mjs` reads too; places that are effectively one point
  are one landmark (Penn Station and Madison Square Garden, the World Trade Center and the 9/11 Memorial), and a page names
  only the place its point measures (Columbus Circle, Chelsea Market, City Hall). **Long places are measured along their
  length** (user decision 2026-09-26): the High Line, Central Park South and the Brooklyn Bridge carry a `path` (OpenStreetMap's
  line for each, simplified to within 10 m, noted in `landmarks.mjs`) and list every spot within half a mile of any point
  along it, "anywhere along it" in the lede, count line, description and llms.txt (`isAlong`, `distanceToPathKm`;
  `check:seo` measures the paths on its own). A priced restaurant without coordinates can't be
  measured, so it is on no list and the count line is the plain "36 burger spots within half a mile" (never "All 36"); a
  DOHMH record without a location gets hand-checked coordinates in `pipeline/data/dohmh_overrides.json` (coordinates only,
  never a zipcode or NTA, which would move its id), and a list row DOHMH doesn't match its address and point in
  `pipeline/data/location_overrides.json`. Every title carries the spot count and the month (`short` in
  `landmarks.mjs` for a long name). A landmark has a page only with **5+
  spots** (`landmarksWithPages` in `src/lib/landmarks.ts`: 20 today; DUMBO 2, Yankee Stadium 1, Citi Field and Coney Island
  0 have none until the dataset has more). The lede: "36 burger spots within half a mile of Times Square, about a 10-minute
  walk; their priciest burgers run from $12.65 at … to $34.00 at … (September 2026)."; never "the cheapest burger near …"
  (`check:seo`). "See them on the map" opens `/map?near=<slug>`, which fits the map to the landmark's half mile. ItemList +
  BreadcrumbList JSON-LD, its own share image (the nearest three, no rank), sitemap, llms.txt ("Burgers near landmarks"),
  the footer's Rankings group and "More burger rankings." (so `/burgers`) link the hub; the nav marks Burgers. Slugs are URLs:
  never rename one. Tests in `test/landmarks.test.ts`; `check:seo` recomputes every landmark page and the hub from the dataset.
- **Sharing and link-building (user decisions 2026-09-25, stage 4):** **share images**: every restaurant, neighborhood,
  borough, ranking, style and landmark page and `/best-burgers` has its own 1200×630 Order Board at `/og/<page path>.png`
  (`src/lib/share-images.ts` the cards and paths, `src/lib/share-cards.ts` server-only, builds them and gives each page its
  `og:image` through `pageMetadata({ image: shareImage(path) })`, `components/og/` the Satori markup shared with `/og.png`,
  `app/og/[...path]/route.tsx` renders them); they are stored as 256-color PNGs (`src/lib/png-palette.ts`: 786 images,
  ~26 MB) and make the build take about 2 minutes instead of 17 s. Other pages keep `/og.png`. **Price badge**:
  `/badge/<id>.svg` for every priced restaurant (`src/lib/badge.ts`, `app/badge/[file]/route.tsx`: drawn with `satori`
  (a dependency pinned to the version next/og bundles) so the text is outlines, paths compacted by `src/lib/svg-path.ts`;
  not pages, never in the sitemap) and the `/badge` page (`components/badge/`: the badge of `?r=<id>` or an example, a finder
  over `/data/menus.json`, copyable HTML and image address), linked from the foot of every restaurant page.
  Honest text only: "$22 burger", "10% above the $20.00 NYC median", "THE BURGER INDEX · SEP 2026". **Press kit** `/press`
  (live numbers, the source line, the CSV and its license, a credit line to copy (`src/lib/press.ts`), the share image, a
  short description; the contact is the GitHub issues page, `src/lib/contact.ts`: never publish an email address, `check:seo`
  fails on one). **"Nearby at a similar price"** on restaurant pages (`src/lib/nearby.ts`): up to 4 other priced spots
  within 1.5 km and $4, nearest first, a menu once and never its own chain, then the same neighborhood by price; "More in …"
  leaves those out. `/press` and `/badge` are in the footer, the sitemap and llms.txt; `check:seo` checks every share
  image (one per page, a 1200×630 PNG, its alt naming the page's price or H1), every badge (one per priced restaurant, its
  title's price and comparison), both pages, no email anywhere, and each nearby list recomputed from the dataset.
- **Counting:** the site counts distinct menus through `src/lib/menus.ts` (menu key = chain, else restaurant id), the same
  rule as `build.menu_index_prices`: histograms, typical range, rankings, cheapest/priciest lists and the `MIN_RANKED` /
  `MIN_HISTOGRAM` thresholds are per menu; map pins, restaurant pages and table rows are per location.
  `test/menus.test.ts` checks the web's per-menu medians against the pipeline's in `data/burger_index.json`.
- Price colors (Steal → Splurge) are always measured against the citywide median (`src/lib/price-bins.ts`), never a
  filtered subset. Fonts load through `next/font/google` (the build needs network); the OG image reads `@fontsource`.
- **Analytics (PostHog project "Burger Index", id 628020, US cloud; never the "Run With Kam" org or project 614669):**
  `src/lib/analytics.ts` is the one client-only module: the typed `AnalyticsEvents` map, `track()` (a no-op without the
  key), property shaping, the debounced search sender and the posthog-js config (`defaults: "2026-08-30"`, `?q=` masked in
  every URL, a client-side `$pageview`'s stale title dropped, Supabase bodies kept out of replays, surveys/tours/conversations
  off: analytics must not change what visitors see). `src/instrumentation-client.ts` calls `initAnalytics()` before hydration; posthog-js loads as its own chunk and only
  when `NEXT_PUBLIC_POSTHOG_KEY` was set at build time. That key lives **only in the Vercel project settings, never in
  `web/.env.local`**, so dev and local builds send nothing. Components call `track()` in event handlers; nothing in server
  components (the restaurant page's links are the client `components/RestaurantLinks.tsx`). The ranker sends
  `ranking_started` (`edited`, once per page view), `ranking_item_added` (`menu_key`, `position`, `surface`: `search` or
  `restaurant_page`), `ranking_saved` (`length`, `edited`: the first autosave of a page view that
  Supabase saved, never every autosave; the store hands each save out once, `takeSave`, so one that lands while the ranker
  is unmounted is tracked by the next mount) and `ranking_deleted` (`length`); the ranker's first showing of the People's Top 10 beside a list sends `peoples_top_revealed` (`surface: "ranker"`,
  `list_length`, once per page view); links to the People's Top 10 send `peoples_top_clicked` (`surface`:
  `nav` / `menu_sheet` / `ranker` / `home`, `from_path`: the path only); "Share your top 10" sends `list_shared` (`method`:
  `share` / `download` / `copy_link`, `length`); the badge page's and press kit's "Copy" buttons
  `snippet_copied` (`surface`, `what`, the badge's `restaurant_id`); a restaurant page's "Add to your top 10" sends
  `add_to_list_clicked` (`menu_key`, `restaurant_id`). The worth and pricer events are gone. No personal data: never the voter id, and no free text in events
  but the search query (trimmed, lowercased, 60 characters); replays mask inputs and the query echoed in the "No burgers
  match" messages (`ph-mask`). Events and properties are listed in `web/README.md` "Analytics
  (PostHog)"; tests in `test/analytics.test.ts`. posthog-js drops headless/webdriver browsers, so browser checks see no
  events unless they pose as a normal Chrome.
- **Deploy (Vercel):** the project "burger-index" (team koolkam00s-projects) is linked to GitHub `koolkam00/burger-index`;
  the production branch is `main`, and preview deployments are protected. Settings: Framework Preset **Next.js**, Root
  Directory `web`, Build Command `npm run build`, **Output Directory left empty** (Vercel handles `output: "export"`
  itself; setting it to `out` failed with `NEXT_NO_ROUTES_MANIFEST`), Node.js 22.x, and "Include files outside the root
  directory in the Build Step" on (the build reads `../data` and `../contract`). CLI deploys run **from the repo
  root** (`npx vercel link` once, then `npx vercel --prod`); the root `.vercelignore` is an allowlist so `.env`,
  `.venv/` and `data/cache/` are never uploaded (it lets through `data/burger_index.json`, `data/best_burgers.json`,
  and `data/peoples_top.json`: a new data file the build reads must be added there). Environment variables: `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Production and Preview, `NEXT_PUBLIC_POSTHOG_KEY` on Production only
  (`NEXT_PUBLIC_POSTHOG_HOST` stays unset: the default `/ingest` is proxied to PostHog by the rewrites in
  `web/vercel.json`, which Vercel reads from the Root Directory; Next's own `rewrites` don't work with
  `output: "export"`). Set `NEXT_PUBLIC_SITE_URL` only once there is a custom domain: until then the build uses the
  `VERCEL_PROJECT_PRODUCTION_URL` Vercel provides (the site launches on its `*.vercel.app` address). The site has no
  Content-Security-Policy.
- **Refresh the live site:** `pipeline run` (spends credits) → `pipeline build` → when the priced menus changed,
  `node web/scripts/ranker-keys-migration.mjs --write` (a new `supabase/migrations/<version>_ranker_keys.sql` setting the
  ranker's allowed keys to the dataset's menu keys; `web/test/ranker-keys.test.ts` fails until it is written) and apply
  it to the live project (the Supabase connector's `apply_migration`, name `ranker_keys`: no secret key) → commit
  `data/burger_index.json` and the migration → deploy → `cd web && SITE_URL=https://<production host> npm run indexnow`
  (tells Bing and the other IndexNow engines). Until the sync is applied, visitors can't save the new burgers.
- **People's Top 10 snapshot (the force ranker, user decisions 2026-09-25/26).** Visitors
  save one ranked list of 3-25 burgers (Supabase, `supabase/README.md`; five published rankings count as lists too, see
  "Published rankings in the People's Top 10"); the crowd's ranking is **the Patty Ladder**
  (the ranker design's `FINAL.md`, with its reference `ladder.mjs` and simulator `sim.py`), computed once a day from
  the public aggregates the database rebuilds each night at 00:20 New York, never live in the browser (the board is
  path-dependent by design). `web/src/lib/ladder.mjs` is the method (a port of the reference; plain JS, no imports):
  `computeBoard(inputs, yesterday)` (weights 0.8^(p-1)/(k-1), the anchored Bradley-Terry fit, the cautious score
  θ - max(0, sd - 0.2), the 0.25-a-day step, the freeze while surging or held, the gate clamp(ceil(0.5% of weighted
  lists), 5, 50) with the 80% keep band and the network floor, Rising, the seat rule: two boards running in the
  computed ten, beat the weakest seat by 0.05, no surge review or owner hold), `refreshInputs` (the JS twin of the
  nightly refresh, for tests and audits: surge damping from every list before the duplicate collapse, surging = a
  factor below 1 on `asOf`, as the database and `sim.py` do) and `buildAggregates`. The file `data/peoples_top.json`
  (`version: 1`): `method` (`patty-ladder/1`), `params` (the board's and the database's surge rule), `asOf` (the last
  New York save day counted), `refreshedAt`, `inputsSha256`, `totalLists` (in the fit) / `countedLists` (before the
  duplicate collapse) / `weightedLists`, `gate`, `early` (under 500 lists: "Early results"), `iterations`, `top10`,
  `computed10`, and one row per burger in the fit that the dataset has (ranked in board order, then rising, then
  listed: `key, tier, rank, score, theta, sd, phi, raw, lists, weighted, firsts, networks, needs, surging,
  inconsistent, held, review, frozen, aheadP, closeToNext`); two-space JSON, one row per line. Before the first
  publication it is the empty early board. `web/scripts/snapshot-peoples-top.mjs` writes it: a read-only GET of
  `rpc/ranker_board_inputs` (and of `ranker_actions` when the lists fell) with the **publishable** key (the
  `NEXT_PUBLIC_SUPABASE_*` variables, else the public defaults; it refuses a secret or service_role key), then
  `computeBoard` with the committed file as yesterday's board. Keys the dataset no longer has (a closed restaurant;
  saves accept only the dataset's menu keys, `ranker_private.ranker_keys`) stay in the fit and never reach the file. Deterministic (the same
  aggregates and the same yesterday give the same bytes; no wall-clock stamp), written only on a change. It exits 1,
  writes nothing and keeps yesterday's board on: a failed or odd read, another method's aggregates, aggregates older
  than the board or none after one, counted lists down by more than 20% beyond the published lists the owner voided
  since the board (each void logs how many of its lists were in the published aggregates; `--allow-drop`, the
  workflow's manual `allow_drop` input, for a real reset), a fit that did not converge
  (`LadderFitError`); an unreadable board file or one of another method stops it too (deleting the file restarts the
  ladder: the next board takes its scores as they are). Aggregates as of the board's own day are a quiet day (the
  database publishes only once 20 counted lists changed): exit 0, nothing written. Each new board also prints the
  owner's watch as GitHub warnings (annotations on the run): "Burial watch" for a burger whose raw score fell more than
  0.5 since the committed board, "Inconsistent record" for phi ≥ 2.5 (FINAL.md 6; no effect on the board).
  **`.github/workflows/peoples-top.yml`**
  runs it daily at 10:00 UTC (and on `workflow_dispatch`): checks out `main`, Node 22, no npm install, no secrets
  (`permissions: contents: write`), keeps the aggregates it read as the `ranker-board-inputs` artifact (90 days; their
  SHA-256 is `inputsSha256`), and if the file changed commits "Update People's Top 10" as `github-actions[bot]` and
  pushes to `main` (three tries, rebasing), which redeploys. Vercel must be able to deploy the bot's commits (a
  blocked bot commit is a Vercel project setting for the user to change). It runs only once merged to the default branch, GitHub disables it after 60 days without repository activity (`gh workflow enable
  peoples-top.yml`), and **after the merge the file belongs to the workflow**: the build branch never edits,
  regenerates or commits `data/peoples_top.json` (merge `main` in; run the workflow by hand to refresh). Owner actions
  (hold, clear, void) reach the board only with the next publication. Tests: `test/ladder.test.ts` (weights, fit, the
  surge rule, every guard), `test/ladder-golden-*.test.ts` (the design's four attack scenarios replayed from their
  lists through `refreshInputs` and `computeBoard`: the simulator's surge weights bit for bit, its flags, surge support
  and Top 10 on every one of 149 daily boards, scores within 1e-6; fixtures in `test/fixtures/patty-ladder/`, written
  by the design's `check/dump_golden.py`), `test/peoples-top-snapshot.test.ts` (Supabase faked). Changing a parameter
  means re-running the design's simulation gate (FINAL.md 12 B) and bumping `PARAMS.version` with the database's
  `params_version`; the script refuses aggregates of another method.

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
  of the dataset and counted in the `build` summary's `targets_not_yet_scraped`). So `extract.py`/`build.py` changes apply for free on the next
  `build`; changes to `discover.py`/`process.py` may make replays hit uncached calls — `run` again (only new calls
  are billed).
- Live calls **reserve** their worst-case cost before sending (PDFs: all 10 OCR pages), so `--max-credits` is a hard
  cap; `run` stops cleanly when the next call would pass `--max-credits` **or** the account balance reported by
  the API (`key_metadata.credits_remaining`, lowest value seen this run). The run starts from the ledger's last
  seen balance; until a live call reports the real one it only throttles, so a top-up never blocks a run.
  Finished targets are cached, unstarted ones are logged as `stopped`; the next `run` resumes where it stopped.
- Always `plan` first. It prints first-pass / expected / worst-case credits and the last seen account balance.
  Test with `--only "<name>"` or `--limit 1`. Never run the full list casually (`plan` first: ~5,300 credits for the master list).
