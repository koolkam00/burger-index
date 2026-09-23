"use client";
// MapLibre helpers. Only ever loaded through dynamic import (client-only), so maplibre-gl stays out
// of every page bundle that doesn't show a map.
import * as maplibregl from "maplibre-gl";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MlMap,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Theme } from "../theme";

// v6 resolves its worker relative to its own module URL, which bundling breaks; sync-data copies
// the worker to public/vendor/maplibre/ and we point at it here.
let workerSet = false;
function ensureWorker() {
  if (workerSet) return;
  maplibregl.setWorkerUrl(new URL("/vendor/maplibre/maplibre-gl-worker.mjs", window.location.origin).toString());
  workerSet = true;
}

export const STYLE_URL: Record<Theme, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export const NYC_CENTER: [number, number] = [-73.94, 40.7];
export const NYC_BOUNDS: [[number, number], [number, number]] = [
  [-74.3, 40.48],
  [-73.68, 40.93],
];

export type MapTokens = {
  land: string;
  water: string;
  park: string;
  border: string;
  label: string;
  ink: string;
  pinRing: string;
  /** Pin fill for a restaurant without an index price (mini map only): neutral, off the ramp. */
  unpriced: string;
  price: [string, string, string, string, string];
};

export function readTokens(): MapTokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    land: v("--map-land"),
    water: v("--map-water"),
    park: v("--map-park"),
    border: v("--map-border"),
    label: v("--map-label"),
    ink: v("--ink"),
    pinRing: v("--pin-ring"),
    unpriced: v("--bar"),
    price: [v("--price-1"), v("--price-2"), v("--price-3"), v("--price-4"), v("--price-5")],
  };
}

/** OpenMapTiles place classes that read as neighborhoods (not cities, towns, states or countries). */
const NEIGHBORHOOD_PLACES: ExpressionSpecification = ["match", ["get", "class"], ["neighbourhood", "suburb", "quarter"], true, false];

const hide = (map: MlMap, id: string) => map.setLayoutProperty(id, "visibility", "none");

/**
 * Basemap per DESIGN.md: land, water, parks, borders and neighborhood labels only. No roads, no
 * buildings, no POIs, no city or water names. Neighborhood labels take the `label` type's look:
 * uppercase, tracked, bold (the closest weight the glyph server has).
 */
export function tuneBasemap(map: MlMap, t: MapTokens) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    const id = layer.id;
    const sourceLayer = (layer as LayerSpecification & { "source-layer"?: string })["source-layer"];
    try {
      const paint = (layer as { paint?: Record<string, unknown> }).paint;
      if (paint && "fill-pattern" in paint) hide(map, id); // textures: not our look
      else if (layer.type === "background") map.setPaintProperty(id, "background-color", t.land);
      else if (layer.type === "fill" && sourceLayer === "water") map.setPaintProperty(id, "fill-color", t.water);
      else if (layer.type === "line" && sourceLayer === "waterway") map.setPaintProperty(id, "line-color", t.water);
      else if (layer.type === "fill" && (id === "park" || id === "landuse_park" || id === "landcover_wood" || sourceLayer === "park")) map.setPaintProperty(id, "fill-color", t.park);
      else if (sourceLayer === "building") hide(map, id);
      // Piers, airport grounds and land use read as plain land.
      else if (layer.type === "fill" && (sourceLayer === "landuse" || sourceLayer === "landcover" || sourceLayer === "aeroway" || sourceLayer === "transportation"))
        map.setPaintProperty(id, "fill-color", t.land);
      else if (layer.type === "line" && sourceLayer === "boundary") map.setPaintProperty(id, "line-color", t.border);
      else if (layer.type === "symbol" && sourceLayer === "place") {
        // Every place layer keeps only neighborhood classes, so the city/town/state layers go empty.
        const filter = (layer as { filter?: FilterSpecification }).filter;
        map.setFilter(id, filter ? ["all", filter as ExpressionSpecification, NEIGHBORHOOD_PLACES] : NEIGHBORHOOD_PLACES);
        map.setLayoutProperty(id, "text-font", ["Noto Sans Bold"]);
        map.setLayoutProperty(id, "text-transform", "uppercase");
        map.setLayoutProperty(id, "text-letter-spacing", 0.08);
        map.setPaintProperty(id, "text-color", t.label);
        map.setPaintProperty(id, "text-halo-color", t.land);
        map.setPaintProperty(id, "text-halo-width", 1.2);
      } else if (layer.type === "symbol" || layer.type === "line" || sourceLayer === "poi" || sourceLayer === "aerodrome_label") hide(map, id);
    } catch {
      // a layer that rejects a property keeps its own styling
    }
  }
}

/** Fallback when the tile service is unreachable: pins on plain land. */
export function blankStyle(t: MapTokens): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": t.land } }] };
}

export type PinProps = { id: string; name: string; where: string; burger: string; price: number; step: number; order: number; delivery: boolean };

/** Stable pseudo-random draw order from the id, so neither end of the ramp buries the other. */
export function hashOrder(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

export const PIN_SOURCE = "restaurants";
export const PIN_LAYER = "pins";

export function addPins(map: MlMap, features: GeoJSON.Feature<GeoJSON.Point, PinProps>[], t: MapTokens) {
  const data: GeoJSON.FeatureCollection<GeoJSON.Point, PinProps> = { type: "FeatureCollection", features };
  const existing = map.getSource(PIN_SOURCE) as GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else map.addSource(PIN_SOURCE, { type: "geojson", data, promoteId: "id" });
  if (map.getLayer(PIN_LAYER)) map.removeLayer(PIN_LAYER);
  const active: ExpressionSpecification = ["any", ["boolean", ["feature-state", "hover"], false], ["boolean", ["feature-state", "selected"], false]];
  const layer: CircleLayerSpecification = {
    id: PIN_LAYER,
    type: "circle",
    source: PIN_SOURCE,
    layout: { "circle-sort-key": ["get", "order"] },
    paint: {
      // step 0 = no index price (neutral); 1–5 = the price ramp
      "circle-color": ["match", ["get", "step"], 0, t.unpriced, 1, t.price[0], 2, t.price[1], 3, t.price[2], 4, t.price[3], t.price[4]],
      // 8px below z12, 12px at z12+, 16px when hovered or selected ("zoom" must be the top-level input)
      "circle-radius": ["step", ["zoom"], ["case", active, 8, 4], 12, ["case", active, 8, 6]],
      "circle-stroke-width": ["case", active, 2, 1.5],
      "circle-stroke-color": ["case", active, t.ink, t.pinRing],
    },
  };
  map.addLayer(layer);
}

export function createMap(container: HTMLElement, opts: { theme: Theme; interactive?: boolean; center?: [number, number]; zoom?: number }): MlMap {
  ensureWorker();
  return new maplibregl.Map({
    container,
    style: STYLE_URL[opts.theme],
    center: opts.center ?? NYC_CENTER,
    zoom: opts.zoom ?? 10,
    // Low enough that fitBounds can show every pin on a 375px-wide map (it needs about 8.7 there).
    minZoom: 8,
    maxZoom: 18,
    maxBounds: [
      [-74.6, 40.3],
      [-73.3, 41.1],
    ],
    interactive: opts.interactive ?? true,
    attributionControl: { compact: true },
    cooperativeGestures: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
}

/**
 * Fold the compact attribution down to its (i) button. MapLibre opens it on load and folds it only on
 * the first drag, which a non-interactive map never gets; on a small map it covers the pin.
 */
export function collapseAttribution(container: HTMLElement) {
  const attrib = container.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
  if (!attrib) return;
  attrib.classList.remove("maplibregl-compact-show");
  attrib.removeAttribute("open");
}

export { maplibregl };
