// The landmarks of the "Burgers near <landmark>" pages (user decision 2026-09-26: pages for searches like "burger near
// Times Square"). Plain data with no imports, so the site (src/lib/landmarks.ts) and the post-build check
// (scripts/check-seo.mjs, which recomputes every page from the dataset on its own) read the same points.
//
// Each point is the landmark's coordinates as Wikipedia gives them (the article's primary coordinates, read on
// 2026-09-26 from en.wikipedia.org/api/rest_v1/page/summary/<article>); the comment names the article, and what the
// point is where the page covers two neighboring places. A page lists the priced burger spots within
// LANDMARK_RADIUS_MILES of its point, as the crow flies, and exists only when at least MIN_LANDMARK_SPOTS are that
// close (src/lib/landmarks.ts landmarksWithPages): DUMBO, Yankee Stadium, Citi Field and Coney Island have fewer today,
// so they have no page until the dataset has more spots there. Places that are effectively one are one landmark
// (Penn Station lies under Madison Square Garden; the 9/11 Memorial is the World Trade Center site; the Brooklyn
// Bridge's Manhattan walkway starts at City Hall Park; the High Line runs along Chelsea Market's west side).
//
// Slugs are URLs (/burgers-near/<slug>): never rename one without a redirect.

/**
 * @typedef {"Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island"} LandmarkBorough
 */

/**
 * @typedef {object} Landmark
 * @property {string} slug the page's path segment: /burgers-near/<slug>
 * @property {string} name the landmark as a list row or breadcrumb: "Times Square", "Empire State Building"
 * @property {string} near the landmark inside a sentence, with its article: "Times Square", "the Empire State Building"
 * @property {LandmarkBorough} borough
 * @property {number} lat
 * @property {number} lng
 */

/** Half a mile, about a 10-minute walk. */
export const LANDMARK_RADIUS_MILES = 0.5;
/** LANDMARK_RADIUS_MILES in kilometers (a mile is 1.609344 km). */
export const LANDMARK_RADIUS_KM = LANDMARK_RADIUS_MILES * 1.609344;
/** A landmark has a page only with at least this many priced burger spots (locations) within the radius. */
export const MIN_LANDMARK_SPOTS = 5;

/** @type {readonly Landmark[]} */
export const LANDMARKS = Object.freeze([
  // Wikipedia "Times Square".
  { slug: "times-square", name: "Times Square", near: "Times Square", borough: "Manhattan", lat: 40.7575, lng: -73.9858 },
  // Wikipedia "Madison Square Garden" (Penn Station lies beneath the arena).
  {
    slug: "penn-station-madison-square-garden",
    name: "Penn Station and Madison Square Garden",
    near: "Penn Station and Madison Square Garden",
    borough: "Manhattan",
    lat: 40.75055556,
    lng: -73.99361111,
  },
  // Wikipedia "Grand Central Terminal".
  { slug: "grand-central", name: "Grand Central", near: "Grand Central", borough: "Manhattan", lat: 40.7528, lng: -73.9772 },
  // Wikipedia "Rockefeller Center".
  { slug: "rockefeller-center", name: "Rockefeller Center", near: "Rockefeller Center", borough: "Manhattan", lat: 40.75861111, lng: -73.97916667 },
  // Wikipedia "Empire State Building".
  { slug: "empire-state-building", name: "Empire State Building", near: "the Empire State Building", borough: "Manhattan", lat: 40.7483, lng: -73.9856 },
  // Wikipedia "Bryant Park".
  { slug: "bryant-park", name: "Bryant Park", near: "Bryant Park", borough: "Manhattan", lat: 40.75388889, lng: -73.98388889 },
  // Wikipedia "Union Square, Manhattan".
  { slug: "union-square", name: "Union Square", near: "Union Square", borough: "Manhattan", lat: 40.73555556, lng: -73.99055556 },
  // Wikipedia "Washington Square Park".
  { slug: "washington-square-park", name: "Washington Square Park", near: "Washington Square Park", borough: "Manhattan", lat: 40.73083333, lng: -73.9975 },
  // Wikipedia "National September 11 Memorial & Museum" (the memorial pools, at the heart of the World Trade Center site).
  {
    slug: "world-trade-center",
    name: "World Trade Center and 9/11 Memorial",
    near: "the World Trade Center and the 9/11 Memorial",
    borough: "Manhattan",
    lat: 40.71166667,
    lng: -74.01361111,
  },
  // Wikipedia "New York City Hall" (the Brooklyn Bridge's Manhattan walkway starts at the east side of City Hall Park).
  {
    slug: "city-hall-brooklyn-bridge",
    name: "City Hall and the Brooklyn Bridge",
    near: "City Hall and the Brooklyn Bridge",
    borough: "Manhattan",
    lat: 40.7127,
    lng: -74.0059,
  },
  // Wikipedia "Columbus Circle" (Central Park South runs east from it).
  {
    slug: "columbus-circle",
    name: "Columbus Circle and Central Park South",
    near: "Columbus Circle and Central Park South",
    borough: "Manhattan",
    lat: 40.769,
    lng: -73.982,
  },
  // Wikipedia "Lincoln Center".
  { slug: "lincoln-center", name: "Lincoln Center", near: "Lincoln Center", borough: "Manhattan", lat: 40.7725, lng: -73.9839 },
  // Wikipedia "Metropolitan Museum of Art" (the museum itself: Museum Mile runs on for 2 km, beyond the radius).
  { slug: "the-met", name: "The Met", near: "the Met", borough: "Manhattan", lat: 40.7794, lng: -73.9631 },
  // Wikipedia "Chelsea Market" (the High Line runs along its west side).
  {
    slug: "chelsea-market-high-line",
    name: "Chelsea Market and the High Line",
    near: "Chelsea Market and the High Line",
    borough: "Manhattan",
    lat: 40.7425,
    lng: -74.00611111,
  },
  // Wikipedia "Vessel (structure)" (the centerpiece of Hudson Yards' public square).
  { slug: "hudson-yards", name: "Hudson Yards", near: "Hudson Yards", borough: "Manhattan", lat: 40.7538, lng: -74.0022 },
  // Wikipedia "Barclays Center".
  { slug: "barclays-center", name: "Barclays Center", near: "Barclays Center", borough: "Brooklyn", lat: 40.68266111, lng: -73.975225 },
  // Wikipedia "Dumbo, Brooklyn".
  { slug: "dumbo", name: "DUMBO", near: "DUMBO", borough: "Brooklyn", lat: 40.703, lng: -73.99 },
  // Wikipedia "Bedford Avenue station" (the L stop at North 7th Street, Williamsburg).
  {
    slug: "bedford-avenue-williamsburg",
    name: "Bedford Avenue L stop, Williamsburg",
    near: "the Bedford Avenue L stop in Williamsburg",
    borough: "Brooklyn",
    lat: 40.71772,
    lng: -73.95756,
  },
  // Wikipedia "Coney Island".
  { slug: "coney-island", name: "Coney Island", near: "Coney Island", borough: "Brooklyn", lat: 40.575, lng: -73.9825 },
  // Wikipedia "Citi Field".
  { slug: "citi-field", name: "Citi Field", near: "Citi Field", borough: "Queens", lat: 40.75694444, lng: -73.84583333 },
  // Wikipedia "Yankee Stadium".
  { slug: "yankee-stadium", name: "Yankee Stadium", near: "Yankee Stadium", borough: "Bronx", lat: 40.82916667, lng: -73.92638889 },
]);
