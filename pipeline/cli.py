"""The Burger Index data pipeline.

    .venv/bin/python -m pipeline sources                 # free: restaurant list + DOHMH + NTA -> data/restaurants.json
    .venv/bin/python -m pipeline plan                    # dry run: counts + credit estimate, no Context.dev calls
    .venv/bin/python -m pipeline run --limit 2           # discover -> scrape -> build (spends credits)
    .venv/bin/python -m pipeline run --only "7th Street Burger" --max-credits 50
    .venv/bin/python -m pipeline build                   # data/burger_index.json purely from cache

Every Context.dev response is cached under data/cache/, so re-runs spend 0 credits unless --refresh.
Scope flags (--cuisines, --min-inspection-date, --national-chains) are remembered in
data/restaurants.json: later commands reuse them until they are passed again. National chains
(McDonald's, Shake Shack...) are excluded by default; NYC's own chains (7th Street Burger...) stay.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import config, corrections
from .api import Api, CreditLedger, DiskCache, estimate_credits, last_known_balance, lifetime_spend, looks_like_pdf
from .build import assemble, write_dataset
from .chains import build_targets, select_targets
from .context_client import scrape_request
from .discover import OFFICIAL, classify_url
from .process import log, replay, run_targets
from .sources import ScopeError, fetch_nta2010, load_restaurants


def _cuisines(s: str | None) -> list[str] | None:
    """None when the flag wasn't passed; [] for 'none' (the restaurant list only)."""
    if s is None:
        return None
    if s.strip().lower() == "none":
        return []
    return [c.strip() for c in s.split(",") if c.strip()]


def _add_scope(p: argparse.ArgumentParser, *, refresh: bool = True) -> None:
    p.add_argument("--cuisines", help="DOHMH cuisine_description values whose restaurants are added to the restaurant "
                                      "list, comma-separated, or 'none' (default: none, the list only)")
    p.add_argument("--min-inspection-date", help=f"drop restaurants whose latest inspection is older (default {config.DEFAULT_MIN_INSPECTION}; 1900-01-01 = not yet inspected, always kept)")
    p.add_argument("--national-chains", choices=("exclude", "include"),
                   help=f"national chains (McDonald's, Shake Shack...; NYC's own chains always stay): default "
                        f"{config.DEFAULT_NATIONAL_CHAINS}")
    if refresh:
        p.add_argument("--refresh-sources", action="store_true", help="re-download the DOHMH snapshot (free)")


def _add_select(p: argparse.ArgumentParser) -> None:
    p.add_argument("--limit", type=int, help="only the first N targets (a chain counts as one)")
    p.add_argument("--only", action="append", metavar="NAME", help="only targets matching this name (repeatable)")


def _saved_scope() -> dict:
    """The scope (cuisines, min inspection date, national chains) data/restaurants.json was last written with."""
    try:
        return json.loads(config.RESTAURANTS_PATH.read_text()).get("meta") or {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _scope(args, *, offline: bool = False, write: bool = True):
    """Resolve the restaurant universe. `build` reuses data/restaurants.json unless scope flags are given.

    Each scope flag that is not passed keeps the value data/restaurants.json was written with, so a
    `run --only X` after a wider `run --cuisines ...` does not silently shrink the dataset."""
    explicit = bool(getattr(args, "cuisines", None) is not None or getattr(args, "min_inspection_date", None)
                    or getattr(args, "national_chains", None) or getattr(args, "refresh_sources", False))
    if offline and not explicit and config.RESTAURANTS_PATH.exists():
        doc = json.loads(config.RESTAURANTS_PATH.read_text())
        return doc["restaurants"], doc.get("report", {}), doc.get("meta", {})
    saved = _saved_scope()
    cuisines = _cuisines(getattr(args, "cuisines", None))
    if cuisines is None:  # [] (list only) is a real, remembered value
        cuisines = saved["cuisines"] if isinstance(saved.get("cuisines"), list) else list(config.DEFAULT_CUISINES)
    min_date = getattr(args, "min_inspection_date", None) or saved.get("min_inspection_date") or config.DEFAULT_MIN_INSPECTION
    national = getattr(args, "national_chains", None) or saved.get("national_chains") or config.DEFAULT_NATIONAL_CHAINS
    if (list(cuisines), min_date, national) != (list(config.DEFAULT_CUISINES), config.DEFAULT_MIN_INSPECTION,
                                                config.DEFAULT_NATIONAL_CHAINS):
        log(f"scope: cuisines={','.join(cuisines) or 'none'} min-inspection-date={min_date} national-chains={national}"
            + (" (saved in data/restaurants.json; pass the flags to change)" if saved and not explicit else ""))
    restaurants, report = load_restaurants(
        cuisines=cuisines, min_date=min_date, national_chains=national, cache_dir=config.CACHE_DIR, csv_path=config.RESTAURANT_LIST_CSV,
        nta_path=config.NTA_PATH, refresh=getattr(args, "refresh_sources", False), offline=offline,
        write_to=config.RESTAURANTS_PATH if write else None,
    )
    meta = {"cuisines": cuisines, "min_inspection_date": min_date, "national_chains": national,
            "restaurant_list": config.RESTAURANT_LIST_CSV.name, "dohmh_fetched_at": report.get("dohmh_fetched_at")}
    return restaurants, report, meta


def _print(obj) -> None:
    print(json.dumps(obj, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------------------


def cmd_sources(args) -> int:
    if args.refresh_nta:
        doc = fetch_nta2010(config.NTA_PATH)
        log(f"sources: wrote {len(doc['ntas'])} NTA names to {config.NTA_PATH}")
    restaurants, report, meta = _scope(args)
    targets = build_targets(restaurants)
    chains = [t for t in targets if t.chain]
    _print({
        "scope": meta,
        "report": report,
        "targets": len(targets),
        "chains": {t.name: len(t.members) for t in sorted(chains, key=lambda t: -len(t.members))},
        "written": str(config.RESTAURANTS_PATH),
    })
    return 0


def _estimate(targets) -> dict:
    """First-pass / worst-case call and credit counts for targets not fully cached."""
    scrape_cost = estimate_credits("scrape", scrape_request("https://example.com/menu"))
    pdf_cost = estimate_credits("scrape", scrape_request("https://example.com/menu.pdf"))
    calls = {k: {"first_pass": 0, "max": 0} for k in ("searches", "maps", "scrapes")}
    credits = {"first_pass": 0, "expected": 0.0, "worst_case": 0}
    for t in targets:
        usable = []
        for url, _origin in t.csv_urls:
            cat, _ = classify_url(url)
            if cat == "reject" or (t.chain and not t.official_has_prices and cat in OFFICIAL):
                continue
            usable.append((url, cat))
        if usable:
            url, cat = usable[0]
            s, m = 0, 1 if cat == "official_home" else 0
            first_scrape = estimate_credits(
                "scrape", scrape_request(url, scroll=config.SCROLL_DELIVERY_APPS and cat == "delivery_app"))
        else:
            s, m, first_scrape = 1, 1, scrape_cost  # assume search lands on a homepage that needs a map
        first = s + m + first_scrape
        worst = 1 + 1 + 3 * scrape_cost + sum(pdf_cost - scrape_cost for u, _ in usable if looks_like_pdf(u))
        calls["searches"]["first_pass"] += s
        calls["maps"]["first_pass"] += m
        calls["scrapes"]["first_pass"] += 1
        for k, v in (("searches", config.MAX_SEARCHES), ("maps", config.MAX_MAPS), ("scrapes", config.MAX_SCRAPES)):
            calls[k]["max"] += v
        credits["first_pass"] += first
        # Assumption: half the targets need one fallback scrape; CSV-sourced fallbacks also search once.
        credits["expected"] += first + 0.5 * (scrape_cost + (1 if usable else 0))
        credits["worst_case"] += worst
    credits["expected"] = round(credits["expected"])
    return {"calls": calls, "credits": credits}


def scrape_cost_note() -> int:
    return estimate_credits("scrape", scrape_request("https://example.com/menu"))


def cmd_plan(args) -> int:
    restaurants, report, meta = _scope(args, write=False)
    targets = build_targets(restaurants)
    selected = select_targets(targets, only=args.only, limit=args.limit)
    cached, pending = replay(selected, Api(DiskCache(config.CACHE_DIR), offline=True))
    chains = [t for t in selected if t.chain]
    est = _estimate(pending)
    plan = {
        "scope": meta,
        "restaurants": len(restaurants),
        "csv_rows": report.get("csv_rows"),
        "csv_matched_to_dohmh": report.get("csv_matched"),
        "dohmh_only_restaurants": report.get("dohmh_added"),
        "targets": len(selected),
        "chains": len(chains),
        "chain_locations": sum(len(t.members) for t in chains),
        "chain_sizes": {t.name: len(t.members) for t in sorted(chains, key=lambda t: -len(t.members))},
        "independent_targets": len(selected) - len(chains),
        "restaurants_covered": sum(len(t.members) for t in selected),
        "targets_already_cached": len(cached),
        "targets_to_scrape": len(pending),
        "targets_to_scrape_with_csv_url": sum(1 for t in pending if t.csv_urls),
        **est,
        "caps_per_target": {"searches": config.MAX_SEARCHES, "maps": config.MAX_MAPS, "scrapes": config.MAX_SCRAPES},
        "max_credits": args.max_credits,
        "credit_costs": {"search_10_results": 1, "map": 1, "scrape_json": scrape_cost_note(),
                         "scrape_json_pdf_estimate": estimate_credits("scrape", scrape_request("https://example.com/menu.pdf"))},
        "lifetime_credits_spent": lifetime_spend(config.LEDGER_PATH),
        "account_credits_remaining_last_seen": last_known_balance(config.LEDGER_PATH),
    }
    _print(plan)
    if est["credits"]["worst_case"] > args.max_credits:
        log(f"plan: worst case {est['credits']['worst_case']} > --max-credits {args.max_credits}; the run would stop cleanly at the cap")
    balance = plan["account_credits_remaining_last_seen"]
    if balance is not None and est["credits"]["expected"] > balance:
        log(f"plan: WARNING expected spend ~{est['credits']['expected']} exceeds the account's last seen balance "
            f"({balance} credits); set --max-credits below the balance or top up first")
    return 0


def _build(targets, meta, *, output: Path) -> dict:
    api = Api(DiskCache(config.CACHE_DIR), offline=True)
    results, pending = replay(targets, api)
    dataset = assemble(targets, results, meta=meta, n_pending_restaurants=sum(len(t.members) for t in pending),
                       corrections=corrections.load())
    write_dataset(dataset, output, config.CONTRACT_PATH)
    s = dataset["stats"]
    summary = {
        "written": str(output),
        "restaurants": s["restaurants_scanned"],
        "restaurants_priced": s["restaurants_priced"],
        "burgers_priced": s["burgers"],
        "index_median": s["index_median"],
        "targets_built": len(results),
        "targets_not_yet_scraped": len(pending),
        "statuses": {},
    }
    for r in dataset["restaurants"]:
        summary["statuses"][r["status"]] = summary["statuses"].get(r["status"], 0) + 1
    return summary


def cmd_build(args) -> int:
    restaurants, _report, meta = _scope(args, offline=True)
    targets = build_targets(restaurants)
    summary = _build(targets, meta, output=Path(args.output) if args.output else config.OUTPUT_PATH)
    log(f"build: {summary['restaurants']} restaurants ({summary['restaurants_priced']} priced) -> {summary['written']}; "
        f"{summary['targets_not_yet_scraped']} targets not yet scraped")
    _print(summary)
    return 0


def cmd_run(args) -> int:
    restaurants, report, meta = _scope(args)
    targets = build_targets(restaurants)
    selected = select_targets(targets, only=args.only, limit=args.limit)
    if not selected:
        log("run: no targets matched")
        return 1
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    # Start from the last balance seen, so the first wave of calls is checked too (see CreditLedger).
    ledger = CreditLedger(args.max_credits, log_path=config.LEDGER_PATH, run_id=run_id,
                          balance=last_known_balance(config.LEDGER_PATH))
    api = Api(DiskCache(config.CACHE_DIR), ledger, refresh=args.refresh, max_age_ms=0 if args.refresh else None)
    log(f"run {run_id}: {len(selected)} target(s) ({sum(len(t.members) for t in selected)} restaurants), "
        f"workers={args.workers}, max-credits={args.max_credits}{', refresh' if args.refresh else ''}")
    summary = run_targets(selected, api, workers=args.workers, run_log_path=config.RUN_LOG_PATH, run_id=run_id)
    summary.pop("results", None)
    summary["lifetime_credits_spent"] = lifetime_spend(config.LEDGER_PATH)
    if summary["capped"]:
        log(f"run: stopped at --max-credits {args.max_credits}; finished targets are cached and kept")
    if not args.no_build:
        summary["build"] = _build(targets, meta, output=config.OUTPUT_PATH)
    _print(summary)
    return 1 if summary["fatal"] else 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sources", help="resolve restaurants (free; writes data/restaurants.json)")
    _add_scope(s)
    s.add_argument("--refresh-nta", action="store_true", help="re-download pipeline/data/nta_2010.json (free)")
    s.set_defaults(fn=cmd_sources)

    s = sub.add_parser("plan", help="dry run: counts and credit estimate, no Context.dev calls")
    _add_scope(s)
    _add_select(s)
    s.add_argument("--max-credits", type=int, default=config.DEFAULT_MAX_CREDITS)
    s.set_defaults(fn=cmd_plan)

    s = sub.add_parser("run", help="sources -> discover -> scrape -> build (spends credits)")
    _add_scope(s)
    _add_select(s)
    s.add_argument("--max-credits", type=int, default=config.DEFAULT_MAX_CREDITS, help=f"stop cleanly before exceeding this many credits this run (default {config.DEFAULT_MAX_CREDITS})")
    s.add_argument("--workers", type=int, default=config.DEFAULT_WORKERS, help=f"concurrent targets (default {config.DEFAULT_WORKERS})")
    s.add_argument("--refresh", action="store_true", help="ignore the disk cache and re-fetch (costs credits)")
    s.add_argument("--no-build", action="store_true", help="skip writing data/burger_index.json")
    s.set_defaults(fn=cmd_run)

    s = sub.add_parser("build", help="write data/burger_index.json from cache only (no API calls)")
    _add_scope(s, refresh=False)
    s.add_argument("--output", help=f"output path (default {config.OUTPUT_PATH})")
    s.set_defaults(fn=cmd_build)

    args = p.parse_args(argv)
    try:
        return args.fn(args)
    except ScopeError as e:  # nothing was written
        log(f"{args.cmd}: {e}")
        return 2
    except KeyboardInterrupt:
        log(f"{args.cmd}: interrupted (finished targets are cached; the next run resumes)")
        return 130


if __name__ == "__main__":
    sys.exit(main())
