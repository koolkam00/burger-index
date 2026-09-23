"""Single server-side wrapper for every Context.dev call in this project.

This is the ONLY module that imports the context.dev SDK. Everything else builds a
request with the *_request() helpers and runs it through pipeline.api (disk cache +
credit ledger), which calls execute() here — so tests mock one function.

Reads CONTEXT_DEV_API_KEY from the environment (loaded from the repo's .env).

Retries: the SDK already retries 408/409/429/5xx with bounded exponential backoff and
honors Retry-After (max_retries=3). What is still failing after that is raised as
TransientError (retry on a later run, never cached as a result). 401 / quota errors raise
FatalError (stop the run). Other 4xx are page-level answers (404, blocked, unsupported)
and are returned as {"error": ...} so they can be cached and not re-billed.

Endpoints (docs: append .md to any docs URL for markdown):
  POST /web/search  https://docs.context.dev/api-reference/web-scraping/search  1 credit / 10 results
  GET  /web/urls    https://docs.context.dev/api-reference/web-scraping/map     1 credit (2 with search)
  POST /web/scrape  https://docs.context.dev/api-reference/web-scraping/scrape  1 (2 with actions) + 4 (JSON)
                                                                               + 1 per OCR'd PDF page
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MAX_RETRIES = 3
REQUEST_TIMEOUT_S = 150  # httpx timeout; must exceed the scrape deadline below
SCRAPE_DEADLINE_MS = 90_000  # timeoutOpts behavior=fail -> 408 without charging credits
SEARCH_DEADLINE_MS = 45_000
MAP_DEADLINE_MS = 45_000
TAGS = ["burger-index"]
PDF_MAX_PAGES = 10

PROTEINS = ["beef", "chicken", "turkey", "fish", "veggie", "lamb", "pork", "other"]
MENU_PERIODS = ["all_day", "dinner", "lunch", "brunch", "late_night", "happy_hour", "kids", "other"]

# JSON Schema for the scrape JSON extractor (POST /web/scrape, formats.json).
BURGER_MENU_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_menu": {
            "type": "boolean",
            "description": "True if this page shows a restaurant's food menu: a menu page, menu PDF, or an "
            "online-ordering / delivery store page listing dishes. False for homepages without dishes, articles, "
            "reviews, directories, error or 'page not found' pages.",
        },
        "has_prices": {"type": "boolean", "description": "True if dishes on this page show prices."},
        "restaurant_name": {"type": ["string", "null"], "description": "Restaurant name as shown on the page."},
        "location": {
            "type": ["string", "null"],
            "description": "Street address or branch name this menu belongs to, if the page shows one.",
        },
        "currency": {"type": ["string", "null"], "description": "ISO code, e.g. USD."},
        "burgers": {
            "type": "array",
            "description": "Every burger item on the menu (any protein).",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Item name as written on the menu, without its price."},
                    "price": {
                        "type": ["number", "null"],
                        "description": "Price in dollars of the burger by itself, as a plain number (12.5 for $12.50). "
                        "null if no price is shown, if it says market price / MP, or if it is only sold as a "
                        "combo or meal with no standalone price.",
                    },
                    "description": {"type": ["string", "null"]},
                    "protein": {
                        "type": "string",
                        "enum": PROTEINS,
                        "description": "Main patty. beef includes wagyu, dry-aged, short rib and brisket blends; "
                        "fish includes salmon, tuna, crab, shrimp; veggie includes Impossible, Beyond, black bean, "
                        "mushroom; other = bison, elk, venison, mixed.",
                    },
                    "menu_period": {
                        "type": ["string", "null"],
                        "enum": MENU_PERIODS + [None],
                        "description": "The menu this price comes from when the page has several (lunch, dinner, "
                        "brunch, happy hour, kids); null or all_day when there is one menu.",
                    },
                },
                "required": ["name", "price", "protein"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_menu", "has_prices", "burgers"],
    "additionalProperties": False,
}

BURGER_INSTRUCTIONS = (
    "List every burger sold on this menu: hamburgers, cheeseburgers, smash burgers, patty melts and other "
    "patty-on-a-bun items of any protein (beef, chicken, turkey, fish, veggie, lamb...). Do not list hot dogs, "
    "chicken sandwiches made from a whole breast or cutlet (unless the menu calls it a burger), or toppings and "
    "add-ons. Include sliders only when sold as their own burger item, not inside a sampler or appetizer platter. "
    "Price rules: price is the burger alone. If several sizes or patty counts are listed (single/double, "
    "4oz/8oz), use the single/standard size. Ignore combo or meal upgrades ('make it a meal +$4') and add-on "
    "prices (bacon, cheese, egg). A burger that simply comes with fries on the plate is fine: use its menu "
    "price. If an item is only sold as a combo/meal and no burger-only price is shown, set price to null. "
    "Market price, MP, or no price shown: null. "
    "If the page has several menus (lunch, dinner, brunch, happy hour, kids), list each burger once per menu it "
    "appears on and set menu_period. "
    "Set is_menu false for pages that are not a food menu or ordering page. Set has_prices true only if menu "
    "items show prices. Return an empty burgers list if the page has no burgers."
)


class ContextDevError(RuntimeError):
    pass


class TransientError(ContextDevError):
    """Timeout / 5xx / connection / rate-limit still failing after SDK retries. Retry on a later run."""


class FatalError(ContextDevError):
    """Bad key, quota exhausted or account disabled. Stop the run."""


FATAL_CODES = {"UNAUTHORIZED", "USAGE_EXCEEDED", "DISABLED", "INSUFFICIENT_PERMISSIONS", "PAID_PLAN_REQUIRED"}


# ---------------------------------------------------------------------------------------
# Request builders: the returned dict is both the SDK kwargs and the cache key material.
# Keep volatile knobs (timeouts, tags, maxAgeMs) OUT of these; execute() adds them.


def search_request(query: str, *, num_results: int = 10, exclude_domains: list[str] | None = None) -> dict:
    req: dict[str, Any] = {"query": query[:500], "num_results": num_results, "country": "us"}
    if exclude_domains:
        req["exclude_domains"] = list(exclude_domains)
    return req


def map_request(domain: str, *, url_regex: str | None = None, max_links: int = 100) -> dict:
    req: dict[str, Any] = {"domain": domain, "max_links": max_links}
    if url_regex:
        req["url_regex"] = url_regex
    return req


# Delivery-app store pages lazy-load their menu sections: scroll to the bottom first.
# Browser actions make the base cost 2 credits instead of 1 (docs: scrape) and need a paid
# plan (HTTP 403 PAID_PLAN_REQUIRED otherwise) — gated by config.SCROLL_DELIVERY_APPS.
SCROLL_ACTIONS = [
    {"type": "scroll", "direction": "down", "amount": "max", "max_scrolls": 15},
    {"type": "wait", "milliseconds": 1500},
]


def scrape_request(url: str, *, scroll: bool = False) -> dict:
    shared: dict[str, Any] = {
        "dismiss_popups": True,
        "include_frames": True,
        "wait_for": 1000,
        "parsers": {"pdf": {"ocr": "auto", "end_page": PDF_MAX_PAGES}},
    }
    if scroll:
        shared["actions"] = SCROLL_ACTIONS
    return {
        "url": url,
        "formats": {"json": True},
        "json_params": {"schema": BURGER_MENU_SCHEMA, "instructions": BURGER_INSTRUCTIONS},
        "shared_params": shared,
    }


@lru_cache(maxsize=1)
def _client():
    from context.dev import ContextDev

    if not os.environ.get("CONTEXT_DEV_API_KEY"):
        raise FatalError("CONTEXT_DEV_API_KEY is not set (add it to .env)")
    return ContextDev(max_retries=MAX_RETRIES, timeout=REQUEST_TIMEOUT_S)


def _int(v: Any) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _rate(headers: Any) -> dict[str, int | None]:
    h = headers or {}
    return {
        "limit": _int(h.get("x-ratelimit-limit")),
        "remaining": _int(h.get("x-ratelimit-remaining")),
        "reset": _int(h.get("x-ratelimit-reset")),
    }


def execute(endpoint: str, request: dict, *, max_age_ms: int | None = None) -> dict:
    """Run one Context.dev call. Returns {"data", "credits", "credits_remaining", "error", "rate"}.

    data: the response as a JSON-able dict (API field names), or None on a page-level error.
    credits: key_metadata.credits_consumed when the API reports it, else None.
    error: None, or {"status", "code", "message"} for a non-retryable 4xx page-level failure.
    """
    import context.dev as cd

    client = _client()
    kwargs = dict(request)
    kwargs["tags"] = TAGS
    if endpoint == "scrape":
        fn = client.web.with_raw_response.scrape
        kwargs["timeout_opts"] = {"milliseconds": SCRAPE_DEADLINE_MS, "behavior": "fail"}
        if max_age_ms is not None:
            kwargs["max_age_ms"] = max_age_ms
    elif endpoint == "search":
        fn = client.web.with_raw_response.search
        kwargs["timeout_opts"] = {"milliseconds": SEARCH_DEADLINE_MS, "behavior": "fail"}
    elif endpoint == "map":
        fn = client.web.with_raw_response.map_urls
        kwargs["timeout_opts"] = {"milliseconds": MAP_DEADLINE_MS, "behavior": "fail"}
    else:
        raise ValueError(f"unknown endpoint {endpoint!r}")

    try:
        raw = fn(**kwargs)
    except cd.APIStatusError as e:
        body = e.body if isinstance(e.body, dict) else {}
        code = body.get("error_code")
        message = str(body.get("message") or e.message)[:500]
        credits = _int((body.get("key_metadata") or {}).get("credits_consumed"))
        if e.status_code == 401 or code in FATAL_CODES:
            raise FatalError(f"{endpoint}: HTTP {e.status_code} {code}: {message}") from e
        if e.status_code in (408, 409, 429) or e.status_code >= 500:
            raise TransientError(f"{endpoint}: HTTP {e.status_code} {code}: {message}") from e
        return {
            "data": None,
            "credits": credits,
            "credits_remaining": _int((body.get("key_metadata") or {}).get("credits_remaining")),
            "error": {"status": e.status_code, "code": code, "message": message},
            "rate": _rate(e.response.headers),
        }
    except cd.APIConnectionError as e:
        raise TransientError(f"{endpoint}: connection error: {e}") from e

    model = raw.parse()
    data = model.to_dict(mode="json")
    meta = data.get("key_metadata") or {}
    return {
        "data": data,
        "credits": _int(meta.get("credits_consumed")),
        "credits_remaining": _int(meta.get("credits_remaining")),
        "error": None,
        "rate": _rate(raw.headers),
    }
