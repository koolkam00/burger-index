import Link from "next/link";
import type { ReactNode } from "react";
import { formatCount } from "@/lib/format";
import type { Restaurant } from "@/lib/schema";
import { PriceChip, SourceBadge, StatusBadge } from "./ui";

function indexBurger(r: Restaurant) {
  return r.burgers.find((b) => b.is_index_item);
}

/** Card with a stretched link on the name (DESIGN.md "Cards"). */
export function RestaurantCard({ restaurant: r, median, kicker, burgerName, price }: { restaurant: Restaurant; median: number | null; kicker?: ReactNode; burgerName?: string; price?: number | null }) {
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
        {burgerName ?? b?.name ?? "No priced burger"} · {r.neighborhood ?? r.borough}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <PriceChip price={shownPrice} median={median} dagger={r.price_source === "delivery_app"} />
        <SourceBadge source={r.price_source} />
      </div>
    </article>
  );
}

/** Compact ranking of restaurants by index price; unpriced ones follow with their status. */
export function RestaurantTable({ restaurants, median, showNeighborhood = true, caption }: { restaurants: Restaurant[]; median: number | null; showNeighborhood?: boolean; caption?: string }) {
  const priced = restaurants
    .filter((r) => r.index_price !== null)
    .sort((a, b) => (a.index_price as number) - (b.index_price as number) || a.name.localeCompare(b.name));
  const unpriced = restaurants.filter((r) => r.index_price === null).sort((a, b) => a.name.localeCompare(b.name));
  const hasDelivery = priced.some((r) => r.price_source === "delivery_app");
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
                    {b?.name}
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

