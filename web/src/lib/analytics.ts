// Product analytics (PostHog), browser only. Everything else calls track() with one of the events
// below; nothing here renders or changes what visitors see.
//
// Off unless NEXT_PUBLIC_POSTHOG_KEY was set at build time: then posthog-js is never imported, no
// request is made and track() does nothing. That is the case for `npm run dev` and local builds
// (the key lives only in the Vercel project settings). src/instrumentation-client.ts calls
// initAnalytics() before hydration; posthog-js arrives in its own chunk after that, and events
// tracked in the meantime are queued.
//
// No personal data: events carry ids, prices, counts and control names. The only free text is the
// /burgers search query, trimmed, lowercased and cut to 60 characters; the full query in the page URL
// (?q=) is masked in every URL PostHog records. The voter id never reaches an event.
import type { CaptureResult, PostHog, PostHogConfig } from "posthog-js";
import type { Filters } from "./explorer";
import type { PriceSource } from "./schema";

/** Where a burger search happened: the /burgers explorer or "Find a burger" on the People's Price page. */
export type SearchSurface = "burgers" | "peoples_price";
/** The /burgers controls: each filter, the sort (select or column header) and "Clear all". */
export type FilterName = "borough" | "neighborhood" | "price" | "sort" | "clear_all";
/** The People's Price page lists a row can be clicked in. */
export type BoardName = "bargains" | "overpriced" | "most_answered" | "needs_answers" | "find";

type LinkClick = {
  restaurant_id: string;
  /** The link's host, "www." dropped. */
  host: string | null;
  price_source: PriceSource;
};

/** Every custom event and its properties (PostHog adds $pageview, $pageleave, autocapture, web vitals). */
export type AnalyticsEvents = {
  /** A search, sent once typing has paused for SEARCH_DEBOUNCE_MS. */
  burger_search: { surface: SearchSurface; query: string; results: number };
  /** One /burgers control changed; `results` is the burger count it leaves. */
  burger_filter_changed: { filter: FilterName; value: string | null; results: number };
  /** An answer to "What would you pay?", sent once it is saved. */
  worth_answered: {
    menu_key: string;
    restaurant_id: string;
    dollars: number;
    menu_price: number;
    first_answer: boolean;
    /** The answer this one replaced (only when it changed one). */
    previous_dollars?: number;
  };
  /** A row of a People's Price list followed to its restaurant's slider. */
  peoples_price_board_clicked: { board: BoardName; menu_key: string; restaurant_id: string; rank: number | null; position: number };
  /** A map pin's popup opened: tapped, or opened for /map?r=<id> ("See it on the map"). */
  map_pin_opened: { restaurant_id: string; source: "pin" | "link" };
  /** The restaurant link inside a map popup. */
  map_popup_link_clicked: { restaurant_id: string };
  /** The map page's Map / List toggle. */
  map_view_changed: { view: "map" | "list" };
  menu_link_clicked: LinkClick;
  website_link_clicked: LinkClick;
  see_on_map_clicked: { restaurant_id: string };
};
export type EventName = keyof AnalyticsEvents;

export const SEARCH_DEBOUNCE_MS = 1000;
export const MAX_QUERY_CHARS = 60;
/** Events kept while posthog-js loads; more than this before it arrives are dropped. */
const MAX_QUEUE = 50;
/** The ingest path the Vercel rewrites in web/vercel.json proxy to PostHog (US cloud). */
export const DEFAULT_API_HOST = "/ingest";
const UI_HOST = "https://us.posthog.com";

// ---- property shaping (pure) ----------------------------------------------------------------

/** A search's properties, or null when there is nothing to send (an empty or all-space query). */
export function searchProps(surface: SearchSurface, query: string, results: number): AnalyticsEvents["burger_search"] | null {
  const q = query.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_QUERY_CHARS).trim();
  return q ? { surface, query: q, results } : null;
}

function priceBound(n: number | null): string {
  return n === null ? "" : String(n);
}

/**
 * What a /burgers control is set to, as an event value: boroughs "brooklyn,queens", a neighborhood
 * slug, a price range "12-20" / "12-" / "-20", a sort key; null when cleared (and for "Clear all").
 */
export function filterValue(filter: FilterName, f: Filters): string | null {
  switch (filter) {
    case "borough":
      return f.boroughs.length ? f.boroughs.join(",") : null;
    case "neighborhood":
      return f.neighborhood || null;
    case "price":
      return f.min === null && f.max === null ? null : `${priceBound(f.min)}-${priceBound(f.max)}`;
    case "sort":
      return f.sort;
    case "clear_all":
      return null;
  }
}

/** The worth_answered properties for a saved answer; `previous` is the answer it replaced (null: none). */
export function worthAnsweredProps(a: {
  menuKey: string;
  restaurantId: string;
  dollars: number;
  menuPrice: number;
  previous: number | null;
}): AnalyticsEvents["worth_answered"] {
  return {
    menu_key: a.menuKey,
    restaurant_id: a.restaurantId,
    dollars: a.dollars,
    menu_price: a.menuPrice,
    first_answer: a.previous === null,
    ...(a.previous !== null && a.previous !== a.dollars ? { previous_dollars: a.previous } : {}),
  };
}

/** An outbound link's host ("www." dropped), or null for a URL that doesn't parse. */
export function linkHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// ---- privacy --------------------------------------------------------------------------------

const MASKED = "<MASKED>";
/** URL query parameters PostHog masks wherever it records a URL: the /burgers search text. */
export const MASKED_URL_PARAMS = ["q"];
const MASK_RE = new RegExp(`([?&](?:${MASKED_URL_PARAMS.join("|")})=)[^&#]*`, "g");

/** The URL with each MASKED_URL_PARAMS value replaced by <MASKED> (as PostHog's own masking writes it). */
export function maskUrl(url: string): string {
  return url.replace(MASK_RE, `$1${MASKED}`);
}

const URL_PROP = /url|referrer/i;

/**
 * before_send: masks the search text in URL properties PostHog's own masking skips (the referrer of a
 * page opened from a search, and the initial-referrer person properties).
 */
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const [k, v] of Object.entries(bag)) {
      if (typeof v === "string" && URL_PROP.test(k)) bag[k] = maskUrl(v);
    }
  }
  return event;
}

/** Supabase request bodies carry the voter id: never keep them in a session recording. */
function dropSupabaseBodies<T extends { name: string; requestBody?: string | null; responseBody?: string | null }>(req: T): T {
  if (!/supabase\.co/i.test(req.name)) return req;
  return { ...req, requestBody: undefined, responseBody: undefined };
}

/** posthog.init options. Session replay, heatmaps and web vitals follow the project settings. */
export function posthogConfig(apiHost: string): Partial<PostHogConfig> {
  return {
    api_host: apiHost,
    ui_host: UI_HOST,
    // Newest config defaults of the installed posthog-js: among them a $pageview on every client-side
    // navigation (capture_pageview "history_change": path changes only, so the explorer's filter URL
    // updates are not pageviews), $pageleave when the visitor leaves, and URL hashes stripped.
    defaults: "2026-08-30",
    person_profiles: "identified_only",
    mask_personal_data_properties: true,
    custom_personal_data_properties: MASKED_URL_PARAMS,
    before_send: scrubEvent,
    session_recording: { maskCapturedNetworkRequestFn: dropSupabaseBodies },
    // Nothing PostHog could show visitors (analytics must not change the page).
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
  };
}

// ---- the client ---------------------------------------------------------------------------

type Client = Pick<PostHog, "init" | "capture">;
export type AnalyticsSetup = { key: string; apiHost: string; load: () => Promise<Client> };

export type Analytics = {
  readonly enabled: boolean;
  /** Load and start posthog-js (once). Does nothing without a key or outside the browser. */
  init(): void;
  track<E extends EventName>(event: E, props: AnalyticsEvents[E]): void;
};

export function createAnalytics(setup: AnalyticsSetup | null): Analytics {
  let client: Client | null = null;
  let started = false;
  let failed = false;
  const queue: Array<[string, Record<string, unknown>]> = [];

  const send = (c: Client, event: string, props: Record<string, unknown>) => {
    try {
      c.capture(event, props);
    } catch {
      // Analytics never breaks the page.
    }
  };

  return {
    enabled: setup !== null,
    init() {
      if (!setup || started || typeof window === "undefined") return;
      started = true;
      setup.load().then(
        (ph) => {
          try {
            ph.init(setup.key, posthogConfig(setup.apiHost));
          } catch {
            failed = true;
            queue.length = 0;
            return;
          }
          client = ph;
          for (const [event, props] of queue.splice(0)) send(ph, event, props);
        },
        () => {
          // The chunk didn't load (offline, or blocked): stay off for this page view.
          failed = true;
          queue.length = 0;
        },
      );
    },
    track(event, props) {
      if (!setup || failed) return;
      const p = props as Record<string, unknown>;
      if (client) send(client, event, p);
      else if (queue.length < MAX_QUEUE) queue.push([event, p]);
    },
  };
}

// NEXT_PUBLIC_* values are inlined at build time, so they are read as literal expressions here.
export const analytics: Analytics = createAnalytics(
  process.env.NEXT_PUBLIC_POSTHOG_KEY
    ? {
        key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
        apiHost: process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_API_HOST,
        load: () => import("posthog-js").then((m) => m.default),
      }
    : null,
);

export function initAnalytics(): void {
  analytics.init();
}

export function track<E extends EventName>(event: E, props: AnalyticsEvents[E]): void {
  analytics.track(event, props);
}

// ---- debounced search ---------------------------------------------------------------------

export type Debounced<A extends unknown[]> = ((...args: A) => void) & { cancel(): void };

/** `fn`, called `ms` after the last call (with that call's arguments); cancel() drops a pending call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const debounced = (...args: A) => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  return Object.assign(debounced, { cancel });
}

/**
 * A search box's burger_search sender: call it on every keystroke with the box's text and a way to
 * count its results. It sends once typing pauses for SEARCH_DEBOUNCE_MS, counting the results then.
 * An empty box sends nothing, and the query it sent last isn't sent again (an edit typed back) until
 * the box has been empty.
 */
export function searchTracker(
  surface: SearchSurface,
  send: (props: AnalyticsEvents["burger_search"]) => void = (p) => track("burger_search", p),
  ms = SEARCH_DEBOUNCE_MS,
): Debounced<[query: string, results: () => number]> {
  let last: string | null = null;
  return debounce((query: string, results: () => number) => {
    const props = searchProps(surface, query, 0);
    if (!props) {
      last = null;
      return;
    }
    if (props.query === last) return;
    last = props.query;
    send({ ...props, results: results() });
  }, ms);
}
