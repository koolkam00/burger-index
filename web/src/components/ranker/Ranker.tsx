"use client";

import { ArrowDown, ArrowRight, ArrowUp, Check, GripVertical, Plus, Search, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useMediaQuery } from "@/components/charts/hooks";
import { RopeLadder } from "@/components/icons/nautical";
import { PriceChip } from "@/components/ui";
import { fromPath, track } from "@/lib/analytics";
import { formatCount, pluralize } from "@/lib/format";
import { revealAnnouncement, revealView, showsReveal, yourList, type RevealBoard } from "@/lib/peoples-top-reveal";
import {
  addParam,
  autosaveLine,
  dragIndex,
  dragTop,
  linkAddText,
  MAX_HITS,
  MAX_ITEMS,
  MIN_ITEMS,
  MINE_FAILED_COPY,
  moveItemTo,
  nyToday,
  RANKER_ERROR_COPY,
  savedStatusText,
  saveFailureText,
  searchBurgers,
  TOP_N,
  withoutAddParam,
  type RankerBurger,
} from "@/lib/ranker";
import { rankerStore, type RankerSnapshot } from "@/lib/ranker-store";
import { PEOPLES_TOP_NAME, PEOPLES_TOP_PATH, RANKER_ADD_PARAM, RANKER_ANCHOR, RANKER_FOCUS_EVENT, RANKER_TITLE_ID } from "@/lib/site";
import { RANKER_ENABLED } from "@/lib/supabase-config";
import { PeoplesTopReveal, RevealHint } from "./PeoplesTopReveal";
import { ShareList } from "./ShareList";

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
/** A row's burger as the live region says it: like its row, "This burger" while the burgers haven't loaded. */
const spokenName = (snap: RankerSnapshot, key: string) => {
  const b = snap.burgers.get(key);
  return b ? b.label : snap.menus === "ready" ? "A burger no longer listed" : "This burger";
};

/**
 * The burger ranker, the home page's first screen (DESIGN.md "The ranker hero"; user decisions 2026-09-25/26):
 * search the priced burgers (a chain once), add 3 to 25 in order, move them up and down (or drag them), remove them;
 * the list saves itself about 2 seconds after each change once it holds 3 (autosave, user request 2026-09-27: no Save
 * button). Come back to find it on the card, editable in place, or delete it. One list per browser (and per
 * connection: the backend keeps the latest). The People's Top 10 is made from all the lists once a day.
 *
 * The prerendered page holds the empty list and the search box (no burgers: they come from /data/menus.json,
 * fetched when the ranker mounts). A browser with a saved list sees a skeleton instead (a <head> flag,
 * html.ranker-saved) until it loads. The Supabase client loads when the ranker first needs it: the saved list
 * of a returning browser, else the first save. The status line under the list says what the autosave is doing; the
 * live region says each change, the first save of the page view, a failure and a delete, and nothing more. Without the Supabase settings the card says lists open soon.
 *
 * Once the list on the card (being built, or saved) holds 3 burgers, the People's Top 10 shows beside it (below it
 * on a phone): `board` is the daily board's seats (user decision 2026-09-26, "Once 3 are added"); the other picks'
 * standings come with the burgers in /data/menus.json.
 *
 * A saved list can be shared (user decision 2026-09-27, "Share your top 10"): an image of its top 10, drawn in the browser,
 * and `shareUrl`, the link to this ranker (no list data).
 *
 * A restaurant page's "Add to your top 10" arrives as /?add=<menu key>#rank (user decision 2026-09-26): the key is read
 * once on mount and dropped from the address, and the store adds it when the burgers and the saved list are known (then
 * it saves itself like any add); the card says what happened (added, already there, list full) and the live region too.
 */
export function Ranker({ median, board, shareUrl }: { median: number | null; board: RevealBoard; shareUrl: string }) {
  const snap = useRanker();
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const [announce, setAnnounce] = useState("");
  // Once per page view (this mount): the reveal's first showing is tracked, and its first showing after a change
  // the visitor made is announced; the first change is ranking_started and the first save ranking_saved (announced).
  const revealTracked = useRef(false);
  const revealAnnounced = useRef(false);
  const startTracked = useRef(false);
  const failureSaid = useRef("");
  // The next save that goes through is said too: after a failed save was said (so its recovery is heard), or "Count it again".
  const sayNextSave = useRef(false);
  // Bumped to re-render after an awaited step, so its focus move runs (the store's own update came before it).
  const [, setFocusTick] = useState(0);
  const focusAfter = (target: FocusTarget) => {
    pendingFocus.current = target;
    setFocusTick((n) => n + 1);
  };
  const say = (text: string) => setAnnounce((prev) => (prev === text ? `${text} ` : text));
  /** The first change of this page view is ranking_started (`edited`: the list was saved before). */
  const starting = (edited: boolean) => {
    if (startTracked.current) return;
    startTracked.current = true;
    track("ranking_started", { edited });
  };

  // What a link's add did: said once in the live region (the card shows the same words), and an added burger is tracked
  // like one added from the search (surface "restaurant_page"). Once per outcome, not per mount: the store remembers that
  // it was said (claimLinkAdd), so coming back to home (the ranker mounts again) shows the note without saying or tracking
  // it again. Listens to the store (subscribed before the add below starts), and checks once on mount for an outcome
  // that settled while no ranker was listening.
  useEffect(() => {
    if (!RANKER_ENABLED) return;
    const sayLinkAdd = () => {
      const s = rankerStore.getSnapshot();
      const r = s.linkAdd;
      if (!r || !rankerStore.claimLinkAdd(r)) return;
      let text = linkAddText(r, nameOf(s.burgers.get(r.key)));
      if (r.kind === "added") {
        if (!startTracked.current) {
          startTracked.current = true;
          track("ranking_started", { edited: s.saved !== null });
        }
        track("ranking_item_added", { menu_key: r.key, position: r.position, surface: "restaurant_page" });
        if (!revealAnnounced.current && !showsReveal(r.position - 1) && showsReveal(r.position)) {
          revealAnnounced.current = true;
          text += ` ${revealAnnouncement(board)}`;
        }
      }
      setAnnounce((prev) => (prev === text ? `${text} ` : text));
    };
    sayLinkAdd();
    return rankerStore.subscribe(sayLinkAdd);
  }, [board]);

  useEffect(() => {
    if (!RANKER_ENABLED) return;
    rankerStore.start();
    // "Add to your top 10" from a restaurant page: read ?add= once, then drop it, so a reload doesn't repeat it.
    const { pathname, search, hash } = window.location;
    if (!new URLSearchParams(search).has(RANKER_ADD_PARAM)) return;
    window.history.replaceState(null, "", `${pathname}${withoutAddParam(search)}${hash}`);
    const key = addParam(search);
    if (key) rankerStore.addFromLink(key);
  }, []);

  // Autosave, in the live region (sparingly: the status line shows every save): the first save that goes through in this
  // page view is tracked (ranking_saved) and said ("Saved. It counts from Sep 28, 2026."); a failed save is said once,
  // not again for each retry of the same failure, and the save that recovers from it is said too. The store hands each
  // save out once (takeSave): one that landed while no ranker was mounted (the visitor followed a link within the pause)
  // is tracked by the next mount, without being said. Listens to the store.
  useEffect(() => {
    if (!RANKER_ENABLED) return;
    let tracked = false;
    const onStore = (mounting: boolean) => {
      const s = rankerStore.getSnapshot();
      const f = s.failure?.action === "save" ? saveFailureText(s.failure, s.saved !== null) : "";
      if (f !== failureSaid.current) {
        failureSaid.current = f;
        if (f) {
          sayNextSave.current = true;
          setAnnounce((prev) => (prev === f ? `${f} ` : f));
        }
      }
      const done = rankerStore.takeSave();
      if (!done || !s.saved) return;
      const first = !tracked;
      if (first) {
        tracked = true;
        track("ranking_saved", { length: done.length, edited: done.edited });
      }
      if (mounting || !(first || sayNextSave.current)) return;
      sayNextSave.current = false;
      const text = s.saved.status === "active" ? savedStatusText(s.saved, nyToday()) : `List saved. ${savedStatusText(s.saved, nyToday())}`;
      setAnnounce((prev) => (prev === text ? `${text} ` : text));
    };
    onStore(true);
    return rankerStore.subscribe(() => onStore(false));
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

  // The list on the card, and whether the People's Top 10 shows beside it.
  const onCard = snap.draft;
  const listed = RANKER_ENABLED && snap.started && (snap.mine === "none" || snap.mine === "ready");
  const revealing = listed && showsReveal(onCard.length);
  useEffect(() => {
    if (!revealing || revealTracked.current) return;
    revealTracked.current = true;
    track("peoples_top_revealed", { surface: "ranker", list_length: onCard.length });
  }, [revealing, onCard.length]);

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

  /** The reveal's one announcement, when a change brings the list from under 3 burgers to 3 or more. */
  const revealNote = (from: number, to: number) => {
    if (revealAnnounced.current || showsReveal(from) || !showsReveal(to)) return "";
    revealAnnounced.current = true;
    return ` ${revealAnnouncement(board)}`;
  };
  const held = snap.busy !== null;

  const add = (b: RankerBurger) => {
    if (held || snap.draft.includes(b.key) || snap.draft.length >= MAX_ITEMS) return;
    starting(snap.saved !== null);
    rankerStore.add(b.key);
    const position = snap.draft.length + 1;
    track("ranking_item_added", { menu_key: b.key, position, surface: "search" });
    say(`${b.label} added at #${position}. ${pluralize(position, "burger")} on your list.${revealNote(snap.draft.length, position)}`);
  };
  const move = (key: string, delta: number) => {
    const from = snap.draft.indexOf(key);
    const to = from + delta;
    if (held || from < 0 || to < 0 || to >= snap.draft.length) return;
    starting(snap.saved !== null);
    rankerStore.move(key, delta);
    const control = delta < 0 ? (to === 0 ? "down" : "up") : to === snap.draft.length - 1 ? "up" : "down";
    pendingFocus.current = { kind: "row", key, control };
    say(`${spokenName(snap, key)} moved to #${to + 1}.`);
  };
  /** A row dropped at a new place (drag to reorder, with a mouse): announced like a move with the arrows. */
  const moveTo = (key: string, to: number) => {
    const from = snap.draft.indexOf(key);
    if (held || from < 0 || to === from || to < 0 || to >= snap.draft.length) return;
    starting(snap.saved !== null);
    rankerStore.moveTo(key, to);
    say(`${spokenName(snap, key)} moved to #${to + 1}.`);
  };
  const remove = (key: string) => {
    if (held) return;
    const i = snap.draft.indexOf(key);
    starting(snap.saved !== null);
    rankerStore.remove(key);
    const rest = snap.draft.filter((k) => k !== key);
    const next = rest[i] ?? rest[i - 1];
    pendingFocus.current = next ? { kind: "row", key: next, control: "remove" } : { kind: "search" };
    // Going under 3 with a saved list: the saved list stays as it was (said once, as the list drops under 3).
    const under = snap.saved && rest.length < MIN_ITEMS && snap.draft.length >= MIN_ITEMS ? ` Add ${MIN_ITEMS - rest.length} more to save your changes.` : "";
    say(`${spokenName(snap, key)} removed. ${pluralize(rest.length, "burger")} on your list.${under}`);
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
    if (length === null) {
      // Not deleted: the status line says why, and so does the live region (the status line isn't one).
      const failure = rankerStore.getSnapshot().failure;
      if (failure?.action === "delete") say(RANKER_ERROR_COPY[failure.kind]);
      // Nothing was withdrawn (a void list): the confirmation is gone, so focus goes to the heading.
      if (failure?.kind === "not_deleted") focusAfter({ kind: "heading" });
      return;
    }
    track("ranking_deleted", { length });
    say("Your list was deleted.");
    focusAfter({ kind: "heading" });
  };
  /** "Count it again": a list a newer one from this connection replaced, saved again as it is. */
  const countAgain = () => {
    if (held) return;
    starting(true);
    sayNextSave.current = true;
    // the button goes away while it saves: focus the heading rather than drop to the page
    pendingFocus.current = { kind: "heading" };
    rankerStore.countAgain();
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
  } else {
    body = (
      <ListCard
        snap={snap}
        median={median}
        shareUrl={shareUrl}
        onAdd={add}
        onMove={move}
        onMoveTo={moveTo}
        onRemove={remove}
        onAskDelete={askDelete}
        onCountAgain={countAgain}
        onKeep={keep}
        onDelete={confirmDelete}
        onRetryMenus={() => {
          pendingFocus.current = { kind: "search" };
          void rankerStore.loadMenus();
        }}
      />
    );
  }

  // Beside the list (below it on a phone): the People's Top 10 at 3+ burgers; before that, at lg only, what shows it
  // (also in the prerendered card, which holds the empty list).
  let side: ReactNode = null;
  if (revealing) {
    const pick = snap.menus === "ready" ? (key: string) => snap.burgers.get(key) : null;
    side = <PeoplesTopReveal view={revealView(board, onCard, pick, yourList(snap.saved?.status, snap.dirty))} />;
  } else if (!snap.started || listed) {
    side = <RevealHint />;
  }

  return (
    <div ref={rootRef} className="ranker panel" tabIndex={-1} data-boot={snap.started ? undefined : ""}>
      <RankerBar />
      <div className="ranker-body">
        <div className="ranker-main">{body}</div>
        {side ? <div className={`ranker-side${revealing ? "" : " is-hint"}`}>{side}</div> : null}
      </div>
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

/** The burgers (/data/menus.json) didn't load: said at once, in the saved list and while building one, with "Try again". */
function MenusFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-3">
      <p className="t-ui-m" role="alert">
        <Alert>{RANKER_ERROR_COPY.network}</Alert>
      </p>
      <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** The burgers are on their way (a row shows a skeleton); after a failure a row says so instead. */
const menusPending = (snap: RankerSnapshot) => snap.menus === "idle" || snap.menus === "loading";

/**
 * What a restaurant page's "Add to your top 10" did, on the card until the list next changes: a check for added or
 * already there, the warning icon when it couldn't be added. Not a live region: the ranker's own says it once.
 */
function LinkAddNote({ snap }: { snap: RankerSnapshot }) {
  const r = snap.linkAdd;
  if (!r) return null;
  const text = linkAddText(r, nameOf(snap.burgers.get(r.key)));
  const ok = r.kind === "added" || r.kind === "already";
  return (
    <p className="t-ui-m ranker-link-note mt-3">
      {ok ? <Check className="ranker-link-icon" strokeWidth={2} aria-hidden="true" /> : <TriangleAlert className="status-icon" strokeWidth={2} aria-hidden="true" />}
      <span>{text}</span>
    </p>
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

/** A row being dragged: which one, where it began and where it would land now. */
type DragState = { key: string; from: number; to: number };
/** How far (px) the pointer moves from where it pressed the grip before the press is a drag. */
const DRAG_START = 5;

/**
 * Drag to reorder, with a mouse (DESIGN.md "The ranker hero": a grip at the row's start where the pointer is fine and
 * hovers, from 480px; the arrows stay for keyboard and touch). Pointer events on the grip, captured while it is held.
 * While a row is dragged the rows are shown in the order they would have after the drop (CSS `order`, so the DOM, its
 * keys and the captured grip stay put), numbered that way, with the "Beyond your top 10" rule at the #10/#11 boundary;
 * the dragged row sits in its landing place, nudged to follow the pointer inside the list (`dragTop`). Where it lands
 * comes from the pointer and the rows' midpoints when the drag began (`dragIndex`). A press is a drag only once the pointer
 * has moved `DRAG_START` px: a click on the grip, or a press let go where it began, moves nothing. The page scrolls while
 * the pointer is near the window's bottom edge or just under the sticky header; Escape or a cancelled pointer puts it
 * back; the drop moves it (`onDrop`, announced like an arrow move). Nothing animates.
 */
function useDragToReorder(onDrop: (key: string, to: number) => void, disabled: boolean) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const info = useRef<{
    key: string;
    from: number;
    /** The rows' midpoints, page coordinates, when the drag began. */
    mids: number[];
    size: number;
    /** From the pointer to the dragged row's top. */
    grab: number;
    /** The list's first row top and last row bottom, page coordinates. */
    top: number;
    bottom: number;
    clientY: number;
    /** Where the press began (viewport), and whether the pointer has since moved far enough to make it a drag. */
    startY: number;
    moving: boolean;
    /** The sticky header's bottom (viewport) when the drag started: the band that scrolls the page up starts there. */
    topEdge: number;
    raf: number;
    /** The dragged row's translateY now. */
    shift: number;
  } | null>(null);

  const place = (): DragState | null => {
    const d = info.current;
    if (!d) return null;
    // Where it lands follows the pointer itself (past the list's end it is the last place), not the row as drawn,
    // which stops at the list's edges.
    return { key: d.key, from: d.from, to: dragIndex(d.mids, d.from, d.clientY + window.scrollY - d.grab + d.size / 2) };
  };
  const update = () => {
    const next = place();
    setDrag((prev) => (prev && next && prev.to === next.to ? prev : next));
    follow();
  };
  /** Nudge the dragged row from its landing place to where the pointer holds it (no re-render). */
  const follow = () => {
    const d = info.current;
    const row = d && listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(d.key)}"]`);
    if (!d || !row) return;
    const laidOut = row.getBoundingClientRect().top + window.scrollY - d.shift;
    d.shift = dragTop(d.clientY + window.scrollY, d.grab, d.top, d.bottom, d.size) - laidOut;
    row.style.transform = `translateY(${d.shift}px)`;
  };
  const scrollNearEdge = () => {
    const d = info.current;
    if (!d) return;
    const edge = 64;
    const top = d.topEdge + edge;
    const step = d.clientY < top ? -Math.ceil((top - d.clientY) / 4) : d.clientY > window.innerHeight - edge ? Math.ceil((d.clientY - window.innerHeight + edge) / 4) : 0;
    if (step) {
      window.scrollBy(0, step);
      update();
    }
    d.raf = requestAnimationFrame(scrollNearEdge);
  };
  const end = (drop: boolean) => {
    const d = info.current;
    if (!d) return;
    // A press that never moved far enough was not a drag: nothing lands.
    const now = d.moving ? place() : null;
    cancelAnimationFrame(d.raf);
    listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(d.key)}"]`)?.style.removeProperty("transform");
    info.current = null;
    setDrag(null);
    if (drop && now && now.to !== now.from) onDrop(now.key, now.to);
  };

  // After each render of a drag (the rows in their landing order), put the dragged row back under the pointer.
  useLayoutEffect(() => {
    if (drag) follow();
  });
  // Escape puts the row back; leaving the builder mid-drag stops the page scrolling.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => () => cancelAnimationFrame(info.current?.raf ?? 0), []);

  /** The grip's pointer handlers for the row at `index`. */
  const grip = (key: string, index: number) => ({
    onPointerDown(e: ReactPointerEvent<HTMLSpanElement>) {
      const list = listRef.current;
      if (disabled || info.current || !list || e.pointerType === "touch" || e.button !== 0) return;
      const rects = [...list.children].map((row) => row.getBoundingClientRect());
      if (!rects[index]) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // the pointer is already gone: the drag still ends on its pointerup or pointercancel
      }
      const y = window.scrollY;
      info.current = {
        key,
        from: index,
        mids: rects.map((r) => r.top + y + r.height / 2),
        size: rects[index].height,
        grab: e.clientY - rects[index].top,
        top: rects[0].top + y,
        bottom: rects[rects.length - 1].bottom + y,
        clientY: e.clientY,
        startY: e.clientY,
        moving: false,
        topEdge: 0,
        raf: 0,
        shift: 0,
      };
    },
    onPointerMove(e: ReactPointerEvent<HTMLSpanElement>) {
      const d = info.current;
      if (!d) return;
      d.clientY = e.clientY;
      if (!d.moving) {
        // Not a drag until the pointer has moved: only then does the row lift and the page scroll near an edge.
        if (Math.abs(e.clientY - d.startY) < DRAG_START) return;
        d.moving = true;
        d.topEdge = Math.max(0, document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0);
        d.raf = requestAnimationFrame(scrollNearEdge);
      }
      update();
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
    onLostPointerCapture: () => end(false),
  });

  return { listRef, drag, grip };
}

/**
 * The list on the card (one view, user request 2026-09-27: it saves itself): the search, the list with its controls, the
 * status line (what the autosave is doing, or what the saved list counts for), then, once a list is saved, "Share your
 * top 10" and "Delete my list".
 */
function ListCard({
  snap,
  median,
  shareUrl,
  onAdd,
  onMove,
  onMoveTo,
  onRemove,
  onAskDelete,
  onCountAgain,
  onKeep,
  onDelete,
  onRetryMenus,
}: {
  snap: RankerSnapshot;
  median: number | null;
  shareUrl: string;
  onAdd: (b: RankerBurger) => void;
  onMove: (key: string, delta: number) => void;
  onMoveTo: (key: string, to: number) => void;
  onRemove: (key: string) => void;
  onAskDelete: () => void;
  onCountAgain: () => void;
  onKeep: () => void;
  onDelete: () => void;
  onRetryMenus: () => void;
}) {
  const uid = useId();
  const draft = snap.draft;
  const ready = snap.menus === "ready";
  const pending = menusPending(snap);
  const held = snap.busy !== null;
  const saved = snap.saved;
  const { listRef, drag, grip } = useDragToReorder(onMoveTo, held);
  // While a row is dragged, the rows show (and are numbered) in the order they would have after the drop.
  const order = drag ? moveItemTo(draft, drag.key, drag.to) : draft;
  // The status line: a delete on its way or refused, else what the autosave is doing (lib/ranker autosaveLine).
  const line =
    snap.busy === "deleting"
      ? { text: "Deleting your list…", alert: false }
      : snap.failure?.action === "delete"
        ? { text: RANKER_ERROR_COPY[snap.failure.kind], alert: true }
        : autosaveLine(
            {
              length: draft.length,
              saved,
              dirty: snap.dirty,
              saving: snap.saving,
              failure: snap.failure?.action === "save" ? snap.failure : null,
              problem: snap.problem,
              deleted: snap.notice === "deleted",
              menusFailed: snap.menus === "error",
            },
            nyToday(),
          );
  // A voided list stays void and can't be withdrawn (the backend keeps it): no "Delete my list" for it.
  const canDelete = saved !== null && saved.status !== "void";
  const asking = snap.confirmDelete && canDelete;
  // A list a newer one from this connection replaced, as it is: it counts again only when saved again, which the visitor asks
  // for (again after a refusal, which isn't tried again by itself: the status line says when it can count).
  const refused = snap.failure?.action === "save" && !snap.failure.retrying;
  const replacedAsIs = saved?.status === "replaced" && !snap.dirty && !snap.saving && !snap.problem && (!snap.failure || refused) && !held;

  return (
    <>
      <h3 tabIndex={-1} data-ranker-heading="" className="t-display-m ranker-title">
        Your top 10.
      </h3>
      <p className="t-ui-m muted mt-1">Pick the burgers you like best, your favorite first: at least 3, up to 25. Your list saves as you go.</p>
      <LinkAddNote snap={snap} />

      <BurgerSearch snap={snap} median={median} onAdd={onAdd} onRetryMenus={onRetryMenus} />

      <p id={`${uid}-list`} className="t-label muted mt-6">
        Your list
      </p>
      {draft.length ? (
        <ol ref={listRef} className={`ranker-list can-drag mt-2${drag ? " is-dragging" : ""}`} aria-labelledby={`${uid}-list`}>
          {draft.map((key, i) => {
            const b = snap.burgers.get(key);
            const name = b ? b.label : ready ? "A burger no longer on the Burger Index" : "this burger";
            const at = order.indexOf(key);
            return (
              <li
                key={key}
                data-row={key}
                className={`ranker-row${at === 0 ? " is-top" : ""}${at === TOP_N ? " is-first-extra" : ""}${drag?.key === key ? " is-dragged" : ""}`}
                style={drag ? { order: at } : undefined}
              >
                {at === TOP_N ? <ExtraRule /> : null}
                {/* Pointer only (keyboard and touch use the arrows), so hidden from assistive technology. */}
                <span className="ranker-grip" aria-hidden="true" {...grip(key, i)}>
                  <GripVertical strokeWidth={2} />
                </span>
                <span className="ranker-rank">
                  <span className="sr-only">Number </span>
                  {at + 1}
                </span>
                <div className="ranker-what">
                  {b ? (
                    <>
                      <Link href={`/restaurants/${b.id}`} className="ui-link break-anywhere font-semibold">
                        {b.name}
                      </Link>
                      <p className="t-ui-s muted break-anywhere">{`${b.burger} · ${b.where}`}</p>
                    </>
                  ) : ready ? (
                    <p className="t-ui-m muted">No longer on the Burger Index</p>
                  ) : pending ? (
                    <span className="skel block h-5 w-40 max-w-full" aria-hidden="true" />
                  ) : (
                    <p className="t-ui-m muted">Couldn&apos;t load this burger</p>
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
      {/* Not a live region: the ranker's own says each change, the first save and a failure, so a save never chatters.
          Its id describes the held "Share your top 10" and "Count it again" (why it waits, what it counts for). */}
      <p id={`${uid}-status`} className="t-ui-s ranker-status mt-2" data-ranker-status="">
        {line.alert ? <Alert>{line.text}</Alert> : line.text}
      </p>
      {replacedAsIs && !asking ? (
        <button type="button" className="btn btn-secondary btn-sm mt-3" data-ranker-button="count" aria-describedby={`${uid}-status`} onClick={onCountAgain}>
          Count it again
        </button>
      ) : null}

      {/* "Share your top 10" (user decision 2026-09-27): the saved list's image and a link to rank your own, once the burgers
          are known; held while the list on the card differs from the saved list (a change waiting, on its way, refused, or
          one that can't be saved yet), so the image is never of a list the card no longer shows. Not keyed on the list: a
          save must not remount the button (focus would drop to the page); ShareList starts afresh on a new list itself. */}
      {saved && ready && !asking ? (
        <ShareList items={saved.items} burgers={snap.burgers} url={shareUrl} held={snap.dirty || snap.saving} describedBy={`${uid}-status`} />
      ) : null}
      {asking ? (
        <div className="ranker-confirm mt-5" role="group" aria-labelledby="ranker-confirm-q">
          <p id="ranker-confirm-q" className="t-ui-m font-semibold">
            {saved.status === "active" ? "Delete your list? It stops counting at the next update." : "Delete your list?"}
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
      ) : canDelete ? (
        <div className="ranker-actions mt-4">
          <button type="button" className="btn btn-ghost" data-ranker-button="delete" aria-disabled={held || undefined} onClick={() => !held && onAskDelete()}>
            Delete my list
          </button>
        </div>
      ) : null}
    </>
  );
}

/** "Find a burger": the priced burgers whose restaurant, burger or neighborhood match, each with "Add". */
function BurgerSearch({ snap, median, onAdd, onRetryMenus }: { snap: RankerSnapshot; median: number | null; onAdd: (b: RankerBurger) => void; onRetryMenus: () => void }) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
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
          ref={inputRef}
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
          <button
            type="button"
            className="icon-btn ranker-clear absolute top-1/2 right-1 size-9 -translate-y-1/2"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              // the button goes away with the query: keep focus in the search box, not on the page
              inputRef.current?.focus();
            }}
          >
            <X strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {/* Always mounted, so screen readers hear the match count, or that nothing matched (without the query: the
          visible no-match sentence below is masked in replays). */}
      <p className="t-ui-s muted mt-2" role="status">
        {!searching || snap.menus === "error" ? (
          ""
        ) : snap.menus !== "ready" ? (
          "Loading burgers…"
        ) : hits.length ? (
          `Showing ${formatCount(Math.min(MAX_HITS, hits.length))} of ${pluralize(hits.length, "match", "matches")}`
        ) : (
          <span className="sr-only">No burgers match. Try another name.</span>
        )}
      </p>
      {snap.menus === "error" ? (
        <MenusFailed onRetry={onRetryMenus} />
      ) : !searching || snap.menus !== "ready" ? null : hits.length ? (
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
                  className={`btn btn-sm ${at >= 0 ? "btn-ghost ranker-added" : "btn-secondary"} ranker-add`}
                  aria-disabled={off || undefined}
                  aria-label={at >= 0 ? `${b.label}: number ${at + 1} on your list` : full ? `${b.label}: your list is full` : `Add ${b.label} to your list`}
                  onClick={() => !off && onAdd(b)}
                >
                  {at >= 0 ? (
                    <>
                      <Check strokeWidth={2} aria-hidden="true" />
                      {`#${at + 1} on your list`}
                    </>
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
