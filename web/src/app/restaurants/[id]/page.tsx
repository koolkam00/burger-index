import { ClipboardCheck, EyeOff, ExternalLink, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MiniMap } from "@/components/map/MiniMap";
import { repeatedNames } from "@/components/RestaurantBits";
import { Breadcrumbs, BoroughName, Dagger, IndexTag, Money, PriceChip, SectionHeading, SourceBadge, StatGrid, StatTile, StatusBadge } from "@/components/ui";
import { boroughSlug } from "@/lib/boroughs";
import {
  getChainLocations,
  getIndexBurger,
  getNeighborhood,
  getRestaurant,
  getRestaurants,
  getRestaurantsInNeighborhood,
  getScope,
  getStats,
  neighborhoodMenuCounts,
} from "@/lib/data";
import { formatCount, formatDate, formatDelta, formatPrice, hostname, pluralize, safeHttpUrl } from "@/lib/format";
import { parseHandCheck, type HandCheck } from "@/lib/hand-checks";
import { chainCoverage, hasOtherMenus, isAirportLocation, isChainOnly, isChainSourceLocation, menuKey, menusByIndexPrice } from "@/lib/menus";
import { DELIVERY_NOTE, PRICE_SOURCE_MEANING, PROTEIN_LABEL, STATUS_COPY, STATUS_LABEL, WITHHELD_COPY } from "@/lib/labels";
import { pageMetadata } from "@/lib/metadata";
import { chainLocationsWhere } from "@/lib/scope";
import { binFor } from "@/lib/price-bins";
import type { Restaurant } from "@/lib/schema";
import { atLeastOneParam, PLACEHOLDER_PARAM } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return atLeastOneParam(getRestaurants().map((r) => ({ id: r.id })), { id: PLACEHOLDER_PARAM });
}

export async function generateMetadata({ params }: PageProps<"/restaurants/[id]">): Promise<Metadata> {
  const { id } = await params;
  const r = getRestaurant(id);
  if (!r) return {};
  const where = r.neighborhood ? `${r.neighborhood}, ${r.borough}` : r.borough;
  const b = getIndexBurger(r);
  const description =
    r.index_price !== null && b
      ? `${r.name} (${where}): the cheapest beef burger is the ${b.name} at ${formatPrice(r.index_price, { cents: "always" })}. Every burger on the menu, with prices and sources.`
      : `${r.name} (${where}): ${statusCopy(r)}`;
  return pageMetadata({ title: `${r.name}, ${r.neighborhood ?? r.borough}`, description, path: `/restaurants/${r.id}` });
}

function ExternalA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="link inline-flex items-center gap-1" rel="nofollow noopener noreferrer" target="_blank">
      {children}
      <ExternalLink className="size-3.5 flex-none" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** The status line, unless a hand check withheld a price that was online: then "no price online" is untrue. */
function statusCopy(r: Restaurant): string {
  return parseHandCheck(r.status_detail)?.kind === "withheld" ? WITHHELD_COPY : STATUS_COPY[r.status];
}

/**
 * The note a hand check leaves (pipeline/corrections.py): shown as its own card, not buried in the
 * status line, because it changes (or withholds) the price the page shows.
 */
function HandCheckNote({ check, chainName, locations }: { check: HandCheck; chainName: string | null; locations: number }) {
  const corrected = check.kind === "corrected";
  const Icon = corrected ? ClipboardCheck : EyeOff;
  return (
    <section className="prose-width mt-6 rounded-[4px] border border-line bg-surface p-4 md:p-5" aria-labelledby="hand-check">
      <h2 id="hand-check" className="t-label muted flex items-start gap-2">
        <Icon className="size-4 flex-none" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0">
          {corrected ? "Prices corrected by hand" : "Prices withheld after a hand check"} · <span className="whitespace-nowrap">{formatDate(check.checkedOn)}</span>
        </span>
      </h2>
      <p className="t-body-s mt-2">
        {corrected ? "We re-read this menu ourselves and corrected what the scrape got wrong: " : "We re-read this menu ourselves and left its prices out: "}
        {check.reason}
      </p>
      {chainName && locations > 1 ? (
        <p className="t-ui-s muted mt-2">
          This applies to all {pluralize(locations, `${chainName} location`)}: they share one menu.
        </p>
      ) : null}
    </section>
  );
}

/** A chain's other locations. `unpriced` rows say why they have no price instead of naming the borough. */
function ChainLocationList({ rows, unpriced = false, className = "mt-6" }: { rows: readonly Restaurant[]; unpriced?: boolean; className?: string }) {
  return (
    <ul className={`${className} grid gap-x-8 sm:grid-cols-2`}>
      {rows.map((n) => (
        <li key={n.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2">
          <Link href={`/restaurants/${n.id}`} className="ui-link break-anywhere min-w-0">
            {n.neighborhood ?? n.borough}
            <span className="t-ui-s muted block">{n.address}</span>
          </Link>
          <span className="t-ui-s muted text-right">{unpriced ? (isAirportLocation(n) ? "Airport, own prices" : STATUS_LABEL[n.status]) : n.borough}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function RestaurantPage({ params }: PageProps<"/restaurants/[id]">) {
  const { id } = await params;
  const r = getRestaurant(id);
  if (!r) notFound();

  const stats = getStats();
  const median = stats.index_median;
  const hood = r.neighborhood_slug ? getNeighborhood(r.neighborhood_slug) : undefined;
  const indexBurger = getIndexBurger(r);
  const delivery = r.price_source === "delivery_app";
  const website = safeHttpUrl(r.website);
  const menuUrl = safeHttpUrl(r.menu_url);
  const priced = r.index_price !== null;
  const bin = priced && median !== null ? binFor(r.index_price as number, median) : null;
  // Other menus nearby, one card per menu: this restaurant's own chain is left out, and a chain with
  // several locations here shows once.
  const hoodMenus = r.neighborhood_slug ? menusByIndexPrice(getRestaurantsInNeighborhood(r.neighborhood_slug)) : [];
  const neighbors = hoodMenus.filter((m) => m.key !== menuKey(r)).slice(0, 6);
  const hoodCounts = r.neighborhood_slug ? neighborhoodMenuCounts(r.neighborhood_slug) : null;
  // "vs neighborhood" needs another priced menu there (five locations of one chain are one menu).
  const compareHood = hood && hoodCounts && hood.index_median !== null && hasOtherMenus(hoodCounts) ? { median: hood.index_median, counts: hoodCounts } : null;
  // A chain's other locations share its menu price only where they carry one: an unpriced chain (no
  // location scraped with a price) isn't in the index, and airport concessions never get the street price.
  const chainOthers = getChainLocations(r);
  const { priced: chainPricedOthers, unpriced: chainUnpricedOthers } = chainCoverage(chainOthers);
  const chainPricedLocations = chainPricedOthers.length + (priced ? 1 : 0);
  const chainListed = chainOthers.length + 1;
  const airport = isAirportLocation(r);
  // The location whose menu the chain's shared price was read from: its price is not an estimate.
  const chainSource = isChainSourceLocation(r);
  // Where the chain's locations are counted: a chain is looked up as a whole, so these are all of its
  // locations on our list (not the whole chain, which can have more in the city).
  const chainWhere = chainLocationsWhere(getScope()) || " we have looked up";
  const chainListedNote = chainListed > chainPricedLocations ? ` of the ${formatCount(chainListed)}${chainWhere}` : "";
  const neighborRepeats = repeatedNames(
    neighbors.map((m) => m.restaurant),
    [r],
  );
  const check = parseHandCheck(r.status_detail);
  // Beef burgers listed below the index price: they can only be priced for a later menu period (late
  // night, lunch, brunch or other), since the index takes a dinner or all-day price first and
  // happy-hour prices are never published (pipeline/extract.py `index_item`, build.py `assemble`).
  const cheaperBeef = priced ? r.burgers.filter((b) => b.protein === "beef" && b.price !== null && b.price < (r.index_price as number)).length : 0;
  // The scrape's own note; the hand-check sentence gets its own card below. After a hand check the
  // scrape's note describes the menu as it was read before the check, so it is labelled as history.
  const detail = check ? (check.scrapeDetail ? `Before the hand check, the scrape noted: ${check.scrapeDetail}` : null) : r.status_detail;

  const crumbs = [
    { href: "/boroughs", label: "Boroughs" },
    { href: `/boroughs/${boroughSlug(r.borough)}`, label: r.borough },
    ...(r.neighborhood && r.neighborhood_slug ? [{ href: `/neighborhoods/${r.neighborhood_slug}`, label: r.neighborhood }] : []),
    { label: r.name },
  ];

  return (
    <div className="wrap">
      <div className="pt-6 md:pt-8">
        <Breadcrumbs items={crumbs} />
      </div>
      <header className="pt-6 md:pt-8">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={r.status} />
          <SourceBadge source={r.price_source} />
          {r.cuisine ? <span className="t-ui-s muted">{r.cuisine}</span> : null}
        </div>
        <h1 className="t-display-l mt-4">{r.name}</h1>
        <p className="t-lede prose-width mt-4">
          {[r.address, r.neighborhood].filter(Boolean).join(", ")}
          {r.address || r.neighborhood ? ", " : ""}
          {r.borough}
          {r.zipcode ? ` ${r.zipcode}` : ""}.
        </p>
        {r.chain ? (
          <p className="t-body-s muted prose-width mt-3">
            {priced
              ? chainSource
                ? `We read this ${r.name} location's menu${
                    chainPricedOthers.length
                      ? `; the chain's ${chainPricedOthers.length === 1 ? "one other priced location uses" : `other ${formatCount(chainPricedOthers.length)} priced locations use`} its prices`
                      : ""
                  }. The index counts the chain once, not once per location.`
                : `A ${r.name} location. Chain locations share one menu price, scraped from a single NYC location, so this branch may differ by a little.${
                    chainPricedLocations > 1 ? ` The same price covers ${pluralize(chainPricedLocations, "priced location")}${chainListedNote}.` : ""
                  } The index counts the chain once, not once per location.`
              : airport
                ? `A ${r.name} airport location. Airport concessions set their own prices, so the chain's street price isn't applied here and this location isn't in the index.`
                : chainPricedLocations
                  ? `A ${r.name} location. Other ${r.name} locations carry the chain's menu price, but this one has no price on file, so it isn't counted.`
                  : `A ${r.name} location. No location of this chain is priced yet, so it isn't in the index.${chainListed > 1 ? ` It has ${pluralize(chainListed, "location")}${chainWhere}.` : ""}`}
          </p>
        ) : null}
      </header>

      {priced && indexBurger ? (
        <section className="mt-8 md:mt-10" aria-label="Index price">
          <StatGrid cols={3}>
            <StatTile
              label="Index price"
              value={<Money value={r.index_price as number} />}
              sub={
                <>
                  {indexBurger.name}
                  {bin ? ` · ${bin.name}` : ""}
                  {delivery ? " · delivery-app price †" : ""}
                </>
              }
            />
            <StatTile
              label={hood ? `vs ${hood.name}` : "vs neighborhood"}
              value={compareHood ? formatDelta(r.index_price, compareHood.median) : "—"}
              sub={
                compareHood
                  ? `Neighborhood median ${formatPrice(compareHood.median, { cents: "always" })} across ${pluralize(compareHood.counts.menus, "menu")}${isChainOnly(compareHood.counts) ? ", chain prices only" : ""}`
                  : r.neighborhood_slug
                    ? "No other priced menu here to compare"
                    : "No neighborhood on file"
              }
            />
            <StatTile
              label="vs NYC"
              value={median !== null ? formatDelta(r.index_price, median) : "—"}
              sub={median !== null ? `NYC median ${formatPrice(median, { cents: "always" })}` : undefined}
            />
          </StatGrid>
        </section>
      ) : (
        <section className="mt-8 rounded-[4px] border border-line bg-surface p-4 md:mt-10 md:p-6" aria-label="Status">
          <div className="flex items-start gap-3">
            <StatusBadge status={r.status} />
          </div>
          <p className="t-body mt-3">{statusCopy(r)}</p>
          {detail ? <p className="t-body-s muted mt-2">{detail}</p> : null}
          <p className="t-body-s muted mt-2">Restaurants without a priced beef burger are left out of the index and every median on this site.</p>
        </section>
      )}

      {check ? (
        <HandCheckNote check={check} chainName={r.chain ? r.name : null} locations={[r, ...chainOthers].filter((x) => parseHandCheck(x.status_detail)?.checkedOn === check.checkedOn).length} />
      ) : null}

      <section className="section" aria-labelledby="menu">
        <SectionHeading id="menu" title={r.burgers.length ? "Burgers on the menu." : "No burgers listed."}>
          {r.burgers.length
            ? priced
              ? cheaperBeef
                ? `The highlighted row sets the index price: the cheapest beef burger at the menu's dinner or all-day prices (late-night, lunch and brunch prices count only when there are none). ${
                    cheaperBeef === 1 ? "The cheaper beef burger listed here is priced for another time of day." : `The ${formatCount(cheaperBeef)} cheaper beef burgers listed here are priced for other times of day.`
                  }`
                : "The highlighted row sets the index price: the cheapest priced beef burger."
              : "We found these burgers but no prices we could record."
            : null}
        </SectionHeading>
        {r.burgers.length ? (
          <ul className="mt-6 max-w-3xl">
            {r.burgers.map((b) => (
              <li key={b.id} id={b.id} className={`menu-item ${b.is_index_item ? "is-index" : ""}`}>
                <div className="menu-line">
                  <span className="t-ui-l break-anywhere min-w-0 font-semibold">{b.name}</span>
                  <span className="menu-leader" aria-hidden="true" />
                  <span className="t-num-l whitespace-nowrap">
                    {b.price === null ? <span className="t-ui-s muted">No price</span> : formatPrice(b.price, { cents: "always" })}
                    {delivery && b.price !== null ? <Dagger /> : null}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {b.is_index_item ? <IndexTag /> : null}
                  <span className="t-ui-s muted">{PROTEIN_LABEL[b.protein]}</span>
                  {b.price !== null && median !== null ? <span className="t-num-s muted">{formatDelta(b.price, median, { suffix: "vs NYC median" })}</span> : null}
                </div>
                {b.description ? <p className="t-body-s muted prose-width mt-1">{b.description}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {delivery ? <p className="t-ui-s muted mt-3">† Delivery-app price. {DELIVERY_NOTE}</p> : null}
      </section>

      <section className="section" aria-labelledby="source">
        <SectionHeading id="source" title="Where the prices come from." />
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <dl className="t-ui-m grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-3 self-start">
            <dt className="t-label muted pt-0.5">Source</dt>
            <dd className="min-w-0">
              {r.price_source ? (
                <>
                  <SourceBadge source={r.price_source} />
                  <p className="t-body-s muted mt-1">{PRICE_SOURCE_MEANING[r.price_source]}</p>
                </>
              ) : (
                <span className="muted">None found</span>
              )}
            </dd>
            <dt className="t-label muted pt-0.5">Menu page</dt>
            <dd className="min-w-0 break-anywhere">{menuUrl ? <ExternalA href={menuUrl}>{hostname(menuUrl)}</ExternalA> : <span className="muted">None found</span>}</dd>
            <dt className="t-label muted pt-0.5">Website</dt>
            <dd className="min-w-0 break-anywhere">{website ? <ExternalA href={website}>{hostname(website)}</ExternalA> : <span className="muted">None on file</span>}</dd>
            <dt className="t-label muted pt-0.5">Menu read</dt>
            <dd>{r.scraped_at ? formatDate(r.scraped_at) : <span className="muted">Not yet</span>}</dd>
            <dt className="t-label muted pt-0.5">Status</dt>
            <dd className="min-w-0">
              <StatusBadge status={r.status} />
              {priced && detail ? <p className="t-body-s muted mt-1">{detail}</p> : null}
              {check ? <p className="t-body-s mt-1">{check.kind === "corrected" ? "Prices corrected by hand" : "Prices withheld"} on {formatDate(check.checkedOn)} (see above).</p> : null}
            </dd>
            <dt className="t-label muted pt-0.5">Borough</dt>
            <dd>
              <BoroughName borough={r.borough} />
            </dd>
            {r.neighborhood && r.neighborhood_slug ? (
              <>
                <dt className="t-label muted pt-0.5">Neighborhood</dt>
                <dd className="min-w-0 break-anywhere">
                  <Link className="ui-link underline-offset-4 hover:underline" href={`/neighborhoods/${r.neighborhood_slug}`}>
                    {r.neighborhood}
                  </Link>
                </dd>
              </>
            ) : null}
          </dl>
          <div className="min-w-0">
            {r.lat !== null && r.lng !== null ? (
              <>
                <MiniMap id={r.id} lat={r.lat} lng={r.lng} price={r.index_price} median={median} label={r.name} />
                <p className="t-ui-s muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                  </span>
                  {priced ? (
                    <Link className="link" href={`/map?r=${encodeURIComponent(r.id)}`}>
                      See it on the full map
                    </Link>
                  ) : null}
                </p>
              </>
            ) : (
              <div className="chart-empty" style={{ minHeight: 160 }}>
                <p>No coordinates on file for this restaurant, so it isn&apos;t on the map.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {neighbors.length ? (
        <section className="section" aria-labelledby="nearby">
          <SectionHeading id="nearby" title={`More in ${r.neighborhood}.`} />
          <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
            {neighbors.map(({ key, restaurant: n, locations }) => (
              <li key={key} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2">
                <span className="min-w-0">
                  <Link href={`/restaurants/${n.id}`} className="ui-link break-anywhere font-semibold">
                    {n.name}
                  </Link>
                  <span className="t-ui-s muted block break-anywhere">
                    {[getIndexBurger(n)?.name, n.chain && locations > 1 ? `chain, ${locations} locations here` : neighborRepeats.has(n.name) ? n.address : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <PriceChip price={n.index_price} median={median} delta={false} dagger={n.price_source === "delivery_app"} />
              </li>
            ))}
          </ul>
          {r.neighborhood_slug ? (
            <p className="mt-4">
              <Link href={`/neighborhoods/${r.neighborhood_slug}`} className="link t-ui-m">
                All of {r.neighborhood}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {chainOthers.length ? (
        <section className="section" aria-labelledby="chain">
          {chainPricedOthers.length ? (
            <>
              <SectionHeading id="chain" title={priced ? `Other ${r.name} locations${chainWhere}.` : `${r.name} locations with the chain price.`}>
                {priced ? "Same menu, same price." : `They share one menu and one price${airport ? "; airport concessions don't get it" : ""}.`}
              </SectionHeading>
              <ChainLocationList rows={chainPricedOthers.slice(0, 12)} />
              {chainPricedOthers.length > 12 ? (
                <p className="mt-4">
                  <Link href={`/burgers?q=${encodeURIComponent(r.name)}&index=1`} className="link t-ui-m">
                    All {formatCount(chainPricedLocations)} priced locations
                  </Link>
                </p>
              ) : null}
              {chainUnpricedOthers.length ? (
                <div className="mt-8">
                  <h3 className="t-label muted">Listed without the chain price</h3>
                  <ChainLocationList rows={chainUnpricedOthers} unpriced className="mt-3" />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <SectionHeading id="chain" title={`Other ${r.name} locations${chainWhere}.`}>
                {priced ? "Listed without the chain price." : "None of them is priced yet either."}
              </SectionHeading>
              <ChainLocationList rows={chainOthers.slice(0, 12)} unpriced />
              {chainOthers.length > 12 ? <p className="t-ui-s muted mt-4">Showing 12 of {formatCount(chainOthers.length)} other locations.</p> : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
