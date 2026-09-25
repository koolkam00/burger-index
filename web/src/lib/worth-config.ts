// Supabase settings for "What's it worth?" (supabase/README.md). Both are public by design: the
// publishable key can only call cast_worth / my_worth and read burger_worth_hist. Next inlines
// NEXT_PUBLIC_* at build time, so they must be read as literal `process.env.NEXT_PUBLIC_…`
// expressions. Without them the site still builds and the worth UI says answers open soon.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

export const WORTH_ENABLED = /^https?:\/\/\S+$/.test(SUPABASE_URL) && SUPABASE_KEY.length > 0;
