// Client-safe site constants.

export const SITE_NAME = "The Burger Index";
export const SITE_TAGLINE = "What a burger costs in New York.";

export type NavItem = { href: string; label: string };

export const NAV: readonly NavItem[] = [
  { href: "/", label: "Index" },
  { href: "/burgers", label: "Burgers" },
  { href: "/map", label: "Map" },
  { href: "/neighborhoods", label: "Neighborhoods" },
  { href: "/boroughs", label: "Boroughs" },
  { href: "/methodology", label: "Methodology" },
];

/** Minimum priced restaurants for an area to be ranked (DESIGN.md "Neighborhood plot"). */
export const MIN_RANKED = 5;
/** Minimum priced restaurants in a slice before a histogram is drawn (DESIGN.md "Minimums"). */
export const MIN_HISTOGRAM = 20;
