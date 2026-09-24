import copy
import re

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


def test_coverage_note_counts_the_whole_scope_and_names_the_exclusion():
    meta = {"cuisines": ["Hamburgers"], "min_inspection_date": "2023-01-01", "national_chains": "exclude"}
    note = build.coverage_note(meta, 129, 113)
    assert note.startswith("242 restaurants in scope: our curated restaurant list plus every restaurant NYC DOHMH lists "
                           "under 'Hamburgers' with an inspection since 2023-01-01 (or not yet inspected), except "
                           "national fast-food chains")
    assert "NYC's own small chains stay in." in note
    assert "129 of them are in this dataset; the other 113 are not yet scraped." in note
    done = build.coverage_note({**meta, "national_chains": "include"}, 129, 0)
    assert done.startswith("129 restaurants: our curated restaurant list") and "except" not in done
    assert "not yet scraped" not in done and "in scope" not in done
    listed = build.coverage_note({**meta, "cuisines": []}, 77, 589)
    assert listed.startswith("666 restaurants in scope: our curated list of NYC burger restaurants, matched to NYC "
                             "DOHMH inspection records for address and location where possible, except national "
                             "fast-food chains. NYC's own small chains stay in.")
    assert "DOHMH lists under" not in listed


# web/src/lib/scope.ts reads methodology.coverage_note and methodology.sources back with these patterns
# (ported as written there); the notes build writes must stay in a phrasing they recognize.
WEB_LIST_ONLY = re.compile(r"\bour curated list of NYC burger restaurants\b", re.IGNORECASE)
WEB_WITH_CUISINES = re.compile(r"\bour curated restaurant list plus every restaurant NYC DOHMH lists under '([^']+)'"
                               r"(?: with an inspection since (\d{4}-\d{2}-\d{2}))?", re.IGNORECASE)
WEB_NATIONAL = re.compile(r"\bexcept national (?:[a-z-]+ (?:and [a-z-]+ )?)?chains\b(?: \(([^)]+)\))?", re.IGNORECASE)
WEB_PENDING = re.compile(r"\bthe other ([\d,]+) (?:are|is) not yet scraped\b", re.IGNORECASE)
WEB_LEAD = re.compile(r"^([\d,]+) restaurants?\b")
WEB_DOHMH_AS_LIST = re.compile(r"^(NYC DOHMH Restaurant Inspection Results\b[^:]*):\s*restaurant list\b", re.IGNORECASE)
WEB_CURATED_LIST = re.compile(r"\brestaurant list: a curated list\b", re.IGNORECASE)

EXCLUDED = {"Shake Shack": 12, "Five Guys": 3, "McDonald's": 2, "White Castle": 2, "Tex's Chicken & Burgers": 2,
            "Applebee's": 1, "PLNT Burger": 1}


def test_coverage_note_names_the_excluded_chains_and_how_many_rows_matched():
    listed = {"cuisines": [], "min_inspection_date": "2023-01-01", "national_chains": "exclude"}
    rs = [rec("Corner Burger", camis="1", csv=True), rec("Ruby's", camis="2", csv=True),
          rec("Nowhere Burgers", csv=True), rec("Side Street", csv=True)]
    ts = build_targets(rs)
    d = build.assemble(ts, {ts[0].key: result(burgers=[b("Burger", 12)])}, meta=listed, n_pending_restaurants=3,
                       report={"national_chains_excluded": EXCLUDED}, generated_at="2026-09-23T12:00:00Z")
    build.validate(d)
    note = d["methodology"]["coverage_note"]
    assert note.startswith(
        "4 restaurants in scope: our curated list of NYC burger restaurants, matched to NYC DOHMH inspection records "
        "for address and location where possible (2 of 4), except national fast-food chains (Shake Shack, Five Guys, "
        "McDonald's, Tex's Chicken & Burgers and the like). NYC's own small chains stay in. 1 of them are in this "
        "dataset; the other 3 are not yet scraped.")
    assert "Burger King" not in note and "Wendy's" not in note  # named from the report, not hard-coded
    # the web reads it back: list-only scope, 4 in scope (1 + 3 pending), the chains as examples
    assert WEB_LIST_ONLY.search(note) and not WEB_WITH_CUISINES.search(note)
    assert WEB_LEAD.match(note)[1] == "4" and WEB_PENDING.search(note)[1] == "3"
    assert WEB_NATIONAL.search(note)[1] == "Shake Shack, Five Guys, McDonald's, Tex's Chicken & Burgers and the like"
    # no report (or no national chain on the list): the rule without examples, still recognized
    bare = build.coverage_note(listed, 4, 0, matched=4)
    assert "(4 of 4), except national fast-food chains. NYC's own small chains stay in." in bare
    assert WEB_NATIONAL.search(bare) and WEB_NATIONAL.search(bare)[1] is None
    assert build.national_chain_examples({"Odd (Name)": 9, "Five Guys": 1}) == "Five Guys and the like"
    assert build.national_chain_examples({}) is None
    # national chains included: no exclusion clause; with cuisines the note keeps its own phrasing
    assert "except" not in build.coverage_note({**listed, "national_chains": "include"}, 4, 0,
                                               national_excluded=EXCLUDED, matched=2)
    wide = build.coverage_note({**listed, "cuisines": ["Hamburgers"]}, 129, 113, national_excluded=EXCLUDED,
                               matched=200)
    assert WEB_WITH_CUISINES.search(wide).groups() == ("Hamburgers", "2023-01-01") and "(200 of" not in wide
    assert WEB_NATIONAL.search(wide)[1].startswith("Shake Shack, Five Guys")


def test_sources_say_what_dohmh_supplies_for_the_scope():
    rs = [rec("Corner Burger", camis="1", csv=True)]
    ts = build_targets(rs)
    listed = build.assemble(ts, {}, meta={"cuisines": [], "national_chains": "exclude"}, n_pending_restaurants=1,
                            generated_at="2026-09-23T12:00:00Z")["methodology"]["sources"]
    # our list first; DOHMH only matches it (addresses, coordinates, neighborhoods, cuisine), never is it
    assert listed[0] == build.LIST_SOURCE and WEB_CURATED_LIST.search(listed[0])
    assert listed[1] == ("NYC DOHMH Restaurant Inspection Results (NYC Open Data 43nn-pn8j): addresses, coordinates, "
                         "neighborhoods and cuisine for the restaurants on our list that match its records.")
    assert not any(WEB_DOHMH_AS_LIST.search(s) for s in listed)
    assert "restaurant list" not in listed[1] and "every restaurant" not in listed[1]
    assert listed[2].startswith("2010 Neighborhood Tabulation Areas") and listed[3].startswith("Menu prices")
    wide = build.sources({"cuisines": ["Hamburgers", "American"], "min_inspection_date": "2024-01-01"})
    assert wide[0] == build.LIST_SOURCE
    assert wide[1] == ("NYC DOHMH Restaurant Inspection Results (NYC Open Data 43nn-pn8j): every restaurant it lists "
                       "under 'Hamburgers, American' with an inspection since 2024-01-01 (or not yet inspected), and "
                       "addresses, coordinates, neighborhoods and cuisine for the restaurants on our list that match "
                       "its records.")
    assert not WEB_DOHMH_AS_LIST.search(wide[1])
    assert build.sources({}) == listed  # no scope saved: the default, the list only


def test_items_that_are_not_burgers_are_not_published_and_slider_plates_stay_listed():
    ts = build_targets([rec("Smacking Burger", camis="1"), rec("Torst", camis="2")])
    smack = [b("The Classic", 7.49), b("The Pup Patty (Patty for Puppy)", 4.0), b("The Frank", 9.99)]
    torst = [b("Burger Sliders", 9.5), b("Smash Burger", 18.9)]
    d = dataset(ts, {ts[0].key: result(burgers=smack), ts[1].key: result(burgers=torst)})
    by = {r["name"]: r for r in d["restaurants"]}
    assert [x["name"] for x in by["Smacking Burger"]["burgers"]] == ["The Classic"]
    assert by["Smacking Burger"]["index_price"] == 7.49
    # the slider plate is listed at its price, but the Smash Burger is the index item
    assert [(x["name"], x["price"], x["is_index_item"]) for x in by["Torst"]["burgers"]] == [
        ("Burger Sliders", 9.5, False), ("Smash Burger", 18.9, True)]
    assert d["stats"]["cheapest_burger_id"].endswith("--the-classic")  # not the $4 dog patty
    build.validate(d)


WIX = "This is an item on your menu. Give your item a brief description"


def test_template_placeholder_page_is_not_a_menu():
    ts = build_targets([rec("The Hairy Lemon", camis="1"), rec("Half Template", camis="2")])
    template = [b("Beef Burger", 9) | {"description": WIX}, b("Vegetarian Burger", 9, "veggie") | {"description": WIX}]
    half = [b("Beef Burger", 9) | {"description": WIX}, b("Lemon Burger", 17)]
    d = dataset(ts, {ts[0].key: result(burgers=template, menu_url="https://www.hairylemonnyc.com/menu?menu=menu"),
                     ts[1].key: result(burgers=half)})
    by = {r["name"]: r for r in d["restaurants"]}
    r = by["The Hairy Lemon"]
    assert (r["status"], r["burgers"], r["index_price"], r["menu_url"]) == ("no_menu_found", [], None, None)
    assert "hairylemonnyc.com" in r["status_detail"] and "template" in r["status_detail"]
    r = by["Half Template"]
    assert [x["name"] for x in r["burgers"]] == ["Lemon Burger"] and r["index_price"] == 17
    assert r["status_detail"].endswith("1 website-template placeholder item left out.")
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
    d = build.assemble(ts, {ts[0].key: result(burgers=template)}, corrections=[fix], generated_at="2026-09-23T12:00:00Z")
    r = d["restaurants"][0]
    assert r["status"] == "priced" and r["index_price"] == 17.53 and "template-placeholder" not in r["status_detail"]
