import { BestBurgerList, BestListSources } from "@/components/BestBurgers";
import { Net, Spyglass } from "@/components/icons/nautical";
import { JsonLd } from "@/components/JsonLd";
import { RankingLinks } from "@/components/Rankings";
import { PageHeader, SectionHeading } from "@/components/ui";
import { BEST_BURGERS_NAME, BEST_BURGERS_PATH, BEST_BURGERS_TICKET, bestBurgersCountLine, bestBurgersLede, leaders } from "@/lib/best-burgers";
import { getBestBurgers, getBestBurgersYears, getBestLists } from "@/lib/best-burgers-data";
import { getGeneratedAt, getPricedRestaurants, getStats } from "@/lib/data";
import { formatMonthYear, pluralize } from "@/lib/format";
import { breadcrumbNode, itemListNode } from "@/lib/jsonld";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { getPeoplesRank } from "@/lib/peoples-top-data";
import { rankingSpecs } from "@/lib/rankings";
import { bestBurgersSeo } from "@/lib/seo";
import { shareImage } from "@/lib/share-cards";
import { SITE_NAME } from "@/lib/site";

const entries = getBestBurgers();
const years = getBestBurgersYears();
const top = leaders(entries);
/** Each priced place's place in the People's Top 10 ranking, from the daily board (lib/peoples-top-data). */
const ranks = Object.fromEntries(entries.flatMap((e) => (e.menuKey ? [[e.menuKey, getPeoplesRank(e.menuKey)]] : [])));

export const metadata = pageMetadata({
  ...bestBurgersSeo({
    name: BEST_BURGERS_NAME,
    places: entries.length,
    leaders: top.map((e) => e.name),
    publishers: top[0]?.publishers.length ?? 0,
    years,
    generatedAt: getGeneratedAt(),
  }),
  path: BEST_BURGERS_PATH,
  image: shareImage(BEST_BURGERS_PATH),
});

/** "2024–2026" (an en dash, as in the ranking note). */
const span = `${years.from}–${years.to}`;

/**
 * The most-recommended burgers in NYC (user decisions 2026-09-25): places ranked by how many publications
 * named them on a best-burger list in 2024–2026, each with every list that names it, our menu price and
 * its place in the People's Top 10 ranking. The ranking note is the one line about how it is ranked; the lists' own words are
 * never quoted. No Review or Rating markup: an ItemList restates the rows, a BreadcrumbList the crumbs.
 */
export default function BestBurgersPage() {
  const lists = getBestLists();
  const publishers = new Set(lists.map((l) => l.publisher)).size;
  const crumbs = [{ href: "/", label: SITE_NAME }, { label: "Most-recommended burgers" }];
  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbNode(SITE_URL, crumbs, BEST_BURGERS_PATH),
          entries.length
            ? itemListNode(SITE_URL, {
                name: BEST_BURGERS_NAME,
                order: "descending",
                entries: entries.map((e) => ({ name: e.name, path: e.restaurant ? `/restaurants/${e.restaurant.id}` : null })),
              })
            : null,
        ]}
      />
      <PageHeader crumbs={crumbs} ticket={BEST_BURGERS_TICKET} ticketIcon={Net} title={`${BEST_BURGERS_NAME}.`} lede={bestBurgersLede(entries, formatMonthYear(getGeneratedAt()))} />
      <div className="wrap">
        <section className="mt-2" aria-label={BEST_BURGERS_NAME}>
          <p className="t-ui-m mb-4 text-balance">Ranked by how many publications named each place on a best-burger list in {span}.</p>
          <BestBurgerList entries={entries} median={getStats().index_median} ranks={ranks} />
          <p className="t-ui-s muted mt-3">{bestBurgersCountLine(entries.length)}</p>
        </section>

        <section className="section" aria-labelledby="the-lists">
          <SectionHeading id="the-lists" kicker="Ship's log" icon={Spyglass} title={`${pluralize(lists.length, "list")} from ${pluralize(publishers, "publication")}.`} />
          <div className="mt-6">
            <BestListSources lists={lists} entries={entries} />
          </div>
        </section>

        <section className="section" aria-labelledby="more-rankings">
          <SectionHeading id="more-rankings" title="More burger rankings." />
          <div className="mt-6">
            <RankingLinks current={BEST_BURGERS_PATH} available={rankingSpecs(getPricedRestaurants())} />
          </div>
        </section>
      </div>
    </>
  );
}
