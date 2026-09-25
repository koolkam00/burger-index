import json
from datetime import date

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


def test_set_drop_add_recompute_index_and_record_the_hand_check():
    res = scraped(b("Burger", 16, period="lunch"), b("Sliders", 9), b("Veggie", 14, "veggie"))
    out = corrections.apply_one(res, fix(set={"burger": {"price": 24, "menu_period": "dinner"}}, drop=["Sliders"],
                                         add=[{"name": "Smash", "price": 12, "protein": "beef"}],
                                         price_source="official_site"))
    assert [(x["name"], x["price"]) for x in out["burgers"]] == [("Burger", 24), ("Veggie", 14), ("Smash", 12)]
    assert out["status"] == "priced" and out["menu_url"] == "https://place.example/menus"
    assert out["price_source"] == "official_site"
    assert out["hand_check"] == {"checked_on": "2026-09-23"}  # the site's "Prices corrected by hand" label
    assert res["burgers"][0]["price"] == 16 and "hand_check" not in res  # input left untouched


@pytest.mark.parametrize("scraped_source,kw,price_source", [
    # American Whiskey: own site scraped (sliders only); the Burger priced on Seamless is published
    ("official_site", {"source_url": "https://www.seamless.com/menu/american-whiskey/9190520",
                       "price_source": "delivery_app", "add": [{"name": "Burger", "price": 20.4, "protein": "beef"}]},
     "delivery_app"),
    # Boeuf & Bun: Uber Eats scraped; its own ordering page's prices set by hand
    ("delivery_app", {"source_url": "https://boeufbun.orders2me.com/order-now", "price_source": "online_ordering",
                      "set": {"Classic": 32}}, "online_ordering"),
    # another page of the same kind, no price_source given (Pipin's Pub: Uber Eats scraped, Postmates read)
    ("delivery_app", {"source_url": "https://postmates.com/store/pipins-pub/y",
                      "add": [{"name": "Beef Burger", "price": 18.95, "protein": "beef"}]}, "delivery_app"),
])
def test_the_corrections_page_is_the_menu_page(scraped_source, kw, price_source):
    res = scraped(b("Classic", 16))
    res["price_source"] = scraped_source
    out = corrections.apply_one(res, fix(**kw))
    assert (out["menu_url"], out["price_source"]) == (kw["source_url"], price_source)
    assert out["hand_check"] == {"checked_on": "2026-09-23"}


def test_withhold_publishes_no_prices_and_no_hand_check():
    out = corrections.apply_one(scraped(b("Waverly Burger", 13)), fix(withhold=True))
    assert out["status"] == "no_prices" and out["burgers"][0]["price"] is None
    assert out["hand_check"] is None  # unpriced: no page, so no label
    # a correction that leaves no priced beef burger records none either
    out = corrections.apply_one(scraped(b("Waverly Burger", 13), b("Veggie", 12, "veggie")),
                                fix(drop=["Waverly Burger"]))
    assert out["status"] == "no_burgers" and out["hand_check"] is None


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
    by = {r["name"]: r for r in d["restaurants"]}
    assert by["Place"]["index_price"] == 24 and by["Place"]["menu_url"] == "https://place.example/menus"
    assert by["Place"]["hand_check"] == {"checked_on": "2026-09-23"} and by["Other"]["hand_check"] is None
    assert d["stats"]["index_median"] == 22
    build.validate(d)


def test_committed_corrections_file_is_well_formed():
    entries = corrections.load()
    assert entries and len({c["target"] for c in entries}) == len(entries)
    allowed = {"target", "checked_at", "source_url", "price_source", "reason", "drop", "set", "add", "withhold"}
    for c in entries:
        assert set(c) <= allowed and {"target", "checked_at", "source_url", "reason"} <= set(c), c["target"]
        assert c["source_url"].startswith(("https://", "http://"))  # some aggregator pages are http only
        assert date.fromisoformat(c["checked_at"]).isoformat() == c["checked_at"], c["target"]  # hand_check.checked_on
        assert not (c.get("withhold") and (c.get("set") or c.get("add"))), c["target"]  # withheld: no hand prices
        for a in c.get("add", []):
            assert a["protein"] in ("beef", "chicken", "turkey", "fish", "veggie", "lamb", "pork", "other")
    json.dumps(entries)
