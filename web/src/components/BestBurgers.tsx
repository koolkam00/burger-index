// The most-recommended burgers (DESIGN.md "The most-recommended burgers page"): the places in groups of one
// publication count, most first ("Named by 10 publications" … "Named by 1 publication", each group's heading a
// sticky bar, like the ticket rail's header), a data zone. Each row: the place (linked to its restaurant page
// when it has a price) and its neighborhood; the menu price and burger (linked to the page's burger block) or
// "Not priced"; the People's Price (the daily snapshot's, prerendered, then live and read-only in the
// browser); and every list that names it, with its publisher and date. The lists' own words are never
// shown: titles, names and dates only. Server-safe: the page passes the ranked entries
// (lib/best-burgers-data.ts).
import Link from "next/link";
import { formatListDate, groupBestBurgers, type BestEntry, type BestList } from "@/lib/best-burgers";
import { pluralize } from "@/lib/format";
import type { PeoplesPriceFigures } from "@/lib/peoples-price";
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

function BestRow({ e, median, peoples }: { e: BestEntry; median: number | null; peoples: Readonly<Record<string, PeoplesPriceFigures | null>> }) {
  const r = e.restaurant;
  const where = e.neighborhood ? `${e.neighborhood.name} · ${e.neighborhood.borough}` : null;
  return (
    <li className="best-row">
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
          <PeoplesPriceFact menuKey={e.menuKey} restaurantId={r.id} labelId={`people-${e.key}`} snapshot={peoples[e.menuKey] ?? null} />
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
}

/**
 * The places in groups of one publication count, most first, each group under a sticky heading ("Named by 10
 * publications", "1 place") and its places by name. `peoples` holds each priced place's People's Price figures
 * from the daily snapshot (by menu key; none without a snapshot): prerendered, then replaced by the live numbers.
 */
export function BestBurgerList({ entries, median, peoples }: { entries: readonly BestEntry[]; median: number | null; peoples: Readonly<Record<string, PeoplesPriceFigures | null>> }) {
  const keys = [...new Set(entries.flatMap((e) => (e.menuKey ? [e.menuKey] : [])))];
  return (
    <div className="best-shell">
      <PeoplesPriceLoader keys={keys} />
      {groupBestBurgers(entries).map((g) => (
        <section key={g.id} className="best-group" aria-labelledby={g.id}>
          <div className="best-group-head">
            <h2 id={g.id} className="best-group-title">
              {g.heading}
            </h2>
            <p className="best-group-count">{pluralize(g.entries.length, "place")}</p>
          </div>
          <ol className="best-list">
            {g.entries.map((e) => (
              <BestRow key={e.key} e={e} median={median} peoples={peoples} />
            ))}
          </ol>
        </section>
      ))}
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
