// Client-safe site constants.

export const SITE_NAME = "The Burger Index";
export const SITE_TAGLINE = "What a burger costs in New York.";

export type NavItem = { href: string; label: string };

export const NAV: readonly NavItem[] = [
  { href: "/", label: "Index" },
  { href: "/burgers", label: "Burgers" },
  { href: "/best-burgers", label: "Best burgers" },
  { href: "/map", label: "Map" },
  { href: "/neighborhoods", label: "Neighborhoods" },
  { href: "/boroughs", label: "Boroughs" },
];

/** Minimum distinct priced menus (a chain counts once) for an area to be ranked (DESIGN.md "Neighborhood plot"). */
export const MIN_RANKED = 5;
/** Minimum distinct priced menus in a slice before a histogram is drawn (DESIGN.md "Minimums"). */
export const MIN_HISTOGRAM = 20;

/**
 * `output: "export"` fails the build when a generateStaticParams returns an empty list, and a dataset
 * written before the first scrape has no restaurants or neighborhoods. Dynamic routes then build this
 * one placeholder instead: it can't be a real id or slug (those match ^[a-z0-9-]+$), so the page's
 * lookup misses and it renders the 404. The sitemap maps the real lists, so it never lists it.
 */
export const PLACEHOLDER_PARAM = "_none";

export function atLeastOneParam<T>(params: T[], placeholder: T): T[] {
  return params.length ? params : [placeholder];
}
