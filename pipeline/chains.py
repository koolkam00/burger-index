"""Chain grouping and scrape targets.

A chain is priced once: one NYC menu source is resolved + scraped per brand and its
burgers are applied to every location (except airport concessions, which price
differently). Everything else is one target per restaurant.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .names import display_name, norm_name, slugify, strip_store_number


@dataclass(frozen=True)
class ChainDef:
    slug: str
    display: str
    pattern: re.Pattern
    # False for chains whose own site shows no prices without picking a store (skip it).
    official_has_prices: bool = True
    # The chain's cheapest regular burger as norm_name() words. A delivery-app page without it
    # is treated as a partial (lazy-loaded) menu and the target keeps looking.
    cheapest_item: str | None = None
    # A known-good NYC menu page to scrape first (e.g. a full store page on Grubhub).
    menu_url: str | None = None
    # National fast-food chain: left out of the index entirely (product decision 2026-09-23), and so is
    # the NY-area fast-food chain Tex's / Texas Chicken & Burgers; NYC's own small chains (7th Street
    # Burger, Jackson Hole, Black Tap...) stay. See is_national_chain().
    national: bool = False


def _c(slug: str, display: str, pattern: str, official_has_prices: bool = True, *, cheapest_item: str | None = None,
       menu_url: str | None = None, national: bool = False) -> ChainDef:
    return ChainDef(slug, display, re.compile(pattern), official_has_prices, cheapest_item, menu_url, national)


# Patterns match norm_name(strip_store_number(dba)) — lowercase, apostrophes dropped, '&' -> 'and'.
CURATED_CHAINS: tuple[ChainDef, ...] = (
    _c("mcdonalds", "McDonald's", r"^mc ?donalds\b", False, cheapest_item="hamburger", national=True),
    _c("burger-king", "Burger King", r"^burger king\b", False, cheapest_item="hamburger", national=True),  # incl. 'BURGER KING, POPEYES'
    _c("shake-shack", "Shake Shack", r"^shake shack\b", False, national=True),
    _c("wendys", "Wendy's", r"^wendys\b", False, cheapest_item="jr hamburger", national=True),
    _c("white-castle", "White Castle", r"^white castle\b", False, cheapest_item="original slider", national=True),
    _c("7th-street-burger", "7th Street Burger", r"^7th street burger\b"),
    _c("checkers", "Checkers", r"^checkers\b", False, national=True),
    _c("five-guys", "Five Guys", r"^five guys\b", False, cheapest_item="little hamburger", national=True),  # incl. FIVE GUYS FAMOUS BURGERS AND FRIES
    _c("jimbos-hamburger-palace", "Jimbo's Hamburger Palace", r"^(the )?(famous )?jimbos hamburger"),
    _c("bareburger", "Bareburger", r"^bareburger\b"),
    _c("smashburger", "Smashburger", r"^smashburger\b", False, national=True),
    _c("jackson-hole", "Jackson Hole", r"^jackson hole\b"),
    _c("sonic", "Sonic Drive-In", r"^sonic( drive ?in)?$", False, national=True),
    _c("black-tap", "Black Tap", r"^black tap\b"),
    _c("bills-bar-and-burger", "Bill's Bar & Burger", r"^bills bar and burger\b"),
    _c("5-napkin-burger", "5 Napkin Burger", r"^5 napkin burger\b"),
    _c("burger-joint", "Burger Joint", r"^burger joint$"),
    _c("harlem-shake", "Harlem Shake", r"^harlem shake\b"),
    _c("burgerfi", "BurgerFi", r"^burgerfi\b", False, national=True),
    _c("fatburger", "Fatburger", r"^fatburger\b", False, national=True),
    _c("johnny-rockets", "Johnny Rockets", r"^johnny rockets\b", False, national=True),
    _c("applebees", "Applebee's", r"^applebees\b", False, national=True),
)
# More national burger/fast-food and casual-dining brands, so widening --cuisines (American,
# Steakhouse...) or a bigger restaurant list never lets them in. Not grouped as chains here (they're
# excluded before grouping); patterns match norm_name() like the list above. Only checked when no
# curated pattern matched, so a slug shared with a curated chain merges its report counts.
# Deliberately NOT here (user decisions, 2026-09-23): NYC-born or NY-area groups (Burgerology,
# Nathan's, Black Tap), national upscale / sit-down restaurants (Del Frisco's, Smith & Wollensky, STK,
# Hillstone, Burger & Lobster, and the like: Capital Grille, Morton's...) and the Swingers and Puttery
# venues all stay. Tex's / Texas Chicken & Burgers is NY-area but fast food (~35 NYC permits), so it
# goes like the national fast-food chains.
NATIONAL_ONLY: tuple[ChainDef, ...] = tuple(
    _c(slug, display, pattern, False, national=True) for slug, display, pattern in (
        # stands whose DBA doesn't start with the brand: 'CITI FIELD SHAKE SHACK - STAND 139',
        # 'BROOKLYN DELI CB24/SHAKE SHACK CB26', 'DUNKIN (38CC)/ SHAKE SHACK (40CC) POST GATE 22'
        ("shake-shack", "Shake Shack", r"\bshake shack\b"),
        ("wayback-burgers", "Wayback Burgers", r"^wayback burgers?\b"),
        ("red-robin", "Red Robin", r"^red robin\b"),
        ("carls-jr", "Carl's Jr.", r"^carls jr\b"),
        ("steak-n-shake", "Steak 'n Shake", r"^steak ?n ?shake\b"),
        ("habit-burger", "The Habit Burger Grill", r"^(the )?habit burger\b"),
        ("jack-in-the-box", "Jack in the Box", r"^jack in the box\b"),
        ("whataburger", "Whataburger", r"^whataburger\b"),
        ("in-n-out", "In-N-Out Burger", r"^in ?n ?out\b"),
        ("culvers", "Culver's", r"^culvers\b"),
        ("umami-burger", "Umami Burger", r"^umami burger\b"),  # not 'UMAMI SUSHI'
        ("cheeburger", "Cheeburger Cheeburger", r"^cheeburger\b"),
        ("plnt-burger", "PLNT Burger", r"^plnt burger\b"),
        ("slutty-vegan", "Slutty Vegan", r"^slutty ?vegan\b"),
        ("next-level-burger", "Next Level Burger", r"^next level burger\b"),
        ("jollibee", "Jollibee", r"^jollibee\b"),
        ("arbys", "Arby's", r"^arbys\b"),
        ("tgi-fridays", "TGI Fridays", r"^t ?g ?i fridays?\b"),
        ("chilis", "Chili's", r"^chilis\b"),
        ("ihop", "IHOP", r"^ihop\b"),
        ("dennys", "Denny's", r"^dennys( restaurant)?$"),  # not "DENNY'S PUB"
        ("perkins", "Perkins", r"^perkins restaurant\b"),
        ("buffalo-wild-wings", "Buffalo Wild Wings", r"^buffalo wild wings\b"),
        ("hooters", "Hooters", r"^hooters\b"),
        ("dave-and-busters", "Dave & Buster's", r"^dave and busters?\b"),
        ("outback", "Outback Steakhouse", r"^outback steakhouse\b"),
        ("longhorn", "LongHorn Steakhouse", r"^longhorn steakhouse\b"),
        ("cheesecake-factory", "The Cheesecake Factory", r"^(the )?cheesecake factory\b"),
        ("hard-rock-cafe", "Hard Rock Cafe", r"^hard rock cafe\b"),
        ("planet-hollywood", "Planet Hollywood", r"^planet hollywood\b"),
        ("bubba-gump", "Bubba Gump Shrimp Co.", r"^bubba gump\b"),
        ("margaritaville", "Margaritaville", r"^(jimmy buffetts )?margaritaville\b"),
        ("yard-house", "Yard House", r"^yard house\b"),
        ("millers-ale-house", "Miller's Ale House", r"^millers ale house\b"),
        ("uno", "Uno Pizzeria & Grill", r"^(pizzeria )?uno (chicago grill|pizzeria)\b"),  # not 'UNO OF ASTORIA'
        # TEX'S CHICKEN & BURGERS, TEX*S CHICKEN & BURGERS, TEXAS CHICKEN & BURGER(S), TEX'S CHICKEN AND
        # BURGER; not Tex-Mex places, NEW TEXAS FRIED CHICKEN or NEW TEXAS CHICKEN & GRILL
        ("texas-chicken-and-burgers", "Tex's Chicken & Burgers", r"^(texas|tex ?s) chicken (and )?burgers?\b"),
    )
)
MIN_AUTO_LOCATIONS = 3
MIN_CURATED_LOCATIONS = 2


def brand_of(rec: dict) -> tuple[str, ChainDef | None]:
    """(brand key, curated def) for a restaurant record. Uses the DOHMH dba when matched."""
    names = [n for n in (rec.get("dba"), rec.get("csv_name"), rec.get("name")) if n]
    for n in names:
        nn = norm_name(strip_store_number(n))
        for cd in CURATED_CHAINS:
            if cd.pattern.search(nn):
                return cd.slug, cd
    nn = norm_name(strip_store_number(names[0])) if names else ""
    nn = re.sub(r"^the ", "", nn)
    nn = re.sub(r"\s+\d{3,}$", "", nn)  # store numbers: 'shake shack 1692' (not 'pier 17')
    return nn, None


def is_national_chain(rec: dict) -> ChainDef | None:
    """The national chain this restaurant belongs to, or None (independents and NYC's own chains).
    Checks the DOHMH dba first, then the pilot-list name (see brand_of)."""
    _, cd = brand_of(rec)
    if cd is not None:
        return cd if cd.national else None
    for n in (rec.get("dba"), rec.get("csv_name"), rec.get("name")):
        if n:
            nn = norm_name(strip_store_number(n))
            for nd in NATIONAL_ONLY:
                if nd.pattern.search(nn):
                    return nd
    return None


@dataclass
class ChainGroup:
    slug: str
    display: str
    official_has_prices: bool
    members: list[dict] = field(default_factory=list)
    cheapest_item: str | None = None
    menu_url: str | None = None


def group_chains(
    restaurants: list[dict], *, min_auto: int = MIN_AUTO_LOCATIONS, min_curated: int = MIN_CURATED_LOCATIONS
) -> dict[str, ChainGroup]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    defs: dict[str, ChainDef] = {}
    for r in restaurants:
        key, cd = brand_of(r)
        if not key:
            continue
        buckets[key].append(r)
        if cd:
            defs[key] = cd
    chains: dict[str, ChainGroup] = {}
    for key, members in buckets.items():
        cd = defs.get(key)
        if cd and len(members) >= min_curated:
            chains[cd.slug] = ChainGroup(cd.slug, cd.display, cd.official_has_prices, list(members), cd.cheapest_item,
                                         cd.menu_url)
        elif not cd and len(members) >= min_auto:
            slug = slugify(key)
            names = Counter(display_name(m.get("dba") or m["name"]) for m in members)
            display = sorted(names.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
            chains[slug] = ChainGroup(slug, display, True, list(members))
    return chains


@dataclass
class Target:
    """One unit of discover+scrape work: a single restaurant or a whole chain."""

    key: str
    name: str
    chain: str | None
    members: list[dict]
    rep: dict  # location used for the search query and the "different location" check
    csv_urls: list[tuple[str, str]]  # (url, origin) from the restaurant list CSV (or a pinned chain menu), in priority order
    official_has_prices: bool = True
    cheapest_item: str | None = None  # curated chains: see ChainDef.cheapest_item

    @property
    def search_names(self) -> list[str]:
        names = [self.name, self.rep.get("name"), self.rep.get("csv_name")]
        if self.rep.get("dba"):
            names.append(display_name(self.rep["dba"]))
        return [n for n in dict.fromkeys(n for n in names if n)]


AIRPORT_ZIPS = {"11430", "11371"}  # JFK, LaGuardia
_AIRPORT_RE = re.compile(r"\b(jfk|laguardia|la guardia|airport)\b")


def is_airport(rec: dict) -> bool:
    """An airport concession (JFK / LaGuardia): its prices are not the chain's street prices."""
    text = norm_name(f"{rec.get('address') or ''} {rec.get('dba') or ''}")
    if rec.get("zipcode") in AIRPORT_ZIPS or _AIRPORT_RE.search(text):
        return True
    return rec.get("borough") == "Queens" and bool(re.search(r"\bterminal\b", text))


def choose_rep(members: list[dict]) -> dict:
    csv_members = [m for m in members if m.get("csv")]
    with_urls = [m for m in csv_members if m.get("menu_url") or m.get("website")]
    if with_urls:
        return with_urls[0]
    if csv_members:
        return csv_members[0]
    return sorted(
        members,
        key=lambda m: (is_airport(m), m["borough"] != "Manhattan", m.get("address") is None, m.get("lat") is None,
                       m.get("camis") or ""),
    )[0]


def _csv_urls(members: list[dict]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for m in members:
        if not m.get("csv"):
            continue
        if m.get("menu_url"):
            out.append((m["menu_url"], "csv menu_url"))
        if m.get("website"):
            out.append((m["website"], "csv website"))
    seen: set[str] = set()
    return [(u, o) for u, o in out if not (u in seen or seen.add(u))]


def build_targets(restaurants: list[dict], chains: dict[str, ChainGroup] | None = None) -> list[Target]:
    """Targets in restaurant order (CSV rows first); a chain appears at its first member."""
    chains = group_chains(restaurants) if chains is None else chains
    member_chain = {m["key"]: slug for slug, g in chains.items() for m in g.members}
    targets: list[Target] = []
    emitted: set[str] = set()
    for r in restaurants:
        slug = member_chain.get(r["key"])
        if slug:
            if slug in emitted:
                continue
            emitted.add(slug)
            g = chains[slug]
            pinned = [(g.menu_url, "chain menu_url")] if g.menu_url else []
            targets.append(Target(
                key=f"chain:{slug}", name=g.display, chain=slug, members=g.members, rep=choose_rep(g.members),
                csv_urls=pinned + [(u, o) for u, o in _csv_urls(g.members) if u != g.menu_url],
                official_has_prices=g.official_has_prices, cheapest_item=g.cheapest_item,
            ))
        else:
            targets.append(Target(key=r["key"], name=r["name"], chain=None, members=[r], rep=r, csv_urls=_csv_urls([r])))
    return targets


def select_targets(targets: list[Target], *, only: list[str] | None = None, limit: int | None = None) -> list[Target]:
    """--only: exact (normalized) name/key match wins; otherwise substring match (>= 4 chars)."""
    out = targets
    if only:
        def hay(t: Target) -> list[str]:
            h = [norm_name(t.name), t.key.lower()] + [norm_name(m.get("name")) for m in t.members]
            return h + [norm_name(m.get("csv_name")) for m in t.members if m.get("csv_name")]

        picked: set[str] = set()
        for needle in (norm_name(o) for o in only if o.strip()):
            exact = [t.key for t in targets if needle in hay(t)]
            fuzzy = [t.key for t in targets if len(needle) >= 4 and any(needle in h for h in hay(t))]
            picked.update(exact or fuzzy)
        out = [t for t in out if t.key in picked]
    if limit is not None:
        out = out[: max(0, limit)]
    return out
