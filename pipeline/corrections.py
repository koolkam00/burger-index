"""Hand-checked price corrections, applied at build time on top of the scraped results.

A correction exists only when the live menu was re-read and the scraped answer was wrong: a
stale aggregator copy, a lunch price read instead of dinner, an add-on parsed as a burger, a
cheaper burger the page lazy-loaded. Each entry names its source page, the date it was checked
and why. The scrape cache is left untouched, so a later --refresh run can supersede it.

Corrections are strict: `build` fails if one names a target or a burger that is not in the
scraped result, so they cannot silently rot when menus are re-scraped. A corrected result takes
the correction's page as its menu_url (and its price_source, when given), and records the check
as hand_check {"checked_on": checked_at}, which the dataset publishes on a priced restaurant (the
site's "Prices corrected by hand" label). A withheld result records none: it has no index price,
so the restaurant has no page. The scrape's status_detail is left as the scrape wrote it; the
dataset does not carry it.

Entry fields (pipeline/data/corrections.json -> "corrections": [...]):
  target        target key (camis:..., csv:..., chain:<slug>)
  checked_at    YYYY-MM-DD the source was read
  source_url    page the corrected prices come from (becomes menu_url)
  price_source  optional new price_source (contract enum)
  reason        one sentence: what was wrong (kept here, never published)
  drop          [burger name, ...]                      rows that are not standalone burgers
  set           {burger name: price | {"price", "menu_period"}}
  add           [{"name", "price", "protein", "menu_period"?, "description"?}]
  withhold      true -> publish no prices (they could not be confirmed and look wrong)

A delivery-app or online-ordering markup alone is not a reason to withhold (user decision, 2026-09-25):
when it is the only price found, the marked-up price is published under its price_source. Withhold
closed restaurants, another restaurant's or city's page, stale copies and partial pages instead.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from . import config, extract

CORRECTIONS_PATH = config.PACKAGE_DIR / "data" / "corrections.json"

# extract.classify_menu kind -> restaurant status (process.py maps 'nonbeef' the same way)
STATUS_OF_KIND = {"priced": "priced", "nonbeef": "no_burgers", "no_prices": "no_prices", "no_burgers": "no_burgers",
                  "not_menu": "no_burgers"}


class CorrectionError(RuntimeError):
    pass


def load(path: Path = CORRECTIONS_PATH) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text())["corrections"]


def _find(burgers: list[dict], name: str, target: str) -> list[int]:
    hits = [i for i, b in enumerate(burgers) if b["name"].casefold() == name.casefold()]
    if not hits:
        have = ", ".join(sorted({b["name"] for b in burgers})) or "none"
        raise CorrectionError(f"{target}: correction names burger {name!r}, not in the scraped menu (have: {have})")
    return hits


def apply_one(res: dict, c: dict) -> dict:
    target = c["target"]
    out = copy.deepcopy(res)
    burgers = out["burgers"]
    for name in c.get("drop", []):
        drop = set(_find(burgers, name, target))
        burgers = [b for i, b in enumerate(burgers) if i not in drop]
    for name, v in c.get("set", {}).items():
        v = v if isinstance(v, dict) else {"price": v}
        for i in _find(burgers, name, target):
            burgers[i]["price"] = v["price"]
            if "menu_period" in v:
                burgers[i]["menu_period"] = v["menu_period"]
    for a in c.get("add", []):
        if any(b["name"].casefold() == a["name"].casefold() for b in burgers):
            raise CorrectionError(f"{target}: correction adds {a['name']!r}, already in the scraped menu (use set)")
        burgers.append({"name": a["name"], "price": a["price"], "description": a.get("description"),
                        "protein": a["protein"], "menu_period": a.get("menu_period")})
    if c.get("withhold"):
        for b in burgers:
            b["price"] = None
    out["burgers"] = burgers
    out["status"] = STATUS_OF_KIND[extract.classify_menu({"burgers": burgers, "is_menu": True})]
    out["menu_url"] = c["source_url"]
    if c.get("price_source"):
        out["price_source"] = c["price_source"]
    # build publishes it only when the restaurant keeps an index price (the one burger may still fail)
    out["hand_check"] = None if c.get("withhold") or out["status"] != "priced" else {"checked_on": c["checked_at"]}
    return out


def apply(results: dict[str, dict], corrections: list[dict]) -> dict[str, dict]:
    """New results dict with every correction applied. A correction whose target has not been
    scraped yet is skipped (it applies once the target is in scope and scraped)."""
    out = dict(results)
    seen: set[str] = set()
    for c in corrections:
        if c["target"] in seen:
            raise CorrectionError(f"{c['target']}: more than one correction")
        seen.add(c["target"])
        if c["target"] in out:
            out[c["target"]] = apply_one(out[c["target"]], c)
    return out
