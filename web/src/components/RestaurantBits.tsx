import Link from "next/link";
import type { ReactNode } from "react";
import { formatCount, pluralize } from "@/lib/format";
import type { Menu } from "@/lib/menus";
import type { Restaurant } from "@/lib/schema";
import { PriceChip, SourceBadge, StatusBadge } from "./ui";

function indexBurger(r: Restaurant) {
  return r.burgers.find((b) => b.is_index_item);
}

/**
 * Names that occur more than once across `list` (and `alongside`, e.g. the page's own restaurant):
 * chain locations, which need their street address to tell the rows apart.
 */
export function repeatedNames(list: readonly Restaurant[], alongside: readonly Restaurant[] = []): Set<string> {
  const counts = new Map<string, number>();
  for (const r of [...list, ...alongside]) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
}

/** Card with a stretched link on the name (DESIGN.md "Cards"). `where` replaces the neighborhood line. */
export function RestaurantCard({
  restaurant: r,
  median,
  kicker,
  burgerName,
  price,
  where,
}: {
  restaurant: Restaurant;
  median: number | null;
  kicker?: ReactNode;
  burgerName?: string;
  price?: number | null;
  where?: string;
}) {
  const b = indexBurger(r);
  const shownPrice = price !== undefined ? price : r.index_price;
  return (
    <article className="card flex h-full flex-col">
      {kicker ? <p className="t-label muted">{kicker}</p> : null}
      <h3 className={`t-display-s break-anywhere ${kicker ? "mt-2" : ""}`}>
        <Link href={`/restaurants/${r.id}`} className="stretched">
          {r.name}
        </Link>
      </h3>
      <p className="t-ui-s muted mt-1 break-anywhere">
        {burgerName ?? b?.name ?? "No priced burger"} · {where ?? r.neighborhood ?? r.borough}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <PriceChip price={shownPrice} median={median} dagger={r.price_source === "delivery_app"} />
        <SourceBadge source={r.price_source} />
      </div>
    </article>
  );
}

/**
 * One distinct menu as a card: an independent restaurant shows its neighborhood; a chain shows how
 * many priced locations in the slice share the menu (the link goes to one of them).
 */
export function MenuCard({ menu, median }: { menu: Menu; median: number | null }) {
  return <RestaurantCard restaurant={menu.restaurant} median={median} where={menu.chain ? `chain, ${pluralize(menu.locations, "location")}` : undefined} />;
}

/** Menus needed before MenuEnds splits into cheapest and priciest (two lists of four that can't overlap). */
export const MENU_ENDS_SPLIT = 8;

/** Cheapest and priciest distinct menus side by side, or one list when there are too few to split. */
export function MenuEnds({ cheapest, priciest, median }: { cheapest: Menu[]; priciest: Menu[]; median: number | null }) {
  // Two lists of four only when they can't overlap; otherwise every menu once, cheapest first.
  if (cheapest.length >= MENU_ENDS_SPLIT) {
    return (
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="t-label muted">Cheapest index prices</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {cheapest.slice(0, 4).map((m) => (
              <li key={m.key}>
                <MenuCard menu={m} median={median} />
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="t-label muted">Priciest index prices</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {priciest.slice(0, 4).map((m) => (
              <li key={m.key}>
                <MenuCard menu={m} median={median} />
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
        {cheapest.map((m) => (
          <li key={m.key}>
            <MenuCard menu={m} median={median} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact ranking of restaurants by index price; unpriced ones follow with their status. */
export function RestaurantTable({ restaurants, median, showNeighborhood = true, caption }: { restaurants: Restaurant[]; median: number | null; showNeighborhood?: boolean; caption?: string }) {
  const priced = restaurants
    .filter((r) => r.index_price !== null)
    .sort((a, b) => (a.index_price as number) - (b.index_price as number) || a.name.localeCompare(b.name));
  const unpriced = restaurants.filter((r) => r.index_price === null).sort((a, b) => a.name.localeCompare(b.name));
  const hasDelivery = priced.some((r) => r.price_source === "delivery_app");
  const repeated = repeatedNames(restaurants);
  const address = (r: Restaurant) => (repeated.has(r.name) && r.address ? r.address : null);
  return (
    <div>
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
          {priced.map((r) => {
            const b = indexBurger(r);
            return (
              <tr key={r.id}>
                <th scope="row" className="min-w-0">
                  <Link href={`/restaurants/${r.id}`} className="ui-link break-anywhere font-semibold">
                    {r.name}
                  </Link>
                  <span className="t-ui-s muted block break-anywhere">
                    {[b?.name, address(r)].filter(Boolean).join(" · ")}
                    {showNeighborhood ? <span className="md:hidden"> · {r.neighborhood ?? r.borough}</span> : null}
                  </span>
                </th>
                {showNeighborhood ? <td className="t-ui-s hidden break-anywhere md:table-cell">{r.neighborhood ?? r.borough}</td> : null}
                <td className="hidden sm:table-cell">
                  <SourceBadge source={r.price_source} />
                </td>
                <td className="num">
                  <PriceChip price={r.index_price} median={median} delta={false} dagger={r.price_source === "delivery_app"} />
                </td>
              </tr>
            );
          })}
          {unpriced.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                <Link href={`/restaurants/${r.id}`} className="ui-link break-anywhere font-semibold">
                  {r.name}
                </Link>
                {address(r) ? <span className="t-ui-s muted block break-anywhere">{address(r)}</span> : null}
              </th>
              {showNeighborhood ? <td className="t-ui-s hidden break-anywhere md:table-cell">{r.neighborhood ?? r.borough}</td> : null}
              <td className="hidden sm:table-cell" />
              <td className="num">
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-ui-s muted mt-3">
        {formatCount(priced.length)} priced{unpriced.length ? `, ${formatCount(unpriced.length)} without a price` : ""}.
        {hasDelivery ? " † Delivery-app price; these usually run higher than ordering in person." : ""}
      </p>
    </div>
  );
}

