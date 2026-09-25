"""Typed mirror of contract/burger_index.schema.json (the output contract).

Keep in sync with the schema and web/src/lib/schema.ts. The build validates every
dataset against the JSON Schema itself before writing, so drift fails loudly.
"""

from __future__ import annotations

from typing import Literal, Optional, TypedDict

Borough = Literal["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]
Protein = Literal["beef", "chicken", "turkey", "fish", "veggie", "lamb", "pork", "other"]
Status = Literal["priced", "no_burgers", "no_prices", "no_menu_found", "error"]
PriceSource = Literal["official_site", "official_pdf", "online_ordering", "delivery_app", "menu_aggregator"]


class Burger(TypedDict):
    """A restaurant's one published burger: its highest-priced eligible beef burger (extract.top_item)."""

    id: str  # '<restaurant id>--<item slug>'
    name: str
    price: Optional[float]
    description: Optional[str]
    protein: Protein
    is_index_item: bool


class Restaurant(TypedDict):
    id: str
    camis: Optional[str]
    name: str
    chain: Optional[str]
    address: Optional[str]
    borough: Borough
    neighborhood: Optional[str]
    neighborhood_slug: Optional[str]
    zipcode: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    cuisine: Optional[str]
    website: Optional[str]
    menu_url: Optional[str]
    price_source: Optional[PriceSource]
    status: Status
    status_detail: Optional[str]
    scraped_at: Optional[str]
    index_price: Optional[float]
    burgers: list[Burger]  # at most one: the index item (empty unless priced)


class AreaSummary(TypedDict):
    slug: str
    name: str
    borough: Borough
    restaurants: int
    restaurants_priced: int
    burgers: int
    index_median: Optional[float]
    index_min: Optional[float]
    index_max: Optional[float]


class Stats(TypedDict):
    restaurants_scanned: int
    restaurants_priced: int
    burgers: int
    beef_burgers: int
    index_median: Optional[float]
    index_mean: Optional[float]
    index_p10: Optional[float]
    index_p90: Optional[float]
    all_burgers_median: Optional[float]
    cheapest_burger_id: Optional[str]
    priciest_burger_id: Optional[str]


class Methodology(TypedDict):
    index_price_rule: str
    sources: list[str]
    coverage_note: str


class BurgerIndex(TypedDict):
    version: Literal[1]
    generated_at: str
    currency: Literal["USD"]
    methodology: Methodology
    stats: Stats
    boroughs: list[AreaSummary]
    neighborhoods: list[AreaSummary]
    restaurants: list[Restaurant]
