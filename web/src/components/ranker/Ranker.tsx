"use client";

import { ArrowDown, ArrowRight, ArrowUp, Plus, Search, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useMediaQuery } from "@/components/charts/hooks";
import { RopeLadder } from "@/components/icons/nautical";
import { PriceChip } from "@/components/ui";
import { fromPath, track } from "@/lib/analytics";
import { formatCount, pluralize } from "@/lib/format";
import {
  countLine,
  listProblem,
  MAX_HITS,
  MAX_ITEMS,
  MINE_FAILED_COPY,
  nyToday,
  PROBLEM_COPY,
  RANKER_ERROR_COPY,
  savedStatusText,
  searchBurgers,
  TOP_N,
  type RankerBurger,
} from "@/lib/ranker";
import { rankerStore, type RankerSnapshot } from "@/lib/ranker-store";
import { PEOPLES_TOP_NAME, PEOPLES_TOP_PATH, RANKER_ANCHOR, RANKER_FOCUS_EVENT, RANKER_TITLE_ID } from "@/lib/site";
import { RANKER_ENABLED } from "@/lib/supabase-config";

/** Where focus goes after a step: a heading, the search box, a row's control, or a named button. */
type FocusTarget = { kind: "heading" } | { kind: "search" } | { kind: "row"; key: string; control: "up" | "down" | "remove" } | { kind: "button"; name: string };

function useRanker(): RankerSnapshot {
  return useSyncExternalStore(rankerStore.subscribe, rankerStore.getSnapshot, rankerStore.getServerSnapshot);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** "Emily" (with where it is when another burger's restaurant has the name), or a stand-in for a burger no longer listed. */
const nameOf = (b: RankerBurger | undefined) => b?.label ?? "A burger no longer listed";

/**
 * The burger ranker, the home page's first screen (DESIGN.md "The ranker hero"; user decisions 2026-09-25/26):
 * search the priced burgers (a chain once), add 3 to 25 in order, move them up and down, remove them, and save
 * the list; come back to see it, edit it or delete it. One list per browser (and per connection: the backend
 * keeps the latest). The People's Top 10 is made from everyone's lists once a day.
 *
 * The prerendered page holds the empty list and the search box (no burgers: they come from /data/menus.json,
 * fetched when the ranker mounts). A browser with a saved list sees a skeleton instead (a <head> flag,
 * html.ranker-saved) until it loads. The Supabase client loads when the ranker first needs it: the saved list
 * of a returning browser, else the first save. Without the Supabase settings the card says lists open soon.
 */
export function Ranker({ median }: { median: number | null }) {
  const snap = useRanker();
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const [announce, setAnnounce] = useState("");
  // Bumped to re-render after an awaited step, so its focus move runs (the store's own update came before it).
  const [, setFocusTick] = useState(0);
  const focusAfter = (target: FocusTarget) => {
    pendingFocus.current = target;
    setFocusTick((n) => n + 1);
  };

  useEffect(() => {
    if (RANKER_ENABLED) rankerStore.start();
  }, []);

  // After a step the visitor took, focus what it shows (only while focus is in the card, or was dropped
  // with a control that went away).
  useEffect(() => {
    const want = pendingFocus.current;
    const root = rootRef.current;
    if (!want || !root) return;
    const selector =
      want.kind === "heading"
        ? "[data-ranker-heading]"
        : want.kind === "search"
          ? "[data-ranker-search]"
          : want.kind === "button"
            ? `[data-ranker-button="${want.name}"]`
            : `[data-row="${CSS.escape(want.key)}"] [data-ctl="${want.control}"]`;
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) return;
    pendingFocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) return;
    el.focus();
  });

  // The header's "Rank your burgers" on this page scrolls here and focuses the ranker; arriving on /#rank
  // (from another page) focuses it too, once the router or the browser has scrolled.
  useEffect(() => {
    const focusRanker = (scroll: boolean) => {
      if (scroll) document.getElementById(RANKER_ANCHOR)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      rootRef.current?.focus({ preventScroll: true });
    };
    const onCta = () => focusRanker(true);
    window.addEventListener(RANKER_FOCUS_EVENT, onCta);
    if (window.location.hash === `#${RANKER_ANCHOR}`) focusRanker(false);
    return () => window.removeEventListener(RANKER_FOCUS_EVENT, onCta);
  }, []);

  if (!RANKER_ENABLED) {
    // Still the focus target of "Rank your burgers" (tabindex −1), like the live card.
    return (
      <div ref={rootRef} className="ranker panel" tabIndex={-1}>
        <RankerBar />
        <h3 className="t-display-m ranker-title">Your top 10.</h3>
        <p className="t-ui-m muted mt-2">{RANKER_ERROR_COPY.disabled}</p>
      </div>
    );
  }

  const say = (text: string) => setAnnounce((prev) => (prev === text ? `${text} ` : text));
  /** The first change to a list (new, or the saved one) is ranking_started. */
  const starting = () => {
    if (!snap.dirty) track("ranking_started", { edited: snap.saved !== null });
  };

  const add = (b: RankerBurger) => {
    if (snap.busy || snap.draft.includes(b.key) || snap.draft.length >= MAX_ITEMS) return;
    starting();
    rankerStore.add(b.key);
    const position = snap.draft.length + 1;
    track("ranking_item_added", { menu_key: b.key, position });
    say(`${b.label} added at #${position}. ${pluralize(position, "burger")} on your list.`);
  };
  const move = (key: string, delta: number) => {
    const from = snap.draft.indexOf(key);
    const to = from + delta;
    if (snap.busy || from < 0 || to < 0 || to >= snap.draft.length) return;
    starting();
    rankerStore.move(key, delta);
    const control = delta < 0 ? (to === 0 ? "down" : "up") : to === snap.draft.length - 1 ? "up" : "down";
    pendingFocus.current = { kind: "row", key, control };
    say(`${nameOf(snap.burgers.get(key))} moved to #${to + 1}.`);
  };
  const remove = (key: string) => {
    if (snap.busy) return;
    const i = snap.draft.indexOf(key);
    starting();
    rankerStore.remove(key);
    const rest = snap.draft.filter((k) => k !== key);
    const next = rest[i] ?? rest[i - 1];
    pendingFocus.current = next ? { kind: "row", key: next, control: "remove" } : { kind: "search" };
    say(`${nameOf(snap.burgers.get(key))} removed. ${pluralize(rest.length, "burger")} on your list.`);
  };
  const save = async () => {
    const result = await rankerStore.save();
    if (!result.ok) return;
    track("ranking_saved", { length: result.length, edited: result.edited });
    focusAfter({ kind: "heading" });
  };
  const edit = () => {
    rankerStore.edit();
    pendingFocus.current = { kind: "heading" };
  };
  const cancel = () => {
    rankerStore.cancel();
    pendingFocus.current = { kind: "heading" };
  };
  const askDelete = () => {
    rankerStore.askDelete();
    pendingFocus.current = { kind: "button", name: "keep" };
  };
  const keep = () => {
    rankerStore.keepList();
    pendingFocus.current = { kind: "button", name: "delete" };
  };
  const confirmDelete = async () => {
    const length = await rankerStore.deleteList();
    if (length === null) return;
    track("ranking_deleted", { length });
    focusAfter({ kind: "heading" });
  };
  const retryMine = () => {
    pendingFocus.current = { kind: "heading" };
    void rankerStore.loadMine();
  };

  let body: ReactNode;
  if (snap.mine === "loading") {
    body = <Skeleton />;
  } else if (snap.mine === "error") {
    body = (
      <>
        <h3 tabIndex={-1} data-ranker-heading="" className="t-display-m ranker-title">
          Your top 10.
        </h3>
        <p className="t-ui-m ranker-alert mt-3" role="alert">
          <TriangleAlert className="status-icon" strokeWidth={2} aria-hidden="true" />
          <span>{MINE_FAILED_COPY}</span>
        </p>
        <button type="button" className="btn btn-secondary mt-4" onClick={retryMine}>
          Try again
        </button>
      </>
    );
  } else if (snap.view === "saved" && snap.saved) {
    body = <SavedView snap={snap} onEdit={edit} onSave={save} onAskDelete={askDelete} onKeep={keep} onDelete={confirmDelete} />;
  } else {
    body = <Builder snap={snap} median={median} onAdd={add} onMove={move} onRemove={remove} onSave={save} onCancel={cancel} />;
  }

  return (
    <div ref={rootRef} className="ranker panel" tabIndex={-1} data-boot={snap.started ? undefined : ""}>
      <RankerBar />
      <div className="ranker-body">{body}</div>
      {!snap.started ? (
        <div className="ranker-boot">
          <Skeleton />
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </div>
  );
}

/** The card's top line: the section heading "Rank your burgers" (a kicker-styled H2 that names the ranker in every state) and the link to the board. */
function RankerBar() {
  return (
    <div className="ranker-bar">
      <h2 id={RANKER_TITLE_ID} className="kicker t-kicker">
        <RopeLadder />
        Rank your burgers
      </h2>
      <Link href={PEOPLES_TOP_PATH} className="link t-ui-s ranker-board-link" onClick={() => track("peoples_top_clicked", { surface: "ranker", from_path: fromPath(window.location.pathname) })}>
        {PEOPLES_TOP_NAME}
        <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
      </Link>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="ranker-skeleton" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your list
      </span>
      <span className="skel block h-9 w-56 max-w-full" aria-hidden="true" />
      <span className="skel mt-4 block h-12 w-full" aria-hidden="true" />
      <span className="skel mt-3 block h-12 w-full" aria-hidden="true" />
      <span className="skel mt-3 block h-12 w-full" aria-hidden="true" />
    </div>
  );
}

/** A line with the warning icon: a failure the visitor should read (the status line carries it). */
function Alert({ children }: { children: ReactNode }) {
  return (
    <span className="ranker-alert">
      <TriangleAlert className="status-icon" strokeWidth={2} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** The saved list: its rows, what it counts for, and "Edit my list" / "Delete my list". */
function SavedView({
  snap,
  onEdit,
  onSave,
  onAskDelete,
  onKeep,
  onDelete,
}: {
  snap: RankerSnapshot;
  onEdit: () => void;
  onSave: () => void;
  onAskDelete: () => void;
  onKeep: () => void;
  onDelete: () => void;
}) {
  const saved = snap.saved!;
  const status = savedStatusText(saved, nyToday());
  const failure = snap.failure ? RANKER_ERROR_COPY[snap.failure.kind] : null;
  const busyText = snap.busy === "saving" ? "Saving your list…" : snap.busy === "deleting" ? "Deleting your list…" : null;
  const held = snap.busy !== null;
  // A burger that left the Burger Index: the visitor replaces it by editing (a save can't carry it).
  const gone = snap.menus === "ready" && saved.items.some((k) => !snap.burgers.has(k));
  return (
    <>
      <h3 tabIndex={-1} data-ranker-heading="" className="t-display-m ranker-title">
        Your top {formatCount(saved.items.length)}.
      </h3>
      <p className="t-ui-m ranker-saved-status mt-1" role="status">
        {status}
        {gone ? " Some burgers on it are no longer on the Burger Index: edit your list to replace them." : null}
      </p>
      <ol className="ranker-list is-saved mt-4" aria-label="Your list">
        {saved.items.map((key, i) => (
          <SavedRow key={key} rank={i + 1} burger={snap.burgers.get(key)} loading={snap.menus !== "ready"} />
        ))}
      </ol>
      {snap.confirmDelete ? (
        <div className="ranker-confirm mt-5" role="group" aria-labelledby="ranker-confirm-q">
          <p id="ranker-confirm-q" className="t-ui-m font-semibold">
            Delete your list? It stops counting at the next update.
          </p>
          <div className="ranker-actions mt-3">
            <button type="button" className="btn btn-primary" data-ranker-button="delete" aria-disabled={held || undefined} onClick={() => !held && onDelete()}>
              Delete my list
            </button>
            <button type="button" className="btn btn-secondary" data-ranker-button="keep" aria-disabled={held || undefined} onClick={() => !held && onKeep()}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="ranker-actions mt-5">
          {saved.status === "replaced" && !gone ? (
            <button type="button" className="btn btn-primary btn-lg" data-ranker-button="save" aria-disabled={held || undefined} onClick={() => !held && onSave()}>
              Save again
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary btn-lg" data-ranker-button="edit" aria-disabled={held || undefined} onClick={() => !held && onEdit()}>
            Edit my list
          </button>
          <button type="button" className="btn btn-ghost" data-ranker-button="delete" aria-disabled={held || undefined} onClick={() => !held && onAskDelete()}>
            Delete my list
          </button>
        </div>
      )}
      <p className="t-ui-s ranker-status mt-3" aria-live="polite">
        {failure ? <Alert>{failure}</Alert> : (busyText ?? "")}
      </p>
    </>
  );
}

function SavedRow({ rank, burger, loading }: { rank: number; burger: RankerBurger | undefined; loading: boolean }) {
  return (
    <li className={`ranker-row${rank === TOP_N + 1 ? " is-first-extra" : ""}`}>
      {rank === TOP_N + 1 ? <ExtraRule /> : null}
      <span className="ranker-rank">
        <span className="sr-only">Number </span>
        {rank}
      </span>
      <div className="ranker-what">
        {burger ? (
          <>
            <Link href={`/restaurants/${burger.id}`} className="ui-link break-anywhere font-semibold">
              {burger.name}
            </Link>
            <p className="t-ui-s muted break-anywhere">{`${burger.burger} · ${burger.where}`}</p>
          </>
        ) : loading ? (
          <span className="skel block h-5 w-40 max-w-full" aria-hidden="true" />
        ) : (
          <p className="t-ui-m muted">No longer on the Burger Index</p>
        )}
      </div>
    </li>
  );
}

/** The rule between #10 and #11: the list is "your top 10", with room for more. */
function ExtraRule() {
  return (
    <span className="ranker-extra-rule t-label muted" aria-hidden="true">
      Beyond your top 10
    </span>
  );
}

/** Building a list, or editing the saved one: the search, the list with its controls, and "Save". */
function Builder({
  snap,
  median,
  onAdd,
  onMove,
  onRemove,
  onSave,
  onCancel,
}: {
  snap: RankerSnapshot;
  median: number | null;
  onAdd: (b: RankerBurger) => void;
  onMove: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [tried, setTried] = useState(false);
  const draft = snap.draft;
  const ready = snap.menus === "ready";
  const problem = listProblem(draft, (k) => !ready || snap.burgers.has(k));
  const held = snap.busy !== null;
  const editing = snap.saved !== null;
  const canSave = !problem && !held && (snap.dirty || !editing);
  // The status line: saving, the last failure, why "Save" can't go yet (once tried), or what just happened.
  const status: ReactNode =
    snap.busy === "saving" ? (
      "Saving your list…"
    ) : snap.failure ? (
      <Alert>{RANKER_ERROR_COPY[snap.failure.kind]}</Alert>
    ) : problem && (tried || problem === "gone") ? (
      <Alert>{PROBLEM_COPY[problem]}</Alert>
    ) : snap.notice === "deleted" ? (
      "Your list was deleted."
    ) : (
      ""
    );

  return (
    <>
      <h3 tabIndex={-1} data-ranker-heading="" className="t-display-m ranker-title">
        {editing ? "Edit your list." : "Your top 10."}
      </h3>
      <p className="t-ui-m muted mt-1">Pick the burgers you like best, your favorite first: at least 3, up to 25.</p>

      <BurgerSearch snap={snap} median={median} onAdd={onAdd} />

      <p id={`${uid}-list`} className="t-label muted mt-6">
        Your list
      </p>
      {draft.length ? (
        <ol className="ranker-list mt-2" aria-labelledby={`${uid}-list`}>
          {draft.map((key, i) => {
            const b = snap.burgers.get(key);
            const name = b ? b.label : ready ? "A burger no longer on the Burger Index" : "Loading";
            return (
              <li key={key} data-row={key} className={`ranker-row${i === TOP_N ? " is-first-extra" : ""}`}>
                {i === TOP_N ? <ExtraRule /> : null}
                <span className="ranker-rank">
                  <span className="sr-only">Number </span>
                  {i + 1}
                </span>
                <div className="ranker-what">
                  {b ? (
                    <>
                      <p className="font-semibold break-anywhere">{b.name}</p>
                      <p className="t-ui-s muted break-anywhere">{`${b.burger} · ${b.where}`}</p>
                    </>
                  ) : ready ? (
                    <p className="t-ui-m muted">No longer on the Burger Index</p>
                  ) : (
                    <span className="skel block h-5 w-40 max-w-full" aria-hidden="true" />
                  )}
                </div>
                <div className="ranker-ctls">
                  <button
                    type="button"
                    className="icon-btn ranker-ctl"
                    data-ctl="up"
                    aria-label={`Move ${name} up`}
                    aria-disabled={i === 0 || held || undefined}
                    onClick={() => onMove(key, -1)}
                  >
                    <ArrowUp strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn ranker-ctl"
                    data-ctl="down"
                    aria-label={`Move ${name} down`}
                    aria-disabled={i === draft.length - 1 || held || undefined}
                    onClick={() => onMove(key, 1)}
                  >
                    <ArrowDown strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn ranker-ctl" data-ctl="remove" aria-label={`Remove ${name}`} aria-disabled={held || undefined} onClick={() => onRemove(key)}>
                    <X strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="ranker-empty t-ui-m muted mt-2">No burgers yet. Find one above and add your favorite first.</p>
      )}
      <p className="t-ui-s muted mt-2">{countLine(draft.length)}</p>

      <div className="ranker-actions mt-5">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          data-ranker-button="save"
          aria-disabled={!canSave || undefined}
          onClick={() => {
            setTried(true);
            if (canSave) onSave();
          }}
        >
          {editing ? "Save changes" : "Save my list"}
        </button>
        {editing ? (
          <button type="button" className="btn btn-secondary btn-lg" aria-disabled={held || undefined} onClick={() => !held && onCancel()}>
            Cancel
          </button>
        ) : null}
      </div>
      <p className="t-ui-s ranker-status mt-3" aria-live="polite">
        {status}
      </p>
    </>
  );
}

/** "Find a burger": the priced burgers whose restaurant, burger or neighborhood match, each with "Add". */
function BurgerSearch({ snap, median, onAdd }: { snap: RankerSnapshot; median: number | null; onAdd: (b: RankerBurger) => void }) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const hits = useMemo(() => (snap.menus === "ready" && searching ? searchBurgers(snap.burgers.values(), query) : []), [snap.menus, snap.burgers, searching, query]);
  const full = snap.draft.length >= MAX_ITEMS;
  const held = snap.busy !== null;
  // The long placeholder needs about 250px; a phone's card leaves less (DESIGN.md "Search input").
  const wide = useMediaQuery("(min-width: 480px)", true);
  return (
    <div className="mt-5">
      <label htmlFor={`${uid}-q`} className="t-label muted mb-1.5 block">
        Find a burger
      </label>
      <div className="relative max-w-xl">
        <Search className="muted pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2" strokeWidth={2} aria-hidden="true" />
        <input
          id={`${uid}-q`}
          type="search"
          data-ranker-search=""
          className="input input-search pr-12 pl-11 [&::-webkit-search-cancel-button]:hidden"
          placeholder={wide ? "Restaurant, burger or neighborhood" : "Restaurant or burger"}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
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
          <button type="button" className="icon-btn absolute top-1/2 right-1 size-9 -translate-y-1/2" aria-label="Clear search" onClick={() => setQuery("")}>
            <X strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {/* Always mounted, so screen readers hear the match count (the no-match sentence is visible below). */}
      <p className="t-ui-s muted mt-2" role="status">
        {!searching || snap.menus === "error" ? "" : snap.menus !== "ready" ? "Loading burgers…" : hits.length ? `Showing ${formatCount(Math.min(MAX_HITS, hits.length))} of ${pluralize(hits.length, "match", "matches")}` : ""}
      </p>
      {!searching ? null : snap.menus === "error" ? (
        <div className="mt-2">
          <p className="t-ui-m" role="alert">
            <Alert>Couldn&apos;t reach the counter. Check your connection and try again.</Alert>
          </p>
          <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => void rankerStore.loadMenus()}>
            Try again
          </button>
        </div>
      ) : snap.menus !== "ready" ? null : hits.length ? (
        <ul className="ranker-hits mt-1" aria-label="Matches">
          {hits.slice(0, MAX_HITS).map((b) => {
            const at = snap.draft.indexOf(b.key);
            const off = at >= 0 || full || held;
            return (
              <li key={b.key} className="ranker-hit">
                <div className="min-w-0">
                  <p className="font-semibold break-anywhere">{b.name}</p>
                  <p className="t-ui-s muted break-anywhere">{`${b.burger} · ${b.where}`}</p>
                </div>
                <PriceChip price={b.price} median={median} delta={false} />
                <button
                  type="button"
                  className={`btn btn-sm ${at >= 0 ? "btn-ghost" : "btn-secondary"} ranker-add`}
                  aria-disabled={off || undefined}
                  aria-label={at >= 0 ? `${b.label}: number ${at + 1} on your list` : full ? `${b.label}: your list is full` : `Add ${b.label} to your list`}
                  onClick={() => !off && onAdd(b)}
                >
                  {at >= 0 ? (
                    `#${at + 1} on your list`
                  ) : full ? (
                    "List full"
                  ) : (
                    <>
                      <Plus strokeWidth={2} aria-hidden="true" />
                      Add
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="t-ui-m muted mt-1 ph-mask">No burgers match &ldquo;{query.trim()}&rdquo;. Nothing in the net; try another name.</p>
      )}
    </div>
  );
}
