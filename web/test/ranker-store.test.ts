import assert from "node:assert/strict";
import { test } from "node:test";
import { menuListData } from "../src/lib/menu-list";
import type { SavedRanking, SaveReply } from "../src/lib/ranker";
import { createRankerStore, parseDraft, RANKER_DRAFT_KEY, type KeyValueStorage, type PageEvents, type RankerApi, type RankerStore, type Timers } from "../src/lib/ranker-store";
import { RANKER_SAVED_KEY } from "../src/lib/theme-script";
import { place } from "./places";

const MENUS = menuListData(
  ["a", "b", "c", "d", "e"].map((id) => place({ id, name: id.toUpperCase(), price: 10, borough: "Queens", hood: "astoria" })),
);

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** Fake setTimeout: nothing runs until the test moves the clock (which starts at 14:00:00 UTC). */
function fakeTimers() {
  let now = Date.UTC(2026, 8, 27, 14);
  let id = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      due.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void due.delete(h as number),
  };
  return {
    timers,
    now: () => now,
    /** Timers waiting, as delays from now. */
    waiting: () => [...due.values()].map((t) => t.at - now).sort((a, b) => a - b),
    advance(ms: number) {
      now += ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        next[1].fn();
      }
    },
  };
}

type Deferred = { items: string[]; resolve(): void; reject(err: unknown): void };

/**
 * A fake backend: one saved list per voter, the calls it got, failures to throw on demand, and (with `hold`) saves
 * that wait until the test settles them.
 */
function fakeApi(seed: Record<string, SavedRanking | null> = {}) {
  const lists = new Map(Object.entries(seed));
  const calls: string[] = [];
  const fail: { save?: unknown; get?: unknown; del?: unknown } = {};
  const ctl = { hold: false, held: [] as Deferred[] };
  const unload: string[] = [];
  const store = (voter: string, items: readonly string[]): SaveReply => {
    lists.set(voter, { items: [...items], status: "active", savedOn: "2026-09-26", countsFrom: "2026-09-27", inBoard: false });
    return { status: "active", savedOn: "2026-09-26", countsFrom: "2026-09-27" };
  };
  const api: RankerApi = {
    save(voter, items): Promise<SaveReply> {
      calls.push(`save ${voter} ${items.join(",")}`);
      if (ctl.hold) {
        return new Promise((resolve, reject) => {
          ctl.held.push({ items: [...items], resolve: () => resolve(store(voter, items)), reject });
        });
      }
      if (fail.save) return Promise.reject(fail.save);
      return Promise.resolve(store(voter, items));
    },
    async get(voter) {
      calls.push(`get ${voter}`);
      if (fail.get) throw fail.get;
      return lists.get(voter) ?? null;
    },
    // like delete_ranking: only an active or replaced list is withdrawn (a void one stays void)
    async del(voter) {
      calls.push(`del ${voter}`);
      if (fail.del) throw fail.del;
      const list = lists.get(voter);
      if (!list || (list.status !== "active" && list.status !== "replaced")) return false;
      lists.set(voter, { ...list, status: "deleted", countsFrom: null, inBoard: false });
      return true;
    },
    saveOnUnload(voter, items) {
      unload.push(`${voter} ${items.join(",")}`);
    },
  };
  return { api, calls, fail, lists, ctl, unload };
}

function setup(opts: { voter?: string | null; saved?: SavedRanking | null; session?: Record<string, string>; menus?: () => Promise<unknown> } = {}) {
  let voter = opts.voter ?? null;
  const backend = fakeApi(voter && opts.saved ? { [voter]: opts.saved } : {});
  const local = memoryStorage();
  const session = memoryStorage(opts.session);
  const clock = fakeTimers();
  let page: PageEvents | null = null;
  const store = createRankerStore({
    loadMenus: opts.menus ?? (async () => MENUS),
    api: backend.api,
    voter: { read: () => voter, get: () => (voter ??= "new-voter") },
    local: () => local,
    session: () => session,
    timers: clock.timers,
    now: clock.now,
    watchPage: (on) => void (page = on),
  });
  return { store, backend, local, session, clock, voterId: () => voter, page: () => page! };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function started(store: RankerStore) {
  store.start();
  await tick();
  await tick();
}
/** Let the clock run `ms`, then the promises it started settle. */
async function wait(clock: ReturnType<typeof fakeTimers>, ms: number) {
  clock.advance(ms);
  await tick();
  await tick();
}

const SAVED = (items: string[], extra: Partial<SavedRanking> = {}): SavedRanking => ({ items, status: "active", savedOn: "2026-09-20", countsFrom: null, inBoard: true, ...extra });

test("a new browser: a list of 3 saves itself 2 s after the last change (making the voter id); under 3 nothing is sent", async () => {
  const { store, backend, local, session, clock, voterId } = setup();
  assert.equal(store.getServerSnapshot().started, false);
  await started(store);
  let s = store.getSnapshot();
  assert.equal(s.menus, "ready");
  assert.equal(s.mine, "none", "no voter id: no request");
  assert.deepEqual(backend.calls, []);

  store.add("a");
  store.add("b");
  s = store.getSnapshot();
  assert.equal(s.saving, false, "two burgers can't be saved");
  assert.equal(s.problem, "too_short");
  assert.deepEqual(clock.waiting(), []);
  store.add("c");
  store.move("c", -2);
  s = store.getSnapshot();
  assert.deepEqual(s.draft, ["c", "a", "b"]);
  assert.equal(s.saving, true);
  assert.deepEqual(clock.waiting(), [2000]);
  assert.equal(session.data.get(RANKER_DRAFT_KEY), JSON.stringify({ items: ["c", "a", "b"] }), "kept for this session until saved");

  await wait(clock, 1999);
  assert.deepEqual(backend.calls, [], "not before the pause ends");
  await wait(clock, 1);
  s = store.getSnapshot();
  assert.equal(voterId(), "new-voter");
  assert.deepEqual(backend.calls, ["save new-voter c,a,b"]);
  assert.equal(s.saving, false);
  assert.equal(s.dirty, false);
  assert.deepEqual(s.saved?.items, ["c", "a", "b"]);
  assert.equal(s.saved?.countsFrom, "2026-09-27");
  assert.deepEqual(s.lastSave, { seq: 1, length: 3, edited: false });
  assert.equal(session.data.has(RANKER_DRAFT_KEY), false, "the draft is gone once saved");
  assert.equal(local.data.get(RANKER_SAVED_KEY), "1", "the next page load knows there is a saved list");
});

test("changes in a row make one save: each change restarts the pause", async () => {
  const { store, backend, clock } = setup();
  await started(store);
  for (const k of ["a", "b", "c"]) store.add(k);
  await wait(clock, 1500);
  store.add("d");
  await wait(clock, 1500);
  store.move("d", -3);
  await wait(clock, 1500);
  assert.deepEqual(backend.calls, []);
  await wait(clock, 500);
  assert.deepEqual(backend.calls, ["save new-voter d,a,b,c"]);
  assert.equal(store.getSnapshot().lastSave?.seq, 1);
});

test("a returning browser: its saved list is on the card, editable; a change saves itself, and the saved list again is never sent", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  let s = store.getSnapshot();
  assert.equal(s.mine, "ready");
  assert.deepEqual(s.draft, ["a", "b", "c"]);
  assert.equal(s.dirty, false);
  assert.equal(s.saving, false, "nothing to save on load");
  assert.deepEqual(backend.calls, ["get v1"]);

  // moved away and back within the pause: identical to the saved list, so nothing goes
  store.moveTo("c", 0);
  assert.equal(store.getSnapshot().saving, true);
  store.moveTo("c", 2);
  assert.equal(store.getSnapshot().saving, false);
  await wait(clock, 5000);
  assert.deepEqual(backend.calls, ["get v1"]);

  store.moveTo("c", 0);
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "save v1 c,a,b"]);
  s = store.getSnapshot();
  assert.deepEqual(s.lastSave, { seq: 1, length: 3, edited: true });
  assert.equal(s.saved?.inBoard, false, "the new version isn't in a board yet");
  // the flush on hide with nothing waiting sends nothing
  await store.flush();
  assert.equal(backend.calls.length, 2);
});

test("one save at a time: a change made while one is on its way is saved right after it, and its reply never overwrites the newer list", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.hold = true;
  store.add("d");
  await wait(clock, 2000);
  assert.deepEqual(backend.calls.slice(1), ["save v1 a,b,c,d"]);
  assert.equal(store.getSnapshot().saving, true);

  store.add("e");
  await wait(clock, 2000); // the pause ends while the first save is still on its way: it waits
  assert.equal(backend.calls.length, 2, "never two at once");
  backend.ctl.held.shift()!.resolve();
  await tick();
  await tick();
  let s = store.getSnapshot();
  assert.deepEqual(s.saved?.items, ["a", "b", "c", "d"], "the reply records the list it saved");
  assert.deepEqual(s.draft, ["a", "b", "c", "d", "e"], "the newer list stays on the card");
  assert.equal(s.dirty, true);
  assert.deepEqual(backend.calls.slice(1), ["save v1 a,b,c,d", "save v1 a,b,c,d,e"], "the newest list goes right after");
  backend.ctl.held.shift()!.resolve();
  await tick();
  await tick();
  s = store.getSnapshot();
  assert.deepEqual(s.saved?.items, ["a", "b", "c", "d", "e"]);
  assert.equal(s.dirty, false);
  assert.equal(s.saving, false);
  assert.equal(s.lastSave?.seq, 2);
});

test("a change back to the list saved before, made while a save is on its way, is saved after it", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.hold = true;
  store.moveTo("c", 0);
  await wait(clock, 2000);
  store.moveTo("c", 2); // [a,b,c] again: the same as the saved list, until the save on its way lands
  backend.ctl.held.shift()!.resolve();
  await tick();
  await tick();
  assert.deepEqual(store.getSnapshot().saved?.items, ["c", "a", "b"]);
  assert.equal(store.getSnapshot().dirty, true);
  backend.ctl.hold = false;
  await wait(clock, 2000);
  assert.deepEqual(backend.calls.slice(1), ["save v1 c,a,b", "save v1 a,b,c"]);
  assert.deepEqual(store.getSnapshot().saved?.items, ["a", "b", "c"]);
});

test("a save that can't reach the counter is tried again after 5 s, 15 s, then every minute, and at once when the connection is back", async () => {
  const { store, backend, clock, session, page } = setup();
  await started(store);
  for (const k of ["a", "b", "c"]) store.add(k);
  backend.fail.save = new TypeError("Failed to fetch");
  await wait(clock, 2000);
  let s = store.getSnapshot();
  assert.deepEqual(s.failure, { action: "save", kind: "network", retrying: true });
  assert.equal(s.saving, true, "still on its way, in a sense");
  assert.deepEqual(clock.waiting(), [5000]);
  assert.deepEqual(s.draft, ["a", "b", "c"], "nothing lost");
  assert.ok(session.data.has(RANKER_DRAFT_KEY), "and kept for this session");
  await wait(clock, 5000);
  assert.deepEqual(clock.waiting(), [15000]);
  await wait(clock, 15000);
  assert.deepEqual(clock.waiting(), [60000]);
  await wait(clock, 60000);
  assert.deepEqual(clock.waiting(), [60000]);
  assert.equal(backend.calls.length, 4);

  // back online: the waiting retry goes now
  backend.fail.save = undefined;
  page().online();
  await tick();
  await tick();
  s = store.getSnapshot();
  assert.equal(s.failure, null);
  assert.equal(s.saving, false);
  assert.deepEqual(clock.waiting(), []);
  assert.equal(backend.calls.length, 5);
});

test("a refusal (a rate limit) is said and not tried again until the list changes", async () => {
  const { store, backend, clock } = setup();
  await started(store);
  for (const k of ["a", "b", "c"]) store.add(k);
  backend.fail.save = { code: "PT429", hint: "rate_voter", message: "You've saved your list a lot today. Try again tomorrow." };
  await wait(clock, 2000);
  let s = store.getSnapshot();
  assert.deepEqual(s.failure, { action: "save", kind: "rate_voter", retrying: false });
  assert.equal(s.saving, false);
  assert.deepEqual(clock.waiting(), [], "no loop");
  await wait(clock, 600000);
  assert.equal(backend.calls.length, 1);
  assert.deepEqual(s.draft, ["a", "b", "c"], "the list stays on the card");

  store.add("d");
  assert.equal(store.getSnapshot().failure, null, "a change clears it");
  backend.fail.save = undefined;
  await wait(clock, 2000);
  s = store.getSnapshot();
  assert.deepEqual(s.saved?.items, ["a", "b", "c", "d"]);
  assert.equal(backend.calls.length, 2);
});

test("a saved list edited under 3 isn't saved: the saved one stays as it was until the list has 3 again", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.remove("b");
  let s = store.getSnapshot();
  assert.equal(s.problem, "too_short");
  assert.equal(s.dirty, true);
  assert.equal(s.saving, false);
  await wait(clock, 10000);
  assert.deepEqual(backend.calls, ["get v1"]);
  assert.deepEqual(s.saved?.items, ["a", "b", "c"]);
  store.add("d");
  await wait(clock, 2000);
  s = store.getSnapshot();
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,c,d"]);
  assert.deepEqual(s.saved?.items, ["a", "c", "d"]);
});

test("a list being built survives a reload (sessionStorage), wins over the saved one it differs from, and saves itself", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]), session: { [RANKER_DRAFT_KEY]: JSON.stringify({ items: ["b", "a", "c", "d"] }) } });
  await started(store);
  const s = store.getSnapshot();
  assert.deepEqual(s.draft, ["b", "a", "c", "d"]);
  assert.equal(s.dirty, true);
  assert.equal(s.saving, true);
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c,d"]);

  // A stored draft equal to the saved list is just the saved list: nothing to send.
  const same = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]), session: { [RANKER_DRAFT_KEY]: JSON.stringify({ items: ["a", "b", "c"] }) } });
  await started(same.store);
  assert.equal(same.store.getSnapshot().dirty, false);
  await wait(same.clock, 5000);
  assert.deepEqual(same.backend.calls, ["get v1"]);
});

test("stored drafts are checked", () => {
  assert.deepEqual(parseDraft(JSON.stringify({ items: ["a", "chain:b"] })), ["a", "chain:b"]);
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft("{"), null);
  assert.equal(parseDraft(JSON.stringify({ items: [] })), null);
  assert.equal(parseDraft(JSON.stringify({ items: ["a", "a"] })), null);
  assert.equal(parseDraft(JSON.stringify({ items: ["Not a key"] })), null);
  assert.equal(parseDraft(JSON.stringify({ items: Array.from({ length: 26 }, (_, i) => `k${i}`) })), null);
});

test("the page hidden: a save waiting goes at once; the page closing: it goes as a keepalive request, and the draft stays", async () => {
  const { store, backend, clock, session, page } = setup();
  await started(store);
  for (const k of ["a", "b", "c"]) store.add(k);
  page().hidden();
  await tick();
  await tick();
  assert.deepEqual(backend.calls, ["save new-voter a,b,c"]);
  assert.deepEqual(clock.waiting(), []);

  store.add("d");
  page().unload();
  assert.deepEqual(backend.unload, ["new-voter a,b,c,d"]);
  assert.deepEqual(clock.waiting(), [], "nothing left waiting");
  assert.equal(session.data.get(RANKER_DRAFT_KEY), JSON.stringify({ items: ["a", "b", "c", "d"] }), "a reload shows (and saves) it if the request was lost");
  page().unload();
  assert.equal(backend.unload.length, 1, "nothing waiting: nothing sent");
});

test("a tab closed within the pause (hidden, then closed): the save the hide started goes again as a keepalive request", async () => {
  const { store, backend, page } = setup();
  await started(store);
  backend.ctl.hold = true; // the normal request is still on its way (the Supabase client loading, a preflight) as the page goes
  for (const k of ["a", "b", "c"]) store.add(k);
  page().hidden();
  page().unload();
  assert.deepEqual(backend.calls, ["save new-voter a,b,c"]);
  assert.deepEqual(backend.unload, ["new-voter a,b,c"], "the keepalive copy outlives the page");
});

test("closed while a save is on its way and a newer change is queued behind it: the newest list goes as a keepalive request", async () => {
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.hold = true;
  store.add("d");
  await wait(clock, 2000);
  store.add("e");
  await wait(clock, 2000); // its pause ends while the first save is on its way: queued behind it
  assert.deepEqual(clock.waiting(), []);
  page().unload();
  assert.deepEqual(backend.unload, ["v1 a,b,c,d,e"]);
  // and while only a save is on its way (nothing queued): that list goes again
  const one = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(one.store);
  one.backend.ctl.hold = true;
  one.store.add("d");
  await wait(one.clock, 2000);
  one.page().unload();
  assert.deepEqual(one.backend.unload, ["v1 a,b,c,d"]);
});

test("back from the back-forward cache after a keepalive save: the saved list is checked again, and a change back is saved", async () => {
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.move("b", -1);
  page().unload();
  assert.deepEqual(backend.unload, ["v1 b,a,c"]);
  assert.equal(store.getSnapshot().saving, false, "nothing left waiting on the card");
  // the keepalive request landed
  backend.lists.set("v1", SAVED(["b", "a", "c"], { inBoard: false }));
  page().restored();
  assert.equal(store.getSnapshot().saving, false);
  await tick();
  await tick();
  let s = store.getSnapshot();
  assert.deepEqual(s.saved?.items, ["b", "a", "c"]);
  assert.equal(s.dirty, false);
  store.move("b", 1); // back to a,b,c: no longer what the backend holds
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "get v1", "save v1 a,b,c"]);
  s = store.getSnapshot();
  assert.deepEqual(s.saved?.items, ["a", "b", "c"]);

  // the keepalive request was lost: the list on the card saves itself again
  const lost = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(lost.store);
  lost.store.move("b", -1);
  lost.page().unload();
  lost.page().restored();
  await tick();
  await tick();
  assert.equal(lost.store.getSnapshot().dirty, true);
  await wait(lost.clock, 2000);
  assert.deepEqual(lost.backend.calls, ["get v1", "get v1", "save v1 b,a,c"]);
});

test("another tab deleting the list: a save waiting here never brings it back, and the card says it was deleted", async () => {
  const { store, backend, clock, page, local } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.move("c", -2);
  backend.fail.save = new TypeError("Failed to fetch");
  await wait(clock, 2000);
  assert.deepEqual(clock.waiting(), [5000], "a retry waiting");
  backend.fail.save = undefined;
  // the other tab deletes (same backend, same localStorage)
  backend.lists.set("v1", { ...SAVED(["a", "b", "c"]), status: "deleted" });
  local.data.delete(RANKER_SAVED_KEY);
  page().deletedElsewhere();
  assert.deepEqual(clock.waiting(), [], "the retry is dropped at once");
  await tick();
  await tick();
  await wait(clock, 120000);
  const s = store.getSnapshot();
  assert.equal(s.saved, null);
  assert.deepEqual(s.draft, []);
  assert.equal(s.notice, "deleted");
  assert.equal(s.failure, null);
  assert.deepEqual(backend.calls, ["get v1", "save v1 c,a,b", "get v1"], "no save after the delete");
  assert.equal(backend.lists.get("v1")?.status, "deleted");
  assert.equal(local.data.has(RANKER_SAVED_KEY), false);

  // a save on its way when the other tab deleted: its reply no longer describes the card
  const racing = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(racing.store);
  racing.backend.ctl.hold = true;
  racing.store.add("d");
  await wait(racing.clock, 2000);
  racing.backend.lists.set("v1", { ...SAVED(["a", "b", "c"]), status: "deleted" });
  racing.page().deletedElsewhere();
  racing.backend.ctl.held.shift()!.resolve();
  racing.backend.lists.set("v1", { ...SAVED(["a", "b", "c"]), status: "deleted" }); // (the fake's save wrote over it)
  await tick();
  await tick();
  await wait(racing.clock, 60000);
  assert.equal(racing.store.getSnapshot().saved, null);
  assert.equal(racing.store.getSnapshot().lastSave, null, "not recorded as a save");
  assert.deepEqual(racing.backend.calls, ["get v1", "save v1 a,b,c,d", "get v1"]);
});

test("an odd reply is tried again three times, then waits for the next change; the hourly budget is tried again after the hour", async () => {
  const { store, backend, clock } = setup();
  await started(store);
  for (const k of ["a", "b", "c"]) store.add(k);
  backend.fail.save = { code: "PGRST202", status: 404, message: "Could not find the function" };
  await wait(clock, 2000);
  await wait(clock, 5000);
  await wait(clock, 15000);
  await wait(clock, 60000);
  let s = store.getSnapshot();
  assert.equal(backend.calls.length, 4);
  assert.deepEqual(s.failure, { action: "save", kind: "unknown", retrying: false });
  assert.deepEqual(clock.waiting(), []);
  await wait(clock, 3_600_000);
  assert.equal(backend.calls.length, 4, "no loop");
  backend.fail.save = undefined;
  store.add("d");
  await wait(clock, 2000);
  assert.equal(store.getSnapshot().failure, null);
  assert.equal(backend.calls.length, 5);

  // 14:00:00 + 2 s: refused by the connection's hourly budget; tried again once the hour turns (15:00:15), not before
  const hourly = setup();
  await started(hourly.store);
  for (const k of ["a", "b", "c"]) hourly.store.add(k);
  hourly.backend.fail.save = { code: "PT429", hint: "rate_connection", message: "Lots of lists were saved from this connection in the last hour. Try again later." };
  await wait(hourly.clock, 2000);
  s = hourly.store.getSnapshot();
  assert.deepEqual(s.failure, { action: "save", kind: "rate_connection", retrying: true });
  assert.deepEqual(hourly.clock.waiting(), [3_600_000 - 2000 + 15_000]);
  hourly.page().online(); // back online doesn't hurry a rate limit
  await tick();
  assert.equal(hourly.backend.calls.length, 1);
  hourly.backend.fail.save = undefined;
  await wait(hourly.clock, 3_600_000 - 2000 + 15_000);
  assert.equal(hourly.backend.calls.length, 2);
  assert.equal(hourly.store.getSnapshot().failure, null);
  assert.deepEqual(hourly.store.getSnapshot().saved?.items, ["a", "b", "c"]);
});

test("each save is handed out once (ranking_saved): one that lands while no ranker listens is taken by the next", async () => {
  const { store, clock } = setup();
  await started(store);
  assert.equal(store.takeSave(), null);
  for (const k of ["a", "b", "c"]) store.add(k);
  await wait(clock, 2000); // landed with no ranker mounted (the visitor followed a link within the pause)
  assert.deepEqual(store.takeSave(), { seq: 1, length: 3, edited: false }, "the next ranker tracks the list's first save");
  assert.equal(store.takeSave(), null, "never twice");
  store.add("d");
  await wait(clock, 2000);
  store.add("e");
  await wait(clock, 2000);
  assert.deepEqual(store.takeSave(), { seq: 3, length: 5, edited: true }, "only the latest of those not yet handed out");
  assert.equal(store.takeSave(), null);
});

test("delete asks first, waits for a save on its way, then withdraws the list and starts an empty one (nothing saves after it)", async () => {
  const { store, backend, local, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c", "d"]) });
  await started(store);
  assert.equal(local.data.get(RANKER_SAVED_KEY), "1");
  store.askDelete();
  assert.equal(store.getSnapshot().confirmDelete, true);
  store.keepList();
  assert.equal(store.getSnapshot().confirmDelete, false);

  backend.fail.del = new TypeError("Failed to fetch");
  store.askDelete();
  assert.equal(await store.deleteList(), null);
  assert.deepEqual(store.getSnapshot().failure, { action: "delete", kind: "network" });
  assert.equal(store.getSnapshot().saved?.items.length, 4, "still saved");
  backend.fail.del = undefined;

  // a change on its way: the delete waits for it, and the change waiting after it is dropped
  backend.ctl.hold = true;
  store.add("e");
  await wait(clock, 2000);
  store.remove("a");
  const deleting = store.deleteList();
  assert.equal(store.getSnapshot().busy, "deleting");
  backend.ctl.held.shift()!.resolve();
  assert.equal(await deleting, 5);
  await wait(clock, 10000);
  const s = store.getSnapshot();
  assert.equal(s.saved, null);
  assert.deepEqual(s.draft, []);
  assert.equal(s.notice, "deleted");
  assert.equal(s.saving, false);
  assert.equal(local.data.has(RANKER_SAVED_KEY), false);
  assert.deepEqual(backend.calls, ["get v1", "del v1", "save v1 a,b,c,d,e", "del v1"]);
});

test("a delete that fails keeps the change it held back: it saves itself, and 'Keep it' clears the failure", async () => {
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.move("b", -1);
  store.askDelete();
  backend.fail.del = new TypeError("Failed to fetch");
  assert.equal(await store.deleteList(), null);
  assert.deepEqual(store.getSnapshot().failure, { action: "delete", kind: "network" });
  assert.equal(store.getSnapshot().saving, true, "the change is waiting again");
  store.keepList();
  assert.equal(store.getSnapshot().failure, null);
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "del v1", "save v1 b,a,c"]);
  assert.deepEqual(store.getSnapshot().saved?.items, ["b", "a", "c"]);
  page().unload();
  assert.deepEqual(backend.unload, [], "nothing left to send");
});

test("a voided list can't be deleted: the card keeps showing it and says so, never 'Your list was deleted.'", async () => {
  const saved = SAVED(["a", "b", "c"], { status: "void", inBoard: false });
  const { store, backend, local } = setup({ voter: "v1", saved });
  await started(store);
  assert.equal(store.getSnapshot().saved?.status, "void");
  assert.equal(store.getSnapshot().saving, false, "a void list as it is isn't sent again");
  store.askDelete();
  assert.equal(await store.deleteList(), null, "nothing was withdrawn");
  const s = store.getSnapshot();
  assert.equal(s.saved?.status, "void");
  assert.deepEqual(s.saved?.items, ["a", "b", "c"]);
  assert.equal(s.busy, null);
  assert.equal(s.confirmDelete, false);
  assert.notEqual(s.notice, "deleted");
  assert.deepEqual(s.failure, { action: "delete", kind: "not_deleted" });
  assert.equal(local.data.get(RANKER_SAVED_KEY), "1", "the next visit still shows it");
  assert.deepEqual(backend.calls, ["get v1", "del v1", "get v1"]);

  // a list deleted elsewhere meanwhile (another tab): there is nothing left, so it is gone here too
  const other = setup({ voter: "v2", saved: { ...saved, status: "active" } });
  await started(other.store);
  other.backend.lists.set("v2", { ...saved, status: "deleted" });
  assert.equal(await other.store.deleteList(), 3);
  assert.equal(other.store.getSnapshot().notice, "deleted");
  assert.equal(other.store.getSnapshot().saved, null);
});

test("a list replaced from this connection isn't sent again just by opening the page: only after a change, or 'Count it again'", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"], { status: "replaced", inBoard: false }) });
  await started(store);
  let s = store.getSnapshot();
  assert.equal(s.saved?.status, "replaced");
  assert.equal(s.saving, false, "the connection's other browser keeps its counted list");
  await wait(clock, 60000);
  assert.deepEqual(backend.calls, ["get v1"]);
  // a delete asked for meanwhile sends no save either
  store.askDelete();
  store.keepList();
  await wait(clock, 5000);
  assert.deepEqual(backend.calls, ["get v1"]);

  store.countAgain();
  await tick();
  await tick();
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c"], "'Count it again' saves it as it is, at once");
  s = store.getSnapshot();
  assert.equal(s.saved?.status, "active");
  assert.deepEqual(s.lastSave, { seq: 1, length: 3, edited: true });

  // a change counts it again too, even one that ends where it began
  const other = setup({ voter: "v2", saved: SAVED(["a", "b", "c"], { status: "replaced", inBoard: false }) });
  await started(other.store);
  other.store.moveTo("c", 0);
  other.store.moveTo("c", 2);
  await wait(other.clock, 2000);
  assert.deepEqual(other.backend.calls, ["get v2", "save v2 a,b,c"]);
  await wait(other.clock, 60000);
  assert.equal(other.backend.calls.length, 2, "once");
});

test("a deleted list on the backend is no list; a failed load says so, sends nothing, and can be tried again", async () => {
  const gone = setup({ voter: "v1", saved: SAVED(["a", "b", "c"], { status: "deleted" }) });
  await started(gone.store);
  assert.equal(gone.store.getSnapshot().saved, null);
  assert.deepEqual(gone.store.getSnapshot().draft, []);

  const failing = setup({ voter: "v2", saved: null, session: { [RANKER_DRAFT_KEY]: JSON.stringify({ items: ["a", "b", "c"] }) } });
  failing.backend.fail.get = new TypeError("Failed to fetch");
  await started(failing.store);
  assert.equal(failing.store.getSnapshot().mine, "error");
  await wait(failing.clock, 5000);
  assert.deepEqual(failing.backend.calls, ["get v2"], "no save before the saved list is known");
  failing.backend.fail.get = undefined;
  await failing.store.loadMine();
  assert.equal(failing.store.getSnapshot().mine, "ready");
  await wait(failing.clock, 2000);
  assert.deepEqual(failing.backend.calls, ["get v2", "get v2", "save v2 a,b,c"], "then the list from this session saves itself");
});

test("a burger no longer on the Burger Index stops the autosave until it is removed", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "retired"]) });
  await started(store);
  store.add("c");
  assert.equal(store.getSnapshot().problem, "gone");
  await wait(clock, 5000);
  assert.deepEqual(backend.calls, ["get v1"]);
  store.remove("retired");
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c"]);
});

test("the burgers failing to load can be tried again; storage that throws never breaks the store", async () => {
  let attempts = 0;
  const throwing: KeyValueStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const store = createRankerStore({
    loadMenus: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return MENUS;
    },
    api: fakeApi().api,
    voter: { read: () => null, get: () => "v" },
    local: () => throwing,
    session: () => {
      throw new Error("no storage");
    },
    timers: fakeTimers().timers,
  });
  await started(store);
  assert.equal(store.getSnapshot().menus, "error");
  await store.loadMenus();
  assert.equal(store.getSnapshot().menus, "ready");
  assert.equal(store.getSnapshot().burgers.size, 5);
  store.add("a");
  assert.deepEqual(store.getSnapshot().draft, ["a"]);
});

test("a restaurant page's add: waits for the burgers and the saved list, then adds once at the end", async () => {
  // A new browser: the add waits for the burgers, then starts the list.
  let release: (v: unknown) => void = () => {};
  const slow = setup({ menus: () => new Promise((r) => (release = r)) });
  slow.store.start();
  slow.store.addFromLink("c");
  assert.deepEqual(slow.store.getSnapshot().draft, [], "not before the burgers are known");
  assert.equal(slow.store.getSnapshot().linkAdd, null);
  release(MENUS);
  await tick();
  let s = slow.store.getSnapshot();
  assert.deepEqual(s.draft, ["c"]);
  assert.deepEqual(s.linkAdd, { key: "c", kind: "added", position: 1 });
  assert.equal(slow.session.data.get(RANKER_DRAFT_KEY), JSON.stringify({ items: ["c"] }), "kept for this session like any add");
  // the same link again: already there, nothing added
  slow.store.addFromLink("c");
  s = slow.store.getSnapshot();
  assert.deepEqual(s.draft, ["c"]);
  assert.deepEqual(s.linkAdd, { key: "c", kind: "already", position: 1 });
  // the next change clears the line
  slow.store.add("a");
  assert.equal(slow.store.getSnapshot().linkAdd, null);
  // not a menu key, or a burger the Burger Index doesn't have
  slow.store.addFromLink("Not a key");
  assert.equal(slow.store.getSnapshot().linkAdd, null);
  slow.store.addFromLink("zzz");
  assert.deepEqual(slow.store.getSnapshot().linkAdd, { key: "zzz", kind: "gone" });
  assert.deepEqual(slow.store.getSnapshot().draft, ["c", "a"]);
});

test("a restaurant page's add to a saved list: it waits for the list, then saves itself like any add", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  store.start();
  store.addFromLink("d");
  assert.deepEqual(store.getSnapshot().draft, [], "not before the saved list has loaded");
  await tick();
  await tick();
  let s = store.getSnapshot();
  assert.deepEqual(s.draft, ["a", "b", "c", "d"]);
  assert.equal(s.dirty, true);
  assert.deepEqual(s.linkAdd, { key: "d", kind: "added", position: 4 });
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c,d"]);
  assert.deepEqual(store.getSnapshot().linkAdd, { key: "d", kind: "added", position: 4 }, "the line stays until the list next changes");
  // already on the saved list: says so, sends nothing
  store.addFromLink("b");
  s = store.getSnapshot();
  assert.deepEqual(s.linkAdd, { key: "b", kind: "already", position: 2 });
  await wait(clock, 5000);
  assert.equal(backend.calls.length, 2);
});

test("a restaurant page's add to a full list says so; a failed load waits for 'Try again'", async () => {
  const many = menuListData(Array.from({ length: 27 }, (_, i) => place({ id: `m${i}`, name: `M${i}`, price: 10, borough: "Queens", hood: "astoria" })));
  const full = Array.from({ length: 25 }, (_, i) => `m${i}`);
  const { store } = setup({ menus: async () => many, session: { [RANKER_DRAFT_KEY]: JSON.stringify({ items: full }) } });
  await started(store);
  store.addFromLink("m26");
  let s = store.getSnapshot();
  assert.equal(s.draft.length, 25);
  assert.deepEqual(s.linkAdd, { key: "m26", kind: "full" });

  let fails = true;
  const flaky = setup({ menus: async () => (fails ? Promise.reject(new Error("offline")) : MENUS) });
  await started(flaky.store);
  flaky.store.addFromLink("a");
  s = flaky.store.getSnapshot();
  assert.equal(s.menus, "error");
  assert.deepEqual(s.draft, [], "can't tell whether it is on the Burger Index yet");
  fails = false;
  await flaky.store.loadMenus();
  s = flaky.store.getSnapshot();
  assert.deepEqual(s.draft, ["a"]);
  assert.deepEqual(s.linkAdd, { key: "a", kind: "added", position: 1 });
});

test("a link's add is said once per outcome: a ranker that mounts again (a return to home) finds it already said", async () => {
  const { store } = setup();
  await started(store);
  store.addFromLink("c");
  const added = store.getSnapshot().linkAdd;
  assert.deepEqual(added, { key: "c", kind: "added", position: 1 });
  assert.equal(store.claimLinkAdd(added!), true, "the first ranker to ask says it (and tracks it)");
  assert.equal(store.claimLinkAdd(added!), false, "a remounted ranker, or the effect again: shown on the card, not said again");
  assert.deepEqual(store.getSnapshot().linkAdd, added, "the note stays on the card");
  // the same link again is a new outcome (already there): said once
  store.addFromLink("c");
  const again = store.getSnapshot().linkAdd;
  assert.deepEqual(again, { key: "c", kind: "already", position: 1 });
  assert.equal(store.claimLinkAdd(added!), false, "an outcome no longer current is never said");
  assert.equal(store.claimLinkAdd(again!), true);
  assert.equal(store.claimLinkAdd(again!), false);
  // a change clears the note: nothing left to say
  store.add("a");
  assert.equal(store.getSnapshot().linkAdd, null);
  assert.equal(store.claimLinkAdd(again!), false);
});
