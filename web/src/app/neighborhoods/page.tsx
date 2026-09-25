import { AreaListItem } from "@/components/AreaList";
import { NeighborhoodRanking } from "@/components/NeighborhoodRanking";
import { Buoy } from "@/components/icons/nautical";
import { BoroughDot, PageHeader, SectionHeading } from "@/components/ui";
import { BOROUGH_META } from "@/lib/boroughs";
import { getNeighborhoods, getStats, rankedNeighborhoods, unrankedNeighborhoods } from "@/lib/data";
import { formatCount, formatPrice, spreadEnds } from "@/lib/format";
import { isChainOnly } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
  title: "Neighborhoods",
  description:
    rankedNeighborhoods().length > 1
      ? "New York neighborhoods ranked by the median price of a burger, with the cheapest and priciest index price in each."
      : "New York neighborhoods and the price of a burger in each: the median, cheapest and priciest index price.",
  path: "/neighborhoods",
});

export default function NeighborhoodsPage() {
  const median = getStats().index_median;
  const all = getNeighborhoods();
  const ranked = rankedNeighborhoods();
  const unranked = unrankedNeighborhoods();
  // The headline compares like for like: ranked neighborhoods with independent menus.
  const e = spreadEnds(
    ranked.filter((n) => !isChainOnly(n.menuCounts)),
    (n) => n.index_median,
  );
  const qualify = `${formatCount(ranked.length)} of ${formatCount(all.length)} neighborhoods ${ranked.length === 1 ? "is" : "are"} ranked.`;
  const lede = e
    ? `${qualify} ${e.top.name} is the priciest at ${formatPrice(e.top.index_median)}; ${e.bottom.name} is the cheapest at ${formatPrice(e.bottom.index_median)}.`
    : qualify;

  return (
    <>
      <PageHeader ticket="Neighborhood specials" ticketIcon={Buoy} title={ranked.length > 1 ? "Neighborhoods, ranked." : "Neighborhoods."} lede={lede} />
      <div className="wrap">

      {ranked.length ? (
        <section className="mt-2" aria-label="Ranked neighborhoods">
          <NeighborhoodRanking areas={ranked} cityMedian={median} />
          <p className="t-ui-s muted mt-3">NYC median {formatPrice(median, { cents: "always" })}.</p>
        </section>
      ) : null}

      {unranked.length ? (
        <section className="section" aria-labelledby="other-hoods">
          <SectionHeading id="other-hoods" title="Other neighborhoods." />
          <div className="mt-6 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {BOROUGH_META.map((m) => {
              const list = unranked.filter((n) => n.borough === m.name);
              if (!list.length) return null;
              return (
                <div key={m.slug} className="min-w-0">
                  <h3 className="t-label muted flex items-center gap-2">
                    <BoroughDot borough={m.name} />
                    {m.name}
                  </h3>
                  <ul className="mt-2">
                    {list.map((n) => (
                      <AreaListItem key={n.slug} area={n} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      </div>
    </>
  );
}
