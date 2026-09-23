"use client";

import type { Map as MlMap, MapMouseEvent, Popup } from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { formatDelta, formatPrice } from "@/lib/format";
import { binFor } from "@/lib/price-bins";
import { useResolvedTheme } from "../theme";
import {
  addPins,
  blankStyle,
  createMap,
  hashOrder,
  maplibregl,
  NYC_BOUNDS,
  PIN_LAYER,
  PIN_SOURCE,
  readTokens,
  tuneBasemap,
  type PinProps,
} from "./maplibre";

export type MapPin = { id: string; name: string; where: string; burger: string; price: number; lat: number; lng: number; delivery: boolean };

type Camera = { center: [number, number]; zoom: number };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text; // textContent only: never HTML from data
  return node;
}

function popupContent(p: PinProps, median: number, color: string, go: (href: string) => void): HTMLElement {
  const root = el("div", "grid gap-1 pr-6 min-w-[200px] max-w-[260px]");
  const link = el("a", "t-ui-l ui-link font-semibold break-anywhere", p.name);
  link.href = `/restaurants/${p.id}`;
  link.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(link.pathname);
  });
  root.append(link, el("p", "t-ui-s muted break-anywhere", p.where));
  const chip = el("span", "price-chip mt-1 w-fit");
  const sw = el("span", "swatch");
  sw.style.background = color;
  chip.append(sw, el("span", "t-num-m", `${formatPrice(p.price, { cents: "always" })}${p.delivery ? "†" : ""}`), el("span", "t-num-s muted", formatDelta(p.price, median, { suffix: "vs NYC" })));
  root.append(chip, el("p", "t-ui-s break-anywhere", `${p.burger} · ${binFor(p.price, median).name}`));
  if (p.delivery) root.append(el("p", "t-ui-s muted", "† Delivery-app price"));
  return root;
}

export default function MapCanvas({ pins, median, onBasemapFail, onFatal }: { pins: MapPin[]; median: number; onBasemapFail: () => void; onFatal: (why: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();
  const router = useRouter();
  const camera = useRef<Camera | null>(null);
  const failRef = useRef({ onBasemapFail, onFatal });
  useEffect(() => {
    failRef.current = { onBasemapFail, onFatal };
  }, [onBasemapFail, onFatal]);

  const features = useMemo(
    () =>
      pins.map(
        (p): GeoJSON.Feature<GeoJSON.Point, PinProps> => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: { id: p.id, name: p.name, where: p.where, burger: p.burger, price: p.price, step: binFor(p.price, median).step, order: hashOrder(p.id), delivery: p.delivery },
        }),
      ),
    [pins, median],
  );

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let map: MlMap;
    try {
      map = createMap(container, { theme, center: camera.current?.center, zoom: camera.current?.zoom });
    } catch (err) {
      failRef.current.onFatal(err instanceof Error ? err.message : "WebGL is not available");
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    let styleLoaded = false;
    let usingBlank = false;
    let popup: Popup | null = null;
    let hoverId: string | null = null;
    let selectedId: string | null = null;
    const tokens = readTokens();

    const setState = (id: string | null, key: "hover" | "selected", on: boolean) => {
      if (id && map.getSource(PIN_SOURCE)) map.setFeatureState({ source: PIN_SOURCE, id }, { [key]: on });
    };

    const fallBack = () => {
      if (usingBlank) return;
      usingBlank = true;
      failRef.current.onBasemapFail();
      map.setStyle(blankStyle(tokens));
    };
    const timer = window.setTimeout(() => {
      if (!styleLoaded) fallBack();
    }, 12000);

    map.on("style.load", () => {
      styleLoaded = true;
      if (!usingBlank) tuneBasemap(map, tokens);
      addPins(map, features, tokens);
    });
    map.on("error", (e) => {
      if (!styleLoaded) fallBack();
      else console.warn("[map]", e.error?.message ?? e.error);
    });

    const pick = (e: MapMouseEvent) => {
      if (!map.getLayer(PIN_LAYER)) return null;
      const { x, y } = e.point;
      // 24px hit target around the pointer; nearest pin wins.
      const hits = map.queryRenderedFeatures(
        [
          [x - 12, y - 12],
          [x + 12, y + 12],
        ],
        { layers: [PIN_LAYER] },
      );
      let best: (typeof hits)[number] | null = null;
      let bestD = Infinity;
      for (const f of hits) {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const p = map.project([lng, lat]);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      return best;
    };

    const open = (props: PinProps, lngLat: [number, number]) => {
      popup?.remove();
      setState(selectedId, "selected", false);
      selectedId = props.id;
      setState(selectedId, "selected", true);
      const next = new maplibregl.Popup({ offset: 12, maxWidth: "280px", focusAfterOpen: true })
        .setLngLat(lngLat)
        .setDOMContent(popupContent(props, median, tokens.price[props.step - 1], (href) => router.push(href)))
        .addTo(map);
      popup = next;
      next.on("close", () => {
        setState(selectedId, "selected", false);
        selectedId = null;
      });
    };

    map.on("mousemove", (e) => {
      const f = pick(e);
      const id = f ? String(f.properties.id) : null;
      if (id !== hoverId) {
        setState(hoverId, "hover", false);
        hoverId = id;
        setState(hoverId, "hover", true);
      }
      map.getCanvas().style.cursor = id ? "pointer" : "";
    });
    map.on("mouseout", () => {
      setState(hoverId, "hover", false);
      hoverId = null;
    });
    map.on("click", (e) => {
      const f = pick(e);
      if (!f) return;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      open(f.properties as unknown as PinProps, [lng, lat]);
    });

    // First load: fit the pins, or fly to ?r=<restaurant id>. (A theme switch rebuilds the map and
    // keeps the previous camera instead.)
    const restoring = camera.current !== null;
    map.once("load", () => {
      if (restoring) return;
      map.resize();
      const want = new URLSearchParams(window.location.search).get("r");
      const target = want ? features.find((f) => f.properties.id === want) : undefined;
      if (target) {
        const [lng, lat] = target.geometry.coordinates;
        map.jumpTo({ center: [lng, lat], zoom: 15 });
        open(target.properties, [lng, lat]);
      } else if (features.length) {
        const b = new maplibregl.LngLatBounds();
        features.forEach((f) => b.extend(f.geometry.coordinates as [number, number]));
        const pad = Math.min(48, container.clientWidth / 10);
        map.fitBounds(b, { padding: { top: pad, bottom: pad, left: pad, right: pad }, maxZoom: 14, duration: 0 });
      } else {
        map.fitBounds(NYC_BOUNDS, { padding: 24, duration: 0 });
      }
    });

    return () => {
      window.clearTimeout(timer);
      const c = map.getCenter();
      camera.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
      popup?.remove();
      map.remove();
    };
  }, [theme, features, median, router]);

  // MapLibre's CSS makes its container position:relative, so size it with a wrapper.
  return (
    <div className="absolute inset-0" aria-label="Map of priced restaurants. Use the list view for a keyboard-friendly list." role="region">
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
