import { getDataset } from "@/lib/data";

// Static export writes this to out/data/burger_index.json: the validated dataset, for download.
export const dynamic = "force-static";

export function GET() {
  return Response.json(getDataset());
}
