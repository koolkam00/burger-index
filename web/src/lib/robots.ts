// robots.txt rules (user decision 2026-09-25): every crawler is welcome, AI search and training bots
// included; only the analytics proxy (/ingest/, web/vercel.json) is off limits. The AI bots get their
// own group so the welcome is explicit: a bot that finds its name reads only that group, which is why
// it repeats the same Allow and Disallow.
import type { MetadataRoute } from "next";

/** The analytics proxy path: PostHog rewrites, nothing to index. */
export const DISALLOWED_PATHS = ["/ingest/"] as const;

/** AI search and assistant fetchers, then training crawlers, named so they know they're allowed. */
export const AI_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
] as const;

export function robotsConfig(site: string): MetadataRoute.Robots {
  const rule = { allow: "/", disallow: [...DISALLOWED_PATHS] };
  return {
    rules: [
      { userAgent: "*", ...rule },
      { userAgent: [...AI_CRAWLERS], ...rule },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
