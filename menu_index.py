"""Burger menu price index.

Reads `burger pilot list.csv`, scrapes each restaurant's menu via context_client,
and writes per-restaurant prices plus neighborhood/borough medians.

    .venv/bin/python menu_index.py --limit 1        # one real call (~5 credits)
    .venv/bin/python menu_index.py                  # full pilot list (~100 calls)
    .venv/bin/python menu_index.py --name "Due West"
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

import context_client

ROOT = Path(__file__).parent
PILOT_CSV = ROOT / "burger pilot list.csv"
OUT_DIR = ROOT / "output"


def menu_source(row: dict[str, str]) -> str | None:
    for key in ("menu_url", "website"):
        url = (row.get(key) or "").strip()
        if url and url.lower() != "unknown":
            return url
    return None


def index_price(burgers: list[dict]) -> float | None:
    """The restaurant's index price: cheapest priced beef burger (its 'classic')."""
    prices = [b["price"] for b in burgers if b.get("is_beef") and isinstance(b.get("price"), (int, float)) and b["price"] > 0]
    return min(prices) if prices else None


def scrape_row(row: dict[str, str], max_age_ms: int | None) -> dict:
    url = menu_source(row)
    result = {**row, "source_url": url, "index_price": None, "burgers": [], "error": None}
    if not url:
        result["error"] = "no menu or website url"
        return result
    try:
        menu = context_client.extract_burger_menu(url, max_age_ms=max_age_ms)
    except context_client.ContextDevError as e:
        result["error"] = str(e)
        return result
    result["burgers"] = menu["burgers"]
    result["index_price"] = index_price(menu["burgers"])
    return result


def summarize(results: list[dict], key: str) -> dict[str, dict]:
    groups: dict[str, list[float]] = {}
    for r in results:
        if r["index_price"] is not None:
            groups.setdefault(r[key], []).append(r["index_price"])
    return {
        k: {"n": len(v), "median": round(statistics.median(v), 2), "mean": round(statistics.mean(v), 2)}
        for k, v in sorted(groups.items())
    }


def build_index(rows: list[dict[str, str]], max_age_ms: int | None = None) -> dict:
    results = [scrape_row(r, max_age_ms) for r in rows]
    priced = [r["index_price"] for r in results if r["index_price"] is not None]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "restaurants": len(results),
        "priced": len(priced),
        "overall_median": round(statistics.median(priced), 2) if priced else None,
        "by_neighborhood": summarize(results, "neighborhood"),
        "by_borough": summarize(results, "borough"),
        "results": results,
    }


def write_outputs(index: dict) -> None:
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "burger_index.json").write_text(json.dumps(index, indent=2))
    with open(OUT_DIR / "burger_prices.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name", "neighborhood", "borough", "index_price", "burger_count", "source_url", "error"])
        for r in index["results"]:
            w.writerow([r["name"], r["neighborhood"], r["borough"], r["index_price"], len(r["burgers"]), r["source_url"], r["error"] or ""])


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--limit", type=int, help="only the first N restaurants")
    p.add_argument("--name", help="only the restaurant with this exact name")
    p.add_argument("--fresh", action="store_true", help="bypass the Context.dev cache (maxAgeMs=0)")
    args = p.parse_args()

    with open(PILOT_CSV, newline="") as f:
        rows = list(csv.DictReader(f))
    if args.name:
        rows = [r for r in rows if r["name"] == args.name]
    if args.limit:
        rows = rows[: args.limit]

    index = build_index(rows, max_age_ms=0 if args.fresh else None)
    write_outputs(index)
    print(json.dumps({k: v for k, v in index.items() if k != "results"}, indent=2))
    for r in index["results"]:
        print(f"\n{r['name']} ({r['neighborhood']}) — index price: {r['index_price']}  [{r['source_url']}]")
        if r["error"]:
            print(f"  error: {r['error']}")
        for b in r["burgers"]:
            print(f"  - {b['name']}: {b.get('price')}{'' if b.get('is_beef') else '  (non-beef)'}")


if __name__ == "__main__":
    main()
