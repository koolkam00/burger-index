"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Anchor, Net, OrderBell, Scales, Spatula, Spyglass } from "@/components/icons/nautical";
import { EmptyState, Money, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { searchTracker, track, type BoardName } from "@/lib/analytics";
import { formatCount, formatPrice, pluralize } from "@/lib/format";
import { WORTH_ENABLED } from "@/lib/worth-config";
import { buildWorthBoards, formatDollars, peoplesPrice, searchWorthMenus, summarize, worthHref, type Hist, type WorthMenu, type WorthRow } from "@/lib/worth";
import { watchHist } from "@/lib/worth-api";
import { worthStore } from "@/lib/worth-store";
import { useHists, usePrefersReducedMotion } from "./hooks";
import { Dollars } from "./Dollars";

/** Rows per board before "Haul in … more". */
const PAGE = 10;
/** Entries in the "needs answers" list before "Haul in … more". */
const NEEDS_PAGE = 12;
/** Refresh interval while the realtime channel is down. */
const POLL_MS = 30_000;
/** Search results shown at once. */
const MAX_HITS = 8;
const SEARCH_ID = "worth-search";

type Row = WorthRow<WorthMenu>;

/**
 * The People's Price page body (DESIGN.md "The People's Price page"). Everything here loads in the
 * browser: the public histograms of the dataset's menus, then realtime changes (or a refresh every
 * 30 s while the channel is down). The dataset's menus and the Burger Index arrive as props; only
 * those menus' histograms are fetched, realtime changes to other keys are dropped, and a chain is one
 * entry.
 */
export function PeoplesPriceBoard({ menus, burgerIndex, menuCount }: { menus: WorthMenu[]; burgerIndex: number | null; menuCount: number }) {
  const hists = useHists();
  const [live, setLive] = useState(false);
  const keys = useMemo(() => menus.map((m) => m.key), [menus]);
  const loadAll = useCallback(() => void worthStore.loadHist(keys, { all: true }), [keys]);

  useEffect(() => {
    if (!WORTH_ENABLED) return;
    const known = new Set(keys);
    const refresh = loadAll;
    refresh();
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (poll !== null) clearInterval(poll);
      poll = null;
    };
    const unwatch = watchHist({
      onUpsert: (row) => {
        if (known.has(row.menu_key)) worthStore.applyRow(row);
      },
      onDelete: (key, dollars) => {
        if (known.has(key)) worthStore.removeRow(key, dollars);
      },
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
  }, [keys, loadAll]);

  const boards = useMemo(() => buildWorthBoards(menus, hists.hists), [menus, hists.hists]);
  // Only a load of every menu makes the boards complete (a restaurant page may have loaded one menu).
  const loading = WORTH_ENABLED && !hists.all && !hists.allFailed;
  const failedFirst = WORTH_ENABLED && !hists.all && hists.allFailed;
  const complete = WORTH_ENABLED && hists.all;
  const people = peoplesPrice(boards.index);

  const findBurger = () => {
    const input = document.getElementById(SEARCH_ID);
    input?.scrollIntoView({ block: "center" });
    input?.focus({ preventScroll: true });
  };

  return (
    <>
      <section className="mt-2" aria-label="The People's Burger Index" aria-busy={loading}>
        <p className="worth-meta t-ui-s muted">
          {live ? (
            <span className="badge badge-live">
              <span className="live-dot" aria-hidden="true" />
              Live
            </span>
          ) : null}
        </p>
        <StatGrid cols={3}>
          <StatTile
            label="People's Burger Index"
            icon={Scales}
            value={loading ? <span className="skel inline-block h-9 w-20 align-middle" aria-hidden="true" /> : people !== null ? <Dollars value={people} /> : "—"}
            sub={!complete ? "\u00a0" : people !== null ? pluralize(boards.indexMenus, "burger") : "Needs a few more answers"}
          />
          <StatTile
            label="The Burger Index"
            icon={Anchor}
            value={burgerIndex !== null ? <Money value={burgerIndex} /> : "—"}
            sub={`Menu prices · ${pluralize(menuCount, "menu")}`}
          />
          <StatTile
            label="Answers"
            icon={OrderBell}
            value={loading ? <span className="skel inline-block h-9 w-16 align-middle" aria-hidden="true" /> : complete ? formatCount(boards.answers) : "—"}
            sub={complete ? `On ${pluralize(boards.answered, "burger")}` : "\u00a0"}
          />
        </StatGrid>
        {loading ? (
          <span className="sr-only" role="status">
            Loading the answers
          </span>
        ) : null}
      </section>

      {!WORTH_ENABLED ? (
        <section className="section" aria-label="The boards">
          <EmptyState art="trap" height={220}>
            Answers open soon.
          </EmptyState>
        </section>
      ) : loading ? (
        <section className="section" aria-label="The boards" aria-busy="true">
          <BoardSkeleton />
        </section>
      ) : failedFirst ? (
        <section className="section" aria-label="The boards">
          <EmptyState
            art="net"
            height={220}
            action={
              <button type="button" className="btn btn-secondary" onClick={loadAll}>
                Try again
              </button>
            }
          >
            Couldn&apos;t reach the counter. Check your connection and try again.
          </EmptyState>
        </section>
      ) : boards.answered === 0 ? (
        <section className="section" aria-label="The boards">
          <EmptyState
            art="trap"
            height={220}
            action={
              <button type="button" className="btn btn-primary" onClick={findBurger}>
                Find a burger
              </button>
            }
          >
            Nobody has named a price yet. Be the first.
          </EmptyState>
        </section>
      ) : (
        <>
          <section className="section" aria-labelledby="bargains">
            <SectionHeading id="bargains" kicker="Good catch" icon={Net} title="Biggest bargains." />
            <div className="mt-6">
              {boards.bargains.length ? <PagedBoard rows={boards.bargains} label="Biggest bargains" board="bargains" /> : <BoardEmpty>No bargains on the board yet.</BoardEmpty>}
            </div>
          </section>
          <section className="section" aria-labelledby="overpriced">
            <SectionHeading id="overpriced" kicker="Walk the plank" icon={Anchor} title="Most overpriced." />
            <div className="mt-6">
              {boards.overpriced.length ? <PagedBoard rows={boards.overpriced} label="Most overpriced" board="overpriced" /> : <BoardEmpty>Nothing overpriced on the board yet.</BoardEmpty>}
            </div>
          </section>
          <section className="section" aria-labelledby="answered">
            <SectionHeading id="answered" kicker="Talk of the dock" icon={OrderBell} title="Most answered." />
            <div className="mt-6">
              <PagedBoard rows={boards.mostAnswered} label="Most answered" board="most_answered" />
            </div>
          </section>
          {boards.needsAnswers.length ? (
            <section className="section" aria-labelledby="needs">
              <SectionHeading
                id="needs"
                kicker="On the pass"
                icon={Spatula}
                title={`${pluralize(boards.needsAnswers.length, "burger")} ${boards.needsAnswers.length === 1 ? "needs" : "need"} a few more answers.`}
              />
              <NeedsAnswers rows={boards.needsAnswers} />
            </section>
          ) : null}
        </>
      )}

      <section className="section" aria-labelledby="find">
        <SectionHeading id="find" kicker="Name your price" icon={Spyglass} title="Find a burger." />
        <FindBurger menus={menus} hists={hists.hists} />
      </section>
    </>
  );
}

function BoardEmpty({ children }: { children: ReactNode }) {
  return (
    <EmptyState art="net" height={140}>
      {children}
    </EmptyState>
  );
}

/** A board with its first PAGE rows, then "Haul in … more". */
function PagedBoard({ rows, label, board }: { rows: Row[]; label: string; board: BoardName }) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <>
      <RowList rows={rows.slice(0, limit)} ranked label={label} board={board} />
      {rows.length > limit ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" className="btn btn-secondary" onClick={() => setLimit((n) => n + PAGE)}>
            Haul in {formatCount(Math.min(PAGE, rows.length - limit))} more
          </button>
          <span className="t-ui-s muted">
            Showing {formatCount(limit)} of {formatCount(rows.length)}
          </span>
        </div>
      ) : null}
    </>
  );
}

/** Five flat placeholder rows while the answers load (no shimmer: nothing loops). */
function BoardSkeleton() {
  return (
    <>
      <div className="worth-board-shell" aria-hidden="true">
        <ol className="worth-board">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="worth-row worth-row-skeleton">
              <span className="worth-rank">
                <span className="skel block h-6 w-6" />
              </span>
              <span className="worth-what">
                <span className="skel block h-5" style={{ width: `${62 - i * 7}%` }} />
                <span className="skel mt-2 block h-3.5" style={{ width: `${44 - i * 4}%` }} />
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="sr-only" role="status">
        Loading the boards
      </p>
    </>
  );
}

/**
 * A list of board rows. When the order or a row's numbers change, rows glide from where they were to
 * where they are (320 ms) and a changed row flashes the highlight tint once (1.2 s); neither happens
 * under reduced motion.
 */
function RowList({ rows, ranked = false, label, board }: { rows: Row[]; ranked?: boolean; label: string; board: BoardName }) {
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
    <div className={`worth-board-shell ${ranked ? "" : "is-unranked"}`}>
      {/* Column labels for sighted readers at desktop width; each row's cells carry their own words. */}
      <div className="worth-board-head t-label muted" aria-hidden="true">
        {ranked ? <span className="worth-rank">Rank</span> : null}
        <span className="worth-what">Burger</span>
        <span className="worth-cell wa-menu num">Menu</span>
        <span className="worth-cell wa-people num">People&apos;s</span>
        <span className="worth-cell wa-verdict">Verdict</span>
        <span className="worth-cell wa-count num">Answers</span>
      </div>
      <ol ref={listRef} className="worth-board" aria-label={label}>
        {rows.map((r, i) => (
          <BoardRow key={r.key} row={r} ranked={ranked} board={board} position={i + 1} />
        ))}
      </ol>
    </div>
  );
}

/** peoples_price_board_clicked: a row followed to its restaurant's slider (`position` counts from 1). */
function trackBoardClick(board: BoardName, r: Row, position: number) {
  track("peoples_price_board_clicked", { board, menu_key: r.key, restaurant_id: r.id, rank: r.rank, position });
}

function BoardRow({ row: r, ranked, board, position }: { row: Row; ranked: boolean; board: BoardName; position: number }) {
  const where = r.neighborhood ? `${r.neighborhood}, ${r.borough}` : r.locations > 1 ? pluralize(r.locations, "location") : r.borough;
  const verdict = r.answers === 0 ? "No answers yet" : r.verdict.label;
  return (
    <li className="worth-row" data-key={r.key} data-tally={`${r.answers}:${r.people ?? ""}`}>
      {ranked ? (
        <span className="worth-rank">
          <span className="sr-only">Rank </span>
          {r.rank ?? "–"}
        </span>
      ) : null}
      <div className="worth-what">
        <Link href={worthHref(r.id)} prefetch={false} className="ui-link t-ui-l break-anywhere font-semibold" onClick={() => trackBoardClick(board, r, position)}>
          {r.name}
        </Link>
        <p className="t-ui-s muted break-anywhere">{[r.burger, where].join(" · ")}</p>
      </div>
      <div className="worth-facts-row">
        <p className="worth-cell wa-menu num">
          <span className="worth-k">Menu </span>
          <span className="t-num-m">{formatPrice(r.price, { cents: "always" })}</span>
        </p>
        <p className="worth-cell wa-people num">
          <span className="worth-k">People&apos;s </span>
          <span className="t-num-m">{r.people !== null ? formatDollars(r.people) : "—"}</span>
        </p>
        <p className={`worth-cell wa-verdict t-ui-s ${r.verdict.kind === "pending" ? "muted" : "font-semibold"}`}>{verdict}</p>
        <p className="worth-cell wa-count num t-num-s muted">{pluralize(r.answers, "answer")}</p>
      </div>
    </li>
  );
}

/** Answered menus short of a verdict: a compact list of links, most answers first. */
function NeedsAnswers({ rows }: { rows: Row[] }) {
  const [limit, setLimit] = useState(NEEDS_PAGE);
  return (
    <>
      <ul className="worth-needs mt-6">
        {rows.slice(0, limit).map((r, i) => (
          <li key={r.key}>
            <Link href={worthHref(r.id)} prefetch={false} className="ui-link break-anywhere min-w-0 font-semibold" onClick={() => trackBoardClick("needs_answers", r, i + 1)}>
              {r.name}
              <span className="t-ui-s muted block font-medium">{r.burger}</span>
            </Link>
            <span className="t-num-s muted whitespace-nowrap">{pluralize(r.answers, "answer")}</span>
          </li>
        ))}
      </ul>
      {rows.length > limit ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" className="btn btn-secondary" onClick={() => setLimit((n) => n + NEEDS_PAGE)}>
            Haul in {formatCount(Math.min(NEEDS_PAGE, rows.length - limit))} more
          </button>
          <span className="t-ui-s muted">
            Showing {formatCount(limit)} of {formatCount(rows.length)}
          </span>
        </div>
      ) : null}
    </>
  );
}

/** "Find a burger": search the menus by restaurant, burger or neighborhood; each result links to its slider. */
function FindBurger({ menus, hists }: { menus: WorthMenu[]; hists: ReadonlyMap<string, Hist> }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchWorthMenus(menus, query), [menus, query]);
  // burger_search once typing pauses (lib/analytics); a no-op without the PostHog key.
  const [searchLog] = useState(() => searchTracker("peoples_price"));
  useEffect(() => searchLog.cancel, [searchLog]);
  const logSearch = (q: string) => searchLog(q, () => searchWorthMenus(menus, q).length);
  const shown: Row[] = hits.slice(0, MAX_HITS).map((m) => ({ ...m, ...summarize(hists.get(m.key), m.price), rank: null }));
  const searching = query.trim().length > 0;

  return (
    <div className="mt-6">
      <label htmlFor={SEARCH_ID} className="t-label muted mb-1.5 block">
        Find a burger
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
          onChange={(e) => {
            setQuery(e.target.value);
            logSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
              logSearch("");
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
              logSearch("");
              inputRef.current?.focus();
            }}
          >
            <X strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="t-ui-s muted mt-3" role="status">
        {searching && hits.length ? `Showing ${formatCount(shown.length)} of ${pluralize(hits.length, "match", "matches")}` : ""}
      </p>
      {searching ? (
        hits.length ? (
          <div className="mt-3">
            <RowList rows={shown} label="Search results" board="find" />
          </div>
        ) : (
          <div className="mt-3">
            <EmptyState art="net" height={160}>
              {/* The echoed search text is masked in session recordings (ph-mask), like the search box. */}
              No burgers match “<span className="ph-mask">{query.trim()}</span>”. Nothing in the net; try another name.
            </EmptyState>
          </div>
        )
      ) : null}
    </div>
  );
}
