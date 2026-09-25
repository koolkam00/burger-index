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
    mc = [r for r in d["restaurants"] if r.get("chain") == "mcdonalds"]
    # the scrape looked for the cheapest burger (index_item); build publishes the priciest one (top_item)
    assert len(mc) == 4 and {r["index_price"] for r in mc} == {7.49}
    assert all(r["burger"]["name"] == "Big Mac" and r["price_source"] == "delivery_app" for r in mc)
    assert all("may vary by location" in results[k]["status_detail"] for k in results if k.startswith("chain:"))
    # McDonald's counts once, not four times: median(7.49, 11)
    assert d["stats"]["index_median"] == 9.25 and d["stats"]["restaurants_priced"] == 5


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
    d = build.assemble(targets, results, generated_at="2026-09-23T12:00:00Z")
    build.validate(d)
    # not yet scraped: left out of the dataset until a run reaches them
    assert len(d["restaurants"]) == 2 and d["stats"]["restaurants_priced"] == 2

    # the next run resumes: cached targets are free, the rest get scraped
    api2 = api_for(tmp_path, max_credits=100)
    summary2 = run_targets(targets, api2, workers=2, run_log_path=None)
    assert summary2["done"] == 6 and summary2["credits_spent"] == 20
    assert config.MAX_SCRAPES == 3


def test_unmapped_homepage_searches_first_and_tries_marketplaces_before_it(tmp_path, fake):
    home = "http://paulsburgersnyc.com/"
    gh = "https://www.grubhub.com/restaurant/pauls-da-burger-joint-131-2nd-ave-new-york/4381032"
    f = fake(
        maps={"paulsburgersnyc.com": []},
        search={"Paul's": [sr("https://www.doordash.com/store/pauls-da-burger-joint-1/", "Paul's Da Burger Joint"),
                           sr(gh, "Paul's Da Burger Joint - Grubhub")]},
        pages={gh: menu(("Beef Burger", 9.5)), home: menu(is_menu=False, has_prices=False)},
    )
    t = one("Paul's Da Burger Joint", address="131 2 Avenue", csv=True, website=home)
    res = process_target(t, api_for(tmp_path))
    assert res["status"] == "priced" and res["menu_url"] == gh
    assert [a["step"] for a in res["attempts"]] == ["map", "search", "scrape"]
    assert f.count("scrape") == 1 and res["website"] == home
    # Grubhub is a delivery marketplace: delivery prices, labeled as such
    assert res["price_source"] == "delivery_app" and "Delivery-app prices" in res["status_detail"]
    assert res["status_detail"] == ("Prices from a delivery app (grubhub.com). Delivery-app prices usually run above "
                                    "in-store prices.")


def test_ctrl_c_stops_queued_targets_and_live_calls(tmp_path, fake, monkeypatch):
    import os
    import signal

    import pytest

    from pipeline import context_client

    rs = [rec(f"Place {i}", camis=str(100 + i), csv=True, menu_url=f"https://p{i}.com/menu") for i in range(30)]
    targets = build_targets(rs)
    f = fake(pages={f"https://p{i}.com/menu": menu(("Burger", 10 + i)) for i in range(30)})

    def interrupting(endpoint, request, *, max_age_ms=None):
        out = f(endpoint, request, max_age_ms=max_age_ms)
        if f.count("scrape") == 3:
            os.kill(os.getpid(), signal.SIGINT)  # Ctrl-C: KeyboardInterrupt in the main thread only
        return out

    monkeypatch.setattr(context_client, "execute", interrupting)
    api = api_for(tmp_path, max_credits=1000)
    run_log = tmp_path / "run_log.jsonl"
    with pytest.raises(KeyboardInterrupt):
        run_targets(targets, api, workers=2, run_log_path=run_log)
    # the queue was cancelled and in-flight targets made no further live call
    assert api.stop_event.is_set()
    assert f.count("scrape") <= 4 and api.ledger.spent <= 20
    assert json.loads(run_log.read_text().splitlines()[-1])["status"] == "interrupted"


def test_partial_delivery_page_keeps_looking_for_a_full_menu(tmp_path, fake):
    rs = [rec("McDonald's", camis=f"4000000{i}", dba="MCDONALD'S", address="4040 Broadway") for i in range(3)]
    t = build_targets(rs)[0]
    ue = "https://www.ubereats.com/store/mcdonalds-4040-broadway/xyz"
    gh = "https://www.grubhub.com/restaurant/mcdonalds-4040-broadway-new-york/123"
    f = fake(
        search={"McDonald's": [sr(ue, "McDonald's (4040 Broadway)"), sr(gh, "McDonald's 4040 Broadway - Grubhub")]},
        pages={ue: menu(("Double Cheeseburger", 4.99), ("Big Mac", 8.39)),
               gh: menu(("Hamburger", 3.19), ("Cheeseburger", 3.59), ("McDouble", 4.19), ("Big Mac", 7.99))},
    )
    res = process_target(t, api_for(tmp_path))
    # Grubhub (full store menu) now ranks ahead of Uber Eats and wins anyway
    assert res["status"] == "priced" and res["menu_url"] == gh and f.count("scrape") == 1

    # Only a partial Uber Eats page: keep looking within the caps, then fall back to it with a note
    f = fake(search={"McDonald's": [sr(ue, "McDonald's (4040 Broadway)")]},
             pages={ue: menu(("Double Cheeseburger", 4.99), ("Big Mac", 8.39))})
    res = process_target(t, api_for(tmp_path / "2"))
    assert res["status"] == "priced" and res["menu_url"] == ue
    assert "looked incomplete (only 2 priced beef burgers on the page)" in res["status_detail"]
    assert "not final" in res["attempts"][-1]["outcome"]


def test_curated_chain_page_without_its_cheapest_item_is_not_final(tmp_path, fake):
    rs = [rec("McDonald's", camis=f"4000000{i}", dba="MCDONALD'S", address="4040 Broadway") for i in range(3)]
    t = build_targets(rs)[0]
    assert t.cheapest_item == "hamburger"
    a = "https://www.ubereats.com/store/mcdonalds-4040-broadway/a"
    b = "https://www.doordash.com/store/mcdonalds-4040-broadway-2/"
    fake(search={"McDonald's": [sr(a, "McDonald's (4040 Broadway)"), sr(b, "McDonald's 4040 Broadway")]},
         pages={a: menu(("Cheeseburger", 4.19), ("McDouble", 4.49), ("Big Mac", 8.39)),
                b: menu(("Hamburger", 3.29), ("Cheeseburger", 4.19), ("McDouble", 4.49), ("Big Mac", 8.39))})
    res = process_target(t, api_for(tmp_path))
    assert res["menu_url"] == b and [x["price"] for x in res["burgers"]][0] == 3.29


def test_temporary_search_failure_is_retried_not_published(tmp_path, fake, monkeypatch):
    from pipeline import cli, context_client

    f = fake(search={})

    def failing_search(endpoint, request, *, max_age_ms=None):
        if endpoint == "search":
            f.calls.append((endpoint, request))
            raise context_client.TransientError("search: HTTP 429")
        return f(endpoint, request, max_age_ms=max_age_ms)

    monkeypatch.setattr(context_client, "execute", failing_search)
    t = one("Ghost Kitchen")
    res = process_target(t, api_for(tmp_path))
    assert res["retry_pending"] and res["status"] == "no_menu_found"
    assert "Web search failed (TRANSIENT)" in res["status_detail"] and "retries it" in res["status_detail"]
    assert "found no usable menu page" not in res["status_detail"]

    # plan/build: not yet scraped (priced for the retry), not published as 'no menu'
    results, pending = replay([t], Api(DiskCache(tmp_path / "cache"), offline=True))
    assert results == {} and pending == [t]
    assert cli._estimate(pending)["credits"]["first_pass"] > 0

    # the next live run retries the search
    fake(search={})
    process_target(t, api_for(tmp_path))
    assert f.count("search") == 1


def test_special_pilot_menu_url_tries_the_website_first(tmp_path, fake):
    rw = "https://duewestnyc.com/s/Restaurant Week Summer 2026.pdf"
    home = "https://duewestnyc.com/"
    dinner = "https://duewestnyc.com/menus/dinner"
    f = fake(maps={"duewestnyc.com": [dinner]},
             pages={rw: menu(("Burger (prix fixe)", 45)), dinner: menu(("Due Burger", 24))})
    res = process_target(one(csv=True, menu_url=rw, website=home), api_for(tmp_path))
    assert res["status"] == "priced" and res["menu_url"] == dinner
    assert [a["step"] for a in res["attempts"]] == ["map", "scrape"] and f.count("scrape") == 1


def test_old_menu_file_keeps_looking_and_says_its_date(tmp_path, fake):
    old = "https://static1.squarespace.com/static/5db3124b/t/623a243b/1647977531864/menus_for_web_DINNER.pdf"
    home = "https://www.duewestnyc.com/"
    dinner = "https://www.duewestnyc.com/menus/dinner"
    fake(maps={"duewestnyc.com": [dinner]}, pages={old: menu(("Hamburger", 12)), dinner: menu(("Due Burger", 24))})
    res = process_target(one(csv=True, menu_url=old, website=home), api_for(tmp_path))
    assert res["menu_url"] == dinner and res["burgers"][0]["price"] == 24

    # nothing newer: the old file is used, and the result says how old it is
    fake(maps={"duewestnyc.com": []}, pages={old: menu(("Hamburger", 12)), home: menu(is_menu=False)}, search={})
    res = process_target(one(csv=True, menu_url=old, website=home), api_for(tmp_path / "2"))
    assert res["status"] == "priced" and res["menu_url"] == old
    assert "The menu file dates from March 2022, so prices may have changed" in res["status_detail"]


def test_scraped_page_for_another_city_is_rejected(tmp_path, fake):
    dd = "https://www.doordash.com/store/due-west-123/"
    page = menu(("Due Burger", 14))
    page["location"] = "4400 Westheimer Rd, Houston, TX 77027"
    fake(search={"Due West": [sr(dd, "Due West - DoorDash")]}, pages={dd: page})
    res = process_target(one(), api_for(tmp_path))
    assert res["status"] == "no_menu_found" and "outside NYC" in res["status_detail"]


def test_chain_note_names_the_location_whose_menu_was_read(tmp_path, fake):
    # Burger Joint's site serves the Moynihan Food Hall menu (383 W 31st St), not the pilot row's
    # hotel counter on W 57th St: the note and the chain's source row follow the page.
    url = "https://www.burgerjointny.com/moynihan-food-hall"
    rs = [rec("Burger Joint", camis="1", dba="BURGER JOINT", address="118 West 57 Street", csv=True, menu_url=url),
          rec("Burger Joint", camis="2", dba="BURGER JOINT", address="383 West 31 Street"),
          rec("Burger Joint", camis="3", dba="BURGER JOINT", address="220 36 Street", borough="Brooklyn",
              nta="BK32", neighborhood="Sunset Park West")]
    (t,) = build_targets(rs)
    assert t.chain == "burger-joint" and t.rep["camis"] == "1"
    for i, (location, where, source) in enumerate([
        ("383 west 31st street, unit 31, new york, ny 10001", "383 West 31 Street, Manhattan", "camis:2"),
        ("118 W 57th St, New York, NY 10019", "118 West 57 Street, Manhattan", "camis:1"),
        (None, "118 West 57 Street, Manhattan", "camis:1"),  # page names no address: the pilot row's
    ]):
        fake(pages={url: {**menu(("Hamburger", 13.96)), "location": location}})
        res = process_target(t, api_for(tmp_path / str(i)))
        assert res["status"] == "priced" and res["source_key"] == source
        assert f"Chain-level prices from one NYC location ({where})" in res["status_detail"]
        # every location gets the menu read at the source location
        d = build.assemble([t], {t.key: res}, generated_at="2026-09-23T12:00:00Z")
        assert [r["index_price"] for r in d["restaurants"]] == [13.96, 13.96, 13.96]


def test_menu_url_override_is_scraped_as_the_menu_and_trusted(tmp_path, fake):
    # Dutch Boy Burger is a counter inside the Franklin Park bar: its store page names the bar. A
    # hand-checked override page is scraped first, as it is (no site map for a URL that looks like a
    # homepage), and is not rejected as another restaurant's or another location's.
    checked = {"checked_at": "2026-09-24", "reason": "hand-checked"}
    store = "https://www.seamless.com/menu/franklin-park-766-franklin-ave-brooklyn/2878081"
    page = {**menu(("Classic Smash Burger", 11), ("The Dutch Boy", 14), ("The Cowboy", 17), restaurant_name="Franklin Park"),
            "location": "766 Franklin Ave, Brooklyn, NY 11238"}
    f = fake(pages={store: page}, search={})
    r = {**rec("Dutch Boy Burger", camis="41329576", address="618 St Johns Place", borough="Brooklyn", nta="BK61",
               neighborhood="Crown Heights North", menu_url=store, csv=True), "menu_url_override": checked}
    (t,) = build_targets([r])
    res = process_target(t, api_for(tmp_path))
    assert res["status"] == "priced" and res["menu_url"] == store and res["burgers"][0]["price"] == 11
    assert res["attempts"][0]["origin"] == "menu_url override" and f.count("search") == 0
    # without the override the same page is another restaurant's
    (t,) = build_targets([{k: v for k, v in r.items() if k != "menu_url_override"}])
    res = process_target(t, api_for(tmp_path / "2"))
    assert res["status"] == "no_menu_found" and "a different restaurant" in res["status_detail"]

    # an override that looks like a homepage is the menu page itself: scraped, never mapped
    home = "https://thesmithrestaurant.com/location/east-village/"
    f = fake(pages={home: menu(("Burger royale", 26), restaurant_name="The Smith")}, maps={}, search={})
    r = {**rec("The Smith", camis="41298603", address="55 3 Avenue", website=home, menu_url=home, csv=True),
         "menu_url_override": checked}
    (t,) = build_targets([r])
    res = process_target(t, api_for(tmp_path / "3"))
    assert res["status"] == "priced" and res["price_source"] == "official_site"
    assert (f.count("map"), f.count("scrape")) == (0, 1)


def test_repeated_temporary_failure_is_accepted_after_two_runs(tmp_path, fake, monkeypatch):
    from pipeline import cli, context_client
    from pipeline.process import transient_history

    home = "http://www.professorthoms.com/"
    f = fake(search={}, pages={home: menu(is_menu=False, has_prices=False)})

    def failing_map(endpoint, request, *, max_age_ms=None):
        if endpoint == "map":
            f.calls.append((endpoint, request))
            raise context_client.TransientError("map: HTTP 503")
        return f(endpoint, request, max_age_ms=max_age_ms)

    monkeypatch.setattr(context_client, "execute", failing_map)
    t = one("Professor Thom's", csv=True, website=home, address="219 2 Avenue")
    run_log = tmp_path / "run_log.jsonl"
    cache = tmp_path / "cache"

    def live_run(run_id):
        return run_targets([t], Api(DiskCache(cache), CreditLedger(100)), workers=1, run_log_path=run_log,
                           run_id=run_id, history=transient_history(run_log))["results"][t.key]

    def offline():
        return replay([t], Api(DiskCache(cache), offline=True), history=transient_history(run_log))

    # run 1: the map call fails temporarily -> provisional, not published, priced for a retry
    first = live_run("run1")
    assert first["retry_pending"] and not first["transient_accepted"]
    assert first["transient_calls"] == [["map", "professorthoms.com"]]
    results, pending = offline()
    assert results == {} and pending == [t] and cli._estimate(pending)["credits"]["first_pass"] > 0

    # run 2 retries it (0 credits), it fails the same way again: the best result stands, with a note
    second = live_run("run2")
    assert f.count("map") == 2 and not second["retry_pending"] and second["transient_accepted"]
    note = ("A Context.dev call (site map of professorthoms.com) failed temporarily on 2 separate runs, so this is "
            "the best result without it; later runs still retry it.")
    assert note in second["status_detail"] and "the next run retries it" not in second["status_detail"]
    results, pending = offline()
    assert pending == [] and results[t.key]["status"] == "no_menu_found" and note in results[t.key]["status_detail"]
    lines = [json.loads(x) for x in run_log.read_text().splitlines()]
    assert [(x["run_id"], x["retry_pending"], x["transient_calls"]) for x in lines] == [
        ("run1", True, [["map", "professorthoms.com"]]), ("run2", False, [["map", "professorthoms.com"]])]

    # the same run logged twice is one run, and without the log a replay still waits for the retry
    assert transient_history(run_log)[t.key] == {("map", "professorthoms.com"): {"run1", "run2"}}
    assert replay([t], Api(DiskCache(cache), offline=True))[1] == [t]

    # a later run where the call gets through replaces the placeholder: a normal result again
    monkeypatch.setattr(context_client, "execute", f)
    f.maps["professorthoms.com"] = ["http://www.professorthoms.com/menu"]
    f.pages["http://www.professorthoms.com/menu"] = menu(("Thom's Burger", 17))
    third = live_run("run3")
    assert third["status"] == "priced" and not third["transient_calls"] and not third["transient_accepted"]


def test_transient_history_reads_run_log_lines_written_before_transient_calls(tmp_path):
    from pipeline.process import transient_history

    def old_line(run_id, target="csv:professor-thoms-manhattan"):
        return {"run_id": run_id, "target": target, "status": "no_menu_found", "retry_pending": True,
                "status_detail": "The pages found were not menus. A Context.dev call failed temporarily (map); the "
                                 "next run retries it. Tried: professorthoms.com (not a menu).",
                "attempts": [{"step": "map", "domain": "professorthoms.com", "outcome": "failed", "credits": 0},
                             {"step": "search", "query": "\"Professor Thom's\" menu", "outcome": "10 results, 2 usable"},
                             {"step": "scrape", "url": "http://www.professorthoms.com/", "outcome": "not a menu"}]}

    scrape_line = {"run_id": "r1", "target": "camis:1", "retry_pending": True,
                   "status_detail": "A Context.dev call failed temporarily (scrape); the next run retries it.",
                   "attempts": [{"step": "scrape", "url": "https://a.example/menu", "outcome": "error: TRANSIENT"},
                                {"step": "scrape", "url": "https://b.example/menu", "outcome": "not a menu"}]}
    log_path = tmp_path / "run_log.jsonl"
    log_path.write_text("\n".join(json.dumps(x) for x in (old_line("r1"), old_line("r2"), scrape_line,
                                                            {"run_id": "r2", "status": "interrupted"})) + "\n\n")
    h = transient_history(log_path)
    assert h == {"csv:professor-thoms-manhattan": {("map", "professorthoms.com"): {"r1", "r2"}},
                 "camis:1": {("scrape", "https://a.example/menu"): {"r1"}}}
    assert transient_history(tmp_path / "missing.jsonl") == {}
