import assert from "node:assert/strict";
import { test } from "node:test";
import type { HistRow } from "../src/lib/worth";
import { canOrderUp, createWorthStore, histKnown, type SavedAnswer, type WorthApi } from "../src/lib/worth-store";

const VOTER = "8f14e45f-ceea-467a-9575-2b7b1a0c3d11";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A fake backend: this browser's answers plus other visitors' answers, a histogram per menu kept like
 * the database trigger (with an updated_at clock per cell), and switches to fail or hold calls.
 */
function fakeServer(opts: { mine?: Record<string, number>; others?: Record<string, number[]> } = {}) {
  const mine = new Map<string, number>(Object.entries(opts.mine ?? {}));
  const others = new Map<string, Map<number, number>>();
  const clock = new Map<string, number>();
  let now = 1000;
  const touch = (key: string, d: number) => clock.set(`${key} ${d}`, ++now);
  for (const [k, answers] of Object.entries(opts.others ?? {})) {
    const h = new Map<number, number>();
    for (const a of answers) {
      h.set(a, (h.get(a) ?? 0) + 1);
      touch(k, a);
    }
    others.set(k, h);
  }
  for (const [k, d] of mine) touch(k, d);

  const hist = (key: string): Map<number, number> => {
    const h = new Map(others.get(key) ?? []);
    const m = mine.get(key);
    if (m !== undefined) h.set(m, (h.get(m) ?? 0) + 1);
    return h;
  };
  const rows = (key: string): HistRow[] => [...hist(key)].map(([dollars, votes]) => ({ menu_key: key, dollars, votes, at: clock.get(`${key} ${dollars}`) ?? 0 }));
  /** The current copy of one cell, as a realtime event would carry it (votes 0: deleted). */
  const cell = (key: string, dollars: number): HistRow => ({ menu_key: key, dollars, votes: hist(key).get(dollars) ?? 0, at: clock.get(`${key} ${dollars}`) ?? 0 });

  const calls: Array<[string, number]> = [];
  const fetches: Array<readonly string[] | undefined> = [];
  const s = {
    calls,
    fetches,
    failCast: undefined as unknown,
    failFetch: undefined as unknown,
    castGate: null as (() => Promise<void>) | null,
    /** Held after the answer is saved, before the reply goes back. */
    replyGate: null as (() => Promise<void>) | null,
    fetchGate: null as (() => Promise<void>) | null,
    mineGate: null as (() => Promise<void>) | null,
    hist,
    cell,
    /** Another visitor answers. */
    other(key: string, dollars: number) {
      const h = others.get(key) ?? new Map<number, number>();
      h.set(dollars, (h.get(dollars) ?? 0) + 1);
      others.set(key, h);
      touch(key, dollars);
    },
    api: {
      async castWorth(key, voter, dollars) {
        assert.equal(voter, VOTER);
        calls.push([key, dollars]);
        if (s.castGate) await s.castGate();
        if (s.failCast) throw s.failCast;
        const prev = mine.get(key);
        mine.set(key, dollars);
        if (prev !== undefined) touch(key, prev);
        touch(key, dollars);
        if (s.replyGate) await s.replyGate();
        return { menu_key: key, votes: [...hist(key).values()].reduce((a, b) => a + b, 0), median: null };
      },
      async fetchMyWorth() {
        const snapshot = new Map(mine);
        if (s.mineGate) await s.mineGate();
        return snapshot;
      },
      async fetchHist(keys) {
        fetches.push(keys);
        if (s.failFetch) throw s.failFetch;
        // The snapshot is taken when the request is made; the gate only delays the reply.
        const all = new Set([...others.keys(), ...mine.keys()]);
        const out = [...all].filter((k) => !keys || keys.includes(k)).flatMap(rows);
        if (s.fetchGate) await s.fetchGate();
        return out;
      },
    } satisfies WorthApi,
  };
  return s;
}

const store = (api: WorthApi, voter: string | null = VOTER, enabled = true) => createWorthStore({ api, enabled, voter: { read: () => voter, get: () => voter ?? VOTER } });

const shown = (s: ReturnType<typeof store>, key: string) => Object.fromEntries([...(s.getHists().hists.get(key) ?? new Map())].sort((a, b) => a[0] - b[0]));

test("an answer shows at once (yours and in the histogram), is saved, then the fresh copy takes over", async () => {
  const f = fakeServer({ others: { "due-west": [30, 30] } });
  const s = store(f.api);
  await s.loadHist(["due-west"]);
  assert.deepEqual(shown(s, "due-west"), { 30: 2 });
  s.answer("due-west", 20);
  assert.equal(s.getMine().answers.get("due-west"), 20, "optimistic");
  assert.equal(s.getMine().saving.has("due-west"), true);
  assert.deepEqual(shown(s, "due-west"), { 20: 1, 30: 2 }, "counted once, straight away");
  await s.settled();
  assert.equal(s.getMine().saving.has("due-west"), false);
  assert.equal(s.getMine().saved.has("due-west"), true);
  assert.deepEqual(shown(s, "due-west"), { 20: 1, 30: 2 });
  assert.deepEqual(f.calls, [["due-west", 20]]);
  assert.deepEqual(f.fetches.at(-1), ["due-west"], "the menu is fetched fresh after the answer is saved");
});

test("changing an answer moves it: the old one comes out of the histogram", async () => {
  const f = fakeServer({ mine: { "due-west": 20 }, others: { "due-west": [30, 30] } });
  const s = store(f.api);
  await Promise.all([s.loadMine(), s.loadHist(["due-west"])]);
  assert.deepEqual(shown(s, "due-west"), { 20: 1, 30: 2 });
  assert.equal(s.getMine().answers.get("due-west"), 20);
  s.answer("due-west", 30);
  assert.deepEqual(shown(s, "due-west"), { 30: 3 }, "moved, not added");
  await s.settled();
  assert.deepEqual(shown(s, "due-west"), { 30: 3 });
  assert.deepEqual(f.hist("due-west"), new Map([[30, 3]]));
});

test("realtime events for the answer that beat the fresh copy are never counted twice", async () => {
  const f = fakeServer({ others: { x: [30, 30] } });
  const s = store(f.api);
  await s.loadHist();
  const reply = deferred<void>();
  f.replyGate = () => reply.promise;
  s.answer("x", 20);
  // The database has the answer before the reply comes back, and its realtime event arrives first.
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(f.hist("x"), new Map([[30, 2], [20, 1]]));
  s.applyRow(f.cell("x", 20)); // {20: 1} from the database
  assert.deepEqual(shown(s, "x"), { 20: 1, 30: 2 }, "held back while the answer settles");
  f.replyGate = null;
  reply.resolve();
  await s.settled();
  assert.deepEqual(shown(s, "x"), { 20: 1, 30: 2 });
});

test("another visitor's answer that arrives while the fresh copy is on its way is kept", async () => {
  const f = fakeServer({ others: { x: [30, 30] } });
  const s = store(f.api);
  await s.loadHist();
  const reply = deferred<void>();
  s.answer("x", 20);
  f.fetchGate = () => reply.promise; // the fresh copy's reply is slow
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(f.fetches.at(-1), ["x"], "the fresh fetch has been sent");
  f.other("x", 50); // after the fresh copy's snapshot
  s.applyRow(f.cell("x", 50));
  s.applyRow(f.cell("x", 20)); // a late echo of this browser's own answer: not newer than the fresh copy
  assert.deepEqual(shown(s, "x"), { 20: 1, 30: 2 });
  f.fetchGate = null;
  reply.resolve();
  await s.settled();
  assert.deepEqual(shown(s, "x"), { 20: 1, 30: 2, 50: 1 });
});

test("when the fresh copy can't be fetched, the held events are replayed and the answer still counts once", async () => {
  const f = fakeServer({ others: { x: [30, 30] } });
  const s = store(f.api);
  await s.loadHist();
  const reply = deferred<void>();
  f.replyGate = () => reply.promise;
  s.answer("x", 20);
  await new Promise((r) => setTimeout(r, 5));
  s.applyRow(f.cell("x", 20)); // held
  f.failFetch = new TypeError("Failed to fetch");
  f.replyGate = null;
  reply.resolve();
  await s.settled();
  assert.deepEqual(shown(s, "x"), { 20: 1, 30: 2 });
  assert.equal(s.getMine().answers.get("x"), 20);
});

test("quick changes are sent one at a time, in order, and the last answer wins", async () => {
  let open = deferred<void>();
  const f = fakeServer();
  f.castGate = () => open.promise;
  const s = store(f.api);
  await s.loadHist(["due-west"]);
  s.answer("due-west", 10);
  s.answer("due-west", 20); // queued behind the first
  s.answer("due-west", 30); // replaces the queued 20
  assert.equal(s.getMine().answers.get("due-west"), 30);
  assert.deepEqual(shown(s, "due-west"), { 30: 1 });
  open.resolve();
  open = deferred<void>();
  await new Promise((r) => setTimeout(r, 10));
  open.resolve();
  await s.settled();
  assert.deepEqual(f.calls, [
    ["due-west", 10],
    ["due-west", 30],
  ]);
  assert.equal(s.getMine().answers.get("due-west"), 30);
  assert.deepEqual(shown(s, "due-west"), { 30: 1 });
});

test("a failed answer falls back to the saved one, keeps a friendly error kind and leaves the histogram alone", async () => {
  const f = fakeServer({ others: { "due-west": [30] } });
  const s = store(f.api);
  await s.loadHist(["due-west"]);
  s.answer("due-west", 20);
  await s.settled();
  f.failCast = { code: "54000", message: "too many answers from this connection; try again later" };
  s.answer("due-west", 60);
  assert.equal(s.getMine().answers.get("due-west"), 60);
  assert.deepEqual(shown(s, "due-west"), { 30: 1, 60: 1 });
  await s.settled();
  assert.equal(s.getMine().answers.get("due-west"), 20, "back to the saved answer");
  assert.equal(s.getMine().errors.get("due-west"), "rate");
  assert.deepEqual(shown(s, "due-west"), { 20: 1, 30: 1 });
  f.failCast = undefined;
  s.answer("due-west", 60);
  assert.equal(s.getMine().errors.has("due-west"), false, "a new answer clears the error");
  await s.settled();
  assert.equal(s.getMine().answers.get("due-west"), 60);
  assert.deepEqual(shown(s, "due-west"), { 30: 1, 60: 1 });
});

test("a network failure on a first answer leaves nothing answered", async () => {
  const f = fakeServer();
  f.failCast = { code: "", message: "TypeError: Failed to fetch" };
  const s = store(f.api);
  await s.loadHist(["due-west"]);
  s.answer("due-west", 25);
  await s.settled();
  assert.equal(s.getMine().answers.has("due-west"), false);
  assert.equal(s.getMine().errors.get("due-west"), "network");
  assert.deepEqual(shown(s, "due-west"), {});
});

test("re-sending the saved answer sends nothing", async () => {
  const f = fakeServer();
  const s = store(f.api);
  s.answer("due-west", 25);
  await s.settled();
  s.answer("due-west", 25);
  await s.settled();
  assert.equal(f.calls.length, 1);
});

test("saved answers load once; an answer made meanwhile is never overwritten or double counted", async () => {
  const f = fakeServer({ mine: { "due-west": 20, "chain:7th-street-burger": 12 }, others: { "due-west": [30, 30] } });
  const s = store(f.api);
  await s.loadHist(["due-west"]);
  const gate = deferred<void>();
  f.mineGate = () => gate.promise;
  const loading = s.loadMine();
  const cast = deferred<void>();
  f.castGate = () => cast.promise;
  s.answer("due-west", 45);
  gate.resolve();
  await loading;
  assert.equal(s.getMine().status, "ready");
  assert.equal(s.getMine().answers.get("due-west"), 45);
  assert.equal(s.getMine().answers.get("chain:7th-street-burger"), 12);
  assert.deepEqual(shown(s, "due-west"), { 30: 2, 45: 1 }, "the saved $20 comes out once it is known");
  cast.resolve();
  await s.settled();
  assert.deepEqual(shown(s, "due-west"), { 30: 2, 45: 1 });
  assert.equal(s.loadMine(), s.loadMine(), "one load per page view");
});

test("a browser that never answered loads nothing", async () => {
  let fetched = false;
  const f = fakeServer();
  const api: WorthApi = {
    ...f.api,
    async fetchMyWorth() {
      fetched = true;
      return f.api.fetchMyWorth();
    },
  };
  const s = store(api, null);
  await s.loadMine();
  assert.equal(fetched, false);
  assert.equal(s.getMine().status, "ready");
});

test("an older copy of a cell never replaces a newer one, and a delete isn't undone by an older fetch", async () => {
  const f = fakeServer();
  const s = store(f.api);
  s.applyRow({ menu_key: "a", dollars: 20, votes: 5, at: 2000 });
  s.applyRow({ menu_key: "a", dollars: 20, votes: 4, at: 1000 }); // late realtime event
  assert.deepEqual(shown(s, "a"), { 20: 5 });
  // A fetch whose copy is older than the realtime one keeps the realtime one.
  const older: WorthApi = { ...f.api, fetchHist: async () => [{ menu_key: "a", dollars: 20, votes: 3, at: 1500 }] };
  const s2 = store(older);
  s2.applyRow({ menu_key: "a", dollars: 20, votes: 5, at: 2000 });
  await s2.loadHist();
  assert.deepEqual(shown(s2, "a"), { 20: 5 });
  assert.equal(s2.getHists().status, "ready");
  // A cell deleted while a fetch was out stays deleted when the (older) fetch lands.
  const gate = deferred<HistRow[]>();
  const s3 = store({ ...f.api, fetchHist: () => gate.promise });
  s3.applyRow({ menu_key: "a", dollars: 30, votes: 1, at: 100 });
  const loading = s3.loadHist();
  s3.removeRow("a", 30);
  gate.resolve([{ menu_key: "a", dollars: 30, votes: 1, at: 100 }]);
  await loading;
  assert.deepEqual(shown(s3, "a"), {});
});

test("a full fetch drops cells that are gone, but not ones that arrived while it ran", async () => {
  const gate = deferred<HistRow[]>();
  const f = fakeServer();
  const s = store({ ...f.api, fetchHist: () => gate.promise });
  s.applyRow({ menu_key: "old", dollars: 10, votes: 1, at: 100 });
  const loading = s.loadHist();
  s.applyRow({ menu_key: "fresh", dollars: 40, votes: 1, at: null }); // arrives mid-fetch
  gate.resolve([{ menu_key: "kept", dollars: 25, votes: 2, at: 300 }]);
  await loading;
  assert.deepEqual([...s.getHists().hists.keys()].sort(), ["fresh", "kept"]);
  s.removeRow("kept", 25);
  assert.equal(s.getHists().hists.has("kept"), false);
});

test("a failed first load reports an error; a failed refresh keeps the histograms shown", async () => {
  const f = fakeServer({ others: { a: [20, 30, 40] } });
  f.failFetch = new TypeError("Failed to fetch");
  const s = store(f.api);
  await s.loadHist();
  assert.equal(s.getHists().status, "error");
  assert.deepEqual([s.getHists().all, s.getHists().allFailed], [false, true]);
  f.failFetch = undefined;
  await s.loadHist();
  assert.equal(s.getHists().status, "ready");
  assert.deepEqual([s.getHists().all, s.getHists().allFailed], [true, false]);
  f.failFetch = new TypeError("Failed to fetch");
  await s.loadHist();
  assert.deepEqual([s.getHists().all, s.getHists().allFailed], [true, false], "still complete, just not refreshed");
  assert.deepEqual(shown(s, "a"), { 20: 1, 30: 1, 40: 1 });
});

test("one menu's load (a restaurant page) doesn't make the whole board look loaded", async () => {
  const f = fakeServer({ others: { a: [20, 30, 40] } });
  const s = store(f.api);
  await s.loadHist(["b"]);
  assert.equal(histKnown(s.getHists(), "b"), true, "known, with no answers");
  assert.equal(histKnown(s.getHists(), "a"), false);
  assert.equal(s.getHists().all, false);
  f.failFetch = new TypeError("Failed to fetch");
  await s.loadHist(["a"]);
  assert.equal(s.getHists().failed.has("a"), true);
  f.failFetch = undefined;
  await s.loadHist(["a"]);
  assert.equal(s.getHists().failed.has("a"), false);
  assert.equal(histKnown(s.getHists(), "a"), true);
  assert.deepEqual(shown(s, "a"), { 20: 1, 30: 1, 40: 1 });
});

test("an answer before the menu's histogram is known makes it known once the fresh copy lands", async () => {
  const f = fakeServer({ others: { a: [20, 30] } });
  const s = store(f.api);
  s.answer("a", 50);
  assert.equal(histKnown(s.getHists(), "a"), false, "the overlay alone isn't the histogram");
  await s.settled();
  assert.equal(histKnown(s.getHists(), "a"), true);
  assert.deepEqual(shown(s, "a"), { 20: 1, 30: 1, 50: 1 });
});

test("disabled (no Supabase settings): nothing is sent or loaded", async () => {
  const f = fakeServer();
  const s = store(f.api, VOTER, false);
  s.answer("due-west", 20);
  await s.loadMine();
  await s.loadHist();
  assert.equal(s.getMine().status, "disabled");
  assert.equal(s.getHists().status, "disabled");
  assert.equal(s.getMine().answers.size, 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.fetches, []);
});

test("invalid answers are ignored before they reach the network", async () => {
  const f = fakeServer();
  const s = store(f.api);
  for (const bad of [4, 76, 19.5, Number.NaN]) s.answer("due-west", bad);
  s.answer("Not A Key", 20);
  await s.settled();
  assert.deepEqual(f.calls, []);
  assert.equal(s.getMine().answers.size, 0);
});

test("snapshots are stable between changes (useSyncExternalStore needs that)", () => {
  const s = store(fakeServer().api);
  assert.equal(s.getMine(), s.getMine());
  assert.equal(s.getHists(), s.getHists());
  assert.equal(s.getServerMine(), s.getMine(), "the prerender snapshot until something happens");
  let heard = 0;
  const off = s.subscribe(() => (heard += 1));
  s.applyRow({ menu_key: "a", dollars: 20, votes: 1, at: null });
  assert.equal(heard, 1);
  off();
  s.applyRow({ menu_key: "b", dollars: 20, votes: 1, at: null });
  assert.equal(heard, 1);
});

test("the board's load of every known menu counts as complete, fetches only those menus and fails as a whole", async () => {
  const f = fakeServer({ others: { a: [20, 30, 40], b: [10], junk: [75, 75, 75] } });
  const s = store(f.api);
  f.failFetch = new TypeError("Failed to fetch");
  await s.loadHist(["a", "b"], { all: true });
  assert.deepEqual([s.getHists().all, s.getHists().allFailed], [false, true]);
  assert.equal(s.getHists().failed.size, 0, "a failed board load isn't a per-menu failure");
  f.failFetch = undefined;
  await s.loadHist(["a", "b"], { all: true });
  assert.deepEqual(f.fetches.at(-1), ["a", "b"], "only the menus the page knows are fetched");
  assert.deepEqual([s.getHists().all, s.getHists().allFailed], [true, false]);
  assert.equal(histKnown(s.getHists(), "c"), true, "every menu is known: a missing one has no answers");
  assert.deepEqual([...s.getHists().hists.keys()].sort(), ["a", "b"], "the junk key is never loaded");
  // A refresh drops cells that are gone.
  const s2 = store({ ...fakeServer().api, fetchHist: async () => [] });
  s2.applyRow({ menu_key: "a", dollars: 20, votes: 1, at: 100 });
  await s2.loadHist(["a", "b"], { all: true });
  assert.deepEqual(shown(s2, "a"), {});
});

test("a restaurant page's refresh of its one menu picks up other visitors' answers", async () => {
  const f = fakeServer({ others: { "amity-hall": [22] } });
  const s = store(f.api);
  s.answer("amity-hall", 33);
  await s.settled();
  assert.deepEqual(shown(s, "amity-hall"), { 22: 1, 33: 1 });
  f.other("amity-hall", 40);
  await s.loadHist(["amity-hall"]);
  assert.deepEqual(shown(s, "amity-hall"), { 22: 1, 33: 1, 40: 1 }, "counted once each, the visitor's own included");
  f.failFetch = new TypeError("Failed to fetch");
  await s.loadHist(["amity-hall"]);
  assert.equal(s.getHists().failed.has("amity-hall"), false, "a failed refresh keeps the People's Price shown");
  assert.deepEqual(shown(s, "amity-hall"), { 22: 1, 33: 1, 40: 1 });
});

test("the untouched slider can't be sent until the saved answer is known; a moved one can", async () => {
  assert.equal(canOrderUp("idle", false), false);
  assert.equal(canOrderUp("loading", false), false);
  assert.equal(canOrderUp("error", false), false, "the saved answer is still unknown");
  assert.equal(canOrderUp("ready", false), true);
  for (const st of ["idle", "loading", "error", "ready"] as const) assert.equal(canOrderUp(st, true), true);
  assert.equal(canOrderUp("disabled", true), false);
  assert.equal(canOrderUp("disabled", false), false);

  // The race the rule closes: while my_worth is on its way the slider shows $40, not the saved $33.
  const f = fakeServer({ mine: { "amity-hall": 33 } });
  const s = store(f.api);
  const gate = deferred<void>();
  f.mineGate = () => gate.promise;
  const loading = s.loadMine();
  assert.equal(s.getMine().status, "loading");
  assert.equal(canOrderUp(s.getMine().status, false), false, "Order up waits for the saved answer");
  gate.resolve();
  await loading;
  assert.equal(s.getMine().answers.get("amity-hall"), 33, "the slider starts at the saved answer");
  assert.equal(canOrderUp(s.getMine().status, false), true);
  assert.deepEqual(f.calls, [], "nothing was sent");
});

test("a failed load of the saved answers reports it and can be tried again", async () => {
  const f = fakeServer({ mine: { "amity-hall": 33 } });
  let fail = true;
  const s = store({
    ...f.api,
    async fetchMyWorth() {
      if (fail) throw new TypeError("Failed to fetch");
      return f.api.fetchMyWorth();
    },
  });
  await s.loadMine();
  assert.equal(s.getMine().status, "error");
  assert.equal(s.getMine().answers.has("amity-hall"), false);
  fail = false;
  await s.loadMine();
  assert.equal(s.getMine().status, "ready");
  assert.equal(s.getMine().answers.get("amity-hall"), 33);
});

test("onSaved hears each saved answer with the answer it replaced, and never a failed one", async () => {
  const f = fakeServer({ mine: { "due-west": 20 } });
  const s = store(f.api);
  const heard: SavedAnswer[] = [];
  const stop = s.onSaved((a) => heard.push(a));
  s.answer("chain:7th-street-burger", 12);
  await s.settled();
  await s.loadMine();
  s.answer("chain:7th-street-burger", 14);
  await s.settled();
  s.answer("amity-hall", 25);
  await s.settled();
  s.answer("due-west", 30);
  await s.settled();
  f.failCast = { code: "", message: "TypeError: Failed to fetch" };
  s.answer("due-west", 40);
  await s.settled();
  f.failCast = undefined;
  s.answer("due-west", 35);
  await s.settled();
  stop();
  s.answer("due-west", 50);
  await s.settled();
  assert.deepEqual(heard, [
    // Saved before the browser's saved answers were loaded: whether it replaced one is unknown.
    { menuKey: "chain:7th-street-burger", dollars: 12, previous: undefined },
    { menuKey: "chain:7th-street-burger", dollars: 14, previous: 12 },
    { menuKey: "amity-hall", dollars: 25, previous: null },
    { menuKey: "due-west", dollars: 30, previous: 20 },
    { menuKey: "due-west", dollars: 35, previous: 30 },
  ]);
});

test("onSaved: an answer saved while the saved ones are still loading, or after they failed, replaced an unknown one", async () => {
  const f = fakeServer({ mine: { "due-west": 30 } });
  const gate = deferred<void>();
  f.mineGate = () => gate.promise;
  const s = store(f.api);
  const heard: SavedAnswer[] = [];
  s.onSaved((a) => heard.push(a));
  const loading = s.loadMine();
  assert.equal(s.getMine().status, "loading");
  s.answer("due-west", 42);
  await s.settled();
  gate.resolve();
  await loading;
  s.answer("due-west", 44);
  await s.settled();
  assert.deepEqual(heard, [
    { menuKey: "due-west", dollars: 42, previous: undefined },
    { menuKey: "due-west", dollars: 44, previous: 42 },
  ]);

  const g = fakeServer({ mine: { "due-west": 30 } });
  const failed = store({
    ...g.api,
    async fetchMyWorth() {
      throw new TypeError("Failed to fetch");
    },
  });
  const heardFailed: SavedAnswer[] = [];
  failed.onSaved((a) => heardFailed.push(a));
  await failed.loadMine();
  assert.equal(failed.getMine().status, "error");
  failed.answer("due-west", 42);
  await failed.settled();
  assert.deepEqual(heardFailed, [{ menuKey: "due-west", dollars: 42, previous: undefined }]);
});

test("onSaved: an answer made while the saved ones load still reports the one it replaced", async () => {
  const f = fakeServer({ mine: { "due-west": 20 } });
  const s = store(f.api);
  const heard: SavedAnswer[] = [];
  s.onSaved((a) => heard.push(a));
  const gate = deferred<void>();
  f.mineGate = () => gate.promise;
  const loading = s.loadMine();
  const cast = deferred<void>();
  f.castGate = () => cast.promise;
  s.answer("due-west", 45);
  gate.resolve();
  await loading;
  cast.resolve();
  await s.settled();
  assert.deepEqual(heard, [{ menuKey: "due-west", dollars: 45, previous: 20 }]);
});

test("a listener that throws doesn't turn a saved answer into an error", async () => {
  const f = fakeServer();
  const s = store(f.api);
  s.onSaved(() => {
    throw new Error("analytics down");
  });
  s.answer("due-west", 25);
  await s.settled();
  assert.equal(s.getMine().errors.has("due-west"), false);
  assert.equal(s.getMine().saved.has("due-west"), true);
});
