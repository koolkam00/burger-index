import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { cheapestSpec } from "@/lib/rankings";

const spec = cheapestSpec();

export const metadata = rankingMetadata(spec);

export default function CheapestBurgersPage() {
  return <RankingPage spec={spec} />;
}
