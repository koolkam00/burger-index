// Contract enum values (contract/burger_index.schema.json), with no zod attached. Client components
// import these (and types from ./schema) so zod stays out of the browser bundle; schema.ts builds
// its validators from the same lists.

export const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"] as const;
export const PRICE_SOURCES = ["official_site", "official_pdf", "online_ordering", "delivery_app", "menu_aggregator"] as const;
