import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandmarkPageView, landmarkMetadata } from "@/components/Landmarks";
import { landmarkPage, landmarkParams } from "@/lib/landmark-routes";

export const dynamicParams = false;

/**
 * Every priced burger spot within half a mile of a NYC landmark, nearest first (lib/landmarks.ts), for the
 * landmarks with at least 5 such spots: /burgers-near/times-square, /burgers-near/grand-central, …
 */
export function generateStaticParams() {
  return landmarkParams();
}

export async function generateMetadata({ params }: PageProps<"/burgers-near/[landmark]">): Promise<Metadata> {
  const page = landmarkPage((await params).landmark);
  return page ? landmarkMetadata(page) : {};
}

export default async function BurgersNearLandmarkPage({ params }: PageProps<"/burgers-near/[landmark]">) {
  const page = landmarkPage((await params).landmark);
  if (!page) notFound();
  return <LandmarkPageView page={page} />;
}
