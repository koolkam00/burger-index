import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaListItem, SoleRanked } from "@/components/AreaList";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { PriceDistribution } from "@/components/charts/PriceDistribution";
import { AreaTable, RangePlot } from "@/components/charts/RangePlot";
import { Letterboard } from "@/components/Letterboard";
import { MENU_ENDS_SPLIT, MenuEnds } from "@/components/RestaurantBits";
import { Buoy, Net, ShipWheel, Spatula } from "@/components/icons/nautical";
import { BoroughDot, ChainOnlyBadge, DetailOverline, Money, PageHeader, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { BOROUGH_META, boroughInProse } from "@/lib/boroughs";
import {
  getBorough,
  getBoroughs,
  getGeneratedAt,
  getNeighborhoodsInBorough,
  getRestaurantsInBorough,
  getStats,
  rankedNeighborhoods,
  unrankedNeighborhoods,
} from "@/lib/data";
import { formatCount, formatDate, formatDelta, formatPrice, pctDiff, pluralize, spreadEnds } from "@/lib/format";
import {
  chainNames,
  isChainOnly,
  isRankable,
  listedNames,
  menuBreakdown,
  menuBreakdownShort,
  menuIndexPrices,
  menusByIndexPrice,
  menusByIndexPriceDesc,
} from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";

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
  const description = !b.summary?.restaurants
    ? `Burger prices in ${where}. No priced restaurants there yet.`
    : b.summary.index_median != null
      ? isChainOnly(c)
        ? `Burger prices in ${where}: ${pluralize(c.menus, "chain menu")}, median ${formatPrice(b.summary.index_median, { cents: "always" })}.`
        : `What a burger costs in ${where}: median index price ${formatPrice(b.summary.index_median, { cents: "always" })} across ${pluralize(c.menus, "menu")} (${menuBreakdown(c)}), by neighborhood.`
      : `Burger prices in ${where}.`;
  return pageMetadata({ title: `${b.name} burger prices`, description, path: `/boroughs/${b.slug}` });
}

export default async function BoroughPage({ params }: PageProps<"/boroughs/[slug]">) {
  const { slug } = await params;
  const b = getBorough(slug);
  if (!b) notFound();
  const s = b.summary;
  const c = b.menuCounts;
  const chainOnly = isChainOnly(c);
  const median = getStats().index_median;
  const restaurants = getRestaurantsInBorough(b.name);
  // Per menu, within the borough (menus.ts).
  const prices = menuIndexPrices(restaurants);
  const cheapest = menusByIndexPrice(restaurants);
  const priciest = menusByIndexPriceDesc(restaurants);
  // Same count as the summary's `burgers` (priced burgers, any protein, a row per location), beef only.
  const beefBurgers = restaurants.reduce((n, r) => n + r.burgers.filter((x) => x.price !== null && x.protein === "beef").length, 0);
  const hoods = getNeighborhoodsInBorough(b.name);
  const ranked = rankedNeighborhoods(hoods);
  const hoodEnds = spreadEnds(
    ranked.filter((n) => !isChainOnly(n.menuCounts)),
    (n) => n.index_median,
  );
  const unranked = unrankedNeighborhoods(hoods);
  const rankable = s !== null && isRankable(c, s.index_median);
  // A chain median is not the borough's burger price: no board to screenshot until independents are in.
  const showBoard = rankable && !chainOnly;
  const diff = s?.index_median != null && median !== null ? pctDiff(s.index_median, median) : null;
  const where = boroughInProse(b.name);
  // No restaurant of this borough is in the dataset at all (its route comes from the fixed borough
  // list): one lede and the other boroughs for reference, no empty stats, chart or neighborhood list.
  const unlisted = !s || s.restaurants === 0;

  let lede: string;
  if (unlisted || s.index_median === null) lede = `No priced restaurants in ${where} yet.`;
  else if (chainOnly)
    lede = `${pluralize(c.menus, "priced chain menu")} at ${pluralize(c.locations, "location")} in ${where}${listedNames(chainNames(restaurants))}.`;
  else {
    // The median index price (one per menu), not "the median burger": the home page's pooled
    // every-burger median is a different number.
    const vs = diff !== null && Math.abs(diff) >= 0.5 ? `${Math.round(Math.abs(diff))}% ${diff > 0 ? "above" : "below"} the NYC median of ${formatPrice(median)}` : "right at the NYC median";
    lede = `The median index price in ${where} is ${formatPrice(s.index_median)}, ${vs}. That is across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.`;
  }

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/boroughs", label: "Boroughs" }, { label: b.name }]}
        overline={<DetailOverline label="Borough">{chainOnly ? <ChainOnlyBadge /> : null}</DetailOverline>}
        title={
          <>
            <BoroughDot borough={b.name} ringed title />
            {b.name}
          </>
        }
        lede={lede}
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
      {!unlisted ? (
        <section className="mt-2" aria-label="Key numbers">
          <StatGrid>
            <StatTile label="Median" value={s?.index_median != null ? <Money value={s.index_median} /> : "—"} sub={chainOnly ? "Chain prices only" : "Index price"} />
            <StatTile
              label="vs NYC"
              value={chainOnly ? "—" : formatDelta(s?.index_median ?? null, median)}
              sub={chainOnly ? "Chain prices only" : median !== null ? `NYC median ${formatPrice(median, { cents: "always" })}` : undefined}
            />
            <StatTile
              label="Menus priced"
              value={formatCount(c.menus)}
              sub={c.menus ? `${menuBreakdownShort(c)}, at ${pluralize(c.locations, "location")}` : `${pluralize(s?.restaurants ?? 0, "restaurant")}, none priced`}
            />
            <StatTile label="Burgers priced" value={formatCount(s?.burgers ?? 0)} sub={`${formatCount(beefBurgers)} beef`} />
          </StatGrid>
        </section>
      ) : null}

      <section className={unlisted ? "mt-2" : "section"} aria-labelledby="compare">
        <SectionHeading id="compare" kicker="Five boroughs, one counter" icon={ShipWheel} title={chainOnly || unlisted ? "The other boroughs, for reference." : "Against the other boroughs."} />
        <div className="mt-8">
          <ChartFigure
            id="borough-bars"
            title="Median index price by borough"
            takeaway={`${s?.index_median != null ? `${b.name}: ${formatPrice(s.index_median, { cents: "always" })}${chainOnly ? ", chain prices only" : ""}. ` : ""}The line marks the NYC median.`}
            chart={<BoroughBars boroughs={getBoroughs()} cityMedian={median} current={b.slug} labelledBy="borough-bars-title borough-bars-desc" />}
            table={<BoroughTable boroughs={getBoroughs()} />}
          />
        </div>
      </section>

      {!unlisted ? (
        <section className="section" aria-labelledby="spread">
          <SectionHeading id="spread" kicker="Fresh off the grill" icon={Spatula} title={`How ${b.name} prices spread.`} />
          <div className="mt-8">
            <PriceDistribution id="hist-borough" prices={prices} cityMedian={median} sliceMedian={s?.index_median ?? null} sliceName={b.name} chainOnly={chainOnly} />
          </div>
        </section>
      ) : null}

      {hoods.length ? (
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
