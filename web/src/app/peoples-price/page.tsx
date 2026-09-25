import { Scales } from "@/components/icons/nautical";
import { JsonLd } from "@/components/JsonLd";
import { PageHeader } from "@/components/ui";
import { PeoplesPriceBoard } from "@/components/worth/PeoplesPriceBoard";
import { getMenuCounts, getPricedRestaurants, getStats } from "@/lib/data";
import { breadcrumbNode } from "@/lib/jsonld";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { peoplesPriceSeo } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";
import { worthMenus } from "@/lib/worth";

export const metadata = pageMetadata({
  ...peoplesPriceSeo({ menus: getMenuCounts().menus, median: getStats().index_median }),
  path: "/peoples-price",
});

/**
 * "What's it worth?" (DESIGN.md "The People's Price page"). The page is static: it ships the
 * dataset's distinct priced menus (a chain once) and the Burger Index, and the board loads the
 * answers in the browser.
 */
export default function PeoplesPricePage() {
  const menus = worthMenus(getPricedRestaurants());
  // No Review, Rating or AggregateRating markup: the People's Price is visitors' opinion (user decision 2026-09-25).
  return (
    <>
      <JsonLd nodes={[breadcrumbNode(SITE_URL, [{ href: "/", label: SITE_NAME }, { label: "The People's Price" }], "/peoples-price")]} />
      <PageHeader
        ticket="What's it worth?"
        ticketIcon={Scales}
        title="The People's Price."
        lede="What visitors would pay for each burger, next to what the menu charges. Name your price on any restaurant page; the boards update live."
      />
      <div className="wrap">
        <PeoplesPriceBoard menus={menus} burgerIndex={getStats().index_median} menuCount={getMenuCounts().menus} />
      </div>
    </>
  );
}
