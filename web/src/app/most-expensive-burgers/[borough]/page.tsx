import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { boroughRankingParams, boroughRankingSpec } from "@/lib/ranking-routes";

export const dynamicParams = false;

/** The boroughs with a priced restaurant (rankings.ts rankingSpecs): an empty borough has no list. */
export function generateStaticParams() {
  return boroughRankingParams("priciest");
}

export async function generateMetadata({ params }: PageProps<"/most-expensive-burgers/[borough]">): Promise<Metadata> {
  const spec = boroughRankingSpec("priciest", (await params).borough);
  return spec ? rankingMetadata(spec) : {};
}

export default async function MostExpensiveInBoroughPage({ params }: PageProps<"/most-expensive-burgers/[borough]">) {
  const spec = boroughRankingSpec("priciest", (await params).borough);
  if (!spec) notFound();
  return <RankingPage spec={spec} />;
}
