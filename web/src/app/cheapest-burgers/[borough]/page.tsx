import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { boroughRankingParams, boroughRankingSpec } from "@/lib/ranking-routes";

export const dynamicParams = false;

/** The boroughs with a priced restaurant (rankings.ts rankingSpecs): an empty borough has no list. */
export function generateStaticParams() {
  return boroughRankingParams("cheapest");
}

export async function generateMetadata({ params }: PageProps<"/cheapest-burgers/[borough]">): Promise<Metadata> {
  const spec = boroughRankingSpec("cheapest", (await params).borough);
  return spec ? rankingMetadata(spec) : {};
}

export default async function CheapestInBoroughPage({ params }: PageProps<"/cheapest-burgers/[borough]">) {
  const spec = boroughRankingSpec("cheapest", (await params).borough);
  if (!spec) notFound();
  return <RankingPage spec={spec} />;
}
