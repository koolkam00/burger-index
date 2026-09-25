// The home pricer's state (DESIGN.md "The pricer hero"): the area, the burger on the counter, and what
// this session has served. A plain external store for useSyncExternalStore, like the worth store: no
// React in here, so the tests drive it with fake storage, a fake loader and a fixed shuffle.
//
// It lives for the page's JavaScript lifetime, so a visitor who leaves the home page and comes back
// (a client-side navigation) finds the same burger on the counter. What the session has served is
// also kept in sessionStorage (a reload starts where it was), and the last area in localStorage (a
// returning visitor starts straight in it). Every storage access is wrapped: it can be missing or throw.
//
// Which burgers: the area's distinct menus (a chain once, at its location in the area), in a random
// order drawn each time the area is picked, never one this browser has already priced (setAnswered,
// fed from my_worth as it arrives) and never one served earlier this session (answered or skipped).
// When none is left the area is exhausted.
import {
  areaId,
  areaPicks,
  nextKey,
  parseAreaId,
  parsePricerData,
  parseSession,
  PRICER_AREA_KEY,
  PRICER_DATA_PATH,
  PRICER_SESSION_KEY,
  readItem,
  shuffled,
  writeItem,
  type KeyValueStorage,
  type PricerArea,
  type PricerMenu,
  type PricerPick,
} from "./pricer";

export type PricerView = "choose" | "play";
export type PricerDataStatus = "idle" | "loading" | "ready" | "error";

export type PricerSnapshot = {
  /** The saved area has been read (false in the prerendered page, until the pricer mounts). */
  restored: boolean;
  /** The area picker, or a burger (its loading, reveal and "none left" states included). */
  view: PricerView;
  data: PricerDataStatus;
  /** The area being priced; it stays while the visitor looks at the picker again. */
  area: PricerArea | null;
  /** The burger on the counter (null until the burgers load, and once the area has none left). */
  current: PricerPick | null;
  /** "Order up!" was pressed for the burger on the counter (the reveal shows once it is saved). */
  sent: boolean;
  /** The area has no burger left: each one is priced already or was served this session. */
  exhausted: boolean;
  /** Burgers answered through the pricer this session. */
  answered: number;
  /** Bumped on every pick (a burger, or none left), so a page can tell two picks apart. */
  pick: number;
};

export type PricerDeps = {
  /** Fetches the data file (lib/pricer PricerData, unchecked). */
  load(): Promise<unknown>;
  /** localStorage and sessionStorage, or null (each call may throw; the store wraps them). */
  local(): KeyValueStorage | null;
  session(): KeyValueStorage | null;
  /** [0, 1), like Math.random (the tests pass a fixed one). */
  random?: () => number;
};

export type PricerStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PricerSnapshot;
  /** What every prerendered page starts from: the picker, nothing read yet. */
  getServerSnapshot(): PricerSnapshot;
  /** Once, on mount: read this session and the saved area (a neighborhood must be one of `hoods`). */
  start(hoods: ReadonlySet<string>): void;
  /** Fetch the burgers (once; again after a failure). */
  load(): Promise<void>;
  /** Price in this area: saved for next time, shuffled afresh, and the first burger served. */
  choose(area: PricerArea): void;
  /** Show the picker again (the area and the burger on the counter stay until another area is picked). */
  changeArea(): void;
  /** Serve the next burger in the area (after the reveal, or to skip this one). */
  next(): void;
  /** The visitor moved the slider: a late "already priced" no longer swaps this burger out. */
  hold(): void;
  /** "Order up!" was pressed for the burger on the counter. */
  send(): void;
  /** An answer saved through the pricer (counted for the session). */
  countAnswer(): void;
  /**
   * The menus this browser has answered (my_worth, as it arrives, and answers made since): never
   * served. The burger on the counter is swapped out if it is one and the visitor hasn't touched it.
   */
  setAnswered(keys: Iterable<string>): void;
};

export function createPricerStore(deps: PricerDeps): PricerStore {
  const random = deps.random ?? Math.random;
  const listeners = new Set<() => void>();

  let started = false;
  let restored = false;
  let view: PricerView = "choose";
  let data: PricerDataStatus = "idle";
  let menus: PricerMenu[] = [];
  let loading: Promise<void> | null = null;
  let area: PricerArea | null = null;
  let current: PricerPick | null = null;
  let sent = false;
  let held = false;
  let pickSeq = 0;
  let answeredCount = 0;
  let answeredKeys = new Set<string>();
  const seen = new Set<string>();
  /** The shuffled queue per area id, drawn when the area is picked (and when the burgers arrive). */
  const orders = new Map<string, string[]>();

  const snapshotOf = (): PricerSnapshot => ({
    restored,
    view,
    data,
    area,
    current,
    sent,
    exhausted: view === "play" && data === "ready" && area !== null && current === null,
    answered: answeredCount,
    pick: pickSeq,
  });
  const serverSnap = snapshotOf();
  let snap = serverSnap;

  function emit() {
    snap = snapshotOf();
    for (const l of [...listeners]) l();
  }

  /** A storage, or null when even reaching it throws. */
  const storage = (get: () => KeyValueStorage | null): KeyValueStorage | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };

  function persistSession() {
    writeItem(storage(deps.session), PRICER_SESSION_KEY, JSON.stringify({ seen: [...seen], answered: answeredCount }));
  }

  /** The area's queue, drawn now if it hasn't been. */
  function orderFor(a: PricerArea): string[] {
    const id = areaId(a);
    let order = orders.get(id);
    if (!order) {
      order = shuffled([...areaPicks(menus, a).keys()], random);
      orders.set(id, order);
    }
    return order;
  }

  /** Serve the area's next burger (or none): what was on the counter counts as served. */
  function pick() {
    pickSeq += 1;
    sent = false;
    held = false;
    current = null;
    if (!area || data !== "ready") return;
    const key = nextKey(orderFor(area), (k) => seen.has(k) || answeredKeys.has(k));
    if (key === null) return;
    current = areaPicks(menus, area).get(key) ?? null;
    seen.add(key);
    persistSession();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snap,
    getServerSnapshot: () => serverSnap,

    start(hoods) {
      if (started) return;
      started = true;
      restored = true;
      const session = parseSession(readItem(storage(deps.session), PRICER_SESSION_KEY));
      for (const k of session.seen) seen.add(k);
      answeredCount = session.answered;
      const saved = parseAreaId(readItem(storage(deps.local), PRICER_AREA_KEY), hoods);
      if (saved) {
        area = saved;
        view = "play";
      }
      emit();
    },

    load() {
      if (data === "ready") return Promise.resolve();
      if (loading) return loading;
      data = "loading";
      emit();
      loading = deps.load().then(
        (raw) => {
          menus = parsePricerData(raw);
          data = "ready";
          loading = null;
          orders.clear();
          if (view === "play" && area && !current) pick();
          emit();
        },
        () => {
          data = "error";
          loading = null;
          emit();
        },
      );
      return loading;
    },

    choose(a) {
      area = a;
      view = "play";
      writeItem(storage(deps.local), PRICER_AREA_KEY, areaId(a));
      orders.delete(areaId(a)); // a fresh shuffle each time the area is picked
      pick();
      emit();
    },

    changeArea() {
      if (view === "choose") return;
      view = "choose";
      emit();
    },

    next() {
      if (view !== "play") return;
      pick();
      emit();
    },

    hold() {
      if (held || !current) return;
      held = true;
    },

    send() {
      if (!current) return;
      held = true;
      if (!sent) {
        sent = true;
        emit();
      }
    },

    countAnswer() {
      answeredCount += 1;
      persistSession();
      emit();
    },

    setAnswered(keys) {
      const next = new Set(keys);
      const same = next.size === answeredKeys.size && [...next].every((k) => answeredKeys.has(k));
      if (same) return;
      answeredKeys = next;
      if (view === "play" && current && !held && !sent && answeredKeys.has(current.menu.key)) {
        pick();
        emit();
      }
    },
  };
}

function browserStorage(which: "localStorage" | "sessionStorage"): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window[which] : null;
  } catch {
    return null;
  }
}

/** The page's pricer: the data file from the static route, the browser's storage. */
export const pricerStore: PricerStore = createPricerStore({
  load: () =>
    fetch(PRICER_DATA_PATH).then((res) => {
      if (!res.ok) throw new Error(`pricer data: ${res.status}`);
      return res.json() as Promise<unknown>;
    }),
  local: () => browserStorage("localStorage"),
  session: () => browserStorage("sessionStorage"),
});
