// The most-recommended burgers (DESIGN.md "The most-recommended burgers page"): one row per place, in rank
// order, a data zone. Each row: the rank, the place (linked to its restaurant page when it has a price),
// its neighborhood and how many publications named it; the menu price and burger (linked to the page's
// burger block) or "Not priced"; the People's Price (client, read-only); and every list that names it,
// with its publisher and date. The lists' own words are never shown: titles, names and dates only.
// Server-safe: the page passes the ranked entries (lib/best-burgers-data.ts).
import Link from "next/link";
import { formatListDate, type BestEntry, type BestList } from "@/lib/best-burgers";
import { formatCount, pluralize } from "@/lib/format";
import { PeoplesPriceFact, PeoplesPriceLoader } from "./worth/PeoplesPriceFact";
import { PriceChip } from "./ui";

function SourceLine({ list, burger }: { list: BestList; burger: string | null }) {
  return (
    <li className="best-source">
      <span className="font-semibold">{list.publisher}</span>
      {" · "}
      <a href={list.url} className="link">
        {list.title}
      </a>
      <span className="muted">
        {" · "}
        <span className="whitespace-nowrap">{formatListDate(list.date)}</span>
        {burger ? ` · ${burger}` : null}
      </span>
    </li>
  );
}

export function BestBurgerList({ entries, median }: { entries: readonly BestEntry[]; median: number | null }) {
  const keys = [...new Set(entries.flatMap((e) => (e.menuKey ? [e.menuKey] : [])))];
  return (
    <div className="best-shell">
      <PeoplesPriceLoader keys={keys} />
      <ol className="best-list">
        {entries.map((e) => {
          const r = e.restaurant;
          const where = e.neighborhood ? `${e.neighborhood.name} · ${e.neighborhood.borough}` : null;
          return (
            <li key={e.key} className="best-row">
              <p className="best-rank">
                <span className="sr-only">Rank </span>
                {e.rank}
              </p>
              <div className="best-place min-w-0">
                <p className="best-name break-anywhere">
                  {r ? (
                    <Link href={`/restaurants/${r.id}`} className="ui-link">
                      {e.name}
                    </Link>
                  ) : (
                    e.name
                  )}
                </p>
                {where ? <p className="t-ui-s muted break-anywhere">{where}</p> : null}
                <p className="t-ui-s mt-1">
                  <span className="t-num-s font-semibold">{formatCount(e.publishers.length)}</span> {e.publishers.length === 1 ? "publication" : "publications"}
                  <span className="muted"> · {pluralize(e.sources.length, "list")}</span>
                </p>
              </div>
              <div className="best-price min-w-0">
                <p id={`menu-${e.key}`} className="t-label muted">
                  Menu price
                </p>
                {r ? (
                  <Link href={`/restaurants/${r.id}#burger`} className="best-price-link" aria-describedby={`menu-${e.key}`}>
                    <PriceChip price={r.index_price} median={median} delta={false} />
                    <span className="t-ui-s break-anywhere">{r.burger.name}</span>
                  </Link>
                ) : (
                  <p className="t-ui-s muted mt-1">Not priced</p>
                )}
              </div>
              {r && e.menuKey ? (
                <div className="best-people min-w-0">
                  <PeoplesPriceFact menuKey={e.menuKey} menuPrice={r.index_price} restaurantId={r.id} labelId={`people-${e.key}`} />
                </div>
              ) : null}
              <div className="best-sources min-w-0">
                <p className="t-label muted">On these lists</p>
                <ul className="mt-1.5">
                  {e.sources.map((s) => (
                    <SourceLine key={s.list.id} list={s.list} burger={s.burger} />
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Every list the page cites, newest first, with how many of the page's places it names. */
export function BestListSources({ lists, entries }: { lists: readonly BestList[]; entries: readonly BestEntry[] }) {
  const named = (id: string) => entries.filter((e) => e.sources.some((s) => s.list.id === id)).length;
  return (
    <ul className="grid gap-x-8 md:grid-cols-2">
      {lists.map((l) => (
        <li key={l.id} className="t-ui-m flex min-h-11 flex-col justify-center border-b border-line py-2 break-anywhere">
          <span>
            <span className="font-semibold">{l.publisher}</span>
            {" · "}
            <a href={l.url} className="link">
              {l.title}
            </a>
          </span>
          <span className="t-ui-s muted">
            {formatListDate(l.date)} · {pluralize(named(l.id), "place")} here
          </span>
        </li>
      ))}
    </ul>
  );
}
