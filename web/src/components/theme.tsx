"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme-script";

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

export function ThemeToggle() {
  const dark = useResolvedTheme() === "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      // A toggle button: the name stays put and aria-pressed carries the state.
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next: Theme = readTheme() === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        store(next);
      }}
    >
      {/* Sun shows in dark mode, Moon in light mode (CSS picks, so server and client markup match). */}
      <Sun className="theme-sun" strokeWidth={1.75} aria-hidden="true" />
      <Moon className="theme-moon" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

export function UseSystemTheme() {
  return (
    <button
      type="button"
      className="ui-link cursor-pointer t-ui-m underline-offset-4 hover:underline"
      onClick={() => {
        document.documentElement.removeAttribute("data-theme");
        store(null);
      }}
    >
      Use system setting
    </button>
  );
}
