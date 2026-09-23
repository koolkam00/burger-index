from pipeline import sources
from pipeline.names import display_case, display_name, norm_name, slugify


def dohmh(camis, dba, *, boro="Manhattan", building="1", street="MAIN STREET", nta="MN23", zipcode="10014",
          lat="40.73", lng="-73.99", cuisine="Hamburgers", last="2026-01-01T00:00:00.000"):
    return {"camis": camis, "dba": dba, "boro": boro, "building": building, "street": street, "nta": nta,
            "zipcode": zipcode, "latitude": lat, "longitude": lng, "cuisine_description": cuisine,
            "last_inspection": last}


def test_latest_per_camis_keeps_latest_inspection():
    rows = [
        dohmh("1", "OLD NAME", last="2024-01-01T00:00:00.000"),
        dohmh("1", "NEW NAME", last="2026-02-01T00:00:00.000"),
        dohmh("2", "OTHER"),
    ]
    latest = {r["camis"]: r["dba"] for r in sources.latest_per_camis(rows)}
    assert latest == {"1": "NEW NAME", "2": "OTHER"}


def test_normalize_dohmh_fields(nta_map):
    r = sources.normalize_dohmh(dohmh("9", "MCDONALD'S #13068", building="296", street="BLEECKER STREET",
                                      lat="0", lng="0"), nta_map)
    assert r["name"] == "McDonald's"
    assert r["address"] == "296 Bleecker Street"
    assert r["lat"] is None and r["lng"] is None  # 0 -> null
    assert r["neighborhood"] == "West Village" and r["nta"] == "MN23"
    assert sources.normalize_dohmh(dohmh("9", "X", boro="0"), nta_map) is None
    assert sources.normalize_dohmh(dohmh("9", "X", boro=""), nta_map) is None


def test_missing_nta_falls_back_to_zipcode(nta_map):
    rows = [dohmh("1", "A", zipcode="10014", nta="MN23"), dohmh("2", "B", zipcode="10014", nta="MN23"),
            dohmh("3", "C", zipcode="10014", nta="")]
    zip_nta = sources.zip_to_nta(rows)
    r = sources.normalize_dohmh(rows[2], nta_map, zip_nta)
    assert r["nta"] == "MN23" and r["nta_source"] == "zipcode"


def test_inspection_filter_keeps_not_yet_inspected():
    assert sources.is_recent({"last_inspection": "2023-05-01"}, "2023-01-01")
    assert sources.is_recent({"last_inspection": "1900-01-01"}, "2023-01-01")  # not yet inspected
    assert not sources.is_recent({"last_inspection": "2019-05-01"}, "2023-01-01")
    assert sources.is_recent({"last_inspection": "2019-05-01"}, "2019-01-01")  # it's a flag


def test_display_names():
    assert display_name("MCDONALDS") == "McDonald's"
    assert display_name("7TH STREET BURGER") == "7th Street Burger"
    assert display_name("BURGERFI") == "BurgerFi"
    assert display_name("PAUL'S DA BURGER JOINT") == "Paul's Da Burger Joint"
    assert display_name("BURGERS & BEER") == "Burgers & Beer"
    assert display_name("Daily Burger") == "Daily Burger"  # mixed case kept
    assert display_name("HAMBURGER, DAILY BURGER") == "Daily Burger"
    assert display_name("WENDY'S (CONCOURSE F)") == "Wendy's"
    assert display_case("100 WEST 124 STREET") == "100 West 124 Street"
    assert display_case("7TH AVE") == "7th Ave"


def test_norm_and_slug():
    assert norm_name("Jack & Charlie's No. 118") == "jack and charlies no 118"
    assert slugify("Hudson Yards-Chelsea-Flat Iron-Union Square") == "hudson-yards-chelsea-flat-iron-union-square"
    assert slugify("Café Clúny") == "cafe-cluny"


def test_neighborhood_to_nta(nta_map):
    assert sources.neighborhood_to_nta("West Village", "Manhattan", nta_map) == "MN23"
    assert sources.neighborhood_to_nta("Greenwich Village", "Manhattan", nta_map) == "MN23"  # alias
    assert sources.neighborhood_to_nta("Williamsburg", "Brooklyn", nta_map) == "BK72"  # exact beats 'East Williamsburg'
    assert sources.neighborhood_to_nta("Park Slope", "Brooklyn", nta_map) == "BK37"  # 'Park Slope-Gowanus'
    assert sources.neighborhood_to_nta("SoHo", "Manhattan", nta_map) == "MN24"
    assert sources.neighborhood_to_nta("Atlantis", "Manhattan", nta_map) is None


def csv_row(name, neighborhood="West Village", borough="Manhattan", website=None, menu_url=None, row=1):
    return {"row": row, "name": name, "neighborhood": neighborhood, "borough": borough, "website": website,
            "menu_url": menu_url, "notes": None}


def test_csv_matching_dedupe_and_unmatched(nta_map):
    dohmh_rows = [
        dohmh("100", "FIVE GUYS", building="56", street="WEST 14 STREET"),
        dohmh("101", "FIVE GUYS FAMOUS BURGERS AND FRIES", building="296", street="BLEECKER STREET"),
        dohmh("102", "SHAKE SHACK", building="820", street="WASHINGTON STREET"),
        dohmh("103", "THE NOORT WYCK", building="289", street="BLEECKER STREET", cuisine="American"),
        dohmh("104", "KEENS STEAKHOUSE", nta="MN17", cuisine="Steakhouse"),
        dohmh("105", "ART SOHO", nta="MN24", cuisine="American"),
        dohmh("106", "OLD BURGER", last="2019-01-01T00:00:00.000"),  # stale -> dropped
        dohmh("107", "NEW BURGER", last="1900-01-01T00:00:00.000"),  # not yet inspected -> kept
        dohmh("108", "BRONX BURGER", boro="0"),
    ]
    rows = [
        csv_row("Five Guys", website="https://restaurants.fiveguys.com/296-bleecker-st", row=1),
        csv_row("Shake Shack West Village", row=2),
        csv_row("The Noortwyck", row=3),
        csv_row("Keens", neighborhood="Midtown", row=4),
        csv_row("SoHo Park", neighborhood="SoHo", row=5),
        csv_row("Nowhere Burgers", row=6),
    ]
    out, report = sources.build_restaurants(rows, dohmh_rows, nta_map, cuisines=["Hamburgers"], min_date="2023-01-01")
    by_name = {r["name"]: r for r in out if r["csv"]}
    # URL address beats an exact-name match elsewhere in the same neighborhood
    assert by_name["Five Guys"]["camis"] == "101"
    assert by_name["Shake Shack West Village"]["camis"] == "102"  # neighborhood suffix stripped
    assert by_name["The Noortwyck"]["camis"] == "103"  # spacing difference
    assert by_name["Keens"]["camis"] == "104"  # contained name + same NTA
    assert by_name["SoHo Park"]["camis"] is None  # loose fuzzy match rejected
    unmatched = by_name["Nowhere Burgers"]
    assert unmatched["camis"] is None and unmatched["lat"] is None
    assert unmatched["borough"] == "Manhattan" and unmatched["neighborhood"] == "West Village"
    assert unmatched["nta"] == "MN23"  # same naming system as DOHMH records
    # CSV rows first, then DOHMH-only in-scope records, no duplicates
    camis = [r["camis"] for r in out if r["camis"]]
    assert len(camis) == len(set(camis))
    assert [r["name"] for r in out[:6]] == [r["name"] for r in rows]
    assert "107" in camis and "106" not in camis and "108" not in camis
    assert report["csv_matched"] == 4 and report["dohmh_dropped_stale"] == 1
    # the matched CSV row keeps its curated URLs and name
    assert by_name["Five Guys"]["website"] == "https://restaurants.fiveguys.com/296-bleecker-st"
    assert by_name["Five Guys"]["csv"] is True


def test_cuisines_flag_widens_scope(nta_map):
    rows = [dohmh("1", "A BURGER"), dohmh("2", "AN IRISH PUB", cuisine="Irish")]
    narrow, _ = sources.build_restaurants([], rows, nta_map, cuisines=["Hamburgers"])
    wide, _ = sources.build_restaurants([], rows, nta_map, cuisines=["Hamburgers", "Irish"])
    assert len(narrow) == 1 and len(wide) == 2


def test_load_csv_cleans_urls(tmp_path):
    p = tmp_path / "pilot.csv"
    p.write_text("name,neighborhood,borough,website,menu_url,notes\n"
                 "A,West Village,Manhattan,unknown,,x\n"
                 "B,West Village,Manhattan,b.com,https://b.com/menu,\n"
                 "C,Nowhere,Jersey,https://c.com,,\n")
    rows = sources.load_csv(p)
    assert [r["name"] for r in rows] == ["A", "B"]  # bad borough skipped
    assert rows[0]["website"] is None and rows[0]["menu_url"] is None
    assert rows[1]["website"] == "https://b.com"
