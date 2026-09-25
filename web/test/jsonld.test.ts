import assert from "node:assert/strict";
import { test } from "node:test";
import {
  breadcrumbNode,
  datasetNode,
  itemListNode,
  jsonLdDocument,
  offerPrice,
  organizationNode,
  restaurantNode,
  serializeJsonLd,
  websiteNode,
  type RestaurantInput,
} from "../src/lib/jsonld";

const SITE = "https://burger-index.example";

/** The node as a page's JSON-LD carries it (a JSON round trip), loosely typed for the checks. */
function plain(node: unknown) {
  return JSON.parse(JSON.stringify(node));
}

const restaurant: RestaurantInput = {
  path: "/restaurants/3-sheets-saloon-west-village",
  name: "3 Sheets Saloon",
  address: "134 West 3 Street",
  neighborhood: "West Village",
  borough: "Manhattan",
  lat: 40.730797,
  lng: -74.000902,
  website: "https://www.3sheetsnyc.com/",
  menuUrl: "https://www.3sheetsnyc.com/menus/",
  burger: { name: "Fatso’s Burger", description: "Two smashed patties & fries" },
  price: 15.99,
};

test("serializeJsonLd: data can never close the script tag, and parses back to the same value", () => {
  const evil = { "@type": "Thing", name: "</script><script>alert(1)</script>", note: "a & b > c", sep: "x\u2028y\u2029z" };
  const out = serializeJsonLd(evil);
  assert.ok(!out.includes("<"), "no raw <");
  assert.ok(!out.includes(">"), "no raw >");
  assert.ok(!out.includes("&"), "no raw &");
  assert.ok(!/[\u2028\u2029]/.test(out), "no raw line or paragraph separators");
  assert.ok(!/<\/script/i.test(out));
  assert.deepEqual(JSON.parse(out), evil);
});

test("jsonLdDocument: one node inline, several in an @graph, nulls dropped, nothing → null", () => {
  const org = organizationNode(SITE);
  assert.deepEqual(jsonLdDocument([org, null, false]), { "@context": "https://schema.org", ...org });
  const both = jsonLdDocument([org, websiteNode(SITE, "desc")]);
  assert.equal(both?.["@context"], "https://schema.org");
  assert.equal((both?.["@graph"] as unknown[]).length, 2);
  assert.equal(jsonLdDocument([null, undefined]), null);
});

test("offerPrice: a dot-decimal string with two places", () => {
  assert.equal(offerPrice(15.99), "15.99");
  assert.equal(offerPrice(20), "20.00");
  assert.equal(offerPrice(7.5), "7.50");
  assert.equal(offerPrice(12.345), "12.35");
});

test("restaurantNode: Restaurant with PostalAddress, GeoCoordinates, url and hasMenu → MenuItem → Offer (USD)", () => {
  const n = plain(restaurantNode(SITE, restaurant));
  assert.equal(n["@type"], "Restaurant");
  assert.equal(n.name, "3 Sheets Saloon");
  assert.equal(n.url, `${SITE}/restaurants/3-sheets-saloon-west-village`);
  assert.equal(n["@id"], `${n.url}#restaurant`);
  assert.deepEqual(n.sameAs, ["https://www.3sheetsnyc.com/"]);
  assert.deepEqual(n.address, { "@type": "PostalAddress", streetAddress: "134 West 3 Street", addressLocality: "Manhattan", addressRegion: "NY", addressCountry: "US" });
  assert.deepEqual(n.geo, { "@type": "GeoCoordinates", latitude: 40.730797, longitude: -74.000902 });
  assert.deepEqual(n.containedInPlace, { "@type": "Place", name: "West Village, Manhattan" });
  assert.equal(n.hasMenu["@type"], "Menu");
  assert.equal(n.hasMenu.url, "https://www.3sheetsnyc.com/menus/");
  assert.deepEqual(n.hasMenu.hasMenuItem, {
    "@type": "MenuItem",
    name: "Fatso’s Burger",
    description: "Two smashed patties & fries",
    offers: { "@type": "Offer", price: "15.99", priceCurrency: "USD" },
  });
});

test("restaurantNode: missing address, coordinates, links and description are left out, never null", () => {
  const n = plain(restaurantNode(SITE, { ...restaurant, address: null, neighborhood: null, lat: null, lng: null, website: null, menuUrl: null, burger: { name: "Burger", description: null } }));
  assert.equal("geo" in n, false);
  assert.equal("sameAs" in n, false);
  assert.equal("containedInPlace" in n, false);
  assert.equal("streetAddress" in n.address, false);
  assert.equal("url" in n.hasMenu, false);
  assert.equal("description" in n.hasMenu.hasMenuItem, false);
  assert.ok(!JSON.stringify(n).includes("null"));
});

test("restaurantNode: never a Review, Rating or AggregateRating", () => {
  const s = JSON.stringify(restaurantNode(SITE, restaurant));
  assert.ok(!/Review|Rating/.test(s));
});

test("breadcrumbNode: positions from 1, absolute items, the last crumb is the page", () => {
  const crumbs = [{ href: "/#boroughs", label: "Boroughs" }, { href: "/boroughs/manhattan", label: "Manhattan" }, { label: "3 Sheets Saloon" }];
  const n = plain(breadcrumbNode(SITE, crumbs, "/restaurants/3-sheets-saloon-west-village"));
  assert.equal(n["@type"], "BreadcrumbList");
  assert.deepEqual(
    n.itemListElement.map((i: { position: number; name: string; item: string }) => [i.position, i.name, i.item]),
    [
      [1, "Boroughs", `${SITE}/#boroughs`],
      [2, "Manhattan", `${SITE}/boroughs/manhattan`],
      [3, "3 Sheets Saloon", `${SITE}/restaurants/3-sheets-saloon-west-village`],
    ],
  );
  // The home page is the bare origin.
  const home = plain(breadcrumbNode(SITE, [{ href: "/", label: "The Burger Index" }, { label: "Map" }], "/map"));
  assert.equal(home.itemListElement[0].item, SITE);
});

test("itemListNode: ordered ListItems with absolute urls and a count", () => {
  const n = plain(itemListNode(SITE, {
    name: "Cheapest burger spots",
    order: "ascending",
    entries: [
      { name: "A", path: "/restaurants/a" },
      { name: "B", path: "/restaurants/b" },
    ],
  }));
  assert.equal(n["@type"], "ItemList");
  assert.equal(n.itemListOrder, "https://schema.org/ItemListOrderAscending");
  assert.equal(n.numberOfItems, 2);
  assert.deepEqual(n.itemListElement[1], { "@type": "ListItem", position: 2, name: "B", url: `${SITE}/restaurants/b` });
});

test("datasetNode: the CSV as a DataDownload, creator The Burger Index, licensed CC BY 4.0", () => {
  const n = plain(datasetNode(SITE, {
    name: "NYC burger prices",
    description: "Burger prices at 548 New York City restaurants, with each one's burger and price.",
    csvPath: "/data/burger-prices.csv",
    generatedAt: "2026-09-25T13:44:09Z",
    month: "2026-09",
  }));
  assert.equal(n["@type"], "Dataset");
  assert.ok(n.description.length >= 50);
  assert.equal(n.url, SITE);
  assert.equal(n.creator.name, "The Burger Index");
  assert.equal(n.dateModified, "2026-09-25T13:44:09Z");
  assert.equal(n.temporalCoverage, "2026-09");
  assert.deepEqual(n.spatialCoverage, { "@type": "Place", name: "New York City" });
  assert.deepEqual(n.distribution, [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/data/burger-prices.csv` }]);
  assert.equal(n.license, "https://creativecommons.org/licenses/by/4.0/");
});

test("websiteNode and organizationNode link up by @id", () => {
  const org = plain(organizationNode(SITE));
  const site = plain(websiteNode(SITE, "What a burger costs in New York."));
  assert.equal(org["@type"], "Organization");
  assert.equal(org.name, "The Burger Index");
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.url, SITE);
  assert.equal(site.publisher["@id"], org["@id"]);
});
