"use client";

import { List, Map as MapIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { track } from "@/lib/analytics";
import { EmptyState } from "../ui";
import type { MapPin } from "./MapCanvas";

const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center">
      <p className="t-ui-m muted">Unrolling the sea chart…</p>
    </div>
  ),
});

/**
 * Map / list toggle (a map is never the only way to reach a restaurant), the legend card, and the
 * graceful fallbacks: no WebGL → list view; tiles unreachable → pins on a blank basemap + notice.
 */
export function MapShell({ pins, median, legend, list }: { pins: MapPin[]; median: number | null; legend: ReactNode; list: ReactNode }) {
  const [view, setView] = useState<"map" | "list">("map");
  const [fatal, setFatal] = useState<string | null>(null);
  const [basemapDown, setBasemapDown] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  // A ?r=<id> arrival is tracked once per visit: the List view unmounts the map, and the remount
  // reopens that popup without counting it again.
  const linkTrackedRef = useRef(false);
  const onBasemapFail = useCallback(() => setBasemapDown(true), []);
  const onFatal = useCallback((why: string) => {
    setFatal(why);
    setView("list");
  }, []);
  const showMap = view === "map" && !fatal && median !== null && pins.length > 0;
  const choose = (next: "map" | "list") => {
    if (next !== view) track("map_view_changed", { view: next });
    setView(next);
  };

  return (
    <div>
      <div className="wrap flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-2" role="group" aria-label="View">
          <button type="button" className="chip disabled:cursor-not-allowed disabled:opacity-40" aria-pressed={view === "map"} disabled={!!fatal || pins.length === 0} onClick={() => choose("map")}>
            <MapIcon strokeWidth={2} aria-hidden="true" />
            Map
          </button>
          <button type="button" className="chip" aria-pressed={view === "list"} onClick={() => choose("list")}>
            <List strokeWidth={2} aria-hidden="true" />
            List
          </button>
        </div>
        {fatal ? (
          <p className="t-ui-s muted" role="status">
            The sea chart can&apos;t run in this browser ({fatal}). Here is the list instead.
          </p>
        ) : basemapDown && view === "map" ? (
          <p className="t-ui-s muted" role="status">
            The sea chart didn&apos;t load, so the pins sit on plain sand. The list view has every restaurant.
          </p>
        ) : null}
      </div>

      {showMap ? (
        <>
        <span className="rope rope-flat map-rope mt-4" aria-hidden="true" />
        <div className="map-frame">
          <MapCanvas pins={pins} median={median} linkTrackedRef={linkTrackedRef} onBasemapFail={onBasemapFail} onFatal={onFatal} />
          <div className="absolute top-3 left-3 z-10 max-w-[calc(100%-5rem)]">
            <button type="button" className="btn btn-secondary btn-sm md:hidden" aria-expanded={legendOpen} aria-controls="map-legend" onClick={() => setLegendOpen((o) => !o)}>
              Legend
            </button>
            <div id="map-legend" className={`${legendOpen ? "mt-3 block" : "hidden"} md:mt-0 md:block`}>
              {legend}
            </div>
          </div>
        </div>
        </>
      ) : (
        <div className="wrap mt-4">
          {pins.length === 0 ? (
            <EmptyState height={200} art="trap">
              No restaurant has both a price and a location yet.
            </EmptyState>
          ) : (
            list
          )}
        </div>
      )}
    </div>
  );
}
