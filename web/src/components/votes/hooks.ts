"use client";

// React bindings for the vote store (lib/vote-store). Prerendered HTML and the first client render
// both use the store's "nothing loaded yet" snapshots, so hydration always matches.
import { useSyncExternalStore } from "react";
import { voteStore, type MineSnapshot, type ScoresSnapshot } from "@/lib/vote-store";

/** This browser's votes: what each picker shows, what is saving, saved or failed. */
export function useMyVotes(): MineSnapshot {
  return useSyncExternalStore(voteStore.subscribe, voteStore.getMine, voteStore.getServerMine);
}

/** The public totals loaded so far (menu key -> votes, total). */
export function useScores(): ScoresSnapshot {
  return useSyncExternalStore(voteStore.subscribe, voteStore.getScores, voteStore.getServerScores);
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
