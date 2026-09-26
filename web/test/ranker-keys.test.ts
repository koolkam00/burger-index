// The ranker's menu keys (supabase/README.md "Saving a list"): save_ranking accepts only the keys in
// ranker_private.ranker_keys, set by the latest supabase/migrations/<version>_ranker_keys.sql
// (scripts/ranker-keys-migration.mjs). That file must list exactly the dataset's menu keys: when the dataset's
// menus change, run `node web/scripts/ranker-keys-migration.mjs --write` and apply the new migration to the live
// project, or visitors can't save the new burgers (and can still save the gone ones).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keysMigrationSql, KEYS_FILE, latestKeysMigration, main, nextVersion, parseKeysMigration } from "../scripts/ranker-keys-migration.mjs";
import { datasetMenuKeys } from "../scripts/snapshot-peoples-top.mjs";
import { loadDataset } from "./dataset";

test("the latest ranker key sync lists exactly the dataset's menu keys (else: ranker-keys-migration.mjs --write, then apply it)", () => {
  const latest = latestKeysMigration();
  assert.ok(latest, "no supabase/migrations/*_ranker_keys.sql");
  assert.match(latest.file, KEYS_FILE);
  const keys = datasetMenuKeys(loadDataset());
  const had = new Set(latest.keys);
  const missing = keys.filter((k: string) => !had.has(k));
  const extra = latest.keys.filter((k: string) => !keys.includes(k));
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `${latest.file} is out of date`);
  assert.deepEqual(latest.keys, keys);
});

test("a key sync's SQL: the keys one per line, read back exactly; no keys or a key that isn't one is refused", () => {
  const keys = ["chain:jackson-hole", "emily-clinton-hill", "j-g-melon-lenox-hill"];
  const sql = keysMigrationSql(keys, "2026-09-26T04:49:23Z");
  assert.match(sql, /^select ranker_private\.ranker_sync_keys\(array\[$/m);
  assert.match(sql, /^ {2}'emily-clinton-hill',$/m);
  assert.match(sql, /^\]::text\[\]\);$/m);
  assert.deepEqual(parseKeysMigration(sql), keys);
  assert.throws(() => keysMigrationSql([], null), /no menu keys/);
  assert.throws(() => keysMigrationSql(["emily'; drop table x; --"], null), /not a menu key/);
  assert.throws(() => parseKeysMigration("select 1;"), /not a ranker key sync/);
});

test("the script: in sync, out of sync (exit 1 without --write), and --write makes the next migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "ranker-keys-"));
  const log = console.log;
  console.log = () => {};
  try {
    const dataset = join(dir, "burger_index.json");
    writeFileSync(dataset, JSON.stringify({ generated_at: "2026-10-01T04:00:00Z", restaurants: [
      { id: "b-spot", chain: null, index_price: 12 },
      { id: "a-spot", chain: null, index_price: 18 },
      { id: "jh-1", chain: "jackson-hole", index_price: 16 },
      { id: "jh-2", chain: "jackson-hole", index_price: 16 },
      { id: "closed", chain: null, index_price: null },
    ] }));
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    const args = ["--dataset", dataset, "--dir", migrations];
    assert.deepEqual(main(args), { inSync: false, wrote: null, keys: 3 });
    const first = main([...args, "--write"]);
    assert.ok(first.wrote && KEYS_FILE.test(first.wrote.split("/").at(-1) as string));
    assert.deepEqual(latestKeysMigration(migrations)?.keys, ["a-spot", "b-spot", "chain:jackson-hole"]);
    assert.deepEqual(main(args), { inSync: true, wrote: null, keys: 3 });
    // a later migration sorts after it; one dated before the latest is refused
    assert.ok(nextVersion(migrations, new Date(Date.now() + 5000)) > (latestKeysMigration(migrations)?.file.slice(0, 14) as string));
    assert.throws(() => nextVersion(migrations, new Date("2020-01-01T00:00:00Z")), /not after the latest migration/);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});
