import { ArrowRight, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { PriceDistribution } from "@/components/charts/PriceDistribution";
import { AreaTable, RangePlot } from "@/components/charts/RangePlot";
import { Letterboard } from "@/components/Letterboard";
import { RestaurantCard } from "@/components/RestaurantBits";
import { ChartEmpty, Money, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { byIndexPrice, getBoroughs, getBurger, getGeneratedAt, getStats, indexPrices, rankedNeighborhoods } from "@/lib/data";
import { formatCount, formatDate, formatPrice, pluralize } from "@/lib/format";
import { pageMetadata } from "@/lib/metadata";

export const metadata = {
  ...pageMetadata({
    title: "What a burger costs in New York",
    description: "The NYC Burger Index: the median price of the cheapest beef burger at every New York restaurant we could price.",
    path: "/",
  }),
  title: { absolute: "The Burger Index: what a burger costs in New York" },
};

export default function HomePage() {
  const stats = getStats();
  const median = stats.index_median;
  const generated = getGeneratedAt();
  const prices = indexPrices();
  const boroughs = getBoroughs();
  const ranked = rankedNeighborhoods();
  const cheapest = byIndexPrice();
  const priciest = [...cheapest].reverse();
  const cheapestBurger = getBurger(stats.cheapest_burger_id);
  const priciestBurger = getBurger(stats.priciest_burger_id);

  const pricedBoroughs = boroughs
    .filter((b) => b.summary?.index_median != null)
    .sort((a, b) => (b.summary!.index_median as number) - (a.summary!.index_median as number));
  const topBorough = pricedBoroughs[0];
  const bottomBorough = pricedBoroughs[pricedBoroughs.length - 1];
  const boroughsTied = pricedBoroughs.length > 1 && topBorough.summary!.index_median === bottomBorough.summary!.index_median;

  const neighborhoodRows = ranked.length > 16 ? [...ranked.slice(0, 8), ...ranked.slice(-8)] : ranked;

  return (
    <div className="wrap">
      {/* Hero: H1 + lede, board in columns 6–12 at lg */}
      <section className="grid gap-8 pt-8 md:pt-12 lg:grid-cols-12 lg:items-end lg:gap-8" aria-labelledby="hero-title">
        <div className="min-w-0 lg:col-span-5 lg:pb-4">
          <h1 id="hero-title" className="t-display-l">
            What a burger costs in New York.
          </h1>
          <p className="t-lede mt-5">
            {median !== null ? (
              <>
                We read the menus of {formatCount(stats.restaurants_scanned)} restaurants and recorded the cheapest beef burger at each of the{" "}
                {formatCount(stats.restaurants_priced)} that list one. Half charge more than {formatPrice(median)}. Half charge less.
              </>
            ) : (
              <>We are still reading menus. The index appears here once the first restaurants are priced.</>
            )}
          </p>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <Letterboard
            overline="The Burger Index · NYC median"
            price={median}
            line={`Cheapest beef burger at ${formatCount(stats.restaurants_priced)} restaurants · Updated ${formatDate(generated)}`}
          />
        </div>
      </section>

      <section className="mt-10 md:mt-12" aria-label="Key numbers">
        <StatGrid>
          <StatTile
            label="Typical range"
            value={
              stats.index_p10 !== null && stats.index_p90 !== null ? (
                <span className="inline-flex flex-wrap items-start gap-x-1">
                  <Money value={stats.index_p10} />
                  <span aria-hidden="true">–</span>
                  <span className="sr-only">to</span>
                  <Money value={stats.index_p90} />
                </span>
              ) : (
                "—"
              )
            }
            sub="Middle 80% of index prices"
          />
          <StatTile label="Restaurants priced" value={formatCount(stats.restaurants_priced)} sub={`of ${formatCount(stats.restaurants_scanned)} menus read`} />
          <StatTile label="Burgers indexed" value={formatCount(stats.burgers)} sub={`${formatCount(stats.beef_burgers)} of them beef`} />
          <StatTile
            label="Every burger, median"
            value={stats.all_burgers_median !== null ? <Money value={stats.all_burgers_median} /> : "—"}
            sub="All items, all proteins"
          />
        </StatGrid>
      </section>

      <section className="section" aria-labelledby="spread">
        <SectionHeading
          id="spread"
          title={
            stats.index_p10 !== null && stats.index_p90 !== null && Math.floor(stats.index_p10) !== Math.ceil(stats.index_p90)
              ? `Most burgers land between ${formatPrice(Math.floor(stats.index_p10))} and ${formatPrice(Math.ceil(stats.index_p90))}.`
              : "How the prices spread."
          }
        >
          Each bar counts restaurants by their index price: the cheapest beef burger on the menu.
        </SectionHeading>
        <div className="mt-8">
          <PriceDistribution id="hist-city" prices={prices} cityMedian={median} sliceMedian={median} />
        </div>
      </section>

      <section className="section" aria-labelledby="boroughs">
        <SectionHeading
          id="boroughs"
          title={
            !topBorough
              ? "Boroughs, once we have prices."
              : boroughsTied
                ? `Every borough lands on ${formatPrice(topBorough.summary!.index_median)}.`
                : `The priciest borough is ${topBorough.name}.`
          }
        />
        <div className="mt-8">
          {topBorough ? (
            <ChartFigure
              id="borough-bars"
              title="Median index price by borough"
              takeaway={
                boroughsTied || !bottomBorough || bottomBorough === topBorough
                  ? `The median is ${formatPrice(topBorough.summary!.index_median, { cents: "always" })} in every borough we have priced.`
                  : `${topBorough.name} ${formatPrice(topBorough.summary!.index_median, { cents: "always" })}, ${bottomBorough.name} ${formatPrice(bottomBorough.summary!.index_median, { cents: "always" })}.`
              }
              chart={<BoroughBars boroughs={boroughs} cityMedian={median} labelledBy="borough-bars-title borough-bars-desc" />}
              table={<BoroughTable boroughs={boroughs} />}
            />
          ) : (
            <ChartEmpty height={220}>No borough has a priced restaurant yet.</ChartEmpty>
          )}
        </div>
      </section>

      {cheapest.length ? (
        <section className="section" aria-labelledby="cheap">
          <SectionHeading id="cheap" title={`Where ${formatPrice(cheapest[0].index_price)} still gets you lunch.`} />
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="t-label muted">Cheapest index prices</h3>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {cheapest.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <RestaurantCard restaurant={r} median={median} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <h3 className="t-label muted">Priciest index prices</h3>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {priciest.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <RestaurantCard restaurant={r} median={median} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {cheapestBurger && priciestBurger ? (
            <p className="t-body muted prose-width mt-6">
              Counting every burger on every menu, any protein: the cheapest is the {cheapestBurger.burger.name} at{" "}
              <Link className="link" href={`/restaurants/${cheapestBurger.restaurant.id}`}>
                {cheapestBurger.restaurant.name}
              </Link>{" "}
              ({formatPrice(cheapestBurger.burger.price, { cents: "always" })}). The priciest is the {priciestBurger.burger.name} at{" "}
              <Link className="link" href={`/restaurants/${priciestBurger.restaurant.id}`}>
                {priciestBurger.restaurant.name}
              </Link>{" "}
              ({formatPrice(priciestBurger.burger.price, { cents: "always" })}).
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="section" aria-labelledby="hoods">
        <SectionHeading id="hoods" title={ranked.length ? `The priciest neighborhood is ${ranked[0].name}.` : "Neighborhoods need more menus."}>
          {ranked.length
            ? `We rank a neighborhood once it has at least five priced restaurants. ${pluralize(ranked.length, "neighborhood")} qualify so far.`
            : "We rank a neighborhood once it has at least five priced restaurants. None qualify yet."}
        </SectionHeading>
        <div className="mt-8">
          {ranked.length ? (
            <ChartFigure
              id="hood-range"
              title={ranked.length > 16 ? "The 8 priciest and 8 cheapest neighborhoods" : "Neighborhoods by median index price"}
              takeaway={
                ranked.length > 1
                  ? `${ranked[0].name} ${formatPrice(ranked[0].index_median, { cents: "always" })} at the top, ${ranked[ranked.length - 1].name} ${formatPrice(ranked[ranked.length - 1].index_median, { cents: "always" })} at the bottom.`
                  : `${ranked[0].name}: ${formatPrice(ranked[0].index_median, { cents: "always" })}.`
              }
              chart={<RangePlot areas={neighborhoodRows} cityMedian={median} labelledBy="hood-range-title hood-range-desc" />}
              table={<AreaTable areas={neighborhoodRows} />}
            />
          ) : (
            <ChartEmpty height={200}>No neighborhood has five priced restaurants yet.</ChartEmpty>
          )}
          <p className="mt-6">
            <Link href="/neighborhoods" className="btn btn-secondary">
              All neighborhoods
              <ArrowRight strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="explore">
        <SectionHeading id="explore" title="Look up any burger." />
        <p className="t-body muted prose-width mt-3">
          Search every burger we found by name, restaurant or neighborhood, or see the index prices on a map.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/burgers" className="btn btn-primary btn-lg">
            Browse all {formatCount(stats.burgers)} burgers
            <ArrowRight strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link href="/map" className="btn btn-secondary btn-lg">
            <MapIcon strokeWidth={1.75} aria-hidden="true" />
            Open the map
          </Link>
        </div>
      </section>
    </div>
  );
}
