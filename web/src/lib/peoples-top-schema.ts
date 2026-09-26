// The People's Top 10 board file (data/peoples_top.json, written by scripts/snapshot-peoples-top.mjs), checked
// with a zod mirror of the part the site reads (the rest of each row is for auditors). Server-side only: the
// pages read the board at build (lib/peoples-top-data.ts), so zod never reaches the browser.
import { z } from "zod";
import type { BoardFile } from "./peoples-top";

const KEY = z.string().regex(/^(chain:)?[a-z0-9-]{1,120}$/);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const COUNT = z.number().int().nonnegative();

const BoardSchema = z.object({
  version: z.literal(1),
  method: z.string(),
  asOf: DAY.nullable(),
  refreshedAt: z.string().nullable(),
  totalLists: COUNT,
  gate: COUNT,
  early: z.boolean(),
  top10: z.array(KEY).max(10),
  rows: z.array(
    z.object({
      key: KEY,
      tier: z.enum(["ranked", "rising", "listed"]),
      rank: COUNT.nullable(),
      score: z.number().nullable(),
      theta: z.number(),
      lists: COUNT,
      firsts: COUNT,
      needs: COUNT,
      held: z.boolean(),
      review: z.boolean(),
      closeToNext: z.boolean().nullable(),
    }),
  ),
});

/** The board file, checked: the board the site reads, or what doesn't check out. */
export function parseBoardFile(raw: unknown): { ok: true; board: BoardFile } | { ok: false; problem: string } {
  const parsed = BoardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: z.prettifyError(parsed.error) };
  const b = parsed.data;
  return { ok: true, board: { method: b.method, asOf: b.asOf, refreshedAt: b.refreshedAt, totalLists: b.totalLists, gate: b.gate, early: b.early, top10: b.top10, rows: b.rows } };
}
