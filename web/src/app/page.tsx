import { ArrowRight, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { PriceDistribution } from "@/components/charts/PriceDistribution";
import { AreaTable, RangePlot } from "@/components/charts/RangePlot";
import { JsonLd } from "@/components/JsonLd";
import { Letterboard } from "@/components/Letterboard";
import { QandA } from "@/components/QandA";
import { MenuEnds, menuEndsLists } from "@/components/RestaurantBits";
import { Buoy, Net, Scales, ShipWheel, Spatula, Spyglass } from "@/components/icons/nautical";
import { BoroughDot, Bubbles, Caustics, ChartEmpty, KickerTicket, SectionHeading, WaveEdge } from "@/components/ui";
import { cityFaq } from "@/lib/answers";
import { boroughInProse } from "@/lib/boroughs";
import { getBoroughs, getGeneratedAt, getMenuCounts, getPricedRestaurants, getStats, rankedNeighborhoods } from "@/lib/data";
import { CSV_PATH } from "@/lib/csv";
import { formatCount, formatDate, formatIsoDay, formatMonthYear, formatPrice, pluralize, spreadEnds } from "@/lib/format";
import { datasetNode, itemListNode, organizationNode, websiteNode } from "@/lib/jsonld";
import { menuIndexPrices, menusByIndexPrice, menusByIndexPriceDesc, type Menu } from "@/lib/menus";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { cheapestSpec, priciestSpec, rankingNameInSentence, rankingPath, rankMenus, topTied } from "@/lib/rankings";
import { homeSeo, sourceLine, type NamedPrice } from "@/lib/seo";

const named = (m: Menu | undefined): NamedPrice | null => (m ? { name: m.restaurant.name, price: m.indexPrice } : null);

const seo = homeSeo({
  median: getStats().index_median,
  menus: getMenuCounts().menus,
  generatedAt: getGeneratedAt(),
  cheapest: named(menusByIndexPrice(getPricedRestaurants())[0]),
  priciest: named(menusByIndexPriceDesc(getPricedRestaurants())[0]),
});

export const metadata = pageMetadata({ ...seo, path: "/" });

export default function HomePage() {
  const stats = getStats();
  const counts = getMenuCounts();
  const median = stats.index_median;
  const generated = getGeneratedAt();
  const restaurants = getPricedRestaurants();
  // Every chart, range and list below counts distinct menus: a chain once, however many locations.
  const prices = menuIndexPrices(restaurants);
  const cheapest = menusByIndexPrice(restaurants);
  const priciest = menusByIndexPriceDesc(restaurants);
  const boroughs = getBoroughs();
  const ranked = rankedNeighborhoods();

  const pricedBoroughs = boroughs
    .filter((b) => b.summary?.index_median != null)
    .sort((a, b) => (b.summary!.index_median as number) - (a.summary!.index_median as number));
  const boroughEnds = spreadEnds(pricedBoroughs, (b) => b.summary!.index_median);
  const boroughTitle = boroughEnds ? `The priciest borough is ${boroughEnds.top.name}.` : "Boroughs, once we have prices.";
  const boroughTakeaway = boroughEnds
    ? `${boroughEnds.top.name} ${formatPrice(boroughEnds.top.summary!.index_median, { cents: "always" })}, ${boroughEnds.bottom.name} ${formatPrice(boroughEnds.bottom.summary!.index_median, { cents: "always" })}.`
    : "The line marks the NYC median.";

  const hoodEnds = spreadEnds(ranked, (n) => n.index_median);
  const faq = cityFaq({
    generatedAt: generated,
    median,
    p10: stats.index_p10,
    p90: stats.index_p90,
    cheapest: topTied(rankMenus(restaurants, cheapestSpec()).rows),
    priciest: topTied(rankMenus(restaurants, priciestSpec()).rows),
    boroughs: pricedBoroughs.map((b) => ({ name: boroughInProse(b.name), href: `/boroughs/${b.slug}`, median: b.summary!.index_median as number })),
    neighborhoods: ranked.map((n) => ({ name: n.name, href: `/neighborhoods/${n.slug}`, median: n.index_median as number })),
  });
  const neighborhoodRows = ranked.length > 16 ? [...ranked.slice(0, 8), ...ranked.slice(-8)] : ranked;

  const jsonLd = [
    organizationNode(SITE_URL),
    websiteNode(SITE_URL, seo.description),
    datasetNode(SITE_URL, {
      name: "NYC burger prices",
      description: `Burger prices at ${pluralize(stats.restaurants_priced, "New York City restaurant")}: each restaurant's burger, its price in US dollars, the neighborhood, borough and price source, and a link to the restaurant's page. Updated ${formatMonthYear(generated)}.`,
      csvPath: CSV_PATH,
      generatedAt: generated,
      month: formatIsoDay(generated).slice(0, 7),
      keywords: ["burger prices", "New York City", "restaurant menu prices", "NYC neighborhoods"],
    }),
    // The cheapest and priciest cards below, list for list.
    ...(cheapest.length
      ? menuEndsLists(cheapest, priciest).map((list) =>
          itemListNode(SITE_URL, { name: list.title, order: list.order, entries: list.menus.map((m) => ({ name: m.restaurant.name, path: `/restaurants/${m.restaurant.id}` })) }),
        )
      : []),
  ];

  return (
    <>
      <JsonLd nodes={jsonLd} />
      {/* The view through the front window: sea water, surface ripples, bubbles in the gutters. The
          kicker ticket and H1 sit here (a lede only when nothing is priced), and the Order Board hangs in
          columns 6–12 at lg. */}
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
              {/* The menu count shows once, on the board line below. The source line is the one sourcing
                  sentence on the site (--ink: it sits on the darker water at lg). */}
              {median === null ? <p className="t-lede mt-5">No prices yet.</p> : <p className="t-ui-m mt-4 text-balance">{sourceLine(generated)}</p>}
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

      <section id="boroughs" className="section" aria-labelledby="boroughs-title">
        <SectionHeading id="boroughs-title" kicker="Five boroughs, one counter" icon={ShipWheel} title={boroughTitle} />
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
          {/* The five borough pages (this section replaced the /boroughs index). */}
          <ul className="mt-6 flex flex-wrap gap-3" aria-label="Borough pages">
            {boroughs.map((b) => (
              <li key={b.slug}>
                <Link href={`/boroughs/${b.slug}`} className="btn btn-secondary">
                  <BoroughDot borough={b.name} />
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {cheapest.length ? (
        <section className="section" aria-labelledby="cheap">
          <SectionHeading id="cheap" kicker="Catch of the day" icon={Net} title={`Where ${formatPrice(cheapest[0].indexPrice)} still gets you lunch.`} />
          <MenuEnds
            cheapest={cheapest}
            priciest={priciest}
            median={median}
            seeAll={{
              cheapest: { href: rankingPath(cheapestSpec()), what: rankingNameInSentence(cheapestSpec()) },
              priciest: { href: rankingPath(priciestSpec()), what: rankingNameInSentence(priciestSpec()) },
            }}
          />
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

      <QandA items={faq} />

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
            Browse all {formatCount(stats.restaurants_priced)} burgers
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
