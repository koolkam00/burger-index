// Page metadata helpers (server side: resolved at build time).
import type { Metadata } from "next";
import { TITLE_MAX } from "./seo";
import { SITE_NAME } from "./site";
import { resolveSiteUrl } from "./site-url";

/**
 * Canonical origin: NEXT_PUBLIC_SITE_URL, else Vercel's production URL, else the local preview origin
 * (http://localhost:4173; next.config.ts warns when a production build falls back to it).
 */
export const SITE_URL = resolveSiteUrl(process.env).url;

export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "The Burger Index: the NYC median burger price on a yellow order board hanging over the water",
};

/**
 * Origin + path, no trailing slash. The home page is the bare origin, as Next writes its canonical
 * (`alternates.canonical: "/"` → `https://example.com`), so the sitemap, canonicals and JSON-LD agree.
 */
export function absoluteUrl(path: string, site: string = SITE_URL): string {
  return path === "/" || path === "" ? site : `${site}${path.startsWith("/") ? path : `/${path}`}`;
}

const SUFFIX = ` · ${SITE_NAME}`;

/** "`title` · The Burger Index" when that fits in TITLE_MAX characters, else `title` alone. */
export function fullTitle(title: string): string {
  return title.includes(SITE_NAME) || title.length + SUFFIX.length > TITLE_MAX ? title : `${title}${SUFFIX}`;
}

/**
 * Title, description, canonical and social tags for one page. The title is final (absolute): the
 * suffix is added here only when it fits, so the layout's template never pushes it past TITLE_MAX.
 */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const full = fullTitle(title);
  return {
    title: { absolute: full },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title: full,
      description,
      url: path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: full,
      description,
      images: [OG_IMAGE.url],
    },
  };
}
