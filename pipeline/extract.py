"""Post-processing of the scrape JSON extraction: clean, validate, dedupe, classify.

Lunch vs dinner: a burger listed on several menus keeps its dinner / all-day price;
late-night, lunch, brunch and "other" prices are used only (in that order) when the burger
is not on the dinner menu; happy-hour prices last; kids'-menu items are dropped.
"""

from __future__ import annotations

import re
from typing import Any

from . import config
from .context_client import PROTEINS
from .names import display_case, norm_name

PERIOD_PRIORITY = {None: 0, "all_day": 0, "dinner": 0, "late_night": 1, "lunch": 2, "brunch": 3, "other": 4,
                   "happy_hour": 5}
PROTEIN_SYNONYMS = {
    "vegetarian": "veggie", "vegan": "veggie", "plant": "veggie", "plant-based": "veggie", "plant based": "veggie",
    "impossible": "veggie", "beyond": "veggie", "vegetable": "veggie", "salmon": "fish", "tuna": "fish",
    "seafood": "fish", "shrimp": "fish", "crab": "fish", "bison": "other", "elk": "other", "venison": "other",
    "wagyu": "beef", "steak": "beef", "short rib": "beef", "brisket": "beef", "poultry": "chicken",
}
# Strong signals in the item NAME that override a 'beef' label (only when the name has no 'beef').
NAME_PROTEIN_OVERRIDES = (
    (re.compile(r"\b(impossible|beyond|veggie|vegan|vegetarian|black bean|plant[- ]based|falafel|tofu)\b"), "veggie"),
    (re.compile(r"\b(chicken)\b"), "chicken"),
    (re.compile(r"\b(turkey)\b"), "turkey"),
    (re.compile(r"\b(salmon|tuna|fish|crab|shrimp|lobster|cod)\b"), "fish"),
    (re.compile(r"\b(lamb)\b"), "lamb"),
    (re.compile(r"\b(pork)\b"), "pork"),
    (re.compile(r"\b(bison|elk|venison|buffalo burger)\b"), "other"),
)
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F900-\U0001F9FF\U00002B00-\U00002BFF️‍]+"
)


def coerce_price(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
    else:
        s = str(v).strip().lower()
        if not s or "market" in s or s in ("mp", "m.p.", "n/a", "na"):
            return None
        m = re.search(r"\d+(?:[.,]\d{1,2})?", s)
        if not m:
            return None
        f = float(m.group(0).replace(",", "."))
    if f != f or f <= 0:  # NaN / zero / negative
        return None
    return round(f, 2)


def clean_name(name: Any, price: float | None = None) -> str:
    s = str(name or "")
    s = _EMOJI_RE.sub("", s)
    s = re.sub(r"[®™©℠]", "", s)
    s = re.sub(r"[*_`#]+", "", s)  # markdown emphasis
    s = re.sub(r"^\s*(?:[-•·*]|\d+[.)])\s+", "", s)  # bullets / "1. "
    s = re.sub(r"\s+", " ", s).strip()
    # trailing "$12", "- $12.50", "| 12"
    s = re.sub(r"\s*[-–—:|·,]?\s*\$\s*\d+(?:[.,]\d{1,2})?\s*$", "", s)
    if price is not None:
        m = re.search(r"\s*[-–—:|·,]?\s*(\d+(?:\.\d{1,2})?)\s*$", s)
        if m and abs(float(m.group(1)) - price) < 0.01 and m.start() > 0:
            s = s[: m.start()]
    s = s.strip(" -–—:|·,.")
    if s and s.isupper() and len(s) > 3:
        s = display_case(s)
    return s


def normalize_protein(value: Any, name: str, description: str | None) -> str:
    p = str(value or "").strip().lower()
    p = PROTEIN_SYNONYMS.get(p, p)
    if p not in PROTEINS:
        p = "beef"  # the schema default for a burger with no stated patty
    n = norm_name(name)
    if p == "beef" and "beef" not in n:
        for rx, prot in NAME_PROTEIN_OVERRIDES:
            if rx.search(n):
                return prot
    return p


def normalize_period(v: Any) -> str | None:
    p = str(v or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not p or p in ("null", "none"):
        return None
    if p in PERIOD_PRIORITY or p == "kids":
        return p
    if "kid" in p or "child" in p:
        return "kids"
    if "happy" in p:
        return "happy_hour"
    for k in ("dinner", "lunch", "brunch"):
        if k in p:
            return k
    if "late" in p or "night" in p:
        return "late_night"
    if "all" in p:
        return "all_day"
    return "other"


def normalize_menu(data: Any) -> dict:
    """Extraction JSON -> {is_menu, has_prices, restaurant_name, location, burgers[], notes[]}.

    burgers: [{name, price, description, protein, menu_period}] in page order, deduped.
    """
    data = data if isinstance(data, dict) else {}
    notes: list[str] = []
    items: list[dict] = []
    for raw in data.get("burgers") or []:
        if not isinstance(raw, dict):
            continue
        price = coerce_price(raw.get("price"))
        name = clean_name(raw.get("name"), price)
        if not name:
            continue
        period = normalize_period(raw.get("menu_period"))
        if period == "kids" or re.search(r"\b(kid|kids|kiddie|child|childrens)\b", norm_name(name)):
            continue
        if price is not None and not (config.PRICE_MIN <= price <= config.PRICE_MAX):
            notes.append(f"dropped suspect price ${price:g} for '{name}'")
            price = None
        desc = raw.get("description")
        desc = re.sub(r"\s+", " ", str(desc)).strip()[:500] if desc else None
        items.append({
            "name": name,
            "price": price,
            "description": desc or None,
            "protein": normalize_protein(raw.get("protein"), name, desc),
            "menu_period": period,
        })

    # One entry per burger name: best menu period with a price wins (dinner > lunch ...).
    best: dict[str, int] = {}
    for i, it in enumerate(items):
        k = norm_name(it["name"])
        j = best.get(k)
        if j is None:
            best[k] = i
            continue
        cur = items[j]
        rank_new = (it["price"] is None, PERIOD_PRIORITY.get(it["menu_period"], 4), it["price"] or 0)
        rank_cur = (cur["price"] is None, PERIOD_PRIORITY.get(cur["menu_period"], 4), cur["price"] or 0)
        if rank_new < rank_cur:
            best[k] = i
    # Duplicates across sections ("Popular" + "Burgers") and menus collapse silently.
    burgers = [items[i] for i in sorted(best.values())]
    return {
        "is_menu": bool(data.get("is_menu")) or bool(burgers),
        "has_prices": bool(data.get("has_prices")),
        "restaurant_name": (str(data.get("restaurant_name")).strip() or None) if data.get("restaurant_name") else None,
        "location": (str(data.get("location")).strip() or None) if data.get("location") else None,
        "burgers": burgers,
        "notes": list(dict.fromkeys(notes)),
    }


def classify_menu(menu: dict) -> str:
    """priced | nonbeef | no_prices | no_burgers | not_menu."""
    burgers = menu["burgers"]
    if any(b["protein"] == "beef" and b["price"] is not None for b in burgers):
        return "priced"
    if any(b["price"] is not None for b in burgers):
        return "nonbeef"
    if burgers:
        return "no_prices"
    return "no_burgers" if menu["is_menu"] else "not_menu"


def index_item(burgers: list[dict]) -> int | None:
    """Position of the cheapest priced beef burger (first one on ties), or None."""
    best: int | None = None
    for i, b in enumerate(burgers):
        if b.get("protein") == "beef" and b.get("price") is not None:
            if best is None or b["price"] < burgers[best]["price"]:
                best = i
    return best
