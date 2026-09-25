// Browser-only calls to the vote backend (supabase/README.md): cast_vote, my_votes, the public
// burger_scores totals and their realtime feed. @supabase/supabase-js is imported lazily, on the
// first call, so it lands in its own chunk and only pages that mount a vote component load it.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, VOTING_ENABLED } from "./vote-config";
import { classifyVoteError, isMenuKey, isValidScore, parseScoreRow, type ScoreRow, type VoteErrorKind } from "./votes";

export class VoteError extends Error {
  readonly kind: VoteErrorKind;
  constructor(kind: VoteErrorKind, cause?: unknown) {
    super(kind, cause === undefined ? undefined : { cause });
    this.name = "VoteError";
    this.kind = kind;
  }
}

let clientPromise: Promise<SupabaseClient> | null = null;

function getClient(): Promise<SupabaseClient> {
  if (!VOTING_ENABLED || typeof window === "undefined") return Promise.reject(new VoteError("disabled"));
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
    throw new VoteError("network", err);
  });
}

function fail(err: unknown): never {
  throw err instanceof VoteError ? err : new VoteError(classifyVoteError(err), err);
}

/** Save (or change) this voter's score for a menu. Returns the menu's new totals. */
export async function castVote(menuKey: string, voter: string, score: number): Promise<ScoreRow | null> {
  if (!isMenuKey(menuKey) || !isValidScore(score)) throw new VoteError("invalid");
  const client = await getClient();
  try {
    const { data, error } = await client.rpc("cast_vote", { p_menu_key: menuKey, p_voter: voter, p_score: score });
    if (error) fail(error);
    return parseScoreRow(Array.isArray(data) ? data[0] : data);
  } catch (err) {
    fail(err);
  }
}

/** This voter's own scores, by menu key. */
export async function fetchMyVotes(voter: string): Promise<Map<string, number>> {
  const client = await getClient();
  try {
    const { data, error } = await client.rpc("my_votes", { p_voter: voter });
    if (error) fail(error);
    const out = new Map<string, number>();
    for (const row of Array.isArray(data) ? (data as Array<{ menu_key?: unknown; score?: unknown }>) : []) {
      if (isMenuKey(row.menu_key) && isValidScore(row.score)) out.set(row.menu_key, row.score);
    }
    return out;
  } catch (err) {
    fail(err);
  }
}

const PAGE = 1000;

/** Public totals: every menu's, or only `keys`. */
export async function fetchScores(keys?: readonly string[]): Promise<ScoreRow[]> {
  const client = await getClient();
  const out: ScoreRow[] = [];
  try {
    for (let from = 0; ; from += PAGE) {
      let q = client.from("burger_scores").select("menu_key,votes,total,updated_at").order("menu_key").range(from, from + PAGE - 1);
      if (keys) q = q.in("menu_key", keys.filter(isMenuKey));
      const { data, error } = await q;
      if (error) fail(error);
      const rows = Array.isArray(data) ? data : [];
      for (const r of rows) {
        const row = parseScoreRow(r);
        if (row) out.push(row);
      }
      if (rows.length < PAGE) break;
    }
  } catch (err) {
    fail(err);
  }
  return out;
}

export type ScoreFeed = {
  onUpsert: (row: ScoreRow) => void;
  onDelete: (menuKey: string) => void;
  /** "live" once the channel is subscribed; "down" when it errors, times out or closes. */
  onStatus: (status: "live" | "down") => void;
};

let channelSeq = 0;

/** Subscribe to changes in burger_scores. Returns the unsubscribe function. */
export function watchScores(feed: ScoreFeed): () => void {
  let closed = false;
  let client: SupabaseClient | null = null;
  let channel: RealtimeChannel | null = null;
  getClient().then(
    (c) => {
      if (closed) return;
      client = c;
      channelSeq += 1;
      channel = c
        .channel(`burger-scores-${channelSeq}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "burger_scores" }, (payload) => {
          if (closed) return;
          if (payload.eventType === "DELETE") {
            const key = (payload.old as { menu_key?: unknown } | null)?.menu_key;
            if (isMenuKey(key)) feed.onDelete(key);
            return;
          }
          const row = parseScoreRow(payload.new);
          if (row) feed.onUpsert(row);
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
