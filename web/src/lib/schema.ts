// zod mirror of contract/burger_index.schema.json (version 2). Keep in sync with the contract and
// pipeline/models.py. Every object is strict (additionalProperties: false in the contract).
//
// Server-only: zod is ~90 KB gzipped. Client components import the enum lists from ./enums and
// only types from here (`import type`), which the bundler erases.
import "server-only";

import { z } from "zod";
import { BOROUGHS, PRICE_SOURCES } from "./enums";

const Slug = z.string().regex(/^[a-z0-9-]+$/, "must match ^[a-z0-9-]+$");

const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** JSON Schema "format": "date" (a real calendar day, YYYY-MM-DD), checked as ajv-formats checks it. */
export function isDate(value: string): boolean {
  const d = DATE.exec(value);
  if (!d) return false;
  const year = +d[1];
  const month = +d[2];
  const day = +d[3];
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && leapYear ? 29 : DAYS_IN_MONTH[month]);
}

/**
 * JSON Schema "format": "date-time", checked exactly as ajv-formats checks it in
 * scripts/sync-data.mjs, so a dataset that passes sync-data never fails here at build. That is
 * RFC 3339 read leniently: "T", "t" or a space between date and time, a required "Z"/"z" or
 * numeric offset (+HH:MM, +HHMM or +HH), and a leap second only at 23:59:60 UTC.
 */
export function isDateTime(value: string): boolean {
  const parts = value.split(/t|\s/i);
  if (parts.length !== 2 || !isDate(parts[0])) return false;
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
const IsoDate = z.string().refine(isDate, "must be a calendar date, YYYY-MM-DD");

export const MoneySchema = z.number().min(0).nullable();
export const BoroughSchema = z.enum(BOROUGHS);
export const PriceSourceSchema = z.enum(PRICE_SOURCES);

export const StatsSchema = z.strictObject({
  restaurants_priced: z.number().int().min(0),
  index_median: MoneySchema,
  index_p10: MoneySchema,
  index_p90: MoneySchema,
});

export const AreaSummarySchema = z.strictObject({
  slug: Slug,
  name: z.string(),
  borough: BoroughSchema,
  restaurants_priced: z.number().int().min(0),
  index_median: MoneySchema,
  index_min: MoneySchema,
  index_max: MoneySchema,
});

/** A priced restaurant's one burger; its price is the restaurant's index_price. */
export const BurgerSchema = z.strictObject({
  name: z.string(),
  description: z.string().nullable(),
});

/** A person re-read the live menu and corrected the scraped prices (pipeline/corrections.py). */
export const HandCheckSchema = z.strictObject({
  checked_on: IsoDate,
});

/** A restaurant with an index price: it gets a page. */
export const PricedRestaurantSchema = z.strictObject({
  id: Slug,
  name: z.string(),
  chain: z.string().nullable(),
  address: z.string().nullable(),
  borough: BoroughSchema,
  neighborhood: z.string().nullable(),
  neighborhood_slug: Slug.nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  website: z.string().nullable(),
  menu_url: z.string(),
  price_source: PriceSourceSchema,
  index_price: z.number().min(0),
  burger: BurgerSchema,
  hand_check: HandCheckSchema.nullable(),
});

/** A restaurant without an index price: no page, only its name on its neighborhood's page. */
export const UnpricedRestaurantSchema = z.strictObject({
  id: Slug,
  name: z.string(),
  address: z.string().nullable(),
  neighborhood_slug: Slug.nullable(),
  index_price: z.null(),
  burger: z.null(),
});

// The contract picks the shape by index_price: null -> UnpricedRestaurant, else PricedRestaurant.
export const RestaurantSchema = z.union([PricedRestaurantSchema, UnpricedRestaurantSchema]);

export const BurgerIndexSchema = z.strictObject({
  version: z.literal(2),
  generated_at: DateTime,
  stats: StatsSchema,
  boroughs: z.array(AreaSummarySchema),
  neighborhoods: z.array(AreaSummarySchema),
  restaurants: z.array(RestaurantSchema),
});

export type Borough = z.infer<typeof BoroughSchema>;
export type PriceSource = z.infer<typeof PriceSourceSchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type AreaSummary = z.infer<typeof AreaSummarySchema>;
export type Burger = z.infer<typeof BurgerSchema>;
export type HandCheck = z.infer<typeof HandCheckSchema>;
export type PricedRestaurant = z.infer<typeof PricedRestaurantSchema>;
export type UnpricedRestaurant = z.infer<typeof UnpricedRestaurantSchema>;
/** One restaurant location in the dataset: priced (a page) or unpriced (a name). `isPriced` tells them apart. */
export type Restaurant = PricedRestaurant | UnpricedRestaurant;
export type BurgerIndex = z.infer<typeof BurgerIndexSchema>;
