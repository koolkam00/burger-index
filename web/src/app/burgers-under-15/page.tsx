import { RankingPage, rankingMetadata } from "@/components/RankingPage";
import { underSpec } from "@/lib/rankings";

const spec = underSpec(15);

export const metadata = rankingMetadata(spec);

export default function BurgersUnder15Page() {
  return <RankingPage spec={spec} />;
}
