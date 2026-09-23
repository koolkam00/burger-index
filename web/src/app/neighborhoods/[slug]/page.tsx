import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaListItem, ChainMenuNote } from "@/components/AreaList";
import { Letterboard } from "@/components/Letterboard";
import { RestaurantTable } from "@/components/RestaurantBits";
import { Breadcrumbs, BoroughName, ChainOnlyBadge, Money, PageHeader, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { boroughSlug } from "@/lib/boroughs";
import {
  getGeneratedAt,
  getNeighborhood,
  getNeighborhoods,
  getNeighborhoodsInBorough,
  getRestaurantsInNeighborhood,
  getStats,
  neighborhoodMenuCounts,
  withMenuCounts,
} from "@/lib/data";
import { formatCount, formatDate, formatDelta, formatPrice, pctDiff, pluralize } from "@/lib/format";
import { chainNames, isChainOnly, isRankable, joinSome, menuBreakdown, menuBreakdownShort } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { atLeastOneParam, PLACEHOLDER_PARAM } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return atLeastOneParam(getNeighborhoods().map((n) => ({ slug: n.slug })), { slug: PLACEHOLDER_PARAM });
}

export async function generateMetadata({ params }: PageProps<"/neighborhoods/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const n = getNeighborhood(slug);
  if (!n) return {};
  const c = neighborhoodMenuCounts(slug);
  const description =
    n.index_median !== null
      ? isChainOnly(c)
        ? `Burger prices in ${n.name}, ${n.borough}: chain prices only so far (${pluralize(c.chains, "chain menu")}, median ${formatPrice(n.index_median, { cents: "always" })}).`
        : `What a burger costs in ${n.name}, ${n.borough}: median index price ${formatPrice(n.index_median, { cents: "always" })} across ${pluralize(c.menus, "priced menu")}.`
      : `Burger prices in ${n.name}, ${n.borough}.`;
  return pageMetadata({ title: `${n.name} burger prices`, description, path: `/neighborhoods/${n.slug}` });
}

export default async function NeighborhoodPage({ params }: PageProps<"/neighborhoods/[slug]">) {
  const { slug } = await params;
  const n = getNeighborhood(slug);
  if (!n) notFound();
  const median = getStats().index_median;
  const restaurants = getRestaurantsInNeighborhood(slug);
  const c = neighborhoodMenuCounts(slug);
  const chainOnly = isChainOnly(c);
  const siblings = withMenuCounts(getNeighborhoodsInBorough(n.borough).filter((x) => x.slug !== slug));
  // Ranked on distinct menus: five McDonald's here are one menu.
  const ranked = isRankable(c, n.index_median);
  // A chain median is not this neighborhood's burger price: no board to screenshot.
  const showBoard = ranked && !chainOnly;
  const diff = n.index_median !== null && median !== null ? pctDiff(n.index_median, median) : null;
  // Both ends on one price (a single priced menu, or every one charging the same) is one value.
  const oneLevel = n.index_min !== null && formatPrice(n.index_min, { cents: "always" }) === formatPrice(n.index_max, { cents: "always" });
  const chains = joinSome(chainNames(restaurants), 3);

  let lede: string;
  if (n.index_median === null) lede = `We found ${pluralize(n.restaurants, "restaurant")} here but no priced beef burger yet.`;
  else if (chainOnly && !ranked)
    lede =
      c.menus === 1
        ? `Chain prices only so far: the only priced menu here is a chain's (${chains}). Not enough to call it a trend.`
        : `Chain prices only so far: every priced menu here belongs to a chain (${chains}). Only ${pluralize(c.menus, "priced menu")} here, not enough to call it a trend.`;
  else if (chainOnly)
    lede = `Chain prices only so far: all ${formatCount(c.menus)} priced menus here belong to chains (${chains}), so the ${formatPrice(n.index_median)} median is not a like-for-like comparison with neighborhoods where we have read independent menus.`;
  else if (!ranked) lede = `Only ${pluralize(c.menus, "priced menu")} here (${menuBreakdown(c)}). Not enough to call it a trend.`;
  else if (diff !== null && Math.abs(diff) >= 0.5)
    lede = `The median burger here costs ${formatPrice(n.index_median)}, ${Math.round(Math.abs(diff))}% ${diff > 0 ? "above" : "below"} the NYC median of ${formatPrice(median)}, across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.`;
  else lede = `The median burger here costs ${formatPrice(n.index_median)}, right at the NYC median, across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.`;

  return (
    <div className="wrap">
      <div className="pt-6 md:pt-8">
        <Breadcrumbs
          items={[
            { href: "/neighborhoods", label: "Neighborhoods" },
            { href: `/boroughs/${boroughSlug(n.borough)}`, label: n.borough },
            { label: n.name },
          ]}
        />
      </div>
      <div className={showBoard ? "grid gap-8 lg:grid-cols-12 lg:items-end" : ""}>
        <div className={showBoard ? "min-w-0 lg:col-span-5" : ""}>
          <PageHeader
            overline={
              <span className="flex flex-wrap items-center gap-3">
                <BoroughName borough={n.borough} />
                {chainOnly ? <ChainOnlyBadge /> : null}
              </span>
            }
            title={n.name}
            lede={lede}
          />
        </div>
        {showBoard ? (
          <div className="min-w-0 lg:col-span-7">
            <Letterboard
              overline={`The Burger Index · ${n.name} median`}
              price={n.index_median}
              line={`Cheapest beef burger on ${pluralize(c.menus, "menu")} · Updated ${formatDate(getGeneratedAt())}`}
            />
          </div>
        ) : null}
      </div>

      <section className="mt-10" aria-label="Key numbers">
        <StatGrid>
          <StatTile label="Median" value={n.index_median !== null ? <Money value={n.index_median} /> : "—"} sub={chainOnly ? "Chain prices only" : ranked ? "Index price, per menu" : "Too few to rank"} />
          <StatTile
            label="vs NYC"
            value={chainOnly ? "—" : formatDelta(n.index_median, median)}
            sub={chainOnly ? "Not like for like: chain prices only" : median !== null ? `NYC median ${formatPrice(median, { cents: "always" })}` : undefined}
          />
          <StatTile
            label="Range"
            value={
              oneLevel ? (
                <Money value={n.index_min as number} />
              ) : n.index_min !== null && n.index_max !== null ? (
                <span className="inline-flex flex-wrap items-start gap-x-1">
                  <Money value={n.index_min} />
                  <span aria-hidden="true">–</span>
                  <span className="sr-only">to</span>
                  <Money value={n.index_max} />
                </span>
              ) : (
                "—"
              )
            }
            sub={oneLevel ? (c.menus === 1 ? "One priced menu" : "Every index price here is the same") : "Cheapest to priciest index price"}
          />
          <StatTile
            label="Menus priced"
            value={formatCount(c.menus)}
            sub={c.menus ? `${menuBreakdownShort(c)}, at ${pluralize(c.locations, "location")} of ${formatCount(n.restaurants)} listed` : `${formatCount(n.restaurants)} listed`}
          />
        </StatGrid>
      </section>

      <section className="section" aria-labelledby="places">
        <SectionHeading id="places" title={`Every restaurant in ${n.name}.`}>
          Sorted by index price, cheapest first.
          {restaurants.some((r) => r.chain) ? " Every location is listed; a chain's locations share one menu, so they count as one menu above." : ""}
        </SectionHeading>
        <div className="mt-6">
          <RestaurantTable restaurants={restaurants} median={median} showNeighborhood={false} caption={`Restaurants in ${n.name}`} />
        </div>
        <p className="mt-4">
          <Link className="link t-ui-m" href={`/burgers?neighborhood=${encodeURIComponent(n.slug)}`}>
            Every burger in {n.name}
          </Link>
        </p>
      </section>

      {siblings.length ? (
        <section className="section" aria-labelledby="nearby">
          <SectionHeading id="nearby" title={`Elsewhere in ${n.borough}.`} />
          <ul className="mt-6 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {siblings.map((s) => (
              <AreaListItem key={s.slug} area={s} />
            ))}
          </ul>
          <ChainMenuNote areas={siblings} />
        </section>
      ) : null}
    </div>
  );
}
