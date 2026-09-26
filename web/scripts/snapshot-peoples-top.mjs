#!/usr/bin/env node
// The People's Top 10 snapshot: the Patty Ladder's daily board, committed so the static pages can show it.
//
//   node web/scripts/snapshot-peoples-top.mjs                       # writes ../data/peoples_top.json (repo root: data/)
//   node web/scripts/snapshot-peoples-top.mjs --out PATH            # somewhere else (also read as yesterday's board)
//   node web/scripts/snapshot-peoples-top.mjs --inputs-out PATH     # also save the exact aggregates read (the audit dump)
//   node web/scripts/snapshot-peoples-top.mjs --allow-drop          # publish even though the lists fell by more than 20%
//
// Reads the aggregates the database publishes each night (GET /rest/v1/rpc/ranker_board_inputs, plus
// GET /rest/v1/ranker_actions for logged voids when the lists fell) with the project's PUBLISHABLE key: GET requests
// only, never a write. Runs computeBoard (src/lib/ladder.mjs, the Patty Ladder) on them with yesterday's board (the
// file as it is) as its only history, and writes the new board. The URL and key come from NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY when set, else the public defaults below (both public by design; the database lets
// that key read the public aggregates and nothing else of the ranker).
//
// It never publishes a doubtful board. Each of these exits 1, writes nothing and keeps yesterday's board:
//   - a failed or odd read (an error status, a reply that isn't the aggregates, another method's aggregates);
//   - aggregates older than the committed board, or none at all after a board was published;
//   - the counted lists fell by more than 20% since the committed board, beyond the lists the owner's logged voids
//     account for (unless --allow-drop: the workflow's manual `allow_drop`, for a reset or a real mass removal);
//   - a fit that did not converge (LadderFitError).
// Aggregates as of the committed board's day are normal (the database publishes only when 20 lists changed): nothing
// to do, exit 0. Before the first publication the file is the empty early board.
//
// The owner's watch (FINAL.md section 6: the review flags that need the fit; the database's review queue has the
// rest): each new board also prints GitHub warning lines, shown as annotations on the job's run, for a burger whose
// raw score fell more than 0.5 since the committed board ("Burial watch") and for phi at or above 2.5 ("Inconsistent
// record"). They change nothing on the board.
//
// The file (CLAUDE.md "People's Top 10 snapshot"): method, params, asOf, refreshedAt, inputsSha256 (SHA-256 of the
// aggregates' response body, the --inputs-out dump), totalLists / countedLists / weightedLists, gate, early,
// iterations, top10, computed10 and one row per burger in the fit that the dataset has (ranked, then rising, then
// listed). Keys in the fit that the dataset doesn't have (a closed restaurant, a mistyped key) stay in the fit and
// never reach the file. Deterministic: the same aggregates and the same yesterday give the same bytes (two-space
// JSON, one row per line, a final newline), and the file is only rewritten when it changes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeBoard, LadderFitError, PARAMS, SURGE } from "../src/lib/ladder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const DATASET_PATH = join(ROOT, "data", "burger_index.json");
export const BOARD_PATH = join(ROOT, "data", "peoples_top.json");

/** Public values (supabase/README.md): the project URL and its publishable key, the ones the site ships. */
export const DEFAULT_SUPABASE_URL = "https://wtbtivqubzymhbmijnri.supabase.co";
export const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_3jMcVPRptvGbnoUIzPN6-w_my_QGtX_";

export const BOARD_VERSION = 1;
export const INPUTS_FORMAT = "patty-ladder-inputs/1";
/** The counted lists may fall by at most this share between two boards, beyond the logged voids. */
export const MAX_DROP = 0.2;
/** Same pattern as the database's check on saved keys (save_ranking). */
const MENU_KEY = /^(chain:)?[a-z0-9-]{1,120}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Rows per page of ranker_actions (PostgREST's default cap is 1000). */
export const PAGE_SIZE = 1000;
const TIMEOUT_MS = 60_000;
const ATTEMPTS = 3;

/** The method's parameters as the file records them: the board's (PARAMS) and the database's surge rule. */
export const BOARD_PARAMS = { ...Object.fromEntries(Object.entries(PARAMS).filter(([k]) => k !== "version")), surge: { ...SURGE } };

// ---- the dataset's menus ----------------------------------------------------------------------------

/**
 * Every distinct priced menu's key, sorted: `chain:<slug>` for a chain's locations, else the restaurant id
 * (src/lib/menus.ts menuKey; test/peoples-top-snapshot.test.ts checks they agree). A list can only hold these.
 */
export function datasetMenuKeys(dataset) {
  const keys = new Set();
  for (const r of dataset?.restaurants ?? []) {
    if (r.index_price === null || r.index_price === undefined) continue;
    keys.add(r.chain ? `chain:${r.chain}` : r.id);
  }
  return [...keys].sort();
}

// ---- the aggregates -----------------------------------------------------------------------------------

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isWeight = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * The rpc/ranker_board_inputs reply, checked (supabase/README.md): `null` before the first publication, else
 * `{ asOf, refreshedAt, totalLists, countedLists, weightedLists, changedSinceLast, items, pairs }` with pairs by key.
 * Throws on anything else: a board fitted to half-read or reshaped numbers must not be published.
 */
export function parseBoardInputs(raw) {
  if (raw === null) return null;
  const fail = (why) => {
    throw new Error(`ranker_board_inputs sent something that doesn't check out: ${why}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("not an object");
  if (raw.format !== INPUTS_FORMAT) fail(`format ${JSON.stringify(raw.format)}, expected ${INPUTS_FORMAT}`);
  if (raw.method !== PARAMS.version) {
    fail(`method ${JSON.stringify(raw.method)}, but this board is ${PARAMS.version} (update src/lib/ladder.mjs first)`);
  }
  if (typeof raw.as_of !== "string" || !DATE.test(raw.as_of)) fail(`as_of ${JSON.stringify(raw.as_of)}`);
  if (!isCount(raw.total_lists) || !isCount(raw.counted_lists) || raw.total_lists > raw.counted_lists) fail("list counts");
  if (!isWeight(raw.weighted_lists) || !isCount(raw.changed_since_last)) fail("weighted_lists / changed_since_last");
  if (raw.refreshed_at !== null && typeof raw.refreshed_at !== "string") fail("refreshed_at");
  if (!Array.isArray(raw.items) || !Array.isArray(raw.pairs)) fail("items / pairs");
  const items = raw.items.map((it, i) => {
    if (!it || typeof it !== "object") fail(`item ${i}`);
    const { key, lists, weighted, firsts, networks, surging, surge_support: support, held } = it;
    if (typeof key !== "string" || !MENU_KEY.test(key)) fail(`item ${i} key`);
    if (i > 0 && !(raw.items[i - 1].key < key)) fail(`items not sorted by key at ${i}`);
    if (![lists, firsts, networks, support].every(isCount) || !isWeight(weighted)) fail(`item ${key} counts`);
    if (typeof surging !== "boolean" || typeof held !== "boolean") fail(`item ${key} flags`);
    return { key, lists, weighted, firsts, networks, surging, surgeLists: support, held };
  });
  const pairs = raw.pairs.map((p, n) => {
    if (!Array.isArray(p) || p.length !== 5) fail(`pair ${n}`);
    const [i, j, wab, wba, q] = p;
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j >= items.length || !(i < j)) fail(`pair ${n} indexes`);
    if (![wab, wba, q].every(isWeight)) fail(`pair ${n} weights`);
    return { a: items[i].key, b: items[j].key, wab, wba, q };
  });
  return {
    asOf: raw.as_of,
    refreshedAt: raw.refreshed_at,
    totalLists: raw.total_lists,
    countedLists: raw.counted_lists,
    weightedLists: raw.weighted_lists,
    changedSinceLast: raw.changed_since_last,
    items,
    pairs,
  };
}

// ---- the file ----------------------------------------------------------------------------------------

/** The board before the first publication: no lists yet, an empty early board. */
export function emptyBoard() {
  return {
    version: BOARD_VERSION,
    method: PARAMS.version,
    params: BOARD_PARAMS,
    asOf: null,
    refreshedAt: null,
    inputsSha256: null,
    totalLists: 0,
    countedLists: 0,
    weightedLists: 0,
    gate: PARAMS.gateMin,
    early: true,
    iterations: 0,
    top10: [],
    computed10: [],
    rows: [],
  };
}

/**
 * The snapshot of a board: computeBoard's output with the method's parameters, the aggregates' stamp and hash,
 * and only the dataset's burgers.
 */
export function boardSnapshot(board, inputs, inputsSha256, keys) {
  const known = new Set(keys);
  return {
    version: BOARD_VERSION,
    method: board.method,
    params: BOARD_PARAMS,
    asOf: board.asOf,
    refreshedAt: inputs.refreshedAt ?? null,
    inputsSha256,
    totalLists: board.totalLists,
    countedLists: inputs.countedLists,
    weightedLists: board.weightedLists,
    gate: board.gate,
    early: board.early,
    iterations: board.iterations,
    top10: board.top10,
    computed10: board.computed10,
    rows: board.rows.filter((r) => known.has(r.key)),
  };
}

const TOP_KEYS = ["version", "method", "params", "asOf", "refreshedAt", "inputsSha256", "totalLists", "countedLists", "weightedLists", "gate", "early", "iterations", "top10", "computed10"];
const ROW_KEYS = ["key", "tier", "rank", "score", "theta", "sd", "phi", "raw", "lists", "weighted", "firsts", "networks", "needs", "surging", "inconsistent", "held", "review", "frozen", "aheadP", "closeToNext"];
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

/** The file's text: two-space JSON in a fixed key order, one row per line, a final newline. */
export function renderBoard(snapshot) {
  const lines = TOP_KEYS.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(snapshot[k])}`);
  const rows = snapshot.rows.map((r) => `    ${JSON.stringify(pick(r, ROW_KEYS))}`);
  lines.push(rows.length ? `  "rows": [\n${rows.join(",\n")}\n  ]` : `  "rows": []`);
  return `{\n${lines.join(",\n")}\n}\n`;
}

const TIERS = new Set(["ranked", "rising", "listed"]);

/**
 * A board file's text, parsed and checked, or null when it isn't one (not JSON, the wrong shape): the day's
 * computation then refuses to run, since a board without its yesterday would restart the ladder.
 */
export function readBoardText(text) {
  if (typeof text !== "string") return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || raw.version !== BOARD_VERSION || typeof raw.method !== "string") return null;
  if (raw.asOf !== null && (typeof raw.asOf !== "string" || !DATE.test(raw.asOf))) return null;
  if (!isCount(raw.totalLists) || !isCount(raw.countedLists)) return null;
  const keyList = (v) => Array.isArray(v) && v.every((k) => typeof k === "string" && MENU_KEY.test(k));
  if (!keyList(raw.top10) || !keyList(raw.computed10) || !Array.isArray(raw.rows)) return null;
  for (const r of raw.rows) {
    if (!r || typeof r !== "object" || typeof r.key !== "string" || !MENU_KEY.test(r.key) || !TIERS.has(r.tier)) return null;
    if (typeof r.theta !== "number" || !Number.isFinite(r.theta)) return null;
    if (r.tier === "ranked" ? typeof r.score !== "number" || !Number.isFinite(r.score) : r.score !== null) return null;
  }
  return raw;
}

/** The new file given the old one's text (null when missing): unchanged text keeps the file as it is. */
export function nextBoardText(previousText, snapshot) {
  const text = renderBoard(snapshot);
  return { changed: text !== previousText, text };
}

// ---- the owner's watch --------------------------------------------------------------------------------

/** A burger whose raw score fell more than this since the last board is on the burial watch (FINAL.md 6 and 9). */
export const RAW_DROP = 0.5;

const fixed = (x) => (typeof x === "number" ? x.toFixed(3) : String(x));

/**
 * The owner's review flags that need the fit (FINAL.md section 6; the database's review queue has the rest), as
 * GitHub Actions warning lines, which the job's log and its run page show as annotations:
 * - "Burial watch": a burger whose raw score fell more than RAW_DROP since the committed board;
 * - "Inconsistent record": phi at or above the flag level (the row's `inconsistent`).
 * Only the dataset's burgers (the file's rows). No automatic effect: the owner looks at the lists behind them.
 */
export function ownerWatch(prev, snapshot) {
  const lines = [];
  const before = new Map((prev?.rows ?? []).filter((r) => typeof r.raw === "number").map((r) => [r.key, r.raw]));
  for (const r of snapshot.rows) {
    const was = before.get(r.key);
    if (typeof was === "number" && typeof r.raw === "number" && was - r.raw > RAW_DROP) {
      lines.push(`::warning title=Burial watch::${r.key} raw ${fixed(was)} -> ${fixed(r.raw)} since ${prev.asOf ?? "the last board"}`);
    }
  }
  for (const r of snapshot.rows) {
    if (r.inconsistent) lines.push(`::warning title=Inconsistent record::${r.key} phi ${fixed(r.phi)} (flag at ${PARAMS.phiFlag})`);
  }
  return lines;
}

// ---- reading ------------------------------------------------------------------------------------------

async function getText(fetchImpl, url, key, retryDelayMs) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: { apikey: key, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await res.text();
      const body = (await res.text().catch(() => "")).slice(0, 200);
      lastError = new Error(`GET ${url.split("?")[0]} answered ${res.status}${body ? `: ${body}` : ""}`);
      if (res.status < 500 && res.status !== 429) break; // a client error won't fix itself
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
  }
  throw lastError;
}

/**
 * The aggregates: `{ body, raw }`, the response text exactly as sent (what inputsSha256 hashes and --inputs-out
 * saves) and its JSON. One GET of rpc/ranker_board_inputs (a stable function, so PostgREST serves it on GET).
 */
export async function fetchBoardInputs({ url, key, fetch: fetchImpl = globalThis.fetch, retryDelayMs = 1000 }) {
  const body = await getText(fetchImpl, `${url.replace(/\/+$/, "")}/rest/v1/rpc/ranker_board_inputs`, key, retryDelayMs);
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error("ranker_board_inputs did not answer with JSON");
  }
  return { body, raw };
}

/**
 * Lists the owner voided on New York days after `sinceDay` that were in the published aggregates (public.ranker_actions,
 * action "void": each void logs how many of its lists the last publication counted, the only ones a drop can be).
 */
export async function fetchVoidsSince({ url, key, sinceDay, fetch: fetchImpl = globalThis.fetch, retryDelayMs = 1000 }) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1/ranker_actions`;
  let voided = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const q = new URLSearchParams({ select: "id,day,count", action: "eq.void", day: `gt.${sinceDay}`, order: "id.asc", limit: String(PAGE_SIZE), offset: String(offset) });
    const page = JSON.parse(await getText(fetchImpl, `${base}?${q}`, key, retryDelayMs));
    if (!Array.isArray(page)) throw new Error("ranker_actions did not answer with a list");
    for (const a of page) {
      if (!a || !isCount(a.count)) throw new Error(`ranker_actions sent a row that doesn't check out: ${JSON.stringify(a).slice(0, 120)}`);
      voided += a.count;
    }
    if (page.length < PAGE_SIZE) break;
  }
  return voided;
}

// ---- main -----------------------------------------------------------------------------------------

/**
 * The key is one the site may ship: a publishable key, or a legacy JWT whose role is "anon". Never a secret key
 * (`sb_secret_…`) or the service_role JWT: this script only reads public aggregates.
 */
export function isPublicKey(key) {
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("sb_secret_")) return false;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role === "anon";
  } catch {
    return false;
  }
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const plural = (count, one) => `${count} ${one}${count === 1 ? "" : "s"}`;

/**
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @param {typeof fetch} [fetchImpl]
 * @param {{ params?: typeof PARAMS, retryDelayMs?: number }} [options] test hooks (the fit's parameters, retry pause)
 * @returns {Promise<{ changed: boolean, asOf: string | null }>}
 */
export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch, options = {}) {
  const out = resolve(argValue(argv, "--out") ?? BOARD_PATH);
  const datasetPath = resolve(argValue(argv, "--dataset") ?? DATASET_PATH);
  const inputsOut = argValue(argv, "--inputs-out");
  const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").trim() || DEFAULT_SUPABASE_URL;
  if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a URL: ${url}`);
  const key = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim() || DEFAULT_PUBLISHABLE_KEY;
  if (!isPublicKey(key)) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must be the publishable key (sb_publishable_…), never a secret one");
  const retryDelayMs = options.retryDelayMs ?? 1000;

  const keys = datasetMenuKeys(JSON.parse(readFileSync(datasetPath, "utf8")));
  if (!keys.length) throw new Error(`${datasetPath} has no priced menus: refusing to write a board`);

  // Yesterday's board: the only history the ladder carries. A missing file starts the ladder over (the first
  // board takes today's scores as they are); an unreadable one stops here rather than silently restarting it.
  const previousText = existsSync(out) ? readFileSync(out, "utf8") : null;
  const prev = previousText === null ? null : readBoardText(previousText);
  if (previousText !== null && !prev) throw new Error(`${out} is not a People's Top 10 board: fix or delete it (deleting restarts the ladder)`);
  if (prev && prev.method !== PARAMS.version) {
    throw new Error(`${out} was made by ${prev.method}, but this is ${PARAMS.version}: moving to a new method is a deliberate restart (delete the file)`);
  }
  const since = prev?.asOf ?? null;

  const { body, raw } = await fetchBoardInputs({ url, key, fetch: fetchImpl, retryDelayMs });
  const inputs = parseBoardInputs(raw);
  if (!inputs) {
    if (since) throw new Error(`the database has no published aggregates, but the committed board is as of ${since}: refusing to replace it`);
    const { changed, text } = nextBoardText(previousText, emptyBoard());
    if (changed) writeFileSync(out, text);
    console.log(`✓ People's Top 10: no lists published yet, ${changed ? "wrote the empty early board" : "the empty early board stands"}: ${out}`);
    return { changed, asOf: null };
  }
  if (since && inputs.asOf <= since) {
    if (inputs.asOf === since) {
      console.log(`✓ People's Top 10 unchanged: no new aggregates since ${since} (the database publishes once 20 lists changed): ${out}`);
      return { changed: false, asOf: since };
    }
    throw new Error(`the aggregates are as of ${inputs.asOf}, older than the committed board (${since}): refusing to publish`);
  }
  if (inputsOut) writeFileSync(resolve(inputsOut), body);

  if (prev && prev.countedLists > 0 && inputs.countedLists < prev.countedLists) {
    const voided = await fetchVoidsSince({ url, key, sinceDay: /** @type {string} */ (since), fetch: fetchImpl, retryDelayMs });
    const unexplained = prev.countedLists - voided - inputs.countedLists;
    if (unexplained > MAX_DROP * prev.countedLists && !argv.includes("--allow-drop")) {
      throw new Error(
        `the counted lists fell from ${prev.countedLists} to ${inputs.countedLists} (${voided} voided by the owner since ${since}): ` +
          `more than ${MAX_DROP * 100}% unexplained, refusing to publish (run with --allow-drop if the lists really went)`,
      );
    }
  }

  const known = new Set(keys);
  const ladderInputs = {
    asOf: inputs.asOf,
    totalLists: inputs.totalLists,
    weightedLists: inputs.weightedLists,
    items: inputs.items,
    pairs: inputs.pairs,
    hidden: inputs.items.map((it) => it.key).filter((k) => !known.has(k)),
  };
  let board;
  try {
    board = computeBoard(ladderInputs, prev, options.params ?? PARAMS);
  } catch (err) {
    if (err instanceof LadderFitError) throw new Error(`${err.message}: refusing to publish; yesterday's board stays`);
    throw err;
  }
  const sha = createHash("sha256").update(body).digest("hex");
  const snapshot = boardSnapshot(board, inputs, sha, keys);
  for (const line of ownerWatch(prev, snapshot)) console.log(line);
  const { changed, text } = nextBoardText(previousText, snapshot);
  const ranked = snapshot.rows.filter((r) => r.tier === "ranked").length;
  const rising = snapshot.rows.filter((r) => r.tier === "rising").length;
  const summary = `as of ${snapshot.asOf}: ${plural(snapshot.totalLists, "list")}, ${ranked} ranked, ${rising} rising, gate ${snapshot.gate}${snapshot.early ? ", early results" : ""}`;
  if (!changed) {
    console.log(`✓ People's Top 10 unchanged (${summary}): ${out}`);
    return { changed, asOf: snapshot.asOf };
  }
  writeFileSync(out, text);
  console.log(`✓ People's Top 10 written (${summary}): ${out}`);
  return { changed, asOf: snapshot.asOf };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`✗ People's Top 10: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
