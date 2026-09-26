import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { neighborhoodRankingParams, neighborhoodRankingSpec } from "@/lib/ranking-routes";

export const dynamicParams = false;

/**
 * The neighborhoods with their own lists (rankings.ts neighborhoodsWithRankings: at least 10 distinct
 * priced menus, and two lists that share no menu). Both segments come from here: the [borough] segment
 * above has a page but no layout, so this route gets no params from it.
 */
export function generateStaticParams() {
  return neighborhoodRankingParams("cheapest");
}

export async function generateMetadata({ params }: PageProps<"/cheapest-burgers/[borough]/[neighborhood]">): Promise<Metadata> {
  const { borough, neighborhood } = await params;
  const spec = neighborhoodRankingSpec("cheapest", borough, neighborhood);
  return spec ? rankingMetadata(spec) : {};
}

export default async function CheapestInNeighborhoodPage({ params }: PageProps<"/cheapest-burgers/[borough]/[neighborhood]">) {
  const { borough, neighborhood } = await params;
  const spec = neighborhoodRankingSpec("cheapest", borough, neighborhood);
  if (!spec) notFound();
  return <RankingPage spec={spec} />;
}
