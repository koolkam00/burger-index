import { ClipboardCheck, EyeOff, ExternalLink, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MiniMap } from "@/components/map/MiniMap";
import { repeatedNames } from "@/components/RestaurantBits";
import { Anchor, Spatula } from "@/components/icons/nautical";
import { BoroughName, DetailOverline, EmptyState, IndexTag, Money, PageHeader, PriceChip, SectionHeading, SourceBadge, StatGrid, StatTile, StatusBadge } from "@/components/ui";
import { boroughSlug } from "@/lib/boroughs";
import {
  getChainLocations,
  getIndexBurger,
  getNeighborhood,
  getRestaurant,
  getRestaurants,
  getRestaurantsInNeighborhood,
  getStats,
  neighborhoodMenuCounts,
} from "@/lib/data";
import { formatCount, formatDate, formatDelta, formatPrice, hostname, pluralize, safeHttpUrl } from "@/lib/format";
import { parseHandCheck, type HandCheck } from "@/lib/hand-checks";
import { chainCoverage, hasOtherMenus, menuKey, menusByIndexPrice } from "@/lib/menus";
import { PROTEIN_LABEL, STATUS_COPY, STATUS_LABEL, WITHHELD_COPY } from "@/lib/labels";
import { pageMetadata } from "@/lib/metadata";
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
      ? `${r.name} (${where}): ${b.name}, ${formatPrice(r.index_price, { cents: "always" })}.`
      : `${r.name} (${where}): ${statusLabel(r)}.`;
  return pageMetadata({ title: `${r.name}, ${r.neighborhood ?? r.borough}`, description, path: `/restaurants/${r.id}` });
}

function ExternalA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="link inline-flex items-center gap-1" rel="nofollow noopener noreferrer" target="_blank">
      {children}
      <ExternalLink className="size-3.5 flex-none" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

const isWithheld = (r: Restaurant) => parseHandCheck(r.status_detail)?.kind === "withheld";

/** The status line, unless a hand check withheld a price that was online: then "no price online" is untrue. */
function statusCopy(r: Restaurant): string {
  return isWithheld(r) ? WITHHELD_COPY : STATUS_COPY[r.status];
}

/** The status as a short label for the meta description: the badge's words, or "Prices withheld". */
function statusLabel(r: Restaurant): string {
  return isWithheld(r) ? WITHHELD_COPY.replace(/\.$/, "") : STATUS_LABEL[r.status];
}

/**
 * The label a hand check leaves (pipeline/corrections.py): shown as its own slip, not buried in the
 * status line, because it changes (or withholds) the price the page shows. A label only, so a
 * paragraph rather than a heading: nothing sits under it.
 */
function HandCheckNote({ check }: { check: HandCheck }) {
  const corrected = check.kind === "corrected";
  const Icon = corrected ? ClipboardCheck : EyeOff;
  // "The cook's correction slip": a ruled guest check with a torn top; its text sits on the rules.
  return (
    <div className="slip mt-8">
      <p className="t-label slip-line muted flex items-start gap-2">
        <Icon className="mt-[6px] size-4 flex-none" strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0">
          {/* A no-break space binds the "·" to the words before it, so a wrap puts the date (which never
              wraps) on the next line without a stray leading dot. */}
          {corrected ? "Prices corrected by hand" : "Prices withheld after a hand check"}
          {"\u00a0· "}
          <span className="whitespace-nowrap">{formatDate(check.checkedOn)}</span>
        </span>
      </p>
    </div>
  );
}

/** A chain's other locations. `unpriced` rows show their status instead of the borough. */
function ChainLocationList({ rows, unpriced = false, className = "mt-6" }: { rows: readonly Restaurant[]; unpriced?: boolean; className?: string }) {
  return (
    <ul className={`${className} grid gap-x-8 sm:grid-cols-2`}>
      {rows.map((n) => (
        <li key={n.id} className="flex min-h-12 items-center justify-between gap-3 border-b-[1.5px] border-line py-2">
          <Link href={`/restaurants/${n.id}`} className="ui-link break-anywhere min-w-0">
            {n.neighborhood ?? n.borough}
            <span className="t-ui-s muted block">{n.address}</span>
          </Link>
          <span className="t-ui-s muted text-right">{unpriced ? STATUS_LABEL[n.status] : n.borough}</span>
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
  // A chain's other locations, split by whether they carry its menu price.
  const chainOthers = getChainLocations(r);
  const { priced: chainPricedOthers, unpriced: chainUnpricedOthers } = chainCoverage(chainOthers);
  const chainPricedLocations = chainPricedOthers.length + (priced ? 1 : 0);
  const neighborRepeats = repeatedNames(
    neighbors.map((m) => m.restaurant),
    [r],
  );
  const check = parseHandCheck(r.status_detail);

  const crumbs = [
    { href: "/boroughs", label: "Boroughs" },
    { href: `/boroughs/${boroughSlug(r.borough)}`, label: r.borough },
    ...(r.neighborhood && r.neighborhood_slug ? [{ href: `/neighborhoods/${r.neighborhood_slug}`, label: r.neighborhood }] : []),
    { label: r.name },
  ];

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        overline={<DetailOverline label={r.cuisine ? `Restaurant · ${r.cuisine}` : "Restaurant"} />}
        title={r.name}
        lede={
          <>
            {[r.address, r.neighborhood].filter(Boolean).join(", ")}
            {r.address || r.neighborhood ? ", " : ""}
            {r.borough}
            {r.zipcode ? ` ${r.zipcode}` : ""}.
          </>
        }
      >
        {/* Status and source sit under the lede (DESIGN.md "Page header"); each badge has its own fill. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={r.status} />
          <SourceBadge source={r.price_source} />
        </div>
      </PageHeader>
      <div className="wrap">
      {priced && indexBurger ? (
        <section className="mt-2" aria-label="Index price">
          <StatGrid cols={3}>
            <StatTile
              label="Index price"
              icon={Spatula}
              value={<Money value={r.index_price as number} />}
              sub={
                <>
                  {indexBurger.name}
                  {bin ? ` · ${bin.name}` : ""}
                  {delivery ? " · delivery-app price" : ""}
                </>
              }
            />
            <StatTile
              label={hood ? `vs ${hood.name}` : "vs neighborhood"}
              value={compareHood ? formatDelta(r.index_price, compareHood.median) : "—"}
              sub={
                compareHood
                  ? `Neighborhood median ${formatPrice(compareHood.median, { cents: "always" })} across ${pluralize(compareHood.counts.menus, "menu")}`
                  : r.neighborhood_slug
                    ? "No other priced menu here to compare"
                    : "No neighborhood on file"
              }
            />
            <StatTile
              label="vs NYC"
              icon={Anchor}
              value={median !== null ? formatDelta(r.index_price, median) : "—"}
              sub={median !== null ? `NYC median ${formatPrice(median, { cents: "always" })}` : undefined}
            />
          </StatGrid>
        </section>
      ) : (
        <section className="panel mt-2 p-4 md:p-6" aria-label="Status">
          <div className="flex items-start gap-3">
            <StatusBadge status={r.status} />
          </div>
          <p className="t-body mt-3">{statusCopy(r)}</p>
        </section>
      )}

      {check ? <HandCheckNote check={check} /> : null}

      <section className="section" aria-labelledby="menu">
        <SectionHeading id="menu" title={r.burgers.length ? "Burgers on the menu." : "No burgers listed."} />
        {r.burgers.length ? (
          <ul className="mt-6 max-w-3xl">
            {r.burgers.map((b) => (
              <li key={b.id} id={b.id} className={`menu-item ${b.is_index_item ? "is-index" : ""}`}>
                <div className="menu-line">
                  <span className="t-ui-l break-anywhere min-w-0 font-semibold">{b.name}</span>
                  <span className="menu-leader" aria-hidden="true" />
                  <span className="t-num-l whitespace-nowrap">
                    {b.price === null ? <span className="t-ui-s muted">No price</span> : formatPrice(b.price, { cents: "always" })}
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
        ) : (
          // No burger rows: the status card above names the status, so this only fills the space.
          <div className="mt-6 max-w-3xl">
            <EmptyState height={160} art="trap">
              Nothing on the menu board for this one.
            </EmptyState>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="source">
        <SectionHeading id="source" title="Source and location." />
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <dl className="t-ui-m grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-3 self-start">
            <dt className="t-label muted pt-0.5">Source</dt>
            <dd className="min-w-0">
              {r.price_source ? <SourceBadge source={r.price_source} /> : <span className="muted">None found</span>}
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
                    <MapPin className="size-4" strokeWidth={2} aria-hidden="true" />
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
              <EmptyState height={160} art="trap">
                No coordinates on file for this restaurant, so it isn&apos;t on the map.
              </EmptyState>
            )}
          </div>
        </div>
      </section>

      {neighbors.length ? (
        <section className="section" aria-labelledby="nearby">
          <SectionHeading id="nearby" title={`More in ${r.neighborhood}.`} />
          <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
            {neighbors.map(({ key, restaurant: n, locations }) => (
              <li key={key} className="flex min-h-12 items-center justify-between gap-3 border-b-[1.5px] border-line py-2">
                <span className="min-w-0">
                  <Link href={`/restaurants/${n.id}`} className="ui-link break-anywhere font-semibold">
                    {n.name}
                  </Link>
                  <span className="t-ui-s muted block break-anywhere">
                    {[getIndexBurger(n)?.name, n.chain && locations > 1 ? `chain, ${locations} locations here` : neighborRepeats.has(n.name) ? n.address : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <PriceChip price={n.index_price} median={median} delta={false} />
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
              <SectionHeading id="chain" title={priced ? `Other ${r.name} locations.` : `${r.name} locations with the chain price.`} />
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
              <SectionHeading id="chain" title={`Other ${r.name} locations.`}>
                {priced ? "Listed without the chain price." : "None of them is priced yet either."}
              </SectionHeading>
              <ChainLocationList rows={chainOthers.slice(0, 12)} unpriced />
              {chainOthers.length > 12 ? <p className="t-ui-s muted mt-4">Showing 12 of {formatCount(chainOthers.length)} other locations.</p> : null}
            </>
          )}
        </section>
      ) : null}
      </div>
    </>
  );
}
