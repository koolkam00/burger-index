# The Burger Index

What a burger costs in New York City. For each restaurant on our curated list of NYC burger places
([`burger-list-master.csv`](burger-list-master.csv), 1,101 rows), we find its menu online and publish one burger:
its **highest-priced eligible beef burger**, one burger for one person at its dinner or all-day price where the menu
has one (never a happy-hour price; no combos, group platters, kids' items or bunless diet plates). That price is the
restaurant's **index price**, and the Burger Index is the median of them, with a chain's menu counted once. National
fast-food chains (Shake Shack, Five Guys, McDonald's, White Castle, Tex's Chicken & Burgers and the like) are left
out. NYC's own small chains, such as 7th Street Burger, Bareburger and Black Tap, stay in, and so do national
sit-down restaurants such as Del Frisco's, Smith & Wollensky, STK, Hillstone and Burger & Lobster. The website shows
that number by borough, neighborhood and restaurant, with a searchable list of every priced burger, a map, and the
People's Price (what visitors say each burger is worth).

The full rules live in [`CLAUDE.md`](CLAUDE.md), the design in [`DESIGN.md`](DESIGN.md) and the website in
[`web/README.md`](web/README.md).

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
addresses that now hold another business, so the list can be fixed by hand. Changes to the list since 2026-09-23 are
logged row by row in [`data/list_changes_2026-09-23.md`](data/list_changes_2026-09-23.md).

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
Always run `plan` before a real `run`: it prints the targets and the first-pass, expected and worst-case credits
(about 5,300 for the whole list). Details, flags and cost rules are in [`CLAUDE.md`](CLAUDE.md).

## Website

Needs Node 20.9 or later.

```bash
cd web
npm install
npm run dev          # http://localhost:3000 with ../data/burger_index.json
npm run lint && npm run typecheck && npm test
npm run build        # static site in web/out/
npm run preview      # serve web/out/ at http://localhost:4173
```

Design rules are in [`DESIGN.md`](DESIGN.md). More in [`web/README.md`](web/README.md).

## Deploy

The Vercel project "burger-index" (team koolkam00s-projects) is linked to GitHub `koolkam00/burger-index`; pushes to
`main` deploy production and previews are protected. Project settings: Framework Preset **Next.js**, **Root Directory**
`web`, **Build Command** `npm run build`, **Output Directory left empty** (Vercel handles `output: "export"`; `out` there
fails with `NEXT_NO_ROUTES_MANIFEST`), Node.js 22.x, "Include files outside the root directory" on. Environment variables:
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Production and Preview, `NEXT_PUBLIC_POSTHOG_KEY` on
Production only. Deploy by pushing, or from the **repo root** with the CLI (`npx vercel link` once, then
`npx vercel --prod`). The root `.vercelignore` limits the upload to what the build needs, so `.env` never leaves your
machine. The site launches on its `*.vercel.app` address, which the
build picks up from Vercel; set `NEXT_PUBLIC_SITE_URL` only once there is a custom domain.

To publish new prices: `pipeline run`, then `pipeline build`, commit `data/burger_index.json`, deploy, then tell the
search engines: `cd web && SITE_URL=https://<production host> npm run indexnow`.
