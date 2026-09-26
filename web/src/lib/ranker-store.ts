// The home ranker's state (DESIGN.md "The ranker hero"): the burgers to pick from, this browser's saved
// list, the list being built or edited, and what is on its way to the backend. A plain external store for
// useSyncExternalStore: no React in here, so the tests drive it with a fake backend and fake storage.
//
// It lives for the page's JavaScript lifetime, so a visitor who leaves the home page and comes back (a
// client-side navigation) finds the list as they left it. An unsaved list is also kept in sessionStorage
// (a reload keeps it), and localStorage remembers that this browser has a saved list (the <head> script
// reads it: the card shows a skeleton, not an empty list, until the saved one loads). Every storage access
// is wrapped: it can be missing or throw.
import { isMenuKey, MENU_LIST_PATH, parseMenuList } from "./menu-list";
import {
  addItem,
  classifyRankerError,
  listProblem,
  MAX_ITEMS,
  moveItem,
  moveItemTo,
  rankerBurgers,
  removeItem,
  sameList,
  type RankerBurger,
  type RankerErrorKind,
  type SavedRanking,
  type SaveReply,
} from "./ranker";
import { deleteRanking, getMyRanking, saveRanking } from "./ranker-api";
import { RANKER_SAVED_KEY } from "./theme-script";
import { getVoterId, readVoterId } from "./voter";

/** sessionStorage: the list being built, until it is saved. */
export const RANKER_DRAFT_KEY = "bi-ranker-draft";

export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void };

export type MenusStatus = "idle" | "loading" | "ready" | "error";
/** This browser's saved list: none to load (no voter id yet), loading, known (maybe none), or failed. */
export type MineStatus = "none" | "loading" | "ready" | "error";
/** Building or editing a list, or looking at the saved one. */
export type RankerView = "edit" | "saved";
export type RankerFailure = { action: "save" | "delete"; kind: RankerErrorKind };

export type RankerSnapshot = {
  /** The store has read storage and started loading (false in the prerendered page, until the ranker mounts). */
  started: boolean;
  menus: MenusStatus;
  /** Every priced burger by menu key (empty until the list loads). */
  burgers: ReadonlyMap<string, RankerBurger>;
  mine: MineStatus;
  /** The saved list (null: none, or deleted). */
  saved: SavedRanking | null;
  view: RankerView;
  /** The list on the card, best first: the saved one, or the one being built. */
  draft: readonly string[];
  /** The draft differs from the saved list (with none saved: it has a burger). */
  dirty: boolean;
  busy: "saving" | "deleting" | null;
  failure: RankerFailure | null;
  /** The last thing that went through: shown until the next change. */
  notice: "saved" | "deleted" | null;
  /** "Delete my list" asked to be sure. */
  confirmDelete: boolean;
};

export type RankerApi = {
  save(voter: string, items: readonly string[]): Promise<SaveReply>;
  get(voter: string): Promise<SavedRanking | null>;
  del(voter: string): Promise<boolean>;
};

export type RankerDeps = {
  /** Fetches /data/menus.json (unchecked). */
  loadMenus(): Promise<unknown>;
  api: RankerApi;
  /** This browser's voter id: read (never made), and get (made on first save). */
  voter: { read(): string | null; get(): string };
  /** localStorage and sessionStorage, or null (each call may throw; the store wraps them). */
  local(): KeyValueStorage | null;
  session(): KeyValueStorage | null;
};

export type SaveResult = { ok: true; edited: boolean; length: number } | { ok: false };

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
  /** Edit the saved list. */
  edit(): void;
  /** Drop the changes and show the saved list again. */
  cancel(): void;
  /** Save the draft (a list saved from here counts again after it was replaced). */
  save(): Promise<SaveResult>;
  askDelete(): void;
  keepList(): void;
  /** Withdraw the saved list; resolves to how many burgers it had (null when it failed). */
  deleteList(): Promise<number | null>;
};

const EMPTY: ReadonlyMap<string, RankerBurger> = new Map();

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

  let started = false;
  let menus: MenusStatus = "idle";
  let burgers: ReadonlyMap<string, RankerBurger> = EMPTY;
  let menusLoading: Promise<void> | null = null;
  let mine: MineStatus = "none";
  let mineLoading: Promise<void> | null = null;
  let saved: SavedRanking | null = null;
  let view: RankerView = "edit";
  let draft: string[] = [];
  /** A draft restored from this session, waiting for the saved list to decide the view. */
  let restored: string[] | null = null;
  let busy: RankerSnapshot["busy"] = null;
  let failure: RankerFailure | null = null;
  let notice: RankerSnapshot["notice"] = null;
  let confirmDelete = false;

  const isDirty = () => (saved ? !sameList(draft, saved.items) : draft.length > 0);
  const snapshotOf = (): RankerSnapshot => ({ started, menus, burgers, mine, saved, view, draft, dirty: isDirty(), busy, failure, notice, confirmDelete });
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

  /** A change to the list: back to editing, the last outcome cleared. */
  function change(next: string[]) {
    if (busy || sameList(next, draft)) return;
    draft = next;
    view = "edit";
    notice = null;
    failure = null;
    confirmDelete = false;
    persistDraft();
    emit();
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
          if (!busy) {
            // An unsaved list from this session stays on the card (being edited); otherwise the saved one shows.
            const keep = restored && !(saved && sameList(restored, saved.items)) ? restored : null;
            draft = keep ? [...keep] : saved ? [...saved.items] : draft;
            view = saved && !keep ? "saved" : "edit";
          }
          restored = null;
          persistFlag();
          persistDraft();
          emit();
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

    edit() {
      if (!saved || busy) return;
      view = "edit";
      notice = null;
      confirmDelete = false;
      emit();
    },

    cancel() {
      if (!saved || busy) return;
      draft = [...saved.items];
      view = "saved";
      failure = null;
      notice = null;
      persistDraft();
      emit();
    },

    async save() {
      if (busy) return { ok: false };
      const known = (k: string) => menus !== "ready" || burgers.has(k);
      if (listProblem(draft, known)) return { ok: false };
      // The saved list again changes nothing; a replaced one is sent again so that it counts again.
      if (saved && saved.status === "active" && !isDirty()) return { ok: false };
      const items = [...draft];
      const edited = saved !== null;
      busy = "saving";
      failure = null;
      notice = null;
      confirmDelete = false;
      emit();
      try {
        const reply = await deps.api.save(deps.voter.get(), items);
        saved = { items, status: reply.status, savedOn: reply.savedOn, countsFrom: reply.countsFrom, inBoard: false };
        busy = null;
        view = "saved";
        notice = "saved";
        if (mine !== "loading") mine = "ready";
        persistFlag();
        persistDraft();
        emit();
        return { ok: true, edited, length: items.length };
      } catch (err) {
        busy = null;
        failure = { action: "save", kind: classifyRankerError(err) };
        emit();
        return { ok: false };
      }
    },

    askDelete() {
      if (!saved || busy) return;
      confirmDelete = true;
      failure = null;
      emit();
    },

    keepList() {
      if (!confirmDelete) return;
      confirmDelete = false;
      emit();
    },

    async deleteList() {
      if (busy || !saved) return null;
      const voter = deps.voter.read();
      const length = saved.items.length;
      busy = "deleting";
      failure = null;
      emit();
      try {
        if (voter) await deps.api.del(voter);
        saved = null;
        draft = [];
        busy = null;
        view = "edit";
        notice = "deleted";
        confirmDelete = false;
        persistFlag();
        persistDraft();
        emit();
        return length;
      } catch (err) {
        busy = null;
        failure = { action: "delete", kind: classifyRankerError(err) };
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
  api: { save: saveRanking, get: getMyRanking, del: deleteRanking },
  voter: { read: () => readVoterId(), get: () => getVoterId() },
  local: () => browserStorage("localStorage"),
  session: () => browserStorage("sessionStorage"),
});
