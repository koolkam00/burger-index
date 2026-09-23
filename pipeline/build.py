"""Assemble data/burger_index.json from target results, validate it against the contract."""

from __future__ import annotations

import json
import math
import os
import statistics
import threading
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from . import config, extract
from .chains import Target
from .models import AreaSummary, Burger, BurgerIndex, Restaurant, Stats
from .names import slugify

INDEX_PRICE_RULE = (
    "A restaurant's index price is its cheapest beef burger: the burger by itself (no combo or meal upgrade, "
    "no add-ons), single/standard size, at the dinner or all-day menu price when a menu lists several. "
    "The Burger Index is the median index price across priced restaurants."
)
SOURCES = [
    "NYC DOHMH Restaurant Inspection Results (NYC Open Data 43nn-pn8j): restaurant list, addresses, coordinates, cuisine.",
    "2010 Neighborhood Tabulation Areas (NYC Open Data 8ius-dhrr): neighborhood names.",
    "Curated pilot list of NYC burger restaurants.",
    "Menu prices from each restaurant's own site or menu PDF, online-ordering pages, menu aggregators and "
    "delivery apps, read with Context.dev web scraping.",
]


class DatasetInvalid(RuntimeError):
    pass


def money(x: float | None) -> float | None:
    return None if x is None else round(float(x), 2)


def percentile(sorted_vals: list[float], q: float) -> float | None:
    """Linear interpolation between closest ranks (numpy's default)."""
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def _nbhd_short(neighborhood: str | None, borough: str) -> str:
    # NTA names are compound ("Hudson Yards-Chelsea-Flat Iron-Union Square"): use the first part in ids.
    return (neighborhood or borough).split("-")[0].strip()


def assign_restaurant_ids(rows: list[tuple[dict, str]]) -> list[str]:
    """rows: (restaurant record, display name). Unique URL slugs: name + neighborhood,
    + short camis suffix for every member of a colliding group, then -2, -3 as a last resort."""
    bases = [slugify(f"{name} {_nbhd_short(r.get('neighborhood'), r['borough'])}") or "restaurant" for r, name in rows]
    groups: dict[str, list[int]] = defaultdict(list)
    for i, b in enumerate(bases):
        groups[b].append(i)
    ids = list(bases)
    for b, idxs in groups.items():
        if len(idxs) > 1:
            for i in idxs:
                camis = rows[i][0].get("camis")
                ids[i] = f"{b}-{camis[-4:]}" if camis else b
    seen: Counter = Counter()
    order = sorted(range(len(rows)), key=lambda i: (ids[i], rows[i][0].get("camis") or "", rows[i][0]["key"]))
    final = list(ids)
    for i in order:
        seen[ids[i]] += 1
        if seen[ids[i]] > 1:
            final[i] = f"{ids[i]}-{seen[ids[i]]}"
    assert len(set(final)) == len(final)
    return final


def make_burgers(restaurant_id: str, burgers: list[dict], priced: bool) -> tuple[list[Burger], float | None]:
    idx = extract.index_item(burgers) if priced else None
    out: list[Burger] = []
    used: Counter = Counter()
    for i, b in enumerate(burgers):
        base = f"{restaurant_id}--{slugify(b['name']) or 'burger'}"
        used[base] += 1
        bid = base if used[base] == 1 else f"{base}-{used[base]}"
        while bid in {x["id"] for x in out}:
            used[base] += 1
            bid = f"{base}-{used[base]}"
        out.append({
            "id": bid,
            "name": b["name"],
            "price": money(b["price"]),
            "description": b.get("description"),
            "protein": b["protein"],
            "is_index_item": i == idx,
        })
    return out, (money(burgers[idx]["price"]) if idx is not None else None)


def compute_stats(restaurants: list[Restaurant]) -> Stats:
    idx_prices = sorted(r["index_price"] for r in restaurants if r["index_price"] is not None)
    priced_burgers = [(b["price"], b["id"]) for r in restaurants for b in r["burgers"] if b["price"] is not None]
    beef = [p for r in restaurants for b in r["burgers"] if b["price"] is not None and b["protein"] == "beef"
            for p in [b["price"]]]
    all_prices = sorted(p for p, _ in priced_burgers)
    cheapest = min(priced_burgers, key=lambda t: (t[0], t[1]))[1] if priced_burgers else None
    priciest = min(priced_burgers, key=lambda t: (-t[0], t[1]))[1] if priced_burgers else None
    return {
        "restaurants_scanned": len(restaurants),
        "restaurants_priced": len(idx_prices),
        "burgers": len(priced_burgers),
        "beef_burgers": len(beef),
        "index_median": money(statistics.median(idx_prices)) if idx_prices else None,
        "index_mean": money(statistics.fmean(idx_prices)) if idx_prices else None,
        "index_p10": money(percentile(idx_prices, 0.10)),
        "index_p90": money(percentile(idx_prices, 0.90)),
        "all_burgers_median": money(statistics.median(all_prices)) if all_prices else None,
        "cheapest_burger_id": cheapest,
        "priciest_burger_id": priciest,
    }


def area_summaries(restaurants: list[Restaurant], level: str) -> list[AreaSummary]:
    """level: 'borough' | 'neighborhood'. Only areas with >= 1 restaurant appear."""
    groups: dict[str, list[Restaurant]] = defaultdict(list)
    names: dict[str, str] = {}
    for r in restaurants:
        if level == "borough":
            slug, name = slugify(r["borough"]), r["borough"]
        else:
            if not r["neighborhood_slug"]:
                continue
            slug, name = r["neighborhood_slug"], r["neighborhood"]
        groups[slug].append(r)
        names[slug] = name
    out: list[AreaSummary] = []
    for slug, rs in groups.items():
        prices = [r["index_price"] for r in rs if r["index_price"] is not None]
        borough = Counter(r["borough"] for r in rs).most_common(1)[0][0]
        out.append({
            "slug": slug,
            "name": names[slug],
            "borough": borough,
            "restaurants": len(rs),
            "restaurants_priced": len(prices),
            "burgers": sum(1 for r in rs for b in r["burgers"] if b["price"] is not None),
            "index_median": money(statistics.median(prices)) if prices else None,
            "index_min": money(min(prices)) if prices else None,
            "index_max": money(max(prices)) if prices else None,
        })
    out.sort(key=lambda a: (config.BOROUGHS.index(a["borough"]), a["name"].lower()))
    return out


def coverage_note(meta: dict, n_restaurants: int, n_pending: int) -> str:
    cuisines = ", ".join(meta.get("cuisines") or config.DEFAULT_CUISINES)
    note = (
        f"{n_restaurants} restaurants: a curated pilot list plus every restaurant NYC DOHMH lists under "
        f"'{cuisines}' with an inspection since {meta.get('min_inspection_date') or config.DEFAULT_MIN_INSPECTION} "
        "(or not yet inspected). Chain locations share one menu price scraped from a single NYC location. "
        "Delivery-app prices usually run above in-store prices."
    )
    if n_pending:
        note += f" {n_pending} more restaurants are in scope but not yet scraped."
    return note


def assemble(
    targets: Iterable[Target],
    results: dict[str, dict],
    *,
    meta: dict | None = None,
    generated_at: str | None = None,
    n_pending_restaurants: int = 0,
) -> BurgerIndex:
    rows: list[tuple[dict, str, Target, dict]] = []
    for t in targets:
        res = results.get(t.key)
        if res is None:
            continue
        for m in t.members:
            rows.append((m, t.name if t.chain else m["name"], t, res))
    ids = assign_restaurant_ids([(m, name) for m, name, _, _ in rows])
    restaurants: list[Restaurant] = []
    for (m, name, t, res), rid in zip(rows, ids):
        status = res["status"]
        burgers, index_price = make_burgers(rid, res["burgers"], priced=status == "priced")
        if status == "priced" and index_price is None:  # defensive: priced requires a priced beef burger
            status = "no_prices"
        nb = m.get("neighborhood")
        restaurants.append({
            "id": rid,
            "camis": m.get("camis"),
            "name": name,
            "chain": t.chain,
            "address": m.get("address"),
            "borough": m["borough"],
            "neighborhood": nb,
            "neighborhood_slug": (slugify(nb) or None) if nb else None,
            "zipcode": m.get("zipcode"),
            "lat": m.get("lat"),
            "lng": m.get("lng"),
            "cuisine": m.get("cuisine"),
            "website": m.get("website") or res.get("website"),
            "menu_url": res.get("menu_url"),
            "price_source": res.get("price_source"),
            "status": status,
            "status_detail": res.get("status_detail"),
            "scraped_at": res.get("scraped_at"),
            "index_price": index_price,
            "burgers": burgers,
        })
    restaurants.sort(key=lambda r: r["id"])
    generated_at = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "version": 1,
        "generated_at": generated_at,
        "currency": "USD",
        "methodology": {
            "index_price_rule": INDEX_PRICE_RULE,
            "sources": SOURCES,
            "coverage_note": coverage_note(meta or {}, len(restaurants), n_pending_restaurants),
        },
        "stats": compute_stats(restaurants),
        "boroughs": area_summaries(restaurants, "borough"),
        "neighborhoods": area_summaries(restaurants, "neighborhood"),
        "restaurants": restaurants,
    }


def validate(dataset: dict, schema_path: Path = config.CONTRACT_PATH) -> None:
    """Raise DatasetInvalid listing every contract violation (JSON Schema 2020-12 + formats)."""
    import jsonschema

    schema = json.loads(Path(schema_path).read_text())
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.Draft202012Validator.FORMAT_CHECKER)
    errors = sorted(validator.iter_errors(dataset), key=lambda e: list(e.absolute_path))
    ids = [r["id"] for r in dataset.get("restaurants", [])]
    burger_ids = [b["id"] for r in dataset.get("restaurants", []) for b in r["burgers"]]
    problems = [f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}" for e in errors[:25]]
    if len(set(ids)) != len(ids):
        problems.append("restaurant ids are not unique")
    if len(set(burger_ids)) != len(burger_ids):
        problems.append("burger ids are not unique")
    for r in dataset.get("restaurants", []):
        n_index = sum(1 for b in r["burgers"] if b["is_index_item"])
        if (r["index_price"] is not None) != (n_index == 1) or n_index > 1:
            problems.append(f"{r['id']}: index_price/is_index_item mismatch")
        if r["index_price"] is not None and r["status"] != "priced":
            problems.append(f"{r['id']}: index_price set but status is {r['status']}")
    if problems:
        more = f" (+{len(errors) - 25} more)" if len(errors) > 25 else ""
        raise DatasetInvalid("dataset violates the contract:\n  " + "\n  ".join(problems) + more)


def write_dataset(dataset: dict, path: Path = config.OUTPUT_PATH, schema_path: Path = config.CONTRACT_PATH) -> Path:
    validate(dataset, schema_path)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(dataset, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    return path
