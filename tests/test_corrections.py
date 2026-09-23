import json

import pytest
from conftest import rec

from pipeline import build, corrections
from pipeline.chains import build_targets


def b(name, price, protein="beef", period=None):
    return {"name": name, "price": price, "description": None, "protein": protein, "menu_period": period}


def scraped(*burgers, status="priced"):
    return {"status": status, "status_detail": "Scraped.", "menu_url": "https://agg.example/menu",
            "price_source": "menu_aggregator", "website": None, "scraped_at": "2026-09-01T12:00:00Z",
            "burgers": list(burgers)}


def fix(**kw):
    return {"target": "camis:1", "checked_at": "2026-09-23", "source_url": "https://place.example/menus",
            "reason": "the aggregator copy was stale.", **kw}


def test_set_drop_add_recompute_index_and_label_the_source():
    res = scraped(b("Burger", 16, period="lunch"), b("Sliders", 9), b("Veggie", 14, "veggie"))
    out = corrections.apply_one(res, fix(set={"burger": {"price": 24, "menu_period": "dinner"}}, drop=["Sliders"],
                                         add=[{"name": "Smash", "price": 12, "protein": "beef"}],
                                         price_source="official_site"))
    assert [(x["name"], x["price"]) for x in out["burgers"]] == [("Burger", 24), ("Veggie", 14), ("Smash", 12)]
    assert out["status"] == "priced" and out["menu_url"] == "https://place.example/menus"
    assert out["price_source"] == "official_site" and out["scraped_at"] == "2026-09-23T16:00:00Z"
    assert out["status_detail"].startswith("Scraped. Prices corrected by hand after re-checking the menu on 2026-09-23")
    assert res["burgers"][0]["price"] == 16  # input left untouched


def test_withhold_publishes_no_prices():
    out = corrections.apply_one(scraped(b("Waverly Burger", 13)), fix(withhold=True))
    assert out["status"] == "no_prices" and out["burgers"][0]["price"] is None
    assert "Prices withheld" in out["status_detail"]


def test_stale_corrections_fail_loudly():
    with pytest.raises(corrections.CorrectionError, match="not in the scraped menu"):
        corrections.apply_one(scraped(b("Burger", 16)), fix(drop=["Sliders"]))
    with pytest.raises(corrections.CorrectionError, match="already in the scraped menu"):
        corrections.apply_one(scraped(b("Burger", 16)), fix(add=[{"name": "burger", "price": 1, "protein": "beef"}]))
    with pytest.raises(corrections.CorrectionError, match="more than one"):
        corrections.apply({}, [fix(), fix()])


def test_unscraped_target_is_skipped_and_assemble_applies_corrections():
    assert corrections.apply({}, [fix(withhold=True)]) == {}
    ts = build_targets([rec("Place", camis="1"), rec("Other", camis="2")])
    results = {ts[0].key: scraped(b("Burger", 16, period="lunch")), ts[1].key: scraped(b("Classic", 20))}
    d = build.assemble(ts, results, generated_at="2026-09-23T12:00:00Z",
                       corrections=[fix(target=ts[0].key, set={"Burger": {"price": 24, "menu_period": "dinner"}})])
    place = next(r for r in d["restaurants"] if r["name"] == "Place")
    assert place["index_price"] == 24 and place["menu_url"] == "https://place.example/menus"
    assert d["stats"]["index_median"] == 22
    build.validate(d)


def test_committed_corrections_file_is_well_formed():
    entries = corrections.load()
    assert entries and len({c["target"] for c in entries}) == len(entries)
    allowed = {"target", "checked_at", "source_url", "price_source", "reason", "drop", "set", "add", "withhold"}
    for c in entries:
        assert set(c) <= allowed and {"target", "checked_at", "source_url", "reason"} <= set(c), c["target"]
        assert c["source_url"].startswith("https://")
        for a in c.get("add", []):
            assert a["protein"] in ("beef", "chicken", "turkey", "fish", "veggie", "lamb", "pork", "other")
    json.dumps(entries)
