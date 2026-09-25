// Browser-only calls to the "What's it worth?" backend (supabase/README.md): cast_worth, my_worth,
// the public burger_worth_hist histograms and their realtime feed. @supabase/supabase-js is imported
// lazily, on the first call, so it lands in its own chunk and only pages that mount a worth component
// (a restaurant page's picker, the People's Price board) load it.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, WORTH_ENABLED } from "./worth-config";
import { classifyWorthError, isMenuKey, isValidAnswer, parseHistRow, type HistRow, type WorthErrorKind } from "./worth";

export class WorthError extends Error {
  readonly kind: WorthErrorKind;
  constructor(kind: WorthErrorKind, cause?: unknown) {
    super(kind, cause === undefined ? undefined : { cause });
    this.name = "WorthError";
    this.kind = kind;
  }
}

let clientPromise: Promise<SupabaseClient> | null = null;

function getClient(): Promise<SupabaseClient> {
  if (!WORTH_ENABLED || typeof window === "undefined") return Promise.reject(new WorthError("disabled"));
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      // No sign-in: nothing to persist, refresh or read from the URL (and no auth keys in storage).
      createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
    );
    clientPromise.catch(() => {
      clientPromise = null; // the chunk failed to load (offline?): try again next time
    });
  }
  return clientPromise.catch((err) => {
    throw new WorthError("network", err);
  });
}

function fail(err: unknown): never {
  throw err instanceof WorthError ? err : new WorthError(classifyWorthError(err), err);
}

/** cast_worth's reply: the menu's answer count and median after the answer. */
export type CastReply = { menu_key: string; votes: number; median: number | null };

function parseCastReply(v: unknown): CastReply | null {
  if (!v || typeof v !== "object") return null;
  const { menu_key, votes, median } = v as Record<string, unknown>;
  if (!isMenuKey(menu_key)) return null;
  const n = typeof votes === "string" ? Number(votes) : votes; // bigint may arrive as a string
  const m = typeof median === "string" ? Number(median) : median; // numeric may arrive as a string
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
  return { menu_key, votes: n, median: typeof m === "number" && Number.isFinite(m) ? m : null };
}

/** Save (or change) this browser's answer for a menu, in whole dollars. */
export async function castWorth(menuKey: string, voter: string, dollars: number): Promise<CastReply | null> {
  if (!isMenuKey(menuKey) || !isValidAnswer(dollars)) throw new WorthError("invalid");
  const client = await getClient();
  try {
    const { data, error } = await client.rpc("cast_worth", { p_menu_key: menuKey, p_voter: voter, p_dollars: dollars });
    if (error) fail(error);
    return parseCastReply(Array.isArray(data) ? data[0] : data);
  } catch (err) {
    fail(err);
  }
}

/** This browser's own answers, by menu key. */
export async function fetchMyWorth(voter: string): Promise<Map<string, number>> {
  const client = await getClient();
  try {
    const { data, error } = await client.rpc("my_worth", { p_voter: voter });
    if (error) fail(error);
    const out = new Map<string, number>();
    for (const row of Array.isArray(data) ? (data as Array<{ menu_key?: unknown; dollars?: unknown }>) : []) {
      if (isMenuKey(row.menu_key) && isValidAnswer(row.dollars)) out.set(row.menu_key, row.dollars);
    }
    return out;
  } catch (err) {
    fail(err);
  }
}

const PAGE = 1000;
/**
 * Menu keys per request when loading given menus: keeps the URL short, and bounds each request (100
 * menus × 71 whole-dollar answers at most), whatever else the table holds.
 */
const KEY_BATCH = 100;

/** Every row for `scope` (null: the whole table), a page at a time. */
async function fetchHistPages(client: SupabaseClient, scope: readonly string[] | null): Promise<HistRow[]> {
  const out: HistRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client
      .from("burger_worth_hist")
      .select("menu_key,dollars,votes,updated_at")
      .order("menu_key")
      .order("dollars")
      .range(from, from + PAGE - 1);
    if (scope) q = q.in("menu_key", [...scope]);
    const { data, error } = await q;
    if (error) fail(error);
    const rows = Array.isArray(data) ? data : [];
    for (const r of rows) {
      const row = parseHistRow(r);
      if (row) out.push(row);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * The public histograms of `keys` (in batches of KEY_BATCH menus, fetched side by side), or with no
 * keys the whole table. The site always passes keys: the People's Price page passes every menu the
 * dataset knows, so rows for keys it doesn't know are never downloaded.
 */
export async function fetchHist(keys?: readonly string[]): Promise<HistRow[]> {
  const client = await getClient();
  try {
    if (!keys) return await fetchHistPages(client, null);
    const scope = [...new Set(keys.filter(isMenuKey))];
    const batches: string[][] = [];
    for (let i = 0; i < scope.length; i += KEY_BATCH) batches.push(scope.slice(i, i + KEY_BATCH));
    const parts = await Promise.all(batches.map((b) => fetchHistPages(client, b)));
    return parts.flat();
  } catch (err) {
    fail(err);
  }
}

export type HistFeed = {
  onUpsert: (row: HistRow) => void;
  onDelete: (menuKey: string, dollars: number) => void;
  /** "live" once the channel is subscribed; "down" when it errors, times out or closes. */
  onStatus: (status: "live" | "down") => void;
};

let channelSeq = 0;

/**
 * Subscribe to changes in burger_worth_hist. Returns the unsubscribe function. The feed carries every
 * menu's changes (deletes can't be filtered on the server), so callers drop keys they don't know.
 */
export function watchHist(feed: HistFeed): () => void {
  let closed = false;
  let client: SupabaseClient | null = null;
  let channel: RealtimeChannel | null = null;
  getClient().then(
    (c) => {
      if (closed) return;
      client = c;
      channelSeq += 1;
      channel = c
        .channel(`burger-worth-${channelSeq}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "burger_worth_hist" }, (payload) => {
          if (closed) return;
          if (payload.eventType === "DELETE") {
            // A delete carries the primary key only (menu_key, dollars).
            const old = (payload.old ?? {}) as { menu_key?: unknown; dollars?: unknown };
            if (isMenuKey(old.menu_key) && isValidAnswer(old.dollars)) feed.onDelete(old.menu_key, old.dollars);
            return;
          }
          const row = parseHistRow(payload.new);
          if (!row) return;
          if (row.votes > 0) feed.onUpsert(row);
          else feed.onDelete(row.menu_key, row.dollars);
        })
        .subscribe((status) => {
          if (closed) return;
          feed.onStatus(status === "SUBSCRIBED" ? "live" : "down");
        });
    },
    () => {
      if (!closed) feed.onStatus("down");
    },
  );
  return () => {
    closed = true;
    if (client && channel) void client.removeChannel(channel);
    channel = null;
  };
}
