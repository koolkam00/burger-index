"""Restaurant universe: the restaurant list CSV, matched to NYC DOHMH inspections + 2010 NTA names.

Everything here is free (NYC Open Data / Socrata, no key). The DOHMH snapshot is cached
under data/cache/socrata/ so builds are offline-reproducible; the NTA code -> name
mapping is committed at pipeline/data/nta_2010.json. DOHMH records with a hand-checked error
(a typo'd address with 0,0 coordinates) are fixed per CAMIS from pipeline/data/dohmh_overrides.json
before matching (load_dohmh_overrides). Hand-checked menu pages from pipeline/data/menu_urls.json replace a
restaurant's menu_url after matching (load_menu_url_overrides), so the scrape tries them first; the
restaurant list CSV is never edited.
"""

from __future__ import annotations

import csv
import difflib
import hashlib
import json
import os
import re
import sys
import threading
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import cos, hypot, radians
from pathlib import Path
from statistics import median
from typing import Any

from rapidfuzz import fuzz, process

from . import config
from .chains import brand_of, is_national_chain
from .names import (
    address_in_text, address_tokens, at_address, display_case, display_name, list_display_name, named_addresses, norm_name,
    slugify, street_in_name, street_in_text, strip_store_number,
)

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
# Hand-checked per-CAMIS fixes to DOHMH records (typo'd address, 0,0 coordinates): see load_dohmh_overrides.
DOHMH_OVERRIDES_PATH = config.PACKAGE_DIR / "data" / "dohmh_overrides.json"
OVERRIDE_FIELDS = ("building", "street", "zipcode", "latitude", "longitude", "nta")
# Hand-checked menu pages per restaurant key (the list's menu_url is stale, partial or another restaurant's):
# see load_menu_url_overrides.
MENU_URLS_PATH = config.PACKAGE_DIR / "data" / "menu_urls.json"
MENU_URL_FIELDS = ("menu_url", "checked_at", "reason", "name")
# CAMIS ids are issued in sequence; venue stands permitted together are a few numbers apart,
# a re-permit months or years later is thousands apart.
SAME_ISSUE_CAMIS_GAP = 1000

# CSV neighborhoods -> the 2010 NTAs they cover, primary first (keys are norm_name()d). Used to map
# unmatched rows onto one NTA name (the primary) and, when matching a row to DOHMH, to decide whether a
# record is "in the row's neighborhood" (any of them). Colloquial neighborhoods straddle NTA lines:
# Court St is the Cobble Hill / Boerum Hill (BK38) / Carroll Gardens (BK33) line, DOHMH puts NoHo's
# Great Jones and Elizabeth Streets in MN23, the UES is three NTAs. Only NTAs of the row's borough.
NEIGHBORHOOD_ALIASES: dict[tuple[str, str], tuple[str, ...]] = {
    ("Manhattan", "greenwich village"): ("MN23",),
    ("Manhattan", "meatpacking"): ("MN23", "MN13"),
    ("Manhattan", "meatpacking district"): ("MN23", "MN13"),
    ("Manhattan", "west chelsea"): ("MN13",),
    ("Manhattan", "chelsea"): ("MN13",),
    ("Manhattan", "flatiron"): ("MN13",),
    ("Manhattan", "nomad"): ("MN13", "MN17"),
    ("Manhattan", "nolita"): ("MN24",),
    ("Manhattan", "noho"): ("MN23", "MN22"),
    ("Manhattan", "east village"): ("MN22", "MN28"),
    ("Manhattan", "lower east side"): ("MN27", "MN28"),
    ("Manhattan", "les"): ("MN27", "MN28"),
    ("Manhattan", "financial district"): ("MN25",),
    ("Manhattan", "fidi"): ("MN25",),
    ("Manhattan", "hells kitchen"): ("MN15", "MN17", "MN13"),
    ("Manhattan", "koreatown"): ("MN17",),
    ("Manhattan", "midtown"): ("MN17", "MN19", "MN15"),
    ("Manhattan", "midtown west"): ("MN17", "MN15"),
    ("Manhattan", "times square"): ("MN17", "MN15"),
    ("Manhattan", "theater district"): ("MN17", "MN15"),
    ("Manhattan", "midtown east"): ("MN19", "MN20"),
    ("Manhattan", "kips bay"): ("MN20", "MN21"),
    ("Manhattan", "upper east side"): ("MN40", "MN31", "MN32"),
    ("Manhattan", "ues"): ("MN40", "MN31", "MN32"),
    ("Manhattan", "upper west side"): ("MN12", "MN14"),
    ("Manhattan", "uws"): ("MN12", "MN14"),
    ("Manhattan", "harlem"): ("MN11", "MN03", "MN06"),
    ("Manhattan", "central harlem"): ("MN11", "MN03"),
    ("Manhattan", "west harlem"): ("MN06", "MN04"),
    ("Manhattan", "east harlem"): ("MN33", "MN34"),
    ("Manhattan", "washington heights"): ("MN35", "MN36"),
    ("Manhattan", "inwood"): ("MN01", "MN35"),
    ("Brooklyn", "bed stuy"): ("BK75", "BK35", "BK69"),
    ("Brooklyn", "bedford stuyvesant"): ("BK75", "BK35", "BK69"),
    ("Brooklyn", "cobble hill"): ("BK09", "BK38", "BK33"),
    ("Brooklyn", "carroll gardens"): ("BK33", "BK38"),
    ("Brooklyn", "boerum hill"): ("BK38",),
    ("Brooklyn", "williamsburg"): ("BK73", "BK72", "BK90"),
    ("Brooklyn", "flatbush"): ("BK42", "BK60"),
    ("Brooklyn", "fort greene"): ("BK68", "BK38"),
    ("Brooklyn", "crown heights"): ("BK61", "BK63", "BK64"),
    ("Bronx", "throggs neck"): ("BX52",),
    ("Bronx", "throgs neck"): ("BX52",),
    ("Bronx", "fordham"): ("BX40", "BX05"),
    ("Bronx", "parkchester"): ("BX46", "BX55"),
    ("Bronx", "concourse"): ("BX63", "BX14"),
    ("Bronx", "kingsbridge"): ("BX29", "BX30"),
    ("Bronx", "riverdale"): ("BX22", "BX29"),
    ("Bronx", "south bronx"): ("BX39", "BX34", "BX35", "BX33", "BX27", "BX63", "BX14"),
    ("Queens", "long island city"): ("QN31", "QN68"),
    ("Queens", "lic"): ("QN31", "QN68"),
    ("Queens", "astoria"): ("QN70", "QN71", "QN72"),
    ("Queens", "flushing"): ("QN22", "QN52"),
    ("Staten Island", "west brighton"): ("SI35", "SI22"),
    ("Staten Island", "new springville"): ("SI05", "SI24"),
    ("Staten Island", "grant city"): ("SI45", "SI24"),
    ("Staten Island", "eltingville"): ("SI01", "SI54"),
    ("Staten Island", "new dorp"): ("SI45", "SI54"),
}
_BOROUGH_WORDS = frozenset({"manhattan", "brooklyn", "queens", "bronx", "the bronx", "staten island", "nyc",
                            "new york", "new york city"})

# USPS ZIP codes of CSV neighborhoods that share a 2010 NTA with other neighborhoods (keys as in
# NEIGHBORHOOD_ALIASES): MN23 is the West Village and Greenwich Village east to University Place, MN13 is
# Chelsea, the Flatiron and Union Square. They only break a tie between records in the row's NTAs, for a row
# that names no address (Matcher: `near`): Jack's Wife Freda (West Village) is the 50 Carmine St shop (10014),
# not the University Place one (10003); Cafeteria (Chelsea) is 119 7th Ave (10011), not 1 Madison Ave (10010).
NEIGHBORHOOD_ZIPS: dict[tuple[str, str], tuple[str, ...]] = {
    ("Manhattan", "west village"): ("10014", "10011"),
    ("Manhattan", "chelsea"): ("10011", "10001"),
    ("Manhattan", "west chelsea"): ("10011", "10001"),
}
# A record this close to an address the row names, where DOHMH has nothing, is the place there: DOHMH files
# Brooklyn Diner ('212 W 57th') under its corner address, 888 7 Avenue. Only breaks a tie (Matcher: `near`).
NEAR_NAMED_M = 250
LOCATE_NUMBERS = 40  # records on the named street within this many house numbers say where the address is

# 2010 NTA names that mislead today, shown as current usage. MN27 'Chinatown' also covers the
# Lower East Side west of Essex (Orchard, Ludlow, Eldridge); MN28 'Lower East Side' is the LES
# east of Essex plus Alphabet City (Avenues B-D); BK73 'North Side-South Side' is what everyone
# calls Williamsburg, and BK72 'Williamsburg' is South Williamsburg. BX99 is the 2010 placeholder
# 'park-cemetery-etc-Bronx'; the priced places in it are park concessions (Hudson Garden Grill in the
# Botanical Garden, Orchard Beach Grill in Pelham Bay Park). BK99, 'park-cemetery-etc-Brooklyn', is not
# only parks (Dyker Beach golf course, for one), so it shows as "Other Brooklyn areas". Restaurant ids
# keep the placeholder's "park" (build._nbhd_short), so a label here never changes an id.
NTA_DISPLAY_OVERRIDES = {
    "MN27": "Chinatown-Lower East Side",
    "MN28": "Lower East Side-Alphabet City",
    "BK72": "South Williamsburg",
    "BK73": "Williamsburg",
    "BX99": "Bronx parks",
    "BK99": "Other Brooklyn areas",
}

_log_lock = threading.Lock()


class ScopeError(ValueError):
    """A scope flag that would silently shrink the dataset (e.g. a misspelled --cuisines value)."""


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
    so restaurant-list rows of any cuisine can be matched. ~31k rows, ~8.5 MB."""
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
    ntas = json.loads(Path(path).read_text())["ntas"]
    for code, name in NTA_DISPLAY_OVERRIDES.items():
        if code in ntas:
            ntas[code] = {**ntas[code], "name": name}
    return ntas


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


def load_dohmh_overrides(path: Path = DOHMH_OVERRIDES_PATH) -> list[dict]:
    """Hand-checked fixes to DOHMH records (pipeline/data/dohmh_overrides.json -> "overrides": [...]).

    Entry fields:
      camis       the record to fix
      dba         the record's DBA, for the reader (not checked)
      when        {raw DOHMH field: value}: the override applies only while the record still says this
                  (e.g. the typo'd building number), so a fix DOHMH makes itself retires it
      set         {raw DOHMH field: value}: the corrected fields (OVERRIDE_FIELDS only); lat/lng numbers or strings
      reason      one sentence: what DOHMH has wrong and how the fix was checked
      source_url  where the corrected values come from
      checked_at  YYYY-MM-DD
    """
    if not Path(path).exists():
        return []
    overrides = json.loads(Path(path).read_text())["overrides"]
    seen: set[str] = set()
    for o in overrides:
        camis = str(o.get("camis") or "")
        bad = sorted(set(o.get("set") or {}) - set(OVERRIDE_FIELDS)) + sorted(set(o.get("when") or {}) - set(DOHMH_GROUP_FIELDS))
        if not camis or not o.get("set") or bad or camis in seen:
            raise ValueError(f"{path}: bad DOHMH override for camis {camis or '?'}: "
                             + (f"unknown fields {bad}" if bad else "duplicate camis" if camis in seen else "needs camis and set"))
        seen.add(camis)
    return overrides


def apply_dohmh_overrides(rows: list[dict], overrides: list[dict]) -> tuple[list[dict], dict]:
    """rows: raw DOHMH rows, one per CAMIS (latest_per_camis). Returns the rows with each override's
    `set` fields replaced, and a report: which were applied, and which no longer apply (the CAMIS is
    gone from the snapshot, or DOHMH no longer says what `when` expects) and can be deleted."""
    by_camis = {str(o["camis"]): o for o in overrides}
    applied: list[str] = []
    out: list[dict] = []
    for r in rows:
        o = by_camis.get(str(r.get("camis")))
        if o is not None and all(str(r.get(k) or "") == str(v) for k, v in (o.get("when") or {}).items()):
            r = {**r, **{k: str(v) for k, v in o["set"].items()}}
            applied.append(str(o["camis"]))
        out.append(r)
    have = {str(r.get("camis")) for r in rows}
    unused = [{"camis": c, "why": (f"the DOHMH record no longer says {json.dumps(o.get('when'))}" if c in have
                                   else "CAMIS not in the DOHMH snapshot")}
              for c, o in by_camis.items() if c not in applied]
    for u in unused:
        log(f"sources: DOHMH override for camis {u['camis']} not applied ({u['why']}); delete it from "
            f"{DOHMH_OVERRIDES_PATH.name} if DOHMH has fixed the record")
    return out, {"applied": applied, "unused": unused}


def load_menu_url_overrides(path: Path = MENU_URLS_PATH) -> dict[str, dict]:
    """Hand-checked menu pages (pipeline/data/menu_urls.json -> "overrides": {restaurant key: entry}).

    Keys are restaurant keys as data/restaurants.json has them (camis:..., csv:...). Entry fields:
      menu_url    the restaurant's own current menu page (or, when it has none, the full menu of this
                  location on an ordering / delivery site): becomes the record's menu_url, scraped first
      checked_at  YYYY-MM-DD the page was checked
      reason      one sentence: why the list's page is wrong and what was checked
      name        optional, for the reader (not checked)
    A record's menu_url changes its scrape path, so the target is re-scraped on the next `run`
    (credits); plan/build count it as not yet scraped until then.
    """
    if not Path(path).exists():
        return {}
    overrides = json.loads(Path(path).read_text())["overrides"]
    for key, o in overrides.items():
        bad = sorted(set(o) - set(MENU_URL_FIELDS))
        problem = (
            "key must be camis:<id> or csv:<slug>" if not re.match(r"^(camis|csv):\S+$", key)
            else f"unknown fields {bad}" if bad
            else "menu_url must be an http(s) URL" if not re.match(r"^https?://\S+$", str(o.get("menu_url") or ""))
            else "checked_at must be YYYY-MM-DD" if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(o.get("checked_at") or ""))
            else "needs a reason" if not str(o.get("reason") or "").strip()
            else None
        )
        if problem:
            raise ValueError(f"{path}: bad menu-URL override for {key}: {problem}")
    return overrides


def apply_menu_url_overrides(records: list[dict], overrides: Mapping[str, dict]) -> tuple[list[dict], dict]:
    """Set the menu_url of each record with an override (the list's own value is kept as
    list_menu_url and no longer tried) and mark it menu_url_override, so the scrape tries the page
    first and trusts it as this restaurant's menu (chains._csv_urls, process.evaluate_scrape).
    Report: which keys were applied, and which were not (the key is not in scope, or the list
    already names that page) and can be deleted."""
    applied: list[str] = []
    unused: list[dict] = []
    have = set()
    out: list[dict] = []
    for r in records:
        have.add(r["key"])
        o = overrides.get(r["key"])
        if o is not None and r.get("menu_url") == o["menu_url"]:
            unused.append({"key": r["key"], "why": "the restaurant list already has this menu_url"})
        elif o is not None:
            r = {**r, "list_menu_url": r.get("menu_url"), "menu_url": o["menu_url"],
                 "menu_url_override": {"checked_at": o["checked_at"], "reason": o["reason"]}}
            applied.append(r["key"])
        out.append(r)
    unused += [{"key": k, "why": "no restaurant with this key in scope (renamed or dropped from the list, or excluded)"}
               for k in overrides if k not in have]
    for u in unused:
        log(f"sources: menu-URL override for {u['key']} not applied ({u['why']}); delete it from {MENU_URLS_PATH.name}")
    return out, {"applied": applied, "unused": unused}


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
        "csv_row": None,
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


def load_csv(path: Path = config.RESTAURANT_LIST_CSV) -> list[dict]:
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


def _is_park_nta(code: str, v: dict) -> bool:
    return code.endswith("99") or "park-cemetery" in (v.get("name") or "")


def neighborhood_ntas(name: str | None, borough: str, nta_map: dict[str, dict]) -> tuple[str, ...]:
    """Every 2010 NTA a free-text neighborhood ("Upper East Side", "UES", "Harlem") covers, primary first.

    Curated aliases first (NEIGHBORHOOD_ALIASES), then an NTA named exactly that, then NTAs with a
    name segment equal to it ('Lower East Side' -> MN27, MN28), then NTAs whose name contains it
    (shortest first). A borough's own name and the park-cemetery NTAs never match."""
    if not name or not name.strip():
        return ()
    key = norm_name(name)
    if key in _BOROUGH_WORDS:
        return ()
    if (borough, key) in NEIGHBORHOOD_ALIASES:
        return tuple(c for c in NEIGHBORHOOD_ALIASES[(borough, key)] if c in nta_map)
    n = name.strip().lower()
    cands = sorted((c, v["name"]) for c, v in nta_map.items() if v.get("borough") == borough and not _is_park_nta(c, v))
    exact = tuple(c for c, nm in cands if nm.lower() == n)
    if exact:
        return exact
    segments = tuple(c for c, nm in cands if n in [seg.strip().lower() for seg in nm.split("-")])
    if segments:
        return segments
    return tuple(c for _, c in sorted((len(nm), c) for c, nm in cands if n in nm.lower()))


def neighborhood_to_nta(name: str | None, borough: str, nta_map: dict[str, dict]) -> str | None:
    """The primary 2010 NTA for a free-text neighborhood ("West Village" -> MN23), or None."""
    codes = neighborhood_ntas(name, borough, nta_map)
    return codes[0] if codes else None


# ---------------------------------------------------------------------------------------
# CSV <-> DOHMH matching


# Words that say what kind of place it is, not which one. They are dropped before two names are compared,
# so 'PJ Brady's Bar and Restaurant' is P.J. BRADY'S TAVERN and not BRASAS RESTAURANT & BAR.
GENERIC_NAME_WORDS = frozenset({
    "the", "and", "a", "an", "of", "at", "n", "restaurant", "restaurants", "bar", "grill", "grille", "cafe", "kitchen",
    "pub", "tavern", "lounge", "bistro", "diner", "eatery", "steakhouse", "nyc", "ny", "llc", "inc", "corp", "co",
})
# Ordinary words that never carry a match on their own (SPRING is not 'Spring Cafe', THE OFFICE is not 'At The
# Office', THE JUNCTION is not 'The Junction Bar', CATCH is not 'Catch Steak') and don't count as the word a
# renamed restaurant shares with its row. So is any word in COMMON_WORD_DF or more DOHMH names, and the row's own
# neighborhood words ('Hudson Yards Grill' is not HUDSON YARDS CATERING LLC).
COMMON_NAME_WORDS = GENERIC_NAME_WORDS | {
    "spring", "bedford", "office", "junction", "catch", "burger", "burgers", "hamburger", "hamburgers", "beer",
    "pizza", "chicken", "wings", "house", "hall", "club", "room", "social", "park", "corner", "square", "street",
    "avenue", "new", "york", "city", "village", "hill", "heights", "brooklyn", "queens", "bronx", "manhattan",
    "island", "american", "little", "big", "blue", "black", "golden", "royal", "king", "famous", "original",
    "classic", "best", "good", "great", "fresh", "express", "deli", "shop", "market", "garden", "food", "coffee",
    "bakery", "juice", "tea", "sushi", "taco", "tacos", "bbq", "steak", "prime", "smash", "craft", "brewery",
    "brewing", "cocktail", "cocktails", "wine", "sports", "irish", "grand", "central", "local", "next", "door",
}
COMMON_WORD_DF = 20
NAME_ACCEPT = 86.0  # this similar is the same restaurant, when the location agrees
NAME_AT_ADDRESS = 80.0  # ...and this similar is enough at the address the row names
LIFTED = 82.0  # one name contained in the other, confirmed by the location


def _paren_hints(name: str) -> tuple[str, list[str]]:
    """'Emmy Squared (UES)' -> ('Emmy Squared', ['UES'])."""
    hints = [h.strip() for h in re.findall(r"\(([^)]*)\)", name or "") if h.strip()]
    return re.sub(r"\s*\([^)]*\)", " ", name or "").strip(), hints


def _name_variants(row: dict, places: Iterable[str] = ()) -> list[str]:
    """Normalized names to compare a row with: parenthetical qualifiers ('(UES)', '(Archer Hotel)') dropped,
    then trailing neighborhood / hint / city / borough words ('Smashed NYC West Village' -> 'smashed nyc' ->
    'smashed', 'SluttyVegan Brooklyn' -> 'sluttyvegan', 'Burgerology Midtown' -> 'burgerology' when `places`,
    the row's NTA names, include Midtown), then a leading 'the'."""
    bare, hints = _paren_hints(row["name"])
    base = norm_name(bare) or norm_name(row["name"])
    variants = [base]
    suffixes = [s for s in (norm_name(row.get("neighborhood")), *map(norm_name, hints), *map(norm_name, places),
                            "nyc", "new york", "ny", *_BOROUGH_WORDS) if s]
    v, changed = base, True
    while changed:
        changed = False
        for suffix in suffixes:
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


def _primary_name(dba: str) -> str:
    """The dba as one name: store numbers dropped, parentheticals and '/' parts kept."""
    return _strip_city(norm_name(re.sub(r"\s*#\s*\d+\w*", "", dba or "")))


def _record_names(dba: str) -> list[str]:
    """Normalized names of a DOHMH record, primary first: the dba, without store numbers or a trailing
    parenthetical, and each part of a combined dba ('ACME / THE NINES', 'THE HIGH NOTE / POPCHEW',
    'CITY ISLAND DINER , SNUG BAR', 'THOMPSON NEW YORK HOTEL (Burger Joint)')."""
    parts = [strip_store_number(dba)]
    if "/" in dba or "," in dba:
        parts += [strip_store_number(p) for p in re.split(r"[/,]", dba)]
    parts += re.findall(r"\(([^)]*)\)", dba)
    names = [_primary_name(dba), *(_strip_city(norm_name(p)) for p in parts)]
    return [n for n in dict.fromkeys(names) if len(n.replace(" ", "")) >= 2]


def _core(n: str) -> str:
    return " ".join(w for w in n.split() if w not in GENERIC_NAME_WORDS)


def _compact(n: str) -> str:
    return n.replace(" ", "")


def _sim(a: str, b: str) -> float:
    return max(fuzz.token_sort_ratio(a, b), fuzz.ratio(_compact(a), _compact(b)))


def _no_the(n: str) -> str:
    return re.sub(r"^the ", "", n)


def _cores(a: str, b: str) -> tuple[str, str]:
    """Both names without generic words, or both whole (minus a leading 'the') when that leaves too little."""
    ca, cb = _core(a), _core(b)
    if len(_compact(ca)) < 3 or len(_compact(cb)) < 3:
        return _no_the(a), _no_the(b)
    return ca, cb


def _words_in_order(short: list[str], long: list[str]) -> bool:
    rest = iter(long)
    return all(w in rest for w in short)


@dataclass(frozen=True)
class _Words:
    """What can't make a name distinctive, for one row: its neighborhood's names ('Hudson Yards Grill' in
    Hudson Yards is only 'grill') and, for a name that rests on one word, ordinary words (COMMON_NAME_WORDS,
    or in COMMON_WORD_DF+ DOHMH names)."""

    df: Mapping[str, int] = field(default_factory=dict)
    places: frozenset[str] = frozenset()  # normalized neighborhood / NTA names: 'hudson yards', 'nomad'

    @classmethod
    def for_row(cls, df: Mapping[str, int], places: Iterable[str]) -> _Words:
        return cls(df, frozenset(p for p in map(norm_name, places) if p))

    def common(self, w: str) -> bool:
        """Too ordinary to carry a match alone: 'spring', 'office', 'junction', 'joes'."""
        return w in COMMON_NAME_WORDS or w in self.places or len(w) <= 2 or self.df.get(w, 0) >= COMMON_WORD_DF

    def only_place(self, name: str) -> bool:
        """Nothing but generic words and the row's neighborhood: 'hudson yards grill', 'nomad bar'."""
        core = _core(_no_the(name))
        return not core or core in self.places


_NO_WORDS = _Words()


def _generic(n: str) -> set[str]:
    return set(n.split()) & GENERIC_NAME_WORDS - {"the"}


def name_score(a: str, b: str, words: _Words = _NO_WORDS) -> float:
    """How alike two normalized names are, 0-100. Identical names score 100.

    Names are compared without generic words (bar, restaurant, the...), which may add at most 10 points
    back ('el poblado gastro bar' / 'poblado gastrobar'), so 'pj bradys bar and restaurant' matches 'p j
    bradys tavern' and not 'brasas restaurant and bar'. max(token_sort_ratio, ratio ignoring spaces),
    lifted to 90 when one name of two or more words starts the other or runs through it word by word
    from the same first word ('peter luger' / 'peter luger steak house', 'benjamin prime' / 'benjamin
    steakhouse prime'); containment anywhere else doesn't count ('burgers and beer' is not 'black tap
    craft burgers and beer'), nor does a name of generic and neighborhood words only ('hudson yards grill'
    / 'hudson yards catering llc'). When one name rests on a single word and the generic words differ,
    the score stays below the accept line ('spring cafe' / 'spring', 'the junction bar' / 'the junction',
    'keens' / 'keens steakhouse'): see _contained."""
    if _compact(a) == _compact(b):
        return 100.0
    if words.only_place(a) or words.only_place(b):  # 'hudson yards grill' / 'hudson yards tavern'
        return min(_sim(_no_the(a), _no_the(b)), NAME_AT_ADDRESS - 1)
    ca, cb = _cores(a, b)
    s = _sim(ca, cb)
    s = max(s, min(_sim(_no_the(a), _no_the(b)), s + 10))
    if min(len(set(ca.split())), len(set(cb.split()))) == 1 and _generic(a) != _generic(b):
        s = min(s, NAME_AT_ADDRESS - 1)
    fs, fl = sorted((_no_the(a).split(), _no_the(b).split()), key=len)
    if len(fs) >= 2 and len(" ".join(fs)) >= 8 and fs[0] == fl[0] and _words_in_order(fs, fl):
        s = max(s, 90.0)
    return s


def _contained(a: str, b: str, words: _Words = _NO_WORDS) -> bool:
    """One name's words (generic words aside) all appear in the other, and not all of them are ordinary
    words: 'blue collar' / 'blue collar burger', 'keens' / 'keens steakhouse', 'serafina meatpacking' /
    'serafina'. Evidence only together with the location. `a` is the row's name, `b` the record's: a
    record name inside the row's name must start it (the row may add a place: 'westville hudson' /
    'westville'; 'bfb highline' is not 'highline cafe'); the row's name may sit anywhere in a DBA that adds
    an owner or a street ('broome street bar' / 'kenns broome street bar', 'cookshop' / '10th avenue
    cookshop'). One word counts only when it is not ordinary and its name has no generic words of its own,
    or the same ones: 'the mercer kitchen' is not 'bar mercer'."""
    if words.only_place(a) or words.only_place(b):
        return False
    ca, cb = _cores(a, b)
    xa, xb = set(ca.split()), set(cb.split())
    xs, ys = sorted((xa, xb), key=len)
    if not xs <= ys:
        return False
    if xb < xa and ca.split()[0] != cb.split()[0]:  # the record's name is the shorter: it must start the row's
        return False
    if len(xs) >= 2:  # 'burgers and beer' in 'black tap craft burgers and beer' is not enough
        return any(not words.common(w) for w in xs)
    (w,) = xs
    return len(w) >= 4 and not words.common(w) and _generic_compatible(a, b)


def _generic_compatible(a: str, b: str) -> bool:
    """The generic words don't say they're different places: one name has none ('keens' / 'keens
    steakhouse', 'cask bar and kitchen' / 'cask') or both have the same. 'the mercer kitchen' / 'bar mercer'
    are not compatible."""
    ga, gb = _generic(a), _generic(b)
    return not ga or not gb or ga == gb


def _same_name(a: str, b: str, words: _Words = _NO_WORDS) -> bool:
    """The same name, spacing, punctuation, a leading 'the' and plural / possessive 's' aside ('stackd burger'
    / 'stackd burgers', 'f ottomanellis' / 'f ottomanelli'), and more than one ordinary word ('spring' /
    'spring'). Generic words may differ too ('step in restaurant' / 'step in restaurant and lounge', 'pj
    bradys bar and restaurant' / 'p j bradys tavern') when what is left is not ordinary words only ('tavern
    next door' / 'next door') or one word with other generic words ('the mercer kitchen' / 'bar mercer')."""
    def key(n: str) -> str:
        return "".join(re.sub(r"s$", "", w) for w in n.split())

    fa, fb = _no_the(a), _no_the(b)
    if key(fa) == key(fb):
        return len(fa.split()) >= 2 or not words.common(fa)
    ca, cb = _cores(a, b)
    if key(ca) != key(cb) or all(words.common(w) for w in ca.split()):
        return False
    return len(ca.split()) >= 2 or _generic_compatible(a, b)


def _starts_alike(a: str, b: str) -> bool:
    """The names begin the same way, spacing and a leading 'the' aside: 'neptune diner' / 'neptune diner ii',
    'pj bradys' / 'p j bradys tavern'; not 'the wren' / 'l wren'."""
    return _compact(_no_the(a))[:3] == _compact(_no_the(b))[:3]


def _address_related(a: str, b: str) -> bool:
    """Enough of a name link for a record at the address the row names, even when the restaurant was
    renamed or registered under another name: a shared real word ('Holy Cow' / HOLY BURGER, 'Popchew Burger'
    / THE HIGH NOTE / POPCHEW), all of one name's words in the other ('american grill' / 'g and g american
    grill'), or an initialism ('SI Diner' / STATEN ISLAND DINER). SOM BO is not 'Bareburger'."""
    wa, wb = a.split(), b.split()
    if {w for w in wa if len(w) >= 3 and w not in COMMON_NAME_WORDS} & set(wb):
        return True
    small, large = sorted((set(wa), set(wb)), key=len)
    if len(small) >= 2 and small <= large:
        return True
    for short, long in ((wa, wb), (wb, wa)):
        words = [w for w in long if w != "the"]
        for t in short:
            n = len(t)
            if 2 <= n <= 4 and t.isalpha() and any(
                    "".join(w[0] for w in words[i:i + n]) == t for i in range(len(words) - n + 1)):
                return True
    return False


def _address_in_urls(rec: dict, urls: str) -> bool:
    addr = rec.get("address") or ""
    m = re.match(r"^(\d+)\s+(.*)$", addr)
    if not m or not urls:
        return False
    number, street = m.group(1), norm_name(m.group(2)).split()
    word = next((w for w in street if len(w) >= 4 and not w.isdigit()), None)
    return bool(re.search(rf"(?<!\d){number}(?!\d)", urls)) and (word is None or word in urls)


def _meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance between two (lat, lng) points in meters; flat-earth, fine within a city."""
    return hypot((a[0] - b[0]) * 111_000, (a[1] - b[1]) * 111_000 * cos(radians(a[0])))


def _mentioned(names: Iterable[str], text: str | None) -> bool:
    """The text names this record word for word, a leading 'the' aside, by a name that is not only ordinary
    words: 'beside The Consulate (same address)' names THE CONSULATE; 'Pizza sports bar' doesn't name PIZZA."""
    t = f" {norm_name(text)} "
    return any(f" {n} " in t for n in map(_no_the, names) if n and not all(w in COMMON_NAME_WORDS for w in n.split()))


@dataclass
class _Pool:
    """DOHMH records a row may match: one borough (or all of NYC) and one national-chain status."""

    records: list[dict] = field(default_factory=list)
    names: list[str] = field(default_factory=list)  # every record name, flattened
    owner: list[int] = field(default_factory=list)  # names[i] belongs to records[owner[i]]
    record_names: list[list[str]] = field(default_factory=list)
    by_address: dict[tuple[str, ...], list[int]] = field(default_factory=lambda: defaultdict(list))

    def add(self, rec: dict, rn: list[str]) -> None:
        i = len(self.records)
        self.records.append(rec)
        self.record_names.append(rn)
        for n in rn:
            self.names.append(n)
            self.owner.append(i)
        tokens = address_tokens(rec.get("address"))
        if len(tokens) >= 2 and tokens[0].isdigit():
            self.by_address[tuple(tokens[:2])].append(i)

    def finish(self) -> None:
        self.compact = [_compact(n) for n in self.names]
        self.core_compact = [_compact(_core(n)) for n in self.names]

    def similar(self, variants: list[str], words: _Words) -> dict[int, float]:
        """Records whose name is anywhere near one of the row's names -> best name_score."""
        idx: set[int] = set()
        for v in variants:
            idx.update(i for _, _, i in process.extract(v, self.names, scorer=fuzz.token_set_ratio, score_cutoff=80,
                                                        limit=None))
            idx.update(i for _, _, i in process.extract(_compact(v), self.compact, scorer=fuzz.ratio, score_cutoff=85,
                                                        limit=None))
            core = _compact(_core(v))
            if len(core) >= 3:
                idx.update(i for _, _, i in process.extract(core, self.core_compact, scorer=fuzz.ratio,
                                                            score_cutoff=90, limit=None))
        return {r: self.score(r, variants, words) for r in {self.owner[i] for i in idx}}

    def score(self, r: int, variants: list[str], words: _Words) -> float:
        # A DOHMH record can have a blank DBA (one at 585 E 189th St does): nothing to compare, no match.
        return max((name_score(v, n, words) for v in variants for n in self.record_names[r]), default=0.0)

    def at(self, key: list[str]) -> list[int]:
        return [i for i in self.by_address.get(tuple(key[:2]), []) if at_address(self.records[i].get("address"), key)]


@dataclass
class _Candidate:
    row: int  # index into csv_rows
    rec: dict
    score: float  # name score, lifted when the location confirms a contained name
    raw: float  # name score before any lift: the closer name wins a tie
    tier: int  # 2 at the address the row names, 1 in its neighborhood or on its street, 0 a unique name elsewhere
    total: float  # ranks candidates within a tier
    method: str
    rivals: frozenset[str] = frozenset()  # tier 0: other places in NYC with this name (CAMIS)
    # breaks a tie, nothing else: 2 = next to the address the row names (NEAR_NAMED_M), 1 = in a ZIP code of the
    # row's neighborhood (NEIGHBORHOOD_ZIPS, rows that name no address)
    near: int = 0

    @property
    def key(self) -> tuple[int, float, float, int]:
        return self.tier, round(self.total, 1), round(self.raw, 1), self.near

    @property
    def tiebreak(self) -> str:
        return {2: "near-named-address", 1: "neighborhood-zip"}.get(self.near, "")


def _describe(rec: dict) -> dict:
    return {"camis": rec["camis"], "dba": rec["dba"], "address": rec.get("address"),
            "neighborhood": rec.get("neighborhood")}


def _place(rec: dict) -> str:
    """Permits at one address are one place (a re-permit, a venue's stands)."""
    return norm_name(rec.get("address")) or rec["camis"]


class Matcher:
    """Scores restaurant-list rows against DOHMH records (same borough, same national-chain status).

    A record is a candidate for a row when the location agrees and the name is close enough:
    - tier 2: at an address the row's notes or URLs name; a renamed restaurant or one registered under a
      company name counts when it still shares a real word with the row ('Holy Cow' / HOLY BURGER);
    - tier 1: in one of the row's neighborhood NTAs (its CSV neighborhood and parenthetical hints) or on a
      street its notes, URLs or name name ('Court St outpost', 'Westville Hudson', 'Shake Shack (Madison
      Square Park)'), with a name score >= NAME_ACCEPT, or one name contained in the other when the row
      names no other address ('Sojourn' is not SOJOURN SOCIAL ten blocks from its address);
    - tier 0: anywhere in the borough only when the name is the same, the row names no other address, the
      permit has been inspected (not a 1900-01-01 permit for a stand or a restaurant not yet open), and no
      other place in NYC with that name is left for it (assign_matches: its `rivals`, records with a near
      name that starts the same way, all went to other rows).
    Candidates that tie on all of that are told apart by `near` only: the one next to the address the row
    names (located from the DOHMH records on that street), else, for a row that names no address, the one in
    a ZIP code of its neighborhood (NEIGHBORHOOD_ZIPS).
    """

    def __init__(self, records: list[dict], nta_map: dict[str, dict], min_date: str):
        self.nta_map, self.min_date = nta_map, min_date
        self.df = Counter(w for r in records for w in set(norm_name(r["dba"]).split()))
        self.pools: dict[tuple[str | None, str | None], _Pool] = defaultdict(_Pool)
        # (borough, street words) -> [(house number, lat, lng)]: where an address DOHMH has no record at is
        self.streets: dict[tuple[str, tuple[str, ...]], list[tuple[int, float, float]]] = defaultdict(list)
        for r in records:
            slug, rn = _national_slug(r), _record_names(r["dba"])
            self.pools[(r["borough"], slug)].add(r, rn)
            self.pools[(None, slug)].add(r, rn)  # all of NYC: who else has this name?
            t = address_tokens(r.get("address"))
            if len(t) >= 2 and t[0].isdigit() and r.get("lat") is not None and r.get("lng") is not None:
                self.streets[(r["borough"], tuple(t[1:3]))].append((int(t[0]), r["lat"], r["lng"]))
        for p in self.pools.values():
            p.finish()

    def row_ntas(self, row: dict) -> list[str]:
        """The row's neighborhood NTAs, primary first: its CSV neighborhood, then parenthetical hints."""
        codes = list(neighborhood_ntas(row.get("neighborhood"), row["borough"], self.nta_map))
        for hint in _paren_hints(row["name"])[1]:
            codes += neighborhood_ntas(hint, row["borough"], self.nta_map)
        return list(dict.fromkeys(codes))

    def row_zips(self, row: dict) -> set[str]:
        """ZIP codes of the row's neighborhood and parenthetical hints (NEIGHBORHOOD_ZIPS), if listed."""
        return {z for nb in (row.get("neighborhood"), *_paren_hints(row["name"])[1])
                for z in NEIGHBORHOOD_ZIPS.get((row["borough"], norm_name(nb)), ())}

    def locate(self, borough: str, key: list[str]) -> tuple[float, float] | None:
        """Roughly where an address a row names is (a named_addresses() key: ['212', 'w', '57']): the middle
        of the DOHMH records on that street with the nearest house numbers (up to five, within LOCATE_NUMBERS).
        None when DOHMH has nothing on that stretch of the street."""
        if len(key) < 2 or not key[0].isdigit():
            return None
        n = int(key[0])
        near = sorted((abs(m - n), lat, lng) for m, lat, lng in self.streets.get((borough, tuple(key[1:3])), ())
                      if abs(m - n) <= LOCATE_NUMBERS)[:5]
        if not near:
            return None
        return median(p[1] for p in near), median(p[2] for p in near)

    def candidates(self, i: int, row: dict) -> tuple[list[_Candidate], str, dict]:
        """(acceptable candidates, why there is none, {'named': addresses, 'at_address': records there})."""
        slug = _national_slug({"csv_name": row["name"], "name": row["name"]})
        pool = self.pools.get((row["borough"], slug))
        info: dict[str, Any] = {"named": [], "at_address": []}
        if pool is None:
            return [], "no candidates", info
        ntas = self.row_ntas(row)
        places = {seg for c in ntas for seg in self.nta_map[c]["name"].split("-")}
        places |= {p for p in (row.get("neighborhood"), *_paren_hints(row["name"])[1]) if p}
        words = _Words.for_row(self.df, places)
        variants = _name_variants(row, sorted(places, key=len, reverse=True))
        urls = " ".join(filter(None, (row.get("website"), row.get("menu_url"))))
        notes = row.get("notes") or ""
        named_notes, named_urls = named_addresses(notes), named_addresses(urls)
        named = named_notes + [k for k in named_urls if k not in named_notes]
        info["named"] = [" ".join(k) for k in named]
        spots = [p for k in named if (p := self.locate(row["borough"], k))]
        zips = set() if named else self.row_zips(row)
        scores = pool.similar(variants, words)
        for key in named:
            for r in pool.at(key):
                if not _mentioned(pool.record_names[r], notes):  # 'beside The Consulate (same address)': known
                    info["at_address"].append(_describe(pool.records[r]))
                scores.setdefault(r, pool.score(r, variants, words))
        if not scores:
            return [], "no similar name", info
        namesakes: dict[str, str] | None = None
        out: list[_Candidate] = []
        rejected: list[tuple[float, str]] = []
        for r, s in scores.items():
            rec, names = pool.records[r], pool.record_names[r]
            pairs = [(v, n) for v in variants for n in names]
            address = rec.get("address")
            nb_ok = bool(rec.get("nta")) and rec["nta"] in ntas
            url_ok = _address_in_urls(rec, urls.lower()) or any(at_address(address, k) for k in named_urls)
            notes_ok = address_in_text(address, notes) or any(at_address(address, k) for k in named_notes)
            addr_ok = url_ok or notes_ok
            conflict = bool(named) and not addr_ok  # the row names an address, and this record isn't there
            street = ("notes" if street_in_text(address, notes) else "url" if street_in_text(address, urls)
                      else "name" if street_in_name(address, row["name"], {w for n in names for w in address_tokens(n)})
                      else "")
            contained = any(_contained(v, n, words) for v, n in pairs)
            where = f"{rec['dba']!r} ({address}, {rec.get('neighborhood')})"
            rivals: frozenset[str] = frozenset()
            if addr_ok and (s >= NAME_AT_ADDRESS or contained or any(_address_related(v, n) for v, n in pairs)):
                tier, how = 2, ("name" if s >= NAME_AT_ADDRESS or contained else "name-word")
            elif (nb_ok or street) and (s >= NAME_ACCEPT or (contained and not conflict)):
                tier, how = 1, "name"
            elif nb_ok or street or s < NAME_ACCEPT:
                rejected.append((s, f"best candidate {rec['dba']!r} scored {s:.0f}"
                                 + (f", not at the address the row names ({'; '.join(info['named'])})"
                                    if conflict and contained else "")))
                continue
            elif conflict:
                rejected.append((s, f"{where} is not at the address the row names ({'; '.join(info['named'])})"))
                continue
            elif rec.get("last_inspection") in (None, NOT_INSPECTED):
                rejected.append((s, f"{where} is outside the row's neighborhood and not yet inspected"))
                continue
            elif not any(_same_name(v, n, words) for v, n in pairs):
                rejected.append((s, f"{where} is only a similar name outside the row's neighborhood"))
                continue
            else:
                if namesakes is None:
                    namesakes = self._namesakes(variants, slug, words)
                tier, how = 0, "name-unique"
                rivals = frozenset(camis for camis, place in namesakes.items() if place != _place(rec))
            raw = s
            if tier and contained:
                s = max(s, LIFTED)
            total = (s + (6 if nb_ok else 0) + (4 if street else 0) + (15 if addr_ok else 0)
                     + (1 if ntas and rec.get("nta") == ntas[0] else 0)
                     + (2 if is_recent(rec, self.min_date) else -5) + (3 if names[0] in variants else 0))
            method = (how + ("+neighborhood" if nb_ok else "") + (f"+{street}-street" if street and not addr_ok else "")
                      + ("+url-address" if url_ok else "+notes-address" if notes_ok else ""))
            here = (rec["lat"], rec["lng"]) if rec.get("lat") is not None and rec.get("lng") is not None else None
            near = (2 if here and any(_meters(here, p) <= NEAR_NAMED_M for p in spots)
                    else 1 if rec.get("zipcode") in zips else 0)
            out.append(_Candidate(i, rec, s, raw, tier, total, method, rivals, near))
        if out:
            return out, "", info
        return [], max(rejected, key=lambda t: t[0])[1], info

    def _namesakes(self, variants: list[str], slug: str | None, words: _Words) -> dict[str, str]:
        """Every DOHMH record in NYC (same national-chain status) with this name or a near one that starts the
        same way -> its place. NEPTUNE DINER II is a namesake of 'Neptune Diner'; L'WREN is not one of 'The
        Wren'."""
        pool = self.pools[(None, slug)]
        return {pool.records[r]["camis"]: _place(pool.records[r])
                for r, s in pool.similar(variants, words).items()
                if s >= NAME_ACCEPT and any(_starts_alike(v, n) for v in variants for n in pool.record_names[r])}


def _latest_first(c: _Candidate) -> tuple:
    last = c.rec.get("last_inspection") or ""
    return (last != NOT_INSPECTED, last, int(c.rec["camis"]) if c.rec["camis"].isdigit() else 0)


@dataclass
class Assignment:
    matched: dict[int, _Candidate] = field(default_factory=dict)  # row -> its record
    ambiguous: dict[int, list[_Candidate]] = field(default_factory=dict)  # row -> the records that tie
    lost: dict[int, tuple[_Candidate, int]] = field(default_factory=dict)  # row -> (best record, row that took it)
    shared_name: dict[int, _Candidate] = field(default_factory=dict)  # row -> name-only record with rivals left


def assign_matches(cands: list[_Candidate]) -> Assignment:
    """Give each DOHMH record to at most one row, strongest evidence first, independent of CSV order.

    Every acceptable (row, record) pair is ranked by (tier, total, raw name score, near); pairs are taken
    best first. A row whose best record was already taken falls back to its next one (claimed records
    excluded). When a row's best remaining records tie, the row waits: once weaker claims have taken all
    but one of the tied places it takes that one, otherwise it is ambiguous and takes none. Records that
    tie at one address are one place (a re-permit, a venue's stands): the most recently inspected is taken.
    A name-only match elsewhere (tier 0) is taken only when every other place with that name went to
    another row."""
    by_row: dict[int, list[_Candidate]] = defaultdict(list)
    for c in cands:
        by_row[c.row].append(c)
    order = sorted(cands, key=lambda c: (tuple(-k for k in c.key), c.row, _latest_first(c)))
    a = Assignment()
    claimed: dict[str, int] = {}
    waiting: dict[int, list[_Candidate]] = {}  # row -> its tied records

    def open_(o: _Candidate) -> bool:
        return o.rec["camis"] not in claimed and o.rivals <= claimed.keys()

    def take(tied: list[_Candidate]) -> None:
        pick = max(tied, key=_latest_first)
        a.matched[pick.row] = pick
        claimed[pick.rec["camis"]] = pick.row

    for c in order:
        if c.row in a.matched or c.row in waiting or c.rec["camis"] in claimed:
            continue
        if not open_(c):
            a.shared_name.setdefault(c.row, c)
            continue
        tied = [o for o in by_row[c.row] if o.key == c.key and open_(o)]
        if len({_place(o.rec) for o in tied}) > 1:
            waiting[c.row] = tied
            continue
        take(tied)
    changed = True
    while changed:  # a tie resolves when the other tied places went to other rows
        changed = False
        for row in sorted(waiting, key=lambda r: (tuple(-k for k in waiting[r][0].key), r)):
            left = [o for o in by_row[row] if open_(o)]
            best = max((o.key for o in left), default=None)
            tied = [o for o in left if o.key == best]
            if len({_place(o.rec) for o in tied}) > 1:
                waiting[row] = tied
                continue
            del waiting[row]
            changed = True
            if tied:
                take(tied)
    a.ambiguous = waiting
    for row, cs in by_row.items():  # the records this row could take went to stronger claims
        taken = [c for c in cs if c.rec["camis"] in claimed]
        if row not in a.matched and row not in a.ambiguous and taken:
            best = max(taken, key=lambda c: c.key)
            a.lost[row] = (best, claimed[best.rec["camis"]])
    return a


# ---------------------------------------------------------------------------------------
# Re-permitted restaurants


def _same_brand(a: dict, b: dict) -> bool:
    ka, kb = brand_of(a)[0], brand_of(b)[0]
    if ka and ka == kb:
        return True
    na, nb = norm_name(a.get("dba")), norm_name(b.get("dba"))
    return min(len(na), len(nb)) >= 5 and fuzz.partial_ratio(na, nb) >= 90


def drop_superseded_permits(records: list[dict]) -> tuple[list[dict], list[dict]]:
    """Drop the old permit (CAMIS) of a restaurant that was re-permitted at the same address.

    Same brand (or near-same name) at the same building + street + borough, where the older-numbered
    CAMIS was last inspected before the newer one and the two permits were not issued together.
    Stands that share a venue address (4 Penn Plaza, 620 Atlantic Ave) are issued together and
    inspected on the same day, so they stay. Returns (kept records, report of dropped ones)."""
    by_addr: dict[tuple, list[dict]] = defaultdict(list)
    for r in records:
        if r.get("address") and re.match(r"^\d", r["address"]):
            by_addr[(norm_name(r["address"]), r["borough"])].append(r)
    dropped: dict[str, dict] = {}
    for group in by_addr.values():
        if len(group) < 2:
            continue
        group = sorted(group, key=lambda r: int(r["camis"]) if r["camis"].isdigit() else 0)
        for i, old in enumerate(group):
            for new in group[i + 1:]:
                if not (old["camis"].isdigit() and new["camis"].isdigit()):
                    continue
                issued_apart = int(new["camis"]) - int(old["camis"]) > SAME_ISSUE_CAMIS_GAP
                last_old, last_new = old.get("last_inspection"), new.get("last_inspection")
                inspected_before = bool(last_old and last_new) and NOT_INSPECTED not in (last_old, last_new) \
                    and last_old < last_new
                if issued_apart and inspected_before and _same_brand(old, new):
                    dropped[old["camis"]] = {"dropped": old["camis"], "kept": new["camis"], "dba": old["dba"],
                                             "address": old["address"], "borough": old["borough"],
                                             "last_inspection": old.get("last_inspection")}
                    break
    return [r for r in records if r["camis"] not in dropped], list(dropped.values())


# ---------------------------------------------------------------------------------------
# Assembly


def _national_slug(rec: dict) -> str | None:
    nd = is_national_chain(rec)
    return nd.slug if nd else None


def build_restaurants(
    csv_rows: list[dict],
    dohmh_rows: list[dict],
    nta_map: dict[str, dict],
    *,
    cuisines: Iterable[str] = config.DEFAULT_CUISINES,
    min_date: str = config.DEFAULT_MIN_INSPECTION,
    national_chains: str = config.DEFAULT_NATIONAL_CHAINS,
    overrides: list[dict] | None = None,
    menu_urls: Mapping[str, dict] | None = None,
) -> tuple[list[dict], dict]:
    """CSV rows first (CSV order, merged with their DOHMH match), then in-scope DOHMH records.
    overrides: hand-checked DOHMH record fixes (load_dohmh_overrides), applied before matching.
    menu_urls: hand-checked menu pages per restaurant key (load_menu_url_overrides), applied last.
    national_chains='exclude' drops national chains (McDonald's, Shake Shack...) after matching.

    A pilot row only matches a DOHMH record of the same national chain, or (for everything else)
    a record that is not a national chain: 'Shake Shack (Madison Square Park)' can't take the
    CAMIS of the local MADISON SQUARE, and a local row can't take a McDonald's permit.

    Raises ScopeError when a requested cuisine is no DOHMH cuisine_description ('Steakhouses')."""
    requested = [c.strip() for c in cuisines if c.strip()]
    cuisines = {c.lower() for c in requested}
    latest, fixed = apply_dohmh_overrides(latest_per_camis(dohmh_rows), overrides or [])
    zip_nta = zip_to_nta(latest)
    records = [r for r in (normalize_dohmh(x, nta_map, zip_nta) for x in latest) if r]
    known = sorted({r["cuisine"] for r in records if r["cuisine"]})
    known_lower = {k.lower() for k in known}
    unknown = [c for c in requested if c.lower() not in known_lower] if records else []
    if unknown:
        hints = [f"{c!r} (did you mean {', '.join(repr(m) for m in close)}?)" if close else repr(c)
                 for c in unknown for close in [difflib.get_close_matches(c, known, n=2, cutoff=0.6)]]
        raise ScopeError(f"--cuisines: no DOHMH restaurant has cuisine {', '.join(hints)}; "
                         "values must match cuisine_description exactly (case-insensitive)")
    records, repermits = drop_superseded_permits(records)
    matcher = Matcher(records, nta_map, min_date)
    found = [matcher.candidates(i, row) for i, row in enumerate(csv_rows)]
    assigned = assign_matches([c for cands, _, _ in found for c in cands])

    report: dict[str, Any] = {
        "csv_rows": len(csv_rows), "csv_matched": 0, "csv_unmatched": [], "csv_duplicate_matches": [],
        "csv_ambiguous": [], "csv_stale_matches": [], "csv_address_now_other_business": [],
        "dohmh_records": len(records), "dohmh_dropped_boro": len(latest) - len(records) - len(repermits),
        "dohmh_superseded_permits": repermits,
        "dohmh_overrides_applied": fixed["applied"], "dohmh_overrides_unused": fixed["unused"],
    }
    out: list[dict] = []
    seen: set[str] = set()
    keys: set[str] = set()
    for i, row in enumerate(csv_rows):
        c = assigned.matched.get(i)
        if c is not None:
            rec = c.rec
            r = dict(rec)
            if not r["nta"]:  # DOHMH record without NTA/zip: fall back to the CSV neighborhood
                nta = neighborhood_to_nta(row["neighborhood"], row["borough"], nta_map)
                if nta:
                    r.update(nta=nta, neighborhood=nta_map[nta]["name"], nta_source="csv-neighborhood")
            method = c.method
            if any(o.key[:3] == c.key[:3] and o.near < c.near and _place(o.rec) != _place(rec) for o in found[i][0]):
                method += f"+{c.tiebreak}"  # it tied with another place on everything else
            r.update(
                name=list_display_name(row["name"]), website=row["website"], menu_url=row["menu_url"], csv=True,
                csv_name=row["name"], csv_neighborhood=row["neighborhood"], csv_notes=row["notes"],
                csv_row=row["row"], match={"score": round(c.score, 1), "method": method, "dba": rec["dba"]},
            )
            seen.add(rec["camis"])
            report["csv_matched"] += 1
            last = rec.get("last_inspection")
            if last and last != NOT_INSPECTED and last < min_date:  # flagged, not dropped: it may still be open
                report["csv_stale_matches"].append({"row": row["row"], "name": row["name"], "camis": rec["camis"],
                                                    "dba": rec["dba"], "last_inspection": last})
        else:
            _, why, info = found[i]
            if i in assigned.ambiguous:
                tied = assigned.ambiguous[i]
                report["csv_ambiguous"].append({"row": row["row"], "name": row["name"],
                                                "candidates": [_describe(o.rec) for o in tied]})
                why = f"ambiguous: {len(tied)} records tie"
            elif i in assigned.lost:
                best, first = assigned.lost[i]
                report["csv_duplicate_matches"].append({"row": row["row"], "name": row["name"],
                                                        "camis": best.rec["camis"], "first_row": csv_rows[first]["row"]})
                why = "duplicate match"
            elif i in assigned.shared_name:
                c = assigned.shared_name[i]
                why = (f"{c.rec['dba']!r} ({c.rec.get('address')}, {c.rec.get('neighborhood')}) is only a name match "
                       f"outside the row's neighborhood, and {len(c.rivals)} other place(s) in NYC have that name")
            elif info["at_address"]:  # the address the row names now holds another business
                report["csv_address_now_other_business"].append({
                    "row": row["row"], "name": row["name"], "address": "; ".join(info["named"]),
                    "now": [f"{d['dba']} ({d['camis']})" for d in info["at_address"]]})
            nta = neighborhood_to_nta(row["neighborhood"], row["borough"], nta_map) or next(
                (x for h in _paren_hints(row["name"])[1] for x in neighborhood_ntas(h, row["borough"], nta_map)), None)
            key = f"csv:{slugify(row['name'])}-{slugify(row['borough'])}"
            if key in keys:  # same name and borough as an earlier row: keep keys (and results) apart
                key = f"{key}-{slugify(row['neighborhood']) or 'row'}-{row['row']}"
            r = {
                "key": key,
                "camis": None, "dba": None, "name": list_display_name(row["name"]), "address": None, "borough": row["borough"],
                "zipcode": None, "lat": None, "lng": None, "nta": nta,
                "neighborhood": nta_map[nta]["name"] if nta else row["neighborhood"],
                "nta_source": "csv-neighborhood" if nta else None,
                "cuisine": None, "last_inspection": None, "website": row["website"], "menu_url": row["menu_url"],
                "csv": True, "csv_name": row["name"], "csv_neighborhood": row["neighborhood"], "csv_notes": row["notes"],
                "csv_row": row["row"], "match": None,
            }
            report["csv_unmatched"].append({"row": row["row"], "name": row["name"], "why": why})
        keys.add(r["key"])
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
    if national_chains == "exclude":
        dropped: Counter = Counter()
        kept = []
        for r in out:
            nd = is_national_chain(r)
            if nd is None:
                kept.append(r)
            else:
                dropped[nd.display] += 1
        out = kept
        report["national_chains_excluded"] = dict(sorted(dropped.items(), key=lambda kv: (-kv[1], kv[0])))
    out, menu_fixed = apply_menu_url_overrides(out, menu_urls or {})
    report["menu_url_overrides_applied"] = menu_fixed["applied"]
    report["menu_url_overrides_unused"] = menu_fixed["unused"]
    report["no_neighborhood"] = sum(1 for r in out if not r["neighborhood"])
    report["restaurants"] = len(out)
    dupes = [k for k, n in Counter(r["key"] for r in out).items() if n > 1]
    if dupes:  # results are keyed by restaurant key: a shared key would publish one's menu for both
        raise ValueError(f"duplicate restaurant keys: {dupes[:5]}")
    return out, report


def load_restaurants(
    *,
    cuisines: Iterable[str] = config.DEFAULT_CUISINES,
    min_date: str = config.DEFAULT_MIN_INSPECTION,
    national_chains: str = config.DEFAULT_NATIONAL_CHAINS,
    cache_dir: Path = config.CACHE_DIR,
    csv_path: Path = config.RESTAURANT_LIST_CSV,
    nta_path: Path = config.NTA_PATH,
    overrides_path: Path = DOHMH_OVERRIDES_PATH,
    menu_urls_path: Path | None = None,  # default MENU_URLS_PATH (looked up at call time, so tests can point it away)
    refresh: bool = False,
    offline: bool = False,
    write_to: Path | None = config.RESTAURANTS_PATH,
) -> tuple[list[dict], dict]:
    cuisines = list(cuisines)
    snap = load_dohmh_snapshot(cache_dir, refresh=refresh, offline=offline)
    restaurants, report = build_restaurants(
        load_csv(csv_path), snap["rows"], load_nta_map(nta_path), cuisines=cuisines, min_date=min_date,
        national_chains=national_chains, overrides=load_dohmh_overrides(overrides_path),
        menu_urls=load_menu_url_overrides(menu_urls_path or MENU_URLS_PATH),
    )
    report["dohmh_fetched_at"] = snap.get("fetched_at")
    meta = {"cuisines": cuisines, "min_inspection_date": min_date, "national_chains": national_chains,
            "restaurant_list": Path(csv_path).name,
            "dohmh_fetched_at": snap.get("fetched_at")}
    if write_to is not None:
        _write_json_atomic(Path(write_to), {"meta": meta, "report": report, "restaurants": restaurants}, indent=1)
    return restaurants, report
