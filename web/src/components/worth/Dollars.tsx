import { formatDollars } from "@/lib/worth";

/**
 * Whole dollars as a display number (answers, People's Prices): the "$" at half size and
 * top-aligned, like the price cards, with no cents. Like Money, the visible parts are drawn from
 * `data-text`, so the page holds the amount once, as the sr-only text.
 */
export function Dollars({ value }: { value: number }) {
  return (
    <span className="money">
      <span className="sr-only">{formatDollars(value)}</span>
      <span aria-hidden="true" className="money-dollar" data-text="$" />
      <span aria-hidden="true" className="money-whole" data-text={String(Math.round(value))} />
    </span>
  );
}
