# Burger Index

A menu price index for NYC burgers. Python 3.12, venv at `.venv/` (`pip install -r requirements.txt`).

- `burger pilot list.csv` — input: name, neighborhood, borough, website, menu_url, notes
- `menu_index.py` — builds the index → `output/burger_index.json`, `output/burger_prices.csv`
  - Index price per restaurant = cheapest priced **beef** burger; rolled up as median/mean by neighborhood and borough
  - Source URL = `menu_url`, else `website` (skips `unknown`)
- `tests/` — offline, run with `.venv/bin/python -m pytest -q tests`

## Context.dev (web data)

- **Env var:** `CONTEXT_DEV_API_KEY` in `.env` (gitignored; loaded by python-dotenv). Rotate at https://www.context.dev/dashboard/api-keys. Never hardcode it.
- **Wrapper:** `context_client.py` is the only module that touches the `context.dev` SDK (`from context.dev import ContextDev`). Add new calls there; everything else calls the wrapper.
- **SDK retries:** `max_retries=3` — the SDK retries 408/409/429/5xx with backoff and honors `Retry-After`. 4xx validation errors are not retried.
- **Endpoint in use:** `POST /web/scrape` with `formats.json` + `jsonParams.schema` (`BURGER_MENU_SCHEMA`) → `client.web.scrape(...)`, response at `resp.json_.data`. Handles HTML and PDF menus. ~5 credits/call (1 + 4 for JSON extraction, +1/page for PDF OCR).
  Docs: https://docs.context.dev/api-reference/web-scraping/scrape
- **Cache:** default `maxAgeMs` is 1 day. Use `menu_index.py --fresh` (maxAgeMs=0) for a fresh capture on re-runs of the index.
- **Credits:** each call costs credits. Test with `--name "<restaurant>"` or `--limit 1`; a full run of the pilot list costs ~500 credits. Tests must mock `context_client.extract_burger_menu`, never hit the live API.
- **Scaling later:** past a few hundred URLs, use the Batch API (https://docs.context.dev/guides/scrape-websites-in-batches); for scheduled re-pricing, use Monitors (https://docs.context.dev/guides/monitor-website-changes) rather than a polling loop.
- Troubleshooting empty or failed scrapes: https://docs.context.dev/optimization/troubleshooting
