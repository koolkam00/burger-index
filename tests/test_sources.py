import json

import pytest

from pipeline import sources
from pipeline.names import address_in_text, display_case, display_name, norm_name, slugify


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


NATIONAL_SPELLINGS = {
    # DOHMH DBAs (and pilot-list names) of national chains -> slug
    "CITI FIELD SHAKE SHACK - STAND 139": "shake-shack", "BROOKLYN DELI CB24/SHAKE SHACK CB26": "shake-shack",
    "DUNKIN (38CC)/ SHAKE SHACK (40CC) POST GATE 22": "shake-shack", "IHOP#3715": "ihop", "IHOP": "ihop",
    "DENNY'S": "dennys", "PERKINS RESTAURANT & BAKERY": "perkins", "BUFFALO WILD WINGS GO": "buffalo-wild-wings",
    "HOOTERS": "hooters", "DAVE & BUSTER'S": "dave-and-busters", "Dave & Buster's Times Square": "dave-and-busters",
    "OUTBACK STEAKHOUSE": "outback", "LONGHORN STEAKHOUSE": "longhorn", "THE CHEESECAKE FACTORY": "cheesecake-factory",
    "HARD ROCK CAFE": "hard-rock-cafe", "PLANET HOLLYWOOD/CHICKEN GUY": "planet-hollywood",
    "BUBBA GUMP SHRIMP CO.": "bubba-gump", "MARGARITAVILLE": "margaritaville", "YARD HOUSE": "yard-house",
    "MILLER'S ALE HOUSE": "millers-ale-house", "UNO CHICAGO GRILL": "uno", "JOLLIBEE": "jollibee",
    "PLNT BURGER": "plnt-burger", "SLUTTY VEGAN": "slutty-vegan", "SluttyVegan Brooklyn": "slutty-vegan",
    "SLUTTYVEGAN": "slutty-vegan",
    "NEXT LEVEL BURGER": "next-level-burger", "Umami Burger": "umami-burger", "Cheeburger Cheeburger": "cheeburger",
    # NY-area fast food, excluded like the national chains (user decision 2026-09-23): every spelling in DOHMH
    "TEX'S CHICKEN & BURGERS": "texas-chicken-and-burgers", "TEXAS CHICKEN & BURGERS": "texas-chicken-and-burgers",
    "TEX'S CHICKEN AND BURGER": "texas-chicken-and-burgers", "TEX*S CHICKEN & BURGERS": "texas-chicken-and-burgers",
    "TEXAS CHICKEN & BURGER": "texas-chicken-and-burgers", "TEXAS CHICKEN AND BURGERS": "texas-chicken-and-burgers",
    "Texas Chicken and Burger": "texas-chicken-and-burgers", "Tex's Chicken & Burgers": "texas-chicken-and-burgers",
}
# Look-alikes and NYC's own chains that must stay in.
NOT_NATIONAL = ["DENNY'S PUB", "UNO CAFE & BILLIARDS", "UNO OF ASTORIA", "UNO MEXICAN GRILL", "UMAMI SUSHI",
                "BAR MILLER", "DEBORAH MILLER", "LAS MARGARITAS", "BUBBA JOES", "HARLEM SHAKE", "MCDONALD AVENUE DINER",
                "BURGEROLOGY", "7TH STREET BURGER", "THE FAMOUS JIMBO'S HAMBURGER PALACE", "BURGER JOINT",
                # Tex-Mex and other Texas-named places are not Tex's Chicken & Burgers
                "TEX MEX RESTAURANT", "EL GUACAMOLE TEX-MEX", "TEXMEX CHICKEN & BURRITO", "NEW TEXAS FRIED CHICKEN",
                "NEW TEXAS CHICKEN & GRILL", "TEXAS FRIED CHICKEN", "Cowgirl",
                # kept (user decisions 2026-09-23): upscale / sit-down national chains, Swingers, Puttery, Black Tap
                "DEL FRISCO'S DOUBLE EAGLE STEAKHOUSE", "SMITH & WOLLENSKY", "STK", "HILLSTONE", "BURGER & LOBSTER",
                "SWINGERS", "PUTTERY / BOMBA / RORY'S ROOFTOP / EASY TIGER / HIGH LINE COMEDY CLUB",
                "BLACK TAP CRAFT BURGERS AND BEER, LOT 15"]


def test_national_chain_spellings_are_caught_and_look_alikes_kept():
    from pipeline.chains import is_national_chain

    for dba, slug in NATIONAL_SPELLINGS.items():
        nd = is_national_chain({"dba": dba, "name": display_name(dba)})
        assert nd is not None and nd.slug == slug, dba
        assert is_national_chain({"csv_name": dba, "name": dba}).slug == slug, dba  # as a pilot-list row
    for dba in NOT_NATIONAL:
        assert is_national_chain({"dba": dba, "name": display_name(dba)}) is None, dba


def test_national_chain_pilot_row_never_takes_a_local_record(nta_map):
    # 'Shake Shack (Madison Square Park)' is name-similar to the local MADISON SQUARE (51 Madison Ave);
    # it may only match a Shake Shack permit, so the local restaurant is never swallowed and dropped.
    rows = [dohmh("300", "MADISON SQUARE", building="51", street="MADISON AVENUE", nta="MN13", zipcode="10010",
                  cuisine="American"),
            dohmh("301", "SHAKE SHACK", building="0", street="MADISON SQUARE PARK", nta="MN13", zipcode="10010")]
    pilot = [csv_row("Shake Shack (Madison Square Park)", neighborhood="Flatiron")]
    out, report = sources.build_restaurants(pilot, rows, nta_map, cuisines=["Hamburgers", "American"])
    assert [r["camis"] for r in out] == ["300"] and report["national_chains_excluded"] == {"Shake Shack": 1}
    out, _ = sources.build_restaurants(pilot, rows, nta_map, cuisines=["Hamburgers", "American"],
                                       national_chains="include")
    assert out[0]["csv_name"] == "Shake Shack (Madison Square Park)" and out[0]["camis"] == "301"
    assert sorted(r["camis"] for r in out) == ["300", "301"]
    # and a local pilot row never takes a national chain's permit
    rows = [dohmh("302", "MCDONALD'S", building="51", street="MCDONALD AVENUE", boro="Brooklyn", nta="BK40")]
    out, _ = sources.build_restaurants([csv_row("McDonald Avenue Diner", neighborhood="Kensington", borough="Brooklyn")],
                                       rows, nta_map, cuisines=["Hamburgers"], national_chains="include")
    assert [(r["name"], r["camis"]) for r in out] == [("McDonald Avenue Diner", None), ("McDonald's", "302")]


def test_unknown_cuisine_fails_instead_of_shrinking_the_scope(nta_map):
    import pytest

    rows = [dohmh("1", "A BURGER"), dohmh("2", "PETER'S STEAKS", cuisine="Steakhouse")]
    with pytest.raises(sources.ScopeError, match=r"'Steakhouses' \(did you mean 'Steakhouse'\?\)"):
        sources.build_restaurants([], rows, nta_map, cuisines=["Hamburgers", "Steakhouses"])
    out, _ = sources.build_restaurants([], rows, nta_map, cuisines=["hamburgers", "Steakhouse"])  # case-insensitive
    assert len(out) == 2


def test_pilot_row_matches_the_address_in_its_notes(nta_map):
    # 'Burgerology Midtown' (neighborhood 'Midtown West', no URL) is the BURGEROLOGY at 320 W 36th St
    # its notes name, not a second, unmatched listing next to it.
    rows = [dohmh("50125883", "BURGEROLOGY", building="320", street="WEST   36 STREET", nta="MN17", zipcode="10018")]
    row = {**csv_row("Burgerology Midtown", neighborhood="Midtown West"),
           "notes": "Burger joint at 320 W 36th (connected to Crowne Plaza)"}
    out, report = sources.build_restaurants([row], rows, nta_map, cuisines=["Hamburgers"])
    assert [(r["name"], r["camis"]) for r in out] == [("Burgerology Midtown", "50125883")]
    # 'Midtown West' now maps to MN17 (it mapped to no NTA before), so the neighborhood agrees too
    assert out[0]["match"]["method"] == "name+neighborhood+notes-address"
    assert address_in_text("383 West 31 Street", "383 west 31st street, unit 31, new york, ny 10001")
    assert address_in_text("991 1 Avenue", "991 First Ave") and not address_in_text("991 1 Avenue", "99 1st Ave")
    assert not address_in_text("383 West 31 Street", "383 East 31st Street")


def test_shared_words_scattered_through_a_name_are_not_a_match(nta_map):
    assert sources.name_score("peter luger", "peter luger steak house") >= 90
    # a name inside another only counts from the start or the same first word; 'ACME / THE NINES' is now
    # read as two names (test_combined_dba_names_are_matched_one_by_one), so the lift isn't needed there
    assert sources.name_score("acme the nines", "the nines") < 86
    assert sources.name_score("benjamin steakhouse prime", "benjamin prime") >= 90
    assert sources.name_score("guy fieris american kitchen and bar", "american bar") < 80
    assert sources.name_score("the lambs club", "the club") < 86
    # the closed Times Square Guy Fieri's must not become the West Village AMERICAN BAR
    rows = [dohmh("50059464", "AMERICAN BAR", building="33", street="GREENWICH AVENUE", cuisine="American")]
    out, _ = sources.build_restaurants([csv_row("Guy Fieri's American Kitchen & Bar", neighborhood="Times Square")],
                                       rows, nta_map, cuisines=["American"])
    assert [(r["name"], r["camis"]) for r in out] == [("Guy Fieri's American Kitchen & Bar", None), ("American Bar", "50059464")]


# --- CSV <-> DOHMH matching (audit of the restaurant list, 2026-09-23) -------------------------------


def row(name, neighborhood="West Village", borough="Manhattan", notes=None, website=None, n=1):
    return {**csv_row(name, neighborhood, borough, website=website, row=n), "notes": notes}


def matches(out):
    return {r["name"]: r["camis"] for r in out if r["csv"]}


def test_camis_assignment_is_order_independent_and_rematches_the_loser(nta_map):
    # Blue Collar: the Cobble Hill row is the Court St shop (BK38, on the Cobble Hill line), whichever row
    # comes first; it used to be left unmatched when the Bushwick row came first.
    blue = [dohmh("50083173", "BLUE COLLAR", boro="Brooklyn", building="1544", street="DEKALB AVENUE", nta="BK77"),
            dohmh("50114194", "BLUE COLLAR", boro="Brooklyn", building="187", street="COURT STREET", nta="BK38"),
            dohmh("50149179", "BLUE COLLAR BURGER", boro="Brooklyn", building="704", street="MANHATTAN AVENUE",
                  nta="BK76")]
    rows = [row("Blue Collar", "Bushwick", "Brooklyn", n=1),
            row("Blue Collar Cobble Hill", "Cobble Hill", "Brooklyn", notes="Blue Collar's Court St outpost", n=2)]
    want = {"Blue Collar": "50083173", "Blue Collar Cobble Hill": "50114194"}
    for ordered in (rows, rows[::-1]):
        out, report = sources.build_restaurants(ordered, blue, nta_map)
        assert matches(out) == want and report["csv_duplicate_matches"] == []
    # Two rows, two Pier Burgers in one NTA: the row whose notes name 20 Perry St takes that one first,
    # and the other row falls back to the record that is left instead of tying or going unmatched.
    piers = [dohmh("1", "PIER BURGER", building="10", street="BANK STREET"),
             dohmh("2", "PIER BURGER", building="20", street="PERRY STREET")]
    rows = [row("Pier Burger", n=1), row("Pier Burger Perry", notes="Burger counter at 20 Perry St", n=2)]
    for ordered in (rows, rows[::-1]):
        out, report = sources.build_restaurants(ordered, piers, nta_map)
        assert matches(out) == {"Pier Burger": "1", "Pier Burger Perry": "2"}
        assert report["csv_ambiguous"] == []


def test_two_rows_for_one_place_report_the_duplicate(nta_map):
    rec = [dohmh("50143115", "HAMBURGER AMERICA", building="51", street="MACDOUGAL STREET", nta="MN24")]
    rows = [row("Hamburger America (Greenwich Village)", "Greenwich Village", n=216),
            row("Hamburger America (SoHo)", "SoHo", n=105)]
    out, report = sources.build_restaurants(rows, rec, nta_map)
    # the SoHo row is in the record's NTA, so it wins even though it comes second
    assert matches(out) == {"Hamburger America (SoHo)": "50143115", "Hamburger America (Greenwich Village)": None}
    assert report["csv_duplicate_matches"] == [{"row": 216, "name": "Hamburger America (Greenwich Village)",
                                                "camis": "50143115", "first_row": 105}]


def test_an_address_in_the_notes_or_url_pulls_in_the_record_there(nta_map):
    recs = [
        dohmh("50159396", "HOLY BURGER", building="34", street="CANAL STREET", nta="MN28"),
        dohmh("50160379", "HOLY COW BURGERS", building="600", street="EAST 14 STREET", nta="MN28"),
        dohmh("50164398", "HOLY COW", building="906", street="3 AVENUE", nta="MN19"),
        dohmh("50131905", "THE HIGH NOTE / POPCHEW", building="119", street="EAST 15 STREET", nta="MN21"),
        dohmh("40918355", "MERCHANTS CIGAR BAR / TRADEWELL PARK", building="1125", street="1 AVENUE", nta="MN31"),
        dohmh("41699341", "TREADWELL PARK / BLACK HOUND", building="301", street="SOUTH END AVENUE", nta="MN25"),
        dohmh("41235694", "STATEN ISLAND DINER", boro="Staten Island", building="1877", street="VICTORY BOULEVARD",
              nta="SI07"),
        dohmh("50185006", "SOM BO", building="153", street="8 AVENUE", nta="MN13", last="1900-01-01T00:00:00.000"),
        dohmh("41520610", "BAREBURGER", building="535", street="LAGUARDIA PLACE", nta="MN23"),
    ]
    rows = [
        row("Holy Cow", "Lower East Side", website="https://order.toasttab.com/online/holy-cow-lower-east-side-34-canal-st",
            n=1),
        row("Holy Cow Burgers", "Midtown East", n=2),
        row("Popchew Burger", "Gramercy", notes="Smash-burger walk-up window at 119 E 15th St", n=3),  # renamed
        row("Treadwell Park", "Upper East Side", notes="Craft beer hall at 1125 1st Ave", n=4),
        row("SI Diner", "Westerleigh", "Staten Island", notes="Classic diner at 1877 Victory Blvd", n=5),
        # the address now holds another business, and the notes rule out the Bareburger elsewhere
        row("Bareburger", "Chelsea", notes="Burger joint; 153 8th Ave location", n=6),
    ]
    out, report = sources.build_restaurants(rows, recs, nta_map)
    assert matches(out) == {"Holy Cow": "50159396", "Holy Cow Burgers": "50164398", "Popchew Burger": "50131905",
                            "Treadwell Park": "40918355", "SI Diner": "41235694", "Bareburger": None}
    by = {r["name"]: r for r in out if r["csv"]}
    assert by["Holy Cow"]["match"]["method"] == "name-word+neighborhood+url-address"
    assert report["csv_address_now_other_business"] == [
        {"row": 6, "name": "Bareburger", "address": "153 8 ave", "now": ["SOM BO (50185006)"]}]
    assert "not at the address the row names" in next(u["why"] for u in report["csv_unmatched"] if u["row"] == 6)
    # a contained name in the neighborhood doesn't beat the address the notes name
    recs = [dohmh("50141337", "SOJOURN SOCIAL", building="1708", street="2 AVENUE", nta="MN32")]
    out, _ = sources.build_restaurants([row("Sojourn", "Upper East Side", notes="Bar at 244 E 79th St")], recs, nta_map)
    assert matches(out) == {"Sojourn": None}


def test_named_addresses_and_streets():
    from pipeline.names import named_addresses, street_in_text

    assert named_addresses("Craft beer hall at 1125 1st Ave; burgers") == [["1125", "1", "ave"]]
    assert named_addresses("Irish pub (133 W 33rd); pub burgers") == [["133", "w", "33"]]
    assert named_addresses("https://order.toasttab.com/online/holy-cow-lower-east-side-34-canal-st") == [
        ["34", "canal", "st"]]
    assert named_addresses("2315 Broadway burger spot") == [["2315", "broadway"]]
    assert named_addresses("Greek diner at 549 Main St") == [["549", "main", "st"]]
    for text in ("4 oz patties, 24-hour diner", "since 1987 on Arthur Ave", "near 171st & Broadway",
                 "https://westville.com/wp-content/uploads/2024/09/DinnerMenu-4.17.24-FINAL.pdf"):
        assert named_addresses(text) == [], text
    assert street_in_text("187 Court Street", "Blue Collar's Court St outpost")
    assert street_in_text("23-14 36 Avenue", "late-night bites on 36th Ave")
    assert street_in_text("18 Greenwich Avenue", "https://menupages.com/rosemarys/18-greenwich-avenue-new-york")
    assert not street_in_text("2315 Broadway", "on Broadway")  # one-word streets say too little
    assert not street_in_text("67 West 44 Street", "Theater District diner (241 W 44th)")


def test_neighborhood_aliases(nta_map):
    def codes(name, borough="Manhattan"):
        return sources.neighborhood_ntas(name, borough, nta_map)

    assert sources.neighborhood_to_nta("Midtown East", "Manhattan", nta_map) == "MN19"
    for nb in ("Midtown West", "Times Square", "Koreatown"):
        assert sources.neighborhood_to_nta(nb, "Manhattan", nta_map) == "MN17", nb
    assert codes("NoMad") == ("MN13", "MN17")
    assert codes("West Chelsea") == ("MN13",)
    assert sources.neighborhood_to_nta("Harlem", "Manhattan", nta_map) == "MN11"  # was MN33 East Harlem South
    assert sources.neighborhood_to_nta("NoHo", "Manhattan", nta_map) == "MN23"  # Great Jones, Elizabeth St
    assert codes("Upper East Side") == codes("UES") == ("MN40", "MN31", "MN32")
    assert codes("Washington Heights") == ("MN35", "MN36")
    assert codes("Lower East Side") == ("MN27", "MN28")
    assert "BK38" in codes("Cobble Hill", "Brooklyn")
    assert sources.neighborhood_to_nta("Throggs Neck", "Bronx", nta_map) == "BX52"
    assert sources.neighborhood_to_nta("West Brighton", "Staten Island", nta_map) == "SI35"
    assert sources.neighborhood_to_nta("Staten Island", "Staten Island", nta_map) is None  # not SI99
    for (borough, name), alias_codes in sources.NEIGHBORHOOD_ALIASES.items():
        assert alias_codes and all(nta_map[c]["borough"] == borough for c in alias_codes), name


def test_name_only_matches_elsewhere_need_a_name_no_other_place_has(nta_map):
    recs = [
        dohmh("50090372", "THE WILSON", building="132", street="WEST 27 STREET", nta="MN17"),
        dohmh("50107295", "NEPTUNE DINER", boro="Queens", building="35-01", street="BELL BOULEVARD", nta="QN46"),
        dohmh("41612212", "NEPTUNE DINER II", boro="Brooklyn", building="699", street="CLASSON AVENUE", nta="BK61"),
        dohmh("50179499", "GERTIE", boro="Brooklyn", building="602", street="VANDERBILT AVENUE", nta="BK64"),
        dohmh("50147896", "BRASAS RESTAURANT & BAR", boro="Bronx", building="743", street="EAST 187 STREET", nta="BX06"),
        dohmh("40607093", "P.J. BRADY'S TAVERN", boro="Bronx", building="3201", street="PHILIP AVENUE", nta="BX52"),
        dohmh("50078890", "BARKING DOG", building="1678", street="3 AVENUE", nta="MN40"),
        dohmh("41509061", "THE JUNCTION", building="329", street="LEXINGTON AVENUE", nta="MN20"),
        dohmh("50162660", "MAX BRENNER", building="1", street="HERALD SQUARE", nta="MN17", last="1900-01-01T00:00:00.000"),
        dohmh("50036001", "BLACK TAP", building="529", street="BROOME STREET", nta="MN24"),
        dohmh("50092429", "BLACK TAP CRAFT BURGERS AND BEER, LOT 15", building="45", street="WEST 35 STREET",
              nta="MN17"),
        # 344 Bowery is in MN23, across the street from the East Village; L'WREN is not another 'The Wren'
        dohmh("41630209", "THE WREN", building="344", street="BOWERY", nta="MN23"),
        dohmh("50079143", "L'WREN", boro="Brooklyn", building="4004", street="5 AVENUE", nta="BK32"),
    ]
    rows = [row("The Wild Son", "Meatpacking District", n=1), row("Neptune Diner", "Astoria", "Queens", n=2),
            row("Gertie", "Williamsburg", "Brooklyn", n=3),
            row("PJ Brady's Bar and Restaurant", "Throggs Neck", "Bronx", n=4),
            row("Barking Dog", "Murray Hill", notes="American restaurant at 150 E 34th", n=5),
            row("The Junction Bar", "Washington Heights", n=6), row("Max Brenner", "East Village", n=7),
            row("Black Tap Craft Burgers & Beer", "Murray Hill", n=8), row("Black Tap", "SoHo", n=9),
            row("The Wren", "East Village", n=10)]
    out, report = sources.build_restaurants(rows, recs, nta_map)
    assert matches(out) == {
        "The Wild Son": None,  # THE WILSON is another restaurant
        "Neptune Diner": None,  # two Neptune Diners in NYC: the Astoria row can't pick the Bayside one
        "Gertie": "50179499",  # the only Gertie: its CSV neighborhood is just out of date
        "PJ Brady's Bar and Restaurant": "40607093",  # not BRASAS RESTAURANT & BAR (generic words only)
        "Barking Dog": None,  # its notes name another address
        "The Junction Bar": None,  # 'junction' alone doesn't carry a match
        "Max Brenner": None,  # a not-yet-inspected permit in another neighborhood
        "Black Tap Craft Burgers & Beer": "50092429",  # the other Black Tap went to the SoHo row
        "Black Tap": "50036001",
        "The Wren": "41630209",
    }
    assert next(r for r in out if r["name"] == "Gertie")["match"]["method"] == "name-unique"
    why = {u["name"]: u["why"] for u in report["csv_unmatched"]}
    assert "1 other place(s) in NYC have that name" in why["Neptune Diner"]
    assert "not yet inspected" in why["Max Brenner"]


def test_name_scoring_needs_more_than_a_contained_phrase_or_generic_words(nta_map):
    assert sources.name_score("black tap craft burgers and beer", "burgers and beer") < 86
    assert sources.name_score("pj bradys bar and restaurant", "brasas restaurant and bar") < 80
    assert sources.name_score("pj bradys bar and restaurant", "p j bradys tavern") >= 86
    assert sources.name_score("el poblado gastro bar", "poblado gastrobar") >= 86
    for a, b in (("spring cafe", "spring"), ("the bedford", "bedford studio"), ("the junction bar", "the junction"),
                 ("at the office", "the office"), ("catch steak", "catch"), ("the mercer kitchen", "bar mercer")):
        assert sources.name_score(a, b) < 80, (a, b)
    recs = [dohmh("41154226", "BURGERS & BEER", building="170", street="WEST 4 STREET", nta="MN40"),
            dohmh("50170331", "SPRING", building="116", street="MADISON STREET", nta="MN27", cuisine="Chinese"),
            dohmh("50131025", "BEDFORD STUDIO", building="62", street="BEDFORD STREET", nta="MN23"),
            dohmh("41611969", "CATCH", building="21", street="9 AVENUE", nta="MN23"),
            dohmh("50115910", "HUDSON YARDS CATERING LLC", building="55", street="HUDSON YARDS", nta="MN13"),
            dohmh("40003001", "KEENS STEAKHOUSE", building="72", street="WEST 36 STREET", nta="MN17"),
            dohmh("41639470", "SERAFINA", building="7", street="9 AVENUE", nta="MN23")]
    rows = [row("Black Tap Craft Burgers & Beer (UES)", "Upper East Side", n=1),
            row("Spring Cafe", "Chinatown", n=2), row("The Bedford", n=3), row("Catch Steak", "Meatpacking District", n=4),
            row("Hudson Yards Grill", "Hudson Yards", n=5), row("Keens", "Midtown", n=6),
            row("Serafina Meatpacking", n=7)]
    out, _ = sources.build_restaurants(rows, recs, nta_map)
    assert matches(out) == {"Black Tap Craft Burgers & Beer (UES)": None, "Spring Cafe": None, "The Bedford": None,
                            "Catch Steak": None, "Hudson Yards Grill": None,
                            "Keens": "40003001", "Serafina Meatpacking": "41639470"}  # one rare word + the NTA


def test_combined_dba_names_are_matched_one_by_one(nta_map):
    recs = [dohmh("40577007", "ACME / THE NINES", building="9", street="GREAT JONES STREET", nta="MN23"),
            dohmh("40604207", "CITY ISLAND DINER , SNUG BAR", boro="Bronx", building="304", street="CITY ISLAND AVENUE",
                  nta="BX10")]
    out, _ = sources.build_restaurants([row("The Nines", "NoHo", n=1),
                                        row("City Island Diner", "City Island", "Bronx", n=2)], recs, nta_map)
    assert matches(out) == {"The Nines": "40577007", "City Island Diner": "40604207"}


def test_name_variants_drop_qualifiers_and_use_them_as_neighborhood_hints(nta_map):
    assert "emmy squared" in sources._name_variants({"name": "Emmy Squared (UES)", "neighborhood": "Uptown"})
    assert "sluttyvegan" in sources._name_variants({"name": "SluttyVegan Brooklyn", "neighborhood": "Fort Greene"})
    assert "burgerology" in sources._name_variants({"name": "Burgerology Midtown", "neighborhood": "Midtown West"},
                                                   ["Midtown South", "Midtown"])
    recs = [dohmh("50101256", "EMMY SQUARED PIZZA", building="1426", street="3 AVENUE", nta="MN40"),
            dohmh("50176341", "SLUTTY VEGAN", boro="Brooklyn", building="690", street="FULTON STREET", nta="BK68")]
    rows = [row("Emmy Squared (UES)", "Uptown", n=1),  # 'Uptown' maps to no NTA; '(UES)' does
            row("SluttyVegan Brooklyn", "Fort Greene", "Brooklyn", notes="Plant-based burgers on Fulton St", n=2)]
    out, report = sources.build_restaurants(rows, recs, nta_map, national_chains="include")
    assert matches(out) == {"Emmy Squared (UES)": "50101256", "SluttyVegan Brooklyn": "50176341"}
    out, report = sources.build_restaurants(rows, recs, nta_map)  # and the matched Slutty Vegan is dropped once
    assert matches(out) == {"Emmy Squared (UES)": "50101256"} and report["national_chains_excluded"] == {
        "Slutty Vegan": 1}


def test_tied_candidates_make_the_row_ambiguous(nta_map):
    recs = [dohmh("50009228", "STOUT NYC", building="90", street="JOHN STREET", nta="MN25"),
            dohmh("50108855", "STOUT NYC", building="109", street="WEST 39 STREET", nta="MN17"),
            dohmh("50178587", "STOUT NYC", building="213", street="WEST 35 STREET", nta="MN17"),
            # two permits at one address are one place: the most recently inspected one is taken
            dohmh("50151490", "WILDFLOWER", building="505", street="WEST 23 STREET", nta="MN13"),
            dohmh("50181666", "WILDFLOWER", building="505", street="WEST 23 STREET", nta="MN13",
                  last="1900-01-01T00:00:00.000")]
    out, report = sources.build_restaurants([row("Stout NYC", "Midtown West", n=1), row("Wildflower", "Chelsea", n=2)],
                                            recs, nta_map)
    assert matches(out) == {"Stout NYC": None, "Wildflower": "50151490"}  # not the lowest CAMIS, 90 John St
    assert [(a["row"], sorted(c["camis"] for c in a["candidates"])) for a in report["csv_ambiguous"]] == [
        (1, ["50108855", "50178587"])]
    assert next(u["why"] for u in report["csv_unmatched"]) == "ambiguous: 2 records tie"


def test_records_carry_their_csv_row_and_stale_matches_are_flagged_not_dropped(nta_map):
    recs = [dohmh("41637468", "BUDDHA BEER BAR", building="4476", street="BROADWAY", nta="MN35",
                  last="2022-01-26T00:00:00.000"),
            dohmh("50131932", "HOUSTON HALL", building="222", street="WEST HOUSTON STREET", nta="MN23"),
            dohmh("7", "A BURGER")]
    rows = [row("Buddha Beer Bar", "Washington Heights", n=464), row("Houston Hall", n=28), row("Nowhere", n=5)]
    out, report = sources.build_restaurants(rows, recs, nta_map, cuisines=["Hamburgers"], min_date="2023-01-01")
    assert [(r["name"], r["csv_row"], r["camis"]) for r in out] == [
        ("Buddha Beer Bar", 464, "41637468"), ("Houston Hall", 28, "50131932"), ("Nowhere", 5, None),
        ("A Burger", None, "7")]
    assert report["csv_stale_matches"] == [{"row": 464, "name": "Buddha Beer Bar", "camis": "41637468",
                                            "dba": "BUDDHA BEER BAR", "last_inspection": "2022-01-26"}]


def test_a_name_that_names_the_street_places_the_row(nta_map):
    from pipeline.names import street_in_name

    assert street_in_name("333 Hudson Street", "Westville Hudson")
    assert street_in_name("Madison Square Park", "Shake Shack (Madison Square Park)")
    assert street_in_name("170 Flatbush Avenue", "Shake Shack Flatbush")
    assert not street_in_name("691 Madison Avenue", "Shake Shack (Madison Square Park)")
    assert not street_in_name("2315 Broadway", "5 Napkin Burger Broadway")  # one-word streets say too little
    assert not street_in_name("500 West 33 Street", "Shake Shack 33rd")  # and so do numbered ones
    assert not street_in_name("333 Hudson Street", "Hudson")
    assert not street_in_name("10 Park Avenue", "Treadwell Park", ignore={"treadwell", "park"})  # its own name
    # No Westville is left in the West Village: the row's name says it's the one on Hudson Street (MN24)
    recs = [dohmh("50120993", "WESTVILLE", building="333", street="HUDSON STREET", nta="MN24"),
            dohmh("41231284", "WESTVILLE", building="173", street="AVENUE A", nta="MN22"),
            dohmh("50057093", "WESTVILLE", building="110", street="WALL STREET", nta="MN25")]
    out, _ = sources.build_restaurants([row("Westville Hudson", n=1)], recs, nta_map)
    assert matches(out) == {"Westville Hudson": "50120993"}
    assert out[0]["match"]["method"] == "name+name-street"
    # Two Shake Shacks in MN13: '(Madison Square Park)' is the stand at that address, and the Hudson Yards row
    # takes the other one, in either order (they used to tie)
    shacks = [dohmh("41038085", "SHAKE SHACK", building="", street="MADISON SQUARE PARK", nta="MN13"),
              dohmh("50089328", "SHAKE SHACK", building="500", street="WEST 33 STREET", nta="MN13")]
    rows = [row("Shake Shack (Madison Square Park)", "Flatiron", n=1), row("Shake Shack (Hudson Yards)", "Hudson Yards", n=2)]
    for ordered in (rows, rows[::-1]):
        out, report = sources.build_restaurants(ordered, shacks, nta_map, national_chains="include")
        assert matches(out) == {"Shake Shack (Madison Square Park)": "41038085", "Shake Shack (Hudson Yards)": "50089328"}
        assert report["csv_ambiguous"] == []


def test_a_record_name_inside_the_row_name_must_start_it(nta_map):
    recs = [dohmh("1", "HIGHLINE CAFE", building="85", street="10 AVENUE", nta="MN13"),
            dohmh("2", "HIGHLINE CAFE", building="368", street="9 AVENUE", nta="MN13"),
            dohmh("41092609", "10TH AVENUE COOKSHOP", building="156", street="10 AVENUE", nta="MN13"),
            dohmh("40367189", "KENN'S BROOME STREET BAR", building="363", street="WEST BROADWAY", nta="MN24"),
            dohmh("50187434", "BROOME", building="431", street="BROOME STREET", nta="MN24")]
    rows = [row("BFB Highline", "Chelsea", n=1), row("Cookshop", "Chelsea", n=2), row("Broome Street Bar", "SoHo", n=3)]
    out, report = sources.build_restaurants(rows, recs, nta_map)
    # 'BFB Highline' is not HIGHLINE CAFE (it used to tie between the two); a row's name may sit anywhere in
    # a DBA that adds a street or an owner
    assert matches(out) == {"BFB Highline": None, "Cookshop": "41092609", "Broome Street Bar": "40367189"}
    assert report["csv_ambiguous"] == []


def test_a_tie_resolves_when_another_row_takes_one_of_the_tied_places(nta_map):
    # The Hell's Kitchen row ties between two Stouts (MN13 and MN17 are both in its neighborhood); the Chelsea
    # row's weaker claim takes the MN13 one afterwards, so the tie resolves to the other instead of leaving
    # the row ambiguous
    recs = [dohmh("1", "STOUT NYC", building="10", street="WEST 20 STREET", nta="MN13"),
            dohmh("2", "STOUT NYC", building="109", street="WEST 39 STREET", nta="MN17")]
    rows = [row("Stout NYC", "Hell's Kitchen", n=1), row("Stout Bar", "Chelsea", n=2)]
    for ordered in (rows, rows[::-1]):
        out, report = sources.build_restaurants(ordered, recs, nta_map)
        assert matches(out) == {"Stout NYC": "2", "Stout Bar": "1"}
        assert report["csv_ambiguous"] == []


def test_a_tie_breaks_on_the_named_address_then_on_the_neighborhood_zip(nta_map):
    # re-audit 2026-09-24: these three used to tie and go CSV-only. Brooklyn Diner's notes say 212 W 57th, where
    # DOHMH has no record: it files the diner under its corner address, 888 7 Avenue, next to the records at
    # 200-225 West 57 Street, while the other Brooklyn Diner is at 43rd St
    diners = [dohmh("41219536", "BROOKLYN DINER", building="1500", street="BROADWAY", nta="MN17", zipcode="10036",
                    lat="40.756849", lng="-73.985973"),
              dohmh("40401934", "BROOKLYN DINER", building="888", street="7 AVENUE", nta="MN17", zipcode="10106",
                    lat="40.765009", lng="-73.980416")]
    w57 = [dohmh("41312223", "FRESH & CO", building="200", street="WEST 57 STREET", nta="MN17", zipcode="10019",
                 lat="40.765621", lng="-73.980315"),
           dohmh("40364531", "CAFE ATELIER", building="215", street="WEST 57 STREET", nta="MN17", zipcode="10019",
                 lat="40.765887", lng="-73.980896"),
           dohmh("50099832", "NORDSTROM WOLF", building="225", street="WEST 57 STREET", nta="MN17", zipcode="10019",
                 lat="40.766065", lng="-73.981318")]
    diner = row("Brooklyn Diner", "Midtown West", notes="Classic NYC diner at 212 W 57th; burgers are a staple", n=317)
    out, report = sources.build_restaurants([diner], diners + w57, nta_map)
    assert matches(out) == {"Brooklyn Diner": "40401934"} and report["csv_ambiguous"] == []
    assert out[0]["match"]["method"] == "name+neighborhood+near-named-address"
    assert report["csv_address_now_other_business"] == []
    # nothing on that stretch of W 57th to say where 212 is: still a tie
    out, report = sources.build_restaurants([diner], diners, nta_map)
    assert matches(out) == {"Brooklyn Diner": None} and [a["row"] for a in report["csv_ambiguous"]] == [317]
    # No address named: the neighborhood's ZIP codes say which one. West Village is 10014, not University
    # Place (10003); Chelsea is 119 7th Ave (10011), not 1 Madison Ave (10010). In either CSV order.
    recs = [dohmh("50017903", "JACK'S WIFE FREDA", building="50", street="CARMINE STREET", nta="MN23", zipcode="10014"),
            dohmh("50132905", "JACK'S WIFE FREDA", building="72", street="UNIVERSITY PLACE", nta="MN23",
                  zipcode="10003"),
            dohmh("40619544", "CAFETERIA", building="119", street="7 AVENUE", nta="MN13", zipcode="10011"),
            dohmh("50150032", "CAFETERIA", building="1", street="MADISON AVENUE", nta="MN13", zipcode="10010")]
    rows = [row("Jack's Wife Freda", "West Village", n=59), row("Cafeteria", "Chelsea", n=136)]
    for ordered in (rows, rows[::-1]):
        out, report = sources.build_restaurants(ordered, recs, nta_map)
        assert matches(out) == {"Jack's Wife Freda": "50017903", "Cafeteria": "40619544"}
        assert report["csv_ambiguous"] == []
    assert {r["name"]: r["match"]["method"] for r in out} == {
        "Jack's Wife Freda": "name+neighborhood+neighborhood-zip", "Cafeteria": "name+neighborhood+neighborhood-zip"}
    # a neighborhood without listed ZIP codes, or a row that names an address (a ZIP can't overrule it), still ties
    for r in (row("Jack's Wife Freda", "Greenwich Village", n=1),
              row("Jack's Wife Freda", "West Village", notes="Cafe at 99 Nowhere St", n=1)):
        out, report = sources.build_restaurants([r], recs, nta_map)
        assert matches(out) == {"Jack's Wife Freda": None} and [a["row"] for a in report["csv_ambiguous"]] == [1]


def test_a_business_the_notes_name_at_the_address_is_not_a_sign_of_closure(nta_map):
    # At The Office opened in April 2026 beside The Consulate, at the same address, and its notes say so
    recs = [dohmh("50186305", "THE CONSULATE", building="160", street="E 38th St Plaza Terrace", nta="MN20",
                  last="1900-01-01T00:00:00.000"),
            dohmh("7", "PIZZA", building="413", street="NEW DORP LANE", boro="Staten Island", nta="SI45")]
    rows = [row("At The Office", "Murray Hill", notes="Upscale sports bar at 160 E 38th St, opened April 2026 beside "
                "The Consulate (same address); sports bars serve burgers", n=335),
            row("Old Sports Bar", "New Dorp", "Staten Island", notes="Pizza sports bar at 413 New Dorp Ln", n=2)]
    out, report = sources.build_restaurants(rows, recs, nta_map)
    assert matches(out) == {"At The Office": None, "Old Sports Bar": None}
    # an ordinary word in the notes ('Pizza') doesn't name the PIZZA there
    assert report["csv_address_now_other_business"] == [
        {"row": 2, "name": "Old Sports Bar", "address": "413 new dorp", "now": ["PIZZA (7)"]}]


ROSEMARYS_FIX = {
    "camis": "41668282", "dba": "ROSEMARY'S", "when": {"building": "1820", "street": "GREENWICH AVENUE"},
    "set": {"building": "18", "zipcode": "10011", "latitude": 40.734885, "longitude": -73.999713, "nta": "MN23"},
    "reason": "typo'd address", "source_url": "https://example.com", "checked_at": "2026-09-24",
}


def test_dohmh_overrides_fix_a_typod_record_before_matching(nta_map):
    typo = dohmh("41668282", "ROSEMARY'S", building="1820", street="GREENWICH AVENUE", nta="", zipcode="",
                 lat="0", lng="0", cuisine="Italian")
    rows = [row("Rosemary's", "West Village", website="https://menupages.com/rosemarys/18-greenwich-avenue-new-york")]
    out, report = sources.build_restaurants(rows, [typo], nta_map, overrides=[ROSEMARYS_FIX])
    r = out[0]
    assert (r["camis"], r["address"], r["zipcode"], r["lat"], r["lng"]) == (
        "41668282", "18 Greenwich Avenue", "10011", 40.734885, -73.999713)
    assert (r["nta"], r["neighborhood"], r["nta_source"]) == ("MN23", "West Village", "dohmh")
    assert report["dohmh_overrides_applied"] == ["41668282"] and report["dohmh_overrides_unused"] == []
    # without it the record keeps DOHMH's typo and has no map location
    out, report = sources.build_restaurants(rows, [typo], nta_map)
    assert out[0]["address"] == "1820 Greenwich Avenue" and out[0]["lat"] is None
    assert report["dohmh_overrides_applied"] == []


def test_dohmh_overrides_retire_once_dohmh_fixes_the_record(nta_map):
    fixed = dohmh("41668282", "ROSEMARY'S", building="18", street="GREENWICH AVENUE", lat="40.7349", lng="-73.9997")
    out, report = sources.build_restaurants([], [fixed], nta_map, cuisines=["Hamburgers"], overrides=[ROSEMARYS_FIX])
    assert out[0]["lat"] == 40.7349 and report["dohmh_overrides_applied"] == []
    assert report["dohmh_overrides_unused"] == [
        {"camis": "41668282", "why": 'the DOHMH record no longer says {"building": "1820", "street": "GREENWICH AVENUE"}'}]
    _, report = sources.build_restaurants([], [], nta_map, overrides=[ROSEMARYS_FIX])
    assert report["dohmh_overrides_unused"] == [{"camis": "41668282", "why": "CAMIS not in the DOHMH snapshot"}]


def test_dohmh_overrides_file_is_strict(tmp_path):
    assert sources.load_dohmh_overrides(tmp_path / "missing.json") == []
    committed = sources.load_dohmh_overrides()  # pipeline/data/dohmh_overrides.json
    assert any(o["camis"] == "41668282" and o["when"]["building"] == "1820" for o in committed)
    assert all(o.get("reason") and o.get("source_url") and o.get("checked_at") for o in committed)
    bad = tmp_path / "bad.json"
    for entry in ({**ROSEMARYS_FIX, "set": {"dba": "ROSEMARYS"}},  # only location fields
                  {**ROSEMARYS_FIX, "set": {}}):
        bad.write_text(json.dumps({"overrides": [entry]}))
        with pytest.raises(ValueError):
            sources.load_dohmh_overrides(bad)
    bad.write_text(json.dumps({"overrides": [ROSEMARYS_FIX, ROSEMARYS_FIX]}))
    with pytest.raises(ValueError, match="duplicate"):
        sources.load_dohmh_overrides(bad)


def menu_fix(url, reason="the list's page is a stale aggregator copy."):
    return {"menu_url": url, "checked_at": "2026-09-24", "reason": reason}


def test_menu_url_overrides_replace_the_list_menu_url_and_report(nta_map):
    rows = [csv_row("Due West", website="https://duewestnyc.com/", menu_url="https://agg.example/due-west/menu"),
            csv_row("Walker's", "TriBeCa", menu_url="https://www.walkersbarnyc.com/dinner", row=2),
            csv_row("Burger Plus", "Flushing", "Queens", row=3)]
    recs = [dohmh("4", "DUE WEST", building="189", street="WEST 10 STREET")]
    overrides = {
        "camis:4": menu_fix("https://duewestnyc.com/menus/dinner"),
        "csv:walkers-manhattan": menu_fix("https://www.walkersbarnyc.com/dinner"),  # the list caught up
        "csv:gone-manhattan": menu_fix("https://gone.example/menu"),
    }
    out, report = sources.build_restaurants(rows, recs, nta_map, menu_urls=overrides)
    due, walkers, plus = out
    assert due["key"] == "camis:4" and due["menu_url"] == "https://duewestnyc.com/menus/dinner"
    assert due["list_menu_url"] == "https://agg.example/due-west/menu"  # kept for the record, no longer tried
    assert due["menu_url_override"] == {"checked_at": "2026-09-24", "reason": "the list's page is a stale aggregator copy."}
    assert due["website"] == "https://duewestnyc.com/"  # the website stays a fallback
    assert "menu_url_override" not in walkers and "menu_url_override" not in plus and plus["menu_url"] is None
    assert report["menu_url_overrides_applied"] == ["camis:4"]
    assert report["menu_url_overrides_unused"] == [
        {"key": "csv:walkers-manhattan", "why": "the restaurant list already has this menu_url"},
        {"key": "csv:gone-manhattan",
         "why": "no restaurant with this key in scope (renamed or dropped from the list, or excluded)"}]
    # without overrides nothing changes
    out, report = sources.build_restaurants(rows, recs, nta_map)
    assert out[0]["menu_url"] == "https://agg.example/due-west/menu" and report["menu_url_overrides_applied"] == []


def test_menu_url_overrides_file_is_strict(tmp_path):
    assert sources.load_menu_url_overrides(tmp_path / "missing.json") == {}
    committed = sources.load_menu_url_overrides()  # pipeline/data/menu_urls.json
    assert committed and all(k.startswith(("camis:", "csv:")) for k in committed)
    assert all(o["reason"] and o["checked_at"] and o["menu_url"].startswith("http") for o in committed.values())
    bad = tmp_path / "bad.json"
    for key, entry in (("Due West", menu_fix("https://a.example/menu")),  # not a restaurant key
                       ("camis:4", {**menu_fix("https://a.example/menu"), "price": 12}),  # unknown field
                       ("camis:4", menu_fix("a.example/menu")),
                       ("camis:4", {**menu_fix("https://a.example/menu"), "checked_at": "Sept 24"}),
                       ("camis:4", menu_fix("https://a.example/menu", reason=" "))):
        bad.write_text(json.dumps({"overrides": {key: entry}}))
        with pytest.raises(ValueError, match="bad menu-URL override"):
            sources.load_menu_url_overrides(bad)


def test_committed_menu_url_overrides_name_restaurants_on_the_list():
    # every committed override should apply to the current restaurant list (data/restaurants.json); a
    # key that no longer exists is reported by `sources`, and this catches it before a run
    from pipeline import config

    if not config.RESTAURANTS_PATH.exists():
        pytest.skip("no data/restaurants.json")
    keys = {r["key"] for r in json.loads(config.RESTAURANTS_PATH.read_text())["restaurants"]}
    assert set(sources.load_menu_url_overrides()) <= keys


def test_blank_dohmh_name_at_a_named_address_does_not_crash(nta_map):
    # DOHMH has a record with an empty DBA at 585 E 189th St; a list row naming that address must still match.
    rows = [dohmh("300", "", building="585", street="EAST 189 STREET", boro="Bronx", nta="BX06", zipcode="10458"),
            dohmh("301", "HOWL AT THE MOON BAR & GRILL", building="585", street="EAST 189 STREET", boro="Bronx",
                  nta="BX06", zipcode="10458", cuisine="American")]
    row = csv_row("Howl at the Moon Bar & Grill", neighborhood="Belmont", borough="Bronx")
    row["notes"] = "DOHMH American; 585 East 189 Street, 10458"
    out, _ = sources.build_restaurants([row], rows, nta_map, cuisines=[], min_date="2023-01-01")
    assert [r["camis"] for r in out] == ["301"]
