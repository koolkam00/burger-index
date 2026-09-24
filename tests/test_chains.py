from conftest import rec

from pipeline.chains import brand_of, build_targets, group_chains, select_targets


def test_curated_aliases_group_spelling_variants():
    rs = [
        rec("McDonald's", camis="1", dba="MCDONALD'S"),
        rec("McDonald's", camis="2", dba="MCDONALDS"),
        rec("McDonald's", camis="3", dba="MCDONALDS # 18093"),
        rec("Five Guys", camis="4", dba="FIVE GUYS"),
        rec("Five Guys", camis="5", dba="FIVE GUYS FAMOUS BURGERS AND FRIES"),
        rec("Burger King", camis="6", dba="BURGER KING, POPEYES"),
        rec("Burger King", camis="7", dba="BURGER KING"),
    ]
    chains = group_chains(rs)
    assert {k: len(g.members) for k, g in chains.items()} == {"mcdonalds": 3, "five-guys": 2, "burger-king": 2}
    assert chains["mcdonalds"].display == "McDonald's"
    assert chains["mcdonalds"].official_has_prices is False


def test_auto_grouping_needs_three_locations():
    rs = [rec("Petey's Burger", camis=str(i), dba="PETEY'S BURGER") for i in range(2)]
    rs += [rec("Local Chain", camis=str(10 + i), dba=f"LOCAL CHAIN #{i}") for i in range(3)]
    chains = group_chains(rs)
    assert list(chains) == ["local-chain"]
    assert len(chains["local-chain"].members) == 3


def test_brand_of_uses_csv_name_when_unmatched():
    r = rec("Shake Shack West Village", csv=True)  # no DOHMH dba
    assert brand_of(r)[0] == "shake-shack"


def test_targets_one_per_chain_in_csv_order():
    csv_ss = rec("Shake Shack West Village", camis="1", dba="SHAKE SHACK", csv=True,
                 menu_url="https://postmates.com/store/shake-shack-west-village/x", website="https://shakeshack.com/location/wv")
    rs = [
        rec("Due West", camis="9", csv=True, website="https://duewestnyc.com"),
        csv_ss,
        rec("Shake Shack", camis="2", dba="SHAKE SHACK"),
        rec("Shake Shack", camis="3", dba="SHAKE SHACK #1506"),
        rec("Paul's", camis="4"),
    ]
    targets = build_targets(rs)
    assert [t.key for t in targets] == ["camis:9", "chain:shake-shack", "camis:4"]
    ss = targets[1]
    assert ss.name == "Shake Shack" and len(ss.members) == 3
    assert ss.rep is csv_ss  # the CSV location with URLs anchors the chain search
    assert ss.csv_urls[0][0].startswith("https://postmates.com")


def test_select_targets_only_and_limit():
    rs = [rec("Burger Joint", camis="1"), rec("Paul's Da Burger Joint", camis="2"), rec("Diner", camis="3")]
    targets = build_targets(rs)
    assert [t.name for t in select_targets(targets, only=["Burger Joint"])] == ["Burger Joint"]  # exact wins
    assert [t.name for t in select_targets(targets, only=["paul"])] == ["Paul's Da Burger Joint"]
    assert len(select_targets(targets, limit=2)) == 2


def test_pinned_chain_menu_url_is_tried_first_and_airports_are_not_the_rep():
    from pipeline.chains import ChainGroup, is_airport

    rs = [rec("Wendy's", camis="1", dba="WENDY'S", address="1 Main Terminal", borough="Queens", zipcode=None),
          rec("Wendy's", camis="2", dba="WENDY'S", address="100 Broadway", borough="Brooklyn"),
          rec("Wendy's", camis="3", dba="WENDY'S (CONCOURSE F)", address="Terminal C", borough="Queens", zipcode="11371")]
    assert [is_airport(r) for r in rs] == [True, False, True]
    assert not is_airport(rec("Burger King", camis="4", address="557 Grand Concourse", borough="Bronx"))
    pinned = "https://www.grubhub.com/restaurant/wendys-100-broadway-brooklyn/1"
    chains = {"wendys": ChainGroup("wendys", "Wendy's", False, rs, "jr hamburger", pinned)}
    t = build_targets(rs, chains)[0]
    assert t.rep["camis"] == "2" and t.csv_urls[0] == (pinned, "chain menu_url") and t.cheapest_item == "jr hamburger"


def test_menu_url_override_is_tried_first_even_before_a_pinned_chain_menu():
    from pipeline.discover import OVERRIDE_ORIGIN

    checked = {"checked_at": "2026-09-24", "reason": "stale list page"}
    r = rec("Due West", camis="9", csv=True, website="https://duewestnyc.com", menu_url="https://duewestnyc.com/dinner")
    (t,) = build_targets([{**r, "menu_url_override": checked}])
    assert t.csv_urls == [("https://duewestnyc.com/dinner", OVERRIDE_ORIGIN), ("https://duewestnyc.com", "csv website")]
    # a DOHMH-only record (not on the list) with an override gets it too
    (t,) = build_targets([{**rec("Other", camis="8", menu_url="https://other.example/menu"), "menu_url_override": checked}])
    assert t.csv_urls == [("https://other.example/menu", OVERRIDE_ORIGIN)]
    # chains: the hand-checked page of a member goes ahead of the chain's pinned menu
    rs = [rec("McDonald's", camis=str(i), dba="MCDONALD'S") for i in range(3)]
    rs[1] = {**rs[1], "menu_url": "https://www.seamless.com/menu/mcdonalds-1/1", "menu_url_override": checked}
    chains = group_chains(rs)
    chains["mcdonalds"].menu_url = "https://www.grubhub.com/restaurant/mcdonalds-2/2"
    (t,) = build_targets(rs, chains)
    assert t.chain == "mcdonalds" and t.csv_urls == [("https://www.seamless.com/menu/mcdonalds-1/1", OVERRIDE_ORIGIN),
                                                     ("https://www.grubhub.com/restaurant/mcdonalds-2/2", "chain menu_url")]
