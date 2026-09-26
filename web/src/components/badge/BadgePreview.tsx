// One restaurant's badge on the badge page (DESIGN.md "Price badge"): the badge as a restaurant's site would
// show it, then its HTML and image address to copy, and a link to the restaurant's page here. Rendered by
// the page itself (the example, in the static HTML) and by BadgeFinder once a restaurant is picked.
import Link from "next/link";
import { badgeAlt, badgePath, badgeSnippet, badgeText, BADGE_HEIGHT, BADGE_WIDTH, type BadgeSpot } from "@/lib/badge";
import { CopyField } from "../CopyField";

/** The preview's heading: the badge page moves focus here when a restaurant is picked. */
export const BADGE_TITLE_ID = "badge-title";

export type BadgeContext = { site: string; cityMedian: number | null; generatedAt: string; hoods: Readonly<Record<string, string>> };

export function BadgePreview({ spot, context, example }: { spot: BadgeSpot; context: BadgeContext; example: boolean }) {
  const text = badgeText({ price: spot.price, cityMedian: context.cityMedian, generatedAt: context.generatedAt });
  const where = [spot.hood ? context.hoods[spot.hood] : null, spot.borough].filter(Boolean).join(", ");
  return (
    <div className="panel badge-card p-4 md:p-6">
      <p className="t-label muted">{example ? "Example badge" : "Your badge"}</p>
      <h3 id={BADGE_TITLE_ID} tabIndex={-1} className="t-display-s break-anywhere mt-2 outline-none">
        {spot.name}
      </h3>
      <p className="t-ui-s muted mt-1">{where}</p>
      <div className="badge-stage mt-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG shown as the restaurant's site would show it */}
        <img src={badgePath(spot.id)} width={BADGE_WIDTH} height={BADGE_HEIGHT} alt={badgeAlt(spot.name, text)} loading="lazy" />
      </div>
      <div className="mt-6 grid gap-6">
        <CopyField
          id={`badge-html-${spot.id}`}
          label="HTML"
          button="Copy HTML"
          rows={5}
          value={badgeSnippet({ site: context.site, id: spot.id, name: spot.name, text })}
          event={{ surface: "badge", what: "badge_html", restaurant_id: spot.id }}
        />
        <CopyField
          id={`badge-img-${spot.id}`}
          label="Image address"
          button="Copy the address"
          rows={2}
          value={`${context.site}${badgePath(spot.id)}`}
          event={{ surface: "badge", what: "badge_image", restaurant_id: spot.id }}
        />
      </div>
      <p className="t-ui-m mt-5">
        <Link href={`/restaurants/${spot.id}`} className="link">
          {spot.name} on The Burger Index
        </Link>
      </p>
    </div>
  );
}
