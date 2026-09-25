import { Pennant } from "@/components/icons/nautical";
import { PageHeader } from "@/components/ui";
import { BestBurgersBoard } from "@/components/votes/BestBurgersBoard";
import { getRestaurants } from "@/lib/data";
import { pageMetadata } from "@/lib/metadata";
import { voteMenus } from "@/lib/votes";

export const metadata = pageMetadata({
  title: "Best burgers",
  description: "The best burgers in New York, by visitors' votes. Rate any burger from 1 to 10.",
  path: "/best-burgers",
});

/**
 * The visitors' ranking (DESIGN.md "Best burgers leaderboard"). The page is static: it ships the
 * dataset's distinct priced menus (a chain once) and the board loads the votes in the browser.
 */
export default function BestBurgersPage() {
  const menus = voteMenus(getRestaurants());
  return (
    <>
      <PageHeader ticket="Comment cards" ticketIcon={Pennant} title="The best burgers, by your votes." lede="Rate any burger from 1 to 10. The board updates live." />
      <div className="wrap">
        <BestBurgersBoard menus={menus} />
      </div>
    </>
  );
}
