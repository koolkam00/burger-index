"""Offline tests: the Context.dev wrapper is mocked, no credits spent."""

import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import context_client  # noqa: E402
import menu_index  # noqa: E402

ROWS = [
    {"name": "A", "neighborhood": "West Village", "borough": "Manhattan", "website": "https://a.test", "menu_url": "https://a.test/menu", "notes": ""},
    {"name": "B", "neighborhood": "West Village", "borough": "Manhattan", "website": "unknown", "menu_url": "", "notes": ""},
    {"name": "C", "neighborhood": "Williamsburg", "borough": "Brooklyn", "website": "https://c.test", "menu_url": "", "notes": ""},
]


def fake_extract(url, max_age_ms=None):
    if url == "https://a.test/menu":
        return {"burgers": [
            {"name": "Classic", "price": 18, "is_beef": True},
            {"name": "Double", "price": 24, "is_beef": True},
            {"name": "Veggie", "price": 15, "is_beef": False},
        ]}
    raise context_client.ContextDevError("HTTP 422")


def test_build_index():
    with mock.patch.object(context_client, "extract_burger_menu", side_effect=fake_extract) as m:
        idx = menu_index.build_index(ROWS)
    assert [c.args[0] for c in m.call_args_list] == ["https://a.test/menu", "https://c.test"]
    a, b, c = idx["results"]
    assert a["index_price"] == 18  # cheapest beef burger, veggie ignored
    assert b["error"] == "no menu or website url"
    assert "422" in c["error"]
    assert idx["by_neighborhood"] == {"West Village": {"n": 1, "median": 18, "mean": 18}}


def test_index_price_ignores_missing_prices():
    assert menu_index.index_price([{"name": "x", "price": None, "is_beef": True}]) is None
