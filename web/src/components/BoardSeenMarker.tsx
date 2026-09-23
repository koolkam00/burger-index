"use client";

import { useEffect } from "react";
import { BOARD_SEEN_KEY } from "@/lib/theme-script";

/**
 * The board's slide-in plays once per visit. After it finishes, flag it so later boards (and
 * reloads, via the <head> script) render still.
 */
export function BoardSeenMarker() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      document.documentElement.classList.add("board-seen");
      try {
        sessionStorage.setItem(BOARD_SEEN_KEY, "1");
      } catch {
        // storage blocked: the animation may replay on the next load, which is harmless
      }
    }, 900);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
