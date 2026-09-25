import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AreaListItem } from "@/components/AreaList";
import { AreaStats } from "@/components/AreaStats";
import { Letterboard } from "@/components/Letterboard";
import { RestaurantTable } from "@/components/RestaurantBits";
import { Buoy, Spyglass } from "@/components/icons/nautical";
import { BoroughName, DetailOverline, PageHeader, SectionHeading } from "@/components/ui";
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
import { formatDate, formatPrice, pluralize } from "@/lib/format";
import { isRankable, menuBreakdown } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
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
  const description = `What a burger costs in ${n.name}, ${n.borough}: median index price ${formatPrice(n.index_median, { cents: "always" })} across ${pluralize(c.menus, "priced menu")}.`;
  return pageMetadata({ title: `${n.name} burger prices`, description, path: `/neighborhoods/${n.slug}` });
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

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/neighborhoods", label: "Neighborhoods" },
          { href: `/boroughs/${boroughSlug(n.borough)}`, label: n.borough },
          { label: n.name },
        ]}
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
              caption={`Restaurants in ${n.name}`}
            />
          </div>
        </section>

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
