// Client-safe site constants.

export const SITE_NAME = "The Burger Index";

export type NavItem = { href: string; label: string };

export const NAV: readonly NavItem[] = [
  { href: "/", label: "Index" },
  { href: "/burgers", label: "Burgers" },
  { href: "/peoples-price", label: "People's Price" },
  { href: "/map", label: "Map" },
  { href: "/neighborhoods", label: "Neighborhoods" },
];

/** The ranking pages' paths (lib/rankings.ts rankingPath): /cheapest-burgers[/borough], /most-expensive-burgers[/borough], /burgers-under-N. */
export function isRankingPath(pathname: string): boolean {
  return /^\/(cheapest-burgers|most-expensive-burgers|burgers-under-\d+)(\/|$)/.test(pathname);
}

/**
 * The home page's burger pricer (lib/pricer): its anchor and the id of the heading that labels it, the header's "Price
 * a burger" link to it, and the window event that scrolls to and focuses it when the visitor is already on the home
 * page. Here, not in lib/pricer, so the header (on every page) doesn't pull the pricer's code in.
 */
export const PRICER_ANCHOR = "price";
export const PRICER_TITLE_ID = "price-title";
export const PRICER_HREF = `/#${PRICER_ANCHOR}`;
export const PRICER_FOCUS_EVENT = "burger-index:price-a-burger";

/** Where the borough comparison lives since /boroughs was folded into the home page (breadcrumbs). */
export const BOROUGHS_HREF = "/#boroughs";

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
