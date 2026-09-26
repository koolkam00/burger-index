import assert from "node:assert/strict";
import { test } from "node:test";
import { menuListData } from "../src/lib/menu-list";
import type { SavedRanking, SaveReply } from "../src/lib/ranker";
import { createRankerStore, parseDraft, RANKER_DRAFT_KEY, type KeyValueStorage, type RankerApi, type RankerStore } from "../src/lib/ranker-store";
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

/** A fake backend: one saved list per voter, the calls it got, and failures to throw on demand. */
function fakeApi(seed: Record<string, SavedRanking | null> = {}) {
  const lists = new Map(Object.entries(seed));
  const calls: string[] = [];
  const fail: { save?: unknown; get?: unknown; del?: unknown } = {};
  const api: RankerApi = {
    async save(voter, items): Promise<SaveReply> {
      calls.push(`save ${voter} ${items.join(",")}`);
      if (fail.save) throw fail.save;
      lists.set(voter, { items: [...items], status: "active", savedOn: "2026-09-26", countsFrom: "2026-09-27", inBoard: false });
      return { status: "active", savedOn: "2026-09-26", countsFrom: "2026-09-27" };
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
  };
  return { api, calls, fail, lists };
}

function setup(opts: { voter?: string | null; saved?: SavedRanking | null; session?: Record<string, string>; menus?: () => Promise<unknown> } = {}) {
  let voter = opts.voter ?? null;
  const backend = fakeApi(voter && opts.saved ? { [voter]: opts.saved } : {});
  const local = memoryStorage();
  const session = memoryStorage(opts.session);
  const store = createRankerStore({
    loadMenus: opts.menus ?? (async () => MENUS),
    api: backend.api,
    voter: { read: () => voter, get: () => (voter ??= "new-voter") },
    local: () => local,
    session: () => session,
  });
  return { store, backend, local, session, voterId: () => voter };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function started(store: RankerStore) {
  store.start();
  await tick();
  await tick();
}

test("a new browser: nothing to load but the burgers; build a list, save it (making the voter id), then it shows as saved", async () => {
  const { store, backend, local, session, voterId } = setup();
  assert.equal(store.getServerSnapshot().started, false);
  await started(store);
  let s = store.getSnapshot();
  assert.equal(s.menus, "ready");
  assert.equal(s.mine, "none", "no voter id: no request");
  assert.deepEqual(backend.calls, []);
  assert.equal(s.view, "edit");

  store.add("a");
  store.add("b");
  assert.deepEqual(await store.save(), { ok: false }, "two burgers can't be saved");
  assert.deepEqual(backend.calls, []);
  store.add("c");
  store.move("c", -2);
  s = store.getSnapshot();
  assert.deepEqual(s.draft, ["c", "a", "b"]);
  assert.equal(s.dirty, true);
  assert.equal(session.data.get(RANKER_DRAFT_KEY), JSON.stringify({ items: ["c", "a", "b"] }), "kept for this session until saved");

  const result = await store.save();
  assert.deepEqual(result, { ok: true, edited: false, length: 3 });
  s = store.getSnapshot();
  assert.equal(voterId(), "new-voter");
  assert.deepEqual(backend.calls, ["save new-voter c,a,b"]);
  assert.equal(s.view, "saved");
  assert.equal(s.notice, "saved");
  assert.equal(s.dirty, false);
  assert.deepEqual(s.saved?.items, ["c", "a", "b"]);
  assert.equal(s.saved?.countsFrom, "2026-09-27");
  assert.equal(session.data.has(RANKER_DRAFT_KEY), false, "the draft is gone once saved");
  assert.equal(local.data.get(RANKER_SAVED_KEY), "1", "the next page load knows there is a saved list");
});

test("a returning browser: its saved list loads and shows; edit, cancel, edit again and save the change", async () => {
  const saved: SavedRanking = { items: ["a", "b", "c"], status: "active", savedOn: "2026-09-20", countsFrom: null, inBoard: true };
  const { store, backend } = setup({ voter: "v1", saved });
  await started(store);
  let s = store.getSnapshot();
  assert.equal(s.mine, "ready");
  assert.equal(s.view, "saved");
  assert.deepEqual(s.draft, ["a", "b", "c"]);
  assert.deepEqual(backend.calls, ["get v1"]);

  store.edit();
  store.remove("b");
  store.add("d");
  assert.deepEqual(store.getSnapshot().draft, ["a", "c", "d"]);
  store.cancel();
  s = store.getSnapshot();
  assert.equal(s.view, "saved");
  assert.deepEqual(s.draft, ["a", "b", "c"], "cancel puts the saved list back");

  store.edit();
  assert.deepEqual(await store.save(), { ok: false }, "an unchanged list is not sent");
  store.moveTo("c", 0);
  const result = await store.save();
  assert.deepEqual(result, { ok: true, edited: true, length: 3 });
  assert.deepEqual(backend.calls, ["get v1", "save v1 c,a,b"]);
  assert.equal(store.getSnapshot().saved?.inBoard, false, "the new version isn't in a board yet");
});

test("a list being built survives a reload (sessionStorage) and wins over the saved one it differs from", async () => {
  const saved: SavedRanking = { items: ["a", "b", "c"], status: "active", savedOn: "2026-09-20", countsFrom: null, inBoard: false };
  const { store } = setup({ voter: "v1", saved, session: { [RANKER_DRAFT_KEY]: JSON.stringify({ items: ["b", "a", "c", "d"] }) } });
  await started(store);
  const s = store.getSnapshot();
  assert.equal(s.view, "edit");
  assert.deepEqual(s.draft, ["b", "a", "c", "d"]);
  assert.equal(s.dirty, true);

  // A stored draft equal to the saved list is just the saved list.
  const same = setup({ voter: "v1", saved, session: { [RANKER_DRAFT_KEY]: JSON.stringify({ items: ["a", "b", "c"] }) } });
  await started(same.store);
  assert.equal(same.store.getSnapshot().view, "saved");
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

test("a save that fails keeps the list and says why; a rate limit is told apart", async () => {
  const { store, backend } = setup();
  await started(store);
  for (const k of ["a", "b", "c"]) store.add(k);
  backend.fail.save = { code: "PT429", hint: "rate_connection", message: "Lots of lists were saved from this connection in the last hour. Try again later." };
  assert.deepEqual(await store.save(), { ok: false });
  let s = store.getSnapshot();
  assert.deepEqual(s.failure, { action: "save", kind: "rate_connection" });
  assert.equal(s.busy, null);
  assert.deepEqual(s.draft, ["a", "b", "c"], "nothing lost");
  assert.equal(s.saved, null);

  backend.fail.save = new TypeError("Failed to fetch");
  await store.save();
  assert.equal(store.getSnapshot().failure?.kind, "network");

  store.add("d");
  assert.equal(store.getSnapshot().failure, null, "a change clears the last failure");
  backend.fail.save = undefined;
  assert.equal((await store.save()).ok, true);
  s = store.getSnapshot();
  assert.equal(s.failure, null);
  assert.equal(s.view, "saved");
});

test("delete asks first, then withdraws the list and starts an empty one", async () => {
  const saved: SavedRanking = { items: ["a", "b", "c", "d"], status: "active", savedOn: "2026-09-20", countsFrom: null, inBoard: true };
  const { store, backend, local } = setup({ voter: "v1", saved });
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
  assert.equal(await store.deleteList(), 4);
  const s = store.getSnapshot();
  assert.equal(s.saved, null);
  assert.deepEqual(s.draft, []);
  assert.equal(s.view, "edit");
  assert.equal(s.notice, "deleted");
  assert.equal(local.data.has(RANKER_SAVED_KEY), false);
  assert.deepEqual(backend.calls, ["get v1", "del v1", "del v1"]);
});

test("a voided list can't be deleted: the card keeps showing it and says so, never 'Your list was deleted.'", async () => {
  const saved: SavedRanking = { items: ["a", "b", "c"], status: "void", savedOn: "2026-09-20", countsFrom: null, inBoard: false };
  const { store, backend, local } = setup({ voter: "v1", saved });
  await started(store);
  assert.equal(store.getSnapshot().saved?.status, "void");
  store.askDelete();
  assert.equal(await store.deleteList(), null, "nothing was withdrawn");
  const s = store.getSnapshot();
  assert.equal(s.saved?.status, "void");
  assert.deepEqual(s.saved?.items, ["a", "b", "c"]);
  assert.equal(s.view, "saved");
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

test("a list replaced from this connection shows as saved, and 'Save again' sends it again", async () => {
  const saved: SavedRanking = { items: ["a", "b", "c"], status: "replaced", savedOn: "2026-09-20", countsFrom: null, inBoard: false };
  const { store, backend } = setup({ voter: "v1", saved });
  await started(store);
  assert.equal(store.getSnapshot().view, "saved");
  assert.equal(store.getSnapshot().saved?.status, "replaced");
  const result = await store.save();
  assert.deepEqual(result, { ok: true, edited: true, length: 3 });
  assert.deepEqual(backend.calls, ["get v1", "save v1 a,b,c"]);
  assert.equal(store.getSnapshot().saved?.status, "active");
});

test("a deleted list on the backend is no list; a failed load says so and can be tried again", async () => {
  const deleted: SavedRanking = { items: ["a", "b", "c"], status: "deleted", savedOn: "2026-09-20", countsFrom: null, inBoard: false };
  const gone = setup({ voter: "v1", saved: deleted });
  await started(gone.store);
  assert.equal(gone.store.getSnapshot().saved, null);
  assert.equal(gone.store.getSnapshot().view, "edit");
  assert.deepEqual(gone.store.getSnapshot().draft, []);

  const failing = setup({ voter: "v2", saved: null });
  failing.backend.fail.get = new TypeError("Failed to fetch");
  await started(failing.store);
  assert.equal(failing.store.getSnapshot().mine, "error");
  failing.backend.fail.get = undefined;
  await failing.store.loadMine();
  assert.equal(failing.store.getSnapshot().mine, "ready");
});

test("a burger no longer on the Burger Index stops a save until it is removed", async () => {
  const saved: SavedRanking = { items: ["a", "b", "retired"], status: "active", savedOn: "2026-09-20", countsFrom: null, inBoard: true };
  const { store, backend } = setup({ voter: "v1", saved });
  await started(store);
  store.edit();
  store.add("c");
  assert.deepEqual(await store.save(), { ok: false });
  store.remove("retired");
  assert.equal((await store.save()).ok, true);
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
  });
  await started(store);
  assert.equal(store.getSnapshot().menus, "error");
  await store.loadMenus();
  assert.equal(store.getSnapshot().menus, "ready");
  assert.equal(store.getSnapshot().burgers.size, 5);
  store.add("a");
  assert.deepEqual(store.getSnapshot().draft, ["a"]);
});
