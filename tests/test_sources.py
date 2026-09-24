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
    # BK73 ('North Side-South Side' in 2010) is shown as Williamsburg; exact beats 'East Williamsburg'
    assert sources.neighborhood_to_nta("Williamsburg", "Brooklyn", nta_map) == "BK73"
    assert nta_map["BK72"]["name"] == "South Williamsburg"
    assert sources.neighborhood_to_nta("Lower East Side", "Manhattan", nta_map) == "MN27"  # Orchard / Ludlow
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
    out, report = sources.build_restaurants(rows, dohmh_rows, nta_map, cuisines=["Hamburgers"], min_date="2023-01-01",
                                            national_chains="include")  # matching is what's under test here
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


def test_csv_match_prefers_the_record_in_the_rows_neighborhood(nta_map):
    # Pilot 'Burger Joint', Midtown ('hidden hotel burger counter') is the Thompson hotel counter on
    # W 57th St (MN17), not the exact-name BURGER JOINT on W 31st St (MN13).
    rows = [
        dohmh("50116365", "BURGER JOINT", building="383", street="WEST   31 STREET", nta="MN13", zipcode="10001",
              last="2026-04-28T00:00:00.000"),
        dohmh("50092105", "THOMPSON NEW YORK HOTEL (Burger Joint)", building="118", street="WEST   57 STREET",
              nta="MN17", zipcode="10019", cuisine="American", last="2024-12-10T00:00:00.000"),
    ]
    out, report = sources.build_restaurants([csv_row("Burger Joint", neighborhood="Midtown")], rows, nta_map,
                                            cuisines=["Hamburgers"], min_date="2023-01-01")
    pilot = out[0]
    assert pilot["camis"] == "50092105" and pilot["address"] == "118 West 57 Street"
    assert pilot["match"]["method"].startswith("name+neighborhood")
    assert [r["camis"] for r in out[1:]] == ["50116365"]  # the W 31st St shop stays, as its own restaurant


def test_unmatched_csv_rows_with_the_same_name_keep_separate_keys_and_prices(nta_map):
    from pipeline import build
    from pipeline.chains import build_targets

    rows = [csv_row("Westville", neighborhood="West Village", menu_url="https://westville.com/wv", row=1),
            csv_row("Westville", neighborhood="Chelsea", menu_url="https://westville.com/chelsea", row=2)]
    out, _ = sources.build_restaurants(rows, [], nta_map)
    assert len({r["key"] for r in out}) == 2
    targets = build_targets(out, chains={})
    results = {
        t.key: {"status": "priced", "status_detail": None, "menu_url": url, "price_source": "official_site",
                "website": None, "scraped_at": "2026-09-23T12:00:00Z",
                "burgers": [{"name": "Burger", "price": price, "description": None, "protein": "beef",
                             "menu_period": None}]}
        for t, (url, price) in zip(targets, [("https://westville.com/wv", 14), ("https://westville.com/chelsea", 22)], strict=True)
    }
    d = build.assemble(targets, results, generated_at="2026-09-23T12:00:00Z")
    assert sorted((r["neighborhood"], r["index_price"]) for r in d["restaurants"]) == [
        ("Hudson Yards-Chelsea-Flat Iron-Union Square", 22), ("West Village", 14)]


def test_repermitted_restaurant_is_listed_once(nta_map):
    rows = [
        dohmh("40538662", "MCDONALD'S", building="4040", street="BROADWAY", nta="MN36", last="2025-03-04T00:00:00.000"),
        dohmh("50183866", "MCDONALD'S", building="4040", street="BROADWAY", nta="MN36", last="2026-06-29T00:00:00.000"),
        dohmh("50087334", "JUMBO HAMBURGER PLACE", building="112", street="WEST 116 STREET", nta="MN11",
              last="2025-10-03T00:00:00.000"),
        dohmh("50185072", "JUMBO HAMBURGERS", building="112", street="WEST 116 STREET", nta="MN11",
              last="2026-06-29T00:00:00.000"),
        # two stands in one venue: permitted together, inspected the same day -> both kept
        dohmh("50044590", "HAMBURGER, DAILY BURGER", building="4", street="PENN PLAZA", nta="MN17",
              last="2025-02-01T00:00:00.000"),
        dohmh("50044622", "Daily Burger", building="4", street="PENN PLAZA", nta="MN17", last="2025-02-01T00:00:00.000"),
        # a different restaurant at the same address is never merged
        dohmh("50144161", "BURGER KING", building="2655", street="RICHMOND AVENUE", boro="Staten Island", nta="SI01",
              last="2025-03-11T00:00:00.000"),
        dohmh("50180342", "SHAKE SHACK", building="2655", street="RICHMOND AVENUE", boro="Staten Island", nta="SI01",
              last="2026-04-24T00:00:00.000"),
    ]
    out, report = sources.build_restaurants([], rows, nta_map, cuisines=["Hamburgers"], min_date="2023-01-01",
                                            national_chains="include")  # re-permit dedupe is what's under test
    camis = sorted(r["camis"] for r in out)
    assert camis == ["50044590", "50044622", "50144161", "50180342", "50183866", "50185072"]
    assert {d["dropped"]: d["kept"] for d in report["dohmh_superseded_permits"]} == {
        "40538662": "50183866", "50087334": "50185072"}


def test_national_chains_dropped_local_chains_kept(nta_map):
    dohmh_rows = [
        dohmh("200", "MCDONALD'S #13068"), dohmh("201", "BURGER KING, POPEYES"), dohmh("202", "SHAKE SHACK 1692"),
        dohmh("203", "FIVE GUYS FAMOUS BURGERS AND FRIES"), dohmh("204", "WENDY'S (CONCOURSE F)"),
        dohmh("205", "WAYBACK BURGERS"), dohmh("206", "CARL'S JR."),
        dohmh("210", "7TH STREET BURGER"), dohmh("211", "JACKSON HOLE"), dohmh("212", "BAREBURGER"),
        dohmh("213", "WHITE HORSE TAVERN", cuisine="Hamburgers"), dohmh("214", "KING OF BURGERS"),
    ]
    rows = [csv_row("Shake Shack West Village", row=1), csv_row("Due West", row=2)]
    out, report = sources.build_restaurants(rows, dohmh_rows, nta_map, cuisines=["Hamburgers"], min_date="2023-01-01")
    names = sorted(r["name"] for r in out)
    assert names == ["7th Street Burger", "Bareburger", "Due West", "Jackson Hole", "King of Burgers",
                     "White Horse Tavern"]
    assert report["national_chains_excluded"] == {
        "Burger King": 1, "Carl's Jr.": 1, "Five Guys": 1, "McDonald's": 1, "Shake Shack": 1, "Wayback Burgers": 1,
        "Wendy's": 1}
    assert report["csv_matched"] == 1  # the Shake Shack pilot row merged with its DOHMH record, then both dropped
