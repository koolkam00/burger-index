# The Burger Index

What a burger costs in New York City. For each NYC restaurant that sells burgers, we find its menu online, read
every burger price, and take its **index price**: the cheapest beef burger, on its own, at the dinner or all-day
price. The Burger Index is the median of those prices, with a chain's menu counted once. National chains
(McDonald's, Burger King, Wendy's, Shake Shack and the like) are left out; NYC's own small chains, such as 7th Street
Burger, stay in. The website shows that number by borough, neighborhood and restaurant, plus a searchable table of every priced burger and a map.

```
NYC Open Data (DOHMH inspections) + burger pilot list.csv
        │  pipeline/  (Python: find menus, scrape prices via Context.dev, clean, aggregate)
        ▼
data/burger_index.json  ── must validate against contract/burger_index.schema.json
        │  web/  (Next.js static export)
        ▼
web/out/  ── plain HTML, deployed to Vercel
```

## Pipeline

Needs Python 3.12 and a Context.dev API key in `.env` as `CONTEXT_DEV_API_KEY` (never commit it).

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q                 # offline; the API is mocked
.venv/bin/python -m pipeline sources          # free: restaurant list from NYC Open Data
.venv/bin/python -m pipeline plan             # free: targets and a credit estimate, no API calls
.venv/bin/python -m pipeline run --limit 2 --max-credits 40   # spends credits; test small first
.venv/bin/python -m pipeline build            # free: rebuild data/burger_index.json from the cache
```

Every API response is cached in `data/cache/`, so re-runs and `build` cost nothing. `--max-credits` is a hard cap.
Always run `plan` before a real `run`. Details, flags and cost rules are in [`CLAUDE.md`](CLAUDE.md).

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
