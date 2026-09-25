import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/metadata";
import { robotsConfig } from "@/lib/robots";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return robotsConfig(SITE_URL);
}
