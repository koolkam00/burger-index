"""Restaurant universe: NYC DOHMH inspections + 2010 NTA names + the pilot CSV.

Everything here is free (NYC Open Data / Socrata, no key). The DOHMH snapshot is cached
under data/cache/socrata/ so builds are offline-reproducible; the NTA code -> name
mapping is committed at pipeline/data/nta_2010.json.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import sys
import threading
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from rapidfuzz import fuzz, process

from . import config
from .names import display_case, display_name, norm_name, slugify

DOHMH_DATASET = "43nn-pn8j"
DOHMH_URL = f"https://data.cityofnewyork.us/resource/{DOHMH_DATASET}.json"
# 2010 Census Tract to NTA Equivalency — the 2010 NTA boundary datasets were retired from
# NYC Open Data; this table carries the same 195 NTA codes and names DOHMH's `nta` uses.
NTA2010_DATASET = "8ius-dhrr"
NTA2010_URL = f"https://data.cityofnewyork.us/resource/{NTA2010_DATASET}.json"

DOHMH_GROUP_FIELDS = (
    "camis", "dba", "boro", "building", "street", "zipcode", "latitude", "longitude", "nta", "cuisine_description",
)
SOCRATA_PAGE = 50_000
NOT_INSPECTED = "1900-01-01"

# CSV neighborhoods no 2010 NTA name contains -> NTA code (only used for unmatched CSV rows).
NEIGHBORHOOD_ALIASES = {
    ("Manhattan", "greenwich village"): "MN23",
    ("Manhattan", "meatpacking"): "MN23",
    ("Manhattan", "meatpacking district"): "MN23",
    ("Manhattan", "flatiron"): "MN13",
    ("Manhattan", "nolita"): "MN24",
    ("Manhattan", "financial district"): "MN25",
    ("Manhattan", "hell's kitchen"): "MN15",
    ("Manhattan", "hells kitchen"): "MN15",
    ("Manhattan", "koreatown"): "MN17",
    ("Manhattan", "noho"): "MN22",
    ("Brooklyn", "bed-stuy"): "BK75",
    ("Brooklyn", "bedford-stuyvesant"): "BK75",
    ("Queens", "long island city"): "QN31",
}

_log_lock = threading.Lock()


def log(msg: str) -> None:
    with _log_lock:
        print(msg, file=sys.stderr, flush=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _write_json_atomic(path: Path, obj: Any, *, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(obj, indent=indent, ensure_ascii=False))
    os.replace(tmp, path)


# ---------------------------------------------------------------------------------------
# Socrata fetches


def socrata_get(url: str, params: dict[str, str], *, http=None) -> list[dict]:
    import httpx

    client = http or httpx.Client(timeout=180, headers={"Accept": "application/json"})
    rows: list[dict] = []
    offset = 0
    while True:
        page_params = {**params, "$limit": str(SOCRATA_PAGE), "$offset": str(offset)}
        resp = client.get(url, params=page_params)
        resp.raise_for_status()
        page = resp.json()
        rows.extend(page)
        if len(page) < SOCRATA_PAGE:
            return rows
        offset += SOCRATA_PAGE


def dohmh_query() -> dict[str, str]:
    """One row per (camis, location fields) with its latest inspection date — every cuisine,
    so pilot-CSV restaurants of any cuisine can be matched. ~31k rows, ~8.5 MB."""
    fields = ",".join(DOHMH_GROUP_FIELDS)
    return {"$select": f"{fields},max(inspection_date) as last_inspection", "$group": fields, "$order": "camis"}


def load_dohmh_snapshot(cache_dir: Path = config.CACHE_DIR, *, refresh: bool = False, offline: bool = False) -> dict:
    params = dohmh_query()
    key = hashlib.sha1(_canonical({"url": DOHMH_URL, "params": params}).encode()).hexdigest()[:16]
    path = Path(cache_dir) / "socrata" / f"dohmh-{key}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    if offline:
        raise FileNotFoundError(f"DOHMH snapshot not cached at {path}; run `python -m pipeline sources` first")
    log(f"sources: fetching DOHMH inspections from {DOHMH_URL} (free, no key)...")
    rows = socrata_get(DOHMH_URL, params)
    snap = {"source": DOHMH_URL, "params": params, "fetched_at": _now(), "rows": rows}
    _write_json_atomic(path, snap)
    log(f"sources: cached {len(rows)} DOHMH rows at {path}")
    return snap


def fetch_nta2010(path: Path = config.NTA_PATH) -> dict:
    """Refresh pipeline/data/nta_2010.json from NYC Open Data (free)."""
    params = {
        "$select": "neighborhood_tabulation_area_nta_code as code, neighborhood_tabulation_area_nta_name as name, borough",
        "$group": "neighborhood_tabulation_area_nta_code, neighborhood_tabulation_area_nta_name, borough",
        "$order": "neighborhood_tabulation_area_nta_code",
    }
    rows = socrata_get(NTA2010_URL, params)
    ntas = {r["code"]: {"name": r["name"], "borough": r["borough"]} for r in rows if r.get("code")}
    doc = {
        "source": NTA2010_URL,
        "dataset": f"2010 Census Tract to Neighborhood Tabulation Area Equivalency ({NTA2010_DATASET})",
        "fetched_at": _now(),
        "ntas": dict(sorted(ntas.items())),
    }
    _write_json_atomic(path, doc, indent=1)
    return doc


def load_nta_map(path: Path = config.NTA_PATH) -> dict[str, dict]:
    return json.loads(Path(path).read_text())["ntas"]


# ---------------------------------------------------------------------------------------
# DOHMH normalization


def parse_coord(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if abs(f) < 1:  # DOHMH uses 0 for "not geocoded"
        return None
    return round(f, 6)


def clean_zip(z: Any) -> str | None:
    z = str(z or "").strip()
    return z[:5] if re.fullmatch(r"\d{5}(-\d{4})?", z) else None


def dohmh_address(building: Any, street: Any) -> str | None:
    b = str(building or "").strip()
    s = display_case(str(street or "").strip())
    if b in ("", "0", "N/A", "NA"):
        return s or None
    return f"{b} {s}".strip() if s else None


def latest_per_camis(rows: Iterable[dict]) -> list[dict]:
    """DOHMH has one row per violation; keep the row from each CAMIS's latest inspection."""
    best: dict[str, dict] = {}
    for r in rows:
        camis = str(r.get("camis") or "").strip()
        if not camis:
            continue
        date = r.get("last_inspection") or r.get("inspection_date") or ""
        cur = best.get(camis)
        if cur is None or date > (cur.get("last_inspection") or cur.get("inspection_date") or ""):
            best[camis] = r
    return list(best.values())


def zip_to_nta(rows: Iterable[dict]) -> dict[str, str]:
    """Most common NTA per zipcode, for the few DOHMH records with no NTA."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        z, nta = clean_zip(r.get("zipcode")), (r.get("nta") or "").strip()
        if z and nta:
            counts[z][nta] += 1
    return {z: c.most_common(1)[0][0] for z, c in counts.items()}


def normalize_dohmh(row: dict, nta_map: dict[str, dict], zip_nta: dict[str, str] | None = None) -> dict | None:
    boro = (row.get("boro") or "").strip()
    if boro not in config.BOROUGHS:  # drops '0' / missing
        return None
    zipcode = clean_zip(row.get("zipcode"))
    nta = (row.get("nta") or "").strip() or None
    nta_source = "dohmh" if nta else None
    if not nta and zipcode and zip_nta and zipcode in zip_nta:
        nta, nta_source = zip_nta[zipcode], "zipcode"
    if nta and nta not in nta_map:
        nta, nta_source = None, None
    last = (row.get("last_inspection") or row.get("inspection_date") or "")[:10] or None
    dba = (row.get("dba") or "").strip()
    return {
        "key": f"camis:{row['camis']}",
        "camis": str(row["camis"]),
        "dba": dba,
        "name": display_name(dba),
        "address": dohmh_address(row.get("building"), row.get("street")),
        "borough": boro,
        "zipcode": zipcode,
        "lat": parse_coord(row.get("latitude")),
        "lng": parse_coord(row.get("longitude")),
        "nta": nta,
        "neighborhood": nta_map[nta]["name"] if nta else None,
        "nta_source": nta_source,
        "cuisine": (row.get("cuisine_description") or "").strip() or None,
        "last_inspection": last,
        "website": None,
        "menu_url": None,
        "csv": False,
        "csv_name": None,
        "csv_neighborhood": None,
        "csv_notes": None,
        "match": None,
    }


def is_recent(rec: dict, min_date: str) -> bool:
    last = rec.get("last_inspection")
    return not last or last == NOT_INSPECTED or last >= min_date


# ---------------------------------------------------------------------------------------
# Pilot CSV


def clean_url(u: Any) -> str | None:
    u = str(u or "").strip()
    if not u or u.lower() in ("unknown", "n/a", "na", "none", "-"):
        return None
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u


def load_csv(path: Path = config.PILOT_CSV) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    out = []
    for i, r in enumerate(rows, start=1):
        name = (r.get("name") or "").strip()
        borough = (r.get("borough") or "").strip()
        if not name:
            continue
        if borough not in config.BOROUGHS:
            log(f"sources: skipping CSV row {i} ({name}): unknown borough {borough!r}")
            continue
        out.append({
            "row": i,
            "name": name,
            "neighborhood": (r.get("neighborhood") or "").strip() or None,
            "borough": borough,
            "website": clean_url(r.get("website")),
            "menu_url": clean_url(r.get("menu_url")),
            "notes": (r.get("notes") or "").strip() or None,
        })
    return out


def neighborhood_to_nta(name: str | None, borough: str, nta_map: dict[str, dict]) -> str | None:
    """Map a free-text neighborhood ("West Village") onto the 2010 NTA whose name contains it."""
    if not name:
        return None
    n = name.strip().lower()
    code = NEIGHBORHOOD_ALIASES.get((borough, n))
    if code in nta_map:
        return code
    cands = [(c, v["name"]) for c, v in nta_map.items() if v.get("borough") == borough]
    for c, nm in cands:
        if nm.lower() == n:
            return c
    for c, nm in cands:
        if n in [seg.strip().lower() for seg in nm.split("-")]:
            return c
    contains = sorted((len(nm), c) for c, nm in cands if n in nm.lower())
    return contains[0][1] if contains else None


# ---------------------------------------------------------------------------------------
# CSV <-> DOHMH matching


def _name_variants(row: dict) -> list[str]:
    base = norm_name(row["name"])
    variants = [base]
    nb = norm_name(row.get("neighborhood"))
    v, changed = base, True
    while changed:  # "Smashed NYC West Village" -> "smashed nyc" -> "smashed"
        changed = False
        for suffix in filter(None, (nb, "nyc", "new york", "ny")):
            if v.endswith(" " + suffix):
                v = v[: -len(suffix) - 1].strip()
                variants.append(v)
                changed = True
    for v in list(variants):
        if v.startswith("the "):
            variants.append(v[4:])
    return [v for v in dict.fromkeys(variants) if v]


def _strip_city(n: str) -> str:
    return re.sub(r"\s+(nyc|ny|new york)$", "", n)


def name_score(a: str, b: str) -> float:
    """max(token_sort_ratio, ratio ignoring spaces), lifted to 90 when one multi-word name is
    contained in the other ('peter luger' vs 'peter luger steak house')."""
    s = max(fuzz.token_sort_ratio(a, b), fuzz.ratio(a.replace(" ", ""), b.replace(" ", "")))
    short = min((a, b), key=len)
    if len(short.split()) >= 2 and len(short) >= 8 and fuzz.token_set_ratio(a, b) == 100:
        s = max(s, 90.0)
    return s


def _address_in_urls(rec: dict, urls: str) -> bool:
    addr = rec.get("address") or ""
    m = re.match(r"^(\d+)\s+(.*)$", addr)
    if not m or not urls:
        return False
    number, street = m.group(1), norm_name(m.group(2)).split()
    word = next((w for w in street if len(w) >= 4 and not w.isdigit()), None)
    return bool(re.search(rf"(?<!\d){number}(?!\d)", urls)) and (word is None or word in urls)


def match_csv_row(
    row: dict,
    candidates: list[tuple[str, dict]],
    nta_map: dict[str, dict],
    min_date: str,
) -> tuple[dict | None, float, str]:
    """Best DOHMH record for a pilot row (same borough), or None. Returns (record, score, method)."""
    if not candidates:
        return None, 0.0, "no candidates"
    choices = [_strip_city(c[0]) for c in candidates]
    compact = [c.replace(" ", "") for c in choices]
    pool: dict[int, float] = {}
    subset: set[int] = set()  # one name fully contained in the other
    for v in _name_variants(row):
        hits = {idx: ts for _, ts, idx in process.extract(v, choices, scorer=fuzz.token_set_ratio, score_cutoff=80, limit=None)}
        for _, _, idx in process.extract(v.replace(" ", ""), compact, scorer=fuzz.ratio, score_cutoff=85, limit=None):
            hits.setdefault(idx, 0.0)
        for idx, ts in hits.items():
            s = name_score(v, choices[idx])
            pool[idx] = max(pool.get(idx, 0.0), s)
            if ts == 100 and min(len(v), len(choices[idx])) >= 5:
                subset.add(idx)
    if not pool:
        return None, 0.0, "no similar name"
    csv_nta = neighborhood_to_nta(row.get("neighborhood"), row["borough"], nta_map)
    csv_nb = (row.get("neighborhood") or "").lower()
    urls = " ".join(filter(None, (row.get("website"), row.get("menu_url")))).lower()
    scored = []
    for idx, s in pool.items():
        rec = candidates[idx][1]
        bonus = 0.0
        nb_ok = bool(rec.get("nta") and (rec["nta"] == csv_nta or (csv_nb and csv_nb in (rec.get("neighborhood") or "").lower())))
        url_ok = _address_in_urls(rec, urls)
        bonus += 6 if nb_ok else 0
        bonus += 15 if url_ok else 0  # the pilot URL names this exact address (e.g. /296-bleecker-st)
        bonus += 2 if is_recent(rec, min_date) else -5
        bonus += 3 if choices[idx] in _name_variants(row) else 0
        lifted = idx in subset and (nb_ok or url_ok)  # "Keens" vs "KEENS STEAKHOUSE" in the same NTA
        if lifted:
            s = max(s, 82.0)
        accept = s >= 86 or lifted or (s >= 80 and url_ok)
        scored.append((s + bonus, s, accept, nb_ok, url_ok, rec["camis"], rec))
    scored.sort(key=lambda t: (-t[0], t[5]))
    total, s, accept, nb_ok, url_ok, _, rec = scored[0]
    if not accept:
        return None, s, f"best candidate {rec['dba']!r} scored {s:.0f}"
    method = "name" + ("+neighborhood" if nb_ok else "") + ("+url-address" if url_ok else "")
    return rec, s, method


# ---------------------------------------------------------------------------------------
# Assembly


def build_restaurants(
    csv_rows: list[dict],
    dohmh_rows: list[dict],
    nta_map: dict[str, dict],
    *,
    cuisines: Iterable[str] = config.DEFAULT_CUISINES,
    min_date: str = config.DEFAULT_MIN_INSPECTION,
) -> tuple[list[dict], dict]:
    """CSV rows first (CSV order, merged with their DOHMH match), then in-scope DOHMH records."""
    cuisines = {c.strip().lower() for c in cuisines if c.strip()}
    latest = latest_per_camis(dohmh_rows)
    zip_nta = zip_to_nta(latest)
    records = [r for r in (normalize_dohmh(x, nta_map, zip_nta) for x in latest) if r]
    by_boro: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for r in records:
        by_boro[r["borough"]].append((norm_name(r["dba"]), r))

    report: dict[str, Any] = {
        "csv_rows": len(csv_rows), "csv_matched": 0, "csv_unmatched": [], "csv_duplicate_matches": [],
        "dohmh_records": len(records), "dohmh_dropped_boro": len(latest) - len(records),
    }
    out: list[dict] = []
    seen: set[str] = set()
    for row in csv_rows:
        rec, score, method = match_csv_row(row, by_boro.get(row["borough"], []), nta_map, min_date)
        if rec is not None and rec["camis"] in seen:
            report["csv_duplicate_matches"].append({"row": row["row"], "name": row["name"], "camis": rec["camis"]})
            rec = None
            method = "duplicate match"
        if rec is not None:
            r = dict(rec)
            if not r["nta"]:  # DOHMH record without NTA/zip: fall back to the CSV neighborhood
                nta = neighborhood_to_nta(row["neighborhood"], row["borough"], nta_map)
                if nta:
                    r.update(nta=nta, neighborhood=nta_map[nta]["name"], nta_source="csv-neighborhood")
            r.update(
                name=row["name"], website=row["website"], menu_url=row["menu_url"], csv=True,
                csv_name=row["name"], csv_neighborhood=row["neighborhood"], csv_notes=row["notes"],
                match={"score": round(score, 1), "method": method, "dba": rec["dba"]},
            )
            seen.add(rec["camis"])
            report["csv_matched"] += 1
        else:
            nta = neighborhood_to_nta(row["neighborhood"], row["borough"], nta_map)
            r = {
                "key": f"csv:{slugify(row['name'])}-{slugify(row['borough'])}",
                "camis": None, "dba": None, "name": row["name"], "address": None, "borough": row["borough"],
                "zipcode": None, "lat": None, "lng": None, "nta": nta,
                "neighborhood": nta_map[nta]["name"] if nta else row["neighborhood"],
                "nta_source": "csv-neighborhood" if nta else None,
                "cuisine": None, "last_inspection": None, "website": row["website"], "menu_url": row["menu_url"],
                "csv": True, "csv_name": row["name"], "csv_neighborhood": row["neighborhood"], "csv_notes": row["notes"],
                "match": None,
            }
            report["csv_unmatched"].append({"row": row["row"], "name": row["name"], "why": method})
        out.append(r)

    in_scope = [r for r in records if (r["cuisine"] or "").lower() in cuisines]
    recent = [r for r in in_scope if is_recent(r, min_date)]
    report["dohmh_in_cuisines"] = len(in_scope)
    report["dohmh_dropped_stale"] = len(in_scope) - len(recent)
    added = 0
    for r in sorted(recent, key=lambda r: (config.BOROUGHS.index(r["borough"]), r["name"].lower(), r["camis"])):
        if r["camis"] in seen:
            continue
        seen.add(r["camis"])
        out.append(r)
        added += 1
    report["dohmh_added"] = added
    report["dohmh_merged_with_csv"] = len(recent) - added
    report["no_neighborhood"] = sum(1 for r in out if not r["neighborhood"])
    report["restaurants"] = len(out)
    return out, report


def load_restaurants(
    *,
    cuisines: Iterable[str] = config.DEFAULT_CUISINES,
    min_date: str = config.DEFAULT_MIN_INSPECTION,
    cache_dir: Path = config.CACHE_DIR,
    csv_path: Path = config.PILOT_CSV,
    nta_path: Path = config.NTA_PATH,
    refresh: bool = False,
    offline: bool = False,
    write_to: Path | None = config.RESTAURANTS_PATH,
) -> tuple[list[dict], dict]:
    cuisines = list(cuisines)
    snap = load_dohmh_snapshot(cache_dir, refresh=refresh, offline=offline)
    restaurants, report = build_restaurants(
        load_csv(csv_path), snap["rows"], load_nta_map(nta_path), cuisines=cuisines, min_date=min_date
    )
    report["dohmh_fetched_at"] = snap.get("fetched_at")
    meta = {"cuisines": cuisines, "min_inspection_date": min_date, "dohmh_fetched_at": snap.get("fetched_at")}
    if write_to is not None:
        _write_json_atomic(Path(write_to), {"meta": meta, "report": report, "restaurants": restaurants}, indent=1)
    return restaurants, report
