"use client";

import dynamic from "next/dynamic";
import { useSeenOnce } from "../charts/hooks";

const MiniMapCanvas = dynamic(() => import("./MiniMapCanvas"), { ssr: false });

/** Loads MapLibre only when the locator scrolls into view. */
export function MiniMap(props: { id: string; lat: number; lng: number; price: number | null; median: number | null; label: string }) {
  const [ref, seen] = useSeenOnce<HTMLDivElement>();
  return (
    <div ref={ref} className="relative h-56 overflow-hidden rounded-[4px] border border-line md:h-64" style={{ background: "var(--map-land)" }}>
      {seen ? <MiniMapCanvas {...props} /> : null}
    </div>
  );
}
