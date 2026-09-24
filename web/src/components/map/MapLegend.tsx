import { formatPrice } from "@/lib/format";
import { binRanges } from "@/lib/price-bins";

/**
 * The "depth chart" plaque: five buoy swatches with name, $ range and % range, cheap to pricey
 * (DESIGN.md "Map pin and legend"). `counts` are pins (one per priced location, so every chain
 * location counts), and the column is headed so.
 */
export function MapLegend({ median, counts }: { median: number; counts?: number[] }) {
  return (
    <div className="legend-plaque">
      <p className="t-label muted flex items-baseline justify-between gap-3">
        <span>Depth chart · index price</span>
        {counts ? <span>Pins</span> : null}
      </p>
      <ul className="mt-2 grid grid-cols-[14px_auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5">
        {binRanges(median).map((bin, i) => (
          <li key={bin.key} className="contents">
            <span className="buoy-swatch" style={{ background: bin.color }} aria-hidden="true" />
            <span className="t-ui-m font-semibold whitespace-nowrap">{bin.name}</span>
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="t-num-m whitespace-nowrap">{bin.dollars}</span>
              <span className="t-num-s muted whitespace-nowrap">({bin.percent})</span>
            </span>
            {counts ? <span className="t-num-s muted pl-2 text-right">{counts[i]}</span> : <span />}
          </li>
        ))}
      </ul>
      <p className="t-ui-s muted mt-2 max-w-[34ch]">
        Colors vs NYC median {formatPrice(median, { cents: "always" })}. The deeper the water, the pricier the burger.
      </p>
    </div>
  );
}
