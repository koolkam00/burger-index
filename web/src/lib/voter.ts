// The anonymous voter id: one random UUID per browser, made the first time it answers "What's it
// worth?" (no sign-in); the backend keeps one answer per voter id per menu. It lives in localStorage
// under "burger-index-voter". Storage can be missing or throw (private windows, blocked site data,
// previews), so every access is wrapped: when it fails, the id lives in memory for this page view
// instead, and answering still works.
export const VOTER_KEY = "burger-index-voter";

/** Any RFC 4122 UUID (crypto.randomUUID makes v4). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VoterStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

let memoryId: string | null = null;

export function isVoterId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** The page's localStorage, or null when there is none or touching it throws. */
export function browserStorage(): VoterStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The parts of `crypto` a voter id is made from (either may be missing outside secure contexts). */
export type RandomSource = { randomUUID?: () => string; getRandomValues?: (bytes: Uint8Array) => unknown };

/** A v4 UUID: crypto.randomUUID when present (secure contexts), else built from getRandomValues. */
export function randomVoterId(c: RandomSource | undefined = globalThis.crypto): string {
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** This browser's voter id if it has one (stored, or made earlier in this page view), else null. Never creates one. */
export function readVoterId(storage: VoterStorage | null = browserStorage()): string | null {
  try {
    const v = storage?.getItem(VOTER_KEY) ?? null;
    if (isVoterId(v)) {
      memoryId = v;
      return v;
    }
  } catch {
    // storage blocked: fall back to the in-memory id
  }
  return memoryId;
}

/** This browser's voter id, made (and stored when storage works) on first use. */
export function getVoterId(storage: VoterStorage | null = browserStorage(), make: () => string = randomVoterId): string {
  const existing = readVoterId(storage);
  if (existing) return existing;
  const id = make();
  memoryId = id;
  try {
    storage?.setItem(VOTER_KEY, id);
  } catch {
    // storage full or blocked: the id lasts for this page view only
  }
  return id;
}

/** Tests only: forget the in-memory id. */
export function resetVoterIdForTests(): void {
  memoryId = null;
}
