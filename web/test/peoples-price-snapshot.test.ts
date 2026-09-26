// The People's Price snapshot writer (scripts/snapshot-peoples-price.mjs): which menus it asks for, what it
// writes, that the file is deterministic and only rewritten when the numbers change, and that it only ever
// makes read-only GETs of burger_worth_hist with a public key. Supabase is faked; nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  datasetMenuKeys,
  DEFAULT_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_URL,
  fetchHistRows,
  histMedian,
  isPublicKey,
  KEY_BATCH,
  main,
  nextSnapshot,
  PAGE_SIZE,
  parseRow,
  readSnapshotText,
  renderSnapshot,
  SNAPSHOT_PATH,
  snapshotMenus,
  stamp,
} from "../scripts/snapshot-peoples-price.mjs";
import { pricedMenus } from "../src/lib/menus";
import { histMedian as siteHistMedian } from "../src/lib/worth";
import { loadDataset } from "./dataset";

const DATA = loadDataset();

type Row = { menu_key: string; dollars: number; votes: number };
const row = (menu_key: string, dollars: number, votes = 1): Row => ({ menu_key, dollars, votes });

/** A fake fetch: records every call and answers from `reply` (a function of the URL). */
function fakeFetch(reply: (url: URL, n: number) => { status: number; body: unknown }) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fn = async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status, body } = reply(url, calls.length);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fn: fn as typeof fetch, calls };
}

/** The menu keys a request asked for, from its `menu_key=in.("a","b")` filter. */
function askedKeys(url: URL): string[] {
  const m = /^in\.\((.*)\)$/.exec(url.searchParams.get("menu_key") ?? "");
  return m ? m[1].split(",").map((k) => JSON.parse(k)) : [];
}

// ---- which menus -----------------------------------------------------------------------------------

test("the snapshot asks for the dataset's menus: the site's menu keys, a chain once, sorted", () => {
  const keys = datasetMenuKeys(DATA);
  const site = pricedMenus(DATA.restaurants).map((m) => m.key);
  assert.deepEqual(keys, [...site].sort());
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.some((k: string) => k.startsWith("chain:")), "chains are one key each");
  assert.ok(keys.length > 100);
  // Unpriced restaurants have no menu.
  assert.deepEqual(datasetMenuKeys({ restaurants: [{ id: "x", index_price: null }, { id: "y", chain: null, index_price: 12 }, { id: "z", chain: "jh", index_price: 9 }] }), ["chain:jh", "y"]);
});

// ---- rows -> menus --------------------------------------------------------------------------------

test("parseRow keeps well-formed cells only (a menu key, a whole dollar answer from $5 to $75, a whole count)", () => {
  assert.deepEqual(parseRow({ menu_key: "due-west", dollars: 20, votes: 3, updated_at: "x" }), row("due-west", 20, 3));
  assert.deepEqual(parseRow({ menu_key: "chain:7th-street-burger", dollars: 75, votes: 0 }), row("chain:7th-street-burger", 75, 0));
  for (const bad of [
    null,
    "row",
    { menu_key: "Due West", dollars: 20, votes: 1 },
    { menu_key: "due-west", dollars: 4, votes: 1 },
    { menu_key: "due-west", dollars: 76, votes: 1 },
    { menu_key: "due-west", dollars: 19.5, votes: 1 },
    { menu_key: "due-west", dollars: "20", votes: 1 },
    { menu_key: "due-west", dollars: 20, votes: -1 },
    { menu_key: "due-west", dollars: 20, votes: 1.5 },
  ]) {
    assert.equal(parseRow(bad), null, JSON.stringify(bad));
  }
});

test("histMedian agrees with the site's (percentile_cont(0.5)) on every shape", () => {
  const cases: Array<Record<string, number>> = [{ "20": 1 }, { "20": 1, "30": 1 }, { "10": 2, "12": 1, "40": 1 }, { "5": 3, "75": 3 }, { "18": 2, "22": 5, "30": 1 }];
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) {
    const h: Record<string, number> = {};
    for (let j = 0; j < 1 + Math.floor(rand() * 6); j++) h[String(5 + Math.floor(rand() * 71))] = 1 + Math.floor(rand() * 4);
    cases.push(h);
  }
  for (const h of cases) {
    const site = siteHistMedian(Object.entries(h).map(([d, n]) => [Number(d), n] as [number, number]));
    assert.equal(histMedian(h), site, JSON.stringify(h));
  }
  assert.equal(histMedian({}), null);
});

test("snapshotMenus: the dataset's answered menus only, keys sorted, answers ascending, count and median", () => {
  const menus = snapshotMenus(
    [row("zeta", 30), row("alpha", 22, 2), row("alpha", 18), row("gone-restaurant", 40, 5), row("chain:jh", 12, 0), row("alpha", 30), row("chain:jh", 15, 3)],
    ["alpha", "chain:jh", "zeta", "never-answered"],
  );
  assert.deepEqual(Object.keys(menus), ["alpha", "chain:jh", "zeta"]);
  assert.deepEqual(menus.alpha, { answers: 4, median: 22, hist: { "18": 1, "22": 2, "30": 1 } });
  assert.deepEqual(Object.keys(menus.alpha.hist), ["18", "22", "30"]);
  assert.deepEqual(menus["chain:jh"], { answers: 3, median: 15, hist: { "15": 3 } }, "an empty cell is left out");
  assert.deepEqual(menus.zeta, { answers: 1, median: 30, hist: { "30": 1 } });
  assert.equal(snapshotMenus([row("x", 20), row("x", 25)], ["x"]).x.median, 22.5, "the exact median, not rounded");
});

// ---- the file ---------------------------------------------------------------------------------------

test("renderSnapshot is deterministic: fixed key order, two-space JSON, a final newline", () => {
  const a = renderSnapshot({ generatedAt: "2026-09-26T09:00:04Z", menus: { b: { answers: 2, median: 21, hist: { "22": 1, "20": 1 } }, a: { answers: 1, median: 9, hist: { "9": 1 } } } });
  const b = renderSnapshot({ generatedAt: "2026-09-26T09:00:04Z", menus: { a: { hist: { "9": 1 }, median: 9, answers: 1 }, b: { median: 21, answers: 2, hist: { "20": 1, "22": 1 } } } });
  assert.equal(a, b);
  assert.ok(a.endsWith("}\n") && !a.endsWith("\n\n"));
  assert.deepEqual(Object.keys(JSON.parse(a)), ["version", "generated_at", "menus"]);
  assert.deepEqual(Object.keys(JSON.parse(a).menus), ["a", "b"]);
  assert.match(a, /^\{\n {2}"version": 1,\n {2}"generated_at": "2026-09-26T09:00:04Z",/);
  assert.equal(stamp(new Date("2026-09-26T09:00:04.123Z")), "2026-09-26T09:00:04Z");
});

test("readSnapshotText: a version-1 snapshot, or null", () => {
  assert.deepEqual(readSnapshotText(renderSnapshot({ generatedAt: null, menus: {} })), { generatedAt: null, menus: {} });
  for (const bad of [null, "", "not json", "[]", '{"version":2,"generated_at":null,"menus":{}}', '{"version":1,"generated_at":5,"menus":{}}', '{"version":1,"generated_at":null,"menus":[]}']) {
    assert.equal(readSnapshotText(bad), null, String(bad));
  }
});

test("nextSnapshot rewrites the file only when the numbers change, keeping generated_at otherwise", () => {
  const menus = snapshotMenus([row("a", 20), row("a", 24), row("b", 30)], ["a", "b"]);
  const first = nextSnapshot(null, menus, new Date("2026-09-26T09:00:04Z"));
  assert.equal(first.changed, true);
  assert.equal(JSON.parse(first.text).generated_at, "2026-09-26T09:00:04Z");

  // The same numbers a day later (rows in another order): nothing to write, the old date stays.
  const again = nextSnapshot(first.text, snapshotMenus([row("b", 30), row("a", 24), row("a", 20)], ["a", "b"]), new Date("2026-09-27T09:00:00Z"));
  assert.deepEqual(again, { changed: false, text: first.text });

  // One more answer: a new file, a new date.
  const changed = nextSnapshot(first.text, snapshotMenus([row("a", 20), row("a", 24), row("b", 30), row("b", 31)], ["a", "b"]), new Date("2026-09-28T09:00:00Z"));
  assert.equal(changed.changed, true);
  assert.equal(JSON.parse(changed.text).generated_at, "2026-09-28T09:00:00Z");
  assert.deepEqual(JSON.parse(changed.text).menus.b, { answers: 2, median: 30.5, hist: { "30": 1, "31": 1 } });

  // Anything that isn't a dated snapshot is replaced, even with no answers at all.
  const empty = renderSnapshot({ generatedAt: null, menus: {} });
  assert.equal(nextSnapshot(empty, {}, new Date("2026-09-26T09:00:00Z")).changed, true, "an undated (empty) snapshot gets a date");
  assert.equal(nextSnapshot("garbage", menus, new Date()).changed, true);
  assert.equal(nextSnapshot('{"version":1,"generated_at":"2026-09-26T09:00:04Z","menus":{"a":{}}}', menus, new Date()).changed, true, "a malformed old file");
  // An answer removed (a reset) is a change too.
  assert.equal(nextSnapshot(first.text, {}, new Date()).changed, true);
});

test("the committed data/peoples_price.json is a snapshot in the writer's own canonical form", () => {
  const textNow = readFileSync(SNAPSHOT_PATH, "utf8");
  const parsed = readSnapshotText(textNow);
  assert.ok(parsed, "a version-1 snapshot");
  assert.ok(parsed.generatedAt === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(parsed.generatedAt));
  assert.equal(renderSnapshot(parsed), textNow, "sorted keys, two-space JSON, final newline");
  for (const [key, m] of Object.entries(parsed.menus) as Array<[string, { answers: number; median: number; hist: Record<string, number> }]>) {
    assert.equal(m.answers, Object.values(m.hist).reduce((s, n) => s + n, 0), key);
    assert.equal(m.median, histMedian(m.hist), key);
  }
});

// ---- reading the table ---------------------------------------------------------------------------

test("fetchHistRows: read-only GETs of burger_worth_hist with the key as apikey, 100 menus per request", async () => {
  const keys = Array.from({ length: 250 }, (_, i) => `menu-${String(i).padStart(3, "0")}`);
  const { fn, calls } = fakeFetch((url) => ({ status: 200, body: askedKeys(url).slice(0, 2).map((k) => ({ menu_key: k, dollars: 20, votes: 1 })) }));
  const rows = await fetchHistRows({ url: "https://example.supabase.co/", key: "sb_publishable_test", keys, fetch: fn, warn: () => {} });
  assert.equal(calls.length, 3);
  for (const { url, init } of calls) {
    assert.equal(init.method, "GET");
    assert.equal(url.origin + url.pathname, "https://example.supabase.co/rest/v1/burger_worth_hist");
    assert.equal(url.searchParams.get("select"), "menu_key,dollars,votes");
    assert.deepEqual(init.headers, { apikey: "sb_publishable_test", Accept: "application/json" });
    assert.ok(!("body" in init), "no request body");
    assert.ok(askedKeys(url).length <= KEY_BATCH);
  }
  assert.deepEqual(calls.flatMap((c) => askedKeys(c.url)), keys, "every key once, in batches");
  assert.equal(rows.length, 6);
});

test("fetchHistRows pages through a full page, skips rows that don't check out, and fails loudly", async () => {
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ menu_key: "busy", dollars: 5 + (i % 71), votes: 1 }));
  const { fn, calls } = fakeFetch((url) => ({ status: 200, body: url.searchParams.get("offset") === "0" ? full : [{ menu_key: "busy", dollars: 99, votes: 1 }, { menu_key: "busy", dollars: 40, votes: 2 }] }));
  const warned: string[] = [];
  const rows = await fetchHistRows({ url: "https://example.supabase.co", key: "k", keys: ["busy"], fetch: fn, warn: (m: string) => warned.push(m) });
  assert.deepEqual(calls.map((c) => c.url.searchParams.get("offset")), ["0", String(PAGE_SIZE)]);
  assert.equal(rows.length, PAGE_SIZE + 1);
  assert.equal(warned.length, 1, "the $99 row is skipped with a warning");

  const notList = fakeFetch(() => ({ status: 200, body: { message: "hi" } }));
  await assert.rejects(fetchHistRows({ url: "https://x.supabase.co", key: "k", keys: ["a"], fetch: notList.fn }), /did not answer with a list/);

  // A client error is not retried; a server error is, then gives up.
  const denied = fakeFetch(() => ({ status: 401, body: { message: "Invalid API key" } }));
  await assert.rejects(fetchHistRows({ url: "https://x.supabase.co", key: "k", keys: ["a"], fetch: denied.fn, retryDelayMs: 0 }), /answered 401/);
  assert.equal(denied.calls.length, 1);
  const down = fakeFetch(() => ({ status: 503, body: "busy" }));
  await assert.rejects(fetchHistRows({ url: "https://x.supabase.co", key: "k", keys: ["a"], fetch: down.fn, retryDelayMs: 0 }), /answered 503/);
  assert.equal(down.calls.length, 3);
  const flaky = fakeFetch((_, n) => (n === 1 ? { status: 502, body: "" } : { status: 200, body: [{ menu_key: "a", dollars: 20, votes: 1 }] }));
  assert.equal((await fetchHistRows({ url: "https://x.supabase.co", key: "k", keys: ["a"], fetch: flaky.fn, retryDelayMs: 0 })).length, 1);
});

test("only a public key: the publishable key or an anon JWT, never a secret or service_role key", () => {
  const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
  assert.equal(isPublicKey(DEFAULT_PUBLISHABLE_KEY), true);
  assert.equal(isPublicKey(jwt("anon")), true);
  assert.equal(isPublicKey(jwt("service_role")), false);
  assert.equal(isPublicKey("sb_secret_abc"), false);
  assert.equal(isPublicKey("whatever"), false);
  assert.match(DEFAULT_SUPABASE_URL, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
});

test("main: writes the snapshot, leaves it alone when nothing changed, and never writes after a failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "peoples-price-"));
  const quiet = console.log;
  console.log = () => {};
  try {
    const dataset = join(dir, "burger_index.json");
    const out = join(dir, "peoples_price.json");
    writeFileSync(
      dataset,
      JSON.stringify({ restaurants: [{ id: "due-west", chain: null, index_price: 18 }, { id: "jh-1", chain: "jackson-hole", index_price: 15 }, { id: "jh-2", chain: "jackson-hole", index_price: 15 }] }),
    );
    let answers = [row("due-west", 20), row("due-west", 22), row("chain:jackson-hole", 18), row("someone-else", 40)];
    const { fn, calls } = fakeFetch((url) => ({ status: 200, body: answers.filter((r) => askedKeys(url).includes(r.menu_key)) }));
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test" };

    assert.deepEqual(await main(["--dataset", dataset, "--out", out], env, fn), { changed: true });
    assert.deepEqual(askedKeys(calls[0].url), ["chain:jackson-hole", "due-west"]);
    const first = readFileSync(out, "utf8");
    assert.deepEqual(Object.keys(JSON.parse(first).menus), ["chain:jackson-hole", "due-west"], "only the dataset's menus");

    assert.deepEqual(await main(["--dataset", dataset, "--out", out], env, fn), { changed: false });
    assert.equal(readFileSync(out, "utf8"), first, "byte for byte");

    answers = [...answers, row("due-west", 30)];
    assert.deepEqual(await main(["--dataset", dataset, "--out", out], env, fn), { changed: true });
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")).menus["due-west"], { answers: 3, median: 22, hist: { "20": 1, "22": 1, "30": 1 } });

    const before = readFileSync(out, "utf8");
    const broken = fakeFetch(() => ({ status: 401, body: "no" }));
    await assert.rejects(main(["--dataset", dataset, "--out", out], env, broken.fn), /401/);
    assert.equal(readFileSync(out, "utf8"), before, "a failed read writes nothing");
    await assert.rejects(main(["--dataset", dataset, "--out", out], { ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_x" }, fn), /publishable/);
    writeFileSync(dataset, JSON.stringify({ restaurants: [] }));
    await assert.rejects(main(["--dataset", dataset, "--out", out], env, fn), /no priced menus/);
    assert.equal(readFileSync(out, "utf8"), before);
  } finally {
    console.log = quiet;
    rmSync(dir, { recursive: true, force: true });
  }
});
