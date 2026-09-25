"""Typed mirror of contract/burger_index.schema.json (the output contract, version 2).

Keep in sync with the schema and web/src/lib/schema.ts. The build validates every
dataset against the JSON Schema itself before writing, so drift fails loudly.
"""

from __future__ import annotations

from typing import Literal, TypedDict

Borough = Literal["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]
PriceSource = Literal["official_site", "official_pdf", "online_ordering", "delivery_app", "menu_aggregator"]


class Burger(TypedDict):
    """A priced restaurant's one burger: its highest-priced eligible beef burger (extract.top_item).
    Its price is the restaurant's index_price."""

    name: str
    description: str | None


class HandCheck(TypedDict):
    checked_on: str  # YYYY-MM-DD the menu was re-checked (pipeline/corrections.py)


class PricedRestaurant(TypedDict):
    id: str
    name: str
    chain: str | None
    address: str | None
    borough: Borough
    neighborhood: str | None
    neighborhood_slug: str | None
    lat: float | None
    lng: float | None
    website: str | None
    menu_url: str
    price_source: PriceSource
    index_price: float
    burger: Burger
    hand_check: HandCheck | None


class UnpricedRestaurant(TypedDict):
    """No index price: the site lists only its name, on its neighborhood's page."""

    id: str
    name: str
    address: str | None
    neighborhood_slug: str | None
    index_price: None
    burger: None


Restaurant = PricedRestaurant | UnpricedRestaurant


class AreaSummary(TypedDict):
    slug: str
    name: str
    borough: Borough
    restaurants_priced: int
    index_median: float | None
    index_min: float | None
    index_max: float | None


class Stats(TypedDict):
    restaurants_priced: int
    index_median: float | None
    index_p10: float | None
    index_p90: float | None


class BurgerIndex(TypedDict):
    version: Literal[2]
    generated_at: str
    stats: Stats
    boroughs: list[AreaSummary]
    neighborhoods: list[AreaSummary]
    restaurants: list[Restaurant]
