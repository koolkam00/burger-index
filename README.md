# The Burger Index

What a burger costs in New York City. For each restaurant on our curated list of NYC burger places
([`burger-list-master.csv`](burger-list-master.csv), 636 rows), we find its menu online, read every burger price, and
take its **index price**: the cheapest beef burger, on its own, at the dinner or all-day price. The Burger Index is
the median of those prices, with a chain's menu counted once. National fast-food chains (Shake Shack, Five Guys,
McDonald's, White Castle, Tex's Chicken & Burgers and the like) are left out. NYC's own small chains, such as 7th
Street Burger, Bareburger and Black Tap, stay in, and so do national sit-down restaurants such as Del Frisco's,
Smith & Wollensky, STK, Hillstone and Burger & Lobster. The website shows that number by borough, neighborhood and restaurant,
plus a searchable table of every priced burger and a map.

```
burger-list-master.csv (the restaurant list)
  + NYC Open Data: DOHMH inspections (address, coordinates, neighborhood for the rows they match)
                   and 2010 NTA names
        │  pipeline/  (Python: match the list, find menus, scrape prices via Context.dev, clean, aggregate)
        ▼
data/burger_index.json  ── must validate against contract/burger_index.schema.json
        │  web/  (Next.js static export)
        ▼
web/out/  ── plain HTML, deployed to Vercel
```

## The restaurant list

`burger-list-master.csv` is the whole universe: `name, neighborhood, borough, website, menu_url, notes, source`.
The city's health-inspection records (DOHMH) only **match** its rows, which gives a row its address, map location
and neighborhood; a row that matches no record stays in with the neighborhood from the list. `pipeline sources`
reports the rows it could not match, the ones that tie between two records, two rows that match one record, and
addresses that now hold another business, so the list can be fixed by hand. The 2026-09-23 clean-up (687 to 635
rows) and its 2026-09-24 second pass (636 rows) are logged row by row in [`data/list_changes_2026-09-23.md`](data/list_changes_2026-09-23.md).

`--cuisines "Hamburgers"` adds every DOHMH restaurant of those cuisines on top of the list (default: none; the flag
is remembered until you pass `--cuisines none`).

Hand-checked fixes live next to the code, each with its source, date and reason:

- `pipeline/data/corrections.json`: menu prices the scrape got wrong, applied by `build`.
- `pipeline/data/dohmh_overrides.json`: DOHMH records with a wrong address or 0,0 coordinates (e.g. Rosemary's,
  listed at "1820 Greenwich Avenue" instead of 18 Greenwich Avenue), fixed per CAMIS by `sources` before matching.
  An override applies only while DOHMH still has the error; once DOHMH corrects the record, `sources` reports the
  override as unused so it can be deleted.

## Pipeline

Needs Python 3.12 and a Context.dev API key in `.env` as `CONTEXT_DEV_API_KEY` (never commit it).

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q tests           # offline; the API is mocked
.venv/bin/python -m pipeline sources          # free: match the list to NYC Open Data -> data/restaurants.json
.venv/bin/python -m pipeline plan             # free: targets and a credit estimate, no API calls
.venv/bin/python -m pipeline run --limit 2 --max-credits 40   # spends credits; test small first
.venv/bin/python -m pipeline build            # free: rebuild data/burger_index.json from the cache
```

Every API response is cached in `data/cache/`, so re-runs and `build` cost nothing. `--max-credits` is a hard cap.
Always run `plan` before a real `run`: on 2026-09-24 the list was 595 targets (608 restaurants), 78 already
scraped, and the other 517 were estimated at about 4,900 credits (3,500 first pass, 8,800 worst case). Details,
flags and cost rules are in [`CLAUDE.md`](CLAUDE.md).

## Website

Needs Node 20.9 or later.

```bash
cd web
npm install
npm run dev          # http://localhost:3000 with ../data/burger_index.json (or the sample fixture if it is missing)
npm run lint && npm run typecheck && npm test
npm run build        # static site in web/out/
npm run preview      # serve web/out/ at http://localhost:4173
```

Design rules are in [`DESIGN.md`](DESIGN.md). More in [`web/README.md`](web/README.md).

## Deploy

Vercel project settings: **Root Directory** `web`, **Build Command** `npm run build`, **Output Directory** `out`,
"Include files outside the root directory" on. Either import the Git repo on Vercel, or deploy from the **repo
root** with the CLI (`npx vercel link` once, then `npx vercel --prod`). The root `.vercelignore` limits the upload to
what the build needs, so `.env` never leaves your machine. Set `NEXT_PUBLIC_SITE_URL` to your domain.

To publish new prices: `pipeline run`, then `pipeline build`, commit `data/burger_index.json`, and deploy.
