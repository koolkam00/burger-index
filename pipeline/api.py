"""Cost control around pipeline.context_client: disk cache, credit ledger, rate gate.

Every Context.dev response is cached at data/cache/<endpoint>/<sha1(canonical request)>.json.
A cached request costs 0 credits on re-runs (unless --refresh). Live calls reserve their
estimated cost against --max-credits *before* the request is sent, so a run stops cleanly
(CreditCapReached) instead of overshooting; the actual cost (key_metadata.credits_consumed)
is settled afterwards and appended to data/credit_ledger.jsonl.

Offline mode (build/plan) never calls the API: a cache miss raises CacheMiss.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import context_client
from .context_client import FatalError, TransientError

ENDPOINTS = ("search", "map", "scrape")
PDF_OCR_ESTIMATE = 2  # extra credits reserved for a PDF (OCR is +1 per recovered page)


class CacheMiss(Exception):
    """Offline replay needed a response that is not on disk."""


class CreditCapReached(Exception):
    """The next live call would exceed --max-credits."""


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def request_key(endpoint: str, request: dict) -> str:
    return hashlib.sha1(canonical({"endpoint": endpoint, "request": request}).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def looks_like_pdf(url: str) -> bool:
    return bool(re.search(r"\.pdf($|[?#])", url or "", re.I))


def estimate_credits(endpoint: str, request: dict) -> int:
    """Pre-call cost estimate from the docs (the ledger settles the reported actual)."""
    if endpoint == "search":
        n = int(request.get("num_results", 10))
        cost = math.ceil(n / 10)
        if (request.get("markdown_options") or {}).get("enabled"):
            cost += n  # each result is scraped
        return cost
    if endpoint == "map":
        return 2 if request.get("search") else 1
    if endpoint == "scrape":
        cost = 1
        if (request.get("formats") or {}).get("json"):
            cost += 4
        if looks_like_pdf(request.get("url", "")):
            cost += PDF_OCR_ESTIMATE
        return cost
    raise ValueError(endpoint)


class DiskCache:
    def __init__(self, root: Path):
        self.root = Path(root)

    def path(self, endpoint: str, key: str) -> Path:
        return self.root / endpoint / f"{key}.json"

    def get(self, endpoint: str, key: str) -> dict | None:
        try:
            return json.loads(self.path(endpoint, key).read_text())
        except FileNotFoundError:
            return None
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None  # corrupt/partial file: treat as a miss

    def put(self, endpoint: str, key: str, record: dict) -> None:
        p = self.path(endpoint, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(f".{p.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps(record, ensure_ascii=False))
        os.replace(tmp, p)  # atomic: readers never see a half-written file


class CreditLedger:
    """Thread-safe running total of live spend for one run, enforcing max_credits."""

    def __init__(self, max_credits: int | None = None, *, log_path: Path | None = None, run_id: str | None = None):
        self.max_credits = max_credits
        self.log_path = Path(log_path) if log_path else None
        self.run_id = run_id
        self._lock = threading.Lock()
        self.spent = 0
        self.estimated = 0
        self.reserved = 0
        self.capped = False
        self.calls: Counter = Counter()
        self.hits: Counter = Counter()
        self.transient: Counter = Counter()

    def reserve(self, est: int) -> None:
        with self._lock:
            if self.max_credits is not None and self.spent + self.reserved + est > self.max_credits:
                self.capped = True
                raise CreditCapReached(
                    f"--max-credits {self.max_credits} reached (spent {self.spent}, in flight {self.reserved}, next call ~{est})"
                )
            self.reserved += est

    def release(self, est: int) -> None:
        with self._lock:
            self.reserved -= est

    def settle(self, est: int, actual: int | None, *, endpoint: str, key: str, target: str | None, outcome: str) -> int:
        charged = est if actual is None else int(actual)
        with self._lock:
            self.reserved -= est
            self.spent += charged
            self.estimated += est
            self.calls[endpoint] += 1
            if outcome == "transient":
                self.transient[endpoint] += 1
            if self.log_path:
                self.log_path.parent.mkdir(parents=True, exist_ok=True)
                line = {
                    "ts": _now(), "run_id": self.run_id, "endpoint": endpoint, "key": key, "target": target,
                    "estimated": est, "actual": actual, "charged": charged, "outcome": outcome,
                    "run_total": self.spent,
                }
                with open(self.log_path, "a") as f:
                    f.write(json.dumps(line) + "\n")
        return charged

    def hit(self, endpoint: str) -> None:
        with self._lock:
            self.hits[endpoint] += 1

    def summary(self) -> dict:
        with self._lock:
            return {
                "credits_spent": self.spent,
                "credits_estimated": self.estimated,
                "max_credits": self.max_credits,
                "capped": self.capped,
                "live_calls": dict(self.calls),
                "cache_hits": dict(self.hits),
                "transient_failures": dict(self.transient),
            }


class RateGate:
    """Shared pause when X-RateLimit-Remaining runs low (docs: optimization/rate-limits)."""

    def __init__(self, min_remaining: int = 2):
        self.min_remaining = min_remaining
        self._lock = threading.Lock()
        self._resume_at = 0.0

    def update(self, rate: dict | None) -> None:
        if not rate:
            return
        remaining, reset = rate.get("remaining"), rate.get("reset")
        if remaining is not None and reset and remaining <= self.min_remaining:
            with self._lock:
                self._resume_at = max(self._resume_at, float(reset) + 0.5)

    def wait(self) -> None:
        with self._lock:
            delay = self._resume_at - time.time()
        if delay > 0:
            time.sleep(min(delay, 61.0))


def lifetime_spend(log_path: Path) -> int:
    try:
        return sum(json.loads(line).get("charged", 0) for line in Path(log_path).read_text().splitlines() if line.strip())
    except FileNotFoundError:
        return 0


class Api:
    """Cached, budgeted access to Context.dev. One instance per run, shared by all workers."""

    def __init__(
        self,
        cache: DiskCache,
        ledger: CreditLedger | None = None,
        *,
        offline: bool = False,
        refresh: bool = False,
        max_age_ms: int | None = None,
    ):
        self.cache = cache
        self.ledger = ledger or CreditLedger(None)
        self.offline = offline
        self.refresh = refresh
        self.max_age_ms = max_age_ms
        self.gate = RateGate()
        self.stop_event = threading.Event()
        self._locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._locks_lock = threading.Lock()
        self._fetched_this_run: set[str] = set()

    # -- public calls -------------------------------------------------------------------
    def search(self, query: str, *, target: str | None = None, **kw) -> dict:
        return self.call("search", context_client.search_request(query, **kw), target=target)

    def map_urls(self, domain: str, *, target: str | None = None, **kw) -> dict:
        return self.call("map", context_client.map_request(domain, **kw), target=target)

    def scrape(self, url: str, *, target: str | None = None) -> dict:
        return self.call("scrape", context_client.scrape_request(url), target=target)

    # -- core ------------------------------------------------------------------------------
    def _lock_for(self, key: str) -> threading.Lock:
        with self._locks_lock:
            return self._locks[key]

    def call(self, endpoint: str, request: dict, *, target: str | None = None) -> dict:
        """Returns the cache record plus {"charged": credits billed now, "cached": bool}.

        Record: {endpoint, key, request, fetched_at, credits, ok, transient, data, error}.
        """
        key = request_key(endpoint, request)
        with self._lock_for(key):
            use_cache = not self.refresh or key in self._fetched_this_run
            rec = self.cache.get(endpoint, key) if (use_cache or self.offline) else None
            # A cached transient failure is only a placeholder: live runs retry it, offline replays reuse it.
            if rec is not None and (self.offline or not rec.get("transient")):
                self.ledger.hit(endpoint)
                return {**rec, "charged": 0, "cached": True}
            if self.offline:
                raise CacheMiss(f"{endpoint} {key}")
            if self.stop_event.is_set():
                raise CreditCapReached("run stopped")
            est = estimate_credits(endpoint, request)
            try:
                self.ledger.reserve(est)
            except CreditCapReached:
                self.stop_event.set()
                raise
            self.gate.wait()
            try:
                out = context_client.execute(endpoint, request, max_age_ms=self.max_age_ms)
            except TransientError as e:
                # Timeouts (behavior=fail), 429 and 5xx are not billed.
                self.ledger.settle(est, 0, endpoint=endpoint, key=key, target=target, outcome="transient")
                rec = self._record(endpoint, key, request, credits=0, data=None,
                                   error={"status": None, "code": "TRANSIENT", "message": str(e)[:500]}, transient=True)
                self.cache.put(endpoint, key, rec)
                self._fetched_this_run.add(key)
                return {**rec, "charged": 0, "cached": False}
            except FatalError:
                self.ledger.release(est)
                self.stop_event.set()
                raise
            except BaseException:
                self.ledger.release(est)
                raise
            self.gate.update(out.get("rate"))
            rec = self._record(endpoint, key, request, credits=out.get("credits"), data=out.get("data"), error=out.get("error"))
            charged = self.ledger.settle(est, out.get("credits"), endpoint=endpoint, key=key, target=target,
                                         outcome="ok" if rec["ok"] else "error")
            self.cache.put(endpoint, key, rec)
            self._fetched_this_run.add(key)
            return {**rec, "charged": charged, "cached": False}

    @staticmethod
    def _record(endpoint: str, key: str, request: dict, *, credits, data, error, transient: bool = False) -> dict:
        return {
            "endpoint": endpoint,
            "key": key,
            "request": request,
            "fetched_at": _now(),
            "credits": credits,
            "ok": error is None,
            "transient": transient,
            "data": data,
            "error": error,
        }
