import Link from "next/link";
import type { ReactNode } from "react";
import { formatCount, pluralize } from "@/lib/format";
import type { Menu } from "@/lib/menus";
import type { PricedRestaurant, UnpricedRestaurant } from "@/lib/schema";
import { Kicker, PriceChip, SourceBadge } from "./ui";

type Named = { name: string };

/**
 * Names that occur more than once across `list` (and `alongside`, e.g. the page's own restaurant):
 * chain locations, which need their street address to tell the rows apart.
 */
export function repeatedNames(list: readonly Named[], alongside: readonly Named[] = []): Set<string> {
  const counts = new Map<string, number>();
  for (const r of [...list, ...alongside]) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
}

/** Card with a stretched link on the name (DESIGN.md "Cards"). `where` replaces the neighborhood line. */
export function RestaurantCard({
  restaurant: r,
  median,
  kicker,
  where,
  headingLevel = 3,
}: {
  restaurant: PricedRestaurant;
  median: number | null;
  kicker?: ReactNode;
  where?: string;
  /** 4 when the card sits under a group heading (h3) of its own. */
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <article className="card flex h-full flex-col">
      {kicker ? <Kicker>{kicker}</Kicker> : null}
      <Heading className={`t-display-s break-anywhere ${kicker ? "mt-2" : ""}`}>
        <Link href={`/restaurants/${r.id}`} className="stretched">
          {r.name}
        </Link>
      </Heading>
      <p className="t-ui-s muted mt-1 break-anywhere">
        {r.burger.name} · {where ?? r.neighborhood ?? r.borough}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <PriceChip price={r.index_price} median={median} />
        <SourceBadge source={r.price_source} />
      </div>
    </article>
  );
}

/** How a menu card counts a chain's locations: the noun ("Manhattan location"). */
export type ChainCount = { noun?: string };

/**
 * One distinct menu as a card: an independent restaurant shows its neighborhood; a chain shows how
 * many priced locations in the slice share the menu ("chain, 3 locations"; the link goes to one of them).
 */
export function MenuCard({
  menu,
  median,
  chainCount = {},
  kicker,
  headingLevel = 3,
}: {
  menu: Menu;
  median: number | null;
  chainCount?: ChainCount;
  kicker?: string;
  headingLevel?: 3 | 4;
}) {
  const where = menu.chain ? `chain, ${pluralize(menu.locations, chainCount.noun ?? "location")}` : undefined;
  return <RestaurantCard restaurant={menu.restaurant} median={median} where={where} kicker={kicker} headingLevel={headingLevel} />;
}

/** The callout kickers on the two ends of the counter: the cheapest menu and the priciest one. */
const CHEAPEST_KICKER = "Cheapest on the counter";
const PRICIEST_KICKER = "Top shelf";

/** Menus needed before MenuEnds splits into cheapest and priciest (two lists of four that can't overlap). */
export const MENU_ENDS_SPLIT = 8;

/** Cheapest and priciest distinct menus side by side, or one list when there are too few to split. */
export function MenuEnds({ cheapest, priciest, median, chainCount }: { cheapest: Menu[]; priciest: Menu[]; median: number | null; chainCount?: ChainCount }) {
  // Two lists of four only when they can't overlap; otherwise every menu once, cheapest first.
  if (cheapest.length >= MENU_ENDS_SPLIT) {
    return (
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="t-label muted">Cheapest index prices</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {cheapest.slice(0, 4).map((m, i) => (
              <li key={m.key}>
                <MenuCard menu={m} median={median} chainCount={chainCount} headingLevel={4} kicker={i === 0 ? CHEAPEST_KICKER : undefined} />
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="t-label muted">Priciest index prices</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {priciest.slice(0, 4).map((m, i) => (
              <li key={m.key}>
                <MenuCard menu={m} median={median} chainCount={chainCount} headingLevel={4} kicker={i === 0 ? PRICIEST_KICKER : undefined} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-8">
      <h3 className="t-label muted">Index prices, cheapest first</h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cheapest.map((m, i) => (
          <li key={m.key}>
            <MenuCard
              menu={m}
              median={median}
              chainCount={chainCount}
              headingLevel={4}
              kicker={cheapest.length > 1 && i === 0 ? CHEAPEST_KICKER : cheapest.length > 1 && i === cheapest.length - 1 ? PRICIEST_KICKER : undefined}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Compact ranking of priced restaurants by index price, each linked to its page. `unpriced` (a
 * neighborhood page) follows as plain names: those restaurants have no page.
 */
export function RestaurantTable({
  restaurants,
  unpriced = [],
  median,
  showNeighborhood = true,
  caption,
}: {
  restaurants: readonly PricedRestaurant[];
  unpriced?: readonly UnpricedRestaurant[];
  median: number | null;
  showNeighborhood?: boolean;
  caption?: string;
}) {
  const priced = [...restaurants].sort((a, b) => a.index_price - b.index_price || a.name.localeCompare(b.name));
  const names = [...unpriced].sort((a, b) => a.name.localeCompare(b.name));
  const repeated = repeatedNames([...priced, ...names]);
  const address = (r: PricedRestaurant | UnpricedRestaurant) => (repeated.has(r.name) && r.address ? r.address : null);
  return (
    <div>
      <div className="table-shell">
      <table className="data-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col">Restaurant</th>
            {showNeighborhood ? (
              <th scope="col" className="hidden md:table-cell">
                Neighborhood
              </th>
            ) : null}
            <th scope="col" className="hidden sm:table-cell">
              Source
            </th>
            <th scope="col" className="num">
              Index price
            </th>
          </tr>
        </thead>
        <tbody>
          {priced.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="min-w-0">
                <Link href={`/restaurants/${r.id}`} className="ui-link break-anywhere font-semibold">
                  {r.name}
                </Link>
                <span className="t-ui-s muted block break-anywhere">
                  {[r.burger.name, address(r)].filter(Boolean).join(" · ")}
                  {showNeighborhood ? <span className="md:hidden"> · {r.neighborhood ?? r.borough}</span> : null}
                </span>
              </th>
              {showNeighborhood ? <td className="t-ui-s hidden break-anywhere md:table-cell">{r.neighborhood ?? r.borough}</td> : null}
              <td className="hidden sm:table-cell">
                <SourceBadge source={r.price_source} />
              </td>
              <td className="num">
                <PriceChip price={r.index_price} median={median} delta={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="t-ui-s muted mt-3">{formatCount(priced.length)} priced.</p>
      {names.length ? (
        <div className="mt-8">
          <h3 className="t-label muted">Not priced</h3>
          <ul className="mt-2 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {names.map((r) => (
              <li key={r.id} className="t-ui-m flex min-h-11 flex-col justify-center border-b border-line py-1.5 break-anywhere">
                {r.name}
                {address(r) ? <span className="t-ui-s muted">{address(r)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
