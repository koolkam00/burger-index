"""Shared fixtures. Everything is offline: pipeline.context_client.execute is replaced by
FakeContext, so no test can reach the live Context.dev API or spend credits."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import context_client  # noqa: E402
from pipeline.sources import load_nta_map  # noqa: E402


@pytest.fixture(autouse=True)
def _no_live_api(monkeypatch):
    """Belt and braces: any un-mocked call to the SDK fails the test."""

    def boom(*a, **k):
        raise AssertionError("test tried to call the live Context.dev API")

    monkeypatch.setattr(context_client, "execute", boom)
    monkeypatch.setattr(context_client, "_client", boom)


@pytest.fixture
def nta_map():
    return load_nta_map()


def rec(name, *, camis=None, borough="Manhattan", nta="MN23", neighborhood="West Village", address=None,
        csv=False, website=None, menu_url=None, dba=None, lat=40.73, lng=-74.0, cuisine="Hamburgers", zipcode="10014"):
    """A restaurant record as produced by pipeline.sources."""
    return {
        "key": f"camis:{camis}" if camis else f"csv:{name.lower().replace(' ', '-')}",
        "camis": camis, "dba": dba if dba is not None else (name.upper() if camis else None), "name": name,
        "address": address, "borough": borough, "zipcode": zipcode, "lat": lat, "lng": lng, "nta": nta,
        "neighborhood": neighborhood, "nta_source": "dohmh", "cuisine": cuisine, "last_inspection": "2026-01-01",
        "website": website, "menu_url": menu_url, "csv": csv, "csv_name": name if csv else None,
        "csv_neighborhood": neighborhood if csv else None, "csv_notes": None, "match": None,
    }


class FakeContext:
    """Stand-in for context_client.execute with scripted search / map / scrape answers.

    search: {query substring: [result dicts]}
    maps:   {domain: [urls]}
    pages:  {url: extraction dict | Exception | ("error", status, code)}
    """

    def __init__(self, search=None, maps=None, pages=None, scrape_credits=5):
        self.search = search or {}
        self.maps = maps or {}
        self.pages = pages or {}
        self.scrape_credits = scrape_credits
        self.calls: list[tuple[str, dict]] = []

    def count(self, endpoint):
        return sum(1 for e, _ in self.calls if e == endpoint)

    def __call__(self, endpoint, request, *, max_age_ms=None):
        self.calls.append((endpoint, request))
        if endpoint == "search":
            results = []
            for k, v in self.search.items():
                if k in request["query"]:
                    results = v
            return {"data": {"query": request["query"], "results": results}, "credits": 1, "error": None, "rate": {}}
        if endpoint == "map":
            urls = self.maps.get(request["domain"], [])
            return {"data": {"domain": request["domain"], "success": True, "urls": [{"url": u} for u in urls]},
                    "credits": 1, "error": None, "rate": {}}
        if endpoint == "scrape":
            page = self.pages.get(request["url"])
            if isinstance(page, Exception):
                raise page
            if page is None:
                return {"data": None, "credits": 1, "error": {"status": 404, "code": "WEBSITE_NOT_FOUND", "message": "nope"}, "rate": {}}
            if isinstance(page, tuple):
                _, status, code = page
                return {"data": None, "credits": 1, "error": {"status": status, "code": code, "message": code}, "rate": {}}
            return {"data": {"url": request["url"], "json": {"requested": True, "data": page}},
                    "credits": self.scrape_credits, "error": None, "rate": {"limit": 300, "remaining": 250, "reset": 0}}
        raise AssertionError(endpoint)


def menu(*burgers, is_menu=True, has_prices=True, restaurant_name=None):
    """Extraction JSON as the scrape JSON extractor returns it."""
    return {
        "is_menu": is_menu, "has_prices": has_prices, "restaurant_name": restaurant_name,
        "burgers": [
            {"name": b[0], "price": b[1], "protein": b[2] if len(b) > 2 else "beef",
             **({"menu_period": b[3]} if len(b) > 3 else {})}
            for b in burgers
        ],
    }


@pytest.fixture
def fake(monkeypatch):
    def install(**kw):
        f = FakeContext(**kw)
        monkeypatch.setattr(context_client, "execute", f)
        return f

    return install
