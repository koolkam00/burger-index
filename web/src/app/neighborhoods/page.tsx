import { AreaListItem } from "@/components/AreaList";
import { JsonLd } from "@/components/JsonLd";
import { NeighborhoodRanking } from "@/components/NeighborhoodRanking";
import { Buoy } from "@/components/icons/nautical";
import { BoroughDot, PageHeader, SectionHeading } from "@/components/ui";
import { BOROUGH_META } from "@/lib/boroughs";
import { getGeneratedAt, getNeighborhoodPages, getNeighborhoods, getStats, rankedNeighborhoods, unrankedNeighborhoods } from "@/lib/data";
import { formatCount, formatPrice, spreadEnds } from "@/lib/format";
import { breadcrumbNode, itemListNode } from "@/lib/jsonld";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { neighborhoodsSeo } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

const rankedEnds = spreadEnds(rankedNeighborhoods(), (n) => n.index_median);

export const metadata = pageMetadata({
  ...neighborhoodsSeo({
    pages: getNeighborhoodPages().length,
    ranked: rankedNeighborhoods().length,
    top: rankedEnds ? { name: rankedEnds.top.name, price: rankedEnds.top.index_median as number } : null,
    bottom: rankedEnds ? { name: rankedEnds.bottom.name, price: rankedEnds.bottom.index_median as number } : null,
    generatedAt: getGeneratedAt(),
  }),
  path: "/neighborhoods",
});

export default function NeighborhoodsPage() {
  const median = getStats().index_median;
  const all = getNeighborhoods();
  const ranked = rankedNeighborhoods();
  // Priced ones below the ranking threshold link to their page; those with nothing priced have no
  // page and are listed as plain names (AreaListItem).
  const unranked = unrankedNeighborhoods();
  const e = spreadEnds(ranked, (n) => n.index_median);
  const qualify = `${formatCount(ranked.length)} of ${formatCount(all.length)} neighborhoods ${ranked.length === 1 ? "is" : "are"} ranked.`;
  const lede = e
    ? `${qualify} ${e.top.name} is the priciest at ${formatPrice(e.top.index_median)}; ${e.bottom.name} is the cheapest at ${formatPrice(e.bottom.index_median)}.`
    : qualify;

  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbNode(SITE_URL, [{ href: "/", label: SITE_NAME }, { label: "Neighborhoods" }], "/neighborhoods"),
          // The ranking's default order (priciest median first), as the table first renders.
          ranked.length > 1
            ? itemListNode(SITE_URL, { name: "Neighborhoods, ranked", order: "descending", entries: ranked.map((n) => ({ name: n.name, path: `/neighborhoods/${n.slug}` })) })
            : null,
        ]}
      />
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
