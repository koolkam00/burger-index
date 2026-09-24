import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaListItem, ChainMenuNote, SoleRanked } from "@/components/AreaList";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { PriceDistribution } from "@/components/charts/PriceDistribution";
import { AreaTable, RangePlot } from "@/components/charts/RangePlot";
import { Letterboard } from "@/components/Letterboard";
import { MENU_ENDS_SPLIT, MenuEnds } from "@/components/RestaurantBits";
import { Breadcrumbs, BoroughDot, ChainOnlyBadge, Money, PageHeader, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { BOROUGH_META, boroughInProse } from "@/lib/boroughs";
import {
  getBorough,
  getBoroughs,
  getGeneratedAt,
  getMenuCounts,
  getNeighborhoodsInBorough,
  getRestaurantsInBorough,
  getScope,
  getStats,
  rankedNeighborhoods,
  unrankedNeighborhoods,
} from "@/lib/data";
import { ends, formatCount, formatDate, formatDelta, formatPrice, pctDiff, pluralize } from "@/lib/format";
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
  shareOfCity,
} from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { chainLocationsWhere, lookedUpWhen, scopeWhere } from "@/lib/scope";
import { MIN_RANKED } from "@/lib/site";

/**
 * A borough with no restaurant in the dataset: not read yet while part of the scope is unread; once
 * everything in scope is in the dataset, the scope simply has no restaurant there.
 */
function unlistedLine(where: string): string {
  const scope = getScope();
  return scope.pending ? `We haven't read any menus in ${where} yet.` : `None of the restaurants ${scopeWhere(scope)} is in ${where}.`;
}

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
    ? `Burger prices in ${where}. ${unlistedLine(where)}`
    : b.summary.index_median != null
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
  const scope = getScope();
  const city = getMenuCounts();
  // All of the NYC index's menus are here: the borough median IS the NYC median, so no comparison.
  // Most of them: the comparison is mostly the borough against itself, and the copy says so.
  const cityShare = chainOnly ? null : shareOfCity(c, city);
  // No restaurant of this borough is in the dataset at all (its route comes from the fixed borough
  // list): one lede and the other boroughs for reference, no empty stats, chart or neighborhood list.
  const unlisted = !s || s.restaurants === 0;

  let lede: string;
  if (unlisted) lede = unlistedLine(where);
  else if (s.index_median === null) lede = `No priced restaurants in ${where} yet.`;
  else if (chainOnly)
    lede = `Chain prices only so far. Every priced menu in ${where} comes from ${pluralize(c.chains, "chain")} at ${pluralize(c.locations, "location")}${listedNames(chainNames(restaurants))}. ${
      c.chains === 1 ? "Its price" : "Their median"
    }, ${formatPrice(s.index_median)}, is not a like-for-like comparison with the NYC median of ${formatPrice(median)}.`;
  else if (cityShare === "all")
    lede = `Every menu priced${scope.pending ? " so far" : ""} is served in ${where}, so its median index price, ${formatPrice(s.index_median)}, is the NYC index${
      scope.pending ? " for now" : ""
    }. That is across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.`;
  else {
    // The median index price (each menu's cheapest beef burger), not "the median burger": the home
    // page's pooled every-burger median is a different, lower number.
    const vs = diff !== null && Math.abs(diff) >= 0.5 ? `${Math.round(Math.abs(diff))}% ${diff > 0 ? "above" : "below"} the NYC median of ${formatPrice(median)}` : "right at the NYC median";
    lede = `The median index price in ${where} is ${formatPrice(s.index_median)}, ${vs}. That is across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.${
      cityShare === "most" ? ` They are ${formatCount(c.menus)} of the ${formatCount(city.menus)} menus behind the NYC median.` : ""
    }`;
  }

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
              line={[`Cheapest beef burger on ${pluralize(c.menus, "menu")}`, `Updated ${formatDate(getGeneratedAt())}`]}
            />
          </div>
        ) : null}
      </div>

      {!unlisted ? (
        <section className="mt-10" aria-label="Key numbers">
          <StatGrid cols={cityShare === "all" ? 3 : 4}>
            <StatTile label="Median" value={s?.index_median != null ? <Money value={s.index_median} /> : "—"} sub={chainOnly ? "Chain prices only" : cityShare === "all" ? "Index price, per menu: the NYC index" : "Index price, per menu"} />
            {cityShare === "all" ? null : (
              <StatTile
                label="vs NYC"
                value={chainOnly ? "—" : formatDelta(s?.index_median ?? null, median)}
                sub={
                  chainOnly
                    ? "Not like for like: chain prices only"
                    : median !== null
                      ? `NYC median ${formatPrice(median, { cents: "always" })}${cityShare === "most" ? ` · ${formatCount(c.menus)} of its ${formatCount(city.menus)} menus are here` : ""}`
                      : undefined
                }
              />
            )}
            {/* Counts rows in the dataset: what we have looked up here, not the restaurants on our list. */}
            <StatTile
              label="Menus priced"
              value={formatCount(c.menus)}
              sub={
                c.menus
                  ? `${menuBreakdownShort(c)}, at ${pluralize(c.locations, "location")} of ${formatCount(s?.restaurants ?? 0)} ${lookedUpWhen(scope)}`
                  : `${pluralize(s?.restaurants ?? 0, "restaurant")} ${lookedUpWhen(scope)}`
              }
            />
            <StatTile label="Burgers priced" value={formatCount(s?.burgers ?? 0)} sub={`${formatCount(beefBurgers)} beef · a row per location`} />
          </StatGrid>
        </section>
      ) : null}

      <section className={unlisted ? "mt-10" : "section"} aria-labelledby="compare">
        <SectionHeading id="compare" title={chainOnly || unlisted ? "The other boroughs, for reference." : "Against the other boroughs."} />
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

      {!unlisted ? (
        <section className="section" aria-labelledby="spread">
          <SectionHeading id="spread" title={`How ${b.name} prices spread.`} />
          <div className="mt-8">
            <PriceDistribution id="hist-borough" prices={prices} cityMedian={median} sliceMedian={s?.index_median ?? null} sliceName={b.name} chainOnly={chainOnly} />
          </div>
        </section>
      ) : null}

      {hoods.length ? (
        <section className="section" aria-labelledby="hoods">
          <SectionHeading id="hoods" title={`${b.name} neighborhoods.`}>
            {ranked.length === 1
              ? `Only ${ranked[0].name} has at least ${MIN_RANKED} priced menus so far (a chain counts once), so it is the only one ranked.`
              : ranked.length
                ? `Ranked once they have at least ${MIN_RANKED} priced menus, counting a chain once.`
                : `None has ${MIN_RANKED} priced menus yet (a chain counts once), so none is ranked.`}
          </SectionHeading>
          {/* Nothing ranked: the intro says so and leads straight into the list (no second empty box). */}
          <div className={ranked.length ? "mt-8" : ""}>
            {ranked.length === 1 ? (
              <SoleRanked area={ranked[0]} cityMedian={median} cityMenus={getMenuCounts()} />
            ) : ranked.length ? (
              <ChartFigure
                id="hood-range"
                title={`${b.name} neighborhoods by median index price`}
                takeaway={`${
                  hoodEnds.kind === "spread"
                    ? `${hoodEnds.top.name} is the priciest at ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.`
                    : hoodEnds.kind === "tied"
                      ? `All ranked neighborhoods with independent menus sit at ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.`
                      : hoodEnds.kind === "one"
                        ? `${hoodEnds.top.name} is the only ranked neighborhood with independent menus, at ${formatPrice(hoodEnds.top.index_median, { cents: "always" })}.`
                        : "Every ranked neighborhood here is priced from chain menus only so far."
                }${hoodEnds.kind !== "none" && ranked.some((n) => isChainOnly(n.menuCounts)) ? " Rows marked “Chain prices only” have no independent restaurant priced yet." : ""}`}
                chart={<RangePlot areas={ranked} cityMedian={median} labelledBy="hood-range-title hood-range-desc" />}
                table={<AreaTable areas={ranked} />}
              />
            ) : null}
            {unranked.length ? (
              <div className={ranked.length ? "mt-8" : "mt-6"}>
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
      ) : null}

      {cheapest.length ? (
        <section className="section" aria-labelledby="ends">
          <SectionHeading id="ends" title={cheapest.length >= MENU_ENDS_SPLIT ? `The cheapest and priciest in ${where}.` : `Every priced menu in ${where}.`}>
            {chainOnly
              ? `Chain prices only so far: every menu below is a chain's, counted once however many ${b.name} locations it has.`
              : `One card per menu: a chain appears once, with the number of its ${b.name} locations${chainLocationsWhere(scope)} that share its price.`}
          </SectionHeading>
          <MenuEnds cheapest={cheapest} priciest={priciest} median={median} chainCount={{ noun: `${b.name} location`, where: chainLocationsWhere(scope) }} />
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
