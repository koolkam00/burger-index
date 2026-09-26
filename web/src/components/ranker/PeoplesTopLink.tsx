"use client";

// A link to the People's Top 10 that reports where it was followed from (peoples_top_clicked): the server pages
// render it like any link.
import Link from "next/link";
import type { ReactNode } from "react";
import { fromPath, track, type PeoplesTopSurface } from "@/lib/analytics";
import { PEOPLES_TOP_PATH } from "@/lib/site";

export function PeoplesTopLink({ surface, className, children }: { surface: PeoplesTopSurface; className?: string; children: ReactNode }) {
  return (
    <Link href={PEOPLES_TOP_PATH} className={className} onClick={() => track("peoples_top_clicked", { surface, from_path: fromPath(window.location.pathname) })}>
      {children}
    </Link>
  );
}
