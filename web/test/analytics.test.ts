import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { CaptureResult } from "posthog-js";
import {
  analytics,
  createAnalytics,
  debounce,
  filterValue,
  fromPath,
  linkHost,
  maskUrl,
  MAX_QUERY_CHARS,
  posthogConfig,
  scrubEvent,
  SEARCH_DEBOUNCE_MS,
  searchProps,
  searchTracker,
  track,
} from "../src/lib/analytics";
import { EMPTY_FILTERS } from "../src/lib/explorer";

/** A stand-in for posthog-js: records init and every capture. */
function fakePosthog() {
  const inits: Array<[string, Record<string, unknown>]> = [];
  const captured: Array<[string, Record<string, unknown>]> = [];
  const client = {
    init(key: string, config: Record<string, unknown>) {
      inits.push([key, config]);
      return client;
    },
    capture(event: string, props: Record<string, unknown>) {
      captured.push([event, props]);
      return undefined;
    },
  };
  return { client, inits, captured };
}

/** init() only runs in a browser: give the test a `window` for its duration. */
async function inBrowser(fn: () => Promise<void>) {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const prev = g.window;
  g.window = globalThis;
  try {
    await fn();
  } finally {
    if (had) g.window = prev;
    else delete g.window;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("without a key (tests, npm run dev, local builds) analytics is off and track() does nothing", async () => {
  assert.equal(process.env.NEXT_PUBLIC_POSTHOG_KEY, undefined, "the test run has no PostHog key");
  assert.equal(analytics.enabled, false);
  track("see_on_map_clicked", { restaurant_id: "due-west" });

  // No key means no setup, so there is no loader to call: posthog-js is never imported.
  const off = createAnalytics(null);
  await inBrowser(async () => {
    off.init();
    off.track("map_view_changed", { view: "list" });
    await tick();
  });
  assert.equal(off.enabled, false);
});

test("with a key: posthog-js loads once, starts with the site's config, and gets the queued events", async () => {
  const ph = fakePosthog();
  let loads = 0;
  const a = createAnalytics({
    key: "phc_test",
    apiHost: "/ingest",
    load: async () => {
      loads++;
      return ph.client as never;
    },
  });
  assert.equal(a.enabled, true);
  a.track("see_on_map_clicked", { restaurant_id: "before-init" });
  await inBrowser(async () => {
    a.init();
    a.init();
    a.track("map_view_changed", { view: "list" });
    await tick();
  });
  assert.equal(loads, 1, "loaded once");
  assert.equal(ph.inits.length, 1);
  const [key, config] = ph.inits[0];
  assert.equal(key, "phc_test");
  assert.equal(config.api_host, "/ingest");
  assert.equal(config.ui_host, "https://us.posthog.com");
  assert.equal(config.defaults, "2026-08-30");
  assert.equal(config.mask_personal_data_properties, true);
  assert.deepEqual(config.custom_personal_data_properties, ["q"]);
  assert.equal(config.disable_surveys, true);
  assert.deepEqual(ph.captured, [
    ["see_on_map_clicked", { restaurant_id: "before-init" }],
    ["map_view_changed", { view: "list" }],
  ]);
  a.track("map_pin_opened", { restaurant_id: "due-west", source: "pin" });
  assert.deepEqual(ph.captured.at(-1), ["map_pin_opened", { restaurant_id: "due-west", source: "pin" }], "sent at once after load");
});

test("outside the browser init() loads nothing; a failed load drops the queue and later events", async () => {
  let loads = 0;
  const server = createAnalytics({ key: "phc_test", apiHost: "/ingest", load: async () => (loads++, fakePosthog().client as never) });
  server.init();
  assert.equal(loads, 0);

  const blocked = createAnalytics({ key: "phc_test", apiHost: "/ingest", load: () => Promise.reject(new Error("blocked")) });
  await inBrowser(async () => {
    blocked.track("map_view_changed", { view: "map" });
    blocked.init();
    await tick();
    blocked.track("map_view_changed", { view: "list" }); // no throw, nowhere to go
  });

  const ph = fakePosthog();
  ph.client.capture = () => {
    throw new Error("capture failed");
  };
  const flaky = createAnalytics({ key: "phc_test", apiHost: "/ingest", load: async () => ph.client as never });
  await inBrowser(async () => {
    flaky.init();
    await tick();
  });
  assert.doesNotThrow(() => flaky.track("map_view_changed", { view: "list" }), "a failing capture never breaks the page");
});

test("search properties: trimmed, spaces collapsed, lowercased, cut to 60 characters; empty sends nothing", () => {
  assert.deepEqual(searchProps("burgers", "  Smash   BURGER ", 12), { surface: "burgers", query: "smash burger", results: 12 });
  assert.equal(searchProps("burgers", "   ", 0), null);
  const long = "a".repeat(59) + " bbbbbbbbbb";
  assert.equal(searchProps("burgers", long, 0)?.query, "a".repeat(59), "no trailing space after the cut");
  assert.equal(searchProps("burgers", "x".repeat(120), 0)?.query.length, MAX_QUERY_CHARS);
});

test("filter values name what each /burgers control is set to", () => {
  const f = { ...EMPTY_FILTERS };
  assert.equal(filterValue("borough", { ...f, boroughs: ["brooklyn", "queens"] }), "brooklyn,queens");
  assert.equal(filterValue("borough", f), null);
  assert.equal(filterValue("neighborhood", { ...f, neighborhood: "west-village" }), "west-village");
  assert.equal(filterValue("neighborhood", f), null);
  assert.equal(filterValue("price", { ...f, min: 12, max: 20 }), "12-20");
  assert.equal(filterValue("price", { ...f, min: 12.5 }), "12.5-");
  assert.equal(filterValue("price", { ...f, max: 20 }), "-20");
  assert.equal(filterValue("price", f), null);
  assert.equal(filterValue("sort", { ...f, sort: "-price" }), "-price");
  assert.equal(filterValue("clear_all", { ...f, boroughs: ["bronx"] }), null);
});

test("the ranker's events carry lengths, positions and menu keys only, never a voter id or a list", async () => {
  const ph = fakePosthog();
  const a = createAnalytics({ key: "phc_test", apiHost: "/ingest", load: async () => ph.client as never });
  await inBrowser(async () => {
    a.init();
    await tick();
  });
  a.track("ranking_started", { edited: false });
  a.track("ranking_item_added", { menu_key: "chain:7th-street-burger", position: 1 });
  a.track("ranking_saved", { length: 10, edited: false });
  a.track("ranking_started", { edited: true });
  a.track("ranking_saved", { length: 12, edited: true });
  a.track("ranking_deleted", { length: 12 });
  a.track("peoples_top_clicked", { surface: "nav", from_path: fromPath("/restaurants/due-west?x=1") });
  assert.deepEqual(ph.captured, [
    ["ranking_started", { edited: false }],
    ["ranking_item_added", { menu_key: "chain:7th-street-burger", position: 1 }],
    ["ranking_saved", { length: 10, edited: false }],
    ["ranking_started", { edited: true }],
    ["ranking_saved", { length: 12, edited: true }],
    ["ranking_deleted", { length: 12 }],
    ["peoples_top_clicked", { surface: "nav", from_path: "/restaurants/due-west" }],
  ]);
  for (const [, props] of ph.captured) assert.equal(JSON.stringify(props).includes("voter"), false);
});

test("a click reports the path it came from only: no search text, no hash", () => {
  assert.equal(fromPath("/burgers?q=my%20secret&borough=bronx"), "/burgers");
  assert.equal(fromPath("/#rank"), "/");
  assert.equal(fromPath("/neighborhoods/astoria"), "/neighborhoods/astoria");
  assert.equal(fromPath(""), "/");
  assert.equal(fromPath(null), "/");
  assert.equal(fromPath("https://example.com/x"), "/", "never a full URL");
});

test("link hosts drop www. and never throw", () => {
  assert.equal(linkHost("https://www.duewestnyc.com/menu"), "duewestnyc.com");
  assert.equal(linkHost("https://order.toasttab.com/online/x?y=1"), "order.toasttab.com");
  assert.equal(linkHost("not a url"), null);
});

test("the search text is masked in every URL property, and nothing else changes", () => {
  assert.equal(maskUrl("https://burgerindex.nyc/burgers?q=my%20secret&borough=bronx"), "https://burgerindex.nyc/burgers?q=<MASKED>&borough=bronx");
  assert.equal(maskUrl("https://burgerindex.nyc/burgers?borough=bronx&q=smash#search"), "https://burgerindex.nyc/burgers?borough=bronx&q=<MASKED>#search");
  assert.equal(maskUrl("https://burgerindex.nyc/burgers?sort=-price"), "https://burgerindex.nyc/burgers?sort=-price");
  assert.equal(maskUrl("https://burgerindex.nyc/burgers?faq=1"), "https://burgerindex.nyc/burgers?faq=1", "only the q parameter");

  const event = {
    uuid: "u",
    event: "$pageview",
    properties: {
      $current_url: "https://burgerindex.nyc/restaurants/due-west",
      $referrer: "https://burgerindex.nyc/burgers?q=smash",
      query: "q=kept as is",
      results: 3,
    },
    $set_once: { $initial_referrer: "https://burgerindex.nyc/burgers?q=smash&min=10" },
  } as unknown as CaptureResult;
  const out = scrubEvent(event)!;
  assert.equal(out.properties.$referrer, "https://burgerindex.nyc/burgers?q=<MASKED>");
  assert.equal(out.properties.$current_url, "https://burgerindex.nyc/restaurants/due-west");
  assert.equal(out.properties.query, "q=kept as is", "not a URL property");
  assert.equal(out.$set_once?.$initial_referrer, "https://burgerindex.nyc/burgers?q=<MASKED>&min=10");
  assert.equal(scrubEvent(null), null);
});

test("a client-side $pageview drops the title (still the page just left); a full load keeps it", () => {
  const pageview = (properties: Record<string, unknown>) => ({ uuid: "u", event: "$pageview", properties }) as unknown as CaptureResult;
  const spa = scrubEvent(pageview({ $current_url: "https://burgerindex.nyc/burgers", title: "The Burger Index", navigation_type: "pushState" }))!;
  assert.equal("title" in spa.properties, false);
  assert.equal(spa.properties.$current_url, "https://burgerindex.nyc/burgers");
  assert.equal(spa.properties.navigation_type, "pushState");
  const back = scrubEvent(pageview({ title: "Every burger · The Burger Index", navigation_type: "popstate" }))!;
  assert.equal("title" in back.properties, false);
  const load = scrubEvent(pageview({ title: "Every burger · The Burger Index" }))!;
  assert.equal(load.properties.title, "Every burger · The Burger Index");
  const other = scrubEvent({ uuid: "u", event: "map_view_changed", properties: { title: "kept", navigation_type: "pushState" } } as unknown as CaptureResult)!;
  assert.equal(other.properties.title, "kept", "only $pageview");
});

test("session recordings never keep a Supabase request body (it carries the voter id)", () => {
  const config = posthogConfig("/ingest");
  const mask = config.session_recording?.maskCapturedNetworkRequestFn;
  assert.ok(mask);
  const supa = mask({ name: "https://abc.supabase.co/rest/v1/rpc/save_ranking", requestBody: '{"p_voter":"8f14e45f"}', responseBody: "[]" } as never);
  assert.equal(supa?.requestBody, undefined);
  assert.equal(supa?.responseBody, undefined);
  const other = mask({ name: "https://burgerindex.nyc/og.png", requestBody: "x" } as never);
  assert.equal(other?.requestBody, "x");
});

test("debounce: one call, with the last arguments, after the pause; cancel drops it", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const calls: string[] = [];
    const d = debounce((s: string) => calls.push(s), 1000);
    d("s");
    mock.timers.tick(600);
    d("sm");
    mock.timers.tick(999);
    assert.deepEqual(calls, []);
    mock.timers.tick(1);
    assert.deepEqual(calls, ["sm"]);
    d("x");
    d.cancel();
    mock.timers.tick(5000);
    assert.deepEqual(calls, ["sm"]);
  } finally {
    mock.timers.reset();
  }
});

test("burger_search waits for typing to pause, counts results then, and skips empty and repeated queries", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const sent: unknown[] = [];
    let count = 0;
    const log = searchTracker("burgers", (p) => sent.push(p));
    for (const q of ["s", "sm", "sma", "smash"]) {
      log(q, () => count);
      mock.timers.tick(200);
    }
    assert.deepEqual(sent, [], "nothing while typing");
    count = 7;
    mock.timers.tick(SEARCH_DEBOUNCE_MS);
    assert.deepEqual(sent, [{ surface: "burgers", query: "smash", results: 7 }], "one event, counted when it fires");
    log("smash ", () => count); // the same query again: not resent
    mock.timers.tick(SEARCH_DEBOUNCE_MS);
    log("", () => count); // cleared: nothing to send
    mock.timers.tick(SEARCH_DEBOUNCE_MS);
    assert.equal(sent.length, 1);
    log("Smash", () => 7); // after the box was empty, the same search counts again
    mock.timers.tick(SEARCH_DEBOUNCE_MS);
    log("smash stack", () => 1);
    log.cancel(); // the page went away first
    mock.timers.tick(SEARCH_DEBOUNCE_MS);
    assert.deepEqual(sent, [
      { surface: "burgers", query: "smash", results: 7 },
      { surface: "burgers", query: "smash", results: 7 },
    ]);
  } finally {
    mock.timers.reset();
  }
});
