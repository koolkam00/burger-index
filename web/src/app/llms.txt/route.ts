import { BEST_BURGERS_NAME, BEST_BURGERS_PATH, leaders } from "@/lib/best-burgers";
import { getBestBurgers, getBestBurgersYears } from "@/lib/best-burgers-data";
import { getBoroughs, getGeneratedAt, getMenuCounts, getNeighborhoodPages, getPricedRestaurants, getStats, rankedNeighborhoods } from "@/lib/data";
import { CSV_LICENSE, CSV_PATH } from "@/lib/csv";
import { llmsTxt } from "@/lib/llms";
import { formatCount, formatDate, formatPrice, spreadEnds } from "@/lib/format";
import { menusByIndexPrice, menusByIndexPriceDesc, type Menu } from "@/lib/menus";
import { rankingName, rankingPath, rankingSpecs, rankMenus, type RankingSpec } from "@/lib/rankings";
import { SITE_URL } from "@/lib/metadata";
import { BEST_VALUE_MIN_GAP, BEST_VALUE_NAME, BEST_VALUE_PATH } from "@/lib/peoples-price";
import { getBestValue } from "@/lib/peoples-price-data";
import { sourceLine } from "@/lib/seo";

// Static export writes this to out/llms.txt (llmstxt.org): the headline numbers, the date and links.
export const dynamic = "force-static";

function end(m: Menu | undefined) {
  if (!m) return null;
  const r = m.restaurant;
  return { restaurant: r.name, burger: r.burger.name, price: m.indexPrice, where: [r.neighborhood, r.borough].filter(Boolean).join(", "), path: `/restaurants/${r.id}` };
}

/**
 * "the 25 cheapest of 531 menus by their priciest burger, from $6.00 at Johnny's Reef", "the 25 most
 * expensive of 531 menus, up to $75.00 at …", "96 burger spots, priciest burgers $6.00 to $14.99",
 * "45 burger spots whose priciest burger is a smash burger, $9.00 to $31.00" (menus count a chain once;
 * burger spots count its every location).
 */
function rankingNote(spec: RankingSpec, restaurants: Parameters<typeof rankMenus>[0]): string | undefined {
  const { rows, total, spots } = rankMenus(restaurants, spec);
  if (!rows.length) return undefined;
  const money = (v: number) => formatPrice(v, { cents: "always" });
  const first = rows[0];
  if (spec.kind === "under") return `${formatCount(spots)} burger spots, priciest burgers ${money(first.indexPrice)} to ${money(rows[rows.length - 1].indexPrice)}`;
  if (spec.kind === "style") return `${formatCount(spots)} burger spots whose priciest burger is ${spec.style!.aBurger}, ${money(first.indexPrice)} to ${money(rows[rows.length - 1].indexPrice)}`;
  if (spec.kind === "cheapest") return `the ${rows.length} cheapest of ${formatCount(total)} menus by their priciest burger, from ${money(first.indexPrice)} at ${first.restaurant.name}`;
  return `the ${rows.length} most expensive of ${formatCount(total)} menus, up to ${money(first.indexPrice)} at ${first.restaurant.name}`;
}

/** "96 places ranked by how many publications named them on a best-burger list in 2024–2026, …" */
function bestBurgersNote(): string {
  const entries = getBestBurgers();
  const years = getBestBurgersYears();
  const top = leaders(entries);
  const lead = top.length === 1 ? `; ${top[0].name} leads, named by ${top[0].publishers.length}` : "";
  return `${formatCount(entries.length)} places ranked by how many publications named them on a best-burger list in ${years.from}–${years.to}, with the menu price${lead}`;
}

/** "12 burgers whose People's Price (what visitors would pay) is 10% or more above the menu price, as of Sep 25, 2026; Emily leads: People's Price $31, menu price $24.00" */
function bestValueNote(): string | undefined {
  const bv = getBestValue();
  if (!bv) return undefined;
  const top = bv.rows[0];
  const lead = top && top.people !== null ? `; ${top.name} leads: People's Price $${formatCount(top.people)}, menu price ${formatPrice(top.price, { cents: "always" })}` : "";
  return `${formatCount(bv.rows.length)} ${bv.rows.length === 1 ? "burger" : "burgers"} whose People's Price (what visitors would pay) is ${BEST_VALUE_MIN_GAP}% or more above the menu price, as of ${formatDate(bv.asOf)}${lead}`;
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
    csvLicense: CSV_LICENSE,
    sections: [
      {
        title: "Rankings",
        links: [
          ...rankingSpecs(restaurants).map((spec) => ({ title: rankingName(spec), path: rankingPath(spec), note: rankingNote(spec, restaurants) })),
          { title: BEST_BURGERS_NAME, path: BEST_BURGERS_PATH, note: bestBurgersNote() },
          ...(getBestValue() ? [{ title: BEST_VALUE_NAME, path: BEST_VALUE_PATH, note: bestValueNote() }] : []),
        ],
      },
    ],
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
