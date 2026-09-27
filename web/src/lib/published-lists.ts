// The published rankings counted among the People's Top 10 lists (user decision 2026-09-26/27: the four genuinely
// ranked published burger lists, each saved as one list weighted exactly like a visitor's; data/ranker_published_lists.json,
// supabase/README.md "Published lists"), and the one short line the site says it in (DESIGN.md "The People's Top 10's
// sourcing line"): on /peoples-top-10, beside the ranker's list and in llms.txt. Computed from the committed file, so it
// always names what was seeded. It says what counts, never how the board weighs it (no weights, never "rated by critics").
//
// Pure and client-safe: lib/published-lists-data.ts (server-only) reads the file; the ranker gets the line as a prop.
import { formatCount, formatMonthYear } from "./format";

/** One published list, as far as the line reads it (the file holds more: the burgers, the list's own numbers, notes). */
export type PublishedList = { id: string; publisher: string; title: string; url: string; date: string };

/** One publisher's lists in the line: each a link to the list itself, its text the list's month ("Aug 2026"). */
export type PublishedSource = { publisher: string; lists: { id: string; title: string; url: string; when: string }[] };

export type PublishedLine = {
  /** How many published lists count. */
  count: number;
  /** "Includes 4 published burger rankings, each counted like one visitor's list:" */
  lead: string;
  /** The publishers in the file's order, each with its lists in the file's order. */
  sources: PublishedSource[];
};

/** The line for these lists, or null when there are none (then nothing is said). */
export function publishedLine(lists: readonly PublishedList[]): PublishedLine | null {
  if (!lists.length) return null;
  const by = new Map<string, PublishedSource>();
  for (const l of lists) {
    const source = by.get(l.publisher) ?? { publisher: l.publisher, lists: [] };
    source.lists.push({ id: l.id, title: l.title, url: l.url, when: formatMonthYear(l.date, { short: true }) });
    by.set(l.publisher, source);
  }
  const n = lists.length;
  const lead = n === 1 ? "Includes 1 published burger ranking, counted like one visitor's list:" : `Includes ${formatCount(n)} published burger rankings, each counted like one visitor's list:`;
  return { count: n, lead, sources: [...by.values()] };
}

/** "A", "A and B", "A, B and C". */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "The Infatuation (Aug 2026, Jan 2026)": a publisher and its lists' months, as the line shows them. */
export function sourceText(s: PublishedSource): string {
  return `${s.publisher} (${s.lists.map((l) => l.when).join(", ")})`;
}

/**
 * The line as plain text (llms.txt, and what `check:seo` compares the page with): "Includes 4 published burger rankings,
 * each counted like one visitor's list: The Infatuation (Aug 2026, Jan 2026), Time Out (Oct 2025) and Brooklyn Magazine
 * (Sep 2024)."
 */
export function publishedLineText(line: PublishedLine): string {
  return `${line.lead} ${joinAnd(line.sources.map(sourceText))}.`;
}
