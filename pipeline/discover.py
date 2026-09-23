"""Menu-URL discovery: classify URLs, rank search results, pick menu pages from a site map.

Ranking (best first): official menu page / official PDF > official homepage (resolved to a
menu page with Map URLs) > online ordering > menu aggregators > delivery marketplaces with full
store menus (Grubhub, Seamless) > delivery apps.
Rejected: social, review sites, news/blog articles, and results for a different location.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from urllib.parse import unquote, urlparse

from rapidfuzz import fuzz

from .names import norm_name, slugify

ONLINE_ORDERING = (
    "toasttab.com", "square.site", "squareup.com", "clover.com", "chownow.com", "popmenu.com", "slicelife.com",
    "menufy.com", "order.online", "getbento.com", "bentobox.com", "netwaiter.com", "beyondmenu.com", "menusifu.com",
    "spoton.com", "owner.com", "olo.com", "hungerrush.com", "foodbooking.com", "gloriafood.com", "ordering.app",
    "orderonlinemenus.com", "tryotter.com", "mealeo.com", "grubhubdirect.com", "orderfood.online",
)
MENU_AGGREGATORS = (
    "menupages.com", "allmenus.com", "menuwithprice.com", "sirved.com",
    "menucollectors.com", "menurestaurants.net", "menuweb.menu", "restaurantji.com", "singleplatform.com",
    "zmenu.com", "menuism.com", "cititour.com",
)
# Delivery marketplaces whose store pages list the whole menu (no lazy loading). Their prices
# are delivery prices, so they are published as price_source delivery_app.
DELIVERY_MARKETPLACES = ("grubhub.com", "seamless.com")
# Delivery apps whose store pages lazy-load menu sections (a scrape often sees part of the menu).
DELIVERY_APPS = ("ubereats.com", "doordash.com", "postmates.com", "trycaviar.com", "caviar.com")
# Site-builder CDNs that host restaurants' own menu PDFs (their domain never matches the name).
SITE_CDNS = (
    "getbento.com", "squarespace-cdn.com", "squarespace.com", "website-files.com", "wixstatic.com", "popmenu.com",
    "shopify.com", "webflow.com", "imgix.net", "cloudfront.net", "amazonaws.com", "wp.com",
)
# Domain entries ending in '.' match any TLD ('yelp.' -> yelp.com, yelp.ca).
REJECT_DOMAINS = (
    "yelp.", "tripadvisor.", "instagram.com", "facebook.com", "fb.com", "tiktok.com", "twitter.com", "x.com",
    "threads.net", "reddit.com", "youtube.com", "pinterest.", "linkedin.com", "google.", "goo.gl", "foursquare.com",
    "opentable.", "resy.com", "exploretock.com", "sevenrooms.com", "wikipedia.org", "eater.com", "grubstreet.com",
    "nymag.com", "timeout.com", "theinfatuation.com", "nytimes.com", "nypost.com", "newyorker.com", "secretnyc.co",
    "gothamist.com", "thrillist.com", "bonappetit.com", "seriouseats.com", "zagat.com", "michelin.com",
    "mapquest.com", "wanderlog.com", "restaurantguru.com", "zomato.com", "patch.com", "medium.com", "substack.com",
    "blogspot.com", "untappd.com", "groupon.com", "fastfoodmenuprices.com", "menuandprice.com", "menu-price.net",
    "fastfoodnutrition.org", "bbb.org", "indeed.com", "glassdoor.com", "apps.apple.com", "play.google.com",
    "waze.com", "happycow.net", "chowhound.com", "tasteatlas.com", "foodandwine.com", "nydailynews.com",
    "amny.com", "silive.com", "brooklynpaper.com", "qns.com", "bkmag.com", "forbes.com", "businessinsider.com",
    "cnn.com", "yahoo.com", "msn.com", "apple.com", "bing.com", "duckduckgo.com", "stackexchange.com",
)
# Passed to search as excludeDomains so the 10 results we pay for are usable.
SEARCH_EXCLUDE_DOMAINS = [
    "yelp.com", "tripadvisor.com", "instagram.com", "facebook.com", "tiktok.com", "reddit.com", "youtube.com",
    "pinterest.com", "opentable.com", "resy.com", "eater.com", "timeout.com", "theinfatuation.com",
    "grubstreet.com", "restaurantguru.com", "wanderlog.com", "fastfoodmenuprices.com",
]
ARTICLE_SEGMENTS = {
    "blog", "blogs", "news", "article", "articles", "story", "stories", "press", "review", "reviews", "guide",
    "guides", "list", "lists", "magazine", "careers", "jobs",
}
MENU_PATH_RE = re.compile(r"(^|[/_\-.])(menus?|food|eat|dinner|lunch|brunch|order|ordering|carta)([/_\-.]|$)")
STREET_SUFFIX = (
    r"st|street|ave|avenue|av|blvd|boulevard|rd|road|pl|place|broadway|bowery|way|pkwy|parkway|ln|lane|dr|drive|"
    r"sq|square|plz|plaza|tpke|turnpike|hwy|highway|ter|terrace|ct|court"
)
ADDRESS_RE = re.compile(rf"\b(\d{{1,5}})(?:\s*-\s*\d+)?\s+(?:[a-z0-9]+\s+){{0,3}}?(?:{STREET_SUFFIX})\b")
# Places outside NYC that never name anything in the city: they count anywhere in the text.
NON_NYC_ANYWHERE = (
    "new jersey", "nj", "jersey city", "hoboken", "connecticut", r"long island(?! city| iced)", "los angeles",
    "las vegas", "san francisco", "washington dc", "new haven", "toronto",
)
# Cities outside NYC that are also NYC street names, dishes or restaurant names (E Houston St,
# Boston Rd, White Plains Rd, Westchester Ave, Albany Ave, buffalo wings, Dallas BBQ): they only
# count in a city/state position ('houston tx', 'white plains ny'). Official-site candidates
# also count them as a bare word unless a street suffix or a dish word follows.
NON_NYC_CITIES = (
    "newark", "yonkers", "white plains", "westchester", "hempstead", "stamford", "new rochelle", "philadelphia",
    "boston", "chicago", "miami", "atlanta", "houston", "dallas", "austin", "albany", "buffalo",
)
# State abbreviations that are also common words (in, or, me, oh, la, co...) are left out.
STATE_ABBRS = "ny|nj|ct|pa|ma|ri|vt|nh|tx|il|fl|ga|ca|nv|dc|md|va|nc|sc|tn|az|wa|mi|mn|mo|wi|ky|ut|nm|ne|ks|ia|ar|ms|mt|nd|sd|wv|wy|ak"
US_STATES = (
    f"{STATE_ABBRS}|new york|new jersey|connecticut|pennsylvania|massachusetts|texas|illinois|florida|georgia|"
    "california|nevada|maryland|virginia"
)
_NOT_A_PLACE_AFTER = (
    rf"{STREET_SUFFIX}|post|wings?|style|dogs?|hot|cream|pies?|rolls?|chicken|sauce|cheesesteaks?|burgers?|"
    r"pizza|bbq|market|hall|strip"
)
NYC_RE = re.compile(
    r"\b(nyc|new york city|manhattan|brooklyn|queens|bronx|staten island|new york(?! style| strip| cheesecake))\b"
    r"|\bny 1(?:0[0-4]|1[1-46])\d\d\b"
)
BOROUGH_WORDS = {"Manhattan": "manhattan", "Brooklyn": "brooklyn", "Queens": "queens", "Bronx": "bronx",
                 "Staten Island": "staten island"}

# third_party: an unknown site whose domain is not the restaurant's but whose title names it
# (line trackers, gift cards, fan price lists). Tried last; priced as a menu aggregator.
# delivery_marketplace: after the aggregators but before an unmapped official homepage
# (UNMAPPED_HOME_TIER) and the lazy-loading delivery apps.
TIERS = {"official_menu": 0, "official_pdf": 0, "official_home": 1, "online_ordering": 2,
         "menu_aggregator": 3, "delivery_marketplace": 3.4, "delivery_app": 4, "third_party": 5}
OFFICIAL = {"official_menu", "official_pdf", "official_home"}
PRICE_SOURCE = {
    "official_menu": "official_site",
    "official_home": "official_site",
    "official_pdf": "official_pdf",
    "online_ordering": "online_ordering",
    "menu_aggregator": "menu_aggregator",
    "delivery_marketplace": "delivery_app",
    "delivery_app": "delivery_app",
    "third_party": "menu_aggregator",
}
SOURCE_LABEL = {
    "official_site": "the restaurant's own site",
    "official_pdf": "the restaurant's menu PDF",
    "online_ordering": "an online-ordering page",
    "menu_aggregator": "a menu aggregator",
    "delivery_app": "a delivery app",
}


# An official homepage whose site map has no menu page: tried after online-ordering pages and
# aggregators (which reliably list prices) but before delivery apps (marked-up prices).
UNMAPPED_HOME_TIER = 3.5


@dataclass
class Candidate:
    url: str
    category: str
    origin: str  # "csv menu_url" | "csv website" | "search" | "map"
    tier: float | None = None  # overrides TIERS[category] when set

    @property
    def price_source(self) -> str | None:
        return PRICE_SOURCE.get(self.category)

    @property
    def rank(self) -> float:
        return self.tier if self.tier is not None else TIERS.get(self.category, 9)


# Platform pages that are a single store's menu. Anything else on these hosts is a directory /
# city / brand listing without prices (grubhub.com/food/mcdonalds/ny-manhattan).
STORE_PATHS = {
    "ubereats.com": ("/store/",),
    "doordash.com": ("/store/",),
    "postmates.com": ("/store/",),
    "trycaviar.com": ("/store/",),
    "caviar.com": ("/store/",),
    "grubhub.com": ("/restaurant/",),
    "seamless.com": ("/menu/", "/restaurant/"),
}
TRACKING_PARAMS = re.compile(r"^(srsltid|utm_[a-z]+|gclid|fbclid|msclkid|ref|ref_src|_gl)$", re.I)


def clean_url(url: str) -> str:
    """Drop tracking query params (Google's srsltid, utm_*) so equal pages share a cache key."""
    from urllib.parse import parse_qsl, urlencode, urlunparse

    p = urlparse(url.strip())
    if not p.query:
        return url.strip()
    q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not TRACKING_PARAMS.match(k)]
    return urlunparse(p._replace(query=urlencode(q)))


def host_of(url: str) -> str:
    h = urlparse(url).netloc.lower().split("@")[-1].split(":")[0]
    return h[4:] if h.startswith("www.") else h


def root_url(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme or 'https'}://{p.netloc}/"


def url_key(url: str) -> str:
    """Normalize for dedupe: no scheme/www/trailing slash/fragment."""
    p = urlparse(url.strip())
    path = p.path.rstrip("/")
    q = f"?{p.query}" if p.query else ""
    return f"{host_of(url)}{path}{q}".lower()


def _host_matches(host: str, entry: str) -> bool:
    if entry.endswith("."):
        return entry[:-1] in host.split(".")
    return host == entry or host.endswith("." + entry)


def _any_host(host: str, entries) -> bool:
    return any(_host_matches(host, e) for e in entries)


def classify_url(url: str) -> tuple[str, str | None]:
    """(category, reject reason). Categories: reject, delivery_app, delivery_marketplace, menu_aggregator,
    official_pdf, online_ordering, official_menu, official_home."""
    host = host_of(url)
    path = unquote(urlparse(url).path).lower()
    if not host:
        return "reject", "not a URL"
    if _any_host(host, REJECT_DOMAINS):
        return "reject", f"{host} is not a menu source"
    if _host_matches(host, "cititour.com"):
        return ("menu_aggregator", None) if "/menu" in path else ("reject", "news article")
    for platform, prefixes in STORE_PATHS.items():
        if _host_matches(host, platform) and not any(path.startswith(pre) for pre in prefixes):
            return "reject", "directory page, not a single store's menu"
    if _any_host(host, DELIVERY_APPS):
        return "delivery_app", None
    if _any_host(host, DELIVERY_MARKETPLACES):
        return "delivery_marketplace", None
    if _any_host(host, MENU_AGGREGATORS):
        return "menu_aggregator", None
    if path.endswith(".pdf"):
        return "official_pdf", None
    if _any_host(host, ONLINE_ORDERING):
        return "online_ordering", None
    segments = [s for s in path.split("/") if s]
    if any(s in ARTICLE_SEGMENTS or s.startswith("best-") for s in segments):
        return "reject", "article/blog page"
    if MENU_PATH_RE.search(path):
        return "official_menu", None
    return "official_home", None


def _compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s)


def _url_words(url: str) -> str:
    p = urlparse(url)
    return norm_name(unquote(p.path).replace("-", " ").replace("_", " "))


def _names(target) -> list[str]:
    out = []
    for n in target.search_names:
        nn = norm_name(n)
        out.append(nn)
        if nn.startswith("the "):
            out.append(nn[4:])
    return [n for n in dict.fromkeys(out) if n]


# Words restaurants add to their name or domain ('duewestnyc', 'burgerbarnyc', 'peterluger' for
# 'Peter Luger Steak House'). They are peeled off before a domain is compared with the name, and a
# name made only of them never matches on its own.
GENERIC_WORDS = {
    "the", "nyc", "ny", "newyork", "bk", "bklyn", "us", "usa", "restaurant", "restaurants", "bar", "burger",
    "burgers", "hamburger", "hamburgers", "grill", "kitchen", "bbq", "pub", "tavern", "cafe", "eatery", "diner",
    "steak", "steakhouse", "house", "joint", "shop", "wine", "pizza", "and", "co", "company", "group",
    "hospitality", "online", "menu", "menus", "official", "eat", "order", "get", "visit", "no",
}
DOMAIN_PREFIXES = ("the", "eat", "order", "get", "visit", "try")
PLACE_WORDS = {"manhattan", "brooklyn", "queens", "bronx", "staten", "island", "harlem", "new", "york", "nyc", "ny"}
# A shorter name found inside a longer domain ('james' in jamesonpub, 'diner' in brooklyndiner) is
# too weak on its own: containment counts only for names at least this long.
MIN_CONTAINED_NAME = 6


def _local_words(target) -> set[str]:
    words: set[str] = set()
    for s in (target.rep.get("csv_neighborhood"), target.rep.get("neighborhood")):
        words.update(norm_name(s).split())
    return words


def _name_cores(target) -> set[str]:
    """Compact forms of the target's names: whole, and without trailing generic / place / number
    words ('peterluger', 'jackandcharlies') as long as a distinctive word is left."""
    plain = GENERIC_WORDS | PLACE_WORDS | _local_words(target)
    out: set[str] = set()
    for n in _names(target):
        toks = n.split()
        out.add(_compact(n))
        while len(toks) > 1 and (toks[-1] in plain or toks[-1].isdigit()):
            toks = toks[:-1]
            if not all(t in plain for t in toks):
                out.add(_compact(" ".join(toks)))
    return {c for c in out if len(c) >= 3}


def _domain_cores(dom: str, extra_suffixes: set[str]) -> set[str]:
    """The domain label with generic prefixes and generic / place / number suffixes peeled off,
    every stage kept."""
    suffixes = {w for w in GENERIC_WORDS | PLACE_WORDS | {"statenisland"} | extra_suffixes if len(w) >= 2}
    out, todo = {dom}, [dom]
    while todo:
        v = todo.pop()
        cuts = [v[: -len(w)] for w in suffixes if v.endswith(w)] + [v[len(w):] for w in DOMAIN_PREFIXES if v.startswith(w)]
        cuts.append(v.rstrip("0123456789"))
        for c in cuts:
            if len(c) >= 3 and c not in out:
                out.add(c)
                todo.append(c)
    return out


_OUT_OF_TOWN_LABELS = tuple(
    c for c in (_compact(p.split("(")[0]) for p in NON_NYC_ANYWHERE + NON_NYC_CITIES) if len(c) >= 5
)


def domain_matches(target, url: str) -> bool:
    """Is this the restaurant's own domain? duewestnyc.com for 'Due West', peterluger.com for
    'Peter Luger Steak House' — but not brooklyndiner.com for 'Diner', jamesonpub.com for 'James'
    or bluecollarmiami.com for 'Blue Collar'."""
    dom = _compact(host_of(url).rsplit(".", 1)[0].split(".")[-1])
    names = [_compact(n) for n in _names(target)]
    if any(p in dom and not any(p in n for n in names) for p in _OUT_OF_TOWN_LABELS):
        return False  # another city's restaurant of the same name
    local = {_compact(norm_name(s)) for s in (target.rep.get("csv_neighborhood"), target.rep.get("neighborhood")) if s}
    for part in (target.rep.get("neighborhood") or "").split("-"):
        local.add(_compact(norm_name(part)))
    if _name_cores(target) & _domain_cores(dom, {x for x in local if len(x) >= 4}):
        return True
    for n in _names(target):
        c, toks = _compact(n), n.split()
        first_two = _compact(" ".join(toks[:2])) if len(toks) >= 2 else ""
        for part in (c, first_two):
            if len(part) >= MIN_CONTAINED_NAME and part in dom:
                return True
        if len(dom) >= MIN_CONTAINED_NAME and dom in c:
            return True
    return False


def title_matches(target, url: str, title: str) -> bool:
    """Does a platform page's title / URL words name the restaurant?"""
    text = f"{norm_name(title)} {_url_words(url)}"
    for n in _names(target):
        if len(n) < 4:
            if re.search(rf"\b{re.escape(n)}\b", text):
                return True
            continue
        if fuzz.partial_ratio(n, text) >= 88 or fuzz.token_set_ratio(n, text) >= 95:
            return True
    return False


def _rep_building(rep: dict) -> tuple[str | None, str | None]:
    m = re.match(r"^(\d+)(?:-\d+)?\s+(.*)$", rep.get("address") or "")
    if not m:
        return None, None
    words = [w for w in norm_name(m.group(2)).split() if len(w) >= 4 and not w.isdigit()]
    return m.group(1), (words[0] if words else None)


def _is_nyc_zip(z: str) -> bool:
    return z[:3] in ("100", "101", "102", "103", "104", "111", "112", "113", "114", "116") or z in ("11004", "11005")


def out_of_town(text: str, own: str = "", *, bare: bool = False) -> str | None:
    """The place outside NYC a normalized text names, or None.

    Counts: a NON_NYC_ANYWHERE place; a NON_NYC_CITIES city followed by a state ('houston tx',
    'white plains ny'); a non-NY state + ZIP ('nj 07030'); a NY ZIP outside the city
    ('ny 10601'); with bare=True also a NON_NYC_CITIES city not followed by a street suffix or a
    dish word. Places that occur in `own` (the target's names and address) are ignored.
    """
    for place in NON_NYC_ANYWHERE:
        if re.search(rf"\b{place}\b", text) and not re.search(rf"\b{place}\b", own):
            return place.split("(")[0]
    for city in NON_NYC_CITIES:
        if re.search(rf"\b{city}\b", own):
            continue
        if re.search(rf"\b{city} (?:{US_STATES})\b", text):
            return city
        if bare and re.search(rf"\b{city}\b(?! (?:{_NOT_A_PLACE_AFTER})\b)", text):
            return city
    m = re.search(rf"\b(?!ny\b)(?:{STATE_ABBRS}) \d{{5}}\b", text)
    if m:
        return m.group(0)
    for m in re.finditer(r"\bny (\d{5})\b", text):
        if not _is_nyc_zip(m.group(1)):
            return m.group(0)
    return None


def location_conflict(target, url: str, title: str, description: str, category: str) -> str | None:
    """Reason string when a result (or a scraped page's location) is for a different location, else None.

    Official sites often list several locations, so they are only checked for a place outside
    NYC, and only when the text names no NYC place at all.
    """
    rep = target.rep
    name_text = " ".join(_names(target))
    own = norm_name(f"{name_text} {rep.get('address') or ''}")
    text = norm_name(f"{title} {description} {_url_words(url) if url else ''}")
    if category in OFFICIAL:
        place = out_of_town(text, own, bare=True)
        if place and not NYC_RE.search(text):
            return f"page is for a location outside NYC ({place})"
        return None
    place = out_of_town(text, own)
    if place:
        return f"page is for a location outside NYC ({place})"
    ours = BOROUGH_WORDS.get(rep.get("borough") or "")
    if ours and not re.search(rf"\b{ours}\b", text):
        for b, w in BOROUGH_WORDS.items():
            if w != ours and re.search(rf"\b{w}\b", text) and w not in name_text:
                return f"page is for a {b} location"
    number, _street = _rep_building(rep)
    if number:
        for n in sorted(_names(target), key=len, reverse=True):  # '5 Napkin Burger', 'Lot 15' are not addresses
            text = re.sub(rf"\b{re.escape(n)}\b", " ", text)
        found = {m.group(1) for m in ADDRESS_RE.finditer(text)}
        if found and number not in found:
            return f"page is for a different address ({', '.join(sorted(found))})"
    return None


def rank_search_results(results: list[dict], target) -> tuple[list[Candidate], str | None, list[str]]:
    """Usable candidates (best first), the official site root if one was found, and reject notes."""
    scored: list[tuple[tuple, Candidate]] = []
    rejected: list[str] = []
    official_root: str | None = None
    seen: set[str] = set()
    for i, res in enumerate(results or []):
        url = clean_url(res.get("url") or "")
        if not url.startswith("http"):
            continue
        k = url_key(url)
        if k in seen:
            continue
        seen.add(k)
        category, reason = classify_url(url)
        if category == "reject":
            rejected.append(f"{host_of(url)}: {reason}")
            continue
        title, desc = res.get("title") or "", res.get("description") or ""
        if category == "official_pdf" and _any_host(host_of(url), SITE_CDNS) and title_matches(target, url, title):
            pass  # the restaurant's own PDF on its site builder's CDN
        elif category in OFFICIAL and not domain_matches(target, url):
            # Not the restaurant's own domain: keep as a last-resort third-party page if it names it.
            category = "third_party" if title_matches(target, url, title) else "reject"
        elif category not in OFFICIAL and not title_matches(target, url, title):
            category = "reject"
        if category == "reject":
            rejected.append(f"{host_of(url)}: different restaurant")
            continue
        conflict = location_conflict(target, url, title, desc, category)
        if conflict:
            rejected.append(f"{host_of(url)}: {conflict}")
            continue
        if category in OFFICIAL:
            official_root = official_root or root_url(url)
            if target.chain and not target.official_has_prices:
                rejected.append(f"{host_of(url)}: chain site shows no prices")
                continue
        rel = {"high": 0, "medium": 1, "low": 2}.get(res.get("relevance") or "", 1)
        scored.append(((TIERS[category], rel, i), Candidate(url, category, "search")))
    scored.sort(key=lambda t: t[0])
    return [c for _, c in scored], official_root, rejected


def search_query(target) -> str:
    rep = target.rep
    where = rep.get("address") or rep.get("csv_neighborhood") or rep.get("neighborhood") or ""
    return re.sub(r"\s+", " ", f'"{target.name}" {where} {rep.get("borough") or ""} NYC menu').strip()


def page_location_conflict(target, location: str | None, category: str) -> str | None:
    """Check the location the scrape extracted ('131 2nd Ave New York, NY 10003') like a search result."""
    if not location:
        return None
    return location_conflict(target, "", location, "", category)


# Menus for an occasion or a part of the day whose burger prices are not the regular (dinner /
# all-day) ones.
SPECIAL_MENU_RE = re.compile(
    r"(?<![a-z])(restaurant[-_ ]?week|prix[-_ ]?fixe|prix|brunch|happy[-_ ]?hour|catering|kids|holiday|"
    r"thanksgiving|christmas|easter|valentines?|new[-_ ]?years?|tasting|private[-_ ]?(?:dining|events?))"
    r"(?=[^a-z]|menus?|$)"
)


def special_menu(url: str) -> str | None:
    """'restaurant week', 'brunch', ... when the URL path names a special menu, else None."""
    m = SPECIAL_MENU_RE.search(unquote(urlparse(url).path).lower())
    return re.sub(r"[-_ ]+", " ", m.group(1)) if m else None


def menu_date(url: str) -> date | None:
    """Apparent date of a menu file from its URL: an upload timestamp in the path (Squarespace's
    /1647977531864/), a WordPress /uploads/YYYY/MM/ folder, or a date / year in the file name.
    The latest one wins."""
    path = unquote(urlparse(url or "").path)
    name = path.rsplit("/", 1)[-1]
    found: list[date] = []
    for m in re.finditer(r"(?<!\d)(1[3-9]\d{11})(?!\d)", path):  # epoch milliseconds, 2011-2033
        found.append(datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).date())
    for m in re.finditer(r"/uploads/(20\d\d)/(0[1-9]|1[0-2])/", path):
        found.append(date(int(m.group(1)), int(m.group(2)), 1))
    dated = False
    for m in re.finditer(r"(?<!\d)(0?[1-9]|1[0-2])[._-](0?[1-9]|[12]\d|3[01])[._-](20\d\d|\d\d)(?!\d)", name):
        y = int(m.group(3))
        try:
            found.append(date(y + 2000 if y < 100 else y, int(m.group(1)), int(m.group(2))))
            dated = True
        except ValueError:
            pass
    if not dated:
        for m in re.finditer(r"(?<!\d)(20[1-3]\d)(?!\d)", name):
            found.append(date(int(m.group(1)), 12, 31))  # a bare year: its last day
    return max(found) if found else None


def maybe_pdf(url: str) -> bool:
    """A .pdf, or a file on a site builder's CDN that may be one (reserve OCR credits for it)."""
    return bool(re.search(r"\.pdf($|[?#])", url or "", re.I)) or _any_host(host_of(url), SITE_CDNS)


MAP_URL_REGEX = r"(?i)(menu|food|dinner|lunch|brunch|\.pdf)"
# Whole path words only (plurals ok, and joined forms like /dessertmenu, /happyhour), so
# 'seventh' is not 'event' and 'espresso' is not 'press'.
_MENU_NEGATIVE = re.compile(
    r"(?<![a-z])(?:drink|wine|cocktail|beverage|bar-menu|beer|dessert|happy|catering|private|event|part(?:y|ie)|"
    r"kid|gift|press|career|job|holiday|valentine|thanksgiving|christmas|easter|mother|father|new-?year|"
    r"restaurant-?week|prix|tasting|wedding|group|allergen|nutrition)(?:e?s)?(?=menu|list|hour|[^a-z]|$)"
)


def pick_menu_urls(map_data: dict | None, home_url: str, target, limit: int = 2) -> list[str]:
    """Best menu-looking pages on the same site from a Map URLs response."""
    home = host_of(home_url)
    home_base = home.split(".", 1)[-1] if home.count(".") > 1 else home
    loc_tokens = set()
    for s in (target.rep.get("csv_neighborhood"), target.rep.get("neighborhood")):
        loc_tokens.update(t for t in slugify(s).split("-") if len(t) >= 4)
    _, street = _rep_building(target.rep)
    if street:
        loc_tokens.add(street)
    scored = []
    seen: set[str] = set()
    for u in (map_data or {}).get("urls") or []:
        url = u.get("url") if isinstance(u, dict) else u
        if not url or not url.startswith("http"):
            continue
        url = clean_url(url)
        h = host_of(url)
        if not (h == home or h.endswith("." + home_base) or h == home_base):
            continue
        k = url_key(url)
        if k in seen or k.rstrip("/") == url_key(home_url).rstrip("/"):
            continue
        seen.add(k)
        p = unquote(urlparse(url).path).lower()
        if "menu" in p:
            s = 10.0
        elif p.endswith(".pdf"):
            s = 6.0
        elif re.search(r"food|dinner|lunch", p):
            s = 5.0
        else:
            continue
        if re.search(r"dinner|all-?day|food|main", p):
            s += 4
        if "brunch" in p:
            s += 1
        elif "lunch" in p:
            s += 2
        if _MENU_NEGATIVE.search(p):
            s -= 12
        s += 3 * sum(1 for t in loc_tokens if t in p)
        s -= len(p) / 100
        if s > 0:
            scored.append((-s, url))
    scored.sort()
    return [u for _, u in scored[:limit]]


def _distinctive(n: str) -> str:
    """A normalized name without generic words ('king' for 'burger king'); the name itself if
    nothing else is left ('burger joint')."""
    return " ".join(t for t in n.split() if t not in GENERIC_WORDS) or n


def same_restaurant(target, page_name: str | None) -> bool:
    """Loose check that an extracted page name belongs to the target (generic words like
    'burger' or 'bar' do not count: 'Burger City' is not 'Burger King')."""
    if not page_name:
        return True
    pn = _distinctive(norm_name(page_name))
    if not pn:
        return True
    for n in _names(target):
        n = _distinctive(n)
        if fuzz.token_set_ratio(n, pn) >= 60 or fuzz.partial_ratio(n, pn) >= 80:
            return True
    return False
