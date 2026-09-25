// This browser's answers and the public histograms, shared by every worth component on a page
// (DESIGN.md "WorthPicker" and "The People's Price page"). A plain external store for
// useSyncExternalStore: no React in here, so the tests drive it with a fake API.
//
// Answers are optimistic: an answer shows at once (in the visitor's own "your answer" and in the
// menu's histogram) and is sent in the background. Sends for one menu are serialized (one request in
// flight, the latest answer queued behind it), so quick changes can't land out of order. A failed send
// falls back to the last saved answer and keeps the error.
//
// Histograms come from three places: a fetch (every menu the page knows, or one menu), realtime events
// and a fresh fetch of the menu right after the visitor's answer is saved. Each cell (menu, dollars)
// remembers its updated_at and when it arrived, so an older copy never replaces a newer one, and a
// deleted cell isn't brought back by a fetch that started before the delete arrived.
//
// While a menu's answer is on its way ("an episode": from the first answer until the menu's fresh
// fetch lands) its histogram is frozen and shown with the visitor's answer moved by hand: one fewer at
// the answer the frozen copy holds for them, one more at the new one. Realtime events and other fetches
// for that menu are held back meanwhile, then the fresh fetch replaces the frozen copy and the events
// that arrived after it was sent are replayed on top. So the visitor's own answer is never counted
// twice, and nothing another visitor did in the meantime is lost.
import { castWorth, fetchHist, fetchMyWorth, type CastReply } from "./worth-api";
import { WORTH_ENABLED } from "./worth-config";
import { getVoterId, readVoterId } from "./worth-voter";
import { classifyWorthError, isMenuKey, isValidAnswer, type Hist, type HistRow, type WorthErrorKind } from "./worth";

export type WorthApi = {
  castWorth(menuKey: string, voter: string, dollars: number): Promise<CastReply | null>;
  fetchMyWorth(voter: string): Promise<Map<string, number>>;
  fetchHist(keys?: readonly string[]): Promise<HistRow[]>;
};

export type VoterIds = {
  /** This browser's voter id, or null before its first answer (never creates one). */
  read(): string | null;
  /** This browser's voter id, made on first use. */
  get(): string;
};

export type LoadStatus = "disabled" | "idle" | "loading" | "ready" | "error";

/** An answer the server accepted: `previous` is the saved answer it replaced (null: none known). */
export type SavedAnswer = { menuKey: string; dollars: number; previous: number | null };

export type MineSnapshot = {
  status: LoadStatus;
  /** Each menu's answer as the picker shows it: one being sent, else the saved one. */
  answers: ReadonlyMap<string, number>;
  /** Menus with an answer on its way. */
  saving: ReadonlySet<string>;
  /** Menus whose answer was saved during this page view. */
  saved: ReadonlySet<string>;
  /** The last failed answer per menu (cleared by its next answer). */
  errors: ReadonlyMap<string, WorthErrorKind>;
};

export type HistSnapshot = {
  status: LoadStatus;
  /** Each answered menu's histogram (dollars -> answers), this browser's unsaved answer included. */
  hists: ReadonlyMap<string, Hist>;
  /** A load of every menu has completed (every menu's histogram is known). */
  all: boolean;
  /** No load of every menu has completed and the latest one failed. */
  allFailed: boolean;
  /** Menus whose histogram was loaded on its own (a restaurant page's). */
  covered: ReadonlySet<string>;
  /** Menus whose own load failed last time (and aren't known some other way). */
  failed: ReadonlySet<string>;
};

/**
 * Whether "Order up!" may send the slider's value: a moved slider whenever answers are open; the
 * untouched one (the starting $40) only once this browser's saved answers are known, since sent
 * before that it would replace a saved answer that hasn't arrived yet.
 */
export function canOrderUp(mineStatus: LoadStatus, moved: boolean): boolean {
  if (mineStatus === "disabled") return false;
  return moved || mineStatus === "ready";
}

/** Whether a menu's histogram is known yet (a missing one then means no answers). */
export function histKnown(s: HistSnapshot, menuKey: string): boolean {
  return s.all || s.covered.has(menuKey);
}

export type WorthStore = {
  subscribe(listener: () => void): () => void;
  getMine(): MineSnapshot;
  getHists(): HistSnapshot;
  /** The snapshots every prerendered page starts from (nothing loaded yet). */
  getServerMine(): MineSnapshot;
  getServerHists(): HistSnapshot;
  /** Load this browser's saved answers (once per page view; again only after a failure). */
  loadMine(): Promise<void>;
  /**
   * Load histograms: only `keys`' (a restaurant page's menu), or every menu's. With `all`, `keys` is
   * every menu the page knows (the People's Price page) and the load counts as a whole-table one;
   * without keys it is the whole table.
   */
  loadHist(keys?: readonly string[], opts?: { all?: boolean }): Promise<void>;
  /** Answer a menu (whole dollars, 5–75): shown at once, sent now. */
  answer(menuKey: string, dollars: number): void;
  /** Called after each answer the server saved (for analytics). Returns the unsubscribe function. */
  onSaved(listener: (saved: SavedAnswer) => void): () => void;
  /** A realtime insert or update. */
  applyRow(row: HistRow): void;
  /** A realtime delete (the cell has no answers left). */
  removeRow(menuKey: string, dollars: number): void;
  /** Resolves once no answer is on its way and every menu's fresh fetch has landed (tests). */
  settled(): Promise<void>;
};

type Cell = { menu_key: string; dollars: number; votes: number; at: number | null };
type Held = { ev: number } & ({ kind: "upsert"; row: HistRow } | { kind: "delete"; dollars: number });
type Episode = {
  /** The answer the frozen histogram holds for this browser (null: none). */
  base: number | null;
  /** The answer shown now (null: none). */
  now: number | null;
  /** At least one answer was saved during the episode. */
  sent: boolean;
  /** Events held back while the episode runs, in arrival order. */
  held: Held[];
  /** Bumped each time a fresh fetch starts, so a fetch overtaken by a newer answer is dropped. */
  token: number;
};

const cellId = (menuKey: string, dollars: number) => `${menuKey} ${dollars}`;

export function createWorthStore({ api, voter, enabled }: { api: WorthApi; voter: VoterIds; enabled: boolean }): WorthStore {
  const listeners = new Set<() => void>();
  const savedListeners = new Set<(saved: SavedAnswer) => void>();

  // ---- this browser's answers ----
  const confirmed = new Map<string, number>(); // saved on the server
  const wanted = new Map<string, number>(); // answered, not (yet) confirmed: what the picker shows
  const queued = new Map<string, number>(); // the next answer to send per menu
  const sending = new Set<string>();
  const touched = new Set<string>(); // answered during this page view: a late my_worth never overrides it
  const saved = new Set<string>();
  const errors = new Map<string, WorthErrorKind>();
  let mineStatus: LoadStatus = enabled ? "idle" : "disabled";
  let mineLoad: Promise<void> | null = null;

  // ---- public histograms ----
  const cells = new Map<string, Cell>();
  const arrived = new Map<string, number>(); // arrival order per cell
  const tombs = new Map<string, number>(); // arrival order of each cell's latest delete
  let seq = 0; // arrival counter (cells, deletes and held events share it)
  let histStatus: LoadStatus = enabled ? "idle" : "disabled";
  let loadedAll = false;
  let allFailed = false;
  const covered = new Set<string>();
  const failed = new Set<string>();
  const episodes = new Map<string, Episode>();
  const settling = new Set<Promise<void>>();

  const makeMine = (): MineSnapshot => {
    const answers = new Map(confirmed);
    for (const [k, v] of wanted) answers.set(k, v);
    return { status: mineStatus, answers, saving: new Set([...queued.keys(), ...sending]), saved: new Set(saved), errors: new Map(errors) };
  };

  const makeHists = (): HistSnapshot => {
    const hists = new Map<string, Map<number, number>>();
    for (const c of cells.values()) {
      if (c.votes <= 0) continue;
      let h = hists.get(c.menu_key);
      if (!h) hists.set(c.menu_key, (h = new Map()));
      h.set(c.dollars, c.votes);
    }
    for (const [k, e] of episodes) {
      if (e.base === e.now) continue;
      const h = new Map(hists.get(k) ?? []);
      if (e.base !== null) {
        const n = h.get(e.base) ?? 0;
        if (n > 1) h.set(e.base, n - 1);
        else h.delete(e.base);
      }
      if (e.now !== null) h.set(e.now, (h.get(e.now) ?? 0) + 1);
      if (h.size) hists.set(k, h);
      else hists.delete(k);
    }
    return { status: histStatus, hists, all: loadedAll, allFailed, covered: new Set(covered), failed: new Set(failed) };
  };

  const serverMine = makeMine();
  const serverHists = makeHists();
  let mineSnap = serverMine;
  let histSnap = serverHists;

  function changed(which: { mine?: boolean; hist?: boolean }) {
    if (which.mine) mineSnap = makeMine();
    if (which.hist) histSnap = makeHists();
    for (const l of [...listeners]) l();
  }

  // ---- cells ----

  /** Apply an upsert unless the current copy is newer. */
  function upsert(row: HistRow): boolean {
    const id = cellId(row.menu_key, row.dollars);
    const cur = cells.get(id);
    if (cur && cur.at !== null && row.at !== null && cur.at > row.at) return false;
    if (row.votes <= 0) return remove(row.menu_key, row.dollars);
    cells.set(id, { menu_key: row.menu_key, dollars: row.dollars, votes: row.votes, at: row.at });
    arrived.set(id, ++seq);
    tombs.delete(id);
    return true;
  }

  function remove(menuKey: string, dollars: number): boolean {
    const id = cellId(menuKey, dollars);
    tombs.set(id, ++seq);
    arrived.delete(id);
    return cells.delete(id);
  }

  /** Replace every cell of `menuKey` with a fresh copy. */
  function replaceMenu(menuKey: string, rows: readonly HistRow[]) {
    for (const [id, c] of [...cells]) {
      if (c.menu_key !== menuKey) continue;
      cells.delete(id);
      arrived.delete(id);
    }
    for (const r of rows) {
      if (r.menu_key !== menuKey || r.votes <= 0) continue;
      const id = cellId(r.menu_key, r.dollars);
      cells.set(id, { menu_key: r.menu_key, dollars: r.dollars, votes: r.votes, at: r.at });
      arrived.set(id, ++seq);
      tombs.delete(id);
    }
  }

  // ---- episodes (an answer on its way) ----

  function busy(key: string): boolean {
    return queued.has(key) || sending.has(key);
  }

  /** The episode is over: fold in the fresh copy (or, without one, every held event) and drop the overlay. */
  function endEpisode(key: string, fresh: { rows: HistRow[]; since: number } | null) {
    const e = episodes.get(key);
    if (!e) return;
    episodes.delete(key);
    if (fresh) {
      replaceMenu(key, fresh.rows);
      covered.add(key);
      failed.delete(key);
      if (histStatus !== "ready") histStatus = "ready";
      // Events that arrived before the fresh fetch was sent are in it already.
      replayHeld(key, e.held.filter((h) => h.ev > fresh.since));
    } else {
      replayHeld(key, e.held);
    }
    changed({ hist: true });
  }

  function replayHeld(key: string, events: readonly Held[]) {
    for (const h of events) {
      if (h.kind === "upsert") upsert(h.row);
      else remove(key, h.dollars);
    }
  }

  /** After the last send of an episode: fetch the menu fresh (if anything was saved), then end it. */
  function finishEpisode(key: string) {
    const e = episodes.get(key);
    if (!e || busy(key)) return;
    if (!e.sent) {
      endEpisode(key, null);
      return;
    }
    const token = ++e.token;
    const since = seq;
    const p = api.fetchHist([key]).then(
      (rows) => {
        const cur = episodes.get(key);
        if (cur !== e || e.token !== token || busy(key)) return; // overtaken by a newer answer
        endEpisode(key, { rows, since });
      },
      () => {
        const cur = episodes.get(key);
        if (cur !== e || e.token !== token || busy(key)) return;
        endEpisode(key, null);
      },
    );
    settling.add(p);
    void p.finally(() => settling.delete(p));
  }

  async function pump(key: string): Promise<void> {
    if (sending.has(key)) return; // the running loop sends the queued answer next
    sending.add(key);
    try {
      while (queued.has(key)) {
        const dollars = queued.get(key) as number;
        queued.delete(key);
        if (confirmed.get(key) === dollars) continue; // already saved: nothing to send
        try {
          await api.castWorth(key, voter.get(), dollars);
          const e = episodes.get(key);
          // The saved answer this one replaced: confirmed, else the one my_worth reported during the
          // episode (an answer made before my_worth loaded); unknown if my_worth hasn't answered yet.
          const previous = confirmed.get(key) ?? (e && !e.sent ? e.base : null);
          confirmed.set(key, dollars);
          saved.add(key);
          errors.delete(key);
          if (e) e.sent = true;
          for (const l of [...savedListeners]) {
            try {
              l({ menuKey: key, dollars, previous });
            } catch {
              // A listener's failure is not the answer's.
            }
          }
        } catch (err) {
          errors.set(key, classifyWorthError(err));
          saved.delete(key);
          // A newer answer still goes out; otherwise the picker falls back to the saved answer.
          if (!queued.has(key)) {
            wanted.delete(key);
            const e = episodes.get(key);
            if (e) e.now = confirmed.get(key) ?? null;
          }
        }
        changed({ mine: true, hist: true });
      }
    } finally {
      sending.delete(key);
      if (!queued.has(key) && wanted.get(key) === confirmed.get(key)) wanted.delete(key);
      changed({ mine: true });
      finishEpisode(key);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getMine: () => mineSnap,
    getHists: () => histSnap,
    getServerMine: () => serverMine,
    getServerHists: () => serverHists,

    loadMine() {
      if (!enabled) return Promise.resolve();
      if (mineLoad) return mineLoad;
      const id = voter.read();
      if (!id) {
        // Never answered from this browser: nothing to load.
        mineStatus = "ready";
        changed({ mine: true });
        mineLoad = Promise.resolve();
        return mineLoad;
      }
      mineStatus = "loading";
      changed({ mine: true });
      mineLoad = api.fetchMyWorth(id).then(
        (mine) => {
          for (const [k, v] of mine) {
            if (!isValidAnswer(v)) continue;
            if (!touched.has(k)) confirmed.set(k, v);
            // An answer made before this loaded: the frozen histogram holds the saved answer.
            const e = episodes.get(k);
            if (e && e.base === null && !e.sent) e.base = v;
          }
          mineStatus = "ready";
          changed({ mine: true, hist: true });
        },
        () => {
          mineStatus = "error";
          mineLoad = null; // try again next time
          changed({ mine: true });
        },
      );
      return mineLoad;
    },

    async loadHist(keys, opts) {
      if (!enabled) return;
      const whole = !keys || opts?.all === true;
      const since = seq;
      // A retry shows as loading again (the histograms already shown stay).
      if (histStatus !== "ready") histStatus = "loading";
      if (whole) allFailed = false;
      else for (const k of keys) failed.delete(k);
      changed({ hist: true });
      try {
        const got = await api.fetchHist(keys);
        const scope = keys ? new Set(keys) : null;
        const fetched = new Set<string>();
        for (const r of got) {
          if (scope && !scope.has(r.menu_key)) continue;
          if (episodes.has(r.menu_key) || r.votes <= 0) continue; // frozen: its fresh fetch decides
          const id = cellId(r.menu_key, r.dollars);
          fetched.add(id);
          if ((tombs.get(id) ?? 0) > since) continue; // deleted after this fetch started
          const cur = cells.get(id);
          const newer = cur && (cur.at !== null && r.at !== null ? cur.at > r.at : (arrived.get(id) ?? 0) > since);
          if (newer) continue;
          cells.set(id, { menu_key: r.menu_key, dollars: r.dollars, votes: r.votes, at: r.at });
          arrived.set(id, ++seq);
        }
        // Cells the fetch no longer has are gone, unless they arrived after it started.
        for (const [id, c] of [...cells]) {
          if (fetched.has(id) || (scope && !scope.has(c.menu_key)) || episodes.has(c.menu_key) || (arrived.get(id) ?? 0) > since) continue;
          cells.delete(id);
          arrived.delete(id);
        }
        histStatus = "ready";
        if (!whole && scope) {
          for (const k of scope) {
            if (episodes.has(k) && !covered.has(k)) continue; // known once its fresh fetch lands
            covered.add(k);
            failed.delete(k);
          }
        } else {
          loadedAll = true;
          allFailed = false;
        }
      } catch {
        if (whole && !loadedAll) allFailed = true;
        if (!whole && keys) for (const k of keys) if (!covered.has(k)) failed.add(k);
        // A failed refresh keeps the histograms already shown.
        if (histStatus !== "ready") histStatus = "error";
      }
      changed({ hist: true });
    },

    answer(menuKey, dollars) {
      if (!enabled || !isMenuKey(menuKey) || !isValidAnswer(dollars)) return;
      touched.add(menuKey);
      errors.delete(menuKey);
      const e = episodes.get(menuKey);
      if (e) e.now = dollars;
      else episodes.set(menuKey, { base: confirmed.get(menuKey) ?? null, now: dollars, sent: false, held: [], token: 0 });
      wanted.set(menuKey, dollars);
      queued.set(menuKey, dollars);
      changed({ mine: true, hist: true });
      void pump(menuKey);
    },

    onSaved(listener) {
      savedListeners.add(listener);
      return () => {
        savedListeners.delete(listener);
      };
    },

    applyRow(row) {
      const e = episodes.get(row.menu_key);
      if (e) {
        e.held.push({ ev: ++seq, kind: "upsert", row });
        return;
      }
      if (upsert(row)) changed({ hist: true });
    },

    removeRow(menuKey, dollars) {
      const e = episodes.get(menuKey);
      if (e) {
        e.held.push({ ev: ++seq, kind: "delete", dollars });
        return;
      }
      if (remove(menuKey, dollars)) changed({ hist: true });
    },

    async settled() {
      while (queued.size || sending.size || settling.size || episodes.size) {
        if (settling.size) await Promise.allSettled([...settling]);
        else await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}

/** The page's store: the Supabase API (loaded lazily inside worth-api) and this browser's voter id. */
export const worthStore: WorthStore = createWorthStore({
  api: { castWorth, fetchMyWorth, fetchHist },
  voter: { read: () => readVoterId(), get: () => getVoterId() },
  enabled: WORTH_ENABLED,
});
