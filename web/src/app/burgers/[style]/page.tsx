import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { styleRankingParams, styleRankingSpec } from "@/lib/ranking-routes";

export const dynamicParams = false;

/**
 * The burger spots whose priciest burger is of a style (lib/styles.ts), for the styles with at least 10
 * distinct menus (rankings.ts stylesWithRankings): /burgers/smash, /burgers/double, …
 */
export function generateStaticParams() {
  return styleRankingParams();
}

export async function generateMetadata({ params }: PageProps<"/burgers/[style]">): Promise<Metadata> {
  const spec = styleRankingSpec((await params).style);
  return spec ? rankingMetadata(spec) : {};
}

export default async function BurgerStylePage({ params }: PageProps<"/burgers/[style]">) {
  const spec = styleRankingSpec((await params).style);
  if (!spec) notFound();
  return <RankingPage spec={spec} />;
}
