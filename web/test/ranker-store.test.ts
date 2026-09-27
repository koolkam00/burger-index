import assert from "node:assert/strict";
import { test } from "node:test";
import { menuListData } from "../src/lib/menu-list";
import { autosaveLine, saveFailureLine, type SavedRanking, type SaveReply } from "../src/lib/ranker";
import { createRankerStore, parseDraft, parseStoredDraft, RANKER_DRAFT_KEY, RECHECK_DELAY, type KeyValueStorage, type PageEvents, type RankerApi, type RankerStore, type Timers } from "../src/lib/ranker-store";
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
    /** Move the clock without running any timer (a page frozen in the back-forward cache). */
    skip(ms: number) {
      now += ms;
    },
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
  // hold: saves wait for the test; holdGet / holdDel: gets (answering with the list as it was when asked) and deletes too
  const ctl = { hold: false, held: [] as Deferred[], holdGet: false, heldGets: [] as (() => void)[], holdDel: false, heldDels: [] as (() => void)[] };
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
      const now = lists.get(voter) ?? null;
      if (ctl.holdGet) await new Promise<void>((resolve) => ctl.heldGets.push(resolve));
      return now;
    },
    // like delete_ranking: only an active or replaced list is withdrawn (a void one stays void)
    async del(voter) {
      calls.push(`del ${voter}`);
      if (ctl.holdDel) await new Promise<void>((resolve) => ctl.heldDels.push(resolve));
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
  const make = () =>
    createRankerStore({
      loadMenus: opts.menus ?? (async () => MENUS),
      api: backend.api,
      voter: { read: () => voter, get: () => (voter ??= "new-voter") },
      local: () => local,
      session: () => session,
      timers: clock.timers,
      now: clock.now,
      watchPage: (on) => void (page = on),
    });
  const store = make();
  /** The tab reopened (a reload, or a closed tab brought back): a new store on the same session, storage and backend. */
  const reopen = () => make();
  return { store, backend, local, session, clock, voterId: () => voter, page: () => page!, reopen };
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
  assert.deepEqual(parseStoredDraft(session.data.get(RANKER_DRAFT_KEY) ?? null), { items: ["c", "a", "b"], base: null, sent: [] }, "kept for this session until saved");

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
  assert.ok(local.data.get(RANKER_SAVED_KEY), "the next page load knows there is a saved list");
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
  assert.deepEqual(
    parseStoredDraft(session.data.get(RANKER_DRAFT_KEY) ?? null),
    { items: ["a", "b", "c", "d"], base: ["a", "b", "c"], sent: [["a", "b", "c", "d"]] },
    "a reload shows (and saves) it if the request was lost",
  );
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
  assert.equal(s.notice, "deleted_elsewhere", "another tab's delete");
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
  // an odd reply may hide a list the backend saved: once no try is left, the saved list is asked for
  assert.deepEqual(backend.calls, ["save new-voter a,b,c", "save new-voter a,b,c", "save new-voter a,b,c", "save new-voter a,b,c", "get new-voter"]);
  assert.deepEqual(s.failure, { action: "save", kind: "unknown", retrying: false });
  assert.deepEqual(clock.waiting(), []);
  await wait(clock, 3_600_000);
  assert.equal(backend.calls.length, 5, "no loop");
  backend.fail.save = undefined;
  store.add("d");
  await wait(clock, 2000);
  assert.equal(store.getSnapshot().failure, null);
  assert.equal(backend.calls.length, 6);

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
  assert.ok(local.data.get(RANKER_SAVED_KEY));
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
  assert.deepEqual(backend.calls, ["get v1", "del v1", "get v1", "save v1 a,b,c,d,e", "del v1"], "a failed delete checks the list: it may have gone through");
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
  assert.deepEqual(backend.calls, ["get v1", "del v1", "get v1", "save v1 b,a,c"]);
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
  assert.ok(local.data.get(RANKER_SAVED_KEY), "the next visit still shows it");
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
  assert.deepEqual(parseDraft(slow.session.data.get(RANKER_DRAFT_KEY) ?? null), ["c"], "kept for this session like any add");
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

// ---- the second review's cases (2026-09-27) ----------------------------------------------------------------

const settled = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

test("another tab's delete while a save is on its way: the check waits for that save, so the card says what the backend holds", async () => {
  const { store, backend, clock, page, local } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.hold = true;
  store.add("d");
  await wait(clock, 2000);
  backend.lists.set("v1", { ...SAVED(["a", "b", "c"]), status: "deleted" });
  local.data.delete(RANKER_SAVED_KEY);
  page().deletedElsewhere();
  await settled();
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c,d"], "no check before the save on its way has landed");
  backend.ctl.held.shift()!.resolve(); // the backend handled the save after the delete: the list is active again
  await settled();
  const s = store.getSnapshot();
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c,d", "get v1"]);
  assert.deepEqual(s.saved?.items, ["a", "b", "c", "d"], "the card shows the list that counts, not 'deleted'");
  assert.equal(s.notice, null);
  assert.ok(local.data.get(RANKER_SAVED_KEY));
});

test("another tab's delete while a first list is on its way: the check waits for it, and a change made meanwhile saves after", async () => {
  const { store, backend, clock, page, local } = setup();
  await started(store);
  backend.ctl.hold = true;
  for (const k of ["a", "b", "c"]) store.add(k);
  await wait(clock, 2000); // on its way (and the voter id made)
  local.data.delete(RANKER_SAVED_KEY);
  page().deletedElsewhere(); // no saved list known here yet: the card waits for the save and asks the backend
  assert.deepEqual(store.getSnapshot().draft, ["a", "b", "c"]);
  store.move("c", -2);
  await wait(clock, 2000); // nothing goes while the saved list is being checked
  assert.deepEqual(backend.calls, ["save new-voter a,b,c"]);
  backend.ctl.hold = false;
  backend.ctl.held.shift()!.resolve(); // it landed after the other tab's delete: the backend holds it
  await settled();
  let s = store.getSnapshot();
  assert.equal(s.mine, "ready");
  assert.deepEqual(s.saved?.items, ["a", "b", "c"], "the card says what the backend holds, never 'deleted' over a list that counts");
  assert.equal(s.notice, null);
  assert.deepEqual(s.draft, ["c", "a", "b"], "the change made meanwhile stays");
  await wait(clock, 2000);
  s = store.getSnapshot();
  assert.deepEqual(backend.calls, ["save new-voter a,b,c", "get new-voter", "save new-voter c,a,b"]);
  assert.deepEqual(s.saved?.items, ["c", "a", "b"]);
  assert.equal(s.saving, false);
  assert.ok(local.data.get(RANKER_SAVED_KEY));

  // the other tab deleted it after it landed: the card empties, and nothing brings it back
  const gone = setup();
  await started(gone.store);
  gone.backend.ctl.hold = true;
  for (const k of ["a", "b", "c"]) gone.store.add(k);
  await wait(gone.clock, 2000);
  gone.backend.ctl.held.shift()!.resolve();
  gone.backend.lists.set("new-voter", { ...SAVED(["a", "b", "c"]), status: "deleted" }); // deleted before its reply got here
  gone.local.data.delete(RANKER_SAVED_KEY);
  gone.page().deletedElsewhere();
  await settled();
  await wait(gone.clock, 60000);
  s = gone.store.getSnapshot();
  assert.equal(s.saved, null);
  assert.deepEqual(s.draft, []);
  assert.equal(s.notice, "deleted_elsewhere");
  assert.deepEqual(gone.backend.calls, ["save new-voter a,b,c", "get new-voter"]);
  assert.equal(gone.local.data.has(RANKER_SAVED_KEY), false);
});

test("back from the back-forward cache with a save that couldn't reach the counter: its retry comes back, or it is done if the keepalive landed", async () => {
  // the keepalive request was lost: the retry goes again
  const lost = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(lost.store);
  lost.store.move("b", -1);
  lost.backend.fail.save = new TypeError("Failed to fetch");
  await wait(lost.clock, 2000);
  assert.deepEqual(lost.clock.waiting(), [5000]);
  lost.page().unload();
  assert.deepEqual(lost.backend.unload, ["v1 b,a,c"], "a network retry goes as a keepalive request");
  lost.page().restored();
  await settled();
  assert.deepEqual(lost.clock.waiting(), [5000], "the retry is armed again");
  lost.backend.fail.save = undefined;
  await wait(lost.clock, 5000);
  let s = lost.store.getSnapshot();
  assert.deepEqual(lost.backend.calls, ["get v1", "save v1 b,a,c", "get v1", "save v1 b,a,c"]);
  assert.equal(s.failure, null);
  assert.deepEqual(s.saved?.items, ["b", "a", "c"]);

  // the keepalive request landed: no failure left, nothing more sent
  const landed = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(landed.store);
  landed.store.move("b", -1);
  landed.backend.fail.save = new TypeError("Failed to fetch");
  await wait(landed.clock, 2000);
  landed.page().unload();
  landed.backend.lists.set("v1", SAVED(["b", "a", "c"], { inBoard: false }));
  landed.page().restored();
  await settled();
  s = landed.store.getSnapshot();
  assert.equal(s.failure, null);
  assert.equal(s.saving, false);
  assert.deepEqual(landed.clock.waiting(), []);
  assert.deepEqual(landed.backend.calls, ["get v1", "save v1 b,a,c", "get v1"]);

  // the hourly budget: nothing at close, and after the return it still goes once the hour turns
  const hourly = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(hourly.store);
  hourly.store.move("b", -1);
  hourly.backend.fail.save = { code: "PT429", hint: "rate_connection", message: "…" };
  await wait(hourly.clock, 2000);
  hourly.page().unload();
  assert.deepEqual(hourly.backend.unload, [], "a refusal's retry waits for the hour, even at close");
  hourly.page().restored();
  await settled();
  assert.deepEqual(hourly.clock.waiting(), [3_600_000 - 2000 + 15_000]);
  hourly.backend.fail.save = undefined;
  await wait(hourly.clock, 3_600_000 - 2000 + 15_000);
  assert.deepEqual(hourly.backend.calls, ["get v1", "save v1 b,a,c", "get v1", "save v1 b,a,c"]);
  assert.equal(hourly.store.getSnapshot().failure, null);
});

test("back from the back-forward cache, a list replaced since it was saved here isn't sent again without a new change", async () => {
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.move("b", -1);
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c"]);
  backend.lists.set("v1", SAVED(["b", "a", "c"], { status: "replaced", inBoard: false })); // the connection's other browser saved
  page().unload();
  page().restored();
  await settled();
  await wait(clock, 60000);
  const s = store.getSnapshot();
  assert.equal(s.saved?.status, "replaced");
  assert.equal(s.saving, false);
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c", "get v1"], "the other browser keeps its counted list");
  store.move("c", -1); // a change made now counts it again
  await wait(clock, 2000);
  assert.deepEqual(backend.calls.at(-1), "save v1 b,c,a");
});

test("back from the back-forward cache after a first list went only as a keepalive request: it is checked, and saved if it didn't land", async () => {
  const lost = setup();
  await started(lost.store);
  for (const k of ["a", "b", "c"]) lost.store.add(k);
  lost.page().unload();
  assert.deepEqual(lost.backend.unload, ["new-voter a,b,c"]);
  lost.page().restored();
  await settled();
  await wait(lost.clock, 2000);
  let s = lost.store.getSnapshot();
  assert.deepEqual(lost.backend.calls, ["get new-voter", "save new-voter a,b,c"]);
  assert.equal(s.mine, "ready");
  assert.deepEqual(s.saved?.items, ["a", "b", "c"]);

  const landed = setup();
  await started(landed.store);
  for (const k of ["a", "b", "c"]) landed.store.add(k);
  landed.page().unload();
  landed.backend.lists.set("new-voter", SAVED(["a", "b", "c"], { inBoard: false }));
  landed.page().restored();
  await settled();
  await wait(landed.clock, 5000);
  s = landed.store.getSnapshot();
  assert.deepEqual(landed.backend.calls, ["get new-voter"]);
  assert.equal(s.mine, "ready");
  assert.deepEqual(s.draft, ["a", "b", "c"]);
  assert.equal(s.dirty, false, "the card says it is saved");
});

test("a change back to the saved list while a different one is on its way survives a close and a reload", async () => {
  const { store, backend, clock, page, session } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.hold = true;
  store.move("b", -1);
  await wait(clock, 2000); // b,a,c on its way
  store.move("b", 1); // back to a,b,c
  assert.deepEqual(
    parseStoredDraft(session.data.get(RANKER_DRAFT_KEY) ?? null),
    { items: ["a", "b", "c"], base: ["a", "b", "c"], sent: [["b", "a", "c"]] },
    "kept: the backend is about to hold b,a,c",
  );
  page().unload();
  assert.deepEqual(backend.unload, ["v1 a,b,c"], "the visitor's last list goes at close");
});

test("a delete confirmed while the saved list is being checked: the check's late answer never brings the list back", async () => {
  const { store, backend, page, local } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.holdGet = true;
  page().restored();
  await settled();
  store.askDelete();
  backend.ctl.holdGet = false;
  assert.equal(await store.deleteList(), 3);
  backend.ctl.heldGets.shift()!(); // the check answers with the list as it was before the delete
  await settled();
  const s = store.getSnapshot();
  assert.equal(s.saved, null);
  assert.deepEqual(s.draft, []);
  assert.equal(s.notice, "deleted");
  assert.equal(local.data.has(RANKER_SAVED_KEY), false);
});

test("a failed delete never re-sends a refused list or hurries the hourly wait; 'Keep it' brings the refusal back", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.move("b", -1);
  backend.fail.save = { code: "PT429", hint: "rate_voter", message: "…" };
  await wait(clock, 2000);
  store.askDelete();
  backend.fail.del = new TypeError("Failed to fetch");
  assert.equal(await store.deleteList(), null);
  assert.deepEqual(store.getSnapshot().failure, { action: "delete", kind: "network" });
  assert.deepEqual(clock.waiting(), []);
  await wait(clock, 60000);
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c", "del v1", "get v1"]);
  store.keepList();
  assert.deepEqual(store.getSnapshot().failure, { action: "save", kind: "rate_voter", retrying: false });
  assert.deepEqual(clock.waiting(), []);

  const hourly = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(hourly.store);
  hourly.store.move("b", -1);
  hourly.backend.fail.save = { code: "PT429", hint: "rate_connection", message: "…" };
  await wait(hourly.clock, 2000);
  hourly.store.askDelete();
  hourly.backend.fail.del = new TypeError("Failed to fetch");
  assert.equal(await hourly.store.deleteList(), null);
  assert.deepEqual(hourly.clock.waiting(), [], "no 2 s pause in place of the hour");
  hourly.store.keepList();
  assert.deepEqual(hourly.store.getSnapshot().failure, { action: "save", kind: "rate_connection", retrying: true });
  assert.deepEqual(hourly.clock.waiting(), [3_600_000 - 2000 + 15_000]);
});

test("a restaurant page's add that arrives while a delete is on its way goes on the list after it", async () => {
  const { store, backend } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.askDelete();
  backend.ctl.holdDel = true;
  const deleting = store.deleteList();
  await settled();
  store.addFromLink("d");
  assert.deepEqual(store.getSnapshot().linkAdd, null, "it waits for the delete");
  backend.ctl.heldDels.shift()!();
  assert.equal(await deleting, 3);
  const s = store.getSnapshot();
  assert.deepEqual(s.draft, ["d"]);
  assert.deepEqual(s.linkAdd, { key: "d", kind: "added", position: 1 });
});

test("hiding or closing the page never hurries a refusal's or an odd reply's retry", async () => {
  const { store, backend, clock, page } = setup();
  await started(store);
  for (const k of ["a", "b", "c"]) store.add(k);
  backend.fail.save = { code: "PT429", hint: "rate_connection", message: "…" };
  await wait(clock, 2000);
  page().hidden();
  page().hidden();
  page().unload();
  await settled();
  assert.deepEqual(backend.calls, ["save new-voter a,b,c"]);
  assert.deepEqual(backend.unload, []);
  assert.deepEqual(clock.waiting(), [3_600_000 - 2000 + 15_000], "still waiting for the hour");

  const odd = setup();
  await started(odd.store);
  for (const k of ["a", "b", "c"]) odd.store.add(k);
  odd.backend.fail.save = { code: "PGRST202", status: 404, message: "Could not find the function" };
  await wait(odd.clock, 2000);
  for (let i = 0; i < 4; i++) odd.page().hidden();
  await settled();
  assert.equal(odd.backend.calls.length, 1, "its three tries keep their times");
  assert.deepEqual(odd.store.getSnapshot().failure, { action: "save", kind: "unknown", retrying: true });
});

test("a change made while the saved list is being checked is sent if the page closes before the answer (never after another tab's delete)", async () => {
  const { store, backend, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.holdGet = true;
  page().restored();
  store.move("b", -1);
  page().hidden();
  page().unload();
  assert.deepEqual(backend.unload, ["v1 b,a,c"]);

  const other = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(other.store);
  other.backend.ctl.holdGet = true;
  other.page().deletedElsewhere();
  other.store.move("b", -1);
  other.page().unload();
  assert.deepEqual(other.backend.unload, [], "it could bring the deleted list back");
});

// ---- round-3 review fixes ------------------------------------------------------------------------------

test("a network failure whose list a keepalive request landed is done: no 'Trying again soon.' left up, and a replaced list offers 'Count it again'", async () => {
  // a first list
  const first = setup();
  await started(first.store);
  for (const k of ["a", "b", "c"]) first.store.add(k);
  first.backend.fail.save = new TypeError("Failed to fetch");
  await wait(first.clock, 2000);
  first.page().unload();
  assert.deepEqual(first.backend.unload, ["new-voter a,b,c"]);
  first.backend.fail.save = undefined;
  first.backend.lists.set("new-voter", SAVED(["a", "b", "c"], { inBoard: false })); // it landed
  first.page().restored();
  await settled();
  let s = first.store.getSnapshot();
  assert.equal(s.failure, null);
  assert.equal(s.saving, false);
  assert.deepEqual(s.saved?.items, ["a", "b", "c"]);
  assert.deepEqual(first.clock.waiting(), []);
  await wait(first.clock, 3_600_000);
  assert.deepEqual(first.backend.calls, ["save new-voter a,b,c", "get new-voter"]);

  // a changed list whose keepalive landed and was then replaced from this connection
  const replaced = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(replaced.store);
  replaced.store.move("b", -1);
  replaced.backend.fail.save = new TypeError("Failed to fetch");
  await wait(replaced.clock, 2000);
  replaced.page().unload();
  replaced.backend.fail.save = undefined;
  replaced.backend.lists.set("v1", SAVED(["b", "a", "c"], { status: "replaced", inBoard: false }));
  replaced.page().restored();
  await settled();
  s = replaced.store.getSnapshot();
  assert.equal(s.failure, null, "the status line says 'Not counted: …' and 'Count it again' shows");
  assert.equal(s.saved?.status, "replaced");
  assert.equal(s.dirty, false);
  assert.equal(s.saving, false);
  await wait(replaced.clock, 60000);
  assert.deepEqual(replaced.backend.calls, ["get v1", "save v1 b,a,c", "get v1"]);
});

test("the hourly refusal of a save that lands while a delete or a check holds saves keeps its wait for the hour", async () => {
  // a delete confirmed while the save was on its way, and the delete fails
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.hold = true;
  store.move("b", -1);
  await wait(clock, 2000);
  store.askDelete();
  backend.fail.del = new TypeError("Failed to fetch");
  const deleting = store.deleteList();
  backend.ctl.held.shift()!.reject({ code: "PT429", hint: "rate_connection", message: "…" });
  assert.equal(await deleting, null);
  assert.deepEqual(clock.waiting(), [], "no 2 s pause in place of the hour");
  await wait(clock, 60000);
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c", "del v1", "get v1"]);
  store.keepList();
  assert.deepEqual(store.getSnapshot().failure, { action: "save", kind: "rate_connection", retrying: true });
  assert.deepEqual(clock.waiting(), [3_600_000 - 62_000 + 15_000]);

  // back from the back-forward cache while the save was on its way
  const back = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(back.store);
  back.backend.ctl.hold = true;
  back.store.move("b", -1);
  await wait(back.clock, 2000);
  back.page().restored();
  back.backend.ctl.held.shift()!.reject({ code: "PT429", hint: "rate_connection", message: "…" });
  await settled();
  assert.deepEqual(back.store.getSnapshot().failure, { action: "save", kind: "rate_connection", retrying: true });
  assert.deepEqual(back.clock.waiting(), [3_600_000 - 2000 + 15_000]);
  await wait(back.clock, 60000);
  assert.deepEqual(back.backend.calls, ["get v1", "save v1 b,a,c", "get v1"], "not sent again before the hour");
});

test("'Count it again' pressed while the saved list is being checked is kept: it saves once the answer is in", async () => {
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"], { status: "replaced", inBoard: false }) });
  await started(store);
  backend.ctl.holdGet = true;
  page().restored();
  await settled();
  store.countAgain();
  backend.ctl.holdGet = false;
  backend.ctl.heldGets.shift()!();
  await settled();
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "get v1", "save v1 a,b,c"]);
  assert.equal(store.getSnapshot().saved?.status, "active");
});

test("'Count it again' refused by a daily limit: said as such, and it can be pressed again", async () => {
  const { store, backend } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"], { status: "replaced", inBoard: false }) });
  await started(store);
  backend.fail.save = { code: "PT429", hint: "rate_voter", message: "…" };
  store.countAgain();
  await settled();
  let s = store.getSnapshot();
  assert.deepEqual(s.failure, { action: "save", kind: "rate_voter", retrying: false });
  assert.equal(s.saved?.status, "replaced");
  assert.equal(s.dirty, false);
  assert.equal(
    autosaveLine({ length: 3, saved: s.saved, dirty: s.dirty, saving: s.saving, failure: s.failure, problem: s.problem, deleted: false, menusFailed: false }, "2026-09-27").text,
    "Not counted: a newer list was saved from this connection. You've saved your list a lot today: count it again tomorrow.",
  );
  // the live region says the same words (never "your changes")
  assert.equal(saveFailureLine(s.failure!, s.saved, s.dirty), "Not counted: a newer list was saved from this connection. You've saved your list a lot today: count it again tomorrow.");
  backend.fail.save = undefined;
  store.countAgain();
  assert.equal(store.getSnapshot().failure, null, "pressed again: the refusal goes while it is on its way");
  await settled();
  s = store.getSnapshot();
  assert.equal(s.saved?.status, "active");
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c", "save v1 a,b,c"]);
});

test("another tab's delete while this browser's saved list is loading: the list from this session never brings it back", async () => {
  const { store, backend, clock, page, local } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]), session: { [RANKER_DRAFT_KEY]: JSON.stringify({ items: ["c", "b", "a"] }) } });
  backend.ctl.holdGet = true;
  await started(store);
  assert.equal(store.getSnapshot().mine, "loading");
  backend.lists.set("v1", { ...SAVED(["a", "b", "c"]), status: "deleted" });
  local.data.delete(RANKER_SAVED_KEY);
  page().deletedElsewhere();
  backend.ctl.holdGet = false;
  backend.ctl.heldGets.shift()!(); // the load answers with the list as it was before the delete
  await settled();
  await wait(clock, 60000);
  const s = store.getSnapshot();
  assert.equal(s.mine, "ready");
  assert.equal(s.saved, null);
  assert.deepEqual(s.draft, []);
  assert.equal(s.notice, "deleted_elsewhere");
  assert.deepEqual(backend.calls, ["get v1", "get v1"], "no save");
  assert.equal(backend.lists.get("v1")?.status, "deleted");
  assert.equal(local.data.has(RANKER_SAVED_KEY), false);
});

test("back from the back-forward cache, a newer list saved in another tab shows: the card's older list is never sent over it", async () => {
  // a clean card
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  page().unload();
  assert.deepEqual(backend.unload, []);
  backend.lists.set("v1", SAVED(["c", "a", "b"], { inBoard: false })); // another tab saved
  page().restored();
  await settled();
  await wait(clock, 60000);
  let s = store.getSnapshot();
  assert.deepEqual(s.draft, ["c", "a", "b"]);
  assert.deepEqual(s.saved?.items, ["c", "a", "b"]);
  assert.equal(s.dirty, false);
  assert.equal(s.notice, "updated_elsewhere", "the card says it shows another tab's list");
  assert.deepEqual(backend.calls, ["get v1", "get v1"]);
  assert.deepEqual(backend.lists.get("v1")?.items, ["c", "a", "b"]);

  // a first list whose keepalive landed and was changed in another tab since
  const first = setup();
  await started(first.store);
  for (const k of ["a", "b", "c"]) first.store.add(k);
  first.page().unload();
  assert.deepEqual(first.backend.unload, ["new-voter a,b,c"]);
  first.backend.lists.set("new-voter", SAVED(["c", "b", "a"], { inBoard: false }));
  first.page().restored();
  await settled();
  await wait(first.clock, 60000);
  s = first.store.getSnapshot();
  assert.deepEqual(s.draft, ["c", "b", "a"]);
  assert.equal(s.dirty, false);
  assert.deepEqual(first.backend.calls, ["get new-voter"]);

  // a change made while the check runs is the visitor's newest: it stays and saves
  const edited = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(edited.store);
  edited.backend.ctl.holdGet = true;
  edited.page().restored();
  await settled();
  edited.store.move("b", -1);
  edited.backend.lists.set("v1", SAVED(["c", "a", "b"], { inBoard: false }));
  edited.backend.ctl.holdGet = false;
  edited.backend.ctl.heldGets.shift()!();
  await settled();
  await wait(edited.clock, 2000);
  assert.deepEqual(edited.backend.calls.at(-1), "save v1 b,a,c");
});

test("the burgers failing to load: a change says it waits for them, and saves once they load", async () => {
  let fail = true;
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]), menus: async () => (fail ? Promise.reject(new TypeError("Failed to fetch")) : MENUS) });
  await started(store);
  store.move("b", -1);
  let s = store.getSnapshot();
  assert.equal(s.menus, "error");
  const line = () =>
    autosaveLine({ length: s.draft.length, saved: s.saved, dirty: s.dirty, saving: s.saving, failure: null, problem: s.problem, deleted: false, menusFailed: s.menus === "error" }, "2026-09-27").text;
  assert.equal(line(), "Your changes save once the burgers load.");
  fail = false;
  await store.loadMenus();
  s = store.getSnapshot();
  assert.equal(line(), "Saving…");
  await wait(clock, 2000);
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c"]);
});

test("a failed load of the saved list keeps this session's unsaved list: 'Try again' shows and saves it", async () => {
  const { store, backend, clock, session } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]), session: { [RANKER_DRAFT_KEY]: JSON.stringify({ items: ["c", "b", "a"] }) } });
  backend.fail.get = new TypeError("Failed to fetch");
  await started(store);
  assert.equal(store.getSnapshot().mine, "error");
  assert.ok(session.data.has(RANKER_DRAFT_KEY));
  backend.fail.get = undefined;
  await store.loadMine();
  await settled();
  let s = store.getSnapshot();
  assert.deepEqual(s.draft, ["c", "b", "a"]);
  assert.equal(s.dirty, true);
  assert.ok(session.data.has(RANKER_DRAFT_KEY), "kept until it is saved");
  await wait(clock, 2000);
  s = store.getSnapshot();
  assert.deepEqual(backend.calls, ["get v1", "get v1", "save v1 c,b,a"]);
  assert.deepEqual(s.saved?.items, ["c", "b", "a"]);
  assert.equal(s.dirty, false);
});

test("back from the back-forward cache, this tab's own save still on its way isn't taken for another tab's list", async () => {
  for (const keepaliveLanded of [false, true]) {
    // saved a,b,c; D = c,a,b on its way; E = a,c,b made meanwhile goes as a keepalive request at close
    const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
    await started(store);
    backend.ctl.hold = true;
    store.move("c", -2);
    await wait(clock, 2000);
    store.move("a", -1);
    assert.deepEqual(store.getSnapshot().draft, ["a", "c", "b"]);
    page().hidden();
    page().unload();
    assert.deepEqual(backend.unload, ["v1 a,c,b"]);
    if (keepaliveLanded) backend.lists.set("v1", SAVED(["a", "c", "b"], { inBoard: false }));
    page().restored();
    await settled();
    backend.ctl.hold = false;
    backend.ctl.held.shift()!.resolve(); // D lands (after the keepalive, when it landed)
    await settled();
    await wait(clock, 2000);
    const s = store.getSnapshot();
    assert.deepEqual(s.draft, ["a", "c", "b"], "the change made after D stays on the card");
    assert.notEqual(s.notice, "updated_elsewhere");
    assert.deepEqual(backend.calls, ["get v1", "save v1 c,a,b", "get v1", "save v1 a,c,b"]);
    assert.deepEqual(backend.lists.get("v1")?.items, ["a", "c", "b"]);
    assert.equal(s.dirty, false);
  }

  // a first list: D = a,b,c on its way (it made the voter id), E = c,a,b at close; the backend handled D before the check
  const first = setup();
  await started(first.store);
  first.backend.ctl.hold = true;
  for (const k of ["a", "b", "c"]) first.store.add(k);
  await wait(first.clock, 2000);
  first.store.move("c", -2);
  first.page().unload();
  assert.deepEqual(first.backend.unload, ["new-voter c,a,b"]);
  first.backend.lists.set("new-voter", SAVED(["a", "b", "c"], { inBoard: false }));
  first.backend.ctl.holdGet = true;
  first.page().restored();
  await settled();
  first.backend.ctl.hold = false;
  first.backend.ctl.held.shift()!.resolve(); // D's reply arrives before the check's
  await settled();
  first.backend.ctl.holdGet = false;
  first.backend.ctl.heldGets.shift()!();
  await settled();
  await wait(first.clock, 2000);
  const s = first.store.getSnapshot();
  assert.deepEqual(s.draft, ["c", "a", "b"]);
  assert.equal(s.notice, null);
  assert.deepEqual(first.backend.calls, ["save new-voter a,b,c", "get new-voter", "save new-voter c,a,b"]);
  assert.deepEqual(first.backend.lists.get("new-voter")?.items, ["c", "a", "b"]);
});

test("back from the back-forward cache with a first list's retry waiting: a list another tab saved meanwhile shows, never overwritten", async () => {
  const kinds = [
    { kind: "unknown", err: { code: "XX000", status: 500, message: "Internal Server Error" } },
    { kind: "rate_connection", err: { code: "PT429", hint: "rate_connection", message: "…" } },
  ];
  for (const { kind, err } of kinds) {
    const { store, backend, clock, page } = setup();
    await started(store);
    backend.fail.save = err;
    for (const k of ["a", "b", "c"]) store.add(k);
    await wait(clock, 2000);
    assert.deepEqual(store.getSnapshot().failure, { action: "save", kind, retrying: true });
    page().unload();
    assert.deepEqual(backend.unload, [], `${kind}: its retry waits for its own time`);
    backend.lists.set("new-voter", SAVED(["c", "b", "a"], { inBoard: false })); // another tab, same voter id
    backend.fail.save = undefined;
    page().restored();
    await settled();
    await wait(clock, 3_700_000);
    const s = store.getSnapshot();
    assert.deepEqual(s.draft, ["c", "b", "a"], kind);
    assert.equal(s.failure, null, kind);
    assert.equal(s.dirty, false, kind);
    assert.equal(s.notice, "updated_elsewhere", kind);
    assert.deepEqual(backend.calls, ["save new-voter a,b,c", "get new-voter"], kind);
    assert.deepEqual(backend.lists.get("new-voter")?.items, ["c", "b", "a"], kind);
  }
});

test("an hourly refusal's retry keeps its time across the back-forward cache: due already, it goes at once", async () => {
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.move("b", -1);
  backend.fail.save = { code: "PT429", hint: "rate_connection", message: "…" };
  await wait(clock, 2000); // refused at 14:00:02: due at 15:00:15
  assert.deepEqual(clock.waiting(), [3_613_000]);
  page().unload();
  clock.skip(600_000); // 14:10:02, frozen: no timer ran
  page().restored();
  await settled();
  assert.deepEqual(clock.waiting(), [3_013_000], "the same time, not a new hour");
  page().unload();
  clock.skip(3_600_000); // 15:10:02: the hour has turned
  backend.fail.save = undefined;
  page().restored();
  await settled();
  assert.deepEqual(clock.waiting(), [0]);
  await wait(clock, 0);
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c", "get v1", "get v1", "save v1 b,a,c"]);
  assert.equal(store.getSnapshot().failure, null);
});

test("'Count it again' waiting for the hour: the card shows the saved list, so it isn't a change on its way", async () => {
  const { store, backend } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"], { status: "replaced", inBoard: false }) });
  await started(store);
  backend.fail.save = { code: "PT429", hint: "rate_connection", message: "…" };
  store.countAgain();
  let s = store.getSnapshot();
  assert.equal(s.sendingChange, false, "on its way: the saved list as it is");
  await settled();
  s = store.getSnapshot();
  assert.deepEqual(s.failure, { action: "save", kind: "rate_connection", retrying: true });
  assert.equal(s.saving, true);
  assert.equal(s.dirty, false);
  assert.equal(s.sendingChange, false);
  assert.equal(
    saveFailureLine(s.failure!, s.saved, s.dirty),
    "Lots of lists were saved from this connection in the last hour. Keep this page open: your list counts again after the hour.",
  );

  // a change on its way is
  const edit = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(edit.store);
  edit.backend.ctl.hold = true;
  edit.store.move("b", -1);
  edit.store.flush();
  assert.equal(edit.store.getSnapshot().sendingChange, true);
  edit.store.move("b", 1); // back to the saved list while the change is on its way: still a change on its way
  assert.equal(edit.store.getSnapshot().dirty, false);
  assert.equal(edit.store.getSnapshot().sendingChange, true);
});

/**
 * Two tabs of one browser: one backend, one voter id, one localStorage (a write that changes a value tells the other tab,
 * as a storage event does), and one clock; each tab its own sessionStorage.
 */
function twoTabs(saved: SavedRanking) {
  const backend = fakeApi({ v1: saved });
  const clock = fakeTimers();
  const data = new Map<string, string>([[RANKER_SAVED_KEY, "x"]]);
  const pages: PageEvents[] = [];
  const localFor = (tab: number): KeyValueStorage => {
    const tell = (key: string, oldValue: string | null, newValue: string | null) => {
      if (key !== RANKER_SAVED_KEY || oldValue === newValue) return;
      const other = pages[1 - tab];
      if (newValue === null) other.deletedElsewhere();
      else other.savedElsewhere();
    };
    return {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        const old = data.get(k) ?? null;
        data.set(k, v);
        tell(k, old, v);
      },
      removeItem: (k) => {
        const old = data.get(k) ?? null;
        data.delete(k);
        tell(k, old, null);
      },
    };
  };
  const tabs = [0, 1].map((tab) => {
    const session = memoryStorage();
    return createRankerStore({
      loadMenus: async () => MENUS,
      api: backend.api,
      voter: { read: () => "v1", get: () => "v1" },
      local: () => localFor(tab),
      session: () => session,
      timers: clock.timers,
      now: clock.now,
      watchPage: (on) => void (pages[tab] = on),
    });
  });
  return { tabs, backend, clock, data, pages };
}

test("a list saved in another open tab shows here: this tab's next change never drops it", async () => {
  const { tabs, backend, clock, data } = twoTabs(SAVED(["a", "b", "c", "d"]));
  const [one, two] = tabs;
  await started(one);
  await started(two);
  const stamp = data.get(RANKER_SAVED_KEY);
  two.addFromLink("e");
  await wait(clock, 2000);
  assert.deepEqual(backend.lists.get("v1")?.items, ["a", "b", "c", "d", "e"]);
  assert.notEqual(data.get(RANKER_SAVED_KEY), stamp, "a save here tells the other tabs");
  await settled();
  let s = one.getSnapshot();
  assert.deepEqual(s.draft, ["a", "b", "c", "d", "e"], "the first tab shows the newer list");
  assert.equal(s.dirty, false);
  assert.equal(s.notice, "updated_elsewhere");
  one.move("d", -1);
  assert.equal(one.getSnapshot().notice, null, "the note goes with the next change");
  await wait(clock, 2000);
  await settled();
  assert.deepEqual(backend.lists.get("v1")?.items, ["a", "b", "d", "c", "e"]);
  s = two.getSnapshot();
  assert.deepEqual(s.draft, ["a", "b", "d", "c", "e"], "and the second tab shows that one");
  await wait(clock, 60_000);
  assert.deepEqual(
    backend.calls,
    ["get v1", "get v1", "save v1 a,b,c,d,e", "get v1", "save v1 a,b,d,c,e", "get v1"],
    "no bouncing between the tabs",
  );

  // a change of this tab's own still waiting for its pause is newer: it stays and saves
  const race = twoTabs(SAVED(["a", "b", "c"]));
  await started(race.tabs[0]);
  await started(race.tabs[1]);
  race.tabs[0].move("c", -1);
  race.tabs[1].move("b", -1);
  await wait(race.clock, 2000);
  await settled();
  const last = race.backend.lists.get("v1")?.items;
  assert.deepEqual(race.tabs[0].getSnapshot().draft, last);
  assert.deepEqual(race.tabs[1].getSnapshot().draft, last);
});

// ---- round-5 fixes: one check of the saved list, what the session keeps, unsure saves ------------------------------------

const lineOf = (s: ReturnType<RankerStore["getSnapshot"]>) =>
  autosaveLine(
    {
      length: s.draft.length,
      saved: s.saved,
      dirty: s.dirty,
      saving: s.saving,
      failure: s.failure?.action === "save" ? s.failure : null,
      problem: s.problem,
      deleted: s.notice === "deleted" || s.notice === "deleted_elsewhere",
      menusFailed: s.menus === "error",
      checkRetrying: s.checkRetrying,
    },
    "2026-09-27",
  ).text;

test("a save that fails after the list went under 3 leaves no 'Trying again soon.' with nothing to try", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c", "d"]) });
  await started(store);
  backend.ctl.hold = true;
  store.move("b", -1);
  await wait(clock, 2000); // b,a,c,d on its way
  store.move("c", -1);
  await wait(clock, 2000); // its pause ends while the save is on its way: queued behind it
  store.remove("a");
  store.remove("b"); // c,d: nothing to save
  backend.ctl.hold = false;
  backend.ctl.held.shift()!.reject(new TypeError("Failed to fetch"));
  await settled();
  const s = store.getSnapshot();
  assert.equal(s.failure, null);
  assert.deepEqual(clock.waiting(), []);
  assert.equal(lineOf(s), "Add 1 more to save your changes. Your saved list is unchanged.");
  // the failed save may have landed: the saved list was asked for (it didn't)
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c,d", "get v1"]);
  assert.deepEqual(s.saved?.items, ["a", "b", "c", "d"]);
});

test("a save whose reply was lost but that landed: a change back to the list saved before is still saved", async () => {
  const { store, backend, clock } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.ctl.hold = true;
  store.add("d");
  await wait(clock, 2000);
  backend.ctl.hold = false;
  backend.lists.set("v1", SAVED(["a", "b", "c", "d"], { inBoard: false })); // the backend saved it
  backend.ctl.held.shift()!.reject(new TypeError("Failed to fetch")); // but the reply never came
  await settled();
  store.remove("d"); // back to a,b,c, which the card still takes for the saved list
  await settled();
  let s = store.getSnapshot();
  assert.deepEqual(s.saved?.items, ["a", "b", "c", "d"], "asked: the backend holds the list whose reply was lost");
  assert.equal(s.dirty, true);
  await wait(clock, 2000);
  s = store.getSnapshot();
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c,d", "get v1", "save v1 a,b,c"]);
  assert.deepEqual(backend.lists.get("v1")?.items, ["a", "b", "c"]);
  assert.deepEqual(s.saved?.items, ["a", "b", "c"]);
  assert.equal(s.dirty, false);
  assert.equal(s.failure, null);
});

test("a delete, then a reload before its reply: the change the session kept never brings the list back", async () => {
  const t = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(t.store);
  t.store.move("c", -1); // a change still in its pause
  t.store.askDelete();
  t.backend.ctl.holdDel = true;
  void t.store.deleteList();
  await settled();
  t.backend.lists.set("v1", { ...SAVED(["a", "b", "c"]), status: "deleted" }); // it went through; its reply is slow
  t.local.data.delete(RANKER_SAVED_KEY);
  const again = t.reopen(); // the visitor reloads
  await started(again);
  await wait(t.clock, 60_000);
  const s = again.getSnapshot();
  assert.deepEqual(s.draft, []);
  assert.equal(s.saved, null);
  assert.equal(s.notice, "deleted_elsewhere");
  assert.equal(lineOf(s), "Your list was deleted.");
  assert.deepEqual(t.backend.calls, ["get v1", "del v1", "get v1"], "nothing saved after the delete");
  assert.equal(t.backend.lists.get("v1")?.status, "deleted");
});

test("a delete whose reply was lost: the saved list is asked for, and the card says it was deleted (nothing saves after it)", async () => {
  const { store, backend, clock, local } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.move("c", -1); // a change still in its pause
  store.askDelete();
  const del = backend.api.del;
  backend.api.del = async (voter) => {
    await del(voter);
    throw new TypeError("Failed to fetch"); // withdrawn, but the reply was lost
  };
  assert.equal(await store.deleteList(), 3, "it went through");
  await wait(clock, 60_000);
  const s = store.getSnapshot();
  assert.deepEqual(s.draft, []);
  assert.equal(s.saved, null);
  assert.equal(s.notice, "deleted");
  assert.equal(s.failure, null);
  assert.deepEqual(backend.calls, ["get v1", "del v1", "get v1"]);
  assert.equal(backend.lists.get("v1")?.status, "deleted");
  assert.equal(local.data.has(RANKER_SAVED_KEY), false, "the other tabs hear of it");
});

test("back from the back-forward cache offline: the check is asked again until it answers, and nothing saves meanwhile", async () => {
  // another tab deleted the list while this page was cached with a network retry waiting
  const { store, backend, clock, page, local } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.move("b", -1);
  backend.fail.save = new TypeError("Failed to fetch");
  await wait(clock, 2000);
  page().unload(); // the keepalive request is lost too
  backend.lists.set("v1", { ...SAVED(["a", "b", "c"]), status: "deleted" });
  local.data.delete(RANKER_SAVED_KEY);
  backend.fail.get = new TypeError("Failed to fetch");
  page().restored();
  await settled();
  assert.deepEqual(clock.waiting(), [5000], "the check is asked again, and the retry waits for its answer");
  await wait(clock, 5000);
  assert.deepEqual(clock.waiting(), [15000]);
  assert.equal(local.data.has(RANKER_SAVED_KEY), false, "a check that couldn't ask writes no flag");
  backend.fail.get = undefined;
  backend.fail.save = undefined;
  page().online();
  await settled();
  await wait(clock, 120_000);
  const s = store.getSnapshot();
  assert.deepEqual(s.draft, []);
  assert.equal(s.notice, "deleted_elsewhere");
  assert.deepEqual(backend.calls, ["get v1", "save v1 b,a,c", "get v1", "get v1", "get v1"], "never saved over the delete");
  assert.equal(backend.lists.get("v1")?.status, "deleted");

  // another tab saved a newer list meanwhile: the card shows it once the check answers
  const other = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(other.store);
  other.page().unload();
  other.backend.lists.set("v1", SAVED(["c", "a", "b"], { inBoard: false }));
  other.backend.fail.get = new TypeError("Failed to fetch");
  other.page().restored();
  await settled();
  other.backend.fail.get = undefined;
  await wait(other.clock, 5000);
  assert.deepEqual(other.store.getSnapshot().draft, ["c", "a", "b"]);
  assert.equal(other.store.getSnapshot().notice, "updated_elsewhere");
});

test("another tab's delete heard while offline is never taken at its word, and a failed check writes no flag", async () => {
  const { store, backend, clock, page, local } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  local.data.delete(RANKER_SAVED_KEY); // another tab's failed check once removed it: the list is still there
  backend.fail.get = new TypeError("Failed to fetch");
  page().deletedElsewhere();
  await settled();
  let s = store.getSnapshot();
  assert.deepEqual(s.draft, ["a", "b", "c"], "the card stays as it is");
  assert.equal(s.notice, null);
  assert.equal(local.data.has(RANKER_SAVED_KEY), false);
  backend.fail.get = undefined;
  await wait(clock, 5000);
  s = store.getSnapshot();
  assert.deepEqual(s.draft, ["a", "b", "c"]);
  assert.equal(s.notice, null);
  assert.ok(local.data.get(RANKER_SAVED_KEY), "the backend holds it: the flag is back");

  // a check that fails never removes the flag either
  const none = setup({ voter: "v1", saved: null });
  await started(none.store);
  none.backend.lists.set("v1", SAVED(["d", "e", "a"], { inBoard: false })); // another tab saved
  none.local.data.set(RANKER_SAVED_KEY, "k1");
  none.backend.fail.get = new TypeError("Failed to fetch");
  none.page().savedElsewhere();
  await settled();
  assert.equal(none.local.data.get(RANKER_SAVED_KEY), "k1");
  none.backend.fail.get = undefined;
  none.page().online();
  await settled();
  assert.deepEqual(none.store.getSnapshot().draft, ["d", "e", "a"]);
  assert.equal(none.store.getSnapshot().notice, "updated_elsewhere");
});

test("a list saved as the page closes tells the other tabs, and a reload that finds it tells them again", async () => {
  const { tabs, backend, clock, pages } = twoTabs(SAVED(["a", "b", "c"]));
  const [one, two] = tabs;
  await started(one);
  await started(two);
  two.move("c", -2); // c,a,b, still in its pause
  pages[1].unload(); // closed within the pause: a keepalive request
  assert.deepEqual(backend.unload, ["v1 c,a,b"]);
  backend.lists.set("v1", SAVED(["c", "a", "b"], { inBoard: false })); // it landed
  await settled();
  const s = one.getSnapshot();
  assert.deepEqual(s.draft, ["c", "a", "b"], "the other tab shows it");
  assert.equal(s.notice, "updated_elsewhere");
  await wait(clock, 60_000);
  assert.deepEqual(backend.calls, ["get v1", "get v1", "get v1"], "and never saves its older list over it");

  // a reload: the load finds the list this tab sent at close and stamps the flag again
  const t = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(t.store);
  t.store.move("b", -1);
  t.page().unload();
  t.backend.lists.set("v1", SAVED(["b", "a", "c"], { inBoard: false }));
  const before = t.local.data.get(RANKER_SAVED_KEY);
  t.clock.skip(1000);
  const again = t.reopen();
  await started(again);
  assert.deepEqual(again.getSnapshot().draft, ["b", "a", "c"]);
  assert.equal(again.getSnapshot().dirty, false);
  assert.notEqual(t.local.data.get(RANKER_SAVED_KEY), before, "a new stamp");
});

test("another tab's save heard while this card has a change of its own: the change still saves, and a change back is not forgotten", async () => {
  // the change goes back to the list this tab had saved: it is sent (the other tab's list is newer than that)
  const { tabs, backend, clock } = twoTabs(SAVED(["a", "b", "c"]));
  const [one, two] = tabs;
  await started(one);
  await started(two);
  one.move("c", -1); // a,c,b in its pause
  two.add("d");
  await wait(clock, 2000); // both pauses end: one saves a,c,b, two a,b,c,d
  await settled();
  one.move("c", 1); // back to a,b,c
  await wait(clock, 2000);
  await settled();
  const last = backend.lists.get("v1")?.items;
  assert.deepEqual(one.getSnapshot().draft, last);
  assert.deepEqual(one.getSnapshot().saved?.items, last);
  assert.deepEqual(two.getSnapshot().draft, last);

  // the change is cut under 3: the card says the saved list (the other tab's) is unchanged, never a false "Saved."
  const cut = twoTabs(SAVED(["a", "b", "c"]));
  await started(cut.tabs[0]);
  await started(cut.tabs[1]);
  cut.tabs[0].remove("c"); // a,b: nothing to send
  cut.tabs[1].add("d");
  await wait(cut.clock, 2000);
  await settled();
  const s = cut.tabs[0].getSnapshot();
  assert.deepEqual(s.draft, ["a", "b"]);
  assert.deepEqual(s.saved?.items, ["a", "b", "c", "d"]);
  assert.equal(lineOf(s), "Add 1 more to save your changes. Your saved list is unchanged.");
});

test("another tab's save heard while this tab's saved list is loading: checked once the load lands", async () => {
  const { tabs, backend, clock } = twoTabs(SAVED(["a", "b", "c"]));
  const [one, two] = tabs;
  await started(two);
  backend.ctl.holdGet = true;
  one.start(); // its load was answered with a,b,c, but the reply is slow
  await settled();
  backend.ctl.holdGet = false;
  two.add("d");
  await wait(clock, 2000); // two saves a,b,c,d: one hears it while loading
  backend.ctl.heldGets.shift()!();
  await settled();
  let s = one.getSnapshot();
  assert.deepEqual(s.draft, ["a", "b", "c", "d"]);
  // its next change keeps d
  one.remove("c");
  one.add("e");
  await wait(clock, 2000);
  await settled();
  s = one.getSnapshot();
  assert.deepEqual(backend.lists.get("v1")?.items, ["a", "b", "d", "e"]);
});

test("a closed tab reopened with its session: a list deleted, or changed, in another tab since is never overwritten", async () => {
  // deleted elsewhere after the keepalive landed
  const t = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(t.store);
  t.store.move("c", -1);
  await wait(t.clock, 1000);
  t.store.flushOnUnload();
  t.backend.lists.set("v1", SAVED(["a", "c", "b"], { inBoard: false })); // it landed
  t.backend.lists.set("v1", { ...SAVED(["a", "c", "b"]), status: "deleted" }); // then another tab deleted it
  t.local.data.delete(RANKER_SAVED_KEY);
  const back = t.reopen();
  await started(back);
  await wait(t.clock, 60_000);
  let s = back.getSnapshot();
  assert.deepEqual(s.draft, []);
  assert.equal(s.notice, "deleted_elsewhere");
  assert.equal(t.backend.lists.get("v1")?.status, "deleted");
  assert.deepEqual(t.backend.calls, ["get v1", "get v1"]);

  // changed elsewhere after the keepalive landed: the newer list shows
  const u = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(u.store);
  u.store.move("c", -1);
  u.store.flushOnUnload();
  u.backend.lists.set("v1", SAVED(["a", "c", "b", "d"], { inBoard: false }));
  const reopened = u.reopen();
  await started(reopened);
  await wait(u.clock, 60_000);
  s = reopened.getSnapshot();
  assert.deepEqual(s.draft, ["a", "c", "b", "d"]);
  assert.equal(s.notice, "updated_elsewhere");
  assert.deepEqual(u.backend.calls, ["get v1", "get v1"]);

  // the keepalive didn't land: the list the session kept saves itself
  const w = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(w.store);
  w.store.move("c", -1);
  w.store.flushOnUnload();
  const reloaded = w.reopen();
  await started(reloaded);
  await wait(w.clock, 2000);
  assert.deepEqual(w.backend.lists.get("v1")?.items, ["a", "c", "b"]);
});

test("a refused first list, then another tab's list: it shows (no refusal left up), without the saved list's skeleton", async () => {
  const { store, backend, clock, page } = setup();
  await started(store);
  backend.fail.save = { code: "P0001", hint: "rate_voter", message: "…" };
  for (const k of ["a", "b", "c"]) store.add(k);
  await wait(clock, 2000);
  assert.deepEqual(store.getSnapshot().failure, { action: "save", kind: "rate_voter", retrying: false });
  assert.equal(store.getSnapshot().mine, "none");
  const seen: string[] = [];
  store.subscribe(() => seen.push(store.getSnapshot().mine));
  backend.lists.set("new-voter", SAVED(["d", "e", "a"], { inBoard: false })); // another tab, same voter id
  page().savedElsewhere();
  await settled();
  const s = store.getSnapshot();
  assert.deepEqual(s.draft, ["d", "e", "a"]);
  assert.equal(s.notice, "updated_elsewhere");
  assert.equal(s.failure, null);
  assert.equal(s.mine, "ready");
  assert.ok(!seen.includes("loading"), "the card never turns into a skeleton");
});

test("each update from another tab is its own notice, even with the note still up", async () => {
  const { tabs, clock } = twoTabs(SAVED(["a", "b", "c"]));
  const [one, two] = tabs;
  await started(one);
  await started(two);
  two.moveTo("c", 0);
  await wait(clock, 2000);
  await settled();
  const first = one.getSnapshot();
  assert.equal(first.notice, "updated_elsewhere");
  two.remove("c");
  two.add("d");
  await wait(clock, 2000);
  await settled();
  const second = one.getSnapshot();
  assert.deepEqual(second.draft, ["a", "b", "d"]);
  assert.equal(second.notice, "updated_elsewhere");
  assert.equal(second.noticeSeq, first.noticeSeq + 1);
});

test("'Count it again' waiting for the hour keeps waiting across the back-forward cache", async () => {
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"], { status: "replaced", inBoard: false }) });
  await started(store);
  backend.fail.save = { code: "PT429", hint: "rate_connection", message: "…" };
  store.countAgain();
  await settled();
  assert.deepEqual(clock.waiting(), [3_615_000]);
  page().unload();
  clock.skip(300_000);
  page().restored();
  await settled();
  let s = store.getSnapshot();
  assert.deepEqual(s.failure, { action: "save", kind: "rate_connection", retrying: true });
  assert.deepEqual(clock.waiting(), [3_315_000]);
  backend.fail.save = undefined;
  await wait(clock, 3_315_000);
  s = store.getSnapshot();
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c", "get v1", "save v1 a,b,c"]);
  assert.equal(s.saved?.status, "active");
  assert.equal(s.failure, null);
});

// ---- round-6 fixes: a lost delete reply and the page closing, a list saved at close landing late, the check's line ----------

/** del that withdraws the list, then loses its reply. */
function lostDeleteReply(backend: ReturnType<typeof fakeApi>) {
  const del = backend.api.del;
  backend.api.del = async (voter) => {
    await del(voter);
    throw new TypeError("Failed to fetch");
  };
}

test("a delete whose reply was lost, then the page closes before the check answers: nothing brings the list back", async () => {
  const t = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(t.store);
  t.store.move("c", -1); // a change still in its pause
  t.store.askDelete();
  lostDeleteReply(t.backend);
  t.backend.fail.get = new TypeError("Failed to fetch");
  assert.equal(await t.store.deleteList(), null);
  assert.equal(t.backend.lists.get("v1")?.status, "deleted");
  assert.deepEqual(t.store.getSnapshot().failure, { action: "delete", kind: "network" });
  t.page().hidden();
  t.page().unload();
  assert.deepEqual(t.backend.unload, [], "no keepalive while the check after the delete waits");
  assert.deepEqual(t.backend.calls, ["get v1", "del v1", "get v1"]);
  // the visitor reloads: the session's draft is settled by the load, which finds the list gone
  t.backend.fail.get = undefined;
  const again = t.reopen();
  await started(again);
  await wait(t.clock, 60_000);
  const s = again.getSnapshot();
  assert.deepEqual(s.draft, []);
  assert.equal(s.saved, null);
  assert.equal(lineOf(s), "Your list was deleted.");
  assert.equal(t.backend.lists.get("v1")?.status, "deleted");
  assert.ok(!t.backend.calls.some((c) => c.startsWith("save")), "nothing saved after the delete");

  // the delete never reached the backend: the reload finds the list, and the change the session kept saves itself
  const u = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(u.store);
  u.store.move("c", -1);
  u.store.askDelete();
  u.backend.fail.del = new TypeError("Failed to fetch");
  u.backend.fail.get = new TypeError("Failed to fetch");
  assert.equal(await u.store.deleteList(), null);
  u.page().unload();
  assert.deepEqual(u.backend.unload, []);
  u.backend.fail.del = undefined;
  u.backend.fail.get = undefined;
  const back = u.reopen();
  await started(back);
  await wait(u.clock, 2000);
  assert.deepEqual(u.backend.lists.get("v1")?.items, ["a", "c", "b"]);
  assert.equal(u.backend.lists.get("v1")?.status, "active");
});

test("a failed delete that a later check finds went through: said and tracked once, like one whose reply came", async () => {
  const { store, backend, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  store.askDelete();
  lostDeleteReply(backend);
  backend.fail.get = new TypeError("Failed to fetch");
  assert.equal(await store.deleteList(), null);
  let s = store.getSnapshot();
  assert.equal(s.noticeSeq, 0);
  assert.equal(store.takeDelete(), null, "not known to have gone through yet");
  backend.fail.get = undefined;
  page().online();
  await settled();
  s = store.getSnapshot();
  assert.deepEqual(s.draft, []);
  assert.equal(s.notice, "deleted");
  assert.equal(s.confirmDelete, false);
  assert.equal(s.failure, null);
  assert.equal(s.noticeSeq, 1, "the ranker says it (and rescues focus from the confirmation that went away)");
  assert.equal(store.takeDelete(), 3, "ranking_deleted, with the list's length");
  assert.equal(store.takeDelete(), null, "once");

  // a delete whose reply came: the same notice, handed out once
  const ok = setup({ voter: "v1", saved: SAVED(["a", "b", "c", "d"]) });
  await started(ok.store);
  ok.store.askDelete();
  assert.equal(await ok.store.deleteList(), 4);
  assert.equal(ok.store.getSnapshot().noticeSeq, 1);
  assert.equal(ok.store.takeDelete(), 4);
  assert.equal(ok.store.takeDelete(), null);
});

test("a list saved as another tab closes that lands after this tab's read: asked once more, it shows, and the next change keeps it", async () => {
  const { tabs, backend, clock, pages } = twoTabs(SAVED(["a", "b", "c"]));
  const [one, two] = tabs;
  await started(one);
  await started(two);
  two.move("c", -2); // c,a,b, still in its pause
  pages[1].unload(); // closed: the keepalive request is on its way, and its stamp is written at once
  assert.deepEqual(backend.unload, ["v1 c,a,b"]);
  await settled(); // tab one's read comes first: a,b,c, nothing new
  assert.deepEqual(one.getSnapshot().draft, ["a", "b", "c"]);
  assert.deepEqual(clock.waiting(), [RECHECK_DELAY], "asked once more");
  backend.lists.set("v1", SAVED(["c", "a", "b"], { inBoard: false })); // the keepalive lands
  await wait(clock, RECHECK_DELAY);
  let s = one.getSnapshot();
  assert.deepEqual(s.draft, ["c", "a", "b"]);
  assert.equal(s.notice, "updated_elsewhere");
  assert.deepEqual(clock.waiting(), [], "once: no loop");
  one.add("d");
  await wait(clock, 2000);
  assert.deepEqual(backend.lists.get("v1")?.items, ["c", "a", "b", "d"], "the closed tab's change is kept");
  // (the loads, one's read and its one more; the last read is tab two's, which the harness keeps open)
  assert.deepEqual(backend.calls, ["get v1", "get v1", "get v1", "get v1", "save v1 c,a,b,d", "get v1"]);

  // a stamp whose list is new is shown at once: no second read
  const plain = twoTabs(SAVED(["a", "b", "c"]));
  await started(plain.tabs[0]);
  await started(plain.tabs[1]);
  plain.tabs[1].add("d");
  await wait(plain.clock, 2000);
  await settled();
  s = plain.tabs[0].getSnapshot();
  assert.deepEqual(s.draft, ["a", "b", "c", "d"]);
  assert.deepEqual(plain.clock.waiting(), []);
  assert.deepEqual(plain.backend.calls, ["get v1", "get v1", "save v1 a,b,c,d", "get v1"]);
});

test("a replaced list counted again whose reply was lost: the reload that finds it counting tells the other tabs", async () => {
  const t = setup({ voter: "v1", saved: SAVED(["a", "b", "c"], { status: "replaced", inBoard: false }) });
  await started(t.store);
  t.store.move("c", -1);
  t.store.move("c", 1); // changed and back: the replaced list as it is goes again
  t.backend.ctl.hold = true;
  await wait(t.clock, 2000);
  assert.deepEqual(t.backend.calls, ["get v1", "save v1 a,b,c"]);
  t.backend.ctl.hold = false;
  t.backend.lists.set("v1", SAVED(["a", "b", "c"], { inBoard: false })); // it landed: counting again
  t.backend.ctl.held.shift()!.reject(new TypeError("Failed to fetch")); // its reply was lost
  t.backend.fail.get = new TypeError("Failed to fetch"); // and the check can't ask
  await settled();
  t.store.remove("c"); // under 3: nothing to send as the page closes
  t.page().unload();
  const before = t.local.data.get(RANKER_SAVED_KEY);
  t.backend.fail.get = undefined;
  t.clock.skip(1000);
  const again = t.reopen();
  await started(again);
  const s = again.getSnapshot();
  assert.equal(s.saved?.status, "active");
  assert.notEqual(t.local.data.get(RANKER_SAVED_KEY), before, "a new stamp: the other tabs ask, and take the new status");
});

test("a change held by a check that can't reach the counter says so, not 'Saving…'", async () => {
  const { store, backend, clock, page } = setup({ voter: "v1", saved: SAVED(["a", "b", "c"]) });
  await started(store);
  backend.fail.save = new TypeError("Failed to fetch");
  backend.fail.get = new TypeError("Failed to fetch");
  store.move("c", -1);
  await wait(clock, 2000);
  assert.equal(lineOf(store.getSnapshot()), "Couldn't reach the counter. Trying again soon.");
  store.move("c", 1); // back to the saved list: the unsure a,c,b is checked, and the check fails
  store.add("d");
  await wait(clock, 300_000);
  let s = store.getSnapshot();
  assert.equal(s.checkRetrying, true);
  assert.equal(s.failure, null);
  assert.equal(lineOf(s), "Couldn't reach the counter. Trying again soon.");
  backend.fail.save = undefined;
  backend.fail.get = undefined;
  page().online();
  await settled();
  await wait(clock, 2000);
  s = store.getSnapshot();
  assert.equal(s.checkRetrying, false);
  assert.deepEqual(backend.lists.get("v1")?.items, ["a", "b", "c", "d"]);
  assert.equal(lineOf(s), "Saved. It joins the People's Top 10 at its next update.");
});
