"""Paths, defaults and hard caps shared by every pipeline step."""

from __future__ import annotations

from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
ROOT = PACKAGE_DIR.parent

DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"  # gitignored: Context.dev + Socrata responses
OUTPUT_PATH = DATA_DIR / "burger_index.json"  # THE dataset (contract/burger_index.schema.json)
RESTAURANTS_PATH = DATA_DIR / "restaurants.json"  # resolved restaurant universe from `sources`
RUN_LOG_PATH = DATA_DIR / "run_log.jsonl"  # one line per target per run
LEDGER_PATH = DATA_DIR / "credit_ledger.jsonl"  # one line per live (billed) Context.dev call

PILOT_CSV = ROOT / "burger pilot list.csv"
CONTRACT_PATH = ROOT / "contract" / "burger_index.schema.json"
NTA_PATH = PACKAGE_DIR / "data" / "nta_2010.json"  # cached 2010 NTA code -> name mapping (committed)

BOROUGHS = ("Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island")

# Scope of the pilot run. Widen with --cuisines "Hamburgers,American,Irish,Steakhouses".
DEFAULT_CUISINES = ("Hamburgers",)
# Restaurants whose latest DOHMH inspection is older than this are treated as closed.
# 1900-01-01 means "not yet inspected" (new restaurant) and is always kept.
DEFAULT_MIN_INSPECTION = "2023-01-01"
# National fast-food chains (chains.ChainDef.national) are left out of the index: "exclude" | "include".
DEFAULT_NATIONAL_CHAINS = "exclude"

DEFAULT_MAX_CREDITS = 6000
DEFAULT_WORKERS = 6

# Hard per-target caps (a chain counts as one target).
MAX_SEARCHES = 1
MAX_MAPS = 1
MAX_SCRAPES = 3

# Post-processing: prices outside this band are treated as extraction errors.
PRICE_MIN = 2.0
PRICE_MAX = 150.0

# A priced page is not the final answer (the target keeps looking within its caps, and falls
# back to it) when it is a delivery-app page with fewer priced beef burgers than this (lazy-loaded
# sections), a special menu (brunch, restaurant week...), or a menu file whose URL dates it more
# than STALE_MENU_DAYS before the scrape.
MIN_DELIVERY_BURGERS = 3
STALE_MENU_DAYS = 365

# Scroll delivery-app store pages before extraction so lazy-loaded menu sections render.
# Browser actions need a paid Context.dev plan (403 PAID_PLAN_REQUIRED on the current key),
# so this is off; turning it on changes those scrapes' cache keys (+1 credit each).
SCROLL_DELIVERY_APPS = False
