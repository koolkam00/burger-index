// The most-recommended burgers (DESIGN.md "The most-recommended burgers page"): the places in groups of one
// publication count, most first ("Named by 10 publications" … "Named by 1 publication", each group's heading a
// sticky bar, like the ticket rail's header), a data zone. Each row: the place (linked to its restaurant page
// when it has a price) and its neighborhood; the menu price and burger (linked to the page's burger block) or
// "Not priced"; its place in the People's Top 10 ranking when it has one (the daily board); and every list
// that names it, with its publisher and date. The lists' own words are never shown: titles, names and dates
// only. Server-safe: the page passes the ranked entries (lib/best-burgers-data.ts).
import Link from "next/link";
import { formatListDate, groupBestBurgers, type BestEntry, type BestList } from "@/lib/best-burgers";
import { pluralize } from "@/lib/format";
import { PEOPLES_TOP_PATH } from "@/lib/site";
import { PriceChip } from "./ui";

/** A menu's place in the People's Top 10 ranking (lib/peoples-top-data getPeoplesRank), by menu key. */
export type PeoplesRanks = Readonly<Record<string, { rank: number; lists: number } | null>>;

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

function BestRow({ e, median, ranks }: { e: BestEntry; median: number | null; ranks: PeoplesRanks }) {
  const r = e.restaurant;
  const people = e.menuKey ? (ranks[e.menuKey] ?? null) : null;
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
      {people ? (
        <div className="best-people min-w-0">
          <p id={`people-${e.key}`} className="t-label muted">
            People&apos;s rank
          </p>
          <p className="mt-0.5">
            <Link href={PEOPLES_TOP_PATH} className="ui-link t-num-m" aria-describedby={`people-${e.key}`}>
              #{people.rank}
            </Link>{" "}
            <span className="t-num-s muted">on {pluralize(people.lists, "list")}</span>
          </p>
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
 * publications", "1 place") and its places by name. `ranks` holds each priced place's place in the People's Top 10
 * ranking (by menu key; null when it isn't ranked).
 */
export function BestBurgerList({ entries, median, ranks }: { entries: readonly BestEntry[]; median: number | null; ranks: PeoplesRanks }) {
  return (
    <div className="best-shell">
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
              <BestRow key={e.key} e={e} median={median} ranks={ranks} />
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
