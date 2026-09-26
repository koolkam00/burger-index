import { LANDMARK_TICKET_ICON, LandmarkLinks } from "@/components/Landmarks";
import { JsonLd } from "@/components/JsonLd";
import { RankingLinks } from "@/components/Rankings";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui";
import { getGeneratedAt, getPricedRestaurants } from "@/lib/data";
import { formatMonthYear } from "@/lib/format";
import { breadcrumbNode, itemListNode } from "@/lib/jsonld";
import { landmarkPages } from "@/lib/landmark-routes";
import { LANDMARKS_CRUMB, LANDMARKS_NAME, LANDMARKS_PATH, LANDMARKS_TICKET, landmarkPath, landmarksHubSentence, mostSentence, mostSpots, RADIUS_WORDS, WALK_WORDS } from "@/lib/landmarks";
import { pageMetadata, SITE_URL } from "@/lib/metadata";
import { rankingSpecs } from "@/lib/rankings";
import { landmarksHubSeo } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

const pages = landmarkPages();
const most = pages.length > 1 ? mostSpots(pages) : null;

export const metadata = pageMetadata({
  ...landmarksHubSeo({ landmarks: pages.length, radius: RADIUS_WORDS, walk: WALK_WORDS, most: most ? mostSentence(most) : null, generatedAt: getGeneratedAt() }),
  path: LANDMARKS_PATH,
});

/**
 * Burgers near NYC landmarks (user decision 2026-09-26): every landmark with a page (at least 5 priced burger spots
 * within half a mile), grouped by borough, each with its spot count and the range of the spots' priciest burgers.
 * ItemList JSON-LD restates the list; the page keeps the site's /og.png (each landmark page has its own image).
 */
export default function BurgersNearPage() {
  const crumbs = [{ href: "/", label: SITE_NAME }, { label: LANDMARKS_CRUMB }];
  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbNode(SITE_URL, crumbs, LANDMARKS_PATH),
          pages.length ? itemListNode(SITE_URL, { name: LANDMARKS_NAME, entries: pages.map((p) => ({ name: p.landmark.name, path: landmarkPath(p.landmark) })) }) : null,
        ]}
      />
      <PageHeader crumbs={crumbs} ticket={LANDMARKS_TICKET} ticketIcon={LANDMARK_TICKET_ICON} title={`${LANDMARKS_NAME}.`} lede={landmarksHubSentence(pages, formatMonthYear(getGeneratedAt()))} />
      <div className="wrap">
        <section className="mt-2" aria-label={LANDMARKS_NAME}>
          {pages.length ? (
            <LandmarkLinks pages={pages} headingLevel={2} />
          ) : (
            <EmptyState height={200}>No landmark has burger spots nearby yet. Nothing in the net.</EmptyState>
          )}
        </section>

        <section className="section" aria-labelledby="more-rankings">
          <SectionHeading id="more-rankings" title="More burger rankings." />
          <div className="mt-6">
            <RankingLinks current={LANDMARKS_PATH} available={rankingSpecs(getPricedRestaurants())} />
          </div>
        </section>
      </div>
    </>
  );
}
