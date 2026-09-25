import { getBoroughs, getGeneratedAt, getMenuCounts, getNeighborhoodPages, getPricedRestaurants, getStats, rankedNeighborhoods } from "@/lib/data";
import { CSV_PATH } from "@/lib/csv";
import { llmsTxt } from "@/lib/llms";
import { formatCount, formatPrice, spreadEnds } from "@/lib/format";
import { menusByIndexPrice, menusByIndexPriceDesc, type Menu } from "@/lib/menus";
import { rankingName, rankingPath, rankingSpecs, rankMenus, type RankingSpec } from "@/lib/rankings";
import { SITE_URL } from "@/lib/metadata";
import { sourceLine } from "@/lib/seo";

// Static export writes this to out/llms.txt (llmstxt.org): the headline numbers, the date and links.
export const dynamic = "force-static";

function end(m: Menu | undefined) {
  if (!m) return null;
  const r = m.restaurant;
  return { restaurant: r.name, burger: r.burger.name, price: m.indexPrice, where: [r.neighborhood, r.borough].filter(Boolean).join(", "), path: `/restaurants/${r.id}` };
}

/** "the 25 cheapest of 532 different burgers, from $6.00 at Johnny's Reef", "90 different burgers, $6.00 to $14.99". */
function rankingNote(spec: RankingSpec, restaurants: Parameters<typeof rankMenus>[0]): string | undefined {
  const { rows, total } = rankMenus(restaurants, spec);
  if (!rows.length) return undefined;
  const money = (v: number) => formatPrice(v, { cents: "always" });
  const first = rows[0];
  if (spec.kind === "under") return `${formatCount(total)} different burgers, ${money(first.indexPrice)} to ${money(rows[rows.length - 1].indexPrice)}`;
  const which = spec.kind === "cheapest" ? "cheapest" : "most expensive";
  return `the ${rows.length} ${which} of ${formatCount(total)} different burgers, ${spec.kind === "cheapest" ? "from" : "up to"} ${money(first.indexPrice)} at ${first.restaurant.name}`;
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
    pins: restaurants.filter((r) => r.lat !== null && r.lng !== null).length,
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
    sections: [
      {
        title: "Rankings",
        links: rankingSpecs(restaurants).map((spec) => ({ title: rankingName(spec), path: rankingPath(spec), note: rankingNote(spec, restaurants) })),
      },
    ],
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
