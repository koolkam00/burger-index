import { getBoroughs, getGeneratedAt, getMenuCounts, getNeighborhoodPages, getPricedRestaurants, getStats, rankedNeighborhoods } from "@/lib/data";
import { CSV_PATH } from "@/lib/csv";
import { spreadEnds } from "@/lib/format";
import { llmsTxt } from "@/lib/llms";
import { menusByIndexPrice, menusByIndexPriceDesc, type Menu } from "@/lib/menus";
import { SITE_URL } from "@/lib/metadata";
import { sourceLine } from "@/lib/seo";

// Static export writes this to out/llms.txt (llmstxt.org): the headline numbers, the date and links.
export const dynamic = "force-static";

function end(m: Menu | undefined) {
  if (!m) return null;
  const r = m.restaurant;
  return { restaurant: r.name, burger: r.burger.name, price: m.indexPrice, where: [r.neighborhood, r.borough].filter(Boolean).join(", "), path: `/restaurants/${r.id}` };
}

export function GET() {
  const stats = getStats();
  const restaurants = getPricedRestaurants();
  const ranked = rankedNeighborhoods();
  const hoodEnds = spreadEnds(ranked, (n) => n.index_median);
  const body = llmsTxt({
    site: SITE_URL,
    generatedAt: getGeneratedAt(),
    sourceLine: sourceLine(getGeneratedAt()),
    median: stats.index_median,
    menus: getMenuCounts().menus,
    locations: stats.restaurants_priced,
    p10: stats.index_p10,
    p90: stats.index_p90,
    boroughs: getBoroughs().map((b) => ({ name: b.name, slug: b.slug, median: b.summary?.index_median ?? null, menus: b.menuCounts.menus })),
    cheapest: end(menusByIndexPrice(restaurants)[0]),
    priciest: end(menusByIndexPriceDesc(restaurants)[0]),
    neighborhoods: {
      pages: getNeighborhoodPages().length,
      ranked: ranked.length,
      top: hoodEnds ? { name: hoodEnds.top.name, price: hoodEnds.top.index_median as number, path: `/neighborhoods/${hoodEnds.top.slug}` } : null,
      bottom: hoodEnds ? { name: hoodEnds.bottom.name, price: hoodEnds.bottom.index_median as number, path: `/neighborhoods/${hoodEnds.bottom.slug}` } : null,
    },
    csvPath: CSV_PATH,
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
