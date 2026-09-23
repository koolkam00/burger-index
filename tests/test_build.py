import copy

import pytest
from conftest import rec

from pipeline import build
from pipeline.chains import build_targets


def result(status="priced", burgers=None, **kw):
    return {
        "status": status,
        "status_detail": kw.get("detail", "x"),
        "menu_url": kw.get("menu_url", "https://example.com/menu" if status != "no_menu_found" else None),
        "price_source": kw.get("price_source", "official_site" if status != "no_menu_found" else None),
        "website": kw.get("website"),
        "scraped_at": "2026-09-23T12:00:00Z" if status != "no_menu_found" else None,
        "burgers": burgers or [],
    }


def b(name, price, protein="beef"):
    return {"name": name, "price": price, "description": None, "protein": protein, "menu_period": None}


def dataset(targets, results):
    return build.assemble(targets, results, meta={"cuisines": ["Hamburgers"], "min_inspection_date": "2023-01-01"},
                          generated_at="2026-09-23T12:00:00Z")


def test_percentile_and_stats_math():
    assert build.percentile([], 0.1) is None
    assert build.percentile([10.0], 0.9) == 10.0
    assert build.percentile([10.0, 20.0, 30.0, 40.0, 50.0], 0.1) == pytest.approx(14.0)
    assert build.percentile([10.0, 20.0, 30.0, 40.0, 50.0], 0.9) == pytest.approx(46.0)

    rs = [rec("A", camis="1"), rec("B", camis="2"), rec("C", camis="3"), rec("D", camis="4")]
    ts = build_targets(rs)
    results = {
        ts[0].key: result(burgers=[b("Classic", 10), b("Veggie", 8, "veggie"), b("Double", 14)]),
        ts[1].key: result(burgers=[b("Smash", 20)]),
        ts[2].key: result(burgers=[b("Big", 30), b("Big", 30)]),  # dup names get -2 ids
        ts[3].key: result("no_prices", burgers=[b("Mystery", None)]),
    }
    d = dataset(ts, results)
    s = d["stats"]
    assert s["restaurants_scanned"] == 4 and s["restaurants_priced"] == 3
    assert s["burgers"] == 6 and s["beef_burgers"] == 5
    assert s["index_median"] == 20 and s["index_mean"] == 20
    assert s["index_p10"] == 12 and s["index_p90"] == 28
    assert s["all_burgers_median"] == 17  # median of 8,10,14,20,30,30
    assert s["cheapest_burger_id"].endswith("--veggie")
    assert s["priciest_burger_id"].endswith("--big")
    a = next(r for r in d["restaurants"] if r["name"] == "A")
    assert a["index_price"] == 10
    assert [x["is_index_item"] for x in a["burgers"]] == [True, False, False]
    c = next(r for r in d["restaurants"] if r["name"] == "C")
    assert [x["id"].split("--")[1] for x in c["burgers"]] == ["big", "big-2"]
    build.validate(d)


def test_empty_and_all_null_stats_are_null():
    d = dataset([], {})
    assert d["stats"]["index_median"] is None and d["stats"]["restaurants_scanned"] == 0
    assert d["boroughs"] == [] and d["neighborhoods"] == []
    build.validate(d)

    ts = build_targets([rec("A", camis="1"), rec("B", camis="2")])
    d = dataset(ts, {ts[0].key: result("no_menu_found"), ts[1].key: result("no_prices", burgers=[b("X", None)])})
    s = d["stats"]
    assert s["restaurants_priced"] == 0 and s["burgers"] == 0
    assert all(s[k] is None for k in ("index_median", "index_mean", "index_p10", "index_p90", "all_burgers_median",
                                      "cheapest_burger_id", "priciest_burger_id"))
    assert d["boroughs"][0]["index_median"] is None and d["boroughs"][0]["restaurants"] == 2
    build.validate(d)


def test_restaurant_ids_unique_with_camis_suffix():
    rs = [rec("McDonald's", camis="40001234", dba="MCDONALD'S"), rec("McDonald's", camis="40005678", dba="MCDONALD'S"),
          rec("McDonald's", camis="40009999", dba="MCDONALD'S", neighborhood="Chinatown", nta="MN27"),
          rec("Joe", camis=None, csv=True), rec("Joe", camis=None, csv=True)]
    ids = build.assign_restaurant_ids([(r, r["name"]) for r in rs])
    assert len(set(ids)) == len(ids)
    assert ids[0] == "mcdonalds-west-village-1234" and ids[1] == "mcdonalds-west-village-5678"
    assert ids[2] == "mcdonalds-chinatown"
    assert sorted(ids[3:]) == ["joe-west-village", "joe-west-village-2"]


def test_chain_applies_burgers_to_every_location_and_areas():
    rs = [rec("Shake Shack", camis=str(i), dba="SHAKE SHACK") for i in range(3)]
    rs[2].update(borough="Brooklyn", nta="BK09", neighborhood="Brooklyn Heights-Cobble Hill")
    rs.append(rec("Solo", camis="9", nta=None, neighborhood=None))
    ts = build_targets(rs)
    chain = ts[0]
    assert chain.chain == "shake-shack"
    results = {chain.key: result(burgers=[b("ShackBurger", 9.49)], price_source="delivery_app"),
               ts[1].key: result("no_menu_found")}
    d = dataset(ts, results)
    locs = [r for r in d["restaurants"] if r["chain"] == "shake-shack"]
    assert len(locs) == 3 and all(r["index_price"] == 9.49 for r in locs)
    burger_ids = [x["id"] for r in d["restaurants"] for x in r["burgers"]]
    assert len(burger_ids) == len(set(burger_ids)) == 3
    assert [a["name"] for a in d["boroughs"]] == ["Manhattan", "Brooklyn"]
    nb = {a["slug"]: a for a in d["neighborhoods"]}
    assert set(nb) == {"west-village", "brooklyn-heights-cobble-hill"}  # 'Solo' has no neighborhood
    assert nb["west-village"]["restaurants"] == 2 and nb["west-village"]["index_median"] == 9.49
    build.validate(d)


def test_chain_counts_once_in_index_and_once_per_area():
    rs = [rec("McDonald's", camis=str(i), dba="MCDONALD'S") for i in range(5)]
    rs[4].update(borough="Brooklyn", nta="BK09", neighborhood="Brooklyn Heights-Cobble Hill")
    rs += [rec("Due West", camis="8"), rec("Emmett's", camis="9")]
    ts = build_targets(rs)
    chain = next(t for t in ts if t.chain)
    solo = {t.name: t for t in ts if not t.chain}
    results = {chain.key: result(burgers=[b("Cheeseburger", 4), b("Big Mac", 7)]),
               solo["Due West"].key: result(burgers=[b("Smash", 15)]),
               solo["Emmett's"].key: result(burgers=[b("Tavern", 20)])}
    d = dataset(ts, results)
    s = d["stats"]
    # per location the median would be $4 (5 of 7 rows are McDonald's); per menu it is median(4, 15, 20)
    assert s["index_median"] == 15 and s["index_mean"] == 13
    assert s["restaurants_priced"] == 7 and s["burgers"] == 12  # locations and table rows still count each one
    assert s["all_burgers_median"] == 11  # median(4, 7, 15, 20): the chain's menu once
    nb = {a["slug"]: a for a in d["neighborhoods"]}
    assert nb["west-village"]["restaurants_priced"] == 6
    assert (nb["west-village"]["index_median"], nb["west-village"]["index_min"]) == (15, 4)
    assert nb["brooklyn-heights-cobble-hill"]["index_median"] == 4
    build.validate(d)


def test_validate_rejects_contract_violations():
    ts = build_targets([rec("A", camis="1")])
    d = dataset(ts, {ts[0].key: result(burgers=[b("Classic", 10)])})
    bad = copy.deepcopy(d)
    bad["restaurants"][0]["extra"] = 1
    with pytest.raises(build.DatasetInvalid, match="Additional properties"):
        build.validate(bad)
    bad = copy.deepcopy(d)
    bad["restaurants"][0]["burgers"][0]["protein"] = "tofu"
    with pytest.raises(build.DatasetInvalid):
        build.validate(bad)
    bad = copy.deepcopy(d)
    bad["generated_at"] = "yesterday"
    with pytest.raises(build.DatasetInvalid, match="date-time"):
        build.validate(bad)
    bad = copy.deepcopy(d)
    bad["restaurants"][0]["burgers"][0]["is_index_item"] = False
    with pytest.raises(build.DatasetInvalid, match="is_index_item"):
        build.validate(bad)


def test_restaurant_ids_do_not_change_when_a_namesake_is_scraped():
    rs = [rec("Daily Burger", camis="50044590", address="4 Penn Plaza", nta="MN17", neighborhood="Midtown-Midtown South"),
          rec("Daily Burger", camis="50044622", address="4 Penn Plaza", nta="MN17", neighborhood="Midtown-Midtown South")]
    ts = build_targets(rs, chains={})
    one = dataset(ts, {ts[0].key: result(burgers=[b("Classic", 12)])})
    both = dataset(ts, {t.key: result(burgers=[b("Classic", 12)]) for t in ts})
    assert [r["id"] for r in one["restaurants"]] == ["daily-burger-midtown-4590"]
    assert [r["id"] for r in both["restaurants"]] == ["daily-burger-midtown-4590", "daily-burger-midtown-4622"]


def test_airport_chain_locations_do_not_copy_the_street_price():
    rs = [rec("McDonald's", camis="1", dba="MCDONALD'S", address="4040 Broadway"),
          rec("McDonald's", camis="2", dba="MCDONALDS - FOOD COURT", address="Terminal 1", borough="Queens",
              nta="QN98", neighborhood="Airport", zipcode="11430"),
          rec("McDonald's", camis="3", dba="MCDONALD'S", address="1 Fulton Street")]
    ts = build_targets(rs)
    assert ts[0].rep["camis"] == "1"
    d = dataset(ts, {ts[0].key: result(burgers=[b("Cheeseburger", 4.19), b("Big Mac", 8.39)],
                                       price_source="delivery_app")})
    build.validate(d)
    by_camis = {r["camis"]: r for r in d["restaurants"]}
    assert by_camis["2"]["index_price"] is None and by_camis["2"]["status"] == "no_menu_found"
    assert by_camis["2"]["burgers"] == [] and "Airport" in by_camis["2"]["status_detail"]
    assert by_camis["1"]["index_price"] == by_camis["3"]["index_price"] == 4.19
    # the cheapest burger points at the location the chain menu was scraped from
    assert d["stats"]["cheapest_burger_id"] == f"{by_camis['1']['id']}--cheeseburger"
    assert "1 airport chain location is listed" in d["methodology"]["coverage_note"]


def test_happy_hour_prices_are_not_published():
    ts = build_targets([rec("The Spaniard", camis="1")])
    menu = [b("Spaniard Burger", 18) | {"menu_period": "dinner"}, b("Little Spaniard", 12) | {"menu_period": "happy_hour"}]
    d = dataset(ts, {ts[0].key: result(burgers=menu)})
    r = d["restaurants"][0]
    assert [x["name"] for x in r["burgers"]] == ["Spaniard Burger"] and r["index_price"] == 18
    build.validate(d)


def test_money_rounds_half_cents_up_and_possessives():
    assert build.money(13.125) == 13.13 and build.money(9.745) == 9.75 and build.money(4.39) == 4.39
    assert build.money(None) is None and build.money(7) == 7.0
    assert build.possessive("McDonald's") == "McDonald's" and build.possessive("Five Guys") == "Five Guys'"
    assert build.possessive("Shake Shack") == "Shake Shack's"
