// Server-only: src/data/ranker_published_lists.json (copied from ../data/ranker_published_lists.json by
// scripts/sync-data.mjs, which checks it with scripts/ranker-published-migration.mjs checkPublishedLists), read once
// per build worker. The published rankings seeded as People's Top 10 lists (user decision 2026-09-26/27); the pages
// show one line about them (lib/published-lists.ts). A file that is missing or doesn't match fails the build here.
// The file records what was seeded; a list later taken out with ranker_private.ranker_void (supabase/README.md
// "Published lists") gets a `voided_on` day in its entry (the seeding migration ignores the field) and leaves the line
// once the committed People's Top 10 board is as of that day or later: until then the board still counts it.
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getPeoplesTop } from "./peoples-top-data";
import { listsInLine, publishedLine, type PublishedLine, type PublishedList } from "./published-lists";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Only what the line reads; the file's other fields (the burgers, the list's own numbers, what was left out) are
// checked in full by sync-data.
const FileSchema = z.object({
  version: z.literal(1),
  seeded_on: Day,
  lists: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      publisher: z.string().min(1),
      title: z.string().min(1),
      url: z.string().regex(/^https:\/\/[^\s'"\\<>]+$/),
      date: Day,
      voided_on: Day.optional(),
    }),
  ),
});

function load(): PublishedList[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "ranker_published_lists.json"), "utf8"));
  } catch (err) {
    throw new Error(`Could not read src/data/ranker_published_lists.json (run \`npm run sync-data\`): ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`src/data/ranker_published_lists.json is malformed:\n${z.prettifyError(parsed.error)}`);
  return listsInLine(parsed.data.lists, parsed.data.seeded_on, getPeoplesTop().asOf).map(({ id, publisher, title, url, date }) => ({ id, publisher, title, url, date }));
}

const LISTS = load();
const LINE = publishedLine(LISTS);

/** The published rankings counted as People's Top 10 lists (not voided, or voided after the committed board), in the file's order. */
export function getPublishedLists(): readonly PublishedList[] {
  return LISTS;
}

/** The line that says so (null: none seeded). */
export function getPublishedLine(): PublishedLine | null {
  return LINE;
}
