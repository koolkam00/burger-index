import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { siteUrlWarning } from "./src/lib/site-url";

// Fully static: `next build` writes the whole site to out/ (no server code, no API keys).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default function config(phase: string): NextConfig {
  // A build without a public origin writes http://localhost:4173 into canonicals, the sitemap and
  // the rest (src/lib/site-url.ts): say so, loudly, instead of claiming a domain. Only for
  // `next build` (`next typegen` loads this file in the same phase), and once: the build loads it
  // more than once and its workers inherit the environment, which marks the warning as shown.
  if (phase === PHASE_PRODUCTION_BUILD && process.argv.includes("build") && !process.env.BURGER_INDEX_SITE_URL_WARNED) {
    const warning = siteUrlWarning(process.env);
    if (warning) console.warn(`\n${warning}\n`);
    process.env.BURGER_INDEX_SITE_URL_WARNED = "1";
  }
  return nextConfig;
}
