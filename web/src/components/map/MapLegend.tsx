import { formatPrice } from "@/lib/format";
import { binRanges } from "@/lib/price-bins";

/**
 * Five swatch rows with name, $ range and % range (DESIGN.md "Map pin and legend"). `counts` are pins
 * (one per priced location, so every chain location counts), and the column is headed so.
 */
export function MapLegend({ median, counts }: { median: number; counts?: number[] }) {
  return (
    <div className="rounded-[4px] border border-line bg-surface p-3">
      <p className="t-label muted flex items-baseline justify-between gap-3">
        <span>Index price</span>
        {counts ? <span>Pins</span> : null}
      </p>
      <ul className="mt-2 grid gap-1.5">
        {binRanges(median).map((bin, i) => (
          <li key={bin.key} className="t-ui-s flex items-center gap-2">
            <span className="size-3 flex-none rounded-full" style={{ background: bin.color, boxShadow: "0 0 0 1.5px var(--pin-ring)" }} aria-hidden="true" />
            <span className="font-semibold">{bin.name}</span>
            <span className="t-num-s">{bin.dollars}</span>
            <span className="t-num-s muted">({bin.percent})</span>
            {counts ? <span className="t-num-s muted ml-auto pl-2">{counts[i]}</span> : null}
          </li>
        ))}
      </ul>
      <p className="t-ui-s muted mt-2">Colors vs NYC median {formatPrice(median, { cents: "always" })}</p>
    </div>
  );
}
