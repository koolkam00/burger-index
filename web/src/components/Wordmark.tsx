// The life-ring emblem and "THE BURGER INDEX" (DESIGN.md "Nav"). The brand is The Burger Index; the
// ring is an original drawing. Server-safe, so the header, the menu sheet and the footer share it.
import { LifeRing } from "./icons/nautical";

/**
 * The small raised "The" keeps a real space after it (inside its own span, so the gap stays at the
 * small size), so the text reads "The Burger Index" to screen readers and in copied text.
 */
export function Wordmark() {
  return (
    <span className="wordmark">
      <LifeRing className="wordmark-ring" />
      <span className="t-wordmark">
        <span className="wordmark-the">The </span>Burger Index
      </span>
    </span>
  );
}
