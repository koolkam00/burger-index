"use client";

// The restaurant page's People's Price sentence (DESIGN.md "People's Price in the static HTML"), under the
// "What would you pay?" card: "People's Price $22 from 14 answers, as of Sep 25, 2026." It is prerendered from
// the snapshot (lib/peoples-price) when the menu has a verdict's worth of answers, so crawlers read it, and it
// switches to the live numbers (no date) once the card has loaded them. Fewer answers: nothing, as before.
// Once this visitor has answered, the card shows the People's Price itself, so the sentence steps aside.
import { hasPeoplesPriceSentence, liveFigures, peoplesPriceSentence, type PeoplesPriceFigures } from "@/lib/peoples-price";
import { WORTH_ENABLED } from "@/lib/worth-config";
import { histKnown } from "@/lib/worth-store";
import { useHists, useMyWorth } from "./hooks";

export function PeoplesPriceNote({ menuKey, snapshot }: { menuKey: string; snapshot: PeoplesPriceFigures | null }) {
  const hists = useHists();
  const mine = useMyWorth();
  const figures = WORTH_ENABLED && histKnown(hists, menuKey) ? liveFigures(hists.hists.get(menuKey)) : snapshot;
  if (!hasPeoplesPriceSentence(figures) || mine.answers.has(menuKey)) return null;
  return <p className="t-ui-m prose-width mt-4 text-pretty">{peoplesPriceSentence(figures)}</p>;
}
