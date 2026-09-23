"""Per-target discover -> scrape workflow, and the concurrent runner.

process_target() is deterministic given the cache, so `build` replays it offline
(Api(offline=True)) and gets exactly what the live run got — without spending credits.

Per target (restaurant or chain) hard caps: 1 search, 1 map, 3 scrapes.
  1. candidates from the pilot CSV (menu_url, then website — website first when the menu_url is a
     special menu such as brunch or restaurant week); none -> web search
  2. an official homepage is resolved to a menu page with Map URLs (homepage kept as fallback)
  3. scrape candidates in rank order until one yields a priced beef burger with no caveat
     (a delivery page that looks partial, a special menu, a menu file over a year old keep the
     search going; the best result wins when the caps are hit)
  4. candidates exhausted before the cap -> search once (if not done yet) and continue

A target whose result may have been changed by a temporary Context.dev failure is marked
retry_pending: replays treat it as not yet scraped, and the next live run retries the call.
"""

from __future__ import annotations

import json
import re
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import config, discover, extract
from .api import Api, CacheMiss, CreditCapReached
from .chains import Target
from .context_client import FatalError
from .discover import Candidate
from .names import norm_name

_log_lock = threading.Lock()


def log(msg: str) -> None:
    with _log_lock:
        print(msg, file=sys.stderr, flush=True)


# kind -> (rank, final status). Higher rank = better answer.
KINDS = {
    "priced": (6, "priced"),
    "nonbeef": (5, "no_burgers"),
    "no_prices": (4, "no_prices"),
    "no_burgers": (3, "no_burgers"),
    "not_menu": (2, "no_menu_found"),
    "wrong_restaurant": (2, "no_menu_found"),
    "wrong_location": (2, "no_menu_found"),
    "error": (1, "error"),
}
OUTCOME_TEXT = {
    "priced": "priced",
    "nonbeef": "only non-beef burgers",
    "no_prices": "burgers without prices",
    "no_burgers": "menu without burgers",
    "not_menu": "not a menu",
    "wrong_restaurant": "a different restaurant",
    "wrong_location": "a different location",
    "error": "error",
}


def _sentence(s: str) -> str:
    """Upper-case the first letter only (keeps burger names as written) and end with a period."""
    s = s.strip()
    return (s[:1].upper() + s[1:] + ("" if s.endswith(".") else ".")) if s else s


@dataclass
class Evaluation:
    kind: str
    candidate: Candidate
    url: str
    fetched_at: str | None
    menu: dict | None = None
    message: str | None = None
    # Why a priced page is not the final answer, as (kind, detail): ("partial", "only 2 priced beef
    # burgers on the page"), ("special", "brunch"), ("stale", "March 2022").
    caveat: tuple[str, str] | None = None
    menu_date: Any = None  # datetime.date the menu file appears to date from, if its URL says

    @property
    def rank(self) -> int:
        return KINDS[self.kind][0]

    @property
    def quality(self) -> tuple:
        """Best result wins: kind, then no caveat, then more priced beef burgers."""
        n = sum(1 for b in (self.menu or {}).get("burgers", []) if b["protein"] == "beef" and b["price"] is not None)
        return self.rank, self.caveat is None, n

    @property
    def final(self) -> bool:
        """Stop looking: priced with no caveat, or a real priced menu whose burgers are all non-beef."""
        if self.kind == "priced":
            return self.caveat is None
        return self.kind == "nonbeef" and bool(self.menu and self.menu["is_menu"] and self.menu["has_prices"])


def partial_delivery_menu(menu: dict, target: Target) -> str | None:
    """Why a priced delivery-app page looks like part of the menu (lazy-loaded sections), or None."""
    burgers = menu["burgers"]
    beef = [b for b in burgers if b["protein"] == "beef" and b["price"] is not None]
    if len(beef) < config.MIN_DELIVERY_BURGERS:
        return f"only {len(beef)} priced beef burger{'s' if len(beef) != 1 else ''} on the page"
    item = target.cheapest_item
    if item and not any(re.search(rf"\b{re.escape(item)}\b", norm_name(b["name"])) for b in burgers):
        return f"no {item} on the page"
    idx = extract.index_item(burgers)
    if idx is not None and re.search(r"\b(double|triple)\b", norm_name(burgers[idx]["name"])):
        return f"the cheapest burger on the page is {burgers[idx]['name']!r}"
    return None


def stale_menu(menu_day, fetched_at: str | None) -> bool:
    """A menu file dated more than config.STALE_MENU_DAYS before it was scraped (deterministic on replay)."""
    if menu_day is None or not fetched_at:
        return False
    scraped = datetime.fromisoformat(fetched_at.replace("Z", "+00:00")).date()
    return menu_day < scraped - timedelta(days=config.STALE_MENU_DAYS)


def evaluate_scrape(rec: dict, cand: Candidate, target: Target) -> Evaluation:
    if not rec.get("ok"):
        err = rec.get("error") or {}
        msg = f"{err.get('code') or 'error'}" + (f" (HTTP {err['status']})" if err.get("status") else "")
        return Evaluation("error", cand, cand.url, rec.get("fetched_at"), None, msg)
    data = rec.get("data") or {}
    extracted = (data.get("json") or {}).get("data")
    menu = extract.normalize_menu(extracted)
    final_url = data.get("url") or cand.url
    fetched_at = rec.get("fetched_at")
    if cand.category not in discover.OFFICIAL and not discover.same_restaurant(target, menu["restaurant_name"]):
        return Evaluation("wrong_restaurant", cand, final_url, fetched_at, menu,
                          f"page is for {menu['restaurant_name']!r}")
    conflict = discover.page_location_conflict(target, menu["location"], cand.category)
    if conflict:
        return Evaluation("wrong_location", cand, final_url, fetched_at, menu, conflict)
    kind = extract.classify_menu(menu)
    day = max(filter(None, (discover.menu_date(final_url), discover.menu_date(cand.url))), default=None)
    caveat = None
    if kind == "priced":
        special = discover.special_menu(final_url) or discover.special_menu(cand.url)
        # Only the lazy-loading apps: Grubhub / Seamless store pages list the whole menu.
        partial = partial_delivery_menu(menu, target) if cand.category == "delivery_app" else None
        if partial:
            caveat = ("partial", partial)
        elif special:
            caveat = ("special", special)
        elif stale_menu(day, fetched_at):
            caveat = ("stale", month_year(day))
    return Evaluation(kind, cand, final_url, fetched_at, menu, caveat=caveat, menu_date=day)


def month_year(day) -> str:
    """'March 2022'; just '2022' for a date that came from a bare year in the file name."""
    return str(day.year) if (day.month, day.day) == (12, 31) else f"{day:%B %Y}"


CAVEAT_TEXT = {
    "partial": ("the delivery page looked partial ({})", "The delivery page looked incomplete ({}); no fuller menu was found."),
    "special": ("a {} menu", "These prices are from a {} menu; no regular menu was found."),
    "stale": ("menu file dated {}", "The menu file dates from {}, so prices may have changed; no newer menu was found."),
}


@dataclass
class TargetRun:
    target: Target
    api: Api
    attempts: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    queue: list[Candidate] = field(default_factory=list)
    tried: set[str] = field(default_factory=set)
    best: Evaluation | None = None
    website: str | None = None
    searches: int = 0
    maps: int = 0
    scrapes: int = 0
    credits: int = 0
    cache_hits: int = 0
    stop_reason: str | None = None
    search_error: str | None = None
    transient: list[str] = field(default_factory=list)  # steps that failed temporarily

    # -- steps -----------------------------------------------------------------------------
    def _track(self, rec: dict, step: str) -> None:
        self.credits += rec.get("charged", 0)
        self.cache_hits += 1 if rec.get("cached") else 0
        if rec.get("transient"):
            self.transient.append(step)

    def _queued(self, url: str) -> bool:
        k = discover.url_key(url)
        return k in self.tried or any(discover.url_key(c.url) == k for c in self.queue)

    def enqueue_csv(self) -> None:
        t = self.target
        urls = list(t.csv_urls)
        # A special menu (brunch, restaurant week, prix fixe...) as the pilot menu_url: try the
        # website (and its map) first, keep the special menu as a fallback.
        special = [(u, o) for u, o in urls if o.endswith("menu_url") and discover.special_menu(u)]
        if special and any(o == "csv website" for _, o in urls):
            urls = [x for x in urls if x not in special] + special
        for url, origin in urls:
            category, reason = discover.classify_url(url)
            if category == "reject":
                self.notes.append(f"skipped {origin} ({reason})")
                continue
            if t.chain and not t.official_has_prices and category in discover.OFFICIAL:
                self.notes.append(f"skipped {origin} {discover.host_of(url)} (chain site shows no prices)")
                if category in ("official_home", "official_menu") and not self.website:
                    self.website = discover.root_url(url)
                continue
            if not self._queued(url):
                self.queue.append(Candidate(url, category, origin))

    def search(self) -> None:
        self.searches += 1
        q = discover.search_query(self.target)
        rec = self.api.search(q, target=self.target.key, exclude_domains=discover.SEARCH_EXCLUDE_DOMAINS)
        self._track(rec, "search")
        if not rec.get("ok"):
            err = (rec.get("error") or {}).get("code") or "error"
            self.search_error = err
            self.attempts.append({"step": "search", "query": q, "outcome": f"failed: {err}",
                                  "credits": rec.get("charged", 0), "cached": rec.get("cached")})
            return
        results = (rec.get("data") or {}).get("results") or []
        cands, official_root, rejected = discover.rank_search_results(results, self.target)
        if official_root and not self.website:
            self.website = official_root
        added = 0
        for c in cands:
            if not self._queued(c.url):
                self.queue.append(c)
                added += 1
        self.attempts.append({"step": "search", "query": q, "outcome": f"{len(results)} results, {added} usable",
                              "rejected": rejected[:10], "credits": rec.get("charged", 0), "cached": rec.get("cached")})

    def map_site(self, home: Candidate) -> list[Candidate]:
        self.maps += 1
        domain = discover.host_of(home.url)
        rec = self.api.map_urls(domain, target=self.target.key, url_regex=discover.MAP_URL_REGEX, max_links=100)
        self._track(rec, "map")
        urls = discover.pick_menu_urls(rec.get("data"), home.url, self.target) if rec.get("ok") else []
        found = [Candidate(u, discover.classify_url(u)[0], "map") for u in urls if not self._queued(u)]
        found = [c for c in found if c.category != "reject"]
        self.attempts.append({"step": "map", "domain": domain,
                              "outcome": f"{len(found)} menu page(s)" if rec.get("ok") else "failed",
                              "credits": rec.get("charged", 0), "cached": rec.get("cached")})
        return found

    def scrape(self, cand: Candidate) -> Evaluation:
        self.scrapes += 1
        self.tried.add(discover.url_key(cand.url))
        rec = self.api.scrape(cand.url, target=self.target.key, maybe_pdf=discover.maybe_pdf(cand.url),
                              scroll=config.SCROLL_DELIVERY_APPS and cand.category == "delivery_app")
        self._track(rec, "scrape")
        ev = evaluate_scrape(rec, cand, self.target)
        n_priced = sum(1 for b in (ev.menu or {}).get("burgers", []) if b["price"] is not None)
        outcome = OUTCOME_TEXT[ev.kind] + (f": {ev.message}" if ev.message else "")
        if ev.caveat:
            outcome += f" (not final: {CAVEAT_TEXT[ev.caveat[0]][0].format(ev.caveat[1])})"
        self.attempts.append({
            "step": "scrape", "url": cand.url, "category": cand.category, "origin": cand.origin,
            "outcome": outcome,
            "priced_burgers": n_priced, "credits": rec.get("charged", 0), "cached": rec.get("cached"),
        })
        return ev

    # -- workflow --------------------------------------------------------------------------
    def run(self) -> dict:
        self.enqueue_csv()
        if not self.queue:
            self.search()
        mapped = False
        while True:
            while self.queue and self.scrapes < config.MAX_SCRAPES:
                cand = self.queue.pop(0)
                if discover.url_key(cand.url) in self.tried:
                    continue
                if cand.category == "official_home" and not mapped and self.maps < config.MAX_MAPS:
                    mapped = True
                    found = self.map_site(cand)
                    if found:
                        self.queue = found + [cand] + self.queue
                        continue
                    # No menu page on the site map: a bare homepage rarely lists prices, so search
                    # first (if not done yet) and try it after ordering pages and aggregators.
                    cand.tier = discover.UNMAPPED_HOME_TIER
                    self.queue.insert(0, cand)
                    if self.searches < config.MAX_SEARCHES:
                        self.search()
                    self.queue.sort(key=lambda c: c.rank)  # stable: equal tiers keep their order
                    continue
                ev = self.scrape(cand)
                if self.best is None or ev.quality > self.best.quality:
                    self.best = ev
                if ev.final:
                    return self.finish()
            if self.scrapes >= config.MAX_SCRAPES:
                if self.queue:
                    self.stop_reason = f"stopped at the {config.MAX_SCRAPES}-scrape cap"
                break
            if self.searches < config.MAX_SEARCHES:
                self.search()
                if self.queue:
                    continue
            self.stop_reason = "no more candidate pages"
            break
        return self.finish()

    def finish(self) -> dict:
        t, best = self.target, self.best
        status = KINDS[best.kind][1] if best else "no_menu_found"
        menu = best.menu if best else None
        burgers = (menu or {}).get("burgers", []) if best and best.kind in ("priced", "nonbeef", "no_prices") else []
        has_menu = best is not None and best.kind in ("priced", "nonbeef", "no_prices", "no_burgers")
        menu_url = best.url if has_menu else None
        price_source = best.candidate.price_source if has_menu else None
        # A temporary failure may have hidden the answer: unless a price was found anyway, the result
        # is provisional (replays count the target as not yet scraped; the next live run retries).
        retry_pending = bool(self.transient) and not (best and (best.final or best.kind == "priced"))
        parts: list[str] = []
        if status == "priced":
            parts.append(f"Prices from {discover.SOURCE_LABEL[price_source]} ({discover.host_of(menu_url)}).")
            if price_source == "delivery_app":
                parts.append("Delivery-app prices usually run above in-store prices.")
            idx = extract.index_item(burgers)
            period = burgers[idx].get("menu_period") if idx is not None else None
            if period in ("late_night", "lunch", "brunch"):
                parts.append(f"The index price is from the {period.replace('_', '-')} menu (no dinner or all-day "
                             "burger price listed).")
            if best.caveat:
                parts.append(CAVEAT_TEXT[best.caveat[0]][1].format(best.caveat[1]))
            elif t.chain and idx is not None and re.search(r"\b(double|triple)\b", norm_name(burgers[idx]["name"])):
                parts.append(f"The cheapest burger listed is {burgers[idx]['name']!r}; a single may not be on this page.")
        elif best is None:
            if self.search_error:
                parts.append(f"Web search failed ({self.search_error}).")
            elif not t.csv_urls and self.searches:
                parts.append("No menu URL in the pilot list and web search found no usable menu page.")
            else:
                parts.append("No usable menu page found.")
        else:
            parts.append({
                "no_burgers": "Found a menu but no beef burger on it.",
                "no_prices": "Found burgers but no prices on the menu.",
                "no_menu_found": "The pages found were not menus.",
                "error": "Every menu page failed to load.",
            }[status])
            if best.kind == "nonbeef":
                prots = sorted({b["protein"] for b in burgers})
                parts[-1] = f"Only non-beef burgers ({', '.join(prots)}) on the menu; not in the beef index."
        if t.chain:
            rep = t.rep
            where = ", ".join(x for x in (rep.get("address"), rep.get("borough")) if x)
            if status == "priced":
                parts.append(f"Chain-level prices from one NYC location ({where}); prices may vary by location.")
            else:
                parts.append(f"The chain's menu was looked up for one NYC location ({where}).")
        if has_menu and stale_menu(best.menu_date, best.fetched_at) and (best.caveat or ("",))[0] != "stale":
            parts.append(f"The menu file dates from {month_year(best.menu_date)}; prices may have changed.")
        if menu and menu.get("notes"):
            parts.append(_sentence("; ".join(menu["notes"])[:200]))
        if retry_pending:
            steps = ", ".join(dict.fromkeys(self.transient))
            parts.append(f"A Context.dev call failed temporarily ({steps}); the next run retries it.")
        if status != "priced":
            tried = [f"{discover.host_of(a['url'])} ({a['outcome']})" for a in self.attempts if a["step"] == "scrape"]
            if tried:
                parts.append("Tried: " + "; ".join(tried)[:300] + ".")
            if self.stop_reason:
                parts.append(_sentence(self.stop_reason))
        skipped = [n for n in self.notes if n.startswith("skipped")]
        if skipped and status != "priced":
            parts.append(_sentence("; ".join(skipped)))
        website = self.website or next((u for u, o in t.csv_urls if o == "csv website"), None)
        if not website and menu_url and best and best.candidate.category in discover.OFFICIAL:
            website = discover.root_url(menu_url)
        return {
            "target": t.key,
            "name": t.name,
            "chain": t.chain,
            "locations": len(t.members),
            "status": status,
            "status_detail": " ".join(parts) or None,
            "menu_url": menu_url,
            "price_source": price_source,
            "website": website,
            "scraped_at": best.fetched_at if has_menu else None,
            "restaurant_name_on_page": (menu or {}).get("restaurant_name"),
            "burgers": burgers,
            "attempts": self.attempts,
            "searches": self.searches,
            "maps": self.maps,
            "scrapes": self.scrapes,
            "credits": self.credits,
            "cache_hits": self.cache_hits,
            "retry_pending": retry_pending,
        }


def process_target(target: Target, api: Api) -> dict:
    return TargetRun(target, api).run()


def replay(targets: list[Target], api: Api) -> tuple[dict[str, dict], list[Target]]:
    """Offline replay from cache: (results for fully-cached targets, targets not yet scraped).

    A target whose cached path includes a temporary failure that may have changed its result
    (retry_pending) counts as not yet scraped: `plan` prices its retry, `build` leaves it out."""
    results: dict[str, dict] = {}
    pending: list[Target] = []
    for t in targets:
        try:
            res = process_target(t, api)
        except CacheMiss:
            pending.append(t)
            continue
        if res.get("retry_pending"):
            pending.append(t)
        else:
            results[t.key] = res
    return results, pending


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def run_targets(
    targets: list[Target],
    api: Api,
    *,
    workers: int = config.DEFAULT_WORKERS,
    run_log_path: Path | None = config.RUN_LOG_PATH,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Process targets concurrently. Stops cleanly at --max-credits: finished targets are kept
    (their responses are cached), unstarted/aborted ones are reported as 'stopped'.

    Ctrl-C (KeyboardInterrupt in the main thread) stops the run: queued targets are cancelled,
    in-flight ones make no further live call (Api.stop_event), and the interrupt is re-raised."""
    run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    outcomes: dict[str, dict] = {}
    counts = {"done": 0, "stopped": 0, "failed": 0, "fatal": 0}
    fatal: list[str] = []
    started = time.time()
    lock = threading.Lock()
    interrupted = threading.Event()

    def work(t: Target) -> tuple[str, Any]:
        # After a credit-cap stop, Api still serves cache hits, so fully-cached targets finish for
        # free; the first live call raises CreditCapReached. After Ctrl-C nothing new starts.
        if interrupted.is_set():
            return "stopped", "run interrupted"
        try:
            return "done", process_target(t, api)
        except CreditCapReached as e:
            return "stopped", str(e)
        except FatalError as e:
            return "fatal", str(e)
        except Exception as e:  # noqa: BLE001 — one bad target must not kill the run
            traceback.print_exc(file=sys.stderr)
            return "failed", f"{type(e).__name__}: {e}"

    log_f = None
    if run_log_path:
        Path(run_log_path).parent.mkdir(parents=True, exist_ok=True)
        log_f = open(run_log_path, "a")

    def record(n: int, t: Target, kind: str, payload: Any) -> None:
        with lock:
            counts[kind] += 1
            if kind == "fatal":
                fatal.append(payload)
        spent = api.ledger.spent
        cap = api.ledger.max_credits
        prefix = f"[{n}/{len(targets)}] {t.name}" + (f" (chain, {len(t.members)} locations)" if t.chain else "")
        if kind == "done":
            res = payload
            outcomes[t.key] = res
            idx = extract.index_item(res["burgers"])
            price = f" ${res['burgers'][idx]['price']:.2f}" if idx is not None and res["status"] == "priced" else ""
            retry = " (temporary failure: retried next run)" if res.get("retry_pending") else ""
            log(f"{prefix}: {res['status']}{price}{retry} — {res['scrapes']} scrape(s), {res['credits']} credits"
                f"{' (cached)' if res['credits'] == 0 and res['cache_hits'] else ''} [run total {spent}/{cap}]")
            line = {
                "ts": _now(), "run_id": run_id, "target": t.key, "name": t.name, "chain": t.chain,
                "locations": len(t.members), "status": res["status"],
                "index_price": res["burgers"][idx]["price"] if idx is not None and res["status"] == "priced" else None,
                "menu_url": res["menu_url"], "price_source": res["price_source"],
                "urls_tried": [a["url"] for a in res["attempts"] if a["step"] == "scrape"],
                "attempts": res["attempts"], "searches": res["searches"], "maps": res["maps"],
                "scrapes": res["scrapes"], "credits": res["credits"], "cache_hits": res["cache_hits"],
                "retry_pending": res.get("retry_pending", False), "status_detail": res["status_detail"],
            }
        else:
            log(f"{prefix}: {kind.upper()} — {payload}")
            line = {"ts": _now(), "run_id": run_id, "target": t.key, "name": t.name, "chain": t.chain,
                    "locations": len(t.members), "status": kind, "status_detail": payload}
        if log_f:
            log_f.write(json.dumps(line, ensure_ascii=False) + "\n")
            log_f.flush()

    try:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            futs: dict = {}
            try:
                for t in targets:
                    futs[ex.submit(work, t)] = t
                for n, fut in enumerate(as_completed(futs), start=1):
                    kind, payload = fut.result()
                    record(n, futs[fut], kind, payload)
            except BaseException as e:
                # Ctrl-C only reaches this (main) thread. Leaving the `with` would otherwise wait for
                # every queued target to run and keep spending: cancel the queue, and stop in-flight
                # targets at their next live call.
                interrupted.set()
                api.stop_event.set()
                ex.shutdown(wait=False, cancel_futures=True)
                cancelled = sum(1 for f in futs if f.cancelled())
                why = "interrupted" if isinstance(e, KeyboardInterrupt) else f"stopped ({type(e).__name__})"
                log(f"run {run_id}: {why} — {cancelled} queued target(s) cancelled, in-flight targets stop "
                    f"after their current call [run total {api.ledger.spent}/{api.ledger.max_credits}]")
                if log_f:
                    log_f.write(json.dumps({"ts": _now(), "run_id": run_id, "status": why,
                                            "cancelled": cancelled, "credits_spent": api.ledger.spent}) + "\n")
                    log_f.flush()
                raise
    finally:
        if log_f:
            log_f.close()
    return {
        "run_id": run_id,
        "targets": len(targets),
        **counts,
        "fatal_errors": fatal,
        "seconds": round(time.time() - started, 1),
        "results": outcomes,
        **api.ledger.summary(),
    }
