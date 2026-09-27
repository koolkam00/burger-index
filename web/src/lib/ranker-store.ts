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
// still waiting when the page is hidden goes at once; when the page closes, whatever is still waiting or on its way
// goes again as a keepalive request (the normal one may not outlive the page). A page restored from the back-forward
// cache, or another tab deleting the list, checks the saved list again before anything more is saved.
//
// It lives for the page's JavaScript lifetime, so a visitor who leaves the home page and comes back (a client-side
// navigation) finds the list as they left it. A list not yet saved is also kept in sessionStorage (a reload keeps it,
// and saves it), and localStorage remembers that this browser has a saved list (the <head> script reads it: the card
// shows a skeleton, not an empty list, until the saved one loads). Every storage access is wrapped: it can be missing
// or throw.
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
  busy: "deleting" | null;
  failure: RankerFailure | null;
  /** The list was just deleted: shown until the next change. */
  notice: "deleted" | null;
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
   * back-forward cache, or when another tab deleted the list (its saved-list flag went away).
   */
  watchPage?(on: PageEvents): void;
};

export type PageEvents = { hidden(): void; unload(): void; online(): void; restored(): void; deletedElsewhere(): void };

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

/** A stored draft, checked: distinct menu keys, at most MAX_ITEMS. */
export function parseDraft(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { items?: unknown };
    const items = Array.isArray(v.items) ? v.items : null;
    if (!items || !items.length || items.length > MAX_ITEMS || !items.every(isMenuKey) || new Set(items).size !== items.length) return null;
    return items as string[];
  } catch {
    return null;
  }
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
  /** A draft restored from this session, waiting for the saved list to decide what the card shows. */
  let restored: string[] | null = null;
  let busy: RankerSnapshot["busy"] = null;
  let failure: RankerFailure | null = null;
  let notice: RankerSnapshot["notice"] = null;
  let confirmDelete = false;
  /** A burger a link asked to add, waiting for the burgers and the saved list. */
  let pendingAdd: string | null = null;
  let linkAdd: LinkAdd | null = null;
  /** The ranker has said (and tracked) `linkAdd`. Kept here, not in the component, so a remount doesn't say it again. */
  let linkAddSaid = false;

  // Autosave: the waiting timer (the pause after a change, or a retry), the save on its way, and a flush asked for
  // while it was.
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let again = false;
  let attempt = 0;
  let saveSeq = 0;
  let lastSave: SaveEvent | null = null;
  /** The last save handed out by takeSave. */
  let takenSeq = 0;
  /** The visitor changed the list in this page's life (a replaced list as it is is sent again only then). */
  let touched = false;
  /** The saved list is being checked again (back-forward cache, another tab's delete): nothing saves meanwhile. */
  let checking = false;
  let syncSeq = 0;
  /** Bumped when another tab deletes the list: a save sent before then no longer describes this card, its reply is ignored. */
  let epoch = 0;

  const isDirty = () => (saved ? !sameList(draft, saved.items) : draft.length > 0);
  const known = (k: string) => menus !== "ready" || burgers.has(k);
  const problemNow = () => listProblem(draft, known);
  /** The draft should go to the backend: it can be saved, and it isn't what the backend already holds as it is. */
  const needsSave = () => {
    if (!started || busy || checking || menus !== "ready" || (mine !== "none" && mine !== "ready")) return false;
    if (listProblem(draft, known)) return false;
    if (!saved || !sameList(draft, saved.items)) return true;
    // The saved list as it is goes again only when a newer list from this connection replaced it and the visitor has
    // touched it here: saving it makes it count again (the latest save from a connection wins), so it is never taken back
    // from the connection's other browser just by opening the page.
    return saved.status === "replaced" && touched;
  };
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
    busy,
    failure,
    notice,
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

  /** Keep an unsaved list for this session (and forget it once it matches the saved one). */
  function persistDraft() {
    write(storage(deps.session), RANKER_DRAFT_KEY, isDirty() ? JSON.stringify({ items: draft }) : null);
  }
  /** Tell the next page load whether this browser has a saved list. */
  function persistFlag() {
    write(storage(deps.local), RANKER_SAVED_KEY, saved ? "1" : null);
  }

  function stopTimer() {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }
  /** The waiting timer ran out: save now. */
  function fireTimer() {
    timer = null;
    void flush();
  }
  /** Save the draft `ms` from now (the pause after a change), unless there is nothing to save. */
  function schedule(ms: number) {
    stopTimer();
    if (needsSave()) timer = timers.set(fireTimer, ms);
  }

  /** Send the draft now (or, while a save is on its way, right after it). */
  function flush(): Promise<void> {
    stopTimer();
    if (inFlight) {
      again = true;
      return inFlight;
    }
    if (!needsSave()) {
      emit();
      return Promise.resolve();
    }
    const items = [...draft];
    const edited = saved !== null;
    const at = epoch;
    inFlight = (async () => {
      try {
        const reply = await deps.api.save(deps.voter.get(), items);
        if (at === epoch) {
          // The reply is about `items`: the draft may have moved on since, and is left alone.
          saved = { items, status: reply.status, savedOn: reply.savedOn, countsFrom: reply.countsFrom, inBoard: false };
          if (mine !== "loading") mine = "ready";
          attempt = 0;
          if (failure?.action === "save") failure = null;
          lastSave = { seq: ++saveSeq, length: items.length, edited };
          persistFlag();
          persistDraft();
        }
      } catch (err) {
        if (at === epoch) {
          const kind = classifyRankerError(err);
          attempt += 1;
          failure = { action: "save", kind, retrying: retriesSave(kind, attempt) };
        }
      }
      inFlight = null;
      if (at !== epoch) {
        // Another tab deleted the list meanwhile: this card was reset, and nothing follows this save.
        emit();
        return;
      }
      if (again) {
        // A flush came while it was on its way (the pause after a later change ended): the newest list goes now.
        again = false;
        void flush();
        return;
      }
      if (timer === null) {
        if (failure?.action === "save" && failure.retrying) {
          if (needsSave()) timer = timers.set(fireTimer, saveRetryDelay(failure.kind, attempt, now()));
          else failure = null;
        } else if (!failure && needsSave()) {
          // A change made while it was on its way that needed no pause of its own (it went back to the list saved before).
          timer = timers.set(fireTimer, AUTOSAVE_DELAY);
        }
      }
      emit();
    })();
    emit();
    return inFlight;
  }

  /** A change to the list: the last outcome cleared, and the list saves itself after the pause. */
  function change(next: string[]) {
    if (busy || sameList(next, draft)) return;
    draft = next;
    touched = true;
    notice = null;
    if (failure) {
      failure = null;
      attempt = 0;
    }
    confirmDelete = false;
    linkAdd = null;
    persistDraft();
    // After the pause; if a save is still on its way then, right after it.
    schedule(AUTOSAVE_DELAY);
    emit();
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

  /** Once the burgers and the saved list are known: a list restored from this session saves itself. */
  function settle() {
    settleLinkAdd();
    if (timer === null && !inFlight && !failure && needsSave()) {
      schedule(AUTOSAVE_DELAY);
      emit();
    }
  }

  /** The card starts empty again: the saved list was deleted (here or in another tab). */
  function showDeleted() {
    stopTimer();
    again = false;
    attempt = 0;
    saved = null;
    draft = [];
    notice = "deleted";
    confirmDelete = false;
    linkAdd = null;
    if (failure?.action === "save") failure = null;
  }

  /**
   * Check the saved list again, keeping the list on the card: after a return from the back-forward cache (a keepalive save
   * may or may not have landed) or when another tab deleted it (`deletedElsewhere`: the flag it keeps in localStorage
   * went away). Nothing saves until the backend has answered; a list deleted there empties the card ("Your list was
   * deleted."), so a save still waiting here never brings it back.
   */
  function resync(deletedElsewhere: boolean) {
    if (!started) return;
    if (deletedElsewhere) {
      epoch += 1; // a save on its way was sent before the delete: its reply no longer describes this card
      stopTimer();
      again = false;
      attempt = 0;
      if (failure?.action === "save") failure = null;
    }
    const voter = deps.voter.read();
    if (!voter || mine !== "ready" || busy) {
      if (deletedElsewhere && (saved || draft.length)) {
        showDeleted();
        persistDraft();
      }
      emit();
      return;
    }
    const mySync = ++syncSeq;
    checking = true;
    stopTimer();
    emit();
    const had = saved !== null;
    deps.api
      .get(voter)
      .then(
        (reply) => {
          if (mySync !== syncSeq) return;
          if (reply && reply.status !== "deleted") saved = reply;
          else if (had || deletedElsewhere) showDeleted();
          else saved = null;
        },
        () => {
          // Couldn't ask: another tab's delete is taken at its word; otherwise nothing changes.
          if (mySync === syncSeq && deletedElsewhere) showDeleted();
        },
      )
      .finally(() => {
        if (mySync !== syncSeq) return;
        checking = false;
        persistFlag();
        persistDraft();
        emit();
        settle();
      });
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
      restored = parseDraft(read(storage(deps.session), RANKER_DRAFT_KEY));
      if (restored) draft = [...restored];
      deps.watchPage?.({
        hidden: () => void (timer !== null ? flush() : undefined),
        unload: () => store.flushOnUnload(),
        online: () => void (timer !== null && failure?.action === "save" && failure.kind === "network" ? flush() : undefined),
        restored: () => resync(false),
        deletedElsewhere: () => resync(true),
      });
      emit();
      void store.loadMenus();
      if (deps.voter.read()) void store.loadMine();
      else {
        restored = null;
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
          emit();
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
      mineLoading = deps.api.get(voter).then(
        (reply) => {
          mineLoading = null;
          mine = "ready";
          saved = reply && reply.status !== "deleted" ? reply : null;
          if (!busy && !inFlight && timer === null) {
            // A list from this session not yet saved stays on the card (and saves itself); otherwise the saved one shows.
            const keep = restored && !(saved && sameList(restored, saved.items)) ? restored : null;
            draft = keep ? [...keep] : saved ? [...saved.items] : draft;
          }
          restored = null;
          persistFlag();
          persistDraft();
          emit();
          settle();
        },
        () => {
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
      // Waiting (the pause, a retry, a flush queued behind a save) or on its way: a save sent normally may not outlive the
      // page (the Supabase client may still be loading, and its request isn't keepalive), so the newest list goes again as
      // a keepalive request. A list identical to one on its way is harmless: the backend keeps the same list as it is.
      if ((timer === null && !again && !inFlight) || !deps.api.saveOnUnload || !needsSave()) return;
      stopTimer();
      again = false;
      // Its reply is never read: the draft stays in sessionStorage, so a reload shows (and if need be saves) it, and a
      // return from the back-forward cache checks the saved list again (resync).
      try {
        deps.api.saveOnUnload(deps.voter.get(), [...draft]);
      } catch {
        // nothing more can be done while the page closes
      }
      emit();
    },

    countAgain() {
      if (!saved || saved.status !== "replaced" || busy) return;
      touched = true;
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
      if (failure?.action === "delete") failure = null;
      emit();
    },

    keepList() {
      if (!confirmDelete) return;
      confirmDelete = false;
      if (failure?.action === "delete") failure = null;
      // A change left waiting by a delete that failed saves itself again.
      if (timer === null && !inFlight && !failure) schedule(AUTOSAVE_DELAY);
      emit();
    },

    async deleteList() {
      if (busy || !saved) return null;
      busy = "deleting";
      stopTimer();
      linkAdd = null;
      emit();
      // A save on its way lands first, so the delete withdraws the newest list (and nothing saves after it).
      if (inFlight) await inFlight.catch(() => undefined);
      stopTimer();
      again = false;
      if (failure?.action === "save" || failure?.action === "delete") failure = null;
      const voter = deps.voter.read();
      const length = saved ? saved.items.length : draft.length;
      try {
        const withdrawn = voter ? await deps.api.del(voter) : true;
        if (!withdrawn && voter) {
          // Nothing was withdrawn: a voided list can't be (it stays void and never counted), or the list changed
          // elsewhere. Show what the backend holds now instead of saying it was deleted.
          const now = await deps.api.get(voter);
          if (now && now.status !== "deleted") {
            saved = now;
            draft = [...now.items];
            busy = null;
            confirmDelete = false;
            failure = { action: "delete", kind: "not_deleted" };
            persistFlag();
            persistDraft();
            emit();
            return null;
          }
        }
        saved = null;
        draft = [];
        busy = null;
        notice = "deleted";
        confirmDelete = false;
        persistFlag();
        persistDraft();
        emit();
        return length;
      } catch (err) {
        busy = null;
        failure = { action: "delete", kind: classifyRankerError(err) };
        // The list wasn't deleted: a change the delete held back still saves itself.
        if (timer === null && !inFlight) schedule(AUTOSAVE_DELAY);
        emit();
        return null;
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
    // Another tab deleted the list (its flag went away): a save waiting here must not bring it back.
    window.addEventListener("storage", (e) => {
      if (e.key === RANKER_SAVED_KEY && e.newValue === null && e.oldValue !== null) on.deletedElsewhere();
    });
  },
});
