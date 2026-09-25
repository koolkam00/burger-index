import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaListItem, SoleRanked } from "@/components/AreaList";
import { AreaStats } from "@/components/AreaStats";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { PriceDistribution } from "@/components/charts/PriceDistribution";
import { AreaTable, RangePlot } from "@/components/charts/RangePlot";
import { Letterboard } from "@/components/Letterboard";
import { MENU_ENDS_SPLIT, MenuEnds } from "@/components/RestaurantBits";
import { Buoy, Net, Spatula } from "@/components/icons/nautical";
import { BoroughDot, DetailOverline, PageHeader, SectionHeading } from "@/components/ui";
import { BOROUGH_META, boroughInProse } from "@/lib/boroughs";
import {
  getBorough,
  getGeneratedAt,
  getNeighborhoodsInBorough,
  getPricedRestaurantsInBorough,
  getStats,
  hasNeighborhoodPage,
  rankedNeighborhoods,
  unrankedNeighborhoods,
} from "@/lib/data";
import { formatDate, formatPrice, pluralize, spreadEnds } from "@/lib/format";
import { isRankable, menuBreakdown, menuIndexPrices, menusByIndexPrice, menusByIndexPriceDesc } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { BOROUGHS_HREF } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return BOROUGH_META.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: PageProps<"/boroughs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const b = getBorough(slug);
  if (!b) return {};
  const c = b.menuCounts;
  const where = boroughInProse(b.name);
  const description =
    b.summary?.index_median != null
      ? `What a burger costs in ${where}: median index price ${formatPrice(b.summary.index_median, { cents: "always" })} across ${pluralize(c.menus, "menu")} (${menuBreakdown(c)}), by neighborhood.`
      : `Burger prices in ${where}. No priced restaurants there yet.`;
  return pageMetadata({ title: `${b.name} burger prices`, description, path: `/boroughs/${b.slug}` });
}

export default async function BoroughPage({ params }: PageProps<"/boroughs/[slug]">) {
  const { slug } = await params;
  const b = getBorough(slug);
  if (!b) notFound();
  const s = b.summary;
  const c = b.menuCounts;
  const median = getStats().index_median;
  const restaurants = getPricedRestaurantsInBorough(b.name);
  // Per menu, within the borough (menus.ts).
  const prices = menuIndexPrices(restaurants);
  const cheapest = menusByIndexPrice(restaurants);
  const priciest = menusByIndexPriceDesc(restaurants);
  const hoods = getNeighborhoodsInBorough(b.name);
  const ranked = rankedNeighborhoods(hoods);
  const hoodEnds = spreadEnds(ranked, (n) => n.index_median);
  // Priced neighborhoods below the ranking threshold; those with nothing priced have no page (the
  // /neighborhoods index lists them).
  const unranked = unrankedNeighborhoods(hoods).filter(hasNeighborhoodPage);
  const where = boroughInProse(b.name);
  // Nothing priced here: one lede, no stats, chart or neighborhood list.
  const priced = s !== null && s.index_median !== null && c.menus > 0;
  // Ranked: the board carries the median and the menu count; otherwise the lede and a Median tile do.
  const showBoard = priced && isRankable(c, s.index_median);

  return (
    <>
      <PageHeader
        crumbs={[{ href: BOROUGHS_HREF, label: "Boroughs" }, { label: b.name }]}
        overline={<DetailOverline label="Borough" />}
        title={
          <>
            <BoroughDot borough={b.name} ringed title />
            {b.name}
          </>
        }
        lede={!priced ? `No priced restaurants in ${where} yet.` : showBoard ? undefined : `${pluralize(c.menus, "priced menu")} in ${where}: ${menuBreakdown(c)}.`}
        aside={
          showBoard ? (
            <Letterboard
              overline={`The Burger Index · ${b.name} median`}
              price={s.index_median}
              line={[pluralize(c.menus, "menu"), `Updated ${formatDate(getGeneratedAt())}`]}
            />
          ) : undefined
        }
      />
      <div className="wrap">
        {priced ? (
          <>
            <AreaStats median={s.index_median} cityMedian={median} min={s.index_min} max={s.index_max} menus={c.menus} withMedian={!showBoard} />

            <section className="section" aria-labelledby="spread">
              <SectionHeading id="spread" kicker="Fresh off the grill" icon={Spatula} title={`How ${b.name} prices spread.`} />
              <div className="mt-8">
                <PriceDistribution id="hist-borough" prices={prices} cityMedian={median} sliceMedian={s.index_median} sliceName={b.name} />
              </div>
            </section>
          </>
        ) : null}

        {ranked.length || unranked.length ? (
          <section className="section" aria-labelledby="hoods">
            <SectionHeading id="hoods" kicker="Neighborhood specials" icon={Buoy} title={`${b.name} neighborhoods.`}>
              {ranked.length === 1 ? `Only ${ranked[0].name} is ranked.` : ranked.length ? null : "None is ranked yet."}
            </SectionHeading>
            {/* Nothing ranked: the intro says so and leads straight into the list (no second empty box). */}
            <div className={ranked.length ? "mt-8" : ""}>
              {ranked.length === 1 ? (
                <SoleRanked area={ranked[0]} cityMedian={median} />
              ) : ranked.length ? (
                <ChartFigure
                  id="hood-range"
                  title={`${b.name} neighborhoods by median index price`}
                  takeaway={
                    hoodEnds ? `${hoodEnds.top.name} is the priciest at ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.` : "The line marks the NYC median."
                  }
                  chart={<RangePlot areas={ranked} cityMedian={median} labelledBy="hood-range-title hood-range-desc" />}
                  table={<AreaTable areas={ranked} />}
                />
              ) : null}
              {unranked.length ? (
                <div className={ranked.length ? "mt-8" : "mt-6"}>
                  <h3 className="t-label muted">Other neighborhoods</h3>
                  <ul className="mt-2 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                    {unranked.map((n) => (
                      <AreaListItem key={n.slug} area={n} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {cheapest.length ? (
          <section className="section" aria-labelledby="ends">
            <SectionHeading id="ends" kicker="Catch of the day" icon={Net} title={cheapest.length >= MENU_ENDS_SPLIT ? `The cheapest and priciest in ${where}.` : `Every priced menu in ${where}.`} />
            <MenuEnds cheapest={cheapest} priciest={priciest} median={median} chainCount={{ noun: `${b.name} location` }} />
            <p className="mt-6">
              <Link href={`/burgers?borough=${b.slug}`} className="btn btn-secondary">
                Every burger in {where}
                <ArrowRight strokeWidth={2} aria-hidden="true" />
              </Link>
            </p>
          </section>
        ) : null}
      </div>
    </>
  );
}
