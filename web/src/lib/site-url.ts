// The site's canonical origin, resolved at build time. Pure (no Next or Node imports), so next.config.ts,
// the metadata helpers and the tests share one rule.

/** Where `npm run preview` serves out/. A build that knows no public origin uses it, so it never claims someone else's domain. */
export const LOCAL_SITE_URL = "http://localhost:4173";

export type SiteUrlSource = "NEXT_PUBLIC_SITE_URL" | "VERCEL_PROJECT_PRODUCTION_URL" | "local";

type Env = Record<string, string | undefined>;

/**
 * NEXT_PUBLIC_SITE_URL (a full origin, e.g. a custom domain), else Vercel's production host
 * (VERCEL_PROJECT_PRODUCTION_URL, a bare host name such as `burger-index.vercel.app`), else the local
 * preview origin. Trailing slashes are dropped; a bare host gets https://.
 */
export function resolveSiteUrl(env: Env): { url: string; source: SiteUrlSource } {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return { url: withScheme(explicit), source: "NEXT_PUBLIC_SITE_URL" };
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return { url: withScheme(vercel), source: "VERCEL_PROJECT_PRODUCTION_URL" };
  return { url: LOCAL_SITE_URL, source: "local" };
}

function withScheme(value: string): string {
  const bare = value.replace(/\/+$/, "");
  return /^https?:\/\//i.test(bare) ? bare : `https://${bare}`;
}

/** The build warning for a build that knows no public origin (null when one is set). */
export function siteUrlWarning(env: Env): string | null {
  if (resolveSiteUrl(env).source !== "local") return null;
  return (
    `⚠ Neither NEXT_PUBLIC_SITE_URL nor VERCEL_PROJECT_PRODUCTION_URL is set: canonical URLs, the sitemap, robots.txt, ` +
    `llms.txt, JSON-LD and the CSV's page_url point at ${LOCAL_SITE_URL}. Fine for a local check; set one of them for a public build.`
  );
}
