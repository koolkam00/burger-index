import type { MetadataRoute } from "next";
import { BOROUGH_META } from "@/lib/boroughs";
import { getGeneratedAt, getNeighborhoodPages, getPricedRestaurants } from "@/lib/data";
import { absoluteUrl } from "@/lib/metadata";
import { rankingPath, rankingSpecs } from "@/lib/rankings";

export const dynamic = "force-static";

/** Every page the export writes: priced restaurants, neighborhoods with a priced restaurant and the ranking pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(getGeneratedAt());
  const pages = ["/", "/burgers", "/peoples-price", "/map", "/neighborhoods"];
  return [
    ...pages.map((p) => ({ url: absoluteUrl(p), lastModified, changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.8 })),
    ...BOROUGH_META.map((b) => ({ url: absoluteUrl(`/boroughs/${b.slug}`), lastModified, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...rankingSpecs(getPricedRestaurants()).map((s) => ({ url: absoluteUrl(rankingPath(s)), lastModified, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...getNeighborhoodPages().map((n) => ({ url: absoluteUrl(`/neighborhoods/${n.slug}`), lastModified, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...getPricedRestaurants().map((r) => ({ url: absoluteUrl(`/restaurants/${r.id}`), lastModified, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
