// Supabase settings for the burger ranker (supabase/README.md). Both are public by design: the
// publishable key can only call save_ranking / get_my_ranking / delete_ranking and read the ranker's
// public aggregates. Next inlines NEXT_PUBLIC_* at build time, so they must be read as literal
// `process.env.NEXT_PUBLIC_…` expressions. Without them the site still builds and the ranker says lists
// open soon.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

export const RANKER_ENABLED = /^https?:\/\/\S+$/.test(SUPABASE_URL) && SUPABASE_KEY.length > 0;
