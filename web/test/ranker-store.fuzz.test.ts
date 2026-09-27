// A seeded, model-based fuzz test of the ranker's store (src/lib/ranker-store.ts): random sequences of visitor actions,
// page events (hidden, back-forward cache, reload, a second tab), network trouble and backend refusals, run against a fake
// backend with save_ranking's real semantics (one list per voter, an upsert that brings a deleted list back, the one list
// per connection rule, refusals) and one fake localStorage shared by the tabs (a change tells the other tabs, as a storage
// event does). Invariants are checked as it goes and once everything has settled:
//
//   I1  one tab, settled: a list of 3+ burgers that isn't a replaced list shown as it is is the backend's list, and the
//       status line says neither "Saving…" nor a failure (a refusal, which is not tried again by itself, aside)
//   I2  at most one save on its way per tab; never a save of under 3 burgers, or of the list the tab knows is saved and
//       counting (the keepalive copy sent as the page closes aside)
//   I3  a list deleted on the backend is never brought back by a save sent after the delete, unless the sending tab
//       changed the list (or pressed "Count it again") after the delete
//   I4  settled, every tab either shows the backend's list or a state its status line states (under 3 burgers, a
//       refusal, a replaced list, a failed delete); nothing is left "Saving…", "Trying again soon." or "Deleting…"
//   I5  no timers left once settled, or after a delete that went through with nothing pending
//   I6  each save is handed out once (takeSave), so ranking_saved is tracked at most once per mount
//
// The backend's reads and deletes fail by mode too (a get or delete that never reached it, a lost or odd reply), the owner
// can void the list (it stays void: a save keeps it void, a delete withdraws nothing), a one-tab visit may start with
// sessionStorage missing or every storage call throwing, and half the keepalive requests land only after the open tabs
// have read the list their stamp told them of (never after a new page's first read).
//
// FUZZ_SEEDS=20000 npm test (or node … --test test/ranker-store.fuzz.test.ts) runs more; FUZZ_START picks the first seed;
// FUZZ_SEED=<n> replays one seed and prints its steps and each tab's state; FUZZ_SEED=<n> FUZZ_BEGIN='<start>'
// FUZZ_STEPS='<steps>' replays a minimized sequence as the failure report prints it (FUZZ_TRACE=1 also prints storage
// events and gets). Exploration only: FUZZ_NO=reload,lost leaves step kinds or backend modes out, FUZZ_REORDER=1 lets
// requests reach the backend out of order (FUZZ_REORDER=live: only an open page's; a closing page's requests land, or not,
// before its keepalive), FUZZ_EMULATE_ANNOUNCE=1 has lists saved as a page closes tell the other tabs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { menuListData } from "../src/lib/menu-list";
import { autosaveLine, RANKER_ERROR_COPY, sameList, type SavedRanking, type SaveReply } from "../src/lib/ranker";
import { createRankerStore, RANKER_DRAFT_KEY, type KeyValueStorage, type PageEvents, type RankerSnapshot, type RankerStore } from "../src/lib/ranker-store";
import { RANKER_SAVED_KEY } from "../src/lib/theme-script";
import { place } from "./places";

const KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];
/** A menu key the Burger Index doesn't list (a link's add of a closed restaurant). */
const GONE_KEY = "zz";
const MENUS = menuListData(KEYS.map((id) => place({ id, name: id.toUpperCase(), price: 10, borough: "Queens", hood: "astoria" })));
const TODAY = "2026-09-27";
/** Exploration only (FUZZ_EMULATE_ANNOUNCE=1): lists saved as a page closes tell the other tabs, as a fix would. */
const EMULATE_ANNOUNCE = process.env.FUZZ_EMULATE_ANNOUNCE === "1";
const REORDER = process.env.FUZZ_REORDER === "1" || process.env.FUZZ_REORDER === "live";
/** FUZZ_REORDER=live: only an open page's requests wait; a closing page's request reaches the backend (or not) as it closes. */
const REORDER_LIVE = process.env.FUZZ_REORDER === "live";
/** Exploration only: FUZZ_NO=reload,lost leaves those step kinds and backend modes out. */
const NO = new Set((process.env.FUZZ_NO ?? "").split(",").filter(Boolean));

// ---- a small seeded PRNG (mulberry32) -----------------------------------------------------------------------

function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    chance: (p: number) => next() < p,
    pick<T>(xs: readonly T[]): T {
      return xs[Math.floor(next() * xs.length)];
    },
  };
}
type Rng = ReturnType<typeof prng>;

// ---- steps ---------------------------------------------------------------------------------------------------

type Mode = "ok" | "network" | "lost" | "unknown" | "rate_connection" | "rate_voter" | "invalid";
const MODES: readonly Mode[] = ["ok", "ok", "ok", "network", "lost", "unknown", "rate_connection", "rate_voter", "invalid"];

type Step =
  | { t: "add"; tab: number; k: number }
  | { t: "remove"; tab: number; i: number }
  | { t: "move"; tab: number; i: number; d: number }
  | { t: "moveTo"; tab: number; i: number; j: number }
  | { t: "time"; ms: number }
  | { t: "net"; down: boolean }
  | { t: "mode"; m: Mode }
  | { t: "hold"; on: boolean }
  | { t: "release"; i: number }
  | { t: "releaseAll"; rev: boolean }
  | { t: "hidden"; tab: number }
  | { t: "freeze"; tab: number }
  | { t: "thaw"; tab: number; repliesFirst: boolean }
  | { t: "reload"; tab: number }
  | { t: "askDelete"; tab: number }
  | { t: "keep"; tab: number }
  | { t: "confirmDelete"; tab: number }
  | { t: "countAgain"; tab: number }
  | { t: "other" }
  | { t: "void" }
  | { t: "unmount"; tab: number }
  | { t: "mount"; tab: number; link: number | null }
  | { t: "openTab" }
  | { t: "retryLoad"; tab: number }
  | { t: "quiesce" };

type Start = {
  voter: boolean;
  row: "none" | "active" | "replaced" | "deleted" | "void";
  items: string[];
  flag: boolean;
  draft: string[] | null;
  twoTabs: boolean;
  /** One tab only: sessionStorage missing, or every storage call throwing (absent: storage works). */
  storage?: "noSession" | "throws";
};

function genStart(r: Rng): Start {
  const voter = r.chance(0.6);
  const row = voter ? r.pick(["none", "active", "active", "active", "replaced", "deleted", "void"] as const) : "none";
  const items = shuffled(r, KEYS).slice(0, 3 + r.int(3));
  const flag = row === "active" || row === "replaced" || row === "void" ? r.chance(0.9) : r.chance(0.1);
  const draft = r.chance(0.2) ? shuffled(r, KEYS).slice(0, 1 + r.int(5)) : null;
  const twoTabs = r.chance(0.5);
  const storage = !twoTabs && r.chance(0.15) ? r.pick(["noSession", "throws"] as const) : undefined;
  return { voter, row, items, flag, draft, twoTabs, ...(storage ? { storage } : {}) };
}

function shuffled<T>(r: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function genSteps(r: Rng, start: Start, n: number): Step[] {
  const steps: Step[] = [];
  const tab = () => (start.twoTabs && r.chance(0.5) ? 1 : 0);
  for (let s = 0; s < n; s++) {
    const x = r.next();
    let step: Step;
    if (x < 0.14) step = { t: "add", tab: tab(), k: r.int(KEYS.length) };
    else if (x < 0.19) step = { t: "remove", tab: tab(), i: r.int(8) };
    else if (x < 0.24) step = { t: "move", tab: tab(), i: r.int(8), d: r.pick([-2, -1, 1, 2]) };
    else if (x < 0.27) step = { t: "moveTo", tab: tab(), i: r.int(8), j: r.int(8) };
    else if (x < 0.43) {
      const y = r.next();
      step = { t: "time", ms: y < 0.55 ? r.int(2600) : y < 0.85 ? 2500 + r.int(70_000) : 60_000 + r.int(70 * 60_000) };
    } else if (x < 0.47) step = { t: "net", down: r.chance(0.5) };
    else if (x < 0.52) step = { t: "mode", m: r.pick(MODES) };
    else if (x < 0.56) step = { t: "hold", on: r.chance(0.5) };
    else if (x < 0.61) step = { t: "release", i: r.int(4) };
    else if (x < 0.63) step = { t: "releaseAll", rev: r.chance(0.5) };
    else if (x < 0.66) step = { t: "hidden", tab: tab() };
    else if (x < 0.69) step = { t: "freeze", tab: tab() };
    else if (x < 0.72) step = { t: "thaw", tab: tab(), repliesFirst: r.chance(0.5) };
    else if (x < 0.74) step = { t: "reload", tab: tab() };
    else if (x < 0.77) step = { t: "askDelete", tab: tab() };
    else if (x < 0.78) step = { t: "keep", tab: tab() };
    else if (x < 0.81) step = { t: "confirmDelete", tab: tab() };
    else if (x < 0.83) step = { t: "countAgain", tab: tab() };
    else if (x < 0.845) step = { t: "other" };
    else if (x < 0.85) step = { t: "void" };
    else if (x < 0.87) step = { t: "unmount", tab: tab() };
    else if (x < 0.9) step = { t: "mount", tab: tab(), link: r.chance(0.5) ? r.int(KEYS.length + 1) : null };
    else if (x < 0.92) step = { t: "openTab" };
    else if (x < 0.94) step = { t: "retryLoad", tab: tab() };
    else if (x < 0.96) step = { t: "quiesce" };
    else step = { t: "time", ms: r.int(3000) };
    if (NO.has(step.t) || (step.t === "mode" && NO.has(step.m))) continue;
    steps.push(step);
  }
  return steps;
}

// ---- the world: backend, storage, clock, tabs ----------------------------------------------------------------

type Row = { items: string[]; status: "active" | "replaced" | "deleted" | "void"; savedOn: string; deletedOp: number; deletedBy: number; delSentOp: number };

type Inst = {
  store: RankerStore;
  page: PageEvents | null;
  timers: Map<number, { at: number; fn: () => void }>;
  alive: boolean;
  frozen: boolean;
  /** Replies that came while the page was frozen in the back-forward cache: delivered when it is shown again. */
  deferred: (() => void)[];
  outstanding: number;
  mount: { tracked: boolean; unsub: () => void } | null;
  taken: Set<number>;
  unwatch: () => void;
};

/** `lastEditOp`: the visitor's last change here; `toldOp`: when this tab last heard the list was deleted (an event, a check). */
type Tab = { id: number; session: Map<string, string>; inst: Inst | null; lastEditOp: number; toldOp: number };

type Held = { inst: Inst | null; label: string; run: () => void; land?: () => void };

type Violation = { code: string; msg: string; step: number };

class World {
  rng: Rng;
  now = Date.UTC(2026, 8, 27, 14, 20);
  op = 1;
  netDown = false;
  mode: Mode = "ok";
  hold = false;
  rows = new Map<string, Row>();
  local = new Map<string, string>();
  voter: string | null = null;
  held: Held[] = [];
  events: { to: Tab; inst: Inst; deleted: boolean }[] = [];
  tabs: Tab[] = [];
  timerId = 0;
  stepNo = -1;
  violations: Violation[] = [];
  /** The other browser on this connection saved a list after this voter's list last became active. */
  otherSinceActive = false;
  /** The save being applied will never be answered to a live page (a keepalive, or a page that closed). */
  silent = false;
  /** Storage trouble for this (one-tab) visit. */
  storage: Start["storage"] = undefined;
  /** Set by a call's apply: run when its reply reaches the page (the page learns something). */
  onDeliver: (() => void) | null = null;
  /**
   * Keepalive requests still on their way: each lands once the tabs already open have heard the closing tab's stamp and
   * asked for the list (their reads answered first), before any time passes, and before a page loads or comes back from
   * the back-forward cache (a new page's first read comes long after). Its own PRNG, so the other draws (and the
   * regression seeds) stay as they were.
   */
  late: (() => void)[] = [];
  lateRng: Rng;

  constructor(seed: number) {
    this.rng = prng(seed ^ 0x9e3779b9);
    this.lateRng = prng(seed ^ 0x5bd1e995);
  }

  fail(code: string, msg: string) {
    if (this.violations.some((v) => v.code === code)) return;
    this.violations.push({ code, msg, step: this.stepNo });
  }

  // -- the backend (save_ranking / get_my_ranking / delete_ranking as the migrations define them) --

  /**
   * `sent`: when the save went and what its tab knew then (its last change, when it last heard of a delete). I3: a save
   * that brings a deleted list back is fine only if its tab didn't know of the delete when it sent it (another tab's
   * delete it hadn't heard of yet: the race the card resolves by showing what the backend holds), or changed the list
   * after it (after asking for it, for its own delete).
   */
  applySave(voter: string, items: readonly string[], sent: { op: number; editOp: number; toldOp: number; tab: number }, from: string): SaveReply {
    const row = this.rows.get(voter);
    if (row && row.status === "deleted" && voter === "v1") {
      const own = row.deletedBy === sent.tab && sent.op > row.delSentOp;
      const told = sent.toldOp > row.deletedOp;
      const since = own ? row.delSentOp : row.deletedOp;
      if ((own || told) && !(sent.editOp > since)) {
        this.fail("I3", `${from} brought back a list deleted ${own ? "in this tab" : "elsewhere, as it knew"} without a change made since: ${items.join(",")}`);
      }
    }
    // a voided list stays void: the new version never counts and replaces nothing
    if (row && row.status === "void") {
      row.items = [...items];
      row.savedOn = TODAY;
      return { status: "void", savedOn: TODAY, countsFrom: null };
    }
    // the same list again from the same connection changes nothing
    if (row && row.status === "active" && sameList(row.items, items)) return { status: "active", savedOn: row.savedOn, countsFrom: "2026-09-28" };
    for (const [v, other] of this.rows) if (v !== voter && other.status === "active") other.status = "replaced";
    if (voter !== "v1") this.otherSinceActive = true;
    else this.otherSinceActive = false;
    const changed = !row || row.status !== "active" || !sameList(row.items, items);
    this.rows.set(voter, { items: [...items], status: "active", savedOn: TODAY, deletedOp: 0, deletedBy: -1, delSentOp: 0 });
    if (EMULATE_ANNOUNCE && changed && voter === "v1" && this.silent) {
      // exploration only: as if a list saved while its page closed told the other tabs (a new stamp)
      const old = this.local.get(RANKER_SAVED_KEY) ?? null;
      const stamp = `k${++this.op}`;
      this.local.set(RANKER_SAVED_KEY, stamp);
      if (old !== stamp) for (const t of this.tabs) if (t.inst) this.events.push({ to: t, inst: t.inst, deleted: false });
    }
    return { status: "active", savedOn: TODAY, countsFrom: "2026-09-28" };
  }

  applyDelete(voter: string, tab: number, sentOp: number): boolean {
    const row = this.rows.get(voter);
    if (!row || (row.status !== "active" && row.status !== "replaced")) return false;
    row.status = "deleted";
    row.deletedOp = ++this.op;
    row.deletedBy = tab;
    row.delSentOp = sentOp;
    return true;
  }

  refusal(mode: Mode): unknown {
    switch (mode) {
      case "network":
      case "lost":
        return new TypeError("Failed to fetch");
      case "unknown":
        return { kind: "unknown" };
      case "rate_connection":
        return { code: "PT429", hint: "rate_connection", message: "Lots of lists were saved from this connection in the last hour." };
      case "rate_voter":
        return { code: "P0001", hint: "rate_voter", message: "You've saved your list a lot today." };
      case "invalid":
        return { code: "22023", hint: "list_invalid", message: "That list doesn't look right." };
      default:
        return null;
    }
  }

  /**
   * One call to the backend from `inst`: it fails at once when the network is down; otherwise it is applied and answered
   * now, or (while replies are held) later, applied when it went (the reply delayed) or when it is released (the request
   * delayed). A reply for a page that is gone is dropped; one for a frozen page waits until it is shown again.
   */
  call<T>(inst: Inst, label: string, apply: () => { ok: true; value: T } | { ok: false; err: unknown }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.netDown) {
        queueMicrotask(() => reject(new TypeError("Failed to fetch")));
        return;
      }
      let outcome: { ok: true; value: T } | { ok: false; err: unknown } | null = null;
      let onDeliver: (() => void) | null = null;
      const applyNow = () => {
        this.onDeliver = null;
        outcome = apply();
        onDeliver = this.onDeliver;
        this.onDeliver = null;
      };
      const deliver = () => {
        const o = outcome!;
        const fn = () => {
          onDeliver?.();
          if (o.ok) resolve(o.value);
          else reject(o.err);
        };
        if (!inst.alive) return;
        if (inst.frozen) inst.deferred.push(fn);
        else fn();
      };
      if (!this.hold) {
        applyNow();
        deliver();
        return;
      }
      // The backend handles requests in the order they were sent; only the replies wait (and may come back out of order).
      // FUZZ_REORDER=1 also lets a request wait before it reaches the backend (requests handled out of order).
      if (!REORDER || this.rng.chance(0.5)) applyNow();
      this.held.push({
        inst,
        label,
        land: () => {
          if (outcome) return;
          if (this.rng.chance(0.5)) applyNow();
          else outcome = { ok: false, err: new TypeError("aborted") };
        },
        run: () => {
          if (!outcome) {
            // a request of a page that closed meanwhile may never have reached the backend
            this.silent = !inst.alive;
            if (inst.alive || this.rng.chance(0.5)) applyNow();
            else outcome = { ok: false, err: new TypeError("aborted") };
            this.silent = false;
          }
          deliver();
        },
      });
    });
  }

  landLate() {
    for (const land of this.late.splice(0)) land();
  }

  // -- storage --

  localFor(tab: Tab, inst: Inst): KeyValueStorage {
    const tell = (key: string, oldValue: string | null, newValue: string | null) => {
      if (key !== RANKER_SAVED_KEY || oldValue === newValue) return;
      for (const other of this.tabs) {
        if (other === tab || !other.inst) continue;
        this.events.push({ to: other, inst: other.inst, deleted: newValue === null });
      }
    };
    return {
      getItem: (k) => this.local.get(k) ?? null,
      setItem: (k, v) => {
        if (!inst.alive) return;
        const old = this.local.get(k) ?? null;
        this.local.set(k, v);
        tell(k, old, v);
      },
      removeItem: (k) => {
        if (!inst.alive) return;
        const old = this.local.get(k) ?? null;
        this.local.delete(k);
        tell(k, old, null);
      },
    };
  }

  // -- tabs --

  makeInst(tab: Tab): Inst {
    return makeInst(this, tab);
  }

  mount(tab: Tab, link: string | null) {
    mountRanker(this, tab, link);
  }

  unmount(tab: Tab) {
    const inst = tab.inst;
    if (!inst?.mount) return;
    inst.mount.unsub();
    inst.mount = null;
  }

  openTab(): Tab {
    this.landLate();
    const tab: Tab = { id: this.tabs.length, session: new Map(), inst: null, lastEditOp: 0, toldOp: 0 };
    this.tabs.push(tab);
    tab.inst = this.makeInst(tab);
    this.mount(tab, null);
    return tab;
  }

  /** FUZZ_REORDER=live: the requests a page sent before it closed (or sent a keepalive) reach the backend first, or never. */
  landAll(inst: Inst) {
    if (REORDER_LIVE) for (const h of this.held) if (h.inst === inst) h.land?.();
  }

  close(tab: Tab) {
    const inst = tab.inst;
    if (!inst) return;
    inst.page?.hidden();
    inst.page?.unload();
    this.landAll(inst);
    inst.alive = false;
    inst.timers.clear();
    inst.deferred = [];
    inst.mount?.unsub();
    inst.unwatch();
    tab.inst = null;
  }

  // -- time --

  async settle() {
    for (let i = 0; i < 200; i++) {
      await new Promise<void>((r) => setImmediate(r));
      if (!this.events.length) {
        await new Promise<void>((r) => setImmediate(r));
        if (!this.events.length) {
          if (!this.late.length) return;
          this.landLate();
          continue;
        }
      }
      const evs = this.events.splice(0);
      for (const e of evs) {
        // a page in the back-forward cache (or gone) hears nothing
        if (process.env.FUZZ_TRACE) console.log(`      event to tab ${e.to.id} deleted=${e.deleted} frozen=${e.inst.frozen}`);
        if (e.to.inst !== e.inst || !e.inst.alive || e.inst.frozen) continue;
        if (e.deleted) {
          e.to.toldOp = ++this.op;
          e.inst.page?.deletedElsewhere();
        }
        else e.inst.page?.savedElsewhere();
      }
    }
  }

  nextTimer(limit: number): { inst: Inst; id: number; at: number } | null {
    let best: { inst: Inst; id: number; at: number } | null = null;
    for (const tab of this.tabs) {
      const inst = tab.inst;
      if (!inst || !inst.alive || inst.frozen) continue;
      for (const [id, t] of inst.timers) if (t.at <= limit && (!best || t.at < best.at)) best = { inst, id, at: t.at };
    }
    return best;
  }

  async fire(t: { inst: Inst; id: number; at: number }) {
    this.now = Math.max(this.now, t.at);
    const timer = t.inst.timers.get(t.id)!;
    t.inst.timers.delete(t.id);
    timer.fn();
    await this.settle();
  }

  async advance(ms: number) {
    const target = this.now + ms;
    for (let n = 0; n < 1000; n++) {
      const t = this.nextTimer(target);
      if (!t) break;
      await this.fire(t);
    }
    this.now = target;
    await this.settle();
  }

  async release(i: number) {
    if (!this.held.length) return;
    const [h] = this.held.splice(i % this.held.length, 1);
    h.run();
    await this.settle();
  }

  async thaw(tab: Tab, repliesFirst: boolean) {
    const inst = tab.inst;
    if (!inst?.frozen) return;
    this.landLate();
    inst.frozen = false;
    const replies = () => {
      const d = inst.deferred.splice(0);
      for (const fn of d) fn();
    };
    if (repliesFirst) {
      replies();
      await this.settle();
      inst.page?.restored();
    } else {
      inst.page?.restored();
      replies();
    }
    await this.settle();
  }

  /** Everything settles: the network and the backend fine, every reply in, every page shown, every timer run out. */
  async quiesce(): Promise<boolean> {
    const wasDown = this.netDown;
    this.netDown = false;
    this.mode = "ok";
    this.hold = false;
    for (const tab of this.tabs) if (tab.inst?.frozen) await this.thaw(tab, this.rng.chance(0.5));
    if (wasDown) for (const tab of this.tabs) tab.inst?.page?.online();
    await this.settle();
    for (let n = 0; n < 300; n++) {
      while (this.held.length) await this.release(0);
      // "Try again" on a card that couldn't load (the visitor's only way on from there)
      let retried = false;
      for (const tab of this.tabs) {
        const s = tab.inst?.store.getSnapshot();
        if (!s?.started) continue;
        if (s.mine === "error") {
          void tab.inst!.store.loadMine();
          retried = true;
        }
        if (s.menus === "error") {
          void tab.inst!.store.loadMenus();
          retried = true;
        }
      }
      if (retried) {
        await this.settle();
        continue;
      }
      const t = this.nextTimer(Infinity);
      if (!t) {
        await this.settle();
        if (!this.held.length && !this.events.length && !this.nextTimer(Infinity)) return true;
        continue;
      }
      await this.fire(t);
    }
    this.fail("I5", "timers (or replies) never ran out: the store keeps itself busy");
    return false;
  }
}

/** Storage that throws on every call (blocked site data, a full quota). */
function throwing(): KeyValueStorage {
  const no = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: no, setItem: no, removeItem: no };
}

/** One page load of a tab: a store wired to the world's backend, storage, clock and page events. */
function makeInst(w: World, tab: Tab): Inst {
  const inst: Inst = {
    store: null as unknown as RankerStore,
    page: null,
    timers: new Map(),
    alive: true,
    frozen: false,
    deferred: [],
    outstanding: 0,
    mount: null,
    taken: new Set(),
    unwatch: () => undefined,
  };
  const mode = () => w.mode;
  inst.store = createRankerStore({
    loadMenus: () => (w.netDown ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(MENUS)),
    api: {
      save(voter, items) {
        const sent = { op: ++w.op, editOp: tab.lastEditOp, toldOp: tab.toldOp, tab: tab.id };
        if (inst.outstanding > 0) w.fail("I2", `tab ${tab.id} sent a second save while one was on its way`);
        if (items.length < 3) w.fail("I2", `tab ${tab.id} sent a save of ${items.length} burgers`);
        const list = [...items];
        // checked once the store has recorded what it sends (its snapshot is emitted right after the call)
        queueMicrotask(() => {
          const saved = inst.store.getSnapshot().saved;
          if (saved && saved.status === "active" && sameList(saved.items, list)) w.fail("I2", `tab ${tab.id} sent the list it knows is saved: ${list.join(",")}`);
        });
        inst.outstanding += 1;
        const m = mode();
        const p = w.call<SaveReply>(inst, `save ${tab.id} ${list.join(",")}`, () => {
          if (m === "ok") return { ok: true, value: w.applySave(voter, list, sent, `tab ${tab.id}'s save`) };
          if (m === "lost" || (m === "unknown" && w.rng.chance(0.5))) w.applySave(voter, list, sent, `tab ${tab.id}'s save (reply lost)`);
          return { ok: false, err: w.refusal(m) };
        });
        return p.finally(() => {
          inst.outstanding -= 1;
        });
      },
      get(voter) {
        if (process.env.FUZZ_TRACE) console.log(`      get from tab ${tab.id} netDown=${w.netDown}`);
        const m = mode();
        return w.call<SavedRanking | null>(inst, `get ${tab.id}`, () => {
          // a read that never got its answer (network, lost) or got an odd one (unknown, half the time)
          if (m === "network" || m === "lost" || (m === "unknown" && w.rng.chance(0.5))) return { ok: false, err: w.refusal(m) };
          const row = w.rows.get(voter);
          if (row?.status === "deleted") w.onDeliver = () => void (tab.toldOp = ++w.op);
          return {
            ok: true,
            value: row ? { items: [...row.items], status: row.status, savedOn: row.savedOn, countsFrom: row.status === "active" ? "2026-09-28" : null, inBoard: false } : null,
          };
        });
      },
      del(voter) {
        const m = mode();
        const sentOp = ++w.op;
        return w.call<boolean>(inst, `del ${tab.id}`, () => {
          // a delete that never reached the backend; one whose reply was lost; an odd reply (it went through half the time)
          if (m === "network") return { ok: false, err: w.refusal(m) };
          if (m === "unknown") {
            if (w.rng.chance(0.5)) w.applyDelete(voter, tab.id, sentOp);
            return { ok: false, err: w.refusal(m) };
          }
          const done = w.applyDelete(voter, tab.id, sentOp);
          return m === "lost" ? { ok: false, err: new TypeError("Failed to fetch") } : { ok: true, value: done };
        });
      },
      // A keepalive request lands (or not: the network down, a refusal) before the page could come back.
      saveOnUnload(voter, items) {
        const sent = { op: ++w.op, editOp: tab.lastEditOp, toldOp: tab.toldOp, tab: tab.id };
        if (w.netDown) return;
        w.landAll(inst);
        const m = mode();
        const list = [...items];
        const land = () => {
          w.silent = true;
          if (m === "ok" || m === "lost" || m === "unknown") w.applySave(voter, list, sent, `tab ${tab.id}'s keepalive`);
          w.silent = false;
        };
        // a keepalive request is slower than the other tabs' reads half the time (its stamp is written as it is sent)
        if (w.lateRng.chance(0.5)) w.late.push(land);
        else land();
      },
    },
    voter: { read: () => w.voter, get: () => (w.voter ??= "v1") },
    local: () => (w.storage === "throws" ? throwing() : w.localFor(tab, inst)),
    session: () =>
      w.storage === "noSession"
        ? null
        : w.storage === "throws"
          ? throwing()
          : {
              getItem: (k) => tab.session.get(k) ?? null,
              setItem: (k, v) => void (inst.alive && tab.session.set(k, v)),
              removeItem: (k) => void (inst.alive && tab.session.delete(k)),
            },
    timers: {
      set: (fn, ms) => {
        const id = ++w.timerId;
        inst.timers.set(id, { at: w.now + ms, fn });
        return id;
      },
      clear: (h) => void inst.timers.delete(h as number),
    },
    now: () => w.now,
    watchPage: (on) => void (inst.page = on),
  });
  // A link's add that went on the list is a change of the visitor's (I3).
  let lastLink: RankerSnapshot["linkAdd"] = null;
  inst.unwatch = inst.store.subscribe(() => {
    const s = inst.store.getSnapshot();
    if (s.linkAdd !== lastLink) {
      lastLink = s.linkAdd;
      if (s.linkAdd?.kind === "added") tab.lastEditOp = ++w.op;
    }
  });
  return inst;
}

/** The ranker mounting (the store starts once), with its analytics listener (I6). */
function mountRanker(w: World, tab: Tab, link: string | null) {
  const inst = tab.inst!;
  if (inst.mount) return;
  const m = { tracked: false, unsub: () => undefined as void };
  // the ranker's analytics effect: each save handed out once; the first one of this mount is ranking_saved
  const onStore = () => {
    const s = inst.store.getSnapshot();
    const done = inst.store.takeSave();
    if (!done) return;
    if (inst.taken.has(done.seq)) w.fail("I6", `tab ${tab.id} was handed save #${done.seq} twice`);
    inst.taken.add(done.seq);
    if (!s.saved) return;
    m.tracked = true;
  };
  inst.mount = m;
  inst.store.start();
  if (link !== null) inst.store.addFromLink(link);
  onStore();
  m.unsub = inst.store.subscribe(onStore);
}

// ---- the status line, as the ranker shows it --------------------------------------------------------------------

function statusLine(s: RankerSnapshot): { text: string; alert: boolean } {
  if (s.busy === "deleting") return { text: "Deleting your list…", alert: false };
  if (s.failure?.action === "delete") return { text: RANKER_ERROR_COPY[s.failure.kind], alert: true };
  return autosaveLine(
    {
      length: s.draft.length,
      saved: s.saved,
      dirty: s.dirty,
      saving: s.saving,
      failure: s.failure?.action === "save" ? s.failure : null,
      problem: s.problem,
      deleted: s.notice === "deleted" || s.notice === "deleted_elsewhere",
      menusFailed: s.menus === "error",
      checkRetrying: s.checkRetrying,
    },
    TODAY,
  );
}

// ---- running a sequence ----------------------------------------------------------------------------------------

/** What the visitor can do: the card is on the page (mounted, shown, loaded far enough to show the list). */
function usable(tab: Tab | undefined): Inst | null {
  const inst = tab?.inst;
  if (!inst || !inst.alive || inst.frozen || !inst.mount) return null;
  const s = inst.store.getSnapshot();
  if (!s.started || (s.mine !== "none" && s.mine !== "ready")) return null;
  return inst;
}

function describe(step: Step): string {
  return JSON.stringify(step);
}

async function runSteps(seed: number, start: Start, steps: readonly Step[], log = false): Promise<Violation[]> {
  const w = new World(seed);
  w.op = 2;
  if (start.voter) w.voter = "v1";
  w.storage = start.twoTabs ? undefined : start.storage;
  if (start.row !== "none") w.rows.set("v1", { items: [...start.items], status: start.row, savedOn: "2026-09-20", deletedOp: start.row === "deleted" ? 1 : 0, deletedBy: -1, delSentOp: 0 });
  if (start.flag) w.local.set(RANKER_SAVED_KEY, "x");
  const first: Tab = { id: 0, session: new Map(), inst: null, lastEditOp: 0, toldOp: 0 };
  if (start.draft) {
    // an unsaved list from earlier in this tab's session: a change made after any delete before the start
    first.session.set(RANKER_DRAFT_KEY, JSON.stringify({ items: start.draft }));
    first.lastEditOp = 2;
  }
  w.tabs.push(first);
  first.inst = w.makeInst(first);
  w.mount(first, null);
  if (start.twoTabs) w.openTab();
  await w.settle();

  const pending: Promise<unknown>[] = [];
  const edit = (tab: Tab, inst: Inst, fn: () => void) => {
    const before = inst.store.getSnapshot().draft;
    fn();
    if (!sameList(before, inst.store.getSnapshot().draft)) tab.lastEditOp = ++w.op;
  };

  try {
    for (let i = 0; i < steps.length; i++) {
      w.stepNo = i;
      const step = steps[i];
      if (log) console.log(i, describe(step));
      const tab = "tab" in step ? w.tabs[step.tab] : undefined;
      const inst = usable(tab);
      switch (step.t) {
        case "add": {
          if (!inst) break;
          const s = inst.store.getSnapshot();
          if (s.menus !== "ready" || s.busy || s.draft.length >= 25) break;
          edit(tab!, inst, () => inst.store.add(KEYS[step.k]));
          break;
        }
        case "remove":
        case "move":
        case "moveTo": {
          if (!inst) break;
          const s = inst.store.getSnapshot();
          if (s.busy || !s.draft.length) break;
          const key = s.draft[step.i % s.draft.length];
          edit(tab!, inst, () => {
            if (step.t === "remove") inst.store.remove(key);
            else if (step.t === "move") inst.store.move(key, step.d);
            else inst.store.moveTo(key, step.j % s.draft.length);
          });
          break;
        }
        case "time":
          await w.advance(step.ms);
          break;
        case "net":
          if (w.netDown && !step.down) {
            w.netDown = false;
            for (const t of w.tabs) if (t.inst && !t.inst.frozen) t.inst.page?.online();
          } else w.netDown = step.down;
          break;
        case "mode":
          w.mode = step.m;
          break;
        case "hold":
          w.hold = step.on;
          break;
        case "release":
          await w.release(step.i);
          break;
        case "releaseAll": {
          const order = step.rev ? [...w.held].reverse() : [...w.held];
          w.held = [];
          for (const h of order) {
            h.run();
            await w.settle();
          }
          break;
        }
        case "hidden":
          if (tab?.inst && !tab.inst.frozen) tab.inst.page?.hidden();
          break;
        case "freeze":
          if (tab?.inst && !tab.inst.frozen) {
            tab.inst.page?.hidden();
            tab.inst.page?.unload();
            tab.inst.frozen = true;
          }
          break;
        case "thaw":
          if (tab) await w.thaw(tab, step.repliesFirst);
          break;
        case "reload":
          if (tab?.inst) {
            w.close(tab);
            w.landLate();
            tab.inst = w.makeInst(tab);
            w.mount(tab, null);
          }
          break;
        case "askDelete": {
          if (!inst) break;
          const s = inst.store.getSnapshot();
          if (s.saved && s.saved.status !== "void" && !s.busy && !s.confirmDelete) inst.store.askDelete();
          break;
        }
        case "keep": {
          if (!inst) break;
          const s = inst.store.getSnapshot();
          if (s.confirmDelete && s.saved && !s.busy) inst.store.keepList();
          break;
        }
        case "confirmDelete": {
          if (!inst) break;
          const s = inst.store.getSnapshot();
          if (!s.confirmDelete || !s.saved || s.saved.status === "void" || s.busy) break;
          const t = tab!;
          const p = inst.store.deleteList().then((n) => {
            // I5: a delete that went through with nothing pending leaves no timer behind
            if (n !== null && inst.alive && t.inst === inst) {
              const after = inst.store.getSnapshot();
              if (after.draft.length < 3 && inst.timers.size) w.fail("I5", `tab ${t.id}: a timer left after a completed delete`);
            }
          });
          pending.push(p);
          await w.settle();
          break;
        }
        case "countAgain": {
          if (!inst) break;
          const s = inst.store.getSnapshot();
          const refused = s.failure?.action === "save" && !s.failure.retrying;
          const shown = s.saved?.status === "replaced" && !s.dirty && !s.saving && !s.problem && (!s.failure || refused) && !s.busy && !s.confirmDelete;
          if (!shown) break;
          tab!.lastEditOp = ++w.op;
          inst.store.countAgain();
          await w.settle();
          break;
        }
        case "other":
          w.applySave("other", ["h", "g", "f"], { op: ++w.op, editOp: 0, toldOp: 0, tab: -1 }, "the other browser");
          break;
        case "void": {
          // the owner voids the list (ranker_void): it stays void and never counts
          const row = w.rows.get("v1");
          if (row && (row.status === "active" || row.status === "replaced")) row.status = "void";
          break;
        }
        case "unmount":
          if (tab) w.unmount(tab);
          break;
        case "mount":
          if (tab?.inst && !tab.inst.frozen && !tab.inst.mount) {
            w.mount(tab, step.link === null ? null : step.link === KEYS.length ? GONE_KEY : KEYS[step.link]);
            await w.settle();
          }
          break;
        case "openTab":
          if (w.tabs.length < 2 && start.twoTabs) {
            w.openTab();
            await w.settle();
          }
          break;
        case "retryLoad":
          if (tab?.inst && !tab.inst.frozen && tab.inst.mount) {
            const s = tab.inst.store.getSnapshot();
            if (s.mine === "error") void tab.inst.store.loadMine();
            if (s.menus === "error") void tab.inst.store.loadMenus();
            await w.settle();
          }
          break;
        case "quiesce":
          if (await w.quiesce()) check(w, `settled at step ${i}`);
          break;
      }
      await w.settle();
      if (log) {
        for (const t of w.tabs) {
          const x = t.inst?.store.getSnapshot();
          if (!x) continue;
          const f = x.failure ? `${x.failure.action}:${x.failure.kind}${"retrying" in x.failure && x.failure.retrying ? "+retry" : ""}` : "-";
          console.log(`    tab ${t.id}${t.inst!.frozen ? " (frozen)" : ""}: [${x.draft.join(",")}] saved ${x.saved ? `[${x.saved.items.join(",")}] ${x.saved.status}` : "none"} saving ${x.saving} failure ${f} notice ${x.notice} timers ${[...t.inst!.timers.values()].map((q) => q.at - w.now).join("/")}`);
        }
        const row = w.rows.get("v1");
        console.log(`    backend ${row ? `[${row.items.join(",")}] ${row.status}` : "none"}; held ${w.held.map((h) => h.label).join(" | ")}`);
      }
      every(w);
      if (w.violations.length) return w.violations;
    }
    w.stepNo = steps.length;
    if (await w.quiesce()) check(w, "settled at the end");
    await Promise.race([Promise.all(pending), new Promise((r) => setImmediate(r))]);
  } catch (err) {
    w.fail("throw", `the store threw: ${(err as Error)?.stack ?? String(err)}`);
  }
  return w.violations;
}

/** After every step. */
function every(w: World) {
  for (const tab of w.tabs) {
    const inst = tab.inst;
    if (!inst) continue;
    const s = inst.store.getSnapshot();
    if (s.draft.length > 25 || new Set(s.draft).size !== s.draft.length) w.fail("list", `tab ${tab.id}: a broken list ${s.draft.join(",")}`);
  }
}

/** Once everything has settled (I1, I4, I5). */
function check(w: World, when: string) {
  const row = w.voter ? (w.rows.get(w.voter) ?? null) : null;
  const live = row && (row.status === "active" || row.status === "replaced" || row.status === "void") ? row : null;
  const alone = w.tabs.filter((t) => t.inst).length === 1;
  for (const tab of w.tabs) {
    const inst = tab.inst;
    if (!inst || !inst.store.getSnapshot().started) continue;
    const s = inst.store.getSnapshot();
    const line = statusLine(s);
    const where = `${when}, tab ${tab.id}${alone ? " (alone)" : ""}: card [${s.draft.join(",")}] saved ${s.saved ? `[${s.saved.items.join(",")}] ${s.saved.status}` : "none"}, backend ${row ? `[${row.items.join(",")}] ${row.status}` : "none"}, line "${line.text}"`;
    if (inst.timers.size) w.fail("I5", `${where}: timers left`);
    if (s.busy) w.fail("I4", `${where}: still busy`);
    if (s.mine === "loading" || s.menus !== "ready") w.fail("I4", `${where}: still loading (mine ${s.mine}, menus ${s.menus})`);
    if (s.saving || line.text === "Saving…" || line.text === "Deleting your list…") w.fail(alone ? "I1" : "I4", `${where}: says it is saving with nothing on its way`);
    if (s.failure?.action === "save" && s.failure.retrying) w.fail(alone ? "I1" : "I4", `${where}: says it will try again, with nothing waiting`);
    if (s.failure) continue; // a refusal or a failed delete, stated on the status line
    if (s.draft.length === 0 && !s.saved) {
      if (live && live.status !== "replaced") w.fail("I4", `${where}: an empty card while the backend holds a list`);
      continue;
    }
    if (s.draft.length < 3 || s.problem) continue; // "Add 1 more to save …": stated
    if (!s.saved || s.dirty) {
      w.fail(alone ? "I1" : "I4", `${where}: a list that differs from the saved one, with nothing on its way`);
      continue;
    }
    if (!live || !sameList(live.items, s.draft)) {
      w.fail(alone ? "I1" : "I4", `${where}: the card shows a saved list the backend doesn't hold`);
      continue;
    }
    if (s.saved.status === "void" && live.status !== "void") w.fail(alone ? "I1" : "I4", `${where}: "not counted" (void) for a list that isn't void`);
    if (s.saved.status === "replaced" && live.status === "active") w.fail(alone ? "I1" : "I4", `${where}: "not counted" for a list that counts`);
    if (s.saved.status === "active" && live.status === "replaced" && !w.otherSinceActive) w.fail(alone ? "I1" : "I4", `${where}: counted, but replaced`);
  }
}

// ---- the test ----------------------------------------------------------------------------------------------------

function sequence(seed: number): { start: Start; steps: Step[] } {
  const r = prng(seed);
  const start = genStart(r);
  return { start, steps: genSteps(r, start, 25 + r.int(40)) };
}

/** The shortest prefix, then each step dropped in turn, that still breaks the same invariant. */
async function minimize(seed: number, start: Start, steps: Step[], code: string): Promise<Step[]> {
  const fails = async (s: Step[]) => (await runSteps(seed, start, s)).some((v) => v.code === code);
  let cur = steps;
  for (let n = 1; n <= cur.length; n++) {
    if (await fails(cur.slice(0, n))) {
      cur = cur.slice(0, n);
      break;
    }
  }
  for (let i = cur.length - 1; i >= 0; i--) {
    const without = [...cur.slice(0, i), ...cur.slice(i + 1)];
    if (await fails(without)) cur = without;
  }
  return cur;
}

/**
 * Seeds that once broke an invariant, run with every range (they are found only past the default 3000): 14043 and 30497, a
 * change made just before "Delete my list" sent as a keepalive while the check after a lost delete reply waits; 19283, a
 * replaced list counted again whose reply was lost, never announced to the other tab.
 */
const REGRESSION_SEEDS = [14043, 19283, 30497];

const w0 = async (vs: Violation[]) => {
  if (vs.length) assert.fail(vs.map((v) => `${v.code} at step ${v.step}: ${v.msg}`).join("\n"));
};

const env = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== undefined && process.env[k] !== "" ? v : d;
};

test("fuzz: random visits, tabs, pages and network trouble never break the autosave's invariants", { timeout: 600_000 }, async () => {
  const one = process.env.FUZZ_SEED;
  if (process.env.FUZZ_STEPS) {
    // replay a given sequence: FUZZ_SEED=<seed> FUZZ_STEPS='[…]' (and FUZZ_BEGIN='{…}' for its start)
    const seed = Number(one ?? 1);
    const start = process.env.FUZZ_BEGIN ? (JSON.parse(process.env.FUZZ_BEGIN) as Start) : sequence(seed).start;
    const vs = await runSteps(seed, start, JSON.parse(process.env.FUZZ_STEPS) as Step[], true);
    await w0(vs);
    return;
  }
  const first = one ? Number(one) : env("FUZZ_START", 1);
  const count = one ? 1 : env("FUZZ_SEEDS", 3000);
  const found = new Map<string, { seed: number; v: Violation; steps: Step[]; start: Start }>();
  const t0 = performance.now();
  const seeds = new Set<number>(one ? [] : REGRESSION_SEEDS);
  for (let seed = first; seed < first + count; seed++) seeds.add(seed);
  for (const seed of seeds) {
    const { start, steps } = sequence(seed);
    const vs = await runSteps(seed, start, steps, Boolean(one));
    for (const v of vs) {
      const key = `${v.code}: ${v.msg.replace(/\[[^\]]*\]|tab \d|step \d+|"[^"]*"/g, "")}`;
      if (!found.has(key)) found.set(key, { seed, v, steps, start });
    }
  }
  if (process.env.FUZZ_TIME) console.log(`sequences: ${Math.round(performance.now() - t0)} ms wall, ${Math.round(process.cpuUsage().user / 1000)} ms cpu`);
  if (!found.size) return;
  const report: string[] = [];
  for (const { seed, v, steps, start } of found.values()) {
    const min = await minimize(seed, start, steps, v.code);
    const again = await runSteps(seed, start, min);
    const shown = again.find((x) => x.code === v.code) ?? v;
    report.push(`seed ${seed} ${v.code}: ${shown.msg}\n  start ${JSON.stringify(start)}\n  steps ${min.map(describe).join("\n        ")}`);
  }
  assert.fail(`${found.size} invariant violation(s):\n${report.join("\n\n")}`);
});
