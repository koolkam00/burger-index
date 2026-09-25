"use client";

// React bindings for the worth store (lib/worth-store). Prerendered HTML and the first client render
// both use the store's "nothing loaded yet" snapshots, so hydration always matches.
import { useSyncExternalStore } from "react";
import { worthStore, type HistSnapshot, type MineSnapshot } from "@/lib/worth-store";

/** This browser's answers: what each picker shows, what is saving, saved or failed. */
export function useMyWorth(): MineSnapshot {
  return useSyncExternalStore(worthStore.subscribe, worthStore.getMine, worthStore.getServerMine);
}

/** The public histograms loaded so far (menu key -> dollars -> answers). */
export function useHists(): HistSnapshot {
  return useSyncExternalStore(worthStore.subscribe, worthStore.getHists, worthStore.getServerHists);
}

/** Whether the visitor asked for reduced motion (false while prerendering). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

const REDUCED = "(prefers-reduced-motion: reduce)";

function readReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED).matches;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
