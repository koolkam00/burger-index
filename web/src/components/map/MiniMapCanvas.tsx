"use client";

import { useEffect, useRef, useState } from "react";
import { binFor } from "@/lib/price-bins";
import { useResolvedTheme } from "../theme";
import { addPins, blankStyle, collapseAttribution, createMap, readTokens, tuneBasemap } from "./maplibre";

/** Static-feeling locator map: one pin, no interaction. */
export default function MiniMapCanvas({ id, lat, lng, price, median, label }: { id: string; lat: number; lng: number; price: number | null; median: number | null; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let map: ReturnType<typeof createMap>;
    try {
      map = createMap(container, { theme, interactive: false, center: [lng, lat], zoom: 14.5 });
    } catch {
      const t = window.setTimeout(() => setFailed(true), 0);
      return () => window.clearTimeout(t);
    }
    const tokens = readTokens();
    let loaded = false;
    let blank = false;
    const fallBack = () => {
      if (blank) return;
      blank = true;
      map.setStyle(blankStyle(tokens));
    };
    const timer = window.setTimeout(() => !loaded && fallBack(), 10000);
    map.on("style.load", () => {
      loaded = true;
      if (!blank) tuneBasemap(map, tokens);
      // No index price (or no median to bin against): a neutral pin, never a ramp color.
      const step = price !== null && median !== null ? binFor(price, median).step : 0;
      addPins(map, [{ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { id, name: label, where: "", burger: "", price: price ?? 0, step, order: 0, delivery: false } }], tokens);
      map.setFeatureState({ source: "restaurants", id }, { selected: true });
    });
    map.on("error", () => {
      if (!loaded) fallBack();
    });
    // The overlay below names the map for screen readers; MapLibre's own "Map" canvas label would
    // only repeat it. (The attribution button stays reachable: it isn't inside the img.)
    map.getCanvas().setAttribute("aria-hidden", "true");
    map.once("load", () => collapseAttribution(container));
    return () => {
      window.clearTimeout(timer);
      map.remove();
    };
  }, [theme, id, lat, lng, price, median, label]);

  if (failed) return <p className="t-ui-s muted absolute inset-0 grid place-items-center p-4 text-center">Map unavailable in this browser.</p>;
  // MapLibre's CSS makes its container position:relative, so size it with a wrapper. The role="img"
  // sits on a sibling overlay, not on a wrapper around the map: an img's contents are presentational,
  // and the map holds a focusable attribution button. pointer-events-none lets clicks reach it.
  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute inset-0 z-[1]" role="img" aria-label={`Map showing the location of ${label}`} />
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
