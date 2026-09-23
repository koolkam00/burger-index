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
    assert c("https://www.grubhub.com/restaurant/x/123") == "menu_aggregator"
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
