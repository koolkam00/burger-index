import Link from "next/link";
import { BoroughBars, BoroughTable } from "@/components/charts/BoroughBars";
import { ChartFigure } from "@/components/charts/ChartFigure";
import { BoroughDot, ChainOnlyBadge, Money, PageHeader } from "@/components/ui";
import { BOROUGH_META, boroughInProse } from "@/lib/boroughs";
import { getBoroughs, getMenuCounts, getNeighborhoodsInBorough, getScope, getStats } from "@/lib/data";
import { capitalize, ends, formatDelta, formatPrice, pluralize } from "@/lib/format";
import { isChainOnly, joinList, shareOfCity, splitByCoverage } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { lookedUpWhen } from "@/lib/scope";

// Name only the boroughs that have a median, and say so when some don't yet.
const withMedian = getBoroughs().filter((b) => b.summary?.index_median != null);

export const metadata = pageMetadata({
  title: "Boroughs",
  description: withMedian.length
    ? `What a burger costs in ${joinList(withMedian.map((b) => boroughInProse(b.name)))}: the median index price in each borough${withMedian.length < BOROUGH_META.length ? " we have priced so far" : ""}.`
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
  const chainLine = chainOnly.length
    ? ` ${capitalize(joinList(chainOnly.map((b) => boroughInProse(b.name))))} ${chainOnly.length === 1 ? "is" : "are"} priced from chain menus only so far, so ${chainOnly.length === 1 ? "its median is a chain price" : "their medians are chain prices"}, not a like-for-like comparison.`
    : "";
  let lede: string;
  if (e.kind === "spread")
    lede = `${e.top.name} is the priciest at ${formatPrice(e.top.summary!.index_median)}; ${boroughInProse(e.bottom.name)} is the cheapest at ${formatPrice(e.bottom.summary!.index_median)}. ${nyc}${chainLine}`;
  else if (e.kind === "tied")
    lede = `${comparable.length === boroughs.length ? "Every borough" : chainOnly.length ? "Every borough with independent menus" : "Every borough we have priced"} lands on ${formatPrice(e.top.summary!.index_median)}. ${nyc}${chainLine}`;
  else if (e.kind === "one")
    lede = chainOnly.length
      ? `Only ${e.top.name} has independent restaurants priced so far. Its median is ${formatPrice(e.top.summary!.index_median)}.${chainLine}`
      : `Only ${e.top.name} has priced restaurants so far. Its median is ${formatPrice(e.top.summary!.index_median)}.`;
  else if (chainOnly.length) lede = `Chain prices only so far: no borough has an independent restaurant priced yet. ${nyc}`;
  else lede = "Each borough's median index price: the middle of its menus' cheapest beef burgers, with a chain counted once.";

  // "Five boroughs, five medians" only when every borough has a like-for-like median.
  const title = comparable.length === boroughs.length ? "Five boroughs, five medians." : "Borough medians.";

  return (
    <div className="wrap">
      <PageHeader title={title} lede={lede} />
      <section className="mt-10" aria-label="Borough comparison">
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
                    `Not priced yet · ${pluralize(b.summary.restaurants, "restaurant")} ${lookedUpWhen(getScope())}`
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
  );
}
