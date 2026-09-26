// The People's Top 10 snapshot writer (scripts/snapshot-peoples-top.mjs): it reads the public aggregates with
// read-only GETs and a public key, runs the Patty Ladder with yesterday's board, keeps to the dataset's menus,
// writes a deterministic file only when it changes, and refuses to publish a doubtful board (stale or missing
// aggregates, an unexplained drop in lists, an unconverged fit), keeping yesterday's. Supabase is faked.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BOARD_PARAMS,
  BOARD_PATH,
  datasetMenuKeys,
  DEFAULT_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_URL,
  emptyBoard,
  fetchBoardInputs,
  fetchVoidsSince,
  INPUTS_FORMAT,
  isPublicKey,
  main,
  ownerWatch,
  parseBoardInputs,
  RAW_DROP,
  readBoardText,
  renderBoard,
} from "../scripts/snapshot-peoples-top.mjs";
import { buildAggregates, computeBoard, PARAMS, type LadderInputs } from "../src/lib/ladder.mjs";
import { pricedMenus } from "../src/lib/menus";
import { loadDataset } from "./dataset";

const DATA = loadDataset();

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

// A small city: 12 restaurants and a 3-location chain; lists name them best first.
const RESTAURANTS = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `spot-${String(i + 1).padStart(2, "0")}`, chain: null, index_price: 15 + i })),
  ...[1, 2, 3].map((i) => ({ id: `jh-${i}`, chain: "jackson-hole", index_price: 16 })),
  { id: "closed-place", chain: null, index_price: null },
];
const MENUS = [...RESTAURANTS.filter((r) => r.index_price !== null).map((r) => (r.chain ? `chain:${r.chain}` : r.id))].filter((k, i, a) => a.indexOf(k) === i).sort();

function cityLists(n: number, seed = 5): string[][] {
  let a = seed;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...MENUS, "gone-burger"]; // a key the dataset no longer has: in the fit, never on the board
  return Array.from({ length: n }, () => {
    const pick = [...pool].sort(() => rnd() - 0.5).slice(0, 3 + Math.floor(rnd() * 5));
    const strength = new Map(pick.map((k) => [k, pool.indexOf(k) + 4 * rnd()]));
    return pick.sort((x, y) => (strength.get(x) as number) - (strength.get(y) as number));
  });
}

/** The rpc/ranker_board_inputs reply for some aggregates (supabase/README.md). */
function rpcBody(inputs: LadderInputs, { countedLists = inputs.totalLists, method = PARAMS.version, refreshedAt = `${inputs.asOf}T04:20:03.1+00:00` } = {}) {
  const items = [...inputs.items].sort((x, y) => (x.key < y.key ? -1 : 1));
  const ix = new Map(items.map((it, i) => [it.key, i]));
  return JSON.stringify({
    format: INPUTS_FORMAT,
    method,
    as_of: inputs.asOf,
    total_lists: inputs.totalLists,
    counted_lists: countedLists,
    weighted_lists: inputs.weightedLists,
    changed_since_last: inputs.totalLists,
    refreshed_at: refreshedAt,
    items: items.map((it) => ({ key: it.key, lists: it.lists, weighted: it.weighted, firsts: it.firsts, networks: it.networks, surging: !!it.surging, surge_support: it.surgeLists ?? 0, held: !!it.held })),
    pairs: inputs.pairs.map((p) => [ix.get(p.a), ix.get(p.b), p.wab, p.wba, p.q]).sort((x, y) => (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number)),
  });
}

/** A fake Supabase: the aggregates (a body, or null before the first publication) and the owner's void log. */
function fakeSupabase(state: { body: string; voids?: Array<{ id: number; day: string; count: number }> }) {
  return fakeFetch((url) => {
    if (url.pathname === "/rest/v1/rpc/ranker_board_inputs") return { status: 200, body: state.body };
    if (url.pathname === "/rest/v1/ranker_actions") {
      const since = (url.searchParams.get("day") ?? "gt.").slice(3);
      return { status: 200, body: (state.voids ?? []).filter((v) => v.day > since) };
    }
    return { status: 404, body: { message: "not found" } };
  });
}

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test" };

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "peoples-top-"));
  const dataset = join(dir, "burger_index.json");
  writeFileSync(dataset, JSON.stringify({ restaurants: RESTAURANTS }));
  const out = join(dir, "peoples_top.json");
  const args = (...more: string[]) => ["--dataset", dataset, "--out", out, ...more];
  return { dir, dataset, out, args, done: () => rmSync(dir, { recursive: true, force: true }) };
}
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

// ---- which menus -----------------------------------------------------------------------------------

test("the board keeps to the dataset's menus: the site's menu keys, a chain once, sorted", () => {
  const keys = datasetMenuKeys(DATA);
  assert.deepEqual(keys, pricedMenus(DATA.restaurants).map((m) => m.key).sort());
  assert.ok(keys.some((k: string) => k.startsWith("chain:")));
  assert.deepEqual(datasetMenuKeys({ restaurants: RESTAURANTS }), MENUS);
  assert.ok(!MENUS.includes("closed-place") && MENUS.includes("chain:jackson-hole"));
});

// ---- the aggregates -----------------------------------------------------------------------------------

test("parseBoardInputs: null before the first publication, the aggregates checked and mapped, anything odd refused", () => {
  assert.equal(parseBoardInputs(null), null);
  const inputs = buildAggregates(cityLists(40), { asOf: "2026-10-01" });
  const raw = JSON.parse(rpcBody(inputs, { countedLists: 41 }));
  const parsed = parseBoardInputs(raw);
  assert.equal(parsed?.asOf, "2026-10-01");
  assert.equal(parsed?.countedLists, 41);
  assert.equal(parsed?.items.length, inputs.items.length);
  assert.deepEqual(
    Object.keys(parsed?.items[0] ?? {}),
    ["key", "lists", "weighted", "firsts", "networks", "surging", "surgeLists", "held"],
    "surge_support becomes computeBoard's surgeLists",
  );
  const byKey = new Map(inputs.pairs.map((p) => [`${p.a}|${p.b}`, p]));
  for (const p of parsed?.pairs ?? []) assert.deepEqual(p, byKey.get(`${p.a}|${p.b}`), "pairs by key, a < b");
  const bad: Array<[string, (r: typeof raw) => void, RegExp]> = [
    ["format", (r) => (r.format = "patty-ladder-inputs/2"), /format/],
    ["method", (r) => (r.method = "patty-ladder/2"), /method/],
    ["as_of", (r) => (r.as_of = "yesterday"), /as_of/],
    ["counts", (r) => (r.total_lists = r.counted_lists + 1), /list counts/],
    ["unsorted", (r) => r.items.reverse(), /not sorted/],
    ["key", (r) => (r.items[0].key = "Due West"), /key/],
    ["weighted", (r) => (r.items[0].weighted = "3"), /counts/],
    ["flags", (r) => (r.items[0].held = null), /flags/],
    ["pair index", (r) => (r.pairs[0] = [3, 3, 1, 1, 1]), /indexes/],
    ["pair weight", (r) => (r.pairs[0][2] = -1), /weights/],
    ["shape", (r) => delete r.pairs, /items \/ pairs/],
  ];
  for (const [name, spoil, why] of bad) {
    const copy = JSON.parse(JSON.stringify(raw));
    spoil(copy);
    assert.throws(() => parseBoardInputs(copy), why, name);
  }
  assert.throws(() => parseBoardInputs([]), /not an object/);
});

test("fetchBoardInputs and fetchVoidsSince: read-only GETs with the key as apikey, no body", async () => {
  const body = rpcBody(buildAggregates(cityLists(10), { asOf: "2026-10-01" }));
  const { fn, calls } = fakeSupabase({ body, voids: [{ id: 1, day: "2026-10-01", count: 4 }, { id: 2, day: "2026-10-02", count: 3 }, { id: 3, day: "2026-10-03", count: 2 }] });
  const read = await fetchBoardInputs({ url: "https://example.supabase.co/", key: "sb_publishable_test", fetch: fn });
  assert.equal(read.body, body, "the body exactly as sent");
  assert.equal(await fetchVoidsSince({ url: "https://example.supabase.co", key: "sb_publishable_test", sinceDay: "2026-10-01", fetch: fn }), 5);
  assert.equal(calls[0].url.href, "https://example.supabase.co/rest/v1/rpc/ranker_board_inputs");
  assert.equal(calls[1].url.pathname, "/rest/v1/ranker_actions");
  assert.equal(calls[1].url.searchParams.get("action"), "eq.void");
  assert.equal(calls[1].url.searchParams.get("day"), "gt.2026-10-01");
  for (const { init } of calls) {
    assert.equal(init.method, "GET");
    assert.deepEqual(init.headers, { apikey: "sb_publishable_test", Accept: "application/json" });
    assert.ok(!("body" in init), "no request body");
  }
  const denied = fakeFetch(() => ({ status: 401, body: { message: "Invalid API key" } }));
  await assert.rejects(fetchBoardInputs({ url: "https://x.supabase.co", key: "k", fetch: denied.fn, retryDelayMs: 0 }), /answered 401/);
  assert.equal(denied.calls.length, 1, "a client error is not retried");
  const flaky = fakeFetch((_, n) => (n === 1 ? { status: 503, body: "" } : { status: 200, body: "null" }));
  assert.equal((await fetchBoardInputs({ url: "https://x.supabase.co", key: "k", fetch: flaky.fn, retryDelayMs: 0 })).raw, null);
  const html = fakeFetch(() => ({ status: 200, body: "<html>" }));
  await assert.rejects(fetchBoardInputs({ url: "https://x.supabase.co", key: "k", fetch: html.fn, retryDelayMs: 0 }), /did not answer with JSON/);
});

test("only a public key: the publishable key or an anon JWT, never a secret or service_role key", () => {
  const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
  assert.equal(isPublicKey(DEFAULT_PUBLISHABLE_KEY), true);
  assert.equal(isPublicKey(jwt("anon")), true);
  assert.equal(isPublicKey(jwt("service_role")), false);
  assert.equal(isPublicKey("sb_secret_abc"), false);
  assert.match(DEFAULT_SUPABASE_URL, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
});

// ---- the file ---------------------------------------------------------------------------------------

test("the file: fixed key order, two-space JSON, one row per line, read back exactly", () => {
  const empty = renderBoard(emptyBoard());
  assert.ok(empty.endsWith("}\n") && !empty.endsWith("\n\n"));
  assert.deepEqual(Object.keys(JSON.parse(empty)), ["version", "method", "params", "asOf", "refreshedAt", "inputsSha256", "totalLists", "countedLists", "weightedLists", "gate", "early", "iterations", "top10", "computed10", "rows"]);
  assert.deepEqual(readBoardText(empty), JSON.parse(empty));
  const board = computeBoard(buildAggregates(cityLists(60), { asOf: "2026-10-01" }), null);
  const snap = { ...emptyBoard(), ...board, params: BOARD_PARAMS, countedLists: 60, refreshedAt: "x", inputsSha256: "0".repeat(64) };
  const text = renderBoard(snap);
  const lines = text.split("\n");
  assert.equal(lines.filter((l) => l.startsWith('    {"key":')).length, board.rows.length, "one line per row");
  assert.equal(renderBoard(readBoardText(text)), text);
  assert.equal(renderBoard({ ...snap, rows: snap.rows.map((r) => Object.fromEntries(Object.entries(r).reverse())) }), text, "row keys in a fixed order");
  for (const bad of [null, "", "nope", "[]", empty.replace('"version": 1', '"version": 2'), empty.replace('"asOf": null', '"asOf": "Oct 1"'), empty.replace('"rows": []', '"rows": [{"key":"x","tier":"top","theta":0,"score":null}]'), empty.replace('"rows": []', '"rows": [{"key":"x","tier":"ranked","theta":0,"score":null}]')]) {
    assert.equal(readBoardText(bad), null, String(bad).slice(0, 60));
  }
});

test("the committed data/peoples_top.json is a board in the writer's canonical form, with the dataset's burgers only", () => {
  const text = readFileSync(BOARD_PATH, "utf8");
  const board = readBoardText(text);
  assert.ok(board, "a version-1 board");
  assert.equal(renderBoard(board), text);
  assert.equal(board.method, PARAMS.version);
  assert.deepEqual(board.params, BOARD_PARAMS);
  const keys = new Set(datasetMenuKeys(DATA));
  const ranked = new Set(board.rows.filter((r: { tier: string }) => r.tier === "ranked").map((r: { key: string }) => r.key));
  for (const r of board.rows) assert.ok(keys.has(r.key), r.key);
  for (const k of board.top10) assert.ok(ranked.has(k), k);
  if (board.asOf === null) assert.equal(text, renderBoard(emptyBoard()), "before the first publication: the empty early board");
});

// ---- main -----------------------------------------------------------------------------------------

test("main: the empty early board before the first publication, then the day's board, only the dataset's burgers, the input dump and its hash", async () => {
  const box = sandbox();
  try {
    const supa = { body: "null" };
    const { fn, calls } = fakeSupabase(supa);
    assert.deepEqual(await quietly(() => main(box.args(), ENV, fn)), { changed: true, asOf: null });
    assert.equal(readFileSync(box.out, "utf8"), renderBoard(emptyBoard()));
    assert.deepEqual(await quietly(() => main(box.args(), ENV, fn)), { changed: false, asOf: null });

    const lists = cityLists(80);
    const inputs = buildAggregates(lists, { asOf: "2026-10-01" });
    supa.body = rpcBody(inputs, { countedLists: 82 });
    const dump = join(box.dir, "inputs.json");
    assert.deepEqual(await quietly(() => main(box.args("--inputs-out", dump), ENV, fn)), { changed: true, asOf: "2026-10-01" });
    const board = JSON.parse(readFileSync(box.out, "utf8"));
    assert.equal(readFileSync(dump, "utf8"), supa.body, "the dump is the body as read");
    assert.equal(board.inputsSha256, createHash("sha256").update(supa.body).digest("hex"));
    assert.deepEqual([board.asOf, board.totalLists, board.countedLists, board.refreshedAt, board.early], ["2026-10-01", 80, 82, "2026-10-01T04:20:03.1+00:00", true]);
    assert.ok(board.rows.length > 0 && board.rows.every((r: { key: string }) => MENUS.includes(r.key)), "no row for a key the dataset doesn't have");
    // the same board as computeBoard on those aggregates, with the stray key hidden (it stays in the fit)
    const direct = computeBoard({ ...inputs, hidden: ["gone-burger"] }, null);
    assert.deepEqual(board.top10, direct.top10);
    assert.deepEqual(board.rows, direct.rows.filter((r) => r.key !== "gone-burger"));
    assert.ok(calls.every((c) => c.init.method === "GET"));

    // the same aggregates tomorrow (quiet day, nothing published): nothing to do, nothing written
    const before = readFileSync(box.out, "utf8");
    const n = calls.length;
    assert.deepEqual(await quietly(() => main(box.args(), ENV, fn)), { changed: false, asOf: "2026-10-01" });
    assert.equal(readFileSync(box.out, "utf8"), before);
    assert.equal(calls.length, n + 1, "one read, no void lookup");

    // the next publication moves the board on from yesterday's
    const more = buildAggregates([...lists, ...cityLists(30, 9)], { asOf: "2026-10-02" });
    supa.body = rpcBody(more, { countedLists: 112 });
    await quietly(() => main(box.args(), ENV, fn));
    const day2 = JSON.parse(readFileSync(box.out, "utf8"));
    assert.equal(day2.asOf, "2026-10-02");
    const expected = computeBoard({ ...more, hidden: ["gone-burger"] }, board);
    assert.deepEqual(day2.top10, expected.top10);
    assert.deepEqual(day2.rows, expected.rows.filter((r) => r.key !== "gone-burger"));
  } finally {
    box.done();
  }
});

test("main is deterministic: the same aggregates and the same yesterday give the same bytes", async () => {
  const a = sandbox();
  const b = sandbox();
  try {
    const body1 = rpcBody(buildAggregates(cityLists(70), { asOf: "2026-10-01" }));
    const body2 = rpcBody(buildAggregates(cityLists(95), { asOf: "2026-10-03" }));
    for (const box of [a, b]) {
      await quietly(() => main(box.args(), ENV, fakeSupabase({ body: body1 }).fn));
      await quietly(() => main(box.args(), ENV, fakeSupabase({ body: body2 }).fn));
    }
    assert.equal(readFileSync(a.out, "utf8"), readFileSync(b.out, "utf8"));
  } finally {
    a.done();
    b.done();
  }
});

test("main refuses to publish a doubtful board and keeps yesterday's", async () => {
  const box = sandbox();
  try {
    const lists = cityLists(100);
    await quietly(() => main(box.args(), ENV, fakeSupabase({ body: rpcBody(buildAggregates(lists, { asOf: "2026-10-05" })) }).fn));
    const yesterday = readFileSync(box.out, "utf8");
    const refuse = async (body: string, why: RegExp, extra: { voids?: Array<{ id: number; day: string; count: number }>; argv?: string[]; params?: typeof PARAMS } = {}) => {
      await assert.rejects(quietly(() => main(box.args(...(extra.argv ?? [])), ENV, fakeSupabase({ body, voids: extra.voids }).fn, { params: extra.params, retryDelayMs: 0 })), why);
      assert.equal(readFileSync(box.out, "utf8"), yesterday, `${why}: yesterday's board stays`);
    };
    // aggregates older than the board, or none at all after a board was published
    await refuse(rpcBody(buildAggregates(lists, { asOf: "2026-10-04" })), /older than the committed board/);
    await refuse("null", /refusing to replace it/);
    // another method's aggregates, an odd reply, a failed read
    await refuse(rpcBody(buildAggregates(lists, { asOf: "2026-10-06" }), { method: "patty-ladder/2" }), /method/);
    await refuse('{"format":"patty-ladder-inputs/1"}', /doesn't check out/);
    await assert.rejects(quietly(() => main(box.args(), ENV, fakeFetch(() => ({ status: 500, body: "down" })).fn, { retryDelayMs: 0 })), /answered 500/);
    // the lists fell by more than 20% with no logged voids
    const fewer = rpcBody(buildAggregates(lists.slice(0, 70), { asOf: "2026-10-06" }));
    await refuse(fewer, /fell from 100 to 70/);
    await refuse(fewer, /fell from 100 to 70/, { voids: [{ id: 1, day: "2026-10-05", count: 30 }] }); // voided before the board: already in it
    // a fit that doesn't converge
    await refuse(rpcBody(buildAggregates(lists, { asOf: "2026-10-06" })), /did not converge.*yesterday's board stays/, { params: { ...PARAMS, tol: -1 } });

    // voids logged since the board explain the drop; so does --allow-drop
    assert.equal((await quietly(() => main(box.args(), ENV, fakeSupabase({ body: fewer, voids: [{ id: 2, day: "2026-10-06", count: 25 }] }).fn))).changed, true);
    writeFileSync(box.out, yesterday);
    assert.equal((await quietly(() => main(box.args("--allow-drop"), ENV, fakeSupabase({ body: fewer }).fn))).changed, true);
    writeFileSync(box.out, yesterday);
    // a drop of 20% or less is fine
    assert.equal((await quietly(() => main(box.args(), ENV, fakeSupabase({ body: rpcBody(buildAggregates(lists.slice(0, 80), { asOf: "2026-10-06" })) }).fn))).changed, true);
  } finally {
    box.done();
  }
});

test("main refuses a secret key, an unreadable or another method's board, and a dataset with no menus", async () => {
  const box = sandbox();
  try {
    const { fn, calls } = fakeSupabase({ body: "null" });
    await assert.rejects(main(box.args(), { ...ENV, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_x" }, fn), /publishable/);
    writeFileSync(box.out, "{ not json");
    await assert.rejects(main(box.args(), ENV, fn), /not a People's Top 10 board/);
    writeFileSync(box.out, renderBoard({ ...emptyBoard(), method: "patty-ladder/0" }));
    await assert.rejects(main(box.args(), ENV, fn), /deliberate restart/);
    assert.equal(calls.length, 0, "nothing is read before the checks pass");
    rmSync(box.out);
    writeFileSync(box.dataset, JSON.stringify({ restaurants: [{ id: "x", chain: null, index_price: null }] }));
    await assert.rejects(main(box.args(), ENV, fn), /no priced menus/);
    assert.equal(existsSync(box.out), false);
  } finally {
    box.done();
  }
});

test("the owner's watch: a raw score down more than 0.5 since the committed board, and phi at the flag level, as GitHub warnings", () => {
  assert.equal(RAW_DROP, 0.5);
  const row = (key: string, raw: number, phi = 1) => ({ key, raw, phi, inconsistent: phi >= PARAMS.phiFlag });
  const prev = { asOf: "2026-10-01", rows: [row("spot-01", 1.2), row("spot-02", 0.4), row("spot-03", 0.9), row("spot-05", 0.2)] };
  const today = { rows: [row("spot-01", 0.75), row("spot-02", -0.2, 2.7), row("spot-03", 0.35), row("spot-04", -3)] };
  assert.deepEqual(ownerWatch(prev, today), [
    "::warning title=Burial watch::spot-02 raw 0.400 -> -0.200 since 2026-10-01",
    "::warning title=Burial watch::spot-03 raw 0.900 -> 0.350 since 2026-10-01",
    "::warning title=Inconsistent record::spot-02 phi 2.700 (flag at 2.5)",
  ]);
  // a drop of exactly 0.5, a burger new to the board, the first board: no burial watch
  assert.deepEqual(ownerWatch({ asOf: "2026-10-01", rows: [row("spot-01", 1)] }, { rows: [row("spot-01", 0.5)] }), []);
  assert.deepEqual(ownerWatch(null, today), ["::warning title=Inconsistent record::spot-02 phi 2.700 (flag at 2.5)"]);
});

test("main prints the owner's watch for the new board", async () => {
  const box = sandbox();
  try {
    const lists = cityLists(90);
    await quietly(() => main(box.args(), ENV, fakeSupabase({ body: rpcBody(buildAggregates(lists, { asOf: "2026-10-01" })) }).fn));
    // yesterday's raw score of one burger set well above today's: it is on the watch
    const board = JSON.parse(readFileSync(box.out, "utf8"));
    const target = board.rows[0];
    writeFileSync(box.out, renderBoard({ ...board, rows: board.rows.map((r: { key: string; raw: number }) => (r.key === target.key ? { ...r, raw: r.raw + 5 } : r)) }));
    const printed: string[] = [];
    const log = console.log;
    console.log = (line: string) => void printed.push(String(line));
    try {
      await main(box.args(), ENV, fakeSupabase({ body: rpcBody(buildAggregates([...lists, ...cityLists(25, 11)], { asOf: "2026-10-02" })) }).fn);
    } finally {
      console.log = log;
    }
    const burial = printed.filter((l) => l.startsWith(`::warning title=Burial watch::${target.key} raw `));
    assert.equal(burial.length, 1, printed.join("\n"));
    assert.match(burial[0], /raw -?[0-9.]+ -> -?[0-9.]+ since 2026-10-01$/);
  } finally {
    box.done();
  }
});
