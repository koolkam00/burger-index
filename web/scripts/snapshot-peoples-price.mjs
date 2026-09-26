#!/usr/bin/env node
// The People's Price snapshot: the crowd's answers per menu, committed so the static pages can show them.
//
//   node web/scripts/snapshot-peoples-price.mjs              # writes ../data/peoples_price.json (repo root: data/)
//   node web/scripts/snapshot-peoples-price.mjs --out PATH   # somewhere else
//
// Reads the public burger_worth_hist table (menu_key, dollars, votes) over the Supabase REST API with the
// project's PUBLISHABLE key: GET requests only, never an RPC, never a write. Only the dataset's menus are asked
// for (a restaurant id, or "chain:<slug>" for a chain: the site's menu key, src/lib/menus.ts), 100 keys per
// request, so keys the dataset doesn't know never land in the file. The URL and key come from
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY when set, else the public defaults below: both are
// public by design (they ship in the site's JavaScript), and the database lets that key read this table only.
//
// The file (supabase/README.md, CLAUDE.md "People's Price snapshot"):
//
//   { "version": 1, "generated_at": "2026-09-26T09:00:04Z",
//     "menus": { "<menu key>": { "answers": 14, "median": 21.5, "hist": { "18": 2, "22": 5, … } } } }
//
// `hist` is how many visitors answered each whole-dollar amount; `answers` and `median` (the exact median
// answer, percentile_cont(0.5): the People's Price is it rounded half up) restate it for people reading the
// diff. A menu with no answers is left out. The output is deterministic (menu keys sorted, answers ascending,
// two-space JSON with a final newline), and the file is only rewritten when the numbers change: an unchanged
// run leaves it, and its generated_at, alone, so the daily workflow (.github/workflows/peoples-price.yml)
// commits only real changes. A failed or odd read exits non-zero without writing anything.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const DATASET_PATH = join(ROOT, "data", "burger_index.json");
export const SNAPSHOT_PATH = join(ROOT, "data", "peoples_price.json");

/** Public values (supabase/README.md): the project URL and its publishable key, the ones the site ships. */
export const DEFAULT_SUPABASE_URL = "https://wtbtivqubzymhbmijnri.supabase.co";
export const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_3jMcVPRptvGbnoUIzPN6-w_my_QGtX_";

export const SNAPSHOT_VERSION = 1;
const ANSWER_MIN = 5;
const ANSWER_MAX = 75;
/** Same pattern as the database check on burger_worth.menu_key (src/lib/worth.ts MENU_KEY_PATTERN). */
const MENU_KEY = /^(chain:)?[a-z0-9-]{1,120}$/;
/** Menu keys per request (the site's batch size: a short URL, at most 100 × 71 rows each). */
export const KEY_BATCH = 100;
/** Rows per page (PostgREST's default cap is 1000). */
export const PAGE_SIZE = 1000;
const TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;

// ---- the dataset's menus ----------------------------------------------------------------------------

/**
 * Every distinct priced menu's key, sorted: `chain:<slug>` for a chain's locations, else the restaurant id
 * (src/lib/menus.ts menuKey; test/peoples-price-snapshot.test.ts checks they agree).
 */
export function datasetMenuKeys(dataset) {
  const keys = new Set();
  for (const r of dataset?.restaurants ?? []) {
    if (r.index_price === null || r.index_price === undefined) continue;
    keys.add(r.chain ? `chain:${r.chain}` : r.id);
  }
  return [...keys].sort();
}

// ---- rows -> menus --------------------------------------------------------------------------------------

/** @typedef {{ menu_key: string, dollars: number, votes: number }} HistRow */
/** @typedef {{ answers: number, median: number | null, hist: Record<string, number> }} SnapshotMenu */
/** @typedef {Record<string, SnapshotMenu>} SnapshotMenus */

const isAnswer = (v) => Number.isInteger(v) && v >= ANSWER_MIN && v <= ANSWER_MAX;

/** A burger_worth_hist row, checked: `{ menu_key, dollars, votes }`, or null. */
export function parseRow(v) {
  if (!v || typeof v !== "object") return null;
  const { menu_key, dollars, votes } = v;
  if (typeof menu_key !== "string" || !MENU_KEY.test(menu_key) || !isAnswer(dollars)) return null;
  if (!Number.isInteger(votes) || votes < 0) return null;
  return { menu_key, dollars, votes };
}

/** The median of a histogram's answers (the mean of the two middle ones for an even count), or null. */
export function histMedian(hist) {
  const cells = Object.entries(hist)
    .map(([d, n]) => [Number(d), n])
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[0] - b[0]);
  const total = cells.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  const at = (pos) => {
    let seen = 0;
    for (const [d, n] of cells) {
      seen += n;
      if (pos < seen) return d;
    }
    return cells[cells.length - 1][0];
  };
  return total % 2 ? at((total - 1) / 2) : (at(total / 2 - 1) + at(total / 2)) / 2;
}

/**
 * The snapshot's `menus`: one entry per menu of `keys` with at least one answer, keys sorted, each with its
 * answer count, median and histogram (answers ascending). Rows for other keys, and empty cells, are left out.
 * @param {Iterable<HistRow>} rows
 * @param {readonly string[]} keys
 * @returns {SnapshotMenus}
 */
export function snapshotMenus(rows, keys) {
  const known = new Set(keys);
  /** @type {Map<string, Map<number, number>>} */
  const byKey = new Map();
  for (const row of rows) {
    if (!known.has(row.menu_key) || row.votes <= 0) continue;
    let h = byKey.get(row.menu_key);
    if (!h) byKey.set(row.menu_key, (h = new Map()));
    h.set(row.dollars, row.votes);
  }
  /** @type {SnapshotMenus} */
  const menus = {};
  for (const key of [...byKey.keys()].sort()) {
    const cells = [...byKey.get(key)].sort((a, b) => a[0] - b[0]);
    const hist = {};
    for (const [d, n] of cells) hist[String(d)] = n;
    menus[key] = { answers: cells.reduce((s, [, n]) => s + n, 0), median: histMedian(hist), hist };
  }
  return menus;
}

// ---- the file ----------------------------------------------------------------------------------------

/** The file's text: two-space JSON, keys in a fixed order, a final newline. */
export function renderSnapshot({ generatedAt, menus }) {
  const ordered = {};
  for (const key of Object.keys(menus).sort()) {
    const m = menus[key];
    const hist = {};
    for (const d of Object.keys(m.hist).map(Number).sort((a, b) => a - b)) hist[String(d)] = m.hist[String(d)];
    ordered[key] = { answers: m.answers, median: m.median, hist };
  }
  return `${JSON.stringify({ version: SNAPSHOT_VERSION, generated_at: generatedAt, menus: ordered }, null, 2)}\n`;
}

/** A snapshot file's text, parsed: `{ generatedAt, menus }`, or null when it isn't one (missing, not JSON, wrong shape). */
export function readSnapshotText(text) {
  if (typeof text !== "string") return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || raw.version !== SNAPSHOT_VERSION) return null;
  if (raw.generated_at !== null && typeof raw.generated_at !== "string") return null;
  if (!raw.menus || typeof raw.menus !== "object" || Array.isArray(raw.menus)) return null;
  return { generatedAt: raw.generated_at, menus: raw.menus };
}

/** "2026-09-26T09:00:04Z" (whole seconds, UTC). */
export function stamp(now) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * What to write given the file as it is now (`previousText`, null when missing): the same numbers keep the file
 * as it is (`changed: false`, generated_at untouched); anything else is a new file stamped `now`.
 */
export function nextSnapshot(previousText, menus, now) {
  const prev = readSnapshotText(previousText);
  if (prev && prev.generatedAt !== null && sameMenus(prev.menus, menus)) return { changed: false, text: previousText };
  return { changed: true, text: renderSnapshot({ generatedAt: stamp(now), menus }) };
}

function sameMenus(a, b) {
  try {
    return renderSnapshot({ generatedAt: null, menus: a }) === renderSnapshot({ generatedAt: null, menus: b });
  } catch {
    return false; // the old file's menus don't have the right shape: write a new one
  }
}

// ---- reading the table ---------------------------------------------------------------------------

/** `in.("a","chain:b")`: PostgREST's list filter, each key quoted (keys never hold a quote or a comma). */
function inList(keys) {
  return `in.(${keys.map((k) => `"${k}"`).join(",")})`;
}

async function getJson(fetchImpl, url, key, retryDelayMs) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: { apikey: key, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
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
 * Every burger_worth_hist row for `keys`, KEY_BATCH keys and PAGE_SIZE rows per GET. Throws on any failed
 * request or a reply that isn't a list; rows that don't check out are skipped with a warning.
 */
export async function fetchHistRows({ url, key, keys, fetch: fetchImpl = globalThis.fetch, warn = (m) => console.warn(m), retryDelayMs = 1000 }) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1/burger_worth_hist`;
  const rows = [];
  for (let i = 0; i < keys.length; i += KEY_BATCH) {
    const batch = keys.slice(i, i + KEY_BATCH);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const q = new URLSearchParams({
        select: "menu_key,dollars,votes",
        menu_key: inList(batch),
        order: "menu_key.asc,dollars.asc",
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const page = await getJson(fetchImpl, `${base}?${q}`, key, retryDelayMs);
      if (!Array.isArray(page)) throw new Error("burger_worth_hist did not answer with a list");
      for (const r of page) {
        const row = parseRow(r);
        if (row) rows.push(row);
        else warn(`skipped a row that doesn't check out: ${JSON.stringify(r).slice(0, 120)}`);
      }
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

// ---- main -----------------------------------------------------------------------------------------

/**
 * The key is one the site may ship: a publishable key, or a legacy JWT whose role is "anon". Never a secret key
 * (`sb_secret_…`) or the service_role JWT: this script only reads a public table.
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

/**
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @param {typeof fetch} [fetchImpl]
 */
export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch) {
  const out = resolve(argValue(argv, "--out") ?? SNAPSHOT_PATH);
  const datasetPath = resolve(argValue(argv, "--dataset") ?? DATASET_PATH);
  const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").trim() || DEFAULT_SUPABASE_URL;
  if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a URL: ${url}`);
  const key = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim() || DEFAULT_PUBLISHABLE_KEY;
  if (!isPublicKey(key)) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must be the publishable key (sb_publishable_…), never a secret one");

  const keys = datasetMenuKeys(JSON.parse(readFileSync(datasetPath, "utf8")));
  if (!keys.length) throw new Error(`${datasetPath} has no priced menus: refusing to write an empty snapshot`);

  const rows = await fetchHistRows({ url, key, keys, fetch: fetchImpl });
  const menus = snapshotMenus(rows, keys);
  const previous = existsSync(out) ? readFileSync(out, "utf8") : null;
  const { changed, text } = nextSnapshot(previous, menus, new Date());
  const answers = Object.values(menus).reduce((s, m) => s + m.answers, 0);
  const verdicts = Object.values(menus).filter((m) => m.answers >= 3).length;
  const n = (count, one) => `${count} ${one}${count === 1 ? "" : "s"}`;
  const summary = `${Object.keys(menus).length} of ${n(keys.length, "menu")} answered, ${n(answers, "answer")}, ${verdicts} with 3 or more`;
  if (!changed) {
    console.log(`✓ People's Price snapshot unchanged (${summary}): ${out}`);
    return { changed };
  }
  writeFileSync(out, text);
  console.log(`✓ People's Price snapshot written (${summary}): ${out}`);
  return { changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`✗ People's Price snapshot: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
