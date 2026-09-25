import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AreaListItem } from "@/components/AreaList";
import { AreaStats } from "@/components/AreaStats";
import { JsonLd } from "@/components/JsonLd";
import { Letterboard } from "@/components/Letterboard";
import { QandA } from "@/components/QandA";
import { byIndexPrice, RestaurantTable } from "@/components/RestaurantBits";
import { Buoy, Spyglass } from "@/components/icons/nautical";
import { BoroughName, DetailOverline, PageHeader, SectionHeading } from "@/components/ui";
import { neighborhoodFaq } from "@/lib/answers";
import { boroughInProse, boroughSlug } from "@/lib/boroughs";
import {
  getGeneratedAt,
  getNeighborhood,
  getNeighborhoodPages,
  getNeighborhoodsInBorough,
  getRestaurantsInNeighborhood,
  getStats,
  hasNeighborhoodPage,
  isPriced,
  isUnpriced,
  neighborhoodMenuCounts,
  withMenuCounts,
} from "@/lib/data";
import { formatDate, pluralize } from "@/lib/format";
import { breadcrumbNode, itemListNode } from "@/lib/jsonld";
import { isRankable, menuBreakdown, menusByIndexPrice, menusByIndexPriceDesc } from "@/lib/menus";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { topTied, withRanks } from "@/lib/rankings";
import { neighborhoodSeo } from "@/lib/seo";
import { atLeastOneParam, PLACEHOLDER_PARAM } from "@/lib/site";

export const dynamicParams = false;

// Only neighborhoods with a priced restaurant get a page (user decision 2026-09-25).
export function generateStaticParams() {
  return atLeastOneParam(getNeighborhoodPages().map((n) => ({ slug: n.slug })), { slug: PLACEHOLDER_PARAM });
}

/** A neighborhood with a page, or undefined (unknown, or nothing priced there). */
function neighborhoodPage(slug: string) {
  const n = getNeighborhood(slug);
  return n && hasNeighborhoodPage(n) && n.index_median !== null ? { ...n, index_median: n.index_median } : undefined;
}

export async function generateMetadata({ params }: PageProps<"/neighborhoods/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const n = neighborhoodPage(slug);
  if (!n) return {};
  const c = neighborhoodMenuCounts(slug);
  const restaurants = getRestaurantsInNeighborhood(slug);
  const cheapest = menusByIndexPrice(restaurants);
  const priciest = menusByIndexPriceDesc(restaurants);
  const seo = neighborhoodSeo({
    name: n.name,
    ambiguous: getNeighborhoodPages().some((x) => x.slug !== n.slug && x.name === n.name),
    borough: n.borough,
    median: n.index_median,
    menus: c.menus,
    cityMedian: getStats().index_median,
    cheapest: cheapest[0] ? { name: cheapest[0].restaurant.name, price: cheapest[0].indexPrice } : null,
    priciest: priciest[0] ? { name: priciest[0].restaurant.name, price: priciest[0].indexPrice } : null,
    only: c.menus === 1 && cheapest[0] ? { restaurant: cheapest[0].restaurant.name, burger: cheapest[0].restaurant.burger.name } : null,
    generatedAt: getGeneratedAt(),
  });
  return pageMetadata({ ...seo, path: `/neighborhoods/${n.slug}` });
}

export default async function NeighborhoodPage({ params }: PageProps<"/neighborhoods/[slug]">) {
  const { slug } = await params;
  const n = neighborhoodPage(slug);
  if (!n) notFound();
  const median = getStats().index_median;
  const restaurants = getRestaurantsInNeighborhood(slug);
  const c = neighborhoodMenuCounts(slug);
  // Siblings with a page of their own (the /neighborhoods index lists the rest).
  const siblings = withMenuCounts(getNeighborhoodsInBorough(n.borough).filter((x) => x.slug !== slug && hasNeighborhoodPage(x)));
  // Ranked on distinct menus (menus.ts isRankable): the board carries the median and the menu count;
  // an unranked neighborhood says them in the lede and the Median tile instead.
  const ranked = isRankable(c, n.index_median);
  const crumbs = [
    { href: "/neighborhoods", label: "Neighborhoods" },
    { href: `/boroughs/${boroughSlug(n.borough)}`, label: n.borough },
    { label: n.name },
  ];
  const path = `/neighborhoods/${n.slug}`;
  const table = `Restaurants in ${n.name}`;
  const faq = neighborhoodFaq({
    generatedAt: getGeneratedAt(),
    name: n.name,
    median: n.index_median,
    cityMedian: median,
    menus: c.menus,
    cheapest: topTied(withRanks(menusByIndexPrice(restaurants))),
    priciest: topTied(withRanks(menusByIndexPriceDesc(restaurants))),
  });

  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbNode(SITE_URL, crumbs, path),
          // The restaurant table below, row for row (every priced location, cheapest first).
          itemListNode(SITE_URL, {
            name: table,
            order: "ascending",
            entries: byIndexPrice(restaurants.filter(isPriced)).map((r) => ({ name: r.name, path: `/restaurants/${r.id}` })),
          }),
        ]}
      />
      <PageHeader
        crumbs={crumbs}
        overline={
          <DetailOverline
            label={
              <>
                Neighborhood ·<BoroughName borough={n.borough} link={false} ringed />
              </>
            }
          />
        }
        title={n.name}
        lede={ranked ? undefined : `${pluralize(c.menus, "priced menu")} here: ${menuBreakdown(c)}.`}
        aside={
          ranked ? (
            <Letterboard
              overline={`The Burger Index · ${n.name} median`}
              price={n.index_median}
              line={[pluralize(c.menus, "menu"), `Updated ${formatDate(getGeneratedAt())}`]}
            />
          ) : undefined
        }
      />
      <div className="wrap">
        <AreaStats median={n.index_median} cityMedian={median} min={n.index_min} max={n.index_max} menus={c.menus} withMedian={!ranked} />

        <section className="section" aria-labelledby="places">
          <SectionHeading id="places" kicker="Cast a line" icon={Spyglass} title={`Restaurants in ${n.name}.`}>
            Sorted by index price, cheapest first.
          </SectionHeading>
          <div className="mt-6">
            <RestaurantTable
              restaurants={restaurants.filter(isPriced)}
              unpriced={restaurants.filter(isUnpriced)}
              median={median}
              showNeighborhood={false}
              caption={table}
            />
          </div>
        </section>

        <QandA items={faq} />

        {siblings.length ? (
          <section className="section" aria-labelledby="nearby">
            <SectionHeading id="nearby" kicker="Neighborhood specials" icon={Buoy} title={`Elsewhere in ${boroughInProse(n.borough)}.`} />
            <ul className="mt-6 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              {siblings.map((s) => (
                <AreaListItem key={s.slug} area={s} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
