"""Single server-side wrapper for every Context.dev call in this project.

Reads CONTEXT_DEV_API_KEY from the environment (loaded from .env). Nothing else
in the project should import the context.dev SDK directly — call these functions
so tests can mock one module.

Retries: the SDK already retries 408/409/429/5xx with bounded exponential
backoff and honors Retry-After; we raise the retry budget, and never retry 4xx
validation errors.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv

load_dotenv()

MAX_RETRIES = 3
REQUEST_TIMEOUT_S = 120

# JSON Schema for the scrape JSON extractor (POST /web/scrape, formats.json).
BURGER_MENU_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "restaurant_name": {"type": ["string", "null"]},
        "currency": {"type": ["string", "null"], "description": "ISO code, e.g. USD."},
        "burgers": {
            "type": "array",
            "description": "Every beef burger / cheeseburger item on the menu.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "price": {"type": ["number", "null"], "description": "Menu price as a number, no currency symbol."},
                    "description": {"type": ["string", "null"]},
                    "is_beef": {"type": "boolean", "description": "False for veggie, chicken, fish, turkey, lamb burgers."},
                },
                "required": ["name", "price", "is_beef"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["burgers"],
    "additionalProperties": False,
}

BURGER_INSTRUCTIONS = (
    "Extract only burger items (hamburgers, cheeseburgers, smash burgers, sliders sold as a burger). "
    "Use the base price of the burger itself, not add-ons or combo upcharges. "
    "If a burger has several sizes, use the single/standard size. Skip items with no listed price "
    "by setting price to null. Return an empty list if the page has no burgers."
)


class ContextDevError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _client():
    from context.dev import ContextDev

    if not os.environ.get("CONTEXT_DEV_API_KEY"):
        raise ContextDevError("CONTEXT_DEV_API_KEY is not set (add it to .env)")
    return ContextDev(max_retries=MAX_RETRIES, timeout=REQUEST_TIMEOUT_S)


def extract_burger_menu(url: str, *, max_age_ms: int | None = None) -> dict[str, Any]:
    """Scrape a menu page (HTML or PDF) and return {restaurant_name, currency, burgers[]}.

    Cost: 1 credit + 4 for JSON extraction (+1/page if a PDF needs OCR).
    max_age_ms=None uses the API default cache (1 day); pass 0 to force a fresh capture.
    """
    import context.dev as cd

    kwargs: dict[str, Any] = {
        "url": url,
        "formats": {"json": True},
        "json_params": {"schema": BURGER_MENU_SCHEMA, "instructions": BURGER_INSTRUCTIONS},
        "timeout_opts": {"milliseconds": 90_000, "behavior": "fail"},
        "tags": ["burger-index"],
    }
    if max_age_ms is not None:
        kwargs["max_age_ms"] = max_age_ms
    try:
        resp = _client().web.scrape(**kwargs)
    except cd.APIStatusError as e:
        raise ContextDevError(f"scrape {url} failed: HTTP {e.status_code} {e.message}") from e
    except cd.APIConnectionError as e:
        raise ContextDevError(f"scrape {url} failed: {e}") from e

    data = resp.json_.data if resp.json_ else None
    if not isinstance(data, dict):
        return {"restaurant_name": None, "currency": None, "burgers": []}
    data.setdefault("burgers", [])
    return data
