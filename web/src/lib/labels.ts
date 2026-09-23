// Display labels and copy for contract enums (DESIGN.md "Source badges", "Status badges", "Voice").
import type { Borough, PriceSource, Protein, Status } from "./schema";

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  official_site: "Restaurant site",
  official_pdf: "Menu PDF",
  online_ordering: "Online ordering",
  menu_aggregator: "Menu aggregator",
  delivery_app: "Delivery app †",
};

/** Plain label without the dagger, for filters and prose. */
export const PRICE_SOURCE_NAME: Record<PriceSource, string> = {
  official_site: "Restaurant site",
  official_pdf: "Menu PDF",
  online_ordering: "Online ordering",
  menu_aggregator: "Menu aggregator",
  delivery_app: "Delivery app",
};

export const PRICE_SOURCE_MEANING: Record<PriceSource, string> = {
  official_site: "The restaurant's own website lists the menu with prices.",
  official_pdf: "A menu PDF published by the restaurant. PDFs can go stale between reprints.",
  online_ordering: "The restaurant's own online-ordering page (pickup prices).",
  menu_aggregator: "A third-party menu listing site. Usually accurate, sometimes out of date.",
  // DELIVERY_NOTE is shown beside every delivery-app price already; this line doesn't repeat it.
  delivery_app: "A delivery-app listing of the restaurant's menu.",
};

export const DELIVERY_NOTE = "Delivery-app prices usually run higher than ordering in person.";

export const STATUS_LABEL: Record<Status, string> = {
  priced: "Priced",
  no_prices: "No prices online",
  no_burgers: "No burgers",
  no_menu_found: "No menu found",
  error: "Scrape failed",
};

export const STATUS_COPY: Record<Status, string> = {
  priced: "We found a priced beef burger on this menu.",
  no_burgers: "Menu found. No burgers on it. We checked.",
  no_prices: "There's a burger on the menu, but no price online. Market price, apparently.",
  no_menu_found: "We couldn't find a menu online for this place.",
  error: "Our scraper choked on this menu. It tries again next update.",
};

/**
 * Replaces STATUS_COPY.no_prices when the menu does have a price online but a hand check withheld it
 * (pipeline/corrections.py `withhold`): "no price online" would contradict the hand-check note.
 */
export const WITHHELD_COPY = "We found a price online but couldn't confirm it against a current menu, so we left it out.";

export const PROTEIN_LABEL: Record<Protein, string> = {
  beef: "Beef",
  chicken: "Chicken",
  turkey: "Turkey",
  fish: "Fish",
  veggie: "Veggie",
  lamb: "Lamb",
  pork: "Pork",
  other: "Other",
};

export const BOROUGH_SHORT: Record<Borough, string> = {
  Manhattan: "Manhattan",
  Brooklyn: "Brooklyn",
  Queens: "Queens",
  Bronx: "Bronx",
  "Staten Island": "Staten Island",
};
