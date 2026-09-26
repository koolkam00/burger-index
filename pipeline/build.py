"""Assemble data/burger_index.json from target results, validate it against the contract.

Two steps: `restaurant_rows` turns the scraped (and hand-corrected) results into one row per
restaurant location, with the pipeline's own status next to everything the dataset publishes;
`dataset` computes the stats and area summaries from those rows and publishes each row in the
contract's shape (a priced restaurant in full, an unpriced one as a name the site lists).
"""

from __future__ import annotations

import json
import math
import os
import statistics
import threading
from collections import Counter, defaultdict
from collections.abc import Iterable
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import TypedDict

from . import config, extract
from . import corrections as corrections_mod
from .chains import Target, is_airport
from .models import AreaSummary, Burger, BurgerIndex, HandCheck, PriceSource, Restaurant, Stats
from .names import slugify

# The contract's two restaurant shapes (models.PricedRestaurant, models.UnpricedRestaurant), in field order.
PRICED_FIELDS = ("id", "name", "chain", "address", "borough", "neighborhood", "neighborhood_slug", "lat", "lng",
                 "website", "menu_url", "price_source", "index_price", "burger", "hand_check")
UNPRICED_FIELDS = ("id", "name", "address", "neighborhood_slug", "index_price", "burger")


class Row(TypedDict):
    """One restaurant location as the build sees it: the published fields plus the pipeline's own
    `key` (data/restaurants.json) and `status` (process.py's, after corrections and the one-burger
    pick; the CLI counts them)."""

    key: str
    status: str
    id: str
    name: str
    chain: str | None
    address: str | None
    borough: str
    neighborhood: str | None
    neighborhood_slug: str | None
    lat: float | None
    lng: float | None
    website: str | None
    menu_url: str | None
    price_source: PriceSource | None
    index_price: float | None
    burger: Burger | None
    hand_check: HandCheck | None


class DatasetInvalid(RuntimeError):
    pass


def money(x: float | None) -> float | None:
    """Cents, half up on the decimal value: median(13.00, 13.25) = 13.125 -> 13.13 (plain round() gives
    13.12 or 13.13 depending on the float's binary error)."""
    if x is None:
        return None
    return float(Decimal(repr(float(x))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def percentile(sorted_vals: list[float], q: float) -> float | None:
    """Linear interpolation between closest ranks (numpy's default)."""
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def _nbhd_short(neighborhood: str | None, borough: str, nta: str | None = None) -> str:
    # NTA names are compound ("Hudson Yards-Chelsea-Flat Iron-Union Square"): use the first part in ids.
    # The park/cemetery NTAs (BX99, BK99, ...) keep the "park" of their 2010 placeholder name
    # ("park-cemetery-etc-Bronx"), whatever sources.NTA_DISPLAY_OVERRIDES shows, so ids never change.
    if nta and nta.endswith("99"):
        return "park"
    return (neighborhood or borough).split("-")[0].strip()


def assign_restaurant_ids(rows: list[tuple[dict, str]]) -> list[str]:
    """rows: (restaurant record, display name). Unique URL slugs: name + neighborhood,
    + short camis suffix for every member of a colliding group, then -2, -3 as a last resort."""
    bases = [slugify(f"{name} {_nbhd_short(r.get('neighborhood'), r['borough'], r.get('nta'))}") or "restaurant" for r, name in rows]
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


def top_burger(burgers: list[dict], priced: bool) -> tuple[Burger | None, float | None]:
    """One burger per restaurant (user decision, 2026-09-24): the restaurant's highest-priced eligible
    beef burger (extract.top_item), whose price is the restaurant's index price. Nothing else on the
    menu is published, and a restaurant without a priced eligible beef burger publishes none.
    Happy-hour rows and items that are not burgers (a hot dog, a pet patty) are never picked."""
    idx = extract.top_item(burgers) if priced else None
    if idx is None:
        return None, None
    b = burgers[idx]
    return {"name": b["name"], "description": b.get("description")}, money(b["price"])


def drop_template_placeholders(res: dict) -> dict:
    """Leave out site-builder template items (extract.is_template_placeholder: 'This is an item on
    your menu', every item $9). A page of nothing else is not a menu: no_menu_found, no menu_url.
    Applied after corrections, so a hand correction that already dropped them sees them first."""
    burgers = res.get("burgers") or []
    keep = [b for b in burgers if not extract.is_template_placeholder(b)]
    if len(keep) == len(burgers):
        return res
    if not keep:
        return {**res, "status": "no_menu_found", "burgers": [], "menu_url": None, "price_source": None}
    kind = extract.classify_menu({"burgers": keep, "is_menu": True})
    status = res["status"] if res["status"] != "priced" or kind == "priced" else corrections_mod.STATUS_OF_KIND[kind]
    return {**res, "status": status, "burgers": keep}


def menu_index_prices(rows: Iterable[Row]) -> list[float]:
    """One index price per distinct menu, sorted: each chain once (its locations share one scraped
    menu), every other restaurant once. The index and every area median are computed over these."""
    per_menu: dict[str, float] = {}
    for r in rows:
        if r["index_price"] is not None:
            per_menu.setdefault(f"chain:{r['chain']}" if r["chain"] else r["id"], r["index_price"])
    return sorted(per_menu.values())


def compute_stats(rows: list[Row]) -> Stats:
    """The Burger Index (median index price over distinct menus), its 10th and 90th percentiles, and
    how many locations are priced."""
    idx_prices = menu_index_prices(rows)
    return {
        "restaurants_priced": sum(1 for r in rows if r["index_price"] is not None),
        "index_median": money(statistics.median(idx_prices)) if idx_prices else None,
        "index_p10": money(percentile(idx_prices, 0.10)),
        "index_p90": money(percentile(idx_prices, 0.90)),
    }


def area_summaries(rows: list[Row], level: str) -> list[AreaSummary]:
    """level: 'borough' | 'neighborhood'. Only areas with >= 1 restaurant appear, priced or not (the
    site lists a neighborhood with nothing priced by name)."""
    groups: dict[str, list[Row]] = defaultdict(list)
    names: dict[str, str] = {}
    for r in rows:
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
        prices = menu_index_prices(rs)  # a chain counts at most once per area
        borough = Counter(r["borough"] for r in rs).most_common(1)[0][0]
        out.append({
            "slug": slug,
            "name": names[slug],
            "borough": borough,
            "restaurants_priced": sum(1 for r in rs if r["index_price"] is not None),
            "index_median": money(statistics.median(prices)) if prices else None,
            "index_min": money(min(prices)) if prices else None,
            "index_max": money(max(prices)) if prices else None,
        })
    out.sort(key=lambda a: (config.BOROUGHS.index(a["borough"]), a["name"].lower()))
    return out


def airport_result(res: dict) -> dict:
    """An airport location of a chain: concession prices differ, so the chain's menu is not copied."""
    return {"status": "no_menu_found", "menu_url": None, "price_source": None, "website": res.get("website"),
            "burgers": []}


def restaurant_rows(targets: Iterable[Target], results: dict[str, dict], *,
                    corrections: list[dict] | None = None) -> list[Row]:
    """One row per restaurant location with a result, sorted by id. corrections: hand-checked fixes
    (pipeline/corrections.py) applied on top of the scraped results; the CLI passes
    pipeline/data/corrections.json, tests pass their own."""
    results = {k: drop_template_placeholders(r) for k, r in corrections_mod.apply(results, corrections or []).items()}
    # Ids are assigned over every restaurant in scope, scraped or not, so an id does not change
    # when a namesake in the same neighborhood gets scraped later (/restaurants/<id> permalinks,
    # People's Top 10 lists).
    everyone = [(m, t.name if t.chain else m["name"], t) for t in targets for m in t.members]
    all_ids = assign_restaurant_ids([(m, name) for m, name, _ in everyone])
    rows: list[Row] = []
    for (m, name, t), rid in zip(everyone, all_ids, strict=True):
        res = results.get(t.key)
        if res is None:
            continue
        # the chain location whose menu was read (process.source_member); older results: the rep
        is_source = m["key"] == res["source_key"] if res.get("source_key") else m is t.rep
        if t.chain and not is_source and is_airport(m):
            res = airport_result(res)
        status = res["status"]
        burger, index_price = top_burger(res["burgers"], priced=status == "priced")
        if status == "priced" and index_price is None:
            # the page prices a beef burger (process.py), but only as a group platter or a combo
            status = "no_prices"
        nb = m.get("neighborhood")
        rows.append({
            "key": m["key"],
            "status": status,
            "id": rid,
            "name": name,
            "chain": t.chain,
            "address": m.get("address"),
            "borough": m["borough"],
            "neighborhood": nb,
            "neighborhood_slug": (slugify(nb) or None) if nb else None,
            "lat": m.get("lat"),
            "lng": m.get("lng"),
            "website": m.get("website") or res.get("website"),
            "menu_url": res.get("menu_url"),
            "price_source": res.get("price_source"),
            "index_price": index_price,
            "burger": burger,
            "hand_check": res.get("hand_check") if index_price is not None else None,
        })
    rows.sort(key=lambda r: r["id"])
    return rows


def publish(row: Row) -> Restaurant:
    """A row in the contract's shape: a priced restaurant in full; an unpriced one only as the name the
    site lists on its neighborhood's page."""
    return {k: row[k] for k in (PRICED_FIELDS if row["index_price"] is not None else UNPRICED_FIELDS)}  # type: ignore[return-value]


def dataset(rows: list[Row], *, generated_at: str | None = None) -> BurgerIndex:
    """The contract's dataset: stats and area summaries over every row, and each row in its published shape."""
    generated_at = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "version": 2,
        "generated_at": generated_at,
        "stats": compute_stats(rows),
        "boroughs": area_summaries(rows, "borough"),
        "neighborhoods": area_summaries(rows, "neighborhood"),
        "restaurants": [publish(r) for r in rows],
    }


def assemble(targets: Iterable[Target], results: dict[str, dict], *, generated_at: str | None = None,
             corrections: list[dict] | None = None) -> BurgerIndex:
    """The dataset for these targets' results (restaurant_rows, then dataset)."""
    return dataset(restaurant_rows(targets, results, corrections=corrections), generated_at=generated_at)


def validate(data: dict, schema_path: Path = config.CONTRACT_PATH) -> None:
    """Raise DatasetInvalid listing every contract violation (JSON Schema 2020-12 + formats)."""
    import jsonschema

    schema = json.loads(Path(schema_path).read_text())
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.Draft202012Validator.FORMAT_CHECKER)
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))
    problems = [f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}" for e in errors[:25]]
    ids = [r["id"] for r in data.get("restaurants", []) if isinstance(r, dict) and "id" in r]
    if len(set(ids)) != len(ids):
        problems.append("restaurant ids are not unique")
    if problems:
        more = f" (+{len(errors) - 25} more)" if len(errors) > 25 else ""
        raise DatasetInvalid("dataset violates the contract:\n  " + "\n  ".join(problems) + more)


def write_dataset(data: dict, path: Path = config.OUTPUT_PATH, schema_path: Path = config.CONTRACT_PATH) -> Path:
    validate(data, schema_path)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    return path
