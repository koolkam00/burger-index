import { getPricedRestaurants } from "@/lib/data";
import { pricerData } from "@/lib/pricer";

// Static export writes this to out/data/pricer.json: the home pricer's burgers (every distinct priced
// menu, a chain once, with its priced locations; lib/pricer.ts). The home page fetches it when the
// pricer mounts, so the menus and their prices never sit in the page's HTML. Not linked anywhere.
export const dynamic = "force-static";

export function GET() {
  return Response.json(pricerData(getPricedRestaurants()));
}
