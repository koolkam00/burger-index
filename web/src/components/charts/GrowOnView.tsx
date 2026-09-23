"use client";

import type { ReactNode } from "react";
import { useSeenOnce } from "./hooks";

/** Wraps server-rendered bars; adds `is-in` the first time they scroll into view (CSS grows them). */
export function GrowOnView({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [ref, seen] = useSeenOnce<HTMLDivElement>();
  return (
    <div ref={ref} className={`chart-grow ${seen ? "is-in" : ""} ${className}`}>
      {children}
    </div>
  );
}
