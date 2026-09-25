"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pennant, Spyglass } from "@/components/icons/nautical";
import { EmptyState, SectionHeading } from "@/components/ui";
import { formatCount, formatPrice, pluralize } from "@/lib/format";
import { watchScores } from "@/lib/vote-api";
import { VOTING_ENABLED } from "@/lib/vote-config";
import { voteStore } from "@/lib/vote-store";
import { buildLeaderboard, formatAverage, searchVoteMenus, type ScoreRow, type VoteMenu } from "@/lib/votes";
import { usePrefersReducedMotion, useScores } from "./hooks";
import { VotePicker } from "./VotePicker";

/** Ranked rows shown before "Haul in … more". */
const PAGE = 50;
/** Refresh interval while the realtime channel is down. */
const POLL_MS = 30_000;
/** Search results shown at once. */
const MAX_HITS = 8;
const SEARCH_ID = "rate-search";

type Row = { menu: VoteMenu; votes: number; total: number; rank: number | null };

/**
 * The live "Best burgers" board (DESIGN.md "Best burgers leaderboard"). Everything here loads in the
 * browser: the public totals (then realtime changes, or a poll every 30 s while the channel is down)
 * and this browser's own votes. The dataset's menus arrive as props; totals for keys it doesn't know
 * are ignored, and a chain is one entry.
 */
export function BestBurgersBoard({ menus }: { menus: VoteMenu[] }) {
  const scores = useScores();
  const [live, setLive] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (!VOTING_ENABLED) return;
    void voteStore.loadMine();
    const refresh = () => void voteStore.loadScores();
    refresh();
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (poll !== null) clearInterval(poll);
      poll = null;
    };
    const unwatch = watchScores({
      onUpsert: (row) => voteStore.applyScore(row),
      onDelete: (key) => voteStore.removeScore(key),
      onStatus: (status) => {
        setLive(status === "live");
        if (status === "live") {
          // (Re)joined: catch up on anything that changed while the channel was down.
          stopPolling();
          refresh();
        } else if (poll === null) {
          poll = setInterval(refresh, POLL_MS);
        }
      },
    });
    return () => {
      unwatch();
      stopPolling();
    };
  }, []);

  const board = useMemo(() => buildLeaderboard(menus, scores.rows.values()), [menus, scores.rows]);

  if (!VOTING_ENABLED) {
    return (
      <section className="mt-2" aria-label="Best burgers">
        <EmptyState art="trap" height={220}>
          Voting opens soon.
        </EmptyState>
      </section>
    );
  }

  // Only a whole-table load makes the board complete (a restaurant page may have loaded one menu).
  const loading = !scores.all && !scores.allFailed;
  const ranked: Row[] = board.ranked.slice(0, limit).map((m) => ({ menu: m, votes: m.votes, total: m.total, rank: m.rank }));
  const pending: Row[] = board.pending.map((m) => ({ menu: m, votes: m.votes, total: m.total, rank: null }));
  const findBurger = () => {
    const input = document.getElementById(SEARCH_ID);
    input?.scrollIntoView({ block: "center" });
    input?.focus({ preventScroll: true });
  };

  return (
    <>
      <section className="mt-2" aria-label="Best burgers, ranked" aria-busy={loading}>
        <p className="vote-board-meta t-ui-s muted">
          {live ? (
            <span className="badge badge-status badge-live">
              <span className="live-dot" aria-hidden="true" />
              Live
            </span>
          ) : null}
          {!loading && board.votes > 0 ? (
            <span>
              {pluralize(board.votes, "vote")} on {pluralize(board.rated, "burger")}
            </span>
          ) : null}
        </p>

        {loading ? (
          <BoardSkeleton />
        ) : !scores.all ? (
          <EmptyState
            art="net"
            height={220}
            action={
              <button type="button" className="btn btn-secondary" onClick={() => void voteStore.loadScores()}>
                Try again
              </button>
            }
          >
            Couldn&apos;t reach the vote counter. Check your connection and try again.
          </EmptyState>
        ) : board.rated === 0 ? (
          <EmptyState
            art="trap"
            height={220}
            action={
              <button type="button" className="btn btn-primary" onClick={findBurger}>
                Find a burger to rate
              </button>
            }
          >
            No votes yet — be the first.
          </EmptyState>
        ) : ranked.length ? (
          <>
            <RowList rows={ranked} ranked label="Best burgers" />
            {board.ranked.length > limit ? (
              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button type="button" className="btn btn-secondary" onClick={() => setLimit((n) => n + PAGE)}>
                  Haul in {formatCount(Math.min(PAGE, board.ranked.length - limit))} more
                </button>
                <span className="t-ui-s muted">
                  Showing {formatCount(limit)} of {formatCount(board.ranked.length)}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState art="trap" height={180}>
            No burger is on the board yet. Rate a few below.
          </EmptyState>
        )}
      </section>

      {!loading && pending.length ? (
        <section className="section" aria-labelledby="needs-votes">
          <SectionHeading id="needs-votes" kicker="On the pass" icon={Pennant} title={`${pluralize(pending.length, "burger")} ${pending.length === 1 ? "needs" : "need"} more votes.`} />
          <div className="mt-6">
            <RowList rows={pending} label="Burgers that need more votes" />
          </div>
        </section>
      ) : null}

      <section className="section" aria-labelledby="rate-any">
        <SectionHeading id="rate-any" kicker="Cast a vote" icon={Spyglass} title="Rate any burger." />
        <RateAny menus={menus} rows={scores.rows} />
      </section>
    </>
  );
}

/** Five flat placeholder rows while the totals load (no shimmer: nothing loops). */
function BoardSkeleton() {
  return (
    <>
      <div className="vote-board-shell" aria-hidden="true">
      <ol className="vote-board">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="vote-row vote-row-skeleton">
            <span className="vote-rank">
              <span className="skel block h-6 w-6" />
            </span>
            <span className="vote-what">
              <span className="skel block h-5" style={{ width: `${62 - i * 7}%` }} />
              <span className="skel mt-2 block h-3.5" style={{ width: `${44 - i * 4}%` }} />
            </span>
            <span className="vote-avg">
              <span className="skel block h-6 w-10" />
            </span>
          </li>
        ))}
      </ol>
      </div>
      <p className="sr-only" role="status">
        Loading the ranking
      </p>
    </>
  );
}

/**
 * A list of board rows. When the order or a tally changes, rows glide from where they were to where
 * they are (320 ms) and a changed row flashes the highlight tint once (1.2 s); neither happens under
 * reduced motion.
 */
function RowList({ rows, ranked = false, label }: { rows: Row[]; ranked?: boolean; label: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  const tops = useRef(new Map<string, number>());
  const tallies = useRef(new Map<string, string>());
  const reduce = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const first = tops.current.size === 0;
    const style = getComputedStyle(list);
    const tint = style.getPropertyValue("--highlight-tint").trim();
    const paper = style.getPropertyValue("--surface").trim();
    const nextTops = new Map<string, number>();
    const nextTallies = new Map<string, string>();
    for (const el of Array.from(list.children) as HTMLElement[]) {
      const key = el.dataset.key;
      if (!key) continue;
      const top = el.offsetTop;
      const tally = el.dataset.tally ?? "";
      const prevTop = tops.current.get(key);
      const prevTally = tallies.current.get(key);
      if (!reduce && !first && typeof el.animate === "function") {
        if (prevTop === undefined) {
          el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" });
        } else if (prevTop !== top) {
          el.animate([{ transform: `translateY(${prevTop - top}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" });
        }
        if (prevTally !== undefined && prevTally !== tally && tint && paper) {
          el.animate([{ backgroundColor: tint }, { backgroundColor: paper }], { duration: 1200, easing: "cubic-bezier(.2,.7,.2,1)" });
        }
      }
      nextTops.set(key, top);
      nextTallies.set(key, tally);
    }
    tops.current = nextTops;
    tallies.current = nextTallies;
  });

  return (
    <div className={`vote-board-shell ${ranked ? "" : "is-unranked"}`}>
      {/* Column labels for sighted readers at desktop width; each row's cells carry their own words. */}
      <div className="vote-board-head t-label muted" aria-hidden="true">
        {ranked ? <span className="vote-rank">Rank</span> : null}
        <span className="vote-what">Burger</span>
        <span className="vote-avg">Average</span>
        <span className="vote-mine" />
      </div>
      <ol ref={listRef} className="vote-board" aria-label={label}>
        {rows.map((r) => (
          <BoardRow key={r.menu.key} row={r} ranked={ranked} />
        ))}
      </ol>
    </div>
  );
}

function BoardRow({ row, ranked }: { row: Row; ranked: boolean }) {
  const { menu: m, votes, total, rank } = row;
  const where = m.neighborhood ? `${m.neighborhood}, ${m.borough}` : m.locations > 1 ? pluralize(m.locations, "location") : m.borough;
  return (
    <li className="vote-row" data-key={m.key} data-tally={`${votes}:${total}`}>
      {ranked ? (
        <span className="vote-rank">
          <span className="sr-only">Rank </span>
          {rank ?? "–"}
        </span>
      ) : null}
      <div className="vote-what">
        <Link href={`/restaurants/${m.id}`} className="ui-link t-ui-l break-anywhere font-semibold">
          {m.name}
        </Link>
        <p className="t-ui-s muted break-anywhere">
          {[m.burger, m.price !== null ? formatPrice(m.price, { cents: "always" }) : null, where].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="vote-avg">
        {votes > 0 ? (
          <>
            <span className="t-num-l">
              {formatAverage(total / votes)}
              <span className="sr-only"> average out of 10,</span>
            </span>
            <span className="t-num-s muted">{pluralize(votes, "vote")}</span>
          </>
        ) : (
          <span className="t-ui-s muted">No votes yet</span>
        )}
      </div>
      <div className="vote-mine">
        <VotePicker menuKey={m.key} name={`${m.burger} at ${m.name}`} label="Your vote" size="sm" status="compact" />
      </div>
    </li>
  );
}

/** "Rate any burger": find a menu by restaurant, burger or neighborhood and vote right here. */
function RateAny({ menus, rows }: { menus: VoteMenu[]; rows: ReadonlyMap<string, ScoreRow> }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchVoteMenus(menus, query), [menus, query]);
  const shown: Row[] = hits.slice(0, MAX_HITS).map((m) => ({ menu: m, votes: rows.get(m.key)?.votes ?? 0, total: rows.get(m.key)?.total ?? 0, rank: null }));
  const searching = query.trim().length > 0;

  return (
    <div className="mt-6">
      <label htmlFor={SEARCH_ID} className="t-label muted mb-1.5 block">
        Find a burger to rate
      </label>
      <div className="relative max-w-xl">
        <Search className="muted pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2" strokeWidth={2} aria-hidden="true" />
        <input
          ref={inputRef}
          id={SEARCH_ID}
          type="search"
          className="input input-search pr-12 pl-11 [&::-webkit-search-cancel-button]:hidden"
          placeholder="Restaurant, burger or neighborhood"
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="icon-btn absolute top-1/2 right-1 size-9 -translate-y-1/2"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="t-ui-s muted mt-3" role="status">
        {searching ? (hits.length ? `Showing ${formatCount(shown.length)} of ${pluralize(hits.length, "match", "matches")}` : "") : ""}
      </p>
      {searching ? (
        hits.length ? (
          <div className="mt-3">
            <RowList rows={shown} label="Search results" />
          </div>
        ) : (
          <div className="mt-3">
            <EmptyState art="net" height={160}>
              No burgers match “{query.trim()}”. Nothing in the net; try another name.
            </EmptyState>
          </div>
        )
      ) : null}
    </div>
  );
}
