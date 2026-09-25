import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANYWHERE,
  answerGap,
  areaId,
  areaName,
  areaPicks,
  areaSlug,
  areaType,
  GAP_LABEL,
  inArea,
  nextKey,
  parseAreaId,
  parsePricerData,
  parseSession,
  PRICER_AREA_KEY,
  PRICER_SESSION_KEY,
  pricerData,
  pricerHoods,
  pricerMenus,
  SHORT_DESCRIPTION,
  shuffled,
  type KeyValueStorage,
  type PricerArea,
  type PricerHood,
} from "../src/lib/pricer";
import { createPricerStore, type PricerStore } from "../src/lib/pricer-store";
import { THEME_BOOT_SCRIPT } from "../src/lib/theme-script";
import type { Restaurant } from "../src/lib/schema";
import { place } from "./places";

// A small city: two independents in Astoria, one on the Upper West Side, one in Mott Haven, a chain
// with locations in Manhattan (first: its usual location), Queens and the Bronx, and an unpriced place.
function city(): Restaurant[] {
  return [
    place({ id: "sals", name: "Sal's", price: 14, burger: "Smash Burger", borough: "Queens", hood: "astoria" }),
    place({ id: "jimbos-harlem", name: "Jimbo's", chain: "jimbos", price: 9.5, borough: "Manhattan", hood: "harlem" }),
    place({ id: "astoria-diner", name: "Astoria Diner", price: 12.25, borough: "Queens", hood: "astoria" }),
    place({ id: "jimbos-astoria", name: "Jimbo's", chain: "jimbos", price: 9.5, borough: "Queens", hood: "astoria" }),
    place({ id: "uws-grill", name: "UWS Grill", price: 24, borough: "Manhattan", hood: "upper-west-side" }),
    place({ id: "haven", name: "Haven", price: 16, borough: "Bronx", hood: "mott-haven" }),
    place({ id: "jimbos-bronx", name: "Jimbo's", chain: "jimbos", price: 9.5, borough: "Bronx", hood: "mott-haven" }),
    place({ id: "closed", name: "Closed", price: null, hood: "astoria" }),
  ];
}

const HOOD_NAMES: Record<string, string> = { astoria: "Astoria", harlem: "Harlem", "upper-west-side": "Upper West Side", "mott-haven": "Mott Haven" };
function withHoodNames(list: Restaurant[]): Restaurant[] {
  return list.map((r) => (r.index_price !== null && r.neighborhood_slug ? { ...r, neighborhood: HOOD_NAMES[r.neighborhood_slug] ?? r.neighborhood } : r));
}

const BRONX: PricerArea = { kind: "borough", slug: "bronx" };
const QUEENS: PricerArea = { kind: "borough", slug: "queens" };
const ASTORIA: PricerArea = { kind: "neighborhood", slug: "astoria" };

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const throwing: KeyValueStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

/** A store over the small city; `random` 0 always swaps with the first item (a fixed, known order). */
function store(opts: { local?: KeyValueStorage | null; session?: KeyValueStorage | null; load?: () => Promise<unknown>; random?: () => number } = {}): PricerStore {
  const local = opts.local === undefined ? memoryStorage() : opts.local;
  const session = opts.session === undefined ? memoryStorage() : opts.session;
  return createPricerStore({
    load: opts.load ?? (async () => JSON.parse(JSON.stringify(pricerData(withHoodNames(city()))))),
    local: () => local,
    session: () => session,
    random: opts.random ?? (() => 0),
  });
}

const HOODS = new Set(["astoria", "harlem", "upper-west-side", "mott-haven"]);

/** Every burger the store serves in the area, one after another, until it runs out. */
function drain(s: PricerStore, limit = 50): string[] {
  const out: string[] = [];
  while (s.getSnapshot().current && out.length < limit) {
    out.push(s.getSnapshot().current!.menu.key);
    s.next();
  }
  return out;
}

// ---- the data file --------------------------------------------------------------------------------

test("the data file: every priced menu once (a chain once), its locations with the usual one first", () => {
  const menus = pricerMenus(withHoodNames(city()));
  assert.deepEqual(
    menus.map((m) => m.key),
    ["sals", "chain:jimbos", "astoria-diner", "uws-grill", "haven"],
  );
  const chain = menus.find((m) => m.key === "chain:jimbos")!;
  assert.deepEqual(
    chain.spots.map((s) => s.id),
    ["jimbos-harlem", "jimbos-astoria", "jimbos-bronx"],
  );
  assert.equal(chain.price, 9.5);
  assert.deepEqual(chain.spots[1], { id: "jimbos-astoria", name: "Jimbo's", hood: "astoria", borough: "Queens" });
  assert.equal(menus.some((m) => m.spots.some((s) => s.id === "closed")), false, "unpriced places are never served");
});

test("only short descriptions travel", () => {
  const short = { ...(place({ id: "a", price: 10 }) as Extract<Restaurant, { burger: object }>) };
  short.burger = { name: "A", description: "  Two patties, pickles.  " };
  const long = { ...(place({ id: "b", price: 10 }) as Extract<Restaurant, { burger: object }>) };
  long.burger = { name: "B", description: "x".repeat(SHORT_DESCRIPTION + 1) };
  const [a, b] = pricerMenus([short, long]);
  assert.equal(a.description, "Two patties, pickles.");
  assert.equal(b.description, null);
});

test("the picker's neighborhoods: priced ones only, in borough order, then by name", () => {
  const hoods = pricerHoods(withHoodNames(city()));
  assert.deepEqual(
    hoods.map((h) => `${h.borough}/${h.slug}`),
    ["Manhattan/harlem", "Manhattan/upper-west-side", "Queens/astoria", "Bronx/mott-haven"],
  );
});

test("the browser checks the data file and drops anything malformed", () => {
  const good = pricerData(withHoodNames(city()));
  assert.equal(parsePricerData(JSON.parse(JSON.stringify(good))).length, 5);
  assert.deepEqual(parsePricerData(null), []);
  assert.deepEqual(parsePricerData({ menus: "nope" }), []);
  const bad = parsePricerData({
    menus: [
      { key: "BAD KEY", burger: "x", price: 10, spots: [{ id: "a", name: "A", hood: null, borough: "Queens" }] },
      { key: "no-price", burger: "x", price: null, spots: [{ id: "a", name: "A", hood: null, borough: "Queens" }] },
      { key: "no-spots", burger: "x", price: 10, spots: [] },
      { key: "bad-borough", burger: "x", price: 10, spots: [{ id: "a", name: "A", hood: null, borough: "Jersey" }] },
      { key: "ok", burger: "Burger", description: "", price: 10, spots: [{ id: "ok", name: "OK", hood: "astoria", borough: "Queens" }] },
      { key: "ok", burger: "Twice", price: 11, spots: [{ id: "ok", name: "OK", hood: "astoria", borough: "Queens" }] },
    ],
  });
  assert.deepEqual(bad, [{ key: "ok", burger: "Burger", description: null, price: 10, spots: [{ id: "ok", name: "OK", hood: "astoria", borough: "Queens" }] }]);
});

// ---- areas ----------------------------------------------------------------------------------------

test("areas: stored as ids, parsed back only when still offered", () => {
  for (const a of [ANYWHERE, BRONX, ASTORIA]) assert.deepEqual(parseAreaId(areaId(a), HOODS), a);
  assert.equal(areaId(BRONX), "borough:bronx");
  assert.equal(parseAreaId("borough:jersey", HOODS), null);
  assert.equal(parseAreaId("neighborhood:gone", HOODS), null, "a neighborhood the picker no longer offers");
  for (const junk of [null, 42, "", "anywhere", "borough:", "neighborhood:Astoria", "<script>"]) assert.equal(parseAreaId(junk, HOODS), null, String(junk));
  assert.deepEqual([areaType(ANYWHERE), areaSlug(ANYWHERE)], ["anywhere", "nyc"]);
  assert.deepEqual([areaType(BRONX), areaSlug(BRONX)], ["borough", "bronx"]);
  assert.deepEqual([areaType(ASTORIA), areaSlug(ASTORIA)], ["neighborhood", "astoria"]);
});

test("areas read as labels and in sentences", () => {
  const hoods = new Map<string, PricerHood>(pricerHoods(withHoodNames(city())).map((h) => [h.slug, h]));
  assert.equal(areaName(ANYWHERE, hoods), "Anywhere in NYC");
  assert.equal(areaName(BRONX, hoods), "Bronx");
  assert.equal(areaName(ASTORIA, hoods), "Astoria");
  assert.equal(inArea(ANYWHERE, hoods), "in NYC");
  assert.equal(inArea(BRONX, hoods), "in the Bronx");
  assert.equal(inArea({ kind: "borough", slug: "staten-island" }, hoods), "in Staten Island");
  assert.equal(inArea(ASTORIA, hoods), "in Astoria");
  assert.equal(inArea({ kind: "neighborhood", slug: "upper-west-side" }, hoods), "on the Upper West Side");
});

test("area filtering: each menu once, a chain at its location in the area, else its usual one", () => {
  const menus = pricerMenus(withHoodNames(city()));
  const spots = (a: PricerArea) => Object.fromEntries([...areaPicks(menus, a)].map(([k, p]) => [k, p.spot.id]));
  assert.deepEqual(spots(ANYWHERE), { sals: "sals", "chain:jimbos": "jimbos-harlem", "astoria-diner": "astoria-diner", "uws-grill": "uws-grill", haven: "haven" });
  assert.deepEqual(spots(QUEENS), { sals: "sals", "chain:jimbos": "jimbos-astoria", "astoria-diner": "astoria-diner" });
  assert.deepEqual(spots(BRONX), { "chain:jimbos": "jimbos-bronx", haven: "haven" });
  assert.deepEqual(spots(ASTORIA), { sals: "sals", "chain:jimbos": "jimbos-astoria", "astoria-diner": "astoria-diner" });
  assert.deepEqual(spots({ kind: "borough", slug: "staten-island" }), {});
});

test("the queue: a shuffled copy, and the first key that isn't priced or served", () => {
  const list = ["a", "b", "c", "d", "e"];
  const out = shuffled(list, () => 0.5);
  assert.deepEqual([...out].sort(), list, "a permutation");
  assert.deepEqual(list, ["a", "b", "c", "d", "e"], "the input is left alone");
  assert.deepEqual(shuffled(list, () => 0), ["b", "c", "d", "e", "a"]);
  assert.deepEqual(shuffled(list, () => 0.9999), list);
  assert.equal(nextKey(["a", "b", "c"], (k) => k === "a"), "b");
  assert.equal(nextKey(["a", "b"], () => true), null);
  assert.equal(nextKey([], () => false), null);
});

test("the reveal's difference: to the cent, with a true minus", () => {
  assert.deepEqual(answerGap(15, 18.5), { cents: -350, text: "−$3.50", side: "under" });
  assert.deepEqual(answerGap(22, 19.99), { cents: 201, text: "+$2.01", side: "over" });
  assert.deepEqual(answerGap(20, 20), { cents: 0, text: "$0.00", side: "even" });
  assert.deepEqual(answerGap(75, 1200), { cents: -112500, text: "−$1,125.00", side: "under" });
  assert.equal(GAP_LABEL.under, "Below the menu price");
});

test("the session file: known menu keys and a whole count, else a fresh session", () => {
  assert.deepEqual(parseSession(null), { seen: [], answered: 0 });
  assert.deepEqual(parseSession("{not json"), { seen: [], answered: 0 });
  assert.deepEqual(parseSession(JSON.stringify({ seen: ["a", "chain:b", "a", "BAD", 7], answered: 3 })), { seen: ["a", "chain:b"], answered: 3 });
  assert.deepEqual(parseSession(JSON.stringify({ seen: "a", answered: -1 })), { seen: [], answered: 0 });
  assert.deepEqual(parseSession(JSON.stringify({ answered: 2.5 })), { seen: [], answered: 0 });
});

test("the <head> script flags a saved area under the pricer's own storage key", () => {
  assert.ok(THEME_BOOT_SCRIPT.includes(`localStorage.getItem('${PRICER_AREA_KEY}')`));
  assert.ok(THEME_BOOT_SCRIPT.includes("pricer-saved"));
});

// ---- the store ------------------------------------------------------------------------------------

test("a first visit: the picker, then burgers in the chosen area, each once, until it runs out", async () => {
  const local = memoryStorage();
  const s = store({ local });
  assert.equal(s.getServerSnapshot().restored, false);
  assert.equal(s.getServerSnapshot().view, "choose");
  s.start(HOODS);
  assert.equal(s.getSnapshot().restored, true);
  assert.equal(s.getSnapshot().view, "choose", "no saved area: the picker");
  await s.load();
  assert.equal(s.getSnapshot().current, null, "nothing served before an area is picked");

  s.choose(BRONX);
  assert.equal(local.data.get(PRICER_AREA_KEY), "borough:bronx", "remembered for next time");
  const first = s.getSnapshot();
  assert.equal(first.view, "play");
  assert.equal(first.current?.spot.borough, "Bronx");
  const served = drain(s);
  assert.deepEqual([...served].sort(), ["chain:jimbos", "haven"], "each Bronx menu once, the chain once");
  const end = s.getSnapshot();
  assert.equal(end.current, null);
  assert.equal(end.exhausted, true, "the area has run out");
  assert.equal(end.pick, first.pick + 2);

  // Another area never serves what this session has seen.
  s.choose(ANYWHERE);
  assert.deepEqual([...drain(s)].sort(), ["astoria-diner", "sals", "uws-grill"]);
  assert.equal(s.getSnapshot().exhausted, true);
});

test("a chain is served at its location in the chosen area", async () => {
  const s = store();
  s.start(HOODS);
  await s.load();
  s.choose(ASTORIA);
  const spots = new Map<string, string>();
  while (s.getSnapshot().current) {
    const c = s.getSnapshot().current!;
    spots.set(c.menu.key, c.spot.id);
    s.next();
  }
  assert.equal(spots.get("chain:jimbos"), "jimbos-astoria");
  assert.equal(spots.size, 3);
});

test("burgers this browser priced are never served; one on the counter is swapped out while untouched", async () => {
  const s = store();
  s.start(HOODS);
  await s.load();
  s.setAnswered(["sals"]);
  s.choose(QUEENS);
  assert.notEqual(s.getSnapshot().current?.menu.key, "sals");

  // my_worth arrives late and says the burger on the counter was priced already: next one.
  const shown = s.getSnapshot().current!.menu.key;
  const pick = s.getSnapshot().pick;
  s.setAnswered(["sals", shown]);
  assert.notEqual(s.getSnapshot().current?.menu.key, shown);
  assert.equal(s.getSnapshot().pick, pick + 1);

  // Once the visitor has moved the slider, a late answer no longer swaps it out.
  const held = s.getSnapshot().current!.menu.key;
  s.hold();
  s.setAnswered(["sals", shown, held]);
  assert.equal(s.getSnapshot().current?.menu.key, held);
  s.next();
  assert.equal(s.getSnapshot().exhausted, true, "Queens has nothing left");
});

test("an answer sent from the pricer keeps its burger on the counter (the reveal follows the save)", async () => {
  const s = store();
  s.start(HOODS);
  await s.load();
  s.choose(BRONX);
  const key = s.getSnapshot().current!.menu.key;
  s.send();
  assert.equal(s.getSnapshot().sent, true);
  s.setAnswered([key]); // the answer is now this browser's
  assert.equal(s.getSnapshot().current?.menu.key, key);
  s.countAnswer();
  assert.equal(s.getSnapshot().answered, 1);
  s.next();
  assert.equal(s.getSnapshot().sent, false, "a new burger starts unsent");
});

test("a returning visitor starts in their last area; a reload never repeats this session's burgers", async () => {
  const local = memoryStorage({ [PRICER_AREA_KEY]: "neighborhood:astoria" });
  const session = memoryStorage();
  const a = store({ local, session });
  a.start(HOODS);
  assert.equal(a.getSnapshot().view, "play", "straight to the saved area");
  assert.deepEqual(a.getSnapshot().area, ASTORIA);
  assert.equal(a.getSnapshot().current, null, "until the burgers arrive");
  assert.equal(a.getSnapshot().exhausted, false);
  await a.load();
  const firstKey = a.getSnapshot().current!.menu.key;
  a.countAnswer();
  assert.ok(JSON.parse(session.data.get(PRICER_SESSION_KEY)!).seen.includes(firstKey));

  // A reload in the same tab: same session, same area, never the same burger.
  const b = store({ local, session });
  b.start(HOODS);
  await b.load();
  assert.equal(b.getSnapshot().answered, 1);
  const again = drain(b);
  assert.equal(again.includes(firstKey), false);
  assert.equal(again.length, 2);

  // A stale saved area (a neighborhood no longer offered) falls back to the picker.
  const c = store({ local: memoryStorage({ [PRICER_AREA_KEY]: "neighborhood:gone" }) });
  c.start(HOODS);
  assert.equal(c.getSnapshot().view, "choose");
});

test("blocked or missing storage: the pricer still works for this page view", async () => {
  for (const storage of [throwing, null]) {
    const s = store({ local: storage, session: storage });
    s.start(HOODS);
    await s.load();
    s.choose(BRONX);
    assert.equal(drain(s).length, 2);
    s.countAnswer();
    assert.equal(s.getSnapshot().answered, 1);
  }
  // Reaching the storage itself throws (a sandboxed frame).
  const s = createPricerStore({
    load: async () => pricerData(withHoodNames(city())),
    local: () => {
      throw new Error("SecurityError");
    },
    session: () => {
      throw new Error("SecurityError");
    },
  });
  s.start(HOODS);
  await s.load();
  s.choose(QUEENS);
  assert.ok(s.getSnapshot().current);
});

test("picking an area before the burgers arrive serves one when they do; a failed fetch can be retried", async () => {
  let fail = true;
  const s = store({
    load: async () => {
      if (fail) throw new Error("offline");
      return pricerData(withHoodNames(city()));
    },
  });
  s.start(HOODS);
  s.choose(BRONX);
  assert.equal(s.getSnapshot().current, null);
  await s.load();
  assert.equal(s.getSnapshot().data, "error");
  assert.equal(s.getSnapshot().exhausted, false, "a failed fetch is not an empty area");
  fail = false;
  await s.load();
  assert.equal(s.getSnapshot().data, "ready");
  assert.equal(s.getSnapshot().current?.spot.borough, "Bronx");
});

test("changing area shows the picker; picking again reshuffles and still skips what was served", async () => {
  const s = store({ random: () => 0.5 });
  s.start(HOODS);
  await s.load();
  s.choose(QUEENS);
  const shown = s.getSnapshot().current!.menu.key;
  s.changeArea();
  assert.equal(s.getSnapshot().view, "choose");
  assert.deepEqual(s.getSnapshot().area, QUEENS, "the area stays until another is picked");
  s.choose(QUEENS);
  assert.notEqual(s.getSnapshot().current?.menu.key, shown, "the burger that was on the counter counts as served");
  assert.equal(drain(s).length, 2);
});

test("snapshots are stable between changes (useSyncExternalStore) and listeners hear each change", async () => {
  const s = store();
  let calls = 0;
  const off = s.subscribe(() => calls++);
  const a = s.getSnapshot();
  assert.equal(s.getSnapshot(), a);
  s.start(HOODS);
  assert.notEqual(s.getSnapshot(), a);
  await s.load();
  s.choose(BRONX);
  const before = calls;
  s.setAnswered([]); // nothing new: no change
  s.hold();
  assert.equal(calls, before);
  off();
  s.next();
  assert.equal(calls, before, "unsubscribed");
});
