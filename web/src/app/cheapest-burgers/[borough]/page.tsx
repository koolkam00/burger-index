import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { boroughBySlug } from "@/lib/boroughs";
import { getPricedRestaurants } from "@/lib/data";
import { cheapestSpec, rankingSpecs, type RankingSpec } from "@/lib/rankings";
import { atLeastOneParam, PLACEHOLDER_PARAM } from "@/lib/site";

export const dynamicParams = false;

/** The boroughs with a priced restaurant (rankings.ts rankingSpecs): an empty borough has no list. */
function specFor(slug: string): RankingSpec | undefined {
  const b = boroughBySlug(slug);
  const spec = b ? cheapestSpec(b) : undefined;
  return spec && rankingSpecs(getPricedRestaurants()).some((s) => s.kind === spec.kind && s.borough?.slug === slug) ? spec : undefined;
}

export function generateStaticParams() {
  const slugs = rankingSpecs(getPricedRestaurants())
    .filter((s) => s.kind === "cheapest" && s.borough)
    .map((s) => ({ borough: s.borough!.slug }));
  return atLeastOneParam(slugs, { borough: PLACEHOLDER_PARAM });
}

export async function generateMetadata({ params }: PageProps<"/cheapest-burgers/[borough]">): Promise<Metadata> {
  const spec = specFor((await params).borough);
  return spec ? rankingMetadata(spec) : {};
}

export default async function CheapestInBoroughPage({ params }: PageProps<"/cheapest-burgers/[borough]">) {
  const spec = specFor((await params).borough);
  if (!spec) notFound();
  return <RankingPage spec={spec} />;
}
