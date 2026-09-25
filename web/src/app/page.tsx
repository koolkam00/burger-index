import { ArrowRight, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { PriceDistribution } from "@/components/charts/PriceDistribution";
import { AreaTable, RangePlot } from "@/components/charts/RangePlot";
import { Letterboard } from "@/components/Letterboard";
import { MenuEnds } from "@/components/RestaurantBits";
import { Anchor, Buoy, LobsterTrap, Net, OrderBell, Scales, ShipWheel, Spatula, Spyglass } from "@/components/icons/nautical";
import { Bubbles, Caustics, ChartEmpty, KickerTicket, Money, MoneyRange, SectionHeading, StatGrid, StatTile, WaveEdge } from "@/components/ui";
import { boroughInProse } from "@/lib/boroughs";
import { allBurgers, getBoroughs, getBurger, getGeneratedAt, getMenuCounts, getRestaurants, getScope, getStats, rankedNeighborhoods } from "@/lib/data";
import { capitalize, formatCount, formatDate, formatPrice, pluralize, spreadEnds } from "@/lib/format";
import { isChainOnly, joinList, menuBreakdown, menuBreakdownShort, menuIndexPrices, menusByIndexPrice, menusByIndexPriceDesc, splitByCoverage } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";

const homeMedian = getStats().index_median;

export const metadata = {
  ...pageMetadata({
    title: "What a burger costs in New York",
    description:
      homeMedian !== null
        ? `The NYC Burger Index is ${formatPrice(homeMedian, { cents: "always" })}. Burger prices by borough, neighborhood and restaurant.`
        : "The NYC Burger Index: burger prices by borough, neighborhood and restaurant.",
    path: "/",
  }),
  title: { absolute: "The Burger Index: what a burger costs in New York" },
};

export default function HomePage() {
  const stats = getStats();
  const counts = getMenuCounts();
  const median = stats.index_median;
  const generated = getGeneratedAt();
  const restaurants = getRestaurants();
  // Whether part of the restaurant list is still unread (the "Looked up so far" tile).
  const scope = getScope();
  const burgerRows = allBurgers().length;
  // Every chart, range and list below counts distinct menus: a chain once, however many locations.
  const prices = menuIndexPrices(restaurants);
  const cheapest = menusByIndexPrice(restaurants);
  const priciest = menusByIndexPriceDesc(restaurants);
  const boroughs = getBoroughs();
  const ranked = rankedNeighborhoods();
  const cheapestBurger = getBurger(stats.cheapest_burger_id);
  const priciestBurger = getBurger(stats.priciest_burger_id);

  // Boroughs are compared like for like: only those with independent menus. Chain-only ones are
  // still drawn, labelled, and named in the copy.
  const pricedBoroughs = boroughs
    .filter((b) => b.summary?.index_median != null)
    .sort((a, b) => (b.summary!.index_median as number) - (a.summary!.index_median as number));
  const { comparable, chainOnly } = splitByCoverage(pricedBoroughs, (b) => b.menuCounts, (b) => b.summary?.index_median ?? null);
  const boroughEnds = spreadEnds(comparable, (b) => b.summary!.index_median);
  const chainOnlyNames = joinList(chainOnly.map((b) => boroughInProse(b.name)));
  const boroughTitle = boroughEnds ? `The priciest borough is ${boroughEnds.top.name}.` : "Boroughs, once we have prices.";
  const boroughTakeaway = [
    boroughEnds
      ? `${boroughEnds.top.name} ${formatPrice(boroughEnds.top.summary!.index_median, { cents: "always" })}, ${boroughEnds.bottom.name} ${formatPrice(boroughEnds.bottom.summary!.index_median, { cents: "always" })}.`
      : "The line marks the NYC median.",
    chainOnly.length ? `${capitalize(chainOnlyNames)}: chain prices only.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  // The neighborhood headline compares like for like too; chain-only ranked rows stay labelled.
  const hoodEnds = spreadEnds(
    ranked.filter((n) => !isChainOnly(n.menuCounts)),
    (n) => n.index_median,
  );
  const neighborhoodRows = ranked.length > 16 ? [...ranked.slice(0, 8), ...ranked.slice(-8)] : ranked;

  return (
    <>
      {/* The view through the front window: sea water, surface ripples, bubbles in the gutters. The
          kicker ticket, H1 and lede sit here, and the Order Board hangs in columns 6–12 at lg. */}
      <section className="hero atmo" aria-labelledby="hero-title">
        <Caustics id="caustic-hero" />
        <Bubbles />
        <div className="wrap band-body">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end lg:gap-8">
            <div className="min-w-0 lg:col-span-5 lg:pb-6">
              <KickerTicket>Now serving · NYC</KickerTicket>
              <h1 id="hero-title" className="t-display-l mt-5">
                What a burger costs in New York.
              </h1>
              <p className="t-lede mt-5">
                {median !== null ? `${pluralize(counts.menus, "menu")} priced: ${menuBreakdown(counts)}.` : "No prices yet."}
              </p>
            </div>
            <div className="min-w-0 lg:col-span-7">
              <Letterboard
                overline="The Burger Index · NYC median"
                price={median}
                line={[pluralize(counts.menus, "menu"), `Updated ${formatDate(generated)}`]}
              />
            </div>
          </div>
        </div>
        <WaveEdge />
      </section>

      {/* Portholes along the counter, on a trap-net band. */}
      <section className="counter" aria-label="Key numbers">
        <div className="wrap">
          <StatGrid>
            <StatTile
              label="Typical range"
              icon={Anchor}
              value={
                stats.index_p10 !== null && stats.index_p90 !== null && stats.index_p10 === stats.index_p90 ? (
                  <Money value={stats.index_p10} />
                ) : stats.index_p10 !== null && stats.index_p90 !== null ? (
                  <MoneyRange lo={stats.index_p10} hi={stats.index_p90} />
                ) : (
                  "—"
                )
              }
              sub={`Across ${pluralize(counts.menus, "menu")}`}
            />
            <StatTile
              label="Menus priced"
              icon={Spatula}
              value={formatCount(counts.menus)}
              sub={counts.menus ? `${menuBreakdownShort(counts)}, at ${pluralize(stats.restaurants_priced, "location")}` : `of ${formatCount(stats.restaurants_scanned)} restaurants`}
            />
            {/* While part of the list is still unread, how much of it is read beats a burger count. */}
            {scope.pending ? (
              <StatTile label="Looked up so far" icon={Spyglass} value={formatCount(scope.lookedUp)} sub="Restaurants" />
            ) : (
              <StatTile label="Burgers priced" icon={OrderBell} value={formatCount(stats.burgers)} sub={`${formatCount(stats.beef_burgers)} beef`} />
            )}
            <StatTile
              label="Every burger, pooled"
              icon={LobsterTrap}
              value={stats.all_burgers_median !== null ? <Money value={stats.all_burgers_median} /> : "—"}
              sub="Median price, any protein"
            />
          </StatGrid>
        </div>
      </section>

      <div className="wrap">
      <section className="mt-10 md:mt-16" aria-labelledby="spread">
        <SectionHeading
          id="spread"
          kicker="Fresh off the grill"
          icon={Spatula}
          title={
            // p10–p90 of index prices (one per menu), not of every burger.
            stats.index_p10 !== null && stats.index_p90 !== null && Math.floor(stats.index_p10) !== Math.ceil(stats.index_p90)
              ? `Most index prices fall between ${formatPrice(Math.floor(stats.index_p10))} and ${formatPrice(Math.ceil(stats.index_p90))}.`
              : "How the prices spread."
          }
        />
        <div className="mt-8">
          <PriceDistribution id="hist-city" prices={prices} cityMedian={median} sliceMedian={median} />
        </div>
      </section>

      <section className="section" aria-labelledby="boroughs">
        <SectionHeading id="boroughs" kicker="Five boroughs, one counter" icon={ShipWheel} title={boroughTitle} />
        <div className="mt-8">
          {pricedBoroughs.length ? (
            <ChartFigure
              id="borough-bars"
              title="Median index price by borough"
              takeaway={boroughTakeaway}
              chart={<BoroughBars boroughs={boroughs} cityMedian={median} labelledBy="borough-bars-title borough-bars-desc" />}
              table={<BoroughTable boroughs={boroughs} />}
            />
          ) : (
            <ChartEmpty height={220}>No borough has a priced restaurant yet. The grill&apos;s still warming up.</ChartEmpty>
          )}
        </div>
      </section>

      {cheapest.length ? (
        <section className="section" aria-labelledby="cheap">
          <SectionHeading id="cheap" kicker="Catch of the day" icon={Net} title={`Where ${formatPrice(cheapest[0].indexPrice)} still gets you lunch.`} />
          <MenuEnds cheapest={cheapest} priciest={priciest} median={median} />
          {cheapestBurger && priciestBurger ? (
            <p className="t-body muted prose-width mt-6">
              Cheapest burger of any kind: the {cheapestBurger.burger.name} at{" "}
              <Link className="link" href={`/restaurants/${cheapestBurger.restaurant.id}`}>
                {cheapestBurger.restaurant.name}
              </Link>{" "}
              ({formatPrice(cheapestBurger.burger.price, { cents: "always" })}). Priciest: the {priciestBurger.burger.name} at{" "}
              <Link className="link" href={`/restaurants/${priciestBurger.restaurant.id}`}>
                {priciestBurger.restaurant.name}
              </Link>{" "}
              ({formatPrice(priciestBurger.burger.price, { cents: "always" })}).
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="section" aria-labelledby="hoods">
        <SectionHeading
          id="hoods"
          kicker="Neighborhood specials"
          icon={Buoy}
          title={hoodEnds ? `The priciest neighborhood is ${hoodEnds.top.name}.` : "Neighborhoods, once they're ranked."}
        >
          {ranked.length ? `${pluralize(ranked.length, "neighborhood")} ranked.` : null}
        </SectionHeading>
        <div className="mt-8">
          {ranked.length ? (
            <ChartFigure
              id="hood-range"
              title={ranked.length > 16 ? "The 8 priciest and 8 cheapest neighborhoods" : "Neighborhoods by median index price"}
              takeaway={
                hoodEnds
                  ? `${hoodEnds.top.name} ${formatPrice(hoodEnds.top.index_median, { cents: "always" })} at the top, ${hoodEnds.bottom.name} ${formatPrice(hoodEnds.bottom.index_median, { cents: "always" })} at the bottom.`
                  : "The line marks the NYC median."
              }
              chart={<RangePlot areas={neighborhoodRows} cityMedian={median} labelledBy="hood-range-title hood-range-desc" />}
              table={<AreaTable areas={neighborhoodRows} />}
            />
          ) : (
            <ChartEmpty height={200}>No neighborhood is ranked yet.</ChartEmpty>
          )}
          <p className="mt-6">
            <Link href="/neighborhoods" className="btn btn-secondary">
              All neighborhoods
              <ArrowRight strokeWidth={2} aria-hidden="true" />
            </Link>
          </p>
        </div>
      </section>

      {/* "What's it worth?": a link only, so the home page never loads the Supabase client. */}
      <section className="section" aria-labelledby="worth">
        <SectionHeading id="worth" kicker="What's it worth?" icon={Scales} title="What would you pay for a burger?">
          Name your price for any burger, then see what everyone else would pay.
        </SectionHeading>
        <p className="mt-6">
          <Link href="/peoples-price" className="btn btn-primary btn-lg">
            See the People&apos;s Price
            <ArrowRight strokeWidth={2} aria-hidden="true" />
          </Link>
        </p>
      </section>

      <section className="section" aria-labelledby="explore">
        <SectionHeading id="explore" kicker="Cast a line" icon={Spyglass} title="Look up any burger." />
        <p className="t-body muted prose-width mt-3">
          Search every burger by name, restaurant or neighborhood, or see the index prices on a map.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/burgers" className="btn btn-primary btn-lg">
            Browse all {formatCount(burgerRows)} burgers
            <ArrowRight strokeWidth={2} aria-hidden="true" />
          </Link>
          <Link href="/map" className="btn btn-secondary btn-lg">
            <MapIcon strokeWidth={2} aria-hidden="true" />
            Open the map
          </Link>
        </div>
      </section>
      </div>
    </>
  );
}
