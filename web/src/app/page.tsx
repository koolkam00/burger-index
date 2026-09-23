import { ArrowRight, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { PriceDistribution } from "@/components/charts/PriceDistribution";
import { AreaTable, RangePlot } from "@/components/charts/RangePlot";
import { Letterboard } from "@/components/Letterboard";
import { MenuEnds } from "@/components/RestaurantBits";
import { ChartEmpty, Money, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { boroughInProse } from "@/lib/boroughs";
import { allBurgers, getBoroughs, getBurger, getGeneratedAt, getMenuCounts, getRestaurants, getStats, rankedNeighborhoods } from "@/lib/data";
import { capitalize, ends, formatCount, formatDate, formatPrice, pluralize } from "@/lib/format";
import { isChainOnly, joinList, listedMenus, menuBreakdown, menuBreakdownShort, menuIndexPrices, menusByIndexPrice, menusByIndexPriceDesc, splitByCoverage } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { MIN_RANKED } from "@/lib/site";

const homeMedian = getStats().index_median;

export const metadata = {
  ...pageMetadata({
    title: "What a burger costs in New York",
    description:
      homeMedian !== null
        ? `The NYC Burger Index is ${formatPrice(homeMedian, { cents: "always" })}: the median price of the cheapest beef burger across ${pluralize(getMenuCounts().menus, "New York menu")}, each chain counted once. By borough, neighborhood and restaurant.`
        : "The NYC Burger Index: the median price of the cheapest beef burger at every New York restaurant we could price.",
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
  // Everything we looked up, a chain counted once (its locations share one lookup).
  const listed = listedMenus(restaurants);
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
  const boroughEnds = ends(comparable, (b) => b.summary!.index_median);
  const chainOnlyNames = joinList(chainOnly.map((b) => boroughInProse(b.name)));
  const comparableNames = joinList(comparable.map((b) => boroughInProse(b.name)));
  const boroughTitle =
    pricedBoroughs.length === 0
      ? "Boroughs, once we have prices."
      : boroughEnds.kind === "none"
        ? "Only chain menus are priced so far."
        : boroughEnds.kind === "one"
          ? chainOnly.length
            ? `Only ${boroughEnds.top.name} has independent restaurants priced so far.`
            : `Only ${boroughEnds.top.name} has priced restaurants so far.`
          : boroughEnds.kind === "tied"
            ? `${comparable.length === boroughs.length ? "Every borough" : chainOnly.length ? "Every borough with independent menus" : "Every borough we have priced"} lands on ${formatPrice(boroughEnds.top.summary!.index_median)}.`
            : `The priciest borough is ${boroughEnds.top.name}.`;
  const chainOnlyLine = chainOnly.length
    ? `Chain prices only so far in ${chainOnlyNames}: no independent restaurant there is priced yet, so ${chainOnly.length === 1 ? "its bar is a chain median" : "their bars are chain medians"}, not a like-for-like comparison${comparable.length ? ` with ${comparableNames}` : ""}.`
    : null;
  const boroughTakeaway = [
    boroughEnds.kind === "spread"
      ? `${boroughEnds.top.name} ${formatPrice(boroughEnds.top.summary!.index_median, { cents: "always" })}, ${boroughEnds.bottom.name} ${formatPrice(boroughEnds.bottom.summary!.index_median, { cents: "always" })}.`
      : boroughEnds.kind === "tied"
        ? `The median is ${formatPrice(boroughEnds.top.summary!.index_median, { cents: "always" })} in every borough with independent menus.`
        : boroughEnds.kind === "one"
          ? `${boroughEnds.top.name}: ${formatPrice(boroughEnds.top.summary!.index_median, { cents: "always" })} across ${pluralize(boroughEnds.top.menuCounts.menus, "menu")}.`
          : null,
    chainOnly.length ? `${capitalize(chainOnlyNames)}: chain prices only.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  // The neighborhood headline compares like for like too; chain-only ranked rows stay labelled.
  const hoodEnds = ends(
    ranked.filter((n) => !isChainOnly(n.menuCounts)),
    (n) => n.index_median,
  );
  const neighborhoodRows = ranked.length > 16 ? [...ranked.slice(0, 8), ...ranked.slice(-8)] : ranked;
  const rankRule = `We rank a neighborhood once it has at least ${MIN_RANKED} priced menus, counting a chain once.`;

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
                We looked up {listed.chains ? `${pluralize(listed.independents, "New York restaurant")} and ${pluralize(listed.chains, "chain")} (${pluralize(listed.locations, "location")} in all)` : pluralize(listed.independents, "New York restaurant")}{" "}
                and recorded the cheapest beef burger on every menu we could price: {pluralize(counts.menus, "menu")}, from {menuBreakdown(counts)}.
                {counts.chains ? " A chain counts once, however many locations it has." : ""} Half of those menus charge more than {formatPrice(median)}. Half charge less.
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
            line={`Cheapest beef burger on ${pluralize(counts.menus, "menu")} · Updated ${formatDate(generated)}`}
          />
        </div>
      </section>

      <section className="mt-10 md:mt-12" aria-label="Key numbers">
        <StatGrid>
          <StatTile
            label="Typical range"
            value={
              stats.index_p10 !== null && stats.index_p90 !== null && stats.index_p10 === stats.index_p90 ? (
                <Money value={stats.index_p10} />
              ) : stats.index_p10 !== null && stats.index_p90 !== null ? (
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
            sub="Middle 80% of the menus"
          />
          <StatTile
            label="Menus priced"
            value={formatCount(counts.menus)}
            sub={counts.menus ? `${menuBreakdownShort(counts)}, at ${pluralize(stats.restaurants_priced, "location")}` : `of ${formatCount(stats.restaurants_scanned)} restaurants`}
          />
          <StatTile label="Burgers priced" value={formatCount(stats.burgers)} sub={`${formatCount(stats.beef_burgers)} beef · a row per location`} />
          <StatTile
            label="Every burger, median"
            value={stats.all_burgers_median !== null ? <Money value={stats.all_burgers_median} /> : "—"}
            sub="Every priced item on those menus"
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
          Each bar counts menus by their index price, the cheapest beef burger on the menu. A chain is one menu, not one bar entry per location.
        </SectionHeading>
        <div className="mt-8">
          <PriceDistribution id="hist-city" prices={prices} cityMedian={median} sliceMedian={median} />
        </div>
      </section>

      <section className="section" aria-labelledby="boroughs">
        <SectionHeading id="boroughs" title={boroughTitle}>
          {chainOnlyLine}
        </SectionHeading>
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
            <ChartEmpty height={220}>No borough has a priced restaurant yet.</ChartEmpty>
          )}
        </div>
      </section>

      {cheapest.length ? (
        <section className="section" aria-labelledby="cheap">
          <SectionHeading id="cheap" title={`Where ${formatPrice(cheapest[0].indexPrice)} still gets you lunch.`}>
            One card per menu: a chain appears once, with the number of locations that share its price.
          </SectionHeading>
          <MenuEnds cheapest={cheapest} priciest={priciest} median={median} />
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
        <SectionHeading
          id="hoods"
          title={
            hoodEnds.kind === "none"
              ? ranked.length
                ? "Only chain menus rank so far."
                : "Neighborhoods need more menus."
              : hoodEnds.kind === "one"
                ? ranked.length === 1
                  ? `Only ${hoodEnds.top.name} has enough priced menus to rank so far.`
                  : `${hoodEnds.top.name} is the only ranked neighborhood with independent menus.`
                : hoodEnds.kind === "tied"
                  ? `Every ranked neighborhood lands on ${formatPrice(hoodEnds.top.index_median)}.`
                  : `The priciest neighborhood is ${hoodEnds.top.name}.`
          }
        >
          {ranked.length
            ? `${rankRule} ${pluralize(ranked.length, "neighborhood")} ${ranked.length === 1 ? "qualifies" : "qualify"} so far.`
            : `${rankRule} None qualify yet.`}
        </SectionHeading>
        <div className="mt-8">
          {ranked.length ? (
            <ChartFigure
              id="hood-range"
              title={ranked.length > 16 ? "The 8 priciest and 8 cheapest neighborhoods" : "Neighborhoods by median index price"}
              takeaway={`${
                hoodEnds.kind === "spread"
                  ? `${hoodEnds.top.name} ${formatPrice(hoodEnds.top.index_median, { cents: "always" })} at the top, ${hoodEnds.bottom.name} ${formatPrice(hoodEnds.bottom.index_median, { cents: "always" })} at the bottom.`
                  : hoodEnds.kind === "tied"
                    ? `All ranked neighborhoods with independent menus sit at ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.`
                    : hoodEnds.kind === "one"
                      ? `${hoodEnds.top.name}: ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.`
                      : "Every ranked neighborhood is priced from chain menus only so far."
              }${hoodEnds.kind !== "none" && ranked.some((n) => isChainOnly(n.menuCounts)) ? " Rows marked “Chain prices only” have no independent restaurant priced yet." : ""}`}
              chart={<RangePlot areas={neighborhoodRows} cityMedian={median} labelledBy="hood-range-title hood-range-desc" />}
              table={<AreaTable areas={neighborhoodRows} />}
            />
          ) : (
            <ChartEmpty height={200}>No neighborhood has {MIN_RANKED} priced menus yet.</ChartEmpty>
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
            Browse all {formatCount(burgerRows)} burgers
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
