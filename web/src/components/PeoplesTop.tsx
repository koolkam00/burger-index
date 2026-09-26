// The People's Top 10 page's lists (DESIGN.md "The People's Top 10 page"), a data zone and server-safe: the
// ranked rows (the 10 seats, then the rest of the ranking) and the unnumbered Rising rows, each a restaurant
// (linked to its page) over its burger and where, the list count and the menu price. The board is the daily
// one (lib/peoples-top-data.ts); nothing here recomputes it.
import Link from "next/link";
import { pluralize } from "@/lib/format";
import type { Menu } from "@/lib/menus";
import { FLAG_TEXT, listsText, risingText, type RisingEntry, type RowFlag, type TopEntry } from "@/lib/peoples-top";
import { PriceChip } from "./ui";

/** "Astoria, Queens"; a chain with several locations: "5 locations"; no neighborhood: the borough. */
function whereOf(m: Menu): string {
  if (m.locations > 1) return pluralize(m.locations, "location");
  return m.restaurant.neighborhood ? `${m.restaurant.neighborhood}, ${m.restaurant.borough}` : m.restaurant.borough;
}

function Flag({ flag }: { flag: RowFlag }) {
  return flag ? <span className="ptop-flag t-ui-s">{FLAG_TEXT[flag]}</span> : null;
}

function What({ menu, detail, flag }: { menu: Menu; detail: string; flag: RowFlag }) {
  const r = menu.restaurant;
  return (
    <div className="ptop-what">
      <Link href={`/restaurants/${r.id}`} className="ui-link t-ui-l break-anywhere font-semibold">
        {r.name}
      </Link>
      <p className="t-ui-s muted break-anywhere">{`${r.burger.name} · ${whereOf(menu)}`}</p>
      <p className="t-ui-s ptop-lists">
        {detail}
        <Flag flag={flag} />
      </p>
    </div>
  );
}

/** Ranked rows: the rank ("≈" before it when too close to call with the row above), the burger and its price. */
export function PeoplesTopList({ entries, median, label }: { entries: readonly TopEntry<Menu>[]; median: number | null; label: string }) {
  return (
    <div className="ptop-shell">
      <ol className="ptop-board" aria-label={label}>
        {entries.map((e) => (
          <li key={e.key} className="ptop-row">
            <span className="ptop-rank">
              {e.closeToAbove ? (
                <span className="ptop-close" title="Too close to call with the burger above" aria-hidden="true">
                  ≈
                </span>
              ) : null}
              <span className="sr-only">Number </span>
              {e.rank}
              {e.closeToAbove ? <span className="sr-only">, too close to call with number {e.rank - 1}</span> : null}
            </span>
            <What menu={e.menu} detail={listsText(e.lists, e.firsts)} flag={e.flag} />
            <span className="ptop-price">
              <PriceChip price={e.menu.indexPrice} median={median} delta={false} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Rising rows: unnumbered, each with how many more lists it needs. */
export function RisingList({ entries, median }: { entries: readonly RisingEntry<Menu>[]; median: number | null }) {
  return (
    <div className="ptop-shell">
      <ul className="ptop-board is-rising" aria-label="Rising">
        {entries.map((e) => (
          <li key={e.key} className="ptop-row">
            <What menu={e.menu} detail={risingText(e.lists, e.needs)} flag={e.flag} />
            <span className="ptop-price">
              <PriceChip price={e.menu.indexPrice} median={median} delta={false} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
