// The signature element: the Order Board (DESIGN.md "The Order Board"). The headline price in chunky
// red sign-painter numerals on a yellow board that hangs from a beam on two ropes, with an "ORDER UP!"
// plaque, a service bell on the beam and a life ring on the corner. Yellow in both themes (it glows at
// night). The rig is decorative and aria-hidden; screen readers get the figure's label and one
// sr-only price. The board holds no focusable element. (Same props as the old letterboard.)
import { Fragment } from "react";
import { formatPrice, priceParts } from "@/lib/format";
import { BoardSeenMarker } from "./BoardSeenMarker";
import { LifeRing, OrderBell } from "./icons/nautical";

/**
 * `line` is the small print under the price. Given as parts, they are joined with " · " and each part
 * wraps as a unit (a part only breaks inside itself when it is wider than the board), so a narrow
 * board never splits "Updated Sep 23, 2026" across two lines.
 */
export function Letterboard({ overline, price, line }: { overline: string; price: number | null; line: string | readonly string[] }) {
  const parts = price !== null ? priceParts(price) : null;
  const lineParts = typeof line === "string" ? [line] : line;
  return (
    <figure className="board" aria-label={`${overline}: ${price !== null ? formatPrice(price, { cents: "always" }) : "no price yet"}`}>
      <div className="board-beam" aria-hidden="true">
        <span className="board-bolt" style={{ left: 10 }} />
        <span className="board-bolt" style={{ left: "calc(50% - 4px)" }} />
        <OrderBell className="board-bell" />
      </div>
      <div className="board-swing">
        <span className="board-rope board-rope-l" aria-hidden="true" />
        <span className="board-rope board-rope-r" aria-hidden="true" />
        <span className="board-eyelet board-eyelet-l" aria-hidden="true" />
        <span className="board-eyelet board-eyelet-r" aria-hidden="true" />
        <div className="board-frame">
          <span className="board-nail" aria-hidden="true" />
          <span className="board-nail" aria-hidden="true" />
          <span className="board-nail" aria-hidden="true" />
          <span className="board-nail" aria-hidden="true" />
          <span className="board-plaque t-plaque" aria-hidden="true">
            Order up!
          </span>
          <div className="board-face">
            <p className="t-label board-line">{overline}</p>
            {parts ? (
              <p className="board-price t-display-xl">
                <span className="sr-only">{formatPrice(price, { cents: "always" })}</span>
                {/* Drawn from data-text (see Money), so the price is in the page once, as the sr-only text. */}
                <span className="money" aria-hidden="true">
                  <span className="money-dollar" data-text="$" />
                  <span className="money-whole" data-text={parts.dollars} />
                  <span className="money-cents" data-text={parts.cents} />
                </span>
              </p>
            ) : (
              <p className="board-price t-display-xl" aria-hidden="true">
                —
              </p>
            )}
            <figcaption className="t-ui-m board-line">
              {lineParts.map((part, i) => (
                <Fragment key={i}>
                  {i ? " " : null}
                  <span className="inline-block">
                    {part}
                    {i < lineParts.length - 1 ? " ·" : null}
                  </span>
                </Fragment>
              ))}
            </figcaption>
          </div>
          <LifeRing className="board-ring" />
        </div>
      </div>
      <BoardSeenMarker />
    </figure>
  );
}
