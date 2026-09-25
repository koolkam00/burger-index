"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme-script";
import { Lantern, Sun } from "./icons/nautical";

export type Theme = "light" | "dark";

function readTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", onChange);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", onChange);
  };
}

/** The theme actually shown (stored choice, else the system setting). "light" during prerender. */
export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "light");
}

function store(theme: Theme | null) {
  try {
    if (theme) localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // storage blocked: the choice lasts for this page view only
  }
}

/**
 * "Shift change": a porthole button. Day shift (light) shows a lantern and offers the night shift;
 * night shift (dark) shows a sun and offers the day shift. The icon and the visible label swap in CSS
 * (so server and client markup match); the accessible name follows the resolved theme. `label`:
 * where the visible label shows ("xl" in the header, "always" in the menu sheet).
 */
export function ThemeToggle({ label = "xl" }: { label?: "xl" | "always" }) {
  const dark = useResolvedTheme() === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={dark ? "Day shift: switch to light theme" : "Night shift: switch to dark theme"}
      title={dark ? "Day shift: switch to light theme" : "Night shift: switch to dark theme"}
      onClick={() => {
        const next: Theme = readTheme() === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        store(next);
      }}
    >
      <span className="porthole" aria-hidden="true">
        <Lantern className="when-light" />
        <Sun className="when-dark" />
      </span>
      {/* Both labels share one grid cell and only the inactive one is hidden (visibility), so the
          button keeps the width of the longer label and the nav doesn't shift on a theme change. */}
      <span className={label === "xl" ? "theme-label hidden pr-1 xl:inline-grid" : "theme-label pr-1"} aria-hidden="true">
        <span className="theme-label-light">Night shift</span>
        <span className="theme-label-dark">Day shift</span>
      </span>
    </button>
  );
}

export function UseSystemTheme({ className = "deck-link" }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        document.documentElement.removeAttribute("data-theme");
        store(null);
      }}
    >
      Use system setting
    </button>
  );
}
