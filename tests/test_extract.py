from conftest import menu

from pipeline import extract


def test_price_coercion():
    assert extract.coerce_price(12) == 12.0
    assert extract.coerce_price("$12.50") == 12.5
    assert extract.coerce_price("Market Price") is None
    assert extract.coerce_price("MP") is None
    assert extract.coerce_price(None) is None
    assert extract.coerce_price(0) is None
    assert extract.coerce_price(True) is None


def test_name_cleanup():
    assert extract.clean_name("Classic Burger $14", 14) == "Classic Burger"
    assert extract.clean_name("Classic Burger - 14.50", 14.5) == "Classic Burger"
    assert extract.clean_name("🍔 Smash Burger 🔥", 12) == "Smash Burger"
    assert extract.clean_name("**DOUBLE CHEESEBURGER**", 12) == "Double Cheeseburger"
    assert extract.clean_name("Burger 21", 15) == "Burger 21"  # a trailing number that isn't the price stays


def test_normalize_menu_rules():
    data = menu(
        ("Cheeseburger", 18, "beef", "lunch"),
        ("Cheeseburger", 22, "beef", "dinner"),  # dinner price wins over lunch
        ("Brunch Burger", 16, "beef", "brunch"),  # only on brunch: kept
        ("Kids Burger", 8, "beef"),  # kids items dropped
        ("Slider Trio", 1.5, "beef"),  # < $2: suspect
        ("Wagyu Tower", 400, "beef"),  # > $150: suspect
        ("Impossible Burger", 17, "beef"),  # name overrides the protein label
        ("Turkey Burger", "$15", "turkey"),
        ("Burger of the Day", "market price", "beef"),
        ("Cheeseburger", 22, "beef", "dinner"),  # exact duplicate
    )
    m = extract.normalize_menu(data)
    by = {b["name"]: b for b in m["burgers"]}
    assert list(by) == ["Cheeseburger", "Brunch Burger", "Slider Trio", "Wagyu Tower", "Impossible Burger",
                        "Turkey Burger", "Burger of the Day"]
    assert by["Cheeseburger"]["price"] == 22 and by["Cheeseburger"]["menu_period"] == "dinner"
    assert by["Slider Trio"]["price"] is None and by["Wagyu Tower"]["price"] is None
    assert any("suspect price $1.5" in n for n in m["notes"]) and any("$400" in n for n in m["notes"])
    assert by["Impossible Burger"]["protein"] == "veggie"
    assert by["Turkey Burger"]["price"] == 15
    assert by["Burger of the Day"]["price"] is None


def test_happy_hour_price_only_as_last_resort():
    m = extract.normalize_menu(menu(("Bar Burger", 10, "beef", "happy_hour"), ("Bar Burger", 16, "beef", "dinner")))
    assert [b["price"] for b in m["burgers"]] == [16]
    m = extract.normalize_menu(menu(("Bar Burger", 10, "beef", "happy_hour")))
    assert [b["price"] for b in m["burgers"]] == [10]


def test_same_name_same_menu_keeps_single_size():
    m = extract.normalize_menu(menu(("Shack Burger", 9.49), ("Shack Burger", 13.99)))
    assert [b["price"] for b in m["burgers"]] == [9.49]


def test_classify_menu():
    c = lambda d: extract.classify_menu(extract.normalize_menu(d))  # noqa: E731
    assert c(menu(("Burger", 15))) == "priced"
    assert c(menu(("Lamb Burger", 19, "lamb"))) == "nonbeef"
    assert c(menu(("Burger", None))) == "no_prices"
    assert c(menu()) == "no_burgers"
    assert c(menu(is_menu=False, has_prices=False)) == "not_menu"
    assert c(None) == "not_menu"
    assert c({"burgers": "garbage"}) == "not_menu"


def test_index_item_cheapest_beef_first_on_ties():
    burgers = [
        {"name": "A", "price": 15, "protein": "beef"},
        {"name": "Veg", "price": 9, "protein": "veggie"},
        {"name": "B", "price": 12, "protein": "beef"},
        {"name": "C", "price": 12, "protein": "beef"},
        {"name": "D", "price": None, "protein": "beef"},
    ]
    assert extract.index_item(burgers) == 2
    assert extract.index_item([{"name": "Veg", "price": 9, "protein": "veggie"}]) is None
    assert extract.index_item([]) is None


def test_index_item_prefers_dinner_and_never_happy_hour():
    m = extract.normalize_menu(menu(("Tavern Burger", 26, "beef", "dinner"), ("Bar Burger", 12, "beef", "happy_hour"),
                                    ("Brunch Burger", 19, "beef", "brunch")))
    assert m["burgers"][extract.index_item(m["burgers"])]["name"] == "Tavern Burger"
    # no dinner / all-day price: the next period counts, happy hour still never does
    m = extract.normalize_menu(menu(("Bar Burger", 12, "beef", "happy_hour"), ("Lunch Burger", 17, "beef", "lunch")))
    assert m["burgers"][extract.index_item(m["burgers"])]["name"] == "Lunch Burger"
    m = extract.normalize_menu(menu(("Bar Burger", 12, "beef", "happy_hour")))
    assert extract.index_item(m["burgers"]) is None and extract.classify_menu(m) == "no_prices"
