"""Chain grouping and scrape targets.

A chain is priced once: one NYC menu source is resolved + scraped per brand and its
burgers are applied to every location. Everything else is one target per restaurant.
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


def _c(slug: str, display: str, pattern: str, official_has_prices: bool = True) -> ChainDef:
    return ChainDef(slug, display, re.compile(pattern), official_has_prices)


# Patterns match norm_name(strip_store_number(dba)) — lowercase, apostrophes dropped, '&' -> 'and'.
CURATED_CHAINS: tuple[ChainDef, ...] = (
    _c("mcdonalds", "McDonald's", r"^mc ?donalds\b", False),
    _c("burger-king", "Burger King", r"^burger king\b", False),  # incl. 'BURGER KING, POPEYES'
    _c("shake-shack", "Shake Shack", r"^shake shack\b", False),
    _c("wendys", "Wendy's", r"^wendys\b", False),
    _c("white-castle", "White Castle", r"^white castle\b", False),
    _c("7th-street-burger", "7th Street Burger", r"^7th street burger\b"),
    _c("checkers", "Checkers", r"^checkers\b", False),
    _c("five-guys", "Five Guys", r"^five guys\b", False),  # incl. FIVE GUYS FAMOUS BURGERS AND FRIES
    _c("jimbos-hamburger-palace", "Jimbo's Hamburger Palace", r"^(the )?(famous )?jimbos hamburger"),
    _c("bareburger", "Bareburger", r"^bareburger\b"),
    _c("smashburger", "Smashburger", r"^smashburger\b", False),
    _c("jackson-hole", "Jackson Hole", r"^jackson hole\b"),
    _c("sonic", "Sonic Drive-In", r"^sonic( drive ?in)?$", False),
    _c("black-tap", "Black Tap", r"^black tap\b"),
    _c("bills-bar-and-burger", "Bill's Bar & Burger", r"^bills bar and burger\b"),
    _c("5-napkin-burger", "5 Napkin Burger", r"^5 napkin burger\b"),
    _c("burger-joint", "Burger Joint", r"^burger joint$"),
    _c("harlem-shake", "Harlem Shake", r"^harlem shake\b"),
    _c("burgerfi", "BurgerFi", r"^burgerfi\b", False),
    _c("fatburger", "Fatburger", r"^fatburger\b", False),
    _c("johnny-rockets", "Johnny Rockets", r"^johnny rockets\b", False),
    _c("applebees", "Applebee's", r"^applebees\b", False),
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
    nn = re.sub(r"\s+\d+$", "", nn)  # 'shake shack 1692'
    return nn, None


@dataclass
class ChainGroup:
    slug: str
    display: str
    official_has_prices: bool
    members: list[dict] = field(default_factory=list)


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
            chains[cd.slug] = ChainGroup(cd.slug, cd.display, cd.official_has_prices, list(members))
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
    csv_urls: list[tuple[str, str]]  # (url, origin) from the pilot CSV, in priority order
    official_has_prices: bool = True

    @property
    def search_names(self) -> list[str]:
        names = [self.name, self.rep.get("name"), self.rep.get("csv_name")]
        if self.rep.get("dba"):
            names.append(display_name(self.rep["dba"]))
        return [n for n in dict.fromkeys(n for n in names if n)]


def choose_rep(members: list[dict]) -> dict:
    csv_members = [m for m in members if m.get("csv")]
    with_urls = [m for m in csv_members if m.get("menu_url") or m.get("website")]
    if with_urls:
        return with_urls[0]
    if csv_members:
        return csv_members[0]
    return sorted(
        members,
        key=lambda m: (m["borough"] != "Manhattan", m.get("address") is None, m.get("lat") is None, m.get("camis") or ""),
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
            targets.append(Target(
                key=f"chain:{slug}", name=g.display, chain=slug, members=g.members, rep=choose_rep(g.members),
                csv_urls=_csv_urls(g.members), official_has_prices=g.official_has_prices,
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
