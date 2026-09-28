// Browser-only calls to the ranker's backend (supabase/README.md): save_ranking, get_my_ranking and
// delete_ranking, the only three things the site's publishable key may call. @supabase/supabase-js is
// imported lazily, on the first call, so it lands in its own chunk and loads only when the ranker needs it:
// a returning browser's saved list on mount, else the first save. A save sent while the page closes is a plain keepalive
// fetch instead (saveRankingOnUnload): there's no time left to load the client.
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyRankerError, parseMyRanking, parseSaveReply, type RankerErrorKind, type SaveReply, type SavedRanking } from "./ranker";
import { RANKER_ENABLED, SUPABASE_KEY, SUPABASE_URL } from "./supabase-config";

export class RankerError extends Error {
  readonly kind: RankerErrorKind;
  constructor(kind: RankerErrorKind, cause?: unknown) {
    super(kind, cause === undefined ? undefined : { cause });
    this.name = "RankerError";
    this.kind = kind;
  }
}

let clientPromise: Promise<SupabaseClient> | null = null;

function getClient(): Promise<SupabaseClient> {
  if (!RANKER_ENABLED || typeof window === "undefined") return Promise.reject(new RankerError("disabled"));
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
    throw new RankerError("network", err);
  });
}

/** Call an RPC; a PostgREST error (with its HTTP status) or a failed fetch becomes a RankerError. */
async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await getClient();
  try {
    const { data, error, status } = await client.rpc(fn, args);
    if (error) throw new RankerError(classifyRankerError({ ...error, status }), error);
    return data;
  } catch (err) {
    throw err instanceof RankerError ? err : new RankerError(classifyRankerError(err), err);
  }
}

/** Save (or replace) this browser's list, best first. */
export async function saveRanking(voter: string, items: readonly string[]): Promise<SaveReply> {
  const reply = parseSaveReply(await rpc("save_ranking", { p_voter: voter, p_items: [...items] }));
  if (!reply) throw new RankerError("unknown");
  return reply;
}

/** This browser's saved list, or null when it has none. */
export async function getMyRanking(voter: string): Promise<SavedRanking | null> {
  return parseMyRanking(await rpc("get_my_ranking", { p_voter: voter }));
}

/** Withdraw this browser's list (true when there was one). */
export async function deleteRanking(voter: string): Promise<boolean> {
  return (await rpc("delete_ranking", { p_voter: voter })) === true;
}

/**
 * Send a save while the page closes (autosave's last pending list; DESIGN.md "The ranker hero"): a keepalive POST to the
 * same RPC, so the browser finishes it after the page is gone. Its reply is never read. The publishable key goes in the
 * `apikey` header only, as supabase-js sends it (a legacy anon JWT also as the bearer token).
 */
export function saveRankingOnUnload(voter: string, items: readonly string[]): void {
  if (!RANKER_ENABLED || typeof fetch !== "function") return;
  const headers: Record<string, string> = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (!SUPABASE_KEY.startsWith("sb_")) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  void fetch(`${SUPABASE_URL}/rest/v1/rpc/save_ranking`, {
    method: "POST",
    keepalive: true,
    headers,
    body: JSON.stringify({ p_voter: voter, p_items: [...items] }),
  }).catch(() => undefined);
}
