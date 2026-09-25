import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { getVoterId, isVoterId, randomVoterId, readVoterId, resetVoterIdForTests, VOTER_KEY, type VoterStorage } from "../src/lib/voter";

/** An in-memory localStorage stand-in; `fail` makes reads and/or writes throw like a blocked store. */
function memoryStorage(fail: { get?: boolean; set?: boolean } = {}): VoterStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key) {
      if (fail.get) throw new DOMException("blocked", "SecurityError");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (fail.set) throw new DOMException("full", "QuotaExceededError");
      data.set(key, value);
    },
  };
}

beforeEach(() => resetVoterIdForTests());

test("a new browser gets a random UUID, stored under burger-index-voter and reused", () => {
  const storage = memoryStorage();
  assert.equal(readVoterId(storage), null, "reading never creates an id");
  const id = getVoterId(storage);
  assert.equal(isVoterId(id), true);
  assert.equal(storage.data.get(VOTER_KEY), id);
  resetVoterIdForTests(); // a new page view: the id comes back from storage
  assert.equal(readVoterId(storage), id);
  assert.equal(getVoterId(storage), id);
});

test("an id already in storage is used as is; junk in storage is replaced", () => {
  const storage = memoryStorage();
  storage.data.set(VOTER_KEY, "8f14e45f-ceea-467a-9575-2b7b1a0c3d11");
  assert.equal(getVoterId(storage), "8f14e45f-ceea-467a-9575-2b7b1a0c3d11");

  resetVoterIdForTests();
  const junk = memoryStorage();
  junk.data.set(VOTER_KEY, "not-a-uuid");
  const id = getVoterId(junk, () => "11111111-2222-4333-8444-555555555555");
  assert.equal(id, "11111111-2222-4333-8444-555555555555");
  assert.equal(junk.data.get(VOTER_KEY), id);
});

test("storage that throws on every access: the id lives in memory for the page view", () => {
  const blocked = memoryStorage({ get: true, set: true });
  let made = 0;
  const make = () => {
    made += 1;
    return "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  };
  const id = getVoterId(blocked, make);
  assert.equal(id, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.equal(getVoterId(blocked, make), id, "same id for the rest of the page view");
  assert.equal(readVoterId(blocked), id);
  assert.equal(made, 1);
});

test("storage that reads but can't write (full): same id for the page view", () => {
  const full = memoryStorage({ set: true });
  const id = getVoterId(full);
  assert.equal(isVoterId(id), true);
  assert.equal(full.data.size, 0);
  assert.equal(getVoterId(full), id);
});

test("no storage at all (null): in-memory fallback", () => {
  const id = getVoterId(null);
  assert.equal(isVoterId(id), true);
  assert.equal(getVoterId(null), id);
  assert.equal(readVoterId(null), id);
});

test("randomVoterId: crypto.randomUUID when present, else a v4 UUID from getRandomValues (or Math.random)", () => {
  assert.equal(randomVoterId({ randomUUID: () => "12345678-1234-4234-8234-123456789abc" }), "12345678-1234-4234-8234-123456789abc");
  const fromBytes = randomVoterId({ getRandomValues: (b: Uint8Array) => b.fill(0xff) });
  assert.equal(fromBytes, "ffffffff-ffff-4fff-bfff-ffffffffffff");
  assert.equal(isVoterId(randomVoterId(undefined)), true);
  assert.equal(isVoterId(randomVoterId({})), true);
  assert.notEqual(randomVoterId(), randomVoterId());
});
