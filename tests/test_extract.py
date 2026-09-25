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


# --- top_item: one burger per restaurant, its highest-priced eligible beef burger (build only) ---------

def _top_name(burgers):
    i = extract.top_item(burgers)
    return None if i is None else burgers[i]["name"]


def _item(name, description=None):
    return {"name": name, "price": 20, "protein": "beef", "menu_period": None, "description": description}


@pytest.mark.parametrize("name,description", [
    ("Burger Platter for 4", None), ("Family Burger Box", None), ("Sliders for Two", None),
    ("Party Pack Burgers", None), ("Burger Catering Tray", None), ("Dozen Sliders", None), ("Burger Tower", None),
    ("Burger Flight", None), ("Slider Sampler", None), ("DIY Burger Kit", None), ("Box of Burgers", None),
    ("Cheeseburgers (6)", None), ("Sliders (12)", None), ("Mini Burgers x6", None), ("Burger Bar for 10", None),
    ("Smash Burgers 12 pc", None), ("10 Sliders", None),
    ("2 for $15 Single Ultimate Smash Deal", "2 ultimate smash"),  # Handcraft Burgers and Brew
    # Cubby's catering platters and Gemini Diner: the count is in the description only
    ("Cub's Pub Platter", "10 double patty swiss cheeseburgers, caramelized onions, tangy burger sauce"),
    ("Cheeseburgers in Paradise", "10 Black Angus beef with American cheese, pickles, red onion"),
    ("Burger Sliders", "10 sliders (serves 3)"),
    ("Burger Board", "Feeds 4. Four cheeseburgers and fries"), ("House Burger", "for 6 people, 24 hour notice"),
])
def test_group_items_are_never_the_published_burger(name, description):
    assert extract.top_item_exclusion(_item(name, description)) == "group"


@pytest.mark.parametrize("name,description", [
    ("Bx Cheeseburger Meal", None), ("Combo 12 oz. Burger", "Cheeseburger on Brioche Bun with 2 Mozzarella Sticks"),
    ("Burger Combo", None), ("Burger Deal", None), ("Cheeseburger with Fries and a Drink", None),
    ("Guilty (Thursday Lunch Special)", "AVOCADO & CHEDDAR + Skin-on fries & Can Soda"),  # Sin City Burger
    ("Beef Burger Deluxe", "Includes Lettuce, Tomato, French Fries & Fountain Soda"),  # Bus Stop Diner
    ("Deluxe Burger", "House special sauce, lettuce, tomato, pickles, bacon, side fries, and drink"),
])
def test_combos_are_never_the_published_burger(name, description):
    assert extract.top_item_exclusion(_item(name, description)) == "combo"


@pytest.mark.parametrize("name,description,why", [
    ("Kids Burger", None, "kids"), ("Mini Cheeseburger", "for kids 12 and under", "kids"),
    ("The Frank", "1/4 lb beef frank", "not a burger"), ("The Pup Patty (Patty for Puppy)", None, "not a burger"),
])
def test_kids_items_and_non_burgers_are_never_the_published_burger(name, description, why):
    assert extract.top_item_exclusion(_item(name, description)) == why


@pytest.mark.parametrize("name,description", [
    ("Slim-Line", "Beef Burger with a scoop o f Cotage Cheese & Peach halves."),  # The Flame Diner, $21.95
    ("Slime Line Jumbo Hamburger", "Served with cottage cheese and fruit salad."),  # Austin House Diner (menu typo)
    ("Slim Line Burger", "Served on a bed of crisp lettuce with tomato and cucumber."), ("Slimline Burger", None),
    ("Lo-Cal Burger", "Jumbo Broiled Hamburger & cottage cheese on a bed of lettuce"),  # Mike's Oakwood Diner
    ("Lo - Cal Burger", None), ("Low Cal Burger", None), ("Low-Calorie Burger", "Served with Cottage Cheese"),
    ("Diet Burger", "With coleslaw & tomato."), ("Diet Plate", "chopped steak, cottage cheese, peaches"),
    ("Hamburger Diet Delights", "Cottage cheese, lettuce and tomato. Served with Melba toast."),
    ("Beef Burger Diet", "Burger on a bed of lettuce with tomatoes, cucumber & red onion"),  # Page Plaza Diner
    ("Dieter's Delight", "8 oz burger, cottage cheese"), ("Weight Watchers Burger", None),
    ("Bunless Burger Plate", None), ("No Bun Burger", "with a side salad"),
    ("Atkins Burger", "9 oz. burger (no bun) with fried egg, cheddar cheese, bacon, and onion."),  # Orion Diner
    ("Low-Carb Topless Burger", "No bun burger, melted pepper jack, grilled onions, field greens"),  # Crosstown
    ("Keto My Heart", "bunless, beef patties, shaved ham, brisket, bacon, vermont white cheddar"),  # Bill's
    ("Burger Delight", "Jumbo burger with cottage cheese on a bed of lettuce"),  # Fort Hamilton Diner
])
def test_a_diet_plate_is_never_the_published_burger(name, description):
    item = _item(name, description)
    assert extract.is_diet_plate(item) and extract.top_item_exclusion(item) == "diet plate"


@pytest.mark.parametrize("name,description", [
    ("Slim Jim Burger", None), ("Local Burger", "8 oz local grass-fed beef"), ("The Local", None),
    ("Low Country Burger", "pimento cheese, fried green tomato"), ("Dietrich's Burger", None),
    ("Keto Burger", "prime beef in between a zucchini bun"),  # Inwood Bar & Grill: a keto bun is still a bun
    ("Lettuce Wrap Burger", "Bunless! Wrapped in Lettuce with Quarter pound beef, American Cheese"),  # Best Buds
    ("Double Bacon Smash", "Two Beef Patties smashed on a bed of onions, Double Bacon, Double Cheese"),
    ("Hamburger", "with cottage cheese, fruit salad, lettuce, tomato and cucumber"),  # no bun is not said
    ("Buffalo Burger", "Low-fat. Served on a toasted bun, with coleslaw and pickle."),
])
def test_diet_plate_look_alikes_are_eligible(name, description):
    item = _item(name, description)
    assert not extract.is_diet_plate(item) and extract.top_item_exclusion(item) is None


def test_a_diet_plate_gives_way_to_the_burgers():
    # The Flame Diner: the $21.95 Slim-Line was its published burger; the Blue Burger ($19.95, first) is next
    flame = _items(("Beef Burger", 14.95), ("Blue Burger", 19.95), ("Patty Melt Burger", 19.95),
                   ("Slim-Line", 21.95, "beef", "all_day", "Beef Burger with a scoop o f Cotage Cheese & Peach halves."))
    assert _top_name(flame) == "Blue Burger"
    # a menu whose only priced beef burger is a diet plate publishes none
    assert _top_name(_items(("Slim Line Burger", 21.95), ("Veggie Burger", 14.0, "veggie"))) is None


@pytest.mark.parametrize("name,description", [
    ("Cheeseburger Club", "With bacon, lettuce, tomato and mayo. Served with french fries or potato salad."),
    ("Bacon Burger Club", "Comes with bacon, lettuce and tomato."),  # Red Flame Diner
    ("Cheeseburger Club Sandwich (#9)", "Bacon, cheese, lettuce, tomato & mayo. Served with French fries, Coleslaw"),
    ("Hamburger Club", "Beef patty, bacon, lettuce, and tomato. Served with French fries"),  # Tom's Restaurant
    ("BURGER CLUB Triple", None), ("Cheese Burger Club", "triple decker"), ("Burger Club", None),
])
def test_a_burger_club_is_one_burger(name, description):
    # user decision (2026-09-25): a burger served club-sandwich style counts like any other burger
    item = _item(name, description)
    assert extract.top_item_exclusion(item) is None and not extract.is_multi_burger_plate(item)
    assert extract.burger_with_sides_key(item) is None and not extract.is_diet_plate(item)


def test_a_burger_club_can_be_the_published_burger():
    club = ("Cheeseburger Club Sandwich", 23.95, "beef", "all_day", "With Bacon, Lettuce, Tomato & French Fries.")
    assert _top_name(_items(("Cheeseburger", 15.95), ("Blue Burger", 19.95), club)) == "Cheeseburger Club Sandwich"
    # it is not the Deluxe twin of the plain burger: its price stands
    assert _top_name(_items(("Hamburger Club", 18.85), ("Hamburger", 9.98))) == "Hamburger Club"


def test_an_eating_challenge_is_never_the_published_burger():
    # Clinton Hall FiDi: $50, free if finished in 25 minutes, served with a 16 oz beer
    ch = _item("The CH Challenge", "Conquer this burger and fries by yourself in 25 mins and it's free. 20 oz signature "
                                   "beef patty, nueske's bacon, bbq chicken tenders, onion rings. Served with a CH "
                                   "Gigawatt IPA")
    assert extract.top_item_exclusion(ch) == "challenge"
    assert extract.top_item_exclusion(_item("Burger Challenge")) == "challenge"
    assert extract.top_item_exclusion(_item("Big Burger", "finish it within the time limit")) == "challenge"
    assert extract.top_item_exclusion(_item("The Challenger", "8 oz beef, cheddar")) is None


@pytest.mark.parametrize("name,description", [
    ("Cheese Burger & Fries with a Beer", "Choice of Cheese and Pint of Bud Light or Abbey Lager"),  # Abbey Tavern
    ("HH Burger & Beer", None),  # The Baroness
    ("$18 Cheeseburger & a Beer", "12-3 MONDAY THRU FRIDAY"),  # Whiskey Tavern
    ("Big Burger", "Served with a 16oz Gigawatt beer"), ("Pub Burger", "includes a pint of lager"),
])
def test_a_burger_sold_with_a_beer_is_a_combo(name, description):
    assert extract.top_item_exclusion(_item(name, description)) == "combo"


@pytest.mark.parametrize("name,description", [
    ("German Burger", "cheddar cheese, garlic aioli, IPA caramelized onions, pretzel roll"),  # Clinton Hall
    ("Original", "Certified Angus Beef, American cheese, lettuce, tomato, IPA Pickles, onions, & special sauce"),
    ("OP Burger", "w/homemade beer chili & cheddar"),  # Peculier Pub
    ("Notorious MAC Burger", "5 cheese smoked mac & cheese, beer battered onion rings, brioche bun."),
    ("Beer Onion Ring Burger", "Fried egg, beer batter onion ring, American cheese, lettuce, and house sauce."),
    ("American Kobe", "Organic Creamy Beer Fed Wagyu Beef"), ("Pretzel Burger", "with beer cheese"),
    ("Guinness Wagyu Burger", "Australian Wagyu Beef infused with the essence of Guinness Stout"),
    ("Ale House Burger", "Paisano's beef blend, lettuce, tomato, onion, sesame bun, fries"),
])
def test_beer_as_an_ingredient_is_not_a_combo(name, description):
    assert extract.top_item_exclusion(_item(name, description)) is None


def _menu(*rows):
    return [{"name": n, "price": p, "protein": "beef", "menu_period": "all_day", "description": None} for n, p in rows]


def test_a_burger_with_sides_gives_way_to_its_cheaper_plain_twin():
    # Atlantic Diner: every burger plain and Deluxe (+$5); five plain burgers tie at $15.25, BBQ is first
    atlantic = _menu(("Beef Burger", 10.95), ("Beef Burger Deluxe", 15.95), ("BBQ Burger", 15.25),
                     ("BBQ Burger Deluxe", 20.25), ("Chavo Burger", 15.25), ("Chavo Burger Deluxe", 20.25),
                     ("Twin Burger", 20.9), ("Twin Burger Deluxe", 25.9), ("Cheeseburger sliders ( 3 )", 16.95))
    assert _top_name(atlantic) == "BBQ Burger"
    # Mikes Olympic Grill: the 'Deluxe X' prefix form
    mikes = _menu(("Bacon Cheeseburger", 16.2), ("Deluxe Bacon Cheeseburger", 20.2), ("Italian Bella Burger", 15.25),
                  ("Deluxe Italian Bella Burger", 19.25), ("Twin Burger Special", 25.0))
    assert _top_name(mikes) == "Bacon Cheeseburger"
    # McSorley's: 'Burger with Fries'
    assert _top_name(_menu(("Burger", 10.0), ("Burger with Fries", 12.0))) == "Burger"
    # Squire's Diner: 'Plain X' / 'Deluxe X'; Galaxy Diner: 'X - Plain' / 'X - Deluxe'
    assert _top_name(_menu(("Plain Double Cheeseburger", 12.5), ("Deluxe Double Cheeseburger", 17.5))) \
        == "Plain Double Cheeseburger"
    assert _top_name(_menu(("8 oz. Country Beef Burger - Plain", 13.95),
                           ("8 oz. Country Beef Burger - Deluxe", 18.95))) == "8 oz. Country Beef Burger - Plain"
    # Gil's Grill: 'Plain Beef burger with LT' is the plain form of 'Beef burger Deluxe'
    assert _top_name(_menu(("Plain Beef burger with LT", 5.49), ("Beef burger Deluxe", 8.99),
                           ("Bacon Cheeseburger", 7.99), ("Bacon Cheeseburger Deluxe", 11.99))) == "Bacon Cheeseburger"
    # National Diner: 'Fried Onions' plain, 'Fried Onion' deluxe
    assert _top_name(_menu(("Texas Cheddar Burger with Bacon, Fried Egg, and Fried Onions", 11.99),
                           ("Deluxe Texas Cheddar Burger with Bacon, Fried Egg, and Fried Onion", 16.99))) \
        == "Texas Cheddar Burger with Bacon, Fried Egg, and Fried Onions"


def test_a_burger_with_sides_and_no_plain_twin_stays_eligible():
    # a menu with only the Deluxe / Platter form: it is still one burger
    assert _top_name(_menu(("Cheeseburger Deluxe", 16.0), ("Hamburger", 12.0))) == "Cheeseburger Deluxe"
    assert _top_name(_menu(("Burger Platter", 18.0), ("Burger Deluxe", 17.0))) == "Burger Platter"
    assert _top_name(_menu(("Houston Hall Burger & Fries", 21.95))) == "Houston Hall Burger & Fries"
    # a pricier burger that merely shares words is not a twin
    assert _top_name(_menu(("Cheeseburger", 14.0), ("Double Cheeseburger", 18.0))) == "Double Cheeseburger"
    assert _top_name(_menu(("Burger", 14.0), ("Special Burger", 19.0))) == "Special Burger"
    # the plain twin must be eligible: a kids' burger does not count
    assert _top_name(_menu(("Kids Burger", 8.0), ("Burger Deluxe", 16.0))) == "Burger Deluxe"
    assert extract.burger_with_sides_key({"name": "BBQ Burger Deluxe"}) == "bbq burger"
    assert extract.burger_with_sides_key({"name": "Deluxe Burger"}) == "burger"
    assert extract.burger_with_sides_key({"name": "Deluxe"}) is None
    assert extract.burger_with_sides_key({"name": "BBQ Burger"}) is None


@pytest.mark.parametrize("name,description", [
    ("Burger Platter", "served with french fries, lettuce, tomato, coleslaw and pickle"),  # one burger, plated
    ("Houston Hall Burger & Fries", None), ("Double Wagyu Burger", None), ("10oz Double Wagyu Cheeseburger", None),
    ("Triple Stack Cheeseburger", "three 4 oz patties"), ("Gold Burger", "8 oz beef patty covered with 24k gold"),
    ("Half & half burger", "50% ground prime beef, 50% ground bacon"),  # Tick Tock Diner: not '50 ... beef'
    ("Bacon Burger", "8 oz beef patty, applewood bacon"), ("Burger Bar", "short rib and beef patty blend"),
    ("5 Napkin Burger", None), ("Krapow Smash Burger/Double", "#5 on Infatuations top 10 smash burgers in NYC"),
    ("Jumbo Burger (7 Oz)", None), ("Wyoming Burger", "Bacon and BBQ sauce, a great, combo."),  # not a meal deal
    ("Classic Hamburger (10oz. Angus Beef)", None), ("Treadwell Junior Burger", None),
    ("Boxcar Burger", None), ("Pub Burger", None), ("Crosstown's Monster Double Deluxe", "stuck together"),
])
def test_one_burger_look_alikes_are_eligible(name, description):
    item = _item(name, description)
    assert extract.top_item_exclusion(item) is None and not extract.is_multi_burger_plate(item)


@pytest.mark.parametrize("name,description", [
    ("Twin Burger Platter Deluxe", "Two Burgers on Two Toasted Buns with French Fries"),  # Court Square Diner
    ("Twin Burger", "Chopped prime beef, served on a toasted brioche bun. Two prime beef burgers"),  # Gracie's
    ("Twin Burger", "Served On 2 Buns"), ("Twin Burger", None), ("Hungry Man Burger", "Twin Burgers topped with Bacon"),
    ("Smash Burger (2)", None), ("Sliders (4)", None), ("Sirloin Sliders (5)", None), ("Sliders (2pcs)", None),
    ("Angus Burger", "Three sliders per order, served on mini kaiser rolls"),  # Esquire Diner
    ("3 Firesliders", "3 baby fireside burgers"), ("Cheeseburger Sliders", None),
])
def test_multi_burger_plates(name, description):
    item = _item(name, description)
    assert extract.top_item_exclusion(item) is None and extract.is_multi_burger_plate(item)


@pytest.mark.parametrize("name,description", [
    ("Twin Beef Burger", "Two beef burgers on one toasted bun"),  # The City Diner: a double
    ("Twin Cheeseburger", "Two juicy certified Angus beef patties topped with melted cheese, served on a toasted bun"),
    ("Double Smash Burger", "two 3oz patties"), ("Slider Burger", None), ("Mini Burger", None),
])
def test_multi_burger_plate_look_alikes(name, description):
    assert not extract.is_multi_burger_plate(_item(name, description))


def test_top_item_is_the_highest_priced_eligible_beef_burger():
    burgers = _items(("Classic", 12, "beef", "dinner"), ("Double Wagyu Burger", 26, "beef", "dinner"),
                     ("Impossible Burger", 32, "veggie", "dinner"), ("Brunch Burger", 30, "beef", "brunch"),
                     ("Bar Burger", 40, "beef", "happy_hour"), ("Burger Platter for 4", 60),
                     ("Bx Cheeseburger Meal", 28), ("The Frank", 35), ("Mystery Burger", None))
    assert _top_name(burgers) == "Double Wagyu Burger"
    assert extract.index_item(burgers) == 0  # the cheapest (process.py's rule) is unchanged
    # ties go to the first on the menu
    assert _top_name(_items(("A", 18), ("B", 18), ("C", 12))) == "A"
    # no dinner / all-day price: the best next period, highest price there; happy hour never
    burgers = _items(("Lunch Burger", 17, "beef", "lunch"), ("Lunch Double", 21, "beef", "lunch"),
                     ("Brunch Burger", 25, "beef", "brunch"), ("Bar Burger", 30, "beef", "happy_hour"))
    assert _top_name(burgers) == "Lunch Double"
    assert _top_name(_items(("Bar Burger", 30, "beef", "happy_hour"))) is None
    assert _top_name([]) is None and _top_name(_items(("Veg", 9, "veggie"))) is None


def test_top_item_takes_a_plate_of_burgers_only_when_there_is_no_single_burger():
    # a slider plate or a twin burger pricier than the single burger is passed over
    assert _top_name(_items(("Burger Sliders", 24), ("Smash Burger", 18.9))) == "Smash Burger"
    twin = ("Twin Burger with Bacon", 31.5, "beef", "all_day", "Two Burgers served with French Fries")
    assert _top_name(_items(twin, ("Bacon Cheese Burger", 16.25, "beef", "all_day"))) == "Bacon Cheese Burger"
    # a single burger on the brunch menu only still beats a dinner slider plate (as in index_item)
    assert _top_name(_items(("HT Classic Sliders", 15, "beef", "dinner"), ("Brunch Burger", 17, "beef", "brunch"))) \
        == "Brunch Burger"
    # only plates: the priciest plate
    assert _top_name(_items(("Sliders (3)", 16), ("Bacon Cheeseburger Sliders", 18))) == "Bacon Cheeseburger Sliders"


def test_top_item_never_takes_a_group_item_or_combo_even_alone():
    platter = ("Cub's Pub Platter", 120, "beef", "all_day", "10 double patty swiss cheeseburgers")
    assert _top_name(_items(platter, ("Custom Burger", 8))) == "Custom Burger"
    assert _top_name(_items(platter, ("Bx Cheeseburger Meal", 23.07))) is None
    # ...while the page still counts as priced for the scrape (process.py uses index_item / classify_menu)
    assert extract.index_item(_items(platter)) == 0
