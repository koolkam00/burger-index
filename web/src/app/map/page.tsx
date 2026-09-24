import Link from "next/link";
import type { MapPin } from "@/components/map/MapCanvas";
import { MapLegend } from "@/components/map/MapLegend";
import { MapShell } from "@/components/map/MapShell";
import { RestaurantTable } from "@/components/RestaurantBits";
import { CompassRose } from "@/components/icons/nautical";
import { PageHeader, PriceChip, SectionHeading, StatusBadge } from "@/components/ui";
import { boroughInProse } from "@/lib/boroughs";
import { getBoroughs, getIndexBurger, getMenuCounts, getRestaurants, getScope, getStats } from "@/lib/data";
import { capitalize, formatCount, pluralize } from "@/lib/format";
import { DELIVERY_NOTE } from "@/lib/labels";
import { joinList, splitByCoverage } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { binFor } from "@/lib/price-bins";

const hasCoords = (r: { lat: number | null; lng: number | null }) => r.lat !== null && r.lng !== null;
const pricedCount = getRestaurants().filter((r) => r.index_price !== null).length;
const pinCount = getRestaurants().filter((r) => r.index_price !== null && hasCoords(r)).length;

export const metadata = pageMetadata({
  title: "Burger price map",
  // Not "every": a priced location without coordinates has no pin (the page lists it below the map).
  description: `The New York burger restaurants we have priced${getScope().pending ? " so far" : ""}, on a map${
    pinCount < pricedCount ? ` (${formatCount(pinCount)} of ${formatCount(pricedCount)} priced locations have coordinates)` : ""
  }, colored from Steal to Splurge against the NYC median.`,
  path: "/map",
});

export default function MapPage() {
  const median = getStats().index_median;
  const restaurants = getRestaurants();
  const onMap = restaurants.filter((r) => r.index_price !== null && hasCoords(r));
  const noCoords = restaurants.filter((r) => !hasCoords(r));
  const pricedNoCoords = noCoords.filter((r) => r.index_price !== null).length;
  const unpricedWithCoords = restaurants.filter((r) => r.index_price === null && hasCoords(r)).length;
  const noCoordsDelivery = noCoords.some((r) => r.index_price !== null && r.price_source === "delivery_app");
  const pins: MapPin[] = onMap.map((r) => ({
    id: r.id,
    name: r.name,
    where: r.neighborhood ? `${r.neighborhood}, ${r.borough}` : r.borough,
    burger: getIndexBurger(r)?.name ?? "",
    price: r.index_price as number,
    lat: r.lat as number,
    lng: r.lng as number,
    delivery: r.price_source === "delivery_app",
  }));
  // Pins per price level: locations, not menus (the legend heads the column "Pins").
  const counts = [0, 0, 0, 0, 0];
  if (median !== null) for (const p of pins) counts[binFor(p.price, median).step - 1] += 1;
  // Boroughs priced from chain menus alone: every pin there is a chain location, not a like-for-like price.
  const { chainOnly } = splitByCoverage(getBoroughs(), (b) => b.menuCounts, (b) => b.summary?.index_median ?? null);
  const coverage = chainOnly.length
    ? ` ${capitalize(joinList(chainOnly.map((b) => boroughInProse(b.name))))} ${chainOnly.length === 1 ? "is" : "are"} priced from chain menus only so far, so every pin there is a chain location.`
    : "";

  return (
    <div>
      <PageHeader
          ticket="Chart a course"
          ticketIcon={CompassRose}
          title="The map."
          lede={`${
            pricedNoCoords ? `${formatCount(onMap.length)} of the ${pluralize(onMap.length + pricedNoCoords, "priced location")}` : pluralize(onMap.length, "priced location")
          }, one pin each, colored by index price against the NYC median. Tap a pin for the burger and the price. Every location of a chain gets a pin, though the index counts the chain once (${pluralize(getMenuCounts().menus, "menu")} in all).${
            pricedNoCoords ? ` The other ${pluralize(pricedNoCoords, "priced location")} ${pricedNoCoords === 1 ? "has" : "have"} no coordinates yet and ${pricedNoCoords === 1 ? "is" : "are"} listed below the map.` : ""
          }${coverage}${unpricedWithCoords ? ` ${pluralize(unpricedWithCoords, "location")} without a price ${unpricedWithCoords === 1 ? "is" : "are"} left off.` : ""}`}
      />
      <div className="mt-2">
        <MapShell
          pins={pins}
          median={median}
          legend={median !== null ? <MapLegend median={median} counts={counts} /> : null}
          list={<RestaurantTable restaurants={onMap} median={median} caption="Priced restaurants on the map" />}
        />
      </div>

      {noCoords.length ? (
        <div className="wrap">
          <section className="section" aria-labelledby="off-map">
            <SectionHeading id="off-map" title="Not on the map.">
              We have no coordinates for these {pluralize(noCoords.length, "location")}.
            </SectionHeading>
            <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
              {noCoords.map((r) => (
                <li key={r.id} className="flex min-h-12 items-center justify-between gap-3 border-b-[1.5px] border-line py-2">
                  <span className="min-w-0">
                    <Link href={`/restaurants/${r.id}`} className="ui-link break-anywhere font-semibold">
                      {r.name}
                    </Link>
                    <span className="t-ui-s muted block break-anywhere">
                      {[r.address, r.neighborhood ?? r.borough].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {r.index_price !== null ? <PriceChip price={r.index_price} median={median} delta={false} dagger={r.price_source === "delivery_app"} /> : <StatusBadge status={r.status} />}
                </li>
              ))}
            </ul>
            {noCoordsDelivery ? <p className="t-ui-s muted mt-3">† Delivery-app price. {DELIVERY_NOTE}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
