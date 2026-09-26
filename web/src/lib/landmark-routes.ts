// The landmark routes' pages and params (server-only: read from the dataset). The pages are exactly
// landmarks.ts landmarksWithPages; any other slug is a 404 (dynamicParams = false). `output: "export"` fails on an
// empty generateStaticParams, so an empty set is one placeholder that renders the 404 (site.ts PLACEHOLDER_PARAM).
import "server-only";

import { getPricedRestaurants } from "./data";
import { landmarksWithPages, type LandmarkPage } from "./landmarks";
import { atLeastOneParam, PLACEHOLDER_PARAM } from "./site";

const PAGES = landmarksWithPages(getPricedRestaurants());

/** Every landmark with a page, in hub order (borough order, then landmarks.mjs order). */
export function landmarkPages(): readonly LandmarkPage[] {
  return PAGES;
}

export function landmarkPage(slug: string): LandmarkPage | undefined {
  return PAGES.find((p) => p.landmark.slug === slug);
}

export function landmarkParams(): Array<{ landmark: string }> {
  return atLeastOneParam(
    PAGES.map((p) => ({ landmark: p.landmark.slug })),
    { landmark: PLACEHOLDER_PARAM },
  );
}
