// Display labels and copy for contract enums (DESIGN.md "Source badges", "Status badges", "Voice").
import type { PriceSource, Protein, Status } from "./schema";

/** Source badge labels, also used by the explorer's Source filter. */
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  official_site: "Restaurant site",
  official_pdf: "Menu PDF",
  online_ordering: "Online ordering",
  menu_aggregator: "Menu aggregator",
  delivery_app: "Delivery app",
};

export const STATUS_LABEL: Record<Status, string> = {
  priced: "Priced",
  no_prices: "No prices online",
  no_burgers: "No burgers",
  no_menu_found: "No menu found",
  error: "Scrape failed",
};

export const STATUS_COPY: Record<Status, string> = {
  priced: "This menu is priced.",
  no_burgers: "Menu found, but no beef burger on the page we read.",
  no_prices: "There's a burger on the menu, but no price online. Market price, apparently.",
  no_menu_found: "We couldn't find a menu online for this place. Lost at sea, for now.",
  error: "This menu ran aground. No prices for now.",
};

/**
 * Replaces STATUS_COPY.no_prices when the menu does have a price online but a hand check withheld it
 * (pipeline/corrections.py `withhold`): "no price online" would contradict the hand-check note.
 */
export const WITHHELD_COPY = "Prices withheld.";

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
