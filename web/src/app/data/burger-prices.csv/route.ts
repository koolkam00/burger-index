import { burgerPricesCsv } from "@/lib/csv";
import { getGeneratedAt, getPricedRestaurants } from "@/lib/data";
import { SITE_URL } from "@/lib/metadata";

// Static export writes this to out/data/burger-prices.csv: one row per priced restaurant location
// (user decision 2026-09-25; the columns are in lib/csv.ts). Linked once, from the footer.
export const dynamic = "force-static";

export function GET() {
  return new Response(burgerPricesCsv(getPricedRestaurants(), { site: SITE_URL, generatedAt: getGeneratedAt() }), {
    headers: { "Content-Type": "text/csv; charset=utf-8" },
  });
}
