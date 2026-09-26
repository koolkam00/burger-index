// Server-only: every page's share card (lib/share-images.ts), built once per build worker from the
// dataset. The pages ask shareImage(path) for their og:image; app/og/[...path]/route.tsx draws each card
// to /og/<page path>.png. A page without a card (home, the map, the People's Price, …) keeps /og.png.
import "server-only";

import { BEST_BURGERS_NAME, BEST_BURGERS_PATH, BEST_BURGERS_TICKET, bestBurgersCountLine, namedByHeading } from "./best-burgers";
import { getBestBurgers } from "./best-burgers-data";
import { BOROUGH_META } from "./boroughs";
import { getBorough, getGeneratedAt, getNeighborhoodPages, getPricedRestaurants, getStats, neighborhoodMenuCounts } from "./data";
import { formatDate, pluralize } from "./format";
import { RANKING_TICKETS, rankingCountLine, rankingName, rankingPath, rankingSpecs, rankMenus } from "./rankings";
import { areaCard, listCard, restaurantCard, SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH, shareImagePath, type ShareCard } from "./share-images";

function build(): Map<string, ShareCard> {
  const cards = new Map<string, ShareCard>();
  const updated = formatDate(getGeneratedAt());
  const cityMedian = getStats().index_median;
  const restaurants = getPricedRestaurants();

  for (const r of restaurants) {
    cards.set(
      `/restaurants/${r.id}`,
      restaurantCard({ name: r.name, burger: r.burger.name, price: r.index_price, neighborhood: r.neighborhood, borough: r.borough, cityMedian, updated }),
    );
  }
  for (const n of getNeighborhoodPages()) {
    const menus = neighborhoodMenuCounts(n.slug).menus;
    cards.set(`/neighborhoods/${n.slug}`, areaCard({ kind: "neighborhood", name: n.name, borough: n.borough, median: n.index_median, menus: pluralize(menus, "menu"), updated }));
  }
  for (const meta of BOROUGH_META) {
    const b = getBorough(meta.slug);
    if (!b) continue;
    const median = b.summary?.index_median ?? null;
    cards.set(`/boroughs/${b.slug}`, areaCard({ kind: "borough", name: b.name, borough: b.name, median: b.menuCounts.menus ? median : null, menus: pluralize(b.menuCounts.menus, "menu"), updated }));
  }
  for (const spec of rankingSpecs(restaurants)) {
    const ranking = rankMenus(restaurants, spec);
    cards.set(
      rankingPath(spec),
      listCard({
        ticket: RANKING_TICKETS[spec.kind],
        title: rankingName(spec),
        rows: ranking.rows.map((m) => ({ rank: m.rank, name: m.restaurant.name, detail: m.restaurant.burger.name, price: m.indexPrice })),
        count: ranking.rows.length > 1 ? rankingCountLine(spec, ranking) : null,
      }),
    );
  }
  const best = getBestBurgers();
  cards.set(
    BEST_BURGERS_PATH,
    listCard({
      ticket: BEST_BURGERS_TICKET,
      title: BEST_BURGERS_NAME,
      rows: best.map((e) => ({ rank: e.rank, name: e.name, detail: namedByHeading(e.publishers.length), price: e.restaurant?.index_price ?? null })),
      count: best.length ? bestBurgersCountLine(best.length) : null,
    }),
  );
  return cards;
}

const CARDS = build();

/** Every page's share card, by page path. */
export function shareCards(): ReadonlyMap<string, ShareCard> {
  return CARDS;
}

/** A page's own og:image (1200×630, with its alt text), or undefined: the page keeps the site's /og.png. */
export function shareImage(pagePath: string): { url: string; width: number; height: number; alt: string } | undefined {
  const card = CARDS.get(pagePath);
  return card ? { url: shareImagePath(pagePath), width: SHARE_IMAGE_WIDTH, height: SHARE_IMAGE_HEIGHT, alt: card.alt } : undefined;
}
