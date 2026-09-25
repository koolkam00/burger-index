"use client";

import { useEffect } from "react";
import { BOARD_SEEN_KEY } from "@/lib/theme-script";

/**
 * The first-load motion (the board swings into place, the bell dings, the hero bubbles rise) plays
 * once per visit and is done by 4.2s. After it finishes, flag it so later boards (and reloads, via the
 * <head> script) render still.
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
    }, 4300);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
