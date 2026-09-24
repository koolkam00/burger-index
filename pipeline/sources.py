"""Restaurant universe: the restaurant list CSV, matched to NYC DOHMH inspections + 2010 NTA names.

Everything here is free (NYC Open Data / Socrata, no key). The DOHMH snapshot is cached
under data/cache/socrata/ so builds are offline-reproducible; the NTA code -> name
mapping is committed at pipeline/data/nta_2010.json.
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
from pathlib import Path
from typing import Any

from rapidfuzz import fuzz, process

from . import config
from .chains import brand_of, is_national_chain
from .names import (
    address_in_text, address_tokens, at_address, display_case, display_name, named_addresses, norm_name, slugify,
    strip_store_number,
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
    ("Manhattan", "chelsea"): ("MN13", "MN17"),
    ("Manhattan", "flatiron"): ("MN13",),
    ("Manhattan", "nomad"): ("MN13", "MN17"),
    ("Manhattan", "nolita"): ("MN24",),
    ("Manhattan", "noho"): ("MN23", "MN22"),
    ("Manhattan", "east village"): ("MN22", "MN28"),
    ("Manhattan", "lower east side"): ("MN27", "MN28"),
    ("Manhattan", "les"): ("MN27", "MN28"),
    ("Manhattan", "financial district"): ("MN25",),
    ("Manhattan", "fidi"): ("MN25",),
    ("Manhattan", "hells kitchen"): ("MN15", "MN17"),
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
    ("Brooklyn", "bed stuy"): ("BK75", "BK35"),
    ("Brooklyn", "bedford stuyvesant"): ("BK75", "BK35"),
    ("Brooklyn", "cobble hill"): ("BK09", "BK38", "BK33"),
    ("Brooklyn", "carroll gardens"): ("BK33", "BK38"),
    ("Brooklyn", "boerum hill"): ("BK38",),
    ("Brooklyn", "williamsburg"): ("BK73", "BK72", "BK90"),
    ("Brooklyn", "flatbush"): ("BK42", "BK60"),
    ("Bronx", "throggs neck"): ("BX52",),
    ("Bronx", "throgs neck"): ("BX52",),
    ("Bronx", "fordham"): ("BX40", "BX05"),
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
}
_BOROUGH_WORDS = frozenset({"manhattan", "brooklyn", "queens", "bronx", "the bronx", "staten island", "nyc",
                            "new york", "new york city"})

# 2010 NTA names that mislead today, shown as current usage. MN27 'Chinatown' also covers the
# Lower East Side west of Essex (Orchard, Ludlow, Eldridge); MN28 'Lower East Side' is the LES
# east of Essex plus Alphabet City (Avenues B-D); BK73 'North Side-South Side' is what everyone
# calls Williamsburg, and BK72 'Williamsburg' is South Williamsburg.
NTA_DISPLAY_OVERRIDES = {
    "MN27": "Chinatown-Lower East Side",
    "MN28": "Lower East Side-Alphabet City",
    "BK72": "South Williamsburg",
    "BK73": "Williamsburg",
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
# Office', THE JUNCTION is not 'The Junction Bar') and don't count as the word a renamed restaurant shares with
# its row. Any word in COMMON_WORD_DF or more DOHMH names is common too (Matcher.df).
COMMON_NAME_WORDS = GENERIC_NAME_WORDS | {
    "spring", "bedford", "office", "junction", "burger", "burgers", "hamburger", "hamburgers", "beer", "pizza",
    "chicken", "wings", "house", "hall", "club", "room", "social", "park", "corner", "square", "street", "avenue",
    "new", "york", "city", "village", "hill", "heights", "brooklyn", "queens", "bronx", "manhattan", "island",
    "american", "little", "big", "blue", "black", "golden", "royal", "king", "famous", "original", "classic", "best",
    "good", "great", "fresh", "express", "deli", "shop", "market", "garden", "food", "coffee", "bakery", "juice",
    "tea", "sushi", "taco", "tacos", "bbq", "steak", "prime", "smash", "craft", "brewery", "brewing", "cocktail",
}
COMMON_WORD_DF = 10
NAME_ACCEPT = 86.0  # a name this similar is the same restaurant, when the location agrees
NAME_AT_ADDRESS = 80.0  # ...and this similar is enough at the address the row names
LIFTED = 82.0  # a multi-word name contained in the other, confirmed by the location


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


def _record_names(dba: str) -> list[str]:
    """Normalized names of a DOHMH record: the dba, without store numbers, and each part of a combined dba
    ('ACME / THE NINES', 'THE HIGH NOTE / POPCHEW', 'THOMPSON NEW YORK HOTEL (Burger Joint)')."""
    parts = [dba, strip_store_number(dba)]
    if "/" in dba:
        parts += [strip_store_number(p) for p in dba.split("/")]
    parts += re.findall(r"\(([^)]*)\)", dba)
    names = (_strip_city(norm_name(p)) for p in parts)
    return [n for n in dict.fromkeys(names) if len(n.replace(" ", "")) >= 2]


def _strip_city(n: str) -> str:
    return re.sub(r"\s+(nyc|ny|new york)$", "", n)


def _core(n: str) -> str:
    return " ".join(w for w in n.split() if w not in GENERIC_NAME_WORDS)


def _compact(n: str) -> str:
    return n.replace(" ", "")


def _sim(a: str, b: str) -> float:
    return max(fuzz.token_sort_ratio(a, b), fuzz.ratio(_compact(a), _compact(b)))


def _is_common(word: str, df: Mapping[str, int] | None = None) -> bool:
    return word in COMMON_NAME_WORDS or len(word) <= 2 or (df is not None and df.get(word, 0) >= COMMON_WORD_DF)


def _words_in_order(short: list[str], long: list[str]) -> bool:
    rest = iter(long)
    return all(w in rest for w in short)


def _cores(a: str, b: str) -> tuple[str, str]:
    """Both names without generic words, or both whole (minus a leading 'the') when that leaves too little."""
    ca, cb = _core(a), _core(b)
    if len(_compact(ca)) < 3 or len(_compact(cb)) < 3:
        return re.sub(r"^the ", "", a), re.sub(r"^the ", "", b)
    return ca, cb


def name_score(a: str, b: str, df: Mapping[str, int] | None = None) -> float:
    """How alike two normalized names are, 0-100, compared without generic words (bar, restaurant, the...).

    max(token_sort_ratio, ratio ignoring spaces), lifted to 90 when one multi-word name starts the other or
    runs through it word by word from the same first word ('peter luger' / 'peter luger steak house',
    'benjamin prime' / 'benjamin steakhouse prime'). Containment anywhere else doesn't count ('burgers and
    beer' is not 'black tap craft burgers and beer', 'american bar' is not "guy fieris american kitchen and
    bar"), and a match that rests on one ordinary word is kept below the accept line ('spring cafe' /
    'spring', 'the junction bar' / 'the junction'). Identical names always score 100."""
    if _compact(a) == _compact(b):
        return 100.0
    ca, cb = _cores(a, b)
    s = _sim(ca, cb)
    ws, wl = sorted((ca.split(), cb.split()), key=len)
    if len(ws) == 1 and _is_common(ws[0], df):
        s = min(s, NAME_AT_ADDRESS - 1)
    if len(ws) >= 2 and len(" ".join(ws)) >= 8 and ws[0] == wl[0] and _words_in_order(ws, wl):
        s = max(s, 90.0)
    return s


def _contained(a: str, b: str) -> bool:
    """One name's words (two or more, generic words aside) all appear in the other: 'blue collar' in
    'blue collar burger'. The shorter name alone isn't enough evidence; the location has to agree."""
    ca, cb = _cores(a, b)
    ws, wl = sorted((ca.split(), cb.split()), key=len)
    return len(ws) >= 2 and set(ws) <= set(wl)


def _same_name(a: str, b: str, df: Mapping[str, int] | None = None) -> bool:
    """The same name, spacing, punctuation and generic words aside ('pj bradys bar and restaurant' /
    'p j bradys tavern', 'the nines' / 'nines'), and more than one ordinary word ('spring' / 'spring')."""
    ca, cb = _cores(a, b)
    if _compact(ca) != _compact(cb) and _compact(a) != _compact(b):
        return False
    words = ca.split()
    return len(words) >= 2 or not _is_common(words[0], df)


def _shares_word(a: str, b: str) -> bool:
    """A renamed or company-registered restaurant at the row's address still shares a real word with it:
    'Holy Cow' / HOLY BURGER, 'Cask Bar & Kitchen' / CASK, 'Popchew Burger' / THE HIGH NOTE / POPCHEW, or an
    initialism ('SI Diner' / STATEN ISLAND DINER)."""
    wa, wb = a.split(), b.split()
    if {w for w in wa if len(w) >= 3 and w not in COMMON_NAME_WORDS} & set(wb):
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


@dataclass
class _Pool:
    """DOHMH records a row may match: one borough (or all of NYC) and one national-chain status."""

    records: list[dict] = field(default_factory=list)
    names: list[str] = field(default_factory=list)  # every record name, flattened
    owner: list[int] = field(default_factory=list)  # names[i] belongs to records[owner[i]]
    record_names: list[list[str]] = field(default_factory=list)
    by_address: dict[tuple[str, ...], list[int]] = field(default_factory=lambda: defaultdict(list))

    def add(self, rec: dict) -> None:
        i = len(self.records)
        self.records.append(rec)
        rn = _record_names(rec["dba"])
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

    def similar(self, variants: list[str], df: Mapping[str, int]) -> dict[int, float]:
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
        return {r: max(name_score(v, n, df) for v in variants for n in self.record_names[r])
                for r in {self.owner[i] for i in idx}}

    def at(self, key: list[str]) -> list[int]:
        return [i for i in self.by_address.get(tuple(key[:2]), []) if at_address(self.records[i].get("address"), key)]


@dataclass
class _Candidate:
    row: int  # index into csv_rows
    rec: dict
    score: float  # name score
    tier: int  # 2 at the address the row names, 1 in its neighborhood, 0 a unique name elsewhere
    total: float  # ranks candidates within a tier
    method: str

    @property
    def key(self) -> tuple[int, float]:
        return self.tier, round(self.total, 1)


def _describe(rec: dict) -> dict:
    return {"camis": rec["camis"], "dba": rec["dba"], "address": rec.get("address"),
            "neighborhood": rec.get("neighborhood")}


class Matcher:
    """Scores restaurant-list rows against DOHMH records (same borough, same national-chain status).

    A candidate is accepted when the location agrees and the name is close enough:
    - tier 2: at an address the row's notes or URLs name (a renamed restaurant or one registered under a
      company name counts when it still shares a real word with the row: 'Holy Cow' / HOLY BURGER);
    - tier 1: in one of the row's neighborhood NTAs (its CSV neighborhood and parenthetical hints) with a
      name score >= NAME_ACCEPT, or a multi-word name contained in the other;
    - tier 0: elsewhere in the borough only when the name is the same and no other DOHMH record in NYC has
      it (a one-location restaurant whose CSV neighborhood is off), and never a not-yet-inspected permit.
    A row that names an address never matches a record somewhere else."""

    def __init__(self, records: list[dict], nta_map: dict[str, dict], min_date: str):
        self.nta_map, self.min_date = nta_map, min_date
        self.df = Counter(w for r in records for w in set(norm_name(r["dba"]).split()))
        self.pools: dict[tuple[str | None, str | None], _Pool] = defaultdict(_Pool)
        for r in records:
            slug = _national_slug(r)
            self.pools[(r["borough"], slug)].add(r)
            self.pools[(None, slug)].add(r)  # all of NYC: is a name unique?
        for p in self.pools.values():
            p.finish()

    def row_ntas(self, row: dict) -> set[str]:
        codes = set(neighborhood_ntas(row.get("neighborhood"), row["borough"], self.nta_map))
        for hint in _paren_hints(row["name"])[1]:
            codes.update(neighborhood_ntas(hint, row["borough"], self.nta_map))
        return codes

    def candidates(self, i: int, row: dict) -> tuple[list[_Candidate], str, dict]:
        """(accepted candidates, why none was when empty, {'named': [...], 'at_address': [...]})."""
        slug = _national_slug({"csv_name": row["name"], "name": row["name"]})
        pool = self.pools.get((row["borough"], slug))
        info: dict[str, Any] = {"named": [], "at_address": []}
        if pool is None:
            return [], "no candidates", info
        ntas = self.row_ntas(row)
        places = {seg for c in ntas for seg in self.nta_map[c]["name"].split("-")}
        variants = _name_variants(row, sorted(places, key=len, reverse=True))
        urls = " ".join(filter(None, (row.get("website"), row.get("menu_url"))))
        notes = row.get("notes") or ""
        named_notes, named_urls = named_addresses(notes), named_addresses(urls)
        named = named_notes + [k for k in named_urls if k not in named_notes]
        info["named"] = [" ".join(k) for k in named]
        scores = pool.similar(variants, self.df)
        for key in named:
            for r in pool.at(key):
                info["at_address"].append(_describe(pool.records[r]))
                if r not in scores:
                    scores[r] = max(name_score(v, n, self.df) for v in variants for n in pool.record_names[r])
        if not scores:
            return [], "no similar name", info
        out: list[_Candidate] = []
        rejected: list[tuple[float, str]] = []
        for r, s in scores.items():
            rec, names = pool.records[r], pool.record_names[r]
            pairs = [(v, n) for v in variants for n in names]
            nb_ok = bool(rec.get("nta")) and rec["nta"] in ntas
            url_ok = _address_in_urls(rec, urls.lower()) or any(at_address(rec.get("address"), k) for k in named_urls)
            notes_ok = address_in_text(rec.get("address"), notes) or any(at_address(rec.get("address"), k)
                                                                         for k in named_notes)
            addr_ok = url_ok or notes_ok
            contained = any(_contained(v, n) for v, n in pairs)
            where = f"{rec['dba']!r} ({rec.get('address')}, {rec.get('neighborhood')})"
            if addr_ok and (s >= NAME_AT_ADDRESS or contained or any(_shares_word(v, n) for v, n in pairs)):
                tier, how = 2, ("name" if s >= NAME_AT_ADDRESS or contained else "name-word")
            elif named and not addr_ok:
                rejected.append((s, f"{where} is not at the address the row names ({'; '.join(info['named'])})"))
                continue
            elif nb_ok and (s >= NAME_ACCEPT or contained):
                tier, how = 1, "name"
                s = max(s, LIFTED)
            elif nb_ok or s < NAME_ACCEPT:
                rejected.append((s, f"best candidate {rec['dba']!r} scored {s:.0f}"))
                continue
            elif rec.get("last_inspection") in (None, NOT_INSPECTED):
                rejected.append((s, f"{where} is outside the row's neighborhood and not yet inspected"))
                continue
            elif not any(_same_name(v, n, self.df) for v, n in pairs) or not self._unique(variants, slug):
                rejected.append((s, f"{where} is only a name match outside the row's neighborhood"))
                continue
            else:
                tier, how = 0, "name-unique"
            total = (s + (6 if nb_ok else 0) + (15 if addr_ok else 0) + (2 if is_recent(rec, self.min_date) else -5)
                     + (3 if any(v == n for v, n in pairs) else 0))
            method = how + ("+neighborhood" if nb_ok else "") + ("+url-address" if url_ok else "") + (
                "+notes-address" if notes_ok and not url_ok else "")
            out.append(_Candidate(i, rec, s, tier, total, method))
        if out:
            return out, "", info
        best = max(rejected, key=lambda t: t[0])
        return [], best[1], info

    def _unique(self, variants: list[str], slug: str | None) -> bool:
        """Exactly one DOHMH record in NYC (same national-chain status) has this name or a near one."""
        return sum(1 for s in self.pools[(None, slug)].similar(variants, self.df).values() if s >= NAME_ACCEPT) == 1


def assign_matches(cands: list[_Candidate]) -> tuple[dict[int, _Candidate], dict[int, list[_Candidate]],
                                                     dict[int, tuple[_Candidate, int]]]:
    """Give each DOHMH record to at most one row, strongest evidence first, independent of CSV order.

    Every (row, record) pair is ranked by (tier, total); pairs are taken best first. A row whose best
    record was already taken falls back to its next one (claimed records excluded). When a row's best
    remaining records tie, it is ambiguous: none is taken for it. Returns (row -> match, row -> tied
    candidates, row -> (best candidate, the row that took it)) for rows left without a record."""
    by_row: dict[int, list[_Candidate]] = defaultdict(list)
    for c in cands:
        by_row[c.row].append(c)
    order = sorted(cands, key=lambda c: (-c.tier, -c.total, c.row, int(c.rec["camis"]) if c.rec["camis"].isdigit()
                                         else 0))
    claimed: dict[str, int] = {}
    matched: dict[int, _Candidate] = {}
    ambiguous: dict[int, list[_Candidate]] = {}
    for c in order:
        if c.row in matched or c.row in ambiguous or c.rec["camis"] in claimed:
            continue
        tied = [o for o in by_row[c.row] if o.key == c.key and o.rec["camis"] not in claimed]
        if len(tied) > 1:
            ambiguous[c.row] = tied
            continue
        matched[c.row] = c
        claimed[c.rec["camis"]] = c.row
    lost: dict[int, tuple[_Candidate, int]] = {}
    for row, cs in by_row.items():  # every record this row could take went to a stronger claim
        if row not in matched and row not in ambiguous:
            best = min(cs, key=lambda c: (-c.tier, -c.total))
            lost[row] = (best, claimed[best.rec["camis"]])
    return matched, ambiguous, lost


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
) -> tuple[list[dict], dict]:
    """CSV rows first (CSV order, merged with their DOHMH match), then in-scope DOHMH records.
    national_chains='exclude' drops national chains (McDonald's, Shake Shack...) after matching.

    A pilot row only matches a DOHMH record of the same national chain, or (for everything else)
    a record that is not a national chain: 'Shake Shack (Madison Square Park)' can't take the
    CAMIS of the local MADISON SQUARE, and a local row can't take a McDonald's permit.

    Raises ScopeError when a requested cuisine is no DOHMH cuisine_description ('Steakhouses')."""
    requested = [c.strip() for c in cuisines if c.strip()]
    cuisines = {c.lower() for c in requested}
    latest = latest_per_camis(dohmh_rows)
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
    matched, ambiguous, lost = assign_matches([c for cands, _, _ in found for c in cands])

    report: dict[str, Any] = {
        "csv_rows": len(csv_rows), "csv_matched": 0, "csv_unmatched": [], "csv_duplicate_matches": [],
        "csv_ambiguous": [], "csv_stale_matches": [], "csv_address_now_other_business": [],
        "dohmh_records": len(records), "dohmh_dropped_boro": len(latest) - len(records) - len(repermits),
        "dohmh_superseded_permits": repermits,
    }
    out: list[dict] = []
    seen: set[str] = set()
    keys: set[str] = set()
    for i, row in enumerate(csv_rows):
        c = matched.get(i)
        if c is not None:
            rec = c.rec
            r = dict(rec)
            if not r["nta"]:  # DOHMH record without NTA/zip: fall back to the CSV neighborhood
                nta = neighborhood_to_nta(row["neighborhood"], row["borough"], nta_map)
                if nta:
                    r.update(nta=nta, neighborhood=nta_map[nta]["name"], nta_source="csv-neighborhood")
            r.update(
                name=row["name"], website=row["website"], menu_url=row["menu_url"], csv=True,
                csv_name=row["name"], csv_neighborhood=row["neighborhood"], csv_notes=row["notes"],
                csv_row=row["row"], match={"score": round(c.score, 1), "method": c.method, "dba": rec["dba"]},
            )
            seen.add(rec["camis"])
            report["csv_matched"] += 1
            last = rec.get("last_inspection")
            if last and last != NOT_INSPECTED and last < min_date:  # flagged, not dropped: it may still be open
                report["csv_stale_matches"].append({"row": row["row"], "name": row["name"], "camis": rec["camis"],
                                                    "dba": rec["dba"], "last_inspection": last})
        else:
            _, why, info = found[i]
            if i in ambiguous:
                tied = ambiguous[i]
                report["csv_ambiguous"].append({"row": row["row"], "name": row["name"],
                                                "candidates": [_describe(o.rec) for o in tied]})
                why = f"ambiguous: {len(tied)} records tie"
            elif i in lost:
                best, first = lost[i]
                report["csv_duplicate_matches"].append({"row": row["row"], "name": row["name"],
                                                        "camis": best.rec["camis"], "first_row": csv_rows[first]["row"]})
                why = "duplicate match"
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
                "camis": None, "dba": None, "name": row["name"], "address": None, "borough": row["borough"],
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
    refresh: bool = False,
    offline: bool = False,
    write_to: Path | None = config.RESTAURANTS_PATH,
) -> tuple[list[dict], dict]:
    cuisines = list(cuisines)
    snap = load_dohmh_snapshot(cache_dir, refresh=refresh, offline=offline)
    restaurants, report = build_restaurants(
        load_csv(csv_path), snap["rows"], load_nta_map(nta_path), cuisines=cuisines, min_date=min_date,
        national_chains=national_chains,
    )
    report["dohmh_fetched_at"] = snap.get("fetched_at")
    meta = {"cuisines": cuisines, "min_inspection_date": min_date, "national_chains": national_chains,
            "restaurant_list": Path(csv_path).name,
            "dohmh_fetched_at": snap.get("fetched_at")}
    if write_to is not None:
        _write_json_atomic(Path(write_to), {"meta": meta, "report": report, "restaurants": restaurants}, indent=1)
    return restaurants, report
