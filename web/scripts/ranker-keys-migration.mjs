#!/usr/bin/env node
// The ranker's menu keys (supabase/README.md "Saving a list"): save_ranking accepts only the keys in
// ranker_private.ranker_keys, which are every distinct priced menu of data/burger_index.json (a chain once, as
// `chain:<slug>`; the same keys as /data/menus.json and the People's Top 10 board). The keys are set by a
// migration this script writes, which calls ranker_private.ranker_sync_keys; apply it to the live project with the
// Supabase connector (apply_migration, name "ranker_keys") whenever the dataset's menus change (CLAUDE.md "Refresh
// the live site"). test/ranker-keys.test.ts fails while the latest one differs from the dataset.
//
//   node web/scripts/ranker-keys-migration.mjs           # check: exit 0 when the latest sync lists the dataset's keys, 1 when not
//   node web/scripts/ranker-keys-migration.mjs --write   # write supabase/migrations/<UTC timestamp>_ranker_keys.sql when they differ
//
// No database access and no key: it only reads the dataset and the migrations folder, and writes one file.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DATASET_PATH, datasetMenuKeys, ROOT } from "./snapshot-peoples-top.mjs";

export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
/** A key sync's file name: `<14-digit version>_ranker_keys.sql`. */
export const KEYS_FILE = /^(\d{14})_ranker_keys\.sql$/;
const MIGRATION_FILE = /^(\d{14})_[a-z0-9_]+\.sql$/;
const MENU_KEY = /^(chain:)?[a-z0-9-]{1,120}$/;

/** The migration that makes ranker_private.ranker_keys exactly `keys` (sorted, distinct menu keys). */
export function keysMigrationSql(keys, generatedAt) {
  if (!keys.length) throw new Error("no menu keys: refusing to write a sync that would refuse every list");
  for (const k of keys) if (!MENU_KEY.test(k)) throw new Error(`not a menu key: ${k}`);
  return [
    `-- The ranker's menu keys: every distinct priced menu of data/burger_index.json (generated ${generatedAt ?? "unknown"}),`,
    `-- ${keys.length} keys, written by web/scripts/ranker-keys-migration.mjs. save_ranking accepts only these; a key that`,
    "-- left the dataset stays in the lists that hold it (and in the fit), but new saves can't include it.",
    "select ranker_private.ranker_sync_keys(array[",
    keys.map((k) => `  '${k}'`).join(",\n"),
    "]::text[]);",
    "",
  ].join("\n");
}

/** The keys a key-sync migration sets, in its order. */
export function parseKeysMigration(sql) {
  const block = /ranker_sync_keys\(array\[(.*?)\]::text\[\]\)/s.exec(sql);
  if (!block) throw new Error("not a ranker key sync (no ranker_sync_keys(array[...]))");
  return [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/** The latest key sync in the migrations folder: `{ file, keys }`, or null when there is none. */
export function latestKeysMigration(dir = MIGRATIONS_DIR) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => KEYS_FILE.test(f)).sort() : [];
  const file = files.at(-1);
  return file ? { file, keys: parseKeysMigration(readFileSync(join(dir, file), "utf8")) } : null;
}

/** A migration version for now (UTC, `YYYYMMDDHHMMSS`), after every migration already in the folder. */
export function nextVersion(dir = MIGRATIONS_DIR, now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const last = (existsSync(dir) ? readdirSync(dir) : []).map((f) => MIGRATION_FILE.exec(f)?.[1]).filter(Boolean).sort().at(-1);
  if (last && stamp <= last) throw new Error(`the clock (${stamp}) is not after the latest migration (${last})`);
  return stamp;
}

export function sameKeys(a, b) {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/**
 * @param {string[]} [argv]
 * @returns {{ inSync: boolean, wrote: string | null, keys: number }}
 */
export function main(argv = process.argv.slice(2)) {
  const datasetPath = resolve(argv.includes("--dataset") ? argv[argv.indexOf("--dataset") + 1] : DATASET_PATH);
  const dir = resolve(argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : MIGRATIONS_DIR);
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  const keys = datasetMenuKeys(dataset);
  const latest = latestKeysMigration(dir);
  if (latest && sameKeys(latest.keys, keys)) {
    console.log(`✓ ranker keys: ${latest.file} lists the dataset's ${keys.length} menu keys`);
    return { inSync: true, wrote: null, keys: keys.length };
  }
  const had = new Set(latest?.keys ?? []);
  const added = keys.filter((k) => !had.has(k));
  const removed = (latest?.keys ?? []).filter((k) => !keys.includes(k));
  const what = `${added.length} added, ${removed.length} removed${latest ? ` since ${latest.file}` : " (no sync yet)"}`;
  if (!argv.includes("--write")) {
    console.log(`✗ ranker keys: the dataset's ${keys.length} menu keys differ from the latest sync: ${what}. Run with --write, then apply the new migration.`);
    return { inSync: false, wrote: null, keys: keys.length };
  }
  const file = join(dir, `${nextVersion(dir)}_ranker_keys.sql`);
  writeFileSync(file, keysMigrationSql(keys, dataset.generated_at));
  console.log(`✓ ranker keys: wrote ${file} (${keys.length} keys; ${what}). Apply it to the live project (apply_migration, name "ranker_keys").`);
  return { inSync: false, wrote: file, keys: keys.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { inSync, wrote } = main();
    process.exit(inSync || wrote ? 0 : 1);
  } catch (err) {
    console.error(`✗ ranker keys: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
