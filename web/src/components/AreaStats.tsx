// The porthole tiles under a borough or neighborhood header (DESIGN.md "Stat tile"). The area's median
// shows once: on the Order Board when the area is ranked, else as the first tile here. The menu count
// shows once too: on the board line, else in the lede.
import { formatDelta, formatPrice } from "@/lib/format";
import { Money, MoneyRange, StatGrid, StatTile } from "./ui";

export function AreaStats({
  median,
  cityMedian,
  min,
  max,
  menus,
  withMedian,
}: {
  median: number | null;
  cityMedian: number | null;
  min: number | null;
  max: number | null;
  /** Distinct priced menus in the area. */
  menus: number;
  /** No board above: the median goes in a tile. */
  withMedian: boolean;
}) {
  // Both ends on one price (a single priced menu, or every one charging the same) is one value.
  const oneLevel = min !== null && formatPrice(min, { cents: "always" }) === formatPrice(max, { cents: "always" });
  return (
    <section className="mt-2" aria-label="Key numbers">
      <StatGrid>
        {withMedian ? <StatTile label="Median" value={median !== null ? <Money value={median} /> : "—"} sub="Index price" /> : null}
        <StatTile label="vs NYC" value={formatDelta(median, cityMedian)} sub={cityMedian !== null ? `NYC median ${formatPrice(cityMedian, { cents: "always" })}` : undefined} />
        <StatTile
          label="Range"
          value={oneLevel ? <Money value={min as number} /> : min !== null && max !== null ? <MoneyRange lo={min} hi={max} /> : "—"}
          sub={oneLevel ? (menus === 1 ? "One priced menu" : "Every index price here is the same") : "Cheapest to priciest index price"}
        />
      </StatGrid>
    </section>
  );
}
