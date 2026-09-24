// Presentational table for the burger explorer. No hooks and no "use client": the server renders
// it as the static fallback, and the client explorer renders it with sorting wired up.
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ExBurger, ExRestaurant, SortKey } from "@/lib/explorer";
import { formatDelta } from "@/lib/format";
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
        <Icon strokeWidth={2} aria-hidden="true" className={active ? "" : "opacity-60"} />
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
    <div className="table-shell">
    <table className="data-table">
      <caption className="sr-only">Restaurants with their burgers, price source and price</caption>
      <thead>
        <tr>
          <SortHeader label="Restaurant" keyAsc="restaurant" sort={sort} onSort={onSort} />
          <SortHeader label="Burger" keyAsc="name" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
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
                <Link href={`/restaurants/${r.id}`} className="ui-link break-anywhere font-semibold">
                  <Highlight text={r.name} tokens={tokens} />
                </Link>
                {/* Below sm the burger shares this cell, under its restaurant. */}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                  <Link href={href} className="ui-link break-anywhere font-normal">
                    <Highlight text={b.name} tokens={tokens} />
                  </Link>
                  {b.idx ? <IndexTag /> : null}
                </div>
                <div className="t-ui-s muted break-anywhere">
                  <Highlight text={where} tokens={tokens} />
                  {r.nb ? ` · ${r.borough}` : ""}
                </div>
                {r.source ? (
                  <div className="mt-1">
                    <SourceBadge source={r.source} />
                  </div>
                ) : null}
              </td>
              <td className="hidden min-w-0 sm:table-cell">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={href} className="ui-link break-anywhere font-normal">
                    <Highlight text={b.name} tokens={tokens} />
                  </Link>
                  {b.idx ? <IndexTag /> : null}
                </div>
                <div className="t-ui-s muted">{PROTEIN_LABEL[b.protein]}</div>
              </td>
              <td className="num">
                <span className="sm:hidden">
                  <PriceChip price={b.price} median={median} dagger={delivery} suffix="" narrowWrap />
                </span>
                <span className="hidden sm:inline">
                  <PriceChip price={b.price} median={median} delta={false} dagger={delivery} />
                </span>
              </td>
              <td className="num t-num-s muted hidden whitespace-nowrap sm:table-cell">{b.price === null ? "—" : formatDelta(b.price, median)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
