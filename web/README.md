# The Burger Index: website

The public site for the NYC Burger Index: the median price of the cheapest beef burger across the New York menus we have priced, from
the restaurants in the pipeline's scope (by default our curated list of burger restaurants; see "Restaurant scope" below).
It is a fully static Next.js site (App Router, TypeScript strict, Tailwind v4, zod). There is no server code and no API key: the Python
pipeline writes one JSON file, and `next build` turns it into plain HTML in `out/`.

Design rules live in [`../DESIGN.md`](../DESIGN.md) (fonts, color tokens, components, voice). Read it before changing anything visual.

## How data gets in

```
pipeline (Python) ──> ../data/burger_index.json ──> npm run sync-data ──> src/data/burger_index.json ──> next build ──> out/
                          (contract: ../contract/burger_index.schema.json)
```

1. `scripts/sync-data.mjs` runs automatically before `dev` and `build`. It copies `../data/burger_index.json` into
   `src/data/`. If the pipeline hasn't written that file yet, it copies `fixtures/burger_index.sample.json` instead, prints a loud
   warning, and every page shows a "Sample data" banner.
2. The same script validates the file against the JSON Schema contract (ajv, draft 2020-12 with formats). Invalid data stops the build.
3. `src/lib/data.ts` (server-only) parses it again with the zod mirror in `src/lib/schema.ts` and checks the invariants (unique ids,
   exactly one index burger per priced restaurant). All pages read data through its typed selectors: `getStats()`,
   `getRestaurant(id)`, `getNeighborhood(slug)`, `getBorough(slug)`, `allBurgers()`, and others.

`src/data/` and `public/vendor/` are generated; both are gitignored.

## Run it locally

Requires Node 20.9 or later.

```bash
cd web
npm install
npm run dev            # http://localhost:3000, uses ../data/burger_index.json if it exists
npm run dev:sample     # force the sample fixture
```

Build and preview the static export:

```bash
npm run build          # writes out/
npm run preview        # serves out/ at http://localhost:4173
```

Checks (all must pass with zero errors):

```bash
npm run lint
npm run typecheck      # next typegen && tsc --noEmit
npm test               # node:test on the TypeScript in src/lib (test/*.test.ts, no extra deps)
npm run build
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run sync-data` | Copy and validate the dataset (runs before dev and build) |
| `npm run build:sample` | Build with the sample fixture, even if pipeline data exists |
| `npm run validate:data [file]` | Validate a dataset against the contract (defaults to the fixture) |
| `npm run fixture` | Regenerate `fixtures/burger_index.sample.json` (deterministic, fictional restaurants on `.example` domains) and validate it |

## Deploy to Vercel

The Vercel project uses **Root Directory** `web`, **Build Command** `npm run build`, **Output Directory** `out`. Either:

- Import the repo on Vercel with those settings (every push to the production branch deploys), or
- From the CLI, **run it from the repo root, not from `web/`** (Vercel's monorepo rule; `sync-data` also needs `../data` and
  `../contract` in the upload): `npx vercel link` once (set Root Directory to `web`), then `npx vercel --prod`.

Notes:

- The build reads `../data/burger_index.json` and `../contract/burger_index.schema.json`, both outside `web/`. Commit the dataset, and
  keep Vercel's "Include files outside the root directory in the Build Step" setting on (the default for new projects).
- The repo-root `.vercelignore` is an allowlist (`web/`, `contract/`, `data/burger_index.json`, `DESIGN.md`). Vercel does not read
  `.gitignore`, so without it a CLI deploy from the root would upload `.env` (the Context.dev key), `.venv/` and the scrape cache.
- Set `NEXT_PUBLIC_SITE_URL` (for example `https://burgerindex.nyc`) so canonical URLs, the sitemap and Open Graph tags point at your
  domain. When it is unset, Vercel's production URL is used, then `https://burgerindex.nyc`.
- Any static host works: upload `out/`. Routes are emitted as `name.html` files, so the host needs clean URLs (`/map` → `map.html`),
  which Vercel, Netlify and `serve` handle by default.

## What's in the site

| Route | Page |
|---|---|
| `/` | The headline index on the Letterboard, typical range, counts, price histogram, borough bars, cheapest and priciest, neighborhood ranking |
| `/burgers` | Every burger: search, filters (borough, neighborhood, price, protein, price source, index-only), sort, all synced to the URL |
| `/restaurants/[id]` | Menu board, index price vs neighborhood and NYC, price source, menu link, scrape date, chain note, locator map |
| `/neighborhoods`, `/neighborhoods/[slug]` | Sortable ranking (areas with at least 5 distinct priced menus; a chain counts once) and area pages |
| `/boroughs`, `/boroughs/[slug]` | Borough comparison and borough pages |
| `/map` | MapLibre GL map, pins colored by price level, legend, list view, restaurants without coordinates |
| `/methodology` | The rule, where the restaurant list comes from and how much of it is read, sources, price-source meanings, statuses, exclusions, biases, update date |
| `/data/burger_index.json` | The validated dataset, for download |
| `/og.png`, `/sitemap.xml`, `/robots.txt` | Open Graph image (the Letterboard), sitemap, robots |

## Notes for maintainers

- **Types:** the contract is the source of truth. If it changes, update `src/lib/schema.ts` (zod) to match; `npm run typecheck` then shows
  every page that needs attention.
- **Menus, not locations:** the index counts each distinct menu once (every independent restaurant, each chain once citywide
  and at most once per area). Anything the site derives itself (histograms, typical range, rankings, cheapest/priciest lists,
  the `MIN_RANKED` / `MIN_HISTOGRAM` thresholds, "N menus" copy) goes through `src/lib/menus.ts` (`menuKey`, `pricedMenus`,
  `menuIndexPrices`, `menuCounts`, `isChainOnly`, `isRankable`). Location counts (`restaurants_priced`, map pins, table rows)
  stay per location. An area priced only from chain menus is labelled "Chain prices only" and never compared like for like.
  Hand corrections (`status_detail` "Prices corrected by hand / withheld after re-checking…") are parsed by `src/lib/hand-checks.ts`.
- **Restaurant scope:** where the restaurant list comes from and how much of it is read so far are never hard-coded. The contract has no
  field for them, so `src/lib/scope.ts` (`restaurantScope`, exposed as `getScope()` in `data.ts`) parses `methodology.coverage_note`
  as `pipeline/build.py` `coverage_note` writes it: list only ("our curated list of NYC burger restaurants, matched to NYC DOHMH
  inspection records...") or list plus DOHMH cuisines ("our curated restaurant list plus every restaurant NYC DOHMH lists under
  'Hamburgers'..."), the in-scope and not-yet-scraped counts, and whether national fast-food chains are left out. The home lede,
  Letterboard line, stat tiles, meta descriptions, Open Graph image, footer and methodology read it. `test/scope.test.ts` pins both
  phrasings; if the pipeline rewords the note, update both together. An unrecognised note (the fixture's) gives copy that names no source.
- **Price colors** (Steal → Splurge) are always measured against the citywide median, never a filtered subset. See `src/lib/price-bins.ts`.
- **Map:** tiles and styles come from [OpenFreeMap](https://openfreemap.org) (`positron` for light, `dark` for dark), recolored to the
  DESIGN.md map tokens at runtime. MapLibre v6 loads its worker relative to its own module URL, which bundling breaks, so `sync-data`
  copies the worker into `public/vendor/maplibre/`. If the tiles can't load, pins are drawn on a blank basemap and the list view
  still has every restaurant.
- **Theme:** light and dark follow the system; the toggle stores `bi-theme` in `localStorage`, and an inline `<head>` script applies it
  before first paint. "Use system setting" in the footer clears it.
