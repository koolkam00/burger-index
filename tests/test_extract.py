import pytest
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


# --- index eligibility rules (names below are real items from the scrape cache) -----------------

def _items(*rows):
    """(name, price[, protein[, menu_period[, description]]]) -> normalized burger rows."""
    return [{"name": r[0], "price": r[1], "protein": r[2] if len(r) > 2 else "beef",
             "menu_period": r[3] if len(r) > 3 else None, "description": r[4] if len(r) > 4 else None} for r in rows]


def _index_name(burgers):
    i = extract.index_item(burgers)
    return None if i is None else burgers[i]["name"]


@pytest.mark.parametrize("name", [
    "Cheeseburger Sliders (3)", "Burger Sliders", "Beef Slider", "Beef Sliders 3 Pc", "Sliders with Cheese",
    "Black Angus Beef Sliders (3)", "Trio of Sliders", "Mini Burgers (3)", "Stout Mini Burgers", "Mini Rodeo Burgers",
    "Mini Blue Sliders", "2 Mini Slammers", "Baby Burgers (3)", "Trio of Mini Burgers", "Burger Minis",
])
def test_slider_plates(name):
    assert extract.is_slider_plate({"name": name})


@pytest.mark.parametrize("name", [
    "Slider Burger",  # 'slider' names the burger: one burger
    "Bistro Mini",  # Corner Bistro's 4 oz single burger
    "Mini Burger",  # one small burger (a kids' one is dropped by the kids rule anyway)
    "Treadwell Junior Burger", "Little Burger", "Jr. Cheeseburger", "Lil Haus",  # small singles the verifier accepted
    "Trio Burger", "Houston Hall Burger & Fries", "Double Smash Burger", "Twin Burger Platter Deluxe",
])
def test_slider_plate_look_alikes(name):
    assert not extract.is_slider_plate({"name": name})


def test_slider_plate_is_never_the_index_while_a_standard_burger_is_priced():
    # Tørst: catering sliders ($9.50 each, 10 minimum) vs the Smash Burger
    burgers = _items(("Burger Sliders", 9.5, "beef", "all_day"), ("Smash Burger", 18.9, "beef", "all_day"))
    assert _index_name(burgers) == "Smash Burger"
    # Burger By Day: a single $3.25 slider; the row keeps its price (it stays listed)
    m = extract.normalize_menu(menu(("Beef Slider", 3.25), ("Chicken Slider", 3.25, "chicken"),
                                    ("Classic Burger", 8.5)))
    assert [b["name"] for b in m["burgers"]] == ["Beef Slider", "Chicken Slider", "Classic Burger"]
    assert m["burgers"][0]["price"] == 3.25
    assert _index_name(m["burgers"]) == "Classic Burger" and extract.classify_menu(m) == "priced"
    # Houston Hall: 'Burger & Fries' is the only full-size burger, and it counts
    assert _index_name(_items(("Pat LaFreida Beef Sliders", 14.95), ("Houston Hall Burger & Fries", 21.95))) \
        == "Houston Hall Burger & Fries"
    # Joyce's Tavern: a tie at $14.95 goes to the burger, not to the slider plate listed first
    assert _index_name(_items(("Sliders (4)", 14.95), ("Classic Hamburger (10oz. Angus Beef)", 14.95))) \
        == "Classic Hamburger (10oz. Angus Beef)"


def test_slider_plate_counts_only_when_it_is_the_only_eligible_beef_burger():
    # a slider-only page keeps its price
    m = extract.normalize_menu(menu(("Cheeseburger Sliders (3)", 12, "beef", "dinner"), ("Chicken Sliders", 14, "chicken")))
    assert _index_name(m["burgers"]) == "Cheeseburger Sliders (3)" and extract.classify_menu(m) == "priced"
    # the only standard burger is happy hour (never the index): the slider plate stays the index
    burgers = _items(("Classic Sliders", 18, "beef", "dinner"), ("Bar Burger", 12, "beef", "happy_hour"))
    assert _index_name(burgers) == "Classic Sliders"
    # a standard burger on the brunch menu only beats a dinner slider plate (sliders are not a standard burger)
    burgers = _items(("HT Classic Sliders", 15, "beef", "dinner"), ("Brunch Burger", 17, "beef", "brunch"))
    assert _index_name(burgers) == "Brunch Burger"


def test_kids_mini_burger_is_dropped_before_any_rule():
    m = extract.normalize_menu(menu(("Mini Burger", 8, "beef", "kids"), ("Kids Mini Burger", 7), ("Burger", 15)))
    assert [b["name"] for b in m["burgers"]] == ["Burger"]


@pytest.mark.parametrize("name", [
    "The Frank", "Beef Frank", "Hot Dog", "Chili Dog", "Hotdog", "Bratwurst", "Italian Sausage",
    "The Pup Patty (Patty for Puppy)", "Doggy Burger", "Plain Patty for Dogs",
])
def test_not_a_burger(name):
    assert extract.is_not_a_burger({"name": name})


@pytest.mark.parametrize("name", [
    "Sausage Burger", "Hot Dog Burger",  # the name says burger
    "Frank's Special", "Frankie Burger", "Frankenburger",  # a burger named after someone, not a frank
    "Hush Puppy Burger", "Temptation", "Classic Burger",
])
def test_not_a_burger_look_alikes(name):
    assert not extract.is_not_a_burger({"name": name})


def test_not_a_burger_never_sets_the_index_or_prices_a_page():
    # Sin City: 'The Frank' (1/4 lb beef frank, relish, mustard) was the $9.99 index item
    burgers = _items(("Temptation", 15.99, "beef", "all_day"), ("The Frank", 9.99, "beef", "all_day"))
    assert _index_name(burgers) == "Temptation"
    # Smacking Burger: a $4 patty for dogs
    assert _index_name(_items(("The Classic", 7.49), ("The Pup Patty (Patty for Puppy)", 4.0))) == "The Classic"
    # a page whose only beef item is a hot dog is not a priced burger menu
    m = extract.normalize_menu(menu(("The Frank", 9.99)))
    assert extract.index_item(m["burgers"]) is None and extract.classify_menu(m) == "no_burgers"
    assert [b["name"] for b in m["burgers"]] == ["The Frank"]  # the row stays for corrections; build leaves it out


def test_template_placeholder():
    wix = "This is an item on your menu. Give your item a brief description"
    assert extract.is_template_placeholder({"name": "Beef Burger", "price": 9, "description": wix})
    assert extract.is_template_placeholder({"name": "Beef Burger", "description": "give your item a brief description"})
    assert not extract.is_template_placeholder({"name": "Beef Burger", "description": "8 oz, lettuce, tomato"})
    assert not extract.is_template_placeholder({"name": "Beef Burger", "description": None})
