import Link from "next/link";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { ShipWheel } from "@/components/icons/nautical";
import { BoroughDot, ChainOnlyBadge, Money, PageHeader } from "@/components/ui";
import { boroughInProse } from "@/lib/boroughs";
import { getBoroughs, getMenuCounts, getNeighborhoodsInBorough, getStats } from "@/lib/data";
import { capitalize, ends, formatDelta, formatPrice, pluralize } from "@/lib/format";
import { isChainOnly, joinList, shareOfCity, splitByCoverage } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";

// Name only the boroughs that have a median.
const withMedian = getBoroughs().filter((b) => b.summary?.index_median != null);

export const metadata = pageMetadata({
  title: "Boroughs",
  description: withMedian.length
    ? `What a burger costs in ${joinList(withMedian.map((b) => boroughInProse(b.name)))}: the median index price in each borough.`
    : "What a burger costs in each New York borough: the median index price, once its menus are priced.",
  path: "/boroughs",
});

export default function BoroughsPage() {
  const median = getStats().index_median;
  const boroughs = getBoroughs();
  const priced = boroughs.filter((b) => b.summary?.index_median != null).sort((a, b) => (b.summary!.index_median as number) - (a.summary!.index_median as number));
  // Like-for-like comparisons only between boroughs with independent menus; chain-only ones are named.
  const { comparable, chainOnly } = splitByCoverage(priced, (b) => b.menuCounts, (b) => b.summary?.index_median ?? null);
  const e = ends(comparable, (b) => b.summary!.index_median);
  const nyc = `The NYC median is ${formatPrice(median)}.`;
  let lede: string;
  if (e.kind === "spread")
    lede = `${e.top.name} is the priciest at ${formatPrice(e.top.summary!.index_median)}; ${boroughInProse(e.bottom.name)} is the cheapest at ${formatPrice(e.bottom.summary!.index_median)}. ${nyc}`;
  else if (e.kind === "tied")
    lede = `${comparable.length === boroughs.length ? "Every borough" : chainOnly.length ? "Every borough with independent menus" : "Every priced borough"} lands on ${formatPrice(e.top.summary!.index_median)}. ${nyc}`;
  else if (e.kind === "one")
    lede = chainOnly.length
      ? `Only ${e.top.name} has independent restaurants priced. Its median is ${formatPrice(e.top.summary!.index_median)}.`
      : `Only ${e.top.name} has priced restaurants. Its median is ${formatPrice(e.top.summary!.index_median)}.`;
  else if (chainOnly.length) lede = `Chain prices only. ${nyc}`;
  else lede = "Each borough's median index price.";

  // "Five boroughs, five medians" only when every borough has a like-for-like median.
  const title = comparable.length === boroughs.length ? "Five boroughs, five medians." : "Borough medians.";

  return (
    <>
      <PageHeader ticket="Five boroughs, one counter" ticketIcon={ShipWheel} title={title} lede={lede} />
      <div className="wrap">
      <section className="mt-2" aria-label="Borough comparison">
        <ChartFigure
          id="borough-bars"
          title="Median index price by borough"
          takeaway={`The line marks the NYC median${median !== null ? `, ${formatPrice(median, { cents: "always" })}` : ""}.${chainOnly.length ? ` ${capitalize(joinList(chainOnly.map((b) => boroughInProse(b.name))))}: chain prices only.` : ""}`}
          chart={<BoroughBars boroughs={boroughs} cityMedian={median} labelledBy="borough-bars-title borough-bars-desc" />}
          table={<BoroughTable boroughs={boroughs} />}
        />
      </section>
      <section className="section" aria-label="Boroughs">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {boroughs.map((b) => (
            <li key={b.slug}>
              <article className="card flex h-full flex-col">
                <h2 className="t-display-s flex items-center gap-2">
                  <BoroughDot borough={b.name} />
                  <Link href={`/boroughs/${b.slug}`} className="stretched">
                    {b.name}
                  </Link>
                </h2>
                <p className="t-stat mt-4">{b.summary?.index_median != null ? <Money value={b.summary.index_median} /> : "—"}</p>
                <p className="t-ui-s muted mt-2">
                  {b.menuCounts.menus ? (
                    <>
                      {/* No delta for a borough holding every menu of the NYC index: it would compare the median with itself. */}
                      {b.summary?.index_median != null && !isChainOnly(b.menuCounts) && shareOfCity(b.menuCounts, getMenuCounts()) !== "all"
                        ? `${formatDelta(b.summary.index_median, median, { suffix: "vs NYC" })} · `
                        : ""}
                      {pluralize(b.menuCounts.menus, "menu")} · {pluralize(b.summary?.restaurants_priced ?? 0, "location")} priced ·{" "}
                      {pluralize(getNeighborhoodsInBorough(b.name).length, "neighborhood")}
                    </>
                  ) : b.summary?.restaurants ? (
                    `Not priced yet · ${pluralize(b.summary.restaurants, "restaurant")}`
                  ) : (
                    "Not priced yet"
                  )}
                </p>
                {isChainOnly(b.menuCounts) ? (
                  <p className="mt-3">
                    <ChainOnlyBadge />
                  </p>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      </section>
      </div>
    </>
  );
}
