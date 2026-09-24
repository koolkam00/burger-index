import Link from "next/link";
import { Lighthouse, OrderBell } from "@/components/icons/nautical";
import { PageHeader, SectionHeading, SourceBadge, StatusBadge } from "@/components/ui";
import { boroughInProse } from "@/lib/boroughs";
import {
  getBoroughs,
  getDataSource,
  getGeneratedAt,
  getHandCheckedMenus,
  getMenuCounts,
  getMethodology,
  getRestaurants,
  getScope,
  getStats,
  pricedLocations,
  withMenuCounts,
} from "@/lib/data";
import { capitalize, formatCount, formatDate, formatDateTime, formatPrice, pluralize } from "@/lib/format";
import { PRICE_SOURCE_MEANING, STATUS_MEANING } from "@/lib/labels";
import { isChainOnly, joinList, listedChainNames, listedMenus, menuBreakdown, perLocationNote, pricedMenus, splitByCoverage, statusTally, type StatusTally } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { cuisineNames, mostlyIn, scopeMethod, scopeRestaurants, scopeSources, scopeWhere } from "@/lib/scope";
import { binRanges } from "@/lib/price-bins";
import { PRICE_SOURCES, STATUSES } from "@/lib/enums";
import { MIN_HISTOGRAM, MIN_RANKED } from "@/lib/site";
import { median as medianOf } from "@/lib/stats";

export const metadata = pageMetadata({
  title: "Methodology",
  description: "How the NYC Burger Index is built: which restaurants, which burger counts, why a chain counts once, where prices come from, and what we leave out.",
  path: "/methodology",
});

/** "56 independent restaurants and 9 chains". */
function statusMenus(t: StatusTally): string {
  return menuBreakdown({ menus: t.independents + t.chains, independents: t.independents, chains: t.chains, locations: t.locations });
}

export default function MethodologyPage() {
  const m = getMethodology();
  const stats = getStats();
  const counts = getMenuCounts();
  const restaurants = getRestaurants();
  const generated = getGeneratedAt();
  const median = stats.index_median;
  const menus = pricedMenus(restaurants);
  // Per menu (a chain once), with the location count beside it where they differ.
  const statuses = statusTally(restaurants);
  // Per distinct menu: a chain's price source counts once, like the chain itself.
  const sourceCounts = Object.fromEntries(PRICE_SOURCES.map((s) => [s, menus.filter((x) => x.restaurant.price_source === s).length])) as Record<
    (typeof PRICE_SOURCES)[number],
    number
  >;
  // Chains: every listed one, and the ones whose shared menu price is in the index.
  const listedChains = listedMenus(restaurants.filter((r) => r.chain !== null));
  const pricedChainLocations = counts.locations - counts.independents;

  // What counting per location would do: the chains' share of priced locations, and the median you
  // would get if every location were its own entry (and whose price it lands on).
  const locationMedian = medianOf(
    pricedLocations()
      .map((r) => r.index_price as number)
      .sort((a, b) => a - b),
  );
  const perLocation = perLocationNote(menus, locationMedian, median);
  // Which restaurants are in scope, where the list comes from, how many are looked up so far, and
  // whether national chains are left out: all read from coverage_note (lib/scope).
  const scope = getScope();
  const noNational = scope.excludesNationalChains;
  // Restaurants matched to a health-department record (camis): where addresses and map locations come from.
  const matched = restaurants.filter((r) => r.camis !== null).length;
  // The chains we do list (NYC's own), most locations first: the examples of what stays in.
  const localChainNames = listedChainNames(restaurants).slice(0, 2);
  // Where the priced menus so far are, when one neighborhood holds most of them (a chain once per area).
  const menusMostlyIn = mostlyIn(withMenuCounts(), (n) => n.menuCounts.menus, counts.menus);

  // Coverage by borough: where independent restaurants are priced, and where only chains are.
  const boroughs = getBoroughs();
  const { comparable, chainOnly } = splitByCoverage(boroughs, (b) => b.menuCounts, (b) => b.summary?.index_median ?? null);
  const unpricedBoroughs = boroughs.filter((b) => b.menuCounts.menus === 0);

  const handChecked = getHandCheckedMenus();
  const corrected = handChecked.filter((h) => h.check.kind === "corrected");
  const withheld = handChecked.filter((h) => h.check.kind === "withheld");
  const handLocations = handChecked.reduce((n, h) => n + h.locations, 0);
  const withheldUnpriced = withheld.filter((h) => h.restaurant.status === "no_prices").length;

  const scraped = restaurants
    .map((r) => r.scraped_at)
    .filter((d): d is string => !!d)
    .sort();
  const firstRead = scraped.length ? formatDate(scraped[0]) : null;
  const lastRead = scraped.length ? formatDate(scraped[scraped.length - 1]) : null;
  const p10 = stats.index_p10 !== null ? formatPrice(stats.index_p10, { cents: "always" }) : null;
  const p90 = stats.index_p90 !== null ? formatPrice(stats.index_p90, { cents: "always" }) : null;

  return (
    <>
      <PageHeader
        ticket="The recipe"
        ticketIcon={Lighthouse}
        title="How the index works."
        lede={`One number for what a burger costs in New York, built from the menus we could price, with each chain counted once${
          noNational ? " and national chains left out" : ""
        }.${
          scope.pending
            ? ` So far we have looked up ${formatCount(scope.lookedUp)} of the ${scopeRestaurants(scope)} and priced ${pluralize(counts.menus, "menu")}.`
            : ""
        } Here is what counts, where the prices come from and what we leave out.`}
      />

      <div className="wrap">
      <article className="prose mt-2">
        <section aria-labelledby="rule">
          <SectionHeading id="rule" title="The rule." />
          <p className="mt-4">{m.index_price_rule}</p>
          <p>
            Why the cheapest one: it is the price of admission. Anyone who walks in can get that burger for that price, and a single $40 wagyu special
            can&apos;t drag it around. Why beef: it is the burger nearly every menu has, so the comparison is like for like. Chicken, turkey, fish,
            veggie and other burgers are still listed on every restaurant page and in the full burger table; they just don&apos;t set the index.
          </p>
        </section>

        <section className="section" aria-labelledby="chains">
          <SectionHeading id="chains" title="Chains count once." />
          <p className="mt-4">
            A chain&apos;s locations share one menu: we read the menu of one NYC location and apply its prices to every location, except airport
            concessions. So the index counts menus, not locations. Every independent restaurant counts once, and each chain counts once citywide,
            however many locations it has. Borough and neighborhood figures count a chain at most once in each area.
          </p>
          {perLocation ? <p>{perLocation}</p> : null}
          <p>
            {counts.menus
              ? `The index rests on ${pluralize(counts.menus, "menu")}: ${menuBreakdown(counts)}. `
              : "No menu is priced yet. "}
            Location counts still count every location: each has its own page, its own pin on the map and its own rows in the burger table.
          </p>
        </section>

        <section className="section" aria-labelledby="compute">
          <SectionHeading id="compute" title="How we compute it." />
          <ol className="mt-4">
            <li>{scopeMethod(scope, matched)}</li>
            <li>Find each menu online and read every burger on it: name, description, price and protein.</li>
            <li>Take the cheapest priced beef burger. That is the menu&apos;s index price, shared by every location of a chain.</li>
            <li>
              Take the median of the index prices across distinct menus. That is the Burger Index:{" "}
              {median !== null ? <strong>{formatPrice(median, { cents: "always" })}</strong> : "not yet available"}
              {counts.menus ? `, across ${pluralize(counts.menus, "menu")} at ${pluralize(counts.locations, "priced location")}` : ""}.
            </li>
          </ol>
          <p>
            Borough and neighborhood medians work the same way over the menus in each area. We rank a neighborhood only once it has at least {MIN_RANKED}{" "}
            priced menus (five locations of one chain are one menu), and draw a price distribution only for slices with at least {MIN_HISTOGRAM}. The
            typical range is the 10th to 90th percentile of the menus&apos; index prices
            {p10 && p90 ? (p10 === p90 ? `; right now both are ${p10}` : ` (${p10} to ${p90})`) : ""}.
          </p>
          {median !== null ? (
            <>
              <p>Colors on the map and charts compare a price with the citywide median, never with a filtered subset, so a restaurant keeps its color everywhere:</p>
              <div className="not-prose table-shell mt-4">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Level</th>
                      <th scope="col" className="num">
                        Index price
                      </th>
                      <th scope="col" className="num">
                        vs NYC median
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {binRanges(median).map((b) => (
                      <tr key={b.key}>
                        <th scope="row">
                          <span className="inline-flex items-center gap-2">
                            <span className="swatch" style={{ background: b.color }} aria-hidden="true" />
                            {b.name}
                          </span>
                        </th>
                        <td className="num">{b.dollars}</td>
                        <td className="num">{b.percent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>

        <section className="section" aria-labelledby="coverage">
          <SectionHeading id="coverage" title="Where we have prices so far." />
          {scope.pending ? (
            <p className="mt-4">
              We have looked up {formatCount(scope.lookedUp)} of the {scopeRestaurants(scope)} so far; the other {formatCount(scope.pending)} are not
              read yet. Each one joins the site once we look it up, and the index once its menu has a priced beef burger.
              {menusMostlyIn
                ? ` Most of the menus priced so far are in ${menusMostlyIn.area.name}: ${formatCount(menusMostlyIn.n)} of ${formatCount(counts.menus)}.`
                : ""}
            </p>
          ) : null}
          {comparable.length && chainOnly.length ? (
            <p className={scope.pending ? "" : "mt-4"}>
              {comparable.length === 1
                ? `Every independent restaurant priced so far is in ${boroughInProse(comparable[0].name)}.`
                : `Independent restaurants are priced so far in ${joinList(comparable.map((b) => boroughInProse(b.name)))}.`}{" "}
              {capitalize(joinList(chainOnly.map((b) => boroughInProse(b.name))))} {chainOnly.length === 1 ? "is" : "are"} priced from chain menus only.{" "}
              {chainOnly.length === 1 ? "Its median is a chain price: we mark it" : "Their medians are chain prices: we mark them"} &ldquo;Chain prices
              only&rdquo; wherever {chainOnly.length === 1 ? "it appears" : "they appear"} and never present {chainOnly.length === 1 ? "it" : "them"} as a
              like-for-like comparison.
            </p>
          ) : chainOnly.length ? (
            <p className={scope.pending ? "" : "mt-4"}>
              Every borough we have priced so far is priced from chain menus only.{" "}
              {chainOnly.length === 1 ? "Its median is a chain price" : "Their medians are chain prices"}, marked &ldquo;Chain prices only&rdquo; wherever{" "}
              {chainOnly.length === 1 ? "it appears" : "they appear"}.
            </p>
          ) : comparable.length ? (
            <p className={scope.pending ? "" : "mt-4"}>Every borough we have priced has at least one independent restaurant priced, alongside any chains.</p>
          ) : null}
          {unpricedBoroughs.length ? (
            <p className={comparable.length || chainOnly.length || scope.pending ? "" : "mt-4"}>
              No menu is priced yet in {joinList(unpricedBoroughs.map((b) => boroughInProse(b.name)))}.
            </p>
          ) : null}
          <div className="not-prose table-shell mt-4">
            <table className="data-table">
              <caption className="sr-only">Priced menus by borough</caption>
              <thead>
                <tr>
                  <th scope="col">Borough</th>
                  <th scope="col" className="num">
                    Independent
                  </th>
                  <th scope="col" className="num">
                    Chains
                  </th>
                  <th scope="col" className="num hidden sm:table-cell">
                    Locations
                  </th>
                </tr>
              </thead>
              <tbody>
                {boroughs.map((b) => (
                  <tr key={b.slug}>
                    <th scope="row">
                      {b.name}
                      {isChainOnly(b.menuCounts) ? <span className="t-ui-s muted block">Chain prices only</span> : null}
                    </th>
                    <td className="num">{formatCount(b.menuCounts.independents)}</td>
                    <td className="num">{formatCount(b.menuCounts.chains)}</td>
                    <td className="num hidden sm:table-cell">{formatCount(b.menuCounts.locations)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* The dataset's own coverage note repeats the paragraphs above in pipeline terms; it is only
              shown when its scope can't be read (then it is the only word on which restaurants are in). */}
          {scope.kind === "unknown" ? <p className="mt-4">{m.coverage_note}</p> : null}
        </section>

        <section className="section" aria-labelledby="sources">
          <SectionHeading id="sources" title="Sources." />
          <ul className="mt-4">
            {scopeSources(m.sources, scope).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p>
            Every price carries a label for where we read it. Restaurant pages link to the exact page each menu came from. The counts below are
            menus, so a chain counts once.
          </p>
          <dl className="not-prose mt-4 grid gap-4">
            {PRICE_SOURCES.map((s) => (
              <div key={s} className="grid gap-1 border-b-[1.5px] border-line pb-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt className="flex flex-wrap items-center gap-2">
                  <SourceBadge source={s} />
                </dt>
                <dd className="t-body-s">
                  {PRICE_SOURCE_MEANING[s]} <span className="muted">({pluralize(sourceCounts[s], "priced menu")})</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="section" aria-labelledby="hand-checks">
          <SectionHeading id="hand-checks" kicker="Checked by the cook" icon={OrderBell} title="Checked by hand." />
          <p className="mt-4">
            When a scraped price looks wrong, we re-read the live menu ourselves. A price found wrong is corrected; one we can&apos;t confirm against a
            current menu is withheld, which leaves that restaurant out of the index. Each restaurant page says what changed and when.
          </p>
          {handChecked.length ? (
            <>
              <p>
                So far {pluralize(corrected.length, "menu")} {corrected.length === 1 ? "has" : "have"} prices corrected by hand
                {withheld.length ? ` and ${pluralize(withheld.length, "menu")} ${withheld.length === 1 ? "has" : "have"} prices withheld` : ""}
                {handLocations > handChecked.length ? `, covering ${pluralize(handLocations, "location")}` : ""}:
              </p>
              <ul>
                {handChecked.map((h) => (
                  <li key={h.key}>
                    <Link href={`/restaurants/${h.restaurant.id}`}>{h.restaurant.name}</Link>
                    {h.locations > 1 ? ` (all ${formatCount(h.locations)} locations)` : ""}: {h.check.kind === "corrected" ? "corrected" : "withheld"}{" "}
                    {formatDate(h.check.checkedOn)}.
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No price has needed a hand correction yet.</p>
          )}
        </section>

        <section className="section" aria-labelledby="statuses">
          <SectionHeading id="statuses" title="When a menu has no price." />
          <p className="mt-4">
            Only menus with a priced beef burger count toward the index. The rest are still on the site, with the reason. Each count below is menus (a
            chain once), then locations:
          </p>
          <dl className="not-prose mt-4 grid gap-4">
            {STATUSES.map((s) => (
              <div key={s} className="grid gap-1 border-b-[1.5px] border-line pb-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt>
                  <StatusBadge status={s} />
                </dt>
                <dd className="t-body-s">
                  {STATUS_MEANING[s]}{" "}
                  <span className="muted">
                    {statuses[s].locations
                      ? `(${statusMenus(statuses[s])}, ${pluralize(statuses[s].locations, "location")}${
                          s === "no_prices" && withheldUnpriced ? `; ${pluralize(withheldUnpriced, "menu")} withheld after a hand check` : ""
                        })`
                      : "(none)"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="section" aria-labelledby="exclusions">
          <SectionHeading id="exclusions" title="What we leave out." />
          <ul className="mt-4">
            <li>Combos, meals and add-ons. The burger by itself, at its standard size.</li>
            <li>Lunch, brunch and late-night prices when the burger has a dinner or all-day price.</li>
            <li>Happy-hour prices, always.</li>
            <li>Kids&apos; items.</li>
            <li>Tax and tip. Every price is the menu price in US dollars.</li>
            <li>Restaurants we couldn&apos;t price. They appear on the site but not in any median.</li>
            {scope.pending ? (
              <li>
                The {formatCount(scope.pending)} restaurants {scopeWhere(scope)} we haven&apos;t looked up yet. They join the site as we look them up.
              </li>
            ) : null}
            {scope.kind === "list" ? (
              <li>Restaurants that aren&apos;t on our list, even if they sell a burger. The list is burger places we picked, not every restaurant in the city.</li>
            ) : scope.kind === "list+cuisines" ? (
              <li>
                Restaurants that are neither on our list nor filed under {cuisineNames(scope.cuisines)} by the health department, even if they sell a burger.
              </li>
            ) : null}
            {noNational ? (
              <li>
                National chains{scope.nationalChainExamples ? ` (${scope.nationalChainExamples})` : ""}. They are not on the site at all.
                {localChainNames.length ? ` NYC's own small chains, like ${joinList(localChainNames)}, stay in.` : ""}
              </li>
            ) : null}
          </ul>
        </section>

        <section className="section" aria-labelledby="biases">
          <SectionHeading id="biases" title="Known biases." />
          <ul className="mt-4">
            {scope.pending ? (
              <li>
                The index so far rests on the {formatCount(scope.lookedUp)} restaurants we looked up first, not all {formatCount(scope.inScope)}
                {menusMostlyIn ? `, and ${formatCount(menusMostlyIn.n)} of its ${formatCount(counts.menus)} priced menus are in ${menusMostlyIn.area.name}` : ""}.
                It will move as the other {formatCount(scope.pending)} are read.
              </li>
            ) : null}
            <li>
              Delivery-app prices usually run higher than ordering in person. {formatCount(sourceCounts.delivery_app)} of {pluralize(counts.menus, "menu")}{" "}
              take their index price from a delivery app; they are marked with † everywhere, and the burger table can hide them.
            </li>
            <li>Menu PDFs and aggregator listings can be out of date. A PDF printed last spring may not show this fall&apos;s price.</li>
            <li>
              Chain locations share one menu price, scraped from a single NYC location
              {counts.chains
                ? listedChains.chains === counts.chains && listedChains.locations === pricedChainLocations
                  ? ` (${pluralize(counts.chains, "chain")} so far, at ${pluralize(pricedChainLocations, "location")}, all priced)`
                  : ` (${pluralize(counts.chains, "chain")} priced so far, covering ${pluralize(pricedChainLocations, "location")}; we have looked up ${pluralize(listedChains.chains, "chain")} at ${pluralize(listedChains.locations, "location")} in all)`
                : listedChains.chains
                  ? ` (we have looked up ${pluralize(listedChains.chains, "chain")} at ${pluralize(listedChains.locations, "location")}, none priced yet)`
                  : ""}
              . Individual branches can charge a little more or less.
            </li>
            {noNational ? (
              <li>
                National fast-food chains sell some of the cheapest burgers in the city, so leaving them out raises the index. It describes local
                restaurants and NYC&apos;s own chains, not national ones.
              </li>
            ) : null}
            <li>
              {scope.kind === "list"
                ? "Coverage follows our list and what menus publish online. The list is burger places we picked, not a random sample of the city's restaurants. "
                : scope.kind === "list+cuisines"
                  ? `Coverage follows our list, what the health department files under ${cuisineNames(scope.cuisines)}, and what menus publish online. `
                  : "Coverage follows which restaurants are in scope and what menus publish online. "}
              Places without a menu online are underrepresented, and areas priced only from chains show chain prices until their independent restaurants
              are read.
            </li>
          </ul>
        </section>

        <section className="section" aria-labelledby="updates">
          <SectionHeading id="updates" title="Updates." />
          <p className="mt-4">
            We rebuild the index each time the scraper re-reads the menus; the date in the footer is the last rebuild. This edition was generated{" "}
            {formatDateTime(generated)}
            {firstRead && lastRead ? `, from menus read ${firstRead === lastRead ? `on ${firstRead}` : `between ${firstRead} and ${lastRead}`}` : ""}. Every restaurant page shows the day
            its own menu was read.
          </p>
          {getDataSource() === "fixture" ? (
            <p>
              <strong>This build uses sample data.</strong> The restaurants and prices on this site are made up for development.
            </p>
          ) : null}
        </section>

        <section className="section" aria-labelledby="data">
          <SectionHeading id="data" title="The data." />
          <p className="mt-4">
            The whole dataset is one JSON file:{" "}
            <a href="/data/burger_index.json" download>
              burger_index.json
            </a>
            . It lists every restaurant, every burger, the price source and the date each menu was read. We index prices, not quality, and we are not
            affiliated with any restaurant.
          </p>
        </section>
      </article>
      </div>
    </>
  );
}
