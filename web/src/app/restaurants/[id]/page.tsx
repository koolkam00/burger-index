import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorthPicker } from "@/components/worth/WorthPicker";
import { repeatedNames } from "@/components/RestaurantBits";
import { OutboundLink, SeeOnMapLink } from "@/components/RestaurantLinks";
import { Scales } from "@/components/icons/nautical";
import { DetailOverline, Money, PageHeader, PriceChip, SectionHeading, SourceBadge } from "@/components/ui";
import { boroughSlug } from "@/lib/boroughs";
import {
  getChainLocations,
  getNeighborhood,
  getPricedRestaurant,
  getPricedRestaurants,
  getRestaurantsInNeighborhood,
  getStats,
  neighborhoodMenuCounts,
} from "@/lib/data";
import { formatDate, formatDelta, formatPrice, hostname, safeHttpUrl } from "@/lib/format";
import { hasOtherMenus, menuKey, menusByIndexPrice } from "@/lib/menus";
import { pageMetadata } from "@/lib/metadata";
import { atLeastOneParam, BOROUGHS_HREF, PLACEHOLDER_PARAM } from "@/lib/site";
import { WORTH_ANCHOR } from "@/lib/worth";

export const dynamicParams = false;

// Only priced restaurants get a page (user decision 2026-09-25): an unpriced id is a 404.
export function generateStaticParams() {
  return atLeastOneParam(getPricedRestaurants().map((r) => ({ id: r.id })), { id: PLACEHOLDER_PARAM });
}

export async function generateMetadata({ params }: PageProps<"/restaurants/[id]">): Promise<Metadata> {
  const { id } = await params;
  const r = getPricedRestaurant(id);
  if (!r) return {};
  const where = r.neighborhood ? `${r.neighborhood}, ${r.borough}` : r.borough;
  const description = `${r.name} (${where}): ${r.burger.name}, ${formatPrice(r.index_price, { cents: "always" })}.`;
  return pageMetadata({ title: `${r.name}, ${r.neighborhood ?? r.borough}`, description, path: `/restaurants/${r.id}` });
}

/**
 * The label a hand check leaves (the dataset's hand_check, from pipeline/corrections.py): shown as its
 * own slip, because it changes the price the page shows. A label only, so a paragraph rather than a
 * heading: nothing sits under it.
 */
function HandCheckNote({ checkedOn }: { checkedOn: string }) {
  // "The cook's correction slip": a ruled guest check with a torn top; its text sits on the rules.
  return (
    <div className="slip mt-8">
      <p className="t-label slip-line muted flex items-start gap-2">
        <ClipboardCheck className="mt-[6px] size-4 flex-none" strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0">
          {/* A no-break space binds the "·" to the words before it, so a wrap puts the date (which never
              wraps) on the next line without a stray leading dot. */}
          Prices corrected by hand
          {"\u00a0· "}
          <span className="whitespace-nowrap">{formatDate(checkedOn)}</span>
        </span>
      </p>
    </div>
  );
}

/** One comparison in the burger block: "vs West Village", "+12%", "Neighborhood median $16.50". */
function Versus({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <dt className="t-label muted break-anywhere">{label}</dt>
      <dd className="t-num-l mt-1">{value}</dd>
      <dd className="t-ui-s muted mt-0.5">{sub}</dd>
    </div>
  );
}

export default async function RestaurantPage({ params }: PageProps<"/restaurants/[id]">) {
  const { id } = await params;
  const r = getPricedRestaurant(id);
  if (!r) notFound();
  const { burger, index_price: price } = r;

  const median = getStats().index_median;
  const hood = r.neighborhood_slug ? getNeighborhood(r.neighborhood_slug) : undefined;
  const website = safeHttpUrl(r.website);
  const menuUrl = safeHttpUrl(r.menu_url);
  const onMap = r.lat !== null && r.lng !== null;
  // Other menus nearby, one card per menu: this restaurant's own chain is left out, and a chain with
  // several locations here shows once.
  const hoodMenus = r.neighborhood_slug ? menusByIndexPrice(getRestaurantsInNeighborhood(r.neighborhood_slug)) : [];
  const neighbors = hoodMenus.filter((m) => m.key !== menuKey(r)).slice(0, 6);
  const hoodCounts = r.neighborhood_slug ? neighborhoodMenuCounts(r.neighborhood_slug) : null;
  // "vs neighborhood" needs another priced menu there (five locations of one chain are one menu).
  const hoodMedian = hood && hoodCounts && hood.index_median !== null && hasOtherMenus(hoodCounts) ? hood.index_median : null;
  const versus = [
    hood && hoodMedian !== null ? { label: `vs ${hood.name}`, value: formatDelta(price, hoodMedian), sub: `Neighborhood median ${formatPrice(hoodMedian, { cents: "always" })}` } : null,
    median !== null ? { label: "vs NYC", value: formatDelta(price, median), sub: `NYC median ${formatPrice(median, { cents: "always" })}` } : null,
  ].filter((v) => v !== null);
  // A chain's other priced locations (an unpriced one has no page).
  const chainOthers = getChainLocations(r);
  const neighborRepeats = repeatedNames(
    neighbors.map((m) => m.restaurant),
    [r],
  );

  const crumbs = [
    { href: BOROUGHS_HREF, label: "Boroughs" },
    { href: `/boroughs/${boroughSlug(r.borough)}`, label: r.borough },
    ...(r.neighborhood && r.neighborhood_slug ? [{ href: `/neighborhoods/${r.neighborhood_slug}`, label: r.neighborhood }] : []),
    { label: r.name },
  ];

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        overline={<DetailOverline label="Restaurant" />}
        title={r.name}
        lede={`${[r.address, r.neighborhood, r.borough].filter(Boolean).join(", ")}.`}
      />
      <div className="wrap">
        {/* "The burger": the one burger this page is about, its price and how it compares. */}
        <section id="burger" className="mt-2 max-w-3xl" aria-labelledby="burger-title">
          <div className="panel p-4 md:p-6">
            <h2 id="burger-title" className="t-label muted">
              The burger
            </h2>
            <div className="menu-line mt-3">
              <p className="t-display-s break-anywhere min-w-0">{burger.name}</p>
              <span className="menu-leader" aria-hidden="true" />
              <p className="t-stat whitespace-nowrap">
                <Money value={price} />
              </p>
            </div>
            {burger.description ? <p className="t-body-s muted prose-width mt-2">{burger.description}</p> : null}
            {versus.length ? (
              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t-[1.5px] border-line pt-4">
                {versus.map((v) => (
                  <Versus key={v.label} {...v} />
                ))}
              </dl>
            ) : null}
            <div className="mt-4">
              <SourceBadge source={r.price_source} />
            </div>
          </div>
          <ul className="t-ui-m mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {menuUrl ? (
              <li>
                <span className="muted">Menu page:</span>{" "}
                <OutboundLink href={menuUrl} kind="menu" restaurantId={r.id} priceSource={r.price_source}>
                  {hostname(menuUrl)}
                </OutboundLink>
              </li>
            ) : null}
            {website ? (
              <li>
                <span className="muted">Website:</span>{" "}
                <OutboundLink href={website} kind="website" restaurantId={r.id} priceSource={r.price_source}>
                  {hostname(website)}
                </OutboundLink>
              </li>
            ) : null}
            {onMap ? (
              <li>
                <SeeOnMapLink restaurantId={r.id} />
              </li>
            ) : null}
          </ul>
        </section>

        {r.hand_check ? <HandCheckNote checkedOn={r.hand_check.checked_on} /> : null}

        {/* "What's it worth?": visitors name their price for the menu's burger (a chain's locations
            share one menu, so one People's Price). The board links here by the section's id. */}
        <section id={WORTH_ANCHOR} className="section" aria-labelledby="worth-title">
          <SectionHeading id="worth-title" kicker="What's it worth?" icon={Scales} title="What would you pay?" />
          <div className="mt-6 max-w-3xl">
            <WorthPicker menuKey={menuKey(r)} restaurantId={r.id} burger={burger.name} price={price} />
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
                      {[n.burger.name, n.chain && locations > 1 ? `chain, ${locations} locations here` : neighborRepeats.has(n.name) ? n.address : null].filter(Boolean).join(" · ")}
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
            <SectionHeading id="chain" title={`Other ${r.name} locations.`} />
            <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
              {chainOthers.map((n) => (
                <li key={n.id} className="flex min-h-12 items-center justify-between gap-3 border-b-[1.5px] border-line py-2">
                  <Link href={`/restaurants/${n.id}`} className="ui-link break-anywhere min-w-0">
                    {n.neighborhood ?? n.borough}
                    <span className="t-ui-s muted block">{n.address}</span>
                  </Link>
                  <span className="t-ui-s muted text-right">{n.borough}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
