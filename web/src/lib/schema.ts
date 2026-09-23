// zod mirror of contract/burger_index.schema.json. Keep in sync with the contract and
// pipeline/models.py. Every object is strict (additionalProperties: false in the contract).
//
// Server-only: zod is ~90 KB gzipped. Client components import the enum lists from ./enums and
// only types from here (`import type`), which the bundler erases.
import "server-only";

import { z } from "zod";
import { BOROUGHS, PRICE_SOURCES, PROTEINS, STATUSES } from "./enums";

const Slug = z.string().regex(/^[a-z0-9-]+$/, "must match ^[a-z0-9-]+$");

const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * JSON Schema "format": "date-time", checked exactly as ajv-formats checks it in
 * scripts/sync-data.mjs, so a dataset that passes sync-data never fails here at build. That is
 * RFC 3339 read leniently: "T", "t" or a space between date and time, a required "Z"/"z" or
 * numeric offset (+HH:MM, +HHMM or +HH), and a leap second only at 23:59:60 UTC.
 */
export function isDateTime(value: string): boolean {
  const parts = value.split(/t|\s/i);
  if (parts.length !== 2) return false;
  const d = DATE.exec(parts[0]);
  if (!d) return false;
  const year = +d[1];
  const month = +d[2];
  const day = +d[3];
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (month < 1 || month > 12 || day < 1 || day > (month === 2 && leapYear ? 29 : DAYS_IN_MONTH[month])) return false;
  const t = TIME.exec(parts[1]);
  if (!t || !t[4]) return false;
  const hour = +t[1];
  const minute = +t[2];
  const second = +t[3];
  const sign = t[5] === "-" ? -1 : 1;
  const tzHour = +(t[6] || 0);
  const tzMinute = +(t[7] || 0);
  if (tzHour > 23 || tzMinute > 59) return false;
  if (hour <= 23 && minute <= 59 && second < 60) return true;
  const utcMinute = minute - tzMinute * sign;
  const utcHour = hour - tzHour * sign - (utcMinute < 0 ? 1 : 0);
  return (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1) && second < 61;
}

const DateTime = z.string().refine(isDateTime, "must be an RFC 3339 date-time with a UTC offset");

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
