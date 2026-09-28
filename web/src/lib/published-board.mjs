// The People's Top 10 board before the database's first publication (user request 2026-09-27: "count the robert top 10
// a populatoed peopels list needs to show when i send this to people"). Until the nightly refresh publishes its first
// aggregates, data/peoples_top.json has no rows, though the published rankings in data/ranker_published_lists.json
// already count as lists (supabase/README.md "Published lists"). They are the only lists whose contents are public,
// so the build fits them with the Patty Ladder's own code (ladder.mjs refreshInputs + computeBoard, no yesterday), the
// way the database will: each list saved on its day (`added_on`, else the file's `seeded_on`), one network per
// publisher. A list with `voided_on` doesn't count. Nothing else goes in: no visitor's list, no invented order.
//
// Plain JS, no Node imports: src/lib/peoples-top-data.ts and scripts/check-seo.mjs both read it.
import { computeBoard, refreshInputs } from "./ladder.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^(chain:)?[a-z0-9-]{1,120}$/;

/**
 * The published lists that count, in save order, as refreshInputs takes them, or null when the file isn't one
 * (the shape data/ranker_published_lists.json has; scripts/ranker-published-migration.mjs checks it in full).
 * @param {unknown} file
 * @returns {{ items: string[], day: string, net: string }[] | null}
 */
export function publishedSaves(file) {
  const f = /** @type {any} */ (file);
  if (!f || typeof f !== "object" || f.version !== 1 || !Array.isArray(f.lists)) return null;
  if (f.lists.length && !(typeof f.seeded_on === "string" && DAY.test(f.seeded_on))) return null;
  const saves = [];
  for (const l of f.lists) {
    if (!l || typeof l !== "object" || typeof l.publisher !== "string" || !l.publisher) return null;
    if (!Array.isArray(l.items) || l.items.length < 3 || l.items.length > 25) return null;
    if (!l.items.every((k) => typeof k === "string" && KEY.test(k)) || new Set(l.items).size !== l.items.length) return null;
    for (const d of [l.added_on, l.voided_on]) if (d !== undefined && !(typeof d === "string" && DAY.test(d))) return null;
    if (l.voided_on !== undefined) continue;
    saves.push({ items: [...l.items], day: l.added_on ?? f.seeded_on, net: `published:${l.publisher}` });
  }
  // save order: by day, the file's order within a day (a stable sort)
  return saves.map((s, i) => ({ s, i })).sort((a, b) => (a.s.day < b.s.day ? -1 : a.s.day > b.s.day ? 1 : a.i - b.i)).map((x) => x.s);
}

/**
 * The board of the published lists, in the board file's shape (as scripts/snapshot-peoples-top.mjs would write it
 * from these lists' aggregates, less `params` and `inputsSha256`), or null when no list counts.
 * @param {unknown} file data/ranker_published_lists.json, parsed
 */
export function publishedBoard(file) {
  const saves = publishedSaves(file);
  if (!saves || !saves.length) return null;
  const asOf = saves.reduce((m, s) => (s.day > m ? s.day : m), saves[0].day);
  const inputs = refreshInputs(saves, { asOf });
  const board = computeBoard(inputs, null);
  return {
    version: 1,
    method: board.method,
    asOf: board.asOf,
    refreshedAt: null,
    totalLists: board.totalLists,
    countedLists: inputs.countedLists,
    weightedLists: board.weightedLists,
    gate: board.gate,
    early: board.early,
    iterations: board.iterations,
    top10: board.top10,
    computed10: board.computed10,
    rows: board.rows,
  };
}

/**
 * The board the site shows: the committed board when it has rows (they cover every counted list of the latest
 * published aggregates), else the published lists' board, else the committed (empty) board.
 * @template B
 * @param {B & { rows: readonly unknown[] }} committed
 * @param {unknown} publishedFile
 */
export function siteBoard(committed, publishedFile) {
  if (committed.rows.length) return committed;
  return publishedBoard(publishedFile) ?? committed;
}
