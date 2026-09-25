import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaListItem } from "@/components/AreaList";
import { Letterboard } from "@/components/Letterboard";
import { RestaurantTable } from "@/components/RestaurantBits";
import { Buoy, Spyglass } from "@/components/icons/nautical";
import { BoroughName, ChainOnlyBadge, DetailOverline, Money, MoneyRange, PageHeader, SectionHeading, StatGrid, StatTile } from "@/components/ui";
import { boroughInProse, boroughSlug } from "@/lib/boroughs";
import {
  getGeneratedAt,
  getMenuCounts,
  getNeighborhood,
  getNeighborhoods,
  getNeighborhoodsInBorough,
  getRestaurantsInNeighborhood,
  getStats,
  neighborhoodMenuCounts,
  withMenuCounts,
} from "@/lib/data";
import { formatCount, formatDate, formatDelta, formatPrice, pctDiff, pluralize } from "@/lib/format";
import { chainNames, isChainOnly, isRankable, joinSome, menuBreakdown, menuBreakdownShort, shareOfCity } from "@/lib/menus";
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
        ? `Burger prices in ${n.name}, ${n.borough}: ${pluralize(c.menus, "chain menu")}, median ${formatPrice(n.index_median, { cents: "always" })}.`
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
  // Ranked on distinct menus (menus.ts isRankable).
  const ranked = isRankable(c, n.index_median);
  // A chain median is not this neighborhood's burger price: no board to screenshot.
  const showBoard = ranked && !chainOnly;
  const diff = n.index_median !== null && median !== null ? pctDiff(n.index_median, median) : null;
  // Both ends on one price (a single priced menu, or every one charging the same) is one value.
  const oneLevel = n.index_min !== null && formatPrice(n.index_min, { cents: "always" }) === formatPrice(n.index_max, { cents: "always" });
  const chains = joinSome(chainNames(restaurants), 3);
  const city = getMenuCounts();
  // All of the NYC index's menus are here: the neighborhood median IS the NYC median, so no comparison.
  // Most of them: the comparison is mostly the neighborhood against itself, and the copy says so.
  const cityShare = chainOnly ? null : shareOfCity(c, city);

  let lede: string;
  if (n.index_median === null) lede = `${pluralize(n.restaurants, "restaurant")} here, none priced.`;
  else if (chainOnly) lede = `${pluralize(c.menus, "priced menu")} here: ${menuBreakdown(c)}${chains ? ` (${chains})` : ""}.`;
  else if (!ranked) lede = `${pluralize(c.menus, "priced menu")} here: ${menuBreakdown(c)}.`;
  else if (cityShare === "all") lede = `The median index price here is ${formatPrice(n.index_median)}, across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.`;
  else {
    // The median index price (one per menu), not "the median burger": the home page's pooled
    // every-burger median is a different number.
    const vs = diff !== null && Math.abs(diff) >= 0.5 ? `${Math.round(Math.abs(diff))}% ${diff > 0 ? "above" : "below"} the NYC median of ${formatPrice(median)}` : "right at the NYC median";
    lede = `The median index price here is ${formatPrice(n.index_median)}, ${vs}, across ${pluralize(c.menus, "menu")}: ${menuBreakdown(c)}.`;
  }

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
          >
            {chainOnly ? <ChainOnlyBadge /> : null}
          </DetailOverline>
        }
        title={n.name}
        lede={lede}
        aside={
          showBoard ? (
            <Letterboard
              overline={`The Burger Index · ${n.name} median`}
              price={n.index_median}
              line={[pluralize(c.menus, "menu"), `Updated ${formatDate(getGeneratedAt())}`]}
            />
          ) : undefined
        }
      />
      <div className="wrap">
      <section className="mt-2" aria-label="Key numbers">
        <StatGrid cols={cityShare === "all" ? 3 : 4}>
          <StatTile
            label="Median"
            value={n.index_median !== null ? <Money value={n.index_median} /> : "—"}
            sub={chainOnly ? "Chain prices only" : "Index price"}
          />
          {cityShare === "all" ? null : (
            <StatTile
              label="vs NYC"
              value={chainOnly ? "—" : formatDelta(n.index_median, median)}
              sub={
                chainOnly ? "Chain prices only" : median !== null ? `NYC median ${formatPrice(median, { cents: "always" })}` : undefined
              }
            />
          )}
          <StatTile
            label="Range"
            value={
              oneLevel ? (
                <Money value={n.index_min as number} />
              ) : n.index_min !== null && n.index_max !== null ? (
                <MoneyRange lo={n.index_min} hi={n.index_max} />
              ) : (
                "—"
              )
            }
            sub={oneLevel ? (c.menus === 1 ? "One priced menu" : "Every index price here is the same") : "Cheapest to priciest index price"}
          />
          <StatTile
            label="Menus priced"
            value={formatCount(c.menus)}
            sub={c.menus ? `${menuBreakdownShort(c)}, at ${pluralize(c.locations, "location")}` : `${pluralize(n.restaurants, "restaurant")}, none priced`}
          />
        </StatGrid>
      </section>

      <section className="section" aria-labelledby="places">
        <SectionHeading
          id="places"
          kicker="Cast a line"
          icon={Spyglass}
          title={`Restaurants in ${n.name}.`}
        >
          Sorted by index price, cheapest first.
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
