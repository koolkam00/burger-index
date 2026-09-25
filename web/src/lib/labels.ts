// Display labels for contract enums (DESIGN.md "Source badges").
import type { PriceSource } from "./schema";

/** Source badge labels. */
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  official_site: "Restaurant site",
  official_pdf: "Menu PDF",
  online_ordering: "Online ordering",
  menu_aggregator: "Menu aggregator",
  delivery_app: "Delivery app",
};
