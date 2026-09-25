// Visitor ratings (DESIGN.md "Vote picker" and "Best burgers leaderboard"): pure, client-safe helpers.
//
// Visitors rate a menu's burger 1–10 (whole numbers). The backend (supabase/README.md) keeps one
// vote per visitor per menu and a public running total per menu (burger_scores: votes, total). The
// leaderboard ranks menus by a weighted rating that pulls a burger with few votes towards the mean
// of all votes (a Bayesian average), so a handful of 10s can't jump a burger past one with a long
// record of 9s:
//
//   rating = (C * m + total) / (C + votes),  C = 5, m = mean of every vote (7 before any vote)
//
// and only menus with at least 3 votes are ranked. None of this is ever explained on the site
// (DESIGN.md "No methodology copy").
//
// A menu is the site's distinct menu (./menus menuKey): a restaurant id, or "chain:<slug>" for a
// chain, whose locations share one menu, one burger and so one entry here.
import { normalize, queryTokens } from "./explorer";
import { pricedMenus } from "./menus";
import type { Borough, Restaurant } from "./schema";

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
/** The ten scores a visitor can give, low to high. */
export const SCORES: readonly number[] = Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i);

/** The weight of the prior (C): how many "average" votes every burger starts with. */
export const RATING_PRIOR_VOTES = 5;
/** The prior mean (m) before anyone has voted. */
export const FALLBACK_MEAN = 7;
/** Votes a menu needs before it is ranked. Fewer: listed apart, never ranked. */
export const MIN_RANKED_VOTES = 3;

/** A whole number from 1 to 10 (the only scores the backend accepts: no decimals, no strings). */
export function isValidScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= SCORE_MIN && v <= SCORE_MAX;
}

/** Same pattern as the database check on burger_votes.menu_key. */
export const MENU_KEY_PATTERN = /^(chain:)?[a-z0-9-]{1,120}$/;

export function isMenuKey(v: unknown): v is string {
  return typeof v === "string" && MENU_KEY_PATTERN.test(v);
}

/**
 * One row of the public burger_scores table (running totals per menu). `at` is its updated_at in
 * epoch ms (null when the source doesn't carry it: cast_vote's reply), used to drop stale copies.
 */
export type ScoreRow = { menu_key: string; votes: number; total: number; at: number | null };

/**
 * A burger_scores row from the network (REST, a realtime payload or cast_vote's reply), checked: a
 * menu key, and whole, non-negative counts whose total fits the vote count (1–10 per vote). Anything
 * else is null.
 */
export function parseScoreRow(v: unknown): ScoreRow | null {
  if (!v || typeof v !== "object") return null;
  const { menu_key, votes, total, updated_at } = v as Record<string, unknown>;
  if (!isMenuKey(menu_key)) return null;
  if (typeof votes !== "number" || !Number.isInteger(votes) || votes < 0) return null;
  if (typeof total !== "number" || !Number.isInteger(total) || total < votes * SCORE_MIN || total > votes * SCORE_MAX) return null;
  const at = typeof updated_at === "string" ? Date.parse(updated_at) : NaN;
  return { menu_key, votes, total, at: Number.isFinite(at) ? at : null };
}

/** A menu as the vote UI shows it: its burger, where it is, and the page to link to. */
export type VoteMenu = {
  /** menu key (restaurant id, or "chain:<slug>") */
  key: string;
  /** restaurant id of the row that stands for the menu (a chain: its first priced location) */
  id: string;
  name: string;
  burger: string;
  price: number | null;
  /** null for a chain (it has many locations) or a restaurant without one */
  neighborhood: string | null;
  borough: Borough;
  /** priced locations sharing the menu (1 for an independent restaurant) */
  locations: number;
};

/**
 * Every distinct priced menu in `list`, once each (a chain once, however many locations), with the
 * burger visitors rate: the menu's index burger (the dataset lists one burger per restaurant).
 */
export function voteMenus(list: readonly Restaurant[]): VoteMenu[] {
  const out: VoteMenu[] = [];
  for (const m of pricedMenus(list)) {
    const r = m.restaurant;
    const b = r.burgers.find((x) => x.is_index_item) ?? r.burgers[0];
    if (!b) continue;
    out.push({
      key: m.key,
      id: r.id,
      name: r.name,
      burger: b.name,
      price: b.price,
      neighborhood: m.chain ? null : r.neighborhood,
      borough: r.borough,
      locations: m.locations,
    });
  }
  return out;
}

export function weightedRating(total: number, votes: number, mean: number, priorVotes: number = RATING_PRIOR_VOTES): number {
  return (priorVotes * mean + total) / (priorVotes + votes);
}

export type Rated<M> = M & {
  votes: number;
  total: number;
  /** plain average of the votes (shown, one decimal) */
  average: number;
  /** weighted rating (orders the ranking; never shown) */
  rating: number;
  /** 1-based rank, shared by exact ties; null outside the ranking */
  rank: number | null;
};

export type Leaderboard<M> = {
  /** menus with at least MIN_RANKED_VOTES votes, best first */
  ranked: Rated<M>[];
  /** menus with 1 to MIN_RANKED_VOTES-1 votes, best average first */
  pending: Rated<M>[];
  /** the mean vote across every known menu (FALLBACK_MEAN before any vote) */
  mean: number;
  /** votes across every known menu */
  votes: number;
  /** known menus with at least one vote */
  rated: number;
};

const EPS = 1e-9;

/**
 * The live ranking: `scores` joined to the dataset's `menus` by menu key. Score rows for keys the
 * dataset doesn't know (an old or mistyped key) are ignored, and so are malformed rows and rows with
 * no votes left. A menu listed twice counts once (the first entry wins). Ties on the weighted rating
 * share a rank (1, 2, 2, 4) and are ordered by more votes, then by name.
 */
export function buildLeaderboard<M extends { key: string; name: string }>(
  menus: readonly M[],
  scores: Iterable<Pick<ScoreRow, "menu_key" | "votes" | "total">>,
  opts: { priorVotes?: number; fallbackMean?: number; minVotes?: number } = {},
): Leaderboard<M> {
  const priorVotes = opts.priorVotes ?? RATING_PRIOR_VOTES;
  const minVotes = opts.minVotes ?? MIN_RANKED_VOTES;
  const byKey = new Map<string, M>();
  for (const m of menus) if (!byKey.has(m.key)) byKey.set(m.key, m);

  const rows = new Map<string, ScoreRow>();
  for (const s of scores) {
    const row = parseScoreRow(s);
    if (row && row.votes > 0 && byKey.has(row.menu_key)) rows.set(row.menu_key, row);
  }

  let votes = 0;
  let total = 0;
  for (const r of rows.values()) {
    votes += r.votes;
    total += r.total;
  }
  const mean = votes > 0 ? total / votes : (opts.fallbackMean ?? FALLBACK_MEAN);

  const rated: Rated<M>[] = [...rows.values()].map((r) => ({
    ...(byKey.get(r.menu_key) as M),
    votes: r.votes,
    total: r.total,
    average: r.total / r.votes,
    rating: weightedRating(r.total, r.votes, mean, priorVotes),
    rank: null,
  }));
  const byName = (a: Rated<M>, b: Rated<M>) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

  const ranked = rated
    .filter((m) => m.votes >= minVotes)
    .sort((a, b) => (Math.abs(b.rating - a.rating) > EPS ? b.rating - a.rating : 0) || b.votes - a.votes || byName(a, b));
  ranked.forEach((m, i) => {
    const prev = ranked[i - 1];
    m.rank = prev && Math.abs(prev.rating - m.rating) <= EPS ? (prev.rank as number) : i + 1;
  });

  const pending = rated
    .filter((m) => m.votes < minVotes)
    .sort((a, b) => (Math.abs(b.average - a.average) > EPS ? b.average - a.average : 0) || b.votes - a.votes || byName(a, b));

  return { ranked, pending, mean, votes, rated: rated.length };
}

/**
 * Menus matching a search (restaurant, burger, neighborhood or borough; every word must match),
 * restaurant names that start with the query first, then names that contain it, then the rest,
 * each by name.
 */
export function searchVoteMenus<M extends Pick<VoteMenu, "key" | "name" | "burger" | "neighborhood" | "borough">>(menus: readonly M[], query: string): M[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const q = tokens.join(" ");
  const hits: Array<{ m: M; tier: number }> = [];
  for (const m of menus) {
    const name = normalize(m.name);
    const hay = `${name} ${normalize(m.burger)} ${normalize(m.neighborhood ?? "")} ${normalize(m.borough)}`;
    if (!tokens.every((t) => hay.includes(t))) continue;
    hits.push({ m, tier: name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2 });
  }
  return hits
    .sort((a, b) => a.tier - b.tier || a.m.name.localeCompare(b.m.name) || (a.m.key < b.m.key ? -1 : a.m.key > b.m.key ? 1 : 0))
    .map((h) => h.m);
}

/** "8.7": an average with one decimal (half up). */
export function formatAverage(avg: number): string {
  return (Math.round(avg * 10 + EPS) / 10).toFixed(1);
}

// ---- errors ----------------------------------------------------------------------------------

export type VoteErrorKind = "rate" | "invalid" | "network" | "disabled" | "unknown";

/** What a failed call means, from a PostgREST / fetch error (SQLSTATE codes from cast_vote). */
export function classifyVoteError(err: unknown): VoteErrorKind {
  if (err && typeof err === "object") {
    const { code, message, name, kind } = err as { code?: unknown; message?: unknown; name?: unknown; kind?: unknown };
    if (kind === "rate" || kind === "invalid" || kind === "network" || kind === "disabled" || kind === "unknown") return kind;
    if (code === "54000") return "rate";
    if (code === "22023" || code === "22P02") return "invalid";
    const text = `${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`;
    if (/fetch|network|load failed|timed? ?out|abort|offline|ECONN|socket/i.test(text)) return "network";
    if (!code) return "network";
  }
  return "unknown";
}

/** Friendly copy for each failure (DESIGN.md "Vote picker": error states). */
export const VOTE_ERROR_COPY: Record<VoteErrorKind, string> = {
  rate: "Too many votes from this connection — try again in a bit.",
  invalid: "That vote didn't go through. Pick a whole number from 1 to 10.",
  network: "Couldn't reach the vote counter. Check your connection and try again.",
  disabled: "Voting opens soon.",
  unknown: "Something went wrong saving your vote. Try again.",
};
