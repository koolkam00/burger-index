import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { underSpec } from "@/lib/rankings";

const spec = underSpec(20);

export const metadata = rankingMetadata(spec);

export default function BurgersUnder20Page() {
  return <RankingPage spec={spec} />;
}
