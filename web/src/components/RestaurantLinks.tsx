"use client";

// The restaurant page's links out (menu page, website) and to the map, as client components only so
// a click can send its analytics event (lib/analytics; a no-op without the PostHog key). They render
// exactly what the page rendered before.
import { ExternalLink, MapPin } from "lucide-react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { linkHost, track } from "@/lib/analytics";
import type { PriceSource } from "@/lib/schema";

/** A link to the restaurant's menu page or website, opened in a new tab. */
export function OutboundLink({
  href,
  kind,
  restaurantId,
  priceSource,
  children,
}: {
  href: string;
  kind: "menu" | "website";
  restaurantId: string;
  priceSource: PriceSource;
  children: ReactNode;
}) {
  // A click, or a middle click (auxclick with the wheel button), follows the link.
  const log = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.type === "auxclick" && e.button !== 1) return;
    track(kind === "menu" ? "menu_link_clicked" : "website_link_clicked", { restaurant_id: restaurantId, host: linkHost(href), price_source: priceSource });
  };
  return (
    <a href={href} className="link inline-flex items-center gap-1" rel="nofollow noopener noreferrer" target="_blank" onClick={log} onAuxClick={log}>
      {children}
      <ExternalLink className="size-3.5 flex-none" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** "See it on the map": /map?r=<id> opens the restaurant's pin. */
export function SeeOnMapLink({ restaurantId }: { restaurantId: string }) {
  return (
    <Link
      className="link inline-flex items-center gap-1"
      href={`/map?r=${encodeURIComponent(restaurantId)}`}
      onClick={() => track("see_on_map_clicked", { restaurant_id: restaurantId })}
    >
      <MapPin className="size-4 flex-none" strokeWidth={2} aria-hidden="true" />
      See it on the map
    </Link>
  );
}
