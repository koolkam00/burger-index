import json

from conftest import menu, rec

from pipeline import build, config
from pipeline.api import Api, CreditLedger, DiskCache
from pipeline.chains import build_targets
from pipeline.process import process_target, replay, run_targets


def api_for(tmp_path, max_credits=None):
    return Api(DiskCache(tmp_path / "cache"), CreditLedger(max_credits))


def one(name="Due West", **kw):
    kw.setdefault("address", "189 West 10 Street")
    return build_targets([rec(name, camis=kw.pop("camis", "1"), **kw)])[0]


def sr(url, title):
    return {"url": url, "title": title, "description": "", "relevance": "high"}


def test_csv_menu_url_priced_in_one_scrape(tmp_path, fake):
    f = fake(pages={"https://duewestnyc.com/menus/": menu(("Smash Burger", 27), ("Veggie Burger", 19, "veggie"))})
    t = one(csv=True, menu_url="https://duewestnyc.com/menus/", website="https://duewestnyc.com/")
    res = process_target(t, api_for(tmp_path))
    assert res["status"] == "priced" and res["price_source"] == "official_site"
    assert res["menu_url"] == "https://duewestnyc.com/menus/" and res["website"] == "https://duewestnyc.com/"
    assert f.count("scrape") == 1 and f.count("search") == 0 and res["credits"] == 5
    assert "own site" in res["status_detail"]


def test_fallback_after_non_menu_then_search(tmp_path, fake):
    f = fake(
        search={"Due West": [
            sr("https://www.yelp.com/biz/due-west", "Due West - Yelp"),
            sr("https://order.toasttab.com/online/due-west", "Due West - Order online"),
        ]},
        pages={
            "https://cititour.com/NYC_Restaurants/Due-West/1/menu": menu(is_menu=False, has_prices=False),
            "https://order.toasttab.com/online/due-west": menu(("Due Burger", 21), restaurant_name="Due West"),
        },
    )
    t = one(csv=True, menu_url="https://cititour.com/NYC_Restaurants/Due-West/1/menu")
    res = process_target(t, api_for(tmp_path))
    assert res["status"] == "priced" and res["price_source"] == "online_ordering"
    assert [a["step"] for a in res["attempts"]] == ["scrape", "search", "scrape"]
    assert f.count("search") == 1


def test_homepage_is_mapped_to_menu_page(tmp_path, fake):
    f = fake(
        search={"Burger Bar": [sr("https://www.burgerbarnyc.com/", "Burger Bar NYC")]},
        maps={"burgerbarnyc.com": ["https://www.burgerbarnyc.com/menu/dinner", "https://www.burgerbarnyc.com/menu/drinks"]},
        pages={"https://www.burgerbarnyc.com/menu/dinner": menu(("Bar Burger", 16))},
    )
    res = process_target(one("Burger Bar"), api_for(tmp_path))
    assert res["status"] == "priced" and res["menu_url"] == "https://www.burgerbarnyc.com/menu/dinner"
    assert (f.count("search"), f.count("map"), f.count("scrape")) == (1, 1, 1)
    assert res["website"] == "https://www.burgerbarnyc.com/"


def test_hard_caps_and_reason(tmp_path, fake):
    urls = [f"https://www.ubereats.com/store/joes-{i}/x" for i in range(5)]
    f = fake(search={"Joe": [sr(u, "Joe's Burgers") for u in urls]},
             pages={u: menu(is_menu=False, has_prices=False) for u in urls})
    res = process_target(one("Joe's Burgers"), api_for(tmp_path))
    assert (f.count("search"), f.count("map"), f.count("scrape")) == (1, 0, 3)
    assert res["status"] == "no_menu_found" and "3-scrape cap" in res["status_detail"]


def test_no_candidates_anywhere(tmp_path, fake):
    f = fake(search={})
    res = process_target(one("Ghost Kitchen"), api_for(tmp_path))
    assert res["status"] == "no_menu_found" and f.count("scrape") == 0 and f.count("search") == 1
    assert "search found no usable menu page" in res["status_detail"]
    assert res["menu_url"] is None and res["price_source"] is None


def test_statuses_no_prices_nonbeef_error(tmp_path, fake):
    fake(pages={
        "https://a.com/menu": menu(("Burger", None)),
        "https://b.com/menu": menu(("Lamb Burger", 24, "lamb")),
        "https://c.com/menu": ("error", 400, "WEBSITE_ACCESS_ERROR"),
    }, search={})
    api = api_for(tmp_path)
    a = process_target(one("A Place", camis="1", csv=True, menu_url="https://a.com/menu"), api)
    assert a["status"] == "no_prices" and a["burgers"][0]["price"] is None
    b = process_target(one("B Place", camis="2", csv=True, menu_url="https://b.com/menu"), api)
    assert b["status"] == "no_burgers" and "non-beef" in b["status_detail"] and b["burgers"]
    c = process_target(one("C Place", camis="3", csv=True, menu_url="https://c.com/menu"), api)
    assert c["status"] == "error"


def test_chain_scraped_once_and_replayed_offline(tmp_path, fake):
    rs = [rec("McDonald's", camis=f"4000000{i}", dba="MCDONALD'S", address="4040 Broadway") for i in range(4)]
    rs.append(rec("Paul's Da Burger Joint", camis="5", address="131 2 Avenue", csv=True,
                  menu_url="https://paulsburgersnyc.com/menu"))
    targets = build_targets(rs)
    f = fake(
        search={"McDonald's": [
            sr("https://www.mcdonalds.com/us/en-us/full-menu.html", "Full Menu | McDonald's"),
            sr("https://www.ubereats.com/store/mcdonalds-4040-broadway/xyz", "McDonald's (4040 Broadway)"),
        ]},
        pages={
            "https://www.ubereats.com/store/mcdonalds-4040-broadway/xyz": menu(("Big Mac", 7.49), ("Cheeseburger", 3.29)),
            "https://paulsburgersnyc.com/menu": menu(("Hamburger", 11)),
        },
    )
    run_log = tmp_path / "run_log.jsonl"
    api = api_for(tmp_path, max_credits=100)
    summary = run_targets(targets, api, workers=3, run_log_path=run_log)
    assert summary["done"] == 2 and summary["credits_spent"] == 1 + 5 + 5
    assert f.count("scrape") == 2  # mcdonalds.com skipped: chain site shows no prices
    lines = [json.loads(x) for x in run_log.read_text().splitlines()]
    assert {x["status"] for x in lines} == {"priced"} and all("urls_tried" in x for x in lines)

    # build replays from cache only: identical results, zero calls
    calls_before = len(f.calls)
    results, pending = replay(targets, Api(DiskCache(tmp_path / "cache"), offline=True))
    assert not pending and len(f.calls) == calls_before
    for k, live in summary["results"].items():
        assert {x: results[k][x] for x in ("status", "menu_url", "burgers", "status_detail")} == \
               {x: live[x] for x in ("status", "menu_url", "burgers", "status_detail")}
    d = build.assemble(targets, results, generated_at="2026-09-23T12:00:00Z")
    build.validate(d)
    mc = [r for r in d["restaurants"] if r["chain"] == "mcdonalds"]
    assert len(mc) == 4 and {r["index_price"] for r in mc} == {3.29}
    assert all(r["price_source"] == "delivery_app" and "may vary by location" in r["status_detail"] for r in mc)
    assert d["stats"]["index_median"] == 3.29


def test_max_credits_stop_keeps_finished_targets(tmp_path, fake):
    rs = [rec(f"Place {i}", camis=str(i), csv=True, menu_url=f"https://p{i}.com/menu") for i in range(6)]
    targets = build_targets(rs)
    fake(pages={f"https://p{i}.com/menu": menu(("Burger", 10 + i)) for i in range(6)})
    api = api_for(tmp_path, max_credits=12)
    summary = run_targets(targets, api, workers=1, run_log_path=None)
    assert summary["capped"] and summary["done"] == 2 and summary["stopped"] == 4
    assert summary["credits_spent"] == 10

    results, pending = replay(targets, Api(DiskCache(tmp_path / "cache"), offline=True))
    assert len(results) == 2 and len(pending) == 4
    d = build.assemble(targets, results, n_pending_restaurants=4, generated_at="2026-09-23T12:00:00Z")
    build.validate(d)
    assert d["stats"]["restaurants_scanned"] == 2 and "4 more restaurants" in d["methodology"]["coverage_note"]

    # the next run resumes: cached targets are free, the rest get scraped
    api2 = api_for(tmp_path, max_credits=100)
    summary2 = run_targets(targets, api2, workers=2, run_log_path=None)
    assert summary2["done"] == 6 and summary2["credits_spent"] == 20
    assert config.MAX_SCRAPES == 3
