import type { MetadataRoute } from "next";
import { BADGE_PAGE_PATH } from "@/lib/badge";
import { BEST_BURGERS_PATH } from "@/lib/best-burgers";
import { BOROUGH_META } from "@/lib/boroughs";
import { getGeneratedAt, getNeighborhoodPages, getPricedRestaurants } from "@/lib/data";
import { absoluteUrl } from "@/lib/metadata";
import { BEST_VALUE_PATH } from "@/lib/peoples-price";
import { getBestValue, getSnapshotAsOf } from "@/lib/peoples-price-data";
import { PRESS_PATH } from "@/lib/press";
import { rankingPath, rankingSpecs } from "@/lib/rankings";

export const dynamic = "force-static";

/**
 * Every page the export writes (never the share images or the badges, which are files, not pages): priced restaurants, neighborhoods with a priced restaurant, the ranking
 * pages (NYC, boroughs, neighborhoods with their own lists, burger styles), the most-recommended burgers and,
 * once it exists, the best value burgers (never before: lib/peoples-price bestValue). The People's Price
 * pages change with the daily snapshot, so they carry its date when it is the later one.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(getGeneratedAt());
  const asOf = getSnapshotAsOf();
  const crowd = asOf && new Date(asOf) > lastModified ? new Date(asOf) : lastModified;
  const pages = ["/", "/burgers", "/map", "/neighborhoods", BEST_BURGERS_PATH, PRESS_PATH, BADGE_PAGE_PATH];
  const crowdPages = ["/peoples-price", ...(getBestValue() ? [BEST_VALUE_PATH] : [])];
  return [
    ...pages.map((p) => ({ url: absoluteUrl(p), lastModified, changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.8 })),
    ...crowdPages.map((p) => ({ url: absoluteUrl(p), lastModified: crowd, changeFrequency: "daily" as const, priority: 0.8 })),
    ...BOROUGH_META.map((b) => ({ url: absoluteUrl(`/boroughs/${b.slug}`), lastModified, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...rankingSpecs(getPricedRestaurants()).map((s) => ({ url: absoluteUrl(rankingPath(s)), lastModified, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...getNeighborhoodPages().map((n) => ({ url: absoluteUrl(`/neighborhoods/${n.slug}`), lastModified, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...getPricedRestaurants().map((r) => ({ url: absoluteUrl(`/restaurants/${r.id}`), lastModified, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
