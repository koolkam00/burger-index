import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { priciestSpec } from "@/lib/rankings";

const spec = priciestSpec();

export const metadata = rankingMetadata(spec);

export default function MostExpensiveBurgersPage() {
  return <RankingPage spec={spec} />;
}
