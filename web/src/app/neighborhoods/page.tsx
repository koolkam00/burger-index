import { AreaListItem, ChainMenuNote, SoleRanked } from "@/components/AreaList";
import { NeighborhoodRanking } from "@/components/NeighborhoodRanking";
import { BoroughDot, PageHeader, SectionHeading } from "@/components/ui";
import { BOROUGH_META } from "@/lib/boroughs";
import { getNeighborhoods, getStats, rankedNeighborhoods, unrankedNeighborhoods } from "@/lib/data";
import { ends, formatCount, formatPrice } from "@/lib/format";
import { isChainOnly } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { MIN_RANKED } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Neighborhoods",
  description:
    rankedNeighborhoods().length > 1
      ? "New York neighborhoods ranked by the median price of a burger, with the cheapest and priciest index price in each."
      : "New York neighborhoods and the price of a burger in each: the median, cheapest and priciest index price, once a neighborhood has enough priced menus.",
  path: "/neighborhoods",
});

export default function NeighborhoodsPage() {
  const median = getStats().index_median;
  const all = getNeighborhoods();
  const ranked = rankedNeighborhoods();
  const unranked = unrankedNeighborhoods();
  // The headline compares like for like: ranked neighborhoods with independent menus.
  const rankedChainOnly = ranked.filter((n) => isChainOnly(n.menuCounts));
  const e = ends(
    ranked.filter((n) => !isChainOnly(n.menuCounts)),
    (n) => n.index_median,
  );
  const qualify = `${formatCount(ranked.length)} of ${formatCount(all.length)} neighborhoods have at least ${MIN_RANKED} priced menus, enough to rank. A chain counts once, however many locations it has there.`;
  const chainNote = rankedChainOnly.length
    ? ` ${rankedChainOnly.length === 1 ? "One ranked neighborhood is" : `${formatCount(rankedChainOnly.length)} ranked neighborhoods are`} priced from chain menus only so far and marked “Chain prices only”.`
    : "";
  let lede: string;
  if (e.kind === "spread")
    lede = `${qualify} ${e.top.name} is the priciest at ${formatPrice(e.top.index_median)}; ${e.bottom.name} is the cheapest at ${formatPrice(e.bottom.index_median)}.${chainNote}`;
  else if (e.kind === "tied") lede = `${qualify} Every one with independent menus lands on ${formatPrice(e.top.index_median)}.${chainNote}`;
  else if (e.kind === "one")
    lede =
      ranked.length === 1
        ? `Only 1 of ${formatCount(all.length)} neighborhoods has at least ${MIN_RANKED} priced menus, enough to rank: ${e.top.name}, at ${formatPrice(e.top.index_median)}. A chain counts once.`
        : `${qualify} ${e.top.name}, at ${formatPrice(e.top.index_median)}, is the only one with independent menus.${chainNote}`;
  else if (ranked.length) lede = `${qualify}${chainNote}`;
  else lede = `We rank a neighborhood once it has at least ${MIN_RANKED} priced menus, counting a chain once. None has that many yet.`;

  return (
    <div className="wrap">
      {/* A ranking needs two rows: with one, it is a single row of numbers, not a sortable table. */}
      <PageHeader title={ranked.length > 1 ? "Neighborhoods, ranked." : "Neighborhoods."} lede={lede} />

      {ranked.length === 1 ? (
        <section className="mt-8" aria-label="The ranked neighborhood">
          <SoleRanked area={ranked[0]} cityMedian={median} />
          <p className="t-ui-s muted mt-3">
            Median and range use each menu&apos;s index price, its cheapest beef burger, with a chain counted once per neighborhood. NYC median{" "}
            {formatPrice(median, { cents: "always" })}.
          </p>
        </section>
      ) : ranked.length ? (
        <section className="mt-8" aria-label="Ranked neighborhoods">
          <NeighborhoodRanking areas={ranked} cityMedian={median} />
          <p className="t-ui-s muted mt-3">
            Median, range and rank use each menu&apos;s index price, its cheapest beef burger, with a chain counted once per neighborhood. NYC median{" "}
            {formatPrice(median, { cents: "always" })}.
          </p>
        </section>
      ) : null}

      {unranked.length ? (
        <section className="section" aria-labelledby="too-few">
          <SectionHeading id="too-few" title="Too few to rank.">
            Fewer than {MIN_RANKED} priced menus each. Not enough to call it a trend. Five locations of one chain are one menu.
          </SectionHeading>
          <div className="mt-6 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {BOROUGH_META.map((m) => {
              const list = unranked.filter((n) => n.borough === m.name);
              if (!list.length) return null;
              const chainOnly = list.filter((n) => isChainOnly(n.menuCounts)).length;
              const priced = list.filter((n) => n.menuCounts.menus > 0).length;
              return (
                <div key={m.slug} className="min-w-0">
                  <h3 className="t-label muted flex items-center gap-2">
                    <BoroughDot borough={m.name} />
                    {m.name}
                  </h3>
                  {chainOnly && chainOnly === priced ? (
                    <p className="t-ui-s muted mt-1">
                      Chain prices only so far: {chainOnly === 1 ? "the priced neighborhood here has" : `none of these ${formatCount(chainOnly)} priced neighborhoods has`}{" "}
                      {chainOnly === 1 ? "no" : "an"} independent restaurant priced yet.
                    </p>
                  ) : null}
                  <ul className="mt-2">
                    {list.map((n) => (
                      <AreaListItem key={n.slug} area={n} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <ChainMenuNote areas={unranked} />
        </section>
      ) : null}
    </div>
  );
}
