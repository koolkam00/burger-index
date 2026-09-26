// The press kit (user decision 2026-09-25, stage 4): its path and the credit line it hands out for the
// price list (CC BY 4.0 asks for the title, the source and the license). Pure and client-safe.
import { CSV_LICENSE } from "./csv";
import { formatMonthYear } from "./format";
import { SITE_NAME } from "./site";

export const PRESS_PATH = "/press";
export const PRESS_NAME = "Press kit";

/** "The Burger Index, “NYC burger prices,” September 2026. https://…. CC BY 4.0." */
export function pressCitation(site: string, generatedAt: string): string {
  return `${SITE_NAME}, “NYC burger prices,” ${formatMonthYear(generatedAt)}. ${site}. ${CSV_LICENSE.name}.`;
}
