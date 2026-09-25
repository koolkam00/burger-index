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


def dataset(targets, results, **kw):
    return build.assemble(targets, results, generated_at="2026-09-23T12:00:00Z", **kw)


UNPRICED = {"id", "name", "address", "neighborhood_slug", "index_price", "burger"}


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
        ts[2].key: result(burgers=[b("Big", 30), b("Big", 30)]),
        ts[3].key: result("no_prices", burgers=[b("Mystery", None)]),
    }
    d = dataset(ts, results)
    # one burger per restaurant, its highest-priced beef burger: A -> Double 14, B -> 20, C -> 30
    assert d["version"] == 2 and set(d) == {"version", "generated_at", "stats", "boroughs", "neighborhoods",
                                            "restaurants"}
    assert d["stats"] == {"restaurants_priced": 3, "index_median": 20, "index_p10": 15.2, "index_p90": 28}
    a = next(r for r in d["restaurants"] if r["name"] == "A")
    assert a["index_price"] == 14 and a["burger"] == {"name": "Double", "description": None}
    assert list(a) == list(build.PRICED_FIELDS) and a["hand_check"] is None
    assert next(r for r in d["restaurants"] if r["name"] == "C")["burger"]["name"] == "Big"
    # no price: nothing published but the name the site lists on its neighborhood's page
    unpriced = next(r for r in d["restaurants"] if r["name"] == "D")
    assert set(unpriced) == UNPRICED and (unpriced["index_price"], unpriced["burger"]) == (None, None)
    assert unpriced["neighborhood_slug"] == "west-village"
    build.validate(d)


def test_empty_and_all_null_stats_are_null():
    d = dataset([], {})
    assert d["stats"] == {"restaurants_priced": 0, "index_median": None, "index_p10": None, "index_p90": None}
    assert d["boroughs"] == [] and d["neighborhoods"] == [] and d["restaurants"] == []
    build.validate(d)

    ts = build_targets([rec("A", camis="1"), rec("B", camis="2")])
    results = {ts[0].key: result("no_menu_found"), ts[1].key: result("no_prices", burgers=[b("X", None)])}
    d = dataset(ts, results)
    assert d["stats"] == {"restaurants_priced": 0, "index_median": None, "index_p10": None, "index_p90": None}
    # an area with nothing priced is still listed (the site shows it as a plain name)
    assert d["boroughs"] == [{"slug": "manhattan", "name": "Manhattan", "borough": "Manhattan", "restaurants_priced": 0,
                              "index_median": None, "index_min": None, "index_max": None}]
    assert [a["slug"] for a in d["neighborhoods"]] == ["west-village"]
    assert all(set(r) == UNPRICED for r in d["restaurants"])
    # the pipeline's own statuses stay on the build rows (the CLI counts them), not in the dataset
    assert [r["status"] for r in build.restaurant_rows(ts, results)] == ["no_menu_found", "no_prices"]
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


def test_park_nta_ids_keep_park_whatever_the_label():
    # BX99's 2010 name is 'park-cemetery-etc-Bronx'; sources shows it as "Bronx parks", and the id keeps "park".
    rs = [rec("Hudson Garden Grill", camis="50154811", borough="Bronx", neighborhood="Bronx parks", nta="BX99"),
          rec("Burger Urway", camis="50110832", borough="Brooklyn", neighborhood="park-cemetery-etc-Brooklyn", nta="BK99")]
    assert build.assign_restaurant_ids([(r, r["name"]) for r in rs]) == ["hudson-garden-grill-park", "burger-urway-park"]


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
    locs = [r for r in d["restaurants"] if r.get("chain") == "shake-shack"]
    assert len(locs) == 3 and all(r["index_price"] == 9.49 and r["burger"]["name"] == "ShackBurger" for r in locs)
    assert [a["name"] for a in d["boroughs"]] == ["Manhattan", "Brooklyn"]
    nb = {a["slug"]: a for a in d["neighborhoods"]}
    assert set(nb) == {"west-village", "brooklyn-heights-cobble-hill"}  # 'Solo' has no neighborhood
    assert nb["west-village"]["restaurants_priced"] == 2 and nb["west-village"]["index_median"] == 9.49
    solo = next(r for r in d["restaurants"] if r["name"] == "Solo")
    assert set(solo) == UNPRICED and solo["neighborhood_slug"] is None
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
    # the chain's one burger is its priciest, the $7 Big Mac; per location the median would be $7 (5 of 7
    # rows are McDonald's), per menu it is median(7, 15, 20)
    assert s["index_median"] == 15
    assert s["restaurants_priced"] == 7  # locations and table rows still count each one
    nb = {a["slug"]: a for a in d["neighborhoods"]}
    assert nb["west-village"]["restaurants_priced"] == 6
    assert (nb["west-village"]["index_median"], nb["west-village"]["index_min"]) == (15, 7)
    assert nb["brooklyn-heights-cobble-hill"]["index_median"] == 7
    build.validate(d)


def test_validate_rejects_contract_violations():
    ts = build_targets([rec("A", camis="1")])
    d = dataset(ts, {ts[0].key: result(burgers=[b("Classic", 10)])})
    bad = copy.deepcopy(d)
    bad["restaurants"][0]["extra"] = 1
    with pytest.raises(build.DatasetInvalid, match="Additional properties"):
        build.validate(bad)
    bad = copy.deepcopy(d)
    bad["restaurants"][0]["burger"]["price"] = 10  # the price is the restaurant's index_price
    with pytest.raises(build.DatasetInvalid, match="Additional properties"):
        build.validate(bad)
    bad = copy.deepcopy(d)
    bad["generated_at"] = "yesterday"
    with pytest.raises(build.DatasetInvalid, match="date-time"):
        build.validate(bad)
    bad = copy.deepcopy(d)
    bad["version"] = 1
    with pytest.raises(build.DatasetInvalid, match="version"):
        build.validate(bad)
    bad = copy.deepcopy(d)
    bad["restaurants"][0]["burger"] = None  # a priced restaurant publishes its burger
    with pytest.raises(build.DatasetInvalid, match="restaurants/0/burger"):
        build.validate(bad)
    bad = copy.deepcopy(d)
    bad["restaurants"][0]["hand_check"] = {"checked_on": "Sep 24"}
    with pytest.raises(build.DatasetInvalid, match="hand_check"):
        build.validate(bad)
    unpriced = {"id": "b-west-village", "name": "B", "address": None, "neighborhood_slug": "west-village",
                "index_price": None, "burger": None}
    build.validate({**d, "restaurants": d["restaurants"] + [unpriced]})
    with pytest.raises(build.DatasetInvalid, match="Additional properties"):  # an unpriced row is a name only
        build.validate({**d, "restaurants": d["restaurants"] + [{**unpriced, "menu_url": "https://b.example"}]})
    with pytest.raises(build.DatasetInvalid, match="not unique"):
        build.validate({**d, "restaurants": d["restaurants"] + [{**unpriced, "id": d["restaurants"][0]["id"]}]})


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
    rows = {r["key"]: r for r in build.restaurant_rows(ts, {ts[0].key: result(burgers=[b("Big Mac", 8.39)])})}
    assert rows["camis:2"]["index_price"] is None and rows["camis:2"]["status"] == "no_menu_found"
    assert rows["camis:2"]["menu_url"] is None and rows["camis:2"]["burger"] is None
    by_address = {r["address"]: r for r in d["restaurants"]}
    assert set(by_address["Terminal 1"]) == UNPRICED
    assert by_address["4040 Broadway"]["index_price"] == by_address["1 Fulton Street"]["index_price"] == 8.39
    assert d["stats"]["index_median"] == 8.39  # the chain's priciest burger, its one menu


def test_happy_hour_prices_are_not_published():
    ts = build_targets([rec("The Spaniard", camis="1")])
    menu = [b("Spaniard Burger", 18) | {"menu_period": "dinner"}, b("Little Spaniard", 12) | {"menu_period": "happy_hour"}]
    d = dataset(ts, {ts[0].key: result(burgers=menu)})
    r = d["restaurants"][0]
    assert r["burger"]["name"] == "Spaniard Burger" and r["index_price"] == 18
    build.validate(d)


def test_money_rounds_half_cents_up():
    assert build.money(13.125) == 13.13 and build.money(9.745) == 9.75 and build.money(4.39) == 4.39
    assert build.money(None) is None and build.money(7) == 7.0


def test_items_that_are_not_burgers_and_slider_plates_are_not_the_published_burger():
    ts = build_targets([rec("Smacking Burger", camis="1"), rec("Torst", camis="2")])
    # Sin City's $9.99 'The Frank' (a hot dog) would be Smacking Burger's priciest item
    smack = [b("The Classic", 7.49), b("The Pup Patty (Patty for Puppy)", 4.0), b("The Frank", 9.99)]
    torst = [b("Burger Sliders", 24), b("Smash Burger", 18.9)]  # a pricier slider plate
    d = dataset(ts, {ts[0].key: result(burgers=smack), ts[1].key: result(burgers=torst)})
    by = {r["name"]: r for r in d["restaurants"]}
    assert by["Smacking Burger"]["burger"]["name"] == "The Classic" and by["Smacking Burger"]["index_price"] == 7.49
    # a slider plate is not one burger: the Smash Burger is Tørst's one published burger
    assert (by["Torst"]["burger"]["name"], by["Torst"]["index_price"]) == ("Smash Burger", 18.9)
    assert d["stats"]["index_p10"] == 8.63  # from $7.49 (not the $4 dog patty) and $18.90
    build.validate(d)


def test_one_burger_per_restaurant_its_highest_priced_eligible_beef_burger():
    ts = build_targets([rec("Tavern", camis="1"), rec("Diner", camis="2"), rec("Veg Spot", camis="3"),
                        rec("Unpriced", camis="4")])
    tavern = [b("Classic", 12) | {"menu_period": "dinner"}, b("Double Wagyu Burger", 26) | {"menu_period": "dinner"},
              b("Brunch Burger", 30) | {"menu_period": "brunch"},  # a dinner price exists: brunch doesn't count
              b("Bar Burger", 40) | {"menu_period": "happy_hour"},  # never
              b("Burger Platter for 4", 60), b("Bx Cheeseburger Meal", 28),  # a group item, a combo
              b("Impossible Burger", 32, "veggie")]
    diner = [b("Burger Platter", 16) | {"description": "served with french fries, lettuce and tomato"},
             b("Twin Burger", 25) | {"description": "Two Burgers on Two Toasted Buns with French Fries"},
             b("Family Burger Box", 45)]
    d = dataset(ts, {ts[0].key: result(burgers=tavern), ts[1].key: result(burgers=diner),
                     ts[2].key: result("no_burgers", burgers=[b("Veggie Burger", 15, "veggie")]),
                     ts[3].key: result("no_prices", burgers=[b("Burger", None)])})
    build.validate(d)
    by = {r["name"]: r for r in d["restaurants"]}
    assert (by["Tavern"]["burger"]["name"], by["Tavern"]["index_price"]) == ("Double Wagyu Burger", 26)
    assert by["Diner"]["burger"] == {"name": "Burger Platter", "description": "served with french fries, lettuce and tomato"}
    assert by["Diner"]["index_price"] == 16
    # no eligible beef burger priced: nothing is published (a veggie-only menu, a menu without prices)
    assert set(by["Veg Spot"]) == set(by["Unpriced"]) == UNPRICED
    assert d["stats"]["restaurants_priced"] == 2 and d["stats"]["index_median"] == 21


def test_a_page_priced_only_through_group_platters_or_combos_has_no_index_price():
    ts = build_targets([rec("Cubby's", camis="1")])
    platter = b("Cub's Pub Platter", 120) | {"description": "10 double patty swiss cheeseburgers, caramelized onions"}
    results = {ts[0].key: result(burgers=[platter, b("Bx Cheeseburger Meal", 23.07)])}
    d = dataset(ts, results)
    build.validate(d)
    assert set(d["restaurants"][0]) == UNPRICED
    (row,) = build.restaurant_rows(ts, results)
    assert (row["status"], row["index_price"], row["burger"]) == ("no_prices", None, None)
    assert d["stats"]["restaurants_priced"] == 0 and d["stats"]["index_median"] is None


def test_corrections_apply_before_the_one_burger_is_chosen():
    ts = build_targets([rec("A", camis="1"), rec("B", camis="2")])
    menu = [b("Classic", 12), b("Big Burger", 40)]
    fixes = [{"target": ts[0].key, "checked_at": "2026-09-24", "source_url": "https://example.com/a",
              "reason": "the $40 row is a catering tray", "drop": ["Big Burger"]},
             {"target": ts[1].key, "checked_at": "2026-09-24", "source_url": "https://example.com/b",
              "reason": "dinner price", "set": {"Classic": 45}}]
    d = dataset(ts, {t.key: result(burgers=menu) for t in ts}, corrections=fixes)
    build.validate(d)
    by = {r["name"]: r for r in d["restaurants"]}
    assert (by["A"]["burger"]["name"], by["A"]["index_price"]) == ("Classic", 12)
    assert (by["B"]["burger"]["name"], by["B"]["index_price"]) == ("Classic", 45)
    # the hand check is published with the corrected prices, the correction's page as the menu page
    assert by["A"]["hand_check"] == by["B"]["hand_check"] == {"checked_on": "2026-09-24"}
    assert (by["A"]["menu_url"], by["B"]["menu_url"]) == ("https://example.com/a", "https://example.com/b")


def test_hand_check_is_published_only_on_restaurants_that_stay_priced():
    rs = [rec("Plain", camis="1"), rec("Withheld", camis="2"), rec("Emptied", camis="3"),
          rec("Jackson Hole", camis="4", dba="JACKSON HOLE", address="1 Main Street"),
          rec("Jackson Hole", camis="5", dba="JACKSON HOLE", address="2 Main Street"),
          rec("Jackson Hole", camis="6", dba="JACKSON HOLE", address="Terminal 4", borough="Queens", nta="QN98",
              neighborhood="Airport", zipcode="11430")]
    ts = build_targets(rs)
    by_name = {t.name: t for t in ts}
    chain = by_name["Jackson Hole"]
    assert chain.chain and chain.rep["camis"] == "4"
    fix = {"checked_at": "2026-09-24", "source_url": "https://example.com/menu", "reason": "x"}
    fixes = [fix | {"target": by_name["Withheld"].key, "withhold": True},
             fix | {"target": by_name["Emptied"].key, "drop": ["Burger"]},
             fix | {"target": chain.key, "set": {"Burger": 19}}]
    results = {t.key: result(burgers=[b("Burger", 15)]) for t in ts}
    d = dataset(ts, results, corrections=fixes)
    build.validate(d)
    by_address = {(r["name"], r["address"]): r for r in d["restaurants"]}
    assert by_address[("Plain", None)]["hand_check"] is None  # no correction
    assert set(by_address[("Withheld", None)]) == set(by_address[("Emptied", None)]) == UNPRICED
    # every chain location the corrected menu is copied to shows the check, except the airport counter
    assert by_address[("Jackson Hole", "1 Main Street")]["hand_check"] == {"checked_on": "2026-09-24"}
    assert by_address[("Jackson Hole", "2 Main Street")]["hand_check"] == {"checked_on": "2026-09-24"}
    assert by_address[("Jackson Hole", "2 Main Street")]["index_price"] == 19
    assert set(by_address[("Jackson Hole", "Terminal 4")]) == UNPRICED
    rows = {r["key"]: r for r in build.restaurant_rows(ts, results, corrections=fixes)}
    assert [rows[k]["hand_check"] for k in ("camis:2", "camis:3", "camis:6")] == [None, None, None]


WIX = "This is an item on your menu. Give your item a brief description"


def test_template_placeholder_page_is_not_a_menu():
    ts = build_targets([rec("The Hairy Lemon", camis="1"), rec("Half Template", camis="2")])
    template = [b("Beef Burger", 9) | {"description": WIX}, b("Vegetarian Burger", 9, "veggie") | {"description": WIX}]
    half = [b("Beef Burger", 9) | {"description": WIX}, b("Lemon Burger", 17)]
    d = dataset(ts, {ts[0].key: result(burgers=template, menu_url="https://www.hairylemonnyc.com/menu?menu=menu"),
                     ts[1].key: result(burgers=half)})
    by = {r["name"]: r for r in d["restaurants"]}
    assert set(by["The Hairy Lemon"]) == UNPRICED
    rows = {r["name"]: r for r in build.restaurant_rows(ts, {
        ts[0].key: result(burgers=template, menu_url="https://www.hairylemonnyc.com/menu?menu=menu"),
        ts[1].key: result(burgers=half)})}
    r = rows["The Hairy Lemon"]
    assert (r["status"], r["burger"], r["index_price"], r["menu_url"]) == ("no_menu_found", None, None, None)
    r = by["Half Template"]
    assert r["burger"]["name"] == "Lemon Burger" and r["index_price"] == 17
    build.validate(d)
    # only placeholders priced: the page keeps its status only if a real burger is still priced
    res = build.drop_template_placeholders(result(burgers=[b("Beef Burger", 9) | {"description": WIX},
                                                           b("Lemon Burger", None)]))
    assert res["status"] == "no_prices" and [x["name"] for x in res["burgers"]] == ["Lemon Burger"]
    untouched = result(burgers=[b("Lemon Burger", 17)])
    assert build.drop_template_placeholders(untouched) is untouched


def test_template_rule_runs_after_corrections_that_name_the_placeholder_rows():
    ts = build_targets([rec("The Hairy Lemon", camis="1")])
    template = [b("Beef Burger", 9) | {"description": WIX}, b("Vegetarian Burger", 9, "veggie") | {"description": WIX}]
    fix = {"target": ts[0].key, "checked_at": "2026-09-24", "source_url": "https://www.hairylemonnyc.com/menu-1",
           "reason": "template page", "drop": ["Beef Burger", "Vegetarian Burger"],
           "add": [{"name": "Classic Burger", "price": 17.53, "protein": "beef"}]}
    d = dataset(ts, {ts[0].key: result(burgers=template)}, corrections=[fix])
    r = d["restaurants"][0]
    assert r["burger"]["name"] == "Classic Burger" and r["index_price"] == 17.53
    assert r["hand_check"] == {"checked_on": "2026-09-24"}
