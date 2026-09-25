// This browser's votes and the public totals, shared by every vote component on a page (DESIGN.md
// "Vote picker" and "Best burgers leaderboard"). A plain external store for useSyncExternalStore:
// no React in here, so the tests drive it with a fake API.
//
// Votes are optimistic: a pick shows at once and is sent in the background. Sends for one menu are
// serialized (one request in flight, the latest pick queued behind it), so quick changes can't land
// out of order; a pick made with the keyboard waits out a short pause first, so arrowing from 1 to 9
// sends one vote, not eight. A failed send falls back to the last saved vote and keeps the error.
//
// Totals come from three places: a fetch (the whole table, or some menus), realtime events and
// cast_vote's reply. Each row remembers its updated_at (when the source has it) and when it arrived,
// so an older copy never replaces a newer one.
import { castVote, fetchMyVotes, fetchScores } from "./vote-api";
import { VOTING_ENABLED } from "./vote-config";
import { getVoterId, readVoterId } from "./voter";
import { classifyVoteError, isMenuKey, isValidScore, type ScoreRow, type VoteErrorKind } from "./votes";

export type VoteApi = {
  castVote(menuKey: string, voter: string, score: number): Promise<ScoreRow | null>;
  fetchMyVotes(voter: string): Promise<Map<string, number>>;
  fetchScores(keys?: readonly string[]): Promise<ScoreRow[]>;
};

export type VoterIds = {
  /** This browser's voter id, or null before its first vote (never creates one). */
  read(): string | null;
  /** This browser's voter id, made on first use. */
  get(): string;
};

export type LoadStatus = "disabled" | "idle" | "loading" | "ready" | "error";

export type MineSnapshot = {
  status: LoadStatus;
  /** The score each menu's picker shows: a pick being saved, else the saved vote. */
  picked: ReadonlyMap<string, number>;
  /** Menus with a pick waiting out the keyboard pause or on its way. */
  saving: ReadonlySet<string>;
  /** Menus whose vote was saved during this page view. */
  saved: ReadonlySet<string>;
  /** The last failed vote per menu (cleared by its next pick). */
  errors: ReadonlyMap<string, VoteErrorKind>;
};

export type ScoresSnapshot = {
  status: LoadStatus;
  rows: ReadonlyMap<string, ScoreRow>;
  /** A whole-table load has completed (every menu's totals are known). */
  all: boolean;
  /** No whole-table load has completed and the latest one failed. */
  allFailed: boolean;
  /** Menus whose totals were loaded on their own (a restaurant page's). */
  covered: ReadonlySet<string>;
  /** Menus whose own load failed last time (and aren't known some other way). */
  failed: ReadonlySet<string>;
};

/** Whether a menu's totals are known yet (a missing row then means no votes). */
export function scoresKnown(s: ScoresSnapshot, menuKey: string): boolean {
  return s.all || s.covered.has(menuKey);
}

export type VoteStore = {
  subscribe(listener: () => void): () => void;
  getMine(): MineSnapshot;
  getScores(): ScoresSnapshot;
  /** The snapshots every prerendered page starts from (nothing loaded yet). */
  getServerMine(): MineSnapshot;
  getServerScores(): ScoresSnapshot;
  /** Load this browser's saved votes (once per page view; again only after a failure). */
  loadMine(): Promise<void>;
  /** Load totals: every menu's, or only `keys`. */
  loadScores(keys?: readonly string[]): Promise<void>;
  /** Pick a score for a menu: shown at once, sent after `delayMs` (a keyboard pause) or now. */
  vote(menuKey: string, score: number, delayMs?: number): void;
  /** Send a pick that is waiting out its pause now. */
  flush(menuKey: string): void;
  /** A realtime insert or update. */
  applyScore(row: ScoreRow): void;
  /** A realtime delete. */
  removeScore(menuKey: string): void;
  /** Resolves once no pick is waiting or on its way (tests). */
  settled(): Promise<void>;
};

export function createVoteStore({ api, voter, enabled }: { api: VoteApi; voter: VoterIds; enabled: boolean }): VoteStore {
  const listeners = new Set<() => void>();

  // ---- this browser's votes ----
  const confirmed = new Map<string, number>(); // saved on the server
  const wanted = new Map<string, number>(); // picked, not (yet) confirmed: what the picker shows
  const queued = new Map<string, number>(); // the next score to send per menu
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const sending = new Set<string>();
  const touched = new Set<string>(); // picked during this page view: a late my_votes never overrides it
  const saved = new Set<string>();
  const errors = new Map<string, VoteErrorKind>();
  let mineStatus: LoadStatus = enabled ? "idle" : "disabled";
  let mineLoad: Promise<void> | null = null;

  // ---- public totals ----
  const rows = new Map<string, ScoreRow>();
  const arrived = new Map<string, number>(); // arrival order per row
  let seq = 0;
  let scoresStatus: LoadStatus = enabled ? "idle" : "disabled";
  let loadedAll = false;
  let allFailed = false;
  const covered = new Set<string>();
  const failed = new Set<string>();

  const makeMine = (): MineSnapshot => {
    const picked = new Map(confirmed);
    for (const [k, v] of wanted) picked.set(k, v);
    return {
      status: mineStatus,
      picked,
      saving: new Set([...timers.keys(), ...queued.keys(), ...sending]),
      saved: new Set(saved),
      errors: new Map(errors),
    };
  };
  const makeScores = (): ScoresSnapshot => ({ status: scoresStatus, rows: new Map(rows), all: loadedAll, allFailed, covered: new Set(covered), failed: new Set(failed) });

  const serverMine = makeMine();
  const serverScores = makeScores();
  let mineSnap = serverMine;
  let scoresSnap = serverScores;

  function changed(which: { mine?: boolean; scores?: boolean }) {
    if (which.mine) mineSnap = makeMine();
    if (which.scores) scoresSnap = makeScores();
    for (const l of [...listeners]) l();
  }

  /** Keep the current copy of a row over an incoming one? Newer updated_at wins; else the later arrival. */
  function keepCurrent(key: string, incomingAt: number | null, since: number): boolean {
    const cur = rows.get(key);
    if (!cur) return false;
    if (cur.at !== null && incomingAt !== null) return cur.at > incomingAt;
    return (arrived.get(key) ?? 0) > since;
  }

  function putRow(row: ScoreRow) {
    rows.set(row.menu_key, row);
    arrived.set(row.menu_key, ++seq);
  }

  function applyOne(row: ScoreRow): boolean {
    const cur = rows.get(row.menu_key);
    if (cur && cur.at !== null && row.at !== null && cur.at > row.at) return false;
    putRow(row);
    return true;
  }

  async function pump(key: string): Promise<void> {
    if (sending.has(key)) return; // the running loop sends the queued score next
    sending.add(key);
    try {
      while (queued.has(key) && !timers.has(key)) {
        const score = queued.get(key) as number;
        queued.delete(key);
        if (confirmed.get(key) === score) continue; // already saved: nothing to send
        try {
          const row = await api.castVote(key, voter.get(), score);
          confirmed.set(key, score);
          saved.add(key);
          errors.delete(key);
          if (row) applyOne(row);
        } catch (err) {
          errors.set(key, classifyVoteError(err));
          saved.delete(key);
          // A newer pick still goes out; otherwise the picker falls back to the saved vote.
          if (!queued.has(key) && !timers.has(key)) wanted.delete(key);
        }
        changed({ mine: true, scores: true });
      }
    } finally {
      sending.delete(key);
      if (!queued.has(key) && !timers.has(key) && wanted.get(key) === confirmed.get(key)) wanted.delete(key);
      changed({ mine: true });
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
    getScores: () => scoresSnap,
    getServerMine: () => serverMine,
    getServerScores: () => serverScores,

    loadMine() {
      if (!enabled) return Promise.resolve();
      if (mineLoad) return mineLoad;
      const id = voter.read();
      if (!id) {
        // Never voted from this browser: nothing to load.
        mineStatus = "ready";
        changed({ mine: true });
        mineLoad = Promise.resolve();
        return mineLoad;
      }
      mineStatus = "loading";
      changed({ mine: true });
      mineLoad = api.fetchMyVotes(id).then(
        (mine) => {
          for (const [k, v] of mine) if (!touched.has(k) && isValidScore(v)) confirmed.set(k, v);
          mineStatus = "ready";
          changed({ mine: true });
        },
        () => {
          mineStatus = "error";
          mineLoad = null; // try again next time
          changed({ mine: true });
        },
      );
      return mineLoad;
    },

    async loadScores(keys) {
      if (!enabled) return;
      const since = seq;
      // A retry shows as loading again (the totals already shown stay).
      if (scoresStatus !== "ready") scoresStatus = "loading";
      if (keys) for (const k of keys) failed.delete(k);
      else allFailed = false;
      changed({ scores: true });
      try {
        const got = await api.fetchScores(keys);
        const fetched = new Map(got.map((r) => [r.menu_key, r]));
        const scope = keys ? new Set(keys) : null;
        for (const [k, r] of fetched) if (!keepCurrent(k, r.at, since)) putRow(r);
        // Rows the fetch no longer has are gone, unless they arrived after it started.
        for (const k of [...rows.keys()]) {
          if (fetched.has(k) || (scope && !scope.has(k)) || (arrived.get(k) ?? 0) > since) continue;
          rows.delete(k);
          arrived.delete(k);
        }
        scoresStatus = "ready";
        if (scope) {
          for (const k of scope) {
            covered.add(k);
            failed.delete(k);
          }
        } else {
          loadedAll = true;
          allFailed = false;
        }
      } catch {
        if (!keys && !loadedAll) allFailed = true;
        if (keys) for (const k of keys) failed.add(k);
        // A failed refresh keeps the totals already shown.
        if (scoresStatus !== "ready") scoresStatus = "error";
      }
      changed({ scores: true });
    },

    vote(menuKey, score, delayMs = 0) {
      if (!enabled || !isMenuKey(menuKey) || !isValidScore(score)) return;
      touched.add(menuKey);
      errors.delete(menuKey);
      wanted.set(menuKey, score);
      queued.set(menuKey, score);
      const t = timers.get(menuKey);
      if (t !== undefined) clearTimeout(t);
      timers.delete(menuKey);
      if (delayMs > 0) {
        timers.set(
          menuKey,
          setTimeout(() => {
            timers.delete(menuKey);
            void pump(menuKey);
          }, delayMs),
        );
      }
      changed({ mine: true });
      if (delayMs <= 0) void pump(menuKey);
    },

    flush(menuKey) {
      const t = timers.get(menuKey);
      if (t === undefined) return;
      clearTimeout(t);
      timers.delete(menuKey);
      void pump(menuKey);
    },

    applyScore(row) {
      if (applyOne(row)) changed({ scores: true });
    },

    removeScore(menuKey) {
      if (!rows.delete(menuKey)) return;
      arrived.delete(menuKey);
      changed({ scores: true });
    },

    async settled() {
      while (timers.size || queued.size || sending.size) await new Promise((r) => setTimeout(r, 5));
    },
  };
}

/** The page's store: the Supabase API (loaded lazily inside vote-api) and this browser's voter id. */
export const voteStore: VoteStore = createVoteStore({
  api: { castVote, fetchMyVotes, fetchScores },
  voter: { read: () => readVoterId(), get: () => getVoterId() },
  enabled: VOTING_ENABLED,
});
