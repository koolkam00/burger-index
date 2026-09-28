// The People's Top 10 board before the database's first publication (user request 2026-09-27: "count the robert top 10
// a populatoed peopels list needs to show when i send this to people"). Until the nightly refresh publishes its first
// aggregates, data/peoples_top.json has no rows, though the published rankings in data/ranker_published_lists.json
// already count as lists (supabase/README.md "Published lists"). They are the only lists whose contents are public,
// so the build fits them with the Patty Ladder's own code (ladder.mjs refreshInputs + computeBoard, no yesterday), the
// way the database will: each list saved on its day (`added_on`, else the file's `seeded_on`), one network per
// publisher. A list with `voided_on` doesn't count. Nothing else goes in: no visitor's list, no invented order.
//
// Each row's `firsts` ("#1 on 2" on the pages) counts only a list whose own No. 1 it is: a list that counts only
// some of a publication's entries (a national ranking's NYC ones, a ranking whose No. 1 has no menu price here)
// leads with a burger the publication ranked lower (Time Out's No. 4, Tasting Table's No. 2), and the page must never
// credit a #1 the publication didn't give. The ladder reads `firsts` for nothing but display (ladder.mjs passes it
// through), so this changes no score, seat or order.
//
// Plain JS, no Node imports: src/lib/peoples-top-data.ts and scripts/check-seo.mjs both read it.
import { computeBoard, refreshInputs } from "./ladder.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^(chain:)?[a-z0-9-]{1,120}$/;

/**
 * Every published list in the file, voided ones included, in the file's order, or null when the file isn't one
 * (the shape data/ranker_published_lists.json has; scripts/ranker-published-migration.mjs checks it in full).
 * `no1`: its first item is the publication's own No. 1 (`ranks[0] === 1`; a list without `ranks` is in its own order).
 * @param {unknown} file
 * @returns {{ items: string[], day: string, net: string, voided: string | null, no1: boolean }[] | null}
 */
function publishedLists(file) {
  const f = /** @type {any} */ (file);
  if (!f || typeof f !== "object" || f.version !== 1 || !Array.isArray(f.lists)) return null;
  if (f.lists.length && !(typeof f.seeded_on === "string" && DAY.test(f.seeded_on))) return null;
  const out = [];
  for (const l of f.lists) {
    if (!l || typeof l !== "object" || typeof l.publisher !== "string" || !l.publisher) return null;
    if (!Array.isArray(l.items) || l.items.length < 3 || l.items.length > 25) return null;
    if (!l.items.every((k) => typeof k === "string" && KEY.test(k)) || new Set(l.items).size !== l.items.length) return null;
    for (const d of [l.added_on, l.voided_on]) if (d !== undefined && !(typeof d === "string" && DAY.test(d))) return null;
    if (l.ranks !== undefined && !(Array.isArray(l.ranks) && l.ranks.length === l.items.length && l.ranks.every((r) => Number.isInteger(r) && r >= 1))) return null;
    out.push({
      items: [...l.items],
      day: l.added_on ?? f.seeded_on,
      net: `published:${l.publisher}`,
      voided: l.voided_on ?? null,
      no1: l.ranks === undefined || l.ranks[0] === 1,
    });
  }
  return out;
}

/**
 * The published lists that count, in save order, as refreshInputs takes them, or null when the file isn't one.
 * @param {unknown} file
 * @returns {{ items: string[], day: string, net: string }[] | null}
 */
export function publishedSaves(file) {
  const lists = publishedLists(file);
  if (!lists) return null;
  const saves = lists.filter((l) => l.voided === null).map(({ items, day, net }) => ({ items, day, net }));
  // save order: by day, the file's order within a day (a stable sort)
  return saves.map((s, i) => ({ s, i })).sort((a, b) => (a.s.day < b.s.day ? -1 : a.s.day > b.s.day ? 1 : a.i - b.i)).map((x) => x.s);
}

/**
 * The published lists a board counted that lead with a burger the publication didn't rank No. 1, as key → how many:
 * saved on or before the board's day and not voided by then (`asOf` null: every list that counts now).
 * @param {unknown} file
 * @param {string | null} asOf
 * @returns {Map<string, number>}
 */
export function falseFirsts(file, asOf) {
  const out = new Map();
  for (const l of publishedLists(file) ?? []) {
    const counted = asOf === null ? l.voided === null : l.day <= asOf && (l.voided === null || l.voided > asOf);
    if (counted && !l.no1) out.set(l.items[0], (out.get(l.items[0]) ?? 0) + 1);
  }
  return out;
}

/**
 * The board with each row's `firsts` less the lists that lead with a burger the publication ranked lower (never
 * below 0). The same board when no row changes.
 * @template {{ asOf: string | null, rows: readonly { key: string, firsts: number }[] }} B
 * @param {B} board
 * @param {unknown} file
 * @returns {B}
 */
function ownFirsts(board, file) {
  const minus = falseFirsts(file, board.asOf);
  if (!board.rows.some((r) => minus.has(r.key) && r.firsts > 0)) return board;
  return { ...board, rows: board.rows.map((r) => (minus.has(r.key) && r.firsts > 0 ? { ...r, firsts: Math.max(0, r.firsts - (minus.get(r.key) ?? 0)) } : r)) };
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
  const board = ownFirsts(computeBoard(inputs, null), file);
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
 * Whether the database has published a board (even an empty one, after a reset): its rows are then the lists.
 * @param {{ asOf: string | null, rows: readonly unknown[] }} board
 */
export function everPublished(board) {
  return board.rows.length > 0 || board.asOf !== null;
}

/**
 * The board the site shows: the committed board once the database has published one (its rows cover every counted
 * list of the latest published aggregates; an empty one after a reset stays empty), else the published lists' board,
 * else the committed (empty) board. Either way `firsts` counts only a list's own No. 1 (`ownFirsts`).
 * @template {{ asOf: string | null, rows: readonly { key: string, firsts: number }[] }} B
 * @param {B} committed
 * @param {unknown} publishedFile
 */
export function siteBoard(committed, publishedFile) {
  if (everPublished(committed)) return ownFirsts(committed, publishedFile);
  return publishedBoard(publishedFile) ?? committed;
}
