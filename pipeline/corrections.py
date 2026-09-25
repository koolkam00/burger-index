"""Hand-checked price corrections, applied at build time on top of the scraped results.

A correction exists only when the live menu was re-read and the scraped answer was wrong: a
stale aggregator copy, a lunch price read instead of dinner, an add-on parsed as a burger, a
cheaper burger the page lazy-loaded. Each entry names its source page, the date it was checked
and why. The scrape cache is left untouched, so a later --refresh run can supersede it.

Corrections are strict: `build` fails if one names a target or a burger that is not in the
scraped result, so they cannot silently rot when menus are re-scraped. Every corrected
restaurant says so in status_detail. When a correction publishes prices from another page than
the one scraped (another host, or another price_source), the scrape's own note about its page
("Prices from the restaurant's own site (x.com).", its caveats) is replaced by one naming the
correction's page, so status_detail agrees with menu_url and price_source; a chain's
"Chain-level prices from one NYC location (...)" sentence stays.

Entry fields (pipeline/data/corrections.json -> "corrections": [...]):
  target        target key (camis:..., csv:..., chain:<slug>)
  checked_at    YYYY-MM-DD the source was read
  source_url    page the corrected prices come from (becomes menu_url)
  price_source  optional new price_source (contract enum)
  reason        one sentence, shown on the restaurant page
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
import re
from pathlib import Path

from . import config, discover, extract

CORRECTIONS_PATH = config.PACKAGE_DIR / "data" / "corrections.json"

# extract.classify_menu kind -> restaurant status (process.py maps 'nonbeef' the same way)
STATUS_OF_KIND = {"priced": "priced", "nonbeef": "no_burgers", "no_prices": "no_prices", "no_burgers": "no_burgers",
                  "not_menu": "no_burgers"}
# process.Worker.finish: a chain's source-location sentence (web/src/lib/menus.ts chainSourceLocation reads it)
CHAIN_SENTENCE_RE = re.compile(r"Chain-level prices from one NYC location \([^)]*\); prices may vary by location\.")
DELIVERY_NOTE = "Delivery-app prices usually run above in-store prices."  # process.Worker.finish's wording


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


def source_note(price_source: str, url: str) -> str:
    """'Prices from a delivery app (seamless.com). Delivery-app prices usually run above in-store prices.',
    worded as process.Worker.finish words a scraped page."""
    note = f"Prices from {discover.SOURCE_LABEL[price_source]} ({discover.host_of(url)})."
    return f"{note} {DELIVERY_NOTE}" if price_source == "delivery_app" else note


def scrape_note(res: dict, c: dict, out: dict) -> str | None:
    """The scrape's status_detail, kept in front of the correction's sentence while it still describes the
    published prices. A correction that publishes prices from another page (another host, or another
    price_source) replaces it with a note naming that page: the scrape's sentences about its own page (where
    the prices came from, a partial delivery page, a brunch-only price) no longer apply. A chain keeps its
    source-location sentence. Withheld prices keep the scrape's note: it says what was scraped and withheld."""
    detail = res.get("status_detail")
    ps = out.get("price_source")
    if c.get("withhold") or out["status"] != "priced" or ps not in discover.SOURCE_LABEL:
        return detail
    if (discover.host_of(c["source_url"]) == discover.host_of(res.get("menu_url") or "")
            and ps == res.get("price_source")):
        return detail
    chain = CHAIN_SENTENCE_RE.search(detail or "")
    return " ".join(x for x in (source_note(ps, c["source_url"]), chain.group(0) if chain else None) if x)


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
    out["scraped_at"] = f"{c['checked_at']}T16:00:00Z"  # noon in New York, so the site shows the checked date
    verb = "Prices withheld" if c.get("withhold") else "Prices corrected by hand"
    hand_check = f"{verb} after re-checking the menu on {c['checked_at']}: {c['reason']}"  # web/src/lib/hand-checks.ts
    out["status_detail"] = " ".join(x for x in (scrape_note(res, c, out), hand_check) if x)
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
