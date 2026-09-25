import Link from "next/link";
import type { MapPin } from "@/components/map/MapCanvas";
import { MapLegend } from "@/components/map/MapLegend";
import { MapShell } from "@/components/map/MapShell";
import { RestaurantTable } from "@/components/RestaurantBits";
import { CompassRose } from "@/components/icons/nautical";
import { PageHeader, PriceChip, SectionHeading, StatusBadge } from "@/components/ui";
import { getIndexBurger, getRestaurants, getStats } from "@/lib/data";
import { formatCount, pluralize } from "@/lib/format";
import { pageMetadata } from "@/lib/metadata";
import { binFor } from "@/lib/price-bins";

const hasCoords = (r: { lat: number | null; lng: number | null }) => r.lat !== null && r.lng !== null;

export const metadata = pageMetadata({
  title: "Burger price map",
  description: "The New York burger restaurants we have priced, on a map.",
  path: "/map",
});

export default function MapPage() {
  const median = getStats().index_median;
  const restaurants = getRestaurants();
  const onMap = restaurants.filter((r) => r.index_price !== null && hasCoords(r));
  const noCoords = restaurants.filter((r) => !hasCoords(r));
  const pricedNoCoords = noCoords.filter((r) => r.index_price !== null).length;
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

  return (
    <div>
      <PageHeader
          ticket="Chart a course"
          ticketIcon={CompassRose}
          title="The map."
          lede={`${
            pricedNoCoords ? `${formatCount(onMap.length)} of the ${pluralize(onMap.length + pricedNoCoords, "priced location")}` : pluralize(onMap.length, "priced location")
          }, one pin each. Tap a pin for the burger and the price.${
            pricedNoCoords ? ` The other ${pluralize(pricedNoCoords, "priced location")} ${pricedNoCoords === 1 ? "is" : "are"} listed below the map.` : ""
          }`}
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
                  {r.index_price !== null ? <PriceChip price={r.index_price} median={median} delta={false} /> : <StatusBadge status={r.status} />}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
