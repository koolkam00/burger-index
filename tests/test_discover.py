from conftest import rec

from pipeline import discover
from pipeline.chains import build_targets


def target(name="Due West", **kw):
    return build_targets([rec(name, camis="1", address=kw.pop("address", "189 West 10 Street"), **kw)])[0]


def test_classify_url_categories():
    c = lambda u: discover.classify_url(u)[0]  # noqa: E731
    assert c("https://www.duewestnyc.com/menus/") == "official_menu"
    assert c("https://www.duewestnyc.com/") == "official_home"
    assert c("https://lumewestvillage.com/s/Lume-Dinner-Menu.pdf") == "official_pdf"
    assert c("https://images.getbento.com/accounts/x/media/menu.pdf") == "official_pdf"
    assert c("https://order.toasttab.com/online/due-west") == "online_ordering"
    assert c("https://order.online/store/706319") == "online_ordering"
    assert c("https://menupages.com/barrow-street-ale-house/15-barrow-st") == "menu_aggregator"
    assert c("https://www.grubhub.com/restaurant/x/123") == "delivery_marketplace"
    assert c("https://www.seamless.com/menu/x/123") == "delivery_marketplace"
    assert c("https://menurestaurants.net/pdf/abc.pdf") == "menu_aggregator"  # aggregator PDF is not official
    assert c("https://www.ubereats.com/store/x/abc") == "delivery_app"
    assert c("https://www.trycaviar.com/store/corner-bistro") == "delivery_app"
    for bad in ("https://www.yelp.com/biz/due-west", "https://www.tripadvisor.com/x", "https://www.instagram.com/x",
                "https://www.facebook.com/x", "https://www.tiktok.com/@x", "https://ny.eater.com/maps/best-burgers",
                "https://cititour.com/NYC_News/Little-Rubys/7754/print", "https://somesite.com/blog/best-burgers-nyc"):
        assert c(bad) == "reject", bad
    assert c("https://cititour.com/NYC_Restaurants/Royale/2781/menu") == "menu_aggregator"


def test_price_source_mapping():
    assert discover.Candidate("u", "official_menu", "x").price_source == "official_site"
    assert discover.Candidate("u", "official_home", "x").price_source == "official_site"
    assert discover.Candidate("u", "official_pdf", "x").price_source == "official_pdf"
    assert discover.Candidate("u", "delivery_app", "x").price_source == "delivery_app"
    assert discover.Candidate("u", "delivery_marketplace", "x").price_source == "delivery_app"  # Grubhub prices


def res(url, title="", description="", relevance="high"):
    return {"url": url, "title": title, "description": description, "relevance": relevance}


def test_rank_search_results_order_and_rejects():
    t = target()
    results = [
        res("https://www.yelp.com/biz/due-west-new-york", "Due West - Yelp"),
        res("https://www.doordash.com/store/due-west-new-york-123/", "Due West - DoorDash"),
        res("https://menupages.com/due-west/189-w-10th-st-new-york", "Due West Menu"),
        res("https://www.duewestnyc.com/", "Due West | West Village"),
        res("https://order.toasttab.com/online/due-west-189-w-10th", "Due West - Order online"),
        res("https://www.duewestnyc.com/menus/", "Menus - Due West"),
        res("https://www.ubereats.com/store/due-west-hoboken/abc", "Due West (Hoboken, NJ)"),
        res("https://www.doordash.com/store/east-west-grill-9/", "East West Grill - DoorDash"),
        res("https://www.grubhub.com/restaurant/due-west-55-grove-st-new-york/1", "Due West 55 Grove St"),
    ]
    cands, official_root, rejected = discover.rank_search_results(results, t)
    assert [c.category for c in cands] == ["official_menu", "official_home", "online_ordering", "menu_aggregator",
                                           "delivery_app"]
    assert cands[0].url == "https://www.duewestnyc.com/menus/"
    assert official_root == "https://www.duewestnyc.com/"
    joined = " ".join(rejected)
    assert "yelp.com" in joined
    assert "outside NYC" in joined  # Hoboken result
    assert "different restaurant" in joined  # East West Grill
    assert "different address" in joined  # 55 Grove St vs our 189 W 10th


def test_chain_without_official_prices_skips_official_site():
    rs = [rec("McDonald's", camis=str(i), dba="MCDONALD'S", address="4040 Broadway") for i in range(3)]
    t = build_targets(rs)[0]
    cands, official_root, rejected = discover.rank_search_results([
        res("https://www.mcdonalds.com/us/en-us/full-menu.html", "Full Menu | McDonald's"),
        res("https://www.ubereats.com/store/mcdonalds-4040-broadway/xyz", "McDonald's (4040 Broadway)"),
        res("https://www.ubereats.com/store/mcdonalds-1-main-st-brooklyn/xyz", "McDonald's (1 Main St, Brooklyn)"),
    ], t)
    assert [c.url for c in cands] == ["https://www.ubereats.com/store/mcdonalds-4040-broadway/xyz"]
    assert official_root == "https://www.mcdonalds.com/"
    assert any("chain site shows no prices" in r for r in rejected)


def test_search_query_uses_address():
    assert discover.search_query(target()) == '"Due West" 189 West 10 Street Manhattan NYC menu'
    unmatched = build_targets([rec("Emily", borough="Brooklyn", neighborhood="Clinton Hill", nta="BK69", csv=True)])[0]
    assert discover.search_query(unmatched) == '"Emily" Clinton Hill Brooklyn NYC menu'


def test_pick_menu_urls_prefers_dinner_menu_on_same_site():
    t = target()
    data = {"urls": [
        {"url": "https://duewestnyc.com/"},
        {"url": "https://duewestnyc.com/menus/cocktails"},
        {"url": "https://duewestnyc.com/menus/dinner"},
        {"url": "https://duewestnyc.com/menus/brunch"},
        {"url": "https://duewestnyc.com/about"},
        {"url": "https://otherplace.com/menu"},
    ]}
    assert discover.pick_menu_urls(data, "https://www.duewestnyc.com/", t) == [
        "https://duewestnyc.com/menus/dinner", "https://duewestnyc.com/menus/brunch"]
    assert discover.pick_menu_urls({"urls": []}, "https://www.duewestnyc.com/", t) == []


def test_pick_menu_urls_negative_words_match_whole_words_only():
    t = target()
    data = {"urls": [
        {"url": "https://duewestnyc.com/seventh-ave-menu"},  # 'event' inside 'seventh'
        {"url": "https://duewestnyc.com/menu/espresso-bar"},  # 'press' inside 'espresso'
        {"url": "https://duewestnyc.com/dessertmenu"},
        {"url": "https://duewestnyc.com/happyhour-menu"},
        {"url": "https://duewestnyc.com/private-events-menu"},
    ]}
    assert set(discover.pick_menu_urls(data, "https://www.duewestnyc.com/", t, limit=5)) == {
        "https://duewestnyc.com/menu/espresso-bar", "https://duewestnyc.com/seventh-ave-menu"}


def test_same_restaurant():
    t = target("Skinny Louie West Village")
    assert discover.same_restaurant(t, "Skinny Louie")
    assert discover.same_restaurant(t, None)
    assert not discover.same_restaurant(t, "Joe's Pizza")


def test_unknown_domains_naming_the_restaurant_are_last_resort_third_party():
    t = target("Hamburger America", address="51 Macdougal Street")
    cands, official_root, _ = discover.rank_search_results([
        res("https://damnlines.com/venue/hamburger-america", "Hamburger America - The Line"),
        res("https://www.hamburgeramerica.com/menus/", "Menu | Hamburger America"),
        res("https://www.doordash.com/store/hamburger-america-new-york-1/", "Hamburger America - DoorDash"),
        res("https://images.getbento.com/x/Hamburger-America-Menu.pdf", "Hamburger America menu (PDF)"),
        res("https://www.somefoodblog.net/", "Ten great NYC smash burgers"),
    ], t)
    assert [(c.category, discover.host_of(c.url)) for c in cands] == [
        ("official_menu", "hamburgeramerica.com"), ("official_pdf", "images.getbento.com"),
        ("delivery_app", "doordash.com"), ("third_party", "damnlines.com")]
    assert cands[-1].price_source == "menu_aggregator"
    assert official_root == "https://www.hamburgeramerica.com/"


def test_nyc_streets_and_dishes_named_after_other_cities_are_not_out_of_town():
    def conflict(t, url, title, description=""):
        return discover.rank_search_results([res(url, title, description)], t)[2]

    katz = target("Katz's Delicatessen", address="205 East Houston Street")
    other = target("Russ Burger", address="179 East Houston Street")
    assert conflict(other, "https://www.grubhub.com/restaurant/russ-burger-179-e-houston-st-new-york/1",
                    "Russ Burger - 179 E Houston St, New York, NY 10002") == []
    assert conflict(katz, "https://www.ubereats.com/store/katzs-delicatessen/abc",
                    "Katz's Delicatessen (205 E Houston St)") == []
    bronx = target("Bronx Burger Company", address="4713 White Plains Road", borough="Bronx", nta="BX44",
                   neighborhood="Williamsbridge")
    assert conflict(bronx, "https://www.grubhub.com/restaurant/bronx-burger-company-4713-white-plains-rd-bronx/2",
                    "Bronx Burger Company - 4713 White Plains Rd, Bronx, NY 10470") == []
    boston_rd = target("Burger Spot", address="1200 Boston Road", borough="Bronx", nta="BX35", neighborhood="Morrisania")
    assert conflict(boston_rd, "https://www.doordash.com/store/burger-spot-bronx-3/",
                    "Burger Spot - 1200 Boston Rd, Bronx") == []
    tex = target("Tex's Chicken and Burger", address="1 Main Street")
    assert conflict(tex, "https://www.ubereats.com/store/texs-chicken-and-burger/x", "Tex's Chicken and Burger",
                    "Popular items: Buffalo Wings, Cheeseburger, Chicago Dog") == []

    # real out-of-town pages are still rejected
    for title in ("Russ Burger (Hoboken, NJ)", "Russ Burger - 4400 Westheimer Rd, Houston, TX 77027",
                  "Russ Burger - 1 Main St, White Plains, NY 10601"):
        assert "outside NYC" in " ".join(conflict(other, "https://www.doordash.com/store/russ-burger-9/", title)), title


def test_homonym_official_sites_are_not_the_restaurant():
    cases = [
        ("Diner", "85 Broadway", "https://brooklyndiner.com/menu", "Brooklyn Diner | Menu", ""),
        ("James", "605 Carlton Avenue", "https://jamesonpub.com/", "Jameson Pub", ""),
        ("Blue Collar", "160 Havemeyer Street", "https://bluecollarmiami.com/", "Blue Collar", ""),
        ("Holy Cow", "1 Main Street", "https://holycowbbq.com/menu", "Holy Cow BBQ Los Angeles", "Texas BBQ in LA"),
        ("Smash House", "1 Main Street", "https://smashhouseburgers.com/", "Smash House Burgers | Chicago", ""),
        ("The Pit Stop", "1 Main Street", "https://pitstopbbq.com/menu", "Pit Stop BBQ - Houston", ""),
        ("Munch", "1 Main Street", "https://munchbar.com/", "Munch Bar", "Burgers and beer in Austin, TX"),
    ]
    for name, address, url, title, desc in cases:
        cands, official_root, _ = discover.rank_search_results([res(url, title, desc)], target(name, address=address))
        assert official_root is None and all(c.category not in discover.OFFICIAL for c in cands), name

    # ...while real own domains still match
    own = [
        ("Due West", "https://www.duewestnyc.com/", {}),
        ("Peter Luger Steak House", "https://peterluger.com/", {}),
        ("The Commodore", "https://www.thecommodorebrooklyn.com/", {"borough": "Brooklyn", "nta": "BK73",
                                                                   "neighborhood": "Williamsburg"}),
        ("Lume", "https://lumewestvillage.com/", {}),
        ("Burger Bar", "https://www.burgerbarnyc.com/", {}),
        ("Hamburger America", "https://www.hamburgeramerica.com/", {}),
        ("Skinny Louie West Village", "https://skinnylouienyc.com/", {}),
    ]
    for name, url, kw in own:
        assert discover.domain_matches(target(name, **kw), url), name
    # an NYC restaurant's official page naming another city is kept when it also names NYC
    cands, root, _ = discover.rank_search_results(
        [res("https://www.duewestnyc.com/", "Due West", "West Village, New York. Sister bar in Boston")], target())
    assert root == "https://www.duewestnyc.com/"


def test_generic_words_do_not_make_the_same_restaurant():
    rs = [rec("Burger King", camis=str(i), dba="BURGER KING") for i in range(3)]
    bk = build_targets(rs)[0]
    assert not discover.same_restaurant(bk, "Burger City")
    assert discover.same_restaurant(bk, "Burger King (Broadway)")
    assert not discover.same_restaurant(target("Burger Joint"), "Paul's Da Burger Joint")
    assert discover.same_restaurant(target("7th Street Burger"), "7th St Burger")


def test_menu_dates_and_special_menus_from_urls():
    from datetime import date

    assert discover.menu_date(
        "https://static1.squarespace.com/static/5db/t/623a/1647977531864/menus_for_web_3_22_DINNER.pdf") == date(2022, 3, 22)
    assert discover.menu_date("https://westville.com/wp-content/uploads/2024/09/DinnerMenu-4.17.24-FINAL.pdf") == \
        date(2024, 9, 1)
    assert discover.menu_date("https://x.com/menus/DinnerMenu-4.17.24.pdf") == date(2024, 4, 17)
    assert discover.menu_date("https://x.com/s/Restaurant Week Summer 2026.pdf") == date(2026, 12, 31)
    assert discover.menu_date("https://x.com/menu") is None
    assert discover.special_menu("https://x.com/s/Restaurant%20Week%20Summer%202026.pdf") == "restaurant week"
    assert discover.special_menu("https://x.com/menus/brunch takeout.pdf") == "brunch"
    assert discover.special_menu("https://x.com/BrunchMenu.pdf") == "brunch"
    assert discover.special_menu("https://x.com/menus/dinner") is None
    assert discover.special_menu("https://7thstreetburger.com/seventh-avenue/menu") is None
