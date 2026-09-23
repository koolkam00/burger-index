// The signature element: the headline price on a grooved black letterboard (DESIGN.md).
// Stays black in both themes. Glyph spans are aria-hidden; screen readers get one sr-only price.
import { formatPrice, priceParts } from "@/lib/format";
import { BoardSeenMarker } from "./BoardSeenMarker";

function Glyphs({ text, start }: { text: string; start: number }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="board-glyph" style={{ ["--i" as string]: start + i }}>
          {ch}
        </span>
      ))}
    </>
  );
}

export function Letterboard({ overline, price, line }: { overline: string; price: number | null; line: string }) {
  const parts = price !== null ? priceParts(price) : null;
  return (
    <figure className="letterboard" aria-label={`${overline}: ${price !== null ? formatPrice(price, { cents: "always" }) : "no price yet"}`}>
      <p className="t-label" style={{ color: "var(--board-muted)" }}>
        {overline}
      </p>
      {parts ? (
        <p className="board-price t-display-xl">
          <span className="sr-only">{formatPrice(price, { cents: "always" })}</span>
          <span className="money" aria-hidden="true">
            <span className="money-dollar">
              <Glyphs text="$" start={0} />
            </span>
            <span>
              <Glyphs text={parts.dollars} start={1} />
            </span>
            <span className="money-cents">
              <Glyphs text={parts.cents} start={1 + parts.dollars.length} />
            </span>
          </span>
        </p>
      ) : (
        <p className="board-price t-display-xl" aria-hidden="true">
          <span className="board-glyph">—</span>
        </p>
      )}
      <figcaption className="t-ui-m" style={{ color: "var(--board-muted)" }}>
        {line}
      </figcaption>
      <BoardSeenMarker />
    </figure>
  );
}
