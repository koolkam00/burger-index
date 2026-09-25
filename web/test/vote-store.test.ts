import assert from "node:assert/strict";
import { test } from "node:test";
import { createVoteStore, scoresKnown, type VoteApi } from "../src/lib/vote-store";
import type { ScoreRow } from "../src/lib/votes";

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

/** A fake backend: records every cast, keeps totals like the database trigger, and can be told to fail. */
function fakeApi(opts: { mine?: Map<string, number>; failWith?: unknown; gate?: () => Promise<void> } = {}) {
  const votes = new Map<string, number>(); // menu_key -> this voter's score
  const others = new Map<string, { votes: number; total: number }>();
  const calls: Array<[string, number]> = [];
  let failWith = opts.failWith;
  const totals = (key: string): ScoreRow => {
    const o = others.get(key) ?? { votes: 0, total: 0 };
    const mine = votes.get(key);
    return { menu_key: key, votes: o.votes + (mine ? 1 : 0), total: o.total + (mine ?? 0), at: null };
  };
  const api: VoteApi = {
    async castVote(key, voter, score) {
      assert.equal(voter, VOTER);
      calls.push([key, score]);
      if (opts.gate) await opts.gate();
      if (failWith) throw failWith;
      votes.set(key, score);
      return totals(key);
    },
    async fetchMyVotes() {
      return new Map(opts.mine ?? []);
    },
    async fetchScores(keys) {
      const all = new Set([...votes.keys(), ...others.keys()]);
      return [...all].filter((k) => !keys || keys.includes(k)).map(totals);
    },
  };
  return {
    api,
    calls,
    others,
    setFail(e: unknown) {
      failWith = e;
    },
  };
}

const store = (api: VoteApi, voter: string | null = VOTER, enabled = true) =>
  createVoteStore({ api, enabled, voter: { read: () => voter, get: () => voter ?? VOTER } });

test("a pick shows at once, then is saved, and the totals follow", async () => {
  const f = fakeApi();
  const s = store(f.api);
  s.vote("due-west", 8);
  assert.equal(s.getMine().picked.get("due-west"), 8, "optimistic");
  assert.equal(s.getMine().saving.has("due-west"), true);
  await s.settled();
  const mine = s.getMine();
  assert.equal(mine.picked.get("due-west"), 8);
  assert.equal(mine.saving.has("due-west"), false);
  assert.equal(mine.saved.has("due-west"), true);
  assert.deepEqual(s.getScores().rows.get("due-west"), { menu_key: "due-west", votes: 1, total: 8, at: null });
  assert.deepEqual(f.calls, [["due-west", 8]]);
});

test("quick changes are sent one at a time, in order, and the last pick wins", async () => {
  let open = deferred<void>();
  const f = fakeApi({ gate: () => open.promise });
  const s = store(f.api);
  s.vote("due-west", 3);
  s.vote("due-west", 6); // queued behind the first
  s.vote("due-west", 9); // replaces the queued 6
  assert.equal(s.getMine().picked.get("due-west"), 9);
  open.resolve();
  open = deferred<void>();
  await new Promise((r) => setTimeout(r, 10));
  open.resolve();
  await s.settled();
  assert.deepEqual(f.calls, [
    ["due-west", 3],
    ["due-west", 9],
  ]);
  assert.equal(s.getMine().picked.get("due-west"), 9);
  assert.equal(s.getScores().rows.get("due-west")?.total, 9);
});

test("keyboard picks wait out the pause: arrowing across the row sends one vote", async () => {
  const f = fakeApi();
  const s = store(f.api);
  for (const score of [2, 3, 4, 5, 6]) s.vote("due-west", score, 30);
  assert.equal(s.getMine().picked.get("due-west"), 6);
  assert.deepEqual(f.calls, []);
  await s.settled();
  assert.deepEqual(f.calls, [["due-west", 6]]);
});

test("flush sends a waiting keyboard pick right away", async () => {
  const f = fakeApi();
  const s = store(f.api);
  s.vote("due-west", 4, 60_000);
  s.flush("due-west");
  await s.settled();
  assert.deepEqual(f.calls, [["due-west", 4]]);
});

test("a failed vote falls back to the saved one and keeps a friendly error kind", async () => {
  const f = fakeApi();
  const s = store(f.api);
  s.vote("due-west", 7);
  await s.settled();
  f.setFail({ code: "54000", message: "too many votes from this connection" });
  s.vote("due-west", 2);
  assert.equal(s.getMine().picked.get("due-west"), 2);
  await s.settled();
  assert.equal(s.getMine().picked.get("due-west"), 7, "back to the saved vote");
  assert.equal(s.getMine().errors.get("due-west"), "rate");
  f.setFail(undefined);
  s.vote("due-west", 2);
  assert.equal(s.getMine().errors.has("due-west"), false, "a new pick clears the error");
  await s.settled();
  assert.equal(s.getMine().picked.get("due-west"), 2);
});

test("a network failure on a first vote leaves nothing picked", async () => {
  const f = fakeApi({ failWith: { code: "", message: "TypeError: Failed to fetch" } });
  const s = store(f.api);
  s.vote("due-west", 5);
  await s.settled();
  assert.equal(s.getMine().picked.has("due-west"), false);
  assert.equal(s.getMine().errors.get("due-west"), "network");
});

test("re-picking the saved score sends nothing", async () => {
  const f = fakeApi();
  const s = store(f.api);
  s.vote("due-west", 7);
  await s.settled();
  s.vote("due-west", 7);
  await s.settled();
  assert.equal(f.calls.length, 1);
});

test("saved votes load once; a pick made meanwhile is never overwritten", async () => {
  const f = fakeApi({ mine: new Map([["due-west", 4], ["chain:7th-street-burger", 9]]) });
  const s = store(f.api);
  const loading = s.loadMine();
  s.vote("due-west", 10);
  await loading;
  await s.settled();
  assert.equal(s.getMine().status, "ready");
  assert.equal(s.getMine().picked.get("due-west"), 10);
  assert.equal(s.getMine().picked.get("chain:7th-street-burger"), 9);
  assert.equal(s.loadMine(), s.loadMine(), "one load per page view");
});

test("a browser that never voted loads nothing", async () => {
  let fetched = false;
  const f = fakeApi();
  const api: VoteApi = {
    ...f.api,
    async fetchMyVotes(v) {
      fetched = true;
      return f.api.fetchMyVotes(v);
    },
  };
  const s = store(api, null);
  await s.loadMine();
  assert.equal(fetched, false);
  assert.equal(s.getMine().status, "ready");
});

test("an older copy of a row never replaces a newer one", async () => {
  const f = fakeApi();
  const s = store(f.api);
  s.applyScore({ menu_key: "a", votes: 5, total: 40, at: 2000 });
  s.applyScore({ menu_key: "a", votes: 4, total: 30, at: 1000 }); // late realtime event
  assert.equal(s.getScores().rows.get("a")?.votes, 5);
  // A fetch whose copy is older than the realtime one keeps the realtime one.
  const api: VoteApi = { ...f.api, fetchScores: async () => [{ menu_key: "a", votes: 3, total: 20, at: 1500 }] };
  const s2 = store(api);
  s2.applyScore({ menu_key: "a", votes: 5, total: 40, at: 2000 });
  await s2.loadScores();
  assert.equal(s2.getScores().rows.get("a")?.votes, 5);
  assert.equal(s2.getScores().status, "ready");
});

test("a full fetch drops rows that are gone, but not ones that arrived while it ran", async () => {
  const gate = deferred<ScoreRow[]>();
  const f = fakeApi();
  const api: VoteApi = { ...f.api, fetchScores: () => gate.promise };
  const s = store(api);
  s.applyScore({ menu_key: "old", votes: 1, total: 5, at: 100 });
  const loading = s.loadScores();
  s.applyScore({ menu_key: "fresh", votes: 1, total: 9, at: null }); // arrives mid-fetch
  gate.resolve([{ menu_key: "kept", votes: 2, total: 12, at: 300 }]);
  await loading;
  assert.deepEqual([...s.getScores().rows.keys()].sort(), ["fresh", "kept"]);
  s.removeScore("kept");
  assert.equal(s.getScores().rows.has("kept"), false);
});

test("a failed first load reports an error; a failed refresh keeps the totals shown", async () => {
  let fail = true;
  const api: VoteApi = {
    ...fakeApi().api,
    fetchScores: async () => {
      if (fail) throw new TypeError("Failed to fetch");
      return [{ menu_key: "a", votes: 3, total: 24, at: 1 }];
    },
  };
  const s = store(api);
  await s.loadScores();
  assert.equal(s.getScores().status, "error");
  assert.equal(s.getScores().allFailed, true);
  assert.equal(s.getScores().all, false);
  fail = false;
  await s.loadScores();
  assert.equal(s.getScores().status, "ready");
  assert.deepEqual([s.getScores().all, s.getScores().allFailed], [true, false]);
  fail = true;
  await s.loadScores();
  assert.equal(s.getScores().status, "ready");
  assert.deepEqual([s.getScores().all, s.getScores().allFailed], [true, false], "still complete, just not refreshed");
  assert.equal(s.getScores().rows.get("a")?.votes, 3);
});

test("one menu's load (a restaurant page) doesn't make the whole board look loaded", async () => {
  let fail = false;
  const api: VoteApi = {
    ...fakeApi().api,
    fetchScores: async (keys) => {
      if (fail) throw new TypeError("Failed to fetch");
      return keys?.includes("a") ? [{ menu_key: "a", votes: 3, total: 24, at: 1 }] : [];
    },
  };
  const s = store(api);
  await s.loadScores(["b"]);
  assert.equal(scoresKnown(s.getScores(), "b"), true, "known, with no votes");
  assert.equal(scoresKnown(s.getScores(), "a"), false);
  assert.equal(s.getScores().all, false);
  fail = true;
  await s.loadScores(["a"]);
  assert.equal(s.getScores().failed.has("a"), true);
  assert.equal(scoresKnown(s.getScores(), "a"), false);
  fail = false;
  await s.loadScores(["a"]);
  assert.equal(s.getScores().failed.has("a"), false);
  assert.equal(s.getScores().rows.get("a")?.votes, 3);
  assert.equal(scoresKnown(s.getScores(), "a"), true);
});

test("disabled (no Supabase settings): nothing is sent or loaded", async () => {
  const f = fakeApi();
  const s = store(f.api, VOTER, false);
  s.vote("due-west", 8);
  await s.loadMine();
  await s.loadScores();
  assert.equal(s.getMine().status, "disabled");
  assert.equal(s.getScores().status, "disabled");
  assert.equal(s.getMine().picked.size, 0);
  assert.deepEqual(f.calls, []);
});

test("invalid picks are ignored before they reach the network", async () => {
  const f = fakeApi();
  const s = store(f.api);
  s.vote("due-west", 11);
  s.vote("due-west", 6.5);
  s.vote("Not A Key", 5);
  await s.settled();
  assert.deepEqual(f.calls, []);
  assert.equal(s.getMine().picked.size, 0);
});

test("snapshots are stable between changes (useSyncExternalStore needs that)", () => {
  const s = store(fakeApi().api);
  assert.equal(s.getMine(), s.getMine());
  assert.equal(s.getScores(), s.getScores());
  assert.equal(s.getServerMine(), s.getMine(), "the prerender snapshot until something happens");
  let heard = 0;
  const off = s.subscribe(() => (heard += 1));
  s.applyScore({ menu_key: "a", votes: 1, total: 5, at: null });
  assert.equal(heard, 1);
  off();
  s.applyScore({ menu_key: "b", votes: 1, total: 5, at: null });
  assert.equal(heard, 1);
});
