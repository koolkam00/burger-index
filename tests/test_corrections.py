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
    # the prices now come from the restaurant's own page, so the note names it, not the aggregator scraped
    assert out["status_detail"].startswith("Prices from the restaurant's own site (place.example). Prices corrected by "
                                           "hand after re-checking the menu on 2026-09-23")
    assert res["burgers"][0]["price"] == 16  # input left untouched


def test_a_correction_on_the_scraped_page_keeps_the_scrape_note():
    res = scraped(b("Burger", 16))
    res["status_detail"] = "Prices from a menu aggregator (agg.example). The menu file dates from May 2024."
    out = corrections.apply_one(res, fix(source_url="https://agg.example/menu#burgers", set={"Burger": 18}))
    assert out["status_detail"].startswith("Prices from a menu aggregator (agg.example). The menu file dates from "
                                           "May 2024. Prices corrected by hand")


@pytest.mark.parametrize("scraped_source,scraped_url,scraped_detail,kw,note", [
    # American Whiskey: own site scraped (sliders only); the Burger priced on Seamless is published
    ("official_site", "https://www.americanwhiskeynyc.com/popmenu-order/midtown/menus/food",
     "Prices from the restaurant's own site (americanwhiskeynyc.com).",
     {"source_url": "https://www.seamless.com/menu/american-whiskey/9190520", "price_source": "delivery_app",
      "add": [{"name": "Burger", "price": 20.4, "protein": "beef"}]},
     "Prices from a delivery app (seamless.com). Delivery-app prices usually run above in-store prices."),
    # Boeuf & Bun: Uber Eats scraped; its own ordering page's prices set by hand (the delivery note goes too)
    ("delivery_app", "https://www.ubereats.com/store/boeuf-and-bun/x",
     "Prices from a delivery app (ubereats.com). Delivery-app prices usually run above in-store prices.",
     {"source_url": "https://boeufbun.orders2me.com/order-now", "price_source": "online_ordering",
      "set": {"Classic": 32}},
     "Prices from an online-ordering page (boeufbun.orders2me.com)."),
    # the same host read as another kind of page (Tavern on Jane's .shop site: an online-ordering page)
    ("official_site", "https://tavernonjane.shop/menu", "Prices from the restaurant's own site (tavernonjane.shop).",
     {"source_url": "https://tavernonjane.shop/order", "price_source": "online_ordering", "set": {"Classic": 22}},
     "Prices from an online-ordering page (tavernonjane.shop)."),
    # another page of the same kind, no price_source given (Pipin's Pub: Uber Eats scraped, Postmates read);
    # the scrape's caveat about its own (partial) page goes with it
    ("delivery_app", "https://www.ubereats.com/store/pipins-pub/x",
     ("Prices from a delivery app (ubereats.com). Delivery-app prices usually run above in-store prices. The delivery "
      "page looked incomplete (only 1 priced beef burger on the page); no fuller menu was found."),
     {"source_url": "https://postmates.com/store/pipins-pub/y", "add": [{"name": "Beef Burger", "price": 18.95,
                                                                           "protein": "beef"}]},
     "Prices from a delivery app (postmates.com). Delivery-app prices usually run above in-store prices."),
])
def test_a_correction_from_another_page_names_that_page(scraped_source, scraped_url, scraped_detail, kw, note):
    res = scraped(b("Classic", 16))
    res.update(price_source=scraped_source, menu_url=scraped_url, status_detail=scraped_detail)
    out = corrections.apply_one(res, fix(**kw))
    assert out["status_detail"] == f"{note} Prices corrected by hand after re-checking the menu on 2026-09-23: " \
                                   "the aggregator copy was stale."
    assert out["menu_url"] == kw["source_url"] and out["price_source"] == kw.get("price_source", scraped_source)


def test_a_chain_keeps_its_source_location_sentence():
    res = scraped(b("Burger", 16))
    res["status_detail"] = ("Prices from a delivery app (ubereats.com). Delivery-app prices usually run above in-store "
                            "prices. Chain-level prices from one NYC location (113 Court Street, Brooklyn); prices may "
                            "vary by location.")
    out = corrections.apply_one(res, fix(price_source="official_site", set={"Burger": 18}))
    assert out["status_detail"].startswith(
        "Prices from the restaurant's own site (place.example). Chain-level prices from one NYC location (113 Court "
        "Street, Brooklyn); prices may vary by location. Prices corrected by hand")


def test_withheld_prices_keep_the_scrape_note():
    res = scraped(b("Cheeseburger Deluxe", 20.45))
    res["status_detail"] = "Prices from a delivery app (seamless.com). Delivery-app prices usually run above in-store prices."
    out = corrections.apply_one(res, fix(source_url="https://www.grubhub.com/restaurant/x/1", withhold=True))
    assert out["status_detail"].startswith(res["status_detail"] + " Prices withheld after re-checking")


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
        assert c["source_url"].startswith(("https://", "http://"))  # some aggregator pages are http only
        assert not (c.get("withhold") and (c.get("set") or c.get("add"))), c["target"]  # withheld: no hand prices
        for a in c.get("add", []):
            assert a["protein"] in ("beef", "chicken", "turkey", "fish", "veggie", "lamb", "pork", "other")
    json.dumps(entries)
