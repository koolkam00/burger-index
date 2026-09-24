import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { MessageBottle } from "@/components/icons/nautical";
import { Caustics, WaveEdge } from "@/components/ui";

export const metadata = { title: "Page not found", robots: { index: false } };

/** The 404: the shallows band, a porthole with a message in a bottle on the trap net. No exclamation marks. */
export default function NotFound() {
  return (
    <section className="shallows atmo flex min-h-[60vh] flex-col justify-between" aria-labelledby="lost-title">
      <Caustics id="caustic-lost" />
      <div className="wrap band-body">
        <div className="grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:gap-12">
          <div className="lost-art" aria-hidden="true">
            <span className="porthole">
              <MessageBottle strokeWidth={1.5} />
            </span>
          </div>
          <div className="min-w-0">
            <h1 id="lost-title" className="t-display-l">
              This page sank.
            </h1>
            <p className="t-lede prose-width mt-4 md:mt-5">We couldn&apos;t find that page. The index, the map and every burger are still here.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/" className="btn btn-primary">
                Back to the counter
                <ArrowRight strokeWidth={2} aria-hidden="true" />
              </Link>
              <Link href="/burgers#search" className="btn btn-secondary">
                Search every burger
              </Link>
            </div>
          </div>
        </div>
      </div>
      <WaveEdge />
    </section>
  );
}
