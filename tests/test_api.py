import json
import threading

import pytest
from conftest import menu

from pipeline import context_client
from pipeline.api import Api, CacheMiss, CreditCapReached, CreditLedger, DiskCache, estimate_credits, request_key

URL = "https://duewestnyc.com/menus/"


def test_estimates_follow_the_docs():
    assert estimate_credits("search", context_client.search_request("q")) == 1  # 1 per 10 results
    assert estimate_credits("search", context_client.search_request("q", num_results=20)) == 2
    assert estimate_credits("map", context_client.map_request("a.com")) == 1
    assert estimate_credits("map", {"domain": "a.com", "search": "menu"}) == 2
    assert estimate_credits("scrape", context_client.scrape_request(URL)) == 5  # 1 + 4 for JSON
    # a PDF reserves its worst-case OCR (+1 per page up to end_page) so --max-credits is a hard cap
    pdf = 1 + 4 + context_client.PDF_MAX_PAGES
    assert estimate_credits("scrape", context_client.scrape_request("https://a.com/menu.pdf")) == pdf
    assert estimate_credits("scrape", context_client.scrape_request("https://cdn.x/abc"), maybe_pdf=True) == pdf


def test_cache_key_ignores_volatile_options():
    a = context_client.scrape_request(URL)
    assert request_key("scrape", a) == request_key("scrape", json.loads(json.dumps(a)))
    assert request_key("scrape", a) != request_key("scrape", context_client.scrape_request(URL + "dinner"))
    assert "max_age_ms" not in a and "tags" not in a and "timeout_opts" not in a


def test_cache_hit_costs_zero_credits(tmp_path, fake):
    f = fake(pages={URL: menu(("Burger", 18))})
    ledger = CreditLedger(100, log_path=tmp_path / "ledger.jsonl")
    api = Api(DiskCache(tmp_path / "cache"), ledger)
    first = api.scrape(URL)
    assert first["charged"] == 5 and not first["cached"] and ledger.spent == 5
    second = api.scrape(URL)
    assert second["charged"] == 0 and second["cached"] and f.count("scrape") == 1

    # a new run (fresh ledger + Api) is free too
    ledger2 = CreditLedger(100)
    api2 = Api(DiskCache(tmp_path / "cache"), ledger2)
    assert api2.scrape(URL)["charged"] == 0 and ledger2.spent == 0 and f.count("scrape") == 1
    assert ledger2.summary()["cache_hits"] == {"scrape": 1}

    lines = (tmp_path / "ledger.jsonl").read_text().splitlines()
    assert len(lines) == 1 and json.loads(lines[0])["charged"] == 5

    # --refresh re-fetches once per run, then serves the fresh copy
    api3 = Api(DiskCache(tmp_path / "cache"), CreditLedger(100), refresh=True)
    assert api3.scrape(URL)["charged"] == 5 and api3.scrape(URL)["charged"] == 0 and f.count("scrape") == 2


def test_offline_never_calls_api(tmp_path, fake):
    f = fake(pages={URL: menu(("Burger", 18))})
    api = Api(DiskCache(tmp_path), offline=True)
    with pytest.raises(CacheMiss):
        api.scrape(URL)
    assert f.calls == []


def test_max_credits_stops_before_overspending(tmp_path, fake):
    f = fake(pages={f"{URL}{i}": menu(("Burger", 10 + i)) for i in range(5)})
    ledger = CreditLedger(12)
    api = Api(DiskCache(tmp_path), ledger)
    api.scrape(f"{URL}0")
    api.scrape(f"{URL}1")
    with pytest.raises(CreditCapReached):
        api.scrape(f"{URL}2")  # 10 spent + 5 > 12
    assert ledger.spent == 10 and ledger.capped and f.count("scrape") == 2
    assert api.stop_event.is_set()
    # cached responses are still served after the stop
    assert api.scrape(f"{URL}0")["cached"]


def test_page_errors_are_cached_transient_errors_are_retried(tmp_path, fake):
    f = fake(pages={"https://gone.com/": ("error", 404, "WEBSITE_NOT_FOUND"),
                    "https://slow.com/": context_client.TransientError("scrape: HTTP 408")})
    api = Api(DiskCache(tmp_path), CreditLedger(100))
    r = api.scrape("https://gone.com/")
    assert not r["ok"] and r["error"]["code"] == "WEBSITE_NOT_FOUND"
    assert api.scrape("https://gone.com/")["cached"]  # not re-billed
    t = api.scrape("https://slow.com/")
    assert t["transient"] and t["charged"] == 0
    api2 = Api(DiskCache(tmp_path), CreditLedger(100))
    api2.scrape("https://slow.com/")  # live run retries a cached transient failure
    assert f.count("scrape") == 3
    # an offline replay reuses the transient placeholder instead of missing
    assert Api(DiskCache(tmp_path), offline=True).scrape("https://slow.com/")["transient"]


def test_fatal_error_stops_run(tmp_path, fake):
    fake(pages={URL: context_client.FatalError("HTTP 401")})
    api = Api(DiskCache(tmp_path), CreditLedger(100))
    with pytest.raises(context_client.FatalError):
        api.scrape(URL)
    assert api.stop_event.is_set() and api.ledger.reserved == 0


def test_concurrent_same_key_is_fetched_once(tmp_path, fake):
    f = fake(pages={URL: menu(("Burger", 18))})
    api = Api(DiskCache(tmp_path), CreditLedger(100))
    threads = [threading.Thread(target=api.scrape, args=(URL,)) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert f.count("scrape") == 1 and api.ledger.spent == 5


def test_stops_before_the_account_balance_runs_dry(tmp_path, fake, monkeypatch):
    f = fake(pages={f"{URL}{i}": menu(("Burger", 10)) for i in range(3)})
    balance = {"left": 12}

    def with_balance(endpoint, request, *, max_age_ms=None):
        out = f(endpoint, request, max_age_ms=max_age_ms)
        balance["left"] -= out["credits"]
        out["credits_remaining"] = balance["left"]  # what key_metadata.credits_remaining reports
        return out

    monkeypatch.setattr(context_client, "execute", with_balance)
    ledger = CreditLedger(1000)
    api = Api(DiskCache(tmp_path), ledger)
    api.scrape(f"{URL}0")
    assert ledger.balance == 7
    api.scrape(f"{URL}1")  # 5 <= 7
    with pytest.raises(CreditCapReached, match="account balance"):
        api.scrape(f"{URL}2")  # 5 > 2 left
    assert f.count("scrape") == 2 and ledger.summary()["account_credits_remaining"] == 2


def test_pdf_reservation_keeps_the_cap_under_concurrency():
    pdf = estimate_credits("scrape", context_client.scrape_request("https://a.com/menu.pdf"))
    ledger = CreditLedger(20)
    ledger.reserve(pdf)  # one scanned PDF in flight
    with pytest.raises(CreditCapReached):
        ledger.reserve(pdf)  # a second one could push a 10-page OCR bill past the cap
    ledger.settle(pdf, 15, endpoint="scrape", key="k", target=None, outcome="ok")  # 1 + 4 + 10 pages
    assert ledger.spent == 15 <= 20


def test_actual_cost_above_reservation_stops_the_run(tmp_path, fake):
    f = fake(pages={f"{URL}{i}": menu(("Burger", 10)) for i in range(3)}, scrape_credits=15)  # an unmarked PDF
    api = Api(DiskCache(tmp_path), CreditLedger(20))
    api.scrape(f"{URL}0")
    api.scrape(f"{URL}1")  # reserved 5 (15 + 5 <= 20), billed 15
    assert api.ledger.spent == 30 and api.ledger.capped and api.stop_event.is_set()
    with pytest.raises(CreditCapReached):
        api.scrape(f"{URL}2")
    assert f.count("scrape") == 2


def test_balance_is_the_lowest_reported_and_seeded_from_last_run():
    ledger = CreditLedger(1000)
    ledger.reserve(5)
    ledger.reserve(5)
    ledger.settle(5, 5, endpoint="scrape", key="a", target=None, outcome="ok", balance=90)
    ledger.settle(5, 5, endpoint="map", key="b", target=None, outcome="ok", balance=95)  # billed earlier, settled later
    assert ledger.balance == 90

    # a stale low balance from the last run (then a top-up) lets one call through to learn the real one
    stale = CreditLedger(1000, balance=3)
    stale.reserve(5)
    stale.settle(5, 5, endpoint="scrape", key="c", target=None, outcome="ok", balance=4995)
    stale.reserve(5)
    assert stale.balance == 4995

    # an accurate low balance: the second call waits for the first to report, then stops cleanly
    low = CreditLedger(1000, balance=7)
    low.reserve(5)
    outcome = {}

    def second():
        try:
            low.reserve(5)
            outcome["r"] = "reserved"
        except CreditCapReached as e:
            outcome["r"] = str(e)

    t = threading.Thread(target=second)
    t.start()
    t.join(0.2)
    assert t.is_alive()  # waiting, not refused on a guess and not sent unchecked
    low.settle(5, 5, endpoint="scrape", key="d", target=None, outcome="ok", balance=2)
    t.join(5)
    assert "account balance" in outcome["r"]
