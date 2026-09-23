// zod mirror of contract/burger_index.schema.json. Keep in sync with the contract and
// pipeline/models.py. Every object is strict (additionalProperties: false in the contract).
import { z } from "zod";

export const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"] as const;
export const PROTEINS = ["beef", "chicken", "turkey", "fish", "veggie", "lamb", "pork", "other"] as const;
export const STATUSES = ["priced", "no_burgers", "no_prices", "no_menu_found", "error"] as const;
export const PRICE_SOURCES = ["official_site", "official_pdf", "online_ordering", "delivery_app", "menu_aggregator"] as const;

const Slug = z.string().regex(/^[a-z0-9-]+$/, "must match ^[a-z0-9-]+$");
// JSON Schema "format": "date-time" is RFC 3339: a UTC "Z" or a numeric offset is required.
const DateTime = z.iso.datetime({ offset: true });

export const MoneySchema = z.number().min(0).nullable();
export const BoroughSchema = z.enum(BOROUGHS);
export const ProteinSchema = z.enum(PROTEINS);
export const StatusSchema = z.enum(STATUSES);
export const PriceSourceSchema = z.enum(PRICE_SOURCES);

export const MethodologySchema = z.strictObject({
  index_price_rule: z.string(),
  sources: z.array(z.string()),
  coverage_note: z.string(),
});

export const StatsSchema = z.strictObject({
  restaurants_scanned: z.number().int().min(0),
  restaurants_priced: z.number().int().min(0),
  burgers: z.number().int().min(0),
  beef_burgers: z.number().int().min(0),
  index_median: MoneySchema,
  index_mean: MoneySchema,
  index_p10: MoneySchema,
  index_p90: MoneySchema,
  all_burgers_median: MoneySchema,
  cheapest_burger_id: z.string().nullable(),
  priciest_burger_id: z.string().nullable(),
});

export const AreaSummarySchema = z.strictObject({
  slug: Slug,
  name: z.string(),
  borough: BoroughSchema,
  restaurants: z.number().int().min(0),
  restaurants_priced: z.number().int().min(0),
  burgers: z.number().int().min(0),
  index_median: MoneySchema,
  index_min: MoneySchema,
  index_max: MoneySchema,
});

export const BurgerSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  price: MoneySchema,
  description: z.string().nullable(),
  protein: ProteinSchema,
  is_index_item: z.boolean(),
});

export const RestaurantSchema = z.strictObject({
  id: Slug,
  camis: z.string().nullable(),
  name: z.string(),
  chain: z.string().nullable(),
  address: z.string().nullable(),
  borough: BoroughSchema,
  neighborhood: z.string().nullable(),
  neighborhood_slug: Slug.nullable(),
  zipcode: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  cuisine: z.string().nullable(),
  website: z.string().nullable(),
  menu_url: z.string().nullable(),
  price_source: PriceSourceSchema.nullable(),
  status: StatusSchema,
  status_detail: z.string().nullable(),
  scraped_at: DateTime.nullable(),
  index_price: MoneySchema,
  burgers: z.array(BurgerSchema),
});

export const BurgerIndexSchema = z.strictObject({
  version: z.literal(1),
  generated_at: DateTime,
  currency: z.literal("USD"),
  methodology: MethodologySchema,
  stats: StatsSchema,
  boroughs: z.array(AreaSummarySchema),
  neighborhoods: z.array(AreaSummarySchema),
  restaurants: z.array(RestaurantSchema),
});

export type Borough = z.infer<typeof BoroughSchema>;
export type Protein = z.infer<typeof ProteinSchema>;
export type Status = z.infer<typeof StatusSchema>;
export type PriceSource = z.infer<typeof PriceSourceSchema>;
export type Methodology = z.infer<typeof MethodologySchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type AreaSummary = z.infer<typeof AreaSummarySchema>;
export type Burger = z.infer<typeof BurgerSchema>;
export type Restaurant = z.infer<typeof RestaurantSchema>;
export type BurgerIndex = z.infer<typeof BurgerIndexSchema>;
