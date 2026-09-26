// Burger styles (user decision 2026-09-25): smash, double, wagyu, dry-aged and patty melt, read from each
// restaurant's one published burger (its name, and its description minus add-ons and swaps). The
// classifier is conservative: a burger belongs to a style only when its own name or description says so
// in so many words ("Smash Burger", "two smashed patties", "8 oz Wagyu burger", "Dry-Aged Blend"), never
// from an add-on ("Sub Wagyu +$6", "Add extra patty $5"), a topping ("American Wagyu pastrami", "double
// smoked bacon") or an ambiguous word ("Double Cheese", "Double-Double"). A burger can have several styles.
//
// Each restaurant publishes only its priciest burger (CLAUDE.md "One burger per restaurant"), so a style
// page lists the burger spots whose priciest burger is of that style, and says so (lib/rankings.ts,
// kind "style"); it never claims to list every smash burger in NYC. Only styles with MIN_STYLE_MENUS
// distinct menus get a page. Pure and client-safe.
import type { Burger } from "./schema";

export type StyleKey = "smash" | "double" | "wagyu" | "dry-aged" | "patty-melt";

export type BurgerStyle = {
  key: StyleKey;
  /** The page's path segment: /burgers/<slug>. */
  slug: string;
  /** In a sentence: "a smash burger" ("… where the priciest burger is a smash burger"). */
  aBurger: string;
  /** Breadcrumbs and short links: "Smash burger spots". */
  spots: string;
};

export const STYLES: readonly BurgerStyle[] = [
  { key: "smash", slug: "smash", aBurger: "a smash burger", spots: "Smash burger spots" },
  { key: "double", slug: "double", aBurger: "a double burger", spots: "Double burger spots" },
  { key: "wagyu", slug: "wagyu", aBurger: "a wagyu burger", spots: "Wagyu burger spots" },
  { key: "dry-aged", slug: "dry-aged", aBurger: "a dry-aged burger", spots: "Dry-aged burger spots" },
  { key: "patty-melt", slug: "patty-melt", aBurger: "a patty melt", spots: "Patty melt spots" },
];

/** Distinct menus a style needs before it gets a page (the same bar as a neighborhood's ranking pages). */
export const MIN_STYLE_MENUS = 10;

export function styleBySlug(slug: string): BurgerStyle | undefined {
  return STYLES.find((s) => s.slug === slug);
}

/** Up to `n` words between two terms: "smashed American Wagyu beef patties". */
const gap = (n: number) => `(?:[\\s-]+[\\w'’.-]+){0,${n}}?[\\s-]+`;

/**
 * The parts of a description that describe the burger itself. Add-ons, swaps, options and anything with a
 * price in it are dropped: "Add extra patty $5", "Sub Beyond Burger +$5.00", "Make it Impossible $17.95".
 */
export function describingParts(description: string | null): string[] {
  if (!description) return [];
  return description
    .split(/(?<!\d)\.(?!\d)|[;!?•|\n]+|,\s*(?=(?:add|sub|substitute|swap|make it|upgrade|extra)\b)/i)
    .map((s) => s.trim())
    .filter((s) => s && !/^(?:add|sub|substitute|swap|make it|upgrade|extra|option|optional|choice of|available|also available|or)\b/i.test(s) && !/\+\s*\$|\$\s*\d/.test(s));
}

const SMASH_NAME = /\bsmash(?:ed|burgers?)?\b/i;
const SMASH_TEXT = new RegExp(`\\bsmash(?:ed|burgers?)?${gap(3)}(?:patt(?:y|ies)|burgers?|beef)\\b|\\bsmash(?:ed)?[\\s-]?burgers?\\b`, "i");

/** Three patties (a triple) is not a double: "Triple Cheeseburger", "Three Beef Patties" (not "Triple Crown Champion"). */
const TRIPLE_NAME = /\b(?:triple|tripple|quad(?:ruple)?)\b/i;
const TRIPLE_TEXT = new RegExp(`(?<![/\\d.])\\b(?:three|3|four|4|triple|quad)\\b(?![/\\d])${gap(4)}patt(?:y|ies)\\b|\\btriple[\\s-]+(?:stack(?:ed)?|decker|patty|burger|cheeseburger|quarter)`, "i");
/** A name saying double, unless the double isn't the patties: "double smoked bacon", "Double Cheese" alone, "double-cut". */
const DOUBLE_NAME = /\b(?:double|dbl)\b(?![\s-]+(?:smoked|cut|fried|dipped|bacon|chocolate|shot|espresso|cheese\b(?!\s*burger)))/i;
/** Two patties in the description: "Double patty", "two 4oz patties", "2 x Beef Patty"; never a fraction ("1/2 LB Beef Patty"). */
const DOUBLE_TEXT = new RegExp(
  `\\b(?:double|dbl)(?:${gap(3)}|[\\s-]+)(?:patt(?:y|ies)|beef|burgers?|cheeseburgers?|smash(?:ed)?|stack(?:ed)?|decker|quarter)\\b|(?<![/\\d.])\\b(?:two|2)\\b(?![/\\d])(?:\\s*x)?${gap(4)}(?:patt(?:y|ies)|burgers)\\b`,
  "i",
);

/** Wagyu (or Kobe) beef, not a wagyu topping: "American Wagyu pastrami" is the pastrami. */
const WAGYU = /\b(?:wagyu|kobe)\b(?![\s-]+(?:pastrami|bacon|brisket|short[\s-]?rib|tallow|fat|butter)\b)/i;
const DRY_AGED = /\b(?:dry[\s-]?aged|\d+[\s-]?day[\s-]+(?:dry[\s-]?)?aged)\b(?![\s-]+(?:ribeye|strip|bacon|duck)\b)/i;
const PATTY_MELT = /\bpatty[\s-]?melts?\b/i;

/** The styles of one burger, in STYLES order. */
export function burgerStyles(burger: Pick<Burger, "name" | "description">): StyleKey[] {
  const name = burger.name;
  const parts = describingParts(burger.description);
  const said = (re: RegExp) => re.test(name) || parts.some((p) => re.test(p));
  const out: StyleKey[] = [];
  if (SMASH_NAME.test(name) || parts.some((p) => SMASH_TEXT.test(p))) out.push("smash");
  if (!TRIPLE_NAME.test(name) && !parts.some((p) => TRIPLE_TEXT.test(p)) && (DOUBLE_NAME.test(name) || parts.some((p) => DOUBLE_TEXT.test(p)))) out.push("double");
  if (said(WAGYU)) out.push("wagyu");
  if (said(DRY_AGED)) out.push("dry-aged");
  if (said(PATTY_MELT)) out.push("patty-melt");
  return out;
}

export function hasStyle(burger: Pick<Burger, "name" | "description">, style: StyleKey): boolean {
  return burgerStyles(burger).includes(style);
}
