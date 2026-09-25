"""End-to-end CLI: sources -> plan -> run (mocked Context.dev) -> build, all in a temp data dir."""

import json

import pytest
from conftest import menu

from pipeline import build, cli, config, sources

DOHMH_ROWS = [
    {"camis": "1", "dba": "MCDONALD'S", "boro": "Manhattan", "building": "4040", "street": "BROADWAY", "nta": "MN36",
     "zipcode": "10032", "latitude": "40.84", "longitude": "-73.94", "cuisine_description": "Hamburgers",
     "last_inspection": "2026-05-01T00:00:00.000"},
    {"camis": "2", "dba": "MCDONALDS", "boro": "Brooklyn", "building": "1", "street": "FULTON STREET", "nta": "BK38",
     "zipcode": "11201", "latitude": "40.69", "longitude": "-73.99", "cuisine_description": "Hamburgers",
     "last_inspection": "2026-05-01T00:00:00.000"},
    {"camis": "3", "dba": "MCDONALD'S #123", "boro": "Queens", "building": "5", "street": "MAIN STREET", "nta": "QN22",
     "zipcode": "11354", "latitude": "40.76", "longitude": "-73.83", "cuisine_description": "Hamburgers",
     "last_inspection": "2026-05-01T00:00:00.000"},
    {"camis": "4", "dba": "DUE WEST", "boro": "Manhattan", "building": "189", "street": "WEST 10 STREET", "nta": "MN23",
     "zipcode": "10014", "latitude": "40.73", "longitude": "-74.0", "cuisine_description": "American",
     "last_inspection": "2026-05-01T00:00:00.000"},
    {"camis": "5", "dba": "HAMBURGER AMERICA", "boro": "Manhattan", "building": "51", "street": "MACDOUGAL STREET",
     "nta": "MN24", "zipcode": "10012", "latitude": "40.72", "longitude": "-74.0", "cuisine_description": "Hamburgers",
     "last_inspection": "2026-05-01T00:00:00.000"},
]


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    d = tmp_path / "data"
    monkeypatch.setattr(config, "DATA_DIR", d)
    monkeypatch.setattr(config, "CACHE_DIR", d / "cache")
    monkeypatch.setattr(config, "OUTPUT_PATH", d / "burger_index.json")
    monkeypatch.setattr(config, "RESTAURANTS_PATH", d / "restaurants.json")
    monkeypatch.setattr(config, "RUN_LOG_PATH", d / "run_log.jsonl")
    monkeypatch.setattr(config, "LEDGER_PATH", d / "credit_ledger.jsonl")
    csv = tmp_path / "pilot.csv"
    csv.write_text("name,neighborhood,borough,website,menu_url,notes\n"
                   "Due West,West Village,Manhattan,http://www.duewestnyc.com/,https://www.duewestnyc.com/menus/,x\n")
    monkeypatch.setattr(config, "RESTAURANT_LIST_CSV", csv)
    monkeypatch.setattr(sources, "socrata_get", lambda url, params, http=None: DOHMH_ROWS)
    monkeypatch.setattr(sources, "MENU_URLS_PATH", tmp_path / "menu_urls.json")  # none unless a test writes one
    return d


def test_sources_plan_run_build(data_dir, fake, capsys):
    # McDonald's is a national chain (excluded by default); this flow opts in, and the flag is
    # remembered by plan/run/build like the other scope flags.
    assert cli.main(["sources", "--cuisines", "Hamburgers", "--national-chains", "include"]) == 0
    doc = json.loads(config.RESTAURANTS_PATH.read_text())
    assert len(doc["restaurants"]) == 5 and doc["restaurants"][0]["name"] == "Due West"

    f = fake(
        search={"McDonald's": [{"url": "https://www.doordash.com/store/mcdonalds-new-york-1/", "title": "McDonald's",
                                "description": "", "relevance": "high"}],
                "Hamburger America": []},
        pages={"https://www.duewestnyc.com/menus/": menu(("Smash Burger", 27)),
               "https://www.doordash.com/store/mcdonalds-new-york-1/": menu(("Cheeseburger", 3.49), ("Big Mac", 7.99))},
    )
    capsys.readouterr()
    assert cli.main(["plan"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["targets"] == 3 and plan["chains"] == 1 and plan["chain_locations"] == 3
    assert plan["targets_to_scrape"] == 3 and plan["credits"]["first_pass"] > 0
    assert f.calls == []  # plan never calls the API

    assert cli.main(["run", "--max-credits", "100", "--workers", "2"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["done"] == 3 and out["credits_spent"] == 5 + (1 + 5) + 1
    d = json.loads(config.OUTPUT_PATH.read_text())
    build.validate(d)
    assert len(d["restaurants"]) == 5 and d["stats"]["restaurants_priced"] == 4
    ha = next(r for r in d["restaurants"] if r["name"] == "Hamburger America")
    assert ha["index_price"] is None and ha["burger"] is None
    assert out["build"]["statuses"] == {"priced": 4, "no_menu_found": 1} and out["build"]["restaurants"] == 5

    # re-run and build: zero new calls, zero credits
    n = len(f.calls)
    assert cli.main(["run"]) == 0
    assert json.loads(capsys.readouterr().out)["credits_spent"] == 0
    config.OUTPUT_PATH.unlink()
    assert cli.main(["build"]) == 0
    assert len(f.calls) == n
    assert json.loads(config.OUTPUT_PATH.read_text())["stats"]["restaurants_priced"] == 4
    ledger = [json.loads(x) for x in config.LEDGER_PATH.read_text().splitlines()]
    assert sum(x["charged"] for x in ledger) == 12

    capsys.readouterr()
    assert cli.main(["plan"]) == 0
    assert json.loads(capsys.readouterr().out)["targets_already_cached"] == 3


def test_run_only_and_max_credits(data_dir, fake, capsys):
    fake(pages={"https://www.duewestnyc.com/menus/": menu(("Smash Burger", 27))}, search={})
    assert cli.main(["run", "--only", "Due West", "--max-credits", "3"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["capped"] and out["stopped"] == 1 and out["credits_spent"] == 0
    assert out["build"]["restaurants"] == 0  # nothing cached yet, dataset still valid
    build.validate(json.loads(config.OUTPUT_PATH.read_text()))


def test_scope_flags_are_remembered_by_later_commands(data_dir, fake, capsys, monkeypatch):
    irish = {**DOHMH_ROWS[3], "camis": "6", "dba": "THE IRISH PUB", "building": "7", "street": "BARROW STREET",
             "cuisine_description": "Irish"}
    monkeypatch.setattr(sources, "socrata_get", lambda url, params, http=None: DOHMH_ROWS + [irish])
    assert cli.main(["sources", "--cuisines", "Hamburgers,Irish", "--min-inspection-date", "2024-01-01",
                     "--national-chains", "include"]) == 0
    wide = json.loads(config.RESTAURANTS_PATH.read_text())
    assert len(wide["restaurants"]) == 6

    capsys.readouterr()
    assert cli.main(["plan"]) == 0
    assert json.loads(capsys.readouterr().out)["scope"]["cuisines"] == ["Hamburgers", "Irish"]

    fake(pages={"https://www.duewestnyc.com/menus/": menu(("Smash Burger", 27))}, search={})
    assert cli.main(["run", "--only", "Due West", "--max-credits", "20"]) == 0
    doc = json.loads(config.RESTAURANTS_PATH.read_text())
    assert doc["meta"]["cuisines"] == ["Hamburgers", "Irish"] and doc["meta"]["min_inspection_date"] == "2024-01-01"
    assert len(doc["restaurants"]) == 6  # not silently narrowed back to the default scope

    # passing a flag changes that part of the scope only
    assert cli.main(["sources", "--cuisines", "Hamburgers"]) == 0
    doc = json.loads(config.RESTAURANTS_PATH.read_text())
    assert doc["meta"]["cuisines"] == ["Hamburgers"] and doc["meta"]["min_inspection_date"] == "2024-01-01"
    assert doc["meta"]["national_chains"] == "include"


def test_national_chains_excluded_by_default(data_dir, capsys):
    assert cli.main(["sources", "--cuisines", "Hamburgers"]) == 0
    doc = json.loads(config.RESTAURANTS_PATH.read_text())
    assert [r["name"] for r in doc["restaurants"]] == ["Due West", "Hamburger America"]
    assert doc["report"]["national_chains_excluded"] == {"McDonald's": 3}
    assert doc["meta"]["national_chains"] == "exclude"
    capsys.readouterr()
    assert cli.main(["plan"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["targets"] == 2 and plan["chains"] == 0


def test_restaurant_list_only_by_default_and_none_resets(data_dir, capsys):
    # default scope: the restaurant list is the universe; DOHMH only fills in address/coords
    assert cli.main(["sources"]) == 0
    doc = json.loads(config.RESTAURANTS_PATH.read_text())
    assert [r["name"] for r in doc["restaurants"]] == ["Due West"]
    assert doc["restaurants"][0]["camis"] == "4" and doc["restaurants"][0]["address"]
    assert doc["meta"]["cuisines"] == [] and doc["meta"]["restaurant_list"] == "pilot.csv"
    # adding a cuisine is remembered; 'none' goes back to the list only (and [] is remembered too)
    assert cli.main(["sources", "--cuisines", "Hamburgers"]) == 0
    assert len(json.loads(config.RESTAURANTS_PATH.read_text())["restaurants"]) == 2  # + Hamburger America
    assert cli.main(["sources", "--cuisines", "none"]) == 0
    assert cli.main(["sources"]) == 0
    doc = json.loads(config.RESTAURANTS_PATH.read_text())
    assert doc["meta"]["cuisines"] == [] and [r["name"] for r in doc["restaurants"]] == ["Due West"]


def test_ctrl_c_exits_cleanly(data_dir, monkeypatch):
    def interrupted(*a, **k):
        raise KeyboardInterrupt

    monkeypatch.setattr(cli, "run_targets", interrupted)
    assert cli.main(["run", "--only", "Due West"]) == 130


def test_misspelled_cuisine_stops_before_anything_is_written(data_dir, capsys):
    assert cli.main(["sources", "--cuisines", "Hamburgers,Americans"]) == 2
    assert "did you mean 'American'" in capsys.readouterr().err
    assert not config.RESTAURANTS_PATH.exists()
    assert cli.main(["sources", "--cuisines", "Hamburgers,American"]) == 0
    assert json.loads(config.RESTAURANTS_PATH.read_text())["meta"]["cuisines"] == ["Hamburgers", "American"]


def test_menu_url_override_reaches_plan_and_run(data_dir, fake, capsys):
    # the list names /menus/ (cached after a first run); a hand-checked dinner page replaces it, which
    # makes the target "not yet scraped" again until the next run scrapes the new page first
    fake(pages={"https://www.duewestnyc.com/menus/": menu(("Brunch Burger", 19, "beef", "brunch"))}, search={})
    assert cli.main(["run"]) == 0
    capsys.readouterr()
    sources.MENU_URLS_PATH.write_text(json.dumps({"overrides": {
        "camis:4": {"name": "Due West", "menu_url": "https://www.duewestnyc.com/menus/dinner", "checked_at": "2026-09-24",
                    "reason": "the list's page is the brunch menu."},
        "csv:closed-place-manhattan": {"menu_url": "https://closed.example/menu", "checked_at": "2026-09-24",
                                       "reason": "x"}}}))
    assert cli.main(["sources"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["report"]["menu_url_overrides_applied"] == ["camis:4"]
    assert [u["key"] for u in out["report"]["menu_url_overrides_unused"]] == ["csv:closed-place-manhattan"]
    assert cli.main(["plan"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["targets_to_scrape"] == 1 and plan["targets_to_scrape_with_menu_url_override"] == 1
    f = fake(pages={"https://www.duewestnyc.com/menus/dinner": menu(("Due Burger", 24, "beef", "dinner"))}, search={})
    assert cli.main(["run"]) == 0
    assert [r["url"] for _, r in f.calls] == ["https://www.duewestnyc.com/menus/dinner"]
    due = next(r for r in json.loads(config.OUTPUT_PATH.read_text())["restaurants"] if r["name"] == "Due West")
    assert due["index_price"] == 24 and due["menu_url"] == "https://www.duewestnyc.com/menus/dinner"
