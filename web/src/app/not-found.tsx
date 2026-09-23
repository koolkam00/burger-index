import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="wrap">
      <PageHeader title="Page not found." lede="We couldn't find that page. The index, the map and every burger are still here." />
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="btn btn-primary">
          Back to the index
          <ArrowRight strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <Link href="/burgers" className="btn btn-secondary">
          Search every burger
        </Link>
      </div>
    </div>
  );
}
