// Histogram of index prices in a <figure> with a table alternative (server wrapper).
import { formatCount, formatPrice, pluralize } from "@/lib/format";
import { binFor } from "@/lib/price-bins";
import { MIN_HISTOGRAM } from "@/lib/site";
import { binRangeLabel, histogram, percentile } from "@/lib/stats";
import { ChartEmpty } from "../ui";
import { ChartFigure } from "./ChartFigure";
import { Histogram } from "./Histogram";

export function PriceDistribution({
  id,
  prices,
  cityMedian,
  sliceMedian,
  sliceName = "NYC",
  chainOnly = false,
}: {
  id: string;
  /** Index prices in the slice, one per distinct menu (menuIndexPrices), ascending. */
  prices: number[];
  cityMedian: number | null;
  sliceMedian: number | null;
  sliceName?: string;
  /** The slice is priced from chain menus only: its takeaway says so first. */
  chainOnly?: boolean;
}) {
  if (prices.length < MIN_HISTOGRAM || cityMedian === null || sliceMedian === null) {
    return (
      <ChartEmpty height={296}>
        {prices.length === 0
          ? "No priced menus here yet."
          : `Only ${pluralize(prices.length, "priced menu")} here. Not enough to draw a distribution.`}
      </ChartEmpty>
    );
  }
  const p10 = percentile(prices, 0.1) as number;
  const p90 = percentile(prices, 0.9) as number;
  const lo = formatPrice(Math.floor(p10), { cents: "auto" });
  const hi = formatPrice(Math.ceil(p90), { cents: "auto" });
  // Says "these menus", not "NYC burgers": the slice is the menus priced so far, not every menu in town.
  const these = `Most of these ${formatCount(prices.length)} menus charge`;
  const spread = lo === hi ? `${these} about ${lo} for their cheapest beef burger` : `${these} ${lo}–${hi} for their cheapest beef burger`;
  const bins = histogram(prices, 1, 10);
  return (
    <ChartFigure
      id={id}
      title={`Index prices on ${formatCount(prices.length)} menus`}
      takeaway={`${chainOnly ? "Chain prices only. " : ""}${spread}; the median is ${formatPrice(sliceMedian, { cents: "always" })}. Bars count menus, so a chain counts once; they are colored by price level against the NYC median.`}
      chart={<Histogram prices={prices} median={cityMedian} mark={{ value: sliceMedian, label: `${sliceName} median` }} labelledBy={`${id}-title ${id}-desc`} />}
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Index price</th>
              <th scope="col" className="num">
                Menus
              </th>
              <th scope="col">Price level</th>
            </tr>
          </thead>
          <tbody>
            {bins
              .filter((b) => b.count > 0)
              .map((b) => {
                const bin = binFor((b.lo + b.hi) / 2, cityMedian);
                return (
                  <tr key={b.lo}>
                    <th scope="row">{binRangeLabel(b)}</th>
                    <td className="num">{formatCount(b.count)}</td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <span className="swatch" style={{ background: bin.color }} aria-hidden="true" />
                        {bin.name}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      }
    />
  );
}
