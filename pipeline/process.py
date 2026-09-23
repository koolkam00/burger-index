"""Per-target discover -> scrape workflow, and the concurrent runner.

process_target() is deterministic given the cache, so `build` replays it offline
(Api(offline=True)) and gets exactly what the live run got — without spending credits.

Per target (restaurant or chain) hard caps: 1 search, 1 map, 3 scrapes.
  1. candidates from the pilot CSV (menu_url, then website); none -> web search
  2. an official homepage is resolved to a menu page with Map URLs (homepage kept as fallback)
  3. scrape candidates in rank order until one yields a priced beef burger
  4. candidates exhausted before the cap -> search once (if not done yet) and continue
"""

from __future__ import annotations

import json
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config, discover, extract
from .api import Api, CacheMiss, CreditCapReached
from .chains import Target
from .context_client import FatalError
from .discover import Candidate

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
    "error": (1, "error"),
}
OUTCOME_TEXT = {
    "priced": "priced",
    "nonbeef": "only non-beef burgers",
    "no_prices": "burgers without prices",
    "no_burgers": "menu without burgers",
    "not_menu": "not a menu",
    "wrong_restaurant": "a different restaurant",
    "error": "error",
}


@dataclass
class Evaluation:
    kind: str
    candidate: Candidate
    url: str
    fetched_at: str | None
    menu: dict | None = None
    message: str | None = None

    @property
    def rank(self) -> int:
        return KINDS[self.kind][0]

    @property
    def final(self) -> bool:
        """Stop looking: priced, or a real priced menu whose burgers are all non-beef."""
        if self.kind == "priced":
            return True
        return self.kind == "nonbeef" and bool(self.menu and self.menu["is_menu"] and self.menu["has_prices"])


def evaluate_scrape(rec: dict, cand: Candidate, target: Target) -> Evaluation:
    if not rec.get("ok"):
        err = rec.get("error") or {}
        msg = f"{err.get('code') or 'error'}" + (f" (HTTP {err['status']})" if err.get("status") else "")
        return Evaluation("error", cand, cand.url, rec.get("fetched_at"), None, msg)
    data = rec.get("data") or {}
    extracted = (data.get("json") or {}).get("data")
    menu = extract.normalize_menu(extracted)
    final_url = data.get("url") or cand.url
    if cand.category not in discover.OFFICIAL and not discover.same_restaurant(target, menu["restaurant_name"]):
        return Evaluation("wrong_restaurant", cand, final_url, rec.get("fetched_at"), menu,
                          f"page is for {menu['restaurant_name']!r}")
    return Evaluation(extract.classify_menu(menu), cand, final_url, rec.get("fetched_at"), menu)


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

    # -- steps -----------------------------------------------------------------------------
    def _track(self, rec: dict) -> None:
        self.credits += rec.get("charged", 0)
        self.cache_hits += 1 if rec.get("cached") else 0

    def _queued(self, url: str) -> bool:
        k = discover.url_key(url)
        return k in self.tried or any(discover.url_key(c.url) == k for c in self.queue)

    def enqueue_csv(self) -> None:
        t = self.target
        for url, origin in t.csv_urls:
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
        self._track(rec)
        if not rec.get("ok"):
            err = (rec.get("error") or {}).get("code") or "error"
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
        self._track(rec)
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
        rec = self.api.scrape(cand.url, target=self.target.key)
        self._track(rec)
        ev = evaluate_scrape(rec, cand, self.target)
        n_priced = sum(1 for b in (ev.menu or {}).get("burgers", []) if b["price"] is not None)
        self.attempts.append({
            "step": "scrape", "url": cand.url, "category": cand.category, "origin": cand.origin,
            "outcome": OUTCOME_TEXT[ev.kind] + (f": {ev.message}" if ev.message else ""),
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
                ev = self.scrape(cand)
                if self.best is None or ev.rank > self.best.rank:
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
        parts: list[str] = []
        if status == "priced":
            parts.append(f"Prices from {discover.SOURCE_LABEL[price_source]} ({discover.host_of(menu_url)}).")
            if price_source == "delivery_app":
                parts.append("Delivery-app prices usually run above in-store prices.")
        elif best is None:
            if not t.csv_urls and self.searches:
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
            parts.append(f"Chain-level prices from one NYC location ({where}); prices may vary by location.")
        if menu and menu.get("notes"):
            parts.append("; ".join(menu["notes"])[:200].capitalize() + ".")
        if status != "priced":
            tried = [f"{discover.host_of(a['url'])} ({a['outcome']})" for a in self.attempts if a["step"] == "scrape"]
            if tried:
                parts.append("Tried: " + "; ".join(tried)[:300] + ".")
            if self.stop_reason:
                parts.append(self.stop_reason.capitalize() + ".")
        skipped = [n for n in self.notes if n.startswith("skipped")]
        if skipped and status != "priced":
            parts.append("; ".join(skipped).capitalize() + ".")
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
        }


def process_target(target: Target, api: Api) -> dict:
    return TargetRun(target, api).run()


def replay(targets: list[Target], api: Api) -> tuple[dict[str, dict], list[Target]]:
    """Offline replay from cache: (results for fully-cached targets, targets not yet scraped)."""
    results: dict[str, dict] = {}
    pending: list[Target] = []
    for t in targets:
        try:
            results[t.key] = process_target(t, api)
        except CacheMiss:
            pending.append(t)
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
    (their responses are cached), unstarted/aborted ones are reported as 'stopped'."""
    run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    outcomes: dict[str, dict] = {}
    counts = {"done": 0, "stopped": 0, "failed": 0, "fatal": 0}
    fatal: list[str] = []
    started = time.time()
    lock = threading.Lock()

    def work(t: Target) -> tuple[str, Any]:
        # After a stop, Api still serves cache hits, so fully-cached targets finish for free;
        # the first live call raises CreditCapReached.
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
    try:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            futs = {ex.submit(work, t): t for t in targets}
            for n, fut in enumerate(as_completed(futs), start=1):
                t = futs[fut]
                kind, payload = fut.result()
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
                    log(f"{prefix}: {res['status']}{price} — {res['scrapes']} scrape(s), {res['credits']} credits"
                        f"{' (cached)' if res['credits'] == 0 and res['cache_hits'] else ''} [run total {spent}/{cap}]")
                    line = {
                        "ts": _now(), "run_id": run_id, "target": t.key, "name": t.name, "chain": t.chain,
                        "locations": len(t.members), "status": res["status"],
                        "index_price": res["burgers"][idx]["price"] if idx is not None and res["status"] == "priced" else None,
                        "menu_url": res["menu_url"], "price_source": res["price_source"],
                        "urls_tried": [a["url"] for a in res["attempts"] if a["step"] == "scrape"],
                        "attempts": res["attempts"], "searches": res["searches"], "maps": res["maps"],
                        "scrapes": res["scrapes"], "credits": res["credits"], "cache_hits": res["cache_hits"],
                        "status_detail": res["status_detail"],
                    }
                else:
                    log(f"{prefix}: {kind.upper()} — {payload}")
                    line = {"ts": _now(), "run_id": run_id, "target": t.key, "name": t.name, "chain": t.chain,
                            "locations": len(t.members), "status": kind, "status_detail": payload}
                if log_f:
                    log_f.write(json.dumps(line, ensure_ascii=False) + "\n")
                    log_f.flush()
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
