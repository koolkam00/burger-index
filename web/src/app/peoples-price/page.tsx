import { Scales } from "@/components/icons/nautical";
import { PageHeader } from "@/components/ui";
import { PeoplesPriceBoard } from "@/components/worth/PeoplesPriceBoard";
import { getMenuCounts, getRestaurants, getStats } from "@/lib/data";
import { pageMetadata } from "@/lib/metadata";
import { worthMenus } from "@/lib/worth";

export const metadata = pageMetadata({
  title: "The People's Price",
  description: "What visitors would pay for New York's burgers, next to what the menus charge: the biggest bargains, the most overpriced and the most answered.",
  path: "/peoples-price",
});

/**
 * "What's it worth?" (DESIGN.md "The People's Price page"). The page is static: it ships the
 * dataset's distinct priced menus (a chain once) and the Burger Index, and the board loads the
 * answers in the browser.
 */
export default function PeoplesPricePage() {
  const menus = worthMenus(getRestaurants());
  return (
    <>
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
