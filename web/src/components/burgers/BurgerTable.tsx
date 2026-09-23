// Presentational table for the burger explorer. No hooks and no "use client": the server renders
// it as the static fallback, and the client explorer renders it with sorting wired up.
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ExBurger, ExRestaurant, SortKey } from "@/lib/explorer";
import { formatDelta, formatPrice } from "@/lib/format";
import { PROTEIN_LABEL } from "@/lib/labels";
import { IndexTag, PriceChip, SourceBadge } from "../ui";

export type TableRow = { b: ExBurger; r: ExRestaurant };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps query matches in <mark>. */
export function Highlight({ text, tokens }: { text: string; tokens: string[] }): ReactNode {
  if (!tokens.length) return text;
  const re = new RegExp(`(${tokens.map(escapeRe).join("|")})`, "gi");
  const parts = text.split(re);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
}

function SortHeader({
  label,
  keyAsc,
  keyDesc,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  keyAsc: SortKey;
  keyDesc?: SortKey;
  sort: SortKey;
  onSort?: (s: SortKey) => void;
  className?: string;
}) {
  const active = sort === keyAsc || sort === keyDesc;
  const dir = sort === keyAsc ? "ascending" : sort === keyDesc ? "descending" : undefined;
  const Icon = dir === "ascending" ? ArrowUp : dir === "descending" ? ArrowDown : ArrowUpDown;
  if (!onSort) {
    return (
      <th scope="col" className={className} aria-sort={dir}>
        {label}
      </th>
    );
  }
  return (
    <th scope="col" className={className} aria-sort={dir}>
      <button
        type="button"
        className="sort-btn"
        onClick={() => onSort(active && keyDesc && sort === keyAsc ? keyDesc : keyAsc)}
        aria-label={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <Icon strokeWidth={1.75} aria-hidden="true" className={active ? "" : "opacity-50"} />
      </button>
    </th>
  );
}

export function BurgerTable({
  rows,
  median,
  tokens = [],
  sort,
  onSort,
}: {
  rows: TableRow[];
  median: number | null;
  tokens?: string[];
  sort: SortKey;
  onSort?: (s: SortKey) => void;
}) {
  return (
    <table className="data-table">
      <caption className="sr-only">Burgers with their restaurant, price source and price</caption>
      <thead>
        <tr>
          <SortHeader label="Burger" keyAsc="name" sort={sort} onSort={onSort} />
          <SortHeader label="Restaurant" keyAsc="restaurant" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
          <th scope="col" className="hidden lg:table-cell">
            Source
          </th>
          <SortHeader label="Price" keyAsc="price" keyDesc="-price" sort={sort} onSort={onSort} className="num" />
          <th scope="col" className="num hidden sm:table-cell">
            vs NYC
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ b, r }) => {
          const href = `/restaurants/${r.id}#${b.id}`;
          const where = r.nb ?? r.borough;
          const delivery = r.source === "delivery_app";
          return (
            <tr key={b.id}>
              <td className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={href} className="ui-link break-anywhere font-semibold">
                    <Highlight text={b.name} tokens={tokens} />
                  </Link>
                  {b.idx ? <IndexTag /> : null}
                </div>
                <div className="t-ui-s muted break-anywhere sm:hidden">
                  <Highlight text={r.name} tokens={tokens} /> · <Highlight text={where} tokens={tokens} />
                </div>
                <div className="t-ui-s muted hidden sm:block">{PROTEIN_LABEL[b.protein]}</div>
                {r.source ? (
                  <div className="mt-1 lg:hidden">
                    <SourceBadge source={r.source} />
                  </div>
                ) : null}
              </td>
              <td className="hidden min-w-0 sm:table-cell">
                <Link href={`/restaurants/${r.id}`} className="ui-link break-anywhere">
                  <Highlight text={r.name} tokens={tokens} />
                </Link>
                <div className="t-ui-s muted break-anywhere">
                  <Highlight text={where} tokens={tokens} />
                  {r.nb ? ` · ${r.borough}` : ""}
                </div>
              </td>
              <td className="hidden lg:table-cell">
                <SourceBadge source={r.source} />
              </td>
              <td className="num">
                <span className="sm:hidden">
                  <PriceChip price={b.price} median={median} dagger={delivery} suffix="" />
                </span>
                <span className="t-num-m hidden whitespace-nowrap sm:inline">
                  {b.price === null ? <span className="t-ui-s muted">No price</span> : formatPrice(b.price, { cents: "always" })}
                  {delivery && b.price !== null ? <span aria-label=" (delivery app price)">†</span> : null}
                </span>
              </td>
              <td className="num t-num-s muted hidden whitespace-nowrap sm:table-cell">{b.price === null ? "—" : formatDelta(b.price, median)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
