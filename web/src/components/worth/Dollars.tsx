import { formatDollars } from "@/lib/worth";

/**
 * Whole dollars as a display number (answers, People's Prices): the "$" at half size and
 * top-aligned, like the price cards, with no cents.
 */
export function Dollars({ value }: { value: number }) {
  return (
    <span className="money">
      <span className="sr-only">{formatDollars(value)}</span>
      <span aria-hidden="true" className="money-dollar">
        $
      </span>
      <span aria-hidden="true" className="money-whole">
        {Math.round(value)}
      </span>
    </span>
  );
}
