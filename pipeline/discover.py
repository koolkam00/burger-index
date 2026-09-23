"""Menu-URL discovery: classify URLs, rank search results, pick menu pages from a site map.

Ranking (best first): official menu page / official PDF > official homepage (resolved to a
menu page with Map URLs) > online ordering > menu aggregators > delivery apps.
Rejected: social, review sites, news/blog articles, and results for a different location.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
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
    "menupages.com", "allmenus.com", "menuwithprice.com", "sirved.com", "grubhub.com", "seamless.com",
    "menucollectors.com", "menurestaurants.net", "menuweb.menu", "restaurantji.com", "singleplatform.com",
    "zmenu.com", "menuism.com", "cititour.com",
)
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
NON_NYC_PLACES = (
    "new jersey", "nj", "jersey city", "hoboken", "newark", "yonkers", "white plains", "westchester",
    r"long island(?! city)", "hempstead", "stamford", "connecticut", "philadelphia", "boston", "chicago",
    "los angeles", "miami", "las vegas", "san francisco", "washington dc", "atlanta", "houston", "dallas",
    "london", "toronto", "new haven", "albany", "buffalo",
)
BOROUGH_WORDS = {"Manhattan": "manhattan", "Brooklyn": "brooklyn", "Queens": "queens", "Bronx": "bronx",
                 "Staten Island": "staten island"}

# third_party: an unknown site whose domain is not the restaurant's but whose title names it
# (line trackers, gift cards, fan price lists). Tried last; priced as a menu aggregator.
TIERS = {"official_menu": 0, "official_pdf": 0, "official_home": 1, "online_ordering": 2,
         "menu_aggregator": 3, "delivery_app": 4, "third_party": 5}
OFFICIAL = {"official_menu", "official_pdf", "official_home"}
PRICE_SOURCE = {
    "official_menu": "official_site",
    "official_home": "official_site",
    "official_pdf": "official_pdf",
    "online_ordering": "online_ordering",
    "menu_aggregator": "menu_aggregator",
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
    """(category, reject reason). Categories: reject, delivery_app, menu_aggregator, official_pdf,
    online_ordering, official_menu, official_home."""
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


def domain_matches(target, url: str) -> bool:
    """Is this the restaurant's own domain? (duewestnyc.com for 'Due West')."""
    dom = _compact(host_of(url).rsplit(".", 1)[0])
    for n in _names(target):
        c = _compact(n)
        toks = n.split()
        if c and (c in dom or (len(dom) >= 5 and dom in c)):
            return True
        if len(toks) >= 2 and _compact(" ".join(toks[:2])) in dom:
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


def location_conflict(target, url: str, title: str, description: str, category: str) -> str | None:
    """Reason string when a platform result is for a different location, else None."""
    if category in OFFICIAL:
        return None
    rep = target.rep
    name_text = " ".join(_names(target))
    text = norm_name(f"{title} {description} {_url_words(url)}")
    for place in NON_NYC_PLACES:
        if re.search(rf"\b{place}\b", text) and not re.search(rf"\b{place}\b", name_text):
            return f"page is for a location outside NYC ({place.split('(')[0]})"
    ours = BOROUGH_WORDS.get(rep.get("borough") or "")
    if ours and not re.search(rf"\b{ours}\b", text):
        for b, w in BOROUGH_WORDS.items():
            if w != ours and re.search(rf"\b{w}\b", text) and w not in name_text:
                return f"page is for a {b} location"
    number, _street = _rep_building(rep)
    if number:
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


MAP_URL_REGEX = r"(?i)(menu|food|dinner|lunch|brunch|\.pdf)"
_MENU_NEGATIVE = re.compile(
    r"drink|wine|cocktail|beverage|bar-menu|beer|dessert|happy|catering|private|event|party|kids|gift|press|"
    r"career|job|holiday|valentine|thanksgiving|christmas|easter|mother|father|new-?year|restaurant-?week|prix|"
    r"tasting|wedding|group|allergen|nutrition"
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


def same_restaurant(target, page_name: str | None) -> bool:
    """Loose check that an extracted page name belongs to the target."""
    if not page_name:
        return True
    pn = norm_name(page_name)
    if not pn:
        return True
    for n in _names(target):
        if fuzz.token_set_ratio(n, pn) >= 60 or fuzz.partial_ratio(n, pn) >= 80:
            return True
    return False
