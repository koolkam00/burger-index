// Restaurant rows for tests, in the dataset's two shapes. Test-only (not a *.test.ts file).
import type { Borough, Restaurant } from "../src/lib/schema";

let seq = 0;

/**
 * A priced restaurant (one burger, its price the index price) or, with `price: null`, an unpriced one,
 * which the dataset carries only as a name. `hood` is both the neighborhood name and its slug.
 */
export function place(opts: {
  id?: string;
  name?: string;
  chain?: string | null;
  price: number | null;
  burger?: string;
  borough?: Borough;
  hood?: string | null;
}): Restaurant {
  seq += 1;
  const id = opts.id ?? `${opts.chain ?? "place"}-${seq}`;
  const name = opts.name ?? (opts.chain ? opts.chain.toUpperCase() : id);
  const address = `${seq} Test Street`;
  const hood = opts.hood ?? null;
  if (opts.price === null) return { id, name, address, neighborhood_slug: hood, index_price: null, burger: null };
  return {
    id,
    name,
    chain: opts.chain ?? null,
    address,
    borough: opts.borough ?? "Manhattan",
    neighborhood: hood,
    neighborhood_slug: hood,
    lat: null,
    lng: null,
    website: null,
    menu_url: "https://example.com/menu",
    price_source: "official_site",
    index_price: opts.price,
    burger: { name: opts.burger ?? "Cheeseburger", description: null },
    hand_check: null,
  };
}
