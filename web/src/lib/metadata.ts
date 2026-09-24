// Page metadata helpers (server side: resolved at build time).
import type { Metadata } from "next";
import { SITE_NAME } from "./site";

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "https://burgerindex.nyc";
}

/** Canonical origin: NEXT_PUBLIC_SITE_URL, else Vercel's production URL, else burgerindex.nyc. */
export const SITE_URL = resolveSiteUrl();

export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "The Burger Index: the NYC median burger price on a yellow order board hanging over the water",
};

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === "/" ? "" : path}`;
}

export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title: `${title} · ${SITE_NAME}`,
      description,
      url: path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} · ${SITE_NAME}`,
      description,
      images: [OG_IMAGE.url],
    },
  };
}
