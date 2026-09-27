// The home ranker's state (DESIGN.md "The ranker hero"): the burgers to pick from, this browser's saved
// list, the list on the card, and its autosave. A plain external store for useSyncExternalStore: no React in
// here, so the tests drive it with a fake backend, fake timers and fake storage.
//
// Autosave (user request 2026-09-27, "can it just autosave without them having to hit save?"): once the list on the
// card holds 3 burgers it saves itself AUTOSAVE_DELAY after the last change. One save is on its way at a time; a change
// made meanwhile is saved right after it (the latest list always wins, and a reply only ever records the list it
// saved). A list identical to the saved one is never sent, and a list a newer one from this connection replaced is
// sent again only after the visitor changes it (or asks, "Count it again"). A save that couldn't reach the backend is
// tried again (5 s, 15 s, then every minute), an odd reply up to three times, the connection's hourly budget after the
// hour; any other refusal (a daily limit, a list the backend won't take) is not, until the list changes again. A save
// still waiting when the page is hidden goes at once (the pause, or a network retry: a refusal's or an odd reply's retry
// keeps its time); when the page closes, whatever is still waiting that way or on its way goes again as a keepalive
// request (the normal one may not outlive the page), and the flag's new stamp tells the other tabs.
//
// One rule decides what the card shows whenever the backend is asked about the saved list (`reconcile`): at page load
// (with what the session kept: the list, the saved list it changed, the lists sent) and at every check, which comes after
// a return from the back-forward cache, another tab's save or delete (the flag in localStorage), a list sent whose landing
// wasn't seen (a lost reply, a keepalive request), or a delete that failed. A check holds every save until the backend has
// answered (it is asked again until it does), after the saved list's load and a save on its way have landed: a list there
// the card knew or sent keeps the card; another tab's newer list shows ("Showing the list saved in another tab.") unless
// the card has a change of its own still to go; a list gone that the card knew empties it ("Your list was deleted."), so
// nothing brings it back without a new change.
//
// It lives for the page's JavaScript lifetime, so a visitor who leaves the home page and comes back (a client-side
// navigation) finds the list as they left it. A list not yet saved is also kept in sessionStorage (a reload keeps it,
// and saves it), and localStorage remembers that this browser has a saved list, as a stamp each save changes (the <head>
// script reads it: the card shows a skeleton, not an empty list, until the saved one loads; the other tabs hear the
// change). Every storage access is wrapped: it can be missing or throw.
import { isMenuKey, MENU_LIST_PATH, parseMenuList } from "./menu-list";
import {
  addItem,
  AUTOSAVE_DELAY,
  classifyRankerError,
  linkAddOutcome,
  listProblem,
  MAX_ITEMS,
  moveItem,
  moveItemTo,
  rankerBurgers,
  removeItem,
  retriesSave,
  retryDelay,
  sameList,
  saveRetryDelay,
  type LinkAdd,
  type ListProblem,
  type RankerBurger,
  type RankerErrorKind,
  type SavedRanking,
  type SaveReply,
} from "./ranker";
import { deleteRanking, getMyRanking, saveRanking, saveRankingOnUnload } from "./ranker-api";
import { RANKER_SAVED_KEY } from "./theme-script";
import { getVoterId, readVoterId } from "./voter";

/** sessionStorage: the list on the card, until it is saved. */
export const RANKER_DRAFT_KEY = "bi-ranker-draft";

export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void };

export type MenusStatus = "idle" | "loading" | "ready" | "error";
/** This browser's saved list: none to load (no voter id yet), loading, known (maybe none), or failed. */
export type MineStatus = "none" | "loading" | "ready" | "error";
/** A save that failed (and whether it will be tried again by itself), or a delete that did. */
export type RankerFailure = { action: "save"; kind: RankerErrorKind; retrying: boolean } | { action: "delete"; kind: RankerErrorKind };
/** A save that went through: the n-th of this store's life, the list's length, and whether a saved list was changed. */
export type SaveEvent = { seq: number; length: number; edited: boolean };

export type RankerNotice = "deleted" | "deleted_elsewhere" | "updated_elsewhere";

export type RankerSnapshot = {
  /** The store has read storage and started loading (false in the prerendered page, until the ranker mounts). */
  started: boolean;
  menus: MenusStatus;
  /** Every priced burger by menu key (empty until the list loads). */
  burgers: ReadonlyMap<string, RankerBurger>;
  mine: MineStatus;
  /** The saved list (null: none, or deleted). */
  saved: SavedRanking | null;
  /** The list on the card, best first. */
  draft: readonly string[];
  /** The draft differs from the saved list (with none saved: it has a burger). */
  dirty: boolean;
  /** Why the draft can't be saved as it is, or null (a gone burger is known only once the burgers load). */
  problem: ListProblem | null;
  /** A save is waiting (the pause after a change, or a retry) or on its way. */
  saving: boolean;
  /** A list other than the saved one is on its way (the saved list is about to change). */
  sendingChange: boolean;
  busy: "deleting" | null;
  failure: RankerFailure | null;
  /**
   * Shown until the next change: the list was just deleted here ("deleted") or in another tab ("deleted_elsewhere"), or
   * the card now shows a newer list another tab saved ("updated_elsewhere").
   */
  notice: RankerNotice | null;
  /** Bumped each time another tab's change reaches the card (each is said, even with the same notice still up). */
  noticeSeq: number;
  /** "Delete my list" asked to be sure. */
  confirmDelete: boolean;
  /**
   * What a restaurant page's "Add to your top 10" (/?add=<key>) did, once the burgers and this browser's saved list
   * were known: shown and announced until the list next changes (null: none).
   */
  linkAdd: LinkAdd | null;
  /** The last save that went through (null: none yet in this store's life). */
  lastSave: SaveEvent | null;
};

export type RankerApi = {
  save(voter: string, items: readonly string[]): Promise<SaveReply>;
  get(voter: string): Promise<SavedRanking | null>;
  del(voter: string): Promise<boolean>;
  /** Send a save that must outlive the page (a keepalive request; its reply is never read). */
  saveOnUnload?(voter: string, items: readonly string[]): void;
};

export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

export type RankerDeps = {
  /** Fetches /data/menus.json (unchecked). */
  loadMenus(): Promise<unknown>;
  api: RankerApi;
  /** This browser's voter id: read (never made), and get (made on first save). */
  voter: { read(): string | null; get(): string };
  /** localStorage and sessionStorage, or null (each call may throw; the store wraps them). */
  local(): KeyValueStorage | null;
  session(): KeyValueStorage | null;
  /** setTimeout / clearTimeout (tests pass fake ones). */
  timers?: Timers;
  /** The time, epoch ms (Date.now; tests pass their clock's). */
  now?(): number;
  /**
   * Called once, on start: tell the store when the page is hidden, closed, back online, shown again from the
   * back-forward cache, or when another tab deleted the list (its saved-list flag went away) or saved one (the flag's
   * stamp changed).
   */
  watchPage?(on: PageEvents): void;
};

export type PageEvents = { hidden(): void; unload(): void; online(): void; restored(): void; deletedElsewhere(): void; savedElsewhere(): void };

export type RankerStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): RankerSnapshot;
  /** What every prerendered page starts from: an empty list, nothing loaded. */
  getServerSnapshot(): RankerSnapshot;
  /** Once, on mount: restore an unsaved list, then load the burgers and (with a voter id) the saved list. */
  start(): void;
  /** Fetch the burgers (once; again after a failure). */
  loadMenus(): Promise<void>;
  /** Fetch the saved list (again after a failure). */
  loadMine(): Promise<void>;
  add(key: string): void;
  remove(key: string): void;
  move(key: string, delta: number): void;
  moveTo(key: string, index: number): void;
  /**
   * Add a burger from a link (a restaurant page's "Add to your top 10"): it waits until the burgers and this browser's
   * saved list have loaded, then goes at the end of the list on the card if it isn't there and there's room (and the
   * list saves itself). `linkAdd` says what happened.
   */
  addFromLink(key: string): void;
  /**
   * The ranker says and tracks a link's add once: true the first time it asks about the current `linkAdd`, false after
   * (the ranker mounted again on a return to home, or its effect ran twice) and for an outcome no longer current.
   */
  claimLinkAdd(outcome: LinkAdd): boolean;
  /** Save now whatever is waiting (the page is being hidden, or the connection came back); resolves when it is done. */
  flush(): Promise<void>;
  /** The page is closing: send whatever is waiting or on its way as a keepalive request. */
  flushOnUnload(): void;
  /** "Count it again": save a list a newer one from this connection replaced, as it is. */
  countAgain(): void;
  /**
   * The saves not yet handed out: the latest one that went through since the last call, or null. The ranker tracks the
   * first it takes in a page view (ranking_saved), so a save that lands while no ranker is mounted is still tracked once,
   * by the next ranker, and a save is never tracked twice.
   */
  takeSave(): SaveEvent | null;
  askDelete(): void;
  keepList(): void;
  /** Withdraw the saved list; resolves to how many burgers it had (null when it failed, or nothing was withdrawn: a void list). */
  deleteList(): Promise<number | null>;
};

const EMPTY: ReadonlyMap<string, RankerBurger> = new Map();

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A list of menu keys, checked: distinct, 1 to MAX_ITEMS of them (or null). */
function parseList(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > MAX_ITEMS || !v.every(isMenuKey) || new Set(v).size !== v.length) return null;
  return v as string[];
}

/**
 * What this session kept of the card: the list on it, the saved list it was a change of (`base`: null when none was
 * saved; undefined in a draft stored before the base was kept) and the lists this tab sent whose landing it never saw.
 */
export type StoredDraft = { items: string[]; base: string[] | null | undefined; sent: string[][] };

/** A stored draft, checked (null: none, or not one this store wrote). */
export function parseStoredDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { items?: unknown; base?: unknown; sent?: unknown };
    const items = parseList(v.items);
    if (!items) return null;
    const base = v.base === null ? null : v.base === undefined ? undefined : (parseList(v.base) ?? undefined);
    const sent = Array.isArray(v.sent) ? v.sent.map(parseList).filter((l): l is string[] => l !== null) : [];
    return { items, base, sent };
  } catch {
    return null;
  }
}

/** A stored draft's list, checked: distinct menu keys, at most MAX_ITEMS. */
export function parseDraft(raw: string | null): string[] | null {
  return parseStoredDraft(raw)?.items ?? null;
}

export function createRankerStore(deps: RankerDeps): RankerStore {
  const listeners = new Set<() => void>();
  const timers = deps.timers ?? realTimers;
  const now = deps.now ?? (() => Date.now());

  let started = false;
  let menus: MenusStatus = "idle";
  let burgers: ReadonlyMap<string, RankerBurger> = EMPTY;
  let menusLoading: Promise<void> | null = null;
  let mine: MineStatus = "none";
  let mineLoading: Promise<void> | null = null;
  let saved: SavedRanking | null = null;
  let draft: string[] = [];
  /** The draft this session kept, until the saved list's load decides what the card shows. */
  let boot: StoredDraft | null = null;
  let busy: RankerSnapshot["busy"] = null;
  let failure: RankerFailure | null = null;
  let notice: RankerSnapshot["notice"] = null;
  let noticeSeq = 0;
  let confirmDelete = false;
  /** A burger a link asked to add, waiting for the burgers and the saved list. */
  let pendingAdd: string | null = null;
  let linkAdd: LinkAdd | null = null;
  /** The ranker has said (and tracked) `linkAdd`. Kept here, not in the component, so a remount doesn't say it again. */
  let linkAddSaid = false;
  /** A save failure set aside while a failed delete is shown: it comes back when that goes ("Keep it", "Delete my list"). */
  let parked: RankerFailure | null = null;

  // Autosave: the waiting timer (the pause after a change, or a retry), the save on its way, and a flush asked for while
  // it was.
  let timer: unknown = null;
  /** The waiting timer is a retry of a failed save (not the pause after a change). */
  let timerRetry = false;
  /**
   * When the failed save is due to be tried again (epoch ms), fixed when it failed: a retry the page dropped (a return from
   * the back-forward cache, a delete, a check) comes back at that time, not a whole wait later.
   */
  let retryAt = 0;
  let inFlight: Promise<void> | null = null;
  /** The list the save on its way sends (null: none on its way). */
  let sending: string[] | null = null;
  let again = false;
  let attempt = 0;
  /** Numbers each list sent, so a save that goes through forgets only the unsure lists sent before it. */
  let sendSeq = 0;
  /**
   * Lists this tab sent whose landing it never saw: a keepalive request as the page closed, a save whose reply was lost or
   * odd (it may have been saved), one that landed after another tab's delete was heard. A check of the saved list settles
   * them: a list there that is one of them is this tab's own, not another tab's.
   */
  let unsure: { items: string[]; seq: number }[] = [];
  let saveSeq = 0;
  let lastSave: SaveEvent | null = null;
  /** The last save handed out by takeSave. */
  let takenSeq = 0;
  /** The visitor changed the list since the saved list was last checked (a replaced list as it is goes again only then). */
  let touched = false;
  /** "Count it again" asked, and not yet done: the replaced list as it is goes again, whatever a check says meanwhile. */
  let recount = false;
  /** Changes made in this page's life. */
  let changeSeq = 0;

  // The check of the saved list (after a return from the back-forward cache, another tab's save or delete, an unsure save,
  // a failed delete): nothing saves until the backend has answered, and one that can't be asked is asked again.
  let checking = false;
  let syncSeq = 0;
  /** `changeSeq` when the running check started (a change made since is the visitor's newest). */
  let checkChangesAt = 0;
  /** Another tab deleted the list (its flag went away): the check's answer decides whether it is gone here too. */
  let heardDelete = false;
  /** The running check follows this tab's own delete that failed (it may have gone through). */
  let checkAfterDelete = false;
  let checkTimer: unknown = null;
  let checkTries = 0;

  const isDirty = () => (saved ? !sameList(draft, saved.items) : draft.length > 0);
  const known = (k: string) => menus !== "ready" || burgers.has(k);
  const problemNow = () => listProblem(draft, known);
  /** Saves wait (a check running aside): the page isn't started, a delete is running, or the burgers or the saved list aren't in. */
  const heldButCheck = () => !started || busy !== null || menus !== "ready" || (mine !== "none" && mine !== "ready");
  /** Saves wait: as above, or the saved list is being checked. */
  const held = () => checking || heldButCheck();
  /** The draft can be sent (`evenChecking`: but for a check running) and has no problem. */
  const canSave = (evenChecking = false) => !(evenChecking ? heldButCheck() : held()) && !problemNow();
  /** The draft should go to the backend: it can be saved, and it isn't what the backend already holds as it is. */
  const needsSave = (evenChecking = false) => {
    if (!canSave(evenChecking)) return false;
    if (!saved || !sameList(draft, saved.items)) return true;
    // The saved list as it is goes again only when a newer list from this connection replaced it and the visitor changed it
    // here, or asked ("Count it again"): saving it makes it count again (the latest save from a connection wins), so it is
    // never taken back from the connection's other browser just by opening the page.
    return saved.status === "replaced" && (touched || recount);
  };
  const isUnsure = (l: readonly string[]) => unsure.some((u) => sameList(u.items, l));
  /** The card has a change of its own still to go by itself (not a refused one, not one it already sent). */
  const pendingChange = () => isDirty() && failure?.action !== "save" && !isUnsure(draft);

  const snapshotOf = (): RankerSnapshot => ({
    started,
    menus,
    burgers,
    mine,
    saved,
    draft,
    dirty: isDirty(),
    problem: started ? problemNow() : null,
    saving: timer !== null || inFlight !== null,
    sendingChange: sending !== null && (!saved || !sameList(sending, saved.items)),
    busy,
    failure,
    notice,
    noticeSeq,
    confirmDelete,
    linkAdd,
    lastSave,
  });
  const serverSnap = snapshotOf();
  let snap = serverSnap;

  function emit() {
    snap = snapshotOf();
    for (const l of [...listeners]) l();
  }

  const storage = (get: () => KeyValueStorage | null): KeyValueStorage | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  const read = (s: KeyValueStorage | null, key: string): string | null => {
    try {
      return s?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (s: KeyValueStorage | null, key: string, value: string | null) => {
    try {
      if (value === null) s?.removeItem?.(key);
      else s?.setItem(key, value);
    } catch {
      // storage full or blocked: it lasts for this page view only
    }
  };

  /**
   * Keep an unsaved list for this session, with the saved list it changes and the lists sent whose landing wasn't seen (a
   * reload decides with them, as a check does); forget it once the card matches the saved list and nothing else is on its
   * way. While the saved list loads (or failed to) the session keeps what the page started from.
   */
  function persistDraft() {
    if (mine === "loading" || mine === "error") return;
    const sent = [...(sending ? [sending] : []), ...unsure.map((u) => u.items)];
    const keep = draft.length > 0 && (isDirty() || sent.some((l) => !sameList(l, draft)));
    write(storage(deps.session), RANKER_DRAFT_KEY, keep ? JSON.stringify({ items: draft, base: saved ? saved.items : null, sent }) : null);
  }
  const stamp = () => write(storage(deps.local), RANKER_SAVED_KEY, `${now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`);
  /**
   * Tell the next page load whether this browser has a saved list, and the other tabs when it changes: the flag holds a
   * stamp, new with each list saved here (`fresh`), so another tab's storage event says "saved elsewhere" (a write of the
   * same value fires none). Otherwise a flag already there is left as it is (a new stamp for every check would bounce
   * between tabs). Written only from what the backend said.
   */
  function persistFlag(fresh = false) {
    if (!saved) write(storage(deps.local), RANKER_SAVED_KEY, null);
    else if (fresh || !read(storage(deps.local), RANKER_SAVED_KEY)) stamp();
  }

  function stopTimer() {
    if (timer !== null) timers.clear(timer);
    timer = null;
    timerRetry = false;
  }
  function stopCheckTimer() {
    if (checkTimer !== null) timers.clear(checkTimer);
    checkTimer = null;
  }
  /** The waiting timer ran out: save now. */
  function fireTimer() {
    timer = null;
    timerRetry = false;
    void flush();
  }
  /** Try the failed save again at the time fixed when it failed (`retryAt`; at once if that has passed). */
  function armRetry() {
    stopTimer();
    timer = timers.set(fireTimer, Math.max(0, retryAt - now()));
    timerRetry = true;
  }
  function addUnsure(items: readonly string[], seq: number) {
    unsure = [...unsure.filter((u) => !sameList(u.items, items)), { items: [...items], seq }];
  }
  /**
   * The waiting save may go early (the page hidden or closing): the pause after a change, or a retry of a save that
   * couldn't reach the backend. Never a retry of a refusal (the hourly budget waits for the hour) or of an odd reply
   * (each try counts against the budgets): those wait for their own time.
   */
  const mayGoEarly = () => timer !== null && (!timerRetry || (failure?.action === "save" && failure.kind === "network"));

  /** Send the draft now (or, while a save is on its way, right after it). */
  function flush(): Promise<void> {
    stopTimer();
    if (inFlight) {
      again = true;
      return inFlight;
    }
    if (!needsSave()) {
      settle();
      return Promise.resolve();
    }
    const items = [...draft];
    const edited = saved !== null;
    const seq = ++sendSeq;
    sending = items;
    inFlight = (async () => {
      try {
        const reply = await deps.api.save(deps.voter.get(), items);
        if (heardDelete) {
          // Another tab deleted the list while it was on its way: whether it came back is the check's to say.
          addUnsure(items, seq);
        } else {
          // The reply is about `items`: the draft may have moved on since, and is left alone.
          saved = { items, status: reply.status, savedOn: reply.savedOn, countsFrom: reply.countsFrom, inBoard: false };
          if (mine === "none") mine = "ready";
          attempt = 0;
          if (failure?.action === "save") failure = null;
          unsure = unsure.filter((u) => u.seq > seq);
          recount = false;
          lastSave = { seq: ++saveSeq, length: items.length, edited };
          persistFlag(true);
        }
      } catch (err) {
        const kind = classifyRankerError(err);
        // A lost or odd reply may hide a list the backend saved.
        if (kind === "network" || kind === "unknown") addUnsure(items, seq);
        if (!heardDelete) {
          attempt += 1;
          failure = { action: "save", kind, retrying: retriesSave(kind, attempt) };
          if (failure.retrying) retryAt = now() + saveRetryDelay(kind, attempt, now());
        }
      }
      sending = null;
      inFlight = null;
      persistDraft();
      settle();
    })();
    emit();
    return inFlight;
  }

  /**
   * What comes next, once nothing holds saves: a change still to save waits for its pause (or goes now, if a flush came
   * while a save was on its way), a failed save that is tried again by itself gets its timer back at its own time (a close,
   * a return from the back-forward cache or a check may have dropped it), a refusal waits for a change. With nothing to
   * send the failure goes, and a list sent whose landing wasn't seen is checked (the card may not be what the backend holds).
   */
  function settle() {
    settleLinkAdd();
    if (inFlight || held()) {
      emit();
      return;
    }
    if (needsSave()) {
      if (again) {
        again = false;
        void flush();
        return;
      }
      if (timer === null) {
        if (failure?.action === "save") {
          if (failure.retrying) armRetry();
        } else if (!(failure?.action === "delete" && parked)) {
          // (a failed delete keeps a save failure it set aside until it goes: "Keep it", or a change)
          timer = timers.set(fireTimer, AUTOSAVE_DELAY);
        }
      }
    } else {
      again = false;
      stopTimer();
      if (failure?.action === "save") {
        failure = null;
        attempt = 0;
      }
    }
    // A list sent whose landing wasn't seen, and nothing more will go by itself: the backend may hold it (the card, and the
    // other tabs, would not know), so it is asked.
    if (unsure.length && timer === null) void check();
    else emit();
  }

  /** A change to the list: the last outcome cleared, and the list saves itself after the pause. */
  function change(next: string[]) {
    if (busy || sameList(next, draft)) return;
    draft = next;
    touched = true;
    recount = false;
    changeSeq += 1;
    notice = null;
    parked = null;
    if (failure) {
      failure = null;
      attempt = 0;
    }
    confirmDelete = false;
    linkAdd = null;
    persistDraft();
    stopTimer();
    // After the pause (if a save is still on its way then, right after it).
    if (needsSave()) timer = timers.set(fireTimer, AUTOSAVE_DELAY);
    settle();
  }

  /**
   * A link's add, once it can be judged: the burgers are loaded (is it on the Burger Index?) and so is this browser's
   * saved list (which list it goes on). It goes through `change`, like an add from the search.
   */
  function settleLinkAdd() {
    if (pendingAdd === null || !started || busy || menus !== "ready" || (mine !== "none" && mine !== "ready")) return;
    const key = pendingAdd;
    pendingAdd = null;
    const outcome = linkAddOutcome(draft, key, (k) => burgers.has(k));
    if (outcome.kind === "added") change([...draft, key]);
    linkAdd = outcome;
    linkAddSaid = false;
    emit();
  }

  /** A failed delete's message goes: a save failure it set aside comes back. */
  function clearDeleteFailure() {
    if (failure?.action !== "delete") return;
    failure = parked;
    parked = null;
  }

  /** The card starts empty again: the saved list was deleted, here ("deleted") or in another tab. */
  function showDeleted(kind: "deleted" | "deleted_elsewhere") {
    stopTimer();
    again = false;
    attempt = 0;
    parked = null;
    saved = null;
    draft = [];
    boot = null;
    unsure = [];
    recount = false;
    touched = false;
    notice = kind;
    if (kind === "deleted_elsewhere") noticeSeq += 1;
    confirmDelete = false;
    linkAdd = null;
    failure = null;
  }

  /**
   * The backend's answer about the saved list, against what the card knew (`base`: the saved list the card was a change
   * of, null when none; undefined when unknown, taken as the list there) and the lists this tab sent whose landing it
   * never saw (`sent`). The same rule for a page load (with what the session kept) and every later check:
   * - a list there that is the base, one this tab sent, or the card's: the card stays (a change on it saves itself);
   * - another list there is one another tab saved since: it shows ("Showing the list saved in another tab."), unless the
   *   card has a change of its own still to go (made in this page's life, or kept by the session and never sent), which is
   *   newer and saves over it;
   * - no list there, when the card knew one (or another tab said it deleted it, or it is a deleted list this tab sent): it
   *   was deleted, and the card empties ("Your list was deleted."); a first list the backend never had stays and saves.
   * Returns whether the list there is one this tab sent that no other tab has heard of (the flag gets a new stamp).
   */
  function reconcile(reply: SavedRanking | null, k: { base: string[] | null | undefined; sent: string[][] }, changesAt: number): boolean {
    const live = reply && reply.status !== "deleted" ? reply : null;
    const wasSent = (l: readonly string[]) => k.sent.some((s) => sameList(s, l));
    const unchanged = changeSeq === changesAt;
    if (!live) {
      const gone = heardDelete || checkAfterDelete || k.base != null || (reply !== null && wasSent(reply.items));
      if (gone && (saved || draft.length || k.base)) showDeleted(checkAfterDelete ? "deleted" : "deleted_elsewhere");
      else saved = null;
      return false;
    }
    const base = k.base === undefined ? live.items : k.base;
    const theirs = !(base && sameList(live.items, base)) && !wasSent(live.items) && !sameList(live.items, draft);
    const mineToGo = !unchanged || (draft.length > 0 && !(base && sameList(draft, base)) && !wasSent(draft) && failure?.action !== "save");
    if (theirs && !mineToGo) {
      draft = [...live.items];
      notice = "updated_elsewhere";
      noticeSeq += 1;
      confirmDelete = false;
      linkAdd = null;
      recount = false;
      parked = null;
      if (failure?.action === "save") failure = null;
      attempt = 0;
    }
    saved = live;
    if (unchanged) touched = false;
    if (live.status !== "replaced") recount = false;
    return !theirs && wasSent(live.items) && !(base && sameList(live.items, base));
  }

  /**
   * Check the saved list again, keeping the card as it is meanwhile: after a return from the back-forward cache (a keepalive
   * save may or may not have landed), when another tab saved a list (the stamp it keeps in localStorage changed) or deleted
   * it (the flag went away), when a list this tab sent may have landed unseen, or after this tab's delete failed. The saved
   * list still loading and a save still on its way land first, so the answer describes them. Nothing saves until the
   * backend has answered, and a check that can't reach it is asked again (5 s, 15 s, then every minute, and at once when
   * the connection is back). Resolves after its first try.
   */
  function check(opts: { deleted?: boolean; afterDelete?: boolean } = {}): Promise<void> {
    if (!started) return Promise.resolve();
    const voter = deps.voter.read();
    if (!voter) return Promise.resolve();
    if (opts.deleted) heardDelete = true;
    if (busy || mine === "error") {
      // The delete decides; after a failed load, "Try again" loads the list (and hears of the delete).
      emit();
      return Promise.resolve();
    }
    const my = ++syncSeq;
    if (!checking) checkChangesAt = changeSeq;
    checking = true;
    if (opts.afterDelete) checkAfterDelete = true;
    stopCheckTimer();
    checkTries = 0;
    stopTimer();
    emit();
    return askBackend(my, voter);
  }

  async function askBackend(my: number, voter: string): Promise<void> {
    await (mineLoading ?? undefined);
    await inFlight?.catch(() => undefined);
    if (my !== syncSeq) return;
    if (mine === "error") {
      // The saved list couldn't load: "Try again" asks for it.
      checking = false;
      checkAfterDelete = false;
      emit();
      return;
    }
    let reply: SavedRanking | null;
    try {
      reply = await deps.api.get(voter);
    } catch {
      if (my !== syncSeq) return;
      checkTries += 1;
      checkTimer = timers.set(() => {
        checkTimer = null;
        void askBackend(my, voter);
      }, retryDelay(checkTries));
      emit();
      return;
    }
    if (my !== syncSeq) return;
    mine = "ready";
    const fresh = reconcile(reply, { base: saved ? saved.items : null, sent: unsure.map((u) => u.items) }, checkChangesAt);
    checking = false;
    checkAfterDelete = false;
    heardDelete = false;
    checkTries = 0;
    unsure = [];
    persistFlag(fresh);
    persistDraft();
    settle();
  }

  const store: RankerStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snap,
    getServerSnapshot: () => serverSnap,

    start() {
      if (started) return;
      started = true;
      boot = parseStoredDraft(read(storage(deps.session), RANKER_DRAFT_KEY));
      if (boot) draft = [...boot.items];
      deps.watchPage?.({
        hidden: () => void (mayGoEarly() ? flush() : undefined),
        unload: () => store.flushOnUnload(),
        online: () => {
          if (checkTimer !== null) {
            stopCheckTimer();
            const voter = deps.voter.read();
            if (voter) void askBackend(syncSeq, voter);
          } else if (timer !== null && failure?.action === "save" && failure.kind === "network") void flush();
        },
        restored: () => void check(),
        deletedElsewhere: () => void check({ deleted: true }),
        savedElsewhere: () => void check(),
      });
      emit();
      void store.loadMenus();
      if (deps.voter.read()) void store.loadMine();
      else {
        boot = null;
        persistFlag(); // no voter id: no saved list to wait for next time either
      }
    },

    loadMenus() {
      if (menus === "ready") return Promise.resolve();
      if (menusLoading) return menusLoading;
      menus = "loading";
      emit();
      menusLoading = deps.loadMenus().then(
        (raw) => {
          burgers = rankerBurgers(parseMenuList(raw));
          menus = "ready";
          menusLoading = null;
          settle();
        },
        () => {
          menus = "error";
          menusLoading = null;
          emit();
        },
      );
      return menusLoading;
    },

    loadMine() {
      if (mineLoading) return mineLoading;
      const voter = deps.voter.read();
      if (!voter) {
        mine = "none";
        emit();
        return Promise.resolve();
      }
      mine = "loading";
      emit();
      const changesAt = changeSeq;
      mineLoading = deps.api.get(voter).then(
        (reply) => {
          mineLoading = null;
          mine = "ready";
          const kept = boot;
          boot = null;
          let fresh = false;
          if (kept) fresh = reconcile(reply, kept, changesAt);
          else {
            saved = reply && reply.status !== "deleted" ? reply : null;
            touched = false;
            draft = saved ? [...saved.items] : draft;
          }
          // A check waiting for this load asks again (it heard of something newer) and decides the flag.
          if (!checking) {
            heardDelete = false;
            persistFlag(fresh);
          }
          persistDraft();
          settle();
        },
        () => {
          // The session's draft stays: "Try again" decides with it (no change can come meanwhile: the card shows only the alert).
          mineLoading = null;
          mine = "error";
          emit();
        },
      );
      return mineLoading;
    },

    add: (key) => change(addItem(draft, key)),
    remove: (key) => change(removeItem(draft, key)),
    move: (key, delta) => change(moveItem(draft, key, delta)),
    moveTo: (key, index) => change(moveItemTo(draft, key, index)),

    addFromLink(key) {
      if (!isMenuKey(key)) return;
      pendingAdd = key;
      settleLinkAdd();
    },

    claimLinkAdd(outcome) {
      if (outcome !== linkAdd || linkAddSaid) return false;
      linkAddSaid = true;
      return true;
    },

    flush,

    flushOnUnload() {
      // Waiting (the pause, a network retry, a flush queued behind a save) or on its way: a save sent normally may not
      // outlive the page (the Supabase client may still be loading, and its request isn't keepalive), so the newest list
      // goes again as a keepalive request. A list identical to the one on its way is harmless (the backend keeps the same
      // list as it is; it counts once more against the budgets); a list different from it goes even when it is the list
      // saved before (a change back). While the saved list is being checked, a change of the card's own still to go goes
      // too. Never after another tab's delete was heard (it could bring the list back); a retry of a refusal or an odd
      // reply waits for its own time: nothing goes. The stamp tells the other tabs a list was saved.
      if (!deps.api.saveOnUnload || heardDelete || busy) return;
      const send = inFlight ? canSave(true) : needsSave(true) && (mayGoEarly() || (checking && pendingChange()));
      if (!send) return;
      stopTimer();
      again = false;
      const items = [...draft];
      try {
        deps.api.saveOnUnload(deps.voter.get(), items);
      } catch {
        // nothing more can be done while the page closes
      }
      // Its reply is never read: the draft stays in sessionStorage, so a reload decides with it, and a return from the
      // back-forward cache checks the saved list again.
      addUnsure(items, ++sendSeq);
      stamp();
      persistDraft();
      emit();
    },

    countAgain() {
      if (!saved || saved.status !== "replaced" || busy) return;
      // Kept until it is done: a check running now, or a return from the back-forward cache, doesn't forget it.
      recount = true;
      if (failure?.action === "save") {
        failure = null; // a refusal of the list as it is ("Count it again" tomorrow), asked again
        attempt = 0;
      }
      notice = null;
      void flush();
    },

    takeSave() {
      if (!lastSave || lastSave.seq <= takenSeq) return null;
      takenSeq = lastSave.seq;
      return lastSave;
    },

    askDelete() {
      if (!saved || busy) return;
      confirmDelete = true;
      clearDeleteFailure();
      emit();
    },

    keepList() {
      if (!confirmDelete) return;
      confirmDelete = false;
      clearDeleteFailure();
      // A change left waiting by a delete that failed saves itself again (a failed save's retry comes back; a refusal waits).
      settle();
    },

    async deleteList() {
      if (busy || !saved) return null;
      busy = "deleting";
      stopTimer();
      linkAdd = null;
      // A check still waiting for its answer is dropped: the delete decides what the card shows.
      syncSeq += 1;
      checking = false;
      checkAfterDelete = false;
      stopCheckTimer();
      emit();
      // A save on its way lands first, so the delete withdraws the newest list (and nothing saves after it).
      if (inFlight) await inFlight.catch(() => undefined);
      stopTimer();
      again = false;
      clearDeleteFailure();
      // A save failure (a refusal, or a retry) stays set aside until the delete goes through: a failed delete never
      // re-sends a refused list or hurries a retry.
      const saveFailure = failure?.action === "save" ? failure : null;
      failure = null;
      const voter = deps.voter.read();
      const length = saved ? saved.items.length : draft.length;
      try {
        const withdrawn = voter ? await deps.api.del(voter) : true;
        if (!withdrawn && voter) {
          // Nothing was withdrawn: a voided list can't be (it stays void and never counted), or the list changed
          // elsewhere. Show what the backend holds now instead of saying it was deleted.
          const there = await deps.api.get(voter);
          if (there && there.status !== "deleted") {
            saved = there;
            draft = [...there.items];
            busy = null;
            confirmDelete = false;
            failure = { action: "delete", kind: "not_deleted" };
            parked = null;
            attempt = 0;
            heardDelete = false;
            unsure = [];
            persistFlag();
            persistDraft();
            emit();
            settleLinkAdd();
            return null;
          }
        }
        busy = null;
        heardDelete = false;
        showDeleted("deleted");
        persistFlag();
        persistDraft();
        emit();
        // A link's add that came while the delete was on its way goes on the new, empty list.
        settleLinkAdd();
        return length;
      } catch (err) {
        busy = null;
        failure = { action: "delete", kind: classifyRankerError(err) };
        parked = saveFailure;
        // It may have gone through (a lost reply): nothing saves until the saved list is checked.
        await check({ afterDelete: true });
        if (!checking) settle();
        return !saved && notice === "deleted" ? length : null;
      }
    },
  };
  return store;
}

function browserStorage(which: "localStorage" | "sessionStorage"): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window[which] : null;
  } catch {
    return null;
  }
}

/** The page's ranker: the static burger list, the Supabase RPCs, the browser's voter id and storage. */
export const rankerStore: RankerStore = createRankerStore({
  loadMenus: () =>
    fetch(MENU_LIST_PATH).then((res) => {
      if (!res.ok) throw new Error(`menus: ${res.status}`);
      return res.json() as Promise<unknown>;
    }),
  api: { save: saveRanking, get: getMyRanking, del: deleteRanking, saveOnUnload: saveRankingOnUnload },
  voter: { read: () => readVoterId(), get: () => getVoterId() },
  local: () => browserStorage("localStorage"),
  session: () => browserStorage("sessionStorage"),
  watchPage(on) {
    if (typeof window === "undefined") return;
    // A save waiting when the tab is hidden goes now (the page may never come back); when it closes, as a keepalive request.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") on.hidden();
    });
    window.addEventListener("pagehide", () => on.unload());
    window.addEventListener("online", () => on.online());
    // Back from the back-forward cache: a keepalive save may or may not have landed.
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) on.restored();
    });
    // Another tab deleted the list (its flag went away): a save waiting here must not bring it back. Another tab saved one
    // (the flag's stamp changed): the card shows it unless it has a change of its own made since.
    window.addEventListener("storage", (e) => {
      if (e.key !== RANKER_SAVED_KEY || e.newValue === e.oldValue) return;
      if (e.newValue === null) on.deletedElsewhere();
      else on.savedElsewhere();
    });
  },
});
