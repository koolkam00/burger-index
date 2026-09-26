import { getPricedRestaurants } from "@/lib/data";
import { menuListData } from "@/lib/menu-list";

// Static export writes this to out/data/menus.json: every distinct priced menu (a chain once) with its priced
// locations, and the neighborhoods' names (lib/menu-list.ts). The home ranker fetches it when it mounts and
// the badge page's finder when it needs it, so the menus never sit in those pages' HTML. Not linked anywhere.
export const dynamic = "force-static";

export function GET() {
  return Response.json(menuListData(getPricedRestaurants()));
}
