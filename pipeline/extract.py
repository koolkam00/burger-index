"""Post-processing of the scrape JSON extraction: clean, validate, dedupe, classify.

Lunch vs dinner: a burger listed on several menus keeps its dinner / all-day price;
late-night, lunch, brunch and "other" prices are used only (in that order) when the burger
is not on the dinner menu; happy-hour prices last; kids'-menu items are dropped.

Two picks over a page's burgers, both by the same menu-period order (a dinner / all-day price
first; only when no beef burger has one, the next menu period; never a happy-hour price):
  - index_item: the cheapest beef burger. process.py uses it (through classify_menu) to decide
    whether a page is priced and whether to keep searching, so it must not change without a re-scrape.
  - top_item (build only): the restaurant's one published burger, its highest-priced eligible beef
    burger (user decision, 2026-09-24); its price is the restaurant's index price. Group items,
    combos, eating challenges, kids' items and diners' bunless diet plates never count; a burger club
    does; a Deluxe / with-fries burger gives way to its cheaper plain twin; plates of several burgers
    only when there is nothing else.

Index eligibility rules (index_item; post-processing only, so the scrape cache replays unchanged):
  - is_slider_plate: a plate of small burgers ('Cheeseburger Sliders (3)', 'Mini Burgers', '2 Mini
    Slammers') is never the index item while a standard-size beef burger is priced on the page. It
    stays in the burger list at its own price (it is a real item people buy); on a page with only
    slider plates it can still be the index item.
  - is_not_a_burger: a hot dog / sausage ('The Frank') or a pet item ('The Pup Patty (Patty for
    Puppy)') is never the index item and does not make a page 'priced'; build leaves it out of the
    published burger list.
  - is_template_placeholder: an unedited site-builder template item ('This is an item on your menu')
    is not a menu item; build leaves it out (build.drop_template_placeholders).
Rows are never removed in normalize_menu: pipeline/data/corrections.json names some of them and
corrections are strict, and the scrape evaluation (process.py) counts them.
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


# A menu line that continues the burger above it: '...with cheese', '… with bacon'.
CONTINUATION_RE = re.compile(r"^\s*(?:\.{2,}|…)")


def normalize_menu(data: Any) -> dict:
    """Extraction JSON -> {is_menu, has_prices, restaurant_name, location, burgers[], notes[]}.

    burgers: [{name, price, description, protein, menu_period}] in page order, deduped. A continuation line
    ('...with cheese & bacon') is named after the burger above it ('Hamburger Sandwich with cheese & bacon').
    """
    data = data if isinstance(data, dict) else {}
    notes: list[str] = []
    items: list[dict] = []
    base = None  # the last burger named in full: a continuation line ('...with cheese') is a variant of it
    for raw in data.get("burgers") or []:
        if not isinstance(raw, dict):
            continue
        price = coerce_price(raw.get("price"))
        name = clean_name(raw.get("name"), price)
        if not name:
            continue
        if CONTINUATION_RE.match(str(raw.get("name"))):
            # Henry Public: 'HAMBURGER SANDWICH $22 / ...with cheese $24 / ...with cheese & bacon $26'
            name = clean_name(CONTINUATION_RE.sub("", str(raw.get("name"))), price) or name
            name = f"{base} {name}" if base else name
        else:
            base = name
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


# A plate of small burgers. 'slider' followed by 'burger' names one burger ('Slider Burger'); a single
# 'Mini Burger' or 'Bistro Mini' (Corner Bistro's 4 oz burger) is one small burger, and so are 'Little',
# 'Junior' and 'Jr.' burgers ('Treadwell Junior Burger', 'Little Burger (4 oz)'): none of them match.
SLIDER_PLATE_RE = re.compile(
    r"\bsliders?\b(?!.*burger)"  # 'Cheeseburger Sliders (3)', 'Beef Slider', 'Trio of Sliders'
    r"|\bminis\b"  # 'Burger Minis'
    r"|\bmini\b.*\b(?:burgers|cheeseburgers|hamburgers|slammers)\b"  # 'Mini Rodeo Burgers', '2 Mini Slammers'
    r"|^\d+ mini\b"  # '3 Mini Burger'
    r"|\bbaby (?:burgers|cheeseburgers)\b"  # 'Baby Burgers (3)'
    r"|\btrio\b(?!.*burger\b)"  # 'Burger Trio' ('Trio Burger' is one burger)
)
# Not a burger at all: hot dogs and sausages (only when the name has no 'burger': 'Sausage Burger'
# stays), and food for dogs. Possessives are ignored ("Frank's Special" is a burger named after Frank).
HOT_DOG_RE = re.compile(
    r"\b(?:franks?|frankfurters?|(?:hot|corn|chili) ?dogs?|wieners?|bratwursts?|kielbasas?|sausages?)\b")
PET_FOOD_RE = re.compile(r"\b(?:pup|pups|puppy|puppies|doggy|doggie|doggies|pooch)\b|\bfor (?:your )?(?:dogs?|pets?)\b")
# Text of an unedited site-builder menu template (Wix: every item $9 with this description).
TEMPLATE_PLACEHOLDER_RE = re.compile(r"this is an item on your menu|give your item a brief description", re.I)


def is_slider_plate(item: dict) -> bool:
    """True for a plate of sliders / mini burgers ('Burger Sliders', 'Mini Burgers (3)', '2 Mini
    Slammers', 'Baby Burgers (3)', a single $3.25 'Beef Slider'). index_item passes over it while the
    page prices a standard-size beef burger; the row itself stays listed at its price."""
    return bool(SLIDER_PLATE_RE.search(norm_name(item.get("name"))))


def is_not_a_burger(item: dict) -> bool:
    """True for an item that is not a burger for people: a hot dog or sausage ('The Frank', a 1/4 lb
    beef frank) unless its name says burger, or a pet item ('The Pup Patty (Patty for Puppy)'; hush
    puppies are not). Never the index item, ignored by classify_menu, left out of the published list."""
    raw = re.sub(r"\b\w+['’]s\b", " ", str(item.get("name") or ""))  # "Frank's Special" -> " Special"
    n = norm_name(raw)
    if "burger" not in n and HOT_DOG_RE.search(n):
        return True
    return bool(PET_FOOD_RE.search(re.sub(r"\bhush pupp\w*", " ", n)))


def is_template_placeholder(item: dict) -> bool:
    """True for a site-builder template item ('This is an item on your menu. Give your item a brief
    description'): filler with a made-up price, not a menu item (build.drop_template_placeholders)."""
    return bool(TEMPLATE_PLACEHOLDER_RE.search(item.get("description") or ""))


def classify_menu(menu: dict) -> str:
    """priced | nonbeef | no_prices | no_burgers | not_menu. Items that are not burgers
    (is_not_a_burger) are ignored."""
    burgers = [b for b in menu["burgers"] if not is_not_a_burger(b)]
    if index_item(burgers) is not None:
        return "priced"
    if any(b["price"] is not None and b["protein"] != "beef" for b in burgers):
        return "nonbeef"
    if burgers:
        return "no_prices"  # incl. beef burgers priced only on a happy-hour menu
    return "no_burgers" if menu["is_menu"] else "not_menu"


# Index-price tiers by menu period (see the module docstring). Happy hour never sets the index.
INDEX_PERIOD_TIER = {None: 0, "all_day": 0, "dinner": 0, "late_night": 1, "lunch": 2, "brunch": 3, "other": 4}


def index_item(burgers: list[dict]) -> int | None:
    """Position of the cheapest priced beef burger from the best menu period that has one
    (first one on ties), or None. Items that are not burgers (is_not_a_burger) never count; slider
    plates (is_slider_plate) count only when no other priced beef burger is eligible."""
    eligible: list[tuple[tuple, int, dict]] = []
    for i, b in enumerate(burgers):
        if b.get("protein") != "beef" or b.get("price") is None or is_not_a_burger(b):
            continue
        tier = INDEX_PERIOD_TIER.get(b.get("menu_period"))
        if tier is None:  # happy_hour (and anything unknown)
            continue
        eligible.append(((tier, b["price"]), i, b))
    standard = [e for e in eligible if not is_slider_plate(e[2])]
    pool = standard or eligible
    return min(pool, key=lambda e: e[:2])[1] if pool else None


# --- One burger per restaurant: its highest-priced burger (build only) -----------------------------
# User decision (2026-09-24): every restaurant publishes exactly one burger, its highest-priced
# eligible beef burger, and that price is its index price. top_item picks it and runs in build only.
# index_item and classify_menu above (the cheapest beef burger) are what process.py uses to decide
# whether a page is priced and whether to keep searching; they stay as they are, so offline replays
# of the scrape cache make exactly the same calls.
#
# Eligible: beef, priced, not happy hour, from the best menu period that has one (INDEX_PERIOD_TIER),
# and one burger for one person. Doubles, triples, specialty and wagyu burgers are one burger; a
# burger plated with fries ('Burger Platter', 'Burger & Fries') is still one burger.
#   never: not a burger (is_not_a_burger), a kids' item, a diner's diet plate (is_diet_plate: 'Slim-Line',
#          'Lo-Cal', 'Diet Delights', a bunless keto / Atkins / low-carb plate), a group item (a platter of 10
#          burgers, 'for 4', family / party / catering / tray / dozen / bucket / tower / flight / sampler / kit /
#          box / bundle, a count of 6 or more: '(6)', 'x6', '12 pc'; 'serves 3'), an eating challenge, or a combo /
#          meal deal ('Meal', 'Combo', a drink or a beer included).
#   always one burger: a burger club ('Cheeseburger Club', 'Bacon Burger Club', a triple-decker 'Cheeseburger Club
#          Sandwich'; user decision, 2026-09-25). Nothing below treats 'club' as a plate, a group item or a sides mark.
#   twin: a burger with sides ('BBQ Burger Deluxe', 'Burger with Fries') when the menu also prices the plain
#          burger for less (is_sides_twin): the plain burger's price stands.
#   fallback: a plate of several burgers (a slider plate, 'Three sliders per order', a 'Twin Burger' of two
#          burgers on two buns, a count of 2 to 5: 'Smash Burger (2)', 'Sliders (4)') only when the menu has
#          no other eligible beef burger, the way index_item treats slider plates.

_NUM_WORDS = "two|three|four|five|six|seven|eight|nine|ten|twelve"
_MANY = r"(?:[6-9]|[1-9]\d)"  # a count of 6-99 is a group item; 2-5 is a plate (_FEW)
_FEW = r"[2-5]"
_PIECES = r"(?:pc|pcs|piece|pieces|ct|count|pack|packs)"
GROUP_NAME_RE = re.compile(
    rf"\bfor (?:[2-9]|[1-9]\d|{_NUM_WORDS}|the table)\b"  # 'Burger Platter for 4', 'Sliders for Two'
    r"|\b\d+ for \d"  # '2 for $15 Single Ultimate Smash'
    r"|\b(?:family|party|parties|catering|trays?|dozen|buckets?|towers?|flights?|samplers?|kits?|box|boxes"
    r"|bundles?|feast|shareable|sharing)\b"
    r"|\bto share\b|\bburger bar for\b"
    rf"|\bx ?{_MANY}\b|\b{_MANY} ?x\b"  # 'x6', '12x'
    rf"|\b{_MANY} ?{_PIECES}\b"  # '6 pc', '12 pack'
    rf"|^{_MANY} (?:\w+ ){{0,3}}(?:burgers|cheeseburgers|hamburgers|sliders|minis)\b"  # '10 Sliders'
)
GROUP_COUNT_RE = re.compile(rf"\(\s*{_MANY}\s*{_PIECES}?\s*\)")  # '(6)', '(12 pcs)' (raw name: norm_name drops brackets)
GROUP_DESC_RE = re.compile(
    rf"\bserves (?:[2-9]|[1-9]\d|{_NUM_WORDS})\b|\bfeeds (?:[2-9]|[1-9]\d|{_NUM_WORDS})\b"  # '10 sliders (serves 3)'
    rf"|\bfor (?:[2-9]|[1-9]\d|{_NUM_WORDS}) (?:people|persons|guests)\b|\bper person\b|\bcatering\b"
    r"|\bfor the table\b|\b(?:\d+|a) (?:\w+ )?minimum\b|\bminimum (?:of|order)\b"
)
# A description that opens with a count of 6+ burgers (raw text, so '50% ground beef' is not a count):
# "10 double patty swiss cheeseburgers", "10 Black Angus beef with ...". Units and ages are not a count
# ('8 oz beef', '12 hour braised', '6 year aged'), nor is a count later on ('top 10 smash burgers in NYC').
GROUP_LEAD_RE = re.compile(
    r"^(?:[6-9]|[1-9]\d|six|seven|eight|nine|ten|twelve|a dozen|dozen)\s+"
    r"(?!(?:oz|ounce|ounces|lb|lbs|pound|pounds|year|years|day|days|week|weeks|hour|hours|inch|inches|g|gram|grams"
    r"|napkin|spice|cheese|pepper|layer|layers)\b)"
    r"(?:[\w'’-]+\s+){0,3}(?:burgers|cheeseburgers|hamburgers|sliders|beef|angus)\b"
)
COMBO_NAME_RE = re.compile(r"\b(?:combo|combos|meal|meals|deal|deals)\b")  # 'Bx Cheeseburger Meal', 'Combo 12 oz. Burger'
# A drink in the price: "+ Skin-on fries & Can Soda", "French Fries & Fountain Soda", "side fries, and drink"
DRINK_RE = re.compile(
    r"\b(?:can(?:ned)? (?:of )?soda|fountain (?:soda|drink)s?|soft drinks?"
    r"|(?:and|with|w|plus|includes?|including) (?:a |any |your |choice of |one |1 )*"
    r"(?:can |canned |fountain |small |medium |large |bottled? )?(?:soda|drink|beverage|coke|pepsi|sprite)s?)\b"
)
# ... or a beer: "Served with a 16oz Gigawatt beer" (Clinton Hall's CH Challenge), "Cheese Burger & Fries with a
# Beer", "HH Burger & Beer". Beer as an ingredient is not a drink: "IPA caramelized onions", "beer battered",
# "beer cheese", "Beer Fed Wagyu", "IPA pickles", "beer chili" (norm_name text: '&' is 'and').
BEER_RE = re.compile(
    r"\b(?:with|w|and|plus|includes?|including) (?:a |an |one |1 |your |choice of |any )*(?:\d+ ?oz )?"
    r"(?:\w+ ){0,2}(?:beers?|ipas?|lagers?|pilsners?|pints?|drafts?)\b"
    r"(?! (?:beer|ipa|batter|battered|braised|caramelized|glazed|chili|onions?|pickles?|fed|cheese|mustard|sauce"
    r"|jam|bun|bread|brined|marinated)\b)"
)
# An eating challenge: a novelty platter priced to be won ("Conquer this burger and fries by yourself in 25 mins
# and it's free"), not a burger on the menu. Clinton Hall's $50 CH Challenge (a 20 oz patty, chicken tenders,
# onion rings, fries and a beer).
CHALLENGE_RE = re.compile(r"\bchallenge\b|\b(?:its|it is) free\b|\bfree if you\b|\btime limit\b")
KIDS_NAME_RE = re.compile(r"\b(?:kid|kids|kiddie|kiddy|child|childs|children|childrens|toddlers?)\b")
KIDS_DESC_RE = re.compile(r"\bfor (?:the )?(?:kids|children)\b|\bkids? (?:menu|meal|size|portion)\b"
                          r"|\b(?:10|12) (?:and|or) (?:under|younger)\b")
# A diner's diet plate (user decision, 2026-09-25): the patty without a bun, with cottage cheese, fruit or a salad,
# priced as a platter and often above the diner's burgers (The Flame Diner's $21.95 'Slim-Line', Austin House's
# 'Slime Line Jumbo Hamburger', Mike's Oakwood 'Lo-Cal Burger'). The name says so (norm_name text, so 'Slim-Line'
# is 'slim line' and 'Lo - Cal' is 'lo cal'); 'Local Burger', 'Slim Jim Burger' and 'Low Country Burger' do not.
DIET_NAME_RE = re.compile(
    r"\bslime? ?line\b"  # 'Slim-Line', 'Slim Line', 'Slimline', 'Slime Line' (a menu typo)
    r"|\blo cal\b|\blow ?cal(?:orie|ories)?\b"  # 'Lo-Cal', 'Low Cal', 'Low-Calorie' ('local' is not 'lo cal')
    r"|\bdiet\b|\bdieters?\b|\bweight ?watchers?\b|\bcalorie counters?\b|\bfigure watchers?\b"  # 'Diet Delights'
    r"|\bbunless\b|\bno bun\b"  # 'Bunless Burger Plate'
)
# A low-carb burger is a diet plate only without a bun ('Atkins Burger': "9 oz. burger (no bun)", 'Low-Carb Topless
# Burger', Bill's 'Keto My Heart': "bunless"); a keto burger on a zucchini bun stays a burger.
LOW_CARB_RE = re.compile(r"\bketo\b|\batkins\b|\blow ?carbs?\b")
# Otherwise the description must say both: a diet plate ("cottage cheese", "low-fat", "diet") and no bun ("on a bed
# of lettuce", "no bun"): Fort Hamilton Diner's 'Burger Delight', "Jumbo burger with cottage cheese on a bed of
# lettuce". A lettuce-wrapped burger ("Bunless! Wrapped in Lettuce") or a burger served with cottage cheese on the
# side is still a burger.
DIET_DESC_RE = re.compile(r"\bdiet\b|\bdieters?\b|\blo cal\b|\blow ?cal(?:orie|ories)?\b|\blow ?fat\b|\bslime? ?line\b"
                          r"|\bweight ?watchers?\b|\bcottage cheese\b|\bketo\b|\batkins\b|\blow ?carbs?\b")
BUNLESS_RE = re.compile(r"\bbunless\b|\bno bun\b|\bwithout (?:a |the )?bun\b|\bbun ?free\b|\btopless\b"
                        r"|\bon a bed of\b|\bover (?:a bed of )?(?:lettuce|greens|romaine|salad)\b"
                        r"|\bin place of (?:a |the )?bun\b")
# Several burgers on one plate (fallback only; see above). The name side is is_slider_plate + the counts.
PLATE_NAME_RE = re.compile(rf"\b{_FEW} ?{_PIECES}\b|^{_FEW} (?:\w+ ){{0,3}}(?:burgers|cheeseburgers|hamburgers|sliders)\b")
PLATE_COUNT_RE = re.compile(rf"\(\s*{_FEW}\s*{_PIECES}?\s*\)")  # 'Smash Burger (2)', 'Sliders (4)' (raw name)
SLIDER_DESC_RE = re.compile(
    r"\b(?:[2-5]|two|three|four|five) (?:\w+ ){0,3}(?:sliders|mini (?:\w+ )?burgers|mini cheeseburgers"
    r"|baby (?:\w+ )?burgers)\b"
    r"|\bsliders? per order\b"  # Esquire Diner 'Angus Burger': "Three sliders per order"
)
TWIN_NAME_RE = re.compile(r"\btwin\b")  # 'Twin Burger Deluxe'
TWIN_DESC_RE = re.compile(r"\btwin burgers\b|\b(?:two|2) (?:\w+ ){0,2}burgers on (?:two|2)\b")
# ... unless it is two patties on one bun, i.e. a double: "Two beef burgers on one toasted bun",
# "Two ... beef patties ... served on a toasted bun" (but not "Two cheeseburgers on two toasted buns").
ONE_BUN_RE = re.compile(r"\b(?:one|single|1) (?:\w+ ){0,2}(?:bun|roll)\b")
A_BUN_RE = re.compile(r"\ba (?:\w+ ){0,2}(?:bun|roll)\b")
TWO_BURGERS_RE = re.compile(r"\b(?:two|2) (?:\w+ ){0,3}(?:burgers|cheeseburgers|buns|rolls)\b")


def _raw(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "").lower()).strip()


def is_diet_plate(item: dict) -> bool:
    """True for a diner's bunless diet / low-calorie plate ('Slim-Line', 'Slime Line Jumbo Hamburger', 'Lo-Cal
    Burger', 'Hamburger Diet Delights', a bunless 'Atkins Burger'), by its name, or by a description that says
    both diet plate and no bun ('with cottage cheese on a bed of lettuce'). Never the published burger."""
    n, d = norm_name(item.get("name")), norm_name(item.get("description"))
    if DIET_NAME_RE.search(n):
        return True
    bunless = BUNLESS_RE.search(n) or BUNLESS_RE.search(d)
    if LOW_CARB_RE.search(n):
        return bool(bunless)
    return bool(bunless and DIET_DESC_RE.search(d))


def top_item_exclusion(item: dict) -> str | None:
    """Why an item can never be a restaurant's one published burger, else None:
    'not a burger' | 'kids' | 'diet plate' | 'group' | 'challenge' | 'combo'. Protein, price and menu period are
    top_item's."""
    if is_not_a_burger(item):
        return "not a burger"
    n, d = norm_name(item.get("name")), norm_name(item.get("description"))
    if KIDS_NAME_RE.search(n) or KIDS_DESC_RE.search(d):
        return "kids"
    if is_diet_plate(item):
        return "diet plate"
    if (GROUP_NAME_RE.search(n) or GROUP_COUNT_RE.search(_raw(item.get("name"))) or GROUP_DESC_RE.search(d)
            or GROUP_LEAD_RE.search(_raw(item.get("description")))):
        return "group"
    if CHALLENGE_RE.search(n) or CHALLENGE_RE.search(d):
        return "challenge"
    if COMBO_NAME_RE.search(n) or any(r.search(n) or r.search(d) for r in (DRINK_RE, BEER_RE)):
        return "combo"
    return None


# The same burger with sides: a diner's 'Deluxe' / 'Platter' (fries, lettuce, tomato, coleslaw) or 'Burger with
# Fries' next to the plain burger ('BBQ Burger' $15.25 / 'BBQ Burger Deluxe' $20.25, 'Bacon Cheeseburger' /
# 'Deluxe Bacon Cheeseburger', 'Burger' $10 / 'Burger with Fries' $12). The extra is the sides, an add-on.
SIDES_MARK_RE = re.compile(
    r"\b(?:deluxe|platter|plain)\b|\bspecial$"
    r"|\b(?:with|w|and|plus) (?:a )?(?:side of )?(?:french |hand cut |steak |curly |sweet potato )?"
    r"(?:fries|tots|chips|onion rings|side|sides)\b"
    r"|\b(?:with|w) (?:lt|lettuce (?:and )?tomato)$"  # Gil's 'Plain Beef burger with LT'
)


def _singular(s: str) -> str:
    """'fried onions' -> 'fried onion' (National Diner lists 'Fried Onions' plain and 'Fried Onion' deluxe)."""
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in s.split())


def burger_with_sides_key(item: dict) -> str | None:
    """The plain burger's name when the item's name marks it as that burger with sides ('BBQ Burger Deluxe'
    -> 'bbq burger', 'Burger with Fries' -> 'burger', '8 oz. Country Beef Burger - Plain' -> '8 oz country beef
    burger'), else None. Compared with plural 's' dropped."""
    n = norm_name(item.get("name"))
    key = re.sub(r"\s+", " ", SIDES_MARK_RE.sub(" ", n)).strip()
    return _singular(key) if key and key != n else None


def _is_plain_form(b: dict, key: str) -> bool:
    n = norm_name(b.get("name"))
    return _singular(n) == key or (burger_with_sides_key(b) == key and re.search(r"\bplain\b", n) is not None)


def is_sides_twin(item: dict, burgers: list[dict]) -> bool:
    """True when the item is a burger with sides and `burgers` prices the plain burger for less (same name
    without the Deluxe / Platter / with-fries mark, or marked 'Plain'). top_item then takes the plain burger's
    price. A menu that lists only the Deluxe or Platter form keeps it (it is still one burger)."""
    key = burger_with_sides_key(item)
    if key is None or item.get("price") is None:
        return False
    return any(b is not item and b.get("price") is not None and b["price"] < item["price"] and _is_plain_form(b, key)
               for b in burgers)


def is_multi_burger_plate(item: dict) -> bool:
    """True for several burgers on one plate: a slider plate (is_slider_plate, or a description such as
    'Three sliders per order'), a 'Twin Burger' of two burgers on two buns, a count of 2 to 5 ('Smash
    Burger (2)', 'Sliders (4)'). top_item takes one only when the menu has no other eligible beef burger."""
    n, d = norm_name(item.get("name")), norm_name(item.get("description"))
    if is_slider_plate(item) or PLATE_COUNT_RE.search(_raw(item.get("name"))) or PLATE_NAME_RE.search(n):
        return True
    if SLIDER_DESC_RE.search(d):
        return True
    if TWIN_NAME_RE.search(n) or TWIN_DESC_RE.search(d):
        one_bun = ONE_BUN_RE.search(d) or (A_BUN_RE.search(d) and not TWO_BURGERS_RE.search(d))
        return not one_bun
    return False


def top_item_candidates(burgers: list[dict]) -> list[tuple[int, int, bool]]:
    """(tier, position, is_multi_burger_plate) of every item top_item may choose from. A burger with sides
    whose plain twin is also eligible and cheaper (is_sides_twin) is left out: its extra is the sides."""
    out = []
    for i, b in enumerate(burgers):
        if b.get("protein") != "beef" or b.get("price") is None:
            continue
        tier = INDEX_PERIOD_TIER.get(b.get("menu_period"))
        if tier is None or top_item_exclusion(b):  # happy hour (and anything unknown); see above
            continue
        out.append((tier, i, is_multi_burger_plate(b)))
    eligible = [burgers[i] for _, i, _ in out]
    return [c for c in out if not is_sides_twin(burgers[c[1]], eligible)]


def top_item(burgers: list[dict]) -> int | None:
    """Position of the restaurant's one published burger: the highest-priced eligible beef burger from
    the best menu period that has one (first on the menu on ties), or None. Plates of several burgers
    count only when no other eligible beef burger is priced; group items, combos and diet plates never
    count; a burger club counts like any other burger."""
    cands = top_item_candidates(burgers)
    pool = [c for c in cands if not c[2]] or cands
    return min(pool, key=lambda c: (c[0], -burgers[c[1]]["price"], c[1]))[1] if pool else None
