import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaListItem, ChainMenuNote } from "@/components/AreaList";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { PriceDistribution } from "@/components/charts/PriceDistribution";
import { AreaTable, RangePlot } from "@/components/charts/RangePlot";
import { Letterboard } from "@/components/Letterboard";
import { MENU_ENDS_SPLIT, MenuEnds } from "@/components/RestaurantBits";
import { Breadcrumbs, BoroughDot, ChainOnlyBadge, ChartEmpty, Money, PageHeader, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { BOROUGH_META, boroughInProse } from "@/lib/boroughs";
import { getBorough, getBoroughs, getGeneratedAt, getNeighborhoodsInBorough, getRestaurantsInBorough, getStats, rankedNeighborhoods, unrankedNeighborhoods } from "@/lib/data";
import { ends, formatCount, formatDate, formatDelta, formatPrice, pctDiff, pluralize } from "@/lib/format";
import { chainNames, isChainOnly, isRankable, joinSome, menuBreakdown, menuBreakdownShort, menuIndexPrices, menusByIndexPrice, menusByIndexPriceDesc } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { MIN_RANKED } from "@/lib/site";

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
      ? isChainOnly(c)
        ? `Burger prices in ${where}: chain prices only so far. The median of ${pluralize(c.chains, "chain menu")} is ${formatPrice(b.summary.index_median, { cents: "always" })}; no independent ${b.name} restaurant is priced yet.`
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
  // Per menu, within the borough: a chain counts once here however many locations it has.
  const prices = menuIndexPrices(restaurants);
  const cheapest = menusByIndexPrice(restaurants);
  const priciest = menusByIndexPriceDesc(restaurants);
  // Same count as the summary's `burgers` (priced burgers, any protein, a row per location), beef only.
  const beefBurgers = restaurants.reduce((n, r) => n + r.burgers.filter((x) => x.price !== null && x.protein === "beef").length, 0);
  const hoods = getNeighborhoodsInBorough(b.name);
  const ranked = rankedNeighborhoods(hoods);
  const hoodEnds = ends(
    ranked.filter((n) => !isChainOnly(n.menuCounts)),
    (n) => n.index_median,
  );
  const unranked = unrankedNeighborhoods(hoods);
  const rankable = s !== null && isRankable(c, s.index_median);
  // A chain median is not the borough's burger price: no board to screenshot until independents are in.
  const showBoard = rankable && !chainOnly;
  const diff = s?.index_median != null && median !== null ? pctDiff(s.index_median, median) : null;
  const where = boroughInProse(b.name);

  let lede: string;
  if (!s || s.index_median === null) lede = `No priced restaurants in ${where} yet.`;
  else if (chainOnly)
    lede = `Chain prices only so far. Every priced menu in ${where} belongs to a chain: ${pluralize(c.chains, "chain")} at ${pluralize(c.locations, "location")}, including ${joinSome(chainNames(restaurants), 3)}. Their median, ${formatPrice(s.index_median)}, is not a like-for-like comparison with the NYC median of ${formatPrice(median)}.`;
  else if (diff !== null && Math.abs(diff) >= 0.5)
    lede = `The median ${b.name} burger costs ${formatPrice(s.index_median)}, ${Math.round(Math.abs(diff))}% ${diff > 0 ? "above" : "below"} the NYC median of ${formatPrice(median)}. That is across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.`;
  else lede = `The median ${b.name} burger costs ${formatPrice(s.index_median)}, right at the NYC median. That is across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.`;

  return (
    <div className="wrap">
      <div className="pt-6 md:pt-8">
        <Breadcrumbs items={[{ href: "/boroughs", label: "Boroughs" }, { label: b.name }]} />
      </div>
      <div className={showBoard ? "grid gap-8 lg:grid-cols-12 lg:items-end" : ""}>
        <div className={showBoard ? "min-w-0 lg:col-span-5" : ""}>
          <PageHeader
            overline={
              <span className="flex flex-wrap items-center gap-3">
                <span className="t-label muted inline-flex items-center gap-2">
                  <BoroughDot borough={b.name} />
                  Borough
                </span>
                {chainOnly ? <ChainOnlyBadge /> : null}
              </span>
            }
            title={b.name}
            lede={lede}
          />
        </div>
        {showBoard ? (
          <div className="min-w-0 lg:col-span-7">
            <Letterboard
              overline={`The Burger Index · ${b.name} median`}
              price={s.index_median}
              line={`Cheapest beef burger on ${pluralize(c.menus, "menu")} · Updated ${formatDate(getGeneratedAt())}`}
            />
          </div>
        ) : null}
      </div>

      <section className="mt-10" aria-label="Key numbers">
        <StatGrid>
          <StatTile label="Median" value={s?.index_median != null ? <Money value={s.index_median} /> : "—"} sub={chainOnly ? "Chain prices only" : "Index price, per menu"} />
          <StatTile
            label="vs NYC"
            value={chainOnly ? "—" : formatDelta(s?.index_median ?? null, median)}
            sub={chainOnly ? "Not like for like: chain prices only" : median !== null ? `NYC median ${formatPrice(median, { cents: "always" })}` : undefined}
          />
          <StatTile
            label="Menus priced"
            value={formatCount(c.menus)}
            sub={c.menus ? `${menuBreakdownShort(c)}, at ${pluralize(c.locations, "location")} of ${formatCount(s?.restaurants ?? 0)} listed` : `${formatCount(s?.restaurants ?? 0)} restaurants listed`}
          />
          <StatTile label="Burgers priced" value={formatCount(s?.burgers ?? 0)} sub={`${formatCount(beefBurgers)} beef · a row per location`} />
        </StatGrid>
      </section>

      <section className="section" aria-labelledby="compare">
        <SectionHeading id="compare" title={chainOnly ? "The other boroughs, for reference." : "Against the other boroughs."} />
        <div className="mt-8">
          <ChartFigure
            id="borough-bars"
            title="Median index price by borough"
            takeaway={`${s?.index_median != null ? `${b.name}: ${formatPrice(s.index_median, { cents: "always" })}${chainOnly ? ", chain prices only" : ""}. ` : ""}The line marks the NYC median.${
              getBoroughs().some((x) => x.slug !== b.slug && isChainOnly(x.menuCounts)) ? " Boroughs marked “Chain prices only” have no independent restaurant priced yet." : ""
            }`}
            chart={<BoroughBars boroughs={getBoroughs()} cityMedian={median} current={b.slug} labelledBy="borough-bars-title borough-bars-desc" />}
            table={<BoroughTable boroughs={getBoroughs()} />}
          />
        </div>
      </section>

      <section className="section" aria-labelledby="spread">
        <SectionHeading id="spread" title={`How ${b.name} prices spread.`} />
        <div className="mt-8">
          <PriceDistribution id="hist-borough" prices={prices} cityMedian={median} sliceMedian={s?.index_median ?? null} sliceName={b.name} chainOnly={chainOnly} />
        </div>
      </section>

      <section className="section" aria-labelledby="hoods">
        <SectionHeading id="hoods" title={`${b.name} neighborhoods.`}>
          {ranked.length
            ? `Ranked once they have at least ${MIN_RANKED} priced menus, counting a chain once.`
            : `None has ${MIN_RANKED} priced menus yet (a chain counts once), so none is ranked.`}
        </SectionHeading>
        <div className="mt-8">
          {ranked.length ? (
            <ChartFigure
              id="hood-range"
              title={`${b.name} neighborhoods by median index price`}
              takeaway={`${
                hoodEnds.kind === "spread"
                  ? `${hoodEnds.top.name} is the priciest at ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.`
                  : hoodEnds.kind === "tied"
                    ? `All ranked neighborhoods with independent menus sit at ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.`
                    : hoodEnds.kind === "one"
                      ? `${ranked.length === 1 ? "Only " : ""}${hoodEnds.top.name}${ranked.length === 1 ? " is ranked so far" : " is the only ranked neighborhood with independent menus"}, at ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.`
                      : "Every ranked neighborhood here is priced from chain menus only so far."
              }${hoodEnds.kind !== "none" && ranked.some((n) => isChainOnly(n.menuCounts)) ? " Rows marked “Chain prices only” have no independent restaurant priced yet." : ""}`}
              chart={<RangePlot areas={ranked} cityMedian={median} labelledBy="hood-range-title hood-range-desc" />}
              table={<AreaTable areas={ranked} />}
            />
          ) : (
            <ChartEmpty height={120}>Not enough priced menus in any {b.name} neighborhood to rank.</ChartEmpty>
          )}
          {unranked.length ? (
            <div className="mt-8">
              <h3 className="t-label muted">Too few to rank</h3>
              <ul className="mt-2 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                {unranked.map((n) => (
                  <AreaListItem key={n.slug} area={n} />
                ))}
              </ul>
              <ChainMenuNote areas={unranked} />
            </div>
          ) : null}
        </div>
      </section>

      {cheapest.length ? (
        <section className="section" aria-labelledby="ends">
          <SectionHeading id="ends" title={cheapest.length >= MENU_ENDS_SPLIT ? `The cheapest and priciest in ${where}.` : `Every priced menu in ${where}.`}>
            {chainOnly
              ? `Chain prices only so far: every menu below is a chain's, counted once however many ${b.name} locations it has.`
              : `One card per menu: a chain appears once, with the number of ${b.name} locations that share its price.`}
          </SectionHeading>
          <MenuEnds cheapest={cheapest} priciest={priciest} median={median} />
          <p className="mt-6">
            <Link href={`/burgers?borough=${b.slug}`} className="btn btn-secondary">
              Every burger in {where}
              <ArrowRight strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
