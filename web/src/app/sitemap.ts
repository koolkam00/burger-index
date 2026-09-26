import type { MetadataRoute } from "next";
import { BADGE_PAGE_PATH } from "@/lib/badge";
import { BEST_BURGERS_PATH } from "@/lib/best-burgers";
import { BOROUGH_META } from "@/lib/boroughs";
import { getGeneratedAt, getNeighborhoodPages, getPricedRestaurants } from "@/lib/data";
import { absoluteUrl } from "@/lib/metadata";
import { getPeoplesTopStamp } from "@/lib/peoples-top-data";
import { PRESS_PATH } from "@/lib/press";
import { rankingPath, rankingSpecs } from "@/lib/rankings";
import { PEOPLES_TOP_PATH } from "@/lib/site";

export const dynamic = "force-static";

/**
 * Every page the export writes (never the share images or the badges, which are files, not pages): priced restaurants,
 * neighborhoods with a priced restaurant, the ranking pages (NYC, boroughs, neighborhoods with their own lists, burger
 * styles), the most-recommended burgers and the People's Top 10. The pages whose static HTML changes with the daily
 * People's Top 10 board (the board itself, and /best-burgers with each row's People's rank) carry the board's date
 * when it is the later one.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(getGeneratedAt());
  const stamp = getPeoplesTopStamp();
  const crowd = stamp && new Date(stamp) > lastModified ? new Date(stamp) : lastModified;
  const pages = ["/", "/burgers", "/map", "/neighborhoods", PRESS_PATH, BADGE_PAGE_PATH];
  return [
    ...pages.map((p) => ({ url: absoluteUrl(p), lastModified, changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.8 })),
    { url: absoluteUrl(BEST_BURGERS_PATH), lastModified: crowd, changeFrequency: "weekly" as const, priority: 0.8 },
    { url: absoluteUrl(PEOPLES_TOP_PATH), lastModified: crowd, changeFrequency: "daily" as const, priority: 0.8 },
    ...BOROUGH_META.map((b) => ({ url: absoluteUrl(`/boroughs/${b.slug}`), lastModified, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...rankingSpecs(getPricedRestaurants()).map((s) => ({ url: absoluteUrl(rankingPath(s)), lastModified, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...getNeighborhoodPages().map((n) => ({ url: absoluteUrl(`/neighborhoods/${n.slug}`), lastModified, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...getPricedRestaurants().map((r) => ({ url: absoluteUrl(`/restaurants/${r.id}`), lastModified, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
